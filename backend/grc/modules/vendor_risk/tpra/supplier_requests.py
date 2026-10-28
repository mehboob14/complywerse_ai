"""Requests to a supplier outside a questionnaire, and messages with them (signed-in side).

We ask a supplier for a document (one of the tier policy's evidence types) or for
information. A reviewer can also share a finding: the supplier is asked for a plan to
fix it, a date and evidence. Only a finding a reviewer shares reaches the supplier,
as the title and note the reviewer chose, never its severity or scores, and a finding
is shared once at a time.

The supplier answers in the portal (tpra/supplier_portal.py). A request is open, then
submitted; a reviewer accepts the answer or returns it with a note, which opens it to
the supplier again; until it is accepted it can be cancelled. Each file the supplier
sends is in the evidence library at once, and becomes the supplier's paperwork when
the request is accepted: a TPRAEvidenceLink with the evidence type, the period the
supplier said it covers and the reviewer, which the Paperwork tab and the tier's
evidence check count from then on. Accepting the answer to a finding can also record
the supplier's plan as its remediation, or close it once the fix is verified, through
the findings' own endpoints.

Messages: one thread about the supplier, one per request and one per questionnaire
(per question, for the reviews). Ours are internal unless shared; a supplier sees only
shared ones, and its own are always shared. A new request, a shared message and a
returned answer are emailed to the supplier's contacts with fresh personal links, from
inside the request. A supplier's answer or message is told to whoever asked and the
supplier's owner, without the supplier's words: the email says where to read them.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import date, datetime, time, timedelta
from typing import Dict, List, Literal, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ....models import (
    Evidence, GRCUser, Tenant, TPRAEvidenceLink, TPRAFinding, TPRAMessage, TPRASupplierRequest,
    TPRASupplierRequestFile, TPRAVendorContact, Vendor, VendorQuestionnaireResponse, get_db,
)
from ....routers.auth_router import require_auth
from ....services import evidence_review
from ..routers import questionnaires as routes
from . import api, contacts, customisation, portal, rbac, service
from .bootstrap import get_tiering_config
from .emails import render
from .graph import _tenant, _vendor

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Supplier requests"])

WAITING = ("open", "returned")                  # the supplier can work on it
LIVE = ("open", "submitted", "returned")        # not finished
RECENT_DAYS = 90                                # a finished request stays on the supplier's home this long
MAX_FILES = 20                                  # files per request (a questionnaire takes 100 in all)
MAX_TEXT = 8000
_ORDER = {"submitted": 0, "open": 1, "returned": 1, "accepted": 2, "cancelled": 3}
_LIVE_FINDING = ("open", "in_remediation")


def _iso(value) -> Optional[str]:
    return value.isoformat() if value else None


def _text(value, limit: int = MAX_TEXT) -> Optional[str]:
    return (value or "").strip()[:limit] or None


def due_words(due: Optional[date]) -> str:
    return f"on {due:%d %b %Y}" if due else "as soon as you can"


def overdue(r: TPRASupplierRequest, today: date) -> bool:
    return r.status in WAITING and r.due_date is not None and r.due_date < today


def _labels(db: Session, tenant_id: int) -> Dict[str, str]:
    return customisation.evidence_labels(get_tiering_config(db, tenant_id).get("customisation"))


# ── what a request looks like ────────────────────────────────────────────────

def _files(db: Session, ids: List[int], public: bool = False) -> Dict[int, List[dict]]:
    """Each request's files, in the order they came."""
    out: Dict[int, List[dict]] = {}
    for f, ev in (db.query(TPRASupplierRequestFile, Evidence)
                  .join(Evidence, Evidence.id == TPRASupplierRequestFile.evidence_id)
                  .filter(TPRASupplierRequestFile.request_id.in_(ids or [-1]))
                  .order_by(TPRASupplierRequestFile.id)):
        item = {"id": f.id, "file_name": f.file_name, "file_size": f.file_size,
                "coverage_from": _iso(f.coverage_from), "coverage_to": _iso(f.coverage_to),
                "expiry_date": _iso(ev.expiry_date.date() if ev.expiry_date else None), "uploaded_at": _iso(f.created_at)}
        if not public:
            item.update({"evidence_id": ev.id, "link_id": f.link_id})
        out.setdefault(f.request_id, []).append(item)
    return out


