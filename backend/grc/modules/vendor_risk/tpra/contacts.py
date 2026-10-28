"""A supplier's contacts and their personal links to the supplier portal (signed-in side).

A supplier can have several contacts, each with roles, one of them primary. Each
contact with an email and portal access can be sent a personal link: emailed or
shown once to copy, valid 30 days unless chosen otherwise, and revocable. Only the
link's hash is kept (tpra/supplier_portal.py looks it up).

Until a supplier's first contact is written, the contact on its record
(primary_contact_*) is listed as one, and the first write makes it a row. Making a
contact primary copies it back to the record. A contact is archived, never
deleted; archiving it, changing its email or taking its portal access away
revokes its links.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta
from typing import Dict, List, Literal, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from ....models import GRCUser, Tenant, TPRAPortalToken, TPRAVendorContact, Vendor, get_db
from ....routers.auth_router import require_auth
from . import portal, rbac
from .emails import render
from .graph import _tenant, _vendor
from .service import write_audit

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Supplier contacts"])

ROLES = ("primary", "security", "privacy", "commercial", "legal", "technical", "billing")
Role = Literal["primary", "security", "privacy", "commercial", "legal", "technical", "billing"]
LINK_DAYS = 30
RECORD = "supplier record"


# ── contacts ─────────────────────────────────────────────────────────────────

def _clean(text, limit: int) -> Optional[str]:
    return " ".join(str(text or "").split())[:limit] or None


def clean_email(raw) -> Optional[str]:
    """An address in lower case, None for none; ValueError when it is not one."""
    email = str(raw or "").strip().lower()[:255]
    if email and ("@" not in email or "." not in email.split("@")[-1] or " " in email):
        raise ValueError("Give a valid email address")
    return email or None


def reachable(contact: Optional[TPRAVendorContact]) -> bool:
    """Whether a personal link can go to this contact."""
    return (contact is not None and contact.archived_at is None and bool(contact.portal_access)
            and bool(contact.email))


def link_problem(contact: TPRAVendorContact) -> Optional[str]:
    if contact.archived_at is not None:
        return "This contact is archived. Restore it first."
    if not contact.email:
        return "This contact has no email address. Add one first."
    if not contact.portal_access:
        return "This contact has no portal access. Turn it on first."
    return None


def _has_rows(db: Session, vendor_id: int) -> bool:
    return db.query(TPRAVendorContact.id).filter(TPRAVendorContact.vendor_id == vendor_id).first() is not None


def primary(db: Session, vendor_id: int) -> Optional[TPRAVendorContact]:
    return db.query(TPRAVendorContact).filter(
        TPRAVendorContact.vendor_id == vendor_id, TPRAVendorContact.is_primary.is_(True),
        TPRAVendorContact.archived_at.is_(None)).order_by(TPRAVendorContact.id).first()


def _record(vendor: Vendor) -> Optional[dict]:
    """The contact on the supplier's record, as a contact's fields."""
    email = (vendor.primary_contact_email or "").strip().lower()[:255] or None
    name = _clean(vendor.primary_contact_name, 255) or email
    return {"name": name, "email": email, "phone": _clean(vendor.primary_contact_phone, 100)} if name else None


def _roles(given, is_primary: bool) -> List[str]:
    """In the catalogue's order; "primary" goes with being the primary contact."""
    given = set(given or [])
    return [r for r in ROLES if (r == "primary" and is_primary) or (r != "primary" and r in given)]


def _make_primary(db: Session, vendor: Vendor, contact: TPRAVendorContact) -> None:
    """The one primary contact, copied to the supplier's record."""
    for other in db.query(TPRAVendorContact).filter(
            TPRAVendorContact.vendor_id == vendor.id, TPRAVendorContact.is_primary.is_(True),
            TPRAVendorContact.id != contact.id):
        other.is_primary, other.roles = False, _roles(other.roles, False)
    contact.is_primary, contact.roles = True, _roles(contact.roles, True)
    vendor.primary_contact_name, vendor.primary_contact_email = contact.name, contact.email
    vendor.primary_contact_phone = contact.phone


