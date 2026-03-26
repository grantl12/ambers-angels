import os
import time
import requests
import docker
import json

client = docker.from_env()
container_name = "alpr-service"
# The path on your actual machine
test_dir = "/home/ambers-angels/proj_dir/ambers-angels/backend/test_plates"
api_url = "http://127.0.0.1:8000/detections"

# The path the Docker container now sees thanks to our new mapping
docker_internal_path = "/home/ambers-angels/test_plates"

files = [f for f in os.listdir(test_dir) if f.endswith(".jpg")]
print(f"🚀 Starting Test on {len(files)} images...")

success_count = 0
for filename in sorted(files):
    try:
        # We tell docker to look in its internal version of the folder
        cmd = f"alpr -j {docker_internal_path}/{filename}"
        result = client.containers.get(container_name).exec_run(cmd)
        
        output = json.loads(result.output.decode('utf-8'))
        if output.get("results"):
            plate = output["results"][0]["candidates"][0]["plate"]
            requests.post(api_url, json={
                "frame_id": 0,
                "drone_id": "sim-drone-01",
                "plate_text": plate,
                "confidence": 0.9,
                "detected_at": time.strftime('%Y-%m-%dT%H:%M:%SZ')
            })
            print(f"✅ Found: {plate}")
            success_count += 1
    except Exception as e:
        print(f"❌ Error on {filename}: {e}")

print(f"Done. Found {success_count} plates.")
