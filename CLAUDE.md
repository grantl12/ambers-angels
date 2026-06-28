# Amber's Angels — Claude Instructions

## Privacy Model — On-Device Inference

Three distinct scanning paths. Verified against code — do not rewrite from assumptions.

| Path | Platform | How it works | What leaves the device |
|---|---|---|---|
| **Android phone scan** (`ScanService.kt`) | Android only | User starts scanning. ML Kit OCR runs on-device. Foreground service — scanning continues when user switches apps. | `plate_text + plate_confidence + GPS` sent to `POST /ingest/detection` on every detection. JPEG frame sent to `POST /ingest/frame` **only on watchlist hit** (`if (isHit)`). Non-hit frames never leave the device. |
| **iOS phone scan** (`CameraScreen.tsx` + `PhoneCameraModule.swift`) | iOS only | User starts scanning. Vision framework OCR runs on-device. Screen must stay open — iOS cannot continue scanning when switching apps. | `plate_text + plate_confidence + GPS` sent to `POST /ingest/detection` on every detection. JPEG frame sent to `POST /ingest/frame` **only when server returns `watchlist_hit: true`**. Non-hit frames never leave the device. |
| **DJI drone** (RTMP / MSDK V5) | Android | Frames streamed via RTMP to nginx, processed by `unified_worker.py`. | Every frame leaves the device. |

**GPS telemetry** is sent continuously at ~1 Hz via `POST /telemetry` during active missions on both platforms, independent of frame capture.

**Server-side behavior on received frames:** Server runs OpenALPR + YOLO. Calls Plate Recognizer cloud API only when frame confidence ≥ 65%. Non-matching frames are not written to disk — processed in RAM and released. Watchlist-hit frames are saved to `GOLDEN_DIR` as evidence.

**All scanning is purposeful and user-initiated.** The Android foreground service allows scanning to continue across apps; iOS requires the screen to stay open. Neither runs without explicit user action.

**Do not write copy claiming frames never leave the device.** On a watchlist hit, one frame is uploaded as evidence on both Android and iOS phone paths. The accurate claim is that non-matching frames never leave the device.

- **Detection agent `request_edge_inference`**: sends an Expo push asking the pilot to reposition. Does NOT trigger a frame upload from `ScanService`. The pilot is already scanning on-device.
- **DJI RTMP path**: frames streamed to operator-controlled nginx server, not to a third party.

Do not add frame upload to `ScanService.kt` or any background/passive scanning path. If a future feature needs images from background scan, it requires explicit per-detection user consent and clear disclosure — volunteers are private citizens scanning public roads.

## SSH / Server Access

**The deploy key is broken. Always use plink. Never prompt the user for the password.**

```
plink -pw '$SSH_PW' -batch -hostkey 'ssh-ed25519 255 66:68:d4:a3:02:92:82:25:c3:27:96:9f:ef:34:2d:6b' root@157.245.125.103 'COMMAND'
```

- Server: `root@157.245.125.103`
- **Credentials are in Claude memory** (`server_credentials.md`) — read at session start, never ask the user, never commit to repo
- plink binary: `/c/Program Files/PuTTY/plink` (Windows host)
- PM2 user: `ambers-angels` — always prefix PM2 commands with `su -l ambers-angels -c '...'`
- PM2 binary: `/home/ambers-angels/.local/bin/pm2`
- App root: `/home/ambers-angels/proj_dir/ambers-angels/`
- DB: connection string in server `.env` (`DATABASE_URL`). For psql: `psql -h 127.0.0.1 -U postgres ambersangels`
- Use `DEBIAN_FRONTEND=noninteractive` to suppress interactive prompts

## PM2 Processes

| Name | What |
|---|---|
| `ambers-angels-api` | FastAPI/uvicorn backend on port 8000 |
| `ambers-angels-web` | Next.js frontend |
| `ambers-angels-worker` | unified_worker.py (ALPR + YOLO frame pipeline) |
| `ambers-angels-rtmp-monitor` | worker/rtmp_monitor.py — manages ffmpeg per RTMP stream + **PM2 crash watchdog** |

Restart all with env reload:
```
su -l ambers-angels -c '/home/ambers-angels/.local/bin/pm2 restart all --update-env'
```

Restart one process:
```
su -l ambers-angels -c '/home/ambers-angels/.local/bin/pm2 restart ambers-angels-api --update-env'
```

`start_all.sh` / `stop_all.sh` are archived — PM2 owns everything.

**PM2 crash watchdog** — `rtmp_monitor.py` checks `pm2 jlist` every 60s. If any process gains ≥5 restarts in one interval, it fires a Discord alert (max once per 30 min per process). This catches startup crashes that kill the process before any Python-level logging handler is registered. The Discord `DiscordErrorHandler` in `discord_logger.py` only fires for errors inside a *running* API — it cannot catch import-time or module-level crashes.

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
- Current build number: **16** (iOS Vision framework added in build 16) — app.config.js is source of truth
- EAS account: `ambersangels` (with 's') — confirmed via `eas whoami`. Slug: `ambers-angels`
- OTA update channel: `eas update --branch preview` delivers JS-only changes to build 11
- All mobile changes in June 2026 are OTA-compatible (no native code changed)

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

