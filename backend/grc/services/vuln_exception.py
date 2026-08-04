"""Phase 8 — Exception workflow state machine for vulnerabilities.

Encodes valid transitions for `Vulnerability.exception_status` and enforces
separation of duties (a user who requested an exception cannot also approve
or deny it). The legacy `is_exception` / `exception_reason` /
`exception_approved_by` / `exception_expiry` columns are kept in sync so
existing dashboards and reports don't have to be rewritten.

States:
    none        — no exception in play (default)
    requested   — pending review
    approved    — accepted by a reviewer
    denied      — rejected by a reviewer (terminal until re-requested)
    expired     — was approved but past expiry; auto-set by daily sweep
    revoked     — manually pulled back by an admin (terminal)

Allowed transitions:
    none        → requested
    requested   → approved
    requested   → denied
    approved    → revoked
    approved    → expired      (sweep-driven; callers usually go through
                                `expire_due_exceptions()`)
    denied      → requested    (re-request after addressing concerns)
    expired     → requested    (re-request after expiry — auditors prefer
                                a fresh review over silently extending)
    revoked     → (nothing)    (terminal)
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Iterable, List, Optional, Set, Tuple

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

EXCEPTION_STATES: Tuple[str, ...] = (
    "none",
    "requested",
    "approved",
    "denied",
    "expired",
    "revoked",
)

# Forward edges. Every transition here is normative — anything missing is
# refused with a 400. Callers don't get to add states without updating this.
_ALLOWED_TRANSITIONS: dict[str, Set[str]] = {
    "none": {"requested"},
    "requested": {"approved", "denied"},
    "approved": {"revoked", "expired"},
    "denied": {"requested"},
    "expired": {"requested"},
    "revoked": set(),
}

# States that block re-requests / require an explicit move-back-through-none.
TERMINAL_STATES: Set[str] = {"revoked"}


class ExceptionWorkflowError(ValueError):
    """Raised for any FSM / separation-of-duties violation. Caller maps to 400."""


def _norm(state: Optional[str]) -> str:
    return (state or "none").strip().lower()


def is_valid_state(state: Optional[str]) -> bool:
    return _norm(state) in EXCEPTION_STATES


def is_valid_transition(from_state: Optional[str], to_state: Optional[str]) -> bool:
    src = _norm(from_state)
    dst = _norm(to_state)
    if not is_valid_state(dst):
        return False
    if src == dst:
        return True
    return dst in _ALLOWED_TRANSITIONS.get(src, set())


# ─── Operations ──────────────────────────────────────────────────────────────


def request_exception(
    *,
    vuln,
    actor_id: int,
    justification: str,
    compensating_controls: Optional[Iterable[str]] = None,
    expires_at: Optional[datetime] = None,
) -> dict:
    """Move `vuln` from none/denied/expired into `requested`.

    Justification is mandatory — auditors specifically look for "documented
    risk acceptance with stated rationale". Empty justifications are refused.
    """
    current = _norm(vuln.exception_status)
    if not is_valid_transition(current, "requested"):
        raise ExceptionWorkflowError(
            f"Cannot request an exception from state {current!r}. "
            f"Permitted next states: {sorted(_ALLOWED_TRANSITIONS.get(current, set()))}"
        )

    just = (justification or "").strip()
    if not just:
        raise ExceptionWorkflowError("Justification is required when requesting an exception.")

    vuln.exception_status = "requested"
    vuln.exception_requested_by_id = actor_id
    vuln.exception_requested_at = datetime.utcnow()
    vuln.exception_justification = just
    if compensating_controls is not None:
        vuln.exception_compensating_controls = [c for c in compensating_controls if c]
    if expires_at is not None:
        # Capture the requester's desired expiry. Approver may override.
        vuln.exception_expires_at = expires_at

    # Clear any prior denial reason — it's no longer the current state.
    vuln.exception_denial_reason = None

    # Legacy sync. is_exception stays False until APPROVED — that mirrors
    # how existing reports treat exceptions ("approved, in force right now").
    vuln.is_exception = False
    vuln.exception_reason = just

    return _summary(vuln)


def approve_exception(
    *,
    vuln,
    actor_id: int,
    comment: Optional[str] = None,
    expires_at: Optional[datetime] = None,
) -> dict:
    """Move `requested` → `approved`. Enforces separation of duties."""
    current = _norm(vuln.exception_status)
    if not is_valid_transition(current, "approved"):
        raise ExceptionWorkflowError(
            f"Cannot approve from state {current!r}. Exception must be in 'requested' state."
        )
    if vuln.exception_requested_by_id is not None and vuln.exception_requested_by_id == actor_id:
        raise ExceptionWorkflowError(
            "Separation of duties: the user who requested an exception cannot also approve it."
        )

    vuln.exception_status = "approved"
    vuln.exception_approved_by = actor_id
    vuln.exception_approved_at = datetime.utcnow()
    if expires_at is not None:
        vuln.exception_expires_at = expires_at

    # Stamp approval comment into the JSON metadata column so we don't lose
    # context. Allocated lazily — most rows won't have any metadata yet.
    if comment and comment.strip():
        meta = dict(vuln.exception_metadata or {})
        meta["approval_comment"] = comment.strip()
        vuln.exception_metadata = meta

    # Legacy sync — flip is_exception ON now that approval has landed.
    vuln.is_exception = True
    vuln.exception_expiry = vuln.exception_expires_at

    return _summary(vuln)


def deny_exception(
    *,
    vuln,
    actor_id: int,
    denial_reason: str,
) -> dict:
    """Move `requested` → `denied`. Enforces separation of duties + mandatory reason."""
    current = _norm(vuln.exception_status)
    if not is_valid_transition(current, "denied"):
        raise ExceptionWorkflowError(
            f"Cannot deny from state {current!r}. Exception must be in 'requested' state."
        )
    if vuln.exception_requested_by_id is not None and vuln.exception_requested_by_id == actor_id:
        raise ExceptionWorkflowError(
            "Separation of duties: the user who requested an exception cannot also deny it."
        )

    reason = (denial_reason or "").strip()
    if not reason:
        raise ExceptionWorkflowError("A denial reason is required.")

    vuln.exception_status = "denied"
    vuln.exception_denial_reason = reason

    # Legacy sync — deny doesn't take effect, so is_exception remains False
    # and exception_expiry is cleared so downstream filters don't think the
    # vuln is still under exception cover.
    vuln.is_exception = False
    vuln.exception_expiry = None

    return _summary(vuln)


def revoke_exception(
    *,
    vuln,
    actor_id: int,
    reason: Optional[str] = None,
) -> dict:
    """Move `approved` → `revoked`. Used when a compensating control fails
    or new threat intelligence makes the exception untenable."""
    current = _norm(vuln.exception_status)
    if not is_valid_transition(current, "revoked"):
        raise ExceptionWorkflowError(
            f"Cannot revoke from state {current!r}. Exception must be in 'approved' state."
        )

    vuln.exception_status = "revoked"
    vuln.exception_revoked_by_id = actor_id
    vuln.exception_revoked_at = datetime.utcnow()
    if reason and reason.strip():
        vuln.exception_revocation_reason = reason.strip()

    # Legacy sync — the exception is no longer in force.
    vuln.is_exception = False
    vuln.exception_expiry = None

    return _summary(vuln)


def expire_due_exceptions(
    db: Session,
    *,
    now: Optional[datetime] = None,
    tenant_ids: Optional[Iterable[int]] = None,
) -> int:
    """Sweep due exceptions and put the findings back in the queue.

    Only `approved` exceptions are eligible — `requested` rows aren't in
    effect yet, and `revoked`/`denied` are already terminal-ish.

    Expiring the *exception* is only half the job. If the finding was parked at
    `status = 'accepted'` on the strength of that exception, leaving the status
    alone means the acceptance lapses on paper while the finding stays invisible
    in every queue and dashboard — the worst of both worlds. So an expiring
    exception also reopens the finding and clears the resolution stamp.

    `tenant_ids` scopes the sweep, which lets a request-time caller sweep only
    what the current user can see instead of the whole estate.
    """
    from ..models import Vulnerability

    cutoff = now or datetime.utcnow()
    q = (
        db.query(Vulnerability)
        .filter(Vulnerability.exception_status == "approved")
        .filter(Vulnerability.exception_expires_at.isnot(None))
        .filter(Vulnerability.exception_expires_at < cutoff)
    )
    if tenant_ids is not None:
        tenant_ids = list(tenant_ids)
        if not tenant_ids:
            return 0
        q = q.filter(Vulnerability.tenant_id.in_(tenant_ids))
    rows = q.all()
    count = 0
    for vuln in rows:
        # FSM sanity check — should always pass given the filter above,
        # but defence in depth is cheap.
        if not is_valid_transition(_norm(vuln.exception_status), "expired"):
            continue
        vuln.exception_status = "expired"
        # Legacy sync.
        vuln.is_exception = False
        # Put it back in front of someone. Only `accepted` is unparked —
        # a finding already remediated or closed on its own merits stays put.
        if (vuln.status or "").lower() == "accepted":
            vuln.status = "open"
            vuln.resolved_at = None
            vuln.resolution_notes = (
                "Risk acceptance expired on "
                f"{vuln.exception_expires_at:%d %b %Y} — reopened automatically."
            )
        vuln.updated_at = cutoff
        count += 1
    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("expire_due_exceptions: commit failed")
        return 0
    return count


def _summary(vuln) -> dict:
    """Compact snapshot of the exception state — returned by every operation
    so callers can render the new state without a follow-up read."""
    return {
        "exception_status": vuln.exception_status,
        "exception_requested_by_id": vuln.exception_requested_by_id,
        "exception_requested_at": vuln.exception_requested_at,
        "exception_justification": vuln.exception_justification,
        "exception_compensating_controls": list(vuln.exception_compensating_controls or []),
        "exception_approved_by": vuln.exception_approved_by,
        "exception_approved_at": vuln.exception_approved_at,
        "exception_expires_at": vuln.exception_expires_at,
        "exception_denial_reason": vuln.exception_denial_reason,
        "exception_revoked_by_id": vuln.exception_revoked_by_id,
        "exception_revoked_at": vuln.exception_revoked_at,
        "exception_revocation_reason": vuln.exception_revocation_reason,
        "is_exception": vuln.is_exception,
        "exception_metadata": dict(vuln.exception_metadata or {}),
    }
