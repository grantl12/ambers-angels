"""
backend/scripts/sim_dashboard.py

Simulates a live Amber's Angels dashboard scenario for demo / media capture.
Run this ON THE SERVER via plink so it can reach the local DB and API.

Usage:
    python3 backend/scripts/sim_dashboard.py [--clean]

    --clean   Remove all sim data and exit (drone + telemetry + detections)

Scenario (Carrollton, GA):
    ANGEL-1   Drone 1 — heartbeat only, pilot standing by at home
    ANGEL-2   Drone 2 — DEPLOYED, active mission (executing), will generate drone hit
    ANGEL-3   Drone 3 — VLOS independent, flying on own initiative, NOT coordinator-dispatched
    HAWK      Ground volunteer car, driving east on Bankhead Hwy
    RANGER    Ground volunteer car, slow-moving near target zone
    --- T+20s ---
    ANGEL-2 detects a watchlist plate (drone hit)
    --- T+35s ---
    HAWK detects a watchlist plate (car / phone-camera hit)
    --- T+50s ---
    CAD dispatch future-capability display
"""

import argparse
import math
import os
import sys
import time
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras
import requests

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DB_URL    = os.getenv("DATABASE_URL",
    "postgresql://postgres:Ambers1Angels@127.0.0.1:5432/ambersangels")
API_BASE  = os.getenv("API_BASE", "http://127.0.0.1:8000")
INT_KEY   = os.getenv("INTERNAL_API_KEY", "")

# Carrollton, GA bounding box center
CENTER_LAT =  33.5799
CENTER_LNG = -85.0766

SIM_TAG = "sim_dashboard"   # used to tag / find / clean all sim rows


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def db_conn():
    return psycopg2.connect(DB_URL, cursor_factory=psycopg2.extras.RealDictCursor)


def offset(lat, lng, d_lat_m, d_lng_m):
    """Offset a lat/lng by meters."""
    return (
        lat  + d_lat_m  / 111_320,
        lng  + d_lng_m  / (111_320 * math.cos(math.radians(lat))),
    )


def bearing(a_lat, a_lng, b_lat, b_lng):
    """Compass bearing in degrees from A to B."""
    d = math.radians(b_lng - a_lng)
    lat1, lat2 = math.radians(a_lat), math.radians(b_lat)
    x = math.sin(d) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(d)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def interpolate_route(waypoints, n_frames):
    """
    Distribute n_frames evenly along a polyline of (lat, lng) waypoints.
    Returns list of (lat, lng, heading_deg) tuples.
    """
    def seg_len(a, b):
        dlat = (b[0] - a[0]) * 111_320
        dlng = (b[1] - a[1]) * 111_320 * math.cos(math.radians(a[0]))
        return math.sqrt(dlat**2 + dlng**2)

    segs = list(zip(waypoints, waypoints[1:]))
    lengths = [seg_len(a, b) for a, b in segs]
    total = sum(lengths)

    result = []
    for i in range(n_frames):
        t = i / max(n_frames - 1, 1) * total
        acc = 0.0
        for (a, b), l in zip(segs, lengths):
            if t <= acc + l or (a, b) == segs[-1]:
                seg_t = ((t - acc) / l) if l > 0 else 0.0
                seg_t = max(0.0, min(1.0, seg_t))
                lat = a[0] + seg_t * (b[0] - a[0])
                lng = a[1] + seg_t * (b[1] - a[1])
                hdg = bearing(a[0], a[1], b[0], b[1])
                result.append((lat, lng, hdg))
                break
            acc += l
    return result


def ts_now():
    return datetime.now(timezone.utc)


def hdr():
    h = {"Content-Type": "application/json"}
    if INT_KEY:
        h["X-Internal-Key"] = INT_KEY
    return h


def banner(msg):
    width = 72
    print("\n" + "─" * width)
    print(f"  {msg}")
    print("─" * width)


def step(msg, ok=True):
    icon = "✓" if ok else "✗"
    print(f"  {icon}  {msg}")


