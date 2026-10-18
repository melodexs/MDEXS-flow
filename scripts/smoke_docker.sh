#!/usr/bin/env bash
# Verify the Docker image starts and /health responds (local only).
# Usage: ./scripts/smoke_docker.sh  (requires Docker)
set -euo pipefail

PORT="${PORT:-8090}"
IMAGE="mdexs-flow-api-smoke"

docker build -q -t "$IMAGE" services/api > /dev/null
docker run -d --rm --name "$IMAGE" -p "$PORT:8000" "$IMAGE" > /dev/null
trap 'docker stop "$IMAGE" > /dev/null 2>&1 || true' EXIT

sleep 3
curl -fsS "http://localhost:$PORT/health"
echo
curl -fsS "http://localhost:$PORT/api/v1/health"
echo "SMOKE_OK"
