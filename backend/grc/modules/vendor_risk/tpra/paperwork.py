"""A supplier's paperwork: its documents and how long each holds, and its SOC reports read into fields.

Documents are the evidence linked to the supplier or its assessments, each listed
once. One holds until the earlier of its expiry and the end of the period it
vouches for (`ends_on`); within EXPIRING_DAYS of that it is expiring. The attention
queue's certificate condition reads the same dates, so the two cannot disagree.

A SOC report review records the report's facts. Whether it is too old to rely on
alone, whether a bridge letter is owed and the one-line verdict are worked out on
every read. A review that calls for a finding (any opinion but unqualified is
critical, material findings high, exceptions medium) raises one on the supplier's
active assessment, opening the first assessment if there is none, as a monitoring
signal does; it takes the steps a finding typed in takes: audited, mirrored into
Issues, and a critical one suspends a supplier already approved. Saving the review
again updates that finding while it is open; once it is closed, accepted or
deleted, a new one is raised only when the review calls for something worse.
Nothing here deletes a finding.

The report is kept in the evidence library and linked to the supplier, where it
counts as its independent assurance. A subservice organisation the report names
can be added as a fourth party in one step (graph.py fills it in).

Contract clauses live in contracts.py and service levels in routers/monitoring.py.
"""
from __future__ import annotations

import os
import uuid
from datetime import date, datetime
from typing import Iterable, List, Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ....models import (
    Evidence, GRCUser, TPRAEvidenceLink, TPRAFinding, TPRAFourthParty, TPRASocReview, Vendor, VendorAssessment, get_db,
)
from ....routers.auth_router import refuse_imported_accounts, require_auth
from ....services import evidence_review
from . import customisation, graph, rbac, service
from .bootstrap import get_tiering_config
from .contracts import _names

router = APIRouter(tags=["Supplier paperwork"])

EXPIRING_DAYS = 60          # this close to its end, a document is expiring
STALE_DAYS = 365            # a SOC report whose period ended longer ago is too old to rely on alone
BRIDGE_AFTER_DAYS = 90      # this long after the period (or a bridge letter) ends, a bridge letter is owed
KINDS = {"soc1": "SOC 1", "soc2": "SOC 2", "soc3": "SOC 3"}
TYPES = {"type1": "Type 1", "type2": "Type 2"}
OPINIONS = {"unqualified": "Unqualified opinion", "qualified": "Qualified opinion",
            "adverse": "Adverse opinion", "disclaimer": "Disclaimer of opinion"}
CRITERIA = ("security", "availability", "processing_integrity", "confidentiality", "privacy")
_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}
_LIVE_FINDING = ("open", "in_remediation")
_RETIRED = ("archived", "superseded", "rejected", "deleted")
_STATE_ORDER = {"expired": 0, "expiring": 1, "no_date": 2, "in_date": 3}


def _day(value) -> Optional[date]:
    return value.date() if isinstance(value, datetime) else value


def _iso(value) -> Optional[str]:
    return value.isoformat() if value else None


# ── documents ────────────────────────────────────────────────────────────────

def ends_on(link: TPRAEvidenceLink, ev: Evidence) -> Optional[date]:
    """When a document stops vouching for the supplier: the earlier of its expiry and the end of its window."""
    dates = [d for d in (_day(ev.expiry_date), link.coverage_to) if d]
    return min(dates) if dates else None


def doc_state(end: Optional[date], today: date) -> str:
    if end is None:
        return "no_date"
    left = (end - today).days
    return "expired" if left < 0 else "expiring" if left <= EXPIRING_DAYS else "in_date"