def describe(db: Session, rows: List[TPRASupplierRequest]) -> List[dict]:
    """Requests as our people see them."""
    if not rows:
        return []
    files = _files(db, [r.id for r in rows])
    names = contacts._names(db, [x for r in rows for x in (r.requested_by, r.reviewed_by)])
    people = {c.id: c for c in db.query(TPRAVendorContact).filter(TPRAVendorContact.id.in_(
        [x for r in rows for x in (r.contact_id, r.responded_by_contact_id) if x] or [-1]))}
    findings = {f.id: f for f in db.query(TPRAFinding).filter(
        TPRAFinding.id.in_([r.finding_id for r in rows if r.finding_id] or [-1]))}
    labels, today = _labels(db, rows[0].tenant_id), datetime.utcnow().date()
    out = []
    for r in rows:
        f, c, by = findings.get(r.finding_id), people.get(r.contact_id), people.get(r.responded_by_contact_id)
        out.append({
            "id": r.id, "vendor_id": r.vendor_id, "assessment_id": r.assessment_id, "kind": r.kind, "title": r.title,
            "detail": r.detail, "evidence_kind": r.evidence_kind, "evidence_label": labels.get(r.evidence_kind),
            "finding": {"id": f.id, "title": f.title, "severity": f.severity, "status": f.status,
                        "assessment_id": f.assessment_id, "removed": f.deleted_at is not None} if f else None,
            "contact": {"id": c.id, "name": c.name, "email": c.email} if c else None,
            "due_date": _iso(r.due_date), "overdue": overdue(r, today), "status": r.status,
            "requested_by": r.requested_by, "requested_by_name": names.get(r.requested_by),
            "requested_at": _iso(r.requested_at), "response_text": r.response_text, "plan_text": r.plan_text,
            "target_date": _iso(r.target_date), "responded_at": _iso(r.responded_at),
            "responded_by": by.name if by else None, "reviewed_by_name": names.get(r.reviewed_by),
            "reviewed_at": _iso(r.reviewed_at), "review_note": r.review_note, "files": files.get(r.id, []),
            "created_at": _iso(r.created_at), "updated_at": _iso(r.updated_at),
        })
    return out


def _public(r: TPRASupplierRequest, labels: Dict[str, str], today: date) -> dict:
    """A request as the supplier sees it: what is asked and where it stands, nothing of ours.
    A reviewer's note shows only on an answer returned to them."""
    return {"id": r.id, "kind": r.kind, "title": r.title, "detail": r.detail,
            "evidence_label": labels.get(r.evidence_kind) if r.evidence_kind else None,
            "due_date": _iso(r.due_date), "overdue": overdue(r, today), "status": r.status, "open": r.status in WAITING,
            "requested_at": _iso(r.requested_at), "responded_at": _iso(r.responded_at),
            "review_note": r.review_note if r.status == "returned" else None}


# ── messages ─────────────────────────────────────────────────────────────────

def subject(db: Session, vendor: Vendor, subject_type: str, subject_id: Optional[int]):
    """What a thread is about, when it is this supplier's: None for the supplier's own
    thread, else the request or questionnaire. LookupError when it is not."""
    if subject_type == "vendor":
        return None
    model = {"request": TPRASupplierRequest, "questionnaire": VendorQuestionnaireResponse}[subject_type]
    row = db.query(model).filter(model.id == subject_id, model.vendor_id == vendor.id).first() if subject_id else None
    if row is None:
        raise LookupError(subject_type)
    return row


def thread(db: Session, vendor_id: int, subject_type: str, subject_id: Optional[int] = None,
           question_key: Optional[str] = None, shared_only: bool = False, limit: int = 200) -> List[TPRAMessage]:
    """A thread's latest `limit` messages, oldest first. A questionnaire's is all its
    questions' unless one is named."""
    M = TPRAMessage
    q = db.query(M).filter(M.vendor_id == vendor_id, M.subject_type == subject_type,
                           M.subject_id.is_(None) if subject_id is None else M.subject_id == subject_id)
    if question_key is not None:
        q = q.filter(M.question_key == question_key)
    if shared_only:
        q = q.filter(M.visibility == "shared")
    return list(reversed(q.order_by(M.created_at.desc(), M.id.desc()).limit(limit).all()))


def message_rows(db: Session, messages: List[TPRAMessage], public: bool = False) -> List[dict]:
    names = contacts._names(db, [m.author_user_id for m in messages])
    people = dict(db.query(TPRAVendorContact.id, TPRAVendorContact.name).filter(
        TPRAVendorContact.id.in_([m.author_contact_id for m in messages if m.author_contact_id] or [-1])))
    out = []
    for m in messages:
        author = (people.get(m.author_contact_id) if m.author_kind == "contact"
                  else names.get(m.author_user_id) if m.author_kind == "user" else None)
        row = {"id": m.id, "from_supplier": m.author_kind == "contact", "author": author, "body": m.body,
               "created_at": _iso(m.created_at)}
        if not public:
            row.update({"subject_type": m.subject_type, "subject_id": m.subject_id, "question_key": m.question_key,
                        "visibility": m.visibility, "author_kind": m.author_kind})
        out.append(row)
    return out


