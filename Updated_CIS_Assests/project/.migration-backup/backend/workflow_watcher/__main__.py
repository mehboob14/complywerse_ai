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
from datetime import datetime, timedelta  # noqa: E402
from typing import Any  # noqa: E402

from grc.models import (  # noqa: E402
    CompliancePlugin,
    CompliancePluginRun,
    IntegrationConnection,
    SessionLocal,
    init_grc_db,
)
from grc.modules.compliance_plugins.services.run_service import execute_plugin  # noqa: E402
from grc.modules.workflow_engine import (  # noqa: E402
    start_workflow_engine_runtime,
    stop_workflow_engine_runtime,
)
from grc.modules.workflow_engine.services.runtime import runtime_status  # noqa: E402

# How often the scheduler tick runs (seconds). The tick is cheap — it just
# scans CompliancePlugin.schedule_cron rows — so a 1-minute cadence is fine.
_SCHEDULER_TICK_SECONDS = 60
_SCHEDULE_INTERVALS = {
    "hourly": timedelta(hours=1),
    "daily": timedelta(days=1),
    "weekly": timedelta(days=7),
    "monthly": timedelta(days=30),
}


def _scheduler_tick():
    """Enqueue runs for plugins whose schedule_cron interval has elapsed.

    v1 contract: schedule_cron is a coarse interval label
    ("hourly"|"daily"|"weekly"|"monthly"). Cron expressions are out of scope.
    A plugin is "due" when its most-recent run started_at is older than the
    interval (or there's never been a run).

    A plugin is only auto-executed when there is a single resolvable target
    (asset for linux_ssh, IntegrationConnection for aws_readonly) for the
    tenant. Without a resolvable target the runner would hard-error every
    tick, so we skip silently. Operators can still trigger one-off runs from
    the UI / API which accept explicit targets.
    """
    now = datetime.utcnow()
    db = SessionLocal()
    try:
        # Pull every enabled plugin (built-in or tenant-owned). The
        # effective cadence is resolved per (plugin, tenant) below from
        # PluginScheduleOverride / catalog default.
        plugins = (
            db.query(CompliancePlugin)
            .filter(CompliancePlugin.enabled.is_(True))
            .all()
        )
        # Per-tenant schedule overrides for built-in plugins, indexed by
        # (plugin_id, tenant_id) → cadence label or None (= disabled).
        from grc.models import PluginScheduleOverride, PluginAssetScope
        overrides = {
            (ov.plugin_id, ov.tenant_id): ov.schedule_cron
            for ov in db.query(PluginScheduleOverride).all()
        }
        scopes = {
            (sc.plugin_id, sc.tenant_id): sc
            for sc in db.query(PluginAssetScope).all()
        }
        # Tenants that actually have an aws_readonly integration connection —
        # the scheduler runs built-in plugins for these tenants on cadence.
        # Without a connection a plugin run would just hard-error, so we
        # don't enqueue it.
        tenant_aws_conns: dict[int, IntegrationConnection] = {}
        for conn in (
            db.query(IntegrationConnection)
            .filter(IntegrationConnection.integration_type == "aws_readonly")
            .order_by(IntegrationConnection.id.asc())
            .all()
        ):
            tenant_aws_conns.setdefault(conn.tenant_id, conn)

        for plugin in plugins:
            # Determine the candidate tenants first (without cadence so we
            # can apply each tenant's effective override).
            candidate_tenants: list[tuple[int, Any, Any]] = []
            if plugin.runner_type == "aws_readonly":
                if plugin.tenant_id is None:
                    for tid, conn in tenant_aws_conns.items():
                        candidate_tenants.append((tid, None, conn))
                else:
                    conn = tenant_aws_conns.get(plugin.tenant_id)
                    if conn is not None:
                        candidate_tenants.append((plugin.tenant_id, None, conn))
            elif plugin.runner_type == "linux_ssh":
                # SSH plugins need a per-asset target binding which is not
                # yet implemented (tracked as a follow-up task) — skip the
                # scheduled path; manual / API-driven runs still work.
                continue

            for tenant_id, asset, connection in candidate_tenants:
                # Effective cadence: tenant override beats catalog default.
                if (plugin.id, tenant_id) in overrides:
                    cadence = overrides[(plugin.id, tenant_id)]
                else:
                    cadence = plugin.schedule_cron
                interval = _SCHEDULE_INTERVALS.get((cadence or "").lower())
                if interval is None:
                    continue  # disabled or unrecognised

                # Asset-scope filter: scope_mode='include' with empty
                # asset_ids ⇒ explicitly opted-out of scheduled runs.
                # We don't filter aws_readonly connection targets here;
                # the scope is enforced when SSH per-asset binding lands.
                scope = scopes.get((plugin.id, tenant_id))
                if scope is not None:
                    if scope.mode == "include" and not (scope.asset_ids or []):
                        continue
                _run_one_due(db, plugin, tenant_id, asset, connection, interval, now)
        return  # _run_one_due handles all loop bodies
    finally:
        db.close()


def _run_one_due(db, plugin, tenant_id, asset, connection, interval, now):
    """Execute one tenant's run for `plugin` if it's due. Errors are logged
    and do not abort the surrounding scheduler loop."""
    last_run = (
        db.query(CompliancePluginRun)
        .filter(
            CompliancePluginRun.plugin_id == plugin.id,
            CompliancePluginRun.tenant_id == tenant_id,
        )
        .order_by(CompliancePluginRun.started_at.desc())
        .first()
    )
    if last_run and last_run.started_at and (now - last_run.started_at) < interval:
        return
    try:
        execute_plugin(
            db=db,
            tenant_id=tenant_id,
            user_id=None,
            plugin=plugin,
            asset=asset,
            connection=connection,
            triggered_by="scheduled",
        )
        logger.info(
            "scheduled run: tenant=%s plugin=%s cadence=%s",
            tenant_id, plugin.plugin_key, plugin.schedule_cron,
        )
    except Exception as exc:  # pragma: no cover — defensive
        logger.exception("scheduled run failed for plugin %s: %s", plugin.plugin_key, exc)
        db.rollback()


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

    # Block until a shutdown signal is received. We piggy-back the compliance
    # plugin scheduler tick on this same loop — no need for a separate thread.
    last_scheduler_tick = 0.0
    try:
        while not _shutdown_requested:
            time.sleep(0.5)
            now = time.time()
            if now - last_scheduler_tick >= _SCHEDULER_TICK_SECONDS:
                last_scheduler_tick = now
                try:
                    _scheduler_tick()
                except Exception as exc:  # pragma: no cover — defensive
                    logger.exception("compliance plugin scheduler tick failed: %s", exc)
    except KeyboardInterrupt:
        pass
    finally:
        logger.info("Stopping workflow runtime …")
        stop_workflow_engine_runtime()
        logger.info("workflow_watcher stopped cleanly.")


if __name__ == "__main__":
    main()
