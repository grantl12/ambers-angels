"""
worker/rtmp_monitor.py

Polls nginx RTMP stat every 5 seconds. For each active stream, ensures an
ffmpeg process is extracting frames into test_plates/<stream_name>/.
Kills ffmpeg when a stream disappears.

Replaces exec_push in nginx.conf — more reliable across reconnects, nginx
reloads, and startup races. This process is also the natural home for future
AI-agent stream intelligence (anomaly detection, adaptive frame rate, etc.).
"""
import os
import subprocess
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

FRAMES_ROOT = os.getenv(
    "FRAMES_ROOT",
    "/home/ambers-angels/proj_dir/ambers-angels/backend/test_plates",
)
RTMP_STAT_URL = os.getenv("RTMP_STAT_URL", "http://127.0.0.1/rtmp-stat")
RTMP_BASE_URL = os.getenv("RTMP_BASE_URL", "rtmp://localhost/live")
POLL_INTERVAL = int(os.getenv("RTMP_POLL_INTERVAL", "5"))

_SKIP_NAMES = {"golden_frames", "anomalies", "recovery_bot"}

# stream_name -> running Popen for ffmpeg
_ffmpeg_procs: dict[str, subprocess.Popen] = {}


def get_active_streams() -> list[str]:
    try:
        with urllib.request.urlopen(RTMP_STAT_URL, timeout=3) as r:
            data = r.read()
        root = ET.fromstring(data)
        names = []
        for stream in root.iter("stream"):
            name_el = stream.find("name")
            if name_el is not None and name_el.text and name_el.text not in _SKIP_NAMES:
                names.append(name_el.text)
        return names
    except Exception as e:
        print(f"[RTMPMonitor] stat error: {e}", flush=True)
        return []


def _start_ffmpeg(name: str) -> None:
    frames_dir = os.path.join(FRAMES_ROOT, name)
    os.makedirs(frames_dir, exist_ok=True)
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-i", f"{RTMP_BASE_URL}/{name}",
        "-vf", "fps=3", "-q:v", "2", "-f", "image2",
        os.path.join(frames_dir, "frame_%06d.jpg"),
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    _ffmpeg_procs[name] = proc
    print(f"[RTMPMonitor] ▶ ffmpeg started for '{name}' (pid {proc.pid})", flush=True)


def _stop_ffmpeg(name: str) -> None:
    proc = _ffmpeg_procs.pop(name, None)
    if not proc:
        return
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
    print(f"[RTMPMonitor] ■ ffmpeg stopped for '{name}'", flush=True)


def main() -> None:
    print(f"[RTMPMonitor] Polling {RTMP_STAT_URL} every {POLL_INTERVAL}s", flush=True)
    while True:
        active = set(get_active_streams())

        # Start ffmpeg for new or restarted streams
        for name in active:
            proc = _ffmpeg_procs.get(name)
            if proc is None or proc.poll() is not None:
                if proc is not None:
                    print(f"[RTMPMonitor] ffmpeg for '{name}' exited (rc={proc.poll()}), restarting", flush=True)
                _start_ffmpeg(name)

        # Stop ffmpeg for streams that ended
        for name in list(_ffmpeg_procs):
            if name not in active:
                _stop_ffmpeg(name)

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
