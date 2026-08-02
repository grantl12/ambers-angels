# Architecture Reference

## Alert Ingestion (5 active sources + 1 disabled + 1 non-functional)

1. **FEMA IPAWS CMAS** (`backend/services/fema_connector.py`) — CAP XML, 5-min poll via `fema_background_loop()`. Covers CAE (AMBER/Levi's), CEM (Silver/Mattie's/Purple/MIPA/EMA), LEW (Blue Alert). Extracts plates + vehicle profiles → `watchlist` + `vehicle_targets`, fires Discord + push. Cancellation: CAP `msg_type=Cancel` deactivates entries. **Dedup is DB-backed** via `processed_alerts` table — survives restarts.

2. **FEMA IPAWS EAS** (`backend/services/amber_alert_poller.py`) — same CAP XML via EAS endpoint. Runs in `amber_background_loop()` every 2 min. Shares `_seen_identifiers` with fema_connector.

3. **NWS Alerts API** (`backend/services/amber_alert_poller.py`) — `api.weather.gov/alerts/active` — catches WEA-distributed AMBER alerts that bypass FEMA CMAS (e.g. Georgia). `NWS_EVENT_MAP` maps event names to ALERT_REGISTRY keys.

4. ~~**amber.alert.gov**~~ — **DISABLED**. Hostname has no DNS record. `AMBER_GOV_URLS = []`.

5. **NCMEC RSS** (`backend/services/ncmec_poller.py`) — all 50 US states, 30-min poll. Persists cases in `ncmec_cases`. New case Discord fires ONLY when active FEMA vehicle target exists in same state — as of 2026-07-31 this also stages a row in `ncmec_pending_alerts` and pushes coordinators+admins to review it (`GET/PATCH /admin/ncmec-pending*` in `read_api.py`, review UI at `/admin/ncmec-review`); nothing reaches volunteers until a coordinator approves (gated by `require_bolo_creator`, same domestic-abuse safeguard as manual-alert/BOLO), which inserts the real `vehicle_targets` row and fires the normal watch-areas-based `_notify_watching_pilots` push. Resolved-case Discord/push (`_notify_resolved`/`_push_notify_resolved`) exists in code but is not currently called anywhere — the DB is still marked resolved, notification is silently a no-op. Initial state loaded from DB on startup to prevent re-firing old resolutions.

6. **BOLO crawler** (`backend/services/bolo_crawler.py`, `bolo_extractor.py`) — `bolo_sources` table has 10 sources (FBI Wanted RSS, NCMEC, GA GBI, TBI, FL FDLE, ALEA, AL SBI, AL AG), polled on `BOLO_CRAWL_INTERVAL`. Root cause of "zero rows ever ingested" found and fixed 2026-07-28: `feedparser`/`beautifulsoup4`/`spacy` were in `requirements.txt` but `deploy.yml` never ran `pip install` for the backend (only `npm ci` for web), so every fetch silently hit the code's own `except ImportError` fallback and returned `[]` — for the entire life of the feature. Fixed by adding a `pip3 install --user -r backend/requirements.txt` step to `deploy.yml`. Now that fetching actually runs, most of the 10 seeded source URLs turn out to be stale or bot-blocked (FBI/GBI 403, TN.gov connection reset, FDLE/ALEA-SBI/NCMEC-pressreleases 404) — only 2 of 10 currently return real content. See TODO: "BOLO Crawler Follow-Up".

## Frame Pipeline

