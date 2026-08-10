"""CTEM Phase 3 — scope membership resolver + cycle stage counters.

ONE membership resolver (`resolve_scope_assets`) is the single source of
truth for "what is in this scope". Every register filter and every counter
join goes through it, so a cycle card's counts can never disagree with the
filtered register sitting next to it — the specific credibility failure the
review named.

Counters are named to REAL event tables + explicit timestamps (below). Only
three ship in v1 — discovered / validated / mobilized — each with something
true to count. "Prioritized" has no event table until Phase 4's choke points
and is omitted rather than faked.

Overlap is fine, summing is not: assets legitimately belong to several
scopes, so no caller may total counts ACROSS scopes (double-counting by
construction). Counters take one scope at a time.
"""

import hashlib
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

HASH_ALGORITHM = "sha256:sorted-asset-ids-v1"


def resolve_scope_assets(db: Session, tenant_id: int, membership_rule: Optional[Dict[str, Any]]) -> List[int]:
    """Resolve a scope's membership to a sorted list of ITAsset ids.

    Membership = explicit asset_ids UNION assets matching the rule criteria
    (criteria AND together — each further NARROWS). Empty/None rule → empty
    scope (never "all assets" by accident). This is the ONLY place membership
    is computed."""
    from ..models import ITAsset

    rule = membership_rule or {}
    ids: set = set()

    explicit = rule.get("asset_ids") or []
    if explicit:
        rows = db.query(ITAsset.id).filter(
            ITAsset.tenant_id == tenant_id,
            ITAsset.id.in_([int(a) for a in explicit]),
        ).all()
        ids.update(r[0] for r in rows)

    criteria = []
    if rule.get("departments"):
        criteria.append(ITAsset.department.in_(list(rule["departments"])))
    if rule.get("asset_types"):
        criteria.append(ITAsset.asset_type.in_(list(rule["asset_types"])))
    if rule.get("name_contains"):
        pat = f"%{rule['name_contains']}%"
        criteria.append(or_(ITAsset.name.ilike(pat), ITAsset.host_name.ilike(pat)))

    if criteria:
        q = db.query(ITAsset.id).filter(ITAsset.tenant_id == tenant_id)
        for c in criteria:
            q = q.filter(c)
        ids.update(r[0] for r in q.all())

    return sorted(ids)


def membership_hash(asset_ids: List[int]) -> str:
    """Deterministic digest over the sorted member-asset ids. Algorithm is
    recorded separately (HASH_ALGORITHM) so equality stays meaningful across
    engine versions."""
    payload = ",".join(str(i) for i in sorted(asset_ids))
    return hashlib.sha256(payload.encode()).hexdigest()


def _vuln_ids_for_assets(db: Session, tenant_id: int, asset_ids: List[int]) -> List[int]:
    from ..models import Vulnerability, VulnerabilityAssetLink
    if not asset_ids:
        return []
    rows = db.query(VulnerabilityAssetLink.vulnerability_id).join(
        Vulnerability, Vulnerability.id == VulnerabilityAssetLink.vulnerability_id,
    ).filter(
        Vulnerability.tenant_id == tenant_id,
        VulnerabilityAssetLink.asset_id.in_(asset_ids),
    ).distinct().all()
    return [r[0] for r in rows]


def scope_vulnerability_ids(db: Session, tenant_id: int, membership_rule: Optional[Dict[str, Any]]) -> List[int]:
    """THE scope→findings function. The register filter AND the cycle counters
    both call this, so "in scope" has exactly one definition — a future
    refactor of either cannot silently drift them apart (the invariant proven
    by the register==resolver identity checks, now structural not incidental).
    Distinct by construction (via _vuln_ids_for_assets), so a mixed scope
    whose explicit list and rule both match an asset counts its findings
    once."""
    return _vuln_ids_for_assets(db, tenant_id, resolve_scope_assets(db, tenant_id, membership_rule))


def compute_stage_counts(
    db: Session,
    tenant_id: int,
    asset_ids: List[int],
    *,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
) -> Dict[str, int]:
    """The three honest counters for a scope's member assets, optionally
    windowed [since, until).

      * discovered — findings on member assets whose FIRST detection falls in
        the window (Vulnerability.first_detected, falling back to
        discovered_at). first_detected is used specifically so re-scans do
        NOT re-discover an existing finding.
      * validated  — control-effectiveness evidence rows (retest / closure /
        reachability) on member-asset findings, tested in the window
        (ControlEffectivenessEvidence.tested_at, retracted rows excluded).
      * mobilized  — remediation plans created in the window for member-asset
        findings (VulnRemediationPlan.created_at).
    """
    from ..models import (
        Vulnerability, ControlEffectivenessEvidence, VulnRemediationPlan,
    )

    out = {"member_assets": len(asset_ids), "discovered": 0, "validated": 0, "mobilized": 0}
    # Same asset→findings mapping the register filter uses (via
    # scope_vulnerability_ids, which wraps this) — one definition of "in scope".
    vuln_ids = _vuln_ids_for_assets(db, tenant_id, asset_ids)
    if not vuln_ids:
        return out

    def _window(q, col):
        if since is not None:
            q = q.filter(col >= since)
        if until is not None:
            q = q.filter(col < until)
        return q

    disc_col = func.coalesce(Vulnerability.first_detected, Vulnerability.discovered_at)
    dq = db.query(func.count(Vulnerability.id)).filter(
        Vulnerability.tenant_id == tenant_id,
        Vulnerability.id.in_(vuln_ids),
    )
    out["discovered"] = _window(dq, disc_col).scalar() or 0

    vq = db.query(func.count(ControlEffectivenessEvidence.id)).filter(
        ControlEffectivenessEvidence.tenant_id == tenant_id,
        ControlEffectivenessEvidence.vulnerability_id.in_(vuln_ids),
        ControlEffectivenessEvidence.retracted_at.is_(None),
    )
    out["validated"] = _window(vq, ControlEffectivenessEvidence.tested_at).scalar() or 0

    mq = db.query(func.count(VulnRemediationPlan.id)).filter(
        VulnRemediationPlan.tenant_id == tenant_id,
        VulnRemediationPlan.vulnerability_id.in_(vuln_ids),
    )
    out["mobilized"] = _window(mq, VulnRemediationPlan.created_at).scalar() or 0

    return out


def freeze_cycle(db: Session, cycle) -> None:
    """Populate a cycle's frozen fields at close: live counts + the rule
    as-of-now + the membership hash + the algorithm string. Caller commits."""
    from ..models import CtemScope

    scope = db.query(CtemScope).filter(CtemScope.id == cycle.scope_id).first()
    rule = (scope.membership_rule if scope else None) or {}
    asset_ids = resolve_scope_assets(db, cycle.tenant_id, rule)
    cycle.counts = compute_stage_counts(
        db, cycle.tenant_id, asset_ids, since=cycle.opened_at, until=datetime.utcnow(),
    )
    cycle.membership_rule_frozen = rule
    cycle.membership_hash = membership_hash(asset_ids)
    cycle.hash_algorithm = HASH_ALGORITHM
