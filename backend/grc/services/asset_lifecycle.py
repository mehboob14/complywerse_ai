"""Phase 5.3 — Asset lifecycle state machine.

Encodes valid transitions for `ITAsset.lifecycle_state` and the side-effects
that fire on each transition (timestamp stamping, auto-close of vulns when
an asset is retired).

States:
    planned         — asset is provisioned but not yet in production
    active          — in production use
    maintenance     — temporarily out of service (planned)
    decommissioned  — taken out of service permanently, may still exist
    retired         — fully removed, no further changes expected

Allowed transitions (one-way unless noted):
    planned        → active
    active         ↔ maintenance     (round-trip)
    active         → decommissioned   (skip maintenance)
    maintenance    → decommissioned
    decommissioned → retired

The legacy `status` column (active/inactive/decommissioned) is left untouched
by this module — callers may keep maintaining it for backward compatibility.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional, Set, Tuple

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Single source of truth for valid state values.
LIFECYCLE_STATES: Tuple[str, ...] = (
    "planned",
    "active",
    "maintenance",
    "decommissioned",
    "retired",
)

# Forward edges. Round-trip pairs are listed in both directions.
_ALLOWED_TRANSITIONS: dict[str, Set[str]] = {
    "planned": {"active"},
    "active": {"maintenance", "decommissioned"},
    "maintenance": {"active", "decommissioned"},
    "decommissioned": {"retired"},
    "retired": set(),
}

# States in which the asset is no longer in service — used by the auto-close
# hook below to decide whether linked vulns should be quietly closed.
TERMINAL_STATES: Set[str] = {"decommissioned", "retired"}

# Single source of truth for "this vuln has already reached a terminal state".
# Must stay aligned with `_LIST_CLOSED_STATUSES` in
# grc/modules/vuln_management/routers/vulnerabilities.py — both touch the
# same column and any drift would mean either:
#   (a) we re-close already-closed rows (harmless but wasteful, and would
#       overwrite a proper resolution note with our auto-close note), or
#   (b) we leave active rows on a retired asset (the bug the user reported).
# We use this as a `notin_(...)` filter rather than enumerating the active
# values, because the list of *active* vuln statuses has grown over time
# (open / in_progress / triaged / confirmed / reopened / under_review / …)
# and an allow-list is brittle. The closed-list is the stable source.
_CLOSED_VULN_STATUSES: Set[str] = {
    "resolved",
    "remediated",
    "verified",
    "closed",
    "accepted",
    "false_positive",
    "auto_closed_decommissioned",
    "auto_closed_fixed",
}


def is_valid_state(state: Optional[str]) -> bool:
    return (state or "").strip().lower() in LIFECYCLE_STATES


def is_valid_transition(from_state: Optional[str], to_state: Optional[str]) -> bool:
    """True if `from_state` → `to_state` is a permitted move.

    No-op transitions (same state) are also allowed — callers may write the
    same state idempotently without an exception.
    """
    src = (from_state or "active").strip().lower()
    dst = (to_state or "").strip().lower()
    if not is_valid_state(dst):
        return False
    if src == dst:
        return True
    return dst in _ALLOWED_TRANSITIONS.get(src, set())


def _auto_close_linked_vulns(db: Session, asset) -> int:
    """When an asset enters a terminal state (decommissioned OR retired),
    quietly close every linked vulnerability that isn't already in a
    closed/terminal state.

    Returns the count closed. Best-effort: any failure is logged and the
    caller still gets the asset transition. We don't raise so that the
    primary state change isn't blocked by a downstream issue.

    Filter semantics: closes every vuln linked to this asset whose status
    is NOT already in ``_CLOSED_VULN_STATUSES``. This catches the full set
    of active states (open / in_progress / triaged / confirmed / reopened /
    under_review / …) without us having to maintain an allow-list that drifts.

    Tenant-id is enforced as a defensive double-check — `asset_id` alone is
    unique across tenants but we still constrain by `asset.tenant_id` so a
    bug elsewhere (e.g. cross-tenant link sneaking in) can't bleed.
    """
    try:
        # Local imports to avoid circulars during module init.
        from ..models import Vulnerability, VulnerabilityAssetLink
    except Exception:
        logger.exception("Could not import models for vuln auto-close")
        return 0

    closed = 0
    try:
        target_state = (asset.lifecycle_state or "").strip().lower()
        vulns = (
            db.query(Vulnerability)
            .join(VulnerabilityAssetLink, VulnerabilityAssetLink.vulnerability_id == Vulnerability.id)
            .filter(
                VulnerabilityAssetLink.asset_id == asset.id,
                Vulnerability.tenant_id == getattr(asset, "tenant_id", None),
                # Active = anything NOT already terminal. Robust against new
                # active sub-states being introduced upstream.
                ~Vulnerability.status.in_(_CLOSED_VULN_STATUSES),
            )
            .all()
        )
        now = datetime.utcnow()
        for v in vulns:
            # Use the dedicated `auto_closed_decommissioned` status so the
            # closed-list filter in the vuln list/dashboard treats this as
            # terminal but reports can still distinguish "fixed by an
            # engineer" from "no longer relevant because the host went away".
            # Both terminal asset states (decommissioned + retired) collapse
            # to this single closure status; the resolution_notes column
            # records the exact target state for audit clarity.
            v.status = "auto_closed_decommissioned"
            v.resolved_at = now
            if hasattr(v, "resolution_notes"):
                stamp = (
                    f"[{now.strftime('%Y-%m-%d %H:%M UTC')}] Auto-closed: "
                    f"linked asset '{asset.name}' transitioned to "
                    f"'{target_state or asset.lifecycle_state}'."
                )
                existing = getattr(v, "resolution_notes", None)
                # Append rather than overwrite — preserves any engineer
                # notes written before the host was decommissioned, while
                # still leaving an unambiguous audit trail for the closure
                # itself.
                v.resolution_notes = f"{existing}\n\n{stamp}" if existing else stamp
            closed += 1
        if closed:
            logger.info(
                "asset_lifecycle.auto_close asset_id=%s state=%s closed_vulns=%d",
                getattr(asset, "id", "?"), target_state, closed,
            )
    except Exception:
        logger.exception("Failed to auto-close vulns for asset %s", getattr(asset, "id", "?"))
    return closed


def transition(
    db: Session,
    asset,
    to_state: str,
    *,
    reason: Optional[str] = None,
    replacement_asset_id: Optional[int] = None,
    actor_id: Optional[int] = None,  # accepted for forward-compat audit logging
) -> dict:
    """Move `asset` to `to_state`. Stamp timestamps, trigger auto-close.

    Raises ValueError when the transition is not allowed. The caller is
    expected to commit the session — we only mutate the in-memory row plus
    its linked vulns (the latter via the auto-close hook).

    Returns a small summary dict suitable for inclusion in a response body.
    """
    current = (asset.lifecycle_state or "active").strip().lower()
    target = (to_state or "").strip().lower()

    if not is_valid_state(target):
        raise ValueError(f"Unknown lifecycle state: {to_state!r}")
    if not is_valid_transition(current, target):
        raise ValueError(
            f"Transition not allowed: {current!r} → {target!r}. "
            f"Permitted next states: {sorted(_ALLOWED_TRANSITIONS.get(current, set()))}"
        )

    asset.lifecycle_state = target

    # Side-effects keyed on the target state.
    if target == "decommissioned":
        # First entry into a terminal state — stamp the timestamp once.
        if asset.decommissioned_at is None:
            asset.decommissioned_at = datetime.utcnow()
        if reason:
            asset.retirement_reason = reason
        if replacement_asset_id is not None:
            asset.replacement_asset_id = replacement_asset_id

    if target == "retired":
        # If somehow we get to retired without passing through decommissioned
        # (defence in depth — the transition table currently forbids it), stamp.
        if asset.decommissioned_at is None:
            asset.decommissioned_at = datetime.utcnow()
        if reason and not asset.retirement_reason:
            asset.retirement_reason = reason

    closed = 0
    if target in TERMINAL_STATES:
        closed = _auto_close_linked_vulns(db, asset)

    return {
        "from_state": current,
        "to_state": target,
        "decommissioned_at": asset.decommissioned_at,
        "auto_closed_vulnerabilities": closed,
    }
