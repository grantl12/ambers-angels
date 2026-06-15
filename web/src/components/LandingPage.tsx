'use client'

import { useEffect, useRef, useState } from 'react'
import s from '@/app/landing.module.css'
import LiveTerminal from './LiveTerminal'

const TABS = [
  { key: 'scan',    label: 'Phone Scanning',    svg: '04-phone-background-mode.svg',  caption: 'Scan-while-you-drive: a persistent foreground service keeps frame uploads running even when you navigate to Maps or Uber (Android). iOS: keep app foregrounded.' },
  { key: 'drone',   label: 'DJI Drone Mode',    svg: '07-dji-connection.svg',         caption: '4-step DJI setup flow: power on → GPS lock → select Drone mode → Start Mission. GPS telemetry auto-attached to every uploaded frame.' },
  { key: 'map',     label: 'Mission Map',        svg: '05-mission-map.svg',            caption: 'Coordinator dashboard: live volunteer positions, active alert polygons (FEMA feed, refreshed every 60s), out-of-range warnings, and tap-to-detail on every asset.' },
  { key: 'angles',  label: 'Camera Positioning', svg: '01-drone-camera-angles.svg',   caption: 'Pilot positioning guide: operate from road shoulder or adjacent field — never over active lanes. 30–45° camera angle, ≤200 ft AGL, visual line of sight at all times (FAA Part 107).' },
  { key: 'mission', label: 'Start a Mission',    svg: '03-start-mission.svg',         caption: '5-step in-app onboarding: volunteer mode → device identity → capture interval → save settings → go live. Settings persist across restarts.' },
]


const FAQS = [
  {
    q: 'Do I need a drone or special equipment to volunteer?',
    a: 'No. For ground volunteers, all you need is an Android or iPhone and a car mount. The app runs in the background while you drive your normal routes — your phone becomes a mobile sensor node. Drone pilots need a DJI-compatible aircraft and an FAA Part 107 certificate; the app connects to your DJI hardware directly in four steps.',
  },
  {
    q: 'What exactly happens when an AMBER Alert fires?',
    a: 'The moment FEMA IPAWS issues an alert, our platform automatically ingests it, extracts the alert vehicle description (plate, make, model, color), and sends push notifications to enrolled volunteers in the affected area. Volunteers receive a sector assignment and open a mission. Every frame their phone or drone captures is scanned in real-time by our Cascade Inference engine — no manual steps required.',
  },
  {
    q: 'Does the app store footage of my car or my neighborhood?',
    a: "No. Raw frames are processed the instant they arrive and deleted immediately — we never build a video archive. The only data we retain is a high-confidence detection record (plate text, GPS coordinates, timestamp, and a cropped vehicle image) for vehicles matching an active alert. Innocent vehicles generate no stored record whatsoever.",
  },
  {
    q: 'Is my location tracked when I\'m not on a mission?',
    a: "Your GPS is only transmitted when you have an active mission open in the app. The moment you end a mission or close the session, location reporting stops. We have no background location capability outside of an active alert response.",
  },
  {
    q: 'How accurate is the vehicle identification?',
    a: 'Plate-only systems run roughly 30% false positive rates due to misreads, partial plates, and switched plates. Our Cascade Inference engine layers OpenALPR plate reading with YOLOv8 visual make, model, color, and year-range classification. That combination drops false positives to under 5% in field testing. Every high-confidence hit also goes through human coordinator review before any alert notification is dispatched.',
  },
  {
    q: 'Who reviews detections before an alert notification is dispatched?',
    a: "Trained coordinators. Every AI detection is flagged to a coordinator dashboard — no result is acted on until a human reviews the photo, GPS location, and confidence score and explicitly approves it. AI flags. Humans decide. That's not a disclaimer; it's how the system is architected.",
  },
  {
    q: 'Is Amber\'s Angels a real nonprofit?',
    a: "Yes. We are a federally recognized 501(c)(3) public charity (EIN 42-2052151), incorporated and headquartered in Carrollton, Georgia. Determination letter received. All financial information is available on request.",
  },
  {
    q: 'Only AMBER Alerts? What about missing seniors or adults?',
    a: "The platform responds to five government-issued alert types: AMBER Alerts (abducted children), Silver Alerts (missing seniors with dementia or Alzheimer's), Mattie's Call (adults with developmental disabilities), Purple Alerts (missing persons with disabilities), and Blue Alerts (endangered law enforcement officers). All five are ingested automatically from FEMA IPAWS — no manual activation needed.",
  },
  {
    q: 'How do I get my city or county involved?',
    a: "We're currently running our pilot program in Carrollton, GA and are actively building the evidence base for expansion. If you're a law enforcement agency, emergency management office, or civic organization interested in a future deployment, email us at info@amberangels.org. Partnership inquiries from grant-making organizations are also welcome.",
  },
]

