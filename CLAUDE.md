# Amber's Angels — Claude Instructions

## SSH / Server Access

**The deploy key is broken. Always use plink. Never prompt the user for the password.**

```
plink -pw 'Ambers1Angels' -batch -hostkey 'ssh-ed25519 255 66:68:d4:a3:02:92:82:25:c3:27:96:9f:ef:34:2d:6b' root@157.245.125.103 'COMMAND'
```

- Server: `root@157.245.125.103`
- SSH password: `Ambers1Angels` — use directly in every plink call, never ask the user
- plink binary: `/c/Program Files/PuTTY/plink` (Windows host)
- PM2 user: `ambers-angels` — always prefix PM2 commands with `su -l ambers-angels -c '...'`
- PM2 binary: `/home/ambers-angels/.local/bin/pm2`
- App root: `/home/ambers-angels/proj_dir/ambers-angels/`
- DB: `postgresql+asyncpg://postgres:Ambers1Angels@127.0.0.1:5432/ambersangels`
  - psql: `psql -h 127.0.0.1 -U postgres ambersangels`
- Use `DEBIAN_FRONTEND=noninteractive` to suppress interactive prompts

## PM2 Processes

| Name | What |
|---|---|
| `ambers-angels-api` | FastAPI/uvicorn backend on port 8000 |
| `ambers-angels-web` | Next.js frontend |
| `ambers-angels-worker` | unified_worker.py (ALPR + YOLO frame pipeline) |

Restart all with env reload:
```
su -l ambers-angels -c '/home/ambers-angels/.local/bin/pm2 restart all --update-env'
```

Restart one process:
```
su -l ambers-angels -c '/home/ambers-angels/.local/bin/pm2 restart ambers-angels-api --update-env'
```

`start_all.sh` / `stop_all.sh` are archived — PM2 owns everything.

## CI/CD

Push to `main` → GitHub Actions (`.github/workflows/deploy.yml`) SSHs into droplet as `ambers-angels` and:
1. `git pull origin main`
2. Installs/configures PM2 log rotation (50 MB cap, 7-day retain) — idempotent
3. `python3 backend/run_migration.py` — idempotent, safe to run every deploy
4. Rebuilds Next.js frontend (`sudo rm -rf .next node_modules && npm ci && npm run build`)
5. `pm2 restart ambers-angels-web ambers-angels-api ambers-angels-worker --update-env`

**All three processes restart on every push to `main`.** No manual SSH needed for routine deploys.

Manual migration without full deploy — trigger via GitHub Actions UI:
`.github/workflows/migrate.yml` → "Run workflow" button in the Actions tab.

## iOS / Android Builds (EAS)

- Mobile config is `mobile/app.config.js` (dynamic)
- **`autoIncrement` in eas.json is NOT supported with app.config.js** — never add it
- **`--build-number` flag does not work with app.config.js** — never use it
- Before each build: bump `ios.buildNumber` in `app.config.js` ("3" → "4" → "5" etc.)
- Current build number: **4** (submitted for App Store review)

Build and submit:
```
cd mobile
eas build --platform ios --profile production
eas submit --platform ios --profile production --latest
```

## App Store Status

- Build 4 submitted, under review
- Rejection history and resolutions:
  - **5.1.1(iv)**: Camera permission pre-prompt button text changed to "Continue"
  - **5.1.1(v)**: Account deletion added (`DELETE /auth/delete-account`). UI in Settings → bottom → "Delete Account" (two-tap confirm). Tell reviewers: *"Account deletion: Settings tab → scroll to bottom → Delete Account."*
  - **2.1 (law enforcement)**: Apple flags "report criminal activity" language. **Do not use that framing.** The app responds to existing government-issued FEMA alerts, it does not enable users to report crimes. Use: *"participate in active public safety searches," "respond to government-issued AMBER/Silver Alerts,"* not *"report criminal activity"* or *"alert law enforcement."* Submit CPD meeting screenshot as documentation while formal letter is pending.

## Architecture Overview

### Alert Ingestion (3 active sources + 1 disabled)

1. **FEMA IPAWS CMAS** (`backend/services/fema_connector.py`) — CAP XML, 5-min poll via `fema_background_loop()`. Covers:
   - CAE → AMBER Alert / Levi's Call (child abduction)
   - CEM → Mattie's Call, Silver Alert, Purple Alert, MIPA, EMA (keyword-classified)
   - LEW → Blue Alert (missing/endangered LE officer)
   - Extracts plates + vehicle profiles, adds to `watchlist` + `vehicle_targets`, fires Discord + push
   - Cancellation: CAP `msg_type=Cancel` deactivates watchlist entries, fires Discord stand-down
   - **Dedup is DB-backed** via `processed_alerts` table — survives PM2 restarts. Loaded into `_seen_identifiers` set on startup via `_load_seen_identifiers()`.

