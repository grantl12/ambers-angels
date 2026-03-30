#!/bin/bash

# Ensure we are in a git repo and create old directory
mkdir -p old

# List of files to move to /old based on start_all.sh being the source of truth
files_to_move=(
    "AA_Launch.py"
    "GPS.py"
    "gps_sender.py"
    "croptop.py"
    "multiDrone.json"
    "telemetry_points.sql"
    "package.json"
    "package-lock.json"
    "test.flv"
    "ffmpeg_log.txt"
    "ssh_key.pub"
)

echo "Cleaning up root directory for Amber's Angels..."

for file in "${files_to_move[@]}"; do
    if [ -f "$file" ]; then
        mv "$file" old/
        echo "Moved to /old: $file"
    else
        echo "Skipping: $file (not found)"
    fi
done

echo "-----------------------------------------------"
echo "Root cleaned. Active orchestration: start_all.sh"
