# Amber's Angels — Site Improvement Spec
*Generated May 13, 2026 — Hand to Claude Code for implementation*

---

## 🔴 CRITICAL — Fix Before June 2nd

---

### 1. Meta Description (ALL pages)

**Current:**
```
drone surveillance and rescue coordination
```

**Replace with:**
```
Amber's Angels is a volunteer-driven AI platform helping law enforcement find missing children faster during active AMBER Alerts. Privacy-first. Veteran-founded. 501(c)(3).
```

Apply to every page that currently has the old meta description:
- `/` (homepage)
- `/privacy`
- `/retention`
- `/terms` (when created)
- `/deck`
- Any other Next.js pages with the default meta

In Next.js this lives in the `metadata` export or `<Head>` component. Update the default layout metadata so it propagates everywhere.

---

### 2. Remove Specific Flock/LPR Camera Count

**Current (homepage, "The Problem" section):**
```
Carroll County, GA: 503 square miles. Fewer than 12 fixed license plate readers. Dozens of high-probability escape corridors with zero automated surveillance coverage.
```

**Replace with:**
```
Carroll County, GA: 503 square miles. Significant road network with no fixed LPR coverage — residential streets, rural routes, and secondary roads where a suspect vehicle can disappear in minutes.
```

**Current stat card:**
```
<12
fixed LPR cameras covering 503 sq miles in Carroll County
```

**Replace with:**
```
503 sq mi
Carroll County coverage area with significant fixed-camera gaps
```

---

### 3. Carroll County → Carrollton (Pilot Section)

**Current heading:**
```
Carroll County Pilot
## On the ground in Georgia.
```

**Replace with:**
```
Carrollton Pilot Program
## On the ground in Georgia.
```

**Current body:**
```
Six-month deployment in Carroll County — 503 square miles, limited fixed infrastructure, seeking active law enforcement partnership, and a community ready to mobilize.
```

**Replace with:**
```
Six-month deployment in Carrollton, Georgia — a community with significant coverage gaps in its road network, active law enforcement engagement, and a veteran community ready to mobilize.
```

**Current impact math label:**
```
Actively seeking formal law enforcement partnership with Carroll County. Active support from local veteran community aligned with our SDVOSB founding.
```

**Replace with:**
```
Actively engaging local law enforcement. Active support from the Carrollton veteran community aligned with our SDVOSB founding.
```

---

### 4. Law Enforcement Partnership Language (Post-June 2nd swap)

**Current:**
```
Actively seeking formal law enforcement partnership with Carroll County.
```

**After the meeting — replace with:**
```
In active partnership with the Carrollton Police Department.
```

Add a new badge in the homepage hero badge row:
```
Current badges: 501(c)(3) In Formation · Carroll County, GA Pilot · SDVOSB Founded · Privacy-First by Design

Add: Carrollton PD Partnership
```

> ⚠️ Do NOT deploy this change until the Letter of Support is signed.

---

### 5. 501(c)(3) Status Language (ALL instances)

**Find everywhere:** `501(c)(3) In Formation` and `501(c)(3) in formation` and `501(c)(3) nonprofit (pending)`

**Replace all with:** `501(c)(3) Applied`

Locations to update:
- Homepage hero badge row
- Homepage footer
- Privacy policy (`We operate as a 501(c)(3) nonprofit (pending)`)
- README.md on GitHub
- Pitch deck

**Privacy policy specific fix:**

Current:
```
Amber's Angels is a volunteer-run drone license plate recognition network dedicated to assisting in the recovery of missing and abducted children. We operate as a 501(c)(3) nonprofit (pending).
```

Replace with:
```
Amber's Angels is a volunteer-driven public safety platform dedicated to assisting in the recovery of missing and abducted children. We have filed for 501(c)(3) nonprofit status (EIN 42-2052151).
```

---

### 6. Verify /deck is live

Run on server:
```bash
curl -I https://amberangels.org/deck/index.html
```

Should return `200 OK`. If 404 — check nginx config for the `/deck` location block and verify the HTML file exists at the correct path in the Next.js public directory or as a static route.

---

### 7. Standardize Contact Email

**Current inconsistency:**
- Footer: `info@amberangels.org`
- Apple submission: `admin@ambersangels.org`
- Grant documents: `admin@ambersangels.org`
- Privacy policy contact: `info@amberangels.org`

**Decision: Use `info@amberangels.org` as the single public-facing address.**

Find and replace:
- `info@amberangels.org` → `info@amberangels.org` (homepage footer, "Fund the Mission" CTA)
- Ensure `info@amberangels.org` still works as an alias or forward (keep for privacy-specific requests — this is fine to maintain separately)
- Confirm all three addresses are set up and forwarding to Grant's inbox

