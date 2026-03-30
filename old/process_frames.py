#!/usr/bin/env python3
import os
import time
import requests
import logging
import subprocess
import json
import shutil
from difflib import SequenceMatcher

# --- Configuration ---
DEFAULT_PATH = "/home/ambers-angels/proj_dir/ambers-angels/backend/test_plates"
FRAME_ROOT = os.getenv("FRAME_ROOT", DEFAULT_PATH)
DRONE_ID = os.getenv("DRONE_ID", "drone1")

# We use localhost here to match your Uvicorn 0.0.0.0 binding
API_BASE = os.getenv("API_BASE", "http://localhost:8000")

# Target Plate for the Watchlist
TARGET_PLATE = "YVJ024"
MIN_CONFIDENCE = 70.0 

# Path for Anomalies
ANOMALY_DIR = os.path.join(FRAME_ROOT, "anomalies")

# Session Tracker
active_tracks = {}
TRACK_EXPIRY = 10 

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("/home/ambers-angels/proj_dir/ambers-angels/worker/worker_debug.log"),
        logging.StreamHandler()
    ]
)

def is_fuzzy_match(detected, target, threshold=0.75):
    return SequenceMatcher(None, detected, target).ratio() >= threshold

def clean_expired_tracks():
    now = time.time()
    for plate in list(active_tracks.keys()):
        if now - active_tracks[plate]['last_seen'] > TRACK_EXPIRY:
            del active_tracks[plate]

def process_loop():
    watch_dir = os.path.join(FRAME_ROOT, DRONE_ID)
    for d in [watch_dir, ANOMALY_DIR]:
        os.makedirs(d, exist_ok=True)

    logging.info(f"🚀 Worker Started. Monitoring: {watch_dir}")
    logging.info(f"🎯 Target: {TARGET_PLATE} | API: {API_BASE}")

    while True:
        try:
            clean_expired_tracks()
            files = [f for f in os.listdir(watch_dir) if f.endswith(('.jpg', '.png'))]
            
            for filename in sorted(files):
                file_path = os.path.join(watch_dir, filename)
                
                # Use subprocess to get the JSON from OpenALPR
                result = subprocess.run(['alpr', '-n', '1', '-j', file_path], capture_output=True, text=True)
                
                try:
                    data = json.loads(result.stdout)
                    
                    if not data.get('results'):
                        logging.warning(f"⚠️ ANOMALY: No plate in {filename}. Archiving.")
                        shutil.move(file_path, os.path.join(ANOMALY_DIR, filename))
                        continue

                    best = data['results'][0]
                    plate_text = best['plate']
                    confidence = best['confidence']

                    logging.info(f"📸 {filename}: {plate_text} ({confidence:.1f}%)")

                    # Session logic
                    if plate_text not in active_tracks:
                        active_tracks[plate_text] = {'count': 0, 'last_seen': time.time()}
                    active_tracks[plate_text]['last_seen'] = time.time()
                    active_tracks[plate_text]['count'] += 1

                    # Limit DB writes to 3 per car session
                    if active_tracks[plate_text]['count'] <= 3:
                        matched = is_fuzzy_match(plate_text, TARGET_PLATE) or plate_text == TARGET_PLATE
                        
                        if matched:
                            logging.info(f"🚨 ALERT: Match found! {plate_text} ~ {TARGET_PLATE}")

                        if confidence >= MIN_CONFIDENCE:
                            payload = {
                                "drone_id": DRONE_ID,
                                "plate_best": plate_text,
                                "confidence": confidence,
                                "event_type": "detection" if not matched else "target_match"
                            }
                            
                            # --- CRITICAL DEBUG SECTION ---
                            try:
                                # We try both with and without a trailing slash if it fails
                                url = f"{API_BASE}/detections"
                                logging.info(f"📡 Sending to {url}...")
                                r = requests.post(url, json=payload, timeout=5)
                                
                                if r.status_code == 200:
                                    logging.info(f"✅ DB SUCCESS: {plate_text} saved.")
                                else:
                                    logging.error(f"❌ DB FAILED: Status {r.status_code} | Body: {r.text}")
                            except Exception as e:
                                logging.error(f"❌ NETWORK ERROR: Cannot reach {API_BASE}. Error: {e}")

                    if os.path.exists(file_path):
                        os.remove(file_path)

                except Exception as e:
                    logging.error(f"Error processing {filename}: {e}")
                    if os.path.exists(file_path): os.remove(file_path)

            time.sleep(0.5) 
        except Exception as e:
            logging.error(f"Global Loop Error: {e}")
            time.sleep(2)

if __name__ == "__main__":
    process_loop()
