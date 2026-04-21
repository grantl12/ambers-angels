"""
backend/services/cdc_classifier.py

Cascade inference stage for Amber's Angels.
Loads the ChaDongCha MobileNetV3 vehicle classifier (ONNX) and provides
fine-grained make/model/generation classification for vehicle crops.

Model path is controlled via CDC_MODEL_PATH.
"""
import logging
import os
import json
import numpy as np
from PIL import Image
from pathlib import Path

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config & Paths
# ---------------------------------------------------------------------------
# Default to the D: drive path mentioned in CDC mandates
DEFAULT_CDC_ROOT = Path("D:/Users/grant/Documents/ChaDongCha/ml/export")
MODEL_PATH    = Path(os.getenv("CDC_MODEL_PATH", str(DEFAULT_CDC_ROOT / "vehicle_classifier.onnx")))
MANIFEST_PATH = Path(os.getenv("CDC_MANIFEST_PATH", str(DEFAULT_CDC_ROOT / "manifest.json")))

_ort_session = None
_classes = []
_input_size = 224

def _load_model():
    global _ort_session, _classes, _input_size
    if _ort_session is not None:
        return True

    if not MODEL_PATH.exists():
        logger.warning("CDC Model not found at %s", MODEL_PATH)
        return False

    try:
        import onnxruntime as ort
        
        # Load manifest for classes and input size
        if MANIFEST_PATH.exists():
            with open(MANIFEST_PATH, "r") as f:
                manifest = json.load(f)
                _classes = manifest.get("classes", [])
                _input_size = manifest.get("input_size", 224)
        
        opts = ort.SessionOptions()
        opts.log_severity_level = 3
        _ort_session = ort.InferenceSession(str(MODEL_PATH), sess_opts=opts)
        logger.info("✅ CDC MobileNetV3 model loaded from %s", MODEL_PATH)
        return True
    except Exception as e:
        logger.error("Failed to load CDC model: %s", e)
        return False

def _preprocess(img: Image.Image, input_size: int) -> np.ndarray:
    """Standard CDC preprocessing: resize -> center-crop -> [0,1] CHW."""
    scale_size = int(input_size * 1.15)
    w, h = img.size
    if w < h:
        new_w, new_h = scale_size, int(h * scale_size / w)
    else:
        new_h, new_w = scale_size, int(w * scale_size / h)
    
    img = img.resize((new_w, new_h), Image.BILINEAR).convert("RGB")
    left = (new_w - input_size) // 2
    top  = (new_h - input_size) // 2
    img  = img.crop((left, top, left + input_size, top + input_size))
    
    arr  = np.array(img, dtype=np.float32) / 255.0
    return arr.transpose(2, 0, 1)[None]   # [1, 3, H, W]

def classify_crop(crop_bgr: np.ndarray) -> dict | None:
    """
    Classify a BGR crop (from YOLO) using the CDC model.
    Returns { 'label': str, 'confidence': float } or None.
    """
    if not _load_model():
        return None

    try:
        # Convert BGR (OpenCV) to RGB (PIL)
        img_rgb = Image.fromarray(crop_bgr[:, :, ::-1])
        tensor = _preprocess(img_rgb, _input_size)
        
        input_name = _ort_session.get_inputs()[0].name
        logits = _ort_session.run(None, {input_name: tensor})[0][0]
        
        # Softmax
        e = np.exp(logits - logits.max())
        probs = e / e.sum()
        
        top_idx = np.argmax(probs)
        label = _classes[top_idx]
        conf = float(probs[top_idx])
        
        # Ignore background class
        if label == "_Background":
            return None
            
        return {"label": label, "confidence": conf}
    except Exception as e:
        logger.warning("CDC classification failed: %s", e)
        return None
