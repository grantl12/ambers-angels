# Amber's Angels: Grant Strategy & Funding Roadmap

---

## 1. The Elevator Pitch

**The Amber's Angels Advantage: Mobilized Community ALPR**

> *"We turn 25 volunteers in their own cars into 1,000 miles of live license plate coverage — activated in minutes when a child goes missing."*

Traditional ALPR is limited by fixed locations and $50,000-per-unit infrastructure costs. Amber's Angels provides a **decentralized, volunteer-driven network** with a trusted coordination layer that lets citizens safely contribute their mobile sensor data specifically during active AMBER Alerts — and only then.

### The Three-Sentence Ask
Amber's Angels is a Georgia-based 501(c)(3) nonprofit using AI-powered mobile technology to help law enforcement find missing children faster. Our volunteers use their existing smartphones and drones to create a real-time vehicle identification network that covers the residential streets and rural routes stationary cameras cannot reach. We are seeking **$5,000** to fund a 6-month Carroll County pilot that will serve as a replicable model for deployment across Georgia.

---

## 2. Target Grant Pipeline

### Tier 1 — Immediate Targets (Apply Now)

| Grant | Funder | Amount | Deadline | Match Requirement | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| BYRNE JAG (Local) | DOJ / GA DCA | $5K–$25K | Rolling (county-level) | None | Research county coordinator |
| DigitalOcean Hollie's Hub for Good | DigitalOcean | Infrastructure credits | Rolling | None | Apply online |
| Mapbox Community Grant | Mapbox | API credits | Rolling | None | Apply online |
| VFW Smart/Safe Communities | VFW National | $2K–$10K | Annual cycle | None | Confirm next cycle date |
| American Legion Children & Youth | American Legion | Varies | Post/Chapter level | None | Contact local chapter |
| Georgia Power Foundation | GA Power | $1K–$10K | Rolling | Community letters | Draft application |

### Tier 2 — 501(c)(3) Confirmed (3–6 Months Out)

| Grant | Funder | Amount | Notes |
| :--- | :--- | :--- | :--- |
| FEMA BRIC / HMGP | FEMA | $25K–$500K | Requires confirmed LEA partnership letter |
| DOJ AMBER Alert Grant Program | OJP | $50K–$200K | Competitive; requires pilot data |
| Community Foundation for Greater Atlanta | CFGA | $5K–$25K | Strong preference for local organizations |
| Google.org Impact Challenge | Google | $50K–$250K | Tech-for-good focus; highly competitive |
| Microsoft Philanthropies | Microsoft | In-kind + cash | Azure credits + potential cash grant |
| Motorola Solutions Foundation | Motorola | $5K–$20K | Public safety technology focus |

### Tier 3 — Long-Term / Post-Pilot (12+ Months)

| Grant | Funder | Amount | Notes |
| :--- | :--- | :--- | :--- |
| NIJ Research Grant | DOJ / NIJ | $100K–$1M | Requires published pilot results |
| SBA SBIR/STTR | SBA | $150K–$750K | SDVOSB set-aside eligible |
| DHS S&T Cyber Security Division | DHS | $250K+ | Requires established LEA partnerships |
| MacArthur Foundation | MacArthur | $100K–$500K | "Safety and Justice" challenge track |

---

## 3. Critical Documents Checklist

Before applying to Tier 1 grants, have these ready:

- [ ] **IRS CP 575 EIN Confirmation Letter** ✅ (file: `CP_575_E.pdf`)
- [ ] **501(c)(3) Determination Letter** — *in progress (Form 1023-EZ)*
- [ ] **Georgia SOS Registration** — confirm active status
- [ ] **Law Enforcement Letter of Support** — see template below
- [ ] **Board of Directors List** (minimum 3 members for most foundations)
- [ ] **Financial Statements / Budget** ✅ (file: `BUDGET.md`)
- [ ] **Organizational Narrative** ✅ (file: `MISSION_AND_IMPACT.md`)
- [ ] **Technical Description** ✅ (file: `TECHNICAL_WHITEPAPER.md`)
- [ ] **Privacy & Data Ethics Policy** ✅ (file: `PRIVACY_ETHICS.md`)
- [ ] **SDVOSB Certification** — *in progress with SBA*

---

## 4. Law Enforcement Letter of Support (Template)

**Why you need this:** Required for DOJ, FEMA, and most federal grants. Even community foundations value it — it validates the "force multiplier" claim and demonstrates that law enforcement trusts our platform. Send to your local Carroll County Sheriff or Police Chief.

---

[Agency Letterhead]

**Date:** [Date]

**TO:** [Granting Agency Name and Address]
**FROM:** [Chief/Sheriff Name], [Agency Name]
**RE:** Letter of Support — Amber's Angels Inc.

