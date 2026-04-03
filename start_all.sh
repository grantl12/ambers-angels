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

# /usr/lib/python2.7/dist-packages is required — the openalpr ctypes binding lives there
# and must come after backend/ so the real package (has __init__.py) wins over
# the backend/openalpr/ source tree which Python 3 would otherwise treat as a namespace package.
export PYTHONPATH="$BASE_DIR:$BASE_DIR/backend:$BASE_DIR/worker:/usr/lib/python2.7/dist-packages"
# FRAMES_ROOT is the parent dir; worker scans all drone subdirs automatically.
# nginx exec_push creates test_plates/<stream_name>/ on first publish.
export FRAMES_ROOT="$BASE_DIR/backend/test_plates"
export API_BASE="http://127.0.0.1:8000"

mkdir -p "$BASE_DIR/logs"

# ── 2. Nginx ──────────────────────────────────────────────────────────────────
sudo service nginx start 2>/dev/null || true

# ── 3. API + Web (PM2) ────────────────────────────────────────────────────────
# start if not registered, restart if already there
cd "$BASE_DIR"
$PM2 start ecosystem.config.js 2>/dev/null || $PM2 restart ecosystem.config.js

# ── 4. Unified Worker (tmux) ──────────────────────────────────────────────────
# One process watches all drone subdirs. Models load once — zero extra RAM per
# additional drone. nginx exec_push handles frame extraction for every stream.
tmux kill-session -t aa-worker 2>/dev/null || true
tmux kill-session -t aa-feed   2>/dev/null || true  # retired: exec_push replaced harvest_stream.sh
tmux new-session -d -s aa-worker \
    "cd $BASE_DIR && export PYTHONPATH=$PYTHONPATH FRAMES_ROOT=$FRAMES_ROOT API_BASE=$API_BASE PYTHONUNBUFFERED=1; python3 worker/unified_worker.py 2>&1 | tee logs/worker.log; echo '[worker exited]'; read"

echo ""
echo "================================================"
echo "  Amber's Angels is LIVE"
echo "================================================"
echo "  API     -> pm2 logs ambers-angels-api"
echo "  Web     -> pm2 logs ambers-angels-web"
echo "  Worker  -> tmux attach -t aa-worker"
echo "------------------------------------------------"
echo "  Dashboard  -> http://157.245.125.103/map"
echo "  Health     -> http://157.245.125.103:8000/health"
echo "================================================"