---

## 🟡 IMPORTANT — Before Grant Applications

---

### 8. Create /terms Page

The footer and privacy policy both link to `/terms` which currently 404s. This needs to exist before any grantor visits the site.

**Create `web/src/app/terms/page.tsx` with the following content:**

```
Terms of Service
Effective date: April 2, 2026

1. Acceptance
By registering as a volunteer or accessing the Amber's Angels platform, you agree to these Terms of Service. If you do not agree, do not use the platform.

2. Eligibility
You must be at least 18 years old to register. Drone pilots must hold a valid FAA Part 107 Remote Pilot Certificate and provide their certificate number at registration. By registering, you agree to use the platform responsibly and in accordance with all applicable laws.

3. Volunteer Conduct
Volunteers must:
- Follow all applicable laws, including FAA regulations for drone operations
- Never follow, confront, or engage with any person or vehicle during a mission
- Never share operational details or detection information publicly
- Comply with the Amber's Angels Volunteer Training Guide at all times

4. No Emergency Services
Amber's Angels is not an emergency service. Always call 911 in an emergency. The platform is a search coordination tool — it does not replace law enforcement response.

5. Intellectual Property
The Amber's Angels platform, including software, AI models, and content, is the property of Amber's Angels Inc. Volunteers are granted a limited, non-transferable license to use the mobile app solely for authorized search missions.

6. Disclaimer of Warranties
The platform is provided "as is." Amber's Angels makes no warranties regarding uptime, detection accuracy, or outcomes. We do not guarantee the recovery of any missing person.

7. Limitation of Liability
To the maximum extent permitted by law, Amber's Angels Inc. shall not be liable for any indirect, incidental, or consequential damages arising from use of the platform.

8. Termination
We may suspend or terminate volunteer access at any time for violations of these terms or the Volunteer Training Guide.

9. Governing Law
These terms are governed by the laws of the State of Georgia.

10. Contact
Questions: info@amberangels.org
Amber's Angels Inc. · 103 Springwood Dr · Carrollton, GA 30117
```

---

### 9. "Support the Mission" CTA Fix

**Current:** "Support the Mission" button links to `#involve` which shows volunteer signup — confusing for donors/grantors.

**Option A (recommended until donation infrastructure is ready):**
Change button label and link:

```
Current: [Support the Mission](#involve)
Replace: [Grant & Partnership Inquiries](mailto:info@amberangels.org)
```

**Option B:** Remove the button entirely and keep only "Become a Volunteer."

---

### 10. Social Proof Block (Post-June 2nd)

After the Carrollton PD letter is signed, add a new section between "How It Works" and "The Platform":

```
## Trusted by Law Enforcement

[Carrollton Police Department logo or seal]
"[Quote from Dobbs or Hitchcock if they provide one]"
— Deputy Chief Chris Dobbs, Carrollton Police Department

In active partnership with Carrollton PD for the Carroll County Pilot Program.
```

If no quote is available, use:
```
In active partnership with the Carrollton Police Department — Carroll County Pilot Program, 2026.
```

---

### 11. GitHub Repo Description

Go to https://github.com/grantl12/ambers-angels → Settings (gear icon top right of repo):

- **Description:** `AI-assisted volunteer platform for real-time missing persons vehicle identification. 501(c)(3) nonprofit. AMBER Alert response.`
- **Website:** `https://amberangels.org`
- **Topics:** `amber-alert`, `missing-persons`, `public-safety`, `alpr`, `yolov8`, `nonprofit`, `drone`, `react-native`

---

### 12. README 501(c)(3) Update

**Current (README.md, multiple locations):**
```
501(c)(3) nonprofit (pending)
501(c)(3) determination pending
donations are currently held in trust pending nonprofit status confirmation
```

**Replace all with:**
```
501(c)(3) nonprofit (application filed, EIN 42-2052151)
501(c)(3) application filed — determination pending
```

Remove the donations held in trust language entirely.

---

## 🟢 POLISH — When You Have Time

---

### 13. Purge "Surveillance" Language

**Find and replace across all public-facing copy:**

| Current | Replace with |
|---|---|
| "drone surveillance" | "aerial search coverage" |
| "surveillance gaps" | "coverage gaps" |
| "surveillance archive" | "video archive" |
| "surveillance network" | "search network" |
| "surveillance coverage" | "camera coverage" |

Primary location: homepage hero section currently says:
```
volunteers and drones fill the surveillance gaps law enforcement can't
```
Replace with:
```
volunteers and drones fill the coverage gaps law enforcement can't
```

