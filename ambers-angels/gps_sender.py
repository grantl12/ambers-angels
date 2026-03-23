import time
import math
import random
from datetime import datetime, timezone

import requests


# ===== CONFIG =====
API_URL = "http://127.0.0.1:8000/telemetry"
DRONE_ID = "drone1"
PILOT_ID = "pilot_test"

# Base location (example: Austin, TX)
BASE_LAT = 30.2672
BASE_LON = -97.7431

SEND_INTERVAL_SECONDS = 1.0
ENABLE_JITTER = True

# Approx movement size
LAT_JITTER = 0.00005
LON_JITTER = 0.00005
# ==================


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def build_payload(step: int):
    lat = BASE_LAT
    lon = BASE_LON

    if ENABLE_JITTER:
        lat += math.sin(step / 5.0) * LAT_JITTER + random.uniform(-0.00001, 0.00001)
        lon += math.cos(step / 5.0) * LON_JITTER + random.uniform(-0.00001, 0.00001)

    return {
        "drone_id": DRONE_ID,
        "pilot_id": PILOT_ID,
        "timestamp": utc_now_iso(),
        "lat": lat,
        "lon": lon,
        "altitude_m": 25.0,
        "speed_mps": 4.0,
        "heading_deg": (step * 12) % 360,
        "accuracy_m": 5.0,
        "source": "python_sender"
    }


def main():
    print(f"Sending telemetry to {API_URL}")
    print(f"Drone ID: {DRONE_ID}")
    print("Press Ctrl+C to stop.\n")

    step = 0

    while True:
        payload = build_payload(step)

        try:
            resp = requests.post(API_URL, json=payload, timeout=5)
            print(f"[{payload['timestamp']}] {resp.status_code} {resp.text}")
        except Exception as e:
            print(f"[{payload['timestamp']}] ERROR: {e}")

        step += 1
        time.sleep(SEND_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