To the Grant Selection Committee,

On behalf of [Agency Name], I am writing to express our strong support for the technology and mission of Amber's Angels Inc., a Georgia-based veteran-led nonprofit.

As a public safety agency serving [County], we recognize that the first hours following a child abduction or missing person report are the most critical for a successful recovery. While our department employs modern investigative tools, we acknowledge that stationary license plate reader (LPR) infrastructure cannot cover all secondary roads, residential areas, and rural routes in our jurisdiction.

Amber's Angels addresses this gap through a volunteer-coordinated, AI-driven vehicle identification network specifically activated during AMBER Alerts and other declared missing person emergencies. Their focus on Vehicle Make, Model, and Color (VMMC) recognition provides actionable intelligence that complements our existing capabilities — particularly when suspect vehicles have obscured or altered license plates.

[Agency Name] is committed to collaborating with Amber's Angels on their Carroll County pilot program and looks forward to seeing this veteran-developed technology enhance the safety of our most vulnerable citizens.

Sincerely,

[Signature Block]
[Name, Title]
[Agency Name, Address, Phone]

---

## 5. Talking Points by Audience

### For Law Enforcement Partners
- We are **not** surveillance infrastructure — we are an on-demand search tool activated only by FEMA IPAWS alerts.
- Every lead we surface is reviewed by a human coordinator before you receive it — no AI-generated false positives cluttering your radio.
- We provide GPS coordinates, timestamp, and vehicle photo — a complete lead package, not just a plate number.
- Our VMMC layer works even when plates are obscured — the most common scenario in vehicle-involved abductions.

### For Community Donors & Foundations
- 76% of abducted children killed in their cases are murdered within the first 3 hours. We fight that clock.
- Your $5,000 doesn't buy one traffic camera — it deploys a 25-node mobile search network across 1,000 miles of road.
- Privacy is non-negotiable: no stored video, no surveillance database, no continuous monitoring.
- 100% veteran-founded; operational overhead is near zero due to volunteer labor.

### For Tech-Focused Grantors (Google, Microsoft, AWS)
- Open-source stack (FastAPI, YOLOv8, MobileNetV3, React Native) — no vendor lock-in.
- Confirmed detections become labeled training data, creating a self-improving model over time.
- Architecture is designed for horizontal scaling — Carroll County is the proof of concept for national deployment.
- Our privacy-by-design approach is a model for responsible community AI that can be cited and replicated.

### For Veteran-Focused Funders (VFW, American Legion, SBA)
- Founded by a Service-Disabled Veteran; SDVOSB certification in progress.
- Combines military-grade operational discipline with civilian technology deployment.
- Provides a meaningful second-service opportunity for veteran drone pilots and technologists in the community.

---

## 6. Pilot Success Metrics

These are the numbers we will publish in our post-pilot transparency report — and that Tier 2/3 grant applications will be built on:

| Metric | Target |
| :--- | :--- |
| Active enrolled volunteers | 35 (30 ground + 5 drone) |
| Total road miles covered per simulated alert | 1,000+ |
| Detection false-positive rate (VMMC dual-factor) | < 5% |
| Mean time from alert activation to first volunteer deployment | < 8 minutes |
| Live alert exercises completed with LEA observer | 3 |
| Coordinator review-to-LEA notification time | < 90 seconds |
| Transparency report published | Yes — public |

---

## 7. 12-Month Funding Roadmap

```
Month 1-2:  Apply for DigitalOcean + Mapbox credits (rolling)
            Submit VFW / American Legion inquiries
            Finalize 501(c)(3) determination letter

Month 2-3:  Secure LEA letter of support (Carroll County)
            Submit CFGA community grant
            Enroll first 15 volunteers; begin training

Month 3-4:  Conduct first live drill with LEA observer
            Apply for BYRNE JAG (county-level coordination)
            Submit Georgia Power Foundation application

Month 4-6:  Complete 30-volunteer enrollment + 3 drills
            Collect pilot performance data

Month 6:    Publish pilot transparency report
            Begin Tier 2 federal grant applications (DOJ/FEMA)
            Expand to second county
```

---

## 8. The "No" Pile — Grants to Avoid

Some funders look attractive but are poor fits:

| Funder | Why It's a Poor Fit |
| :--- | :--- |
| Crime Stoppers affiliate grants | Require anonymous tip programs; our model is different |
| NCMEC direct grants | NCMEC is a partner/validator, not typically a direct funder |
| General tech accelerators (YC, etc.) | Nonprofit structure doesn't fit VC-style equity models |
| Law enforcement equipment grants | We are software + coordination, not hardware vendors |

---

*Last Updated: April 22, 2026*
