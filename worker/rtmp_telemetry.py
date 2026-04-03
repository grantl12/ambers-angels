#!/usr/bin/env python3
"""
worker/rtmp_telemetry.py

Extracts DJI flight telemetry embedded in an RTMP stream and posts each point
to POST /telemetry so the drone appears live on the mission map.

Launched automatically by nginx exec_push alongside the ffmpeg frame extractor.
Runs for the lifetime of the RTMP stream; exits cleanly when it ends.

Usage:
    python3 rtmp_telemetry.py <stream_name> [api_base] [drone_id]

Extraction strategies (tried in order):
  1. Subtitle/data track  — ffmpeg -map 0:s:0 -f srt
     DJI Fly, some Avata firmware, and FPV goggles output SRT-format telemetry
     as a subtitle stream alongside the video.
  2. AMF onMetaData poll  — ffprobe -show_format -show_streams
     Some DJI drones / encoders embed lat/lon/altitude/speed as RTMP metadata
     tags visible via ffprobe.  Polled at 1 Hz.
  3. Probe-only mode       — falls through if neither yields data.
     Logs a diagnostic message so you know what the stream contains.
     No data is posted; phone GPS already covers this case.
"""

import json
import os
import re
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone

import requests

# ---------------------------------------------------------------------------
# DJI SRT telemetry text patterns (multiple firmware variants)
# ---------------------------------------------------------------------------

# Avata 1 / Mini / Air / Mavic with DJI Fly — square-bracket format
_SRT_BRACKET = re.compile(
    r'\[latitude:\s*([+-]?\d+\.\d+)\].*?\[longitude:\s*([+-]?\d+\.\d+)\]'
    r'.*?\[altitude:\s*([+-]?\d+\.?\d*)\]'
    r'(?:.*?\[(?:speed|h_speed):\s*([+-]?\d+\.?\d*)\])?'
    r'(?:.*?\[heading:\s*([+-]?\d+\.?\d*)\])?',
    re.IGNORECASE | re.DOTALL,
)

# Newer DJI firmware — HOME(lat,lon) SPEED:Xm/s ALT:Ym
_SRT_HOME = re.compile(
    r'HOME\(([+-]?\d+\.\d+),([+-]?\d+\.\d+)\).*?'
    r'ALT:\s*([+-]?\d+\.?\d*)m'
    r'(?:.*?SPEED:\s*([+-]?\d+\.?\d*)m/s)?'
    r'(?:.*?HEADING:\s*([+-]?\d+\.?\d*))?',
    re.IGNORECASE | re.DOTALL,
)

# Generic key:value fallback
_SRT_KV = re.compile(
    r'(?:latitude|lat)[:\s=]+([+-]?\d+\.\d+).*?'
    r'(?:longitude|lng|lon)[:\s=]+([+-]?\d+\.\d+)'
    r'(?:.*?(?:altitude|alt)[:\s=]+([+-]?\d+\.?\d*))?',
    re.IGNORECASE | re.DOTALL,
)


def _parse_srt_block(text: str) -> dict | None:
    for pattern in (_SRT_BRACKET, _SRT_HOME, _SRT_KV):
        m = pattern.search(text)
        if not m:
            continue
        g = m.groups()
        try:
            return {
                'lat':      float(g[0]),
                'lng':      float(g[1]),
                'altitude': float(g[2]) if len(g) > 2 and g[2] else None,
                'speed':    float(g[3]) if len(g) > 3 and g[3] else None,
                'heading':  float(g[4]) if len(g) > 4 and g[4] else None,
            }
        except (ValueError, TypeError):
            continue
    return None


# ---------------------------------------------------------------------------
# Strategy 1 — subtitle/data track via ffmpeg
# ---------------------------------------------------------------------------

def _read_subtitle_stream(rtmp_url: str, callback) -> bool:
    """
    Attempt to extract an SRT subtitle track from the stream.
    Calls callback(point_dict) for each successfully parsed block.
    Returns True if at least one valid point was found.
    """
    proc = subprocess.Popen(
        ['ffmpeg', '-hide_banner', '-loglevel', 'warning',
         '-i', rtmp_url,
         '-map', '0:s:0',
         '-f', 'srt', '-'],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )

    found_any = False
    buf = ''
    try:
        for line in proc.stdout:
            buf += line
            # SRT blocks are delimited by a blank line
            if '\n\n' in buf or buf.count('\n') >= 5:
                point = _parse_srt_block(buf)
                if point:
                    found_any = True
                    callback(point)
                buf = ''
    except Exception:
        pass
    finally:
        try:
            proc.terminate()
        except Exception:
            pass

    return found_any