def _documents(db: Session, vendor: Vendor, today: date) -> dict:
    """The supplier's documents, each once (its first live link speaks for it), the most pressing first."""
    labels = customisation.evidence_labels(get_tiering_config(db, vendor.tenant_id).get("customisation"))
    seen, items = set(), []
    for link, ev in (db.query(TPRAEvidenceLink, Evidence).join(Evidence, Evidence.id == TPRAEvidenceLink.evidence_id)
                     .filter(TPRAEvidenceLink.tenant_id == vendor.tenant_id, TPRAEvidenceLink.vendor_id == vendor.id,
                             TPRAEvidenceLink.deleted_at.is_(None))
                     .order_by(TPRAEvidenceLink.id)):
        if ev.id in seen or (ev.status or "").lower() in _RETIRED:
            continue
        seen.add(ev.id)
        end = ends_on(link, ev)
        items.append({
            "link_id": link.id, "evidence_id": ev.id, "name": ev.name, "file_name": ev.file_name,
            "requirement": link.requirement, "kind": labels.get(link.requirement) if link.requirement else None,
            "evidence_type": ev.evidence_type, "from_supplier": ev.source_system == "vendor_portal",
            "assessment_id": link.assessment_id,
            "coverage_from": _iso(link.coverage_from), "coverage_to": _iso(link.coverage_to),
            "expiry_date": _iso(_day(ev.expiry_date)), "ends_on": _iso(end),
            "days_left": (end - today).days if end else None, "state": doc_state(end, today),
            "reviewed_by": link.reviewed_by, "reviewed_at": _iso(link.reviewed_at),
        })
    names = _names(db, [i["reviewed_by"] for i in items])
    for item in items:
        item["reviewed_by_name"] = names.get(item["reviewed_by"])
    items.sort(key=lambda i: (_STATE_ORDER[i["state"]], i["ends_on"] or "9999", (i["name"] or "").lower()))
    return {"items": items, "counts": {k: sum(i["state"] == k for i in items) for k in _STATE_ORDER},
            "expiring_days": EXPIRING_DAYS, "today": today.isoformat()}


