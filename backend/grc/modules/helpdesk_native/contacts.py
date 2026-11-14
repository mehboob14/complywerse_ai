"""Contacts — native conversion of helpdesk/api/contact.py over HDContact.

Source fns (helpdesk/api/contact.py):
  * search_contacts    -> search_contacts
  * create_contact     -> create_contact
  * edit_contact       -> edit_contact
  * delete_contact     -> delete_contact (+ unlink_from_customers)
  * get_contact_info   -> get_contact_info
  * unlink_from_customers -> unlink_from_customers

Frappe's core `Contact` keeps email/phone in child tables (email_ids / phone_nos);
the native HDContact carries the primary email/mobile/phone inline (what Help Desk
reads), so edit_contact flattens the incoming child-row arrays to the primary values.

Links to a ticket: native HDTicket.contact stores the contact's EMAIL (a bare
string — see common.ticket_row / people module docstring), where Frappe's
HD Ticket.contact was a Link to the Contact doc name. So ticket un/link matches on
email_id, not the surrogate id. Flagged.

Gaps (no native store — noted, not faked):
  * invite-by-email (invite flag / User Invitation) — ComplyVerse has no invitation store.
  * get_contact_info last_seen / timezone / country — came from the Frappe User row
    (last_active / time_zone); ComplyVerse's HDContact has no such link, so last_seen is null.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ...models import HDContact, HDCustomer, HDCustomerMember, HDTicket, get_db
from .common import require_view, require_settings_manage, tenant_id

router = APIRouter(prefix="/helpdesk/contacts", tags=["Help Desk (native)"])


# ─── request bodies ────────────────────────────────────────────────────────
class ContactBody(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    phone: str | None = None
    mobile_no: str | None = None
    company_name: str | None = None
    image: str | None = None


class ContactEdit(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    email_id: str | None = None
    phone: str | None = None
    mobile_no: str | None = None
    company_name: str | None = None
    image: str | None = None


def _full_name(c: HDContact) -> str:
    return " ".join(p for p in (c.first_name, c.last_name) if p).strip()


def _get_contact(db: Session, tid: int, name: str) -> HDContact | None:
    """Tenant-scoped fetch by contract `name` (our integer PK) — the tenant_id
    filter is the isolation guard."""
    try:
        pk = int(name)
    except (TypeError, ValueError):
        return None
    return (
        db.query(HDContact)
        .filter(HDContact.id == pk, HDContact.tenant_id == tid)
        .first()
    )


# ─── read ──────────────────────────────────────────────────────────────────
def list_contacts(db: Session, tid: int) -> dict:
    """§A9. Real rows now that HDContact exists (replaces the old empty stub)."""
    rows = (
        db.query(HDContact)
        .filter(HDContact.tenant_id == tid)
        .order_by(HDContact.email_id.asc(), HDContact.first_name.asc())
        .all()
    )
    return {"contacts": [{
        "name": str(c.id),
        "first_name": c.first_name,
        "last_name": c.last_name,
        "email_id": c.email_id,
        "phone": c.phone or c.mobile_no,
        "company_name": c.company_name,
    } for c in rows]}


def search_contacts(db: Session, tid: int, txt: str | None = None) -> list[dict]:
    """contact.search_contacts — contacts WITH an email, matched on name/email,
    capped at 10 (Frappe limit_page_length=10)."""
    q = db.query(HDContact).filter(
        HDContact.tenant_id == tid, HDContact.email_id.isnot(None)
    )
    if txt:
        like = f"%{txt}%"
        q = q.filter(or_(
            HDContact.email_id.ilike(like),
            HDContact.first_name.ilike(like),
            HDContact.last_name.ilike(like),
        ))
    rows = q.order_by(HDContact.email_id.asc(), HDContact.first_name.asc()).limit(10).all()
    return [{"name": str(c.id), "full_name": _full_name(c), "email_id": c.email_id} for c in rows]


def get_contact_info(db: Session, tid: int, name: str) -> dict:
    """contact.get_contact_info — the customers this contact belongs to (with image).
    last_seen is always null natively (no Frappe User link); invitation lookup omitted
    (no invitation store)."""
    c = _get_contact(db, tid, name)
    if not c:
        raise HTTPException(status_code=404, detail="not found")
    customers = (
        db.query(HDCustomer)
        .join(HDCustomerMember, HDCustomerMember.customer_id == HDCustomer.id)
        .filter(HDCustomerMember.contact_id == c.id, HDCustomer.tenant_id == tid)
        .all()
    )
    return {
        "customers": [{"name": str(cu.id), "image": cu.image} for cu in customers],
        "last_seen": None,
    }


# ─── mutations ───────────────────────────────────────────────────────────────
def create_contact(db: Session, tid: int, doc: dict) -> dict:
    """contact.create_contact. The `invite` path (invite_by_email) is omitted — no
    native invitation store; see module docstring."""
    row = HDContact(
        tenant_id=tid,
        first_name=doc.get("first_name"),
        last_name=doc.get("last_name"),
        email_id=doc.get("email") or doc.get("email_id"),
        phone=doc.get("phone"),
        mobile_no=doc.get("mobile_no") or doc.get("phone"),
        company_name=doc.get("company_name"),
        image=doc.get("image"),
    )
    db.add(row)
    db.commit()
    return {"ok": True, "name": str(row.id)}


def edit_contact(db: Session, tid: int, name: str, doc: dict) -> dict:
    """contact.edit_contact. Frappe rebuilt the email_ids/phone_nos child tables;
    natively those collapse to the primary email/mobile/phone columns, so a plain
    field patch is the faithful equivalent. The User photo/timezone sync is omitted
    (no Frappe User link)."""
    c = _get_contact(db, tid, name)
    if not c:
        raise HTTPException(status_code=404, detail="not found")
    for field in ("first_name", "last_name", "email_id", "phone", "mobile_no",
                  "company_name", "image"):
        if doc.get(field) is not None:
            setattr(c, field, doc[field])
    db.commit()
    return {"ok": True}


def unlink_from_customers(db: Session, tid: int, contact_id: int) -> None:
    """contact.unlink_from_customers — drop this contact's membership rows, and
    clear primary_contact/email/mobile on any customer it was primary for. Tenant
    scope comes through the parent HDCustomer."""
    members = (
        db.query(HDCustomerMember)
        .join(HDCustomer, HDCustomer.id == HDCustomerMember.customer_id)
        .filter(HDCustomerMember.contact_id == contact_id, HDCustomer.tenant_id == tid)
        .all()
    )
    for m in members:
        cust = m.customer
        if cust and cust.primary_contact == str(contact_id):
            cust.primary_contact = None
            cust.email_id = None
            cust.mobile_no = None
        db.delete(m)


def delete_contact(db: Session, tid: int, name: str, delete_tickets: bool = False) -> dict:
    """contact.delete_contact. Tickets are matched by email (native HDTicket.contact
    holds the email, not a surrogate) — unlinked by default, deleted when the flag is
    set. Then membership is cleared and the contact removed."""
    c = _get_contact(db, tid, name)
    if not c:
        raise HTTPException(status_code=404, detail="not found")

    if c.email_id:
        tq = db.query(HDTicket).filter(
            HDTicket.tenant_id == tid, HDTicket.contact == c.email_id
        )
        if delete_tickets:
            tq.delete(synchronize_session=False)
        else:
            tq.update({HDTicket.contact: None}, synchronize_session=False)

    unlink_from_customers(db, tid, c.id)
    db.delete(c)
    db.commit()
    return {"ok": True}


# ─── endpoints ───────────────────────────────────────────────────────────────
@router.get("")
def contacts_index(db: Session = Depends(get_db), _: bool = Depends(require_view)):
    return list_contacts(db, tenant_id(db))


@router.get("/search")
def contacts_search(txt: str | None = None, db: Session = Depends(get_db),
                    _: bool = Depends(require_view)):
    return {"contacts": search_contacts(db, tenant_id(db), txt)}


@router.get("/{name}/info")
def contact_info(name: str, db: Session = Depends(get_db), _: bool = Depends(require_view)):
    return get_contact_info(db, tenant_id(db), name)


@router.post("")
def contact_create(body: ContactBody, db: Session = Depends(get_db),
                   _: bool = Depends(require_settings_manage)):
    return create_contact(db, tenant_id(db), body.model_dump())


@router.post("/{name}")
def contact_edit(name: str, body: ContactEdit, db: Session = Depends(get_db),
                 _: bool = Depends(require_settings_manage)):
    return edit_contact(db, tenant_id(db), name, body.model_dump(exclude_unset=True))


@router.delete("/{name}")
def contact_delete(name: str, delete_tickets: bool = False, db: Session = Depends(get_db),
                   _: bool = Depends(require_settings_manage)):
    return delete_contact(db, tenant_id(db), name, delete_tickets)


if __name__ == "__main__":  # pragma: no cover — pure-logic check (DB paths need a session)
    class _C:
        first_name = "Ada"; last_name = "Lovelace"
    assert _full_name(_C()) == "Ada Lovelace"
    _C.last_name = None
    assert _full_name(_C()) == "Ada"
    _C.first_name = None
    assert _full_name(_C()) == ""
    print("contacts self-check ok")
