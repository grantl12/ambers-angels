import os
import time
import sys
from openalpr import Alpr
from dotenv import load_dotenv

# Ensure we can find the backend folder
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.database import SessionLocal
from backend.services import detection_service, telemetry_service
from backend import schemas  # Import schemas for validation

load_dotenv()

# Initialize OpenALPR once (Global context to save CPU)
alpr = Alpr(os.getenv("ALPR_COUNTRY", "us"), 
            os.getenv("ALPR_CONFIG_FILE", "/etc/openalpr/openalpr.conf"), 
            os.getenv("ALPR_RUNTIME_DIR", "/usr/share/openalpr/runtime_data"))

def process_frame(frame_path):
    db = SessionLocal()
    try:
        results = alpr.recognize_file(frame_path)
        # Grab latest telemetry to link location to the plate
        latest_gps = telemetry_service.get_latest_telemetry(db)
        
        for plate in results['results']:
            # Create the schema object your service expects
            detection_data = schemas.DetectionCreate(
                plate_number=plate['plate'],
                confidence=plate['confidence'],
                frame_path=frame_path,
                telemetry_id=latest_gps.id if latest_gps else None
            )
            
            # Use your ROBUST existing service
            detection_service.create_detection(db=db, detection=detection_data)
            print(f" [SUCCESS] Saved Plate: {plate['plate']} to DB via Service")
            
    except Exception as e:
        print(f" [ERROR] Failed to process {frame_path}: {e}")
    finally:
        db.close()

def watch_frames():
    print(f"Monitoring {FRAME_DIR} for new drone frames...")
    processed_files = set()
    
    while True:
        files = [f for f in os.listdir(FRAME_DIR) if f.endswith(('.jpg', '.png'))]
        for file in files:
            full_path = os.path.join(FRAME_DIR, file)
            if full_path not in processed_files:
                # Add a small delay to ensure FFmpeg has finished writing the file
                time.sleep(0.1) 
                process_frame(full_path)
                processed_files.add(full_path)
        time.sleep(0.5)

if __name__ == "__main__":
    try:
        watch_frames()
    finally:
        alpr.unload()
