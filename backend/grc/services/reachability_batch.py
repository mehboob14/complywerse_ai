"""Batch attack-path computation — fill the "path not calculated yet" gap.

The reachability engine (attack.view.build_view → attack.history.record_snapshot)
runs per (finding × asset) and, until now, only when someone opened a finding's
Exploit Test tab. So a freshly-linked scope reads "205 path not calculated
yet" — honest, but empty. This service runs the SAME engine and the SAME
change-aware writer over every linked (vuln × asset) pair in a tenant (or a
scope), persisting a snapshot for each — no second code path, no re-derived
logic. record_snapshot is idempotent-by-hash, so re-running only writes when a
verdict actually changed.

Honesty carried through: a finding with no CVE/CWE/vector (a Nessus "info"
item) still gets a snapshot — its verdict will be `unlikely` with entry_state
`assumed_insufficient` → viability "undeterminable" — so the card can say
"can't tell" for exactly those, instead of pretending they were analysed.
"""

import logging
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def compute_paths(db: Session, tenant_id: int, *, vulnerability_ids: Optional[List[int]] = None,
                  only_missing: bool = True, limit: int = 5000) -> Dict[str, Any]:
    """Run the attack-path engine over (vuln × linked asset) pairs.

    vulnerability_ids: restrict to these findings (a CTEM scope); None = tenant.
    only_missing: skip pairs that already have a snapshot (the default — the
      point is to fill the gap; a full re-evaluate is a deliberate choice).
    Returns a report {pairs, evaluated, snapshots_written, unchanged, errors,
      by_verdict}. Caller owns nothing — record_snapshot commits per pair.
    """
    from ..models import Vulnerability, ITAsset, VulnerabilityAssetLink, ReachabilitySnapshot
    from ..modules.vuln_management.attack.view import build_view
    from ..modules.vuln_management.attack.history import record_snapshot

    q = db.query(VulnerabilityAssetLink.vulnerability_id, VulnerabilityAssetLink.asset_id).join(
        Vulnerability, Vulnerability.id == VulnerabilityAssetLink.vulnerability_id,
    ).filter(Vulnerability.tenant_id == tenant_id)
    if vulnerability_ids is not None:
        if not vulnerability_ids:
            return {"pairs": 0, "evaluated": 0, "snapshots_written": 0, "unchanged": 0,
                    "errors": 0, "by_verdict": {}}
        q = q.filter(VulnerabilityAssetLink.vulnerability_id.in_(vulnerability_ids))
    pairs = q.distinct().limit(limit).all()

    have = set()
    if only_missing:
        have = {(r.vulnerability_id, r.asset_id) for r in db.query(
            ReachabilitySnapshot.vulnerability_id, ReachabilitySnapshot.asset_id
        ).filter(ReachabilitySnapshot.tenant_id == tenant_id).all()}

    report: Dict[str, Any] = {"pairs": len(pairs), "evaluated": 0, "snapshots_written": 0,
                              "unchanged": 0, "errors": 0, "by_verdict": {}}
    vcache: Dict[int, Any] = {}
    acache: Dict[int, Any] = {}
    for vid, aid in pairs:
        if only_missing and (vid, aid) in have:
            continue
        vuln = vcache.get(vid) or db.query(Vulnerability).get(vid)
        asset = acache.get(aid) or db.query(ITAsset).get(aid)
        if vuln is None or asset is None:
            continue
        vcache[vid], acache[aid] = vuln, asset
        try:
            view = build_view(vuln, asset)
            snap, created = record_snapshot(db, tenant_id, vuln, asset, view)
            report["evaluated"] += 1
            if created:
                report["snapshots_written"] += 1
            else:
                report["unchanged"] += 1
            v = (view.get("verdict") or {}).get("verdict") or "unlikely"
            report["by_verdict"][v] = report["by_verdict"].get(v, 0) + 1
        except Exception:
            logger.exception("compute_paths failed for vuln %s asset %s", vid, aid)
            report["errors"] += 1
    return report
