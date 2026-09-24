"""The regulator and board pack, generated from records third-party risk already keeps.

Three reports:

* the committee pack for a period: the portfolio by tier and residual risk,
  coverage and what is overdue, the programme's own measures, concentration,
  incidents, how old the open findings are, and the decisions taken;
* the register: the critical or important functions and the vendors behind them,
  and each contractual obligation mapped to the requirements of the frameworks
  the tenant has put in scope;
* a vendor's evidence file: assessments, questionnaires and answers, evidence,
  findings, decisions and alerts.

A report is frozen when it is generated, so what a committee or an examiner saw
stays on record. Its content is headline figures and tables, so one renderer
draws every kind. Once approved it can be shared with an examiner through a link
that needs no login; only the token's hash is kept, and every view is audited.

Cycle time runs from an assessment's start to its decision. The wait for a
decision starts when the assessment entered the approval stage, which is kept
apart from the moment it was decided. Obligations reach the frameworks through
the SCF crosswalk and name requirements by their codes only.
"""
from __future__ import annotations

import hashlib
import json
import secrets
import statistics
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from ....models import (
    BcmBiaDependency, BcmBiaRecord, BcmPlan, Evidence, GRCUser, SCFControl, SCFMapping, SCFScope,
    TPRAApproval, TPRAAuditLog, TPRAContract, TPRAControlObligation, TPRAEvidenceLink, TPRAFinding,
    TPRAFourthParty, TPRAMonitoringSignal, TPRARemediation, TPRAReport, TPRARiskAcceptance,
    TPRAStageInstance, TPRAVendorLink, Vendor, VendorAssessment, VendorIncident,
    VendorQuestionnaireResponse, VendorQuestionnaireTemplate, get_db,
)
from ....routers.auth_router import require_auth
from . import graph, portal, rbac
from .attention import _names
from .engine_scoring import answer_score
from .service import write_audit
from .versions import questions_for

KINDS = {"committee_pack": "Committee pack", "register": "Register of functions and obligations",
         "vendor_file": "Vendor evidence file"}
LEVELS = ("critical", "high", "medium", "low")
MEASURES = {
    "cycle": "Assessment cycle: start to decision",
    "decision_wait": "Waiting for a decision: submitted to decided",
    "questionnaire_turnaround": "Questionnaire turnaround: sent to submitted",
    "review": "Questionnaire review: submitted to accepted",
    "remediation": "Time to remediate: finding raised to fix completed",
}
STATE_LABEL = {"in_date": "In date", "overdue": "Overdue", "never": "Never approved"}
SHARE_MAX_DAYS = 30
SCF_NOTE = ("Control identifiers and the crosswalk are from the Secure Controls Framework (SCF), "
            "licensed CC BY-ND 4.0. Requirements are named by their codes.")
_OPEN = ("open", "in_progress", "in_remediation")
_APPROVED = ("approve", "approve_with_conditions")
_AGES = (("0 to 30 days", 30), ("31 to 60 days", 60), ("61 to 90 days", 90), ("Over 90 days", None))


# ── Periods and small helpers ────────────────────────────────────────────────

