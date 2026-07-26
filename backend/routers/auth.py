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

import json
import logging
import os
import random
import smtplib
import threading
import time
import httpx
import requests as _requests

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

CURRENT_TOS_VERSION = "2025-05-19"

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
# Discord notification for coordinator requests
# ---------------------------------------------------------------------------

def _notify_coordinator_request(username: str, full_name: str | None, city: str | None, reason: str | None) -> None:
    webhook_url = os.getenv("ALERT_WEBHOOK_URL", "")
    if not webhook_url:
        return
    def _send():
        try:
            name_line = f"**{full_name}** (`{username}`)" if full_name else f"`{username}`"
            fields = [
                {"name": "Pilot", "value": name_line, "inline": True},
            ]
            if city:
                fields.append({"name": "City", "value": city, "inline": True})
            if reason:
                fields.append({"name": "Reason", "value": reason, "inline": False})
            fields.append({
                "name": "Action",
                "value": "Approve or deny at [Admin Panel](https://amberangels.org/admin)",
                "inline": False,
            })
            _requests.post(webhook_url, json={
                "username": "Amber's Angels — Backend",
                "embeds": [{
                    "title": "📋 Coordinator Access Requested",
                    "color": 0xF59E0B,
                    "fields": fields,
                    "footer": {"text": "ambers-angels-api"},
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }],
            }, timeout=5)
        except Exception:
            pass
    threading.Thread(target=_send, daemon=True).start()


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


