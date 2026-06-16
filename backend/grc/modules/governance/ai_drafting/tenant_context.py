"""Tenant context bundle for AI document drafting.

`build_tenant_context()` reads the tenant company profile, committees,
roles, business units, and the password policy row in a single helper.
The resulting `TenantContextBundle` is injected into every LLM call so
generated documents reference real organisation values rather than
placeholders.

The committee / role / BU lookups are best-effort — when the tenant
hasn't configured a given table, the corresponding field is left empty
and the scaffold uses a generic role label downstream rather than a
fake committee name.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from sqlalchemy.orm import Session

from ....models import (
    Tenant,
    BusinessUnit,
    Role,
    GovernanceCommittee,
    PasswordPolicy,
)
from ....services.password_policy import get_active_password_policy


@dataclass
class TenantContextBundle:
    """Concrete tenant values that drive document personalisation."""

    # ── Organisation profile ─────────────────────────────────────────
    tenant_id: int
    organization_name: str                          # falls back to "the organization"
    legal_entity: Optional[str] = None
    industry: Optional[str] = None
    regulatory_scope: Optional[str] = None          # free-text scope blurb
    geography: Optional[str] = None
    primary_contact_name: Optional[str] = None
    primary_contact_email: Optional[str] = None

    # ── Governance structures ────────────────────────────────────────
    committees: List[dict] = field(default_factory=list)
    # Each entry: {"name": str, "type": str, "frequency": str, "chair_name": Optional[str]}

    roles: List[str] = field(default_factory=list)
    business_units: List[str] = field(default_factory=list)

    # ── Concrete configured thresholds (only populated when present) ─
    password_policy: Optional[dict] = None
    # When set: {min_length, require_uppercase, ..., lockout_threshold,
    #            lockout_minutes, session_idle_timeout_minutes,
    #            password_history_count, max_password_age_days}

    # ── Convenience flags ────────────────────────────────────────────
    @property
    def organisation_display(self) -> str:
        """Best name to use inline in the document body."""
        return self.legal_entity or self.organization_name

    def committee_names(self) -> List[str]:
        return [c["name"] for c in self.committees if c.get("name")]

    def find_committee(self, *types: str) -> Optional[dict]:
        """Return the first committee whose `committee_type` matches any of `types`.

        Used by the scaffolds to populate Approval Signoff rows — e.g. the
        Policy scaffold asks for a "risk_committee" committee for the second
        approval tier. When none exists the scaffold falls back to a generic
        role label rather than fabricating a committee name.
        """
        wanted = {t.lower() for t in types}
        for c in self.committees:
            if (c.get("type") or "").lower() in wanted:
                return c
        return None


def _serialise_password_policy(policy: PasswordPolicy) -> dict:
    """Snapshot only the fields the scaffolds care about."""
    return {
        "min_length": policy.min_length,
        "require_uppercase": policy.require_uppercase,
        "require_lowercase": policy.require_lowercase,
        "require_digit": policy.require_digit,
        "require_special": policy.require_special,
        "lockout_threshold": policy.lockout_threshold,
        "lockout_minutes": policy.lockout_minutes,
        "session_idle_timeout_minutes": policy.session_idle_timeout_minutes,
        "password_history_count": policy.password_history_count,
        "max_password_age_days": policy.max_password_age_days,
    }


def build_tenant_context(tenant_id: int, db: Session) -> TenantContextBundle:
    """Assemble the tenant context bundle in one DB pass per table.

    Each lookup is wrapped in a defensive try so a missing relationship
    (e.g. tenant has no committees configured yet) degrades gracefully
    rather than killing the whole draft.
    """
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        # Empty bundle — the pipeline still runs, just with placeholder
        # language. Callers should avoid this path but it must not raise.
        return TenantContextBundle(
            tenant_id=tenant_id,
            organization_name="the organization",
        )

    bundle = TenantContextBundle(
        tenant_id=tenant.id,
        organization_name=tenant.name or "the organization",
        legal_entity=tenant.legal_entity,
        industry=tenant.industry,
        regulatory_scope=tenant.regulatory_scope,
        geography=tenant.geography,
        primary_contact_name=tenant.primary_contact_name,
        primary_contact_email=tenant.primary_contact_email,
    )

    # ── Committees ───────────────────────────────────────────────────
    try:
        committee_rows = (
            db.query(GovernanceCommittee)
            .filter(
                GovernanceCommittee.tenant_id == tenant_id,
                GovernanceCommittee.is_active.is_(True),
            )
            .order_by(GovernanceCommittee.committee_type, GovernanceCommittee.name)
            .all()
        )
        for c in committee_rows:
            chair_name = None
            if c.chair and getattr(c.chair, "full_name", None):
                chair_name = c.chair.full_name
            bundle.committees.append({
                "name": c.name,
                "type": c.committee_type,
                "frequency": c.meeting_frequency,
                "chair_name": chair_name,
            })
    except Exception:
        pass

    # ── Roles (tenant RBAC roles) ────────────────────────────────────
    try:
        role_rows = (
            db.query(Role.name)
            .filter(Role.tenant_id == tenant_id)
            .order_by(Role.name.asc())
            .all()
        )
        bundle.roles = [r[0] for r in role_rows if r[0]]
    except Exception:
        pass

    # ── Business units ───────────────────────────────────────────────
    try:
        bu_rows = (
            db.query(BusinessUnit.name)
            .filter(BusinessUnit.tenant_id == tenant_id)
            .order_by(BusinessUnit.name.asc())
            .all()
        )
        bundle.business_units = [b[0] for b in bu_rows if b[0]]
    except Exception:
        pass

    # ── Password policy thresholds ───────────────────────────────────
    try:
        policy = get_active_password_policy(db)
        if policy is not None:
            bundle.password_policy = _serialise_password_policy(policy)
    except Exception:
        pass

    return bundle
