#!/usr/bin/env python3
import os
import time
import requests
import logging
from difflib import SequenceMatcher

# --- Configuration ---
# Pointing specifically to your project directory to avoid permission errors
DEFAULT_PATH = "/home/ambers-angels/proj_dir/ambers-angels/backend/test_plates"
FRAME_ROOT = os.getenv("FRAME_ROOT", DEFAULT_PATH)
DRONE_ID = os.getenv("DRONE_ID", "drone1")
API_BASE = os.getenv("API_BASE", "http://127.0.0.1:8000")

# Target Plate for the Watchlist
TARGET_PLATE = "YVJ024"
MIN_CONFIDENCE = 70.0  # Set to 70 to catch your 77.72% hit

# --- Logging Setup ---
# This creates a permanent record you can 'tail -f' in another window
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("/home/ambers-angels/proj_dir/ambers-angels/worker/worker_debug.log"),
        logging.StreamHandler()
    ]
)

def is_fuzzy_match(detected, target, threshold=0.75):
    """Checks if the detected string is visually similar to our target."""
    return SequenceMatcher(None, detected, target).ratio() >= threshold

def process_loop():
    watch_dir = os.path.join(FRAME_ROOT, DRONE_ID)
    
    if not os.path.exists(watch_dir):
        os.makedirs(watch_dir, exist_ok=True)
        logging.info(f"Created directory: {watch_dir}")

    logging.info(f"🚀 Worker Started. Monitoring: {watch_dir}")
    logging.info(f"🎯 Target: {TARGET_PLATE} (Threshold: {MIN_CONFIDENCE}%)")

    while True:
        try:
            # Look for new frames
            files = [f for f in os.listdir(watch_dir) if f.endswith(('.jpg', '.png'))]
            
            for filename in sorted(files):
                file_path = os.path.join(watch_dir, filename)
                
                # Use the 'alpr' command directly since we proved it works
                # We use -n 1 to get the best candidate
                cmd = f"alpr -n 1 -j {file_path}"
                import subprocess
                import json
                
                result = subprocess.run(['alpr', '-n', '1', '-j', file_path], capture_output=True, text=True)
                
                try:
                    data = json.loads(result.stdout)
                    if data['results']:
                        best = data['results'][0]
                        plate_text = best['plate']
                        confidence = best['confidence']

                        logging.info(f"📸 {filename}: Detected {plate_text} ({confidence:.1f}%)")

                        # Fuzzy Match Check
                        if confidence >= MIN_CONFIDENCE:
                            if is_fuzzy_match(plate_text, TARGET_PLATE) or plate_text == TARGET_PLATE:
                                logging.info(f"🚨 ALERT: Match found! {plate_text} is likely {TARGET_PLATE}")
                            
                            # Send to Backend Database
                            payload = {
                                "drone_id": DRONE_ID,
                                "plate_best": plate_text,
                                "confidence": confidence,
                                "event_type": "detection"
                            }
                            requests.post(f"{API_BASE}/detections", json=payload, timeout=5)
                    
                    # Delete frame after processing to keep folder clean
                    os.remove(file_path)

                except Exception as e:
                    logging.error(f"Error parsing ALPR JSON for {filename}: {e}")
                    # Remove the file even if it failed so we don't get stuck in a loop
                    if os.path.exists(file_path): os.remove(file_path)

            time.sleep(0.5) # Fast polling
        except Exception as e:
            logging.error(f"Loop Error: {e}")
            time.sleep(2)

if __name__ == "__main__":
    process_loop()
