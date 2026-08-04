"""Automated access-review checks → findings (exceptions).

Each sampled user (an AccessReviewItem) is run through every rule. A rule that
fails produces an AccessReviewFinding. The rules mirror what an auditor tests:

  mfa_missing     — account active but no MFA registered
  ghost_account   — terminated/left but account still enabled
  stale_account   — active account with no sign-in for > STALE_DAYS
  sod_conflict    — holds both roles of an active SoD rule
  over_privileged — privileged role but not in an IT/Security function
  no_approval     — role assigned with no recorded approver / source
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Dict, List, Set, Tuple

from sqlalchemy.orm import Session

from ...models import (
    AccessReviewFinding,
    AccessReviewItem,
    Role,
    SoDRule,
    UserRole,
)

STALE_DAYS = 90
IT_SECURITY_DEPTS = {"it", "information technology", "security", "infosec", "information security"}


def _add_finding(
    tenant_db: Session,
    *,
    tenant_id: int,
    campaign_id: int,
    item: AccessReviewItem,
    finding_type: str,
    severity: str,
    title: str,
    detail: str,
    sod_rule_id: int | None = None,
) -> AccessReviewFinding:
    f = AccessReviewFinding(
        tenant_id=tenant_id,
        campaign_id=campaign_id,
        item_id=item.id,
        finding_type=finding_type,
        severity=severity,
        title=title,
        detail=detail,
        sod_rule_id=sod_rule_id,
    )
    tenant_db.add(f)
    return f


def _active_sod_pairs(tenant_db: Session, tenant_id: int) -> List[SoDRule]:
    return (
        tenant_db.query(SoDRule)
        .filter(SoDRule.tenant_id == tenant_id, SoDRule.is_active == True)  # noqa: E712
        .all()
    )


def _user_role_ids(tenant_db: Session, user_id: int) -> Set[int]:
    rows = tenant_db.query(UserRole.role_id).filter(UserRole.user_id == user_id).all()
    return {r[0] for r in rows}


def _has_unapproved_role(tenant_db: Session, user_id: int) -> bool:
    """A role assignment with neither an approver nor an SSO source can't be
    tied back to an authorization — treat as a (low) finding."""
    rows = (
        tenant_db.query(UserRole)
        .filter(UserRole.user_id == user_id)
        .all()
    )
    for ur in rows:
        if not ur.assigned_by and not ur.source:
            return True
    return False


def run_checks_for_item(
    tenant_db: Session,
    *,
    tenant_id: int,
    campaign_id: int,
    item: AccessReviewItem,
    sod_rules: List[SoDRule],
    role_names: Dict[int, str],
) -> int:
    """Run all rules for one item. Returns number of findings created."""
    count = 0
    now = datetime.utcnow()

    # mfa_missing
    if item.account_enabled and item.mfa_enabled is False:
        _add_finding(
            tenant_db, tenant_id=tenant_id, campaign_id=campaign_id, item=item,
            finding_type="mfa_missing", severity="high",
            title="MFA not registered",
            detail=f"{item.email} has an active account but no registered MFA method.",
        )
        count += 1

    # ghost_account — terminated but still enabled
    if item.termination_date and (item.account_enabled or not item.is_terminated):
        # account_enabled True after a termination date is the classic leaver gap
        if item.account_enabled:
            _add_finding(
                tenant_db, tenant_id=tenant_id, campaign_id=campaign_id, item=item,
                finding_type="ghost_account", severity="critical",
                title="Terminated user still active",
                detail=(
                    f"{item.email} has termination date {item.termination_date} "
                    f"but the account is still enabled."
                ),
            )
            count += 1

    # stale_account — active account that is dormant OR has never signed in
    if item.account_enabled:
        if item.last_sign_in is None:
            _add_finding(
                tenant_db, tenant_id=tenant_id, campaign_id=campaign_id, item=item,
                finding_type="stale_account", severity="medium",
                title="No sign-in on record",
                detail=f"{item.email} has an active account with no recorded sign-in.",
            )
            count += 1
        elif item.last_sign_in < now - timedelta(days=STALE_DAYS):
            days = (now - item.last_sign_in).days
            _add_finding(
                tenant_db, tenant_id=tenant_id, campaign_id=campaign_id, item=item,
                finding_type="stale_account", severity="medium",
                title="Stale account",
                detail=f"{item.email} has not signed in for {days} days.",
            )
            count += 1

    # over_privileged — privileged role outside IT/Security (incl. no department)
    if item.is_privileged:
        dept = (item.department or "").strip().lower()
        if dept not in IT_SECURITY_DEPTS:
            where = f"works in '{item.department}'" if dept else "has no department recorded"
            _add_finding(
                tenant_db, tenant_id=tenant_id, campaign_id=campaign_id, item=item,
                finding_type="over_privileged", severity="high",
                title="Privileged access outside IT/Security",
                detail=(
                    f"{item.email} holds a privileged role but {where}. "
                    f"Confirm least-privilege."
                ),
            )
            count += 1

    # sod_conflict
    if item.user_id and sod_rules:
        held = _user_role_ids(tenant_db, item.user_id)
        for rule in sod_rules:
            if rule.role_a_id in held and rule.role_b_id in held:
                ra = role_names.get(rule.role_a_id, str(rule.role_a_id))
                rb = role_names.get(rule.role_b_id, str(rule.role_b_id))
                _add_finding(
                    tenant_db, tenant_id=tenant_id, campaign_id=campaign_id, item=item,
                    finding_type="sod_conflict", severity=rule.severity or "high",
                    title=f"SoD conflict: {rule.name}",
                    detail=f"{item.email} holds conflicting roles '{ra}' and '{rb}'.",
                    sod_rule_id=rule.id,
                )
                count += 1

    # no_approval
    if item.user_id and _has_unapproved_role(tenant_db, item.user_id):
        _add_finding(
            tenant_db, tenant_id=tenant_id, campaign_id=campaign_id, item=item,
            finding_type="no_approval", severity="low",
            title="Access without recorded approval",
            detail=f"{item.email} has a role assignment with no recorded approver or source.",
        )
        count += 1

    return count


def run_checks(
    tenant_db: Session, *, tenant_id: int, campaign_id: int, items: List[AccessReviewItem]
) -> int:
    """Clear prior findings for the campaign and recompute. Returns total findings."""
    tenant_db.query(AccessReviewFinding).filter(
        AccessReviewFinding.campaign_id == campaign_id
    ).delete(synchronize_session=False)

    sod_rules = _active_sod_pairs(tenant_db, tenant_id)
    role_names = {r.id: r.name for r in tenant_db.query(Role).all()}

    total = 0
    for item in items:
        total += run_checks_for_item(
            tenant_db, tenant_id=tenant_id, campaign_id=campaign_id,
            item=item, sod_rules=sod_rules, role_names=role_names,
        )
    tenant_db.commit()
    return total
