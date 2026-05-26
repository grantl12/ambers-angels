# Amber's Angels — CPD Meeting War Game
## Carrollton PD · Dobbs & Hitchcock · 06.02.2026

This document is for prep only — do not bring into the room. Every objection below has a "steel man" version (the sharpest form of the objection) and a response. The goal is not to win an argument; it's to demonstrate that we have thought harder about the risks than they have.

**The one thing to never do:** get defensive. When a hard question lands, the right move is to slow down, acknowledge it's a fair concern, and walk through the answer methodically.

---

## Before You Start

**Framing to set in the opener (do it explicitly):**
> "We are a volunteer civilian network that responds to government-issued AMBER Alerts. We are not law enforcement. We do not enable citizens to report crimes. We do not contact officers directly. Every detection goes through a human coordinator we control. We are here today to answer hard questions and, if it makes sense, to ask for a Letter of Support."

If this framing lands before the first slide, most objections below are preempted.

---

## Objection Categories

### 1. LIABILITY

**Steel man:** "If a volunteer gets into an accident, gets into a confrontation, or misidentifies someone, we have a chain-of-custody problem. The letter of support makes us look like we endorsed the program."

**Response:**
- Volunteers cannot enter an active mission without accepting a binding participation agreement — observe and report only, no pursuit, no confrontation, no contact with subjects. We enforce this in the app; it is not an honor system.
- CPD never dispatches volunteers. CPD never instructs volunteers. CPD receives leads from our coordinator, not from volunteers directly. The liability chain breaks at our coordinator, not at your department.
- The Letter of Support is not an endorsement of individual volunteer actions. It is an acknowledgment that the program exists and that CPD is willing to receive leads through a vetted coordination channel. Frame it that way in the draft.
- We carry general liability insurance (policy on file). If they want a certificate of insurance, we provide it.

**Concession if needed:** We can add explicit language to the LOS draft that CPD bears no liability for volunteer conduct and exercises no operational control over the network.

**Hold firm on:** The coordinator gate is non-negotiable. CPD will never receive raw volunteer reports.

---

### 2. PRIVACY / SURVEILLANCE

**Steel man:** "You're building a mobile surveillance network on our streets. Citizens haven't consented to being scanned. This is going to create a political problem for the department."

**Response:**
- The platform activates only when a FEMA IPAWS alert is in force — it is technically incapable of running outside that window. There is no always-on scanning.
- Frames are processed in memory and deleted immediately after inference. No image archive exists. The retention policy is published publicly at amberangels.org/privacy.
- Plate matches exist only inside the active alert window and are purged when the alert closes. We do not build a plate database.
- The FEMA alert itself is a public government broadcast. Responding to it is no different from a citizen noticing a vehicle matching a public BOLO description.
- We are not a surveillance company. Flock, Motorola, Vigilant — those are surveillance companies with persistent databases. We are a response network with ephemeral state.

**Concession if needed:** We are happy to let CPD review our data retention architecture and audit logs before issuing any letter. Open-book.

**Hold firm on:** We do not operate outside of active alerts. This is an architectural constraint, not a policy choice.

---

### 3. FALSE POSITIVES / ACCURACY

**Steel man:** "If your system generates bad leads, you're sending officers to the wrong location during an active child abduction. That's worse than no system at all."

**Response:**
- Plate-only ALPR runs roughly 30% false positives. Our cascade — plate + make + model + color + year — requires multiple corroborating signals before a flag escalates. That rate drops significantly.
- The coordinator is the human gate before anything reaches CPD. They review the detection, the image, the match confidence, and the vehicle profile before confirming. Officers do not receive raw AI output.
- If a coordinator is unsure, the lead is held. We surface it as a low-confidence flag, not as an actionable tip. CPD only receives confirmed leads.
- We can walk through the actual coordinator interface in this meeting if useful.

**Concession if needed:** We can agree to a calibration period where all leads are logged but not transmitted until CPD is comfortable with false-positive rate. This is a reasonable ask for a pilot.

**Hold firm on:** AI flags; humans decide. The coordinator gate exists precisely for this scenario.

---

### 4. INTERFERENCE WITH ACTIVE OPERATIONS

**Steel man:** "What if a volunteer shows up at a scene? What if drone footage ends up online? What if a well-meaning volunteer tips off a suspect?"

