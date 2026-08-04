"""Windows service wrapper for the agent — resolves TODO 4B.

Background
==========
The agent CLI shipped with `enroll`, `run`, `cred`, `revoke`, `status`
subcommands, but `service install/uninstall` was marked TODO 4B in
__main__.py. Without it, the agent only ran during the install window —
the installer would enroll the agent (heartbeat once → write to DB),
then exit. On reboot the agent never came back. That's why every
production agent in the live DB shows `last_heartbeat_at` = the install
timestamp + `last_result_at` = NEVER.

What this fixes
===============
This module makes `python -m complyverse_agent run` runnable as a
Windows service via pywin32. The service auto-starts on boot, runs
`jobs.run_loop()` in a background thread, and stops gracefully when
Windows shuts down or the operator runs `service stop`.

Implementation
==============
* `ComplyverseAgentService` extends ``win32serviceutil.ServiceFramework``.
* Service name: ``ComplyverseAgent``. Display name shown in services.msc:
  "Compliverse Compliance Agent".
* The service body runs `jobs.run_loop(once=False, interval_sec=...)`
  which already has its own retry/backoff logic on transport failures.
* SvcStop signals the run_loop via the existing stop_event hook —
  we extend jobs.run_loop to accept an external Event for clean shutdown.

The Linux + macOS equivalents (systemd unit, launchd plist) are tracked
separately — this file only handles the Windows path because that's
where every TODO 4B-blocked agent in the live DB happens to live.
"""
from __future__ import annotations

import logging
import os
import sys
import threading
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# pywin32 modules are only available on Windows. Importing them on Linux/
# macOS would raise ImportError, which we want to surface to the operator
# with a clearer message ("This is a Windows-only command") rather than a
# cryptic stack trace from inside argparse. So we lazy-import inside the
# functions that actually need them.

SERVICE_NAME = "ComplyverseAgent"
SERVICE_DISPLAY_NAME = "Compliverse Compliance Agent"
SERVICE_DESCRIPTION = (
    "Runs the Compliverse CIS Benchmark agent. Heartbeats the backend "
    "every ~30 seconds, pulls queued check tasks, executes them locally, "
    "and pushes results. Configure via the Compliverse admin console; "
    "this service has no GUI."
)

# Singleton stop event the service uses to signal jobs.run_loop. Exposed
# as a module-level so the SvcStop method can flip it without needing a
# handle to the running run_loop frame.
_STOP_EVENT: Optional[threading.Event] = None


def _ensure_pywin32():
    """Lazy-import pywin32; raise a user-friendly error on non-Windows
    OR when pywin32 isn't installed."""
    if os.name != "nt":
        raise RuntimeError(
            "Windows service registration is only available on Windows. "
            "Use the systemd unit (Linux) or launchd plist (macOS) instead."
        )
    try:
        import win32service  # noqa: F401  (only the import matters)
        import win32serviceutil  # noqa: F401
        import servicemanager  # noqa: F401
        import win32event  # noqa: F401
    except ImportError as exc:
        raise RuntimeError(
            "pywin32 is required for service install/uninstall. "
            "Install with `pip install pywin32` and then re-run "
            "`python -m complyverse_agent service install`."
        ) from exc


def install_service(python_exe: Optional[str] = None) -> None:
    """Register the agent as a Windows service.

    Auto-start mode = SERVICE_AUTO_START so it comes up on every boot.
    Service runs as ``LocalSystem`` so it can read local-policy data
    (secedit, registry, GPO export) without prompting.

    Args:
        python_exe: optional override for the Python interpreter path.
            Defaults to sys.executable, which is correct when the
            operator runs ``python -m complyverse_agent service install``
            inside the agent's bundled embedded Python from setup.ps1.
    """
    _ensure_pywin32()
    import win32serviceutil

    exe = python_exe or sys.executable
    # Module reference, not file path — pywin32 will resolve via importlib.
    win32serviceutil.InstallService(
        pythonClassString="complyverse_agent.service_windows.ComplyverseAgentService",
        serviceName=SERVICE_NAME,
        displayName=SERVICE_DISPLAY_NAME,
        description=SERVICE_DESCRIPTION,
        startType=2,  # SERVICE_AUTO_START — comes up on every boot.
        exeName=exe,
    )
    # Start it right away so the operator doesn't have to also do
    # `service start` — install + first heartbeat in one command.
    win32serviceutil.StartService(SERVICE_NAME)
    logger.info("service %s installed and started", SERVICE_NAME)


