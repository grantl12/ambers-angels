# Technical Whitepaper: Amber’s Angels
## The Core Engine: Distributed ALPR & Multi-Signal Verification

The Amber’s Angels platform is built on a high-speed, localized Automatic License Plate Recognition (ALPR) pipeline designed for rapid mobilization.

### 1. Mobile Node Ingestion
When an alert is active, authorized volunteer nodes (drones/smartphones) scan for alphanumeric plate data using our custom OCR engine.

### 2. VMMC Cross-Referencing
Once a plate is detected, the system runs a secondary Vehicle Make, Model, and Color (VMMC) check. This two-factor identification (Plate + Vehicle Profile) significantly reduces false positives.

### 3. Privacy-First Data Volunteering
Our ALPR is mission-specific. It is not a 24/7 surveillance tool; it is an emergency response system that only activates during declared crises, ensuring we maintain long-term community trust.

### 4. Cascade Inference Model
We leverage a proprietary "Cascade Inference" model that integrates YOLOv8 for object detection and MobileNetV3 for generational vehicle classification, optimized for real-time edge processing.
