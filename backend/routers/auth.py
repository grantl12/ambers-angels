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

import logging
import os
import random
import smtplib
import time
import httpx

logger = logging.getLogger(__name__)
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
        msg["From"]    = os.getenv("SMTP_FROM", "info@amberangels.org")
        msg["To"]      = to
        port = int(os.getenv("SMTP_PORT", "587"))
        with smtplib.SMTP(host, port) as s:
            s.starttls()
            s.login(os.getenv("SMTP_USER", ""), os.getenv("SMTP_PASS", ""))
            s.send_message(msg)
    except Exception as e:
        logger.warning("Email send failed: %s", e)

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
    notification_prefs:   Optional[list[str]] = None  # push | email — defaults to both

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

def require_coordinator(payload: dict = Depends(get_current_pilot)):
    """Coordinator or admin — can see coverage map, not user management."""
    if payload.get("role") not in ("admin", "coordinator"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Coordinator access required")
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
                 watch_areas, notification_prefs, status, role, approved_at)
            VALUES
                (:username, :email, :password_hash, :full_name, :phone, :city,
                 :radius, :drones, :part107, :cert_number,
                 :watch_areas, :notif_prefs, :status, :role, :approved_at)
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
            "notif_prefs":   req.notification_prefs or ["push", "email"],
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
            text("""
                SELECT username, full_name, email, city, status, role, created_at,
                       watch_areas, expo_push_token, notification_prefs,
                       alert_scope, alert_range_miles
                FROM pilots WHERE username = :u
            """),
            {"u": payload["sub"]},
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pilot not found")
        return {
            "username":          row[0],
            "fullName":          row[1],
            "email":             row[2],
            "city":              row[3],
            "status":            row[4],
            "role":              row[5],
            "createdAt":         row[6].isoformat() if row[6] else None,
            "watchAreas":        row[7] or [],
            "expoPushToken":     row[8],
            "notificationPrefs": row[9] or ["push", "email"],
            "alertScope":        row[10] or "local",
            "alertRangeMiles":   row[11] or 25,
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
                "Sign in at: https://amberangels.org/login\n\n"
                "Thank you for volunteering your time and equipment to help bring "
                "missing children home.\n\n"
                "— The Amber's Angels Team"
            ),
        )
        return {"status": "approved", "username": username}
    finally:
        db.close()


@router.get("/pilots")
def list_pilots(payload: dict = Depends(require_admin)):
    """Admin-only: all approved pilots with their current roles."""
    db = database.SessionLocal()
    try:
        rows = db.execute(text("""
            SELECT username, full_name, email, city, role, status, created_at, approved_at
            FROM pilots
            WHERE status = 'approved'
            ORDER BY approved_at DESC
        """)).fetchall()
        return [
            {
                "username":   r[0],
                "fullName":   r[1],
                "email":      r[2],
                "city":       r[3],
                "role":       r[4],
                "status":     r[5],
                "createdAt":  r[6].isoformat() if r[6] else None,
                "approvedAt": r[7].isoformat() if r[7] else None,
            }
            for r in rows
        ]
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
    notification_prefs:   Optional[list[str]] = None

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
                watch_areas          = COALESCE(:watch_areas, watch_areas),
                notification_prefs   = COALESCE(:notif_prefs, notification_prefs)
            WHERE username = :u
        """), {
            "u":            payload["sub"],
            "full_name":    req.full_name,
            "phone":        req.phone,
            "city":         req.city,
            "radius":       req.service_radius_miles,
            "drones":       req.drones,
            "part107":      req.part107,
            "cert_number":  req.cert_number,
            "watch_areas":  req.watch_areas,
            "notif_prefs":  req.notification_prefs,
        })
        db.commit()
        return {"status": "updated"}
    finally:
        db.close()


class AlertPrefsRequest(BaseModel):
    alert_scope:       str
    alert_range_miles: Optional[int] = 25

@router.patch("/me/alert-prefs")
def update_alert_prefs(req: AlertPrefsRequest, payload: dict = Depends(get_current_pilot)):
    if req.alert_scope not in ("nationwide", "local"):
        raise HTTPException(status_code=400, detail="alert_scope must be 'nationwide' or 'local'")
    db = database.SessionLocal()
    try:
        db.execute(
            text("UPDATE pilots SET alert_scope = :scope, alert_range_miles = :miles WHERE username = :u"),
            {"scope": req.alert_scope, "miles": req.alert_range_miles or 25, "u": payload["sub"]},
        )
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


class SetRoleRequest(BaseModel):
    role: str  # pilot | coordinator | admin

@router.post("/set-role/{username}")
def set_role(username: str, req: SetRoleRequest, _: dict = Depends(require_admin)):
    """Admin-only: promote or demote a pilot's role."""
    if req.role not in ("pilot", "coordinator", "admin"):
        raise HTTPException(status_code=400, detail="Invalid role. Must be pilot, coordinator, or admin")
    db = database.SessionLocal()
    try:
        result = db.execute(
            text("UPDATE pilots SET role = :role WHERE username = :u RETURNING username"),
            {"role": req.role, "u": username.strip().lower()},
        ).fetchone()
        db.commit()
        if not result:
            raise HTTPException(status_code=404, detail="Pilot not found")
        return {"username": username, "role": req.role}
    finally:
        db.close()


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password:     str