# ---------------------------------------------------------------------------
# Scenario positions
# ---------------------------------------------------------------------------

# ANGEL-1: home base, north-west of center (waiting for dispatch)
ANGEL1_HOME = offset(CENTER_LAT, CENTER_LNG,  300, -250)

# ANGEL-2: deployed, orbiting east side — will make a detection hit
ANGEL2_CENTER = offset(CENTER_LAT, CENTER_LNG,  100,  350)

# ANGEL-3: VLOS independent, flying south side
ANGEL3_START = offset(CENTER_LAT, CENTER_LNG, -200, -100)

# Volunteers — road-following waypoints (Carrollton, GA street grid)
# HAWK: east along Bankhead Hwy / Maple St corridor
HAWK_ROUTE = [
    (33.5790, -85.0870),  # west end, near Hwy 166 junction
    (33.5790, -85.0820),  # continuing east
    (33.5793, -85.0775),  # slight bend near downtown core
    (33.5793, -85.0730),  # past Newnan St
    (33.5790, -85.0685),  # east end of corridor
]

# RANGER: slower patrol on N/S and cross streets near target zone
RANGER_ROUTE = [
    (33.5760, -85.0775),  # south on Newnan St-ish
    (33.5800, -85.0775),  # north
    (33.5800, -85.0730),  # east on cross street
    (33.5760, -85.0730),  # south
    (33.5760, -85.0700),  # jog east
    (33.5800, -85.0700),  # north again
]


# ---------------------------------------------------------------------------
# Orbit path generator (circle for ANGEL-2)
# ---------------------------------------------------------------------------

def orbit_point(center_lat, center_lng, radius_m, step_idx, total_steps=30):
    angle = 2 * math.pi * step_idx / total_steps
    return offset(center_lat, center_lng,
                  radius_m * math.sin(angle),
                  radius_m * math.cos(angle))


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def clean(conn):
    banner("Cleaning previous sim data")
    with conn.cursor() as cur:
        # Telemetry points written by sim
        cur.execute(
            "DELETE FROM telemetry_points WHERE drone_id LIKE 'SIM-%' OR pilot_id LIKE 'sim-%'"
        )
        step(f"telemetry_points removed: {cur.rowcount}")

        # Detections from sim drones
        cur.execute(
            "DELETE FROM detection_events WHERE drone_id LIKE 'SIM-%'"
        )
        step(f"detection_events removed: {cur.rowcount}")

        # Missions created by sim
        cur.execute(
            "DELETE FROM autonomous_missions WHERE alert_id = 'SIM-ALERT-001'"
        )
        step(f"autonomous_missions removed: {cur.rowcount}")

        # Drones registered by sim
        cur.execute(
            "DELETE FROM autonomous_drones WHERE drone_model = %s", (SIM_TAG,)
        )
        step(f"autonomous_drones removed: {cur.rowcount}")

        # Watchlist entry created by sim
        cur.execute(
            "DELETE FROM watchlist WHERE source = 'demo' AND plate_text IN ('GHX4821', 'TYP6633')"
        )
        step(f"watchlist entries removed: {cur.rowcount}")

    conn.commit()
    step("Done.", ok=True)


def insert_telemetry(cur, drone_id, pilot_id, lat, lng, altitude_m,
                     heading_deg, speed_mps, source, volunteer_mode):
    cur.execute("""
        INSERT INTO telemetry_points
            (drone_id, pilot_id, ts, lat, lon, altitude_m,
             heading_deg, speed_mps, source, volunteer_mode)
        VALUES
            (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """, (
        drone_id, pilot_id, ts_now(), lat, lng,
        altitude_m, heading_deg, speed_mps, source, volunteer_mode,
    ))


