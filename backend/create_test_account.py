"""
One-shot script: create (or reset) the info@amberangels.org test account.
Run once on the server, then delete this file.

  python create_test_account.py
"""
import os, secrets, string
from dotenv import load_dotenv
load_dotenv()

from passlib.context import CryptContext
from sqlalchemy import create_engine, text

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ── credentials ──────────────────────────────────────────────────────────────
EMAIL    = "info@amberangels.org"
USERNAME = "info"
PASSWORD = "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(20))

engine = create_engine(os.environ["DATABASE_URL"].replace("+asyncpg", ""))

with engine.begin() as conn:
    conn.execute(text("""
        INSERT INTO pilots
            (username, email, password_hash, full_name, status, role, approved_at)
        VALUES
            (:u, :e, :pw, 'Test Account', 'approved', 'admin', NOW())
        ON CONFLICT (email) DO UPDATE
            SET password_hash = EXCLUDED.password_hash,
                status        = 'approved',
                role          = 'admin',
                approved_at   = NOW()
    """), {"u": USERNAME, "e": EMAIL, "pw": pwd_ctx.hash(PASSWORD)})

print()
print("=" * 48)
print(f"  Username : {USERNAME}")
print(f"  Email    : {EMAIL}")
print(f"  Password : {PASSWORD}")
print(f"  Role     : admin")
print("=" * 48)
print("Change the password after first login.")
print()
