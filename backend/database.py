"""
backend/database.py
Database engine + session factories.
Provides both a sync SessionLocal (for health check / simple endpoints)
and an AsyncSessionLocal (for the async event pipeline).
"""
import os
from dotenv import load_dotenv

from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Async support
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker as async_sessionmaker

load_dotenv()

# --- Sync engine (used by health check, simple DB reads) ---
SYNC_DATABASE_URL = os.getenv("DATABASE_URL", "").replace("+asyncpg", "")

engine = create_engine(SYNC_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# --- Async engine (used by event_service, event_repository) ---
ASYNC_DATABASE_URL = os.getenv("DATABASE_URL", "")
# Ensure the URL uses the asyncpg driver
if ASYNC_DATABASE_URL and "+asyncpg" not in ASYNC_DATABASE_URL:
    ASYNC_DATABASE_URL = ASYNC_DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")

async_engine = create_async_engine(ASYNC_DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(
    async_engine, class_=AsyncSession, expire_on_commit=False
)

Base = declarative_base()


def get_db():
    """Sync DB session dependency for FastAPI endpoints."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
