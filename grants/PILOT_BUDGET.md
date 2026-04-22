# Amber's Angels: Carroll County Pilot Budget
## 6-Month Program Budget Justification — $5,000 Grant Request

---

## Budget Summary

| Category | Item | Cost | Justification |
| :--- | :--- | ---: | :--- |
| **Technology** | Cloud inference servers (DigitalOcean GPU-capable droplets for YOLOv8 + VMMC processing) | $1,500 | Critical for real-time VMMC detection during live alerts |
| **Technology** | API services — Mapbox (geospatial tracking) + PostgreSQL hosting | $600 | Required for real-time sector assignment and detection logging |
| **Equipment** | Field detection kit — 2× dedicated high-resolution mobile devices + car mounts | $1,200 | Provides dedicated "ground truth" sensor nodes independent of volunteer-owned hardware |
| **Training** | FAA Part 107 Remote Pilot Certificate scholarships (3 local volunteers) | $450 | Expands aerial search capability; Part 107 is legally required for all drone operations |
| **Operations** | UAS liability insurance + data security compliance audit | $1,250 | Required by law enforcement partners; addresses grantor privacy concerns |
| | | | |
| **TOTAL** | | **$5,000** | |

---

## Budget Justification Narrative

### Why This Budget Is Lean (And Why That Matters)

Unlike traditional law enforcement technology that costs $50,000 or more per fixed camera unit, Amber's Angels operates on a **"Bring Your Own Device" (BYOD)** model. Volunteers use their existing vehicles and smartphones as sensor nodes. Our budget covers the intelligence layer — the AI backend and coordination infrastructure — not hardware procurement.

**In-Kind Leverage:** For every $1,000 in grant funding, our volunteer network provides an estimated **$5,000+ in search hours and aerial flight value** (based on fair-market drone pilot rates and volunteer vehicle hours). This 5x impact multiplier means grantors can point to real community leverage, not just operational overhead.

### Line-Item Detail

**Cloud Infrastructure ($1,500)**
Our YOLOv8 + MobileNetV3 inference pipeline requires GPU-capable compute for model training and real-time event processing during active alerts. DigitalOcean GPU droplets at ~$100–$125/month for 12 months covers training iterations and live deployment. This is the "brain" of the search network.

**API Services ($600)**
- Mapbox: Live mission maps for coordinators showing volunteer positions, sector assignments, and detection events. ~$50/month.
- PostgreSQL hosting: Encrypted detection logs and volunteer data. ~$0 (included in DigitalOcean droplet cost; line covers backup and monitoring services).

**Field Detection Kit ($1,200)**
Two dedicated Android devices (Samsung Galaxy A series, ~$300 each) and car mounts serve as permanent, always-ready sensor nodes for law enforcement-observed training exercises and drills — independent of individual volunteer hardware. This ensures exercises can proceed regardless of volunteer device availability.

**Part 107 Training ($450)**
The FAA Part 107 Remote Pilot Certificate is a legal requirement for all drone operations in our aerial search network. Test prep courses cost approximately $150 per candidate. Scholarships for 3 local volunteers ($450 total) directly expand our drone search capability at minimal cost.

**Insurance + Compliance ($1,250)**
- General liability and UAS (drone) insurance: ~$800/year. Required before law enforcement will partner with any volunteer aerial organization.
- Data security audit: ~$450 one-time cost for a third-party review of our privacy-by-design architecture. This gives grantors and law enforcement partners documented assurance that our platform meets data governance standards.

---

## Internal Operating Budget (For Reference — Not the Grant Ask)

The following reflects Amber's Angels' total annual operating picture for IRS Form 990 and grant narrative purposes:

| Category | Item | Annual Cost |
| :--- | :--- | ---: |
| **Legal / Admin** | IRS 1023-EZ fee, GA SOS registration, notary | ~$400 |
| **Infrastructure** | DigitalOcean droplets, Mapbox, domain/SSL | ~$1,200 |
| **Operations** | Insurance (general + UAS), PO Box, secure comms | ~$800 |
| **Equipment** | Demo drone (DJI Mavic 3), testing devices, mounts | ~$2,500 |
| **TOTAL CASH** | | **~$4,900** |

### In-Kind Contributions (Professional Services)

| Role | Expertise | Est. Annual Hours | Fair Market Rate | In-Kind Value |
| :--- | :--- | ---: | ---: | ---: |
| Senior Lead Engineer | ML inference, system architecture, backend API | 480 hrs (10h/wk) | $150/hr | $72,000 |
| Project Coordinator | Grant writing, LEA liaison, compliance | 120 hrs (10h/mo) | $75/hr | $9,000 |
| **Total In-Kind** | | | | **$81,000** |

**Total Programmatic Value (Cash + In-Kind): $85,900**

This figure is the correct representation of organizational capacity for federal grant applications and the IRS 1023-EZ organizational budget worksheet.

---

*Last Updated: April 22, 2026*
