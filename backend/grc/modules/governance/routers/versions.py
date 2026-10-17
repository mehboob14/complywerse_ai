import os
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from pydantic import BaseModel
import difflib

from ....models import (
    GovernanceDocument, GovernanceDocumentVersion, DocumentAuditLog,
    GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants
from .. import permissions
from ..permissions import require_doc_editor, require_doc_reader

router = APIRouter(prefix="/versions", tags=["Governance - Document Versions"])


def _hide_newer(db: Session, user: GRCUser, doc: GovernanceDocument, *versions: GovernanceDocumentVersion):
    """The version row in force for someone who reads that one (None: they see every version); a version after it is not found."""
    row = permissions.version_for(db, user, doc)
    if row is not None and any(v.id > row.id for v in versions):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found")
    return row


class VersionCreate(BaseModel):
    change_type: str  # major, minor, patch
    change_summary: Optional[str] = None
    change_reason: Optional[str] = None
    title: Optional[str] = None
    content: Optional[str] = None


class VersionRollback(BaseModel):
    rollback_reason: Optional[str] = None


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def create_audit_log(
    db: Session,
    document_id: int,
    tenant_id: int,
    user_id: int,
    action: str,
    action_details: Optional[str] = None,
    field_changed: Optional[str] = None,
    old_value: Optional[str] = None,
    new_value: Optional[str] = None
) -> DocumentAuditLog:
    audit_log = DocumentAuditLog(
        document_id=document_id,
        tenant_id=tenant_id,
        action=action,
        action_details=action_details,
        field_changed=field_changed,
        old_value=old_value,
        new_value=new_value,
        performed_by=user_id,
        performed_at=datetime.utcnow()
    )
    db.add(audit_log)
    return audit_log


def increment_version(current_version: str, change_type: str) -> str:
    parts = current_version.split(".")
    if len(parts) == 2:
        major, minor = int(parts[0]), int(parts[1])
        patch = 0
    elif len(parts) == 3:
        major, minor, patch = int(parts[0]), int(parts[1]), int(parts[2])
    else:
        major, minor, patch = 1, 0, 0
    
    if change_type == "major":
        major += 1
        minor = 0
        patch = 0
    elif change_type == "minor":
        minor += 1
        patch = 0
    elif change_type == "patch":
        patch += 1
    
    return f"{major}.{minor}.{patch}" if patch > 0 else f"{major}.{minor}"


def serialize_version(version: GovernanceDocumentVersion) -> dict:
    return {
        "id": version.id,
        "document_id": version.document_id,
        "version_number": version.version_number,
        "change_type": version.change_type,
        "title": version.title,
        "content": version.content,
        "change_summary": version.change_summary,
        "change_reason": version.change_reason,
        "status": version.status,
        "created_at": version.created_at.isoformat() if version.created_at else None,
        "created_by": version.created_by,
        "creator_name": version.creator.display_name if version.creator else None,
        "approved_by": version.approved_by,
        "approved_at": version.approved_at.isoformat() if version.approved_at else None,
        "file_name": version.file_name,
        "file_type": version.file_type,
        "has_file": bool(version.file_path and os.path.exists(version.file_path)),
    }


@router.get("/document/{document_id}", dependencies=[Depends(require_doc_reader)])
def list_versions(
    document_id: int,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    query = db.query(GovernanceDocumentVersion).options(
        joinedload(GovernanceDocumentVersion.creator)
    ).filter(
        GovernanceDocumentVersion.document_id == document_id
    )
    in_force = _hide_newer(db, current_user, document)
    if in_force is not None:
        query = query.filter(GovernanceDocumentVersion.id <= in_force.id)
    
    total = query.count()
    versions = query.order_by(
        GovernanceDocumentVersion.created_at.desc()
    ).offset(skip).limit(limit).all()
    
    return {
        "items": [serialize_version(v) for v in versions],
        "total": total,
        "skip": skip,
        "limit": limit,
        "document_id": document_id,
        "current_version": in_force.version_number if in_force is not None else document.current_version
    }


@router.post("/document/{document_id}", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_doc_editor)])
def create_version(
    document_id: int,
    version_data: VersionCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    if version_data.change_type not in ["major", "minor", "patch"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="change_type must be one of: major, minor, patch"
        )
    
    if db.query(GovernanceDocumentVersion.id).filter(GovernanceDocumentVersion.document_id == document_id).first() is None:
        # an older document with no versions yet: what it holds now is kept first, as its own version (the version in force)
        db.add(GovernanceDocumentVersion(
            document_id=document_id, version_number=document.current_version or "1.0", change_type="baseline", title=document.title,
            content=document.content, file_name=document.file_name, file_path=document.file_path, file_size=document.file_size,
            file_type=document.file_type, change_summary="Baseline snapshot (before first edit)", status="superseded",
            created_by=current_user.id, created_at=datetime.utcnow()))
    from .. import doc_version

    new_version_number, new_version = doc_version.target(db, document, version_data.change_type)
    if new_version is not None:          # not published yet: the change goes into the one pending version
        doc_version.update_pending(new_version, new_version_number, version_data.change_type, title=version_data.title or document.title,
                                   content=version_data.content or document.content, summary=version_data.change_summary,
                                   reason=version_data.change_reason,
                                   files={"file_name": document.file_name, "file_path": document.file_path,
                                          "file_size": document.file_size, "file_type": document.file_type})
    else:
        db.query(GovernanceDocumentVersion).filter(
            GovernanceDocumentVersion.document_id == document_id,
            GovernanceDocumentVersion.status == "current"
        ).update({"status": "superseded"})
        new_version = GovernanceDocumentVersion(
            document_id=document_id,
            version_number=new_version_number,
            change_type=version_data.change_type,
            title=version_data.title or document.title,
            content=version_data.content or document.content,
            # the document's file stays its file: the row holds it too, so it is still there once a later version replaces it
            file_name=document.file_name, file_path=document.file_path, file_size=document.file_size, file_type=document.file_type,
            change_summary=version_data.change_summary,
            change_reason=version_data.change_reason,
            status="current",
            created_by=current_user.id,
            created_at=datetime.utcnow()
        )
        db.add(new_version)
    
    old_version = document.current_version
    document.current_version = new_version_number
    if version_data.title:
        document.title = version_data.title
    old_status = document.status
    if version_data.content:
        document.content = version_data.content
        from .. import doc_lifecycle

        doc_lifecycle.changed_after_review(db, document, old_status, current_user.id,
                                           f"New version {new_version_number}, so it needs approving again")
    if document.status == "published":          # a new number for the same published text: the one in force
        document.published_version = new_version_number
    document.updated_at = datetime.utcnow()
    
    create_audit_log(
        db=db,
        document_id=document_id,
        tenant_id=document.tenant_id,
        user_id=current_user.id,
        action="version_created",
        action_details=f"New {version_data.change_type} version {new_version_number} created. {version_data.change_summary or ''}",
        field_changed="current_version",
        old_value=old_version,
        new_value=new_version_number
    )
    
    db.commit()
    db.refresh(new_version)
    
    return serialize_version(new_version)


@router.get("/{version_id}")
def get_version(
    version_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    version = db.query(GovernanceDocumentVersion).options(
        joinedload(GovernanceDocumentVersion.creator),
        joinedload(GovernanceDocumentVersion.document)
    ).filter(
        GovernanceDocumentVersion.id == version_id
    ).first()
    
    if not version:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Version not found"
        )
    
    if version.document.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )
    _hide_newer(db, current_user, require_doc_reader(version.document_id, db, current_user), version)
    
    return serialize_version(version)


