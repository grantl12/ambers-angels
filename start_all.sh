#!/bin/bash
echo "🚀 Initializing Amber's Angels Mission Control..."

# 1. Environment Configuration
export ALERT_WEBHOOK_URL="your_discord_webhook_here"
export DATABASE_URL="postgresql+asyncpg://postgres:Ambers1Angels@127.0.0.1:5432/ambersangels"

# 2. Cleanup
sudo fuser -k 8000/tcp 2>/dev/null
sudo systemctl restart nginx

# 3. Start Backend (The Brain)
tmux kill-session -t aa-backend 2>/dev/null
tmux new-session -d -s aa-backend "cd /home/ambers-angels/proj_dir/ambers-angels/backend && python3 -m uvicorn main:app --host 0.0.0.0 --port 8000"

# 4. Start Worker (The Eyes)
# Using your professional process_frames.py logic
tmux kill-session -t aa-worker 2>/dev/null
tmux new-session -d -s aa-worker "export FRAME_ROOT=/home/ambers-angels/proj_dir/ambers-angels/backend/test_plates && python3 /home/ambers-angels/proj_dir/ambers-angels/worker/process_frames.py"

echo "✅ System LIVE. Check health at: http://157.245.125.103:8000/health"
