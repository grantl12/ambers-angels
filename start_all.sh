!/bin/bash

echo "🚀 Initializing Amber's Angels Mission Control..."

# 1. Environment Configuration (Ensure these are correct)
export ALERT_WEBHOOK_URL="https://discord.com/api/webhooks/1487118233978015809/x4vC4bi56xCJmWzAZIORinokhE6q9Utc5kKAIraaqcj0ubRd3ZDRi91tSV3QEGbh84ic"
export DATABASE_URL="postgresql+asyncpg://postgres:Ambers1Angels@127.0.0.1:5432/ambersangels"
export FRAME_ROOT="/home/ambers-angels/proj_dir/ambers-angels/backend/test_plates"

# 2. Infrastructure Cleanup
sudo fuser -k 8000/tcp 2>/dev/null
sudo systemctl restart nginx

# 3. Start Backend (The Brain)
# We keep these in separate sessions so one crash doesn't take down the whole mission
tmux kill-session -t aa-backend 2>/dev/null
tmux new-session -d -s aa-backend "cd /home/ambers-angels/proj_dir/ambers-angels/backend && python3 -m uvicorn main:app --host 0.0.0.0 --port 8000"

# 4. Start Worker (The Processor)
tmux kill-session -t aa-worker 2>/dev/null
tmux new-session -d -s aa-worker "cd /home/ambers-angels/proj_dir/ambers-angels/worker && python3 unified_worker.py &"

# 5. Multi-Drone Harvester (The Eyes/Mouth)
# Fixed: We create the session FIRST, then run the script
tmux kill-session -t aa-feed 2>/dev/null
tmux new-session -d -s aa-feed -n 'Harvester' "cd /home/ambers-angels/proj_dir/ambers-angels && ./harvest_stream.sh"

echo "------------------------------------------------"
echo "✅  System LIVE."
echo "🧠  Backend:  tmux attach -t aa-backend"
echo "⚙️   Worker:   tmux attach -t aa-worker"
echo "🛰️   Feeds:    tmux attach -t aa-feed"
echo "------------------------------------------------"
echo "🏥 Health Check: http://157.245.125.103:8000/health"