@router.get("/compare/{version_id_1}/{version_id_2}")
def compare_versions(
    version_id_1: int,
    version_id_2: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    version_1 = db.query(GovernanceDocumentVersion).options(
        joinedload(GovernanceDocumentVersion.creator),
        joinedload(GovernanceDocumentVersion.document)
    ).filter(
        GovernanceDocumentVersion.id == version_id_1
    ).first()
    
    version_2 = db.query(GovernanceDocumentVersion).options(
        joinedload(GovernanceDocumentVersion.creator),
        joinedload(GovernanceDocumentVersion.document)
    ).filter(
        GovernanceDocumentVersion.id == version_id_2
    ).first()
    
    if not version_1 or not version_2:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="One or both versions not found"
        )
    
    if version_1.document.tenant_id not in user_tenants or version_2.document.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )
    
    if version_1.document_id != version_2.document_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot compare versions from different documents"
        )
    _hide_newer(db, current_user, require_doc_reader(version_1.document_id, db, current_user), version_1, version_2)
    
    content_1 = (version_1.content or "").splitlines(keepends=True)
    content_2 = (version_2.content or "").splitlines(keepends=True)
    
    diff = list(difflib.unified_diff(
        content_1,
        content_2,
        fromfile=f"Version {version_1.version_number}",
        tofile=f"Version {version_2.version_number}",
        lineterm=""
    ))
    
    title_changed = version_1.title != version_2.title
    content_changed = version_1.content != version_2.content
    
    additions = sum(1 for line in diff if line.startswith('+') and not line.startswith('+++'))
    deletions = sum(1 for line in diff if line.startswith('-') and not line.startswith('---'))
    
    return {
        "version_1": serialize_version(version_1),
        "version_2": serialize_version(version_2),
        "diff": {
            "unified_diff": diff,
            "title_changed": title_changed,
            "content_changed": content_changed,
            "additions": additions,
            "deletions": deletions,
            "old_title": version_1.title if title_changed else None,
            "new_title": version_2.title if title_changed else None
        }
    }


