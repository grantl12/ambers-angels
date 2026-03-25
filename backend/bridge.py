import cv2
import docker
import requests
import time
import json
import os
from datetime import datetime

# Setup
client = docker.from_env()
rtmp_url = "rtmp://localhost/live/drone1"
api_url = "http://127.0.0.1:8000/detections"
container_name = "alpr-service"

work_dir = "/home/ambers-angels/proj_dir/ambers-angels/backend"
static_dir = os.path.join(work_dir, "static/captures")
temp_frame = os.path.join(work_dir, "current_frame.jpg")

cap = cv2.VideoCapture(rtmp_url)
print("Archiving Bridge Started. Saving all detected plates to /static/captures/...")

while True:
    ret, frame = cap.read()
    if not ret:
        time.sleep(2)
        cap.open(rtmp_url)
        continue

    cv2.imwrite(temp_frame, frame)
    
    try:
        result = client.containers.get(container_name).exec_run("alpr -j /data/current_frame.jpg")
        output = result.output.decode('utf-8')
        
        if output.strip():
            data = json.loads(output)
            if data.get("results"):
                best = data["results"][0]["candidates"][0]
                plate = best["plate"]
                conf = best["confidence"]
                
                if conf > 80:
                    # Create a unique filename for this detection
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    filename = f"{plate}_{timestamp}.jpg"
                    save_path = os.path.join(static_dir, filename)
                    
                    # Save the permanent evidence image
                    cv2.imwrite(save_path, frame)
                    print(f"STAKE OUT: Saved image for {plate} to {filename}")

                    # Log to Database
                    requests.post(api_url, json={
                        "frame_id": 1,
                        "drone_id": "drone1",
                        "plate_text": plate,
                        "confidence": float(conf)/100,
                        "detected_at": datetime.utcnow().isoformat(),
                        "raw_payload": {"image_path": f"/static/captures/{filename}"}
                    })
    except Exception as e:
        print(f"Error: {e}")

    time.sleep(1)