@router.get("/vendors/{vendor_id}/paperwork")
def documents(vendor_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tenant_id = graph._tenant(db, user)
    return _documents(db, graph._vendor(db, tenant_id, vendor_id), datetime.utcnow().date())


class CoverageIn(BaseModel):
    coverage_from: Optional[date] = None
    coverage_to: Optional[date] = None


@router.put("/vendors/{vendor_id}/paperwork/{link_id}")
def review_document(vendor_id: int, link_id: int, body: CoverageIn, db: Session = Depends(get_db),
                    user: GRCUser = Depends(require_auth)):
    """Record the period a document vouches for (a field left out keeps its value) and mark it
    reviewed. It goes on each of the supplier's live links to the document, so it holds whichever is listed."""
    tenant_id = graph._tenant(db, user)
    vendor = graph._vendor(db, tenant_id, vendor_id)
    rbac.require_write(db, user, "assessments", "edit")
    link = db.query(TPRAEvidenceLink).filter(
        TPRAEvidenceLink.id == link_id, TPRAEvidenceLink.tenant_id == tenant_id,
        TPRAEvidenceLink.vendor_id == vendor.id, TPRAEvidenceLink.deleted_at.is_(None)).first()
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    given = {k: getattr(body, k) for k in body.model_fields_set}
    start, end = given.get("coverage_from", link.coverage_from), given.get("coverage_to", link.coverage_to)
    if start and end and end < start:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The period it covers ends before it starts")
    changes = {k: [_iso(getattr(link, k)), _iso(v)] for k, v in given.items() if getattr(link, k) != v}
    now = datetime.utcnow()
    for row in db.query(TPRAEvidenceLink).filter(
            TPRAEvidenceLink.tenant_id == tenant_id, TPRAEvidenceLink.vendor_id == vendor.id,
            TPRAEvidenceLink.evidence_id == link.evidence_id, TPRAEvidenceLink.deleted_at.is_(None)):
        for key, value in given.items():
            setattr(row, key, value)
        row.reviewed_by, row.reviewed_at = user.id, now
    service.write_audit(db, tenant_id, entity="evidence", action="review", vendor_id=vendor.id,
                        assessment_id=link.assessment_id, entity_id=link.id, actor_id=user.id, to_value=_iso(end),
                        extra={"evidence_id": link.evidence_id, "changes": changes})
    db.commit()
    return _documents(db, vendor, now.date())


# ── SOC reports: what follows from a review ──────────────────────────────────

def needs_bridge_letter(r: TPRASocReview, today: date) -> bool:
    """Owed once the period ended more than BRIDGE_AFTER_DAYS ago, and again that long after
    the date a received letter vouches to."""
    if r.period_end is None or (today - r.period_end).days <= BRIDGE_AFTER_DAYS:
        return False
    if r.bridge_letter != "received":
        return True
    return r.bridge_letter_until is not None and (today - r.bridge_letter_until).days > BRIDGE_AFTER_DAYS


def verdict(r: TPRASocReview) -> str:
    """The opinion and what the auditor found, together: an unqualified opinion is never
    shown alone when there are material findings or exceptions."""
    n = r.exceptions_count or 0
    found = (["material findings"] if r.material_findings else []) + ([f"{n} exception{'' if n == 1 else 's'}"] if n else [])
    opinion = OPINIONS.get(r.opinion, r.opinion)
    if found:
        return f"{opinion} with {' and '.join(found)}"
    return f"{opinion}, no exceptions" if r.opinion == "unqualified" else opinion


def derived(r: TPRASocReview, today: date) -> dict:
    since = (today - r.period_end).days if r.period_end else None
    found = r.material_findings or (r.exceptions_count or 0) > 0
    return {
        "days_since_period_end": since,
        "stale": since is not None and since > STALE_DAYS,
        "needs_bridge_letter": needs_bridge_letter(r, today),
        "verdict": verdict(r),
        "verdict_tone": "red" if r.opinion != "unqualified" else "amber" if found else "green",
    }


def _report(r: TPRASocReview) -> str:
    return f"{KINDS.get(r.report_kind, 'SOC')} {TYPES.get(r.report_type, '')}".strip() + " report"


def finding_for(r: TPRASocReview) -> Optional[dict]:
    """The finding a review calls for, or None: the worst of what it records decides."""
    n = r.exceptions_count or 0
    if r.opinion != "unqualified":
        severity, title = "critical", f"{OPINIONS.get(r.opinion, r.opinion)} on the {_report(r)}"
    elif r.material_findings:
        severity, title = "high", f"Material findings in the {_report(r)}"
    elif n:
        severity, title = "medium", f"{n} exception{'' if n == 1 else 's'} in the {_report(r)}"
    else:
        return None
    period = f" for {r.period_start:%d %b %Y} to {r.period_end:%d %b %Y}" if r.period_start and r.period_end else ""
    by = f" by {r.auditor_firm}" if r.auditor_firm else ""
    description = f"Raised from the review of the {_report(r)}{period}{by}: {verdict(r)}."
    if r.exceptions_summary:
        description += f"\n\nExceptions: {r.exceptions_summary}"
    return {"severity": severity, "title": title[:255], "description": description,
            "domain": "compliance" if r.report_kind == "soc1" else "cybersecurity"}


def sync_finding(db: Session, vendor: Vendor, r: TPRASocReview, actor_id: Optional[int]) -> Optional[TPRAFinding]:
    """Raise the finding the review calls for, once. Caller owns the commit."""
    want = finding_for(r)
    if want is None:
        return None
    ids = list(r.raised_finding_ids or [])
    latest = db.query(TPRAFinding).filter(TPRAFinding.id.in_(ids)).order_by(TPRAFinding.id.desc()).first() if ids else None
    if latest is not None and latest.deleted_at is None and latest.status in _LIVE_FINDING:
        changes = [k for k, v in want.items() if getattr(latest, k) != v]
        if changes:
            for key in changes:
                setattr(latest, key, want[key])
            latest.is_critical_control_fail = latest.severity == "critical"
            latest.row_version = (latest.row_version or 1) + 1
            service.write_audit(db, vendor.tenant_id, entity="finding", action="update", vendor_id=vendor.id,
                                assessment_id=latest.assessment_id, entity_id=latest.id, actor_id=actor_id,
                                to_value=", ".join(changes), extra={"soc_review_id": r.id})
            assessment = db.get(VendorAssessment, latest.assessment_id) if "severity" in changes else None
            if assessment is not None:
                service.enforce_critical_invariant(db, vendor, assessment, actor_id)
        return latest
    if latest is not None and _RANK.get(latest.severity, 0) >= _RANK[want["severity"]]:
        return latest                       # closed, accepted or deleted already, for this or something worse
    assessment = service.ensure_active_assessment(db, vendor, actor_id)
    finding = TPRAFinding(tenant_id=vendor.tenant_id, vendor_id=vendor.id, assessment_id=assessment.id,
                          status="open", is_critical_control_fail=want["severity"] == "critical",
                          created_by=actor_id, **want)
    db.add(finding)
    db.flush()
    service.write_audit(db, vendor.tenant_id, entity="finding", action="create", vendor_id=vendor.id,
                        assessment_id=assessment.id, entity_id=finding.id, actor_id=actor_id, to_value=finding.title,
                        extra={"soc_review_id": r.id})
    service.ensure_finding_issue(db, finding, actor_id)
    if finding.severity == "critical":
        service.enforce_critical_invariant(db, vendor, assessment, actor_id)
    r.raised_finding_ids = ids + [finding.id]
    return finding


def _link_report(db: Session, vendor: Vendor, r: TPRASocReview, ev: Evidence, actor_id: Optional[int]) -> None:
    """The report as the supplier's evidence, linked once; a new link counts as its independent assurance."""
    if db.query(TPRAEvidenceLink.id).filter(
            TPRAEvidenceLink.vendor_id == vendor.id, TPRAEvidenceLink.evidence_id == ev.id,
            TPRAEvidenceLink.deleted_at.is_(None)).first():
        return
    active = service.get_active_assessment(db, vendor)
    kinds = customisation.evidence_kinds(get_tiering_config(db, vendor.tenant_id).get("customisation"))
    link = TPRAEvidenceLink(tenant_id=vendor.tenant_id, vendor_id=vendor.id, assessment_id=active.id if active else None,
                            evidence_id=ev.id, requirement="assurance_report" if "assurance_report" in kinds else None,
                            note="SOC report", created_by=actor_id)
    db.add(link)
    db.flush()
    service.write_audit(db, vendor.tenant_id, entity="evidence", action="create", vendor_id=vendor.id,
                        assessment_id=link.assessment_id, entity_id=link.id, actor_id=actor_id, to_value=ev.name,
                        extra={"evidence_id": ev.id, "soc_review_id": r.id})


# ── SOC reports: reading and writing ─────────────────────────────────────────

def _describe(db: Session, rows: List[TPRASocReview], today: date) -> List[dict]:
    people = {r.reviewer_id for r in rows} | {c.get("owner_id") for r in rows for c in r.cuecs or []}
    names = _names(db, people)
    finding_ids = [i for r in rows for i in r.raised_finding_ids or []]
    findings = {f.id: {"id": f.id, "severity": f.severity, "status": f.status, "title": f.title,
                       "assessment_id": f.assessment_id}
                for f in db.query(TPRAFinding).filter(TPRAFinding.id.in_(finding_ids or [-1]),
                                                      TPRAFinding.deleted_at.is_(None))}
    files = {e.id: e for e in db.query(Evidence).filter(Evidence.id.in_([r.evidence_id for r in rows if r.evidence_id] or [-1]))}
    out = []
    for r in rows:
        ev = files.get(r.evidence_id)
        out.append({
            "id": r.id, "vendor_id": r.vendor_id, "evidence_id": r.evidence_id,
            "evidence": {"id": ev.id, "name": ev.name, "file_name": ev.file_name} if ev is not None else None,
            "report_kind": r.report_kind, "report_type": r.report_type,
            "period_start": _iso(r.period_start), "period_end": _iso(r.period_end), "issued_on": _iso(r.issued_on),
            "auditor_firm": r.auditor_firm, "opinion": r.opinion, "tsc": r.tsc or [],
            "exceptions_count": r.exceptions_count or 0, "exceptions_summary": r.exceptions_summary,
            "material_findings": bool(r.material_findings), "bridge_letter": r.bridge_letter,
            "bridge_letter_until": _iso(r.bridge_letter_until),
            "cuecs": [{**c, "owner_name": names.get(c.get("owner_id"))} for c in r.cuecs or []],
            "subservice_orgs": r.subservice_orgs or [],
            "reviewer_id": r.reviewer_id, "reviewer_name": names.get(r.reviewer_id), "reviewed_at": _iso(r.reviewed_at),
            "notes": r.notes, "raised_finding_ids": r.raised_finding_ids or [],
            "findings": [findings[i] for i in r.raised_finding_ids or [] if i in findings],
            "created_at": _iso(r.created_at), "updated_at": _iso(r.updated_at), "archived_at": _iso(r.archived_at),
            **derived(r, today),
        })
    return out


def _one(db: Session, r: TPRASocReview) -> dict:
    return _describe(db, [r], datetime.utcnow().date())[0]


def _review(db: Session, tenant_id: int, vendor: Vendor, review_id: int) -> TPRASocReview:
    r = db.query(TPRASocReview).filter(TPRASocReview.id == review_id, TPRASocReview.tenant_id == tenant_id,
                                       TPRASocReview.vendor_id == vendor.id, TPRASocReview.archived_at.is_(None)).first()
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "SOC report review not found")
    return r


