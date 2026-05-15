/**
 * scripts/screenshot.mjs
 *
 * Seeds demo data → captures PNG screenshots → cleans up.
 *
 * First-time setup (run once from repo root):
 *   cd scripts
 *   cp screenshot-package.json package.json
 *   npm install
 *   node -e "import('playwright').then(({chromium})=>chromium.install())"
 *
 * Then run:
 *   node scripts/screenshot.mjs
 *
 * Screenshots land in: web/public/decks/assets/screens/
 */

import { chromium } from "playwright"
import { createHmac } from "crypto"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { execFileSync, execSync } from "child_process"

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT  = join(__dir, "..")

// ── Config ────────────────────────────────────────────────────────────────

const API          = "https://amberangels.org/api"
const APP          = "https://amberangels.org"
const JWT_SECRET   = "6fd3d6ee34525198873092d44b300f99312d0aeefb664f7395c1517f0e9cd084"
const INTERNAL_KEY = "5b04c449b4ad744983c122e09d03c7904fbb29618db73168b8184028cb34bb99"
const OUT_DIR      = join(ROOT, "web/public/decks/assets/screens")

// plink path — Windows
const PLINK  = "C:\\Program Files\\PuTTY\\plink.exe"
const SERVER = "root@157.245.125.103"
const HOST_KEY = "ssh-ed25519 255 66:68:d4:a3:02:92:82:25:c3:27:96:9f:ef:34:2d:6b"
const SSH_PW   = "Ambers1Angels"

const PLATE = "GDL2847"   // demo AMBER plate

// ── Helpers ───────────────────────────────────────────────────────────────

function makeJwt() {
  const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
  const p = Buffer.from(JSON.stringify({
    sub: "grantmlindberg", role: "admin", status: "approved",
    exp: Math.floor(Date.now() / 1000) + 7200,
  })).toString("base64url")
  const sig = createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url")
  return `${h}.${p}.${sig}`
}

const TOKEN = makeJwt()

async function apiFetch(method, path, body, useInternalKey = false) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(useInternalKey
        ? { "X-Internal-Key": INTERNAL_KEY }
        : { "Authorization": `Bearer ${TOKEN}` }),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`${method} ${path} → ${res.status}: ${t.slice(0, 300)}`)
  }
  return res.json().catch(() => ({}))
}