export default function LandingPage() {
  const [activeTab, setActiveTab] = useState('scan')
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new IntersectionObserver(
      (entries) => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add(s.visible) }),
      { threshold: 0.1 }
    )
    root.querySelectorAll(`.${s.fadeUp}`).forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  return (
    <div className={s.landing} ref={rootRef}>

      {/* NAV */}
      <nav className={s.nav}>
        <a className={s.navBrand} href="#">
          <img src="/aa-icon.png" alt="AA" />
          <span className={s.navWordmark}>Amber&apos;s <em>Angels</em></span>
        </a>
        <ul className={s.navLinks}>
          <li><a href="#how">How It Works</a></li>
          <li><a href="#platform">Platform</a></li>
          <li><a href="#alerts">Alert Types</a></li>
          <li><a href="#pilot">Pilot</a></li>
          <li><a href="#privacy">Privacy</a></li>
          <li><a href="#faq">FAQ</a></li>
          <li><a href="#explore">Explore</a></li>
          <li><a href="#blog">Writing</a></li>
        </ul>
        <a href="/login" className={s.navSignIn}>Sign In</a>
        <a href="#involve" className={s.navCta}>Get Involved →</a>
      </nav>

      {/* HERO */}
      <section id="hero" className={s.hero}>
        <div>
          <div className={s.heroKicker}>AMBER Alert Response Network</div>
          <div className={s.heroStat}>76%</div>
          <p className={s.heroStatDetail}>
            of abducted children who are murdered are killed within the{' '}
            <strong>first 3 hours</strong> of a missing child emergency. The window is closing fast.
          </p>
        </div>
        <div>
          <h1 className={s.heroHeadline}>Amber&apos;s Angels<br /><em>closes that window.</em></h1>
          <p className={s.heroBody}>
            A community-driven AI search network. When an AMBER Alert fires, volunteers and drones fill the coverage gaps no fixed system can — and AI identifies the vehicle before it&apos;s too late.
          </p>
          <div className={s.heroCtas}>
            <a href="#involve" className={s.btnPrimary}>Become a Volunteer</a>
            <a href="mailto:info@amberangels.org" className={s.btnGhost}>Grant &amp; Partnership Inquiries</a>
          </div>
          <div className={s.heroBadges}>
            <span className={s.heroBadge}>501(c)(3) Approved</span>
            <span className={s.heroBadge}>Carrollton, GA Pilot</span>
            <span className={s.heroBadge}>SDVOSB Founded</span>
            <span className={s.heroBadge}>Privacy-First by Design</span>
          </div>
        </div>
      </section>

      {/* PROBLEM */}
      <section id="problem" className={`${s.section} ${s.problem}`}>
        <div className={s.fadeUp}>
          <span className={s.label}>The Problem</span>
          <div className={s.sectionHeader}>
            <h2>The gap is real — and it&apos;s geographic.</h2>
            <p>Carroll County, GA: 503 square miles. Significant road network with no fixed LPR coverage — residential streets, rural routes, and secondary roads where a vehicle can disappear in minutes.</p>
          </div>
        </div>
        <div className={`${s.problemGrid} ${s.fadeUp}`}>
          <div>
            <div className={s.statGrid}>
              <div className={s.statCard}><div className={s.statNum}>3 hrs</div><div className={s.statDesc}>critical window — 76% of fatal missing child cases occur within this timeframe</div></div>
              <div className={s.statCard}><div className={s.statNum}>503 sq mi</div><div className={s.statDesc}>Carroll County coverage area with significant fixed-camera gaps</div></div>
              <div className={s.statCard}><div className={s.statNum}>~30%</div><div className={s.statDesc}>false positive rate for plate-only vehicle detection systems</div></div>
              <div className={s.statCard}><div className={s.statNum}>&lt;5%</div><div className={s.statDesc}>false positive rate using our dual VMMC verification model</div></div>
            </div>
            <p className={s.sourceNote}>Source: OJJDP / National Center for Missing &amp; Exploited Children</p>
          </div>
          <div>
            <div className={s.mapBox}>
              <svg viewBox="0 0 400 280" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
                <rect width="400" height="280" fill="#111827"/>
                <line x1="0" y1="140" x2="400" y2="136" stroke="rgba(255,255,255,0.1)" strokeWidth="5"/>
                <line x1="200" y1="0" x2="198" y2="280" stroke="rgba(255,255,255,0.08)" strokeWidth="4"/>
                <line x1="0" y1="72" x2="400" y2="80" stroke="rgba(255,255,255,0.06)" strokeWidth="2.5"/>
                <line x1="0" y1="210" x2="400" y2="200" stroke="rgba(255,255,255,0.06)" strokeWidth="2.5"/>
                <line x1="105" y1="0" x2="100" y2="280" stroke="rgba(255,255,255,0.05)" strokeWidth="2"/>
                <line x1="300" y1="0" x2="304" y2="280" stroke="rgba(255,255,255,0.05)" strokeWidth="2"/>
                <rect x="20" y="90" width="70" height="52" fill="rgba(239,68,68,0.14)" rx="2"/>
                <rect x="230" y="28" width="64" height="44" fill="rgba(239,68,68,0.14)" rx="2"/>
                <rect x="240" y="155" width="60" height="48" fill="rgba(239,68,68,0.12)" rx="2"/>
                <rect x="32" y="175" width="55" height="52" fill="rgba(239,68,68,0.11)" rx="2"/>
                <rect x="118" y="180" width="52" height="40" fill="rgba(239,68,68,0.1)" rx="2"/>
                <circle cx="200" cy="138" r="8" fill="#f59e0b" opacity="0.9"/>
                <circle cx="104" cy="72" r="8" fill="#f59e0b" opacity="0.9"/>
                <circle cx="300" cy="200" r="8" fill="#f59e0b" opacity="0.9"/>
                <circle cx="200" cy="78" r="8" fill="#f59e0b" opacity="0.7"/>
                <circle cx="20" cy="258" r="6" fill="#f59e0b"/>
                <text x="32" y="263" fill="rgba(255,255,255,0.45)" fontSize="11" fontFamily="system-ui">Fixed LPR</text>
                <rect x="116" y="252" width="12" height="12" fill="rgba(239,68,68,0.5)" rx="1"/>
                <text x="133" y="263" fill="rgba(255,255,255,0.45)" fontSize="11" fontFamily="system-ui">Coverage gap</text>
              </svg>
            </div>
            <p className={s.mapLabel}>Carroll County, GA — illustrative coverage map</p>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className={`${s.section} ${s.how}`}>
        <div className={s.fadeUp}>
          <span className={s.label}>How It Works</span>
          <div className={s.sectionHeader}>
            <h2>Alert fires. Network activates. AI finds the vehicle.</h2>
            <p>Every enrolled volunteer becomes a mobile sensor node. Our Cascade Inference engine identifies not just a license plate — but the specific make, model, and year range of the vehicle in the alert. Even when plates are switched or missing.</p>
          </div>
        </div>
        <div className={`${s.flowRow} ${s.fadeUp}`}>
          {[
            { icon: '📡', title: 'FEMA IPAWS Fires',       body: 'Government-verified alert triggers platform activation automatically' },
            { icon: '📲', title: 'Mission Push Sent',       body: 'Volunteers receive sector assignments based on Flight Priority Zones' },
            { icon: '🔍', title: 'Cascade Inference',       body: 'YOLOv8 + OpenALPR scans every frame for plate, make, model, and color', highlight: true },
            { icon: '👤', title: 'Human Review',            body: 'Every high-confidence hit reviewed by a coordinator before any action is taken' },
            { icon: '🎯', title: 'Lead Confirmed',            body: 'Coordinator-verified sighting — GPS coordinates, photo, and vehicle profile ready for responding teams' },
          ].map(step => (
            <div key={step.title} className={`${s.flowStep}${step.highlight ? ` ${s.stepHighlight}` : ''}`}>
              <div className={s.stepIcon}>{step.icon}</div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          ))}
        </div>
        <div className={`${s.flowNote} ${s.fadeUp}`}>
          <strong>Cascade Inference:</strong>{' '}Our proprietary model identifies make, model, and year range — so coordinators can document &ldquo;Blue 2018–2021 Honda CR-V, Highway 5, 14:32&rdquo; even when the plate is obscured or switched. Reducing false positives from ~30% to &lt;5%.
        </div>
      </section>

      <LiveTerminal />

      {/* PLATFORM */}
      <section id="platform" className={`${s.section} ${s.platform}`}>
        <div className={s.fadeUp}>
          <span className={s.label}>The Platform</span>
          <div className={s.sectionHeader}>
            <h2>Built for field conditions. Zero extra hardware required.</h2>
            <p>Volunteers use their existing smartphone. Drone pilots connect DJI hardware directly to our platform. Every frame is processed in real-time and deleted immediately — no video archive, ever.</p>
          </div>
        </div>
        <div className={s.tabs}>
          {TABS.map(t => (
            <button
              key={t.key}
              className={`${s.tab}${activeTab === t.key ? ` ${s.tabActive}` : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {TABS.map(t => (
          <div key={t.key} className={activeTab === t.key ? s.panelActive : s.panel}>
            <div className={s.diagramFrame} style={t.key === 'mission' ? { maxWidth: 560 } : undefined}>
              <img src={`/graphics/${t.svg}`} alt={`${t.label} diagram`} style={{ width: '100%', height: 'auto', display: 'block' }} />
            </div>
            <p className={s.diagramCaption}>{t.caption}</p>
          </div>
        ))}
      </section>

      {/* ALERT TYPES */}
      <section id="alerts" className={`${s.section} ${s.alerts}`}>
        <div className={s.fadeUp}>
          <span className={s.label}>Multi-Alert Response</span>
          <div className={s.sectionHeader}>
            <h2>Not just AMBER Alerts.</h2>
            <p>Our platform activates across five government-issued alert types — protecting children, seniors, adults with disabilities, and endangered officers.</p>
          </div>
        </div>
        <table className={`${s.alertsTable} ${s.fadeUp}`}>
          <thead>
            <tr>
              <th>Alert Type</th>
              <th>Population Served</th>
              <th>Trigger</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><span className={`${s.chip} ${s.chipAmber}`}>AMBER Alert</span></td><td>Abducted children</td><td><span className={s.chipTrigger}>FEMA IPAWS — automated</span></td></tr>
            <tr><td><span className={`${s.chip} ${s.chipSilver}`}>Silver Alert</span></td><td>Missing seniors with dementia / Alzheimer&apos;s</td><td><span className={s.chipTrigger}>FEMA IPAWS — automated</span></td></tr>
            <tr><td><span className={`${s.chip} ${s.chipMattie}`}>Mattie&apos;s Call</span></td><td>At-risk adults with developmental disabilities</td><td><span className={s.chipTrigger}>FEMA IPAWS — automated</span></td></tr>
            <tr><td><span className={`${s.chip} ${s.chipPurple}`}>Purple Alert</span></td><td>Missing persons with disabilities</td><td><span className={s.chipTrigger}>State emergency system</span></td></tr>
            <tr><td><span className={`${s.chip} ${s.chipBlue}`}>Blue Alert</span></td><td>Endangered law enforcement officers</td><td><span className={s.chipTrigger}>State emergency system</span></td></tr>
          </tbody>
        </table>
      </section>

      {/* PILOT */}
      <section id="pilot" className={`${s.section} ${s.pilot}`}>
        <div className={s.fadeUp}>
          <span className={s.label}>Carrollton Pilot Program</span>
          <div className={s.sectionHeader}>
            <h2>On the ground in Georgia.</h2>
            <p>Six-month deployment in Carrollton, Georgia — a community with significant coverage gaps in its road network, active emergency management engagement, and a veteran community ready to mobilize.</p>
          </div>
        </div>
        <div className={`${s.pilotGrid} ${s.fadeUp}`}>
          <ul className={s.pilotGoals}>
            <li className={s.pilotGoal}><div className={s.goalNum}>1</div><div className={s.goalText}>Enroll and train <strong>30 ground volunteers</strong> and <strong>5 Part 107-certified drone pilots</strong></div></li>
            <li className={s.pilotGoal}><div className={s.goalNum}>2</div><div className={s.goalText}>Achieve operational readiness for <strong>live AMBER Alert response</strong></div></li>
            <li className={s.pilotGoal}><div className={s.goalNum}>3</div><div className={s.goalText}>Demonstrate successful VMMC detection in <strong>field exercises with emergency management observers</strong></div></li>
            <li className={s.pilotGoal}><div className={s.goalNum}>4</div><div className={s.goalText}>Publish a <strong>public transparency report</strong> on detection accuracy and privacy compliance</div></li>
          </ul>
          <div>
            <div className={s.impactCard}>
              <h4>Impact Math — Launch Day</h4>
              {[
                ['Active search nodes',         '25'],
                ['Road miles per node / alert', '~40 mi'],
                ['Total additional coverage',   '~1,000 mi'],
                ['False positive rate (VMMC)',  '<5%'],
                ['vs. plate-only systems',      '~30%'],
              ].map(([label, val]) => (
                <div key={label} className={s.impactRow}>
                  <span className={s.impactLabel}>{label}</span>
                  <span className={s.impactVal}>{val}</span>
                </div>
              ))}
              <p className={s.supportNote}>Actively engaging local emergency management. Active support from the Carrollton veteran community aligned with our SDVOSB founding.</p>
            </div>
          </div>
        </div>
      </section>

      {/* PRIVACY */}
      <section id="privacy" className={`${s.section} ${s.privacy}`}>
        <div className={s.fadeUp}>
          <span className={s.label}>Privacy First</span>
          <div className={s.sectionHeader}>
            <h2>We save lives without building a surveillance state.</h2>
            <p>Every architectural decision begins with one question: what is the minimum data required for this mission? Raw footage is never stored. Innocent citizens are never profiled.</p>
          </div>
        </div>
        <div className={`${s.privacyGrid} ${s.fadeUp}`}>
          <div className={s.pillar}>
            <div className={s.pillarIcon}>
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="4" y="12" width="22" height="16" rx="3" stroke="#f59e0b" strokeWidth="2" fill="none"/>
                <path d="M26 17l8-4v14l-8-4V17z" stroke="#f59e0b" strokeWidth="2" fill="none" strokeLinejoin="round"/>
                <line x1="6" y1="34" x2="34" y2="6" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
            </div>
            <h3>No Video Archiving</h3>
            <p>Raw footage is processed in real-time and deleted immediately. We build no searchable database of innocent citizens.</p>
          </div>
          <div className={s.pillar}>
            <div className={s.pillarIcon}>
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="20" cy="20" r="14" stroke="#f59e0b" strokeWidth="2" fill="none"/>
                <circle cx="20" cy="20" r="7" stroke="#f59e0b" strokeWidth="2" fill="none"/>
                <circle cx="20" cy="20" r="2.5" fill="#f59e0b"/>
              </svg>
            </div>
            <h3>Operational Necessity Only</h3>
            <p>We collect and store only data strictly required for the active search mission. Nothing more.</p>
          </div>
          <div className={s.pillar}>
            <div className={s.pillarIcon}>
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="20" cy="14" r="6" stroke="#f59e0b" strokeWidth="2" fill="none"/>
                <path d="M8 34c0-6.627 5.373-12 12-12s12 5.373 12 12" stroke="#f59e0b" strokeWidth="2" fill="none" strokeLinecap="round"/>
                <path d="M27 22l3 3 5-5" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h3>Human in the Loop</h3>
            <p>No AI result triggers a notification without human coordinator review. AI flags. Humans decide.</p>
          </div>
          <div className={s.pillar}>
            <div className={s.pillarIcon}>
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="8" y="6" width="24" height="28" rx="3" stroke="#f59e0b" strokeWidth="2" fill="none"/>
                <line x1="13" y1="14" x2="27" y2="14" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="13" y1="20" x2="27" y2="20" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="13" y1="26" x2="21" y2="26" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <h3>Public Transparency</h3>
            <p>Our data retention policies are public and rigorous. Published with every pilot transparency report.</p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className={`${s.section} ${s.faq}`}>
        <div className={s.fadeUp}>
          <span className={s.label}>FAQ</span>
          <div className={s.sectionHeader}>
            <h2>Common questions.</h2>
            <p>From volunteers, parents, and partners — answered plainly.</p>
          </div>
        </div>
        <div className={`${s.faqList} ${s.fadeUp}`}>
          {FAQS.map((item, i) => (
            <div key={i} className={`${s.faqItem}${openFaq === i ? ` ${s.faqOpen}` : ''}`}>
              <button
                className={s.faqQ}
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                aria-expanded={openFaq === i}
              >
                <span className={s.faqQText}>{item.q}</span>
                <span className={s.faqIcon}>{openFaq === i ? '−' : '+'}</span>
              </button>
              <div className={s.faqA}>
                <p>{item.a}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* GET INVOLVED */}
      <section id="involve" className={s.involve}>
        <span className={s.label}>Join the Network</span>
        <h2>Be there when it matters most.</h2>
        <p className={s.involveLead}>Every volunteer hour is time a child gets back. Every dollar funds the infrastructure that makes the search possible.</p>
        <div className={s.involveGrid}>
          <div className={s.involveCard}>
            <h3>Volunteer — Ground</h3>
            <p>Drive your normal routes during active alerts. Your phone does the work. No special hardware needed — just a car mount and the app.</p>
            <a href="/pilot/register">Create an Account →</a>
          </div>
          <div className={s.involveCard}>
            <h3>Volunteer — Drone</h3>
            <p>Part 107 certified? Put your skills and your aircraft to work. DJI hardware connects directly to our platform in four steps.</p>
            <a href="/pilot/register">Register as a Pilot →</a>
          </div>
          <div className={s.involveCard}>
            <h3>Fund the Mission</h3>
            <p>We&apos;re a federally recognized 501(c)(3) nonprofit (EIN 42-2052151). Every dollar of grant funding goes directly toward operational readiness — no software licensing fees.</p>
            <a href="mailto:info@amberangels.org">Contact Us →</a>
          </div>
        </div>
      </section>

      {/* EXPLORE */}
      <section id="explore" className={`${s.section} ${s.explore}`}>
        <div className={s.fadeUp}>
          <span className={s.label}>Go Deeper</span>
          <div className={s.sectionHeader}>
            <h2>See the full picture.</h2>
            <p>The platform is more than the app. Explore the operational strategy, the technical architecture, and the people behind it.</p>
          </div>
        </div>
        <div className={`${s.exploreGrid} ${s.fadeUp}`}>
          <a href="/deck/carrollton" target="_blank" rel="noopener noreferrer" className={s.exploreCard}>
            <span className={s.exploreTag}>Carrollton PD Pitch</span>
            <h3>What we presented to emergency management.</h3>
            <p>Community deployment strategy, operational readiness timeline, and the partnership framework we brought to the Carrollton Police Department. If you want to understand where the pilot is headed, start here.</p>
            <span className={s.exploreArrow}>View deck →</span>
          </a>
          <a href="/deck/tech" target="_blank" rel="noopener noreferrer" className={s.exploreCard}>
            <span className={s.exploreTag}>Technical Deep Dive</span>
            <h3>Alert through to coordinator determination — end to end.</h3>
            <p>FEMA IPAWS ingestion, Cascade Inference engine, YOLO + OpenALPR fusion, human review loop, and mission dispatch. Every layer of the stack, explained without the marketing.</p>
            <span className={s.exploreArrow}>View deck →</span>
          </a>
          <a href="/deck/stories" target="_blank" rel="noopener noreferrer" className={s.exploreCard}>
            <span className={s.exploreTag}>Volunteer Stories</span>
            <h3>Four ways to help. Zero overlap.</h3>
            <p>Maria scanned 340 plates during her lunch break. DeShawn covered two thousand on a single delivery shift — and didn&apos;t know about the flag until later. The platform fits everyone.</p>
            <span className={s.exploreArrow}>View deck →</span>
          </a>
        </div>
        <div className={`${s.exploreMore} ${s.fadeUp}`}>
          <span>More</span>
          <a href="/guide" target="_blank" rel="noopener noreferrer">User Guide</a>
          <a href="/deck/platform" target="_blank" rel="noopener noreferrer">Platform Overview</a>
          <a href="/deck/grant" target="_blank" rel="noopener noreferrer">Grant &amp; Financial Info</a>
          <a href="/deck/about" target="_blank" rel="noopener noreferrer">About the Founder</a>
          <a href="/deck/partnership" target="_blank" rel="noopener noreferrer">Partnership Capabilities</a>
        </div>
      </section>

      {/* THE COVERAGE GAP — BLOG SERIES */}
      <section id="blog" className={s.blog}>
        <div className={`${s.blogHeader} ${s.fadeUp}`}>
          <div>
            <p className={s.blogSeriesLabel}>The Coverage Gap · Weekly Series</p>
            <h2 className={s.blogTitle}>Written for the field.</h2>
            <p className={s.blogDesc}>
              Eight posts on where fixed ALPR ends, where mobile volunteer AI begins, and why the future of public safety technology has to be event-triggered, not always-on.
            </p>
          </div>
          <a href="/blog" className={s.blogAllLink}>All posts →</a>
        </div>
        <div className={`${s.blogGrid} ${s.fadeUp}`}>
          <a href="/blog/coverage-gap-intro" target="_blank" rel="noopener noreferrer" className={s.blogCard}>
            <span className={s.blogPostTag}>Series Introduction</span>
            <h3>The Coverage Gap</h3>
            <p className={s.blogPostDate}>Grant Lindberg · June 2026</p>
            <p>Fixed ALPR covers the intersections. Amber&apos;s Angels covers everything between them. A jurisdiction with both has no blind spots — fixed infrastructure at fixed points, mobile volunteers covering every road in between.</p>
            <span className={s.blogReadLink}>Read →</span>
          </a>
          <a href="/blog/post-1-always-on" target="_blank" rel="noopener noreferrer" className={s.blogCard}>
            <span className={s.blogPostTag}>Post 1 of 8 · June 17</span>
            <h3>The Problem with Always-On</h3>
            <p className={s.blogPostDate}>Grant Lindberg · June 2026</p>
            <p>Every technology that retains data creates risk. The problem isn&apos;t character — it&apos;s architecture. A system that retains data creates liability whether or not anyone ever misuses it.</p>
            <span className={s.blogReadLink}>Read →</span>
          </a>
        </div>
      </section>

      {/* FOOTER */}
      <footer className={s.footer}>
        <div className={s.footerBrand}>
          <img src="/aa-icon.png" alt="AA" />
          <span>Amber&apos;s Angels · 501(c)(3) Approved · info@amberangels.org · amberangels.org</span>
        </div>
        <div className={s.footerLinks}>
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms of Service</a>
          <a href="https://www.faa.gov/uas/commercial_operators/become_a_drone_pilot" target="_blank" rel="noopener noreferrer">FAA Part 107</a>
          <a href="mailto:info@amberangels.org">Contact</a>
        </div>
      </footer>

    </div>
  )
}
