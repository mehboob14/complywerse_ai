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

ALGORITHM_VERSION = "chokepoint-1.0.0:finding-x-viable-chains"


def is_rankable(chain_count: int) -> bool:
    """A finding is a rankable choke point iff it participates in >=1 viable
    chain. THE pinned predicate — the prioritized-counter event ("finding
    first appears in a snapshot") means "first becomes rankable", nothing
    looser."""
    return chain_count >= 1


def rank_choke_points(db: Session, tenant_id: int,
                      vulnerability_ids: Optional[Any] = None) -> List[Dict[str, Any]]:
    """Pure compute (no writes): the deterministic choke-point ranking for a
    tenant from the latest reachability snapshot per (vuln, asset).

    `vulnerability_ids` (None = whole tenant) restricts the ranking to a slice
    of findings — the CTEM-scope filter. An EMPTY collection means "a scope with
    no findings" → empty ranking (never silently the whole tenant).

    Returns [{vulnerability_id, chain_count, rank,
              chains: [{asset_id, snapshot_id, verdict}]}], rank 1 = highest.
    """
    from ..models import ReachabilitySnapshot
    from ..modules.vuln_management.attack.verdict import is_viable_verdict  # one definition, lazily (circular-safe)

    if vulnerability_ids is not None and not vulnerability_ids:
        return []

    # Latest snapshot per (vuln, asset): max assessed_at, tie-broken by id so
    # it's deterministic even if two share a timestamp.
    q = db.query(
        ReachabilitySnapshot.id,
        ReachabilitySnapshot.vulnerability_id,
        ReachabilitySnapshot.asset_id,
        ReachabilitySnapshot.verdict,
        ReachabilitySnapshot.assessed_at,
    ).filter(ReachabilitySnapshot.tenant_id == tenant_id)
    if vulnerability_ids is not None:
        q = q.filter(ReachabilitySnapshot.vulnerability_id.in_(list(vulnerability_ids)))
    rows = q.all()

    latest: Dict[tuple, Any] = {}
    for r in rows:
        key = (r.vulnerability_id, r.asset_id)
        cur = latest.get(key)
        # newer assessed_at wins; ties broken by higher snapshot id
        if cur is None or (r.assessed_at, r.id) > (cur.assessed_at, cur.id):
            latest[key] = r

    by_finding: Dict[int, List[Dict[str, Any]]] = {}
    for (vuln_id, asset_id), r in latest.items():
        if not is_viable_verdict(r.verdict):
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

    # Primary sort = leverage (how many viable paths fixing this breaks). BUT when
    # several findings break the same number of paths (e.g. all "1 path"), a bare
    # id tie-break is arbitrary — it put a Medium node-tar above a CISA-KEV,
    # actively-exploited High purely because of a lower row id (caught by the UI
    # walkthrough 18 Aug). Break equal leverage by REAL risk signal, most urgent
    # first: KEV (actively exploited) → EPSS (exploit probability) → CVSS/severity
    # → id (only to stay deterministic).
    from ..models import Vulnerability
    _SEV = {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0, "informational": 0}
    sig: Dict[int, tuple] = {}
    if ranking:
        try:
            for v in db.query(Vulnerability.id, Vulnerability.kev_flag, Vulnerability.epss_score,
                              Vulnerability.cvss_score, Vulnerability.severity).filter(
                              Vulnerability.id.in_([c["vulnerability_id"] for c in ranking])).all():
                sig[v.id] = (1 if v.kev_flag else 0, float(v.epss_score or 0.0),
                             float(v.cvss_score or 0.0), _SEV.get((v.severity or "").lower(), 0))
        except Exception:
            # No signal source available (e.g. a snapshot-only test DB) — fall back
            # to the pure leverage + id order. Never fail ranking over a tie-break.
            logger.debug("choke ranking: risk-signal lookup unavailable; id tie-break only")
    def _key(c):
        kev, epss, cvss, sev = sig.get(c["vulnerability_id"], (0, 0.0, 0.0, 0))
        # negate the descending dimensions; id ascending last for a stable order.
        return (-c["chain_count"], -kev, -epss, -cvss, -sev, c["vulnerability_id"])
    ranking.sort(key=_key)
    for i, c in enumerate(ranking, start=1):
        c["rank"] = i
    return ranking


