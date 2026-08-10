"""Phase 4 — choke-point ranking.

A finding's choke-point score = the number of distinct VIABLE (asset) chains
it participates in: its latest snapshot per (vuln, asset) whose verdict is
viable (likely/possible). One remediation of that finding severs every one of
those chains — so a widespread finding (a CVE present on many assets) is the
choke point. A severed chain (unlikely) is already broken and does not count.

Design rules settled in review:
  * "appears in a snapshot" means RANKABLE (`is_rankable`, >=1 viable chain) —
    the predicate is named so the prioritized-counter event can never drift
    between "in any chain" and "in the ranked list".
  * Ranking is deterministic: count desc, THEN finding id asc, so identical
    recomputes are byte-identical and only real change (fixes landing)
    reshuffles.
  * NO SUMMING across findings — chains are per-finding here (additive), but
    the ASSETS they touch overlap, so a total would double-count protection.
  * Snapshot rows are SELF-CONTAINED: each entry stores its chain
    decomposition, so the explainability click never joins to the mutable
    reachability tables (which replace on sync).
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

VIABLE_VERDICTS = ("likely", "possible")
ALGORITHM_VERSION = "chokepoint-1.0.0:finding-x-viable-chains"


def is_rankable(chain_count: int) -> bool:
    """A finding is a rankable choke point iff it participates in >=1 viable
    chain. THE pinned predicate — the prioritized-counter event ("finding
    first appears in a snapshot") means "first becomes rankable", nothing
    looser."""
    return chain_count >= 1


def rank_choke_points(db: Session, tenant_id: int) -> List[Dict[str, Any]]:
    """Pure compute (no writes): the deterministic choke-point ranking for a
    tenant from the latest reachability snapshot per (vuln, asset).

    Returns [{vulnerability_id, chain_count, rank,
              chains: [{asset_id, snapshot_id, verdict}]}], rank 1 = highest.
    """
    from ..models import ReachabilitySnapshot

    # Latest snapshot per (vuln, asset): max assessed_at, tie-broken by id so
    # it's deterministic even if two share a timestamp.
    rows = db.query(
        ReachabilitySnapshot.id,
        ReachabilitySnapshot.vulnerability_id,
        ReachabilitySnapshot.asset_id,
        ReachabilitySnapshot.verdict,
        ReachabilitySnapshot.assessed_at,
    ).filter(ReachabilitySnapshot.tenant_id == tenant_id).all()

    latest: Dict[tuple, Any] = {}
    for r in rows:
        key = (r.vulnerability_id, r.asset_id)
        cur = latest.get(key)
        # newer assessed_at wins; ties broken by higher snapshot id
        if cur is None or (r.assessed_at, r.id) > (cur.assessed_at, cur.id):
            latest[key] = r

    by_finding: Dict[int, List[Dict[str, Any]]] = {}
    for (vuln_id, asset_id), r in latest.items():
        if r.verdict not in VIABLE_VERDICTS:
            continue
        by_finding.setdefault(vuln_id, []).append(
            {"asset_id": asset_id, "snapshot_id": r.id, "verdict": r.verdict})

    ranking = []
    for vuln_id, chains in by_finding.items():
        count = len(chains)
        if not is_rankable(count):
            continue
        ranking.append({
            "vulnerability_id": vuln_id,
            "chain_count": count,
            "chains": sorted(chains, key=lambda c: c["asset_id"]),
        })

    # count desc, then finding id asc — deterministic, no tie jitter.
    ranking.sort(key=lambda c: (-c["chain_count"], c["vulnerability_id"]))
    for i, c in enumerate(ranking, start=1):
        c["rank"] = i
    return ranking


def coverage(db: Session, tenant_id: int) -> Dict[str, int]:
    """Honesty numbers for the view: how many findings the ranking spans out
    of the whole register, and how many carry ANY stored chain at all."""
    from ..models import Vulnerability, ReachabilitySnapshot

    total_findings = db.query(func.count(Vulnerability.id)).filter(
        Vulnerability.tenant_id == tenant_id).scalar() or 0
    findings_with_chains = db.query(
        func.count(func.distinct(ReachabilitySnapshot.vulnerability_id))).filter(
        ReachabilitySnapshot.tenant_id == tenant_id).scalar() or 0
    ranked = len(rank_choke_points(db, tenant_id))
    return {
        "total_findings": total_findings,
        "findings_with_stored_chains": findings_with_chains,
        "findings_ranked": ranked,
    }


def persist_snapshot(db: Session, tenant_id: int, *, triggered_by_user_id: Optional[int] = None) -> Dict[str, Any]:
    """Compute + persist a choke-point snapshot, and stamp first-appearance.

    Snapshot rows are replace-friendly; the `first_seen` side table is NOT —
    it records, first-write-wins, the moment each finding first became
    rankable, marked with the snapshot that first saw it (the structural
    inaugural marker, not a timestamp heuristic). That fact must outlive any
    snapshot pruning, because the prioritized counter is derived from it.
    Caller commits."""
    from ..models import ChokePointSnapshot, ChokePointEntry, ChokePointFirstSeen

    ranking = rank_choke_points(db, tenant_id)
    now = datetime.utcnow()

    # is this the tenant's first ever snapshot? (inaugural backfill marker)
    prior = db.query(func.count(ChokePointSnapshot.id)).filter(
        ChokePointSnapshot.tenant_id == tenant_id).scalar() or 0
    is_inaugural = prior == 0

    snap = ChokePointSnapshot(
        tenant_id=tenant_id, computed_at=now, algorithm_version=ALGORITHM_VERSION,
        finding_count=len(ranking), triggered_by_user_id=triggered_by_user_id,
        is_inaugural=is_inaugural,
    )
    db.add(snap)
    db.flush()

    for c in ranking:
        db.add(ChokePointEntry(
            snapshot_id=snap.id, tenant_id=tenant_id,
            vulnerability_id=c["vulnerability_id"], chain_count=c["chain_count"],
            rank=c["rank"], chains=c["chains"],
        ))
        # first-appearance: first write wins, never updated.
        existing = db.query(ChokePointFirstSeen).filter(
            ChokePointFirstSeen.tenant_id == tenant_id,
            ChokePointFirstSeen.vulnerability_id == c["vulnerability_id"],
        ).first()
        if existing is None:
            db.add(ChokePointFirstSeen(
                tenant_id=tenant_id, vulnerability_id=c["vulnerability_id"],
                first_in_snapshot_at=now, first_snapshot_id=snap.id,
                # backlog stamped by the very first snapshot is backfill, not
                # workflow — carried structurally so a cycle card can decompose
                # "prioritized: X (Y launch backfill)".
                is_inaugural_backfill=is_inaugural,
            ))

    db.flush()
    return {"snapshot_id": snap.id, "computed_at": now.isoformat(),
            "finding_count": len(ranking), "is_inaugural": is_inaugural}


def latest_snapshot(db: Session, tenant_id: int) -> Optional[Dict[str, Any]]:
    """Read the most recent persisted snapshot + its ranked entries (from the
    self-contained rows — no join to reachability)."""
    from ..models import ChokePointSnapshot, ChokePointEntry

    snap = db.query(ChokePointSnapshot).filter(
        ChokePointSnapshot.tenant_id == tenant_id).order_by(
        ChokePointSnapshot.computed_at.desc()).first()
    if snap is None:
        return None
    entries = db.query(ChokePointEntry).filter(
        ChokePointEntry.snapshot_id == snap.id).order_by(ChokePointEntry.rank.asc()).all()
    return {
        "snapshot_id": snap.id,
        "computed_at": snap.computed_at.isoformat() if snap.computed_at else None,
        "algorithm_version": snap.algorithm_version,
        "is_inaugural": snap.is_inaugural,
        "entries": [{
            "vulnerability_id": e.vulnerability_id,
            "chain_count": e.chain_count,
            "rank": e.rank,
            "chains": e.chains or [],
        } for e in entries],
    }
