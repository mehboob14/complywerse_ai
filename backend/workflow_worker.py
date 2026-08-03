"""Standalone Workflow Engine worker.

Runs the workflow runtime loop in its OWN process, independent of the API
server, so it can be restarted / scaled on its own. The runtime iterates every
active tenant's database each cycle (per-tenant DB architecture): polling the
audit log for trigger events, scheduling due timers, processing approvals, and
executing queued workflow instances (including sending notification email /
in-app alerts).

Run the API with ``DISABLE_EMBEDDED_WORKFLOW_RUNTIME=1`` so the runtime only
runs here — otherwise both processes would poll and you'd get duplicate work.

Usage (from the ``backend/`` directory):

    python workflow_worker.py

Stop with Ctrl+C (or SIGTERM). Honors the same ``.env`` as the API.
"""
import logging
import os
import signal
import sys
import time

from dotenv import load_dotenv

# Load .env BEFORE importing grc.* so DB URLs / secrets are present at import.
load_dotenv()

logging.basicConfig(
    level=os.getenv("WORKFLOW_WORKER_LOG_LEVEL", os.getenv("LOG_LEVEL", "INFO")),
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("workflow_worker")

# Import the lightweight runtime stack only (NOT grc.main / the full API app,
# so we don't spin up the SQL agent, routers, middleware, etc.).
from grc.models import init_master_db  # noqa: E402
from grc.modules.workflow_engine.services.runtime import get_runtime  # noqa: E402


def main() -> int:
    logger.info("Workflow Engine worker starting (pid=%s)…", os.getpid())

    # Ensure the master catalog is reachable / initialised. Idempotent; the
    # per-tenant schemas are managed by the API's provisioning + self-heal.
    try:
        init_master_db()
    except Exception:  # noqa: BLE001 — log but still try to run
        logger.exception("init_master_db failed; continuing (DB may already be ready)")

    runtime = get_runtime()
    runtime.start()  # spawns the per-tenant poll/timer/execute loop on a daemon thread
    logger.info("Workflow Engine worker started. Polling all active tenants. Ctrl+C to stop.")

    stop = {"flag": False}

    def _handle(signum, _frame):
        logger.info("Received signal %s — shutting down…", signum)
        stop["flag"] = True

    # SIGINT is always available; SIGTERM may not exist on some platforms.
    signal.signal(signal.SIGINT, _handle)
    try:
        signal.signal(signal.SIGTERM, _handle)
    except (ValueError, AttributeError, OSError):
        pass

    try:
        while not stop["flag"]:
            # Surface a clear failure if the runtime thread dies unexpectedly.
            if not runtime.is_running():
                logger.error("Workflow runtime thread is no longer running; exiting.")
                return 1
            time.sleep(1.0)
    finally:
        try:
            runtime.stop()
        except Exception:  # noqa: BLE001
            logger.exception("Error while stopping runtime")
        logger.info("Workflow Engine worker stopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