2. **FEMA IPAWS EAS** (`backend/services/amber_alert_poller.py`) — same CAP XML format as CMAS but via the EAS endpoint. Runs in `amber_background_loop()` every 2 min. Shares `_seen_identifiers` with fema_connector.

3. **NWS Alerts API** (`backend/services/amber_alert_poller.py`) — `api.weather.gov/alerts/active` — catches WEA-distributed AMBER alerts that bypass the FEMA CMAS public feed (e.g. Georgia). Polled each `amber_background_loop` cycle. `NWS_EVENT_MAP` maps NWS event names to ALERT_REGISTRY keys.

4. ~~**amber.alert.gov**~~ — **DISABLED**. Hostname has no DNS record. `AMBER_GOV_URLS = []` in amber_alert_poller.py.

5. **NCMEC RSS** (`backend/services/ncmec_poller.py`) — all 50 US states, 30-min poll.
   - Persists missing-child cases in `ncmec_cases` table
   - **New cases**: Discord notification fires ONLY when there is an active FEMA vehicle target in the same state (cross-reference). No target = no notification, because volunteers cannot act on a missing-person case without a vehicle to search for.
   - **Resolved cases**: Always fires Discord "possibly resolved" notification
   - Initial state loaded from DB on startup (`_load_initial_state`) so restarts don't re-fire old resolutions

### Frame Pipeline

- **Drone (RTMP)**: DJI MSDK V5 on Android → RTMP stream → nginx `exec_push` → JPEG frames saved to `test_plates/<drone_id>/` → `unified_worker.py` picks them up
- **Phone/DJI App (direct upload)**: `POST /ingest/frame` — pilot JWT required, 25 MB limit, image content-type enforced, runs ALPR + YOLO server-side
- **Worker** (`worker/unified_worker.py`): scans frame directories, runs OpenALPR + YOLOv8-nano + optional Plate Recognizer, posts to `POST /detections/` with `X-Internal-Key` header

### Confidence Scoring

Detection pipeline uses composite scoring:
- OpenALPR confidence
- Plate Recognizer cloud API (only called when ALPR confidence ≥ threshold)
- YOLO vehicle classification (color, body type, make/model via CDC)
- 5-second aggregation window via `AggregationService`
- HIGH_CONFIDENCE threshold triggers Discord alert + optional SMS (Twilio)

### Role Matrix

| Role | Can do |
|---|---|
| **Pilot** | Register, upload frames, join missions, view detections |
| **Coordinator** | All pilot actions + review detections, manage watchlist, dispatch drones (if `can_dispatch_drones = true`) |
| **Admin** | Everything + approve users, set roles, set `can_dispatch_drones`, inject test alerts |

Coordinator access: pilot requests via `POST /auth/request-coordinator` → admin approves via `POST /auth/approve-coordinator/{username}`.
Dispatch permission: admin sets via `POST /auth/admin/pilots/{username}/permissions` with `{"can_dispatch_drones": true}`.

### Autonomous Drone Swarm

**The "relinquish to swarm" flow:**
1. Pilot powers on drone at home, opens AutonomousMissionScreen
2. App sends heartbeat (`POST /autonomous/drones/{id}/heartbeat`) with GPS position every 30s
3. Backend updates `autonomous_drones.home_lat/lng/last_seen_at`
4. Coordinator sees drone on map (amber icon, grays out if `last_seen_at > 5 min`)
5. Coordinator selects drone + observation point → `POST /autonomous/plan` → creates `pending` mission
6. Pilot receives mission on AutonomousMissionScreen, taps "Accept & Launch"
7. DJI SDK uploads waypoints and executes → status updates: `uploading → executing → completed/aborted`

**FAA operational tiers** (enforced at plan creation):
- `vlos` — Part 107 standard; all waypoints must be within `drone.vlos_radius_m` (default 400m) of drone home
- `bvlos_tactical` — Part 107 BVLOS waiver; requires `drone.bvlos_authorized = true` (admin sets this)
- `bvlos_autonomous` — Part 108 placeholder; same auth gate as tactical

**Mission status lifecycle:**
`pending → dispatched → uploading → executing → completed | aborted | failed`

