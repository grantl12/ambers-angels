
import os
import sys
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

# Ensure we're in the right directory to load the .env
os.chdir(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(".env")
load_dotenv("../.env")

DATABASE_URL = os.getenv("DATABASE_URL", "").replace("+asyncpg", "")

if not DATABASE_URL:
    print("Error: DATABASE_URL not found in environment.")
    sys.exit(1)

print(f"Connecting to: {DATABASE_URL.split('@')[-1]}") # Log host only for safety

engine = create_engine(DATABASE_URL)

sql = """
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS apple_sub          TEXT UNIQUE;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS google_sub         TEXT UNIQUE;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS auth_provider      TEXT DEFAULT 'email';
ALTER TABLE pilots ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS alert_scope        VARCHAR(20) DEFAULT 'local';
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS alert_range_miles  INT DEFAULT 25;
UPDATE pilots SET alert_scope = 'nationwide' WHERE role IN ('admin', 'coordinator') AND (alert_scope IS NULL OR alert_scope = 'local');
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS active     BOOLEAN   DEFAULT TRUE;
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS ncmec_cases (
    guid          TEXT PRIMARY KEY,
    name          TEXT,
    age_now       INT,
    state         VARCHAR(2),
    city          TEXT,
    missing_since DATE,
    poster_url    TEXT,
    photo_url     TEXT,
    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at  TIMESTAMPTZ DEFAULT NOW(),
    resolved_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ncmec_cases_state_idx ON ncmec_cases (state);
CREATE INDEX IF NOT EXISTS ncmec_cases_resolved_idx ON ncmec_cases (resolved_at) WHERE resolved_at IS NULL;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS coordinator_requested_at     TIMESTAMPTZ;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS coordinator_request_reason   TEXT;
CREATE INDEX IF NOT EXISTS pilots_coordinator_req_idx ON pilots (coordinator_requested_at) WHERE coordinator_requested_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS autonomous_drones (
    id                  SERIAL PRIMARY KEY,
    pilot_username      TEXT NOT NULL,
    drone_model         TEXT NOT NULL DEFAULT 'DJI Mavic 3',
    serial_number       TEXT,
    home_lat            DOUBLE PRECISION,
    home_lng            DOUBLE PRECISION,
    max_flight_time_min INT DEFAULT 25,
    camera_hfov_deg     REAL DEFAULT 84.0,
    registered_at       TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at        TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS autonomous_missions (
    id                  SERIAL PRIMARY KEY,
    alert_id            TEXT,
    drone_id            INT REFERENCES autonomous_drones(id),
    status              TEXT DEFAULT 'pending',
    waypoints_json      JSONB NOT NULL,
    altitude_m          REAL DEFAULT 60.0,
    speed_mps           REAL DEFAULT 8.0,
    coverage_area_sqkm  REAL,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    dispatched_at       TIMESTAMPTZ,
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    progress_pct        INT DEFAULT 0,
    error_msg           TEXT
);
CREATE INDEX IF NOT EXISTS autonomous_missions_drone_status_idx
    ON autonomous_missions (drone_id, status);
CREATE TABLE IF NOT EXISTS alert_resolutions (
    id                  SERIAL PRIMARY KEY,
    resolved_by         TEXT NOT NULL,
    role                TEXT NOT NULL,
    fema_identifier     TEXT,
    ncmec_guid          TEXT,
    reason              TEXT NOT NULL,
    plates_deactivated  TEXT[],
    resolved_at         TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS can_dispatch_drones BOOLEAN DEFAULT FALSE;
ALTER TABLE autonomous_missions ADD COLUMN IF NOT EXISTS operation_mode TEXT DEFAULT 'vlos';
ALTER TABLE autonomous_drones   ADD COLUMN IF NOT EXISTS bvlos_authorized BOOLEAN DEFAULT FALSE;
ALTER TABLE autonomous_drones   ADD COLUMN IF NOT EXISTS vlos_radius_m    INT     DEFAULT 400;
CREATE INDEX IF NOT EXISTS autonomous_missions_mode_idx ON autonomous_missions (operation_mode);
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS expo_push_token TEXT;
CREATE TABLE IF NOT EXISTS processed_alerts (
    identifier  TEXT PRIMARY KEY,
    processed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS processed_alerts_time_idx ON processed_alerts (processed_at);
CREATE TABLE IF NOT EXISTS road_segments (
    id              BIGSERIAL PRIMARY KEY,
    osm_way_id      BIGINT NOT NULL,
    osm_segment_idx INT    NOT NULL DEFAULT 0,
    name            TEXT,
    highway_type    TEXT,
    geometry_json   JSONB  NOT NULL,
    centroid_lat    DOUBLE PRECISION NOT NULL,
    centroid_lng    DOUBLE PRECISION NOT NULL,
    length_m        DOUBLE PRECISION,
    bbox_south      DOUBLE PRECISION,
    bbox_north      DOUBLE PRECISION,
    bbox_west       DOUBLE PRECISION,
    bbox_east       DOUBLE PRECISION,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (osm_way_id, osm_segment_idx)
);
CREATE INDEX IF NOT EXISTS road_segments_centroid_idx ON road_segments (centroid_lat, centroid_lng);
"""

try:
    with engine.connect() as conn:
        print("Running migration...")
        # Split by semicolon to run each statement if needed, or run as one block
        # SQLAlchemy's text() works best for raw SQL blocks in some dialects
        conn.execute(text(sql))
        conn.commit()
        print("Migration successful!")
except Exception as e:
    print(f"Migration failed: {e}")
    sys.exit(1)
