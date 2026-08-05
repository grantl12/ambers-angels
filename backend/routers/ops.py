"""
backend/routers/ops.py

Live-system ops API for Claude Code sessions that can't reach the droplet
over SSH (e.g. the cloud "Code" tab sandbox — HTTPS-only egress). Gated by
a single static header key (OPS_API_KEY), not a pilot JWT, because these
callers are agent sessions, not logged-in humans.

Deliberately NOT included: arbitrary shell exec, arbitrary (non-SELECT) SQL.
A bearer-token-gated RCE endpoint on a server holding AMBER-alert / missing
child data is a bad trade even for "I need shit fixed fast" emergencies —
the four actions below (logs, health, read-only query, restart/migrate)
cover the real emergency cases without that exposure. If a future emergency
doesn't fit these, extend this file with another narrow, named action —
don't loosen these into a general command channel.
"""
import os
import subprocess
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

import database
from services.audit import write_audit_sync

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ops", tags=["ops"])

OPS_API_KEY = os.getenv("OPS_API_KEY", "")
PM2_BIN = "/home/ambers-angels/.local/bin/pm2"
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PROCESS_MAP = {
    "api": "ambers-angels-api",
    "web": "ambers-angels-web",
    "worker": "ambers-angels-worker",
    "rtmp-monitor": "ambers-angels-rtmp-monitor",
}


def require_ops_key(x_ops_key: str = Header(default=""), x_ops_actor: str = Header(default="unknown")):
    if not OPS_API_KEY:
        raise HTTPException(status_code=503, detail="OPS_API_KEY not configured on server")
    if x_ops_key != OPS_API_KEY:
        raise HTTPException(status_code=403, detail="Invalid ops key")
    return x_ops_actor


def _resolve_process(name: str) -> str:
    if name == "all":
        return "all"
    if name not in PROCESS_MAP:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown process '{name}'. Valid: {list(PROCESS_MAP)} or 'all'.",
        )
    return PROCESS_MAP[name]


# ---------------------------------------------------------------------------
# Read-only diagnostics
# ---------------------------------------------------------------------------

@router.get("/health")
def ops_health(actor: str = Depends(require_ops_key)):
    try:
        result = subprocess.run(
            [PM2_BIN, "jlist"], capture_output=True, text=True, timeout=15,
        )
        import json as _json
        procs = _json.loads(result.stdout) if result.returncode == 0 else []
        summary = [
            {
                "name": p.get("name"),
                "status": p.get("pm2_env", {}).get("status"),
                "restarts": p.get("pm2_env", {}).get("restart_time"),
                "uptime_ms": p.get("pm2_env", {}).get("pm_uptime"),
                "memory": p.get("monit", {}).get("memory"),
                "cpu": p.get("monit", {}).get("cpu"),
            }
            for p in procs
        ]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"pm2 jlist failed: {exc}")
    return {"checked_at": datetime.now(timezone.utc).isoformat(), "processes": summary}


@router.get("/logs/{process}")
def ops_logs(process: str, lines: int = 200, actor: str = Depends(require_ops_key)):
    lines = max(1, min(lines, 2000))
    pm2_name = _resolve_process(process)
    args = [PM2_BIN, "logs", "--lines", str(lines), "--nostream"]
    if pm2_name != "all":
        args.insert(2, pm2_name)
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=30)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"pm2 logs failed: {exc}")
    return {"process": process, "lines": lines, "output": result.stdout or result.stderr}


class QueryRequest(BaseModel):
    sql: str


@router.post("/query")
def ops_query(req: QueryRequest, actor: str = Depends(require_ops_key), db: Session = Depends(database.get_db)):
    """
    Read-only SQL. Enforced by Postgres itself (SET TRANSACTION READ ONLY),
    not by pattern-matching the query text — READ ONLY transactions reject
    INSERT/UPDATE/DELETE/DDL even when smuggled inside a CTE. The caller's
    SQL is also wrapped as a single subquery, so multi-statement injection
    (`...; DROP TABLE x`) is a syntax error before READ ONLY is even reached.
    """
    write_audit_sync(db, actor, "ops.query", {"sql": req.sql})
    try:
        with database.engine.connect() as conn:
            conn.execute(text("SET TRANSACTION READ ONLY"))
            conn.execute(text("SET statement_timeout = '5000'"))
            result = conn.execute(text(f"SELECT * FROM ({req.sql}) AS _ops_q LIMIT 500"))
            rows = [dict(r._mapping) for r in result]
            conn.rollback()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"row_count": len(rows), "rows": rows}


# ---------------------------------------------------------------------------
# Bounded write actions
# ---------------------------------------------------------------------------

class RestartRequest(BaseModel):
    process: str


def _do_restart(pm2_name: str):
    subprocess.run([PM2_BIN, "restart", pm2_name, "--update-env"], capture_output=True, text=True, timeout=60)


@router.post("/restart")
def ops_restart(req: RestartRequest, background: BackgroundTasks, actor: str = Depends(require_ops_key), db: Session = Depends(database.get_db)):
    pm2_name = _resolve_process(req.process)
    write_audit_sync(db, actor, "ops.restart", {"process": req.process})
    # Backgrounded: if we're restarting our own process (api / all), running
    # it inline would kill this request before the response goes out.
    background.add_task(_do_restart, pm2_name)
    return {"status": "restart queued", "process": req.process}


@router.post("/migrate")
def ops_migrate(actor: str = Depends(require_ops_key), db: Session = Depends(database.get_db)):
    write_audit_sync(db, actor, "ops.migrate", {})
    try:
        result = subprocess.run(
            ["python3", "run_migration.py"], cwd=BACKEND_DIR,
            capture_output=True, text=True, timeout=120,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"migration failed to run: {exc}")
    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=result.stderr or result.stdout)
    return {"status": "migration complete", "output": result.stdout}