def register_drone(conn, drone_id_str, pilot_username, home_lat, home_lng):
    """Insert into autonomous_drones; return the integer id."""
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO autonomous_drones
                (pilot_username, drone_model, serial_number,
                 home_lat, home_lng, last_seen_at, bvlos_authorized, vlos_radius_m)
            VALUES (%s, %s, %s, %s, %s, %s, FALSE, 400)
            RETURNING id
        """, (
            pilot_username, SIM_TAG, drone_id_str,
            home_lat, home_lng, ts_now(),
        ))
        row = cur.fetchone()
    conn.commit()
    return row["id"]


def create_sim_alert(conn):
    """Inject a minimal watchlist vehicle so the detection pipeline has something to match."""
    with conn.cursor() as cur:
        # Two plates — one for drone hit, one for car hit
        for plate, color, vtype in [
            ("GHX4821", "silver", "sedan"),
            ("TYP6633", "black",  "suv"),
        ]:
            cur.execute("""
                INSERT INTO watchlist (plate_text, description, alert_type, source,
                                       vehicle_color, vehicle_type, active)
                VALUES (%s, %s, 'amber', 'demo', %s, %s, TRUE)
                ON CONFLICT DO NOTHING
            """, (
                plate,
                f"SIM — {color} {vtype} — dashboard demo vehicle",
                color, vtype,
            ))
    conn.commit()


def create_mission(conn, drone_db_id):
    obs_lat, obs_lng = ANGEL2_CENTER
    waypoints = [{"lat": obs_lat, "lng": obs_lng, "altitude_m": 60.0}]
    import json
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO autonomous_missions
                (drone_id, alert_id, status, operation_mode,
                 altitude_m, speed_mps,
                 waypoints_json, started_at, created_at)
            VALUES (%s, %s, 'executing', 'vlos',
                    60.0, 8.0,
                    %s, NOW(), NOW())
            RETURNING id
        """, (
            drone_db_id, "SIM-ALERT-001",
            json.dumps(waypoints),
        ))
        row = cur.fetchone()
    conn.commit()
    return row["id"]


def post_detection(drone_id, lat, lng, plate, confidence, color, vtype, source_label):
    payload = {
        "drone_id":     drone_id,
        "plate_text":   plate,
        "confidence":   confidence,
        "latitude":     lat,
        "longitude":    lng,
        "vehicle_color": color,
        "vehicle_type":  vtype,
        "detected_at":  ts_now().isoformat(),
    }
    try:
        r = requests.post(f"{API_BASE}/detections/", json=payload, headers=hdr(), timeout=5)
        if r.ok:
            body = r.json()
            hit = body.get("watchlist_hit", False)
            return hit
        else:
            print(f"  [warn] POST /detections/ returned {r.status_code}: {r.text[:120]}")
            return False
    except Exception as exc:
        print(f"  [warn] detection POST failed: {exc}")
        return False


# ---------------------------------------------------------------------------
# Main simulation
# ---------------------------------------------------------------------------

