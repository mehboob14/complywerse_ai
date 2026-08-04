#!/usr/bin/env bash
# Start the Celery beat scheduler. Only ONE instance must run cluster-wide;
# beat schedules tasks at fixed intervals.
#
# This is only needed if you wire up periodic tasks. Without `celery_app.conf.beat_schedule`
# entries, beat is a no-op.

set -euo pipefail

cd "$(dirname "$0")/.."
export PYTHONPATH="$PWD:${PYTHONPATH:-}"

LOGLEVEL="${LOGLEVEL:-info}"

exec celery -A grc.celery_app beat \
  --loglevel="${LOGLEVEL}" \
  --schedule="/tmp/celerybeat-grc.db"
