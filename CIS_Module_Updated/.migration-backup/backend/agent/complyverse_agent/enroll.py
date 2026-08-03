"""One-time enrollment with the cloud.

Trades the operator-issued enrollment_token for a long-lived api_token,
saves the api_token in the encrypted vault and the non-secret bits in
config.json.
"""
from __future__ import annotations

import logging
import platform
import socket
import sys

from . import vault
from .config import HEARTBEAT_INTERVAL_DEFAULT_SEC, save_config
from .transport import TransportError, post

logger = logging.getLogger(__name__)


def enroll(backend_url: str, enrollment_token: str) -> dict:
    """Run the enrollment handshake. Returns the new agent record."""
    backend_url = backend_url.rstrip("/")
    hostname = socket.gethostname()
    os_family = _normalised_os()
    try:
        ip = socket.gethostbyname(hostname)
    except Exception:
        ip = None

    body = {
        "enrollment_token": enrollment_token,
        "hostname": hostname,
        "os_family": os_family,
        "agent_version": "1.0.0",
        "ip_address": ip,
    }
    try:
        data = post(f"{backend_url}/grc/agents/enroll", body=body, timeout=30)
    except TransportError as e:
        print(f"Enrollment failed: HTTP {e.status} — {e.body}", file=sys.stderr)
        sys.exit(1)

    # Persist
    vault.set_api_token(data["api_token"])
    save_config({
        "backend_url": backend_url,
        "agent_id": data["agent_id"],
        "hostname": hostname,
        "os_family": os_family,
        "heartbeat_interval_sec": data.get("heartbeat_interval_sec", HEARTBEAT_INTERVAL_DEFAULT_SEC),
        "enrolled_at": data.get("enrolled_at"),
    })
    return data


def _normalised_os() -> str:
    s = platform.system().lower()
    if "win" in s:
        return "windows"
    if "linux" in s:
        return "linux"
    if "darwin" in s or "mac" in s:
        return "darwin"
    return s or "unknown"