def post(db: Session, vendor: Vendor, subject_type: str, subject_id: Optional[int], body: str, *, author_kind: str,
         user_id: Optional[int] = None, contact_id: Optional[int] = None, visibility: str = "internal",
         question_key: Optional[str] = None) -> TPRAMessage:
    """A message on a thread the caller found to be this supplier's; the caller commits.
    A contact's is always shared. ValueError when there is nothing to send."""
    text = (body or "").strip()
    if not text:
        raise ValueError("Write the message")
    if len(text) > MAX_TEXT:
        raise ValueError("Keep a message under 8,000 characters")
    m = TPRAMessage(tenant_id=vendor.tenant_id, vendor_id=vendor.id, subject_type=subject_type, subject_id=subject_id,
                    question_key=str(question_key)[:100] if question_key else None,
                    visibility="shared" if author_kind == "contact" else visibility, author_kind=author_kind,
                    author_user_id=user_id, author_contact_id=contact_id, body=text)
    db.add(m)
    db.flush()
    return m


def unread(db: Session, vendor_id: int, seen_at: Optional[datetime]) -> Dict[Tuple[str, Optional[int]], int]:
    """Our shared messages since `seen_at`, counted per thread."""
    M = TPRAMessage
    q = db.query(M.subject_type, M.subject_id, func.count(M.id)).filter(
        M.vendor_id == vendor_id, M.visibility == "shared", M.author_kind != "contact")
    if seen_at is not None:
        q = q.filter(M.created_at > seen_at)
    return {(t, i): n for t, i, n in q.group_by(M.subject_type, M.subject_id)}


# ── telling the supplier, telling us ─────────────────────────────────────────

def recipients(db: Session, vendor: Vendor, contact_id: Optional[int] = None,
               by: Optional[int] = None) -> List[TPRAVendorContact]:
    """Who hears from us: the contact a request is addressed to, while a link can go to
    them; else every contact of the supplier a link can go to (the contact on the
    supplier's record becomes one on first use, as for a questionnaire)."""
    chosen = db.get(TPRAVendorContact, contact_id) if contact_id else None
    if chosen is not None and chosen.vendor_id == vendor.id and contacts.reachable(chosen):
        return [chosen]
    rows = (db.query(TPRAVendorContact)
            .filter(TPRAVendorContact.vendor_id == vendor.id, TPRAVendorContact.archived_at.is_(None),
                    TPRAVendorContact.portal_access.is_(True), TPRAVendorContact.email.isnot(None))
            .order_by(TPRAVendorContact.is_primary.desc(), TPRAVendorContact.id).all())
    if not rows:
        first = contacts.recipient(db, vendor, by)
        rows = [first] if first is not None else []
    return rows


def email_supplier(db: Session, vendor: Vendor, contact_id: Optional[int], purpose: str, path: str, key: str,
                   values: dict, by: Optional[int]) -> List[dict]:
    """Email each recipient a fresh personal link opening `path` under their portal home.
    Commits (the links and whatever the caller wrote) before any email goes; each email
    is best effort. Returns who was written to and whether it went."""
    issued = [(c, *contacts.issue(db, c, purpose, by)) for c in recipients(db, vendor, contact_id, by)]
    db.commit()
    organisation = db.query(Tenant.name).filter(Tenant.id == vendor.tenant_id).scalar() or ""
    sent = []
    for c, raw, _ in issued:
        subject_line, text, html = render(db, vendor.tenant_id, key, {
            **values, "contact": c.name, "vendor": vendor.name, "link": portal.supplier_link(raw) + path,
            "organisation": organisation})
        sent.append({"contact_id": c.id, "name": c.name, "email": c.email,
                     "emailed": bool(contacts.deliver(db, vendor.tenant_id, c.email, subject_line, text, html))})
    return sent


def tell_us(db: Session, vendor: Vendor, r: Optional[TPRASupplierRequest], title: str) -> None:
    """Whoever asked and the supplier's owner hear that the supplier answered or wrote, in
    the app and by email, once the supplier's write is committed. Never fails the supplier."""
    from ...workflow_engine.services.notification_service import send_workflow_notification

    people = [p for p in dict.fromkeys([r.requested_by if r is not None else None, vendor.owner_id]) if p]
    if not people:
        return
    link = f"/vendor-risk/vendors/{vendor.id}?tab=portal" + (f"&request={r.id}" if r is not None else "")
    try:
        subject_line, message, _ = render(db, vendor.tenant_id, "supplier_responded",
                                          {"title": title, "link": link, "vendor": vendor.name})
        send_workflow_notification(db, tenant_id=vendor.tenant_id, subject=subject_line[:500], message=message,
                                   workflow_instance_id=None, user_ids=people, channels=["in_app", "email"],
                                   notification_type="info", link=link)
        db.commit()
    except Exception:  # noqa: BLE001 — the supplier's answer is saved either way
        logger.warning("supplier response notice for vendor %s not sent", vendor.id, exc_info=True)
        db.rollback()


# ── the supplier's side (called by tpra/supplier_portal.py) ──────────────────