def _restore_kind(db: Session, document: GovernanceDocument, target: GovernanceDocumentVersion) -> str:
    """A restore is major when it undoes a major version, else by the rule (``doc_version.by_rule``) on the text now and the
    text it brings back. No AI call."""
    from .. import change_chain, doc_version

    undone = db.query(GovernanceDocumentVersion.id).filter(GovernanceDocumentVersion.document_id == document.id,
                                                           GovernanceDocumentVersion.id > target.id,
                                                           GovernanceDocumentVersion.change_type == "major").first()
    if undone is not None:
        return "major"
    return doc_version.by_rule(change_chain.document_text(document), change_chain.version_text(target))


@router.post("/document/{document_id}/rollback/{version_id}", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_doc_editor)])
def rollback_to_version(
    document_id: int,
    version_id: int,
    rollback_data: Optional[VersionRollback] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    target_version = db.query(GovernanceDocumentVersion).filter(
        GovernanceDocumentVersion.id == version_id,
        GovernanceDocumentVersion.document_id == document_id
    ).first()
    
    if not target_version:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Target version not found for this document"
        )
    
    rollback_reason = ((rollback_data.rollback_reason if rollback_data else None) or "").strip()[:2000] or None     # the person's why
    change_summary = f"Rollback to version {target_version.version_number}"
    if rollback_reason:
        change_summary += f": {rollback_reason}"
    kind = _restore_kind(db, document, target_version)

    if not (target_version.content or "").strip() and target_version.file_path and os.path.exists(target_version.file_path):
        # a version that is a file (an uploaded Word or PDF, the original or a later one): that file becomes the document's file
        # again, as a new version; the files after it stay as the versions they were
        from ..studio import service as studio

        with open(target_version.file_path, "rb") as f:
            data = f.read()
        ext = (target_version.file_type or os.path.splitext(target_version.file_path)[1]).lower().lstrip(".") or "docx"
        old_version = document.current_version
        row, new_version_number, _ = studio.write_file_version(
            db, document, current_user, data, change_type=kind, summary=change_summary, reason=rollback_reason, ext=ext,
            done=f"Version {target_version.version_number} restored", audit_action="version_rollback")
        row.change_reason = rollback_reason or f"Rollback from version {old_version} to version {target_version.version_number}"
        document.content = None
        db.commit()
        studio.reanchor(db, document, current_user.id)
        db.refresh(row)
        return {
            "message": f"Successfully rolled back to version {target_version.version_number}",
            "new_version": serialize_version(row),
            "rollback_from": old_version,
            "rollback_to_content_from": target_version.version_number,
            "status": document.status,
        }

    from .. import doc_version

    why = rollback_reason or f"Rollback from version {document.current_version} to version {target_version.version_number}"
    new_version_number, new_version = doc_version.target(db, document, kind)
    if new_version is not None:          # not published yet: the restored text goes into the one pending version
        doc_version.update_pending(new_version, new_version_number, kind, title=target_version.title, content=target_version.content,
                                   summary=change_summary, reason=why)
    else:
        db.query(GovernanceDocumentVersion).filter(
            GovernanceDocumentVersion.document_id == document_id,
            GovernanceDocumentVersion.status == "current"
        ).update({"status": "superseded"})
        new_version = GovernanceDocumentVersion(
            document_id=document_id,
            version_number=new_version_number,
            change_type=kind,
            title=target_version.title,
            content=target_version.content,
            change_summary=change_summary,
            change_reason=why,
            status="current",
            created_by=current_user.id,
            created_at=datetime.utcnow()
        )
        db.add(new_version)
    
    old_version = document.current_version
    document.current_version = new_version_number
    document.title = target_version.title
    document.content = target_version.content
    document.updated_at = datetime.utcnow()
    
    create_audit_log(
        db=db,
        document_id=document_id,
        tenant_id=document.tenant_id,
        user_id=current_user.id,
        action="version_rollback",
        action_details=f"Rolled back from version {old_version} to version {target_version.version_number} (created as {new_version_number}). {rollback_reason or ''}",
        field_changed="current_version",
        old_value=old_version,
        new_value=new_version_number
    )
    from .. import doc_lifecycle

    # restored text is reviewed again, as a file is (approved or published, or while in review or approval)
    doc_lifecycle.changed_after_review(db, document, document.status, current_user.id,
                                       f"Version {target_version.version_number} restored (version {new_version_number}), so it needs approving again")

    db.commit()
    db.refresh(new_version)
    
    return {
        "message": f"Successfully rolled back to version {target_version.version_number}",
        "new_version": serialize_version(new_version),
        "rollback_from": old_version,
        "rollback_to_content_from": target_version.version_number,
        "status": document.status,
    }