---

### 14. Favicon

Confirm `aa-icon.png` is properly set as favicon in the Next.js layout:

```tsx
// app/layout.tsx
export const metadata: Metadata = {
  icons: {
    icon: '/aa-icon.png',
    apple: '/aa-icon.png',
  },
}
```

If it's not rendering in the browser tab, this is why.

---

### 15. Open Graph / Social Preview

Add to `app/layout.tsx` metadata:

```tsx
openGraph: {
  title: "Amber's Angels",
  description: "Volunteer-driven AI platform helping law enforcement find missing children faster during active AMBER Alerts.",
  url: "https://amberangels.org",
  siteName: "Amber's Angels",
  images: [{ url: "/aa-icon.png", width: 512, height: 512 }],
  locale: "en_US",
  type: "website",
},
twitter: {
  card: "summary",
  title: "Amber's Angels",
  description: "Volunteer-driven AI platform helping law enforcement find missing children faster during active AMBER Alerts.",
  images: ["/aa-icon.png"],
},
```

---

### 16. "Contact Grant Lindberg" Label Fix

**Current (Fund the Mission section):**
```
[Contact Grant Lindberg →](mailto:info@amberangels.org)
```

**Replace with:**
```
[Contact Us →](mailto:info@amberangels.org)
```

---

## 🔴 NEW — Accuracy Fixes (Apple Review & Grant Compliance)

---

### 17. Remove Background Check Language Everywhere

The app does NOT implement background checks or identity verification at registration. Volunteers register and get immediate access. This was confirmed May 13, 2026. Remove or correct all references across:

**Privacy Policy (`/privacy`):**

Current:
```
The app does not run in the background when not in use.
```
This is fine — keep. But remove any implication of pre-screening.

**Volunteer Training Guide (`grants/VOLUNTEER_TRAINING_GUIDE.md`):**

Find and remove/replace all references to background checks as a prerequisite:

Current:
```
Passed background check
Government-issued ID verified in-app
Criminal background check (via approved third-party provider)
```

Replace section "Vetting Requirements" with:
```
Vetting Requirements:
- Must be 18 years or older
- Drone pilots: valid FAA Part 107 Remote Pilot Certificate required (certificate number verified at registration)
- Signed agreement to Amber's Angels Terms of Service and Volunteer Code of Conduct
- Admin may suspend or revoke access at any time for violations
```

**Budget Narrative (`grants/BUDGET.md` and `AA_Audit_Proof_Budget_Narrative.docx`):**

Remove any line items referencing background check costs (e.g. "$50 x 35 volunteers") until background checks are actually implemented. Replace with:

```
Volunteer onboarding infrastructure — account management, FAA certificate verification workflow, Terms of Service enforcement
```

**grants/PILOT_BUDGET.md:**

Current:
```
volunteer background checks ($50 x 35 volunteers = $1,750)
```

Replace with:
```
volunteer onboarding and coordination infrastructure ($500)
```

**Demo Prep War Game (`AA_Demo_Prep_WarGame.docx`):**

Find:
```
Government ID verification, criminal background check, and a signed Data Use Agreement before anyone touches a live mission.
```

Replace with:
```
Registration is open to any member of the public 18 or older. Drone pilots must provide a valid FAA Part 107 certificate number. Coordinator access — which includes sensitive operational tools — requires admin approval. We can suspend or revoke any volunteer's access at any time.
```

---

### 18. Camera Permission Button (Apple Guideline 5.1.1iv)

**In mobile app source — find the camera permission pre-prompt screen:**

Current button label:
```
Grant Permission
```

Replace with:
```
Continue
```

This is required for App Store Build 3 submission. Single label change — one line of code.

---

### 19. "Mobile Nav Test

Before June 2nd — open amberangels.org on your phone and verify:
- Nav links are tappable and correctly sized
- Hero section renders without horizontal scroll
- Stat cards stack cleanly on mobile
- All CTA buttons are full-width and easy to tap
- Footer links are readable

Fix any issues in the Next.js responsive CSS before the meeting. Dobbs or Hitchcock will pull it up on their phone in the room.

---

### 20. App Store Connect — Update App Description

The live App Store description (once approved) should match the actual registration flow. Specifically ensure it does not reference background checks or identity verification as part of onboarding, consistent with the actual implementation and the Apple review response submitted May 13, 2026.

Current promotional text and description were drafted before the registration flow was simplified. Have Claude Code cross-reference the App Store Connect copy against the actual onboarding flow and flag any discrepancies before Build 3 submission.
