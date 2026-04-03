"""
backend/routers/auth.py

Pilot authentication endpoints.

POST /auth/register  — create a new pilot account (status: pending)
POST /auth/login     — verify credentials, return JWT
GET  /auth/me        — return current pilot info from JWT
POST /auth/approve/{username} — admin-only: approve a pending pilot
POST /auth/logout    — client hint (JWT is stateless; client drops the token)

JWT is signed with JWT_SECRET from the environment (HS256, 30-day expiry).
The first pilot to register is auto-approved as admin so there's always
at least one account that can approve others.
"""

import os
import smtplib
from email.mime.text import MIMEText
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy import text
from slowapi import Limiter
from slowapi.util import get_remote_address

import database

limiter = Limiter(key_func=get_remote_address)

# ---------------------------------------------------------------------------
# Email helper
# ---------------------------------------------------------------------------

def _send_email(to: str, subject: str, body: str) -> None:
    """Best-effort email — silently skips if SMTP env vars are not set."""
    host = os.getenv("SMTP_HOST")
    if not host:
        return
    try:
        msg = MIMEText(body, "plain")
        msg["Subject"] = subject
        msg["From"]    = os.getenv("SMTP_FROM", "noreply@ambersangels.org")
        msg["To"]      = to
        port = int(os.getenv("SMTP_PORT", "587"))
        with smtplib.SMTP(host, port) as s:
            s.starttls()
            s.login(os.getenv("SMTP_USER", ""), os.getenv("SMTP_PASS", ""))
            s.send_message(msg)
    except Exception as e:
        print(f"[email] send failed: {e}")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

JWT_SECRET    = os.getenv("JWT_SECRET", "change-me-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 30

_pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
_bearer  = HTTPBearer(auto_error=False)

router = APIRouter(prefix="/auth", tags=["auth"])


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class RegisterRequest(BaseModel):
    username:             str
    email:                str
    password:             str
    full_name:            Optional[str]  = None
    phone:                Optional[str]  = None
    city:                 Optional[str]  = None
    service_radius_miles: Optional[int]  = None
    drones:               Optional[list[str]] = None
    part107:              bool = False
    cert_number:          Optional[str]  = None
    watch_areas:          Optional[list[str]] = None

class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type:   str = "bearer"
    username:     str
    full_name:    Optional[str]
    role:         str
    status:       str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _hash(password: str) -> str:
    return _pwd_ctx.hash(password)

def _verify(plain: str, hashed: str) -> bool:
    return _pwd_ctx.verify(plain, hashed)

def _make_token(username: str, role: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": username, "role": role, "exp": exp},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )

def _decode_token(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])


def get_current_pilot(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
):
    """FastAPI dependency — returns decoded JWT payload or raises 401."""
    if not creds:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        return _decode_token(creds.credentials)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

def require_admin(payload: dict = Depends(get_current_pilot)):
    if payload.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return payload


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/register", response_model=TokenResponse)
def register(req: RegisterRequest):
    db = database.SessionLocal()
    try:
        # Check for existing username / email
        existing = db.execute(
            text("SELECT id FROM pilots WHERE username = :u OR email = :e"),
            {"u": req.username.strip().lower(), "e": req.email.strip().lower()},
        ).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="Username or email already registered")

        # First pilot ever → auto-approve as admin
        count = db.execute(text("SELECT COUNT(*) FROM pilots")).scalar()
        is_first = count == 0
        pilot_status = "approved" if is_first else "pending"
        pilot_role   = "admin"   if is_first else "pilot"

        username = req.username.strip().lower()
        db.execute(text("""
            INSERT INTO pilots
                (username, email, password_hash, full_name, phone, city,
                 service_radius_miles, drones, part107, cert_number,
                 watch_areas, status, role, approved_at)
            VALUES
                (:username, :email, :password_hash, :full_name, :phone, :city,
                 :radius, :drones, :part107, :cert_number,
                 :watch_areas, :status, :role, :approved_at)
        """), {
            "username":      username,
            "email":         req.email.strip().lower(),
            "password_hash": _hash(req.password),
            "full_name":     req.full_name,
            "phone":         req.phone,
            "city":          req.city,
            "radius":        req.service_radius_miles,
            "drones":        req.drones,
            "part107":       req.part107,
            "cert_number":   req.cert_number,
            "watch_areas":   req.watch_areas or [],
            "status":        pilot_status,
            "role":          pilot_role,
            "approved_at":   datetime.now(timezone.utc) if is_first else None,
        })
        db.commit()

        if pilot_status == "pending":
            # Return a token that indicates pending — client shows "awaiting approval"
            token = _make_token(username, pilot_role)
            return TokenResponse(
                access_token=token,
                username=username,
                full_name=req.full_name,
                role=pilot_role,
                status=pilot_status,
            )

        token = _make_token(username, pilot_role)
        return TokenResponse(
            access_token=token,
            username=username,
            full_name=req.full_name,
            role=pilot_role,
            status=pilot_status,
        )
    finally:
        db.close()


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
def login(request: Request, req: LoginRequest):
    db = database.SessionLocal()
    try:
        row = db.execute(
            text("SELECT username, password_hash, full_name, status, role FROM pilots WHERE username = :u OR email = :u"),
            {"u": req.username.strip().lower()},
        ).fetchone()

        if not row or not _verify(req.password, row[1]):
            raise HTTPException(status_code=401, detail="Invalid username or password")

        if row[3] == "suspended":
            raise HTTPException(status_code=403, detail="Account suspended")

        # Allow pending pilots to get a token — the dashboard will show a pending state
        token = _make_token(row[0], row[4])
        return TokenResponse(
            access_token=token,
            username=row[0],
            full_name=row[2],
            role=row[4],
            status=row[3],
        )
    finally:
        db.close()


