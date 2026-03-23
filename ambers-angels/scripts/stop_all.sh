#!/usr/bin/env bash
set +e

PROJECT_ROOT="/root/ambers-angels"
LOG_DIR="$PROJECT_ROOT/logs"

echo "Stopping Amber's Angels services..."

for file in "$LOG_DIR/api.pid" "$LOG_DIR/gps_sender.pid" "$LOG_DIR/frame_worker.pid"; do
if [ -f "$file" ]; then
PID=$(cat "$file")
kill "$PID" 2>/dev/null
rm -f "$file"
echo "Stopped PID $PID"
fi
done

echo "Done."