class CuecIn(BaseModel):
    id: Optional[str] = Field(None, max_length=40)
    text: str = Field(..., min_length=1, max_length=1000)
    owner_id: Optional[int] = None
    status: Literal["open", "in_place", "not_applicable"] = "open"
    note: Optional[str] = Field(None, max_length=1000)


class SubserviceIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    method: Literal["carve_out", "inclusive"] = "carve_out"
    fourth_party_id: Optional[int] = None


class SocReviewIn(BaseModel):
    """A review as recorded. An update writes only the fields it names."""
    evidence_id: Optional[int] = None
    report_kind: Literal["soc1", "soc2", "soc3"] = "soc2"
    report_type: Literal["type1", "type2"] = "type2"
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    issued_on: Optional[date] = None
    auditor_firm: Optional[str] = Field(None, max_length=200)
    opinion: Literal["unqualified", "qualified", "adverse", "disclaimer"] = "unqualified"
    tsc: List[Literal["security", "availability", "processing_integrity", "confidentiality", "privacy"]] = Field(
        default_factory=list)
    exceptions_count: int = Field(0, ge=0, le=100000)
    exceptions_summary: Optional[str] = Field(None, max_length=8000)
    material_findings: bool = False
    bridge_letter: Optional[Literal["received", "needed", "not_needed"]] = None
    bridge_letter_until: Optional[date] = None
    cuecs: List[CuecIn] = Field(default_factory=list, max_length=200)
    subservice_orgs: List[SubserviceIn] = Field(default_factory=list, max_length=100)
    notes: Optional[str] = Field(None, max_length=8000)


