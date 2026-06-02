# Amber's Angels — Site Improvement Backlog
*Last audited June 2, 2026*

Items 1–20 from the original May 2026 list are complete. What remains:

---

## Waiting on CPD Letter of Support

### 1. LE Partnership Language + Badge

Once the Letter of Support is signed:

- Hero badge row: add `Carrollton PD Partnership`
- Line 252 of `LandingPage.tsx`: `"Actively engaging local law enforcement"` → `"In active partnership with the Carrollton Police Department"`
- Add "Trusted by Law Enforcement" social proof block between "How It Works" and "The Platform":

```
## Trusted by Law Enforcement
[Carrollton PD seal]
"[Quote from Dobbs/Hitchcock if provided]"
— Deputy Chief Chris Dobbs, Carrollton Police Department

In active partnership with Carrollton PD — Carrollton Pilot Program, 2026.
```

---

## Waiting on App Store Approval

### 2. App Store Description Update

Build 4 is under review. When approved:
- Remove any "report criminal activity" framing from the description
- Add CPD partnership language (after letter is signed)
- No background check language anywhere in App Store copy — none is implemented

---

## Quick Manual Task

### 3. GitHub Repo Settings

Go to github.com/grantl12/ambers-angels → Settings:
- **Description:** `AI-assisted volunteer platform for real-time missing persons vehicle identification. 501(c)(3) nonprofit. AMBER Alert response.`
- **Website:** `https://amberangels.org`
- **Topics:** `amber-alert`, `missing-persons`, `public-safety`, `alpr`, `yolov8`, `nonprofit`, `drone`, `react-native`

---

## Content Depth (Airo Audit — June 2026)

### 4. National Statistics for Problem Framing

Add a national/global AMBER Alert gap block to "The Problem" section. Sources: NCMEC, DOJ/OJJDP, FEMA IPAWS. Lead with national scope, land on Carrollton as the pilot model. Include a scalability statement.

### 5. Data Governance Page (`/governance`)

Create a public-facing page documenting: data retention timelines, deletion policy (account deletion already implemented), role-based access controls, consent mechanisms (ToS gate, version-tracked), public commitments (no data sale, no use outside active alert response, open-source codebase). Link from footer alongside `/privacy` and `/terms`.

### 6. Pipeline Explainer + Glossary (`/how-it-works` or expanded `/deck/tech`)

Web-readable version of the Cascade Inference pipeline: alert ingestion → frame upload → OpenALPR → YOLOv8-nano → Plate Recognizer → AggregationService → confidence score → AlertDispatcher. Include privacy safeguards. Add glossary: YOLOv8, OpenALPR, IPAWS, ALPR, CMAS, CAP, NCMEC, Part 107.

**Do not publish specific false positive rate claims until verified pilot data exists.**

### 7. Section Anchor IDs

Add `id` attributes to major landing page sections for deep-linking. Suggested: `#problem`, `#how-it-works`, `#platform`, `#privacy`, `#pilot`, `#about`, `#contact`.

---

## Post-Pilot (Blocked Until Real Data)

### 8. Impact Metrics + Case Studies

Once the Carrollton pilot generates real data: coverage achieved, detection pipeline performance, response times, volunteer engagement, CPD quotes. **Do not publish with synthetic or demo data.**