Both `executing` and `active` are accepted status strings (mobile DJI SDK emits `executing`; backend treats them identically, sets `started_at`).

**Mission timeout cleanup** (`mission_timeout_loop` background task, 5-min interval):
- `pending/dispatched/uploading` > 30 min → `failed` ("Timed out waiting for drone to connect")
- `executing/active` > 4 hours → `failed` ("Mission exceeded maximum flight duration")

**Observation post dispatch** (current mode): single-waypoint mission. Drone flies to observation point (explicit lat/lng or polygon centroid) and hovers while live stream runs ALPR/YOLO. Lawnmower grid kept in codebase but not active.

### Security

- All endpoints require JWT except `GET /health`, `GET /`, `POST /auth/register`, `POST /auth/login`
- `POST /fema/test` requires admin JWT
- `POST /ingest/frame` requires pilot JWT
- `POST /detections/` requires `X-Internal-Key` header (worker uses this) OR pilot JWT
- `INTERNAL_API_KEY` env var on server; worker reads it and sends as `X-Internal-Key` header
- CORS restricted to `https://amberangels.org`, `https://www.amberangels.org`, `http://localhost:3000`, `http://localhost:19006`
- SSL: all httpx clients use certifi CA bundle. `apps.fema.gov` has an incomplete cert chain — `verify=False` scoped to that host only; all other clients use `verify=certifi.where()`
- ToS gate enforced in mobile: `TosGateScreen` blocks app access until user accepts current version (`CURRENT_TOS_VERSION` in `mobile/src/api/tos.ts`). Acceptance recorded server-side via `POST /auth/tos/accept`, checked via `GET /auth/tos-status`

### Key Files

**Backend**
- `backend/main.py` — FastAPI entry, routers, lifespan background tasks (FEMA, NCMEC, amber poller, mission timeout loop)
- `backend/routers/auth.py` — registration, SSO, coordinator request, account deletion (`DELETE /auth/delete-account`), ToS accept/status
- `backend/routers/alerts.py` — watchlist management, alert cancellation pipeline
- `backend/routers/autonomous.py` — autonomous mission plan/dispatch/status, drone registry, heartbeat
- `backend/routers/read_api.py` — detections feed, telemetry, watchlist reads, alerts history
- `backend/services/fema_connector.py` — FEMA IPAWS polling, plate extraction, vehicle target matching, Discord notifications
- `backend/services/amber_alert_poller.py` — EAS endpoint poll (amber.alert.gov disabled)
- `backend/services/ncmec_poller.py` — 50-state NCMEC RSS poll, cross-reference notifications
- `backend/services/autonomous_mission_service.py` — mission CRUD, `expire_stale_missions()`, `mission_timeout_loop()`
- `backend/services/waypoint_generator.py` — `generate_observation_point()` (primary), `generate_lawnmower()` (kept, not active), `check_vlos_radius()`
- `backend/services/alert_dispatcher.py` — HIGH_CONFIDENCE Discord + Twilio SMS dispatch
- `backend/services/discord_logger.py` — `DiscordErrorHandler` logging handler; posts ERROR/CRITICAL records to Discord webhook as embeds. 30-min dedup per (logger + message). Daemon-threaded, never blocks.
- `backend/services/audit.py` — `write_audit_sync` / `write_audit_async` helpers; writes to `audit_log` table. Fire-and-forget, swallows failures.
- `backend/run_migration.py` — run after any DB schema change: `python3 backend/run_migration.py`
- `event_repository.py`, `backend/services/event_service.py` — detection event persistence
- `worker/unified_worker.py` — RTMP frame scanner, ALPR + YOLO, posts to `/detections/` with `X-Internal-Key`

**Web**
- `web/src/app/page.tsx` — landing page (NO auth redirect — always serves public landing)
- `web/src/app/layout.tsx` — global metadata, OG tags, favicon
- `web/src/components/LandingPage.tsx` — public marketing page
- `web/src/app/map/page.tsx` — mission map (FEMA alert polygons, drone positions, detection feed)
- `web/src/app/admin/page.tsx` — admin panel: user approval, coordinator management, `can_dispatch_drones` checkbox
- `web/src/app/deck/` — `/deck` → `/deck/carrollton`; subroutes: `/carrollton`, `/grant`, `/tech`
- `web/public/decks/` — deck HTML + assets. Speaker notes in `const NOTES = [...]` at top of each file.

