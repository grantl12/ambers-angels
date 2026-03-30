#!/bin/bash

# Amber's Angels - Master Orchestration
echo "🚀 Launching Amber's Angels Pipeline..."

# 1. Environment & Secrets
export ALERT_WEBHOOK_URL="https://discord.com/api/webhooks/1487118233978015809/x4vC4bi56xCJmWzAZIORinokhE6q9Utc5kKAIraaqcj0ubRd3ZDRi91tSV3QEGbh84ic"
# Ensure we use the asyncpg driver for the new EventService logic
export DATABASE_URL="postgresql+asyncpg://postgres:Ambers1Angels@127.0.0.1:5432/ambersangels"
export FRAME_ROOT="/home/ambers-angels/proj_dir/ambers-angels/backend/test_plates"

# 2. Critical Path Fix
# We add both the root and the backend folder to PYTHONPATH
BASE_DIR=$(pwd)
export PYTHONPATH=$BASE_DIR:$BASE_DIR/backend:$BASE_DIR/worker

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

echo "------------------------------------------------"
echo "✅ System RE-SYNCED."
echo "🏥 Health: http://157.245.125.103:8000/health"
echo "------------------------------------------------"
