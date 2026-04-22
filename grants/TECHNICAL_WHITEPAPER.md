# Technical Whitepaper: Amber’s Angels
## The Core Engine: Distributed ALPR & Multi-Signal Verification

Amber’s Angels is a mission-specific emergency response platform designed for rapid mobilization during missing person crises. Our architecture leverages a distributed edge-computing model to turn everyday mobile hardware into a high-precision search and rescue network.

---

## 1. The Technology Stack

### **Edge AI & Mobile (The Detection Nodes)**
*   **Framework:** Expo / React Native (TypeScript)
*   **Computer Vision:** 
    *   **YOLOv8 (Ultralytics):** Real-time vehicle and plate detection.
    *   **MobileNetV3:** Localized generational classification (Make/Model/Year range).
    *   **OpenALPR / ONNX Runtime:** Optimized alphanumeric OCR for license plate recognition on mobile hardware.
*   **Telemetry:** Real-time GPS tracking and geofencing via `expo-location` and `react-native-maps`.

### **Backend Infrastructure (The Coordination Hub)**
*   **API Framework:** FastAPI (Python 3.10) with asynchronous request handling.
*   **Database:** PostgreSQL (Self-hosted on DigitalOcean) with SQLAlchemy (AsyncIO) for high-concurrency event ingestion.
*   **Authentication:** JWT-based secure auth with `passlib` and `python-jose`.
*   **Rate Limiting:** `slowapi` to prevent system abuse during active alerts.

### **Network & Deployment**
*   **Compute:** DigitalOcean Droplets for centralized API and database hosting.
*   **Edge Hardware:** DJI Mavic 3 Drones (Part 107 volunteer-operated) and Android/iOS smartphones.
*   **Security:** End-to-end encryption for all LPR data; raw frames are processed in-memory and deleted post-inference.

---

## 2. Core Operational Mechanics

### **Mobile Node Ingestion**
When a FEMA IPAWS alert is triggered, authorized volunteer nodes are mobilized. Using the device's camera, the mobile app scans for alphanumeric plate data using our custom localized OCR engine, reducing the need for high-bandwidth video streaming.

### **Multi-Signal Verification (VMMC)**
Once a potential plate match is detected, the system runs a secondary verification layer:
1.  **Plate OCR:** High-speed alphanumeric recognition.
2.  **VMMC Check:** Verification of the vehicle's Make, Model, and Color against the alert profile.
3.  **Two-Factor Result:** Only detections that pass both signals are escalated to law enforcement, significantly reducing false positives compared to standard ALPR.

### **Privacy-by-Design**
Amber’s Angels is not a 24/7 surveillance tool. 
*   **Ephemeral Processing:** Frames are analyzed and immediately discarded. 
*   **Event-Triggered:** The system only activates during declared emergencies.
*   **Mission Specificity:** Data is only volunteered by users who explicitly opt-in to a specific search mission.

---

## 3. Scalability & Sustainability
By utilizing a distributed tech stack, Amber's Angels remains highly scalable with minimal capital expenditure. The reliance on volunteer-owned edge devices (drones/phones) ensures the network can cover residential and rural "search gaps" that stationary LPR infrastructure cannot reach.
