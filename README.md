# Amber's Angels

Real-time drone surveillance platform for missing persons and Amber Alert response. Drones stream live video to the server, frames are processed for license plate recognition and vehicle identification, and hits are cross-referenced against an active watchlist derived from both manual entries and live FEMA IPAWS alerts. Suspect vehicles trigger immediate Discord notifications and are logged with frame captures for audit review.

---

## Features

### License Plate Recognition
- Ingests live drone video over RTMP
- Extracts frames with FFmpeg and processes them through OpenALPR
- Fuzzy plate matching against the watchlist (91%+ similarity threshold handles partial reads)
- High-confidence detections are enriched via the **Plate Recognizer Snapshot API** (free-tier aware: 2,500 lookups/month)
- Frame captures saved to `golden_frames/` as an evidence audit trail

### Vehicle Identification
- **YOLOv8** detects vehicle presence and classifies body type (car, truck, motorcycle, bus)
- Dominant color extraction from bounding box in HSV space
- Hybrid pipeline: OpenALPR for plates, YOLO + Plate Recognizer for vehicle attributes
- Full vehicle description (color, make, model, type) attached to every detection

### FEMA IPAWS Alert Monitoring
Polls the FEMA public IPAWS feed every 5 minutes and monitors all national missing/endangered person alert programs:

| Program | Description |
|---|---|
| **AMBER / Levi's Call** | Child abduction (CAE) |
| **Mattie's Call** | Missing at-risk adult |
| **Silver Alert** | Missing senior |
| **Purple Alert** | Missing person with developmental disability |
| **Blue Alert** | Threat to or missing law enforcement officer |
| **MIPA** | Missing Indigenous Person Alert |
| **EMA** | Endangered Missing Advisory |

- Extracts suspect plate numbers from CAP XML and adds them to the watchlist automatically
- Notifies pilots via Discord even when the alert contains no plate — just a description
- Deduplicated: each alert ID is only ingested once

### Mission Map
Live Mapbox dark-mode map showing the full operational picture:
- **Drone markers** — real-time positions with animated pulse ring; click a drone in the sidebar to fly the map to it
- **Flight trail** — last 30 telemetry points rendered as a polyline
- **Detection markers** — amber dots for detections, red for watchlist hits; click to see plate, vehicle info, confidence, and status
- **Detection heatmap** — density layer showing where activity is concentrated
- **Flock ALPR cameras** — fixed camera positions with oriented road-strip coverage polygons showing the direction each camera watches
- **Click-to-fly** — clicking any detection in the event feed or sidebar flies the map to that GPS coordinate
- **Layer toggles** — independently toggle drones, flight trail, Flock cameras, coverage polygons, heatmap, and detection markers

### Event Feed
Right-side panel with a live-updating stream of every detection:
- Thumbnail image for alert vehicle detections
- AMBER / Mattie's / Silver / Purple / Blue / MIPA / EMA badge per event type
- Vehicle description, plate, confidence, drone ID, and GPS flag
- Click any detection with GPS to fly the map to it

### Mission Sidebar
Left panel with full situational awareness:
- Active mission name, start time, and live stats
- Drone list with altitude, heading, and speed — click any drone to fly the map to it
- Watchlist hits panel — click any hit with GPS to fly the map to that location

### Alerts & Notifications
- **Discord webhooks** — instant notification on any watchlist plate match or new FEMA alert
- **Browser push notifications** — toggle in Settings (requests OS permission)
- **Sound alerts** — separate toggles for watchlist hits, FEMA alerts, and AMBER-specific alerts

### User Settings
- Display name / callsign (shown in the top bar, no account required)
- Per-category notification toggles, persisted in `localStorage`
- Accessible from the account dropdown in the top bar

### Native App (Phase 1 — in development)
Expo (bare workflow) + TypeScript + EAS Build for cloud iOS compilation (no Mac required):
- Phone camera capture at configurable interval → `POST /ingest/frame`
- GPS telemetry at ~1 Hz → `POST /telemetry`
- Plate detections with lat/lng/altitude/heading → `POST /detections/`
- Map tab, Feed tab, Settings tab
- Phase 2: DJI MSDK v5 bindings for Mavic 3, Mini 4 Pro, Air 3, Autel EVO II

### Pilot Portal
Static registration page (`/pilot/`) for onboarding drone operators to a mission.

---

## Architecture

