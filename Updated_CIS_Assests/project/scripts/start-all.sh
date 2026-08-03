#!/bin/bash
set -e

# Kill any processes that may already be occupying ports
fuser -k 5000/tcp 2>/dev/null || true
fuser -k 8080/tcp 2>/dev/null || true
fuser -k 20080/tcp 2>/dev/null || true

# Start Python backend
cd /home/runner/workspace/.migration-backup/backend
python3 -m uvicorn main:app --host 0.0.0.0 --port 5000 --reload &
BACKEND_PID=$!

# Return to workspace root
cd /home/runner/workspace

# Start Express API proxy
PORT=8080 pnpm --filter @workspace/api-server run dev &
API_PID=$!

# Start Vite frontend
PORT=20080 BASE_PATH=/ pnpm --filter @workspace/grc-frontend run dev &
FRONTEND_PID=$!

# Wait for all processes
wait $BACKEND_PID $API_PID $FRONTEND_PID