**Response:**
- Volunteers are instructed to drive or fly assigned corridors — not to respond to scenes. They are not given suspect location data; they are given search zone polygons. They don't know where officers are concentrating.
- Drone operators are FAA Part 107 certified. They operate on a mission plan generated by our coordinator. They do not freelance.
- Volunteers sign an agreement that prohibits sharing any mission data publicly. Violations are grounds for immediate removal and potential legal action.
- The biggest interference risk with a child abduction is usually social media bystanders — people who drive to a scene after seeing a post. Our volunteers are directed away from scenes and toward corridor coverage.

**Concession if needed:** We can add a geofence buffer around any active scene coordinates CPD provides, automatically excluding it from drone dispatch zones.

**Hold firm on:** Volunteers never receive suspect location data. They receive search polygons.

---

### 5. DATA SECURITY / WHO SEES WHAT

**Steel man:** "You're ingesting active alert data — plate numbers, vehicle descriptions — and processing it on a server you control. What's your security posture? Who else can see this?"

**Response:**
- All data is encrypted in transit (TLS) and at rest (AES-256).
- Access is role-gated: pilots see their assigned mission, coordinators see their managed missions, admins see the audit trail. No volunteer sees another volunteer's data.
- We do not share or sell any data. The only outbound channel is the confirmed lead to CPD via our coordinator (phone or secure message — their preference).
- Our server is hosted on DigitalOcean's NYC3 datacenter (US-based). We can provide the IP range and hosting agreement on request.

**Concession if needed:** We are open to a security audit at any point. If CPD has an IT security officer who wants to review our architecture, we will set that up.

---

### 6. JURISDICTIONAL / MULTI-COUNTY

**Steel man:** "What happens when the suspect crosses into Douglas County or Paulding County? You're operating in jurisdictions we don't control."

**Response:**
- The platform follows the FEMA alert polygon, which is set by the issuing agency. If the alert polygon expands, the network activation expands with it — we don't cross-jurisdictional lines independently.
- We can restrict the Carrollton pilot to Carroll County only, operationally. Volunteers outside the county boundary get a different mission scope or no mission at all.
- Leads are always directed back to CPD as the originating department. They can route to neighboring agencies as they see fit through existing inter-agency channels. We don't route leads to departments we haven't partnered with.

**Concession if needed:** We build a Carroll County operational boundary into the pilot agreement and enforce it in the app.

---

### 7. FAA / DRONE LEGALITY

**Steel man:** "Are your drone pilots legal? Are we going to have an FAA problem if we're associated with this?"

**Response:**
- All drone pilots in the network are FAA Part 107 certified. Certification is verified at enrollment; we check the FAA DrAMP database.
- All missions are within Part 107 visual line-of-sight (VLOS) unless the pilot holds an explicit BVLOS waiver. The app enforces VLOS radius at dispatch time — a coordinator cannot dispatch a drone to a waypoint outside the pilot's operational envelope.
- CPD has zero FAA liability. Drone operators are responsible for their own airspace compliance. The Letter of Support does not create any FAA relationship between CPD and the pilots.
- If it comes up: BVLOS (beyond visual line of sight) is an authorized path under Part 107.39 waiver. We are not operating under Part 108 (autonomous drones) — that rule is not yet in effect.

---

### 8. WHAT DOES THIS COST US?

**Steel man:** "Every new program creates overhead. Staff time, training, protocol updates, public records requests. What's the actual cost to CPD?"

