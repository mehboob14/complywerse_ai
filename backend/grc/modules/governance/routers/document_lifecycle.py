"""The document's Approvals & Acknowledgements tab: who it is waiting for, who signed or acknowledged, the full timeline.

The approval chain itself is still driven by routers/document_signoff.py; this reads the per-person obligations
(modules/governance/doc_lifecycle.py) and takes acknowledgements. Tenants without it get ``{"enabled": false}``.
"""
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ....models import DocumentObligation, GRCUser, get_db
from ....routers.auth_router import get_user_tenants, has_tenant_permission, require_auth
from .. import doc_lifecycle
from ..permissions import in_force_number, require_doc_editor, require_doc_reader
from .document_signoff import _doc_or_404, check_version

router = APIRouter(prefix="/documents", tags=["Governance - Lifecycle"])


class AcknowledgeIn(BaseModel):
    version: Optional[str] = None             # the version the person read; 409 when it changed since
    comment: Optional[str] = None
    signature_image: Optional[str] = None     # optional PNG data URL; sealed like a sign-off when given


@router.get("/{document_id}/lifecycle", dependencies=[Depends(require_doc_reader)])
def get_lifecycle(document_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    doc = _doc_or_404(document_id, get_user_tenants(current_user, db), db)
    if not doc_lifecycle.enabled(db):
        return {"enabled": False}
    return doc_lifecycle.state(db, doc, current_user)


@router.post("/{document_id}/lifecycle/acknowledge", dependencies=[Depends(require_doc_reader)])
def acknowledge(document_id: int, body: AcknowledgeIn, request: Request, db: Session = Depends(get_db),
                current_user: GRCUser = Depends(require_auth)):
    doc = _doc_or_404(document_id, get_user_tenants(current_user, db), db)
    if not doc_lifecycle.enabled(db):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Acknowledgements are not enabled for this organisation")
    number = in_force_number(doc)
    asked = db.query(DocumentObligation.document_version).filter(        # the version the person's waiting request names
        DocumentObligation.document_id == doc.id, DocumentObligation.kind == "acknowledgement", DocumentObligation.user_id == current_user.id,
        DocumentObligation.status == "pending").order_by(DocumentObligation.id.desc()).limit(1).scalar()
    if not body.version or body.version in (number, asked):          # what they read, or what they were asked for (a request not moved up)
        pass
    elif doc.status == "published":
        check_version(db, doc, body.version)
    elif number:                                                     # a new version is on its way: the one in force is acknowledged
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=f"The version in force changed since you opened it (now version {number}). Reload it and read it again.")
    try:
        doc_lifecycle.acknowledge(db, doc, current_user, body.comment, body.signature_image, request)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except LookupError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    return doc_lifecycle.state(db, doc, current_user)


@router.post("/{document_id}/lifecycle/remind", dependencies=[Depends(require_doc_editor)])
def remind(document_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Alert everyone who still has something to do on this document."""
    doc = _doc_or_404(document_id, get_user_tenants(current_user, db), db)
    if not doc_lifecycle.enabled(db):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not enabled for this organisation")
    pending = db.query(DocumentObligation).filter(DocumentObligation.document_id == document_id,
                                                  DocumentObligation.status == "pending").all()
    people = set(doc_lifecycle._people(db))
    pending = [o for o in pending if o.user_id in people]                  # never an account that is not a person
    # the reminder channels; with reminders off, one someone asks for by hand still goes in the app
    event = "reminder" if doc_lifecycle.channels(doc_lifecycle.settings(db, doc.tenant_id), "reminder") else None
    for kind in {o.kind for o in pending}:
        ids = [o.user_id for o in pending if o.kind == kind]
        doc_lifecycle._notify(db, doc, ids, f"Reminder: {doc_lifecycle._VERB[kind]} {doc.title}",
                              f"{current_user.display_name or current_user.username} reminds you to "
                              f"{doc_lifecycle._VERB[kind].lower()} \"{doc.title}\".", "warning", link=doc_lifecycle._link(doc, kind),
                              event=event)
    db.commit()
    return {"reminded": len({o.user_id for o in pending})}


class SettingsIn(BaseModel):
    approval_days: Optional[int] = None
    ack_days: Optional[int] = None
    remind_days: Optional[int] = None
    admin_after_days: Optional[int] = None
    email: Optional[bool] = None
    # Governance > Settings (2026-10-18); null escalate_role_id = the administrators
    review_days: Optional[int] = None
    remind_every_days: Optional[int] = None
    owner_after_days: Optional[int] = None
    escalate_role_id: Optional[int] = None
    notify: Optional[Dict[str, str]] = None
    task_create: Optional[Dict[str, bool]] = None
    task_priority: Optional[Dict[str, str]] = None
    task_title: Optional[str] = None
    task_description: Optional[str] = None


SETTINGS_RIGHT = "governance:settings:edit"
SETTINGS_REFUSED = "Only an administrator or someone allowed to change governance settings can change these."


def _tenant_id(db: Session, user: GRCUser) -> int:
    return get_user_tenants(user, db)[0]


def _settings_answer(db: Session, user: GRCUser, tenant_id: int, saved=None) -> dict:
    """The settings, the defaults (for Reset), whether the person may change them, and the roles escalation can go to."""
    from ....models import Role

    can_edit = has_tenant_permission(db, user, SETTINGS_RIGHT)
    roles = [{"id": r.id, "name": r.name} for r in db.query(Role).filter(Role.tenant_id == tenant_id).order_by(Role.name, Role.id)] if can_edit else []
    current = saved or doc_lifecycle.settings(db, tenant_id)
    chosen = db.get(Role, current["escalate_role_id"]) if current["escalate_role_id"] else None
    return {"enabled": True, "settings": current, "can_edit": can_edit, "defaults": doc_lifecycle.resolved({}), "roles": roles,
            "escalate_role_name": chosen.name if chosen else None}


@router.get("/lifecycle/mine")
def my_requests(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Everything the current user is asked to review, approve or acknowledge, across documents."""
    if not doc_lifecycle.enabled(db):
        return {"enabled": False, "items": []}
    items = doc_lifecycle.mine(db, current_user.id)
    return {"enabled": True, "total": len(items), "items": items}


@router.get("/lifecycle/settings")
def get_lifecycle_settings(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    if not doc_lifecycle.enabled(db):
        return {"enabled": False}
    return _settings_answer(db, current_user, _tenant_id(db, current_user))


@router.put("/lifecycle/settings")
def put_lifecycle_settings(body: SettingsIn, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """How long reviews, approvals and acknowledgements are given, reminders, escalation, the channel of every alert and the
    tasks made for each request (Governance > Settings). Administrators and holders of governance:settings:edit."""
    if not doc_lifecycle.enabled(db):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not enabled for this organisation")
    tenant_id = _tenant_id(db, current_user)
    if not has_tenant_permission(db, current_user, SETTINGS_RIGHT):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=SETTINGS_REFUSED)
    patch = body.model_dump(exclude_none=True)
    if "escalate_role_id" in body.model_fields_set and body.escalate_role_id is None:
        patch["escalate_role_id"] = None                     # back to the administrators
    try:
        saved = doc_lifecycle.save_settings(db, tenant_id, patch, current_user.id)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return _settings_answer(db, current_user, tenant_id, saved)