# ---------------------------------------------------------------------------
# Strategy 2 — AMF onMetaData poll via ffprobe
# ---------------------------------------------------------------------------

_AMF_FIELD_MAP = {
    'lat':       ('lat', float),
    'latitude':  ('lat', float),
    'lon':       ('lng', float),
    'lng':       ('lng', float),
    'longitude': ('lng', float),
    'altitude':  ('altitude', float),
    'alt':       ('altitude', float),
    'height':    ('altitude', float),
    'speed':     ('speed', float),
    'h_speed':   ('speed', float),
    'yaw':       ('heading', float),
    'heading':   ('heading', float),
    'compass':   ('heading', float),
}


def _probe_amf_metadata(rtmp_url: str) -> dict | None:
    try:
        result = subprocess.run(
            ['ffprobe', '-v', 'quiet',
             '-print_format', 'json',
             '-show_format', '-show_streams',
             rtmp_url],
            capture_output=True, text=True, timeout=8,
        )
    except subprocess.TimeoutExpired:
        return None

    if result.returncode != 0:
        return None

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None

    # Collect all tags from format + all streams
    tags: dict[str, str] = {}
    tags.update(data.get('format', {}).get('tags', {}))
    for s in data.get('streams', []):
        tags.update(s.get('tags', {}))

    if not tags:
        return None

    point: dict = {}
    for raw_key, raw_val in tags.items():
        mapped = _AMF_FIELD_MAP.get(raw_key.lower())
        if mapped:
            dest_key, caster = mapped
            try:
                point[dest_key] = caster(raw_val)
            except (ValueError, TypeError):
                pass

    if 'lat' not in point or 'lng' not in point:
        return None

    return point


# ---------------------------------------------------------------------------
# API posting
# ---------------------------------------------------------------------------

def _post(api_base: str, drone_id: str, point: dict) -> None:
    payload = {
        'drone_id': drone_id,
        'lat':      point['lat'],
        'lng':      point['lng'],
        'altitude': point.get('altitude'),
        'heading':  point.get('heading'),
        'speed':    point.get('speed'),
        'source':   'rtmp_telemetry',
        'ts':       datetime.now(timezone.utc).isoformat(),
    }
    try:
        requests.post(f'{api_base}/telemetry', json=payload, timeout=3)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    stream_name = sys.argv[1] if len(sys.argv) > 1 else 'avata'
    api_base    = sys.argv[2] if len(sys.argv) > 2 else os.getenv('API_BASE', 'http://127.0.0.1:8000')
    drone_id    = sys.argv[3] if len(sys.argv) > 3 else stream_name
    rtmp_url    = f'rtmp://localhost/live/{stream_name}'

    print(f'[rtmp_telemetry:{stream_name}] started  drone_id={drone_id}  api={api_base}')

    # ── Strategy 1: subtitle track (blocking, runs in thread) ──────────────
    subtitle_hit = threading.Event()

    def _on_subtitle(point: dict) -> None:
        if not subtitle_hit.is_set():
            print(f'[rtmp_telemetry:{stream_name}] subtitle/data track detected — using it')
        subtitle_hit.set()
        _post(api_base, drone_id, point)

    sub_thread = threading.Thread(
        target=_read_subtitle_stream,
        args=(rtmp_url, _on_subtitle),
        daemon=True,
    )
    sub_thread.start()

    # Give the subtitle reader a few seconds to prove itself
    subtitle_hit.wait(timeout=5)

    if subtitle_hit.is_set():
        sub_thread.join()   # stream ended naturally
        print(f'[rtmp_telemetry:{stream_name}] subtitle stream ended — exiting')
        return

    print(f'[rtmp_telemetry:{stream_name}] no subtitle track — falling back to AMF metadata poll')

    # ── Strategy 2: AMF metadata poll ──────────────────────────────────────
    quiet_streak = 0
    while True:
        point = _probe_amf_metadata(rtmp_url)
        if point:
            quiet_streak = 0
            _post(api_base, drone_id, point)
            print(
                f'[rtmp_telemetry:{stream_name}] AMF '
                f'lat={point["lat"]:.6f} lng={point["lng"]:.6f} '
                f'alt={point.get("altitude")}m spd={point.get("speed")}m/s'
            )
        else:
            quiet_streak += 1
            if quiet_streak == 1:
                print(
                    f'[rtmp_telemetry:{stream_name}] stream has no embedded telemetry — '
                    f'run `ffprobe -show_format -show_streams {rtmp_url}` to inspect. '
                    f'Phone GPS will cover position tracking in the meantime.'
                )
            if quiet_streak > 60:
                print(f'[rtmp_telemetry:{stream_name}] giving up after 60 empty probes — exiting')
                break

        time.sleep(1)


if __name__ == '__main__':
    main()
