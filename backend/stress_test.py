import os
import time
import requests
import docker

client = docker.from_env()
container_name = "alpr-service"
test_dir = "/home/ambers-angels/proj_dir/ambers-angels/backend/test_plates"

print("Starting Stress Test: 100 Plates...")
start_time = time.time()

for filename in os.listdir(test_dir):
    if filename.endswith(".jpg"):
        # 1. Copy file to a place Docker can see
        # (Assuming your docker volume is -v /path/to/backend:/data)
        file_path = f"/data/test_plates/{filename}"
        
        # 2. Run ALPR
        result = client.containers.get(container_name).exec_run(f"alpr -j {file_path}")
        # Note: In a real test, you'd parse this and POST to localhost:8000/detections
        print(f"Processed: {filename}")

end_time = time.time()
print(f"Finished! Total time for 100 plates: {end_time - start_time:.2f} seconds")
