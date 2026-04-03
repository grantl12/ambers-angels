-- 1. Create the table first
CREATE TABLE IF NOT EXISTS detection_events (
    id SERIAL PRIMARY KEY,
    plate_best VARCHAR(20) NOT NULL,
    drone_id VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    classification VARCHAR(20) DEFAULT 'weak',
    occurrence_count INTEGER DEFAULT 1,
    average_confidence FLOAT,
    first_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    vehicle_color  VARCHAR(30),
    vehicle_type   VARCHAR(20),
    vehicle_make   VARCHAR(40),
    vehicle_model  VARCHAR(40)
);

-- Additive migration for existing deployments
ALTER TABLE detection_events ADD COLUMN IF NOT EXISTS vehicle_color  VARCHAR(30);
ALTER TABLE detection_events ADD COLUMN IF NOT EXISTS vehicle_type   VARCHAR(20);
ALTER TABLE detection_events ADD COLUMN IF NOT EXISTS vehicle_make   VARCHAR(40);
ALTER TABLE detection_events ADD COLUMN IF NOT EXISTS vehicle_model  VARCHAR(40);

-- 2. Create the index separately (Postgres way)
CREATE INDEX IF NOT EXISTS idx_plate_drone ON detection_events (plate_best, drone_id, last_seen);

-- 3. Flock ALPR camera locations (populated by scraper)
CREATE TABLE IF NOT EXISTS flock_cameras (
    id          VARCHAR(20) PRIMARY KEY,
    lat         DOUBLE PRECISION NOT NULL,
    lng         DOUBLE PRECISION NOT NULL,
    heading     INTEGER,
    road        TEXT,
    agency      TEXT,
    scraped_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Watchlist — plates from FEMA alerts
-- alert_type  = registry key (amber | matties | silver | blue | purple | mipa | ema)
-- source_program = human-readable program name from the alert headline
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS alert_type     VARCHAR(30) DEFAULT 'amber';
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS source_program TEXT;

-- 6. Vehicle targets from FEMA alerts — partial profiles for no-plate alerts
CREATE TABLE IF NOT EXISTS vehicle_targets (
    id              SERIAL PRIMARY KEY,
    fema_identifier TEXT UNIQUE NOT NULL,
    alert_type      VARCHAR(30),
    source_program  TEXT,
    headline        TEXT,
    area            TEXT,
    color           VARCHAR(30),
    body_type       VARCHAR(30),
    make            VARCHAR(40),
    polygon         TEXT,
    centroid_lat    DOUBLE PRECISION,
    centroid_lng    DOUBLE PRECISION,
    added_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at      TIMESTAMP WITH TIME ZONE
);

-- Additive migration for existing deployments
ALTER TABLE vehicle_targets ADD COLUMN IF NOT EXISTS polygon      TEXT;
ALTER TABLE vehicle_targets ADD COLUMN IF NOT EXISTS centroid_lat DOUBLE PRECISION;
ALTER TABLE vehicle_targets ADD COLUMN IF NOT EXISTS centroid_lng DOUBLE PRECISION;

-- Additive migration for telemetry_points
ALTER TABLE telemetry_points ADD COLUMN IF NOT EXISTS volunteer_mode VARCHAR(10);

-- 7. Pilots — registered volunteer drone operators
CREATE TABLE IF NOT EXISTS pilots (
    id              SERIAL PRIMARY KEY,
    username        VARCHAR(50)  UNIQUE NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   TEXT         NOT NULL,
    full_name       TEXT,
    phone           TEXT,
    city            TEXT,
    service_radius_miles INTEGER,
    drones          TEXT[],
    part107         BOOLEAN      DEFAULT FALSE,
    cert_number     TEXT,
    status          VARCHAR(20)  DEFAULT 'pending',   -- pending | approved | suspended
    role            VARCHAR(20)  DEFAULT 'pilot',     -- pilot | admin
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    approved_at     TIMESTAMP WITH TIME ZONE
);

ALTER TABLE pilots ADD COLUMN IF NOT EXISTS watch_areas TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_pilots_username ON pilots (username);
CREATE INDEX IF NOT EXISTS idx_pilots_status   ON pilots (status);

-- 4. Create the alerts table
CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    event_id INTEGER REFERENCES detection_events(id),
    alert_type VARCHAR(50),
    severity VARCHAR(20),
    message TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
