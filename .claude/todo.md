# Pending TODO

### LinkedIn Presence
Post regularly as Amber's Angels. One founder story post (who we are, what we built, why) to establish the account, then milestone posts for CPD letter and App Store approval. Avoid repeated "go look at our page" links — each post should stand alone as content.

### RTMP Live View for Coordinators
nginx RTMP → HLS (`hls on; hls_path /tmp/hls; hls_fragment 2s;`) → serve `/tmp/hls/` auth-gated → mission map "Live Feed" button on active drone markers → `hls.js` player. Auth: short-lived signed URL token. Do alongside: nginx `on_publish` hook to snapshot pilot GPS at stream start → `stream_sessions` table → fixes loose 10-min telemetry fallback.

### Adaptive Scanning — Hierarchical Pipeline Plan (future)
Three stages: Stage 0 — YOLO-nano vehicle detection (~3fps, ~6MB TFLite/CoreML); Stage 1 — plate readability binary classifier (small CNN on vehicle bbox crop); Stage 2 — OCR only when plate readable. Adaptive interval: `lerp(2000ms, 400ms, bbox_area_fraction)`. First step (no native code): skip ALPR in `unified_worker.py` when `yolo_vehicles` empty; use YOLO bbox area to set `capture_interval_ms` dynamically. `CameraScreen.tsx` already consumes `capture_interval_ms` via recursive setTimeout on both the iOS and DJI paths — the client side of this is done, only the server-side dynamic-interval-from-YOLO-bbox part remains.

### BOLO Crawler Follow-Up (root cause fixed 2026-07-28, sources still need curation)
Root cause of "zero rows ever ingested" was **not** a parsing bug — `feedparser`/`beautifulsoup4`/`spacy` were listed in `requirements.txt` but `deploy.yml` never ran `pip install` for the backend, so every fetch hit the code's own `except ImportError` fallback and silently returned `[]`, for the entire life of the feature. `last_crawled_at` still updated every cycle, making it look healthy. Fixed: added `pip3 install --user -r backend/requirements.txt` to `deploy.yml`, and manually installed on the server (also had to `chown -R ambers-angels:ambers-angels ~/.local ~/.cache` first — that whole tree was owned by `www-data` from some earlier process, blocking the install; same class of bug as the documented root-owned-build-files incident, different culprit user).

Remaining work now that fetching actually runs:
- Of the 10 seeded `bolo_sources` URLs, only 2 (ALEA news, AL AG press releases) currently return real content. FBI (all 3 feeds) and GA GBI return 403; TN.gov resets the connection; FL FDLE, AL SBI, and the NCMEC pressreleases URL all 404. These sites likely added bot protection or moved pages since the URLs were seeded — need re-checking/replacing one by one, not a code fix.
- The NCMEC entry in `bolo_sources` is redundant with the dedicated 50-state `ncmec_poller.py`, which already works — consider dropping it from `bolo_sources` entirely.
- `bolo_extractor.py`'s `is_actionable()` gate accepts `(make AND model)` as one path to actionable, but `extract()` never populates `vehicle_model` anywhere — that branch is permanently dead code. Even once URLs are fixed, most "wanted person" press-release prose won't have a plate or a clean make+color+area combo either, since these sources describe people, not vehicles — worth a product call on whether vehicle-only BOLO extraction from person-wanted feeds is the right shape at all before investing more here.

### National Alerts Map
Mission map currently shows only vehicle-target FEMA alerts. All CAP event types already flow through the FEMA poller; they're discarded today if no plate/vehicle is extracted. Plan: add a `fema_alerts_log` table (event_code, headline, area, polygon, received_at) storing ALL alerts; `GET /fema/alerts/all` endpoint; map layer color-coded by type (red=AMBER, orange=Silver/Purple, yellow=CEM/fire/civil, blue=LEW/Blue Alert). Display-only, no new volunteer workflow — makes the mission map a national real-time CAP viewer.

### Public Discord Join Button
Only `aa-test` channel exists — internal only. Define public channel structure (alert-firehose + general chat) and get real invite link before adding button to `/guide` page.

### Store Distribution
- **`/beta` page** (`web/src/app/beta/page.tsx`): both install buttons have `href="#"` — need real iOS TestFlight public link and Android internal testing opt-in link (~300 unique visitors/day with no download path)
- **Google Play**: org policy blocks service account key (`iam.disableServiceAccountKeyCreation`). Manual path: download AAB from EAS → Play Console → Internal testing → upload → copy opt-in link → put on `/beta` page
- **Android package name** `com.ambersangels.app` registration required before September 2026 (hard deadline)
- **App Store badges**: add to landing page hero once iOS listing approved AND Android Play Store listing live; retire or repurpose `/beta` page

### CPD Letter of Support (waiting)
Once signed: add "Carrollton PD Partnership" badge to homepage hero, update "Actively engaging" → "In active partnership with Carrollton PD", add "Trusted by Law Enforcement" block, add partnership language to App Store description.

