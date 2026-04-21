# Amber's Angels

**A volunteer-driven public safety platform using cameras, license plate recognition, and real-time coordination to help bring missing and abducted children home.**

Amber's Angels is a 501(c)(3) nonprofit that coordinates volunteers in response to active AMBER Alerts and other missing-persons emergencies. When an alert is issued, volunteers in the affected area join the search — whether by launching a drone or simply mounting their phone on their car's dashboard and driving the search area. Either way, the app streams frames to the server for live license plate recognition and vehicle identification. Detections are cross-referenced against the alert's suspect vehicle profile in real time and escalated immediately to mission coordinators — without storing raw video footage, without building searchable databases of innocent people, and without collecting any data beyond what is operationally necessary to support the search.

---

## Mission

Every hour a child is missing, the chances of a safe recovery decline. Amber's Angels exists to close the gap between when an alert is issued and when boots are on the ground and rotors are in the air. Our volunteers donate their time, equipment, and expertise because they believe technology can save lives when it is deployed responsibly, transparently, and in partnership with law enforcement. Drone pilots with FAA Part 107 certification are welcome and encouraged, but a license is never a prerequisite — a smartphone and a car mount are all it takes to join a search.

---

## Who We Serve

- **Missing children** — our primary mission. We respond to AMBER Alert, Levi's Call, and equivalent state-level child abduction emergency programs.
- **At-risk adults** — we also respond to Silver Alerts (missing seniors), Mattie's Call (missing at-risk adults), and Purple Alerts (missing persons with developmental disabilities).
- **Law enforcement and emergency coordinators** — we act as a force multiplier, not a replacement. Every match is reviewed by a human coordinator before escalation.
- **Volunteer pilots** — we provide the infrastructure, training resources, and mission coordination that lets individual pilots contribute meaningfully.

---

## How It Works

1. **Alert ingestion** — The platform polls the FEMA IPAWS feed every five minutes. When a qualifying alert fires, the suspect vehicle profile (plate, color, make, body type) and the search polygon are automatically extracted from the CAP XML, written to the watchlist, and loaded into the mission system.

2. **Volunteer dispatch** — Approved volunteers in the affected area are notified. They connect via the mobile app — whether launching a drone or simply mounting their phone in their car's dashboard holder and driving the search area.

3. **Real-time detection** — Frames from the camera are processed using OpenALPR (plate recognition) and YOLOv8 (vehicle classification). Each detection produces a **composite confidence score** that combines plate-read quality across multiple frames with independent YOLO evidence about the vehicle's color and body type. A plate read alone is not enough — the system asks *is this also the right kind of car?*

4. **Vehicle corroboration** — For each watchlist hit, YOLO's detected color and body type are compared against the expected vehicle profile parsed from the original FEMA alert text. The Discord notification shows the full verdict: plate confidence, what YOLO saw, and whether it matches the suspect vehicle description.

5. **Coordinator notification** — On a match, a Discord alert fires instantly to the mission coordinator channel with plate text, confidence breakdown, GPS coordinates, vehicle description, and the attached frame image.

6. **Mission debrief** — After the mission, coordinators and volunteers review detection statistics, coverage, and alert history through the web dashboard.

---

## You Don't Need a Drone

One of the most important design decisions we made: **the platform works with any camera that can run our mobile app.** You do not need an FAA license, a $1,500 drone, or technical expertise to contribute.

If you have a smartphone and a car mount, you are already equipped. Mount your phone on your dashboard, open the Amber's Angels app, tap **START MISSION**, and switch to your navigation app. The app's background service keeps the camera running and uploading frames even when AA is not the active screen — a persistent notification shows the live frame count and a one-tap Stop button. Your GPS location is transmitted alongside every frame, so coordinators can see your coverage on the mission map.

**Volunteer modes:**
- 🚁 **Drone pilot** — aerial coverage, best for wide search areas and terrain that's hard to access by road
- 🚗 **Vehicle-mounted phone** — ground-level coverage along roads and parking lots, no special equipment or certification required
- 📱 **Both** — many of our volunteers do both depending on the mission

---

## Detection & Scoring Pipeline

The platform's core capability is not just reading plates — it is deciding, with calibrated confidence, whether a particular vehicle in a particular frame is the one that matters.

### Composite Confidence Score

Every detection produces an `aggregate_confidence` value (0–99) built from two independent signals:

**1. ALPR signal (plate text quality)**