def quarter_of(d: date) -> Tuple[date, date]:
    start = date(d.year, 3 * ((d.month - 1) // 3) + 1, 1)
    after = date(start.year + (start.month == 10), (start.month + 2) % 12 + 1, 1)
    return start, after - timedelta(days=1)


def last_quarter(today: date) -> Tuple[date, date]:
    return quarter_of(quarter_of(today)[0] - timedelta(days=1))


def period_label(start: date, end: date) -> str:
    if quarter_of(start) == (start, end):
        return f"Q{(start.month - 1) // 3 + 1} {start.year}"
    return f"{start:%d %b %Y} to {end:%d %b %Y}"


def _span(start: date, end: date) -> Tuple[datetime, datetime]:
    return datetime.combine(start, datetime.min.time()), datetime.combine(end + timedelta(days=1), datetime.min.time())


def _days(a: Optional[datetime], b: Optional[datetime]) -> Optional[float]:
    return (b - a).total_seconds() / 86400 if a and b and b >= a else None


def _d(value) -> Optional[str]:
    if value is None:
        return None
    return (value.date() if isinstance(value, datetime) else value).isoformat()


def _title(value: Optional[str]) -> Optional[str]:
    return value.replace("_", " ").capitalize() if value else None


def _table(key: str, title: str, columns: List[str], rows: List[list], note: Optional[str] = None) -> dict:
    return {"key": key, "title": title, "note": note, "columns": columns, "rows": rows}


def _vendors(db: Session, tenant_id: int) -> List[Vendor]:
    return [v for v in db.query(Vendor).filter(Vendor.tenant_id == tenant_id, Vendor.deleted_at.is_(None)).order_by(Vendor.name)
            if (v.status or "active").lower() not in graph._INACTIVE]


def _tier(v: Vendor) -> str:
    return (v.tier or "unset").lower()


# ── Programme measures ───────────────────────────────────────────────────────

def coverage(db: Session, tenant_id: int, today: date, vendors: Optional[List[Vendor]] = None) -> dict:
    """Each vendor in use is in date (approved, review not yet due), overdue (review
    date passed) or never approved."""
    vendors = _vendors(db, tenant_id) if vendors is None else vendors
    approved = {vid for (vid,) in db.query(TPRAApproval.vendor_id).filter(
        TPRAApproval.tenant_id == tenant_id, TPRAApproval.decision.in_(_APPROVED))}
    states = {}
    for v in vendors:
        due = v.next_reassessment_date.date() if v.next_reassessment_date else None
        states[v.id] = "overdue" if due and due < today else ("in_date" if v.id in approved else "never")
    n, c = len(vendors), Counter(states.values())
    return {"states": states, "active": n, "in_date": c["in_date"], "overdue": c["overdue"], "never": c["never"],
            "coverage_pct": round(100 * c["in_date"] / n, 1) if n else None,
            "overdue_pct": round(100 * c["overdue"] / n, 1) if n else None}


def measures(db: Session, tenant_id: int, start: date, end: date) -> Dict[str, dict]:
    """Median days for each measure over cases that finished in the period, and how many."""
    lo, hi = _span(start, end)
    cycle, wait = [], []
    for stage, begun in (db.query(TPRAStageInstance, VendorAssessment.created_at)
                         .join(VendorAssessment, VendorAssessment.id == TPRAStageInstance.assessment_id)
                         .filter(TPRAStageInstance.tenant_id == tenant_id, TPRAStageInstance.stage_key == "approval",
                                 TPRAStageInstance.completed_at >= lo, TPRAStageInstance.completed_at < hi)):
        cycle.append(_days(begun, stage.completed_at))
        wait.append(_days(stage.started_at, stage.completed_at))
    qr = VendorQuestionnaireResponse
    turnaround = [_days(q.created_at, q.submitted_at) for q in db.query(qr).filter(
        qr.tenant_id == tenant_id, qr.submitted_at >= lo, qr.submitted_at < hi)]
    review = [_days(q.submitted_at, q.accepted_at) for q in db.query(qr).filter(
        qr.tenant_id == tenant_id, qr.accepted_at >= lo, qr.accepted_at < hi)]
    fixed: Dict[int, float] = {}
    for rem, finding in (db.query(TPRARemediation, TPRAFinding).join(TPRAFinding, TPRAFinding.id == TPRARemediation.finding_id)
                         .filter(TPRARemediation.tenant_id == tenant_id, TPRARemediation.deleted_at.is_(None),
                                 TPRARemediation.status == "completed",
                                 TPRARemediation.completed_at >= lo, TPRARemediation.completed_at < hi)):
        took = _days(finding.created_at, rem.completed_at)
        if took is not None:
            fixed[finding.id] = min(took, fixed.get(finding.id, took))

    def summary(values) -> dict:
        xs = [x for x in values if x is not None]
        return {"median_days": round(statistics.median(xs), 1) if xs else None, "count": len(xs)}

    return {"cycle": summary(cycle), "decision_wait": summary(wait), "questionnaire_turnaround": summary(turnaround),
            "review": summary(review), "remediation": summary(fixed.values())}


def write_snapshot(db: Session, tenant_id: int, today: Optional[date] = None) -> int:
    """Today's coverage and 90-day measures into the metric snapshot table, so a
    trend costs one read. Called by the daily third-party risk snapshot job."""
    from ....services import metric_snapshots as ms

    today = today or date.today()
    ms.ensure_table(db)
    written = 0
    cov = coverage(db, tenant_id, today)
    for key in ("coverage_pct", "overdue_pct"):
        if cov[key] is not None:
            ms.upsert(db, tenant_id, f"tprm_{key}", today, cov[key], meta={"active": cov["active"]})
            written += 1
    for key, m in measures(db, tenant_id, today - timedelta(days=89), today).items():
        if m["median_days"] is not None:
            ms.upsert(db, tenant_id, f"tprm_{key}_days", today, m["median_days"], meta={"count": m["count"], "window_days": 90})
            written += 1
    db.commit()
    return written


def trends(db: Session, tenant_id: int, days: int) -> Dict[str, List[dict]]:
    from ....services.metric_snapshots import read_trend

    keys = ["tprm_coverage_pct", "tprm_overdue_pct"] + [f"tprm_{k}_days" for k in MEASURES]
    return {k: read_trend(db, [tenant_id], k, days) for k in keys}


# ── The register ─────────────────────────────────────────────────────────────

def functions(db: Session, tenant_id: int, today: date, vendors: Optional[List[Vendor]] = None) -> List[dict]:
    """Each continuity process with the vendors behind it: linked on the vendor's
    Dependencies tab, or named as a vendor dependency in the business impact analysis."""
    vendors = _vendors(db, tenant_id) if vendors is None else vendors
    by_id = {v.id: v for v in vendors}
    aliases = graph.tenant_aliases(db, tenant_id)
    keys = [(v.id, graph.normalise(v.name), graph.platform_for(v.name, aliases).lower()) for v in vendors]
    behind: Dict[int, Dict[int, Optional[str]]] = defaultdict(dict)
    for ln in db.query(TPRAVendorLink).filter(TPRAVendorLink.tenant_id == tenant_id, TPRAVendorLink.target_type == "bia_process"):
        if ln.vendor_id in by_id:
            behind[ln.target_id][ln.vendor_id] = None
    for dep in db.query(BcmBiaDependency).filter(BcmBiaDependency.tenant_id == tenant_id,
                                                 BcmBiaDependency.dependency_type == "vendor"):
        # ponytail: every dependency against every vendor; index by normalised name past a few thousand of each
        for vid, key, platform in keys:
            if graph._same(dep.name, key, platform, aliases):
                behind[dep.bia_id][vid] = dep.external_bcp_status
    if not behind:
        return []
    states = coverage(db, tenant_id, today, vendors)["states"]
    approved = dict(db.query(TPRAApproval.vendor_id, func.max(TPRAApproval.created_at)).filter(
        TPRAApproval.tenant_id == tenant_id, TPRAApproval.decision.in_(_APPROVED)).group_by(TPRAApproval.vendor_id))
    fourth = Counter(vid for (vid,) in db.query(TPRAFourthParty.vendor_id).filter(
        TPRAFourthParty.tenant_id == tenant_id, TPRAFourthParty.deleted_at.is_(None)))
    out = []
    for bia, plan in (db.query(BcmBiaRecord, BcmPlan).outerjoin(BcmPlan, BcmPlan.id == BcmBiaRecord.plan_id)
                      .filter(BcmBiaRecord.tenant_id == tenant_id, BcmBiaRecord.id.in_(list(behind)))):
        crit = (bia.criticality_rating or "medium").lower()
        for vid, bcp in behind[bia.id].items():
            v = by_id[vid]
            out.append({"function": bia.process_name, "plan": plan.title if plan else None, "criticality": crit,
                        "critical_or_important": crit in ("critical", "high"),
                        "rto_hours": bia.rto_hours, "rpo_hours": bia.rpo_hours, "vendor_id": v.id, "vendor": v.name,
                        "tier": v.tier, "rating": v.risk_rating, "approved": approved.get(v.id),
                        "next_review": v.next_reassessment_date, "state": states[v.id], "vendor_bcp": bcp,
                        "fourth_parties": fourth[v.id]})
    rank = {c: i for i, c in enumerate(LEVELS)}
    out.sort(key=lambda r: (rank.get(r["criticality"], 9), r["rto_hours"] is None, r["rto_hours"] or 0,
                            r["function"], r["vendor"]))
    return out


def obligations(db: Session, tenant_id: int) -> Tuple[List[dict], List[dict]]:
    """Each contractual obligation, the SCF controls its reference resolves to (an SCF
    id, or a requirement code the crosswalk knows), and the requirements those
    controls meet in the frameworks in scope. Reuses the automation module's
    crosswalk reading, so reviewer suppressions and retargets apply here too."""
    from ...automation.router import (
        _effective_mapping_scf, _mapping_reviews, _published_scope_codes, _scope_frameworks,
    )
    from ...scf.registry import label_for_slug
    from ...scf.scope_service import _current_ready_release

    rows = (db.query(TPRAControlObligation, TPRAContract, Vendor)
            .join(TPRAContract, TPRAContract.id == TPRAControlObligation.contract_id)
            .join(Vendor, Vendor.id == TPRAContract.vendor_id)
            .filter(TPRAControlObligation.tenant_id == tenant_id, TPRAControlObligation.deleted_at.is_(None),
                    TPRAContract.deleted_at.is_(None), Vendor.deleted_at.is_(None))
            .order_by(Vendor.name, TPRAControlObligation.id).all())
    scope = db.query(SCFScope).filter(SCFScope.tenant_id == tenant_id, SCFScope.is_default.is_(True)).first()
    frameworks = _scope_frameworks(scope)
    slugs = [f["key"] for f in frameworks]
    label = {f["key"]: f["label"] for f in frameworks}
    release = _current_ready_release(db)
    refs = {(o.control_ref or "").strip() for o, _, _ in rows} - {""}
    to_scf: Dict[str, set] = defaultdict(set)
    codes: Dict[str, Dict[str, set]] = defaultdict(lambda: defaultdict(set))
    if release is not None and refs:
        suppressed, retargets = _mapping_reviews(db, tenant_id)
        variants = {**{r: r for r in refs}, **{r.upper(): r for r in refs}}
        for (scf_id,) in db.query(SCFControl.scf_id).filter(SCFControl.release_id == release.id,
                                                            SCFControl.scf_id.in_(list(variants))):
            to_scf[variants[scf_id]].add(scf_id)
        direct = set(to_scf)   # a reference that is an SCF id is not also read as a requirement code
        for scf_id, slug, code in db.query(SCFMapping.scf_id, SCFMapping.source_slug, SCFMapping.requirement_code).filter(
                SCFMapping.release_id == release.id, SCFMapping.requirement_code.in_(list(variants))):
            owner = _effective_mapping_scf(slug, code, scf_id, suppressed, retargets)
            if owner and variants[code] not in direct:
                to_scf[variants[code]].add(owner)
        wanted = set().union(*to_scf.values()) if to_scf else set()
        if wanted:
            q = db.query(SCFMapping.scf_id, SCFMapping.source_slug, SCFMapping.requirement_code).filter(
                SCFMapping.release_id == release.id, SCFMapping.provenance.in_(("resolver", "ai")))
            if slugs:
                q = q.filter(SCFMapping.source_slug.in_(slugs))
            for scf_id, slug, code in q:
                owner = _effective_mapping_scf(slug, code, scf_id, suppressed, retargets)
                if owner in wanted:
                    codes[owner][slug].add(code)
            if slugs:
                published = _published_scope_codes(db, release.id, slugs, suppressed, retargets)
                for scf_id in wanted:
                    for slug, cs in (published.get(scf_id) or {}).items():
                        codes[scf_id][slug].update(cs)
    out = []
    for o, contract, v in rows:
        ref = (o.control_ref or "").strip()
        ids = sorted(to_scf.get(ref, ()))
        maps: Dict[str, set] = defaultdict(set)
        for scf_id in ids:
            for slug, cs in codes[scf_id].items():
                maps[label.get(slug) or label_for_slug(slug)] |= cs
        out.append({"vendor_id": v.id, "vendor": v.name, "contract": contract.title or _title(contract.contract_type),
                    "obligation": o.obligation, "control_ref": ref or None, "status": o.status, "scf_ids": ids,
                    "regimes": {k: sorted(cs) for k, cs in sorted(maps.items())}})
    return out, frameworks


def register(db: Session, tenant_id: int, today: date) -> dict:
    funcs = functions(db, tenant_id, today)
    obls, frameworks = obligations(db, tenant_id)
    cif = [f for f in funcs if f["critical_or_important"]]
    func_rows = [[f["function"], "Yes" if f["critical_or_important"] else "No", _title(f["criticality"]), f["rto_hours"],
                  f["rpo_hours"], f["vendor"], _title(f["tier"]), _title(f["rating"]), _d(f["approved"]), _d(f["next_review"]),
                  STATE_LABEL[f["state"]], _title(f["vendor_bcp"]), f["fourth_parties"]] for f in funcs]
    obl_rows = [[o["vendor"], o["contract"], o["obligation"], o["control_ref"], ", ".join(o["scf_ids"]) or None,
                 "\n".join(f"{k}: {', '.join(cs)}" for k, cs in o["regimes"].items()) or None, _title(o["status"])]
                for o in obls]
    per_regime: Dict[str, List[set]] = defaultdict(lambda: [set(), set()])
    for i, o in enumerate(obls):
        for k in o["regimes"]:
            per_regime[k][0].add(i)
            per_regime[k][1].add(o["vendor_id"])
    scope_note = (f"Frameworks in scope: {', '.join(f['label'] for f in frameworks)}." if frameworks
                  else "No frameworks are in scope yet, so every framework in the library is shown.")
    return {
        "kind": "register", "title": f"Register of functions and obligations, {today:%d %b %Y}", "as_of": today.isoformat(),
        "headline": [
            {"label": "Functions with vendors behind them", "value": len({f["function"] for f in funcs})},
            {"label": "Critical or important functions", "value": len({f["function"] for f in cif})},
            {"label": "Vendors behind them", "value": len({f["vendor_id"] for f in cif})},
            {"label": "Contract obligations", "value": len(obls)},
            {"label": "Mapped to a framework", "value": sum(1 for o in obls if o["regimes"])},
        ],
        "sections": [
            _table("functions", "Functions and the vendors behind them",
                   ["Function", "Critical or important", "Criticality", "RTO (h)", "RPO (h)", "Vendor", "Tier",
                    "Residual rating", "Last approved", "Next review", "Assessment", "Vendor continuity plan",
                    "Fourth parties"], func_rows,
                   "From the business impact analysis: processes that name a vendor as a dependency, and processes "
                   "linked on a vendor's Dependencies tab. Critical or important means rated critical or high."),
            _table("obligations", "Contract obligations and the requirements they meet",
                   ["Vendor", "Contract", "Obligation", "Control reference", "SCF controls", "Requirements met",
                    "Status"], obl_rows, f"{scope_note} {SCF_NOTE}"),
            _table("regimes", "Obligations by framework", ["Framework", "Obligations", "Vendors"],
                   [[k, len(v[0]), len(v[1])] for k, v in sorted(per_regime.items())]),
        ],
    }


# ── The committee pack ───────────────────────────────────────────────────────

def committee_pack(db: Session, tenant_id: int, start: date, end: date, today: date) -> dict:
    lo, hi = _span(start, end)
    vendors = _vendors(db, tenant_id)
    names = dict(db.query(Vendor.id, Vendor.name).filter(Vendor.tenant_id == tenant_id))
    cov = coverage(db, tenant_id, today, vendors)

    grid: Dict[str, Counter] = defaultdict(Counter)
    for v in vendors:
        grid[_tier(v)][(v.risk_rating or "unrated").lower()] += 1
    tiers = [t for t in LEVELS if t in grid] + sorted(set(grid) - set(LEVELS))
    ratings = LEVELS + ("unrated",)
    portfolio = [[_title(t)] + [grid[t][r] for r in ratings] + [sum(grid[t].values())] for t in tiers]

    cov_rows = []
    for t in tiers:
        c = Counter(cov["states"][v.id] for v in vendors if _tier(v) == t)
        cov_rows.append([_title(t), sum(c.values()), c["in_date"], c["overdue"], c["never"]])
    overdue = sorted((v for v in vendors if cov["states"][v.id] == "overdue"), key=lambda v: v.next_reassessment_date)
    overdue_rows = [[v.name, _title(v.tier), _d(v.next_reassessment_date), (today - v.next_reassessment_date.date()).days]
                    for v in overdue]

    length = (end - start).days + 1
    now_m = measures(db, tenant_id, start, end)
    before = measures(db, tenant_id, start - timedelta(days=length), start - timedelta(days=1))
    measure_rows = [[MEASURES[k], now_m[k]["median_days"], now_m[k]["count"], before[k]["median_days"]] for k in MEASURES]

    conc_rows = [[p["platform"], p["vendor_count"], p["critical_count"], ", ".join(x["name"] for x in p["vendors"])]
                 for p in graph.concentration(db, tenant_id, 2)[:10]]

    incidents = [[_d(i.occurred_at), names.get(i.vendor_id), i.title, _title(i.severity), "Incident log", _title(i.status)]
                 for i in db.query(VendorIncident).filter(VendorIncident.tenant_id == tenant_id,
                                                          VendorIncident.occurred_at >= lo, VendorIncident.occurred_at < hi)]
    for s in db.query(TPRAMonitoringSignal).filter(TPRAMonitoringSignal.tenant_id == tenant_id,
                                                   TPRAMonitoringSignal.deleted_at.is_(None),
                                                   TPRAMonitoringSignal.occurred_at >= lo, TPRAMonitoringSignal.occurred_at < hi):
        if s.verified is False or not (s.signal_type == "breach" or (s.severity or "").lower() in ("critical", "high")):
            continue
        state = "Raised as a finding" if s.finding_id else ("Reviewed" if s.acknowledged else "Open")
        incidents.append([_d(s.occurred_at), names.get(s.vendor_id), s.title or _title(s.signal_type), _title(s.severity),
                          f"Monitoring: {(s.signal_type or '').replace('_', ' ')}", state])
    incidents.sort(key=lambda r: r[0] or "")

    ages: Dict[str, Counter] = defaultdict(Counter)
    for f in db.query(TPRAFinding).filter(TPRAFinding.tenant_id == tenant_id, TPRAFinding.deleted_at.is_(None),
                                          TPRAFinding.status.in_(_OPEN)):
        old = (today - f.created_at.date()).days if f.created_at else 0
        ages[(f.severity or "medium").lower()][next(lbl for lbl, top in _AGES if top is None or old <= top)] += 1
    age_rows = [[_title(sev)] + [ages[sev][lbl] for lbl, _ in _AGES] + [sum(ages[sev].values())]
                for sev in list(LEVELS) + sorted(set(ages) - set(LEVELS)) if ages[sev]]
    late = db.query(TPRARemediation).filter(
        TPRARemediation.tenant_id == tenant_id, TPRARemediation.deleted_at.is_(None),
        TPRARemediation.status.notin_(("completed", "cancelled")),
        TPRARemediation.due_date < datetime.combine(today, datetime.min.time())).count()

    decisions = decisions_in(db, tenant_id, lo, hi, names)

    cif: Dict[str, dict] = {}
    for f in functions(db, tenant_id, today, vendors):
        if f["critical_or_important"]:
            row = cif.setdefault(f["function"], {"rto": f["rto_hours"], "vendors": [], "flags": set()})
            row["vendors"].append(f["vendor"])
            if f["state"] != "in_date":
                row["flags"].add(f"{f['vendor']}: {STATE_LABEL[f['state']].lower()}")
            if (f["rating"] or "").lower() in ("critical", "high"):
                row["flags"].add(f"{f['vendor']}: {f['rating'].lower()} residual risk")
    cif_rows = [[k, v["rto"], ", ".join(v["vendors"]), "; ".join(sorted(v["flags"])) or None] for k, v in cif.items()]

    open_findings = sum(sum(c.values()) for c in ages.values())
    return {
        "kind": "committee_pack", "title": f"Third-party risk committee pack, {period_label(start, end)}",
        "period": {"start": start.isoformat(), "end": end.isoformat()}, "as_of": today.isoformat(),
        "headline": [
            {"label": "Vendors in use", "value": len(vendors)},
            {"label": "Critical or high tier", "value": sum(1 for v in vendors if _tier(v) in ("critical", "high"))},
            {"label": "Assessed and in date", "value": f"{cov['coverage_pct']}%" if cov["coverage_pct"] is not None else None},
            {"label": "Reassessments overdue", "value": cov["overdue"]},
            {"label": "Open findings", "value": open_findings, "hint": f"{sum(ages['critical'].values())} critical"},
            {"label": "Incidents in the period", "value": len(incidents)},
        ],
        "sections": [
            _table("portfolio", "Portfolio by tier and residual risk",
                   ["Tier", "Critical", "High", "Medium", "Low", "Not rated", "Total"], portfolio,
                   "Vendors in use, by the tier their inherent risk earned and the residual rating after assessment."),
            _table("coverage", "Coverage", ["Tier", "Vendors", "In date", "Overdue", "Never approved"], cov_rows,
                   f"As at {today:%d %b %Y}. In date means approved with the next review not yet due."),
            _table("overdue", "Reassessments overdue", ["Vendor", "Tier", "Was due", "Days overdue"], overdue_rows),
            _table("measures", "Programme measures", ["Measure", "Median days", "Cases", "Previous period"], measure_rows,
                   "Cases are those that finished in the period. The wait for a decision starts when the assessment "
                   "was submitted for approval."),
            _table("functions", "Critical or important functions", ["Function", "RTO (h)", "Vendors", "Needs attention"],
                   cif_rows),
            _table("concentration", "Concentration", ["Platform", "Vendors on it", "Critical dependencies", "Vendors"],
                   conc_rows, "Platforms two or more of our vendors depend on, from the fourth-party register."),
            _table("incidents", "Incidents", ["Date", "Vendor", "What happened", "Severity", "Source", "Status"], incidents,
                   "Incidents logged against vendors, and breaches or high-severity alerts from monitoring."),
            _table("ageing", "Open findings by age", ["Severity"] + [lbl for lbl, _ in _AGES] + ["Total"], age_rows,
                   f"Remediation plans past their due date: {late}." if late else None),
            _table("decisions", "Decisions taken", ["Date", "Vendor", "Decision", "Detail"], decisions),
        ],
    }


def decisions_in(db: Session, tenant_id: int, lo: datetime, hi: datetime, names: Dict[int, str],
                 vendor_id: Optional[int] = None) -> List[list]:
    """Approvals, tier overrides and risk acceptances in a window, oldest first."""
    out = []
    q = db.query(TPRAApproval).filter(TPRAApproval.tenant_id == tenant_id, TPRAApproval.created_at >= lo,
                                      TPRAApproval.created_at < hi)
    for a in (q.filter(TPRAApproval.vendor_id == vendor_id) if vendor_id else q):
        detail = [f"residual {a.residual_rating}" if a.residual_rating else None,
                  f"{len(a.conditions)} condition{'s' if len(a.conditions) != 1 else ''}" if a.conditions else None]
        out.append([_d(a.created_at), names.get(a.vendor_id), _title(a.decision),
                    ", ".join(x for x in detail if x) or None])
    q = db.query(TPRAAuditLog).filter(TPRAAuditLog.tenant_id == tenant_id, TPRAAuditLog.entity == "tiering",
                                      TPRAAuditLog.action == "override", TPRAAuditLog.created_at >= lo,
                                      TPRAAuditLog.created_at < hi)
    for r in (q.filter(TPRAAuditLog.vendor_id == vendor_id) if vendor_id else q):
        out.append([_d(r.created_at), names.get(r.vendor_id), "Tier overridden",
                    f"{r.from_value or 'none'} to {r.to_value}: {r.reason or ''}".strip()])
    q = (db.query(TPRARiskAcceptance, TPRAFinding).join(TPRAFinding, TPRAFinding.id == TPRARiskAcceptance.finding_id)
         .filter(TPRARiskAcceptance.tenant_id == tenant_id, TPRARiskAcceptance.deleted_at.is_(None),
                 TPRARiskAcceptance.accepted_at >= lo, TPRARiskAcceptance.accepted_at < hi))
    for acc, f in (q.filter(TPRAFinding.vendor_id == vendor_id) if vendor_id else q):
        out.append([_d(acc.accepted_at), names.get(f.vendor_id), "Risk accepted",
                    f"{f.title or 'Finding'} until {_d(acc.expiry) or 'no expiry'}"])
    out.sort(key=lambda r: r[0] or "")
    return out


# ── A vendor's evidence file ─────────────────────────────────────────────────

def vendor_file(db: Session, tenant_id: int, vendor: Vendor, today: date) -> dict:
    names = {vendor.id: vendor.name}
    assessments = (db.query(VendorAssessment).filter(VendorAssessment.tenant_id == tenant_id,
                                                     VendorAssessment.vendor_id == vendor.id,
                                                     VendorAssessment.deleted_at.is_(None))
                   .order_by(VendorAssessment.created_at.desc()).all())
    ids = [a.id for a in assessments] or [-1]
    stage = {s.assessment_id: s for s in db.query(TPRAStageInstance).filter(
        TPRAStageInstance.assessment_id.in_(ids), TPRAStageInstance.stage_key == "approval")}
    decided = {a.assessment_id: a for a in db.query(TPRAApproval).filter(
        TPRAApproval.assessment_id.in_(ids)).order_by(TPRAApproval.created_at)}
    a_rows = []
    for a in assessments:
        s, d = stage.get(a.id), decided.get(a.id)
        a_rows.append([a.id, _title(a.assessment_type or "vendor"), _d(a.created_at), _d(s.started_at if s else None),
                       _d(s.completed_at if s else None), _title(d.decision) if d else None,
                       _title(a.residual_rating or (d.residual_rating if d else None))])

    qrs = (db.query(VendorQuestionnaireResponse).filter(VendorQuestionnaireResponse.tenant_id == tenant_id,
                                                        VendorQuestionnaireResponse.vendor_id == vendor.id)
           .order_by(VendorQuestionnaireResponse.created_at.desc()).all())
    templates = dict(db.query(VendorQuestionnaireTemplate.id, VendorQuestionnaireTemplate.name).filter(
        VendorQuestionnaireTemplate.id.in_([q.template_id for q in qrs if q.template_id] or [-1])))
    q_rows = [[templates.get(q.template_id) or "Questionnaire", _title(q.status), _d(q.created_at), _d(q.submitted_at),
               _d(q.accepted_at), q.attested_name] for q in qrs]
    answered = next((q for q in qrs if q.status in portal.ANSWERED), None)
    answer_rows = []
    if answered is not None:
        given = answered.responses or {}
        for question in questions_for(db, answered):
            raw = given.get(question["id"])
            label, score = answer_score(question, raw)
            if raw is None and label is None:
                continue
            shown = label if label is not None else (raw.get("value") if isinstance(raw, dict) else raw)
            answer_rows.append([question.get("text") or question.get("question") or question["id"],
                                None if shown is None else str(shown),
                                None if score is None else f"{round(score * 100)}%"])

    ev_rows = []
    for link, ev in (db.query(TPRAEvidenceLink, Evidence).join(Evidence, Evidence.id == TPRAEvidenceLink.evidence_id)
                     .filter(TPRAEvidenceLink.tenant_id == tenant_id, TPRAEvidenceLink.vendor_id == vendor.id,
                             TPRAEvidenceLink.deleted_at.is_(None)).order_by(TPRAEvidenceLink.created_at)):
        expiry = ev.expiry_date.date() if isinstance(ev.expiry_date, datetime) else ev.expiry_date
        ev_rows.append([ev.name, _title(link.requirement) or (f"Question {link.question_key}" if link.question_key else "Assessment"),
                        _d(link.created_at), _d(expiry), None if expiry is None else ("Expired" if expiry < today else "In date")])

    findings = (db.query(TPRAFinding).filter(TPRAFinding.tenant_id == tenant_id, TPRAFinding.vendor_id == vendor.id,
                                             TPRAFinding.deleted_at.is_(None)).order_by(TPRAFinding.created_at).all())
    plans: Dict[int, List[TPRARemediation]] = defaultdict(list)
    for r in db.query(TPRARemediation).filter(TPRARemediation.finding_id.in_([f.id for f in findings] or [-1]),
                                              TPRARemediation.deleted_at.is_(None)):
        plans[r.finding_id].append(r)
    f_rows = []
    for f in findings:
        dues = [r.due_date for r in plans[f.id] if r.due_date]
        done = [r.completed_at for r in plans[f.id] if r.completed_at]
        f_rows.append([f.title, _title(f.severity), _title(f.status), _d(f.created_at), _d(min(dues) if dues else None),
                       _d(max(done) if done else None)])

    since = datetime.combine(today - timedelta(days=365), datetime.min.time())
    s_rows = [[_d(s.occurred_at), _title(s.signal_type), s.title, _title(s.severity),
               "Raised as a finding" if s.finding_id else ("Reviewed" if s.acknowledged else "Open")]
              for s in db.query(TPRAMonitoringSignal).filter(
                  TPRAMonitoringSignal.tenant_id == tenant_id, TPRAMonitoringSignal.vendor_id == vendor.id,
                  TPRAMonitoringSignal.deleted_at.is_(None), TPRAMonitoringSignal.occurred_at >= since)
              .order_by(TPRAMonitoringSignal.occurred_at)]

    return {
        "kind": "vendor_file", "title": f"Evidence file: {vendor.name}", "as_of": today.isoformat(),
        "vendor": {"id": vendor.id, "name": vendor.name},
        "headline": [
            {"label": "Tier", "value": _title(vendor.tier)},
            {"label": "Residual rating", "value": _title(vendor.risk_rating)},
            {"label": "Status", "value": _title(vendor.status)},
            {"label": "Next review", "value": _d(vendor.next_reassessment_date)},
            {"label": "Open findings", "value": sum(1 for f in findings if f.status in _OPEN)},
        ],
        "sections": [
            _table("assessments", "Assessments", ["Id", "Type", "Started", "Submitted for decision", "Decided",
                                                  "Decision", "Residual rating"], a_rows),
            _table("decisions", "Decisions", ["Date", "Vendor", "Decision", "Detail"],
                   decisions_in(db, tenant_id, datetime.min, datetime.max, names, vendor.id)),
            _table("questionnaires", "Questionnaires", ["Questionnaire", "Status", "Sent", "Submitted", "Accepted",
                                                        "Attested by"], q_rows),
            _table("answers", "Answers to the latest answered questionnaire", ["Question", "Answer", "Score"], answer_rows,
                   f"{templates.get(answered.template_id) or 'Questionnaire'}, submitted {_d(answered.submitted_at)}."
                   if answered is not None else None),
            _table("evidence", "Evidence", ["Evidence", "Supports", "Added", "Valid until", "Validity"], ev_rows,
                   "Files stay in the evidence library; this lists what was supplied and whether it is still in date."),
            _table("findings", "Findings", ["Finding", "Severity", "Status", "Raised", "Fix due", "Fix completed"], f_rows),
            _table("signals", "Monitoring alerts in the last 12 months", ["Date", "Type", "Alert", "Severity", "Status"],
                   s_rows),
        ],
    }


# ── REST ─────────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/tpra", tags=["TPRA Reports"])


class ReportIn(BaseModel):
    kind: str = Field(..., pattern="^(committee_pack|register|vendor_file)$")
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    vendor_id: Optional[int] = None


class ShareIn(BaseModel):
    days: int = Field(14, ge=1, le=SHARE_MAX_DAYS)


def _build(db: Session, tenant_id: int, body: ReportIn) -> Tuple[dict, Optional[date], Optional[date], Optional[int]]:
    today = date.today()
    if body.kind == "committee_pack":
        start, end = body.period_start, body.period_end
        if not start or not end:
            start, end = last_quarter(today)
        if end < start or (end - start).days > 366:
            raise HTTPException(400, "The period must run forwards and be no longer than a year.")
        return committee_pack(db, tenant_id, start, end, today), start, end, None
    if body.kind == "register":
        return register(db, tenant_id, today), None, None, None
    if not body.vendor_id:
        raise HTTPException(400, "Choose the vendor whose file to generate.")
    vendor = graph._vendor(db, tenant_id, body.vendor_id)
    return vendor_file(db, tenant_id, vendor, today), None, None, vendor.id


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _report(db: Session, tenant_id: int, report_id: int) -> TPRAReport:
    r = db.query(TPRAReport).filter(TPRAReport.id == report_id, TPRAReport.tenant_id == tenant_id,
                                    TPRAReport.deleted_at.is_(None)).first()
    if r is None:
        raise HTTPException(404, "Report not found")
    return r


def _sharing(r: TPRAReport, now: datetime) -> bool:
    return bool(r.share_token_hash and not r.share_revoked_at and r.share_expires_at and r.share_expires_at > now)


def s_report(db: Session, reports: List[TPRAReport], content: bool = False) -> List[dict]:
    now = datetime.utcnow()
    ids = [r.id for r in reports] or [-1]
    views = {rid: (n, last) for rid, n, last in db.query(
        TPRAAuditLog.entity_id, func.count(TPRAAuditLog.id), func.max(TPRAAuditLog.created_at)).filter(
        TPRAAuditLog.entity == "report", TPRAAuditLog.action == "examiner_view",
        TPRAAuditLog.entity_id.in_(ids)).group_by(TPRAAuditLog.entity_id)}
    people = _names(db, {x for r in reports for x in (r.generated_by, r.approved_by, r.shared_by) if x})
    out = []
    for r in reports:
        n, last = views.get(r.id, (0, None))
        row = {"id": r.id, "kind": r.kind, "kind_label": KINDS.get(r.kind, r.kind), "title": r.title,
               "vendor_id": r.vendor_id, "period_start": _d(r.period_start), "period_end": _d(r.period_end),
               "content_hash": r.content_hash, "generated_at": r.generated_at.isoformat() if r.generated_at else None,
               "generated_by": people.get(r.generated_by), "approved_by": people.get(r.approved_by),
               "approved_at": r.approved_at.isoformat() if r.approved_at else None,
               "share": {"active": _sharing(r, now), "shared_by": people.get(r.shared_by),
                         "expires_at": r.share_expires_at.isoformat() if r.share_expires_at else None,
                         "revoked_at": r.share_revoked_at.isoformat() if r.share_revoked_at else None,
                         "views": n, "last_viewed_at": last.isoformat() if last else None}}
        if content:
            row["content"] = r.content
        out.append(row)
    return out


@router.get("/reports/preview")
def preview_report(kind: str = Query(..., pattern="^(committee_pack|register|vendor_file)$"),
                   period_start: Optional[date] = None, period_end: Optional[date] = None,
                   vendor_id: Optional[int] = None, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """The report as it would be generated now, without keeping it."""
    body = ReportIn(kind=kind, period_start=period_start, period_end=period_end, vendor_id=vendor_id)
    return _build(db, graph._tenant(db, user), body)[0]


@router.get("/reports/measures")
def programme_measures(days: int = Query(365, ge=30, le=1095), db: Session = Depends(get_db),
                       user: GRCUser = Depends(require_auth)):
    tid, today = graph._tenant(db, user), date.today()
    cov = coverage(db, tid, today)
    now_m = measures(db, tid, today - timedelta(days=89), today)
    return {"as_of": today.isoformat(),
            "coverage": {k: cov[k] for k in ("active", "in_date", "overdue", "never", "coverage_pct", "overdue_pct")},
            "measures": [{"key": k, "label": MEASURES[k], **now_m[k]} for k in MEASURES],
            "trends": trends(db, tid, days)}


@router.get("/reports")
def list_reports(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tid = graph._tenant(db, user)
    rows = (db.query(TPRAReport).filter(TPRAReport.tenant_id == tid, TPRAReport.deleted_at.is_(None))
            .order_by(TPRAReport.generated_at.desc()).limit(200).all())
    return {"items": s_report(db, rows)}


@router.post("/reports", status_code=201)
def create_report(body: ReportIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    rbac.require_write(db, user, "vendors", "edit")
    tid = graph._tenant(db, user)
    content, start, end, vendor_id = _build(db, tid, body)
    r = TPRAReport(tenant_id=tid, kind=body.kind, title=content["title"][:255], vendor_id=vendor_id,
                   period_start=start, period_end=end, content=content, generated_by=user.id,
                   content_hash=hashlib.sha256(json.dumps(content, sort_keys=True, default=str).encode()).hexdigest())
    db.add(r)
    db.flush()
    write_audit(db, tid, entity="report", action="create", entity_id=r.id, vendor_id=vendor_id, actor_id=user.id,
                to_value=r.title)
    db.commit()
    return s_report(db, [r], content=True)[0]


@router.get("/reports/{report_id}")
def get_report(report_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    return s_report(db, [_report(db, graph._tenant(db, user), report_id)], content=True)[0]


@router.post("/reports/{report_id}/approve")
def approve_report(report_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    rbac.require_write(db, user, "approvals", "approve", allow_fallback=False)
    tid = graph._tenant(db, user)
    r = _report(db, tid, report_id)
    if r.approved_at:
        raise HTTPException(409, "This report is already approved.")
    r.approved_by, r.approved_at = user.id, datetime.utcnow()
    write_audit(db, tid, entity="report", action="approve", entity_id=r.id, vendor_id=r.vendor_id, actor_id=user.id,
                to_value=r.content_hash)
    db.commit()
    return s_report(db, [r])[0]


@router.delete("/reports/{report_id}", status_code=204)
def delete_report(report_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    rbac.require_write(db, user, "vendors", "edit")
    tid = graph._tenant(db, user)
    r = _report(db, tid, report_id)
    if r.approved_at:
        raise HTTPException(409, "An approved report stays on record.")
    r.deleted_at = r.share_revoked_at = datetime.utcnow()
    write_audit(db, tid, entity="report", action="delete", entity_id=r.id, vendor_id=r.vendor_id, actor_id=user.id,
                from_value=r.title)
    db.commit()


@router.post("/reports/{report_id}/share")
def share_report(report_id: int, body: ShareIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """A fresh examiner link; any earlier link for this report stops working. The
    token is returned once and only its hash is kept."""
    rbac.require_write(db, user, "config", "edit", allow_fallback=False)
    tid = graph._tenant(db, user)
    r = _report(db, tid, report_id)
    if not r.approved_at:
        raise HTTPException(409, "Approve the report before sharing it.")
    token = secrets.token_urlsafe(32)
    r.share_token_hash, r.share_revoked_at, r.shared_by = _hash(token), None, user.id
    r.share_expires_at = datetime.utcnow() + timedelta(days=body.days)
    write_audit(db, tid, entity="report", action="share", entity_id=r.id, vendor_id=r.vendor_id, actor_id=user.id,
                extra={"expires_at": r.share_expires_at.isoformat()})
    db.commit()
    root = portal.base_url()
    return {**s_report(db, [r])[0], "token": token,
            "url": f"{root}/vendor-risk/examiner/{token}" if root else None}


@router.delete("/reports/{report_id}/share")
def revoke_share(report_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    rbac.require_write(db, user, "config", "edit", allow_fallback=False)
    tid = graph._tenant(db, user)
    r = _report(db, tid, report_id)
    if r.share_token_hash and not r.share_revoked_at:
        r.share_revoked_at = datetime.utcnow()
        write_audit(db, tid, entity="report", action="revoke_share", entity_id=r.id, vendor_id=r.vendor_id,
                    actor_id=user.id)
        db.commit()
    return s_report(db, [r])[0]


@router.get("/examiner/{token}")
def examiner_view(token: str, request: Request, db: Session = Depends(get_db)):
    """A shared report, read without a login. Every view is written to the audit log."""
    if not portal.throttle.allow(f"examiner:{token[:24]}"):
        raise HTTPException(429, "Too many requests. Try again in a few minutes.")
    r = db.query(TPRAReport).filter(TPRAReport.share_token_hash == _hash(token), TPRAReport.deleted_at.is_(None)).first()
    if r is None or not _sharing(r, datetime.utcnow()):
        raise HTTPException(404, "This link is not valid. It may have expired or been withdrawn.")
    write_audit(db, r.tenant_id, entity="report", action="examiner_view", entity_id=r.id, vendor_id=r.vendor_id,
                extra={"ip": request.client.host if request.client else None,
                       "user_agent": (request.headers.get("user-agent") or "")[:200]})
    db.commit()
    return {"title": r.title, "kind": r.kind, "kind_label": KINDS.get(r.kind, r.kind),
            "generated_at": r.generated_at.isoformat() if r.generated_at else None,
            "approved_at": r.approved_at.isoformat() if r.approved_at else None,
            "expires_at": r.share_expires_at.isoformat(), "content_hash": r.content_hash, "content": r.content}
