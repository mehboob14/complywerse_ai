"""HMAC-signed single-use approval tokens for email-link approvals (Task #46)."""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta
from typing import Optional, Tuple

from sqlalchemy.orm import Session

from ....models import ApprovalEmailToken


_DEFAULT_TTL_DAYS = 7


def _signing_key() -> bytes:
    key = os.environ.get("APPROVAL_TOKEN_SECRET") or os.environ.get("SECRET_KEY") or os.environ.get("SESSION_SECRET")
    if not key:
        raise RuntimeError(
            "No signing key configured. Set APPROVAL_TOKEN_SECRET, SECRET_KEY, "
            "or SESSION_SECRET environment variable."
        )
    return key.encode("utf-8")


def _hash(token_plaintext: str) -> str:
    return hmac.new(_signing_key(), token_plaintext.encode("utf-8"), hashlib.sha256).hexdigest()


def issue_token(
    db: Session,
    tenant_id: int,
    proposal_id: int,
    approver_user_id: int,
    ttl_days: int = _DEFAULT_TTL_DAYS,
) -> Tuple[str, ApprovalEmailToken]:
    """Issue a single-use approval token. Returns (plaintext_token, row).

    The plaintext token is what we send in the email link; the DB stores only
    the HMAC of (plaintext + tenant_id + proposal_id + approver_user_id) so a
    leaked DB row cannot replay the link, and a leaked link cannot be re-used.
    """
    raw = secrets.token_urlsafe(32)
    bound = f"{raw}|{tenant_id}|{proposal_id}|{approver_user_id}"
    row = ApprovalEmailToken(
        tenant_id=tenant_id,
        proposal_id=proposal_id,
        approver_user_id=approver_user_id,
        token_hash=_hash(bound),
        expires_at=datetime.utcnow() + timedelta(days=ttl_days),
    )
    db.add(row)
    db.flush()
    # The plaintext we hand back to the email is "raw.proposal_id.approver_user_id.tenant_id"
    # so the verify endpoint can recompute the bound input without a DB lookup
    # by token_hash alone (defense-in-depth: same bound input or rejected).
    plaintext = f"{raw}.{proposal_id}.{approver_user_id}.{tenant_id}"
    return plaintext, row


def verify_and_consume(
    db: Session,
    plaintext: str,
    decision: str,
    ip_address: Optional[str] = None,
) -> Optional[ApprovalEmailToken]:
    """Verify token, mark used, return the row. Returns None on any failure
    (invalid format, bad signature, expired, already used, decision mismatch)."""
    if decision not in ("approve", "reject"):
        return None
    parts = plaintext.split(".")
    if len(parts) != 4:
        return None
    raw, p_id_s, a_id_s, t_id_s = parts
    try:
        proposal_id = int(p_id_s)
        approver_user_id = int(a_id_s)
        tenant_id = int(t_id_s)
    except ValueError:
        return None
    bound = f"{raw}|{tenant_id}|{proposal_id}|{approver_user_id}"
    expected_hash = _hash(bound)
    row: Optional[ApprovalEmailToken] = (
        db.query(ApprovalEmailToken)
        .filter(ApprovalEmailToken.token_hash == expected_hash)
        .first()
    )
    if not row:
        return None
    if row.used_at is not None:
        return None
    if row.expires_at and row.expires_at < datetime.utcnow():
        return None
    if (
        row.tenant_id != tenant_id
        or row.proposal_id != proposal_id
        or row.approver_user_id != approver_user_id
    ):
        return None
    row.used_at = datetime.utcnow()
    row.decision = decision
    row.ip_address = ip_address
    db.add(row)
    db.flush()
    return row