- **Drone (RTMP)**: DJI MSDK V5 → RTMP to nginx port 1935 → ffmpeg → JPEG frames in `test_plates/<drone_id>/frame_NNNN.jpg` → `unified_worker.py` processes + deletes. **No GPS in RTMP payload** — backend looks up pilot's last telemetry (10-min window). Clean fix: nginx `on_publish` hook to snapshot location at stream start.
- **Android phone scan** (`ScanService.kt`): ML Kit OCR on-device, ~1.5s interval, 640×480. Text+GPS → `POST /ingest/detection`. Frame → `POST /ingest/frame` only on watchlist hit.
- **iOS phone scan** (`CameraScreen.tsx` + `PhoneCameraModule.swift`): Vision framework OCR on-device (build 16+). Text+GPS → `POST /ingest/detection`. Frame → `POST /ingest/frame` only on `watchlist_hit: true`.
- **DJI SDK camera** (`CameraScreen.tsx` drone path): every frame → `POST /ingest/frame`. Requires pilot JWT, 25 MB limit.
- **Worker** (`worker/unified_worker.py`): scans frame dirs, runs OpenALPR + YOLOv8-nano, posts to `POST /detections/` with `X-Internal-Key`.
- **On-device result endpoint** `POST /ingest/detection`: accepts plate_text + confidence + GPS, no image. **Quick direct DB watchlist lookup fires before aggregation** — returns `watchlist_hit: true` immediately. This is the fast path that triggers phone-side frame upload.

**Server-side preprocessing (not cloud calls):**
- `apply_clahe()` — OpenCV CLAHE contrast enhancement when ALPR < 70% confidence. In-process, no network.
- `enhance_alpr_results()` — OpenCV perspective deskew on plate crop, re-runs ALPR. No network.

**Plate Recognizer cloud API** — only external call in the detection pipeline. Fires when ALPR confidence ≥ 70% (`SINGLE_FRAME_HIGH_CONFIDENCE`). Sends frame crop for make/model/color enrichment.

**Claude Haiku** — NOT in the detection pipeline. Only used for email BOLO webhook (`POST /webhooks/bolo-email`).

**Auth notes (easy to break):**
- `POST /telemetry` — requires pilot JWT. If omitted, server returns 401 silently → location never appears on map.
- `GET /telemetry/latest` — requires pilot JWT. Returns only points from last 5 minutes.
- `POST /ingest/detection` — does NOT require JWT (`_optional_pilot` dependency). Android can scan without login.
- `POST /ingest/frame` — requires pilot JWT.

**Phone scan confidence boost:** Source `phone_gps`/`phone_mlkit` + watchlist hit → confidence overridden to `max(raw, 93.0)`. One frame typically reaches HIGH_CONFIDENCE immediately.

**Phone scan → Discord:** Non-hit phone scans never upload a frame. Discord hit messages for phone scans include the evidence frame. Text-only detection path will not have frame attachments.

## Confidence Scoring

Detection pipeline uses composite scoring (`aggregation_service.py`):
- OpenALPR raw confidence (max, mean, median over 5-second window)
- Repetition bonus: +5 pts at ≥2 hits, +10 pts at ≥3 hits in window
- Consistency bonus: +5 pts if dominant plate ratio ≥ 75%
- Vehicle corroboration: up to +14 pts from YOLO color + body type + CDC generational label match
- Bayesian prior bonus: log2 scale — alert type × vehicle type (e.g. minivan during AMBER ≈ +7 pts)
- Quality penalty: up to -15 pts if every frame has blur/skew/partial flags
- Vehicle mismatch penalty in EventService: -12 pts color mismatch, -8 pts type mismatch
- Thresholds: PROBABLE ≥ 75 + ≥2 detections; HIGH_CONFIDENCE ≥ 85 + ≥3 detections
- HIGH_CONFIDENCE triggers Discord + optional SMS (Twilio); PROBABLE also triggers Discord
- 5-second window is a DRONE concern. Phone path has fast-path direct DB lookup bypassing the window.

### CDC Classifier (Cascade Stage 2)

- `backend/services/cdc_classifier.py` — MobileNetV3 ONNX, fine-grained make/model/generation labels (e.g. "Toyota_Camry_XV70"). Called from `vehicle_classifier.py` after each YOLO detection.
- Model path via `CDC_MODEL_PATH` env var, defaults to `DEFAULT_CDC_ROOT / "vehicle_classifier.onnx"`. **Not deployed to the server** — `cdc_classifier.py` gracefully degrades (returns `None`) when the model file is absent.
- Dataset was DDG-scraped with quality issues (skewed toward rare/cool cars). Needs a purposeful rebuild before retraining. Current use is a verification layer ("is this actually a sedan?"), not primary classification.
- Plate Recognizer called only at ALPR ≥ 70% — adds make/model to vehicle corroboration

