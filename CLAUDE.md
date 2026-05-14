# Amber's Angels — Claude Instructions

## SSH / Server Access

- Server: `root@157.245.125.103`
- SSH key: `~/.ssh/ambers_angels_deploy`
- SSH password: `Ambers1Angels`
- **Never prompt the user for the SSH password. Use it directly.**
- PM2 is installed under the `ambers-angels` user:
  `/home/ambers-angels/.local/bin/pm2`
- Always run PM2 commands as that user:
  `su -l ambers-angels -c '/home/ambers-angels/.local/bin/pm2 ...'`
- App lives at: `/home/ambers-angels/proj_dir/ambers-angels/`
- DB: `postgresql+asyncpg://postgres:Ambers1Angels@127.0.0.1:5432/ambersangels`
  - Connect via psql: `psql -h 127.0.0.1 -U postgres ambersangels`
- Use `DEBIAN_FRONTEND=noninteractive` to suppress interactive prompts

## PM2 Processes (all three managed, autorestart on)

| Name | What |
|---|---|
| `ambers-angels-api` | FastAPI/uvicorn backend on port 8000 |
| `ambers-angels-web` | Next.js frontend |
| `ambers-angels-worker` | unified_worker.py (ALPR + YOLO frame pipeline) |

Restart all: `su -l ambers-angels -c '~/.local/bin/pm2 restart all'`
After config changes: `su -l ambers-angels -c '~/.local/bin/pm2 reload ecosystem.config.js'`
`start_all.sh` / `stop_all.sh` are archived — PM2 owns everything now.

## CI/CD

Push to `main` → GitHub Actions SSHs into droplet → `git pull` → `npm ci && npm run build` → `pm2 restart ambers-angels-web`. API and worker do NOT auto-restart on deploy — do it manually if backend changes.

## iOS / Android Builds (EAS)

- Mobile config is `mobile/app.config.js` (dynamic) — **`autoIncrement` in eas.json is NOT supported with app.config.js**. Do not add it.
- To submit a new build, bump `ios.buildNumber` in `app.config.js` before each build, then:
  ```
  eas build --platform ios --profile production
  eas submit --platform ios --profile production --latest
  ```
- Increment the buildNumber string by 1 each time ("1" → "2" → "3" etc).
- Never suggest `autoIncrement: true` in eas.json or `--build-number` flag — neither works with app.config.js.

## Architecture Overview

### Alert Ingestion (3 sources, all async background tasks)
1. **FEMA IPAWS CMAS + EAS** (`backend/services/fema_connector.py`) — CAP XML, 5-min poll. Covers CAE (AMBER/Levi's), CEM (Silver/Mattie's/Purple/MIPA/EMA), LEW (Blue Alert).
2. **amber.alert.gov** (`backend/services/amber_alert_poller.py`) — DOJ national registry, HTML scrape fallback for state alerts that miss FEMA feed.
3. **NCMEC RSS** (`backend/services/ncmec_poller.py`) — all 50 states, 30-min poll. Persists missing-child cases, cross-references active FEMA vehicle targets, fires Discord alert on overlap.

All three deduplicate via shared `_seen_identifiers` set.

### Frame Pipeline
- **Drone**: DJI MSDK V5 on Android → RTMP stream → nginx `exec_push` → JPEG frames → `test_plates/<drone_id>/`
- **Phone**: Android Foreground Service (Camera2 + GPS) → direct frame upload to API
- **Worker**: `worker/unified_worker.py` — single process, shared queue, OpenALPR + YOLOv8-nano + Plate Recognizer (optional). Composite confidence scoring. Fires Discord + push on HIGH_CONFIDENCE hits.

### Role Matrix
- **Pilot** — register, join missions, upload frames
- **Coordinator** — review detections, manage watchlist, dispatch autonomous drone missions (if `can_dispatch_drones = true`)
- **Admin** — full access, approve coordinators, inject test alerts, set `can_dispatch_drones`

