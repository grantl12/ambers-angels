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
RTMP_STAT_URL   = os.getenv("RTMP_STAT_URL", "http://127.0.0.1/rtmp-stat")
RTMP_BASE_URL   = os.getenv("RTMP_BASE_URL", "rtmp://localhost/live")
POLL_INTERVAL   = int(os.getenv("RTMP_POLL_INTERVAL", "5"))
DISCORD_WEBHOOK = os.getenv("ALERT_WEBHOOK_URL", "")

_SKIP_NAMES = {"golden_frames", "anomalies", "recovery_bot"}

# ---------------------------------------------------------------------------
# PM2 crash watchdog — fires a Discord alert when a managed process is
# crash-looping. Checked every WATCHDOG_INTERVAL seconds. We track the
# restart count seen last check; a jump of ≥ RESTART_THRESHOLD in one
# interval is treated as a crash-loop.
# ---------------------------------------------------------------------------
WATCHDOG_INTERVAL  = 60   # seconds between PM2 checks
RESTART_THRESHOLD  = 5    # restart count jump that triggers an alert
DOWN_ALERT_DELAY   = 120  # seconds a process must be stopped/errored before alerting
_WATCHDOG_LAST_CHECK = 0.0
_WATCHDOG_PREV_COUNTS: dict[str, int]  = {}  # process name → last seen restart count
_WATCHDOG_ALERTED: dict[str, float]    = {}  # process name → last crash-loop alert time
_WATCHDOG_DOWN_SINCE: dict[str, float] = {}  # process name → first time seen stopped/errored
_WATCHDOG_DOWN_ALERTED: dict[str, float] = {}  # process name → last down alert time


def _discord_post(text: str) -> None:
    if not DISCORD_WEBHOOK:
        return
    import json, urllib.request as _ur
    try:
        data = json.dumps({"content": text}).encode()
        req = _ur.Request(DISCORD_WEBHOOK, data=data, headers={"Content-Type": "application/json"})
        with _ur.urlopen(req, timeout=5):
            pass
    except Exception as e:
        print(f"[RTMPMonitor] Discord post failed: {e}", flush=True)


def _check_pm2() -> None:
    """Parse `pm2 jlist` and alert Discord if any process is crash-looping."""
    try:
        result = subprocess.run(
            ["/home/ambers-angels/.local/bin/pm2", "jlist"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            return
        import json
        procs = json.loads(result.stdout)
    except Exception as e:
        print(f"[RTMPMonitor] pm2 jlist error: {e}", flush=True)
        return

    now = time.time()
    for p in procs:
        name    = p.get("name", "?")
        restarts = p.get("pm2_env", {}).get("restart_time", 0)
        prev    = _WATCHDOG_PREV_COUNTS.get(name, restarts)
        delta   = restarts - prev
        _WATCHDOG_PREV_COUNTS[name] = restarts

        if delta >= RESTART_THRESHOLD:
            last_alerted = _WATCHDOG_ALERTED.get(name, 0)
            if now - last_alerted > 1800:  # at most one alert per 30 min per process
                _discord_post(
                    f":rotating_light: **PM2 crash-loop detected** — `{name}` "
                    f"restarted {delta}x in the last {WATCHDOG_INTERVAL}s "
                    f"(total restarts: {restarts}). Check logs immediately."
                )
                _WATCHDOG_ALERTED[name] = now
                print(f"[RTMPMonitor] ⚠ crash-loop alert sent for '{name}' ({delta} restarts)", flush=True)

        status = p.get("pm2_env", {}).get("status", "online")
        if status in ("stopped", "errored", "stopping"):
            first_seen = _WATCHDOG_DOWN_SINCE.setdefault(name, now)
            if now - first_seen >= DOWN_ALERT_DELAY:
                last_alerted = _WATCHDOG_DOWN_ALERTED.get(name, 0)
                if now - last_alerted > 1800:
                    _discord_post(
                        f":red_circle: **PM2 process down** — `{name}` is `{status}` "
                        f"(down for {int(now - first_seen)}s). Site may be unreachable. "
                        f"Check logs immediately."
                    )
                    _WATCHDOG_DOWN_ALERTED[name] = now
                    print(f"[RTMPMonitor] ⚠ down alert sent for '{name}' (status={status})", flush=True)
        else:
            _WATCHDOG_DOWN_SINCE.pop(name, None)

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
    global _WATCHDOG_LAST_CHECK
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

        # PM2 crash watchdog — runs every WATCHDOG_INTERVAL seconds
        now = time.time()
        if now - _WATCHDOG_LAST_CHECK >= WATCHDOG_INTERVAL:
            _check_pm2()
            _WATCHDOG_LAST_CHECK = now

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