| Component | Weight |
|---|---|
| Highest single-frame ALPR confidence | 50% |
| Mean ALPR confidence across all frames | 30% |
| Median ALPR confidence across all frames | 10% |
| Repetition bonus (+5 / +10 for 2 / 3+ frames) | additive |
| Consistency bonus (+5 if ≥75% of reads agree) | additive |
| Quality penalty (blur, skew, partial plate, etc.) | subtractive |

**2. YOLO vehicle corroboration**

YOLO independently observes the vehicle in every frame. Its contribution to the composite score:

| Signal | Max contribution |
|---|---|
| Color consistency (+2 if ≥75% of frames agree on color) | +2 pts |
| Body-type consistency (+2 if ≥75% of frames agree on type) | +2 pts |
| YOLO detection confidence signal `(avg_conf − 0.5) × 6` | ±3 pts |

The YOLO contribution is intentionally small — ALPR dominates because the plate is the primary identifier. But a consistently high-confidence vehicle detection that agrees across frames adds meaningful corroboration, while a weak or inconsistent YOLO signal (e.g. a partially visible vehicle seen at a bad angle) pulls the score down slightly. This prevents a sharp ALPR read on a blurry or ambiguous vehicle from scoring unrealistically high.

The full breakdown is stored in `raw_summary.vehicle_corroboration` on every detection event, so coordinators can inspect exactly what contributed to the score.

### Vehicle Profile Matching

When FEMA issues an alert — "blue 2018 Honda sedan, plate ABC1234" — our connector parses the alert text and stores the vehicle profile alongside the plate in the watchlist. When a drone or phone camera later detects plate ABC1234, the system:

1. Looks up the watchlist entry and retrieves the expected vehicle profile
2. Compares YOLO's detected color and body type against the expected values
3. Computes a `color_match` and `type_match` verdict (True / False / None if no expectation)
4. Appends the result to the Discord alert embed

The Discord notification tells coordinators not just *which plate was seen* but whether the vehicle it was attached to looks right:

```
Vehicle (YOLO)   blue car  ✓ matches profile
Vehicle (YOLO)   red truck  ⚠️ profile expects blue sedan
Vehicle (YOLO)   blue car  (no profile on file)
```

A plate match with a mismatched vehicle description prompts additional verification before escalation — the system surfaces the discrepancy rather than hiding it behind a single number.

### FEMA Alert → Watchlist

When an AMBER Alert, Silver Alert, or other qualifying alert is ingested from FEMA IPAWS, the connector:

1. Parses the CAP XML for plate numbers and vehicle description (color, body type, make)
2. Writes the plate to the watchlist with the full vehicle profile attached
3. Stores a separate `vehicle_targets` record for alerts where no plate was found, so YOLO-only matching can still trigger a notification
4. On re-poll, uses `COALESCE` upsert logic so an existing bare-plate entry gets backfilled with vehicle profile data if a later poll provides it

---

## Platform Features

### Alert Coverage
Monitors all national missing and endangered person alert programs via FEMA IPAWS:

| Program | Population served |
|---|---|
| AMBER Alert / Levi's Call | Abducted children |
| Silver Alert | Missing seniors |
| Mattie's Call | Missing at-risk adults |
| Purple Alert | Missing persons with developmental disabilities |
| Blue Alert | Missing or endangered law enforcement officers |
| MIPA | Missing Indigenous persons |
| EMA | Endangered Missing Advisory |

### License Plate Recognition
- Frame analysis via OpenALPR (local, no third-party transmission of raw frames)
- High-confidence frames optionally enriched via Plate Recognizer cloud API (opt-in, quota-conserving)
- Fuzzy matching handles OCR confusions (O/0, I/1, B/8, S/5, Z/2, G/6) and single-character insertions/deletions
- 5-second aggregation window groups multi-frame detections before scoring and alerting
- Composite confidence score incorporating both ALPR quality and YOLO vehicle corroboration

### Vehicle Identification
- YOLOv8 (nano) classifies body type (car, truck, motorcycle, bus) and extracts dominant color via K-means clustering in HSV space
- Color sampled from the upper 60% of the bounding box to exclude plate and wheel areas
- YOLO confidence and cross-frame consistency feed directly into the composite score
- Vehicle profile from FEMA alert text compared against YOLO detections at alert time
- Partial-profile alerts (no plate found) matched by color + body type via the `vehicle_targets` table