def _clean_cuecs(db: Session, rows: List[CuecIn], before: list) -> list:
    kept = {c.get("owner_id") for c in before if c.get("owner_id")}
    owners = {c.owner_id for c in rows if c.owner_id}
    refuse_imported_accounts(db, owners, kept=kept)
    active = {i for (i,) in db.query(GRCUser.id).filter(GRCUser.id.in_(owners or [-1]), GRCUser.is_active.is_(True))}
    if owners - active - kept:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose someone who uses the platform as the owner")
    out, ids = [], set()
    for c in rows:
        text = " ".join(c.text.split())
        if not text:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Write what each control asks us to do")
        cid = c.id if c.id and c.id not in ids else uuid.uuid4().hex[:8]
        ids.add(cid)
        out.append({"id": cid, "text": text, "owner_id": c.owner_id, "status": c.status,
                    "note": " ".join((c.note or "").split()) or None})
    return out


def _clean_subservice(db: Session, vendor: Vendor, rows: List[SubserviceIn]) -> list:
    """A fourth party an organisation points at must be one of this supplier's."""
    live = {i for (i,) in db.query(TPRAFourthParty.id).filter(
        TPRAFourthParty.tenant_id == vendor.tenant_id, TPRAFourthParty.vendor_id == vendor.id,
        TPRAFourthParty.deleted_at.is_(None))}
    return [{"name": " ".join(o.name.split()), "method": o.method,
             "fourth_party_id": o.fourth_party_id if o.fourth_party_id in live else None}
            for o in rows if o.name.strip()]


