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

## Ops API — for Claude Code sessions that can't SSH out

The cloud "Code" tab sandbox (mobile app → Code tab) only has HTTPS egress —
no route to `157.245.125.103` on port 22. For those sessions, use
`backend/routers/ops.py` instead of plink: a small HTTPS API on the live
API server, gated by a static header key (not a pilot JWT — these are
agent sessions, not logged-in humans).

nginx strips `/api/` before proxying to FastAPI (see `location /api/` in the
site config), so every call below needs that prefix — `/ops/...` alone 404s
against the Next.js frontend, it does not reach the router.

```
curl -H "X-Ops-Key: $OPS_API_KEY" -H "X-Ops-Actor: mobile-emergency" https://amberangels.org/api/ops/health
curl -H "X-Ops-Key: $OPS_API_KEY" "https://amberangels.org/api/ops/logs/api?lines=300"
curl -X POST -H "X-Ops-Key: $OPS_API_KEY" -H "Content-Type: application/json" \
  -d '{"sql": "SELECT * FROM detection_events ORDER BY created_at DESC LIMIT 5"}' \
  https://amberangels.org/api/ops/query
curl -X POST -H "X-Ops-Key: $OPS_API_KEY" -H "Content-Type: application/json" \
  -d '{"process": "api"}' https://amberangels.org/api/ops/restart
curl -X POST -H "X-Ops-Key: $OPS_API_KEY" https://amberangels.org/api/ops/migrate
```

Verified live 2026-08-05: auth (wrong key → 403), a real `SELECT`, a bare
`DELETE` (rejected — invalid as a subquery), a CTE-smuggled `DELETE`
(rejected — Postgres refuses a data-modifying CTE not at top level), and a
real `worker` restart (restart count incremented, uptime reset).

- **`OPS_API_KEY`** — in Claude memory (`server_credentials.md`) and server `.env`. Send as `X-Ops-Key` header.
- **`X-Ops-Actor`** — optional free-text label, written to `audit_log` (action `ops.*`) with every call. Use it to note context (e.g. `mobile-emergency`, `mobile-idea`) — there's no other record of who/why triggered an ops call.
- **`GET /ops/health`** — `pm2 jlist` summary (status, restarts, memory/cpu per process).
- **`GET /ops/logs/{process}?lines=N`** — `process` ∈ `api`/`web`/`worker`/`rtmp-monitor`/`all`, `lines` capped at 2000.
- **`POST /ops/query`** `{"sql": "..."}` — **read-only, enforced by Postgres** (`SET TRANSACTION READ ONLY`), not by string-matching the query — a `WITH x AS (DELETE ...) SELECT * FROM x` fails the same as a bare `DELETE`. Query is also wrapped as a single subquery, so `...; DROP TABLE x` is a syntax error before READ ONLY even matters. Capped at 500 rows, 5s statement timeout.
- **`POST /ops/restart`** `{"process": "..."}` — `pm2 restart <name> --update-env`, same allowlist as logs. Backgrounded so self-restarting `api`/`all` doesn't kill the response mid-flight.
- **`POST /ops/migrate`** — runs `backend/run_migration.py` (idempotent).
- **Deliberately excluded: arbitrary shell exec, arbitrary (non-SELECT) SQL.** A bearer-key-gated RCE endpoint on a server holding AMBER-alert/missing-child data isn't worth it even for a real emergency. If an emergency doesn't fit these four actions, add another narrow named action to `ops.py` — don't turn this into a general command channel.
- If `OPS_API_KEY` is ever rotated, update both server `.env` and `server_credentials.md` — same PM2-cached-env gotcha as other secrets applies (delete+recreate `ambers-angels-api`, not just restart).

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

**PM2 crash watchdog** — `rtmp_monitor.py` checks `pm2 jlist` every 60s. If any process gains ≥5 restarts in one interval, it fires a Discord alert (max once per 30 min per process). The Discord `DiscordErrorHandler` in `discord_logger.py` only fires for errors inside a *running* API — it cannot catch import-time or module-level crashes.

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
- Before each build: bump `ios.buildNumber` in `app.config.js` ("3" → "4" → "5" etc.). Android's `android.versionCode` bumps independently for Play Store resubmissions — check both before assuming a number is current.
- Current build number: **20** iOS / **3** Android (as of 2026-08-05, uncommitted in working tree) — app.config.js is the source of truth, this number will drift; verify with `grep -n "buildNumber\|versionCode" mobile/app.config.js` before citing it
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

