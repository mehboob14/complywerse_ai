"""Who may change, publish or delete a governance document, enforced on the server (the user's decision of 2026-10-16).

* Change it (its text and details, its sign-off set-up, reviews, versions, take back, AI Studio saves): its owner, its author,
  or whoever holds ``governance:policies:edit``.
* Publish it, or move it to approved or published by hand: ``governance:policies:publish``.
* Delete it: its owner, its author, or ``governance:policies:delete``.

Administrators - the organisation's primary contact and holders of the platform-given role named exactly "Administrator" - always
may (the shared rule, ``auth_router.is_tenant_admin``). Signing, rejecting and acknowledging stay with the person whose turn it is.

Who may read it (the user's decisions of 2026-10-17, "rights or asked"):

* The library: administrators and anyone whose platform-given roles hold any ``governance:policies:*`` right, matched the way the
  menu and the reports match it (wildcards). They read every document that has a version in force; a draft that was never
  published only if they may also edit or publish documents, or they are asked about it (below).
* Its owner and its author.
* Anyone asked about it: a request (review, approval, acknowledgement) that is not cancelled, or its sign-off naming them as
  prepared by, reviewer or approver - by name, by a role the platform gave them, or by a team they belong to or lead.
* Auditors (the right that opens the Auditor Portal, ``compliance:frameworks:*``) open single documents from the portal and the
  evidence screens; no library lists.
* Everybody else is refused; lists show only what the person may read.

While a new version of a published document is on its way, the version published stays in force: whoever may not change, publish
or sign off the document reads that one (``version_for``), the others read the newest. Whatever the status, a once-published
document never shows them a newer number than the one published last (also once archived, expired or flagged for review).

This module must not import ``routers/documents.py`` (documents -> permissions -> document_signoff -> documents would be a cycle);
``reporting_router`` is imported inside the functions that use it.
"""
from typing import Iterable, Optional, Set, Tuple

from fastapi import Depends, HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from ...models import (DocumentObligation, DocumentSignoffAssignment, GovernanceDocument, GovernanceDocumentVersion, GRCUser, Role,
                       Team, TeamMember, Tenant, UserRole, get_db)
from ...routers.auth_router import (ADMIN_ROLE, PLATFORM_GRANT, get_user_tenants, has_tenant_permission, is_tenant_admin,
                                    platform_role_ids, require_auth)

EDIT_REFUSED = "Only the document's owner, its author or someone allowed to edit documents can change it."
PUBLISH_REFUSED = "Only someone allowed to publish documents can approve or publish it."
DELETE_REFUSED = "Only the document's owner, its author or someone allowed to delete documents can delete it."
READ_REFUSED = ("Only people allowed to read the document library, or asked to review, approve or acknowledge this document, "
                "can open it.")
DRAFT_REFUSED = ("This document is a draft that has not been published yet; it opens for its owner, author, editors and the people "
                 "asked to review or approve it.")          # what a library reader is told
LIBRARY_REFUSED = "Only people allowed to read the document library can see this."
ANNOTATE_REFUSED = ("Only the document's owner, its author, someone allowed to edit documents, an auditor or someone taking part "
                    "in its sign-off can add remarks to it.")

SIGNOFF_KINDS = ("prepared_by", "reviewer", "approver")
# a new version of a published document is on its way in these statuses; the version published stays in force meanwhile
ON_ITS_WAY = ("draft", "pending_review", "pending_approval", "approved", "review_required")     # (a workflow flags it for review)
_DRAFT_RIGHTS = {"governance:policies:edit", "governance:policies:publish"}

# An administrator, or a platform-given role that holds the permission (an admin ticks permissions on a role in
# Administration > Roles); a link an access-review connector imported counts for neither.
_granted = has_tenant_permission
is_admin = is_tenant_admin