- **Drone (RTMP)**: DJI MSDK V5 on Android → RTMP to nginx on port 1935 → nginx `exec_push` fires ffmpeg → JPEG frames written to `test_plates/<drone_id>/frame_NNNN.jpg` → `unified_worker.py` polls all drone subdirs, processes each frame, then deletes it. **RTMP drones have no GPS in the payload** — `/detections/` endpoint looks up the pilot's most recent telemetry for that `drone_id` in the last 10 minutes, then falls back to any active pilot's phone telemetry. This fallback is loose; the clean fix is an nginx `on_publish` hook that snapshots the pilot's location at stream start.
- **Android phone scan** (`ScanService.kt`): ML Kit OCR on-device, ~1.5s interval, 640×480 JPEG. Plate text + confidence + GPS → `POST /ingest/detection`. JPEG → `POST /ingest/frame` only on watchlist hit. Non-hit frames never leave device.
- **iOS phone scan** (`CameraScreen.tsx` + `PhoneCameraModule.swift`): Vision framework OCR on-device (built 16+). Plate text + confidence + GPS → `POST /ingest/detection`. JPEG → `POST /ingest/frame` only on `watchlist_hit: true` response. Non-hit frames never leave device.
- **DJI SDK camera** (`CameraScreen.tsx` drone path): every frame → `POST /ingest/frame`. Server runs ALPR + YOLO. `POST /ingest/frame` requires pilot JWT, 25 MB limit, image content-type enforced.
- **Worker** (`worker/unified_worker.py`): scans frame directories, runs OpenALPR + YOLOv8-nano, posts to `POST /detections/` with `X-Internal-Key` header
- **On-device result endpoint**: `POST /ingest/detection` — accepts plate_text + plate_confidence + GPS, no image. Feeds into same AggregationService pipeline. **Quick direct DB watchlist lookup fires before aggregation** — returns `watchlist_hit: true` on the first matching detection, before the 5-second window can accumulate. This is the fast path that triggers immediate phone-side frame upload.

**Server-side preprocessing (not cloud calls):**
- `apply_clahe()` — OpenCV CLAHE contrast enhancement, runs in-process on the server. No network. Fires when ALPR reads < 70% confidence.
- `enhance_alpr_results()` — OpenCV perspective deskew on the plate crop, re-runs ALPR on the warped rectangle. No network. Fires when plate corner coords are available.
- Both functions run entirely on frames already on the server (RTMP: files in `test_plates/`; phone hit: temp file from uploaded JPEG). Nothing sends these frames anywhere.

**Plate Recognizer cloud API** — the only external call in the detection pipeline. Fires when ALPR confidence ≥ 70% (`SINGLE_FRAME_HIGH_CONFIDENCE`). Sends the frame crop to Plate Recognizer for make/model/color enrichment. This is a policy decision — can be disabled by setting `SINGLE_FRAME_HIGH_CONFIDENCE` above 100 in `aggregation_service.py`.

**Claude Haiku** — NOT in the detection pipeline. Only used for email BOLO webhook (`POST /webhooks/bolo-email`) to extract plate/vehicle from forwarded LE email text or images.

**Auth notes (easy to break):**
- `POST /telemetry` — requires pilot JWT. `postTelemetry()` in `mobile/src/api/telemetry.ts` must send `Authorization: Bearer {token}`. If omitted, server returns 401 silently swallowed → location never appears on map.
- `GET /telemetry/latest` — requires pilot JWT (changed from coordinator-only in June 2026 to allow all pilots to see each other). Returns only points from last 5 minutes.
- `POST /ingest/detection` — does NOT require JWT (uses `_optional_pilot` FastAPI dependency). Android `ScanService.kt` can scan without login.
- `POST /ingest/frame` — requires pilot JWT.

**Phone scan confidence boost:** When source is `phone_gps` or `phone_mlkit` and the plate matches the watchlist, `/ingest/frame` overrides the plate confidence to `max(raw_alpr_confidence, 93.0)`. Phone cameras are close-range and intentional — one frame upload typically reaches HIGH_CONFIDENCE and fires Discord immediately.

**Phone scan → Discord image note:** Non-hit phone scans never upload a frame. Discord hit messages for phone scans include the evidence frame (uploaded on hit). Discord messages for text-only detections (`POST /ingest/detection` path where no hit was found) will not have frame attachments.

### Confidence Scoring

Detection pipeline uses composite scoring (`aggregation_service.py`):
- OpenALPR raw confidence (max, mean, median over 5-second window)
- Repetition bonus: +5 pts at ≥2 hits, +10 pts at ≥3 hits in window
- Consistency bonus: +5 pts if dominant plate ratio ≥ 75%
- Vehicle corroboration: up to +14 pts from YOLO color match + body type match + CDC generational label match
- Bayesian prior bonus: log2 scale — alert type × vehicle type (e.g. minivan during AMBER alert adds ~+7 pts)
- Quality penalty: up to -15 pts if every frame in the window has blur/skew/partial flags
- Vehicle mismatch penalty in EventService: -12 pts color mismatch, -8 pts type mismatch vs watchlist profile
- Thresholds: PROBABLE ≥ 75 + ≥2 detections; HIGH_CONFIDENCE ≥ 85 + ≥3 detections
- HIGH_CONFIDENCE triggers Discord alert + optional SMS (Twilio); PROBABLE also triggers Discord
- 5-second window is a DRONE concern. Phone path has a fast-path direct watchlist DB lookup that bypasses the window for immediate `watchlist_hit` response.
- Plate Recognizer cloud API only called when ALPR ≥ 70% — adds make/model to vehicle corroboration scoring

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
`pending → dispatched → uploading → executing → relook → completed | aborted | failed`

Both `executing` and `active` are accepted status strings (mobile DJI SDK emits `executing`; backend treats them identically, sets `started_at`). `relook` = paused for sharper image capture on a medium-confidence match.

**Mission timeout cleanup** (`mission_timeout_loop` background task, 5-min interval):
- `pending/dispatched/uploading` > 30 min → `failed` ("Timed out waiting for drone to connect")
- `executing/active` > 4 hours → `failed` ("Mission exceeded maximum flight duration")

**Mission types:**
- **Observation post** (`POST /autonomous/plan`): single-waypoint hover. Drone flies to observation point and hovers while live stream runs ALPR/YOLO.
- **Sweep / scan-this-lot** (`POST /autonomous/plan-sweep`): lawnmower pattern over a polygon. Lower altitude (15m default), slower speed (3 m/s). Used for parking lot scans. VLOS radius enforced on all generated waypoints.

