#!/usr/bin/env bash
# Celery prefork worker for pentest batch fan-out (run it as a systemd service, e.g.
# ExecStart=/bin/bash <repo>/backend/run-worker.sh).
# Matches grc/modules/pentest/RUN_WORKER.md. Single-asset runs are in-process and
# need no worker; batch (2+) runs fan out via Celery and require this.
cd "$(dirname "$0")"
set -a
. ./.env 2>/dev/null
set +a
exec venv/bin/celery -A grc.modules.pentest.tasks worker --pool=prefork -c "${AVA_WORKER_CONCURRENCY:-2}"
