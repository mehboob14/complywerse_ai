"""The supplier portal: what a supplier's contact sees through their personal link. No sign-in.

The link is the key. It opens the supplier's home: every questionnaire still
waiting on the supplier, whoever it was sent to, and those answered in the last
90 days, read-only. A questionnaire is answered here with the same code as through
a questionnaire's own link (routers/questionnaires.py), once it is found to be this
supplier's. An unknown, expired or revoked link, and another supplier's
questionnaire, all get the same answer, and failed lookups count against the
address they came from. A contact who lost their link asks for a new one by
email; the answer never says whether the address is known.

The home also lists what we asked the supplier for outside a questionnaire, and
the supplier's thread with us (tpra/supplier_requests.py): a request is answered
here, with files and a reply, and only shared messages are ever shown. Another
supplier's request gets the same answer as a link that does not work.

A questionnaire the supplier already sent opens read-only, with the comments a
reviewer shared on its questions (never an internal one); the contact replies on
the question, and the question's reviewers hear of it (tpra/reviews.py).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import List, Literal, Optional, Tuple

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from ....models import (
    Tenant, TPRAPortalToken, TPRASupplierRequest, TPRATemplateVersion, TPRAVendorContact, Vendor,
    VendorQuestionnaireResponse, VendorQuestionnaireTemplate, get_db,
)
from ..routers import questionnaires as routes
from . import contacts, portal, reviews, supplier_requests, versions

router = APIRouter(tags=["Supplier portal"])

GONE = "This link is no longer valid. Ask your contact for a new one, or request one below."
SENT = "If that address belongs to a supplier contact, a new link is on its way."
BUSY = "Too many requests. Wait a few minutes and try again."
RECENT_DAYS = 90
asks = portal.Throttle(limit=5, window=900.0)        # new-link requests, per address and per email


def _refuse(request: Request, status_code: int):
    portal.throttle.failed(portal.client_ip(request))
    raise HTTPException(status_code, GONE)


def resolve(db: Session, token: str, request: Request) -> Tuple[TPRAPortalToken, TPRAVendorContact, Vendor]:
    """The link, its contact and their supplier, if the link still works."""
    if portal.throttle.failing(portal.client_ip(request)):
        raise HTTPException(429, BUSY)
    row = db.query(TPRAPortalToken).filter(TPRAPortalToken.token_hash == portal.hash_token(token)).first()
    if row is None:
        _refuse(request, 404)
    contact, vendor = db.get(TPRAVendorContact, row.contact_id), db.get(Vendor, row.vendor_id)
    if (row.revoked_at is not None or row.expires_at <= datetime.utcnow() or contact is None
            or contact.archived_at is not None or not contact.portal_access
            or vendor is None or vendor.deleted_at is not None or vendor.status == "offboarded"):
        _refuse(request, 410)
    if not portal.throttle.allow(f"portal:{row.id}"):
        raise HTTPException(429, BUSY)
    return row, contact, vendor


def _questionnaire(db: Session, token: str, qid: int, request: Request,
                   allow_submitted: bool = False) -> Tuple[TPRAVendorContact, VendorQuestionnaireResponse]:
    """A questionnaire of the link's supplier, as the vendor may use it now. With
    `allow_submitted`, one already sent is there to read and talk about, whatever
    its own expiry: the personal link is the key."""
    _, contact, vendor = resolve(db, token, request)
    qr = db.query(VendorQuestionnaireResponse).filter(VendorQuestionnaireResponse.id == qid,
                                                      VendorQuestionnaireResponse.vendor_id == vendor.id).first()
    if qr is None:
        _refuse(request, 404)
    if allow_submitted and qr.status not in portal.WAITING_ON_VENDOR:
        return contact, qr
    return contact, routes.open_for_vendor(qr, allow_submitted)


def _request(db: Session, token: str, rid: int,
             request: Request) -> Tuple[TPRAVendorContact, Vendor, TPRASupplierRequest]:
    """A request to the link's supplier."""
    _, contact, vendor = resolve(db, token, request)
    r = db.query(TPRASupplierRequest).filter(TPRASupplierRequest.id == rid,
                                             TPRASupplierRequest.vendor_id == vendor.id).first()
    if r is None:
        _refuse(request, 404)
    return contact, vendor, r


