"""Per-platform inventory collectors (package) — the typed-asset "components" layer.

Parallel to the CIS runner registry: one collector module per platform, each
registering `@register(integration_type)` and returning the platform's OWN deep
inventory as `platform_properties`. `collect_platform()` dispatches by
integration_type and returns `(platform_kind, platform_properties)`.

`platform_properties` = flat identity/summary scalars + named SECTIONS, each a
`{status, data, note?}` dict (see `status.py`). This is the SINK for typed deep
inventory; hierarchy that has independent identity is promoted to child
`ITAsset` rows + `AssetRelationship` by the deep-collect caller — NOT stored in a
new table.

Contract:
  * READ-ONLY. Collectors MUST NOT mutate the target.
  * Partial-failure-safe. A denied/failed section becomes a status-tagged empty
    section; it never aborts the collect.
  * Same credential keys the CIS runners use (resolved via credentials.py).
"""
from __future__ import annotations

import importlib
import logging
from typing import Any, Callable, Dict, Optional, Tuple

# Re-export the status contract so modules do `from . import discovered, ...`.
from .status import (  # noqa: F401
    DISCOVERED, PERMISSION_DENIED, NOT_SUPPORTED, NOT_APPLICABLE, UNAVAILABLE,
    ERROR, section, discovered, collect_section, classify_error,
)

logger = logging.getLogger(__name__)

# integration_type -> the coarse kind that drives the detail card the UI shows.
PLATFORM_KINDS: Dict[str, str] = {
    "postgres_sql": "database",
    "mysql_sql": "database",
    "mssql_sql": "database",
    "oracle_sql": "database",
    "netdev_ssh": "network",
    "aws_readonly": "cloud",
    "azure_readonly": "cloud",
    "digitalocean_api": "cloud",   # account-level (API token) — droplet SSH stays "server"
    "k8s_api": "cluster",
    "ldap_query": "identity",
}

_COLLECTORS: Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]] = {}


def register(integration_type: str):
    def deco(fn: Callable[[Dict[str, Any]], Dict[str, Any]]):
        _COLLECTORS[integration_type] = fn
        return fn
    return deco


def has_collector(integration_type: str) -> bool:
    return integration_type in _COLLECTORS


def collect_platform(
    integration_type: str, creds: Dict[str, Any]
) -> Optional[Tuple[str, Dict[str, Any]]]:
    """Run the platform collector. Returns (platform_kind, properties) or None
    when no collector is registered. Raises RuntimeError with a human cause on a
    connection/auth failure (the connect itself) so the caller can record it."""
    fn = _COLLECTORS.get(integration_type)
    if fn is None:
        return None
    props = fn(creds)
    return PLATFORM_KINDS.get(integration_type, "server"), props


def safe_cursor(cur, conn):
    """`_safe(sql) -> rows` helper that swallows per-query errors and rolls back
    so one failed query never aborts a DB collect. Prefer `collect_section` when
    you want the failure surfaced as a status; use this for optional scalars."""
    def _safe(sql: str):
        try:
            cur.execute(sql)
            return cur.fetchall()
        except Exception:  # noqa: BLE001
            try:
                conn.rollback()
            except Exception:  # noqa: BLE001
                pass
            return []
    return _safe


# ── Register all platform collectors ────────────────────────────────────────
# Defensive: a single module that fails to import (e.g. a syntax error mid-edit)
# must not take down the whole registry — log it and keep the rest working.
_MODULES = ("postgres", "mysql", "mssql", "oracle", "cisco", "aws", "azure",
            "digitalocean", "k8s", "ad")
for _m in _MODULES:
    try:
        importlib.import_module(f"{__name__}.{_m}")
    except Exception:  # noqa: BLE001
        logger.exception("platform_collectors: failed to import collector module %s", _m)
