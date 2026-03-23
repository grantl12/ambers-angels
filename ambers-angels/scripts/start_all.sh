#!/usr/bin/env bash
set -e

PROJECT_ROOT="/root/ambers-angels"
BACKEND_DIR="$PROJECT_ROOT/backend"
WORKER_DIR="$PROJECT_ROOT/worker"
LOG_DIR="$PROJECT_ROOT/logs"

mkdir -p "$LOG_DIR"

echo "Starting Amber's Angels services..."

# ---- Backend env ----
export DB_NAME="ambersangels"
export DB_USER="postgres"
export DB_PASSWORD="Ambers1Angels"
export DB_HOST="127.0.0.1"
export DB_PORT="5432"

# ---- Worker / telemetry env ----
export API_BASE="http://127.0.0.1:8000"
export DRONE_ID="drone1"
export FRAMES_DIR="/root/frames/drone1"

# Start FastAPI
echo "Starting API..."
cd "$BACKEND_DIR"
nohup python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 > "$LOG_DIR/api.log" 2>&1 &
echo $! > "$LOG_DIR/api.pid"

sleep 2

# Start GPS sender
echo "Starting GPS sender..."
cd "$PROJECT_ROOT"
nohup python3 gps_sender.py > "$LOG_DIR/gps_sender.log" 2>&1 &
echo $! > "$LOG_DIR/gps_sender.pid"

sleep 1

# Start frame worker
echo "Starting frame worker..."
cd "$WORKER_DIR"
nohup python3 process_frames.py > "$LOG_DIR/frame_worker.log" 2>&1 &
echo $! > "$LOG_DIR/frame_worker.pid"

echo ""
echo "All services started."
echo "Logs: $LOG_DIR"
echo "API PID: $(cat "$LOG_DIR/api.pid")"
echo "GPS PID: $(cat "$LOG_DIR/gps_sender.pid")"
echo "Worker PID: $(cat "$LOG_DIR/frame_worker.pid")"