@router.get("/document/{document_id}/history", dependencies=[Depends(require_doc_reader)])
def get_version_history(
    document_id: int,
    skip: int = 0,
    limit: int = 20,
    change_type: Optional[str] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    query = db.query(GovernanceDocumentVersion).options(
        joinedload(GovernanceDocumentVersion.creator)
    ).filter(
        GovernanceDocumentVersion.document_id == document_id
    )
    in_force = _hide_newer(db, current_user, document)
    if in_force is not None:
        query = query.filter(GovernanceDocumentVersion.id <= in_force.id)
    
    if change_type:
        if change_type not in ["major", "minor", "patch"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="change_type must be one of: major, minor, patch"
            )
        query = query.filter(GovernanceDocumentVersion.change_type == change_type)
    
    if date_from:
        query = query.filter(GovernanceDocumentVersion.created_at >= date_from)
    
    if date_to:
        query = query.filter(GovernanceDocumentVersion.created_at <= date_to)
    
    total = query.count()
    
    versions = query.order_by(
        GovernanceDocumentVersion.created_at.desc()
    ).offset(skip).limit(limit).all()
    
    history = []
    for version in versions:
        history.append({
            **serialize_version(version),
            "document_title": document.title,
            "document_code": document.document_code
        })
    
    return {
        "items": history,
        "total": total,
        "skip": skip,
        "limit": limit,
        "has_more": (skip + limit) < total,
        "document": {
            "id": document.id,
            "title": document.title,
            "document_code": document.document_code,
            "current_version": in_force.version_number if in_force is not None else document.current_version
        }
    }
