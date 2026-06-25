"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"

// ── Nav structure ─────────────────────────────────────────────────────────────

const NAV = [
  {
    label: "Getting Started",
    id: "getting-started",
    children: [
      { label: "What is Amber's Angels?", id: "what-is" },
      { label: "Registration", id: "registration" },
      { label: "Terms of Service", id: "tos" },
    ],
  },
  {
    label: "Pilot / Volunteer",
    id: "pilot",
    children: [
      { label: "Background Scan", id: "background-scan" },
      { label: "Active Camera Mode", id: "active-camera" },
      { label: "Getting Alerts", id: "pilot-alerts" },
      { label: "Watch Areas", id: "watch-areas" },
      { label: "Requesting Coordinator Access", id: "request-coordinator" },
    ],
  },
  {
    label: "Coordinator",
    id: "coordinator",
    children: [
      { label: "Detection Feed", id: "detection-feed" },
      { label: "Watchlist Management", id: "watchlist" },
      { label: "Drone Dispatch", id: "drone-dispatch" },
      { label: "Mission Monitoring", id: "mission-monitoring" },
    ],
  },
  {
    label: "Admin",
    id: "admin",
    children: [
      { label: "Approving Pilots", id: "approving-pilots" },
      { label: "Approving Coordinators", id: "approving-coordinators" },
      { label: "Drone Dispatch Permissions", id: "dispatch-permissions" },
      { label: "Demo Alert Injection", id: "demo-inject" },
      { label: "BOLO Ingestor", id: "bolo-ingestor" },
      { label: "BOLO Crawler Sources", id: "bolo-crawler" },
      { label: "Resolving Active Alerts", id: "resolving-alerts" },
      { label: "System Health", id: "system-health" },
    ],
  },
  {
    label: "Alert Types",
    id: "alert-types",
    children: [
      { label: "AMBER / Levi's Call", id: "type-amber" },
      { label: "Silver Alert", id: "type-silver" },
      { label: "Blue Alert", id: "type-blue" },
      { label: "Purple Alert", id: "type-purple" },
      { label: "BOLO", id: "type-bolo" },
      { label: "NCMEC", id: "type-ncmec" },
    ],
  },
]

// ── Reusable components ───────────────────────────────────────────────────────

function RoleBadge({ role }: { role: "pilot" | "coordinator" | "admin" | "all" }) {
  const styles = {
    pilot:       "bg-amber-500/10 text-amber-400 border-amber-500/20",
    coordinator: "bg-sky-500/10 text-sky-400 border-sky-500/20",
    admin:       "bg-purple-500/10 text-purple-400 border-purple-500/20",
    all:         "bg-white/5 text-white/50 border-white/10",
  }
  const labels = { pilot: "Pilot", coordinator: "Coordinator", admin: "Admin", all: "All roles" }
  return (
    <span className={`inline-block text-[11px] font-bold tracking-widest uppercase px-2.5 py-1 rounded border ${styles[role]}`}>
      {labels[role]}
    </span>
  )
}

function Screenshot({ label, src }: { label: string; src?: string }) {
  if (!src) return null
  return (
    <figure className="my-8 flex flex-col items-center gap-3">
      <div className="rounded-[2rem] border-2 border-white/20 overflow-hidden shadow-2xl" style={{ maxWidth: 260 }}>
        <img src={src} alt={label} className="block w-full" />
      </div>
      <figcaption className="text-xs text-white/30 font-mono text-center">{label}</figcaption>
    </figure>
  )
}

function WebScreenshot({ label, src }: { label: string; src?: string }) {
  if (!src) return null
  return (
    <figure className="my-8 flex flex-col items-center gap-3">
      <div className="rounded-xl border border-white/15 overflow-hidden shadow-2xl w-full">
        <img src={src} alt={label} className="block w-full" />
      </div>
      <figcaption className="text-xs text-white/30 font-mono text-center">{label}</figcaption>
    </figure>
  )
}

