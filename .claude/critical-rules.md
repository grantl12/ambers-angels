# Critical Rules — Things That Break Silently

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

**Demo inject endpoint — always use an admin UI, not plink — and there are two of them (corrected 2026-07-28)**
`POST /fema/test` just polls the real FEMA feed — it does NOT create a synthetic alert. There are two separate inject paths, not one:
- **Web admin** (`web/src/app/admin/page.tsx`, "Test Alert Criteria" form) → `POST /admin/manual-alert` (`read_api.py`). This is the more complete path: geocodes `area` via Nominatim (`_geocode()`), draws a real bbox polygon + `centroid_lat/lng` on `vehicle_targets`, supports a `is_demo` flag (preserved across "Clear Test Data"), and fires the same push/Discord pipeline as a real alert. Entries land under "Active test alerts" in the same page and are individually deletable via `DELETE /admin/manual-alert/{plate|vehicle/{id}}`.
- **Mobile admin screen** (`AdminScreen.tsx`, "On-Device OCR Test" button) → `POST /admin/inject-alert` (`main.py`). Simpler/older path, hardcoded to `area: "Carrollton, GA"`. No geocoding — `centroid_lat/lng` now default to the Carrollton pilot-area center (33.5801, -85.0766) when the optional `lat`/`lng` fields are omitted, added 2026-07-28 so map fly-to isn't a no-op for these test alerts. Both paths write `source_program='manual'`, so both show up in / are removable from the web admin's manual-alert list regardless of which UI created them.
Never call either endpoint via plink/curl for a real demo — always go through one of the two UIs so the entry is tracked and cancellable without direct SQL.

**`autonomous.ts` API base URL**
`mobile/src/api/autonomous.ts` must use `getApiBaseUrl()` from `client.ts`, not a hardcoded IP. The server is behind nginx on port 443 (HTTPS). Port 8000 is blocked externally by firewall. Any hardcoded `http://157.245.125.103:8000` will fail for external clients.

**Google SSO redirect URI**
`mobile/src/screens/LoginScreen.tsx` uses `Google.useAuthRequest` with `redirectUri: "https://auth.expo.io/@ambersangels/ambers-angels"`. This exact URI must be registered in Google Cloud Console. The EAS account is `ambersangels` (with 's').

**Mobile `client.ts` 401 handling**
`mobile/src/api/client.ts` registers a session-expired handler via `registerSessionExpiredHandler`. `App.tsx` must call `registerSessionExpiredHandler(() => setAuthed(false))` in a `useEffect`. And `resetSessionExpiredState()` must be called in `handleLogin()` to re-arm after a fresh login. Without this, 401s from a stale JWT silently fail instead of logging the user out.

**nginx RTMP stat endpoint**
Added `/rtmp-stat` location to `/etc/nginx/sites-enabled/telemetry` (default server). The backend health endpoint (`GET /health`) queries `http://127.0.0.1/rtmp-stat` to count active RTMP streams via XML. `rtmp_feeds.active` = number of `<stream>` elements in the `<live>` application. Do NOT use `pgrep -f "rtmp://..."` — the ffmpeg processes use `rtmp://localhost/` so pgrep never matched.

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
3. Point camera at plate "YVJ024" → phone uploads frame → `POST /ingest/frame` → ALPR → AggregationService → EventService → dispatch_alert → Discord hit fires with frame thumbnail
4. Discord embed shows: Alert type (AMBER), Plate (YVJ024), Confidence (%), Detection source, Location (GPS from phone telemetry)
5. Stats from June 7 test: 47s end-to-end, 99% peak confidence, sub-meter GPS, 23 frames to first hit
6. To reset: admin "Clear Test Data" button, or SQL above. Detection events with status='alerted' are kept (evidence).

**Never build as root on the server**
Never run `npm ci`, `npm run build`, or any build command directly as root in the web directory. Running as root creates root-owned files (`node_modules/`, `.next/`) that the deploy script (running as `ambers-angels`) cannot `rm -rf`, so `set -e` kills the deploy mid-run — leaving `node_modules` deleted but the web process stopped. This happened twice in the same incident (2026-06-26), taking the site down both times, and again on 2026-07-27 when a root-owned `web/src/app/guide/` directory blocked a `git pull` for two consecutive deploys. Always prefix build commands with `su -l ambers-angels -c "..."` when SSH'd in as root:
```
plink ... root@157.245.125.103 'su -l ambers-angels -c "cd /home/ambers-angels/proj_dir/ambers-angels/web && npm ci && npm run build"'
```
If you find root-owned files blocking a deploy, `chown -R ambers-angels:ambers-angels` them back before retrying — don't just force through as root.

