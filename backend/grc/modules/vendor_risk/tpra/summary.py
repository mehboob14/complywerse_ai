"""A supplier on a few printable pages: where it stands, what is open, what it
could cost, and how what we hold sits against NIST CSF 2.0.

Everything is read from records the programme already keeps. The CSF 2.0 profile
places them on the framework's 22 categories by code only: questionnaire answers
through our map of the built-in questions (or a question that names its own CSF
category), outside-in findings through a fixed map of their kinds, evidence by
what it was supplied for, and contract obligations through the control
crosswalk from SCF controls to CSF 2.0 requirement codes. Each category then
shows what supports it, what counts against it, or that nothing is held — an
honest picture of our knowledge of the supplier, not a certification of it.

The AI can write a summary for a committee on top. It is given the figures on
the page and nothing else, the page says the AI wrote it, and it can be kept
with the rest as a frozen report.
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Callable, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ....models import (
    Evidence, GRCUser, SCFMapping, TPRAApproval, TPRAEvidenceLink, TPRAFairAnalysis, TPRAFinding,
    TPRAMonitoringSignal, TPRAContract, TPRASurfaceScan, Vendor, VendorAssessment, VendorQuestionnaireResponse, get_db,
)
from ....routers.auth_router import get_user_tenants, require_auth
from . import contracts as contract_rules, outside_in, portal, rbac
from .engine_scoring import answer_score
from .versions import questions_for

router = APIRouter(tags=["Vendor summary"])

FUNCTIONS = {"GV": "Govern", "ID": "Identify", "PR": "Protect", "DE": "Detect", "RS": "Respond", "RC": "Recover"}
# NIST CSF 2.0 categories (a US government work, in the public domain).
CATEGORIES = {
    "GV.OC": "Organizational Context", "GV.RM": "Risk Management Strategy",
    "GV.RR": "Roles, Responsibilities, and Authorities", "GV.PO": "Policy", "GV.OV": "Oversight",
    "GV.SC": "Cybersecurity Supply Chain Risk Management", "ID.AM": "Asset Management", "ID.RA": "Risk Assessment",
    "ID.IM": "Improvement", "PR.AA": "Identity Management, Authentication, and Access Control",
    "PR.AT": "Awareness and Training", "PR.DS": "Data Security", "PR.PS": "Platform Security",
    "PR.IR": "Technology Infrastructure Resilience", "DE.CM": "Continuous Monitoring",
    "DE.AE": "Adverse Event Analysis", "RS.MA": "Incident Management", "RS.AN": "Incident Analysis",
    "RS.CO": "Incident Response Reporting and Communication", "RS.MI": "Incident Mitigation",
    "RC.RP": "Incident Recovery Plan Execution", "RC.CO": "Incident Recovery Communication",
}
# Our reading of the built-in questionnaires' questions onto CSF 2.0 categories.
QUESTION_CSF = {
    "sl_isms": "GV.PO", "sl_mfa": "PR.AA", "sl_enc": "PR.DS", "sl_ir": "RS.MA", "sl_bcp": "RC.RP", "sl_vuln": "ID.RA",
    "sl_pentest": "ID.RA", "sl_subproc": "GV.SC", "sl_breach": "RS.CO", "sl_soc2": "GV.OV",
    "sc_gov": "GV.RR", "sc_access": "PR.AA", "sc_mfa": "PR.AA", "sc_keymgmt": "PR.DS", "sc_logging": "DE.CM",
    "sc_change": "PR.PS", "sc_dr_test": "RC.RP", "sc_data_ret": "PR.DS", "sc_fourth": "GV.SC", "sc_geo": "GV.OC",
    "sc_insurance": "GV.RM", "caiq_tenant": "PR.DS", "caiq_enc": "PR.DS", "caiq_iam": "PR.AA", "caiq_avail": "PR.IR",
    "caiq_portability": "PR.DS", "caiq_vuln": "PR.PS", "caiq_csa": "GV.OV", "caiq_subproc": "GV.SC",
    "csf_id": "ID.AM", "csf_pr_ac": "PR.AA", "csf_pr_ds": "PR.DS", "csf_de": "DE.CM", "csf_rs": "RS.MA",
    "csf_rc": "RC.RP", "csf_supply": "GV.SC", "iso_cert": "GV.OV", "iso_a5": "GV.PO", "iso_a8": "ID.AM",
    "iso_a9": "PR.AA", "iso_a12": "PR.PS", "iso_a15": "GV.SC", "iso_a16": "RS.MA", "iso_a18": "GV.OC",
    "hecvat_data": "PR.DS", "hecvat_ferpa": "GV.OC", "hecvat_access": "PR.AA", "hecvat_breach": "RS.CO",
    "hecvat_thirdparty": "GV.SC", "dpa_role": "GV.SC", "dpa_lawful": "GV.PO", "dpa_dsar": "PR.DS",
    "dpa_transfer": "GV.OC", "dpa_retention": "PR.DS", "dpa_pia": "ID.RA", "dpa_subproc": "GV.SC", "dpa_breach": "RS.CO",
}
SURFACE_CSF = {"tls": "PR.DS", "web": "PR.PS", "email": "PR.PS", "exposure": "PR.IR", "vulns": "ID.RA", "software": "PR.PS"}
EVIDENCE_CSF = {"assurance_report": "GV.OV", "pen_test": "ID.RA", "bcp_test": "RC.RP", "insurance": "GV.RM",
                "security_policy": "GV.PO", "dpa": "GV.SC"}
CSF_SLUGS = ("nist_csf_20", "nist_csf")
_CODE = re.compile(r"^([A-Z]{2}\.[A-Z]{2})")


def _category(code: Optional[str]) -> Optional[str]:
    found = _CODE.match(str(code or "").strip().upper())
    return found.group(1) if found and found.group(1) in CATEGORIES else None


def _d(value) -> Optional[str]:
    if value is None:
        return None
    return (value.date() if isinstance(value, datetime) else value).isoformat()


# ── the CSF 2.0 profile ──────────────────────────────────────────────────────

def _crosswalk(db: Session, scf_ids: set) -> Dict[str, set]:
    """CSF 2.0 categories the crosswalk maps each SCF control to, codes only."""
    from ...scf.scope_service import _current_ready_release

    release = _current_ready_release(db) if scf_ids else None
    out: Dict[str, set] = defaultdict(set)
    if release is None:
        return out
    for scf_id, code in db.query(SCFMapping.scf_id, SCFMapping.requirement_code).filter(
            SCFMapping.release_id == release.id, SCFMapping.source_slug.in_(CSF_SLUGS), SCFMapping.scf_id.in_(list(scf_ids))):
        category = _category(code)
        if category:
            out[scf_id].add(category)
    return out


def profile(db: Session, vendor: Vendor, obligations: Optional[List[dict]] = None) -> List[dict]:
    """Each CSF 2.0 category with what supports it and what counts against it."""
    support: Dict[str, List[str]] = defaultdict(list)
    against: Dict[str, List[str]] = defaultdict(list)

    seen = set()
    for qr in (db.query(VendorQuestionnaireResponse).filter(VendorQuestionnaireResponse.vendor_id == vendor.id,
                                                            VendorQuestionnaireResponse.status.in_(portal.ANSWERED))
               .order_by(VendorQuestionnaireResponse.submitted_at.desc(), VendorQuestionnaireResponse.id.desc())):
        given = qr.responses or {}
        for question in questions_for(db, qr):
            key = str(question.get("id"))
            category = _category(question.get("csf")) or QUESTION_CSF.get(key)
            if not category or key in seen or given.get(key) is None:
                continue
            seen.add(key)
            label, score = answer_score(question, given.get(key))
            text = f"“{str(question.get('text') or key)[:110]}” {label or 'answered'}"
            if score is None:
                continue
            (support if score >= 0.75 else against)[category].append(text)

    for f in db.query(TPRAFinding).filter(TPRAFinding.vendor_id == vendor.id, TPRAFinding.deleted_at.is_(None),
                                          TPRAFinding.status.in_(("open", "in_remediation"))):
        category = QUESTION_CSF.get(f.question_key or "")
        if category:
            against[category].append(f"Open {f.severity or 'medium'} finding: {f.title}")

    scan = (db.query(TPRASurfaceScan).filter(TPRASurfaceScan.vendor_id == vendor.id,
                                                        TPRASurfaceScan.status == "done",
                                                        TPRASurfaceScan.score.isnot(None))
            .order_by(TPRASurfaceScan.started_at.desc()).first())
    if scan is not None:
        active = outside_in.live_waivers(outside_in.waivers_of(db, vendor), date.today())
        titles: Dict[str, set] = defaultdict(set)
        for f in scan.findings or []:
            if not outside_in.waiver_for(f, active) and SURFACE_CSF.get(f["category"]):
                titles[SURFACE_CSF[f["category"]]].add(f["title"])
        for category, names in titles.items():
            against[category].append(f"Seen from outside: {'; '.join(sorted(names)[:3])}" + (f" and {len(names) - 3} more" if len(names) > 3 else ""))
        for category in {SURFACE_CSF[c] for c in ("tls", "web", "email")} - set(titles):
            support[category].append(f"Nothing seen from outside against it (scan of {_d(scan.finished_at or scan.started_at)})")

    today = datetime.utcnow()
    for link, ev in (db.query(TPRAEvidenceLink, Evidence).join(Evidence, Evidence.id == TPRAEvidenceLink.evidence_id)
                     .filter(TPRAEvidenceLink.vendor_id == vendor.id, TPRAEvidenceLink.deleted_at.is_(None),
                             TPRAEvidenceLink.requirement.isnot(None))):
        category = EVIDENCE_CSF.get(link.requirement)
        if category:
            if ev.expiry_date is not None and ev.expiry_date < today:
                against[category].append(f"{ev.name}: lapsed {_d(ev.expiry_date)}")
            else:
                support[category].append(f"{ev.name}" + (f", valid to {_d(ev.expiry_date)}" if ev.expiry_date else ""))

    mine = [o for o in (obligations or []) if o["vendor_id"] == vendor.id and o["scf_ids"]]
    walk = _crosswalk(db, {s for o in mine for s in o["scf_ids"]})
    for o in mine:
        for category in sorted({c for s in o["scf_ids"] for c in walk.get(s, ())}):
            text = f"Contract obligation ({o['status']}): {o['obligation'][:110]}"
            (against if o["status"] == "breached" else support)[category].append(text)

    out = []
    for code, name in CATEGORIES.items():
        state = "gap" if against[code] else "evidence" if support[code] else "none"
        out.append({"code": code, "function": FUNCTIONS[code[:2]], "name": name, "state": state,
                    "support": support[code][:6], "against": against[code][:6]})
    return out


# ── the page ─────────────────────────────────────────────────────────────────

def _money(value, currency: str) -> Optional[str]:
    return None if value is None else f"{currency} {value:,.0f}"


def summary(db: Session, tenant_id: int, vendor: Vendor, today: date, narrative: Optional[List[str]] = None) -> dict:
    """The supplier summary, in the shape every report uses."""
    from . import quantification
    from .reports import _table, _title, functions, obligations

    cfg = quantification._config(db, tenant_id)
    procs = [f for f in functions(db, tenant_id, today, [vendor]) if f.get("vendor_id") == vendor.id]
    exposure = quantification.quantify(vendor, procs, cfg)
    try:
        obls, _ = obligations(db, tenant_id)
    except Exception:  # noqa: BLE001 — without the crosswalk the profile still reads everything else
        obls = []
    csf = profile(db, vendor, obls)

    assessment = (db.query(VendorAssessment).filter(VendorAssessment.vendor_id == vendor.id, VendorAssessment.deleted_at.is_(None))
                  .order_by(VendorAssessment.created_at.desc()).first())
    decision = (db.query(TPRAApproval).filter(TPRAApproval.vendor_id == vendor.id).order_by(TPRAApproval.created_at.desc()).first())
    findings = (db.query(TPRAFinding).filter(TPRAFinding.vendor_id == vendor.id, TPRAFinding.deleted_at.is_(None),
                                             TPRAFinding.status.in_(("open", "in_remediation")))
                .order_by(TPRAFinding.created_at).all())
    rank = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    findings.sort(key=lambda f: rank.get((f.severity or "medium").lower(), 2))
    scan = (db.query(TPRASurfaceScan).filter(TPRASurfaceScan.vendor_id == vendor.id,
                                                        TPRASurfaceScan.status == "done")
            .order_by(TPRASurfaceScan.started_at.desc()).first())
    waivers = outside_in.waivers_of(db, vendor)
    now_score = outside_in.score(scan.findings or [], waivers, today) if scan is not None and scan.score is not None else None
    decide = contract_rules.decide_days(db, tenant_id)
    deals = [contract_rules.describe(c, vendor, today, decide) for c in db.query(TPRAContract).filter(
        TPRAContract.vendor_id == vendor.id, TPRAContract.deleted_at.is_(None))]
    alerts = (db.query(TPRAMonitoringSignal).filter(TPRAMonitoringSignal.vendor_id == vendor.id,
                                                    TPRAMonitoringSignal.deleted_at.is_(None),
                                                    TPRAMonitoringSignal.occurred_at >= datetime.utcnow() - timedelta(days=365))
              .order_by(TPRAMonitoringSignal.occurred_at.desc()).limit(15).all())
    fairs = (db.query(TPRAFairAnalysis).filter(TPRAFairAnalysis.vendor_id == vendor.id, TPRAFairAnalysis.deleted_at.is_(None))
             .order_by(TPRAFairAnalysis.updated_at.desc()).limit(5).all())
    in_force = [c for c in deals if c["status"] == "active"]
    soonest = min((c for c in in_force if c["act_by"]), key=lambda c: c["act_by"], default=None)
    gaps = [c for c in csf if c["state"] == "gap"]
    held = [c for c in csf if c["state"] != "none"]
    currency = exposure["currency"]

    sections = []
    if narrative:
        sections.append({**_table("narrative", "Summary", [], [], "Written by AI from the figures in this report; check it against them."),
                         "paragraphs": narrative})
    sections += [
        _table("csf", "NIST CSF 2.0 profile", ["Function", "Category", "What we hold", "Against it", "Reading"],
               [[c["function"], f"{c['code']} {c['name']}", "\n".join(c["support"]) or None, "\n".join(c["against"]) or None,
                 {"gap": "Gap", "evidence": "Supported", "none": "Nothing held"}[c["state"]]] for c in csf],
               "Placed on CSF 2.0 by code: questionnaire answers through our map of the questions, outside-in findings "
               "by kind, evidence by what it was supplied for, and contract obligations through the control crosswalk. "
               "It shows what we know about the supplier, not whether it is certified."),
        _table("findings", "Open findings", ["Finding", "Severity", "Domain", "Raised", "Status"],
               [[f.title, _title(f.severity), _title(f.domain), _d(f.created_at), _title(f.status)] for f in findings[:30]]),
        _table("outside", "Seen from outside", ["Measure", "Value"], [
            ["Grade and score", f"{now_score['grade']} ({now_score['score']} of 100)" if now_score else "Not scanned"],
            ["Scanned", _d(scan.finished_at or scan.started_at) if scan else None],
            ["High or critical findings counting",
             len({f["key"] for f in (scan.findings or []) if now_score and f["key"] in now_score["counted"]
                  and f["severity"] in ("critical", "high")}) if scan else None],
            ["Waivers in force", len(outside_in.live_waivers(waivers, today))],
            ["Technologies seen", ", ".join(t["name"] for t in (outside_in.seen_technologies(scan) if scan else [])[:12]) or None],
        ]),
        _table("contracts", "Contracts", ["Contract", "Type", "Ends", "Notice by", "State", "Value a year"],
               [[c["title"] or c["type_label"], c["type_label"], c["ends_on"], c["act_by"] if c["act_by"] != c["ends_on"] else None,
                 _title(c["state"]), _money(c["annual_value"], c["currency"] or currency)] for c in deals]),
        _table("alerts", "Alerts in the last 12 months", ["Date", "Type", "Alert", "Severity", "Status"],
               [[_d(s.occurred_at), _title(s.signal_type), s.title, _title(s.severity),
                 _title(s.triage_status or ("closed" if s.acknowledged else "new"))] for s in alerts]),
        _table("exposure", "What it could cost", ["Basis", "Chance of a loss in a year", "Average year", "One year in twenty",
                                                  "Least liability cap"],
               [["Exposure model (all scenarios)", f"{exposure['annual']['chance']:.0%}", _money(exposure["annual"]["mean"], currency),
                 _money(exposure["annual"]["p95"], currency), None]]
               + [[f"Comply analysis: {a.name}", f"{(a.result or {}).get('annual', {}).get('chance', 0):.0%}",
                   _money((a.result or {}).get("annual", {}).get("mean"), currency),
                   _money((a.result or {}).get("annual", {}).get("p95"), currency),
                   _money((a.result or {}).get("liability_cap"), currency)] for a in fairs],
               "Ranges from simulated years, not forecasts."),
    ]
    return {
        "kind": "vendor_summary", "title": f"Supplier summary: {vendor.name}", "as_of": today.isoformat(),
        "headline": [
            {"label": "Tier", "value": _title(vendor.tier)},
            {"label": "Residual rating", "value": _title((assessment.residual_rating if assessment else None) or vendor.risk_rating)},
            {"label": "Latest decision", "value": _title(decision.decision) if decision else None,
             "hint": _d(decision.created_at) if decision else None},
            {"label": "Outside-in", "value": f"{now_score['grade']} · {now_score['score']}" if now_score else None},
            {"label": "Open findings", "value": len(findings),
             "hint": f"{sum(1 for f in findings if (f.severity or '').lower() in ('critical', 'high'))} critical or high"},
            {"label": "CSF 2.0 categories", "value": f"{len(held)} of {len(csf)} held", "hint": f"{len(gaps)} with gaps"},
            {"label": "Contract", "value": _d(soonest["act_by"]) if soonest else None,
             "hint": "next decision date" if soonest else ("none in force" if not in_force else None)},
            {"label": "Average year", "value": _money(exposure["annual"]["mean"], currency),
             "hint": f"1 in 20: {_money(exposure['annual']['p95'], currency)}"},
        ],
        "sections": sections,
    }


# ── the AI's summary ─────────────────────────────────────────────────────────

_ASK = """You write for a third-party risk committee. From the supplier report below, write three to five short
paragraphs in plain English: where the supplier stands overall, the main concerns and why they matter to us, what
is reassuring, and what the committee should do next. Use only the figures and facts given; do not invent any.
Answer with one JSON object: {"paragraphs": ["...", "..."]}"""


def _as_text(content: dict) -> str:
    lines = [content["title"]]
    lines += [f"{h['label']}: {h.get('value') or '—'}" + (f" ({h['hint']})" if h.get("hint") else "") for h in content["headline"]]
    for s in content["sections"]:
        if s.get("paragraphs") or not s["rows"]:
            continue
        lines.append(f"\n{s['title']} ({', '.join(s['columns'])}):")
        lines += [" | ".join("—" if v is None else str(v).replace("\n", "; ") for v in row) for row in s["rows"][:30]]
    return "\n".join(lines)[:14000]


def write_narrative(content: dict, complete: Optional[Callable] = None) -> List[str]:
    from ....services.assessment_evidence_ai import _parse, openai_complete

    reply = (complete or openai_complete)([{"role": "system", "content": _ASK}, {"role": "user", "content": _as_text(content)}])
    paragraphs = _parse(reply).get("paragraphs")
    out = [" ".join(str(p).split())[:900] for p in paragraphs if str(p).strip()] if isinstance(paragraphs, list) else []
    if not out:
        raise ValueError("The AI did not return a summary")
    return out[:5]


# ── REST ─────────────────────────────────────────────────────────────────────

def _vendor(db: Session, vendor_id: int, user: GRCUser) -> Vendor:
    tids = get_user_tenants(user, db)
    v = db.query(Vendor).filter(Vendor.id == vendor_id, Vendor.tenant_id.in_(tids or [-1]), Vendor.deleted_at.is_(None)).first()
    if v is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    return v


@router.get("/vendors/{vendor_id}/summary")
def read_summary(vendor_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    v = _vendor(db, vendor_id, user)
    return summary(db, v.tenant_id, v, date.today())


@router.post("/vendors/{vendor_id}/summary/narrative")
def narrative(vendor_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    from ....services.assessment_evidence_ai import AIUnavailable

    v = _vendor(db, vendor_id, user)
    rbac.require_write(db, user, "vendors", "edit")
    try:
        paragraphs = write_narrative(summary(db, v.tenant_id, v, date.today()))
    except AIUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))
    except Exception:  # noqa: BLE001 — a failed call must not look like an empty summary
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The AI could not write the summary. Try again.")
    return {"paragraphs": paragraphs, "at": datetime.utcnow().isoformat()}