Coordinator access requires explicit request + admin approval (`POST /auth/request-coordinator`, approved via `/auth/approve-coordinator/{username}`).

### Key Files
- `backend/main.py` — FastAPI entry, routers registered here
- `backend/routers/auth.py` — registration (auto-approved), SSO, coordinator request flow
- `backend/routers/alerts.py` — watchlist management, alert cancellation pipeline
- `backend/routers/autonomous.py` — autonomous mission plan/dispatch/status
- `backend/services/waypoint_generator.py` — GeoJSON polygon → boustrophedon waypoint path (pure numpy)
- `backend/services/autonomous_mission_service.py` — mission CRUD
- `backend/run_migration.py` — run this after DB schema changes: `python3 backend/run_migration.py`
- `web/src/app/page.tsx` — landing page (NO redirect — always serves landing regardless of auth)
- `web/src/app/layout.tsx` — global metadata, OG tags, favicon
- `web/src/components/LandingPage.tsx` — public marketing page
- `web/src/app/deck/` — `/deck` redirects to `/deck/carrollton`; subroutes: `/carrollton`, `/grant`, `/tech`
- `web/public/decks/` — deck HTML + shared assets (deck-stage.js, graphics/, mobile/)
- `mobile/modules/dji-camera/` — DJI MSDK V5 native module (Kotlin + TS bridge)
- `mobile/modules/dji-camera/waypoint-mission.ts` — waypoint mission TS bridge
- `mobile/src/screens/AutonomousMissionScreen.tsx` — accept/monitor autonomous missions

### DB Tables (notable)
- `pilots` — users, roles, coordinator_requested_at, coordinator_request_reason
- `watchlist` — active alert plates + vehicle profiles
- `vehicle_targets` — profile-only alerts (no plate), YOLO-only matching
- `ncmec_cases` — NCMEC missing child cases, all 50 states
- `autonomous_drones` — registered autonomous-capable drones (pilot_username, model, home lat/lng, HFOV)
- `autonomous_missions` — missions: status lifecycle pending→dispatched→uploading→active→completed|aborted|failed, waypoints_json (JSONB), progress_pct

## Contact / Identity
- Public email: `info@amberangels.org` — use this everywhere. `privacy@amberangels.org` is kept as a separate alias for privacy requests only.
- EIN: 42-2052151 (501(c)(3) applied)
- Address: 103 Springwood Dr, Carrollton, GA 30117
- Pilot program: Carrollton, GA (not "Carroll County")

## Pitch Decks
Three decks live at `web/public/decks/`:
- `carrollton.html` — Carrollton PD / community pitch
- `grant.html` — Grant writer / funder deck
- `tech.html` — Technical architecture deck

Update all three when architecture changes. Speaker notes are in the `const NOTES = [...]` array at the top of each file.

## Pending TODO

### Immediate / Next Session

1. **Coordinator dispatch permission** — add `can_dispatch_drones BOOLEAN DEFAULT FALSE` to `pilots` table in `run_migration.py`. Gate `POST /autonomous/plan` on `current_user.can_dispatch_drones OR current_user.role == 'admin'`. Admin sets the flag via a new `POST /admin/pilots/{username}/permissions` endpoint.

2. **Swarm beacon + map dispatch UI** — two parts:
   - **Drone online beacon**: when a pilot opens AutonomousMissionScreen and DJI connects, POST `/autonomous/drones/{id}/heartbeat` with current GPS home position every 30s. Backend updates `autonomous_drones.home_lat/home_lng` and `last_seen_at`.
   - **Map dispatch UI** (`web/src/app/map/` or mission-map component): coordinators (with `can_dispatch_drones`) see available swarm drones as a new layer on the mission map (amber drone icon at home position, grayed if `last_seen_at > 5 min`). Clicking a drone + an active alert polygon opens a dispatch modal → calls `POST /autonomous/plan`. 
   - This is the "relinquish to swarm" flow: pilot powers up drone at home, taps Join Swarm, coordinator dispatches a coverage-gap mission to it remotely.