**PM2 caches env vars from initial `pm2 start` — `restart --update-env` is not enough**
PM2 captures the shell environment at `pm2 start` time and persists it in its dump file. `load_dotenv(override=False)` (Python default) won't overwrite an existing env var PM2 already injected. Discovered during the 2026-06-22 DB password rotation — the API stayed "degraded" through 3 restart cycles because PM2 kept injecting the old `DATABASE_URL`. When rotating any credential or adding a new env var a process reads, `pm2 delete <name>` then `pm2 start` fresh (not just restart), then `pm2 save`. The worker also needs `PYTHONPATH=.../openalpr/src/bindings/python` set in the shell at `pm2 start` time.

**Verify mobile builds on a real device/emulator before trusting "root cause found"**
A plausible, correctly-diagnosed root cause is not proof it's the *only* bug. On 2026-07-17, an Android build failing for Play Store testers was traced to a stale versionCode — true and worth fixing, but sideload-testing the "fixed" build anyway surfaced a second, unrelated bug (a malformed `AndroidManifest` `<meta-data>` tag causing `INSTALL_PARSE_FAILED_MANIFEST_MALFORMED`). Uploading without that verification step would have failed again. Treat "found a bug and fixed it" as a hypothesis until the actual artifact has been installed and opened on a device, especially before any App Store/Play Store submission.

**`workflow_dispatch` requires the workflow file to exist on `main`**
A GitHub Actions workflow with a `workflow_dispatch` trigger only shows up / can be triggered via API or the Actions tab UI once that workflow file is present on the repo's default branch. A workflow that only exists on a feature branch returns 404 when you try to dispatch it manually. Always push new workflows to `main` before trying to trigger them by hand.

**No new Anthropic API calls for new agent features**
The detection agent (`detection_agent.py`) already uses the Claude API; don't default to it for additional AI features (QA chatbot, calendar agent, etc.) on a self-funded nonprofit budget. Prefer local/open-source inference. Only reach for Anthropic again when there's a clear technical reason no local model can do the job, or the user explicitly asks for it.

**Coordinator/BOLO permission gate is a domestic-abuse safeguard, not bureaucracy**
`can_create_bolo` and the admin-approval flow (`POST /auth/approve-coordinator/{username}`) exist because the threat model is someone falsely claiming LEO status, getting coordinator access, and putting a real person's plate on the watchlist to weaponize the volunteer network against them. Discord fires on every coordinator request (`_notify_coordinator_request` in `auth.py`) so this can't happen silently. Do not build self-service coordinator onboarding or public BOLO-activation marketing without first adding LEA identity verification (agency email domain or CJIS cert) — the current gate (admin approval + permission flag) is a stopgap, not the final control.

**Blog post byline dates drift ~1 week ahead of the publish schedule**
Every unpublished post's standalone HTML file (`web/public/blog/post-N-*.html`) has a byline date that doesn't match the scheduled date in `web/src/app/blog/page.tsx`'s `POSTS` array — consistently about a week later (confirmed on post-4 and post-5, same pattern both times). When flipping a post's `live` flag to `true`, always grep the HTML file for `By Grant Lindberg` and fix the byline date to match today's actual publish date / the `page.tsx` `date:` field. Also add a "What's New" entry in `page.tsx`'s `WHATS_NEW` array announcing the post.

**Known Hardcoded Values (intentional — tune from real-world data)**
- `backend/services/aggregation_service.py`: `RAW_DETECTION_FLOOR=55`, `SINGLE_FRAME_HIGH_CONFIDENCE=70`, `HIGH_CONFIDENCE_EVENT_MIN_SCORE=85`
- `backend/services/event_service.py`: `ALERT_COOLDOWN_SECONDS=120`, `REOPEN_WINDOW_SECONDS=300`
- `backend/routers/auth.py`: `JWT_EXPIRE_DAYS=30`, `RESET_CODE_EXPIRY_MINUTES=30`
- `backend/services/autonomous_mission_service.py`: dispatch timeout 30 min, active timeout 4 hours
- `backend/main.py`: frame upload limit 25 MB, plate length 2-10 chars
- `backend/services/badge_service.py`: badge thresholds (60 min → hour_up, 100 det → sharp_eyes, etc.)
- `backend/routers/read_api.py`: default map bbox hardcoded to Carrollton GA area (`33.45-33.70, -85.25 to -84.95`)
- `backend/services/detection_agent.py:212`: `http://127.0.0.1:8000/autonomous/plan` (works because agent runs on same box as API)
