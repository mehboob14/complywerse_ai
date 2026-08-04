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

router = APIRouter(prefix="/versions", tags=["Governance - Document Versions"])


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
    }


@router.get("/document/{document_id}")
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
        "current_version": document.current_version
    }


@router.post("/document/{document_id}", status_code=status.HTTP_201_CREATED)
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
    
    db.query(GovernanceDocumentVersion).filter(
        GovernanceDocumentVersion.document_id == document_id,
        GovernanceDocumentVersion.status == "current"
    ).update({"status": "superseded"})
    
    new_version_number = increment_version(document.current_version, version_data.change_type)
    
    new_version = GovernanceDocumentVersion(
        document_id=document_id,
        version_number=new_version_number,
        change_type=version_data.change_type,
        title=version_data.title or document.title,
        content=version_data.content or document.content,
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
    if version_data.content:
        document.content = version_data.content
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


@router.post("/document/{document_id}/rollback/{version_id}", status_code=status.HTTP_201_CREATED)
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
    
    db.query(GovernanceDocumentVersion).filter(
        GovernanceDocumentVersion.document_id == document_id,
        GovernanceDocumentVersion.status == "current"
    ).update({"status": "superseded"})
    
    new_version_number = increment_version(document.current_version, "minor")
    
    rollback_reason = rollback_data.rollback_reason if rollback_data else None
    change_summary = f"Rollback to version {target_version.version_number}"
    if rollback_reason:
        change_summary += f": {rollback_reason}"
    
    new_version = GovernanceDocumentVersion(
        document_id=document_id,
        version_number=new_version_number,
        change_type="minor",
        title=target_version.title,
        content=target_version.content,
        change_summary=change_summary,
        change_reason=f"Rollback from version {document.current_version} to version {target_version.version_number}",
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
    
    db.commit()
    db.refresh(new_version)
    
    return {
        "message": f"Successfully rolled back to version {target_version.version_number}",
        "new_version": serialize_version(new_version),
        "rollback_from": old_version,
        "rollback_to_content_from": target_version.version_number
    }


@router.get("/document/{document_id}/history")
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
            "current_version": document.current_version
        }
    }
