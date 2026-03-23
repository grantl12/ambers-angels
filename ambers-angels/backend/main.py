import os
from datetime import datetime, timedelta, timezone
from typing import Optional, Any

import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="Amber's Angels Metadata API")


DB_NAME = os.getenv("DB_NAME", "ambersangels")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")
DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = int(os.getenv("DB_PORT", "5432"))

GPS_MATCH_WINDOW_SECONDS = int(os.getenv("GPS_MATCH_WINDOW_SECONDS", "5"))


def get_conn():
    return psycopg2.connect(
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        host=DB_HOST,
        port=DB_PORT,
        cursor_factory=psycopg2.extras.RealDictCursor,
    )


def ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


class TelemetryIn(BaseModel):
    drone_id: str = Field(..., min_length=1)
    pilot_id: Optional[str] = None
    timestamp: datetime
    lat: float
    lon: float
    altitude_m: Optional[float] = None
    speed_mps: Optional[float] = None
    heading_deg: Optional[float] = None
    accuracy_m: Optional[float] = None
    source: Optional[str] = "phone_gps"


class FrameIn(BaseModel):
    drone_id: str = Field(..., min_length=1)
    frame_path: str = Field(..., min_length=1)
    frame_ts: datetime


class DetectionIn(BaseModel):
    frame_id: int
    drone_id: str = Field(..., min_length=1)
    plate_text: Optional[str] = None
    confidence: Optional[float] = None
    detected_at: datetime
    raw_payload: Optional[Any] = None


@app.get("/health")
def health():
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SELECT 1 AS ok;")
        row = cur.fetchone()
        cur.close()
        conn.close()
        return {"status": "ok", "db": row["ok"] == 1}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"health check failed: {exc}")


@app.post("/telemetry")
def ingest_telemetry(t: TelemetryIn):
    ts = ensure_utc(t.timestamp)

    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            INSERT INTO telemetry_points
            (drone_id, pilot_id, ts, lat, lon, altitude_m, speed_mps, heading_deg, accuracy_m, source)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                t.drone_id,
                t.pilot_id,
                ts,
                t.lat,
                t.lon,
                t.altitude_m,
                t.speed_mps,
                t.heading_deg,
                t.accuracy_m,
                t.source,
            ),
        )
        row = cur.fetchone()
        conn.commit()
        return {
            "ok": True,
            "telemetry_id": row["id"],
            "drone_id": t.drone_id,
            "timestamp": ts.isoformat(),
        }
    finally:
        cur.close()
        conn.close()


@app.get("/latest-telemetry/{drone_id}")
def latest_telemetry(drone_id: str):
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT id, drone_id, pilot_id, ts, lat, lon, altitude_m, speed_mps, heading_deg, accuracy_m, source
            FROM telemetry_points
            WHERE drone_id = %s
            ORDER BY ts DESC
            LIMIT 1
            """,
            (drone_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="No telemetry found for drone")
        return {"ok": True, "telemetry": row}
    finally:
        cur.close()
        conn.close()


def find_nearest_telemetry(cur, drone_id: str, frame_ts: datetime):
    lower = frame_ts - timedelta(seconds=GPS_MATCH_WINDOW_SECONDS)
    upper = frame_ts + timedelta(seconds=GPS_MATCH_WINDOW_SECONDS)

    cur.execute(
        """
        SELECT
            id,
            ts,
            lat,
            lon,
            altitude_m,
            speed_mps,
            heading_deg,
            accuracy_m,
            ABS(EXTRACT(EPOCH FROM (ts - %s))) AS time_diff_seconds
        FROM telemetry_points
        WHERE drone_id = %s
          AND ts BETWEEN %s AND %s
        ORDER BY time_diff_seconds ASC
        LIMIT 1
        """,
        (frame_ts, drone_id, lower, upper),
    )
    return cur.fetchone()


@app.post("/frames")
def register_frame(f: FrameIn):
    frame_ts = ensure_utc(f.frame_ts)

    conn = get_conn()
    cur = conn.cursor()
    try:
        telemetry = find_nearest_telemetry(cur, f.drone_id, frame_ts)
        telemetry_id = telemetry["id"] if telemetry else None

        cur.execute(
            """
            INSERT INTO frames (drone_id, frame_path, frame_ts, telemetry_id)
            VALUES (%s, %s, %s, %s)
            RETURNING id
            """,
            (f.drone_id, f.frame_path, frame_ts, telemetry_id),
        )
        frame_row = cur.fetchone()
        conn.commit()

        return {
            "ok": True,
            "frame_id": frame_row["id"],
            "drone_id": f.drone_id,
            "frame_ts": frame_ts.isoformat(),
            "telemetry_id": telemetry_id,
            "telemetry_match": telemetry,
        }
    finally:
        cur.close()
        conn.close()


@app.post("/detections")
def create_detection(d: DetectionIn):
    detected_at = ensure_utc(d.detected_at)

    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT
                f.id AS frame_id,
                f.drone_id,
                f.frame_ts,
                f.telemetry_id,
                tp.lat,
                tp.lon,
                tp.altitude_m
            FROM frames f
            LEFT JOIN telemetry_points tp ON tp.id = f.telemetry_id
            WHERE f.id = %s
            """,
            (d.frame_id,),
        )
        frame = cur.fetchone()
        if not frame:
            raise HTTPException(status_code=404, detail="Frame not found")

        cur.execute(
            """
            INSERT INTO detections
            (frame_id, drone_id, plate_text, confidence, lat, lon, altitude_m, telemetry_id, detected_at, raw_payload)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                d.frame_id,
                d.drone_id,
                d.plate_text,
                d.confidence,
                frame["lat"],
                frame["lon"],
                frame["altitude_m"],
                frame["telemetry_id"],
                detected_at,
                psycopg2.extras.Json(d.raw_payload) if d.raw_payload is not None else None,
            ),
        )
        row = cur.fetchone()
        conn.commit()

        return {
            "ok": True,
            "detection_id": row["id"],
            "frame_id": d.frame_id,
            "plate_text": d.plate_text,
            "confidence": d.confidence,
            "lat": frame["lat"],
            "lon": frame["lon"],
            "altitude_m": frame["altitude_m"],
            "telemetry_id": frame["telemetry_id"],
            "detected_at": detected_at.isoformat(),
        }
    finally:
        cur.close()
        conn.close()