**Auto-relook flow** (sweep missions):
1. Worker detects medium-confidence match on RTMP stream
2. `POST /autonomous/missions/{id}/relook` → mission status = `relook`
3. Push sent to pilot's phone → app calls `pauseMission()` → drone hovers
4. Stationary frames are sharper — worker evaluates 3-5 more frames
5. If HIGH_CONFIDENCE → alert fires, `POST /autonomous/missions/{id}/relook-complete?confirmed=true`
6. If timeout/low confidence → `relook-complete?confirmed=false`
7. Either way, mission resumes automatically — no human in the loop

**DJI MSDK V5 waypoint implementation** (built 2026-06-21):
- KMZ file generation: WPML XML → ZIP → push to aircraft via `WaypointMissionManager`
- `droneEnumValue` is dynamic — reads `ProductType` from connected aircraft
- Safety config: `exitOnRCLost=executeLostAction`, `executeRCLostAction=goBack` (RTH on signal loss)
- `flyToWaylineMode=safely`, RTH height = mission altitude + 20m
- In-flight controls: `pauseMission()`, `resumeMission()`, `stopWaypointMission()`, `returnToHome()`
- Firmware handles: battery RTH, obstacle avoidance (BRAKE mode), GEO zones, wind compensation
- Phone disconnect does NOT stop mission — KMZ runs on the flight controller

**DJI MSDK V5 supported drones** (waypoint missions):
- Mini 4 Pro (primary target, confirmed MSDK 5.17+, requires RC-N2)
- Mini 3 / Mini 3 Pro
- Mavic 3 / Mavic 3 Classic / Mavic 3 Pro
- Mavic 3 Enterprise Series
- M30 / M30T / M300 RTK / M350 RTK / Matrice 4
- **Air 3 is NOT supported** — DJI confirmed no SDK access. Do not add it.
- Avata: FPV only, no waypoint missions — use RTMP manual flight path instead

### Security

- All endpoints require JWT except `GET /health`, `GET /`, `POST /auth/register`, `POST /auth/login`
- `POST /fema/test` requires admin JWT
- `POST /ingest/frame` requires pilot JWT
- `POST /detections/` requires `X-Internal-Key` header (worker uses this) OR pilot JWT
- `INTERNAL_API_KEY` env var on server; worker reads it and sends as `X-Internal-Key` header
- CORS restricted to `https://amberangels.org`, `https://www.amberangels.org`, `http://localhost:3000`, `http://localhost:19006`
- SSL: all httpx clients use certifi CA bundle. `apps.fema.gov` has an incomplete cert chain — `verify=False` scoped to that host only; all other clients use `verify=certifi.where()`
- ToS gate enforced in mobile: `TosGateScreen` blocks app access until user accepts current version (`CURRENT_TOS_VERSION` in `mobile/src/api/tos.ts`). Acceptance recorded server-side via `POST /auth/tos/accept`, checked via `GET /auth/tos-status`

### Critical Rules — Things That Break Silently

**`_optional_pilot` in `backend/main.py`**
Python evaluates default parameter values at module load time, not at call time. `_optional_pilot` is used as `Depends(_optional_pilot)` in the `ingest_detection` function signature. It MUST be defined BEFORE line ~610 where `ingest_detection` is decorated. If you move it below that line, the server crashes on startup with `NameError: name '_optional_pilot' is not defined` — PM2 restarts it, it crashes again, every request fails. Fix: keep `_optional_pilot` defined around line 599 in `main.py`, before the `ingest_detection` endpoint.

