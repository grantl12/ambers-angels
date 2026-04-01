from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from statistics import mean, median
from typing import Any, Iterable
from uuid import UUID

from services.detection_models import EventClassification, EventStatus


# -----------------------------------------------------------------------------
# Tunable defaults
# -----------------------------------------------------------------------------


RAW_DETECTION_FLOOR = 55.0
SINGLE_FRAME_HIGH_CONFIDENCE = 70.0
AGGREGATION_WINDOW_SECONDS = 5
PLATE_LENGTH_MIN = 5
PLATE_LENGTH_MAX = 10

PROBABLE_EVENT_MIN_SCORE = 75.0
HIGH_CONFIDENCE_EVENT_MIN_SCORE = 90.0
PROBABLE_EVENT_MIN_SUPPORT = 2
HIGH_CONFIDENCE_EVENT_MIN_SUPPORT = 3
DOMINANT_RATIO_PROBABLE = 0.60
DOMINANT_RATIO_HIGH = 0.75

KNOWN_OCR_CONFUSIONS: set[tuple[str, str]] = {
    ("O", "0"),
    ("0", "O"),
    ("I", "1"),
    ("1", "I"),
    ("B", "8"),
    ("8", "B"),
    ("S", "5"),
    ("5", "S"),
    ("Z", "2"),
    ("2", "Z"),
    ("G", "6"),
    ("6", "G"),
}

NEGATIVE_QUALITY_FLAGS = {
    "motion_blur",
    "blur",
    "skew",
    "low_size",
    "partial_plate",
    "compression_artifact",
    "far_distance",
}


# -----------------------------------------------------------------------------
# Data containers
# -----------------------------------------------------------------------------


@dataclass(slots=True)
class DetectionInput:
    detection_id: UUID | str
    frame_id: UUID | str
    drone_id: str
    detected_at: datetime
    plate_raw: str
    confidence: float
    quality_flags: list[str] = field(default_factory=list)
    telemetry: dict[str, Any] | None = None
    bbox: dict[str, Any] | None = None
    alpr_payload: dict[str, Any] | None = None
    vehicle_color: str | None = None
    vehicle_type:  str | None = None
    vehicle_make:  str | None = None
    vehicle_model: str | None = None

    @property
    def plate_normalized(self) -> str:
        return normalize_plate(self.plate_raw)


@dataclass(slots=True)
class GroupedHypothesis:
    plate: str
    adjusted_score_total: float
    raw_score_total: float
    count: int


@dataclass(slots=True)
class EventSnapshot:
    drone_id: str
    group_key: str
    plate_best: str
    plate_normalized: str
    first_seen_at: datetime
    last_seen_at: datetime
    aggregate_confidence: float
    classification: EventClassification
    status: EventStatus
    detection_count: int
    distinct_frame_count: int
    best_frame_id: UUID | str | None
    best_detection_id: UUID | str | None
    should_open_event: bool
    should_alert: bool
    dominant_ratio: float
    top_hypotheses: list[GroupedHypothesis]
    quality_flags: list[str]
    raw_summary: dict[str, Any]
    location_centroid: dict[str, Any] | None = None
    vehicle_color: str | None = None
    vehicle_type:  str | None = None
    vehicle_make:  str | None = None
    vehicle_model: str | None = None


# -----------------------------------------------------------------------------
# Normalization and matching
# -----------------------------------------------------------------------------


def normalize_plate(plate: str) -> str:
    normalized = "".join(ch for ch in plate.upper() if ch.isalnum())
    return normalized


def has_usable_plate(plate: str) -> bool:
    return PLATE_LENGTH_MIN <= len(plate) <= PLATE_LENGTH_MAX


def is_known_confusion(a: str, b: str) -> bool:
    return (a, b) in KNOWN_OCR_CONFUSIONS


def one_edit_ocr_compatible(left: str, right: str) -> bool:
    if abs(len(left) - len(right)) > 1:
        return False

    if left == right:
        return True

    if len(left) == len(right):
        diffs: list[tuple[str, str]] = []
        for lch, rch in zip(left, right):
            if lch != rch:
                diffs.append((lch, rch))
                if len(diffs) > 1:
                    return False
        return len(diffs) == 1 and is_known_confusion(*diffs[0])

    shorter, longer = (left, right) if len(left) < len(right) else (right, left)
    i = j = 0
    edits = 0
    while i < len(shorter) and j < len(longer):
        if shorter[i] == longer[j]:
            i += 1
            j += 1
            continue
        edits += 1
        if edits > 1:
            return False
        j += 1
    return True