def admin_user_ids(db: Session) -> Set[int]:
    """The active users who are administrators (the rule of ``is_tenant_admin``, as one query)."""
    tenant = db.query(Tenant).first()
    contact = (tenant.primary_contact_email or "").lower() if tenant else ""
    who = GRCUser.id.in_(select(UserRole.user_id).join(Role, Role.id == UserRole.role_id).where(Role.name == ADMIN_ROLE, PLATFORM_GRANT))
    if contact:
        who = or_(who, func.lower(GRCUser.email) == contact)
    return {uid for (uid,) in db.query(GRCUser.id).filter(GRCUser.is_active.is_(True), who)}


def publisher_ids(db: Session) -> Set[int]:
    """The active people who may publish a document: holders of ``governance:policies:publish`` through a platform-given role, or
    the administrators when nobody holds it (an administrator always may, but is told only then)."""
    from ...models import Permission, RolePermission

    held = {uid for (uid,) in db.query(GRCUser.id).join(UserRole, UserRole.user_id == GRCUser.id)
            .join(RolePermission, RolePermission.role_id == UserRole.role_id).join(Permission, Permission.id == RolePermission.permission_id)
            .filter(GRCUser.is_active.is_(True), PLATFORM_GRANT, Permission.name == "governance:policies:publish")}
    return held or admin_user_ids(db)


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


# ── who may read (decisions of 2026-10-17) ───────────────────────────────────
def _rights(db: Session, user: GRCUser) -> Tuple[bool, bool, bool]:
    """(reads the library, is an auditor, sees every draft) from one look at the person's rights. The first two match the way the
    menu and the reports do (wildcards; an administrator holds every right); the third is may edit or publish any document - the
    rights part of ``can_edit`` and ``can_publish``."""
    from ...routers.reporting_router import _satisfies, _user_perm_names

    granted = _user_perm_names(user, db)
    return (_satisfies(granted, "governance:policies:*"), _satisfies(granted, "compliance:frameworks:*"),     # the portal's menu right
            "*:*:*" in granted or bool(granted & _DRAFT_RIGHTS))


def can_read_library(db: Session, user: GRCUser) -> bool:
    return _rights(db, user)[0]


def is_auditor(db: Session, user: GRCUser) -> bool:
    return _rights(db, user)[1]


def _assigned(db: Session, user: GRCUser, kinds: Iterable[str] = SIGNOFF_KINDS):
    """A select of the ids of documents whose sign-off names the person in one of these kinds: by name, by a role the platform gave
    them (not a link a connector imported) or by a team they belong to or lead - the matching of document_signoff._resolve_target_users."""
    A = DocumentSignoffAssignment
    return select(A.document_id).where(A.role_type.in_(tuple(kinds)), or_(
        and_(A.target_type == "user", A.target_id == user.id),
        and_(A.target_type == "role", A.target_id.in_(platform_role_ids(db, user))),
        and_(A.target_type == "team", or_(A.target_id.in_(select(TeamMember.team_id).where(TeamMember.user_id == user.id)),
                                          A.target_id.in_(select(Team.id).where(Team.lead_user_id == user.id))))))


def participant(db: Session, user: GRCUser, doc_id: int, kinds: Iterable[str] = SIGNOFF_KINDS) -> bool:
    """The document's sign-off names the person (prepared by, reviewer or approver, or only the kinds given)."""
    return db.execute(_assigned(db, user, kinds).where(DocumentSignoffAssignment.document_id == doc_id).limit(1)).first() is not None


def asked_ids(db: Session, user: GRCUser):
    """A select of the ids of documents the person is asked about: a request that is not cancelled, or a sign-off naming them."""
    O = DocumentObligation
    return select(O.document_id).where(O.user_id == user.id, O.status != "cancelled").union(_assigned(db, user))


def _own_or_asked(db: Session, user: GRCUser):
    G = GovernanceDocument
    return or_(G.owner_id == user.id, G.author_id == user.id, G.id.in_(asked_ids(db, user)))


def readable_ids(db: Session, user: GRCUser):
    """None for a library reader (the whole library), else a select of the ids the person owns, wrote or is asked about (for
    ``.in_()``). A list of documents hides never-published drafts too: use ``visible_filter``."""
    if can_read_library(db, user):
        return None
    return select(GovernanceDocument.id).where(_own_or_asked(db, user))