def _duplicate(db: Session, vendor_id: int, email: Optional[str], other_than: Optional[int] = None) -> bool:
    if not email:
        return False
    q = db.query(TPRAVendorContact.id).filter(TPRAVendorContact.vendor_id == vendor_id,
                                              TPRAVendorContact.email == email, TPRAVendorContact.archived_at.is_(None))
    if other_than:
        q = q.filter(TPRAVendorContact.id != other_than)
    return q.first() is not None


def _insert(db: Session, vendor: Vendor, by: Optional[int], **fields) -> TPRAVendorContact:
    contact = TPRAVendorContact(tenant_id=vendor.tenant_id, vendor_id=vendor.id, created_by=by, **fields)
    db.add(contact)
    db.flush()
    return contact


def add(db: Session, vendor: Vendor, by: Optional[int], *, name: str, email: Optional[str] = None,
        phone: Optional[str] = None, job_title: Optional[str] = None, roles=(), is_primary: bool = False,
        portal_access: bool = True, notes: Optional[str] = None) -> TPRAVendorContact:
    """A new contact on a supplier (fields already clean). The contact on the
    supplier's record becomes a row first, unless it is this person; a supplier's
    first contact is its primary."""
    if _duplicate(db, vendor.id, email):
        raise ValueError("This supplier already has a contact with that email")
    record = None if _has_rows(db, vendor.id) else _record(vendor)
    if record and not (record["email"] == email if record["email"] or email
                       else (record["name"] or "").lower() == name.lower()):
        _make_primary(db, vendor, _insert(db, vendor, by, roles=[], **record))
    contact = _insert(db, vendor, by, name=name, email=email, phone=phone, job_title=job_title,
                      roles=_roles(roles, False), portal_access=portal_access, notes=notes)
    if is_primary or primary(db, vendor.id) is None:
        _make_primary(db, vendor, contact)
    return contact


def recipient(db: Session, vendor: Vendor, by: Optional[int] = None, contact_id: Optional[int] = None,
              name: Optional[str] = None, email: Optional[str] = None) -> Optional[TPRAVendorContact]:
    """Who a questionnaire goes to: the contact chosen, the one named now (added
    when new), or else the supplier's primary contact (the one on its record,
    added on first use). None when there is nobody a link can go to; ValueError
    when the one chosen or named cannot have one."""
    if contact_id:
        contact = db.query(TPRAVendorContact).filter(TPRAVendorContact.id == contact_id,
                                                     TPRAVendorContact.vendor_id == vendor.id).first()
        if contact is None:
            raise ValueError("That contact is not one of this supplier's")
        problem = link_problem(contact)
        if problem:
            raise ValueError(problem)
        return contact
    email = clean_email(email)
    if email:
        contact = db.query(TPRAVendorContact).filter(TPRAVendorContact.vendor_id == vendor.id,
                                                     TPRAVendorContact.email == email,
                                                     TPRAVendorContact.archived_at.is_(None)).first()
        if contact is None:
            return add(db, vendor, by, name=_clean(name, 255) or email, email=email)
        problem = link_problem(contact)
        if problem:
            raise ValueError(problem)
        return contact
    contact = primary(db, vendor.id)
    if contact is None and not _has_rows(db, vendor.id):
        record = _record(vendor)
        if record and record["email"]:
            contact = add(db, vendor, by, **record)
    return contact if reachable(contact) else None


def for_questionnaire(db: Session, qr) -> Optional[TPRAVendorContact]:
    """Where a questionnaire's personal links go: its contact, or else the
    supplier's primary contact; None when neither can have one."""
    contact = db.get(TPRAVendorContact, qr.contact_id) if qr.contact_id else None
    if not reachable(contact):
        contact = primary(db, qr.vendor_id)
    return contact if reachable(contact) else None


