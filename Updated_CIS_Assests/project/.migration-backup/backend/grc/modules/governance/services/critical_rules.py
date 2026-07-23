"""Critical-rule evaluation for policy gap findings (Task #46).

A finding is "critical" if any enabled rule for its (tenant, framework) fires.
Defaults are seeded on first lookup so admins see all three toggles even before
any explicit configuration.
"""
from __future__ import annotations

from typing import Iterable, List, Optional

from sqlalchemy.orm import Session

from ....models import (
    FrameworkCriticalRule,
    PolicyGapFinding,
    ParsedFrameworkControl,
)


DEFAULT_RULES: List[dict] = [
    {"rule_type": "mandatory_clause", "enabled": True, "params": {}},
    {"rule_type": "high_severity", "enabled": True, "params": {"severities": ["high", "critical"]}},
    {"rule_type": "regulatory_breach", "enabled": True, "params": {}},
]


def get_or_seed_rules(
    db: Session,
    tenant_id: int,
    uploaded_framework_id: Optional[int],
) -> List[FrameworkCriticalRule]:
    """Return the rules for (tenant, framework). Seeds defaults if none exist."""
    rules: List[FrameworkCriticalRule] = (
        db.query(FrameworkCriticalRule)
        .filter(
            FrameworkCriticalRule.tenant_id == tenant_id,
            FrameworkCriticalRule.uploaded_framework_id == uploaded_framework_id,
        )
        .all()
    )
    if rules:
        return rules
    seeded: List[FrameworkCriticalRule] = []
    for r in DEFAULT_RULES:
        row = FrameworkCriticalRule(
            tenant_id=tenant_id,
            uploaded_framework_id=uploaded_framework_id,
            rule_type=r["rule_type"],
            enabled=r["enabled"],
            params=r["params"],
            approver_chain=[],
        )
        db.add(row)
        seeded.append(row)
    db.flush()
    return seeded


def _is_mandatory(control: Optional[ParsedFrameworkControl]) -> bool:
    if not control:
        return False
    for attr in ("is_mandatory", "mandatory", "must_have"):
        v = getattr(control, attr, None)
        if v is True:
            return True
    # Fall back to scanning text fields for common mandatory markers.
    for attr in ("control_text", "requirement_text", "title", "description"):
        v = getattr(control, attr, None)
        if isinstance(v, str) and any(
            kw in v.lower() for kw in ("must ", "shall ", "required ", "mandatory")
        ):
            return True
    return False


def evaluate_finding(
    db: Session,
    finding: PolicyGapFinding,
) -> List[str]:
    """Return the names of rules that fire for this finding. Side-effect-free
    on the finding row — caller writes back if it cares about persisting."""
    rules = get_or_seed_rules(db, finding.tenant_id, finding.uploaded_framework_id)
    fired: List[str] = []

    control: Optional[ParsedFrameworkControl] = None
    # Best-effort lookup of the parsed control for mandatory detection.
    if finding.clause_reference and finding.uploaded_framework_id:
        control = (
            db.query(ParsedFrameworkControl)
            .filter(
                ParsedFrameworkControl.uploaded_framework_id == finding.uploaded_framework_id,
                ParsedFrameworkControl.control_id == finding.clause_reference,
            )
            .first()
        )

    for rule in rules:
        if not rule.enabled:
            continue
        rt = rule.rule_type
        params = rule.params or {}
        if rt == "mandatory_clause":
            if _is_mandatory(control):
                fired.append(rt)
        elif rt == "high_severity":
            severities = params.get("severities") or ["high", "critical"]
            if (finding.risk_severity or "").lower() in [s.lower() for s in severities]:
                fired.append(rt)
        elif rt == "regulatory_breach":
            if bool(getattr(finding, "impact_regulatory", False)):
                fired.append(rt)
    return fired


def apply_critical_status(
    db: Session,
    finding: PolicyGapFinding,
) -> bool:
    """Evaluate + write critical_rules_fired/is_critical onto the finding.
    Returns True if the finding is now critical."""
    fired = evaluate_finding(db, finding)
    finding.critical_rules_fired = fired
    finding.is_critical = bool(fired)
    db.add(finding)
    return finding.is_critical


def default_approver_chain(
    db: Session,
    tenant_id: int,
    uploaded_framework_id: Optional[int],
) -> List[dict]:
    """Default approver chain inferred from the FrameworkCriticalRule rows
    (whichever rule has approver_chain set wins; otherwise single Approver)."""
    rules = get_or_seed_rules(db, tenant_id, uploaded_framework_id)
    for r in rules:
        if r.approver_chain:
            return list(r.approver_chain)
    return [{"step": 1, "role": "Approver"}]
