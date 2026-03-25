#!/bin/bash
echo "🛑 Shutting down Amber's Angels System..."

# 1. Kill the Python Bridge
echo "Stopping Bridge..."
pkill -f bridge.py

# 2. Kill the FastAPI Backend
echo "Stopping FastAPI..."
sudo kill -9 $(sudo lsof -t -i:8000) 2>/dev/null

# 3. Stop the Docker Container
echo "Stopping ALPR Container..."
docker stop alpr-service

echo "📴 System is OFFLINE."
