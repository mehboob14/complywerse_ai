"""Who may change, publish or delete a governance document, enforced on the server (the user's decision of 2026-10-16).

* Change it (its text and details, its sign-off set-up, reviews, versions, take back, AI Studio saves): its owner, its author,
  or whoever holds ``governance:policies:edit``.
* Publish it, or move it to approved or published by hand: ``governance:policies:publish``.
* Delete it: its owner, its author, or ``governance:policies:delete``.

Administrators - the organisation's primary contact and holders of the role named exactly "Administrator" - always may: the same
rule as ``admin_router.check_permission``. Signing, rejecting and acknowledging stay with the person whose turn it is. This module
must not import ``routers/documents.py`` (documents -> permissions -> document_signoff -> documents would be a cycle).
"""
from typing import Iterable, Set

from fastapi import Depends, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ...models import GovernanceDocument, GRCUser, Role, Tenant, UserRole, get_db
from ...routers.auth_router import get_user_tenants, require_auth

ADMIN_ROLE = "Administrator"
EDIT_REFUSED = "Only the document's owner, its author or someone allowed to edit documents can change it."
PUBLISH_REFUSED = "Only someone allowed to publish documents can approve or publish it."
DELETE_REFUSED = "Only the document's owner, its author or someone allowed to delete documents can delete it."


def _granted(db: Session, user: GRCUser, name: str) -> bool:
    from ...routers.admin_router import check_permission      # the primary contact and "Administrator" pass it too

    return check_permission(user, db, name)


def is_admin(db: Session, user: GRCUser) -> bool:
    tenant = db.query(Tenant).first()
    email = (getattr(user, "email", None) or "").lower()
    if tenant and tenant.primary_contact_email and email and tenant.primary_contact_email.lower() == email:
        return True
    return db.query(UserRole.id).join(Role, Role.id == UserRole.role_id).filter(
        UserRole.user_id == user.id, Role.name == ADMIN_ROLE).first() is not None


def admin_user_ids(db: Session) -> Set[int]:
    """The active users who are administrators."""
    tenant = db.query(Tenant).first()
    contact = (tenant.primary_contact_email or "").lower() if tenant else ""
    who = GRCUser.id.in_(select(UserRole.user_id).join(Role, Role.id == UserRole.role_id).where(Role.name == ADMIN_ROLE))
    if contact:
        who = or_(who, func.lower(GRCUser.email) == contact)
    return {uid for (uid,) in db.query(GRCUser.id).filter(GRCUser.is_active.is_(True), who)}


def can_edit(db: Session, user: GRCUser, doc: GovernanceDocument) -> bool:
    return user.id in (doc.owner_id, doc.author_id) or _granted(db, user, "governance:policies:edit")


def can_publish(db: Session, user: GRCUser) -> bool:
    return _granted(db, user, "governance:policies:publish")


def can_delete(db: Session, user: GRCUser, doc: GovernanceDocument) -> bool:
    return user.id in (doc.owner_id, doc.author_id) or _granted(db, user, "governance:policies:delete")


def _forbidden(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def ensure_editor(db: Session, user: GRCUser, doc: GovernanceDocument) -> None:
    if not can_edit(db, user, doc):
        raise _forbidden(EDIT_REFUSED)


def ensure_publisher(db: Session, user: GRCUser) -> None:
    if not can_publish(db, user):
        raise _forbidden(PUBLISH_REFUSED)


def ensure_all_editable(db: Session, user: GRCUser, docs: Iterable[GovernanceDocument]) -> None:
    """A bulk change is all or nothing: refused, naming them, when the person may not change some of the documents."""
    refused = [d for d in docs if not can_edit(db, user, d)]
    if refused:
        names = ", ".join(f'"{d.title}"' for d in refused[:10]) + (f" and {len(refused) - 10} more" if len(refused) > 10 else "")
        raise _forbidden(f"Nothing was changed: you may not change {names}. {EDIT_REFUSED}")


# ── dependencies for routes with a {document_id} ─────────────────────────────
def _document(document_id: int, db: Session, user: GRCUser) -> GovernanceDocument:
    doc = db.query(GovernanceDocument).filter(GovernanceDocument.id == document_id,
                                              GovernanceDocument.tenant_id.in_(get_user_tenants(user, db))).first()
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return doc


def require_doc_editor(document_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)) -> GovernanceDocument:
    doc = _document(document_id, db, user)
    ensure_editor(db, user, doc)
    return doc


def require_doc_publisher(document_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)) -> GovernanceDocument:
    doc = _document(document_id, db, user)
    ensure_publisher(db, user)
    return doc


def require_doc_deleter(document_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)) -> GovernanceDocument:
    doc = _document(document_id, db, user)
    if not can_delete(db, user, doc):
        raise _forbidden(DELETE_REFUSED)
    return doc