def plates_match(candidate: str, existing: str) -> bool:
    if candidate == existing:
        return True
    if not has_usable_plate(candidate) or not has_usable_plate(existing):
        return False
    return one_edit_ocr_compatible(candidate, existing)


# -----------------------------------------------------------------------------
# Quality / scoring helpers
# -----------------------------------------------------------------------------


def frame_quality_weight(flags: Iterable[str]) -> float:
    penalty_flags = [flag for flag in flags if flag in NEGATIVE_QUALITY_FLAGS]
    if not penalty_flags:
        return 1.0
    if len(penalty_flags) == 1:
        return 0.85
    if len(penalty_flags) == 2:
        return 0.70
    return 0.60


def quality_penalty(flags_by_detection: Iterable[list[str]]) -> float:
    penalty_count = 0
    total = 0
    for flags in flags_by_detection:
        total += 1
        if any(flag in NEGATIVE_QUALITY_FLAGS for flag in flags):
            penalty_count += 1
    if total == 0:
        return 0.0
    ratio = penalty_count / total
    if ratio >= 0.75:
        return 15.0
    if ratio >= 0.50:
        return 10.0
    if ratio >= 0.25:
        return 5.0
    return 0.0


# -----------------------------------------------------------------------------
# Live group state
# -----------------------------------------------------------------------------


