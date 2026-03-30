#!/bin/bash

# --- CONFIGURATION ---
DRONES=(
    "drone1|rtmp://127.0.0.1/live/drone1"
    "drone2|rtmp://127.0.0.1/live/drone2"
    "drone3|rtmp://127.0.0.1/live/drone3"
)

BASE_DIR="/home/ambers-angels/proj_dir/ambers-angels/backend/test_plates"
FPS="3"

# --- CLEANUP HANDLER ---
cleanup() {
    echo -e "\n\n🛑 Shutting down Harvester Cluster..."
    pkill -P $$ ffmpeg 2>/dev/null
    echo "✅ All FFmpeg instances stopped."
    exit 0
}

trap cleanup SIGINT SIGTERM

echo "🚀 Starting Multi-Drone Harvester Cluster..."

for drone in "${DRONES[@]}"; do
    IFS="|" read -r NAME URL <<< "$drone"
    TARGET_DIR="$BASE_DIR/$NAME"
    mkdir -p "$TARGET_DIR"

    # Start the loop in the background
    (
        while true; do
            # 1. We removed '-er 4' and used '-flags +discardcorrupt' for compatibility
            # 2. We redirect STDERR (2) to /dev/null so "Option not found" doesn't spam
            ffmpeg -hide_banner -loglevel panic \
                   -fflags nobuffer+genpts \
                   -flags +discardcorrupt \
                   -i "$URL" \
                   -vf "fps=$FPS" -q:v 2 \
                   -vsync vfr \
                   -f image2 "$TARGET_DIR/frame_%04d.jpg" 2>/dev/null
            
            # This only prints if ffmpeg exits (connection lost or never started)
            echo "📡 [$NAME] Searching for stream..."
            sleep 5
        done
    ) & 
done

echo "✅ Harvesters are polling for drone connections."
echo "💡 Press Ctrl+C to stop."

wait