def run(conn):
    banner("Amber's Angels — Dashboard Demo Simulation")
    print(f"  Location : Carrollton, GA  ({CENTER_LAT:.4f}, {CENTER_LNG:.4f})")
    print(f"  API      : {API_BASE}")
    print(f"  DB       : {DB_URL.split('@')[1] if '@' in DB_URL else DB_URL}")

    # -- Setup -----------------------------------------------------------------
    banner("Setting up scenario assets")

    create_sim_alert(conn)
    step("Watchlist: 2 sim vehicles seeded (GHX4821 silver sedan, TYP6633 black SUV)")

    drone1_id = register_drone(conn, "SIM-ANGEL-1", "sim-pilot-alpha", *ANGEL1_HOME)
    drone2_id = register_drone(conn, "SIM-ANGEL-2", "sim-pilot-bravo", *ANGEL2_CENTER)
    drone3_id = register_drone(conn, "SIM-ANGEL-3", "sim-pilot-charlie", *ANGEL3_START)

    step(f"ANGEL-1 registered (db id={drone1_id}) — standing by at home")
    step(f"ANGEL-2 registered (db id={drone2_id}) — will be dispatched")
    step(f"ANGEL-3 registered (db id={drone3_id}) — VLOS independent")

    mission_id = create_mission(conn, drone2_id)
    step(f"Mission {mission_id} created for ANGEL-2 → status: executing")

    # -- Animation loop --------------------------------------------------------
    banner("Starting animation loop  (Ctrl-C to stop early)")
    print("  Frame  | Asset      | Position                   | Note")
    print("  -------|------------|----------------------------|-----------------------------")

    FRAMES        = 40
    FRAME_DELAY   = 2.0   # seconds between frames
    HIT_DRONE_AT  = 10    # frame index for drone hit
    HIT_CAR_AT    = 17    # frame index for car hit
    CAD_SHOW_AT   = 25    # frame index for CAD display

    # Pre-compute road-following positions for volunteers
    hawk_route   = interpolate_route(HAWK_ROUTE,   FRAMES)
    ranger_route = interpolate_route(RANGER_ROUTE, FRAMES)

    drone_hit_fired = False
    car_hit_fired   = False
    cad_shown       = False

    try:
        for i in range(FRAMES):

            # Fresh connection per frame — released immediately after commit
            # so we never hold the pool hostage across the sleep interval.
            frame_conn = db_conn()
            try:
                with frame_conn.cursor() as cur:

                    # ANGEL-1: heartbeat — stays at home, updates last_seen
                    a1_lat, a1_lng = ANGEL1_HOME
                    cur.execute("""
                        UPDATE autonomous_drones
                           SET home_lat = %s, home_lng = %s, last_seen_at = NOW()
                         WHERE id = %s
                    """, (a1_lat, a1_lng, drone1_id))
                    print(f"  {i:5d}  | ANGEL-1    | {a1_lat:.5f}, {a1_lng:.6f}  | heartbeat ♡")

                    # ANGEL-2: orbit pattern at 60m, under coordinator control
                    a2_lat, a2_lng = orbit_point(*ANGEL2_CENTER, radius_m=120,
                                                 step_idx=i, total_steps=20)
                    heading = (i * 18) % 360
                    insert_telemetry(cur,
                        "SIM-ANGEL-2", "sim-pilot-bravo",
                        a2_lat, a2_lng, 60.0, heading, 8.0,
                        "dji_telemetry", "drone")
                    print(f"  {i:5d}  | ANGEL-2    | {a2_lat:.5f}, {a2_lng:.6f}  | deployed ✈ hdg={heading}°")

                    # ANGEL-3: straight glide path (VLOS, independent)
                    a3_lat, a3_lng = offset(*ANGEL3_START, i * 8, i * 5)
                    insert_telemetry(cur,
                        "SIM-ANGEL-3", "sim-pilot-charlie",
                        a3_lat, a3_lng, 45.0, 85, 6.0,
                        "dji_telemetry", "drone")
                    print(f"  {i:5d}  | ANGEL-3    | {a3_lat:.5f}, {a3_lng:.6f}  | VLOS / independent")

                    # HAWK: following road route east, phone camera scanning
                    hawk_lat, hawk_lng, hawk_hdg = hawk_route[i]
                    insert_telemetry(cur,
                        "SIM-HAWK", "HAWK",
                        hawk_lat, hawk_lng, 0.0, round(hawk_hdg), 13.0,
                        "phone_gps", "phone")
                    print(f"  {i:5d}  | 🚗 HAWK     | {hawk_lat:.5f}, {hawk_lng:.6f}  | ground / hdg={round(hawk_hdg)}°")

                    # RANGER: slow patrol on cross streets
                    ranger_lat, ranger_lng, ranger_hdg = ranger_route[i]
                    insert_telemetry(cur,
                        "SIM-RANGER", "RANGER",
                        ranger_lat, ranger_lng, 0.0, round(ranger_hdg), 5.0,
                        "phone_gps", "phone")
                    print(f"  {i:5d}  | 🚗 RANGER   | {ranger_lat:.5f}, {ranger_lng:.6f}  | ground / hdg={round(ranger_hdg)}°")

                frame_conn.commit()
            finally:
                frame_conn.close()

            # -- Hit events ----------------------------------------------------
            if i == HIT_DRONE_AT and not drone_hit_fired:
                print()
                banner("🔴  DETECTION HIT — DRONE SOURCE")
                print(f"  Asset    : ANGEL-2 (deployed, coordinator-dispatched)")
                print(f"  Plate    : GHX4821")
                print(f"  Vehicle  : Silver sedan")
                print(f"  Position : {a2_lat:.5f}, {a2_lng:.6f}")
                print(f"  Confidence : 94.2%")
                hit = post_detection(
                    "SIM-ANGEL-2", a2_lat, a2_lng,
                    "GHX4821", 94.2, "silver", "sedan", "drone",
                )
                print(f"  Watchlist match : {'YES ⚠' if hit else 'no (check INTERNAL_API_KEY)'}")
                drone_hit_fired = True
                print()

            if i == HIT_CAR_AT and not car_hit_fired:
                print()
                banner("🔴  DETECTION HIT — VOLUNTEER CAR SOURCE")
                print(f"  Asset    : HAWK (ground volunteer, phone camera)")
                print(f"  Plate    : TYP6633")
                print(f"  Vehicle  : Black SUV")
                print(f"  Position : {hawk_lat:.5f}, {hawk_lng:.6f}")
                print(f"  Confidence : 88.7%")
                hit = post_detection(
                    "SIM-HAWK", hawk_lat, hawk_lng,
                    "TYP6633", 88.7, "black", "suv", "phone",
                )
                print(f"  Watchlist match : {'YES ⚠' if hit else 'no (check INTERNAL_API_KEY)'}")
                car_hit_fired = True
                print()

            if i == CAD_SHOW_AT and not cad_shown:
                print()
                banner("📡  [FUTURE CAPABILITY] CAD DISPATCH INTEGRATION")
                print("""
  ┌─────────────────────────────────────────────────────────────────┐
  │  CAD DISPATCH EVENT                                             │
  │                                                                 │
  │  Alert     : AMBER Alert — GA-2026-0605-001                     │
  │  Detection : GHX4821 (94.2% confidence)                        │
  │  Asset     : ANGEL-2 drone @ 33.5812, -85.0731                 │
  │                                                                 │
  │  ┌── Dispatch Action ──────────────────────────────────────┐    │
  │  │  POST /dispatch/cad                                     │    │
  │  │  Target: Motorola PremierOne / Tyler New World          │    │
  │  │  CPD Endpoint: [requires IT key + MOU]                  │    │
  │  └──────────────────────────────────────────────────────── ┘    │
  │                                                                 │
  │  ✅  This event has been shared directly with                    │
  │      CARROLLTON POLICE DEPARTMENT CAD                          │
  │      Incident #: CPD-2026-0605-8841                            │
  │      Dispatched: {ts}         │
  │                                                                 │
  │  ⚠  This capability requires a signed MOU with CPD and        │
  │     Motorola PremierOne / Tyler New World API credentials.     │
  └─────────────────────────────────────────────────────────────────┘
""".format(ts=datetime.now().strftime("%Y-%m-%d %H:%M:%S UTC")))
                cad_shown = True

            time.sleep(FRAME_DELAY)

    except KeyboardInterrupt:
        print("\n  [stopped by user]")

    banner("Simulation complete")
    print("""
  Dashboard should now show:
    • ANGEL-1  violet dot — standing by at home (heartbeat grays out after 5 min without telemetry)
    • ANGEL-2  violet dot — orbiting, has executing mission in sidebar
    • ANGEL-3  violet dot — flying independently (no mission record)
    • HAWK     violet dot — ground node driving east  (volunteerMode=phone)
    • RANGER   violet dot — ground node, slow patrol  (volunteerMode=phone)
    • 2 detection events in feed — one drone-sourced, one car-sourced
    • CAD dispatch block displayed above (future cap)

  Run with --clean to remove all sim data when done.
""")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Amber's Angels dashboard simulation")
    parser.add_argument("--clean", action="store_true",
                        help="Remove all sim data and exit")
    args = parser.parse_args()

    conn = db_conn()
    try:
        if args.clean:
            clean(conn)
        else:
            clean(conn)   # always start fresh
            run(conn)
    finally:
        conn.close()