# ── links ────────────────────────────────────────────────────────────────────

def issue(db: Session, contact: TPRAVendorContact, purpose: str, by: Optional[int] = None,
          days: int = LINK_DAYS) -> Tuple[str, TPRAPortalToken]:
    """A fresh personal link: (the raw token, its row). The raw token exists only
    in what this returns; the row keeps its hash. The caller commits."""
    raw, now = secrets.token_urlsafe(32), datetime.utcnow()
    row = TPRAPortalToken(tenant_id=contact.tenant_id, vendor_id=contact.vendor_id, contact_id=contact.id,
                          token_hash=portal.hash_token(raw), purpose=purpose, created_by=by, created_at=now,
                          expires_at=now + timedelta(days=days), use_count=0)
    db.add(row)
    db.flush()
    return raw, row


def _live(db: Session):
    now = datetime.utcnow()
    return db.query(TPRAPortalToken).filter(TPRAPortalToken.revoked_at.is_(None), TPRAPortalToken.expires_at > now)


def _revoke(rows, by: Optional[int]) -> int:
    now, n = datetime.utcnow(), 0
    for row in rows:
        row.revoked_at, row.revoked_by, n = now, by, n + 1
    return n


def revoke_all(db: Session, vendor_id: int, by: Optional[int], reason: Optional[str] = None) -> int:
    """Every live link of a supplier stops working (offboarding calls this too).
    Audited here; the caller commits."""
    n = _revoke(_live(db).filter(TPRAPortalToken.vendor_id == vendor_id).all(), by)
    vendor = db.get(Vendor, vendor_id)
    if n and vendor is not None:
        write_audit(db, vendor.tenant_id, entity="portal_link", action="revoke_all", vendor_id=vendor_id,
                    actor_id=by, to_value=n, reason=reason)
    return n


def _revoke_contact(db: Session, contact: TPRAVendorContact, by: Optional[int]) -> int:
    return _revoke(_live(db).filter(TPRAPortalToken.contact_id == contact.id).all(), by)


def deliver(db: Session, tenant_id: int, to: str, subject: str, text: str, html: str) -> bool:
    """Best effort: True when the email went. The link was issued either way."""
    from ...workflow_engine.services.email_service import send_email

    try:
        return bool(send_email(db, tenant_id, to, subject, html, text).get("success"))
    except Exception:  # noqa: BLE001 — never fail the caller over an email
        logger.warning("supplier portal email for tenant %s not sent", tenant_id, exc_info=True)
        return False


def deliver_later(slug: Optional[str], tenant_id: int, to: str, subject: str, text: str, html: str) -> None:
    """The same, after the response has gone, on a session of its own."""
    from ....db import open_tenant_session

    if not slug:
        return
    db = open_tenant_session(slug)
    try:
        deliver(db, tenant_id, to, subject, text, html)
    finally:
        db.close()


def link_email(db: Session, contact: TPRAVendorContact, vendor: Vendor, link: str,
               expires_at: datetime) -> Tuple[str, str, str]:
    """(subject, text, html) of the email carrying a contact's personal link."""
    organisation = db.query(Tenant.name).filter(Tenant.id == contact.tenant_id).scalar()
    return render(db, contact.tenant_id, "portal_link", {
        "contact": contact.name, "vendor": vendor.name, "link": link, "expires": f"{expires_at:%d %b %Y}",
        "organisation": organisation or ""})


# ── REST ─────────────────────────────────────────────────────────────────────

def _names(db: Session, ids) -> Dict[int, str]:
    ids = {int(i) for i in ids if i}
    return {u.id: u.display_name or u.username or u.email
            for u in db.query(GRCUser).filter(GRCUser.id.in_(ids))} if ids else {}


def _iso(value) -> Optional[str]:
    return value.isoformat() if value else None


