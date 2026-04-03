#!/usr/bin/env bash

PM2="$HOME/.local/bin/pm2"

echo "Stopping Amber's Angels..."

# PM2 processes (API + Web)
$PM2 stop ambers-angels-api ambers-angels-web 2>/dev/null || true

# tmux sessions
tmux kill-session -t aa-worker 2>/dev/null || true
tmux kill-session -t aa-feed   2>/dev/null || true  # kept for cleanup of any lingering old sessions

echo "Done. Run start_all.sh to bring everything back up."
echo "(Nginx left running — stop manually with: sudo service nginx stop)"
