
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
