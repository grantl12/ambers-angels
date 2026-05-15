"""
scripts/seed_demo.py
Run on the server via plink to seed / clean up screenshot demo data.

Usage:
  python3 /tmp/seed_demo.py seed
  python3 /tmp/seed_demo.py cleanup
"""

import sys
import psycopg2

CONN = "host=127.0.0.1 dbname=ambersangels user=postgres password=Ambers1Angels"

PLATE = "GDL2847"


def seed(cur):
    # Telemetry — 3 drones flying around Carrollton
    tracks = [
        ("AA-DEMO-1", 33.5810, -85.0700, 75, 90,  8.5, 30),
        ("AA-DEMO-1", 33.5812, -85.0680, 75, 90,  8.5, 20),
        ("AA-DEMO-1", 33.5815, -85.0660, 75, 92,  8.5, 10),
        ("AA-DEMO-1", 33.5818, -85.0642, 75, 92,  8.5,  0),
        ("AA-DEMO-2", 33.5750, -85.0810, 60, 180, 6.0, 25),
        ("AA-DEMO-2", 33.5730, -85.0805, 60, 185, 6.0, 15),
        ("AA-DEMO-2", 33.5712, -85.0800, 60, 188, 6.0,  5),
        ("AA-DEMO-3", 33.5875, -85.0840, 80, 270, 9.0, 20),
        ("AA-DEMO-3", 33.5872, -85.0860, 80, 268, 9.0, 10),
        ("AA-DEMO-3", 33.5869, -85.0880, 80, 265, 9.0,  0),
    ]
    for drone_id, lat, lon, alt, hdg, spd, secs_ago in tracks:
        cur.execute("""
            INSERT INTO telemetry_points
                (drone_id, lat, lon, altitude_m, heading_deg, speed_mps, ts)
            VALUES (%s, %s, %s, %s, %s, %s, NOW() - INTERVAL '%s seconds')
        """, (drone_id, lat, lon, alt, hdg, spd, secs_ago))

    # Swarm drones — two at home positions, one online
    cur.execute("""
        INSERT INTO autonomous_drones
            (pilot_username, drone_model, serial_number,
             home_lat, home_lng, last_seen_at, bvlos_authorized, vlos_radius_m)
        VALUES
            ('demo-pilot-1', 'DJI Mini 4 Pro', 'DEMO-SN-001',
             33.5828, -85.0912, NOW() - INTERVAL '90 seconds', false, 400),
            ('demo-pilot-2', 'DJI Mavic 3 Enterprise', 'DEMO-SN-002',
             33.5695, -85.0630, NOW() - INTERVAL '2 minutes', true, 800)
        ON CONFLICT DO NOTHING
    """)

    # NCMEC cases — active
    cur.execute("""
        INSERT INTO ncmec_cases
            (guid, name, age_now, state, city, missing_since,
             poster_url, photo_url, first_seen_at, last_seen_at)
        VALUES
            ('demo-ncmec-001', 'Emma Johnson', 8, 'GA', 'Carrollton',
             '2026-05-10', 'https://www.missingkids.org/poster/NCMC/demo001', '',
             NOW(), NOW()),
            ('demo-ncmec-002', 'Marcus Williams', 14, 'GA', 'Atlanta',
             '2026-05-08', 'https://www.missingkids.org/poster/NCMC/demo002', '',
             NOW() - INTERVAL '1 hour', NOW())
        ON CONFLICT (guid) DO NOTHING
    """)
    # NCMEC case — resolved (separate insert so resolved_at column is included)
    cur.execute("""
        INSERT INTO ncmec_cases
            (guid, name, age_now, state, city, missing_since,
             poster_url, photo_url, first_seen_at, last_seen_at, resolved_at)
        VALUES
            ('demo-ncmec-003', 'Sofia Rodriguez', 11, 'AL', 'Anniston',
             '2026-04-20', 'https://www.missingkids.org/poster/NCMC/demo003', '',
             NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day',
             NOW() - INTERVAL '1 day')
        ON CONFLICT (guid) DO NOTHING
    """)

    print("seed ok")


def cleanup(cur):
    cur.execute("DELETE FROM watchlist WHERE plate_text = %s AND source_program = 'manual'", (PLATE,))
    cur.execute("""
        DELETE FROM vehicle_targets
        WHERE source_program = 'manual'
          AND area ILIKE %s
          AND expires_at > NOW()
          AND expires_at < NOW() + INTERVAL '3 hours'
    """, ('%Carrollton%',))
    cur.execute("DELETE FROM detection_events WHERE drone_id LIKE 'AA-DEMO-%'")
    cur.execute("DELETE FROM telemetry_points WHERE drone_id LIKE 'AA-DEMO-%'")
    cur.execute("DELETE FROM autonomous_drones WHERE serial_number LIKE 'DEMO-SN-%'")
    cur.execute("DELETE FROM ncmec_cases WHERE guid LIKE 'demo-ncmec-%'")
    print("cleanup ok")


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "seed"
    conn = psycopg2.connect(CONN)
    cur = conn.cursor()
    try:
        if action == "seed":
            seed(cur)
        elif action == "cleanup":
            cleanup(cur)
        else:
            print(f"unknown action: {action}", file=sys.stderr)
            sys.exit(1)
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