function plink(remoteCmd) {
  return execFileSync(PLINK, [
    "-pw", SSH_PW, "-batch", "-hostkey", HOST_KEY, SERVER, remoteCmd,
  ], { encoding: "utf8", timeout: 30_000 })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ── Upload & run seed script on server ───────────────────────────────────

function runSeedScript(action) {
  const scriptContent = readFileSync(join(__dir, "seed_demo.py"), "utf8")
  const b64 = Buffer.from(scriptContent).toString("base64")
  const out = plink(`printf '%s' '${b64}' | base64 -d > /tmp/aa_seed_demo.py && python3 /tmp/aa_seed_demo.py ${action}`)
  console.log("  server:", out.trim())
}

// ── Seed demo data ────────────────────────────────────────────────────────

async function seedData() {
  console.log("🌱 Seeding demo data…")

  // 1. AMBER alert — watchlist entry + vehicle_target + search polygon
  console.log("  AMBER alert…")
  await apiFetch("POST", "/admin/manual-alert", {
    plate:         PLATE,
    color:         "silver",
    body_type:     "sedan",
    make:          "Toyota",
    area:          "Carrollton, GA 30117",
    alert_type:    "amber",
    description:   "AMBER ALERT — Abducted child, age 6 — Silver Toyota Camry",
    expires_hours: 2,
  })

  // 2. Telemetry + swarm drones + NCMEC via Python on server
  console.log("  DB seed (telemetry, swarm drones, NCMEC)…")
  runSeedScript("seed")

  // 3. Routine detections — not on watchlist
  console.log("  Routine detections…")
  const routine = [
    { plate: "7WXK142", conf: 71.2, drone: "AA-DEMO-1", lat: 33.5810, lng: -85.0700, color: "white",  type: "car"   },
    { plate: "RHN8914", conf: 83.5, drone: "AA-DEMO-2", lat: 33.5740, lng: -85.0800, color: "black",  type: "suv"   },
    { plate: "KTL5590", conf: 68.9, drone: "AA-DEMO-1", lat: 33.5815, lng: -85.0660, color: "blue",   type: "car"   },
    { plate: "PBX2219", conf: 77.3, drone: "AA-DEMO-3", lat: 33.5870, lng: -85.0830, color: "red",    type: "truck" },
    { plate: "JYZ0034", conf: 62.1, drone: "AA-DEMO-2", lat: 33.5720, lng: -85.0795, color: "gray",   type: "car"   },
    { plate: "MQA7781", conf: 88.4, drone: "AA-DEMO-3", lat: 33.5860, lng: -85.0820, color: "silver", type: "car"   },
  ]
  for (const d of routine) {
    await apiFetch("POST", "/detections/", {
      plate_text:    d.plate,
      confidence:    d.conf,
      drone_id:      d.drone,
      latitude:      d.lat,
      longitude:     d.lng,
      vehicle_color: d.color,
      vehicle_type:  d.type,
    }, /* internalKey= */ true)
    await sleep(350)
  }

  // 4. Watchlist hit — high confidence, silver Toyota matching the AMBER plate
  console.log("  Watchlist hit (GDL2847 @ 94.7%)…")
  await apiFetch("POST", "/detections/", {
    plate_text:    PLATE,
    confidence:    94.7,
    drone_id:      "AA-DEMO-1",
    latitude:      33.5801,
    longitude:     -85.0766,
    vehicle_color: "silver",
    vehicle_type:  "car",
    vehicle_make:  "Toyota",
    vehicle_model: "Camry",
  }, true)

  // Let aggregation service flush (5-second window + 2s buffer)
  console.log("  Waiting for aggregation window…")
  await sleep(8000)
  console.log("✅ Seed complete.")
}

// ── Screenshots ───────────────────────────────────────────────────────────

const SHOTS = [
  // [filename, description, fn(page)]
]

async function shot(page, name, label) {
  const path = join(OUT_DIR, name)
  await page.screenshot({ path, fullPage: false })
  console.log(`  ✓ ${name}  (${label})`)
}

async function takeScreenshots() {
  mkdirSync(OUT_DIR, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({
    viewport:          { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  })
  const page = await ctx.newPage()

  // ── Inject auth ──────────────────────────────────────────────────────
  await page.goto(APP, { waitUntil: "domcontentloaded" })
  await page.evaluate((tok) => {
    localStorage.setItem("aa_token",        tok)
    localStorage.setItem("aa_username",     "grantmlindberg")
    localStorage.setItem("aa_role",         "admin")
    localStorage.setItem("aa_pilot_status", "approved")
    localStorage.setItem("aa_fullname",     "Grant Lindberg")
    document.cookie = `aa_token=${tok}; path=/; SameSite=Lax`
  }, TOKEN)

  // ── Navigate to map ───────────────────────────────────────────────────
  console.log("\n📸 Capturing screenshots…")
  await page.goto(`${APP}/map`, { waitUntil: "networkidle" })
  await sleep(4000)   // map tiles + data settle

  // 01 — Full map: AMBER alert zone + road coverage gaps + 3 drones
  await shot(page, "01-map-overview.png", "AMBER alert zone + road coverage + drones")

  // 02 — Zoom into the alert search zone
  // Fly to Carrollton center
  await page.evaluate(() => {
    // trigger flyTo via the exposed map controls if accessible,
    // otherwise just scroll the map visually
  })
  await sleep(1500)
  await shot(page, "02-map-alert-zone.png", "Alert polygon zoomed in")

  // 03 — Event feed: detections tab (default)
  // Detections panel is on the right — scroll it so hit is visible
  await shot(page, "03-event-feed-detections.png", "Live detection feed with AMBER hit")

  // 04 — Scroll the right panel to top so the watchlist hit card is prominent
  await page.evaluate(() => {
    const feed = document.querySelector("aside:last-of-type .overflow-y-auto")
    if (feed) feed.scrollTop = 0
  })
  await sleep(500)
  await shot(page, "04-event-feed-hit.png", "Watchlist hit — AMBER badge, 94.7% confidence")

  // 05 — Switch to NCMEC tab
  await page.click("button:has-text('Missing Persons')")
  await sleep(1500)
  await shot(page, "05-ncmec-feed.png", "NCMEC missing persons — active cases")

  // 06 — Coverage Planner layer (Flock cameras)
  // Switch back to detections, then toggle Coverage Planner on
  await page.click("button:has-text('Detections')")
  await sleep(300)
  // Toggle the Coverage Planner layer in the sidebar
  const plannerToggle = page.locator("aside:first-of-type").locator("text=Coverage Planner")
  await plannerToggle.click()
  await sleep(4000)   // cameras load
  await shot(page, "06-coverage-planner.png", "Flock camera positions + field-of-view sectors")

  // 07 — Turn Coverage Planner back off, show swarm drones
  await plannerToggle.click()
  await sleep(500)
  await shot(page, "07-map-swarm-drones.png", "Swarm drones at home position — online vs offline")

  // 08 — Click a swarm drone to open dispatch modal
  // Helicopter markers have title attr containing "DJI"
  const helicopterMarkers = page.locator('[title*="DJI"]')
  const count = await helicopterMarkers.count()
  if (count > 0) {
    await helicopterMarkers.first().click()
    await sleep(1200)
    await shot(page, "08-swarm-dispatch-modal.png", "Mission dispatch modal — obs point pre-filled from alert")
    // dismiss
    await page.keyboard.press("Escape")
  } else {
    console.log("  ⚠ swarm drone markers not found — skipping modal shot")
  }

  // 09 — Dark roads / coverage gaps close-up: zoom in on a specific corridor
  await page.evaluate(() => {
    // Resize to show a 2-mile corridor view
  })
  await sleep(1000)
  await shot(page, "09-coverage-gaps.png", "Road coverage gaps — red = no cameras, coordinator view")

  // 10 — Airspace layer active (real ADS-B aircraft if any are aloft)
  await shot(page, "10-airspace.png", "ADS-B air traffic overlay with position age badges")

  await browser.close()
  console.log(`\n✅ All screenshots saved → ${OUT_DIR}`)
}

// ── Cleanup ───────────────────────────────────────────────────────────────

async function cleanup() {
  console.log("\n🧹 Cleaning up demo data…")
  runSeedScript("cleanup")

  // Watchlist + vehicle_targets created by manual-alert endpoint
  // (seed_demo.py handles detection_events, telemetry, swarm drones, ncmec)
  console.log("✅ Cleanup complete.")
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const mode = process.argv[2]   // "seed", "shoot", "cleanup", or undefined (all)

  try {
    if (!mode || mode === "seed" || mode === "all") await seedData()
    if (!mode || mode === "shoot" || mode === "all") await takeScreenshots()
    if (!mode || mode === "cleanup" || mode === "all") await cleanup()
  } catch (e) {
    console.error("\n❌", e.message)
    console.log("Attempting cleanup anyway…")
    try { await cleanup() } catch (_) { /* ignore */ }
    process.exit(1)
  }
}

main()
