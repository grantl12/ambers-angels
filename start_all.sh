#!/bin/bash

# Amber's Angels - Master Orchestration
echo "🚀 Launching Amber's Angels Pipeline..."

# 1. Environment & Secrets
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    source "$SCRIPT_DIR/.env"
    set +a
else
    echo "⚠️  WARNING: .env file not found at $SCRIPT_DIR/.env — secrets will be missing!"
fi
export FRAME_ROOT="/home/ambers-angels/proj_dir/ambers-angels/backend/test_plates"
export FRAMES_DIR="$FRAME_ROOT"

# 2. Critical Path Fix
# We add both the root and the backend folder to PYTHONPATH
BASE_DIR=$(pwd)
export PYTHONPATH=$BASE_DIR:$BASE_DIR/backend:$BASE_DIR/worker:/usr/lib/python2.7/dist-packages

# 3. Infrastructure
sudo service nginx start

# 4. Start Backend
# We run uvicorn from the root but point to the backend package
tmux kill-session -t aa-backend 2>/dev/null
tmux new-session -d -s aa-backend "cd $BASE_DIR && export PYTHONPATH=$PYTHONPATH; uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload"

# 5. Start Unified Worker
# Ensure we use python3 -m to handle imports correctly
tmux kill-session -t aa-worker 2>/dev/null
tmux new-session -d -s aa-worker "cd $BASE_DIR && export PYTHONPATH=$PYTHONPATH; python3 worker/unified_worker.py"

# 6. Start Feed Harvester
tmux kill-session -t aa-feed 2>/dev/null
if [ -f "./harvest_stream.sh" ]; then
    chmod +x ./harvest_stream.sh
    tmux new-session -d -s aa-feed "./harvest_stream.sh"
fi

# 7. Start Frontend (PM2)
~/.local/bin/pm2 restart ambers-angels-web 2>/dev/null || \
    (cd /opt/ambers-angels/web && ~/.local/bin/pm2 start npm --name ambers-angels-web -- start)

echo "================================================"
echo "  ✅  Amber's Angels is LIVE"
echo "================================================"
echo "  🧠  Backend  →  tmux attach -t aa-backend"
echo "  ⚙️   Worker   →  tmux attach -t aa-worker"
echo "  🛰️   Feeds    →  tmux attach -t aa-feed"
echo "  🗺️   Frontend →  pm2 logs ambers-angels-web"
echo "------------------------------------------------"
echo "  🌐  Dashboard →  http://157.245.125.103/map"
echo "  🏥  Health    →  http://157.245.125.103:8000/health"
echo "================================================"
