
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
UPDATE pilots SET alert_scope = 'nationwide' WHERE role = 'admin' AND (alert_scope IS NULL OR alert_scope = 'local');
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