def visible_filter(db: Session, user: GRCUser):
    """For a list of documents: a condition on GovernanceDocument keeping what the person may read, or None when they read every
    document (administrators, and whoever may edit or publish any document). A library reader sees the documents that were ever
    published plus their own and those they are asked about; anyone else only the latter. Auditors get no lists."""
    library, _auditor, drafts = _rights(db, user)
    if drafts:
        return None
    G = GovernanceDocument
    mine = _own_or_asked(db, user)
    # published at some time, with a known version to serve (published_at alone cannot tell which text was approved)
    published = or_(G.published_version.isnot(None), G.last_published_version.isnot(None), G.status == "published")
    return or_(published, mine) if library else mine


def can_read(db: Session, user: GRCUser, doc: GovernanceDocument) -> bool:
    if user.id in (doc.owner_id, doc.author_id):
        return True
    library, auditor, drafts = _rights(db, user)
    if drafts or auditor or (library and (doc.status == "published" or published_last(doc))):
        return True
    return db.execute(select(GovernanceDocument.id).where(GovernanceDocument.id == doc.id,
                                                          GovernanceDocument.id.in_(asked_ids(db, user)))).first() is not None


def ensure_reader(db: Session, user: GRCUser, doc: GovernanceDocument) -> None:
    if not can_read(db, user, doc):           # a library reader is refused only a draft never published
        raise _forbidden(DRAFT_REFUSED if can_read_library(db, user) else READ_REFUSED)


def ensure_annotator(db: Session, user: GRCUser, doc: GovernanceDocument) -> None:
    """Remarks on a document: its editors, auditors and the people taking part in its sign-off."""
    if not (can_edit(db, user, doc) or is_auditor(db, user) or participant(db, user, doc.id)):
        raise _forbidden(ANNOTATE_REFUSED)


def require_doc_reader(document_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)) -> GovernanceDocument:
    doc = _document(document_id, db, user)
    ensure_reader(db, user, doc)
    return doc


def require_library_reader(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)) -> None:
    if not can_read_library(db, user):
        raise _forbidden(LIBRARY_REFUSED)


# ── the version in force while a newer one is on its way ─────────────────────
def in_force_number(doc: GovernanceDocument) -> Optional[str]:
    """The number of the version in force (what acknowledgements are for): a published document's own; while a new version is on
    its way (or a workflow flagged it for review), the one published last; none when the document was never published, or is
    archived, expired or under an exception."""
    if doc.status == "published":
        return doc.current_version or "1.0"
    return doc.published_version if doc.status in ON_ITS_WAY else None


def published_last(doc: GovernanceDocument) -> Optional[str]:
    """The number published last, also after a withdrawal (None: never published since the numbers were recorded)."""
    return doc.last_published_version or doc.published_version


def in_force_row(db: Session, doc: GovernanceDocument) -> Optional[GovernanceDocumentVersion]:
    """The version row whoever does not see drafts reads instead of the document, else None (the document itself): the one
    published last, whenever the document is not published now and holds a newer number - a new version on its way, or withdrawn
    or flagged for review after one was. While a version is in force it is that one. The earliest row with the number (a gap
    fix's pre-fix copy repeats it later), never one a take-back marked reverted or one holding neither text nor a file."""
    number = published_last(doc)
    if doc.status == "published" or not number or number == doc.current_version:
        return None
    V = GovernanceDocumentVersion
    return (db.query(V).filter(V.document_id == doc.id, V.version_number == number, func.coalesce(V.status, "") != "reverted",
                               or_(V.content != "", V.file_path != ""))
            .order_by(V.id).first())


def sees_draft(db: Session, user: GRCUser, doc: GovernanceDocument) -> bool:
    """Reads the newest version of the document, not only the one in force: who may change or publish it, and its sign-off."""
    return can_edit(db, user, doc) or can_publish(db, user) or participant(db, user, doc.id)


def version_for(db: Session, user: GRCUser, doc: GovernanceDocument) -> Optional[GovernanceDocumentVersion]:
    """The version row this person reads instead of the document, or None (they read the document itself)."""
    row = in_force_row(db, doc)
    return row if row is not None and not sees_draft(db, user, doc) else None