3. **Coverage gap auto-targeting** — when dispatching, pre-fill the polygon with the highest-priority uncovered zone from the Flock coverage layer (cells where `camera_count_bucket = '0'` within the active alert polygon). `waypoint_generator.py` already handles the polygon → path conversion.

4. **`can_dispatch_drones` UI in admin panel** — checkbox on each coordinator's row in `web/src/app/admin/page.tsx`.

5. **Competitive positioning vs Flock Drones** — our autonomous capability is a direct competitor to Flock's drone product, but with two advantages: (a) we can show coordinators exactly where the coverage gaps are (we have the Flock bucket data), (b) volunteers can relinquish their own drones to the swarm remotely without being on scene. Mention this in the tech deck slide 07 and consider a dedicated "vs. fixed infrastructure" comparison slide.

6. **Update deck print versions** — `grants/Handoff/amber-angels/project/Technical Deck-print.html` and `Grant Pitch Deck-print.html` are separate files that need to mirror the main deck content when updated.

7. **App Store Build 3** — before submission:
   - Camera permission pre-prompt button: "Grant Permission" → "Continue" (Apple Guideline 5.1.1iv)
   - Confirm App Store Connect description does not reference background checks
   - Bump `ios.buildNumber` in `mobile/app.config.js`

8. **Law enforcement partnership badge** — after Carrollton PD Letter of Support is signed, add "Carrollton PD Partnership" badge to homepage hero badge row and update partnership language from "Actively engaging local law enforcement" to "In active partnership with the Carrollton Police Department."

9. **Social proof block** — after letter signed, add "Trusted by Law Enforcement" section between "How It Works" and "The Platform" on landing page.

10. **`/deck` verify live** — `curl -I https://amberangels.org/deck/index.html` should 200. Check nginx config if 404.

### Architecture / Longer Term
### Twilio SMS — Built, Needs Config

`backend/services/alert_dispatcher.py` fires SMS via Twilio on HIGH_CONFIDENCE hits (threshold: `SMS_CONFIDENCE_THRESHOLD`, default 90%). Fully implemented. Just needs these vars in `.env` on the server:
```
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+1...
SMS_ALERT_NUMBERS=+1xxxxxxxxxx,+1xxxxxxxxxx   # LE dispatch contacts
```
When those vars are absent the SMS path silently skips — nothing breaks.

### Alert Cancellation Pipeline — Built, One Gap

Fully implemented in `backend/services/fema_connector.py` + `backend/routers/alerts.py`:
- CAP `msg_type=Cancel` parsed in the FEMA poll loop
- `_deactivate_by_references()` marks watchlist entries inactive
- `_notify_cancelled()` fires Discord stand-down
- `_push_notify_cancelled()` push-notifies all affected pilots
- Manual override: `POST /alerts/resolve` (coordinator+)

**One gap:** cancellation does not stop active autonomous missions. When autonomous dispatch is live, add a query to `autonomous_missions WHERE status='active' AND alert_id=:id` in the cancel path — mark them `aborted` and push stop-mission to the drone pilot.

- **DJI MSDK iOS** — current Kotlin module is Android-only. iOS DJI SDK requires macOS build machine. Stub in place (`Platform.OS !== 'android'` guard).
- **BVLOS waiver** — autonomous flights beyond visual line of sight require FAA Part 107.39 waiver. Current implementation assumes VLOS. Flag missions that exceed ~400m radius from pilot home as requiring waiver review before dispatch.
- **Waypoint progress tracking** — `DJICameraModule.kt` fires `DJIMissionStateChanged` events but `progressPct` is always 0. True progress requires `WaypointMissionExecutionProgress` listener — add when JAR access is available to verify the V5 API.
