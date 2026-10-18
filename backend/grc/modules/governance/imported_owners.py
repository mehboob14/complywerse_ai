"""Once per organisation: documents owned by, and requests waiting on, accounts an access-review connector imported.

The owner pickers used to list every grc_users row, so an account a connector imported (cfsb: "Arif Malik (DigitalOcean)") could
be made a document's owner and be asked to sign or acknowledge. Such accounts belong to Access Reviews only
(``auth_router.platform_account``). The user chose "the author becomes the owner" (2026-10-18): each such document gets its author
as owner when the author uses the platform, else the organisation's primary contact, else its first administrator, with a history
row saying why; a prepared-by that named the account names the new owner; the requests still waiting on the account end (their
Task Management tasks go, as for any request that no longer applies). Runs at the tenant's first connection in a process
(compliance/schema_migrations) and only once: ``Tenant.settings[MARK]`` records that it ran.
"""
from __future__ import annotations

from datetime import datetime
from typing import Dict, Optional, Set, Tuple

MARK = "imported_account_owners_fixed_at"


def _fallback(db, tenant, people: Set[int]) -> Tuple[Optional[int], str]:
    """Who owns a document whose author cannot: the primary contact, else the first administrator (platform accounts only)."""
    from ...models import GRCUser
    from .permissions import admin_user_ids

    contact = (tenant.primary_contact_email or "").strip().lower()
    for uid, email in db.query(GRCUser.id, GRCUser.email).filter(GRCUser.id.in_(people)).order_by(GRCUser.id):
        if contact and (email or "").strip().lower() == contact:
            return uid, "the organisation's primary contact"
    admins = sorted(admin_user_ids(db) & people)
    return (admins[0], "an administrator") if admins else (None, "")


def run(db) -> Dict[str, int]:
    """The fix itself; the caller commits. Does nothing once ``MARK`` is set."""
    from ...models import DocumentObligation, DocumentSignoffAssignment, GovernanceDocument, GRCUser, Tenant
    from ...routers.auth_router import platform_account
    from . import doc_lifecycle
    from .routers.versions import create_audit_log

    out = {"owners": 0, "prepared_by": 0, "requests": 0}
    tenant = db.query(Tenant).first()
    if tenant is None or (tenant.settings or {}).get(MARK):
        return out
    imported = {uid for (uid,) in db.query(GRCUser.id).filter(~platform_account())}
    people = {uid for (uid,) in db.query(GRCUser.id).filter(GRCUser.is_active.is_(True), platform_account())}
    now = datetime.utcnow()
    G, A, O = GovernanceDocument, DocumentSignoffAssignment, DocumentObligation
    if imported:
        fallback, label = _fallback(db, tenant, people)
        for doc in db.query(G).filter(G.owner_id.in_(imported)).order_by(G.id).all():
            new, who = (doc.author_id, "the author") if doc.author_id in people else (fallback, label)
            if new is None:
                continue
            create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=new, action="owner_assigned",
                             action_details=f"The owner was an account imported by an access-review connector; {who} is the owner now",
                             field_changed="owner_id", old_value=str(doc.owner_id), new_value=str(new))
            doc.owner_id, doc.updated_at = new, now
            out["owners"] += 1
        db.flush()
        for a in db.query(A).filter(A.role_type == "prepared_by", A.target_type == "user", A.target_id.in_(imported)).order_by(A.id).all():
            doc = db.get(G, a.document_id)
            if doc is None or doc.owner_id not in people:
                continue
            twin = db.query(A.id).filter(A.document_id == doc.id, A.role_type == "prepared_by", A.target_type == "user",
                                         A.target_id == doc.owner_id).first()
            if twin:
                db.delete(a)                # the owner is named already
            else:
                a.target_id = doc.owner_id
            out["prepared_by"] += 1
        for ob in db.query(O).filter(O.status == "pending", O.user_id.in_(imported)).order_by(O.id).all():
            ob.status, ob.done_at = "cancelled", now
            doc_lifecycle._close(db, ob, completed=False)
            doc = db.get(G, ob.document_id)
            if doc is not None:
                create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=doc.owner_id or ob.requested_by or ob.user_id,
                                 action="request_cancelled", field_changed=ob.kind, old_value="pending", new_value="cancelled",
                                 action_details=f"The {ob.kind} request to an account imported by an access-review connector was "
                                                "cancelled: it is not a user of this platform")
            out["requests"] += 1
    tenant.settings = {**(tenant.settings or {}), MARK: now.isoformat()}
    return out
