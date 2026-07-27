"""
workflow_watcher — standalone workflow runtime process.

Runs the WorkflowRuntime poll loop independently of the FastAPI server.
Useful when you want to scale the watcher separately or keep the API and
event processing in distinct OS processes.

Usage (from the backend/ directory):

    python -m workflow_watcher

Environment variables (loaded from .env automatically):
    DATABASE_URL          — SQLAlchemy connection string (required)
    SESSION_SECRET        — JWT / app secret (required by model imports)
    DISABLE_EMBEDDED_WORKFLOW_RUNTIME=1
                          — set this on the API server so it doesn't also
                            poll, avoiding duplicate executions

The process exits cleanly on CTRL-C (SIGINT) or SIGTERM.
"""

import logging
import os
import signal
import sys
import time

# ── env / path setup ──────────────────────────────────────────────────────────
# Must run BEFORE any project imports so DATABASE_URL etc. are visible.
try:
    from dotenv import load_dotenv  # type: ignore

    load_dotenv()
except ImportError:
    pass  # python-dotenv optional; rely on OS env vars

# Ensure the backend/ directory is on sys.path so `grc.*` imports resolve
_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

# ── logging setup ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("workflow_watcher")

# ── validate required env vars ────────────────────────────────────────────────
_missing = [v for v in ("DATABASE_URL", "SESSION_SECRET") if not os.getenv(v)]
if _missing:
    logger.error(
        "Missing required environment variables: %s\n"
        "Create a .env file in the backend/ directory or export them before starting.",
        ", ".join(_missing),
    )
    sys.exit(1)

# ── project imports (after env is set) ────────────────────────────────────────
from grc.models import init_grc_db  # noqa: E402
from grc.modules.workflow_engine import (  # noqa: E402
    start_workflow_engine_runtime,
    stop_workflow_engine_runtime,
)
from grc.modules.workflow_engine.services.runtime import runtime_status  # noqa: E402


# ── signal handling ───────────────────────────────────────────────────────────
_shutdown_requested = False


def _handle_signal(signum, frame):
    global _shutdown_requested
    logger.info("Shutdown signal received (%s). Stopping runtime …", signum)
    _shutdown_requested = True


signal.signal(signal.SIGINT, _handle_signal)
signal.signal(signal.SIGTERM, _handle_signal)


# ── main ──────────────────────────────────────────────────────────────────────
def main():
    logger.info("workflow_watcher starting up")

    # Ensure all DB tables exist (idempotent — safe to call every time)
    init_grc_db()
    logger.info("Database initialised")

    start_workflow_engine_runtime()
    logger.info("Workflow runtime started — polling every 500 ms")

    # Print a friendly status summary
    status = runtime_status()
    logger.info(
        "Runtime status: running=%s  mode=%s  latest_audit_log_id=%s",
        status.get("running"),
        status.get("mode"),
        status.get("latest_audit_log_id"),
    )

    logger.info("Press CTRL-C to stop.")

    # Block until a shutdown signal is received
    try:
        while not _shutdown_requested:
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        logger.info("Stopping workflow runtime …")
        stop_workflow_engine_runtime()
        logger.info("workflow_watcher stopped cleanly.")


if __name__ == "__main__":
    main()