def for_portal(db: Session, vendor: Vendor, seen_at: Optional[datetime]) -> Tuple[List[dict], dict]:
    """The supplier's requests, those waiting on it first by due date, then the rest newest
    first; and its own thread: our shared messages since `seen_at`, and the latest."""
    now = datetime.utcnow()
    R, F = TPRASupplierRequest, TPRASupplierRequestFile
    rows = (db.query(R).filter(R.vendor_id == vendor.id, or_(R.status.in_(LIVE),
                                                              R.updated_at >= now - timedelta(days=RECENT_DAYS)))
            .order_by(R.requested_at.desc(), R.id.desc()).all())
    files = dict(db.query(F.request_id, func.count(F.id)).filter(F.request_id.in_([r.id for r in rows] or [-1]))
                 .group_by(F.request_id))
    new = unread(db, vendor.id, seen_at)
    labels = _labels(db, vendor.tenant_id)
    items = [{**_public(r, labels, now.date()), "file_count": files.get(r.id, 0), "unread": new.get(("request", r.id), 0)}
             for r in rows]
    waiting = sorted((i for i in items if i["open"]), key=lambda i: (i["due_date"] is None, i["due_date"] or ""))
    latest = message_rows(db, thread(db, vendor.id, "vendor", shared_only=True, limit=50), public=True)
    return waiting + [i for i in items if not i["open"]], {"unread": new.get(("vendor", None), 0), "latest": latest}


def portal_detail(db: Session, r: TPRASupplierRequest) -> dict:
    return {**_public(r, _labels(db, r.tenant_id), datetime.utcnow().date()),
            "files": _files(db, [r.id], public=True).get(r.id, []),
            "response_text": r.response_text, "plan_text": r.plan_text, "target_date": _iso(r.target_date),
            "messages": message_rows(db, thread(db, r.vendor_id, "request", r.id, shared_only=True), public=True)}


def _waiting(r: TPRASupplierRequest) -> None:
    if r.status not in WAITING:
        raise HTTPException(409, "This request is not waiting on you now.")


async def upload(db: Session, vendor: Vendor, r: TPRASupplierRequest, contact: TPRAVendorContact, file: UploadFile,
                 coverage_from: Optional[date], coverage_to: Optional[date], expires_on: Optional[date]) -> dict:
    """A supplier's file for a request, hardened as a questionnaire upload is: allowed types
    only, a bounded 25 MB read, a name of our own on disk, a cap per request. It goes into
    the evidence library at once, with the expiry the supplier gives, and is read and
    rated there like every upload; it becomes the supplier's paperwork on acceptance."""
    _waiting(r)
    if coverage_from and coverage_to and coverage_to < coverage_from:
        raise HTTPException(400, "The period it covers ends before it starts")
    name = (file.filename or "").strip()
    ext = os.path.splitext(name)[1].lower()
    if ext not in routes._ALLOWED_EVIDENCE_EXT:
        raise HTTPException(415, f"File type '{ext or 'unknown'}' is not allowed. "
                                 f"Allowed: {', '.join(sorted(routes._ALLOWED_EVIDENCE_EXT))}")
    if db.query(TPRASupplierRequestFile.id).filter(TPRASupplierRequestFile.request_id == r.id).count() >= MAX_FILES:
        raise HTTPException(429, "Upload limit reached for this request.")
    contents = await file.read(routes._MAX_EVIDENCE_BYTES + 1)
    if len(contents) > routes._MAX_EVIDENCE_BYTES:
        raise HTTPException(413, f"File exceeds the {routes._MAX_EVIDENCE_BYTES // (1024 * 1024)} MB limit.")
    if not contents:
        raise HTTPException(400, "Empty file.")
    path = os.path.join(routes.EVIDENCE_UPLOAD_DIR, f"{uuid.uuid4()}{ext}")
    with open(path, "wb") as fh:
        fh.write(contents)
    shown, now = (os.path.basename(name) or os.path.basename(path))[:255], datetime.utcnow()
    ev = Evidence(tenant_id=vendor.tenant_id, name=f"{vendor.name}: {shown}"[:255],
                  description=f"Sent by the supplier for the request: {r.title}"[:2000], file_path=path,
                  file_name=shown, file_type=file.content_type, uploaded_at=now, status="pending_review",
                  ocr_status="pending", evidence_type="vendor_request", source_system="vendor_portal",
                  collection_date=now, expiry_date=datetime.combine(expires_on, time.min) if expires_on else None)
    db.add(ev)
    db.flush()
    f = TPRASupplierRequestFile(tenant_id=vendor.tenant_id, request_id=r.id, evidence_id=ev.id, file_name=shown,
                                file_size=len(contents), coverage_from=coverage_from, coverage_to=coverage_to,
                                contact_id=contact.id)
    db.add(f)
    db.commit()
    evidence_review.rate_upload(db, ev)
    return _files(db, [r.id], public=True)[r.id][-1]


def withdraw_file(db: Session, r: TPRASupplierRequest, file_id: int) -> dict:
    """A file the supplier takes back before sending: it leaves the library too, as a
    questionnaire's does."""
    _waiting(r)
    f = db.query(TPRASupplierRequestFile).filter(TPRASupplierRequestFile.id == file_id,
                                                 TPRASupplierRequestFile.request_id == r.id).first()
    if f is None:
        raise HTTPException(404, "That file is not on this request")
    ev = db.get(Evidence, f.evidence_id)
    if ev is not None:
        ev.status = "archived"
        if ev.file_path and os.path.exists(ev.file_path):
            os.remove(ev.file_path)
    db.delete(f)
    db.commit()
    return {"deleted": True, "id": file_id}