**Mobile**
- `mobile/app.config.js` — Expo config, build numbers, all mobile config
- `mobile/src/screens/TosGateScreen.tsx` — full-screen blocking ToS gate; shown before any app content until user accepts current version
- `mobile/src/screens/SettingsScreen.tsx` — pilot settings, watch areas, coordinator request, sign out, **account deletion**
- `mobile/src/screens/AutonomousMissionScreen.tsx` — swarm heartbeat, accept/monitor drone missions, battery level display, RTH button
- `mobile/src/screens/CameraScreen.tsx` — phone camera mode, frame upload
- `mobile/src/api/client.ts` — base API client (`apiGet`, `apiPost`, `apiPatch`, `apiDelete`)
- `mobile/src/api/autonomous.ts` — autonomous mission API calls, drone types, operation mode labels
- `mobile/src/api/tos.ts` — `fetchTosStatus`, `acceptTos`, `CURRENT_TOS_VERSION` constant
- `mobile/modules/dji-camera/` — DJI MSDK V5 Kotlin native module + TS bridge
- `mobile/modules/dji-camera/waypoint-mission.ts` — `startWaypointMission`, `stopWaypointMission`, `getMissionStatus`, `getDroneLocation`, `onMissionStateChanged`, `returnToHome`, `getBatteryLevel`
- Registration opens in Safari View Controller (not WebView) — required by App Store Guideline 4

### DB Tables

| Table | Purpose |
|---|---|
| `pilots` | Users: username, password_hash, role, status, can_dispatch_drones, expo_push_token, watch_areas, SSO fields |
| `watchlist` | Active alert plates: plate_text, description, alert_type, source_program, vehicle_color/type/make, active flag |
| `vehicle_targets` | Profile-only alerts (no plate): color, body_type, make — matched by YOLO |
| `detection_events` | ALPR/YOLO hits: plate, confidence, drone_id, status, timestamps, golden frame path |
| `alerts` | Discord-dispatched high-confidence alerts |
| `telemetry_points` | GPS track: drone_id, pilot_id (nullable), lat/lng, altitude, heading, speed |
| `ncmec_cases` | 50-state NCMEC missing child cases, resolved_at nullable |
| `autonomous_drones` | Registered swarm drones: pilot_username, model, serial, home_lat/lng, last_seen_at, bvlos_authorized, vlos_radius_m |
| `autonomous_missions` | Drone missions: status lifecycle, waypoints_json (JSONB), operation_mode, progress_pct, timestamps |
| `processed_alerts` | FEMA/EAS identifier dedup: survives PM2 restarts. Entries older than 24h excluded from startup load. |
| `alert_resolutions` | Audit log of manual alert resolutions by coordinators/admins |
| `audit_log` | General action audit trail: username, action string, details JSONB, created_at |

## Contact / Identity

- Public email: `info@amberangels.org` — use everywhere for all contact including privacy requests.
- EIN: 42-2052151 (501(c)(3) applied)
- Address: 103 Springwood Dr, Carrollton, GA 30117
- Pilot program: Carrollton, GA (not "Carroll County")

## Pitch Decks

Three decks at `web/public/decks/`:
- `carrollton.html` — Carrollton PD / community pitch
- `grant.html` — Grant writer / funder deck
- `tech.html` — Technical architecture deck

Update all three when architecture changes. Speaker notes in `const NOTES = [...]` at top of each file.

Print versions at `grants/Handoff/amber-angels/project/` must also be manually updated to match.

## Environment Variables (server `.env`)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://postgres:Ambers1Angels@127.0.0.1:5432/ambersangels` |
| `JWT_SECRET` | 64-char hex secret for HS256 JWT signing |
| `ALERT_WEBHOOK_URL` | Discord webhook URL for alert notifications |
| `INTERNAL_API_KEY` | Shared secret for worker → `/detections/` calls (`X-Internal-Key` header) |
| `TWILIO_ACCOUNT_SID` | Optional — SMS on HIGH_CONFIDENCE hits |
| `TWILIO_AUTH_TOKEN` | Optional |
| `TWILIO_FROM_NUMBER` | Optional |
| `SMS_ALERT_NUMBERS` | Optional — comma-separated numbers to receive SMS alerts |
| `SMTP_HOST` | Optional — email for password reset |
| `SMTP_PORT` | Optional (default 587) |
| `SMTP_USER` / `SMTP_PASS` | Optional |
| `SMTP_FROM` | Optional (default `info@amberangels.org`) |
| `FEMA_POLL_INTERVAL` | FEMA poll frequency seconds (default 300) |
| `NCMEC_POLL_INTERVAL` | NCMEC poll frequency seconds (default 1800) |
| `NCMEC_RECENT_DAYS` | Days back to track NCMEC cases (default 30) |

