CREATE TABLE IF NOT EXISTS telemetry_points (
    id BIGSERIAL PRIMARY KEY,
    drone_id TEXT NOT NULL,
    pilot_id TEXT,
    ts TIMESTAMPTZ NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    altitude_m DOUBLE PRECISION,
    speed_mps DOUBLE PRECISION,
    heading_deg DOUBLE PRECISION,
    accuracy_m DOUBLE PRECISION,
    source TEXT DEFAULT 'phone_gps',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_drone_ts
ON telemetry_points (drone_id, ts DESC);

CREATE TABLE IF NOT EXISTS frames (
    id BIGSERIAL PRIMARY KEY,
    drone_id TEXT NOT NULL,
    frame_path TEXT NOT NULL,
    frame_ts TIMESTAMPTZ NOT NULL,
    telemetry_id BIGINT REFERENCES telemetry_points(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_frames_drone_ts
ON frames (drone_id, frame_ts DESC);

CREATE TABLE IF NOT EXISTS detections (
    id BIGSERIAL PRIMARY KEY,
    frame_id BIGINT REFERENCES frames(id) ON DELETE CASCADE,
    drone_id TEXT NOT NULL,
    plate_text TEXT,
    confidence DOUBLE PRECISION,
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    altitude_m DOUBLE PRECISION,
    telemetry_id BIGINT REFERENCES telemetry_points(id) ON DELETE SET NULL,
    detected_at TIMESTAMPTZ NOT NULL,
    raw_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_detections_drone_time
ON detections (drone_id, detected_at DESC);
