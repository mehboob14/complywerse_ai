"""Once per organisation: documents owned by, and requests waiting on, accounts an access-review connector imported.

The owner pickers used to list every grc_users row, so an account a connector imported (cfsb: "Arif Malik (DigitalOcean)") could
be made a document's owner and be asked to sign or acknowledge. Such accounts belong to Access Reviews only
(``auth_router.platform_account``). The user chose "the author becomes the owner" (2026-10-18): each such document gets its author
as owner when the author uses the platform, else the organisation's primary contact, else its first administrator, with a history
row saying why; a prepared-by that named the account names the new owner; the requests still waiting on the account end (their
Task Management tasks go, as for any request that no longer applies). A reviewer or approver naming such an account can never sign,
so that stage could never end: it is removed with a history row, and the stage in progress is checked again
(``doc_lifecycle.recheck_stage``): left with nobody to sign it, it goes to the other stage or back to draft; when everyone left
has signed this round, it ends as at a last signature. Runs at the tenant's first connection in a process
(compliance/schema_migrations) and only once: ``Tenant.settings[MARK]`` and ``[SIGNERS_MARK]`` record that each part ran (an
organisation fixed before the signers part existed still gets it); the tenant row is locked while it runs, so a second process
starting at the same moment (another worker, the Celery worker) waits and then finds the marks.

Accounts of the organisation's own Entra directory are left alone: the directory sync stamps real staff (made by SSO or by an
administrator) who have not signed in yet, and they keep their documents and requests (they are still not offered in pickers
until they sign in). Which accounts it changed is logged.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Dict, Optional, Set, Tuple

logger = logging.getLogger(__name__)

MARK = "imported_account_owners_fixed_at"
SIGNERS_MARK = "imported_account_signers_fixed_at"


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
    """The fix itself; the caller commits. Does nothing once ``MARK`` and ``SIGNERS_MARK`` are set."""
    from ...models import DocumentObligation, DocumentSignoffAssignment, GovernanceDocument, GRCUser, Tenant
    from ...routers.auth_router import platform_account
    from ...routers.sso_router import PROVIDER_ENTRA
    from . import doc_lifecycle
    from .routers.versions import create_audit_log

    out = {"owners": 0, "prepared_by": 0, "requests": 0, "signers": 0, "stages": 0}
    tenant = db.query(Tenant).first()
    done = (tenant.settings or {}) if tenant is not None else {}
    if tenant is None or (done.get(MARK) and done.get(SIGNERS_MARK)):
        return out
    # another process may be running this right now: wait for it, then read the marks it wrote
    tenant = db.query(Tenant).filter(Tenant.id == tenant.id).with_for_update().populate_existing().one()
    done = tenant.settings or {}
    if done.get(MARK) and done.get(SIGNERS_MARK):
        return out
    # not the organisation's own directory (PROVIDER_ENTRA): its accounts are staff, who keep their documents and requests
    imported = {uid for (uid,) in db.query(GRCUser.id).filter(~platform_account(), GRCUser.external_provider != PROVIDER_ENTRA)}
    people = {uid for (uid,) in db.query(GRCUser.id).filter(GRCUser.is_active.is_(True), platform_account())}
    changed: Set[int] = set()
    now = datetime.utcnow()
    G, A, O = GovernanceDocument, DocumentSignoffAssignment, DocumentObligation
    if imported and not done.get(MARK):
        fallback, label = _fallback(db, tenant, people)
        for doc in db.query(G).filter(G.owner_id.in_(imported)).order_by(G.id).all():
            new, who = (doc.author_id, "the author") if doc.author_id in people else (fallback, label)
            if new is None:
                continue
            create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=new, action="owner_assigned",
                             action_details=f"The owner was an account imported by an access-review connector; {who} is the owner now",
                             field_changed="owner_id", old_value=str(doc.owner_id), new_value=str(new))
            changed.add(doc.owner_id)
            doc.owner_id, doc.updated_at = new, now
            out["owners"] += 1
        db.flush()
        for a in db.query(A).filter(A.role_type == "prepared_by", A.target_type == "user", A.target_id.in_(imported)).order_by(A.id).all():
            doc = db.get(G, a.document_id)
            if doc is None or doc.owner_id not in people:
                continue
            twin = db.query(A.id).filter(A.document_id == doc.id, A.role_type == "prepared_by", A.target_type == "user",
                                         A.target_id == doc.owner_id).first()
            changed.add(a.target_id)
            if twin:
                db.delete(a)                # the owner is named already
            else:
                a.target_id = doc.owner_id
            out["prepared_by"] += 1
        for ob in db.query(O).filter(O.status == "pending", O.user_id.in_(imported)).order_by(O.id).all():
            ob.status, ob.done_at = "cancelled", now
            changed.add(ob.user_id)
            doc_lifecycle._close(db, ob, completed=False)
            doc = db.get(G, ob.document_id)
            if doc is not None:
                create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=doc.owner_id or ob.requested_by or ob.user_id,
                                 action="request_cancelled", field_changed=ob.kind, old_value="pending", new_value="cancelled",
                                 action_details=f"The {ob.kind} request to an account imported by an access-review connector was "
                                                "cancelled: it is not a user of this platform")
            out["requests"] += 1
    if imported and not done.get(SIGNERS_MARK):
        stages: Dict[int, Tuple[object, int]] = {}
        for a in db.query(A).filter(A.role_type.in_(("reviewer", "approver")), A.target_type == "user",
                                    A.target_id.in_(imported)).order_by(A.id).all():
            doc = db.get(G, a.document_id)
            if doc is not None:
                by = doc.owner_id or doc.author_id or a.added_by or a.target_id     # the history row needs someone
                create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=by,
                                 action="participant_removed", field_changed=a.role_type, old_value=str(a.target_id), new_value=None,
                                 action_details=f"The {a.role_type} was an account imported by an access-review connector, "
                                                "which can never sign: it was removed")
                stages[doc.id] = (doc, by)
            changed.add(a.target_id)
            db.delete(a)
            out["signers"] += 1
        db.flush()                  # the stages below read the participants that are left
        for doc, by in stages.values():
            # nobody left to sign it (the other stage, or a draft), or everyone left signed (the next stage); the new stage is asked
            if doc_lifecycle.recheck_stage(db, doc, by):
                doc.updated_at = now
                out["stages"] += 1
    tenant.settings = {**(tenant.settings or {}), MARK: done.get(MARK) or now.isoformat(),
                       SIGNERS_MARK: done.get(SIGNERS_MARK) or now.isoformat()}
    if changed:
        providers = dict(db.query(GRCUser.id, GRCUser.external_provider).filter(GRCUser.id.in_(changed)))
        logger.info("Imported-account fix on tenant %s changed the documents and requests of accounts %s: %s", tenant.slug,
                    ", ".join(f"{uid} ({providers.get(uid)})" for uid in sorted(changed)), out)
    return out
