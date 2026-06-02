'use client'

import { useEffect, useRef, useState } from 'react'
import s from '@/app/landing.module.css'

const TABS = [
  { key: 'scan',    label: 'Phone Scanning',    svg: '04-phone-background-mode.svg',  caption: 'Scan-while-you-drive: a persistent foreground service keeps frame uploads running even when you navigate to Maps or Uber (Android). iOS: keep app foregrounded.' },
  { key: 'drone',   label: 'DJI Drone Mode',    svg: '07-dji-connection.svg',         caption: '4-step DJI setup flow: power on → GPS lock → select Drone mode → Start Mission. GPS telemetry auto-attached to every uploaded frame.' },
  { key: 'map',     label: 'Mission Map',        svg: '05-mission-map.svg',            caption: 'Coordinator dashboard: live volunteer positions, active alert polygons (FEMA feed, refreshed every 60s), out-of-range warnings, and tap-to-detail on every asset.' },
  { key: 'angles',  label: 'Camera Positioning', svg: '01-drone-camera-angles.svg',   caption: 'Pilot positioning guide: operate from road shoulder or adjacent field — never over active lanes. 30–45° camera angle, ≤200 ft AGL, visual line of sight at all times (FAA Part 107).' },
  { key: 'mission', label: 'Start a Mission',    svg: '03-start-mission.svg',         caption: '5-step in-app onboarding: volunteer mode → device identity → capture interval → save settings → go live. Settings persist across restarts.' },
]

const DECKS = [
  { label: 'Carrollton Pilot',  href: '/deck/carrollton'          },
  { label: 'Financial Info',    href: '/deck/grant'                },
  { label: 'Technical',         href: '/deck/tech'                 },
  { label: 'Volunteer Stories', href: '/deck/stories'              },
  { label: 'About the Founder', href: '/deck/about'                },
]

export default function LandingPage() {
  const [activeTab, setActiveTab] = useState('scan')
  const [deckOpen, setDeckOpen] = useState(false)
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
            <strong>first 3 hours</strong> of the abduction. The window is closing before law enforcement can cover the ground.
          </p>
        </div>
        <div>
          <h1 className={s.heroHeadline}>Amber&apos;s Angels<br /><em>closes that window.</em></h1>
          <p className={s.heroBody}>
            A community-driven AI search network. When an AMBER Alert fires, volunteers and drones fill the coverage gaps law enforcement can&apos;t — and AI identifies the vehicle before it&apos;s too late.
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
            <p>Carroll County, GA: 503 square miles. Significant road network with no fixed LPR coverage — residential streets, rural routes, and secondary roads where a suspect vehicle can disappear in minutes.</p>
          </div>
        </div>
        <div className={`${s.problemGrid} ${s.fadeUp}`}>
          <div>
            <div className={s.statGrid}>
              <div className={s.statCard}><div className={s.statNum}>3 hrs</div><div className={s.statDesc}>critical window — 76% of fatal abductions occur within this timeframe</div></div>
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
            <p>Every enrolled volunteer becomes a mobile sensor node. Our Cascade Inference engine identifies not just a license plate — but the specific make, model, and year range of the suspect vehicle. Even when plates are switched or missing.</p>
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
          <strong>Cascade Inference:</strong> Our proprietary model identifies make, model, and year range — so coordinators can tell law enforcement &ldquo;Blue 2018–2021 Honda CR-V, Highway 5, 14:32&rdquo; even when the plate is obscured or switched. Reducing false positives from ~30% to &lt;5%.
        </div>
      </section>

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
            <p>Six-month deployment in Carrollton, Georgia — a community with significant coverage gaps in its road network, active law enforcement engagement, and a veteran community ready to mobilize.</p>
          </div>
        </div>
        <div className={`${s.pilotGrid} ${s.fadeUp}`}>
          <ul className={s.pilotGoals}>
            <li className={s.pilotGoal}><div className={s.goalNum}>1</div><div className={s.goalText}>Enroll and train <strong>30 ground volunteers</strong> and <strong>5 Part 107-certified drone pilots</strong></div></li>
            <li className={s.pilotGoal}><div className={s.goalNum}>2</div><div className={s.goalText}>Achieve operational readiness for <strong>live AMBER Alert response</strong></div></li>
            <li className={s.pilotGoal}><div className={s.goalNum}>3</div><div className={s.goalText}>Demonstrate successful VMMC detection in <strong>field exercises with law enforcement observers</strong></div></li>
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
              <p className={s.supportNote}>Actively engaging local law enforcement. Active support from the Carrollton veteran community aligned with our SDVOSB founding.</p>
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
            <p>No AI result reaches law enforcement without human coordinator review. AI flags. Humans decide.</p>
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

      {/* GET INVOLVED */}
      <section id="involve" className={s.involve}>
        <span className={s.label}>Join the Network</span>
        <h2>Be there when it matters most.</h2>
        <p className={s.involveLead}>Every volunteer hour is time a child gets back. Every dollar funds the infrastructure that makes the search possible.</p>
        <div className={s.involveGrid}>
          <div className={s.involveCard}>
            <h3>Volunteer — Ground</h3>
            <p>Drive your normal routes during active alerts. Your phone does the work. No special hardware needed — just a car mount and the app.</p>
            <a href="/pilot/register.html">Create an Account →</a>
          </div>
          <div className={s.involveCard}>
            <h3>Volunteer — Drone</h3>
            <p>Part 107 certified? Put your skills and your aircraft to work. DJI hardware connects directly to our platform in four steps.</p>
            <a href="/pilot/register.html">Register as a Pilot →</a>
          </div>
          <div className={s.involveCard}>
            <h3>Fund the Mission</h3>
            <p>We&apos;re a federally recognized 501(c)(3) nonprofit (EIN 42-2052151). Every dollar of grant funding goes directly toward operational readiness — no software licensing fees.</p>
            <a href="mailto:info@amberangels.org">Contact Us →</a>
          </div>
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
          <span style={{ position: 'relative' }}>
            <button
              onClick={() => setDeckOpen(o => !o)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 13, color: 'var(--text-dim)', fontFamily: 'inherit', transition: 'color 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-muted)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
            >
              Information Sheets ▾
            </button>
            {deckOpen && (
              <>
                <div onClick={() => setDeckOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9 }} />
                <div style={{
                  position: 'absolute', bottom: '100%', left: 0, marginBottom: 8, zIndex: 10,
                  background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8, padding: '6px 0', minWidth: 180,
                  boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                }}>
                  {DECKS.map(d => (
                    <a
                      key={d.href}
                      href={d.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setDeckOpen(false)}
                      style={{
                        display: 'block', padding: '8px 16px', fontSize: 13,
                        color: 'var(--text-dim)', textDecoration: 'none', whiteSpace: 'nowrap',
                        transition: 'background 0.1s, color 0.1s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#fff' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-dim)' }}
                    >
                      {d.label}
                    </a>
                  ))}
                </div>
              </>
            )}
          </span>
          <a href="https://www.faa.gov/uas/commercial_operators/become_a_drone_pilot" target="_blank" rel="noopener noreferrer">FAA Part 107</a>
          <a href="/terms">Terms of Service</a>
          <a href="mailto:info@amberangels.org">Contact</a>
        </div>
      </footer>

    </div>
  )
}
