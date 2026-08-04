"""Token helpers for compliance agents.

Two token kinds:
  • enrollment_token: one-time, expires after first /enroll call.
                      Format: enroll_<32-hex>
  • api_token:        long-lived, used on every /heartbeat + /results.
                      Format: agt_<48-hex>

Only the sha256 hash is stored. Raw tokens are returned exactly once
when generated; lost token → revoke + re-enroll.
"""
from __future__ import annotations

import hashlib
import secrets
from typing import Optional

from sqlalchemy.orm import Session

from grc.models import ComplianceAgent


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def new_enrollment_token() -> tuple[str, str]:
    raw = "enroll_" + secrets.token_hex(32)
    return raw, _hash(raw)


def new_api_token() -> tuple[str, str]:
    raw = "agt_" + secrets.token_hex(48)
    return raw, _hash(raw)


def find_agent_by_enrollment_token(db: Session, raw_token: str) -> Optional[ComplianceAgent]:
    # Match BOTH:
    #   - single-use pending agents (legacy installers)
    #   - fleet templates whose status='active' but enrollment_token_hash is still
    #     set so N hosts can claim it. The /enroll handler then spawns a child
    #     per claim.
    return (
        db.query(ComplianceAgent)
        .filter(
            ComplianceAgent.enrollment_token_hash == _hash(raw_token),
            ComplianceAgent.enrollment_token_hash.isnot(None),
        )
        .first()
    )


def find_agent_by_api_token(db: Session, raw_token: str) -> Optional[ComplianceAgent]:
    return (
        db.query(ComplianceAgent)
        .filter(
            ComplianceAgent.api_token_hash == _hash(raw_token),
            ComplianceAgent.status == "active",
        )
        .first()
    )
