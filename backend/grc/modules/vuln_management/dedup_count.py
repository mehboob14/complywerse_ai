"""The ONE deduped-distinct vulnerability count, shared by every "open vulnerabilities" surface.

Three surfaces must agree: the Vulnerability Register Overview (canonical), the IT Asset Inventory
"open vulns / Needs attention", and the AI Pentest "open findings". They used to diverge because only
the register deduped. This module holds the SINGLE fold — lifted verbatim from
`vuln_management/routers/dashboard.py::get_dashboard` — so all three read the same truth.

A distinct finding = one `dedup_key` group over the tenant's vulnerabilities, keyed by
{cve_id, title, asset_type (from the inventory-asset link), affected_url, affected_component}, with
the most-severe row as the group representative. `inventory_only` excludes ad-hoc pentest targets
(exclude_adhoc); `open_only` counts groups with at least one non-resolved member.
"""
from typing import Any, Dict, List, Tuple

from sqlalchemy.orm import Session

from ...models import Vulnerability, VulnerabilityAssetLink, ITAsset
from ._adhoc_filter import exclude_adhoc, inventory_assets_only

# Statuses that mean a finding is no longer open. Single source of truth — dashboard.py imports this.
RESOLVED_STATUSES = [
    "resolved", "remediated", "verified", "closed",
    "accepted", "false_positive", "auto_closed_decommissioned",
    "auto_closed_fixed",
]


def fold_distinct_vulns(db: Session, vulns: List[Vulnerability], *, inventory_only: bool = True
                        ) -> Tuple[Dict[Any, dict], set]:
    """Fold Vulnerability rows into DISTINCT findings by dedup_key — the exact fold get_dashboard uses.

    asset_type (for the dedup key) and internet exposure come from one batch link query over the
    assets each vuln links to (inventory-only when `inventory_only`). Returns
    (groups, exposed_ids): groups maps dedup_key -> {"rep": most-severe Vulnerability, "ids": [vuln_id…]};
    exposed_ids is the set of vuln ids linked to an internet-facing asset. REUSE this — do not re-fold.
    """
    from grc.modules.pentest.dedup_tables import dedup_key
    from grc.modules.pentest.service import _SEV_RANK_DISTINCT

    _atype: Dict[int, str] = {}
    _exposed_ids: set = set()
    _all_ids = [v.id for v in vulns]
    if _all_ids:
        link_q = (
            db.query(VulnerabilityAssetLink.vulnerability_id, ITAsset.asset_type,
                     ITAsset.internet_facing, ITAsset.is_internet_facing)
            .join(ITAsset, ITAsset.id == VulnerabilityAssetLink.asset_id)
            .filter(VulnerabilityAssetLink.vulnerability_id.in_(_all_ids))
        )
        if inventory_only:
            link_q = link_q.filter(*inventory_assets_only(ITAsset))
        for vid, atype, inet, isinet in link_q.all():
            _atype.setdefault(vid, atype)
            if inet or isinet:
                _exposed_ids.add(vid)

    groups: Dict[Any, dict] = {}

    def _rank(v):
        return _SEV_RANK_DISTINCT.get((v.severity or "info").strip().lower(), 5)

    for v in vulns:
        kd = {"cve_id": v.cve_id, "title": v.title, "asset_type": _atype.get(v.id),
              "affected_url": getattr(v, "affected_url", None),
              "affected_component": getattr(v, "affected_component", None)}
        try:
            k = dedup_key(kd)
        except Exception:  # noqa: BLE001 — a bad key must never merge unrelated rows
            k = ("_id", v.id)
        g = groups.get(k)
        if g is None:
            groups[k] = {"rep": v, "ids": [v.id]}
        else:
            g["ids"].append(v.id)
            if _rank(v) < _rank(g["rep"]):
                g["rep"] = v
    return groups, _exposed_ids


def distinct_vuln_count(db: Session, user_tenants: list, *,
                        open_only: bool = False, inventory_only: bool = True) -> int:
    """The deduped-distinct finding count for a tenant — the number every "open vulnerabilities"
    surface must show. `inventory_only` excludes ad-hoc pentest targets; `open_only` counts only
    groups with at least one non-resolved member. Returns 0 when there are no tenants."""
    if not user_tenants:
        return 0
    q = db.query(Vulnerability).filter(Vulnerability.tenant_id.in_(user_tenants))
    if inventory_only:
        q = q.filter(exclude_adhoc(db))
    vulns = q.all()
    groups, _ = fold_distinct_vulns(db, vulns, inventory_only=inventory_only)
    if not open_only:
        return len(groups)
    open_ids = {v.id for v in vulns if (v.status or "") not in RESOLVED_STATUSES}
    return sum(1 for g in groups.values() if any(i in open_ids for i in g["ids"]))