## Pending TODO

### Active / Next Session

1. **Site improvements backlog** — `AA_Site_Improvements.md` in repo root. Critical items (before June 2nd CPD meeting):
   - Meta description update (all pages) — replace "drone surveillance and rescue coordination"
   - Remove specific Flock LPR camera count from homepage copy
   - "Carroll County" → "Carrollton" in pilot section
   - 501(c)(3) language: replace all "In Formation" / "pending" with "Applied" everywhere
   - Create `/terms` page (content specified in the doc) — currently 404s, linked from footer
   - "Support the Mission" CTA → `mailto:info@amberangels.org` (or remove button)
   - Purge "surveillance" language → "coverage" / "search coverage"
   - Post-CPD-letter-signed: swap LE partnership language + add Carrollton PD badge + social proof block
   - See doc for exact copy replacements on every item

2. **Alert cancellation → stop active missions** — when a FEMA alert is cancelled (`_deactivate_by_references`), query `autonomous_missions WHERE status IN ('uploading','executing','active') AND alert_id = :id`, mark them `aborted`, push stop-mission notification to drone pilot. One gap in the cancellation pipeline.

3. **Law enforcement partnership badge** — after Carrollton PD Letter of Support is signed:
   - Add "Carrollton PD Partnership" badge to homepage hero badge row
   - Change landing page language from "Actively engaging local law enforcement" to "In active partnership with the Carrollton Police Department"
   - Add "Trusted by Law Enforcement" section between "How It Works" and "The Platform"
   - Full copy in `AA_Site_Improvements.md` items 4 and 10

4. **Update deck print versions** — `grants/Handoff/amber-angels/project/Technical Deck-print.html` and `Grant Pitch Deck-print.html` are separate files that must mirror the main deck content when updated.

4a. **Update demo slides with real vehicle** — Any demo slide currently showing a generic/Toyota vehicle must be updated to match the actual test vehicle:
   - **Vehicle**: white 2021 Tesla Model S
   - **Plates**: handicap plates (exact plate string TBD — user will photograph and run through the pipeline)
   - Once the plate photo is processed through the detection pipeline, use the real plate text and the actual ALPR/YOLO confidence output in the demo slide narrative

5. **App Store Build 4** — in review. When approved:
   - Update App Store description to remove any "report criminal activity" language (see 2.1 rejection history above)
   - Remove any background check / identity verification language from App Store copy (not implemented — see `AA_Site_Improvements.md` item 17)
   - After CPD letter is signed, add partnership language to App Store description

6. **DJI MSDK iOS** — current Kotlin module is Android-only. iOS DJI SDK requires a macOS build machine. `Platform.OS !== 'android'` guard is in place; iOS pilots fall back to phone camera mode.

7. **Watch-area UI + autocomplete** — BUILT (2026-05-24). All three layers shipped:
   - `alert_areas` table harvests real FEMA/NWS area tokens on every active alert (self-seeding)
   - `GET /alert-areas?q=` endpoint for autocomplete
   - Mobile Settings: debounced autocomplete input + inline suggestion list + Nationwide toggle (PATCHes `alert_scope`)
   - **Testing needed next week**: seed the `alert_areas` table with a few manual rows so suggestions work before real alerts arrive; confirm PATCH `/auth/me` `alert_scope` field is actually exposed on `GET /auth/me` response (check `backend/routers/auth.py` `/me` handler)

### Longer Term / Needs Config Only

- **Twilio SMS** — fully implemented in `alert_dispatcher.py`, silently skips if env vars absent. Just needs `TWILIO_*` vars added to server `.env`.
- **BVLOS waiver documentation** — `bvlos_authorized` flag set by admin via `PATCH /autonomous/drones/{id}`. Admin must record FAA Part 107.39 waiver number in notes before setting.
- **Competitive positioning** — autonomous swarm is a direct Flock Safety Drone competitor: (a) we show coordinators exactly where coverage gaps are (Flock bucket data), (b) volunteers relinquish drones remotely without being on scene. Tech deck slide 11 covers this.
- **Background check infrastructure** — registration currently accepts anyone 18+ with a valid FAA Part 107 cert number (drone pilots). No background check is implemented. All grant copy and App Store copy must reflect this accurately (see `AA_Site_Improvements.md` item 17).
