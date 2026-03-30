# Amber's Angels

A real-time drone surveillance platform for missing persons and Amber Alert response. Drones stream live video to the server, frames are processed for license plate recognition, and hits are cross-referenced against an active watchlist. Alert vehicles trigger immediate Discord notifications and are logged for audit review.

---

## What it does

- Ingests live drone video over RTMP
- Extracts frames and runs OpenALPR license plate recognition
- Fuzzy-matches detected plates against a watchlist (91%+ similarity threshold)
- Fires Discord alerts on watchlist hits
- Polls FEMA IPAWS for national Amber Alerts — extracts suspect plates, adds them to the watchlist, and notifies pilots even when no plate is listed
- Saves alert frame captures to `golden_frames/` for audit trail
- Displays everything on a live mission dashboard: drone position, flight trail, event feed with thumbnails

---

## Architecture

```
Drone (RTMP stream)
       |
       v
  Nginx RTMP  --> FFmpeg frame extraction
                         |
                         v
               worker/unified_worker.py     <- watches frames dir, runs ALPR
                         |
              +----------+----------+
              v                     v
       POST /detections        POST /events
              |
              v
     backend/main.py (FastAPI)
              |
       +------+------------------+
       |                         |
       v                         v
  PostgreSQL DB           Discord Webhook
       |
       v
  web/ (Next.js dashboard)
```

---

## Repo layout

```
ambers-angels/
├── backend/
│   ├── main.py                  # FastAPI app, lifespan, static mounts
│   ├── database.py              # Async + sync SQLAlchemy sessions
│   ├── event_repository.py      # DB reads/writes for detection events
│   ├── event_service.py         # Alert evaluation, watchlist matching
│   ├── schemas.py               # Pydantic models
│   ├── schema.sql               # PostgreSQL schema
│   ├── recover_anomalies.py     # Re-scan stored frames through ALPR
│   ├── routers/
│   │   └── read_api.py          # GET endpoints for the dashboard
│   └── services/
│       └── fema_connector.py    # FEMA IPAWS Amber Alert polling
│
├── worker/
│   └── unified_worker.py        # Frame watcher + ALPR + alert pipeline
│
├── web/                         # Next.js 16 dashboard (served by PM2)
│   └── src/
│       ├── app/map/             # Mission map page
│       ├── components/          # Map, event feed, sidebar, top bar
│       └── features/            # TanStack Query hooks for API data
│
├── start_all.sh                 # Launch everything (sources .env)
├── stop_all.sh                  # Tear everything down
└── harvest_stream.sh            # FFmpeg RTMP -> frame extraction
```

---

## Setup

### Prerequisites

- Ubuntu server with PostgreSQL, Nginx (with RTMP module), Node.js, PM2
- OpenALPR Python bindings at `/usr/lib/python2.7/dist-packages/openalpr`
- Python 3.10+

### 1. Clone and configure

```bash
git clone git@github.com:grantl12/ambers-angels.git
cd ambers-angels
```

Create a `.env` file in the project root (never committed):

```
ALERT_WEBHOOK_URL="https://discord.com/api/webhooks/YOUR_WEBHOOK_HERE"
DATABASE_URL="postgresql+asyncpg://postgres:YOUR_PASSWORD@127.0.0.1:5432/ambersangels"
```

### 2. Backend dependencies

```bash
pip3 install -r backend/requirements.txt
```

### 3. Frontend dependencies

```bash
cd web
npm install
npm run build
```

Create `web/.env.local` (never committed):

```
NEXT_PUBLIC_APP_NAME=Amber's Angels
NEXT_PUBLIC_MAPBOX_TOKEN=YOUR_MAPBOX_PUBLIC_TOKEN_HERE
NEXT_PUBLIC_API_BASE_URL=http://YOUR_SERVER_IP:8000
```

### 4. Database

```bash
psql -U postgres ambersangels < backend/schema.sql
```

### 5. Launch

```bash
./start_all.sh
```

This starts:
- `aa-backend` — FastAPI on port 8000
- `aa-worker` — frame watcher and ALPR processor
- `aa-feed` — FFmpeg RTMP harvester (if `harvest_stream.sh` exists)
- `ambers-angels-web` — Next.js dashboard via PM2 on port 3000

---

## Dashboard

| Route | Description |
|---|---|
| `/map` | Live mission map |
| `:8000/health` | Backend health check |
| `:8000/fema/test` | Manually trigger FEMA poll |
| `:8000/detections/feed` | Raw detections JSON |

---

## Testing the pipeline

Drop a known frame into the watch directory and the worker processes it automatically:

```bash
cp backend/test_plates/golden_frames/alert_YVJ02_frame_107.jpg backend/test_plates/
```

Watch the worker log:

```bash
tmux attach -t aa-worker
```

---

## Session management

```bash
tmux attach -t aa-backend    # FastAPI logs
tmux attach -t aa-worker     # ALPR worker logs
tmux attach -t aa-feed       # RTMP harvester logs
pm2 logs ambers-angels-web   # Next.js logs
```

---

## Notes

- Secrets are never committed. Credentials live in `.env` (backend) and `web/.env.local` (frontend).
- Alert frame captures are saved to `backend/test_plates/golden_frames/` with the plate number in the filename.
- The FEMA connector polls IPAWS every 5 minutes and notifies pilots of any active Amber Alert, even when no plate number is present in the alert text.
