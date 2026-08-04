"""Compliverse Compliance Agent.

This package runs on the customer's host (Windows or Linux) and:
  1. Enrolls with the cloud backend exactly once (trading a one-time
     enrollment token for a long-lived api_token).
  2. Heartbeats every 30s so the cloud knows the host is alive.
  3. Pulls queued check jobs from the cloud.
  4. Executes each job — either against the local host (endpoint mode)
     or against remote network devices via SSH (collector mode).
  5. Pushes results back to the cloud as immutable evidence.

The package is split into focused modules so each piece is independently
testable and the NSIS / .deb / .rpm packagers can drop unused parts:

    config.py     — config dir, paths, defaults
    vault.py      — encrypted credential vault (DPAPI on Win, Fernet on POSIX)
    transport.py  — HTTP client (stdlib urllib so NSIS embedded Python works)
    enroll.py     — one-time enrollment flow
    heartbeat.py  — periodic ping
    jobs.py       — pull queued check tasks, push results
    runners/      — execution engines (local Windows, local Linux, SSH)

A thin CLI shim in __main__.py exposes the entry points:

    python -m complyverse_agent enroll --backend URL --token ENROLL_TOKEN
    python -m complyverse_agent run        # foreground loop
    python -m complyverse_agent run --once # single tick (for tests)
    python -m complyverse_agent cred set   # local cred vault (Scenario A)
    python -m complyverse_agent service install   # register Windows service
"""

__version__ = "1.0.0"
