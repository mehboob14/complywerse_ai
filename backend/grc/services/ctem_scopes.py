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

    # PRIORITIZED (Phase 4 filled the seam Phase 3 left open): a finding's
    # event is "first became a rankable choke point in-window", read from the
    # durable first_seen fact (never the replaceable snapshot). Decomposed:
    # in_window is real workflow; launch_backfill is the one-time inaugural
    # stamp, surfaced separately so a cycle spanning launch doesn't read a
    # backfill spike as prioritization. Only present once a snapshot exists.
    try:
        from ..models import ChokePointFirstSeen
        fq = db.query(
            func.count(ChokePointFirstSeen.id),
            func.count(ChokePointFirstSeen.id).filter(
                ChokePointFirstSeen.is_inaugural_backfill.is_(True)),
        ).filter(
            ChokePointFirstSeen.tenant_id == tenant_id,
            ChokePointFirstSeen.vulnerability_id.in_(vuln_ids),
        )
        if since is not None:
            fq = fq.filter(ChokePointFirstSeen.first_in_snapshot_at >= since)
        if until is not None:
            fq = fq.filter(ChokePointFirstSeen.first_in_snapshot_at < until)
        total_prio, backfill = fq.one()
        total_prio = total_prio or 0
        backfill = backfill or 0
        out["prioritized"] = total_prio
        out["prioritized_in_window"] = total_prio - backfill
        out["prioritized_launch_backfill"] = backfill
    except Exception:
        # No choke-point snapshot yet → the counter stays absent (the honest
        # "seam still open" state), never a fake zero that reads as measured.
        logger.debug("prioritized counter unavailable (no choke-point data yet)")

    return out


def freeze_cycle(db: Session, cycle) -> None:
    """Populate a cycle's frozen fields at close: live counts + the rule
    as-of-now + the membership hash + the algorithm string. Caller commits."""
    from ..models import CtemScope

    scope = db.query(CtemScope).filter(CtemScope.id == cycle.scope_id).first()
    rule = (scope.membership_rule if scope else None) or {}
    asset_ids = resolve_scope_assets(db, cycle.tenant_id, rule)
    counts = compute_stage_counts(
        db, cycle.tenant_id, asset_ids, since=cycle.opened_at, until=datetime.utcnow(),
    )
    # ALSO freeze the STATE totals (not just the since-opened activity), so a
    # later cycle can be compared honestly: "we had N findings / M ticketed at
    # close". Additive keys — older freezes without them are simply skipped by
    # the trend builder, never read as 0.
    try:
        from ..models import VulnTicketLink
        vuln_ids = _vuln_ids_for_assets(db, cycle.tenant_id, asset_ids)
        counts["discovered_total"] = len(vuln_ids)
        counts["mobilized_total"] = (db.query(func.count(VulnTicketLink.id)).filter(
            VulnTicketLink.tenant_id == cycle.tenant_id,
            VulnTicketLink.vulnerability_id.in_(vuln_ids),
            VulnTicketLink.external_ticket_id.isnot(None),
        ).scalar() or 0) if vuln_ids else 0
    except Exception:
        logger.exception("freeze_cycle: total counters failed (non-fatal)")
    cycle.counts = counts
    cycle.membership_rule_frozen = rule
    cycle.membership_hash = membership_hash(asset_ids)
    cycle.hash_algorithm = HASH_ALGORITHM


