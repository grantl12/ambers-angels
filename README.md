# Amber's Angels

Amber's Angels is an MVP system for ingesting live drone video, extracting frames, running license plate recognition, and associating detections with telemetry.

## Current components

- DJI RTMP ingest to Nginx RTMP
- FastAPI backend
- PostgreSQL schema for telemetry, frames, detections
- Frame registration worker
- Live frame processing worker using OpenALPR
- GPS sender for simulated telemetry
- Nginx config for RTMP + static page + API proxy

## Main paths

- `backend/` - API and database schema
- `worker/` - frame registration and detection workers
- `pilot/` - simple telemetry page
- `scripts/` - startup/shutdown helpers
- `ops/nginx/` - Nginx configs used in deployment

## Notes

Secrets are not committed to git.