def _row(c: TPRAVendorContact) -> dict:
    return {"id": c.id, "source": "contact", "vendor_id": c.vendor_id, "name": c.name, "email": c.email,
            "phone": c.phone, "job_title": c.job_title, "roles": c.roles or [], "is_primary": bool(c.is_primary),
            "portal_access": bool(c.portal_access), "notes": c.notes, "last_portal_at": _iso(c.last_portal_at),
            "created_at": _iso(c.created_at), "updated_at": _iso(c.updated_at), "archived_at": _iso(c.archived_at)}


def _record_row(vendor: Vendor) -> Optional[dict]:
    record = _record(vendor)
    if record is None:
        return None
    return {"id": None, "source": RECORD, "vendor_id": vendor.id, **record, "job_title": None, "roles": ["primary"],
            "is_primary": True, "portal_access": True, "notes": None, "last_portal_at": None, "created_at": None,
            "updated_at": None, "archived_at": None}


def _contact(db: Session, vendor: Vendor, contact_id: int) -> TPRAVendorContact:
    c = db.query(TPRAVendorContact).filter(TPRAVendorContact.id == contact_id,
                                           TPRAVendorContact.vendor_id == vendor.id).first()
    if c is None:
        raise HTTPException(404, "Contact not found")
    return c


class ContactIn(BaseModel):
    name: str = Field(..., max_length=255)
    email: Optional[str] = Field(None, max_length=255)
    phone: Optional[str] = Field(None, max_length=100)
    job_title: Optional[str] = Field(None, max_length=255)
    roles: List[Role] = Field(default_factory=list, max_length=len(ROLES))
    is_primary: bool = False
    portal_access: bool = True
    notes: Optional[str] = Field(None, max_length=4000)


class ContactUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    email: Optional[str] = Field(None, max_length=255)
    phone: Optional[str] = Field(None, max_length=100)
    job_title: Optional[str] = Field(None, max_length=255)
    roles: Optional[List[Role]] = Field(None, max_length=len(ROLES))
    is_primary: Optional[bool] = None
    portal_access: Optional[bool] = None
    notes: Optional[str] = Field(None, max_length=4000)


def _fields(data: dict) -> dict:
    """The given fields, clean; ValueError on a missing name or a bad email."""
    out = dict(data)
    for key, limit in (("name", 255), ("phone", 100), ("job_title", 255)):
        if key in out:
            out[key] = _clean(out[key], limit)
    if "name" in out and not out["name"]:
        raise ValueError("Give the contact's name")
    if "email" in out:
        out["email"] = clean_email(out["email"])
    if "notes" in out:
        out["notes"] = (out["notes"] or "").strip() or None
    return out


@router.get("/vendors/{vendor_id}/contacts")
def list_contacts(vendor_id: int, include_archived: bool = False, db: Session = Depends(get_db),
                  user: GRCUser = Depends(require_auth)):
    """Primary first, then by name. Before any is written, the contact on the
    supplier's record stands in as one (id null); nothing is written here."""
    v = _vendor(db, _tenant(db, user), vendor_id)
    q = db.query(TPRAVendorContact).filter(TPRAVendorContact.vendor_id == v.id)
    if not include_archived:
        q = q.filter(TPRAVendorContact.archived_at.is_(None))
    rows = q.order_by(TPRAVendorContact.is_primary.desc(), func.lower(TPRAVendorContact.name),
                      TPRAVendorContact.id).all()
    items = [_row(c) for c in rows]
    if not items and not _has_rows(db, v.id):
        items = [r for r in [_record_row(v)] if r]
    return {"items": items, "roles": list(ROLES)}


@router.post("/vendors/{vendor_id}/contacts", status_code=201)
def create_contact(vendor_id: int, body: ContactIn, db: Session = Depends(get_db),
                   user: GRCUser = Depends(require_auth)):
    v = _vendor(db, _tenant(db, user), vendor_id)
    rbac.require_write(db, user, "vendors", "edit")
    try:
        c = add(db, v, user.id, **_fields(body.model_dump()))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    write_audit(db, v.tenant_id, entity="contact", action="create", vendor_id=v.id, entity_id=c.id,
                actor_id=user.id, to_value=c.name)
    db.commit()
    return _row(c)