# ── the home ─────────────────────────────────────────────────────────────────

def _iso(value) -> Optional[str]:
    return value.isoformat() if value else None


def _questions(db: Session, qr) -> Tuple[List[dict], Optional[str]]:
    """The questions as sent and their title, pinning nothing: the home writes nothing."""
    version = db.get(TPRATemplateVersion, qr.template_version_id) if qr.template_version_id else None
    if version is not None:
        return list(version.questions or []), version.name
    template = db.get(VendorQuestionnaireTemplate, qr.template_id) if qr.template_id else None
    return (versions.freeze(template.questions or []), template.name) if template else ([], None)


def _item(db: Session, qr, now: datetime, unread: int = 0) -> dict:
    questions, title = _questions(db, qr)
    answers = qr.responses or {}
    shown = portal.visible_questions(questions, answers)
    files = portal.evidence_keys(db, qr) if any(portal._type(q) == "file" for q in shown) else set()
    return {
        "id": qr.id, "title": title or "Questionnaire", "status": qr.status,
        "due_date": _iso(qr.due_date), "sent_at": _iso(qr.last_sent_at or qr.created_at),
        "expires_at": _iso(qr.expires_at), "submitted_at": _iso(qr.submitted_at),
        "progress": {"answered": sum(1 for q in shown if portal.answered(q, answers.get(str(q.get("id"))), files)),
                     "total": len(shown)},
        "returned_questions": len(portal.clarifications(qr.review)) if qr.status == "returned" else 0,
        # Answerable now; the rest are there to read about.
        "open": qr.status in portal.WAITING_ON_VENDOR and not (qr.expires_at and qr.expires_at < now),
        "unread": unread,                    # comments we shared on its questions since the last visit
    }


def home(db: Session, row: TPRAPortalToken, contact: TPRAVendorContact, vendor: Vendor,
         seen_at: Optional[datetime]) -> dict:
    """`seen_at`: the contact's visit before this one; our messages since then are new."""
    now = datetime.utcnow()
    since = now - timedelta(days=RECENT_DAYS)
    Q = VendorQuestionnaireResponse
    rows = db.query(Q).filter(Q.vendor_id == vendor.id, or_(
        and_(Q.status.in_(portal.WAITING_ON_VENDOR), or_(Q.expires_at.is_(None), Q.expires_at >= since)),
        and_(Q.status.in_(("submitted", "under_review", "accepted")), Q.submitted_at >= since),
    )).order_by(Q.created_at.desc(), Q.id.desc()).all()
    new = supplier_requests.unread(db, vendor.id, seen_at)
    items = [_item(db, qr, now, new.get(("questionnaire", qr.id), 0)) for qr in rows]
    waiting = sorted((i for i in items if i["status"] in portal.WAITING_ON_VENDOR),
                     key=lambda i: (i["due_date"] is None, i["due_date"] or ""))
    requests, messages = supplier_requests.for_portal(db, vendor, seen_at)
    return {
        "organisation": {"name": db.query(Tenant.name).filter(Tenant.id == vendor.tenant_id).scalar()},
        "supplier": {"name": vendor.name},
        "contact": {"name": contact.name, "email": contact.email},
        "expires_at": _iso(row.expires_at),
        "questionnaires": waiting + [i for i in items if i["status"] not in portal.WAITING_ON_VENDOR],
        "requests": requests,
        "messages": messages,
    }


# ── REST (declared before /portal/{token} so its literal path wins) ──────────

class LinkRequest(BaseModel):
    email: str = Field(..., max_length=255)


