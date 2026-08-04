#!/usr/bin/env bash
# Start a Celery worker on the parsing + default queues.
# Run from WSL (or any Linux host) so the worker can use the `prefork` pool —
# Celery's prefork pool does not work natively on Windows.
#
# Usage:
#   bash scripts/start_celery_worker.sh                # default + parsing queues
#   QUEUES=default bash scripts/start_celery_worker.sh # only short tasks
#   CONCURRENCY=8 bash scripts/start_celery_worker.sh  # 8 worker children

set -euo pipefail

cd "$(dirname "$0")/.."
export PYTHONPATH="$PWD:${PYTHONPATH:-}"

QUEUES="${QUEUES:-default,parsing}"
CONCURRENCY="${CONCURRENCY:-4}"
LOGLEVEL="${LOGLEVEL:-info}"

echo "[celery] queues=${QUEUES} concurrency=${CONCURRENCY} loglevel=${LOGLEVEL}"

exec celery -A grc.celery_app worker \
  --queues="${QUEUES}" \
  --concurrency="${CONCURRENCY}" \
  --loglevel="${LOGLEVEL}" \
  --hostname="grc-worker@%h"