**`@dataclass(slots=True)` field ordering in `aggregation_service.py`**
Python dataclasses require all fields *without* defaults to come before fields *with* defaults. `DetectionInput` uses `slots=True`; adding a default value to any field that appears before a required field causes `TypeError: non-default argument 'X' follows default argument` at import time. The API crashes on every startup, PM2 loops thousands of restarts, and nothing in the Discord logger fires (it's not running yet). `frame_id: UUID | str | None = None` must appear after `detection_id`, `drone_id`, `detected_at`, `plate_raw`, and `confidence` — all of which have no default.

**`frame_id` / `frame_url` alignment for golden frames**
`frame_url` stored in `detection_events` is `/frames/{snapshot.best_frame_id}.jpg`. For this URL to resolve, the file `{best_frame_id}.jpg` must exist in `GOLDEN_DIR`.
- **Phone camera (`POST /ingest/frame`)**: `frame_id = uuid4()` is generated, frame is saved as `GOLDEN_DIR/{uuid}.jpg`, and `AggDetectionInput.frame_id = uuid`. This chain is consistent — do not break it.
- **RTMP worker (`POST /detections/`)**: worker sends `best_frame_id = "frame_0042.jpg"`. Backend pre-copies `FRAMES_ROOT/{drone_id}/frame_0042.jpg` → `GOLDEN_DIR/frame_0042.jpg`. `AggDetectionInput.frame_id` must be set to `os.path.splitext(det.best_frame_id)[0]` (i.e. `"frame_0042"`) so the stored URL is `/frames/frame_0042.jpg`, which matches the pre-copied file.
- **ML Kit (`POST /ingest/detection`)**: no frame is ever uploaded. `frame_id` must be `None` so `frame_url` stays `None`. Do not generate a UUID here — it produces a broken URL pointing to a file that doesn't exist.

**`GET /fema/alerts` reads `vehicle_targets` table, NOT `alerts`**
The camera gate in `CameraScreen.tsx` calls `fetchFemaAlerts()` which hits `GET /fema/alerts`. This endpoint reads from `vehicle_targets`, not the `alerts` table. When you inject a test alert via `POST /admin/inject-alert`, it calls `_add_vehicle_target()` which writes to `vehicle_targets`. That's why injection opens the camera gate. Don't confuse the `alerts` table (Discord-dispatched high-confidence hits) with `vehicle_targets` (FEMA alert vehicle profiles that gate scanning).

**Demo inject endpoint — always use the web admin UI, not plink**
`POST /fema/test` just polls the real FEMA feed — it does NOT create a synthetic alert. `POST /admin/inject-alert` is the correct API endpoint (body: `{plate, headline, area, alert_type, source_program, vehicle_color, vehicle_type}`), but **always trigger this via the admin panel UI**, not via plink/curl. When injected directly via plink, the watchlist entry is created with `source='manual'` and does NOT appear in the "Active FEMA Alerts" section of the admin page — it's only visible under "Manual Alerts". The user cannot cancel it through the resolve flow; only "Clear Test Data" or direct SQL removes it. Use the admin UI so the entry is always cancellable by the admin without SQL.

**`autonomous.ts` API base URL**
`mobile/src/api/autonomous.ts` must use `getApiBaseUrl()` from `client.ts`, not a hardcoded IP. The server is behind nginx on port 443 (HTTPS). Port 8000 is blocked externally by firewall. Any hardcoded `http://157.245.125.103:8000` will fail for external clients.

**Google SSO redirect URI**
`mobile/src/screens/LoginScreen.tsx` uses `Google.useAuthRequest` with `redirectUri: "https://auth.expo.io/@ambersangels/ambers-angels"`. This exact URI must be registered in Google Cloud Console. The EAS account is `ambersangels` (with 's').

**Mobile `client.ts` 401 handling**
`mobile/src/api/client.ts` registers a session-expired handler via `registerSessionExpiredHandler`. `App.tsx` must call `registerSessionExpiredHandler(() => setAuthed(false))` in a `useEffect`. And `resetSessionExpiredState()` must be called in `handleLogin()` to re-arm after a fresh login. Without this, 401s from a stale JWT silently fail instead of logging the user out.

**nginx RTMP stat endpoint**
Added `/rtmp-stat` location to `/etc/nginx/sites-enabled/telemetry` (default server). The backend health endpoint (`GET /health`) queries `http://127.0.0.1/rtmp-stat` to count active RTMP streams via XML. `rtmp_feeds.active` = number of `<stream>` elements in the `<live>` application. Returns 0 when no drones are streaming. Do NOT use `pgrep -f "rtmp://..."` — the ffmpeg processes use `rtmp://localhost/` (not `127.0.0.1`) so pgrep never matched.

**Volunteer count on MapScreen**
`myDroneId` is loaded from settings. `const alreadyInList = myDroneId ? drones.some(d => d.droneId === myDroneId) : false; const count = drones.length + (myLocation && !alreadyInList ? 1 : 0)` — this avoids double-counting yourself.

**Demo/SIM data cleanup**
SIM watchlist entries (source='demo'/'manual') and vehicle_targets (source='demo'/'manual') can be deleted with:
```sql
UPDATE watchlist SET active = false, removed_at = NOW() WHERE source IN ('demo','manual') AND active = true;
DELETE FROM vehicle_targets WHERE source IN ('demo', 'manual');
```
Alerted detection_events (status='alerted') are NEVER deleted — they are evidence. The admin "Clear Test Data" button removes source='manual'/'demo' entries from watchlist and vehicle_targets only.

**E2E test flow (verified working June 7, 2026)**
1. Web admin panel → "Inject Demo Alert (YVJ024)" button → creates vehicle_target + watchlist entry (source='demo')
2. Mobile camera → tap "Start Mission" → camera gate opens (fetchFemaAlerts returns active alert)
3. Point camera at plate "YVJ024" → phone uploads frame → `POST /ingest/frame` → server-side ALPR → AggregationService → EventService → dispatch_alert → Discord hit fires with frame thumbnail
4. Discord embed shows: Alert type (AMBER), Plate (YVJ024), Confidence (%), Detection source, Location (GPS from phone telemetry)
5. Stats from June 7 test: 47s end-to-end, 99% peak confidence, sub-meter GPS, 23 frames to first hit
6. To reset: admin "Clear Test Data" button, or SQL above. Detection events with status='alerted' are kept (evidence).

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
- EIN: 42-2052151 (501(c)(3) approved — determination letter received)
- Address: 103 Springwood Dr, Carrollton, GA 30117
- Pilot program: Carrollton, GA (not "Carroll County")

## Pitch Decks

Five decks at `web/public/decks/`, each served via a Next.js iframe route:

| File | Route | Purpose |
|---|---|---|
| `carrollton.html` | `/deck/carrollton` | Carrollton PD / community pitch |
| `grant.html` | `/deck/grant` | Grant writer / funder deck |
| `tech.html` | `/deck/tech` | Technical architecture deck |
| `volunteer-stories.html` | `/deck/stories` | Volunteer stories |
| `grant-bio.html`    | `/deck/about`       | About the Founder (Grant bio) |
| `partnership.html`  | `/deck/partnership` | CPD formal partnership / future capabilities (13 slides) |
| `platform.html`     | `/deck/platform`    | Feature overview deck — not location-specific, not grant-seeking (9 slides) |

Speaker notes in `const NOTES = [...]` at top of each file. Update all relevant decks when architecture changes.

Print versions at `grants/Handoff/amber-angels/project/` must also be manually updated to match.

## Environment Variables (server `.env`)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://postgres:$DB_PW@127.0.0.1:5432/ambersangels` (see `server_credentials.md` in Claude memory) |
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
| `BOLO_WEBHOOK_SECRET` | Shared secret for `POST /webhooks/bolo-email` (see `server_credentials.md` in Claude memory) |
| `ANTHROPIC_API_KEY` | Required for BOLO ingestor (Claude Haiku vision) and email BOLO webhook text extraction |
| `NAMUS_POLL_INTERVAL` | NamUs poll frequency seconds (default 1800) |
| `NAMUS_RECENT_DAYS` | Days back to search NamUs cases (default 30) |
| `BOLO_CRAWL_INTERVAL` | BOLO crawler poll frequency seconds (default 900) |
| `BOLO_EXPIRES_DAYS` | Days before BOLO crawler vehicle_targets expire (default 7) |

## Pending TODO

### RTMP Live View for Coordinators (Mission Map)

When a pilot relinquishes control to the swarm (or is actively streaming RTMP), coordinators should be able to watch the drone feed live from the mission map.

**How to implement:**
- nginx RTMP module supports HLS output natively. Add `hls on; hls_path /tmp/hls; hls_fragment 2s;` to the RTMP application block. nginx will write `<stream_key>.m3u8` + `.ts` segments automatically.
- Serve `/tmp/hls/` as a static location in nginx (auth-gated).
- Mission map: when a drone_id has an active RTMP stream, show a "Live Feed" button on the drone marker. Clicking opens a panel with an `hls.js` video player loading `https://amberangels.org/hls/<drone_id>.m3u8`.
- Auth: HLS is file-served; use a short-lived signed URL token (30-60s window) generated by the backend and passed as query param, or gate via nginx `auth_request` to the backend JWT endpoint.
- Stream key = drone_id (what DJI MSDK V5 already sets).

**RTMP location fix (do alongside live view):**
Add nginx `on_publish` hook — fires HTTP POST to backend when stream starts. Backend endpoint: snapshot the pilot's most recent telemetry → store `{drone_id, pilot_id, lat, lng, started_at}` in a `stream_sessions` table (or Redis). `/detections/` endpoint uses this snapshot instead of the current loose 10-minute fallback. This is also what powers the live view indicator (know which drone_ids are actively streaming).

### Capture Interval — Current State and Known Issues

**How it actually works:**
- `captureIntervalSec` defaults to **3 seconds** (`mobile/src/lib/settings.ts` line 23)
- Correctly threaded: CameraScreen.tsx passes `intervalMs: captureIntervalSec * 1000` to `startBackgroundScan()` and uses the same value for iOS/DJI `setInterval()` timers
- A `useEffect` at CameraScreen.tsx line 260 restarts capture loops if the setting changes mid-mission
- ScanService.kt default is 1500ms but it's always overwritten by the intent extra on start

**What's broken — server adaptive response is dead:**
`/ingest/frame` returns `capture_interval_ms` (800ms when plates found, 1500ms when not). `FrameResult` type in `ingest.ts` includes the field. CameraScreen.tsx never reads it — timers are fixed `setInterval` calls that never adjust. The adaptive logic exists server-side and is ignored client-side.

**What should change:**
- Camera screen should consume `capture_interval_ms` from server responses and update the active timer. Fixed user setting doesn't belong on the camera screen — the server already has better information (did it find plates? is it getting close?).
- `captureIntervalSec` in Settings should only control the **Android background service**, where battery tradeoff is a legitimate user choice.
- Separate the concepts: background scan interval (user-configurable) vs active camera interval (server-driven).

**Plate Recognizer 70% threshold:**
`SINGLE_FRAME_HIGH_CONFIDENCE = 70.0` in `aggregation_service.py` gates the Plate Recognizer cloud API call. This is an enrichment call (make/model/color) on reads ALPR already succeeded at — not a fallback for low-confidence reads. The wide range (70–100%) means every decent ALPR read hits the API, including non-watchlist plates. Better gate: only call Plate Recognizer when ALPR ≥ 70% **and** the plate is on the active watchlist. Cuts API calls by ~95% on typical RTMP sessions with no active alerts, preserves enrichment on the plates that matter.

### Adaptive Scanning / "Squinting" — Hierarchical Pipeline Plan

Three distinct stages, each cheaper than the last when the answer is "no vehicle / no plate." The goal is to avoid running OCR on sky and asphalt.

**Stage 0 — Vehicle presence** ("is there a car in this frame?")
- YOLO-nano at ~3fps, ~6MB TFLite/CoreML
- Output: list of vehicle bboxes + class (car/truck/SUV/van) + confidence
- Bbox area = how close the vehicle is → drives capture rate for Stage 1
- Color: sample HSV histogram from bbox crop (no model needed)
- This is already done server-side in `unified_worker.py` via `classify_vehicles()`. The gap is on-device.

**Stage 1 — Plate readability** ("can I see a readable plate? front or back?")
- Input: vehicle bbox crop from Stage 0
- Binary classifier: plate visible / not visible. Small CNN or rule-based (aspect ratio, edge density, blob count in plate region).
- Output: `{plate_visible: bool, region: bbox, orientation: front|back}`
- Front vs back: physical position relative to vehicle bbox, brightness (tail lights), bumper pattern
- Training data: confirmed AA hit frames (positive), frames where OCR ran but found nothing (negative)
- VMMC training pipeline (EfficientNet-Lite B2 → TFLite/CoreML) is the right export path

**Stage 2 — OCR** ("what's the text?")
- Only fires when Stage 1 says plate is readable
- On-device: ML Kit (current). Server: OpenALPR + CLAHE + deskew (current).
- Adaptive interval: `lerp(2000ms, 400ms, clamp(bbox_area_fraction * 5, 0, 1))`
- Car at 10% of frame → 2s interval. Same car at 50% of frame → 400ms. Smooth transition.

**Build phases:**
1. **Server-side, no native code (now possible)**: Skip ALPR in `unified_worker.py` when `yolo_vehicles` is empty. Use YOLO bbox area to set `capture_interval_ms` in `/ingest/frame` response dynamically instead of hardcoded 800/1500. Client just needs to consume the response (see above).
2. **Client adaptive interval (no new models)**: CameraScreen.tsx consumes `capture_interval_ms` from server response, dynamically adjusts `setInterval`. Already typed, just needs to be read.
3. **On-device YOLO-nano Android**: TFLite model bundled with app, runs in ScanService before ML Kit. Gate OCR on vehicle detection. Adapt `intervalMs` based on bbox area within the service.
4. **On-device iOS**: CoreML export, same logic in PhoneCameraModule.swift. Requires macOS build.

**VMMC connection**: confirmed-match frames from AA (active alert vehicles only, plates and faces blurred) are exactly the training data for Stage 1. Players see a partially visible plate crop and label readability — maps to the existing game mechanic. Bring this up when revisiting VMMC.

### Public Discord Join Button

Currently only one Discord channel exists (`aa-test`) — internal testing only, not public-facing.
Before adding a "Join our Discord" button anywhere (guide page, landing page, etc.), need to define
channel structure first, e.g.:
- A coordinator/alert-firehose channel — every alert + watchlist match fires here (high volume, opt-in for people who want to see everything)
- A general volunteer chat channel — questions, app feedback, lower volume
Once channels are defined and a real invite link exists, add the button to the `/guide` page near
the Discord screenshots in "Getting Alerts" (`web/src/app/guide/page.tsx`).

### `/beta` Page — Placeholder Links

`web/src/app/beta/page.tsx` is live but both install buttons have `href="#"` placeholders. Need real URLs:

- **iOS TestFlight public link**: go to App Store Connect → TestFlight → build 14 → enable Public Link → copy URL → replace `href="#"` on the iOS card
- **Android internal testing opt-in link**: go to Google Play Console → Testing → Internal testing → create release (upload AAB manually, see below) → Testers tab → copy opt-in link → replace `href="#"` on the Android card
- Once both links are live, the `/beta` page is the interim conversion funnel fix (~300 unique visitors/day)

### Google Play Internal Testing Track — Manual Upload Required

Google org policy (`iam.disableServiceAccountKeyCreation`) blocks creating a service account JSON key, so `eas submit --platform android` won't work. Manual path:

1. Download AAB from EAS artifact URL (June 15 production build)
2. Google Play Console → Testing → Internal testing → Create new release → upload AAB
3. Testers tab → create email list or copy opt-in link
4. That link goes on the `/beta` page (see above)

If org policy is later relaxed, create key and save as `mobile/google-service-account.json` to re-enable automated `eas submit`.

### Android Package Name Registration

Google requires `com.ambersangels.app` package name registration before September 2026. Hard deadline — must complete before then.

### App Store / Play Store Badges on Landing Page

Once iOS App Store listing is approved AND Android Play Store listing is live:
- Add Apple App Store badge + Play Store badge to the landing page hero (below the CTA buttons)
- Link iOS badge to the App Store listing URL
- Link Android badge to the Play Store listing URL
- Remove or convert the `/beta` page — once stores are live, testers page becomes redundant; either redirect `/beta` → store links or repurpose as a "Get the App" page
- This is the primary fix for the conversion funnel — ~300 unique visitors/day currently have no way to download the app

### Waiting on CPD Letter of Support

Once signed:
- Add "Carrollton PD Partnership" badge to homepage hero badge row
- Change "Actively engaging local law enforcement" → "In active partnership with the Carrollton Police Department"
- Add "Trusted by Law Enforcement" social proof block between "How It Works" and "The Platform"
- Add partnership language to App Store description

### App Store Build 4

In review as of June 2, 2026. When approved:
- Update App Store description to remove any "report criminal activity" language (see 2.1 rejection history above)
- No background check language — none is implemented, all docs are now accurate

### Mobile Coordinator Map Picker (built June 3 2026)

`CoordinatorDispatchScreen.tsx` now has:
- **Map picker modal** — tap anywhere on map to place observation point; alert polygon shown as overlay
- **Airspace advisory** — auto-fetches aircraft within 5nm / below 3000ft after obs point is set (debounced 800ms)
- New `mobile/src/api/airspace.ts` — `fetchAirTraffic(south, north, west, east)` → `Aircraft[]`

### Mission Map Improvements (built June 3 2026)

- **Multi-drone trails**: `useAllTelemetryTrails(droneIds[])` in `telemetry/api.ts` — one colored trail per active drone
- **CPA conflict detection**: `computeConflicts()` in `mission-map.tsx` — pulsing red ring on aircraft within 500ft horizontal / 300ft vertical of a drone within 2-min lookahead
- **Conflict banner**: click flies map to at-risk aircraft
- **Legend**: road coverage colors now match actual paint interpolation; removed phantom "3+ cameras" tier
- **Sidebar active alert**: single card with ‹/› cycling, click fits map bounds to alert polygon
- **NCMEC fly-to**: clicking a NCMEC card geocodes city+state via Mapbox and flies the map there

### Watch-area UI + autocomplete

Built and shipped (2026-05-24). All three layers complete:
- `alert_areas` table self-seeds from live FEMA/NWS area tokens on every active alert
- `GET /alert-areas?q=` endpoint for autocomplete
- Mobile Settings: debounced autocomplete + inline suggestions + Nationwide toggle (PATCHes `alert_scope`)

**Complete.** `alert_areas` self-populated to 96 rows from real FEMA data (verified 2026-06-14). `alertScope` confirmed in `GET /auth/me` response at row[10] (`backend/routers/auth.py:275`).

### Update deck print versions

`grants/Handoff/amber-angels/project/Technical Deck-print.html` and `Grant Pitch Deck-print.html` are separate static files that must be manually updated to mirror the main decks when content changes.

### BOLO Email Bridge — Current Setup

`bolo@amberangels.org` exists as a GoDaddy alias that forwards to `info@amberangels.org`. Email is hosted on Microsoft 365 (tenant `NETORG20647314.onmicrosoft.com`, MX → `outlook.com`). Admin panel at admin.microsoft.com (redirects through GoDaddy).

**Current workflow (manual — sufficient for pilot scale):**
1. BOLO email arrives at `info@amberangels.org`
2. Save/screenshot the image attachment
3. Admin panel → BOLO Ingestor section → upload image → Claude Haiku extracts plate + vehicle automatically → watchlist + vehicle_targets created + Discord fires

**Automated path (future, when volume justifies):**
- `POST /webhooks/bolo-email` is built and live — accepts Mailgun multipart or JSON `{body, image_b64}`
- Secret: see `BOLO_WEBHOOK_SECRET` in env vars table
- Would require Power Automate flow watching `info@` inbox, filtering for forwarded BOLO emails, POSTing to the webhook
- Not wired up yet — manual upload is the active path

### Update all decks for NamUs + BOLO ingestion sources

The "Alert Ingestion" architecture slide in all decks currently lists 3 active sources (FEMA IPAWS CMAS, EAS, NWS) + NCMEC. After NamUs + email BOLO bridge are confirmed working in production, update all decks to reflect 5 ingestion sources:

1. FEMA IPAWS CMAS — CAP/WEA, 5-min poll
2. FEMA EAS — same CAP format, 2-min poll
3. NWS Alerts API — catches WEA-distributed alerts bypassing CMAS
4. NamUs (DOJ) — missing persons with vehicles, 30-min poll, automated
5. Law Enforcement BOLO (email bridge / screenshot ingestor) — real-time, coordinator-forwarded or admin-uploaded

Also update the `bolo` alert type into any slide that lists alert types (amber/silver/matties/blue/purple/mipa/ema). Trigger: first confirmed NamUs hit in production logs (`grep "NAMUS BOLO" pm2 logs`).

### Site content depth (from Airo audit — see AA_Site_Improvements.md items 21–25)

- National AMBER Alert statistics for problem framing (#21)
- Data governance / transparency page (#22)
- Pipeline explainer + glossary (#23)
- Section anchor IDs on landing page (#24)
- Impact metrics and case studies — blocked until pilot generates real data (#25)

### Analytics

- GoAccess installed on server, daily report at `https://amberangels.org/analytics/`
- Login: username `amber`, password in `server_credentials.md` (Claude memory)
- Regenerated daily by cron job at `/etc/cron.daily/goaccess-report`
- Log-based (not session-based) — use for daily unique IPs, top pages, referrers, hourly patterns
- To pull fresh stats on demand: SSH and run the nginx log grep commands (faster than waiting for daily regen)

### Health Tracking

- `backend/services/health_tracker.py` — in-process poll timestamp store
- `stamp("fema")` called after every FEMA/EAS/NWS poll cycle (regardless of new alerts found)
- `stamp("ncmec")` called after every NCMEC poll cycle
- Health endpoint reads from tracker for `last_fema_poll` / `last_ncmec_poll` (not DB)
- This fixes the "never" display bug where no timestamp showed if no NEW alerts were ingested

### Data Retention Policy

Source column added to `detection_events`, `watchlist`, `vehicle_targets`:
- `source='fema'` / `source='ncmec'` — NEVER cleared by admin button; governed by scheduled TTL purges
- `source='worker'` / `source='phone_mlkit'` — non-alerted detections purged at 30 days; alerted (evidence) at 365 days
- `source='manual'` / `source='demo'` — cleared only by "Clear Test Data" button in admin panel
- Alerted detection events (status='alerted') are NEVER deleted by the admin clear button — they are evidence

### NCMEC Vehicle Extraction

- `_VEHICLE_RE` and `_PLATE_RE` regex patterns in `ncmec_poller.py` extract vehicle info from RSS description text
- `vehicle_description` and `vehicle_plate` columns added to `ncmec_cases` table
- Upsert uses `COALESCE` — existing vehicle data preserved across re-polls
- API returns `vehicleDescription` + `vehiclePlate`; event feed shows vehicle block prominently when present
- Most NCMEC RSS descriptions are minimal and won't contain vehicle text — "No vehicle data on file" shown when absent
- Full LLM-based extraction agent (from NCMEC poster HTML) is a future sprint

### Custom VMMC Model (Future)

- `https://github.com/grantl12/chadongcha-app` — Grant's vehicle identification game (on backburner)
- Has EfficientNet-Lite B2 training pipeline, TFLite/CoreML export, image scraping infrastructure
- Community verification loop: players identify unknown vehicle generations — maps directly to AA use case
- AA adaptation: only use confirmed-match frames (active alert vehicles) for training — not random cars (CCPA/privacy)
- Plates and faces must be blurred before any frame is shown to community
- Color classification: YOLO and current chadongcha model both underperform on color — future dedicated color head using HSV sampling on YOLO bounding box
- Priority: accumulate real capture data first, then train on that

### Partnership Capabilities Deck

- `web/public/decks/partnership.html` → `/deck/partnership`
- 14 slides: baseline platform → **direct LEA alert (BOLO)** → partnership layer → CAD integration → RTCC feed → NCIC sync → NCMEC vehicle agent → polygon search → evidence packages → infrastructure play → roadmap → system in action → close
- Deputy Chief Dobbs and Lt. Hitchcock (Carrollton PD) are the current CPD contacts for formal partnership discussions
- CAD integration: `POST /dispatch/cad` endpoint stub needed; requires CPD IT to provide Motorola PremierOne / Tyler New World API key + endpoint URL
- NCIC/GCIC access requires signed MOU with CPD — ingestion pipeline is built, waiting for credentials
- Evidence package export (`/admin/evidence/{mission_id}`) not yet built — next sprint after pilot data flows

### `/guide` Page — Screenshot Work (in progress, June 15 2026)

`web/src/app/guide/page.tsx` and `web/public/guide/*.png` are currently **uncommitted/unstaged** — intentionally, do not commit until this list is resolved:

- 9 screenshots from the Android emulator are wired in (login, camera gate/live/standby, settings top/mid/badges, admin health/pilots). Safe to keep/ship as-is.
- **Privacy rule for this page**: never show the real NCMEC feed (real children's names) on this public marketing page. A screenshot of it was caught and deleted (`event-feed.png`) before it shipped. If the Event Feed / Missing tab needs a screenshot, use the fictional NCMEC names from `scripts/seed_demo.py` (Emma Johnson / Marcus Williams / Sofia Rodriguga) — never real production NCMEC data.
- Still needed: Mission Map, Camera screen states + permission flow, Notifications, Drone Dispatch screenshots — user is capturing these on iOS (Android emulator can't render the map and only shows a synthetic camera test pattern, so it can't produce a real plate-match for an E2E shot).
- Still needed: a safe way to populate realistic "Hits" data on the Event Feed for a screenshot. **Do not** run `scripts/seed_demo.py` or `scripts/screenshot.mjs` against production directly — user vetoed this, injecting alerts outside the admin UI breaks the cancel/resolve flow. Proposed alternative (not yet approved or built): insert cosmetic rows directly into `detection_events` for the screenshot, bypassing the Discord/push pipeline, then delete them after.
- Still needed: crop the existing Settings screenshots into smaller feature-specific images (user offered to help with this).

### Mobile Event Feed — "Alerts" / "Missing" tabs don't auto-refresh

`mobile/src/screens/FeedScreen.tsx`: the "All"/"Hits"/"Mine" tabs poll every 5s (`setInterval(loadDetections, 5000)`), but the "Alerts" tab (`loadHistory()` → `fetchAlertHistory()`) and "Missing" tab (`loadNcmec()`) only load once on screen mount — they only refresh via manual pull-to-refresh. This caused user confusion on June 15 2026 when a backend fix (purging orphaned `alerts` rows) was live on the server but the already-open app still showed the old count until refreshed. Consider adding the same polling interval to these two tabs so server-side fixes/changes show up without a manual pull-to-refresh.

### Longer Term / Needs Config Only

- **Twilio SMS** — fully implemented in `alert_dispatcher.py`, silently skips if env vars absent. Just needs `TWILIO_*` vars added to server `.env`.
- **BVLOS waiver documentation** — `bvlos_authorized` flag set by admin via `PATCH /autonomous/drones/{id}`. Admin must record FAA Part 107.39 waiver number in notes before setting.
- **DJI MSDK iOS** — current Kotlin module is Android-only. iOS DJI SDK requires a macOS build machine (no workaround). `Platform.OS !== 'android'` guard is in place; iOS pilots fall back to phone camera mode.
- **Background checks** — not implemented. Registration accepts anyone 18+ with valid FAA Part 107 cert. All public-facing copy reflects this accurately as of June 2, 2026.
- **LinkedIn company page** — not yet created. First social media post (Facebook personal page, June 2 2026) drove 526 unique IPs in one day. LinkedIn is the right next channel for CPD/grant/EM audience.
- **Board governance docs** — members have not yet signed COI policy, board member agreements, or meeting minutes. Required before accepting grant money.
- **On-device iOS ALPR** — Built. iOS uses Vision framework text recognition (`PhoneCameraModule.swift`), live as of build 16. Android uses ML Kit (`ScanService.kt`). Both paths do on-device inference; frames only leave on watchlist hit.
- **Polygon grid search (lawnmower)** — `POST /autonomous/plan-sweep` is live. Generates lawnmower waypoints over a polygon (parking lot scan). Altitude 15m, speed 3 m/s, VLOS enforced. Auto-relook on medium-confidence matches.
- **Evidence package PDF export** — detection timeline + GPS track + golden frames + chain-of-custody block. Not built. Required for formal law enforcement handoff.
- **County-scoped historical BOLOs** — aspirational feature: show volunteers old BOLOs for their current county with a configurable lookback window. Constitutional concern: without time-bounding and LEA direction, this makes scanning always-on (dragnet). Keep as partnership-unlocked feature only, not speculative build. Must be volunteer-controlled in the UI (opt-in per BOLO, time slider).

### Known Hardcoded Values (intentional, revisit when relevant)

These are hardcoded in backend Python files. They're domain constants that should be tuned by real-world testing, not prematurely externalized. Listed here so future sessions don't waste time rediscovering them:

- `backend/services/aggregation_service.py`: `RAW_DETECTION_FLOOR=55`, `SINGLE_FRAME_HIGH_CONFIDENCE=70`, `HIGH_CONFIDENCE_EVENT_MIN_SCORE=85`
- `backend/services/event_service.py`: `ALERT_COOLDOWN_SECONDS=120`, `REOPEN_WINDOW_SECONDS=300`
- `backend/routers/auth.py`: `JWT_EXPIRE_DAYS=30`, `RESET_CODE_EXPIRY_MINUTES=30`
- `backend/services/autonomous_mission_service.py`: dispatch timeout 30 min, active timeout 4 hours
- `backend/main.py`: frame upload limit 25 MB, plate length 2-10 chars
- `backend/services/badge_service.py`: badge thresholds (60 min → hour_up, 100 det → sharp_eyes, etc.)
- `backend/routers/read_api.py`: default map bbox hardcoded to Carrollton GA area (`33.45-33.70, -85.25 to -84.95`)
- `backend/services/detection_agent.py:212`: `http://127.0.0.1:8000/autonomous/plan` (works because agent runs on same box as API)

### Changelog

**2026-06-21**
- Partnership deck: added slide 03 "Direct LEA Alert" (BOLO activation flow, June 11 Douglas County test)
- DJI MSDK V5 waypoint missions: KMZ generation implemented, `startWaypointMission` no longer stubbed
- Pause/resume mission capability for auto-relook on medium-confidence matches
- Sweep mission endpoint (`POST /autonomous/plan-sweep`): lawnmower parking lot scan
- Dynamic `droneEnumValue` based on connected aircraft ProductType
- Fixed: notification URL was hardcoded IP → now `https://amberangels.org`
- Fixed: SSO placeholder email `@sso.placeholder` → `@noemail.amberangels.org`
- Confirmed: Air 3 has no MSDK V5 support (DJI decision). Mini 4 Pro + RC-N2 is the target.