### App Store Build 4
In review as of June 2, 2026. When approved: update description to remove any "report criminal activity" language.

### BOLO Email Bridge
`bolo@amberangels.org` → GoDaddy alias → `info@amberangels.org` (Microsoft 365). **Current (manual):** BOLO arrives → save image → admin panel BOLO Ingestor → Claude Haiku extracts plate/vehicle → watchlist + Discord. **Automated path (built, not wired):** `POST /webhooks/bolo-email` accepts Mailgun/JSON `{body, image_b64}`. Would need Power Automate flow to POST to webhook. Not active — manual upload is the path.

### Update Decks for NamUs + BOLO Sources
After first confirmed NamUs hit (`grep "NAMUS BOLO" pm2 logs`), update all decks to show 5 ingestion sources: FEMA CMAS, FEMA EAS, NWS Alerts, NamUs (DOJ), LE BOLO (email bridge). Also add `bolo` to alert type lists in slides.

### Site Content Depth (Airo audit items 21–25)
AMBER Alert statistics (#21), data governance page (#22), pipeline explainer + glossary (#23), section anchor IDs on landing page (#24), impact metrics (#25 — blocked until pilot data).

### Analytics
GoAccess daily report at `https://amberangels.org/analytics/` (login: `amber` / password in `server_credentials.md`). Regenerated daily by `/etc/cron.daily/goaccess-report`. Log-based — daily unique IPs, top pages, referrers.

### Health Tracking
`backend/services/health_tracker.py` — `stamp("fema")` / `stamp("ncmec")` called after each poll cycle regardless of new alerts. Health endpoint reads from tracker for `last_fema_poll` / `last_ncmec_poll`.

### Data Retention Policy
Source column on `detection_events`, `watchlist`, `vehicle_targets`:
- `source='fema'/'ncmec'` — NEVER cleared by admin button; governed by scheduled TTL purges
- `source='worker'/'phone_mlkit'` — non-alerted detections purged at 30 days; alerted (evidence) at 365 days
- `source='manual'/'demo'` — cleared only by "Clear Test Data" button
- Alerted detection events (status='alerted') are NEVER deleted — they are evidence

### NCMEC Vehicle Extraction
`_VEHICLE_RE` and `_PLATE_RE` regexes in `ncmec_poller.py`. `vehicle_description` + `vehicle_plate` columns in `ncmec_cases`. Upsert uses `COALESCE` — existing data preserved across re-polls. Most RSS descriptions are minimal; "No vehicle data on file" shown when absent.

### Partnership Capabilities Deck
`web/public/decks/partnership.html` → `/deck/partnership`. CPD contacts: Deputy Chief Dobbs + Lt. Hitchcock. Outstanding: `POST /dispatch/cad` stub (needs CPD IT Motorola PremierOne/Tyler New World credentials); NCIC/GCIC access (requires signed MOU with CPD); evidence package export (`/admin/evidence/{mission_id}`) not yet built.

### `/guide` Page — Screenshot Work (in progress)
`web/src/app/guide/page.tsx` and `web/public/guide/*.png` are uncommitted — do not commit until resolved. **Privacy rule**: never show real NCMEC feed (real children's names) on this public page — use fictional names from `scripts/seed_demo.py` (Emma Johnson / Marcus Williams / Sofia Rodriguga). Still needed: Mission Map, Camera permission flow, Notifications, Drone Dispatch screenshots (capturing on iOS). Still needed: safe "Hits" data for Event Feed screenshot — do NOT run seed_demo.py or screenshot.mjs against production. Proposed: insert cosmetic rows into `detection_events` directly, delete after.

### Longer Term / Needs Config Only

- **Twilio SMS** — fully implemented, silently skips if env vars absent. Just needs `TWILIO_*` in server `.env`.
- **BVLOS waiver** — `bvlos_authorized` set by admin via `PATCH /autonomous/drones/{id}`. Must record FAA Part 107.39 waiver number before setting.
- **DJI MSDK iOS** — Kotlin module is Android-only. iOS DJI SDK requires macOS build machine. `Platform.OS !== 'android'` guard in place; iOS falls back to phone camera.
- **Background checks** — not implemented. Registration accepts anyone 18+ with FAA Part 107 cert.
- **LinkedIn company page** — not yet created. Right channel for CPD/grant/EM audience.
- **Board governance** — COI policy, board member agreements, meeting minutes not yet signed. Required before accepting grant money.
- **Evidence package PDF export** — detection timeline + GPS track + golden frames + chain-of-custody. Not built. Required for formal LE handoff.
- **County-scoped historical BOLOs** — partnership-unlocked feature only (dragnet risk without LEA direction + time-bounding). Must be volunteer-controlled opt-in.
- **Custom VMMC Model** — `https://github.com/grantl12/chadongcha-app` (backburner). EfficientNet-Lite B2 pipeline, TFLite/CoreML export. AA adaptation: only use confirmed-match frames (active alert vehicles, plates/faces blurred). Accumulate real capture data first.
