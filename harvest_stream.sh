#!/bin/bash

# --- CONFIGURATION ---
# Format: "DroneName|RTMP_URL"
DRONES=(
    "drone1|rtmp://127.0.0.1/live/drone1"
    "drone2|rtmp://127.0.0.1/live/drone2"
    "drone3|rtmp://127.0.0.1/live/drone3"
)

BASE_DIR="/home/ambers-angels/proj_dir/ambers-angels/backend/test_plates"
FPS="2"

echo "🚀 Starting Multi-Drone Harvester Cluster..."

for drone in "${DRONES[@]}"; do
    # Split the string into Name and URL
    IFS="|" read -r NAME URL <<< "$drone"
    
    TARGET_DIR="$BASE_DIR/$NAME"
    mkdir -p "$TARGET_DIR"

    echo "🛰️  Launching Harvester for $NAME at $URL"

    # Start FFmpeg in the background for this specific drone
    # We use a subshell ( ... ) & to allow auto-restart logic per drone
    (
        while true; do
            ffmpeg -hide_banner -loglevel error \
                   -i "$URL" \
                   -vf "fps=$FPS" -q:v 2 \
                   -f image2 "$TARGET_DIR/frame_%04d.jpg"
            
            echo "⚠️  Connection lost for $NAME ($URL). Retrying in 5s..."
            sleep 5
        done
    ) & 
done

echo "✅ All harvesters are running in the background."
echo "💡 Use 'ps aux | grep ffmpeg' to monitor them."

# Keep the script alive so it doesn't close the background processes immediately
wait
