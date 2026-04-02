# Amber's Angels

**A volunteer-driven public safety platform leveraging drone technology to help bring missing and abducted children home.**

Amber's Angels is a 501(c)(3) nonprofit (pending) that coordinates volunteer drone pilots in response to active AMBER Alerts and other missing-persons emergencies. When an alert is issued, pilots in the affected area deploy drones equipped with license plate recognition and vehicle identification technology. Detections are cross-referenced against the alert's suspect vehicle profile in real time and escalated immediately to mission coordinators — without storing raw video footage, without building searchable databases of innocent people, and without collecting any data beyond what is operationally necessary to support the search.

---

## Mission

Every hour a child is missing, the chances of a safe recovery decline. Amber's Angels exists to close the gap between when an alert is issued and when boots — and rotors — are on the ground. Our volunteers are FAA-certified drone pilots who donate their time, equipment, and expertise because they believe technology can save lives when it is deployed responsibly, transparently, and in partnership with law enforcement.

---

## Who We Serve

- **Missing children** — our primary mission. We respond to AMBER Alert, Levi's Call, and equivalent state-level child abduction emergency programs.
- **At-risk adults** — we also respond to Silver Alerts (missing seniors), Mattie's Call (missing at-risk adults), and Purple Alerts (missing persons with developmental disabilities).
- **Law enforcement and emergency coordinators** — we act as a force multiplier, not a replacement. Every match is reviewed by a human coordinator before escalation.
- **Volunteer pilots** — we provide the infrastructure, training resources, and mission coordination that lets individual pilots contribute meaningfully.

---

## How It Works

1. **Alert ingestion** — The platform polls the FEMA IPAWS (Integrated Public Alert and Warning System) feed every five minutes. When a qualifying alert is issued, the suspect vehicle profile (plate, color, make, body type) and the search polygon are automatically extracted and loaded into the mission system.

2. **Pilot dispatch** — Approved pilots in the affected area are notified. They launch and connect their drone or phone camera to the platform via the mobile app.

3. **Real-time detection** — Frames from the drone camera are processed locally on the server using OpenALPR (license plate recognition) and YOLOv8 (vehicle classification). Detected plates and vehicle types are compared against the active alert profile.

4. **Coordinator notification** — On a match, a Discord alert fires instantly to the mission coordinator channel with plate text, vehicle description, confidence score, and GPS coordinates.

5. **Mission debrief** — After the mission, coordinators and pilots review detection statistics, flight coverage, and alert history through the web dashboard.

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
- High-confidence frames optionally enriched via Plate Recognizer cloud API (opt-in)
- Fuzzy matching handles partial plate reads (91%+ similarity threshold)
- Detection aggregation window prevents duplicate alerts on the same plate

### Vehicle Identification
- YOLOv8 classifies vehicle body type and extracts dominant color
- Partial-profile alerts (no plate available) matched by color + body type
- Full vehicle description attached to every detection event

### Mission Map
Live Mapbox dark-mode dashboard:
- Real-time drone positions with animated markers and flight trail
- Active FEMA alert polygons with alert-type color coding
- Detection markers (amber = detected, red = watchlist hit)
- Detection density heatmap
- Flock ALPR fixed-camera positions with coverage polygons
- Out-of-range warning when a drone exceeds the pilot's configured distance from the active search area

### Pilot Portal & Accounts
- Multi-step registration with FAA certification tracking
- Admin approval workflow — no pilot accesses mission data without vetting
- JWT authentication with 30-day tokens
- Email notification on account approval
- Profile page with personal mission stats (flight time, detections, missions)

### Mobile App (Android, iOS pending)
- Expo bare workflow + TypeScript, built via EAS cloud (no Mac required)
- Phone camera capture at configurable interval → server-side ALPR
- GPS telemetry at ~1 Hz for live drone tracking
- Login screen, mission map, detection feed, settings
- Phase 2: DJI Mobile SDK v5 bindings for Mavic 3, Mini 4 Pro, Air 3

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

## Technology Stack

| Layer | Technology |
|---|---|
| Backend API | Python / FastAPI / PostgreSQL |
| License plate recognition | OpenALPR (local) + Plate Recognizer (cloud, optional) |
| Vehicle classification | YOLOv8 (Ultralytics) |
| Web dashboard | Next.js 14 / Tailwind CSS / Mapbox GL |
| Mobile app | Expo (React Native) / EAS Build |
| Alert ingestion | FEMA IPAWS CAP/XML feed |
| Notifications | Discord webhooks |
| Process management | PM2 |
| Infrastructure | DigitalOcean (self-hostable on any Linux VPS) |

---

## Architecture