class SubmitIn(BaseModel):
    response_text: Optional[str] = Field(None, max_length=MAX_TEXT)
    plan_text: Optional[str] = Field(None, max_length=MAX_TEXT)        # a finding's: how it will be fixed
    target_date: Optional[date] = None                                 # ... and by when


def submit(db: Session, vendor: Vendor, r: TPRASupplierRequest, contact: TPRAVendorContact, body: SubmitIn) -> dict:
    """The supplier's answer, sent for review: a document needs a file, information an
    answer or a file, a finding a plan and a date."""
    _waiting(r)
    response, plan = _text(body.response_text), _text(body.plan_text)
    files = db.query(TPRASupplierRequestFile.id).filter(TPRASupplierRequestFile.request_id == r.id).count()
    if r.kind == "document" and not files:
        raise HTTPException(400, "Attach the document first")
    if r.kind == "information" and not (response or files):
        raise HTTPException(400, "Write your answer or attach a file")
    if r.kind == "finding" and not (plan and body.target_date):
        raise HTTPException(400, "Say how you will fix it and by when")
    before = r.status
    r.response_text = response
    r.plan_text, r.target_date = (plan, body.target_date) if r.kind == "finding" else (None, None)
    r.status, r.responded_at, r.responded_by_contact_id = "submitted", datetime.utcnow(), contact.id
    service.write_audit(db, r.tenant_id, entity="supplier_request", action="submit", vendor_id=vendor.id,
                        assessment_id=r.assessment_id, entity_id=r.id, from_value=before, to_value="submitted",
                        extra={"contact_id": contact.id, "files": files})
    db.commit()
    tell_us(db, vendor, r, f"{vendor.name} answered the request '{r.title}'")
    return portal_detail(db, r)


def supplier_writes(db: Session, vendor: Vendor, contact: TPRAVendorContact,
                    about: Optional[TPRASupplierRequest], body: str) -> dict:
    """A contact's message, on the supplier's thread or a request's."""
    m = post(db, vendor, "request" if about is not None else "vendor", about.id if about is not None else None, body,
             author_kind="contact", contact_id=contact.id)
    db.commit()
    tell_us(db, vendor, about, f"{vendor.name} sent a message"
            + (f" about the request '{about.title}'" if about is not None else ""))
    return message_rows(db, [m], public=True)[0]


# ── REST (signed in) ─────────────────────────────────────────────────────────

def cancel_open(db: Session, vendor: Vendor, by: Optional[int], reason: Optional[str]) -> List[int]:
    """Every request still with or from the supplier is cancelled, as offboarding closes its
    side. Audited once; the caller commits."""
    rows = (db.query(TPRASupplierRequest)
            .filter(TPRASupplierRequest.vendor_id == vendor.id, TPRASupplierRequest.status.in_(LIVE))
            .order_by(TPRASupplierRequest.id).all())
    for r in rows:
        r.status = "cancelled"
    if rows:
        service.write_audit(db, vendor.tenant_id, entity="supplier_request", action="cancel", vendor_id=vendor.id,
                            actor_id=by, to_value=len(rows), reason=reason, extra={"request_ids": [r.id for r in rows]})
    return [r.id for r in rows]


def _one(db: Session, vendor: Vendor, request_id: int) -> TPRASupplierRequest:
    r = db.query(TPRASupplierRequest).filter(TPRASupplierRequest.id == request_id,
                                             TPRASupplierRequest.vendor_id == vendor.id).first()
    if r is None:
        raise HTTPException(404, "Request not found")
    return r


def _fields(db: Session, vendor: Vendor, data: dict, kind: str, by: int) -> dict:
    """The given fields, clean; HTTP 400 for what cannot be sent."""
    out = {}
    if "evidence_kind" in data:
        out["evidence_kind"] = api._requirement(db, vendor.tenant_id, data["evidence_kind"]) if kind == "document" else None
    if "title" in data:
        title = contacts._clean(data["title"], 255)
        if not title and out.get("evidence_kind"):
            title = _labels(db, vendor.tenant_id)[out["evidence_kind"]][:255]
        if not title:
            raise HTTPException(400, "Say what you are asking for")
        out["title"] = title
    if "detail" in data:
        out["detail"] = _text(data["detail"])
    if "due_date" in data:
        if data["due_date"] is not None and data["due_date"] < datetime.utcnow().date():
            raise HTTPException(400, "The due date has passed")
        out["due_date"] = data["due_date"]
    if "contact_id" in data:
        if data["contact_id"]:
            try:
                contacts.recipient(db, vendor, by, contact_id=data["contact_id"])
            except ValueError as exc:
                raise HTTPException(400, str(exc))
        out["contact_id"] = data["contact_id"] or None
    return out