@router.get("/me")
def me(payload: dict = Depends(get_current_pilot)):
    db = database.SessionLocal()
    try:
        row = db.execute(
            text("SELECT username, full_name, email, city, status, role, created_at, watch_areas, expo_push_token FROM pilots WHERE username = :u"),
            {"u": payload["sub"]},
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pilot not found")
        return {
            "username":      row[0],
            "fullName":      row[1],
            "email":         row[2],
            "city":          row[3],
            "status":        row[4],
            "role":          row[5],
            "createdAt":     row[6].isoformat() if row[6] else None,
            "watchAreas":    row[7] or [],
            "expoPushToken": row[8],
        }
    finally:
        db.close()


@router.post("/approve/{username}")
def approve_pilot(username: str, _: dict = Depends(require_admin)):
    db = database.SessionLocal()
    try:
        row = db.execute(
            text("""
                UPDATE pilots
                SET status = 'approved', approved_at = :now
                WHERE username = :u AND status = 'pending'
                RETURNING email, full_name
            """),
            {"u": username.lower(), "now": datetime.now(timezone.utc)},
        ).fetchone()
        db.commit()
        if not row:
            raise HTTPException(status_code=404, detail="Pilot not found or already approved")
        # Send approval email (best-effort, non-blocking)
        _send_email(
            to=row[0],
            subject="You're approved — Amber's Angels",
            body=(
                f"Hi {row[1] or username},\n\n"
                "Your Amber's Angels pilot account has been approved!\n\n"
                "Sign in at: http://157.245.125.103/login\n\n"
                "Thank you for volunteering your time and equipment to help bring "
                "missing children home.\n\n"
                "— The Amber's Angels Team"
            ),
        )
        return {"status": "approved", "username": username}
    finally:
        db.close()


@router.get("/pending")
def list_pending(payload: dict = Depends(require_admin)):
    db = database.SessionLocal()
    try:
        rows = db.execute(text("""
            SELECT username, full_name, email, city, drones, part107, created_at
            FROM pilots WHERE status = 'pending'
            ORDER BY created_at ASC
        """)).fetchall()
        return [
            {
                "username":  r[0],
                "fullName":  r[1],
                "email":     r[2],
                "city":      r[3],
                "drones":    r[4],
                "part107":   r[5],
                "createdAt": r[6].isoformat() if r[6] else None,
            }
            for r in rows
        ]
    finally:
        db.close()


class UpdateProfileRequest(BaseModel):
    full_name:            Optional[str] = None
    phone:                Optional[str] = None
    city:                 Optional[str] = None
    service_radius_miles: Optional[int] = None
    drones:               Optional[list[str]] = None
    part107:              Optional[bool] = None
    cert_number:          Optional[str] = None
    watch_areas:          Optional[list[str]] = None

@router.patch("/me")
def update_me(req: UpdateProfileRequest, payload: dict = Depends(get_current_pilot)):
    db = database.SessionLocal()
    try:
        db.execute(text("""
            UPDATE pilots SET
                full_name            = COALESCE(:full_name, full_name),
                phone                = COALESCE(:phone, phone),
                city                 = COALESCE(:city, city),
                service_radius_miles = COALESCE(:radius, service_radius_miles),
                drones               = COALESCE(:drones, drones),
                part107              = COALESCE(:part107, part107),
                cert_number          = COALESCE(:cert_number, cert_number),
                watch_areas          = COALESCE(:watch_areas, watch_areas)
            WHERE username = :u
        """), {
            "u":           payload["sub"],
            "full_name":   req.full_name,
            "phone":       req.phone,
            "city":        req.city,
            "radius":      req.service_radius_miles,
            "drones":      req.drones,
            "part107":     req.part107,
            "cert_number": req.cert_number,
            "watch_areas": req.watch_areas,
        })
        db.commit()
        return {"status": "updated"}
    finally:
        db.close()


class PushTokenRequest(BaseModel):
    token: str

@router.post("/push-token")
def register_push_token(req: PushTokenRequest, payload: dict = Depends(get_current_pilot)):
    """Store (or update) the Expo push token for the authenticated pilot."""
    db = database.SessionLocal()
    try:
        db.execute(
            text("UPDATE pilots SET expo_push_token = :token WHERE username = :u"),
            {"token": req.token.strip(), "u": payload["sub"]},
        )
        db.commit()
        return {"status": "ok"}
    finally:
        db.close()


@router.post("/logout")
def logout():
    # JWT is stateless — the client drops its token. This endpoint is a
    # convenience so the client has a clean POST to call on logout.
    return {"status": "logged_out"}