```
Drone / Phone Camera
        |
        v
  POST /ingest/frame  ←─── Mobile App (Expo)
        |
        v
  OpenALPR + YOLOv8 (local, no raw data leaves server)
        |
        v
  AggregationService (5-second dedup window)
        |
   ┌────┴────┐
   v         v
PostgreSQL   Discord Webhook → Mission coordinators
   |
   v
Next.js Dashboard  ←── Pilot web browsers
   |
FEMA IPAWS Poller (every 5 min, background async task)
   |
   ├── Watchlist (plates from alerts)
   ├── Vehicle targets (color/type/make from alert text)
   └── Search polygon (for drone proximity warnings)
```

---

## Repository Layout

```
ambers-angels/
├── backend/
│   ├── main.py                   # FastAPI app + ingestion endpoints
│   ├── routers/
│   │   ├── read_api.py           # Dashboard data endpoints + mission management
│   │   └── auth.py               # Pilot registration, login, approval, profile
│   └── services/
│       ├── fema_connector.py     # IPAWS polling + vehicle target matching
│       ├── aggregation_service.py# ALPR + YOLO + Plate Recognizer pipeline
│       ├── event_service.py      # Alert evaluation and watchlist matching
│       └── alert_dispatcher.py   # Discord dispatch
├── web/                          # Next.js dashboard
│   └── src/app/
│       ├── map/                  # Live mission map
│       ├── missions/             # Mission management (create/end)
│       ├── admin/                # Pilot approvals + test alert injection
│       ├── profile/              # Pilot profile + stats
│       ├── alerts/               # Alert history log
│       ├── leaderboard/          # Pilot rankings
│       ├── debrief/              # Post-mission reports
│       ├── privacy/              # Privacy policy
│       ├── terms/                # Terms of service
│       └── retention/            # Data retention policy
├── mobile/                       # Expo React Native app
│   └── src/
│       ├── screens/              # Login, Camera, Map, Feed, Settings
│       ├── api/                  # Authenticated API client
│       └── lib/                  # Auth (AsyncStorage JWT), settings
├── pilot/                        # Static pilot registration form
├── ecosystem.config.js           # PM2 process definitions
└── start_api.sh                  # Backend launch with env vars
```

---

## Deployment

### Prerequisites
- Ubuntu 20.04+ · PostgreSQL 14+ · Node.js 18+ · Python 3.10+ · PM2 · OpenALPR

### Quick start

```bash
git clone https://github.com/grantl12/ambers-angels.git
cd ambers-angels

# Backend
pip3 install -r backend/requirements.txt

# Create .env (never committed)
cat > .env <<EOF
DATABASE_URL=postgresql+asyncpg://postgres:PASSWORD@127.0.0.1:5432/ambersangels
ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK
JWT_SECRET=$(openssl rand -hex 32)
# Optional — email notifications on pilot approval
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your_app_password
EOF

# Database
PGPASSWORD=PASSWORD psql -U postgres -h 127.0.0.1 -d ambersangels < backend/schema.sql

# Web dashboard
cd web && npm install && npm run build && cd ..

# Create web/.env.local
cat > web/.env.local <<EOF
NEXT_PUBLIC_APP_NAME=Amber's Angels
NEXT_PUBLIC_MAPBOX_TOKEN=your_mapbox_token
NEXT_PUBLIC_API_BASE_URL=http://YOUR_SERVER_IP/api
EOF

# Launch everything under PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # follow the printed sudo command to enable auto-restart on reboot
```

### Mobile app (Android)

```bash
cd mobile
npm install
EXPO_TOKEN=your_token npx eas-cli build --profile preview --platform android
```

EAS builds in the cloud — no Android SDK or Mac required. The finished APK download link appears in the Expo dashboard and can be sideloaded directly onto any Android device.

---

## Funding & Grants

Amber's Angels operates entirely on volunteer labor and donated infrastructure. We are actively pursuing:

- **OJJDP (Office of Juvenile Justice and Delinquency Prevention)** — Missing Children's Assistance grants
- **NCMEC (National Center for Missing & Exploited Children)** — technology partnership
- **State-level homeland security and public safety grants**
- **Corporate technology sponsorships** (cloud credits, API access, drone hardware)

If you represent a grant-making organization and would like a technical briefing, deployment data, or a letter of interest, contact us at **admin@ambersangels.org**.

501(c)(3) determination pending. All donations are currently held in trust pending nonprofit status confirmation.

---

## Get Involved

**Volunteer pilots** — Register at `/pilot/register.html` on the deployed platform. FAA Part 107 certification is preferred but not required for recreational-altitude operations.

**Developers** — Issues and pull requests welcome. See open issues for the current roadmap.

**Organizations** — If you are a law enforcement agency, search-and-rescue organization, or child safety nonprofit and want to explore a formal partnership, reach out at **admin@ambersangels.org**.

---

## Legal

- [Privacy Policy](https://ambersangels.org/privacy)
- [Terms of Service](https://ambersangels.org/terms)
- [Data Retention Policy](https://ambersangels.org/retention)

Amber's Angels is a volunteer-run nonprofit. The platform is provided as-is. Pilots are responsible for complying with all applicable FAA regulations and local laws. Nothing in this platform constitutes legal advice or a guarantee of child recovery outcomes.
