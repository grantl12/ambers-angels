#!/bin/bash

echo "🛑 Shutting down systems..."

# Kill tmux sessions
tmux kill-session -t aa-backend 2>/dev/null
tmux kill-session -t aa-worker 2>/dev/null
tmux kill-session -t aa-feed 2>/dev/null

# Kill any stray python/uvicorn processes
sudo fuser -k 8000/tcp 2>/dev/null
pkill -f process_frames.py
pkill -f uvicorn

# Optional: Stop Nginx if you want to close the RTMP port entirely
# sudo systemctl stop nginx

echo "📴 All systems offline."
