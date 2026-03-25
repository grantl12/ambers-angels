import os
import sys
import re
from datetime import datetime, timezone

import requests


API_BASE = os.getenv("API_BASE", "http://127.0.0.1:8000")
DRONE_ID = os.getenv("DRONE_ID", "drone1")


def parse_frame_ts_from_filename(frame_path: str) -> datetime:
    """
    Preferred:
      frame_1742780405123.jpg  -> epoch ms in filename

    Fallback:
      use file modification time if no epoch-ms exists
    """
    name = os.path.basename(frame_path)
    stem = os.path.splitext(name)[0]

    matches = re.findall(r"(\d{13})", stem)
    if matches:
        epoch_ms = int(matches[-1])
        return datetime.fromtimestamp(epoch_ms / 1000.0, tz=timezone.utc)

    mtime = os.path.getmtime(frame_path)
    return datetime.fromtimestamp(mtime, tz=timezone.utc)


def register_frame(frame_path: str):
    frame_ts = parse_frame_ts_from_filename(frame_path)

    payload = {
        "drone_id": DRONE_ID,
        "frame_path": frame_path,
        "frame_ts": frame_ts.isoformat(),
    }

    resp = requests.post(f"{API_BASE}/frames", json=payload, timeout=10)
    resp.raise_for_status()
    return resp.json()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python register_frame.py /path/to/frame_1742780405123.jpg")
        sys.exit(1)

    result = register_frame(sys.argv[1])
    print(result)