### Mission Map
Live Mapbox dark-mode dashboard:
- Real-time drone positions with animated markers and flight trail
- Active FEMA alert polygons with alert-type color coding
- Detection markers (amber = detected, red = watchlist hit)
- Detection density heatmap
- Flock ALPR fixed-camera positions with coverage polygons
- Out-of-range warning when a drone exceeds the pilot's configured distance from the active search area

### Tiered Access & Roles

Three roles with distinct access levels, managed from the admin console:

| Role | Access |
|---|---|
| **Pilot** | Mission map, camera capture, detection feed, personal stats |
| **Coordinator** | All pilot access + coverage map with bucketed camera density — suitable for law enforcement demos and operational briefings |
| **Admin** | Full platform access: pilot approval, role management, test alert injection, system health, raw Flock camera data |

Coordinators see a heatmap of ALPR camera coverage broken down by zone (bucketed "0 / 1–3 / 4+" cameras per cell — never exact counts, never positions), derived flight priority zones, and live volunteer positions. Raw Flock camera coordinates never leave the server. Admins can promote or demote any pilot's role at any time from the admin console.

### Flight Priority Zones

When an active search area is live, the platform computes a grid of recommended flight zones based on Flock Safety fixed-camera coverage:

- Cells with **zero** fixed-camera coverage → **high priority** (red overlay on map)
- Cells with **low** coverage (1–3 cameras) → **medium priority** (amber overlay)
- Well-covered cells are omitted — no need to duplicate existing infrastructure

Pilots see color-coded zone overlays on the mission map with a compass-direction label ("Northwest sector"). The coverage reasoning is intentionally opaque to pilots — they see where to fly, not why. Coordinators and admins see the full bucketed coverage map for briefings and demos.

### Pilot Portal & Accounts
- Multi-step registration with FAA certification tracking
- Admin approval workflow with role assignment — no pilot accesses mission data without vetting
- Role selector on the approval card (approve as Pilot, Coordinator, or Admin in one step)
- Active Pilots panel for live role management of already-approved volunteers
- JWT authentication with 30-day tokens
- Push notification on account approval (Expo)
- Profile page with personal mission stats (flight time, detections, missions)

### Mobile App (Android + iOS)
- Expo bare workflow + TypeScript, built via EAS cloud (no Mac required)
- **Background scanning** — Android Foreground Service keeps Camera2 + GPS + upload running while the user drives with another app open; no need to keep AA visible
- Phone camera capture at configurable interval → server-side ALPR + YOLO
- GPS telemetry at ~1 Hz for live tracking
- Out-of-range notification when volunteer leaves the active search polygon
- Server URL configurable from the login screen — no login required to connect
- Login screen, mission map (with priority zone overlay), detection feed, settings
- Phase 2: DJI Mobile SDK v5 (5.17.0) bindings for Mavic 3, Mini 4 Pro, Air 3, Avata

### Gamification & Volunteer Recognition
- Ranked pilot leaderboard (flight hours, detection count, missions flown)
- Mission debrief reports for each completed mission
- Foundation for achievement badges and milestone recognition (in development)

### Operational Controls
- Admin console: pilot approval, test alert injection, mission start/end
- Alert history log of every notification dispatched
- Manual watchlist management for multi-agency coordination
- Rate-limited authentication (brute-force protected)

---

## Privacy & Data Handling

We built privacy in from the start, not as an afterthought.

