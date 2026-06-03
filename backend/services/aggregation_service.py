from __future__ import annotations

import math
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
    yolo_conf:     float = 0.0
    # Cascade Stage 2: CDC
    cdc_label:     str | None = None
    cdc_conf:      float = 0.0
    # Bayesian vehicle prior (geometric mean across active alert profiles)
    prior_weight:  float = 1.0

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
    best_frame_id: UUID | str | None = None
    best_detection_id: UUID | str | None = None
    should_open_event: bool = False
    should_alert: bool = False
    dominant_ratio: float = 0.0
    top_hypotheses: list[GroupedHypothesis] = field(default_factory=list)
    quality_flags: list[str] = field(default_factory=list)
    raw_summary: dict[str, Any] = field(default_factory=dict)
    location_centroid: tuple[float, float] | None = None
    vehicle_color: str | None = None
    vehicle_type:  str | None = None
    vehicle_make:  str | None = None
    vehicle_model: str | None = None
    # Cascade Stage 2: CDC
    cdc_label:     str | None = None


# -----------------------------------------------------------------------------
# Scoring logic
# -----------------------------------------------------------------------------


def normalize_plate(raw: str) -> str:
    if not raw:
        return ""
    # Uppercase and remove non-alphanumeric (except space/dash if needed, but ALPR usually strips)
    clean = "".join(c.upper() for c in raw if c.isalnum())
    return clean


def has_usable_plate(normalized: str) -> bool:
    return PLATE_LENGTH_MIN <= len(normalized) <= PLATE_LENGTH_MAX


def plates_match(p1: str, p2: str) -> bool:
    if p1 == p2:
        return True
    if abs(len(p1) - len(p2)) > 1:
        return False
    # Check for common OCR confusions at every position
    # (O vs 0, I vs 1, etc.)
    if len(p1) == len(p2):
        mismatches = 0
        for c1, c2 in zip(p1, p2):
            if c1 == c2:
                continue
            if (c1, c2) in KNOWN_OCR_CONFUSIONS:
                continue
            mismatches += 1
        return mismatches <= 1
    return False


def frame_quality_weight(flags: Iterable[str]) -> float:
    penalty = 0.0
    for f in flags:
        if f in NEGATIVE_QUALITY_FLAGS:
            penalty += 0.15
    return max(0.4, 1.0 - penalty)


def quality_penalty(flag_sets: Iterable[Iterable[str]]) -> float:
    # If every single frame in the group has a quality flag, penalize the aggregate
    all_flags: list[set[str]] = [set(fs) for fs in flag_sets if fs]
    if not all_flags:
        return 0.0
    
    common_penalties = set(NEGATIVE_QUALITY_FLAGS)
    # intersection of all flags seen across frames
    persistent_flags = all_flags[0].intersection(*all_flags[1:])
    
    penalty = 0.0
    for f in persistent_flags:
        if f in common_penalties:
            penalty += 5.0
    return min(15.0, penalty)


