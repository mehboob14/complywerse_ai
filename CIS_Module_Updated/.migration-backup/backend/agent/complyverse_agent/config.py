"""Agent configuration paths + defaults.

The agent stores its state in a per-user directory so multiple installs
on the same machine (rare, but supported for testing) don't clobber each
other. The vault (vault.py) lives in the same dir and encrypts secrets
via DPAPI / Fernet.

Layout:
    %APPDATA%\\Compliverse\\Agent\\
        config.json     ← non-secret state (backend URL, agent_id, version)
        vault.bin       ← encrypted secrets (api_token + collector creds)
        agent.log       ← rolling log file
"""
from __future__ import annotations

import json
import os
from pathlib import Path


HEARTBEAT_INTERVAL_DEFAULT_SEC = 30
JOB_PULL_TIMEOUT_SEC = 60
RESULT_PUSH_TIMEOUT_SEC = 60
ENROLL_TIMEOUT_SEC = 30


def agent_dir() -> Path:
    """Return the per-user agent state directory, creating it if missing.

    Windows  → %APPDATA%\\Compliverse\\Agent
    Linux    → ~/.config/complyverse/agent
    macOS    → ~/Library/Application Support/Compliverse/Agent
    """
    home = Path.home()
    if os.name == "nt":
        base = Path(os.environ.get("APPDATA", home / "AppData" / "Roaming"))
        d = base / "Compliverse" / "Agent"
    elif os.name == "posix":
        d = home / ".config" / "complyverse" / "agent"
    else:
        d = home / ".complyverse_agent_dir"
    d.mkdir(parents=True, exist_ok=True)
    return d


def config_path() -> Path:
    return agent_dir() / "config.json"


def vault_path() -> Path:
    return agent_dir() / "vault.bin"


def log_path() -> Path:
    return agent_dir() / "agent.log"


def load_config() -> dict:
    """Read the non-secret config. Returns an empty dict if not enrolled."""
    p = config_path()
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        # A corrupt config shouldn't crash the agent — return empty so the
        # caller can either re-enroll or surface the error to the operator.
        return {}


def save_config(cfg: dict) -> None:
    """Atomically write the non-secret config (best-effort permissions)."""
    p = config_path()
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    # POSIX: chmod 600 so other users on the box can't read backend URL etc.
    # Windows: ACLs are inherited from the user's profile dir — DPAPI takes
    # care of the actual secret encryption inside vault.bin.
    try:
        os.chmod(tmp, 0o600)
    except Exception:
        pass
    os.replace(tmp, p)
