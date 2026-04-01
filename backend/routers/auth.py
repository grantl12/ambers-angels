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
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy import text

import database

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
                 service_radius_miles, drones, part107, cert_number, status, role, approved_at)
            VALUES
                (:username, :email, :password_hash, :full_name, :phone, :city,
                 :radius, :drones, :part107, :cert_number, :status, :role,
                 :approved_at)
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
def login(req: LoginRequest):
    db = database.SessionLocal()
    try:
        row = db.execute(
            text("SELECT username, password_hash, full_name, status, role FROM pilots WHERE username = :u"),
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
            text("SELECT username, full_name, email, city, status, role, created_at FROM pilots WHERE username = :u"),
            {"u": payload["sub"]},
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pilot not found")
        return {
            "username":  row[0],
            "fullName":  row[1],
            "email":     row[2],
            "city":      row[3],
            "status":    row[4],
            "role":      row[5],
            "createdAt": row[6].isoformat() if row[6] else None,
        }
    finally:
        db.close()


@router.post("/approve/{username}")
def approve_pilot(username: str, _: dict = Depends(require_admin)):
    db = database.SessionLocal()
    try:
        result = db.execute(
            text("""
                UPDATE pilots
                SET status = 'approved', approved_at = :now
                WHERE username = :u AND status = 'pending'
            """),
            {"u": username.lower(), "now": datetime.now(timezone.utc)},
        )
        db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Pilot not found or already approved")
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


@router.post("/logout")
def logout():
    # JWT is stateless — the client drops its token. This endpoint is a
    # convenience so the client has a clean POST to call on logout.
    return {"status": "logged_out"}