def _vehicle_corroboration_bonus(detections: list[DetectionInput]) -> tuple[float, dict[str, Any]]:
    """
    Computes a corroboration bonus (0-8 pts) based on YOLO + CDC consistency.
    """
    if not detections:
        return 0.0, {}

    colors = [d.vehicle_color for d in detections if d.vehicle_color]
    types  = [d.vehicle_type  for d in detections if d.vehicle_type]
    cdc_labels = [d.cdc_label for d in detections if d.cdc_label]
    yolo_confs = [d.yolo_conf  for d in detections if d.yolo_conf > 0]
    cdc_confs  = [d.cdc_conf   for d in detections if d.cdc_conf > 0]

    color_bonus = 0.0
    dominant_color = None
    if colors:
        c_counts = Counter(colors)
        dominant_color, count = c_counts.most_common(1)[0]
        if count / len(detections) >= DOMINANT_RATIO_HIGH:
            color_bonus = 2.0

    type_bonus = 0.0
    dominant_type = None
    if types:
        t_counts = Counter(types)
        dominant_type, count = t_counts.most_common(1)[0]
        if count / len(detections) >= DOMINANT_RATIO_HIGH:
            type_bonus = 2.0

    # CDC Bonus — generational match consistency is worth more
    cdc_bonus = 0.0
    dominant_cdc = None
    if cdc_labels:
        cdc_counts = Counter(cdc_labels)
        dominant_cdc, count = cdc_counts.most_common(1)[0]
        if count / len(detections) >= DOMINANT_RATIO_PROBABLE:
            cdc_bonus = 4.0  # Big bonus for generational agreement

    yolo_signal = 0.0
    avg_yolo_conf = None
    if yolo_confs:
        avg_yolo_conf = mean(yolo_confs)
        yolo_signal = (avg_yolo_conf - 0.5) * 6.0  # ±3 pts

    total = color_bonus + type_bonus + cdc_bonus + yolo_signal
    detail: dict[str, Any] = {
        "color_bonus":    round(color_bonus, 2),
        "type_bonus":     round(type_bonus, 2),
        "cdc_bonus":      round(cdc_bonus, 2),
        "yolo_signal":    round(yolo_signal, 3),
        "avg_yolo_conf":  round(avg_yolo_conf, 3) if avg_yolo_conf is not None else None,
        "dominant_color": dominant_color,
        "dominant_type":  dominant_type,
        "dominant_cdc":   dominant_cdc,
        "total":          round(total, 3),
    }
    return round(total, 3), detail


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

        vehicle_bonus, vehicle_detail = _vehicle_corroboration_bonus(self.detections)

        # Bayesian prior bonus: geometric mean of prior_weight across the group.
        # log2 scale → prior=3.67 (minivan/AMBER) adds +6.9 pts; prior=0.5 subtracts 4 pts.
        prior_weights = [d.prior_weight for d in self.detections if d.prior_weight != 1.0]
        group_prior = (math.prod(prior_weights) ** (1 / len(prior_weights))) if prior_weights else 1.0
        prior_bonus = round(math.log2(max(0.1, min(10.0, group_prior))) * 4.0, 3)

        aggregate_confidence = min(
            99.0,
            max(
                0.0,
                (max_confidence * 0.50)
                + (mean_confidence * 0.30)
                + (median_confidence * 0.10)
                + repetition_bonus
                + consistency_bonus
                + vehicle_bonus
                + prior_bonus
                - penalty,
            )
        )

        status = EventStatus.CANDIDATE
        classification = EventClassification.WEAK
        should_alert = False

        if aggregate_confidence >= HIGH_CONFIDENCE_EVENT_MIN_SCORE and winning_count >= HIGH_CONFIDENCE_EVENT_MIN_SUPPORT:
            status = EventStatus.DETECTION
            classification = EventClassification.HIGH_CONFIDENCE
            should_alert = True
        elif aggregate_confidence >= PROBABLE_EVENT_MIN_SCORE and winning_count >= PROBABLE_EVENT_MIN_SUPPORT:
            status = EventStatus.DETECTION
            classification = EventClassification.PROBABLE
            should_alert = True

        should_open_event = aggregate_confidence >= RAW_DETECTION_FLOOR

        # Pick a representative location and vehicle profile from the group
        location_centroid = None
        lats = [d.telemetry["lat"] for d in self.detections if d.telemetry and "lat" in d.telemetry]
        lngs = [d.telemetry["lng"] for d in self.detections if d.telemetry and "lng" in d.telemetry]
        if lats and lngs:
            location_centroid = (sum(lats) / len(lats), sum(lngs) / len(lngs))

        # Best frame for thumbnails
        best_frame_id = best_adjusted_detection.frame_id if best_adjusted_detection else None

        # Consolidate profile
        vehicle_color = vehicle_detail.get("dominant_color")
        vehicle_type  = vehicle_detail.get("dominant_type")
        cdc_label     = vehicle_detail.get("dominant_cdc")
        
        # Try to pull make/model from Plate Recognizer enrichment if available
        vehicle_make = None
        vehicle_model = None
        for det in self.detections:
            if det.vehicle_make:
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
            "vehicle_corroboration": vehicle_detail,
            "prior_bonus": prior_bonus,
            "group_prior_weight": round(group_prior, 4),
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
            cdc_label=cdc_label,
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

    def _find_matching_group(self, detection: DetectionInput) -> ActiveDetectionGroup | None:
        # Search backwards (most recent groups first)
        for group in reversed(self._active_groups):
            if group.can_accept(detection):
                return group
        return None

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