def require_bolo_creator(payload: dict = Depends(get_current_pilot)):
    """Admin always passes. Coordinators need can_create_bolo flag."""
    role = payload.get("role")
    if role == "admin":
        return payload
    if role != "coordinator":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="BOLO creation requires coordinator or admin access")
    db = database.SessionLocal()
    try:
        row = db.execute(
            text("SELECT COALESCE(can_create_bolo, FALSE) FROM pilots WHERE username = :u"),
            {"u": payload["sub"]},
        ).fetchone()
        if not row or not row[0]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="BOLO creation not enabled for your account — contact an admin")
        return payload
    finally:
        db.close()


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

        # First pilot ever → admin; all others auto-approved as pilot
        count = db.execute(text("SELECT COUNT(*) FROM pilots")).scalar()
        is_first = count == 0
        pilot_status = "approved"
        pilot_role   = "admin" if is_first else "pilot"

        username = req.username.strip().lower()
        db.execute(text("""
            INSERT INTO pilots
                (username, email, password_hash, full_name, phone, city,
                 service_radius_miles, drones, part107, cert_number,
                 watch_areas, notification_prefs, status, role, approved_at)
            VALUES
                (:username, :email, :password_hash, :full_name, :phone, :city,
                 :radius, :drones, :part107, :cert_number,
                 CAST(:watch_areas AS jsonb), CAST(:notif_prefs AS jsonb), :status, :role, :approved_at)
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
            "watch_areas":   json.dumps(req.watch_areas or []),
            "notif_prefs":   json.dumps(req.notification_prefs or ["push", "email"]),
            "status":        pilot_status,
            "role":          pilot_role,
            "approved_at":   datetime.now(timezone.utc),
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
                       alert_scope, alert_range_miles, coordinator_requested_at,
                       sms_number, sms_alerts_enabled
                FROM pilots WHERE username = :u
            """),
            {"u": payload["sub"]},
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pilot not found")
        return {
            "username":                   row[0],
            "fullName":                   row[1],
            "email":                      row[2],
            "city":                       row[3],
            "status":                     row[4],
            "role":                       row[5],
            "createdAt":                  row[6].isoformat() if row[6] else None,
            "watchAreas":                 row[7] or [],
            "expoPushToken":              row[8],
            "notificationPrefs":          row[9] or ["push", "email"],
            "alertScope":                 row[10] or "local",
            "alertRangeMiles":            row[11] or 25,
            "coordinatorRequestedAt":     row[12].isoformat() if row[12] else None,
            "smsNumber":                  row[13],
            "smsAlertsEnabled":           bool(row[14]) if row[14] is not None else False,
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
            SELECT username, full_name, email, city, role, status, created_at, approved_at,
                   COALESCE(can_dispatch_drones, FALSE),
                   COALESCE(can_create_bolo, FALSE)
            FROM pilots
            WHERE status = 'approved'
            ORDER BY approved_at DESC
        """)).fetchall()
        return [
            {
                "username":          r[0],
                "fullName":          r[1],
                "email":             r[2],
                "city":              r[3],
                "role":              r[4],
                "status":            r[5],
                "createdAt":         r[6].isoformat() if r[6] else None,
                "approvedAt":        r[7].isoformat() if r[7] else None,
                "canDispatchDrones": r[8],
                "canCreateBolo":     r[9],
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


@router.delete("/pending/{username}")
def deny_pending_pilot(username: str, _: dict = Depends(require_admin)):
    """Admin: reject and delete a pending volunteer registration."""
    db = database.SessionLocal()
    try:
        row = db.execute(
            text("DELETE FROM pilots WHERE username = :u AND status = 'pending' RETURNING username"),
            {"u": username.lower()},
        ).fetchone()
        db.commit()
        if not row:
            raise HTTPException(status_code=404, detail="Pending pilot not found")
        return {"status": "denied", "username": username}
    finally:
        db.close()


@router.delete("/pilots/{username}")
def remove_pilot(username: str, payload: dict = Depends(require_admin)):
    """Admin: deactivate (suspend) an approved pilot. Cannot remove yourself."""
    if payload.get("sub") == username.lower():
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")
    db = database.SessionLocal()
    try:
        row = db.execute(
            text("""
                UPDATE pilots SET status = 'suspended'
                WHERE username = :u AND status = 'approved'
                RETURNING username
            """),
            {"u": username.lower()},
        ).fetchone()
        db.commit()
        if not row:
            raise HTTPException(status_code=404, detail="Active pilot not found")
        return {"status": "suspended", "username": username}
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
                watch_areas          = COALESCE(CAST(:watch_areas AS jsonb), watch_areas),
                notification_prefs   = COALESCE(CAST(:notif_prefs AS jsonb), notification_prefs)
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
            "watch_areas":  json.dumps(req.watch_areas) if req.watch_areas is not None else None,
            "notif_prefs":  json.dumps(req.notification_prefs) if req.notification_prefs is not None else None,
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


import re as _re
_E164_RE = _re.compile(r"^\+1\d{10}$")

class SmsSettingsRequest(BaseModel):
    sms_number:        Optional[str]  = None   # E.164 US (+1XXXXXXXXXX) or null to clear
    sms_alerts_enabled: bool          = False

@router.patch("/me/sms-settings", dependencies=[Depends(require_coordinator)])
def update_sms_settings(req: SmsSettingsRequest, payload: dict = Depends(get_current_pilot)):
    num = req.sms_number.strip() if req.sms_number else None
    if num and not _E164_RE.match(num):
        raise HTTPException(status_code=400, detail="Phone number must be E.164 US format: +1XXXXXXXXXX")
    # Disable alerts if number is cleared
    enabled = req.sms_alerts_enabled and bool(num)
    db = database.SessionLocal()
    try:
        db.execute(
            text("UPDATE pilots SET sms_number = :num, sms_alerts_enabled = :enabled WHERE username = :u"),
            {"num": num, "enabled": enabled, "u": payload["sub"]},
        )
        db.commit()
        return {"status": "updated", "sms_number": num, "sms_alerts_enabled": enabled}
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


class SetPermissionsRequest(BaseModel):
    can_dispatch_drones: Optional[bool] = None
    can_create_bolo:     Optional[bool] = None

@router.post("/admin/pilots/{username}/permissions")
def set_permissions(username: str, req: SetPermissionsRequest, _: dict = Depends(require_admin)):
    """Admin-only: toggle individual permission flags for a pilot."""
    if req.can_dispatch_drones is None and req.can_create_bolo is None:
        raise HTTPException(status_code=400, detail="No permission flags provided")
    db = database.SessionLocal()
    try:
        sets = []
        params: dict = {"u": username.strip().lower()}
        if req.can_dispatch_drones is not None:
            sets.append("can_dispatch_drones = :dispatch")
            params["dispatch"] = req.can_dispatch_drones
        if req.can_create_bolo is not None:
            sets.append("can_create_bolo = :bolo")
            params["bolo"] = req.can_create_bolo
        result = db.execute(
            text(f"UPDATE pilots SET {', '.join(sets)} WHERE username = :u RETURNING username"),
            params,
        ).fetchone()
        db.commit()
        if not result:
            raise HTTPException(status_code=404, detail="Pilot not found")
        return {"username": username, "can_dispatch_drones": req.can_dispatch_drones, "can_create_bolo": req.can_create_bolo}
    finally:
        db.close()


class CoordinatorRequestBody(BaseModel):
    reason: Optional[str] = None

@router.post("/request-coordinator")
def request_coordinator(req: CoordinatorRequestBody, payload: dict = Depends(get_current_pilot)):
    """Any approved pilot can request elevation to coordinator tier."""
    db = database.SessionLocal()
    try:
        row = db.execute(
            text("SELECT role, status, full_name, city FROM pilots WHERE username = :u"),
            {"u": payload["sub"]},
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Account not found")
        if row[1] != "approved":
            raise HTTPException(status_code=403, detail="Account not yet active")
        if row[0] in ("coordinator", "admin"):
            raise HTTPException(status_code=400, detail="Already a coordinator or admin")
        db.execute(
            text("UPDATE pilots SET coordinator_requested_at = :now, coordinator_request_reason = :reason WHERE username = :u"),
            {"now": datetime.now(timezone.utc), "reason": req.reason, "u": payload["sub"]},
        )
        db.commit()
        _notify_coordinator_request(payload["sub"], row[2], row[3], req.reason)
        return {"status": "requested"}
    finally:
        db.close()


@router.get("/coordinator-requests")
def list_coordinator_requests(payload: dict = Depends(require_admin)):
    """Admin-only: pilots who have requested coordinator access."""
    db = database.SessionLocal()
    try:
        rows = db.execute(text("""
            SELECT username, full_name, email, city, part107, coordinator_requested_at, coordinator_request_reason
            FROM pilots
            WHERE coordinator_requested_at IS NOT NULL
              AND role NOT IN ('coordinator', 'admin')
            ORDER BY coordinator_requested_at ASC
        """)).fetchall()
        return [
            {
                "username":    r[0],
                "fullName":    r[1],
                "email":       r[2],
                "city":        r[3],
                "part107":     r[4],
                "requestedAt": r[5].isoformat() if r[5] else None,
                "reason":      r[6],
            }
            for r in rows
        ]
    finally:
        db.close()


@router.post("/deny-coordinator/{username}")
def deny_coordinator(username: str, _: dict = Depends(require_admin)):
    """Admin-only: reject a coordinator request and clear the pending flag."""
    db = database.SessionLocal()
    try:
        row = db.execute(
            text("""
                UPDATE pilots
                SET coordinator_requested_at = NULL, coordinator_request_reason = NULL
                WHERE username = :u AND coordinator_requested_at IS NOT NULL
                  AND role NOT IN ('coordinator', 'admin')
                RETURNING email, full_name
            """),
            {"u": username.lower()},
        ).fetchone()
        db.commit()
        if not row:
            raise HTTPException(status_code=404, detail="No pending coordinator request for this user")
        _send_email(
            to=row[0],
            subject="Coordinator request update — Amber's Angels",
            body=(
                f"Hi {row[1] or username},\n\n"
                "Thank you for your interest in coordinator access on Amber's Angels.\n\n"
                "At this time, your request has not been approved. You can reapply in the app "
                "if your situation changes.\n\n"
                "Your pilot account remains active — you can continue participating in missions.\n\n"
                "— The Amber's Angels Team"
            ),
        )
        return {"status": "denied", "username": username}
    finally:
        db.close()


@router.post("/approve-coordinator/{username}")
def approve_coordinator(username: str, _: dict = Depends(require_admin)):
    """Admin-only: grant coordinator role to a pilot who requested it."""
    db = database.SessionLocal()
    try:
        row = db.execute(
            text("""
                UPDATE pilots
                SET role = 'coordinator', coordinator_requested_at = NULL, coordinator_request_reason = NULL
                WHERE username = :u AND coordinator_requested_at IS NOT NULL
                  AND role NOT IN ('coordinator', 'admin')
                RETURNING email, full_name
            """),
            {"u": username.lower()},
        ).fetchone()
        db.commit()
        if not row:
            raise HTTPException(status_code=404, detail="No pending coordinator request for this user")
        _send_email(
            to=row[0],
            subject="Coordinator access approved — Amber's Angels",
            body=(
                f"Hi {row[1] or username},\n\n"
                "Your request for coordinator access on Amber's Angels has been approved.\n\n"
                "You now have access to mission coordination tools at https://amberangels.org/map\n\n"
                "— The Amber's Angels Team"
            ),
        )
        return {"status": "approved", "username": username, "role": "coordinator"}
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
# Account deletion (required by App Store Guideline 5.1.1(v))
# ---------------------------------------------------------------------------

@router.delete("/delete-account")
async def delete_account(payload: dict = Depends(get_current_pilot)):
    """
    Permanently delete the calling pilot's account and associated personal data.
    This is irreversible. The client must discard its JWT after calling this.
    """
    username = payload.get("sub") or payload.get("username", "")
    if not username:
        raise HTTPException(status_code=400, detail="Cannot identify account from token.")

    async with database.AsyncSessionLocal() as session:
        try:
            # Anonymise telemetry (keep flight data, remove identity)
            await session.execute(
                text("UPDATE telemetry_points SET pilot_id = NULL WHERE pilot_id = :u"),
                {"u": username},
            )
            # Remove drone registrations and their missions
            await session.execute(
                text("""
                    DELETE FROM autonomous_missions
                    WHERE drone_id IN (
                        SELECT id FROM autonomous_drones WHERE pilot_username = :u
                    )
                """),
                {"u": username},
            )
            await session.execute(
                text("DELETE FROM autonomous_drones WHERE pilot_username = :u"),
                {"u": username},
            )
            # Delete the account itself
            result = await session.execute(
                text("DELETE FROM pilots WHERE username = :u RETURNING username"),
                {"u": username},
            )
            if not result.fetchone():
                raise HTTPException(status_code=404, detail="Account not found.")
            await session.commit()
            logger.info("Account deleted: %s", username)
        except HTTPException:
            raise
        except Exception as exc:
            await session.rollback()
            logger.error("Account deletion failed for %s: %s", username, exc)
            raise HTTPException(status_code=500, detail="Account deletion failed. Please try again.")

    return {"ok": True, "message": "Account permanently deleted."}


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

        # If this email is already registered to a different account, surface that
        # clearly rather than letting sso_complete crash on a unique constraint.
        if email:
            existing_email = db.execute(
                text("SELECT 1 FROM pilots WHERE email = :email"),
                {"email": email.strip().lower()},
            ).fetchone()
            if existing_email:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "This email address is already associated with an existing account. "
                        "Please sign in with your original login method, then link Apple Sign In "
                        "from your account settings."
                    ),
                )

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
        pilot_status = "approved"
        pilot_role   = "admin" if is_first else "pilot"

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
        try:
            db.execute(text(_SSO_INSERT[provider]), {
                "username":   username,
                "email":      email or f"{username}@noemail.amberangels.org",
                "full_name":  req.full_name,
                "provider":   provider,
                "sub":        sub,
                "status":     pilot_status,
                "role":       pilot_role,
                "approved_at": datetime.now(timezone.utc),
            })
            db.commit()
        except Exception as db_exc:
            db.rollback()
            err = str(db_exc).lower()
            if "email" in err and "unique" in err:
                raise HTTPException(status_code=400, detail="This email is already registered. Sign in with your original account.")
            if "username" in err and "unique" in err:
                raise HTTPException(status_code=400, detail="Username already taken — please choose a different one.")
            raise HTTPException(status_code=500, detail="Registration failed. Please try again.")

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


# ---------------------------------------------------------------------------
# Terms of Service
# ---------------------------------------------------------------------------

@router.get("/tos-status")
def tos_status(payload: dict = Depends(get_current_pilot)):
    username = payload["sub"]
    db = database.SessionLocal()
    try:
        row = db.execute(
            text("SELECT tos_version FROM pilots WHERE username = :u"),
            {"u": username},
        ).fetchone()
        accepted = bool(row and row[0] == CURRENT_TOS_VERSION)
        return {
            "current_version": CURRENT_TOS_VERSION,
            "accepted": accepted,
            "accepted_version": row[0] if row else None,
        }
    finally:
        db.close()


@router.post("/tos/accept")
def accept_tos(payload: dict = Depends(get_current_pilot)):
    username = payload["sub"]
    db = database.SessionLocal()
    try:
        db.execute(
            text("UPDATE pilots SET tos_version = :v, tos_accepted_at = NOW() WHERE username = :u"),
            {"v": CURRENT_TOS_VERSION, "u": username},
        )
        db.commit()
        return {"accepted": True, "version": CURRENT_TOS_VERSION}
    finally:
        db.close()
