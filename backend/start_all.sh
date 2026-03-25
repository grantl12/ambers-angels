#!/bin/bash
echo "🚀 Starting Amber's Angels System..."

# 1. Start the FastAPI Backend
echo "Starting FastAPI..."
sudo kill -9 $(sudo lsof -t -i:8000) 2>/dev/null
cd /home/ambers-angels/proj_dir/ambers-angels/backend
nohup uvicorn main:app --host 0.0.0.0 --port 8000 > app_log.txt 2>&1 &
sleep 2

# 2. Start the ALPR Docker Container
echo "Starting ALPR Docker Container..."
docker start alpr-service || docker run -d --name alpr-service --restart unless-stopped --memory="768m" -v /home/ambers-angels/proj_dir/ambers-angels/backend:/data openalpr/openalpr

# 3. Start the Vision Bridge
echo "Starting Vision Bridge..."
pkill -f bridge.py 2>/dev/null
nohup python3 bridge.py > bridge_log.txt 2>&1 &

echo "✅ System is ONLINE."
echo "View API logs: tail -f app_log.txt"
echo "View Bridge logs: tail -f bridge_log.txt"