## Role Matrix

| Role | Can do |
|---|---|
| **Pilot** | Register, upload frames, join missions, view detections |
| **Coordinator** | All pilot actions + review detections, manage watchlist, dispatch drones (if `can_dispatch_drones = true`) |
| **Admin** | Everything + approve users, set roles, set `can_dispatch_drones`, inject test alerts |

Coordinator access: pilot requests via `POST /auth/request-coordinator` → admin approves via `POST /auth/approve-coordinator/{username}`.
Dispatch permission: admin sets via `POST /auth/admin/pilots/{username}/permissions` with `{"can_dispatch_drones": true}`.

## Autonomous Drone Swarm

**The "relinquish to swarm" flow:**
1. Pilot powers on drone, opens AutonomousMissionScreen, app sends heartbeat (`POST /autonomous/drones/{id}/heartbeat`) every 30s
2. Coordinator selects drone + observation point → `POST /autonomous/plan` → `pending` mission
3. Pilot taps "Accept & Launch" → DJI SDK uploads waypoints and executes

**FAA operational tiers** (enforced at plan creation):
- `vlos` — Part 107 standard; waypoints within `drone.vlos_radius_m` (default 400m) of home
- `bvlos_tactical` — Part 107 BVLOS waiver; requires `drone.bvlos_authorized = true`
- `bvlos_autonomous` — Part 108 placeholder; same auth gate

**Mission status lifecycle:** `pending → dispatched → uploading → executing → relook → completed | aborted | failed`

Both `executing` and `active` are accepted (mobile emits `executing`; backend treats identically).

**Mission timeout cleanup** (`mission_timeout_loop`, 5-min interval):
- `pending/dispatched/uploading` > 30 min → `failed`
- `executing/active` > 4 hours → `failed`

**Mission types:**
- **Observation post** (`POST /autonomous/plan`): single-waypoint hover with live ALPR/YOLO stream.
- **Sweep** (`POST /autonomous/plan-sweep`): lawnmower pattern, 15m altitude, 3 m/s. VLOS enforced on all waypoints.

**Auto-relook** (sweep): worker detects medium-confidence match → `POST .../relook` → drone hovers → evaluates 3-5 sharp frames → HIGH_CONFIDENCE fires alert or times out → mission resumes automatically.

**DJI MSDK V5 waypoint implementation:**
- KMZ file: WPML XML → ZIP → pushed to aircraft via `WaypointMissionManager`. `droneEnumValue` is dynamic (reads `ProductType`).
- Safety: `exitOnRCLost=executeLostAction`, `executeRCLostAction=goBack`. RTH height = mission altitude + 20m.
- Phone disconnect does NOT stop mission — KMZ runs on the flight controller.

**DJI MSDK V5 supported drones:** Mini 4 Pro (primary, requires RC-N2), Mini 3/3 Pro, Mavic 3 series, Mavic 3 Enterprise, M30/M30T/M300 RTK/M350 RTK/Matrice 4. **Air 3 is NOT supported** — DJI confirmed no SDK access. Avata: FPV only, no waypoints.

## Security

- All endpoints require JWT except `GET /health`, `GET /`, `POST /auth/register`, `POST /auth/login`
- `POST /fema/test` requires admin JWT; `POST /ingest/frame` requires pilot JWT
- `POST /detections/` requires `X-Internal-Key` header (worker) OR pilot JWT
- CORS restricted to `https://amberangels.org`, `https://www.amberangels.org`, `http://localhost:3000`, `http://localhost:19006`
- SSL: all httpx clients use certifi. `apps.fema.gov` has incomplete cert chain — `verify=False` scoped to that host only.
- ToS gate: `TosGateScreen` blocks app until user accepts `CURRENT_TOS_VERSION`. Recorded via `POST /auth/tos/accept`, checked via `GET /auth/tos-status`.