function PhonePair({ screens }: { screens: { src: string; label: string }[] }) {
  return (
    <div className="my-8 flex gap-6 justify-center flex-wrap">
      {screens.map(({ src, label }) => (
        <figure key={src} className="flex flex-col items-center gap-3">
          <div className="rounded-[2rem] border-2 border-white/20 overflow-hidden shadow-2xl" style={{ maxWidth: 220 }}>
            <img src={src} alt={label} className="block w-full" />
          </div>
          <figcaption className="text-xs text-white/30 font-mono text-center" style={{ maxWidth: 220 }}>{label}</figcaption>
        </figure>
      ))}
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-5 flex gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3.5">
      <span className="text-amber-400 flex-shrink-0 mt-0.5">⚠</span>
      <p className="text-sm text-white/70 leading-relaxed">{children}</p>
    </div>
  )
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-5 flex gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3.5">
      <span className="text-emerald-400 flex-shrink-0 mt-0.5">✓</span>
      <p className="text-sm text-white/70 leading-relaxed">{children}</p>
    </div>
  )
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-16 mb-2 text-2xl font-bold text-white scroll-mt-24 first:mt-0">
      {children}
    </h2>
  )
}

function H3({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="mt-10 mb-3 text-lg font-semibold text-white/90 scroll-mt-24">
      {children}
    </h3>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[15px] text-white/60 leading-relaxed mb-4">{children}</p>
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 text-[15px] text-white/60 leading-relaxed">
      <span className="text-amber-400/60 flex-shrink-0 mt-1">›</span>
      <span>{children}</span>
    </li>
  )
}