- **No video archive.** Raw frames are deleted immediately after processing. Nothing is stored.
- **Minimum data.** We collect only what is operationally necessary: GPS telemetry during missions, license plate reads, and pilot account information.
- **Short retention windows.** Telemetry is purged after 90 days. Detection records after 1 year. See our full [Data Retention Policy](https://ambersangels.org/retention).
- **No third-party data sales.** We do not sell, rent, or share personal data with advertisers or data brokers under any circumstances.
- **Transparent watchlist.** The platform only flags vehicles that match an active government-issued alert. It does not build or maintain its own persistent database of plate sightings.
- **Volunteer-only access.** The dashboard, detection data, and pilot portal are accessible only to approved, identity-verified volunteers.

Full policies: [Privacy Policy](https://ambersangels.org/privacy) · [Terms of Service](https://ambersangels.org/terms) · [Data Retention Policy](https://ambersangels.org/retention)

---

## Technology Stack

| Layer | Technology |
|---|---|
| Backend API | Python / FastAPI / PostgreSQL |
| License plate recognition | OpenALPR (local) + Plate Recognizer (cloud, optional) |
| Vehicle classification | YOLOv8 (Ultralytics) |
| Web dashboard | Next.js 14 / Tailwind CSS / Mapbox GL |
| Mobile app | Expo (React Native) / EAS Build |
| Alert ingestion | FEMA IPAWS CAP/XML feed |
| Notifications | Discord webhooks · Expo push (device alerts) |
| Process management | PM2 |
| Reverse proxy / TLS | nginx + Let's Encrypt (Certbot) |
| Infrastructure | DigitalOcean (self-hostable on any Linux VPS) |

---

## Architecture

```
Drone (RTMP stream)    Phone Camera (background service)    DJI SDK (phase 2)
        |                          |                               |
        v                          v                               v
  nginx exec_push          POST /ingest/frame  ←────────── Mobile App (Expo)
  → JPEG frames/drone/                |
        |                            |
        └──── Unified Worker ────────┘
              (shared frame queue, one process, all sources)
                            |
                            v
              OpenALPR (plate text + confidence)
              YOLOv8   (body type + color + yolo_conf)
              Plate Recognizer (make/model, cloud, high-conf only)
                            |
                            v
              AggregationService
                ├── ALPR composite (max/mean/median + bonuses/penalties)
                └── YOLO corroboration (color consistency, type consistency, conf signal)
                            |
                            v
              EventService → watchlist fuzzy match
                            |
                            v
              Vehicle profile comparison
                (YOLO detected color/type vs. FEMA alert expected profile)
                            |
                       ┌────┴────┐
                       v         v
                  PostgreSQL   Discord Webhook
                               ├── Plate + confidence
                               ├── Frame image attachment
                               └── Vehicle match verdict
                                   (✓ matches / ⚠️ mismatch / no profile)
                       |
                       v
              Next.js Dashboard  ←── Pilot web browsers

FEMA IPAWS Poller (every 5 min, background async task)
        ├── Parses CAP XML for plates + vehicle profile (color, body type, make)
        ├── Watchlist (plate + vehicle profile written together)
        ├── Vehicle targets (color/type/make for no-plate alerts, YOLO-matched)
        └── Search polygon (for drone proximity warnings + pilot notifications)
```

---

## Repository Layout

```
ambers-angels/
├── backend/
│   ├── main.py                   # FastAPI app + ingestion endpoints
│   ├── schema.sql                # Database schema + additive migrations
│   ├── routers/
│   │   ├── read_api.py           # Dashboard data endpoints + mission management
│   │   └── auth.py               # Pilot registration, login, approval, profile
│   └── services/
│       ├── fema_connector.py     # IPAWS polling, vehicle profile parsing, target matching
│       ├── aggregation_service.py# Composite scoring: ALPR + YOLO corroboration
│       ├── vehicle_classifier.py # YOLOv8 inference + dominant color extraction
│       ├── event_service.py      # Watchlist matching + vehicle profile comparison
│       ├── alert_dispatcher.py   # Discord dispatch with vehicle match embed field
│       ├── coverage_service.py   # Flight priority zones + coordinator coverage map (bucketed, never raw positions)
│       └── plate_recognizer.py   # Plate Recognizer cloud API (make/model enrichment)
├── web/                          # Next.js dashboard
│   └── src/app/
│       ├── map/                  # Live mission map
│       ├── missions/             # Mission management (create/end)
│       ├── admin/                # Pilot approvals + test alert injection
│       ├── profile/              # Pilot profile + stats
│       ├── alerts/               # Alert history log
│       ├── leaderboard/          # Pilot rankings
│       ├── debrief/              # Post-mission reports
│       ├── login/                # Authentication flow
│       ├── settings/             # Pilot settings
│       ├── privacy/              # Privacy policy
│       ├── terms/                # Terms of service
│       └── retention/            # Data retention policy
├── mobile/                       # Expo React Native app
│   ├── modules/
│   │   ├── dji-camera/           # DJI MSDK V5 native module (Kotlin, phase 2)
│   │   └── phone-camera/         # Android Foreground Service for background scanning
│   └── src/
│       ├── screens/              # Login, Camera, Map, Feed, Settings
│       ├── api/                  # Authenticated API client
│       └── lib/                  # Auth (AsyncStorage JWT), settings, polygon math
├── worker/
│   ├── unified_worker.py         # Shared frame queue — handles RTMP + direct frame sources
│   └── rtmp_telemetry.py         # RTMP stream telemetry harvester
├── deploy/
│   └── nginx.conf                # nginx reverse proxy template with HTTPS / Let's Encrypt
├── pilot/                        # Static pilot registration form
├── .env.example                  # Environment variable template — copy to .env and fill in
├── ecosystem.config.js           # PM2 process definitions
├── start_all.sh                  # Start all PM2 processes
└── stop_all.sh                   # Stop all PM2 processes
```

---

## Deployment

### Prerequisites
- Ubuntu 20.04+ · PostgreSQL 14+ · Node.js 18+ · Python 3.10+ · PM2 · OpenALPR · nginx · Certbot

### Quick start

```bash
git clone https://github.com/grantl12/ambers-angels.git
cd ambers-angels

# Backend dependencies
pip3 install -r backend/requirements.txt

# Configure secrets — copy the template and fill in your values
cp .env.example .env
$EDITOR .env   # set DATABASE_URL, JWT_SECRET (openssl rand -hex 32), ALERT_WEBHOOK_URL

# Database
PGPASSWORD=YOUR_DB_PASSWORD psql -U postgres -h 127.0.0.1 -d ambersangels < backend/schema.sql

# Web dashboard
cd web && npm install && npm run build && cd ..

# Create web/.env.local
cat > web/.env.local <<'EOF'
NEXT_PUBLIC_APP_NAME=Amber's Angels
NEXT_PUBLIC_MAPBOX_TOKEN=your_mapbox_token
NEXT_PUBLIC_API_BASE_URL=https://ambersangels.org/api
EOF

# Launch everything under PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # follow the printed sudo command to enable auto-restart on reboot
```

### HTTPS setup

A ready-to-use nginx config is in `deploy/nginx.conf`. It reverse-proxies the FastAPI backend (`:8000`) and the Next.js dashboard (`:3000`) behind HTTPS using Let's Encrypt.

```bash
# Install nginx and Certbot
sudo apt install nginx certbot python3-certbot-nginx

# Copy the site config and enable it
sudo cp deploy/nginx.conf /etc/nginx/sites-available/ambersangels
sudo ln -s /etc/nginx/sites-available/ambersangels /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Obtain a certificate (fills in the ssl_* lines automatically)
sudo certbot --nginx -d ambersangels.org -d www.ambersangels.org

# Certbot installs a renewal cron automatically — verify with:
sudo certbot renew --dry-run
```

### Mobile app (Android + iOS)

```bash
cd mobile
npm install

# Android
EXPO_TOKEN=your_token npx eas-cli build --profile preview --platform android

# iOS (requires Apple Developer account)
EXPO_APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx eas build --platform ios --profile preview
```

EAS builds in the cloud — no Android SDK or Mac required. The finished APK/IPA download link appears in the Expo dashboard. Android builds can be sideloaded directly; iOS preview builds install via the Expo Go link or direct IPA install on registered devices.

---

## Funding & Grants

Amber's Angels operates entirely on volunteer labor and donated infrastructure. We are actively pursuing:

- **OJJDP (Office of Juvenile Justice and Delinquency Prevention)** — Missing Children's Assistance grants
- **NCMEC (National Center for Missing & Exploited Children)** — technology partnership
- **State-level homeland security and public safety grants**
- **Corporate technology sponsorships** (cloud credits, API access, drone hardware)

If you represent a grant-making organization and would like a technical briefing, deployment data, or a letter of interest, contact us at **admin@ambersangels.org**.

Amber's Angels is a registered 501(c)(3) nonprofit. Donations are tax-deductible to the extent permitted by law.

---

## Get Involved

**Volunteer pilots and phone-camera volunteers** — Register at `/pilot/register.html` on the deployed platform. Drone pilots with FAA Part 107 certification are welcome and encouraged, but certification is not required — vehicle-mounted phone volunteers contribute meaningfully with no certification at all.

**Developers** — Issues and pull requests welcome. See open issues for the current roadmap.

**Organizations** — If you are a law enforcement agency, search-and-rescue organization, or child safety nonprofit and want to explore a formal partnership, reach out at **admin@ambersangels.org**.

---

## Legal

- [Privacy Policy](https://ambersangels.org/privacy)
- [Terms of Service](https://ambersangels.org/terms)
- [Data Retention Policy](https://ambersangels.org/retention)

Amber's Angels is a volunteer-run nonprofit. The platform is provided as-is. Pilots are responsible for complying with all applicable FAA regulations and local laws. Nothing in this platform constitutes legal advice or a guarantee of child recovery outcomes.