def _ask(db: Session, vendor: Vendor, user: GRCUser, kind: str, fields: dict,
         finding: Optional[TPRAFinding] = None) -> dict:
    """A new request, on the supplier's active assessment (a finding's on the finding's),
    emailed to the supplier. Commits."""
    active = service.get_active_assessment(db, vendor) if finding is None else None
    r = TPRASupplierRequest(tenant_id=vendor.tenant_id, vendor_id=vendor.id, kind=kind, status="open",
                            assessment_id=finding.assessment_id if finding is not None else active.id if active else None,
                            finding_id=finding.id if finding is not None else None, requested_by=user.id, **fields)
    db.add(r)
    db.flush()
    service.write_audit(db, vendor.tenant_id, entity="supplier_request", action="create", vendor_id=vendor.id,
                        assessment_id=r.assessment_id, entity_id=r.id, actor_id=user.id, to_value=r.title,
                        extra={"kind": kind, "finding_id": r.finding_id, "due_date": _iso(r.due_date)})
    sent = email_supplier(db, vendor, r.contact_id, "supplier_request", f"/requests/{r.id}", "supplier_request",
                          {"title": r.title, "due": due_words(r.due_date)}, user.id)
    return {**describe(db, [r])[0], "sent": sent}


@router.get("/vendors/{vendor_id}/supplier-requests")
def list_requests(vendor_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Answers waiting on us first, then requests waiting on the supplier, then the
    finished; newest first within each. With the evidence types a document can be."""
    v = _vendor(db, _tenant(db, user), vendor_id)
    rows = (db.query(TPRASupplierRequest).filter(TPRASupplierRequest.vendor_id == v.id)
            .order_by(TPRASupplierRequest.requested_at.desc(), TPRASupplierRequest.id.desc()).all())
    rows.sort(key=lambda r: _ORDER.get(r.status, 9))
    kinds = customisation.evidence_kinds(get_tiering_config(db, v.tenant_id).get("customisation"))
    return {"items": describe(db, rows), "evidence_kinds": [{"key": k, "label": label} for k, label in kinds.items()]}


class RequestIn(BaseModel):
    kind: Literal["document", "information"] = "document"
    title: Optional[str] = Field(None, max_length=255)          # a document's defaults to its evidence type
    detail: Optional[str] = Field(None, max_length=MAX_TEXT)
    evidence_kind: Optional[str] = Field(None, max_length=40)
    due_date: Optional[date] = None
    contact_id: Optional[int] = None                           # none: every contact with portal access


@router.post("/vendors/{vendor_id}/supplier-requests", status_code=201)
def create_request(vendor_id: int, body: RequestIn, db: Session = Depends(get_db),
                   user: GRCUser = Depends(require_auth)):
    v = _vendor(db, _tenant(db, user), vendor_id)
    rbac.require_write(db, user, "vendors", "edit")
    return _ask(db, v, user, body.kind, _fields(db, v, body.model_dump(exclude={"kind"}), body.kind, user.id))


class RequestUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=255)
    detail: Optional[str] = Field(None, max_length=MAX_TEXT)
    evidence_kind: Optional[str] = Field(None, max_length=40)
    due_date: Optional[date] = None
    contact_id: Optional[int] = None


@router.put("/vendors/{vendor_id}/supplier-requests/{request_id}")
def update_request(vendor_id: int, request_id: int, body: RequestUpdate, db: Session = Depends(get_db),
                   user: GRCUser = Depends(require_auth)):
    """Only while it waits on the supplier; a field left out keeps its value."""
    v = _vendor(db, _tenant(db, user), vendor_id)
    r = _one(db, v, request_id)
    rbac.require_write(db, user, "vendors", "edit")
    if r.status not in WAITING:
        raise HTTPException(409, "A request can change only while it waits on the supplier")
    fields = _fields(db, v, body.model_dump(exclude_unset=True), r.kind, user.id)
    changed = [k for k, value in fields.items() if getattr(r, k) != value]
    for key in changed:
        setattr(r, key, fields[key])
    if changed:
        service.write_audit(db, v.tenant_id, entity="supplier_request", action="update", vendor_id=v.id,
                            assessment_id=r.assessment_id, entity_id=r.id, actor_id=user.id, to_value=", ".join(changed))
        db.commit()
    return describe(db, [r])[0]


class CancelIn(BaseModel):
    reason: Optional[str] = Field(None, max_length=4000)


@router.post("/vendors/{vendor_id}/supplier-requests/{request_id}/cancel")
def cancel_request(vendor_id: int, request_id: int, body: CancelIn = CancelIn(), db: Session = Depends(get_db),
                   user: GRCUser = Depends(require_auth)):
    v = _vendor(db, _tenant(db, user), vendor_id)
    r = _one(db, v, request_id)
    rbac.require_write(db, user, "vendors", "edit")
    if r.status not in LIVE:
        raise HTTPException(409, "This request is already finished")
    before, r.status = r.status, "cancelled"
    service.write_audit(db, v.tenant_id, entity="supplier_request", action="cancel", vendor_id=v.id,
                        assessment_id=r.assessment_id, entity_id=r.id, actor_id=user.id, from_value=before,
                        to_value="cancelled", reason=_text(body.reason, 4000))
    db.commit()
    return describe(db, [r])[0]


class AcceptIn(BaseModel):
    note: Optional[str] = Field(None, max_length=4000)        # ours: the supplier does not see it
    # A shared finding: leave it be, record the supplier's plan as its remediation, or
    # close it, the fix verified.
    finding: Literal["keep", "plan", "close"] = "keep"


def _settle(db: Session, finding: TPRAFinding, r: TPRASupplierRequest, how: str, user: GRCUser) -> None:
    """The supplier's plan as the finding's remediation, due on the supplier's date; when
    closing, completed and the finding closed. Through the findings' own endpoints, which
    check, audit and commit."""
    made = api.create_remediation(finding.id, api.RemediationIn(
        title=f"Supplier's plan: {r.title}"[:255], plan=r.plan_text,
        due_date=datetime.combine(r.target_date, time.min) if r.target_date else None), db=db, user=user)
    if how == "close":
        api.update_remediation(made["id"], api.RemediationUpdate(status="completed"), db=db, user=user)
        api.update_finding(finding.id, api.FindingUpdate(status="closed"), db=db, user=user)


@router.post("/vendors/{vendor_id}/supplier-requests/{request_id}/accept")
def accept_request(vendor_id: int, request_id: int, body: AcceptIn = AcceptIn(), db: Session = Depends(get_db),
                   user: GRCUser = Depends(require_auth)):
    """Each file sent becomes the supplier's paperwork, reviewed by whoever accepts."""
    v = _vendor(db, _tenant(db, user), vendor_id)
    r = _one(db, v, request_id)
    rbac.require_write(db, user, "vendors", "edit")
    if r.status != "submitted":
        raise HTTPException(409, "Only an answer the supplier sent can be accepted")
    finding = None
    if body.finding != "keep":
        finding = db.get(TPRAFinding, r.finding_id) if r.kind == "finding" and r.finding_id else None
        if finding is None or finding.deleted_at is not None or finding.status not in _LIVE_FINDING:
            raise HTTPException(409, "There is no open finding behind this request to update")
        rbac.require_write(db, user, "findings", "edit")
    now = datetime.utcnow()
    r.status, r.reviewed_by, r.reviewed_at, r.review_note = "accepted", user.id, now, _text(body.note, 4000)
    for f in (db.query(TPRASupplierRequestFile)
              .filter(TPRASupplierRequestFile.request_id == r.id, TPRASupplierRequestFile.link_id.is_(None))
              .order_by(TPRASupplierRequestFile.id)):
        link = TPRAEvidenceLink(tenant_id=v.tenant_id, vendor_id=v.id, assessment_id=r.assessment_id,
                                finding_id=r.finding_id, evidence_id=f.evidence_id,
                                requirement=r.evidence_kind if r.kind == "document" else None,
                                coverage_from=f.coverage_from, coverage_to=f.coverage_to, reviewed_by=user.id,
                                reviewed_at=now, note=f"Sent by the supplier for: {r.title}", created_by=user.id)
        db.add(link)
        db.flush()
        f.link_id = link.id
        service.write_audit(db, v.tenant_id, entity="evidence", action="create", vendor_id=v.id,
                            assessment_id=r.assessment_id, entity_id=link.id, actor_id=user.id, to_value=f.file_name,
                            extra={"evidence_id": f.evidence_id, "supplier_request_id": r.id})
    service.write_audit(db, v.tenant_id, entity="supplier_request", action="accept", vendor_id=v.id,
                        assessment_id=r.assessment_id, entity_id=r.id, actor_id=user.id, from_value="submitted",
                        to_value="accepted", reason=r.review_note, extra={"finding": body.finding})
    if finding is not None:
        _settle(db, finding, r, body.finding, user)
    db.commit()
    return describe(db, [r])[0]


class ReturnIn(BaseModel):
    note: str = Field(..., max_length=4000)                   # the supplier reads it


@router.post("/vendors/{vendor_id}/supplier-requests/{request_id}/return")
def return_request(vendor_id: int, request_id: int, body: ReturnIn, db: Session = Depends(get_db),
                   user: GRCUser = Depends(require_auth)):
    """Back to the supplier with a note, which also goes on the request's thread and by email."""
    v = _vendor(db, _tenant(db, user), vendor_id)
    r = _one(db, v, request_id)
    rbac.require_write(db, user, "vendors", "edit")
    if r.status != "submitted":
        raise HTTPException(409, "Only an answer the supplier sent can be returned")
    note = _text(body.note, 4000)
    if not note:
        raise HTTPException(400, "Say what the supplier should change")
    r.status, r.reviewed_by, r.reviewed_at, r.review_note = "returned", user.id, datetime.utcnow(), note
    post(db, v, "request", r.id, note, author_kind="user", user_id=user.id, visibility="shared")
    service.write_audit(db, v.tenant_id, entity="supplier_request", action="return", vendor_id=v.id,
                        assessment_id=r.assessment_id, entity_id=r.id, actor_id=user.id, from_value="submitted",
                        to_value="returned", reason=note)
    sent = email_supplier(db, v, r.contact_id, "message", f"/requests/{r.id}", "supplier_message",
                          {"about": f"your answer to '{r.title}'", "message": note}, user.id)
    return {**describe(db, [r])[0], "sent": sent}


class ShareIn(BaseModel):
    title: Optional[str] = Field(None, max_length=255)         # the finding's unless changed
    note: Optional[str] = Field(None, max_length=MAX_TEXT)     # what the supplier is told about it
    due_date: date
    contact_id: Optional[int] = None


@router.post("/tpra/findings/{finding_id}/share", status_code=201)
def share_finding(finding_id: int, body: ShareIn, db: Session = Depends(get_db),
                  user: GRCUser = Depends(require_auth)):
    """Ask the supplier for a plan to fix a finding, a date and evidence."""
    tenant_id = _tenant(db, user)
    f = db.query(TPRAFinding).filter(TPRAFinding.id == finding_id, TPRAFinding.tenant_id == tenant_id,
                                     TPRAFinding.deleted_at.is_(None)).first()
    if f is None:
        raise HTTPException(404, "Finding not found")
    rbac.require_write(db, user, "findings", "edit")
    v = _vendor(db, tenant_id, f.vendor_id)
    if f.status not in _LIVE_FINDING:
        raise HTTPException(409, "Only an open finding can be shared")
    if db.query(TPRASupplierRequest.id).filter(TPRASupplierRequest.finding_id == f.id,
                                               TPRASupplierRequest.status.in_(LIVE)).first():
        raise HTTPException(409, "This finding is already shared with the supplier")
    fields = _fields(db, v, {"title": body.title or f.title or "A finding to fix", "detail": body.note,
                             "due_date": body.due_date, "contact_id": body.contact_id}, "finding", user.id)
    return _ask(db, v, user, "finding", fields, finding=f)


def _about(db: Session, vendor: Vendor, subject_type: str, subject_id: Optional[int]):
    try:
        return subject(db, vendor, subject_type, subject_id)
    except LookupError:
        raise HTTPException(404, "Not found")


Subject = Literal["vendor", "request", "questionnaire"]


@router.get("/vendors/{vendor_id}/messages")
def list_messages(vendor_id: int, subject_type: Subject = "vendor", subject_id: Optional[int] = None,
                  question_key: Optional[str] = None, db: Session = Depends(get_db),
                  user: GRCUser = Depends(require_auth)):
    """A thread, internal and shared alike, oldest first."""
    v = _vendor(db, _tenant(db, user), vendor_id)
    _about(db, v, subject_type, subject_id)
    return {"items": message_rows(db, thread(db, v.id, subject_type, None if subject_type == "vendor" else subject_id,
                                             question_key))}


class MessageIn(BaseModel):
    subject_type: Subject = "vendor"
    subject_id: Optional[int] = None
    question_key: Optional[str] = Field(None, max_length=100)
    visibility: Literal["internal", "shared"] = "internal"
    body: str = Field(..., max_length=MAX_TEXT)


@router.post("/vendors/{vendor_id}/messages", status_code=201)
def send_message(vendor_id: int, body: MessageIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Internal unless shared. A shared one is emailed to the supplier: to a request's or
    questionnaire's own contact when it has one, else to every contact with portal access."""
    v = _vendor(db, _tenant(db, user), vendor_id)
    rbac.require_write(db, user, "vendors", "edit")
    about = _about(db, v, body.subject_type, body.subject_id)
    try:
        m = post(db, v, body.subject_type, about.id if about is not None else None, body.body, author_kind="user",
                 user_id=user.id, visibility=body.visibility, question_key=body.question_key)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    service.write_audit(db, v.tenant_id, entity="message", action="create", vendor_id=v.id, entity_id=m.id,
                        actor_id=user.id, to_value=m.visibility,
                        extra={"subject_type": m.subject_type, "subject_id": m.subject_id})
    sent: List[dict] = []
    if m.visibility == "shared":
        if body.subject_type == "request":
            contact_id, path, words = about.contact_id, f"/requests/{about.id}", f"the request '{about.title}'"
        elif body.subject_type == "questionnaire":
            c = contacts.for_questionnaire(db, about)
            contact_id, path, words = (c.id if c else None), f"?q={about.id}", "your questionnaire"
        else:
            contact_id, path, words = None, "", v.name
        sent = email_supplier(db, v, contact_id, "message", path, "supplier_message",
                              {"about": words, "message": m.body}, user.id)
    else:
        db.commit()
    return {**message_rows(db, [m])[0], "sent": sent}