function Ul({ children }: { children: React.ReactNode }) {
  return <ul className="space-y-2 my-4">{children}</ul>
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function GuidePage() {
  const [activeId, setActiveId] = useState("")
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    const allIds = NAV.flatMap(s => [s.id, ...s.children.map(c => c.id)])
    const els = allIds.map(id => document.getElementById(id)).filter(Boolean) as HTMLElement[]

    observerRef.current = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting)
        if (visible.length > 0) setActiveId(visible[0].target.id)
      },
      { rootMargin: "-20% 0px -70% 0px" }
    )
    els.forEach(el => observerRef.current?.observe(el))
    return () => observerRef.current?.disconnect()
  }, [])

  return (
    <div className="min-h-screen bg-neutral-950 text-white">

      {/* Top bar */}
      <div className="sticky top-0 z-50 border-b border-white/[0.06] bg-neutral-950/90 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 text-sm font-semibold text-white/70 hover:text-white transition-colors">
            <img src="/aa-icon.png" alt="AA" className="w-6 h-6 rounded-full" />
            Amber&apos;s Angels
          </Link>
          <span className="text-xs text-white/30 font-mono">User Guide · June 2026</span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-12 flex gap-12">

        {/* Sidebar */}
        <aside className="hidden lg:block flex-shrink-0 w-56 sticky top-24 self-start max-h-[calc(100vh-7rem)] overflow-y-auto">
          <nav className="space-y-5">
            {NAV.map(section => (
              <div key={section.id}>
                <div className="text-[11px] font-bold tracking-widest uppercase text-white/25 mb-2">
                  {section.label}
                </div>
                <ul className="space-y-0.5">
                  {section.children.map(item => (
                    <li key={item.id}>
                      <a
                        href={`#${item.id}`}
                        className={`block text-[13px] py-1 px-2 rounded transition-colors ${
                          activeId === item.id
                            ? "text-amber-400 bg-amber-500/8"
                            : "text-white/40 hover:text-white/70"
                        }`}
                      >
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0 max-w-3xl">

          {/* Hero */}
          <div className="mb-14">
            <div className="text-[11px] font-bold tracking-widest uppercase text-amber-400 mb-4">User Guide</div>
            <h1 className="text-4xl font-bold text-white mb-4 leading-tight">
              Amber&apos;s Angels<br />Platform Guide
            </h1>
            <p className="text-lg text-white/50 leading-relaxed max-w-2xl">
              Everything you need to know to participate in active public safety searches — whether you&apos;re a volunteer scanning plates on your commute, a coordinator dispatching drones, or an admin managing the system.
            </p>
          </div>

          {/* ── GETTING STARTED ─────────────────────────────── */}
          <H2 id="getting-started">Getting Started</H2>

          <H3 id="what-is">What is Amber&apos;s Angels?</H3>
          <P>
            Amber&apos;s Angels is a volunteer-driven search platform that responds to government-issued missing persons
            alerts — AMBER Alerts, Silver Alerts, Blue Alerts, Purple Alerts, NamUs cases, and public safety BOLOs.
            When an alert fires, the platform notifies volunteers in the affected area and opens a searchable camera
            feed. Volunteers use the smartphones and DJI drones they already own. No hardware purchase required.
          </P>
          <P>
            The platform ingests alerts from five sources simultaneously: FEMA IPAWS CMAS (every 5 minutes),
            FEMA IPAWS EAS (every 2 minutes), the NWS Alerts API, the NamUs DOJ federal missing persons database
            (every 30 minutes), and a configurable BOLO crawler that polls public safety agency feeds every 15 minutes.
          </P>
          <P>
            There are three roles: <strong className="text-white/80">Pilot</strong> (all volunteers),{" "}
            <strong className="text-white/80">Coordinator</strong> (pilots who have been approved to manage missions
            and dispatch drones), and <strong className="text-white/80">Admin</strong> (full system access).
          </P>

          <H3 id="registration">Registration</H3>
          <RoleBadge role="all" />
          <P>
            Registration opens in Safari View Controller — a full browser window inside the app, not a WebView.
            This is required by App Store guidelines and means your credentials are handled by the system browser,
            not the app itself.
          </P>
          <Ul>
            <Li>Open the app and tap <strong className="text-white/80">Register</strong></Li>
            <Li>Fill in your name, email, city, and password</Li>
            <Li>Check the Part 107 box if you hold an FAA drone certification — this affects your eligibility for drone coordination roles</Li>
            <Li>Submit — your account is created with <strong className="text-white/80">pending</strong> status</Li>
            <Li>An admin reviews and approves your account before you can scan</Li>
          </Ul>
          <Note>
            Your account starts as <strong>pending</strong>. You won&apos;t be able to start a mission until an admin
            approves it. During the Carrollton pilot, approvals happen manually — expect same-day turnaround.
          </Note>
          <Screenshot src="/guide/login.png" label="Sign in screen — registration opens in Safari View Controller" />

          <H3 id="tos">Terms of Service</H3>
          <RoleBadge role="all" />
          <P>
            The first time you open the app after registration (and after any future ToS version update), you&apos;ll
            see a full-screen Terms of Service gate. The app is inaccessible until you accept. Your acceptance is
            recorded server-side so it persists across reinstalls.
          </P>
          <Screenshot label="ToS gate screen" />

          {/* ── PILOT ───────────────────────────────────────── */}
          <H2 id="pilot">Pilot / Volunteer</H2>
          <P>
            Pilots are approved volunteers. Once your account is approved you can participate in two ways:
            background scan (passive, on-device) or active camera mode (explicit, frame-uploading). Most
            volunteers use background scan — it requires no attention while driving.
          </P>

          <H3 id="background-scan">Background Scan</H3>
          <RoleBadge role="pilot" />
          <P>
            Background scan is the default volunteer mode. ML Kit OCR runs entirely on your device — frames
            never leave your phone. Only the plate text and confidence score are transmitted to the server.
            This is a privacy guarantee enforced by the architecture, not policy.
          </P>
          <Ul>
            <Li>Mount your phone with the camera facing traffic</Li>
            <Li>Open the app and tap <strong className="text-white/80">Start Mission</strong></Li>
            <Li>A persistent notification appears showing live frame count and a one-tap stop button</Li>
            <Li>You can switch to navigation, music, or any other app — scanning continues in the background</Li>
            <Li>If a scanned plate matches an active alert watchlist entry, you receive a push notification immediately</Li>
          </Ul>
          <Tip>
            Background scan works during your normal commute. You don&apos;t need to actively watch the phone — just mount it, start the mission, and drive. The notification will alert you if there&apos;s a match.
          </Tip>
          <P>
            The first time you start a mission, iOS asks for camera and location permission directly —
            these are the standard system prompts, not anything custom to the app:
          </P>
          <PhonePair screens={[
            { src: "/guide/camera-attestation.png", label: "iOS camera permission prompt" },
            { src: "/guide/location-attestation.png", label: "iOS location permission prompt" },
          ]} />
          <PhonePair screens={[
            { src: "/guide/camera-standby.png", label: "STANDBY — no active alert" },
            { src: "/guide/camera-live.png", label: "LIVE — on-device OCR scanning" },
          ]} />

          <H3 id="active-camera">Active Camera Mode</H3>
          <RoleBadge role="pilot" />
          <P>
            Active camera mode uploads frames to the server for full ALPR + YOLO processing. It is only available
            when there is an active alert in the system — if no alert is active, the camera gate is closed and the
            Start Mission button will say so.
          </P>
          <P>
            This is the iOS path. The phone camera captures frames at approximately one per second, uploads them
            via <code className="font-mono text-xs bg-white/5 px-1.5 py-0.5 rounded">POST /ingest/frame</code>, and
            the server runs OpenALPR + YOLOv8 on each frame. Results feed into the 5-second aggregation window.
          </P>
          <Ul>
            <Li>Tap <strong className="text-white/80">Start Mission</strong> — the camera view opens automatically if an alert is active</Li>
            <Li>Point the camera at license plates. Hold steady for best results.</Li>
            <Li>A confidence score updates in real time as frames process</Li>
            <Li>If the composite score exceeds the HIGH_CONFIDENCE threshold (≥85%, ≥3 frames), a Discord alert fires and a push notification is sent to coordinators</Li>
            <Li>If your scan hits a watchlist match at any confidence ≥55%, you receive an instant push notification: <strong className="text-white/80">WATCHLIST MATCH — Plate [X] matches an active alert</strong></Li>
          </Ul>
          <Note>
            Active camera mode requires a network connection and drains battery faster than background scan. Use it when you are stationary or parked near a choke point — intersections, gas stations, highway on-ramps.
          </Note>
          <PhonePair screens={[
            { src: "/guide/camera-gate.png", label: "Camera permission gate" },
            { src: "/guide/camera-live.png", label: "Camera — active mission" },
          ]} />

          <H3 id="pilot-alerts">Getting Alerts</H3>
          <RoleBadge role="pilot" />
          <P>
            You receive push notifications in two situations: when a new alert fires in your watch area, and when
            your scan produces a watchlist match. Notifications arrive even if the app is in the background or
            closed — this requires push notification permission, which the app will request during onboarding.
          </P>
          <P>
            If you enter a geographic area that is under an active alert (based on the alert polygon from the
            FEMA CAP XML), you also receive a geofence notification without needing to be actively scanning.
          </P>
          <P>
            Coordinators and admins can optionally monitor alerts and watchlist matches in a Discord channel in
            real time — handy for watching a search from a laptop or a second screen. A match includes the
            plate, confidence, source, and the evidence frame when one was captured. Discord is not required to
            use the app — it's an internal monitoring tool for organizers, and the platform can also send
            high-confidence alerts via SMS as an alternative or addition to push/email:
          </P>
          <PhonePair screens={[
            { src: "/guide/discord-watchlist-add.png", label: "Discord — new plate added to the watchlist" },
            { src: "/guide/discord-match-photo.png", label: "Discord — watchlist match with evidence frame" },
          ]} />

          <H3 id="watch-areas">Watch Areas</H3>
          <RoleBadge role="pilot" />
          <P>
            Watch areas control which alerts notify you. By default you receive alerts for your home city.
            You can add additional watch areas or switch to nationwide coverage.
          </P>
          <Ul>
            <Li>Open the app and go to <strong className="text-white/80">Settings</strong></Li>
            <Li>Tap <strong className="text-white/80">Watch Areas</strong></Li>
            <Li>Type a city or county name — autocomplete suggestions appear as you type, populated from real FEMA alert data</Li>
            <Li>Tap a suggestion to add it. You can add multiple areas.</Li>
            <Li>Toggle <strong className="text-white/80">Nationwide</strong> to receive all alerts regardless of location — useful for coordinators and high-availability volunteers</Li>
          </Ul>
          <PhonePair screens={[
            { src: "/guide/settings-top.png", label: "Settings — Identity & Capture" },
            { src: "/guide/settings-mid.png", label: "Settings — Alert Range & Watch Areas" },
          ]} />

          <Screenshot src="/guide/settings-badges.png" label="Settings — Badges, account actions, and Delete Account" />

          <H3 id="request-coordinator">Requesting Coordinator Access</H3>
          <RoleBadge role="pilot" />
          <P>
            Pilots can request elevation to Coordinator role from within the app. Coordinator access gives you
            the ability to manage the watchlist, review detection events, and dispatch drones.
          </P>
          <Ul>
            <Li>Go to <strong className="text-white/80">Settings</strong></Li>
            <Li>Tap <strong className="text-white/80">Request Coordinator Access</strong></Li>
            <Li>Write a brief reason — your aviation background, experience with search operations, or affiliation</Li>
            <Li>Submit. An admin reviews requests from the admin panel.</Li>
          </Ul>
          <Note>
            Coordinator access requires admin approval. Admins can see your request reason and your registration details including whether you hold a Part 107 certification.
          </Note>

          {/* ── COORDINATOR ─────────────────────────────────── */}
          <H2 id="coordinator">Coordinator</H2>
          <P>
            Coordinators have all pilot capabilities plus the mission map, detection review, watchlist management,
            and drone dispatch. You access these through the web dashboard at{" "}
            <a href="https://amberangels.org/map" target="_blank" rel="noopener noreferrer"
              className="text-amber-400 hover:text-amber-300">
              amberangels.org/map
            </a>{" "}
            or from the Map tab in the mobile app.
          </P>
          <PhonePair screens={[
            { src: "/guide/mission-map.png", label: "Mission Map — drones and ground volunteers online" },
            { src: "/guide/mission-map-alert.png", label: "Mission Map — active alert detail" },
          ]} />

          <H3 id="detection-feed">Detection Feed</H3>
          <RoleBadge role="coordinator" />
          <P>
            The detection feed shows all recent ALPR hits in real time. Each event shows the plate read, confidence
            score, detection source (drone RTMP, phone camera, or on-device ML Kit), GPS location, and timestamp.
            HIGH_CONFIDENCE events (≥85%) include a golden evidence frame attached to the event record.
          </P>
          <P>
            Events are color-coded by status: white for pending review, green for confirmed, red for dismissed.
            Coordinators can confirm or dismiss events directly from the feed.
          </P>
          <Screenshot label="Live detection feed with event cards and confidence scores" />

          <H3 id="watchlist">Watchlist Management</H3>
          <RoleBadge role="coordinator" />
          <P>
            The watchlist is the set of plates that trigger alerts when detected. It is populated automatically
            from FEMA IPAWS alerts, NamUs cases, and the BOLO crawler. Coordinators can also add plates manually.
          </P>
          <Ul>
            <Li>Active watchlist entries are shown in the admin panel under <strong className="text-white/80">Active FEMA Alerts</strong> (for FEMA-sourced entries) or <strong className="text-white/80">Manual Alerts</strong></Li>
            <Li>To add a plate manually: use the <strong className="text-white/80">Inject Demo Alert</strong> form in the admin panel (sets source to &apos;demo&apos; for easy cleanup)</Li>
            <Li>To deactivate an entry: use the <strong className="text-white/80">Resolve</strong> button next to the alert — this deactivates the watchlist entry and fires a Discord stand-down notification</Li>
          </Ul>
          <Note>
            FEMA-sourced watchlist entries are cancelled automatically when a CAP Cancel message arrives from
            the federal feed. You do not need to manually deactivate them.
          </Note>

          <H3 id="drone-dispatch">Drone Dispatch</H3>
          <RoleBadge role="coordinator" />
          <P>
            Drone dispatch requires a volunteer pilot to have powered on their DJI drone and opened the Autonomous
            Mission screen. When a drone is ready, it appears on the coordinator map as an amber icon at the
            pilot&apos;s home position, with a gray-out if the heartbeat is older than 5 minutes.
          </P>
          <P>
            The dispatch flow:
          </P>
          <Ul>
            <Li>Click a drone icon on the map to select it</Li>
            <Li>Click anywhere on the map to place an observation point — a location you want the drone to fly to and hold position (intersection, highway, corridor)</Li>
            <Li>The alert polygon for the active alert is shown as an overlay to help you choose</Li>
            <Li>An ADS-B airspace advisory automatically loads: any crewed aircraft within 5 nautical miles below 3,000 ft. Review before confirming.</Li>
            <Li>Tap <strong className="text-white/80">Confirm Dispatch</strong> — the mission is created with status <code className="font-mono text-xs bg-white/5 px-1.5 py-0.5 rounded">pending</code></Li>
            <Li>The pilot accepts the mission on their Autonomous Mission screen and the drone launches</Li>
          </Ul>
          <Note>
            VLOS mode (default) enforces a 400-meter software radius from the drone&apos;s home position. The dispatch UI will warn you if your observation point exceeds this. BVLOS Tactical is available when an admin has recorded the FAA Part 107.39 waiver number.
          </Note>
          <Screenshot src="/guide/drone-dispatch.png" label="Dispatch screen — observation point, ADS-B airspace advisory, and operation mode" />

          <H3 id="mission-monitoring">Mission Monitoring</H3>
          <RoleBadge role="coordinator" />
          <P>
            After dispatch, mission status progresses through:{" "}
            <code className="font-mono text-xs bg-white/5 px-1.5 py-0.5 rounded">pending</code> →{" "}
            <code className="font-mono text-xs bg-white/5 px-1.5 py-0.5 rounded">dispatched</code> →{" "}
            <code className="font-mono text-xs bg-white/5 px-1.5 py-0.5 rounded">uploading</code> →{" "}
            <code className="font-mono text-xs bg-white/5 px-1.5 py-0.5 rounded">executing</code> →{" "}
            <code className="font-mono text-xs bg-white/5 px-1.5 py-0.5 rounded">completed</code> or{" "}
            <code className="font-mono text-xs bg-white/5 px-1.5 py-0.5 rounded">aborted</code>.
          </P>
          <Ul>
            <Li>Missions time out automatically: 30 minutes if the pilot never accepts, 4 hours if executing</Li>
            <Li>Battery level is visible on the Autonomous Mission screen — the pilot can tap Return to Home at any time</Li>
            <Li>ALPR detections from the drone&apos;s live stream appear in the detection feed in real time</Li>
            <Li>A detection at HIGH_CONFIDENCE fires a Discord alert with the evidence frame attached</Li>
          </Ul>

          {/* ── ADMIN ────────────────────────────────────────── */}
          <H2 id="admin">Admin</H2>
          <P>
            Admins access the admin panel at{" "}
            <a href="https://amberangels.org/admin" target="_blank" rel="noopener noreferrer"
              className="text-amber-400 hover:text-amber-300">
              amberangels.org/admin
            </a>.
            The panel is only accessible to accounts with the <code className="font-mono text-xs bg-white/5 px-1.5 py-0.5 rounded">admin</code> role.
          </P>

          <H3 id="approving-pilots">Approving Pilots</H3>
          <RoleBadge role="admin" />
          <P>
            Newly registered pilots appear in the <strong className="text-white/80">Pending Pilots</strong> queue
            at the top of the admin panel. Each card shows their name, email, city, and whether they hold a
            Part 107 certification.
          </P>
          <Ul>
            <Li>Review the registration details</Li>
            <Li>Tap <strong className="text-white/80">Approve</strong> to activate the account — they receive a push notification and can immediately start missions</Li>
            <Li>Tap <strong className="text-white/80">Reject</strong> to decline — their account is deactivated</Li>
          </Ul>
          <Screenshot src="/guide/admin-pilots.png" label="Admin panel — Registered Pilots & Pending Approval queue" />

          <H3 id="approving-coordinators">Approving Coordinator Requests</H3>
          <RoleBadge role="admin" />
          <P>
            Pilots who have requested coordinator access appear in the{" "}
            <strong className="text-white/80">Coordinator Requests</strong> section. You can see their request
            reason, when they submitted it, and their registration details.
          </P>
          <Ul>
            <Li>Tap <strong className="text-white/80">Approve</strong> to elevate the pilot to Coordinator role</Li>
            <Li>Their role updates immediately — no restart required</Li>
          </Ul>

          <H3 id="dispatch-permissions">Drone Dispatch Permissions</H3>
          <RoleBadge role="admin" />
          <P>
            By default, coordinators cannot dispatch drones — they need explicit permission. This is a deliberate
            gate to ensure only coordinators who understand FAA operational requirements are controlling autonomous flights.
          </P>
          <Ul>
            <Li>In the <strong className="text-white/80">Approved Pilots</strong> section, find the coordinator</Li>
            <Li>Check the <strong className="text-white/80">Can dispatch drones</strong> checkbox</Li>
            <Li>The coordinator can now see drone icons on the mission map and use the dispatch flow</Li>
          </Ul>
          <Note>
            Before enabling BVLOS Tactical for a drone, the admin must record the FAA Part 107.39 waiver
            number in notes and set the <code className="font-mono text-xs bg-white/5 px-1.5 py-0.5 rounded">bvlos_authorized</code> flag
            via the database or API. VLOS (400m radius) is the default and requires no waiver.
          </Note>

          <H3 id="demo-inject">Demo Alert Injection</H3>
          <RoleBadge role="admin" />
          <P>
            The <strong className="text-white/80">Inject Demo Alert</strong> button creates a synthetic watchlist
            entry and vehicle target for testing the pipeline end-to-end. This is the correct way to test — not
            curl, not plink directly.
          </P>
          <Ul>
            <Li>Fill in a plate (e.g. <code className="font-mono text-xs bg-white/5 px-1.5 py-0.5 rounded">YVJ024</code>), headline, area, and optional vehicle details</Li>
            <Li>Select alert type and click <strong className="text-white/80">Inject</strong></Li>
            <Li>The entry is created with <code className="font-mono text-xs bg-white/5 px-1.5 py-0.5 rounded">source=&apos;demo&apos;</code> — it appears under <strong className="text-white/80">Manual Alerts</strong>, not Active FEMA Alerts</Li>
            <Li>Mobile camera gate opens immediately — volunteers in the area can start scanning</Li>
            <Li>Use <strong className="text-white/80">Clear Test Data</strong> to remove it when done</Li>
          </Ul>
          <Note>
            Do not inject test alerts via curl or the server shell. Entries created outside the admin UI have
            source=&apos;manual&apos; and cannot be cancelled through the Resolve flow — only the Clear Test Data button
            or direct SQL removes them.
          </Note>
          <Screenshot src="/guide/admin-health.png" label="Admin panel — System Health & Test Controls" />

          <H3 id="bolo-ingestor">BOLO Screenshot Ingestor</H3>
          <RoleBadge role="admin" />
          <P>
            The BOLO Ingestor lets you upload a screenshot of a social media BOLO or public safety notice.
            Claude Haiku vision extracts the plate, vehicle description, person name, area, and alert type
            automatically and creates a watchlist + vehicle target entry.
          </P>
          <Ul>
            <Li>In the admin panel, find the <strong className="text-white/80">BOLO Ingestor</strong> section</Li>
            <Li>Tap <strong className="text-white/80">Choose screenshot…</strong> and select the image</Li>
            <Li>Tap <strong className="text-white/80">Ingest BOLO</strong> — extraction takes 2–5 seconds</Li>
            <Li>The result shows extracted plate, person, vehicle, area, and case number</Li>
            <Li>If extraction fails (no plate and no make+model), the entry is not created — you&apos;ll see an error</Li>
          </Ul>
          <Tip>
            Best results come from clear screenshots with visible text. Facebook posts, sheriff&apos;s office press releases, and NCMEC posters all work well. Blurry images or PDFs may not extract correctly.
          </Tip>
          <Screenshot label="BOLO Ingestor section with file picker and extraction result" />

          <H3 id="bolo-crawler">BOLO Crawler Sources</H3>
          <RoleBadge role="admin" />
          <P>
            The BOLO Crawler automatically polls configurable public safety RSS feeds and web pages every
            15 minutes. Extraction runs locally — no API calls per post. It uses regex, dictionary matching,
            and spaCy NER to pull plate, vehicle, and location data. Only posts with adequate vehicle data
            (plate, or make + model, or make + color + area) create alerts.
          </P>
          <P>
            Pre-seeded sources include FBI kidnapping and missing persons RSS feeds, NCMEC, GBI Georgia,
            ALEA Alabama, and others. You can add county sheriff&apos;s office news feeds from this panel.
          </P>
          <Ul>
            <Li>Find the <strong className="text-white/80">BOLO Crawler Sources</strong> section in the admin panel</Li>
            <Li>Green dot = active source. Last crawled time shown below each URL.</Li>
            <Li>Click <strong className="text-white/80">Disable</strong> to pause a source without deleting it</Li>
            <Li>To add a new source: enter a name, the URL, select RSS or HTML, and optionally a 2-letter state code</Li>
            <Li>RSS sources work with any standard RSS or Atom feed. HTML sources scrape visible text from the page — contact the admin if a source needs a specific CSS selector.</Li>
          </Ul>
          <WebScreenshot src="/guide/bolo-crawler.png" label="BOLO Crawler Sources — active feeds with last-crawled timestamps and add-source form" />

          <H3 id="resolving-alerts">Resolving Active Alerts</H3>
          <RoleBadge role="admin" />
          <P>
            When a missing person is found or an alert is cancelled, the watchlist entry should be deactivated
            so volunteers stop scanning for it. FEMA-sourced alerts are cancelled automatically when a CAP Cancel
            message arrives. For manual entries, use the Resolve flow in the admin panel.
          </P>
          <Ul>
            <Li>Find the entry under <strong className="text-white/80">Active FEMA Alerts</strong> or <strong className="text-white/80">Manual Alerts</strong></Li>
            <Li>Click <strong className="text-white/80">Resolve</strong> — a confirmation dialog appears</Li>
            <Li>Select a reason (found safe, false alarm, cancelled by agency, etc.)</Li>
            <Li>Confirm — the watchlist entry is deactivated and a Discord stand-down notification fires</Li>
          </Ul>
          <Note>
            Alerted detection events (events that fired a Discord alert) are never deleted — they are evidence
            records. Resolving an alert only deactivates the watchlist entry; it does not touch the detection history.
          </Note>

          <H3 id="system-health">System Health</H3>
          <RoleBadge role="admin" />
          <P>
            The system health panel at the top of the admin page shows the live state of all background services.
            It refreshes every 10 seconds.
          </P>
          <Ul>
            <Li><strong className="text-white/80">Database:</strong> connected / disconnected</Li>
            <Li><strong className="text-white/80">FEMA poll:</strong> timestamp of last successful FEMA/EAS/NWS poll cycle</Li>
            <Li><strong className="text-white/80">NCMEC poll:</strong> timestamp of last NCMEC RSS cycle</Li>
            <Li><strong className="text-white/80">NamUs poll:</strong> timestamp of last NamUs DOJ cycle</Li>
            <Li><strong className="text-white/80">BOLO crawler:</strong> timestamp of last crawl cycle</Li>
            <Li><strong className="text-white/80">Active RTMP streams:</strong> number of live drone streams hitting the nginx ingest server</Li>
            <Li><strong className="text-white/80">Watchlist entries:</strong> count of active plates</Li>
            <Li><strong className="text-white/80">Detections (last hour):</strong> recent pipeline activity</Li>
          </Ul>
          <P>
            If the FEMA poll timestamp is more than 10 minutes stale, the background loop has likely crashed.
            Check PM2 logs: the rtmp_monitor watchdog will have fired a Discord alert if the API process restarted
            five or more times in one interval.
          </P>
          <Screenshot src="/guide/admin-health.png" label="System health panel — API, database, worker, and FEMA poll status" />

          {/* ── ALERT TYPES ─────────────────────────────────── */}
          <H2 id="alert-types">Alert Types</H2>
          <P>
            All alerts in the system are classified by type. The type determines the emoji and color shown in
            Discord notifications, the push notification priority, and how the alert is routed in the mobile app.
          </P>

          <H3 id="type-amber">AMBER Alert / Levi&apos;s Call</H3>
          <P>
            Child abduction. Issued via FEMA IPAWS CMAS CAP XML with event code <code className="font-mono text-xs bg-white/5 px-1.5 py-0.5 rounded">CAE</code>.
            Levi&apos;s Call is Georgia&apos;s equivalent and uses the same pipeline. Highest search priority.
            NamUs cases for subjects under 18 are also classified as AMBER.
          </P>

          <H3 id="type-silver">Silver Alert</H3>
          <P>
            At-risk senior or adult missing person. Issued via FEMA IPAWS CMAS with event code{" "}
            <code className="font-mono text-xs bg-white/5 px-1.5 py-0.5 rounded">CEM</code> and keyword classification
            (Silver Alert, Mattie&apos;s Call). NamUs cases for subjects 65 and older are classified as Silver.
          </P>

          <H3 id="type-blue">Blue Alert</H3>
          <P>
            Endangered or missing law enforcement officer. Issued via FEMA IPAWS CMAS with event code{" "}
            <code className="font-mono text-xs bg-white/5 px-1.5 py-0.5 rounded">LEW</code>. Same ALPR + YOLO pipeline.
          </P>

          <H3 id="type-purple">Purple Alert</H3>
          <P>
            Missing adult with a developmental disability. Issued via FEMA IPAWS CMAS with event code{" "}
            <code className="font-mono text-xs bg-white/5 px-1.5 py-0.5 rounded">CEM</code> and
            Purple Alert keyword match.
          </P>

          <H3 id="type-bolo">BOLO</H3>
          <P>
            Law enforcement be-on-the-lookout notice. Sourced from the NamUs DOJ federal database (adult cases)
            and the configurable BOLO crawler (agency RSS feeds and websites). BOLO alerts for subjects under 18
            are reclassified as AMBER; subjects 65+ are reclassified as Silver. BOLO entries follow the same
            watchlist and YOLO pipeline as FEMA alerts.
          </P>

          <H3 id="type-ncmec">NCMEC</H3>
          <P>
            Missing child cases from the National Center for Missing and Exploited Children. Polled from all
            50 state RSS feeds every 30 minutes. A Discord notification fires only when the case&apos;s state has
            an active FEMA vehicle target — without a vehicle to search for, the case is logged but no alert
            is dispatched. NCMEC cases do not go to the watchlist unless there is also an active FEMA plate match.
          </P>

          {/* Footer */}
          <div className="mt-20 pt-8 border-t border-white/[0.06] flex items-center justify-between">
            <div className="text-xs text-white/25 font-mono">
              Amber&apos;s Angels · 501(c)(3) · EIN 42-2052151 · info@amberangels.org
            </div>
            <Link href="/" className="text-xs text-white/30 hover:text-white/60 transition-colors">
              ← Back to amberangels.org
            </Link>
          </div>

        </main>
      </div>
    </div>
  )
}