@router.post("/change-password")
def change_password(req: ChangePasswordRequest, payload: dict = Depends(get_current_pilot)):
    if len(req.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    db = database.SessionLocal()
    try:
        row = db.execute(
            text("SELECT password_hash FROM pilots WHERE username = :u"),
            {"u": payload["sub"]},
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Account not found")
        if not row[0] or not _verify(req.current_password, row[0]):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        db.execute(
            text("UPDATE pilots SET password_hash = :pw WHERE username = :u"),
            {"pw": _hash(req.new_password), "u": payload["sub"]},
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


# ---------------------------------------------------------------------------
# Self-service password reset (6-digit code via email)
# ---------------------------------------------------------------------------

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    email:        str
    code:         str
    new_password: str

RESET_CODE_EXPIRY_MINUTES = 30

@router.post("/forgot-password")
@limiter.limit("5/minute")
def forgot_password(request: Request, req: ForgotPasswordRequest):
    """
    Generate a 6-digit reset code and email it to the pilot.
    Always returns 200 so we don't leak whether an email is registered.
    """
    db = database.SessionLocal()
    try:
        row = db.execute(
            text("SELECT username, full_name FROM pilots WHERE email = :e"),
            {"e": req.email.strip().lower()},
        ).fetchone()

        if row:
            code    = f"{random.randint(0, 999999):06d}"
            expires = datetime.now(timezone.utc) + timedelta(minutes=RESET_CODE_EXPIRY_MINUTES)
            db.execute(
                text("UPDATE pilots SET reset_code = :code, reset_code_expires = :exp WHERE email = :e"),
                {"code": code, "exp": expires, "e": req.email.strip().lower()},
            )
            db.commit()
            _send_email(
                to=req.email.strip().lower(),
                subject="Your Amber's Angels password reset code",
                body=(
                    f"Hi {row[1] or row[0]},\n\n"
                    f"Your password reset code is:\n\n"
                    f"    {code}\n\n"
                    f"This code expires in {RESET_CODE_EXPIRY_MINUTES} minutes.\n\n"
                    "If you didn't request a reset, you can safely ignore this email.\n\n"
                    "— Amber's Angels"
                ),
            )

        # Always 200 — don't reveal whether the email is registered
        return {"status": "ok"}
    finally:
        db.close()


@router.post("/reset-password")
@limiter.limit("10/minute")
def reset_password(request: Request, req: ResetPasswordRequest):
    """Verify the 6-digit code and set a new password."""
    if len(req.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    db = database.SessionLocal()
    try:
        row = db.execute(
            text("SELECT reset_code, reset_code_expires FROM pilots WHERE email = :e"),
            {"e": req.email.strip().lower()},
        ).fetchone()

        if (
            not row
            or row[0] != req.code.strip()
            or row[1] is None
            or row[1] < datetime.now(timezone.utc)
        ):
            raise HTTPException(status_code=400, detail="Invalid or expired reset code")

        db.execute(
            text("""
                UPDATE pilots
                SET password_hash = :pw, reset_code = NULL, reset_code_expires = NULL
                WHERE email = :e
            """),
            {"pw": _hash(req.new_password), "e": req.email.strip().lower()},
        )
        db.commit()
        return {"status": "ok"}
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Apple / Google SSO
# ---------------------------------------------------------------------------

SSO_REG_EXPIRE_MINUTES = 30

_apple_jwks: dict = {"keys": [], "fetched_at": 0.0}
_APPLE_JWKS_TTL = 3600  # seconds

async def _get_apple_jwks() -> list:
    now = time.monotonic()
    if _apple_jwks["keys"] and now - _apple_jwks["fetched_at"] < _APPLE_JWKS_TTL:
        return _apple_jwks["keys"]
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get("https://appleid.apple.com/auth/keys")
    if resp.status_code != 200:
        if _apple_jwks["keys"]:
            return _apple_jwks["keys"]  # serve stale rather than break login
        raise HTTPException(status_code=502, detail="Could not fetch Apple public keys")
    keys = resp.json()["keys"]
    _apple_jwks["keys"] = keys
    _apple_jwks["fetched_at"] = now
    return keys

class AppleSignInRequest(BaseModel):
    identity_token: str

class GoogleSignInRequest(BaseModel):
    id_token: str

class SSOCompleteRequest(BaseModel):
    registration_token: str
    username:           str
    full_name:          Optional[str] = None


def _make_sso_reg_token(provider: str, sub: str, email: Optional[str]) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=SSO_REG_EXPIRE_MINUTES)
    return jwt.encode(
        {"type": "sso_registration", "provider": provider, "sub": sub, "email": email, "exp": exp},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


_SSO_LOOKUP: dict[str, str] = {
    "apple":  "SELECT username, full_name, role, status FROM pilots WHERE apple_sub  = :sub",
    "google": "SELECT username, full_name, role, status FROM pilots WHERE google_sub = :sub",
}

def _handle_sso_login(provider: str, sub: str, email: Optional[str]) -> dict:
    """Look up an existing SSO pilot or return a registration token for a new one."""
    db = database.SessionLocal()
    try:
        row = db.execute(
            text(_SSO_LOOKUP[provider]),
            {"sub": sub},
        ).fetchone()

        if row:
            if row[3] == "suspended":
                raise HTTPException(status_code=403, detail="Account suspended")
            token = _make_token(row[0], row[2])
            return {
                "access_token": token,
                "token_type":   "bearer",
                "username":     row[0],
                "full_name":    row[1],
                "role":         row[2],
                "status":       row[3],
            }

        # New SSO user — short-lived token so the mobile app can collect a username
        return {
            "registration_token": _make_sso_reg_token(provider, sub, email),
            "email": email,
        }
    finally:
        db.close()


@router.post("/apple")
async def apple_sign_in(req: AppleSignInRequest):
    keys = await _get_apple_jwks()

    try:
        header = jwt.get_unverified_header(req.identity_token)
        key = next((k for k in keys if k["kid"] == header.get("kid")), None)
        if not key:
            raise HTTPException(status_code=400, detail="Apple public key not found for kid")
        payload = jwt.decode(
            req.identity_token,
            key,
            algorithms=["RS256"],
            audience="com.ambersangels.app",
        )
    except JWTError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid Apple identity token: {exc}")

    return _handle_sso_login("apple", payload["sub"], payload.get("email"))


@router.post("/google")
async def google_sign_in(req: GoogleSignInRequest):
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            "https://oauth2.googleapis.com/tokeninfo",
            params={"id_token": req.id_token},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=400, detail="Invalid Google ID token")

    data = resp.json()

    allowed_ids = set(filter(None, os.getenv("GOOGLE_CLIENT_IDS", "").split(",")))
    if allowed_ids and data.get("aud") not in allowed_ids:
        raise HTTPException(status_code=400, detail="Token not issued for this app")

    return _handle_sso_login("google", data["sub"], data.get("email"))


@router.post("/sso-complete", response_model=TokenResponse)
def sso_complete(req: SSOCompleteRequest):
    try:
        payload = _decode_token(req.registration_token)
    except JWTError:
        raise HTTPException(status_code=400, detail="Invalid or expired registration token")

    if payload.get("type") != "sso_registration":
        raise HTTPException(status_code=400, detail="Invalid token type")

    provider = payload["provider"]
    sub      = payload["sub"]
    email    = payload.get("email")
    username = req.username.strip().lower()

    if len(username) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters")

    db = database.SessionLocal()
    try:
        existing = db.execute(
            text("SELECT id FROM pilots WHERE username = :u"),
            {"u": username},
        ).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="Username already taken")

        count      = db.execute(text("SELECT COUNT(*) FROM pilots")).scalar()
        is_first   = count == 0
        pilot_status = "approved" if is_first else "pending"
        pilot_role   = "admin"   if is_first else "pilot"

        _SSO_INSERT = {
            "apple": """
                INSERT INTO pilots
                    (username, email, password_hash, full_name, auth_provider, apple_sub,
                     status, role, approved_at)
                VALUES
                    (:username, :email, NULL, :full_name, :provider, :sub,
                     :status, :role, :approved_at)
            """,
            "google": """
                INSERT INTO pilots
                    (username, email, password_hash, full_name, auth_provider, google_sub,
                     status, role, approved_at)
                VALUES
                    (:username, :email, NULL, :full_name, :provider, :sub,
                     :status, :role, :approved_at)
            """,
        }
        db.execute(text(_SSO_INSERT[provider]), {
            "username":   username,
            "email":      email or f"{username}@sso.placeholder",
            "full_name":  req.full_name,
            "provider":   provider,
            "sub":        sub,
            "status":     pilot_status,
            "role":       pilot_role,
            "approved_at": datetime.now(timezone.utc) if is_first else None,
        })
        db.commit()

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
