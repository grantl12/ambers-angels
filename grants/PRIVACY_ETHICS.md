# Amber's Angels: Operational Privacy & Data Ethics

---

## 1. Introduction

Amber's Angels is committed to the highest standards of privacy and ethical AI deployment. Our platform is designed to act as a force multiplier for missing persons recovery while strictly adhering to a **"Privacy-by-Design"** philosophy. We believe technology can save lives without creating a surveillance state — and we have engineered our system from the ground up to prove it.

This document outlines our data governance commitments to our volunteers, the communities we serve, law enforcement partners, and grant-awarding bodies.

---

## 2. The Privacy-by-Design Framework

Unlike traditional surveillance systems, Amber's Angels does not build persistent databases of citizen movement. Our technology is **event-triggered and ephemeral** by architectural design — not just by policy.

### Core Principles

| Principle | What It Means in Practice |
| :--- | :--- |
| **No Video Archiving** | Raw video streams are processed in real-time. Once the inference engine analyzes a frame, it is immediately deleted from memory — never written to disk. |
| **Event-Triggered Only** | Inference processing only activates during declared, government-issued alerts (AMBER, Silver, Mattie's Call, etc.). The platform is dormant between events. |
| **Mission Specificity** | Volunteers explicitly opt in to each individual search mission. There is no passive background collection. |
| **Facial Obfuscation** | Our pipeline includes automated protocols to obfuscate faces and non-suspect license plates in any data passed to downstream systems. |
| **Minimum Necessary Collection** | We collect only the data operationally required for the active search. GPS telemetry, for example, is mission-scoped, not continuous. |

---

## 3. Data Minimization & Retention Schedule

| Data Type | Purpose | Retention Period | Who Can Access |
| :--- | :--- | :--- | :--- |
| GPS Telemetry | Mission mapping and coverage verification | 90 days | Coordinators only |
| Detection Records | Law enforcement leads (plate + VMMC data only) | 1 year | Coordinators + LEA on active case |
| Volunteer Identity | Background checks, accountability, and vetting | Duration of volunteer status | Admin only |
| Raw Video Frames | Real-time inference only | **Not retained** — deleted post-inference | Processing system only (ephemeral) |
| Alert Metadata | FEMA IPAWS alert source, timestamp, activation log | 2 years (compliance) | Admin only |

All retention schedules are enforced at the infrastructure level through automated deletion routines — not dependent on manual processes.

---

## 4. What We Do Not Do

It is equally important to be explicit about the boundaries of our system:

- **We do not sell or share volunteer or detection data** with any commercial entity, data broker, or third party outside of active law enforcement coordination.
- **We do not operate continuously.** Between active alerts, the platform's detection capabilities are offline.
- **We do not create citizen movement profiles.** Without persistent storage, a searchable history of where any individual has been cannot exist.
- **We do not share data with immigration enforcement or agencies outside the scope of the triggering missing person alert.**

---

## 5. Volunteer Accountability & Vetting

All volunteers must complete a background screening prior to being granted access to the active search platform. This is not optional — it is a core trust mechanism for our law enforcement partners and for the communities we serve.

**Vetting Requirements:**
- Government-issued ID verification
- Criminal background check (via approved third-party provider)
- Completion of the Amber's Angels Volunteer Training Program
- Signed Data Use Agreement acknowledging privacy responsibilities
- For drone pilots: FAA Part 107 Remote Pilot Certificate (or supervised flight status)

---

## 6. AI Ethics & Bias Mitigation

Our AI models (YOLOv8 + MobileNetV3 + OpenALPR) are mission-scoped tools, not autonomous decision-makers.

**Human-in-the-Loop by Design:** No detection result is ever transmitted directly to law enforcement. Every potential match is reviewed by a trained human coordinator before escalation. The AI surfaces leads; humans validate them.

**Bias Awareness:** We acknowledge that vehicle recognition AI can carry training data biases. Our team actively monitors for disparate false-positive rates across vehicle types and geographic contexts, and we are committed to publishing model performance audits as our dataset grows.

**Transparency:** Our general system architecture and data governance policies are public. We welcome scrutiny from civil liberties organizations, academic researchers, and grant oversight bodies.

---

## 7. Regulatory Alignment

| Framework | Our Position |
| :--- | :--- |
| **COPPA** | No minors may create volunteer accounts. The platform does not interact with child users. |
| **CCPA / State Privacy Laws** | Ephemeral processing and no commercial data sharing keeps us well within state-level privacy requirements. |
| **FAA Part 107** | All drone operations require certified pilots or supervised training. No autonomous drone flight. |
| **FEMA IPAWS** | We consume official IPAWS feeds — we do not generate or amplify unofficial alerts. |
| **GDPR (informational)** | Our privacy-by-design architecture aligns with GDPR principles, positioning us for future international expansion. |

---

## 8. Contact & Accountability

Questions regarding data governance, privacy concerns, or requests for records deletion may be directed to:

**Amber's Angels Inc.**
Email: admin@amberangels.org
Website: amberangels.org

*Last Updated: April 22, 2026*
