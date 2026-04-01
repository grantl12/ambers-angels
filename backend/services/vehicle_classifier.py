"""
backend/services/vehicle_classifier.py

Detects vehicles in a frame using YOLOv8, classifies body type, and extracts
dominant color from the bounding box.  Loaded lazily on first call so startup
stays fast even if ultralytics takes a moment to initialize.

YOLO model is controlled via env var YOLO_MODEL_PATH (default: yolov8n.pt).
On first run ultralytics will download the weights automatically.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np

# COCO class IDs that represent vehicles we care about
_VEHICLE_CLASSES: dict[int, str] = {
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck",
}

# Named color centroids in HSV space (H 0-179, S 0-255, V 0-255).
# Red wraps around H=0/180 so it appears twice.
_COLOR_CENTROIDS: list[tuple[str, np.ndarray]] = [
    ("red",    np.array([  0, 210, 200], dtype=np.float32)),
    ("red",    np.array([175, 210, 200], dtype=np.float32)),
    ("orange", np.array([ 10, 220, 215], dtype=np.float32)),
    ("yellow", np.array([ 26, 210, 210], dtype=np.float32)),
    ("green",  np.array([ 60, 180, 145], dtype=np.float32)),
    ("blue",   np.array([110, 210, 200], dtype=np.float32)),
    ("purple", np.array([140, 150, 145], dtype=np.float32)),
    ("white",  np.array([  0,  18, 235], dtype=np.float32)),
    ("silver", np.array([  0,  18, 175], dtype=np.float32)),
    ("gray",   np.array([  0,  18, 115], dtype=np.float32)),
    ("black",  np.array([  0,  18,  38], dtype=np.float32)),
]

_yolo_model = None


def _get_model():
    global _yolo_model
    if _yolo_model is None:
        from ultralytics import YOLO  # imported here to keep startup fast
        model_path = os.getenv("YOLO_MODEL_PATH", "yolov8n.pt")
        _yolo_model = YOLO(model_path)
    return _yolo_model


@dataclass
class VehicleAttributes:
    body_type: Optional[str] = None   # car | truck | motorcycle | bus
    color:     Optional[str] = None   # named color string
    bbox:      Optional[tuple[int, int, int, int]] = None  # x1, y1, x2, y2
    yolo_conf: float = 0.0


def _dominant_color(img_bgr: np.ndarray, x1: int, y1: int, x2: int, y2: int) -> str:
    """
    Extract dominant color from the upper 60 % of the bounding box
    (avoiding the plate / wheel area at the bottom).

    Uses K-means (k=3) on HSV pixels, picks the largest cluster, then
    finds the nearest named-color centroid with saturation-weighted hue distance.
    """
    h = y2 - y1
    crop = img_bgr[y1 : y1 + max(1, int(h * 0.60)), x1:x2]
    if crop.size == 0:
        return "unknown"

    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    pixels = hsv.reshape(-1, 3).astype(np.float32)

    k = min(3, len(pixels))
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _, labels, centers = cv2.kmeans(
        pixels, k, None, criteria, 5, cv2.KMEANS_RANDOM_CENTERS
    )
    dominant = centers[np.argmax(np.bincount(labels.flatten()))]

    best_name = "unknown"
    best_dist = float("inf")
    sat_weight = float(dominant[1]) / 255.0  # low-saturation → hue matters less

    for name, centroid in _COLOR_CENTROIDS:
        hue_diff = abs(int(dominant[0]) - int(centroid[0]))
        hue_diff = min(hue_diff, 180 - hue_diff)  # handle circular hue
        d = (
            sat_weight * hue_diff * 2.0
            + abs(float(dominant[1]) - float(centroid[1])) * 0.5
            + abs(float(dominant[2]) - float(centroid[2]))
        )
        if d < best_dist:
            best_dist = d
            best_name = name

    return best_name


def classify(image_path: str) -> list[VehicleAttributes]:
    """
    Run YOLOv8 on image_path.  Returns one VehicleAttributes per detected
    vehicle, ordered largest bounding box first (closest / most prominent).
    Returns [] on any error so callers can treat it as optional enrichment.
    """
    try:
        model = _get_model()
        results = model(image_path, verbose=False)[0]
        img = cv2.imread(image_path)
        if img is None:
            return []

        vehicles: list[VehicleAttributes] = []
        for box in results.boxes:
            cls_id = int(box.cls[0])
            if cls_id not in _VEHICLE_CLASSES:
                continue
            x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
            conf      = float(box.conf[0])
            body_type = _VEHICLE_CLASSES[cls_id]
            color     = _dominant_color(img, x1, y1, x2, y2)
            vehicles.append(
                VehicleAttributes(body_type=body_type, color=color,
                                  bbox=(x1, y1, x2, y2), yolo_conf=conf)
            )

        # Largest bounding-box area first
        vehicles.sort(
            key=lambda v: (v.bbox[2] - v.bbox[0]) * (v.bbox[3] - v.bbox[1]) if v.bbox else 0,
            reverse=True,
        )
        return vehicles

    except Exception as e:
        print(f"[VehicleClassifier] ⚠️ classify failed: {e}")
        return []
