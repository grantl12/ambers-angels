"""
backend/services/frame_preprocessor.py

Two-pass preprocessing pipeline to improve ALPR accuracy at oblique drone angles.

Pass 1 — CLAHE contrast enhancement
    Applied to the full frame before the first ALPR call. Helps with low-contrast
    plates, overexposed asphalt backgrounds, and foggy/hazy conditions.

Pass 2 — Perspective deskew + re-read
    OpenALPR returns four corner coordinates for every detected plate. If the plate
    was shot at an angle (e.g. 45° oblique from a drone), those corners describe a
    trapezoid. We apply a perspective transform to warp it into a flat rectangle at
    a fixed size (~400×90 px × 3 for upscaling), then re-run ALPR on that crop.
    If the deskewed read has higher confidence than the original, we substitute it.

Usage (both main.py and unified_worker.py):

    from services.frame_preprocessor import apply_clahe, enhance_alpr_results

    # Before ALPR:
    enhanced_path, clahe_was_temp = apply_clahe(original_path)
    try:
        results = alpr.recognize_file(enhanced_path)
        results = enhance_alpr_results(alpr, enhanced_path, results)
    finally:
        if clahe_was_temp:
            os.unlink(enhanced_path)

enhance_alpr_results is a no-op if results is empty or coordinates are missing,
so it is safe to call unconditionally.
"""
from __future__ import annotations

import os
import tempfile
from typing import Any

import cv2
import numpy as np

# Standard US plate dimensions ~520mm × 110mm → aspect ~4.73:1.
# We render at this size then scale up 3× for better ALPR accuracy.
_PLATE_W = 400
_PLATE_H = 85
_SCALE   = 3


# ---------------------------------------------------------------------------
# Pass 1 — CLAHE contrast enhancement
# ---------------------------------------------------------------------------

def apply_clahe(image_path: str) -> tuple[str, bool]:
    """
    Apply CLAHE (Contrast Limited Adaptive Histogram Equalization) to the
    luminance channel of the frame.

    Returns (path, is_temp):
        path     — path to the enhanced image (may equal image_path on failure)
        is_temp  — True if the returned path is a new temp file the caller must delete
    """
    try:
        img = cv2.imread(image_path)
        if img is None:
            return image_path, False

        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        l = clahe.apply(l)
        enhanced = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)

        fd, tmp_path = tempfile.mkstemp(suffix=".jpg")
        os.close(fd)
        cv2.imwrite(tmp_path, enhanced, [cv2.IMWRITE_JPEG_QUALITY, 95])
        return tmp_path, True

    except Exception as e:
        print(f"[Preprocessor] ⚠️  CLAHE failed: {e}")
        return image_path, False


# ---------------------------------------------------------------------------
# Pass 2 — Perspective deskew + ALPR re-read
# ---------------------------------------------------------------------------

def enhance_alpr_results(
    alpr: Any,
    image_path: str,
    initial_results: dict[str, Any],
) -> dict[str, Any]:
    """
    For each plate detection in initial_results that carries four corner
    coordinates, warp the plate region to a flat rectangle and re-run ALPR.
    If the deskewed confidence exceeds the original, substitute the result.

    Returns a new results dict — never mutates the input.
    Safe to call when initial_results is empty or None.
    """
    if not initial_results or not initial_results.get("results"):
        return initial_results or {}

    img = cv2.imread(image_path)
    if img is None:
        return initial_results

    improved: list[dict[str, Any]] = []

    for detection in initial_results["results"]:
        coords = detection.get("coordinates", [])
        deskewed = _try_deskew_and_read(alpr, img, coords, detection)
        improved.append(deskewed)

    return {**initial_results, "results": improved}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _try_deskew_and_read(
    alpr: Any,
    img: np.ndarray,
    coords: list[dict],
    original_detection: dict[str, Any],
) -> dict[str, Any]:
    """
    Attempt a perspective-corrected re-read for one plate detection.
    Returns the better detection (higher confidence) between original and deskewed.
    Returns original unchanged on any error or if coordinates are unavailable.
    """
    if len(coords) != 4:
        return original_detection

    try:
        # OpenALPR corners: [top-left, top-right, bottom-right, bottom-left]
        src = np.array(
            [[c["x"], c["y"]] for c in coords],
            dtype=np.float32,
        )

        plate_w = _PLATE_W * _SCALE
        plate_h = _PLATE_H * _SCALE
        dst = np.array(
            [[0, 0], [plate_w, 0], [plate_w, plate_h], [0, plate_h]],
            dtype=np.float32,
        )

        M      = cv2.getPerspectiveTransform(src, dst)
        warped = cv2.warpPerspective(img, M, (plate_w, plate_h))

        # Additional contrast pass on the cropped plate
        lab = cv2.cvtColor(warped, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(4, 4))
        l = clahe.apply(l)
        warped = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)

        fd, tmp_path = tempfile.mkstemp(suffix=".jpg")
        os.close(fd)
        try:
            cv2.imwrite(tmp_path, warped, [cv2.IMWRITE_JPEG_QUALITY, 97])
            deskewed_results = alpr.recognize_file(tmp_path)
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

        if not deskewed_results or not deskewed_results.get("results"):
            return original_detection

        best = max(deskewed_results["results"], key=lambda r: r.get("confidence", 0.0))

        orig_conf   = original_detection.get("confidence", 0.0)
        deskew_conf = best.get("confidence", 0.0)

        if deskew_conf > orig_conf:
            merged = dict(original_detection)
            merged["plate"]      = best["plate"]
            merged["confidence"] = deskew_conf
            merged["candidates"] = best.get("candidates", original_detection.get("candidates", []))
            merged["deskew_applied"] = True
            merged["deskew_gain"]    = round(deskew_conf - orig_conf, 2)
            print(
                f"[Preprocessor] ✅ Deskew improved {original_detection.get('plate')} "
                f"→ {best['plate']}  ({orig_conf:.1f}% → {deskew_conf:.1f}%)"
            )
            return merged

        return original_detection

    except Exception as e:
        print(f"[Preprocessor] ⚠️  Deskew failed: {e}")
        return original_detection