@router.put("/vendors/{vendor_id}/contacts/{contact_id}")
def update_contact(vendor_id: int, contact_id: int, body: ContactUpdate, db: Session = Depends(get_db),
                   user: GRCUser = Depends(require_auth)):
    v = _vendor(db, _tenant(db, user), vendor_id)
    rbac.require_write(db, user, "vendors", "edit")
    c = _contact(db, v, contact_id)
    if c.archived_at is not None:
        raise HTTPException(409, "Restore this contact before changing it.")
    try:
        data = _fields(body.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if "email" in data and data["email"] != c.email:
        if _duplicate(db, v.id, data["email"], other_than=c.id):
            raise HTTPException(400, "This supplier already has a contact with that email")
        _revoke_contact(db, c, user.id)               # the old address's links must not keep working
    if data.get("portal_access") is False:
        _revoke_contact(db, c, user.id)
    before = f"{c.name} <{c.email or ''}>"
    for key in ("name", "email", "phone", "job_title", "portal_access", "notes"):
        if key in data and (data[key] is not None or key not in ("name", "portal_access")):
            setattr(c, key, data[key])
    if data.get("roles") is not None:
        c.roles = _roles(data["roles"], bool(c.is_primary))
    if data.get("is_primary") is True or (c.is_primary and data.get("is_primary") is not False):
        _make_primary(db, v, c)                       # the record follows the primary's details
    elif data.get("is_primary") is False:
        c.is_primary, c.roles = False, _roles(c.roles, False)
    write_audit(db, v.tenant_id, entity="contact", action="update", vendor_id=v.id, entity_id=c.id,
                actor_id=user.id, from_value=before, to_value=f"{c.name} <{c.email or ''}>")
    db.commit()
    return _row(c)


@router.post("/vendors/{vendor_id}/contacts/{contact_id}/archive")
def archive_contact(vendor_id: int, contact_id: int, db: Session = Depends(get_db),
                    user: GRCUser = Depends(require_auth)):
    v = _vendor(db, _tenant(db, user), vendor_id)
    rbac.require_write(db, user, "vendors", "edit")
    c = _contact(db, v, contact_id)
    if c.archived_at is None:
        c.archived_at = datetime.utcnow()
        c.is_primary, c.roles = False, _roles(c.roles, False)
        revoked = _revoke_contact(db, c, user.id)
        write_audit(db, v.tenant_id, entity="contact", action="archive", vendor_id=v.id, entity_id=c.id,
                    actor_id=user.id, to_value=c.name, extra={"links_revoked": revoked})
        db.commit()
    return _row(c)


@router.post("/vendors/{vendor_id}/contacts/{contact_id}/restore")
def restore_contact(vendor_id: int, contact_id: int, db: Session = Depends(get_db),
                    user: GRCUser = Depends(require_auth)):
    v = _vendor(db, _tenant(db, user), vendor_id)
    rbac.require_write(db, user, "vendors", "edit")
    c = _contact(db, v, contact_id)
    if c.archived_at is not None:
        if _duplicate(db, v.id, c.email, other_than=c.id):
            raise HTTPException(409, "Another contact of this supplier has that email now")
        c.archived_at = None
        write_audit(db, v.tenant_id, entity="contact", action="restore", vendor_id=v.id, entity_id=c.id,
                    actor_id=user.id, to_value=c.name)
        db.commit()
    return _row(c)


class LinkIn(BaseModel):
    expires_in_days: int = Field(LINK_DAYS, ge=1, le=90)
    send_email: bool = True


@router.post("/vendors/{vendor_id}/contacts/{contact_id}/portal-link")
def send_portal_link(vendor_id: int, contact_id: int, body: LinkIn = LinkIn(), db: Session = Depends(get_db),
                     user: GRCUser = Depends(require_auth)):
    """A fresh personal link for one contact, emailed unless asked not to. The link
    is in this answer once; only its hash is kept."""
    v = _vendor(db, _tenant(db, user), vendor_id)
    rbac.require_write(db, user, "vendors", "edit")
    c = _contact(db, v, contact_id)
    problem = link_problem(c)
    if problem:
        raise HTTPException(400, problem)
    raw, row = issue(db, c, "invite", user.id, body.expires_in_days)
    link = portal.supplier_link(raw)
    write_audit(db, v.tenant_id, entity="portal_link", action="issue", vendor_id=v.id, entity_id=row.id,
                actor_id=user.id, to_value=c.email, extra={"expires_at": row.expires_at.isoformat(),
                                                          "send_email": body.send_email})
    db.commit()
    emailed = body.send_email and deliver(db, v.tenant_id, c.email, *link_email(db, c, v, link, row.expires_at))
    return {"id": row.id, "link": link, "expires_at": row.expires_at.isoformat(), "emailed": bool(emailed)}


def _link_row(t: TPRAPortalToken, contacts: Dict[int, TPRAVendorContact], names: Dict[int, str],
              now: datetime) -> dict:
    c = contacts.get(t.contact_id)
    return {"id": t.id, "contact": {"id": t.contact_id, "name": c.name if c else None, "email": c.email if c else None},
            "purpose": t.purpose, "created_at": _iso(t.created_at), "created_by": names.get(t.created_by),
            "expires_at": _iso(t.expires_at), "last_used_at": _iso(t.last_used_at), "use_count": t.use_count or 0,
            "revoked_at": _iso(t.revoked_at), "revoked_by": names.get(t.revoked_by),
            "active": t.revoked_at is None and t.expires_at > now}


def _link_rows(db: Session, rows: List[TPRAPortalToken]) -> List[dict]:
    contacts = {c.id: c for c in db.query(TPRAVendorContact).filter(
        TPRAVendorContact.id.in_([t.contact_id for t in rows] or [-1]))}
    names = _names(db, [x for t in rows for x in (t.created_by, t.revoked_by)])
    now = datetime.utcnow()
    return [_link_row(t, contacts, names, now) for t in rows]


@router.get("/vendors/{vendor_id}/portal-links")
def list_portal_links(vendor_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """The links sent to this supplier's contacts, newest first. Never the links themselves."""
    v = _vendor(db, _tenant(db, user), vendor_id)
    rows = (db.query(TPRAPortalToken).filter(TPRAPortalToken.vendor_id == v.id)
            .order_by(TPRAPortalToken.created_at.desc(), TPRAPortalToken.id.desc()).limit(200).all())
    return {"items": _link_rows(db, rows)}


@router.post("/portal-links/{link_id}/revoke")
def revoke_portal_link(link_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tid = _tenant(db, user)
    row = db.query(TPRAPortalToken).filter(TPRAPortalToken.id == link_id, TPRAPortalToken.tenant_id == tid).first()
    if row is None:
        raise HTTPException(404, "Link not found")
    rbac.require_write(db, user, "vendors", "edit")
    if row.revoked_at is None:
        _revoke([row], user.id)
        write_audit(db, tid, entity="portal_link", action="revoke", vendor_id=row.vendor_id, entity_id=row.id,
                    actor_id=user.id)
        db.commit()
    return _link_rows(db, [row])[0]


@router.post("/vendors/{vendor_id}/portal-links/revoke-all")
def revoke_all_portal_links(vendor_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    v = _vendor(db, _tenant(db, user), vendor_id)
    rbac.require_write(db, user, "vendors", "edit")
    n = revoke_all(db, v.id, user.id, "Revoked by hand")
    db.commit()
    return {"revoked": n}