```
Drone (RTMP stream)
       |
       v
  Nginx RTMP --> FFmpeg frame extraction
                        |
                        v
             worker/unified_worker.py      ← watches frames dir
                        |
            +-----------+-----------+
            v                       v
      OpenALPR (local)    YOLOv8 + Plate Recognizer
            |                       |
            +----------+------------+
                       v
             AggregationService
                       |
              +--------+--------+
              v                 v
       POST /detections    POST /events
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

  FEMA IPAWS poller (async background task)
       |
       v
  Watchlist DB + Discord pilot alert
```

---

## Repo layout

```
ambers-angels/
├── backend/
│   ├── main.py                   # FastAPI app, lifespan, ingestion endpoints
│   ├── database.py               # Async + sync SQLAlchemy sessions
│   ├── event_repository.py       # DB reads/writes for detection events
│   ├── schemas.py                # Pydantic models
│   ├── schema.sql                # PostgreSQL schema
│   ├── recover_anomalies.py      # Re-scan stored frames through ALPR
│   ├── routers/
│   │   └── read_api.py           # GET endpoints for the dashboard
│   └── services/
│       ├── fema_connector.py     # FEMA IPAWS alert poller
│       ├── aggregation_service.py# Wires ALPR + YOLO + Plate Recognizer
│       ├── detection_pipeline.py # Frame-level detection orchestration
│       ├── vehicle_classifier.py # YOLOv8 body type + color extraction
│       ├── plate_recognizer.py   # Plate Recognizer API wrapper
│       ├── event_service.py      # Alert evaluation, watchlist matching
│       └── alert_dispatcher.py   # Discord webhook dispatch
│
├── worker/
│   └── unified_worker.py         # Frame watcher + ALPR processor
│
├── web/                          # Next.js dashboard (served by PM2)
│   └── src/
│       ├── app/
│       │   ├── map/              # Mission map page
│       │   └── settings/         # User settings + notification toggles
│       ├── components/
│       │   ├── map/              # MissionMap, MapLoader
│       │   ├── layout/           # TopBar with username dropdown
│       │   └── mission/          # EventFeed, MissionSidebar
│       └── features/             # TanStack Query hooks (detections, telemetry, flock, missions)
│
├── pilot/                        # Pilot registration portal (static HTML)
├── start_all.sh                  # Launch everything (sources .env)
├── stop_all.sh                   # Tear everything down
└── harvest_stream.sh             # FFmpeg RTMP → frame extraction
```

---

## Setup

### Prerequisites

- Ubuntu server with PostgreSQL, Nginx (with RTMP module), Node.js 18+, PM2
- Python 3.10+
- OpenALPR Python bindings

### 1. Clone and configure

```bash
git clone git@github.com:grantl12/ambers-angels.git
cd ambers-angels
```

Create `backend/.env` (never committed):

```env
DATABASE_URL=postgresql+asyncpg://postgres:YOUR_PASSWORD@127.0.0.1:5432/ambersangels
ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK
PLATE_RECOGNIZER_TOKEN=your_token_here        # optional — enrichment only
FEMA_POLL_INTERVAL=300                         # seconds between IPAWS polls
FEMA_LOOKBACK_MINUTES=60
```

### 2. Backend

```bash
pip3 install -r backend/requirements.txt
```

### 3. Frontend

```bash
cd web
npm install
npm run build
```

Create `web/.env.local` (never committed):

```env
NEXT_PUBLIC_APP_NAME=Amber's Angels
NEXT_PUBLIC_MAPBOX_TOKEN=your_mapbox_public_token
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

Starts:
- `aa-backend` — FastAPI on port 8000
- `aa-worker` — frame watcher and ALPR processor
- `aa-feed` — FFmpeg RTMP harvester
- `ambers-angels-web` — Next.js dashboard on port 3000

---

## Routes

| Route | Description |
|---|---|
| `/map` | Live mission map dashboard |
| `/settings` | User settings and notification preferences |
| `/pilot/` | Pilot registration portal |
| `:8000/health` | Backend health check |
| `:8000/fema/test` | Manually trigger a FEMA poll |
| `:8000/detections/feed` | Raw detections JSON |
| `:8000/telemetry/latest` | Current drone positions |

---

## Testing the pipeline

Drop a known frame into the watch directory — the worker processes it automatically:

```bash
cp backend/test_plates/golden_frames/alert_YVJ02_frame_107.jpg backend/test_plates/
```

Watch the worker:

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

## Security note

Secrets are never committed. All credentials live in `backend/.env` and `web/.env.local`. The backend has no authentication layer yet — deploy behind a firewall or VPN until auth is added.