@dataclass
class ActiveDetectionGroup:
    drone_id: str
    canonical_plate: str
    started_at: datetime
    window_seconds: int = AGGREGATION_WINDOW_SECONDS
    detections: list[DetectionInput] = field(default_factory=list)

    def can_accept(self, detection: DetectionInput) -> bool:
        if detection.drone_id != self.drone_id:
            return False
        if detection.detected_at - self.last_seen_at > timedelta(seconds=self.window_seconds):
            return False
        return plates_match(detection.plate_normalized, self.canonical_plate)

    @property
    def last_seen_at(self) -> datetime:
        if not self.detections:
            return self.started_at
        return max(item.detected_at for item in self.detections)

    @property
    def group_key(self) -> str:
        bucket = int(self.started_at.timestamp() // self.window_seconds)
        return f"{self.drone_id}:{self.canonical_plate}:{bucket}"

    def add(self, detection: DetectionInput) -> None:
        self.detections.append(detection)

    def is_expired(self, now: datetime | None = None) -> bool:
        now = now or datetime.now(timezone.utc)
        return now - self.last_seen_at > timedelta(seconds=self.window_seconds)

    def build_snapshot(self) -> EventSnapshot:
        if not self.detections:
            raise ValueError("Cannot build snapshot for empty detection group")

        grouped_scores: dict[str, float] = defaultdict(float)
        grouped_raw_scores: dict[str, float] = defaultdict(float)
        grouped_counts: Counter[str] = Counter()
        distinct_frame_ids: set[UUID | str] = set()
        quality_flags_union: set[str] = set()

        best_adjusted_detection: DetectionInput | None = None
        best_adjusted_score = -1.0

        per_detection_weights: list[float] = []
        confidences: list[float] = []

        for detection in self.detections:
            plate = detection.plate_normalized
            if not plate:
                continue

            weight = frame_quality_weight(detection.quality_flags)
            adjusted_score = detection.confidence * weight

            grouped_scores[plate] += adjusted_score
            grouped_raw_scores[plate] += detection.confidence
            grouped_counts[plate] += 1
            distinct_frame_ids.add(detection.frame_id)
            quality_flags_union.update(detection.quality_flags)
            per_detection_weights.append(weight)
            confidences.append(detection.confidence)

            if adjusted_score > best_adjusted_score:
                best_adjusted_score = adjusted_score
                best_adjusted_detection = detection

        if not grouped_counts:
            raise ValueError("No usable normalized plates in detection group")

        sorted_hypotheses = sorted(
            grouped_counts.keys(),
            key=lambda plate: (grouped_scores[plate], grouped_counts[plate], grouped_raw_scores[plate]),
            reverse=True,
        )
        winning_plate = sorted_hypotheses[0]
        winning_count = grouped_counts[winning_plate]
        dominant_ratio = winning_count / len(self.detections)

        top_hypotheses = [
            GroupedHypothesis(
                plate=plate,
                adjusted_score_total=round(grouped_scores[plate], 2),
                raw_score_total=round(grouped_raw_scores[plate], 2),
                count=grouped_counts[plate],
            )
            for plate in sorted_hypotheses[:3]
        ]

        top_confidences = [
            item.confidence
            for item in self.detections
            if item.plate_normalized == winning_plate
        ]
        max_confidence = max(top_confidences) if top_confidences else 0.0
        mean_confidence = mean(top_confidences) if top_confidences else 0.0
        median_confidence = median(top_confidences) if top_confidences else 0.0

        repetition_bonus = 0.0
        if winning_count >= 3:
            repetition_bonus = 10.0
        elif winning_count == 2:
            repetition_bonus = 5.0

        consistency_bonus = 5.0 if dominant_ratio >= DOMINANT_RATIO_HIGH else 0.0
        penalty = quality_penalty(item.quality_flags for item in self.detections)

        aggregate_confidence = min(
            99.0,
            max(
                0.0,
                (max_confidence * 0.50)
                + (mean_confidence * 0.30)
                + (median_confidence * 0.10)
                + repetition_bonus
                + consistency_bonus
                - penalty,
            ),
        )

        classification = EventClassification.WEAK
        status = EventStatus.CANDIDATE
        should_open_event = False
        should_alert = False

        if max_confidence >= SINGLE_FRAME_HIGH_CONFIDENCE or winning_count >= 2:
            should_open_event = True

        if (
            aggregate_confidence >= HIGH_CONFIDENCE_EVENT_MIN_SCORE
            and winning_count >= HIGH_CONFIDENCE_EVENT_MIN_SUPPORT
            and dominant_ratio >= DOMINANT_RATIO_HIGH
        ):
            classification = EventClassification.HIGH_CONFIDENCE
            status = EventStatus.QUEUED_REVIEW
            should_alert = True
        elif (
            aggregate_confidence >= PROBABLE_EVENT_MIN_SCORE
            and winning_count >= PROBABLE_EVENT_MIN_SUPPORT
            and dominant_ratio >= DOMINANT_RATIO_PROBABLE
        ):
            classification = EventClassification.PROBABLE
            status = EventStatus.QUEUED_REVIEW
        elif should_open_event:
            classification = EventClassification.WEAK
            status = EventStatus.CANDIDATE

        if best_adjusted_detection and best_adjusted_detection.plate_normalized != winning_plate:
            best_frame_id = next(
                (
                    item.frame_id
                    for item in self.detections
                    if item.plate_normalized == winning_plate
                ),
                best_adjusted_detection.frame_id,
            )
        else:
            best_frame_id = best_adjusted_detection.frame_id if best_adjusted_detection else None

        location_centroid = _compute_location_centroid(self.detections)

        # Vehicle attributes — take from the best-scoring detection that has them.
        # Prefer make/model from Plate Recognizer; fall back to YOLO color/type.
        vehicle_color = vehicle_type = vehicle_make = vehicle_model = None
        for det in sorted(self.detections, key=lambda d: d.confidence, reverse=True):
            if vehicle_make is None and det.vehicle_make:
                vehicle_make  = det.vehicle_make
                vehicle_model = det.vehicle_model
            if vehicle_color is None and det.vehicle_color:
                vehicle_color = det.vehicle_color
            if vehicle_type is None and det.vehicle_type:
                vehicle_type = det.vehicle_type
            if all([vehicle_color, vehicle_type, vehicle_make]):
                break

        raw_summary = {
            "max_confidence": round(max_confidence, 2),
            "mean_confidence": round(mean_confidence, 2),
            "median_confidence": round(median_confidence, 2),
            "dominant_ratio": round(dominant_ratio, 3),
            "repetition_bonus": repetition_bonus,
            "consistency_bonus": consistency_bonus,
            "quality_penalty": penalty,
            "top_hypotheses": [
                {
                    "plate": h.plate,
                    "adjusted_score_total": h.adjusted_score_total,
                    "raw_score_total": h.raw_score_total,
                    "count": h.count,
                }
                for h in top_hypotheses
            ],
        }

        return EventSnapshot(
            drone_id=self.drone_id,
            group_key=self.group_key,
            plate_best=winning_plate,
            plate_normalized=winning_plate,
            first_seen_at=min(item.detected_at for item in self.detections),
            last_seen_at=max(item.detected_at for item in self.detections),
            aggregate_confidence=round(aggregate_confidence, 2),
            classification=classification,
            status=status,
            detection_count=len(self.detections),
            distinct_frame_count=len(distinct_frame_ids),
            best_frame_id=best_frame_id,
            best_detection_id=best_adjusted_detection.detection_id if best_adjusted_detection else None,
            should_open_event=should_open_event,
            should_alert=should_alert,
            dominant_ratio=round(dominant_ratio, 3),
            top_hypotheses=top_hypotheses,
            quality_flags=sorted(quality_flags_union),
            raw_summary=raw_summary,
            location_centroid=location_centroid,
            vehicle_color=vehicle_color,
            vehicle_type=vehicle_type,
            vehicle_make=vehicle_make,
            vehicle_model=vehicle_model,
        )


# -----------------------------------------------------------------------------
# Aggregation service
# -----------------------------------------------------------------------------


class AggregationService:
    def __init__(self, window_seconds: int = AGGREGATION_WINDOW_SECONDS) -> None:
        self.window_seconds = window_seconds
        self._active_groups: list[ActiveDetectionGroup] = []

    def ingest(self, detection: DetectionInput) -> EventSnapshot | None:
        plate = detection.plate_normalized
        if not plate or not has_usable_plate(plate):
            return None
        if detection.confidence < RAW_DETECTION_FLOOR:
            return None

        group = self._find_matching_group(detection)
        if group is None:
            group = ActiveDetectionGroup(
                drone_id=detection.drone_id,
                canonical_plate=plate,
                started_at=detection.detected_at,
                window_seconds=self.window_seconds,
            )
            self._active_groups.append(group)

        group.add(detection)
        return group.build_snapshot()

    def flush_expired(self, now: datetime | None = None) -> list[EventSnapshot]:
        now = now or datetime.now(timezone.utc)
        expired: list[EventSnapshot] = []
        remaining: list[ActiveDetectionGroup] = []

        for group in self._active_groups:
            if group.is_expired(now):
                expired.append(group.build_snapshot())
            else:
                remaining.append(group)

        self._active_groups = remaining
        return expired

    def active_group_count(self) -> int:
        return len(self._active_groups)

    def _find_matching_group(self, detection: DetectionInput) -> ActiveDetectionGroup | None:
        candidates: list[ActiveDetectionGroup] = []
        for group in self._active_groups:
            if group.can_accept(detection):
                candidates.append(group)

        if not candidates:
            return None

        candidates.sort(
            key=lambda group: (
                group.canonical_plate == detection.plate_normalized,
                group.last_seen_at,
                len(group.detections),
            ),
            reverse=True,
        )
        return candidates[0]


# -----------------------------------------------------------------------------
# Internal helpers
# -----------------------------------------------------------------------------


def _compute_location_centroid(detections: Iterable[DetectionInput]) -> dict[str, Any] | None:
    lats: list[float] = []
    lons: list[float] = []
    alts: list[float] = []

    for detection in detections:
        if not detection.telemetry:
            continue
        lat = detection.telemetry.get("lat")
        lon = detection.telemetry.get("lon")
        alt = detection.telemetry.get("alt")
        if isinstance(lat, (int, float)):
            lats.append(float(lat))
        if isinstance(lon, (int, float)):
            lons.append(float(lon))
        if isinstance(alt, (int, float)):
            alts.append(float(alt))

    if not lats or not lons:
        return None

    centroid: dict[str, Any] = {
        "lat": round(sum(lats) / len(lats), 7),
        "lon": round(sum(lons) / len(lons), 7),
        "source": "telemetry_centroid",
    }
    if alts:
        centroid["alt"] = round(sum(alts) / len(alts), 2)
    return centroid
