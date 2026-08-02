
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
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS sms_number        TEXT;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS sms_alerts_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS watch_areas        JSONB DEFAULT '[]';
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS notification_prefs JSONB DEFAULT '{}';
ALTER TABLE autonomous_drones ADD COLUMN IF NOT EXISTS serial_number TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS autonomous_drones_serial_idx ON autonomous_drones (serial_number) WHERE serial_number IS NOT NULL;
ALTER TABLE telemetry_points ADD COLUMN IF NOT EXISTS volunteer_mode VARCHAR(10);
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS tos_version TEXT;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS tos_accepted_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS alert_areas (
    id           SERIAL PRIMARY KEY,
    area_text    TEXT NOT NULL UNIQUE,
    seen_count   INT NOT NULL DEFAULT 1,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS alert_areas_text_idx ON alert_areas USING gin (to_tsvector('english', area_text));
ALTER TABLE autonomous_missions ADD COLUMN IF NOT EXISTS obs_acknowledged_at TIMESTAMPTZ;
ALTER TABLE autonomous_missions ADD COLUMN IF NOT EXISTS bvlos_certificate TEXT;
CREATE TABLE IF NOT EXISTS audit_log (
    id          BIGSERIAL PRIMARY KEY,
    username    TEXT NOT NULL,
    action      TEXT NOT NULL,
    details     JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_username_idx ON audit_log (username);

-- Source column: tracks data provenance for differential retention
ALTER TABLE detection_events  ADD COLUMN IF NOT EXISTS source VARCHAR(32) DEFAULT 'worker';
ALTER TABLE watchlist         ADD COLUMN IF NOT EXISTS source VARCHAR(32) DEFAULT 'fema';
ALTER TABLE vehicle_targets   ADD COLUMN IF NOT EXISTS source VARCHAR(32) DEFAULT 'fema';

-- vehicle_targets columns added after initial deploy (nullable so existing rows are not broken)
ALTER TABLE vehicle_targets ADD COLUMN IF NOT EXISTS fema_identifier TEXT;
ALTER TABLE vehicle_targets ADD COLUMN IF NOT EXISTS headline        TEXT;
ALTER TABLE vehicle_targets ADD COLUMN IF NOT EXISTS area            TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_targets_fema_identifier_idx
    ON vehicle_targets (fema_identifier) WHERE fema_identifier IS NOT NULL;

-- Back-fill existing manual/demo rows by heuristic
UPDATE watchlist       SET source = 'manual' WHERE source_program IN ('manual','demo') AND source = 'fema';
UPDATE vehicle_targets SET source = 'manual' WHERE source_program IN ('manual','demo') AND source = 'fema';

-- NCMEC vehicle extraction fields
ALTER TABLE ncmec_cases ADD COLUMN IF NOT EXISTS vehicle_description TEXT;
ALTER TABLE ncmec_cases ADD COLUMN IF NOT EXISTS vehicle_plate       VARCHAR(32);

-- Vehicle alert priors: Bayesian prior weights by alert type + vehicle attribute
-- prior_weight = incident_pct / population_pct
-- > 1.0 = over-represented in this alert type vs national fleet
-- < 1.0 = under-represented
CREATE TABLE IF NOT EXISTS vehicle_alert_priors (
    id              SERIAL PRIMARY KEY,
    alert_type      VARCHAR(20)  NOT NULL DEFAULT 'all',
    attribute_type  VARCHAR(20)  NOT NULL,  -- 'body_type' | 'color' | 'make'
    attribute_value VARCHAR(50)  NOT NULL,
    incident_pct    FLOAT        NOT NULL,  -- % of this alert type with this attribute
    population_pct  FLOAT        NOT NULL,  -- % of national fleet with this attribute
    prior_weight    FLOAT        NOT NULL,  -- incident_pct / population_pct
    source          VARCHAR(40)  NOT NULL DEFAULT 'public_data',
    updated_at      TIMESTAMPTZ  DEFAULT NOW(),
    UNIQUE (alert_type, attribute_type, attribute_value)
);
CREATE INDEX IF NOT EXISTS vehicle_alert_priors_lookup_idx
    ON vehicle_alert_priors (alert_type, attribute_type, attribute_value);

-- NamUs missing persons cases with vehicle data
CREATE TABLE IF NOT EXISTS namus_cases (
    namus_id      TEXT         PRIMARY KEY,
    subject_name  TEXT,
    age_now       INT,
    state         VARCHAR(2),
    county        TEXT,
    city          TEXT,
    missing_since DATE,
    actionable    BOOLEAN      DEFAULT FALSE,
    alert_type    VARCHAR(20),
    vehicle_info  TEXT,
    first_seen_at TIMESTAMPTZ  DEFAULT NOW(),
    last_seen_at  TIMESTAMPTZ  DEFAULT NOW(),
    resolved_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS namus_cases_state_idx      ON namus_cases (state);
CREATE INDEX IF NOT EXISTS namus_cases_actionable_idx ON namus_cases (actionable) WHERE actionable = TRUE;

-- BOLO crawler configurable sources
CREATE TABLE IF NOT EXISTS bolo_sources (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    url             TEXT NOT NULL UNIQUE,
    source_type     VARCHAR(10) NOT NULL DEFAULT 'rss',  -- 'rss' | 'html'
    state           VARCHAR(2),                           -- NULL = national
    css_selector    TEXT,                                 -- for source_type='html' only
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    last_crawled_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bolo_sources_active_idx ON bolo_sources (active) WHERE active = TRUE;

-- Seed national RSS sources (idempotent)
INSERT INTO bolo_sources (name, url, source_type, state) VALUES
    ('FBI Wanted - Kidnappings',      'https://www.fbi.gov/wanted/kidnap/@/rss.xml',                              'rss', NULL),
    ('FBI Wanted - Missing Persons',  'https://www.fbi.gov/wanted/vicap/missing-persons/@/rss.xml',               'rss', NULL),
    ('FBI Wanted - Violent Crimes',   'https://www.fbi.gov/wanted/crimes-against-children/@/rss.xml',             'rss', NULL),
    ('NCMEC News Releases',           'https://www.missingkids.org/newsroom/pressreleases/rss',                   'rss', NULL),
    ('GA GBI Press Releases',         'https://gbi.georgia.gov/press-releases/rss.xml',                          'rss', 'GA'),
    ('TBI Missing Persons',           'https://www.tn.gov/tbi/news-releases.html',                               'html', 'TN'),
    ('FL FDLE Alerts',                'https://www.fdle.state.fl.us/AMBER-Alert/AMBER-Alert-History',             'html', 'FL'),
    ('ALEA News Releases',            'https://www.alea.gov/news',                                               'html', 'AL'),
    ('AL SBI Missing Persons',        'https://www.alea.gov/sbi/missing-persons',                                'html', 'AL'),
    ('AL AG Press Releases',          'https://www.alabamaag.gov/news',                                          'html', 'AL')
ON CONFLICT (url) DO NOTHING;

-- Water search: mission_type column (defaults preserve existing missions)
ALTER TABLE autonomous_missions ADD COLUMN IF NOT EXISTS mission_type TEXT DEFAULT 'observation';
ALTER TABLE autonomous_missions ADD COLUMN IF NOT EXISTS water_body_id TEXT;
ALTER TABLE autonomous_missions ADD COLUMN IF NOT EXISTS water_body_name TEXT;

-- Coordinator BOLO creation permission (like can_dispatch_drones)
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS can_create_bolo BOOLEAN DEFAULT FALSE;

-- Water bodies cache (populated on-demand from Overpass API)
CREATE TABLE IF NOT EXISTS water_bodies (
    id              TEXT PRIMARY KEY,
    name            TEXT,
    water_type      TEXT,
    centroid_lat    DOUBLE PRECISION NOT NULL,
    centroid_lng    DOUBLE PRECISION NOT NULL,
    area_sqm        DOUBLE PRECISION,
    polygon_json    JSONB NOT NULL,
    fetched_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS water_bodies_centroid_idx
    ON water_bodies (centroid_lat, centroid_lng);

-- Alert ingestion log: permanent record of every alert we ingested and how we handled it.
-- Unlike processed_alerts (dedup only), this preserves the full pipeline trace forever.
-- Source 'fema' = FEMA CMAS/EAS CAP feed; 'nws' = NWS alerts API; 'bolo' = manual/social BOLO;
--        'ncmec' = NCMEC RSS; 'namus' = NamUs; 'email_bolo' = email webhook.
CREATE TABLE IF NOT EXISTS alert_ingestion_log (
    id              BIGSERIAL PRIMARY KEY,
    identifier      TEXT NOT NULL,
    source          VARCHAR(20) NOT NULL,           -- 'fema' | 'nws' | 'bolo' | 'ncmec' | 'namus' | 'email_bolo'
    alert_type      VARCHAR(20),                    -- 'amber' | 'silver' | 'purple' | 'blue' | etc.
    headline        TEXT,
    area            TEXT,
    plates          TEXT[],                         -- plates extracted from CAP text
    vehicle_profile JSONB DEFAULT '{}',             -- color, body_type, make, model, year
    source_program  TEXT,                           -- e.g. 'Tennessee Bureau of Investigation'
    raw_cap_text    TEXT,                           -- first 4000 chars of CAP description/headline
    pilots_notified INT DEFAULT 0,                  -- number of Expo push tokens messaged
    discord_fired   BOOLEAN DEFAULT FALSE,
    ingested_at     TIMESTAMPTZ DEFAULT NOW(),
    ingested_by     TEXT                            -- username if manual BOLO, NULL if automated
);
CREATE INDEX IF NOT EXISTS alert_ingestion_log_ingested_idx ON alert_ingestion_log (ingested_at DESC);
CREATE INDEX IF NOT EXISTS alert_ingestion_log_type_idx     ON alert_ingestion_log (alert_type);
CREATE INDEX IF NOT EXISTS alert_ingestion_log_source_idx   ON alert_ingestion_log (source);

-- In-app notification history
CREATE TABLE IF NOT EXISTS push_notifications (
    id          BIGSERIAL PRIMARY KEY,
    username    TEXT NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    type        TEXT,
    data        JSONB DEFAULT '{}',
    sent_at     TIMESTAMPTZ DEFAULT NOW(),
    read_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS push_notifications_username_sent_idx
    ON push_notifications (username, sent_at DESC);

-- NCMEC cross-reference matches awaiting coordinator review before any
-- volunteer-facing alert is created from them
CREATE TABLE IF NOT EXISTS ncmec_pending_alerts (
    id                        SERIAL PRIMARY KEY,
    ncmec_case_guid           TEXT NOT NULL,
    matched_vehicle_target_id INT,
    state                     VARCHAR(2),
    area                      TEXT,
    headline                  TEXT,
    vehicle_description       TEXT,
    vehicle_plate             VARCHAR(32),
    photo_url                 TEXT,
    poster_url                TEXT,
    centroid_lat              DOUBLE PRECISION,
    centroid_lng              DOUBLE PRECISION,
    polygon                   TEXT,
    status                    VARCHAR(20) DEFAULT 'pending',
    created_vehicle_target_id INT,
    decided_by                TEXT,
    decided_at                TIMESTAMPTZ,
    created_at                TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ncmec_pending_status_idx ON ncmec_pending_alerts (status);
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
