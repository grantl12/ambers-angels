#!/usr/bin/env bash
set -e

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PM2="$HOME/.local/bin/pm2"

# ── 1. Environment ────────────────────────────────────────────────────────────
if [ -f "$BASE_DIR/.env" ]; then
    set -a; source "$BASE_DIR/.env"; set +a
else
    echo "WARNING: .env not found at $BASE_DIR/.env — secrets will be missing"
fi

export PYTHONPATH="$BASE_DIR:$BASE_DIR/backend:$BASE_DIR/worker"
export FRAMES_DIR="$BASE_DIR/backend/test_plates"
export DRONE_ID="${DRONE_ID:-drone1}"
export API_BASE="http://127.0.0.1:8000"

mkdir -p "$BASE_DIR/logs"

# ── 2. Nginx ──────────────────────────────────────────────────────────────────
sudo service nginx start 2>/dev/null || true

# ── 3. API + Web (PM2) ────────────────────────────────────────────────────────
# start if not registered, restart if already there
cd "$BASE_DIR"
$PM2 start ecosystem.config.js 2>/dev/null || $PM2 restart ecosystem.config.js

# ── 4. Unified Worker (tmux) ──────────────────────────────────────────────────
tmux kill-session -t aa-worker 2>/dev/null || true
tmux new-session -d -s aa-worker \
    "cd $BASE_DIR && export PYTHONPATH=$PYTHONPATH FRAMES_DIR=$FRAMES_DIR DRONE_ID=$DRONE_ID API_BASE=$API_BASE; python3 worker/unified_worker.py 2>&1 | tee logs/worker.log; echo '[worker exited]'; read"

# ── 5. RTMP Feed Harvester (tmux) ─────────────────────────────────────────────
tmux kill-session -t aa-feed 2>/dev/null || true
tmux new-session -d -s aa-feed \
    "cd $BASE_DIR && bash harvest_stream.sh 2>&1 | tee logs/feed.log; echo '[feed exited]'; read"

echo ""
echo "================================================"
echo "  Amber's Angels is LIVE"
echo "================================================"
echo "  API     -> pm2 logs ambers-angels-api"
echo "  Web     -> pm2 logs ambers-angels-web"
echo "  Worker  -> tmux attach -t aa-worker"
echo "  Feed    -> tmux attach -t aa-feed"
echo "------------------------------------------------"
echo "  Dashboard  -> http://157.245.125.103/map"
echo "  Health     -> http://157.245.125.103:8000/health"
echo "================================================"