def _apply(db: Session, vendor: Vendor, r: TPRASocReview, body: SocReviewIn, fields: Iterable[str],
           actor_id: int) -> Optional[Evidence]:
    """Write the named fields, cleaned. Returns the report's evidence when the write names one."""
    values = {k: getattr(body, k) for k in fields}
    start, end = values.get("period_start", r.period_start), values.get("period_end", r.period_end)
    if start and end and end < start:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The period ends before it starts")
    ev = None
    if values.get("evidence_id") is not None:
        ev = db.query(Evidence).filter(Evidence.id == values["evidence_id"], Evidence.tenant_id == vendor.tenant_id).first()
        if ev is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "That file is not in the evidence library")
    if "auditor_firm" in values:
        values["auditor_firm"] = " ".join((values["auditor_firm"] or "").split()) or None
    for key in ("exceptions_summary", "notes"):
        if key in values:
            values[key] = (values[key] or "").strip() or None
    if "tsc" in values:
        values["tsc"] = [c for c in CRITERIA if c in values["tsc"]]
    if "cuecs" in values:
        values["cuecs"] = _clean_cuecs(db, values["cuecs"], r.cuecs or [])
    if "subservice_orgs" in values:
        values["subservice_orgs"] = _clean_subservice(db, vendor, values["subservice_orgs"])
    for key, value in values.items():
        setattr(r, key, value)
    r.reviewer_id, r.reviewed_at = actor_id, datetime.utcnow()
    return ev


def _saved(db: Session, vendor: Vendor, r: TPRASocReview, ev: Optional[Evidence], actor_id: int, action: str) -> None:
    if ev is not None:
        _link_report(db, vendor, r, ev, actor_id)
    finding = sync_finding(db, vendor, r, actor_id)
    service.write_audit(db, vendor.tenant_id, entity="soc_review", action=action, vendor_id=vendor.id, entity_id=r.id,
                        actor_id=actor_id, to_value=verdict(r),
                        extra={"report": _report(r), "finding_id": finding.id if finding else None})


@router.get("/vendors/{vendor_id}/soc-reviews")
def list_reviews(vendor_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """The supplier's SOC report reviews, the latest period first."""
    tenant_id = graph._tenant(db, user)
    vendor = graph._vendor(db, tenant_id, vendor_id)
    rows = (db.query(TPRASocReview)
            .filter(TPRASocReview.tenant_id == tenant_id, TPRASocReview.vendor_id == vendor.id,
                    TPRASocReview.archived_at.is_(None))
            .order_by(TPRASocReview.period_end.is_(None), TPRASocReview.period_end.desc(), TPRASocReview.id.desc())
            .all())
    return {"items": _describe(db, rows, datetime.utcnow().date()), "criteria": list(CRITERIA)}


@router.post("/vendors/{vendor_id}/soc-reviews", status_code=status.HTTP_201_CREATED)
def create_review(vendor_id: int, body: SocReviewIn, db: Session = Depends(get_db),
                  user: GRCUser = Depends(require_auth)):
    tenant_id = graph._tenant(db, user)
    vendor = graph._vendor(db, tenant_id, vendor_id)
    rbac.require_write(db, user, "assessments", "edit")
    r = TPRASocReview(tenant_id=tenant_id, vendor_id=vendor.id)
    ev = _apply(db, vendor, r, body, SocReviewIn.model_fields, user.id)
    db.add(r)
    db.flush()
    _saved(db, vendor, r, ev, user.id, "create")
    db.commit()
    return _one(db, r)


@router.put("/vendors/{vendor_id}/soc-reviews/{review_id}")
def update_review(vendor_id: int, review_id: int, body: SocReviewIn, db: Session = Depends(get_db),
                  user: GRCUser = Depends(require_auth)):
    tenant_id = graph._tenant(db, user)
    vendor = graph._vendor(db, tenant_id, vendor_id)
    r = _review(db, tenant_id, vendor, review_id)
    rbac.require_write(db, user, "assessments", "edit")
    ev = _apply(db, vendor, r, body, body.model_fields_set, user.id)
    _saved(db, vendor, r, ev, user.id, "update")
    db.commit()
    return _one(db, r)


@router.post("/vendors/{vendor_id}/soc-reviews/{review_id}/archive")
def archive_review(vendor_id: int, review_id: int, db: Session = Depends(get_db),
                   user: GRCUser = Depends(require_auth)):
    """Out of the list; the findings it raised stay where they are."""
    tenant_id = graph._tenant(db, user)
    vendor = graph._vendor(db, tenant_id, vendor_id)
    r = _review(db, tenant_id, vendor, review_id)
    rbac.require_write(db, user, "assessments", "edit")
    r.archived_at = datetime.utcnow()
    service.write_audit(db, tenant_id, entity="soc_review", action="archive", vendor_id=vendor.id, entity_id=r.id,
                        actor_id=user.id, from_value=_report(r))
    db.commit()
    return {"archived": True, "id": r.id}


@router.post("/vendors/{vendor_id}/soc-reviews/{review_id}/report")
async def upload_report(vendor_id: int, review_id: int, file: UploadFile = File(...), db: Session = Depends(get_db),
                        user: GRCUser = Depends(require_auth)):
    """Keep the report in the evidence library, linked to the supplier; a new upload replaces the review's file."""
    from .api import _save_evidence_file
    from .contracts import FILE_TYPES, MAX_FILE_BYTES

    tenant_id = graph._tenant(db, user)
    vendor = graph._vendor(db, tenant_id, vendor_id)
    r = _review(db, tenant_id, vendor, review_id)
    rbac.require_write(db, user, "assessments", "edit")
    if os.path.splitext(file.filename or "")[1].lower() not in FILE_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Upload the report as one of: {', '.join(sorted(t[1:] for t in FILE_TYPES))}")
    if len(await file.read(MAX_FILE_BYTES + 1)) > MAX_FILE_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "The file is larger than 25 MB")
    await file.seek(0)
    ev = await _save_evidence_file(db, tenant_id, f"{vendor.name}: {_report(r)}"[:255], "soc_report", file, user.id)
    previous, r.evidence_id = r.evidence_id, ev.id
    _link_report(db, vendor, r, ev, user.id)
    service.write_audit(db, tenant_id, entity="soc_review", action="attach_report", vendor_id=vendor.id, entity_id=r.id,
                        actor_id=user.id, from_value=previous, to_value=ev.id, reason=file.filename)
    db.commit()
    out = _one(db, r)
    evidence_review.rate_upload(db, ev, user.id)
    return out


class FourthPartyNameIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


@router.post("/vendors/{vendor_id}/soc-reviews/{review_id}/fourth-parties")
def add_fourth_party(vendor_id: int, review_id: int, body: FourthPartyNameIn, db: Session = Depends(get_db),
                     user: GRCUser = Depends(require_auth)):
    """A subservice organisation the report names, as one of the supplier's fourth parties: the
    supplier's own fourth party of that name when it has one, else a new one it declared."""
    tenant_id = graph._tenant(db, user)
    vendor = graph._vendor(db, tenant_id, vendor_id)
    r = _review(db, tenant_id, vendor, review_id)
    rbac.require_write(db, user, "vendors", "edit")
    key = graph.normalise(body.name)
    orgs = [dict(o) for o in r.subservice_orgs or []]
    org = next((o for o in orgs if graph.normalise(o.get("name") or "") == key), None)
    if org is None or not key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That organisation is not on this review")
    fp = next((f for f in db.query(TPRAFourthParty).filter(
        TPRAFourthParty.tenant_id == tenant_id, TPRAFourthParty.vendor_id == vendor.id,
        TPRAFourthParty.deleted_at.is_(None)).order_by(TPRAFourthParty.id) if graph.normalise(f.name) == key), None)
    if fp is None:
        how = ("carved out, so the report does not cover its controls" if org.get("method") == "carve_out"
               else "included in the report")
        fp = TPRAFourthParty(tenant_id=tenant_id, vendor_id=vendor.id, created_by=user.id)
        graph._fill(db, fp, graph.FourthPartyIn(
            name=org["name"], service="Subservice organisation in its SOC report", source="declared",
            notes=f"Named in the {_report(r)}" + (f" for the period to {r.period_end:%d %b %Y}" if r.period_end else "")
                  + f": {how}."), tenant_id)
        db.add(fp)
        db.flush()
        service.write_audit(db, tenant_id, entity="fourth_party", action="create", vendor_id=vendor.id,
                            entity_id=fp.id, actor_id=user.id, to_value=fp.name)
    org["fourth_party_id"] = fp.id
    r.subservice_orgs = orgs
    service.write_audit(db, tenant_id, entity="soc_review", action="update", vendor_id=vendor.id, entity_id=r.id,
                        actor_id=user.id, to_value=fp.name, reason="Added as a fourth party",
                        extra={"fourth_party_id": fp.id})
    db.commit()
    return _one(db, r)