def uninstall_service() -> None:
    """Stop (if running) and unregister the service."""
    _ensure_pywin32()
    import win32serviceutil

    # Stop first — RemoveService on a running service fails on some
    # Windows builds. Swallow the "not running" error.
    try:
        win32serviceutil.StopService(SERVICE_NAME)
    except Exception as exc:  # noqa: BLE001
        logger.debug("StopService threw (probably wasn't running): %s", exc)
    win32serviceutil.RemoveService(SERVICE_NAME)
    logger.info("service %s removed", SERVICE_NAME)


def start_service() -> None:
    """Manual start (after install or after a stop)."""
    _ensure_pywin32()
    import win32serviceutil
    win32serviceutil.StartService(SERVICE_NAME)


def stop_service() -> None:
    """Manual stop. Does NOT unregister — use `uninstall_service` for that."""
    _ensure_pywin32()
    import win32serviceutil
    win32serviceutil.StopService(SERVICE_NAME)


# ─── The service class itself ───────────────────────────────────────────
# Lazy-imported in main() below so this module can also be imported on
# Linux/macOS for the install_service() error message path.

if os.name == "nt":
    try:
        import win32event
        import win32service
        import win32serviceutil
        import servicemanager

        class ComplyverseAgentService(win32serviceutil.ServiceFramework):
            """The pywin32 service-control entry point.

            SCM (Service Control Manager) instantiates this when the
            service starts. Lifecycle:
              SvcDoRun  → spawn jobs.run_loop in a thread, wait on stop event
              SvcStop   → flip the stop event, wait for the thread to exit
            """

            _svc_name_ = SERVICE_NAME
            _svc_display_name_ = SERVICE_DISPLAY_NAME
            _svc_description_ = SERVICE_DESCRIPTION

            def __init__(self, args):
                win32serviceutil.ServiceFramework.__init__(self, args)
                # Win32 event SCM uses to wake us up on stop / pause.
                self._scm_event = win32event.CreateEvent(None, 0, 0, None)
                # Cooperative shutdown event the run_loop polls.
                self._stop_event = threading.Event()
                global _STOP_EVENT
                _STOP_EVENT = self._stop_event
                self._worker: Optional[threading.Thread] = None

            def SvcStop(self):
                # Pre-stop hint to SCM so it doesn't kill us at 30s.
                self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
                self._stop_event.set()
                # Wake SCM's wait so we exit SvcDoRun cleanly.
                win32event.SetEvent(self._scm_event)
                # Worker may take a few seconds to wrap up an in-flight
                # job + push results. Give it 30s.
                if self._worker is not None:
                    self._worker.join(timeout=30)

            def SvcDoRun(self):
                servicemanager.LogMsg(
                    servicemanager.EVENTLOG_INFORMATION_TYPE,
                    servicemanager.PYS_SERVICE_STARTED,
                    (self._svc_name_, ""),
                )
                self._worker = threading.Thread(
                    target=self._run_worker, name="agent-run-loop", daemon=True,
                )
                self._worker.start()
                # Block until SCM signals stop.
                win32event.WaitForSingleObject(self._scm_event, win32event.INFINITE)

            def _run_worker(self) -> None:
                """Run the existing jobs.run_loop, threading the stop
                event through so SvcStop can break us out of the sleep."""
                try:
                    from .config import HEARTBEAT_INTERVAL_DEFAULT_SEC, load_config
                    from . import jobs as jobs_mod
                    cfg = load_config()
                    interval = int(cfg.get("heartbeat_interval_sec",
                                            HEARTBEAT_INTERVAL_DEFAULT_SEC))
                    # jobs.run_loop accepts the stop_event so the loop's
                    # sleep is interruptible. If your local run_loop is
                    # older, fall back to once=False without it.
                    try:
                        jobs_mod.run_loop(
                            once=False, interval_sec=interval,
                            stop_event=self._stop_event,
                        )
                    except TypeError:
                        jobs_mod.run_loop(once=False, interval_sec=interval)
                except Exception:  # noqa: BLE001
                    # Any uncaught exception → log to Windows Event Log
                    # so it shows up in Event Viewer for triage. Then
                    # exit cleanly so SCM doesn't restart us on a tight
                    # loop (which would mask the error).
                    import traceback
                    servicemanager.LogErrorMsg(
                        f"ComplyverseAgent run loop crashed:\n{traceback.format_exc()}"
                    )

    except ImportError:
        # pywin32 not installed — ComplyverseAgentService is undefined
        # but install_service()'s error message will tell the operator
        # why and how to fix it.
        pass


def main():
    """Entry point used by SCM when the service starts.

    SCM invokes ``<python.exe> -m complyverse_agent.service_windows`` per
    the registration. We hand control to pywin32's service dispatcher,
    which then constructs ComplyverseAgentService and calls SvcDoRun.
    """
    _ensure_pywin32()
    import win32serviceutil
    win32serviceutil.HandleCommandLine(ComplyverseAgentService)  # noqa: F821


if __name__ == "__main__":
    main()