# ─────────────────────────────────────────────────────────────────────────────
# CTEM command center — one per-scope rollup of the whole loop's downstream
# signals (the four cards below the counters). Each card REUSES the service that
# owns that stage, filtered to this scope's findings via the one resolver — no
# number is re-derived here. The money card is the honest exception: risk
# quantification links to risks (risk_id), never to a CTEM scope or asset, so a
# per-scope dollar figure is not derivable — it shows the PORTFOLIO run, labelled
# as such, rather than faking a scoped number.
# ─────────────────────────────────────────────────────────────────────────────
def command_center(db: Session, tenant_id: int, scope) -> Dict[str, Any]:
    from ..models import ITAsset
    asset_ids = resolve_scope_assets(db, tenant_id, scope.membership_rule)
    vuln_ids = _vuln_ids_for_assets(db, tenant_id, asset_ids)
    # The machines themselves — named, so the scope is never a faceless count.
    machines = [
        {"id": a.id, "name": a.name, "host_name": a.host_name, "asset_type": a.asset_type}
        for a in db.query(ITAsset.id, ITAsset.name, ITAsset.host_name, ITAsset.asset_type)
        .filter(ITAsset.id.in_(asset_ids)).order_by(ITAsset.name.asc()).all()
    ] if asset_ids else []
    return {
        "member_assets": len(asset_ids),
        "machines": machines,
        "scope_findings": len(vuln_ids),
        "prioritise": _cc_prioritise(db, tenant_id, vuln_ids),
        "validate": _cc_validate(db, tenant_id, vuln_ids),
        "mobilise": _cc_mobilise(db, tenant_id, vuln_ids),
        "quantify": _cc_quantify(db, tenant_id),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Portfolio view — the redesigned page's data contract, for ALL scopes in one
# call (no N+1 from the browser). Shape mirrors the design handoff's `Scope`
# interface exactly, built ONLY from the proven services above. Where the
# design assumes data that has no real source (per-scope FAIR money, scope
# owner name), the field is returned null/empty and the UI renders an honest
# empty state — never an invented number.
# ─────────────────────────────────────────────────────────────────────────────
def _membership_label(rule: Optional[Dict[str, Any]]) -> str:
    rule = rule or {}
    parts = []
    if rule.get("name_contains"):
        parts.append(f'name contains "{rule["name_contains"]}"')
    if rule.get("departments"):
        parts.append("dept in " + ", ".join(rule["departments"]))
    if rule.get("asset_types"):
        parts.append("type in " + ", ".join(rule["asset_types"]))
    if rule.get("asset_ids"):
        parts.append(f'{len(rule["asset_ids"])} named asset(s)')
    return " AND ".join(parts) or "no rule"


def portfolio(db: Session, tenant_id: int) -> Dict[str, Any]:
    from ..models import CtemScope, CtemCycle, GRCUser, Vulnerability, ITAsset, VulnerabilityAssetLink
    from .choke_points import rank_choke_points

    scopes = db.query(CtemScope).filter(CtemScope.tenant_id == tenant_id).order_by(CtemScope.created_at.asc()).all()
    now = datetime.utcnow()
    out: List[Dict[str, Any]] = []
    for s in scopes:
        cc = command_center(db, tenant_id, s)
        asset_ids = [m["id"] for m in cc["machines"]]
        vuln_ids = _vuln_ids_for_assets(db, tenant_id, asset_ids)
        cov = cc["prioritise"]["coverage"]
        tiers = cc["validate"]["tiers"]
        mob = cc["mobilise"]

        # cycles: open one + closed history (frozen counts drive trend/deltas)
        cycles = sorted(s.cycles, key=lambda c: c.opened_at or datetime.min)
        open_c = next((c for c in cycles if c.status == "open"), None)
        closed = [c for c in cycles if c.status == "closed" and c.counts]
        cycle_no = len(cycles)
        cycle_day = (now - open_c.opened_at).days if open_c and open_c.opened_at else None
        last_closed = closed[-1].closed_at.strftime("%d %b %Y") if closed and closed[-1].closed_at else None
        # trend + deltas from CLOSED cycles' frozen counts, then the live point.
        # HONESTY: `discovered`/`validated`/`mobilized` in a frozen payload are
        # "since the cycle opened" ACTIVITY counters, not totals — using them as
        # a trend point painted a false 0 (found live). Only `prioritized` is a
        # true state count. So the dangerous trend uses frozen `prioritized`
        # (real); the findings trend uses `discovered_total` only if a freeze
        # recorded it, else that point is OMITTED rather than faked. prev_*
        # deltas follow the same rule (None = "no comparable freeze").
        def _tot(c, key):
            v = (c.counts or {}).get(key)
            return int(v) if v is not None else None
        t_find = [x for x in (_tot(c, "discovered_total") for c in closed[-4:]) if x is not None] + [cc["scope_findings"]]
        t_dang = [x for x in (_tot(c, "prioritized") for c in closed[-4:]) if x is not None] + [cov["findings_ranked"]]
        last = closed[-1] if closed else None
        prev_find = _tot(last, "discovered_total") if last else None
        prev_dang = _tot(last, "prioritized") if last else None
        prev_mob = _tot(last, "mobilized_total") if last else None

        # owner (real user if set; else null → UI shows "unassigned")
        owner = None
        if s.business_owner_id:
            u = db.query(GRCUser).get(s.business_owner_id)
            if u:
                owner = getattr(u, "full_name", None) or getattr(u, "name", None) or getattr(u, "email", None)

        # top dangerous findings: choke ranking hydrated with finding meta (+ real owner/SLA)
        rank = rank_choke_points(db, tenant_id, vulnerability_ids=vuln_ids)[:5]
        top: List[Dict[str, Any]] = []
        if rank:
            meta = {v.id: v for v in db.query(Vulnerability).filter(Vulnerability.id.in_([r["vulnerability_id"] for r in rank])).all()}
            uid = {v.assigned_to for v in meta.values() if v.assigned_to}
            users = {u.id: u for u in db.query(GRCUser).filter(GRCUser.id.in_(uid)).all()} if uid else {}
            for r in rank:
                v = meta.get(r["vulnerability_id"])
                if not v:
                    continue
                sla = None
                if v.due_date:
                    d = (v.due_date - now).days
                    sla = f"overdue {abs(d)}d" if d < 0 else f"{d}d left"
                ou = users.get(v.assigned_to) if v.assigned_to else None
                top.append({
                    "id": v.id, "rank": r["rank"], "title": v.title,
                    "meta": " · ".join(x for x in [v.cve_id or v.cwe_id, (cc["machines"][0]["name"] if cc["machines"] else None)] if x),
                    "breaks": f'{r["chain_count"]} path{"s" if r["chain_count"] != 1 else ""}',
                    "owner": (getattr(ou, "full_name", None) or getattr(ou, "email", None)) if ou else None,
                    "sla": sla, "sev": (v.severity or "low").lower(),
                })

        # machines with findings count + worst reachable verdict as the risk dot
        per_asset_findings: Dict[int, int] = {}
        if asset_ids:
            for aid, n in db.query(VulnerabilityAssetLink.asset_id, func.count(VulnerabilityAssetLink.id)).filter(
                    VulnerabilityAssetLink.asset_id.in_(asset_ids)).group_by(VulnerabilityAssetLink.asset_id).all():
                per_asset_findings[aid] = n
        machines = [{"id": m["id"], "name": m["name"], "type": m.get("asset_type") or "asset",
                     "findings": per_asset_findings.get(m["id"], 0), "risk": None} for m in cc["machines"]]

        # frameworks with tested count from the crosswalk items
        fw: Dict[str, Dict[str, int]] = {}
        for it in cc["validate"].get("items", []):
            f = fw.setdefault(it["framework"], {"controls": 0, "tested": 0})
            f["controls"] += 1
            if it["tier"] in ("tested_effective", "tested_failed", "remediation_verified"):
                f["tested"] += 1
        tier_map = {"tested_effective": "tested", "tested_failed": "failed", "remediation_verified": "verified"}
        cw = [{"fw": it["framework"], "code": it["code"], "title": it["title"], "findings": it["findings_covered"],
               "tier": tier_map.get(it["tier"], "claimed"), "control_id": it["id"], "kind": it["kind"]}
              for it in cc["validate"].get("items", [])]

        out.append({
            "id": s.id, "name": s.name, "owner": owner, "cadence": s.cadence or "—",
            "membership": _membership_label(s.membership_rule),
            "cycleOpen": open_c is not None, "cycleId": open_c.id if open_c else None,
            "cycleNo": cycle_no, "cycleDay": cycle_day, "lastClosed": last_closed,
            "assets": len(asset_ids), "findings": cc["scope_findings"],
            "dangerous": cov["findings_ranked"], "chains": cov["total_viable_chains"],
            "controls": cc["validate"]["controls"],
            "tested": tiers.get("tested_effective", 0), "failed": tiers.get("tested_failed", 0),
            "verified": tiers.get("remediation_verified", 0), "claimed": tiers.get("attested_only", 0) + tiers.get("stale", 0),
            "fixes": mob.get("tickets", 0), "fixesOpen": mob.get("open", 0), "fixesResolved": mob.get("resolved", 0),
            # per-scope FAIR has no real source (risks aren't scope-linked) → null, honestly
            "ale": None, "aleMin": None, "p95": None, "aleAfter": None,
            "buckets": {"ranked": cov["findings_ranked"], "undeterminable": cov["findings_undeterminable"],
                        "chainless": cov["findings_chainless"], "severed": cov["findings_severed"]},
            "analysable": cc["prioritise"].get("analysable"),
            "frameworks": [{"name": k, **v} for k, v in fw.items()],
            "machines": machines, "top": top,
            "tFind": t_find, "tDang": t_dang, "prevFind": prev_find, "prevDang": prev_dang, "prevMob": prev_mob,
            "cw": cw,
        })
    return {"scopes": out, "quantify": _cc_quantify(db, tenant_id)}


def _cc_prioritise(db: Session, tenant_id: int, vuln_ids: List[int]) -> Dict[str, Any]:
    """Prioritise for the scope — plus the HONEST split the engine's inputs
    force: a finding with no CVE/CWE/vector (a Nessus "info" item — a banner,
    a service detection) carries nothing an attack-path engine can reason
    from. Reporting "215 analysed" when 181 are informational would overclaim;
    the card must say "N real vulnerabilities, M informational"."""
    from ..models import Vulnerability
    from .choke_points import coverage, rank_choke_points
    cov = coverage(db, tenant_id, vulnerability_ids=vuln_ids)
    top = [{"vulnerability_id": c["vulnerability_id"], "chain_count": c["chain_count"]}
           for c in rank_choke_points(db, tenant_id, vulnerability_ids=vuln_ids)[:3]]
    real = informational = 0
    if vuln_ids:
        for cve, cwe, vec in db.query(
                Vulnerability.cve_id, Vulnerability.cwe_id, Vulnerability.cvss_vector).filter(
                Vulnerability.id.in_(vuln_ids)).all():
            if (cve or "").strip() or (cwe or "").strip() or (vec or "").strip():
                real += 1
            else:
                informational += 1
    return {"coverage": cov, "top": top,
            "analysable": {"real_vulnerabilities": real, "informational": informational}}


def _cc_validate(db: Session, tenant_id: int, vuln_ids: List[int]) -> Dict[str, Any]:
    """Controls covering THIS scope's findings, and how many are actually tested.
    Scope→control map = scope findings → their control links; tiers come from the
    same read-time deriver the assurance page uses (no stored badge).

    Returns the controls LISTED (code, title, framework, tier, how many of the
    scope's findings each covers), not just counted — the user must be able to
    see the crosswalk ("ISO 27001 A.8.8, NIST RA-5 …"), not a bare "60"."""
    from ..models import VulnerabilityControlLink, ParsedFrameworkControl, UploadedFramework
    from .control_assurance import _ref_key, tier_for_ref
    if not vuln_ids:
        return {"controls": 0, "tiers": {}, "items": [], "by_framework": {}}
    refs: Dict[tuple, int] = {}          # (kind, id) → number of scope findings it covers
    for link in db.query(VulnerabilityControlLink).filter(
            VulnerabilityControlLink.vulnerability_id.in_(vuln_ids)).all():
        k = _ref_key(link)
        if k:
            refs[k] = refs.get(k, 0) + 1
    tiers: Dict[str, int] = {}
    tier_of: Dict[tuple, str] = {}
    for kind, cid in refs:
        t = tier_for_ref(db, tenant_id, kind, cid)["tier"]
        tiers[t] = tiers.get(t, 0) + 1
        tier_of[(kind, cid)] = t

    # Name the parsed-framework controls (the path the CWE crosswalk writes to).
    parsed_ids = [cid for (kind, cid) in refs if kind == "parsed_framework_control"]
    items: List[Dict[str, Any]] = []
    if parsed_ids:
        rows = db.query(
            ParsedFrameworkControl.id, ParsedFrameworkControl.control_id,
            ParsedFrameworkControl.title, UploadedFramework.name,
        ).outerjoin(UploadedFramework, UploadedFramework.id == ParsedFrameworkControl.uploaded_framework_id
        ).filter(ParsedFrameworkControl.id.in_(parsed_ids)).all()
        for r in rows:
            k = ("parsed_framework_control", r.id)
            items.append({
                "id": r.id, "kind": "parsed_framework_control", "code": r.control_id,
                "title": r.title, "framework": r.name or "—",
                "tier": tier_of.get(k, "attested_only"), "findings_covered": refs.get(k, 0),
            })
    # Any non-parsed refs (internal/framework/normalized) still count; name them minimally.
    for (kind, cid), n in refs.items():
        if kind != "parsed_framework_control":
            items.append({"id": cid, "kind": kind, "code": f"#{cid}", "title": kind.replace("_", " "),
                          "framework": "—", "tier": tier_of[(kind, cid)], "findings_covered": n})
    items.sort(key=lambda i: (-i["findings_covered"], i["framework"], i["code"]))
    by_framework: Dict[str, int] = {}
    for i in items:
        by_framework[i["framework"]] = by_framework.get(i["framework"], 0) + 1
    return {"controls": len(refs), "tiers": tiers, "items": items, "by_framework": by_framework}


def _cc_mobilise(db: Session, tenant_id: int, vuln_ids: List[int]) -> Dict[str, Any]:
    from ..models import VulnTicketLink
    if not vuln_ids:
        return {"tickets": 0, "open": 0, "resolved": 0, "plans_applied": 0}
    links = db.query(VulnTicketLink).filter(
        VulnTicketLink.tenant_id == tenant_id,
        VulnTicketLink.vulnerability_id.in_(vuln_ids),
        VulnTicketLink.external_ticket_id.isnot(None),
    ).all()
    resolved = sum(1 for l in links if l.resolved_at is not None)
    return {
        "tickets": len(links),
        "open": len(links) - resolved,
        "resolved": resolved,
        "plans_applied": sum(1 for l in links if l.plan_advanced_at is not None),
    }


def _cc_quantify(db: Session, tenant_id: int) -> Optional[Dict[str, Any]]:
    """Latest COMPLETED portfolio simulation — labelled portfolio, NOT scope.
    Risk quantification links to risks, never to a CTEM scope or asset, so there
    is no honest per-scope dollar figure; the portfolio number, clearly labelled,
    is the closest true thing."""
    from ..models import RiskSimulationRun, Risk
    run = db.query(RiskSimulationRun).filter(
        RiskSimulationRun.tenant_id == tenant_id,
        RiskSimulationRun.scope == "portfolio",
        RiskSimulationRun.status == "completed",
    ).order_by(RiskSimulationRun.created_at.desc()).first()
    if run is None:
        return None
    # HARD RULE: never present a figure computed from sample data as the user's
    # own. If every risk in the register is a [DEMO] seed, the run is a real
    # Monte Carlo on fake inputs — say so, and don't hand the UI a headline
    # number to display as real.
    total = db.query(func.count(Risk.id)).filter(Risk.tenant_id == tenant_id).scalar() or 0
    demo = db.query(func.count(Risk.id)).filter(
        Risk.tenant_id == tenant_id, Risk.title.like("[DEMO]%")).scalar() or 0
    demo_only = total > 0 and demo == total
    return {"scope": "portfolio", "ale": run.ale_mean, "p95": run.p95,
            "currency": run.currency,
            "computed_at": run.created_at.isoformat() if run.created_at else None,
            "risks_total": total, "risks_demo": demo, "demo_only": demo_only}