**Response:**
- Zero budget ask. We are not asking CPD for money, staff, or equipment.
- We are asking for: a Letter of Support (one document), a partnership touchpoint at whatever cadence works for them (a phone call per quarter if that's all they want), and a slot in a future tabletop exercise.
- The tabletop is their tool to stress-test the dispatch flow under conditions they control, not ours. It's in their interest.
- If there are public records implications (leads we transmit to CPD becoming subject to open records laws), we want to work through that protocol now, before we go live. Our leads are short-form — plate text, vehicle description, GPS coordinate, coordinator note, timestamp. We can design the transmission format to minimize records burden.

---

### 9. WHY SHOULD WE TRUST A STARTUP?

**Steel man:** "You've been around for how long? What's your track record? Why should we put our name on this?"

**Response:**
- We are not asking CPD to stake their reputation on a cold bet. The Letter of Support acknowledges the program exists and that CPD is willing to receive leads through a vetted channel. You can revoke it with a phone call.
- The platform is live. The coordinator console, the drone dispatch UI, the detection pipeline — these are running today. We can show it to them in the meeting.
- We are a 501(c)(3) nonprofit (determination letter received, EIN 42-2052151). We are not a startup trying to sell a product. Our incentive is mission outcomes, not recurring revenue.
- The founder is a military intelligence veteran with drone flight experience. We take operational security seriously because that is how we were trained.

**Concession if needed:** Propose a 90-day observation period before requesting any public statement. They watch, we operate, they evaluate.

---

### 10. WHAT EXACTLY HAPPENS WHEN YOU GET A HIT?

**Steel man:** "Walk me through the exact workflow. Alert fires, volunteer spots something, then what? Who calls who? What do I tell my dispatcher?"

**Response (step by step):**
1. FEMA IPAWS fires an AMBER Alert. Our system ingests it within 5 minutes.
2. Volunteers enrolled in Carroll County get a push notification with the mission brief (vehicle description, alert polygon — no suspect data).
3. Volunteers opt in. Their phone or drone starts sending frames to our backend.
4. Our cascade inference flags a candidate vehicle.
5. A coordinator (vetted by us, not a volunteer) reviews the detection: image, match confidence, vehicle attributes.
6. If the coordinator confirms: they contact the CPD dispatch line with plate text, vehicle description, GPS coordinate, and timestamp. Method is whatever CPD prefers — phone, secure message, radio patch.
7. CPD responds as they see fit. We do not instruct officers.
8. If the alert is cancelled, the platform stands down automatically. Volunteers are notified. The coordinator closes the mission.

**The question they will ask:** "What's the coordinator's phone number and who do they call?" — We need to agree on a protocol before the pilot goes live. That's one of the three asks: a touchpoint to establish that protocol.

---

## Likely Curveballs

**"Have you done this anywhere else?"**
No. Carrollton is the pilot. That is why we are here — to build the first real-world validation with a law enforcement partner who can help us get it right.

**"What if the alert is a hoax or bad information from FEMA?"**
We don't adjudicate the alert — FEMA does. If FEMA issued it, we respond to it. Same as any other emergency broadcast. If FEMA cancels it, we stand down immediately.

**"What if a volunteer is a bad actor?"**
Background check at enrollment. Binding participation agreement. All coordinator actions are timestamped and auditable. A bad actor volunteer generates frames that go through coordinator review — they can't weaponize that without coordinator confirmation. A bad actor coordinator is our accountability problem, not CPD's, and we accept that.

**"The ACLU is going to come after you."**
That's a fair concern and we've thought about it. Our position: we respond to government-issued public safety alerts using volunteer civilian observation — no different in kind from a neighborhood watch. The technical difference is the AI layer and the coordinator gate, which actually create more accountability than unstructured citizen observation. We don't build a persistent database. We have a public privacy policy. We are open to community advisory input.

**"Why not just partner with Flock?"**
Flock covers fixed infrastructure. We cover mobile corridors. They are not competitive — a suspect who drove past a Flock camera 20 minutes ago and is now on a rural county road is exactly who we're looking for. Hitchcock himself said in 2019 (Fox 5 Atlanta) that having Flock was "very, very helpful — and hopefully it saved somebody's life or even saved his own life." We think so too. We're the part that works after the camera has already been passed.

---

## The Three Asks — Hold the Line

1. **Letter of Support** — one page, revocable, no financial commitment, no liability transfer.
2. **Partnership touchpoint** — whatever cadence works for them. A quarterly call is fine.
3. **Tabletop slot** — a future exercise where they stress-test the dispatch flow. Their agenda, their rules.

Do not trade these for each other. If they say "we'll do a tabletop but not the letter," push back gently — the letter is the foundation for grant eligibility (FEMA BRIC, DOJ AMBER Alert Program both require it). Explain that and let them decide.

---

## Closing Move

If the meeting ends without a clear yes:
> "We are not asking for a decision today. We are asking for a next step. Can we put something on the calendar in two weeks to review a draft Letter of Support? If the language doesn't work for you, we tear it up."

That is the lowest-stakes yes in the room.
