"""Asset-scope resolver for IntegrationConnection.

CIS-merge stub.  The package's compliance_plugins/router calls
``resolve_assets(connection, assets)`` and ``preview_scope(...)`` to
filter which IT assets a stored credential is allowed to scan.  The
package model carries ``scope_mode`` / ``scope_value`` /
``last_scope_resolution_count`` / ``scope_updated_at`` columns on
``IntegrationConnection`` that drive this matcher; our codebase
doesn't have those columns yet, so the safe default is
"every asset is in scope" (matches the package's ``scope_mode='tenant_all'``
behaviour).

When the real columns + ingest UI land:
  * ``scope_mode='tenant_all'`` → return every passed asset
  * ``scope_mode='include'``    → return assets whose id ∈ scope_value['asset_ids']
  * ``scope_mode='exclude'``    → return assets whose id ∉ scope_value['asset_ids']
  * ``scope_mode='by_os'``      → return assets whose os_normalized matches
                                  the scope_value['os_patterns'] prefix list

For now we attribute-check defensively so the stub keeps working as the
columns get added — no model edit needed to swap out for the real impl.
"""
from __future__ import annotations

import logging
from typing import Iterable, List, Optional, Sequence

logger = logging.getLogger(__name__)


def _scope_attrs(connection) -> tuple[Optional[str], Optional[dict]]:
    """Read scope_mode + scope_value off the connection if present.

    Defensive: returns ``(None, None)`` when the model doesn't yet expose
    these attributes so the stub is forward-compatible with the eventual
    schema migration.
    """
    mode = getattr(connection, "scope_mode", None)
    value = getattr(connection, "scope_value", None) or {}
    return mode, value


def resolve_assets(connection, assets: Sequence) -> List:
    """Return the subset of ``assets`` that are in this connection's scope.

    Stub default: ``scope_mode='tenant_all'`` semantics — every asset
    is in scope.  The package's full implementation supports
    ``include`` / ``exclude`` / ``by_os`` modes; we honour those if the
    columns exist, otherwise pass-through.
    """
    mode, value = _scope_attrs(connection)
    if not mode or mode == "tenant_all":
        return list(assets)

    if mode == "include":
        wanted = set(int(x) for x in (value.get("asset_ids") or []))
        return [a for a in assets if getattr(a, "id", None) in wanted]

    if mode == "exclude":
        excluded = set(int(x) for x in (value.get("asset_ids") or []))
        return [a for a in assets if getattr(a, "id", None) not in excluded]

    if mode == "by_os":
        patterns = [str(p).lower() for p in (value.get("os_patterns") or []) if p]
        if not patterns:
            return list(assets)
        out = []
        for a in assets:
            os_n = (getattr(a, "os_normalized", "") or "").lower()
            if any(os_n == p or os_n.startswith(p + "-") for p in patterns):
                out.append(a)
        return out

    # Unknown mode → fail-safe to tenant_all so a scope misconfig doesn't
    # accidentally hide every asset from the operator.
    logger.warning("resolve_assets: unknown scope_mode=%s; treating as tenant_all", mode)
    return list(assets)


def preview_scope(
    connection,
    assets: Sequence,
    scope_mode: Optional[str] = None,
    scope_value: Optional[dict] = None,
) -> List:
    """Same filter logic, but for an UNSAVED candidate scope the operator
    is previewing in the Connect Wizard before persisting.

    The frontend passes the proposed scope_mode + scope_value via the
    request body; we apply those instead of the connection's current
    values so the operator can see "this scope would cover N hosts" live.
    """
    class _ProxyConn:
        pass

    proxy = _ProxyConn()
    proxy.scope_mode = scope_mode  # type: ignore[attr-defined]
    proxy.scope_value = scope_value or {}  # type: ignore[attr-defined]
    return resolve_assets(proxy, assets)


__all__ = ["resolve_assets", "preview_scope"]
