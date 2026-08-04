"""Discovery-status contract shared by every deep collector.

Deep inventory is permission- and platform-dependent: a query may succeed, be
denied, be unsupported by the target, not apply, or error. Every *section* of a
collector's ``platform_properties`` records which — so the UI can show
"permission denied" instead of a silently-empty table, and a partial failure
never fails the whole collect.

Shape:
  platform_properties = {
     # flat identity / summary scalars — engine, version, host, port, provider …
     "engine": "PostgreSQL", "version": "16.2", "host": "...", "port": 5432,
     # named SECTIONS of deep inventory, each wrapped with a status:
     "databases": {"status": "discovered", "data": [ {...}, {...} ]},
     "replication": {"status": "permission_denied", "data": None, "note": "..."},
  }

A section is ``{"status": <STATUS>, "data": <list|dict|scalar|None>, "note"?: str}``.
The frontend reads `.status` to badge the section and `.data` to render it.
"""
from __future__ import annotations

from typing import Any, Callable, Optional

# ── Status values ────────────────────────────────────────────────────────────
DISCOVERED = "discovered"            # collected successfully
PERMISSION_DENIED = "permission_denied"  # credential lacks the privilege
NOT_SUPPORTED = "not_supported"      # target/platform doesn't offer this
NOT_APPLICABLE = "not_applicable"    # doesn't apply to this target shape
UNAVAILABLE = "unavailable"          # feature/API present but nothing to return
ERROR = "error"                      # unexpected failure

_DENIED_HINTS = (
    "permission denied", "denied", "not authorized", "unauthorized", "forbidden",
    "access is denied", "access denied", "insufficient priv", "must be superuser",
    "must be a member", "not allowed", "privilege", "ora-00942", "ora-01031",
    "accessdenied", "not authorized to perform", "authorizationerror",
)
_UNSUPPORTED_HINTS = (
    "not supported", "unknown command", "invalid input", "does not exist",
    "unrecognized", "not recognized", "no such", "not implemented", "unsupported",
    "% invalid input", "command not found",
)


def classify_error(exc: Exception) -> str:
    """Best-effort map a driver/API exception to a discovery status."""
    msg = str(exc).lower()
    if any(h in msg for h in _DENIED_HINTS):
        return PERMISSION_DENIED
    if any(h in msg for h in _UNSUPPORTED_HINTS):
        return NOT_SUPPORTED
    return ERROR


def section(status: str, data: Any = None, note: Optional[str] = None) -> dict:
    out: dict = {"status": status, "data": data}
    if note:
        out["note"] = note
    return out


def discovered(data: Any, note: Optional[str] = None) -> dict:
    return section(DISCOVERED, data, note)


def collect_section(fn: Callable[[], Any], *, empty: Any = None,
                    note: Optional[str] = None) -> dict:
    """Run ``fn()`` and wrap the result as a DISCOVERED section; on failure,
    classify the exception (permission_denied / not_supported / error) and wrap
    the empty value. NEVER raises — a denied/failed section must not abort the
    surrounding collect."""
    try:
        return section(DISCOVERED, fn(), note)
    except Exception as e:  # noqa: BLE001
        return section(classify_error(e), empty, note=str(e)[:200])