@router.post("/portal/request-link")
def request_link(body: LinkRequest, request: Request, background: BackgroundTasks, db: Session = Depends(get_db)):
    """A fresh link by email for a contact who lost theirs. The answer is the same
    whether or not the address is known, and the email goes after the answer."""
    address = portal.client_ip(request)
    if address and not asks.allow(f"ip:{address}"):
        raise HTTPException(429, BUSY)
    email = (body.email or "").strip().lower()
    if email and asks.allow(f"email:{email}"):
        for contact in db.query(TPRAVendorContact).filter(
                TPRAVendorContact.email == email, TPRAVendorContact.archived_at.is_(None),
                TPRAVendorContact.portal_access.is_(True)).order_by(TPRAVendorContact.id).limit(5).all():
            vendor = db.get(Vendor, contact.vendor_id)
            if vendor is None or vendor.deleted_at is not None or vendor.status == "offboarded":
                continue
            raw, row = contacts.issue(db, contact, "request")
            background.add_task(contacts.deliver_later,
                                db.query(Tenant.slug).filter(Tenant.id == contact.tenant_id).scalar(),
                                contact.tenant_id, contact.email,
                                *contacts.link_email(db, contact, vendor, portal.supplier_link(raw), row.expires_at))
        db.commit()
    return {"message": SENT}


@router.get("/portal/{token}")
def view_home(token: str, request: Request, db: Session = Depends(get_db)):
    """The supplier's home as it stands. Records nothing."""
    row, contact, vendor = resolve(db, token, request)
    return home(db, row, contact, vendor, contact.last_portal_at)


@router.post("/portal/{token}/open")
def open_home(token: str, request: Request, db: Session = Depends(get_db)):
    """The supplier's home, recording the visit (the page calls this once per load)."""
    row, contact, vendor = resolve(db, token, request)
    seen, now = contact.last_portal_at, datetime.utcnow()
    row.last_used_at, row.use_count, contact.last_portal_at = now, (row.use_count or 0) + 1, now
    db.commit()
    return home(db, row, contact, vendor, seen)


# One questionnaire, through the same code as its own link.
_Q = "/portal/{token}/questionnaires/{qid}"


def _comments(db: Session, qr) -> dict:
    """The comments a reviewer shared, and the supplier's replies, by question."""
    rows = supplier_requests.thread(db, qr.vendor_id, "questionnaire", qr.id, shared_only=True)
    out: dict = {}
    for m, row in zip(rows, supplier_requests.message_rows(db, rows, public=True)):
        out.setdefault(m.question_key or "", []).append(row)
    return out


@router.get(_Q)
def load_questionnaire(token: str, qid: int, request: Request, db: Session = Depends(get_db)):
    """Waiting on the supplier: to answer. Already sent: to read and reply on."""
    contact, qr = _questionnaire(db, token, qid, request, allow_submitted=True)
    return {**routes.vendor_view(db, qr, contact), "messages": _comments(db, qr)}


class ReplyIn(BaseModel):
    question_key: str = Field(..., max_length=100)
    body: str = Field(..., max_length=supplier_requests.MAX_TEXT)


@router.post(_Q + "/messages", status_code=201)
def reply(token: str, qid: int, body: ReplyIn, request: Request, db: Session = Depends(get_db)):
    """A contact's reply on one question, always shared."""
    contact, qr = _questionnaire(db, token, qid, request, allow_submitted=True)
    if body.question_key not in {str(q.get("id")) for q in versions.questions_for(db, qr)}:
        raise HTTPException(404, "That question is not in this questionnaire")
    vendor = db.get(Vendor, qr.vendor_id)
    try:
        m = supplier_requests.post(db, vendor, "questionnaire", qr.id, body.body, author_kind="contact",
                                   contact_id=contact.id, question_key=body.question_key)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    db.commit()
    title = _questions(db, qr)[1] or "the questionnaire"
    reviews.tell_reviewers(db, qr, body.question_key, f"{vendor.name} replied on a question in '{title}'")
    return supplier_requests.message_rows(db, [m], public=True)[0]


@router.post(_Q)
def save_questionnaire(token: str, qid: int, payload: routes.ExternalSubmitRequest, request: Request,
                       db: Session = Depends(get_db)):
    contact, qr = _questionnaire(db, token, qid, request)
    return routes._save_answers(db, qr, payload, contact)


@router.post(_Q + "/evidence/{question_id}")
async def upload_evidence(token: str, qid: int, question_id: str, request: Request, file: UploadFile = File(...),
                          expires_on: Optional[date] = Form(None), db: Session = Depends(get_db)):
    _, qr = _questionnaire(db, token, qid, request)
    return await routes.vendor_upload(db, qr, question_id, file, expires_on)


