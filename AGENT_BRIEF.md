# Amber's Angels — Detection Agent Brief

## What's Built and Working

- FastAPI backend on DigitalOcean droplet (PM2: `ambers-angels-api`)
- `unified_worker.py` (PM2: `ambers-angels-worker`): OpenALPR + YOLOv8 reads frames from RTMP streams, POSTs to `POST /detections/` with `X-Internal-Key`
- `rtmp_monitor.py` (PM2: `ambers-angels-rtmp-monitor`): polls nginx RTMP stat every 5s, spawns/kills ffmpeg per stream — self-healing, deployed 2026-06-07
- `AggregationService`: 5-second window, needs 3+ frames at 85%+ confidence to classify HIGH_CONFIDENCE → triggers Discord + Expo push
- `EventService`: fuzzy-matches plate to active watchlist (FEMA AMBER/Silver/Blue alerts), applies vehicle profile mismatch penalties, enforces 2-min cooldown
- RTMP E2E confirmed 2026-06-07: DJI Avata → 99% peak confidence, 193 alerted events, Discord + phone push working

## The Problem With Static Thresholds

The pipeline today uses hard numbers (85% confidence, ≥3 frames, exact/fuzzy plate match). It can't reason across signals: a 70% plate read on a white sedan 0.3mi from an active AMBER alert polygon means something very different than a 70% read in an empty parking lot. Rules can't combine these; an agent can.

## The Ask — Build a Detection Agent

A new PM2 process (`ambers-angels-agent`, `worker/detection_agent.py`) using the Anthropic Python SDK that:

### 1. Intercepts PROBABLE Events
Confidence 75–85%, not yet HIGH_CONFIDENCE — events the threshold pipeline would dismiss. Agent evaluates them with full context via Claude tool use and can escalate to alert or dismiss.

### 2. Tools the Agent Needs

| Tool | Endpoint / Source | Purpose |
|---|---|---|
| `get_active_alerts()` | `GET /fema/alerts` | Active AMBER/Silver/Blue alert vehicle profiles: plate, color, type, area polygon |
| `get_recent_detections(plate, minutes)` | `GET /detections/feed` | Detection history: frequency, confidence trend, drone source |
| `get_vehicle_context(detection_id)` | Detection event record | YOLO color/type/make from aggregated snapshot |
| `dispatch_alert(plate, confidence, reasoning, drone_id)` | `AlertDispatcher` directly or internal endpoint | Fire Discord embed + Expo push with agent's reasoning included |
| `reposition_drone(drone_id, obs_lat, obs_lon)` | `POST /autonomous/plan` | Command drone closer for a better read on low-confidence plate |

### 3. Model Choice

- **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) for inline decisions — fast and cheap
- Reserve Sonnet for complex multi-drone scenarios or when multiple conflicting signals need reconciliation

### 4. Integration Point

After `AggregationService.ingest()` returns a snapshot, if classification is `PROBABLE` (not `HIGH_CONFIDENCE`), instead of dismissing, hand it to the agent. Agent runs as an **async background task** so it doesn't block the API response. If the agent decides to escalate, it calls `AlertDispatcher` directly.

### 5. Intel AI Super Builder

Evaluate for **edge inference** — running plate recognition or vehicle classification on drone hardware before frames ever hit the server. Not v1, but the agent architecture should leave a hook for it (agent could issue "request on-device inference" as a tool call result that the mobile app or drone SDK acts on).

## Key Files

**Backend**
- `backend/services/aggregation_service.py` — thresholds, `EventClassification` enum, `PROBABLE_EVENT_MIN_SCORE = 75.0`, `HIGH_CONFIDENCE_EVENT_MIN_SCORE = 85.0`
- `backend/services/event_service.py` — `upsert_from_snapshot()`, where to hook the agent call
- `backend/services/alert_dispatcher.py` — `dispatch_alert()`, Discord + Expo push, reuse directly from agent
- `backend/main.py` — `create_detection` endpoint, `_aggregation_service` and `_alert_dispatcher` singletons, `FRAMES_ROOT`, `GOLDEN_DIR`
- `backend/routers/autonomous.py` — `POST /autonomous/plan` for drone repositioning tool

**Worker**
- `worker/unified_worker.py` — OpenALPR + YOLO, posts to `/detections/` with X-Internal-Key
- `worker/rtmp_monitor.py` — ffmpeg lifecycle manager, potential home for stream-level agent logic (adaptive frame rate, stream quality assessment)

**New file to create**
- `worker/detection_agent.py` — the agent process

## Server Access

```
plink -pw '$SSH_PW' -batch -hostkey 'ssh-ed25519 255 66:68:d4:a3:02:92:82:25:c3:27:96:9f:ef:34:2d:6b' root@157.245.125.103 'COMMAND'
```

- Credentials: see `server_credentials.md` in Claude memory — never hardcode
- App root: `/home/ambers-angels/proj_dir/ambers-angels/`
- PM2 user: `ambers-angels` — prefix PM2 commands with `su -l ambers-angels -c '...'`
- PM2 binary: `/home/ambers-angels/.local/bin/pm2`
- DB: connection string in server `.env` (`DATABASE_URL`)
- Deploy: `git push origin main` → GitHub Actions CI/CD (`.github/workflows/deploy.yml`)

## Env Var Needed

Add `ANTHROPIC_API_KEY` to `/home/ambers-angels/proj_dir/ambers-angels/.env` on the server before starting the agent process.

## Architecture Decision to Nail First

Two open questions before writing code:

1. **Async vs sync integration into `event_service`:** Recommended — async background task called from `event_service.upsert_from_snapshot()` when snapshot classification is PROBABLE. Keeps API response time unchanged while agent evaluates in parallel.

2. **Polling vs inline:** Inline (called from event_service) is preferable to a polling loop — lower latency, no missed events, no separate state tracking. The agent process itself can be a lightweight asyncio loop that receives work via an in-process queue if needed.

## Example Reasoning the Agent Should Perform

> "Plate YVJ024 read at 78% confidence (below HIGH_CONFIDENCE threshold). Active AMBER alert in Carroll County GA for a white sedan, plate YVJ024. YOLO detected white sedan. Detection is 0.2mi from alert polygon centroid. Plate read 4 times in the last 8 seconds with consistent reads. **Escalating to HIGH_CONFIDENCE alert.** Commanding drone to reduce altitude by 20m for confirmation read."

Rules cannot produce this — it requires combining plate similarity, vehicle profile match, geographic proximity, temporal consistency, and a repositioning decision in a single inference.