- Build 19 rejected 2026-08-04 (Guideline 2.5.4); build 20 fixes it, not yet submitted.
- Rejection history and resolutions:
  - **5.1.1(iv)**: Camera permission pre-prompt button text changed to "Continue"
  - **5.1.1(v)**: Account deletion added (`DELETE /auth/delete-account`). UI in Settings → bottom → "Delete Account" (two-tap confirm). Tell reviewers: *"Account deletion: Settings tab → scroll to bottom → Delete Account."*
  - **2.1 (law enforcement)**: Apple flags "report criminal activity" language. **Do not use that framing.** The app responds to existing government-issued FEMA alerts, it does not enable users to report crimes. Use: *"participate in active public safety searches," "respond to government-issued AMBER/Silver Alerts,"* not *"report criminal activity"* or *"alert law enforcement."* Submit CPD meeting screenshot as documentation while formal letter is pending.
  - **2.5.4 (build 19, 2026-08-04)**: `UIBackgroundModes` in `app.config.js` declared `location` and `fetch` with no feature behind either — no `TaskManager`/background location task/background fetch registration anywhere in the mobile app; only foreground location (`Location.watchPositionAsync` in `CameraScreen.tsx`) was ever implemented. Fixed in build 20: `UIBackgroundModes` trimmed to `["remote-notification"]` (the only one actually backed, by `NotificationServiceExtension`), and the unused `NSLocationAlwaysAndWhenInUseUsageDescription`/`NSLocationAlwaysUsageDescription` strings removed since nothing calls `requestBackgroundPermissionsAsync`. If background location/telemetry-while-backgrounded becomes a real feature later, re-add `location` to `UIBackgroundModes` only alongside the actual implementation — don't declare it ahead of the feature.

## Contact / Identity

- Public email: `info@amberangels.org` — use everywhere for all contact including privacy requests.
- EIN: 42-2052151 (501(c)(3) approved — determination letter received)
- Address: 103 Springwood Dr, Carrollton, GA 30117
- Pilot program: Carrollton, GA (not "Carroll County")

## Pitch Decks

Decks at `web/public/decks/`, served via Next.js iframe routes:

| File | Route | Purpose |
|---|---|---|
| `carrollton.html` | `/deck/carrollton` | Carrollton PD / community pitch |
| `grant.html` | `/deck/grant` | Grant writer / funder deck |
| `tech.html` | `/deck/tech` | Technical architecture deck |
| `volunteer-stories.html` | `/deck/stories` | Volunteer stories |
| `grant-bio.html` | `/deck/about` | About the Founder (Grant bio) |
| `partnership.html` | `/deck/partnership` | CPD formal partnership / future capabilities (13 slides) |
| `platform.html` | `/deck/platform` | Feature overview deck (9 slides) |

Speaker notes in `const NOTES = [...]` at top of each file. Update all relevant decks when architecture changes. Print versions at `grants/Handoff/amber-angels/project/` must be manually updated to match.

## Environment Variables (server `.env`)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://postgres:$DB_PW@127.0.0.1:5432/ambersangels` (see `server_credentials.md` in Claude memory) |
| `JWT_SECRET` | 64-char hex secret for HS256 JWT signing |
| `ALERT_WEBHOOK_URL` | Discord webhook URL for alert notifications |
| `INTERNAL_API_KEY` | Shared secret for worker → `/detections/` calls (`X-Internal-Key` header) |
| `OPS_API_KEY` | Shared secret for the `/ops/*` API (`X-Ops-Key` header) — see "Ops API" section above |
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
| `BOLO_WEBHOOK_SECRET` | Shared secret for `POST /webhooks/bolo-email` (see `server_credentials.md`) |
| `ANTHROPIC_API_KEY` | Required for BOLO ingestor (Claude Haiku vision) and email BOLO webhook |
| `NAMUS_POLL_INTERVAL` | NamUs poll frequency seconds (default 1800) |
| `NAMUS_RECENT_DAYS` | Days back to search NamUs cases (default 30) |
| `BOLO_CRAWL_INTERVAL` | BOLO crawler poll frequency seconds (default 900) |
| `BOLO_EXPIRES_DAYS` | Days before BOLO crawler vehicle_targets expire (default 7) |

---

@.claude/architecture.md
@.claude/critical-rules.md
@.claude/todo.md
