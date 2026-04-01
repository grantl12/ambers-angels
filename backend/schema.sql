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