@router.get(_Q + "/evidence")
def list_evidence(token: str, qid: int, request: Request, db: Session = Depends(get_db)):
    _, qr = _questionnaire(db, token, qid, request, allow_submitted=True)
    return routes.vendor_evidence(db, qr)


@router.delete(_Q + "/evidence/{evidence_id}")
def delete_evidence(token: str, qid: int, evidence_id: int, request: Request, db: Session = Depends(get_db)):
    _, qr = _questionnaire(db, token, qid, request)
    return routes.vendor_delete_evidence(db, qr, evidence_id)


@router.get(_Q + "/workbook")
def download_workbook(token: str, qid: int, request: Request, db: Session = Depends(get_db)):
    return routes._workbook_file(db, _questionnaire(db, token, qid, request)[1])


@router.get(_Q + "/pdf")
def download_pdf(token: str, qid: int, request: Request, db: Session = Depends(get_db)):
    return routes._pdf_file(db, _questionnaire(db, token, qid, request)[1])


@router.post(_Q + "/workbook")
async def import_workbook(token: str, qid: int, request: Request, file: UploadFile = File(...),
                          db: Session = Depends(get_db)):
    contact, qr = _questionnaire(db, token, qid, request)
    return await routes.vendor_import_workbook(db, qr, file, contact)


# A request to the supplier: what is asked, its files, the answer, its thread.
_R = "/portal/{token}/requests/{rid}"


@router.get(_R)
def view_request(token: str, rid: int, request: Request, db: Session = Depends(get_db)):
    return supplier_requests.portal_detail(db, _request(db, token, rid, request)[2])


@router.post(_R + "/files")
async def upload_request_file(token: str, rid: int, request: Request, file: UploadFile = File(...),
                              coverage_from: Optional[date] = Form(None), coverage_to: Optional[date] = Form(None),
                              expires_on: Optional[date] = Form(None), db: Session = Depends(get_db)):
    contact, vendor, r = _request(db, token, rid, request)
    return await supplier_requests.upload(db, vendor, r, contact, file, coverage_from, coverage_to, expires_on)


@router.delete(_R + "/files/{fid}")
def delete_request_file(token: str, rid: int, fid: int, request: Request, db: Session = Depends(get_db)):
    return supplier_requests.withdraw_file(db, _request(db, token, rid, request)[2], fid)


@router.post(_R + "/submit")
def submit_request(token: str, rid: int, body: supplier_requests.SubmitIn, request: Request,
                   db: Session = Depends(get_db)):
    contact, vendor, r = _request(db, token, rid, request)
    return supplier_requests.submit(db, vendor, r, contact, body)


def _thread(db: Session, token: str, subject_type: str, subject_id: Optional[int],
            request: Request) -> Tuple[TPRAVendorContact, Vendor, Optional[TPRASupplierRequest]]:
    """The supplier's own thread, or a request's when the request is the supplier's."""
    if subject_type == "request":
        return _request(db, token, subject_id or 0, request)
    _, contact, vendor = resolve(db, token, request)
    return contact, vendor, None


@router.get("/portal/{token}/messages")
def list_messages(token: str, request: Request, subject_type: Literal["vendor", "request"] = "vendor",
                  subject_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Shared messages only, oldest first."""
    _, vendor, about = _thread(db, token, subject_type, subject_id, request)
    rows = supplier_requests.thread(db, vendor.id, subject_type, about.id if about is not None else None,
                                    shared_only=True)
    return {"items": supplier_requests.message_rows(db, rows, public=True)}


class MessageIn(BaseModel):
    body: str = Field(..., max_length=supplier_requests.MAX_TEXT)
    subject_type: Literal["vendor", "request"] = "vendor"
    subject_id: Optional[int] = None


@router.post("/portal/{token}/messages", status_code=201)
def post_message(token: str, body: MessageIn, request: Request, db: Session = Depends(get_db)):
    contact, vendor, about = _thread(db, token, body.subject_type, body.subject_id, request)
    try:
        return supplier_requests.supplier_writes(db, vendor, contact, about, body.body)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