def coverage(db: Session, tenant_id: int,
             vulnerability_ids: Optional[Any] = None) -> Dict[str, int]:
    """Honesty numbers for the view. Names THREE levers on the empty/short state:
    chain GENERATION (findings with no chain at all), and — among findings that
    carry a chain but none currently viable — the TWO reasons that are not one
    lever: SEVERED (we derived the path and every door is blocked — real posture)
    vs UNDETERMINABLE (no CWE/CVSS to derive from — `unlikely` is a data-gap
    default, and enrichment is a lever only when the finding has a CVE to enrich
    from). Collapsing those two frames enrichment as a fix for the severed ones,
    which it is not. total_viable_chains is a legitimate sum — chains are disjoint
    per finding here — while asset counts still must never be summed.

    `vulnerability_ids` (None = whole tenant) restricts every count to a slice of
    findings — the CTEM-scope filter, so a scope card shows only its own numbers.
    An empty collection is a real scope with no findings → all-zero coverage."""
    from ..models import Vulnerability, ReachabilitySnapshot
    from ..modules.vuln_management.attack.selection import is_undeterminable

    scoped = vulnerability_ids is not None
    vset = set(vulnerability_ids) if scoped else None
    if scoped and not vset:
        return {"total_findings": 0, "findings_with_stored_chains": 0,
                "findings_chainless": 0, "findings_ranked": 0,
                "findings_chained_but_unviable": 0, "findings_severed": 0,
                "findings_undeterminable": 0, "total_viable_chains": 0}

    if scoped:
        total_findings = len(vset)
    else:
        total_findings = db.query(func.count(Vulnerability.id)).filter(
            Vulnerability.tenant_id == tenant_id).scalar() or 0

    chain_q = db.query(func.distinct(ReachabilitySnapshot.vulnerability_id)).filter(
        ReachabilitySnapshot.tenant_id == tenant_id)
    if scoped:
        chain_q = chain_q.filter(ReachabilitySnapshot.vulnerability_id.in_(list(vset)))
    chained_ids = {r[0] for r in chain_q.all()}
    findings_with_chains = len(chained_ids)
    ranking = rank_choke_points(db, tenant_id, vulnerability_ids=vset)
    ranked_ids = {c["vulnerability_id"] for c in ranking}
    total_viable_chains = sum(c["chain_count"] for c in ranking)  # disjoint → sums true

    # Split the unviable set (has a chain, none viable) by WHY, using the SAME
    # predicate the live engine uses for assumed_insufficient — no drift. The set
    # is bounded by findings_with_chains (small), so the per-finding re-selection
    # is cheap; is_undeterminable is pure/DB-free.
    unviable_ids = chained_ids - ranked_ids
    findings_undeterminable = 0
    if unviable_ids:
        for v in db.query(Vulnerability).filter(
                Vulnerability.tenant_id == tenant_id,
                Vulnerability.id.in_(unviable_ids)).all():
            if is_undeterminable(getattr(v, "cwe_ids", None) or getattr(v, "cwe_id", None),
                                 getattr(v, "cvss_vector", None)):
                findings_undeterminable += 1
    findings_unviable = len(unviable_ids)
    return {
        "total_findings": total_findings,
        "findings_with_stored_chains": findings_with_chains,
        "findings_chainless": max(total_findings - findings_with_chains, 0),
        "findings_ranked": len(ranking),
        # kept for back-compat (any older consumer); now decomposed by the two below.
        "findings_chained_but_unviable": findings_unviable,
        "findings_severed": findings_unviable - findings_undeterminable,
        "findings_undeterminable": findings_undeterminable,
        "total_viable_chains": total_viable_chains,
    }


def persist_snapshot(db: Session, tenant_id: int, *, triggered_by_user_id: Optional[int] = None,
                     stamp_first_seen: bool = True) -> Dict[str, Any]:
    """Compute + persist a choke-point snapshot, and stamp first-appearance.

    Snapshot rows are replace-friendly; the `first_seen` side table is NOT —
    it records, first-write-wins, the moment each finding first became
    rankable, marked with the snapshot that first saw it (the structural
    inaugural marker, not a timestamp heuristic). That fact must outlive any
    snapshot pruning, because the prioritized counter is derived from it.
    Caller commits.

    `stamp_first_seen=False` computes + persists the snapshot WITHOUT touching
    the append-only first_seen table — the mandatory setting for synthetic
    verification, so a live check that injects fake chains can never leave a
    permanent false first-appearance behind (the day a real chain makes that
    finding rankable, its prioritized event would predate reality). Production
    paths (sync, recompute endpoint) always stamp."""
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
        if not stamp_first_seen:
            continue
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