## Key Files

**Backend**
- `backend/main.py` — FastAPI entry, routers, lifespan background tasks (FEMA, NCMEC, amber poller, mission timeout loop)
- `backend/routers/auth.py` — registration, SSO, coordinator request, account deletion, ToS accept/status
- `backend/routers/alerts.py` — watchlist management, alert cancellation pipeline
- `backend/routers/autonomous.py` — autonomous mission plan/dispatch/status, drone registry, heartbeat
- `backend/routers/read_api.py` — detections feed, telemetry, watchlist reads, alerts history
- `backend/services/fema_connector.py` — FEMA IPAWS polling, plate extraction, vehicle target matching, Discord notifications
- `backend/services/amber_alert_poller.py` — EAS endpoint poll (amber.alert.gov disabled)
- `backend/services/ncmec_poller.py` — 50-state NCMEC RSS poll, cross-reference notifications
- `backend/services/autonomous_mission_service.py` — mission CRUD, `expire_stale_missions()`, `mission_timeout_loop()`
- `backend/services/waypoint_generator.py` — `generate_observation_point()`, `generate_lawnmower()`, `check_vlos_radius()`
- `backend/services/alert_dispatcher.py` — HIGH_CONFIDENCE Discord + Twilio SMS dispatch
- `backend/services/discord_logger.py` — `DiscordErrorHandler`; posts ERROR/CRITICAL to Discord webhook. 30-min dedup. Daemon-threaded.
- `backend/services/audit.py` — `write_audit_sync` / `write_audit_async`; writes to `audit_log`. Fire-and-forget.
- `backend/run_migration.py` — run after any DB schema change
- `backend/services/event_service.py`, `event_repository.py` — detection event persistence
- `worker/unified_worker.py` — RTMP frame scanner, ALPR + YOLO, posts to `/detections/` with `X-Internal-Key`

**Web**
- `web/src/app/page.tsx` — landing page (NO auth redirect — always serves public landing)
- `web/src/components/LandingPage.tsx` — public marketing page
- `web/src/app/map/page.tsx` — mission map (FEMA alert polygons, drone positions, detection feed)
- `web/src/app/admin/page.tsx` — admin panel: user approval, coordinator management, `can_dispatch_drones` checkbox
- `web/public/decks/` — deck HTML + assets. Speaker notes in `const NOTES = [...]` at top of each file.

**Mobile**
- `mobile/app.config.js` — Expo config, build numbers, all mobile config
- `mobile/src/screens/TosGateScreen.tsx` — full-screen blocking ToS gate
- `mobile/src/screens/SettingsScreen.tsx` — pilot settings, watch areas, coordinator request, sign out, account deletion
- `mobile/src/screens/AutonomousMissionScreen.tsx` — swarm heartbeat, accept/monitor drone missions
- `mobile/src/screens/CameraScreen.tsx` — phone camera mode, frame upload
- `mobile/src/api/client.ts` — base API client (`apiGet`, `apiPost`, `apiPatch`, `apiDelete`)
- `mobile/src/api/autonomous.ts` — autonomous mission API calls (must use `getApiBaseUrl()`, not hardcoded IP)
- `mobile/src/api/tos.ts` — `fetchTosStatus`, `acceptTos`, `CURRENT_TOS_VERSION`
- `mobile/modules/dji-camera/` — DJI MSDK V5 Kotlin native module + TS bridge
- `mobile/modules/dji-camera/waypoint-mission.ts` — `startWaypointMission`, `stopWaypointMission`, `getMissionStatus`, `returnToHome`, `getBatteryLevel`
- Registration opens in Safari View Controller (not WebView) — required by App Store Guideline 4

## DB Tables

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
