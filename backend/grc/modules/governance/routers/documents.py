from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, and_
from pydantic import BaseModel

from ....models import (
    GovernanceDocument, GovernanceDocumentVersion, DocumentReviewer,
    DocumentApprovalStep, DocumentAuditLog, GRCUser, Tenant, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/documents", tags=["Governance - Documents"])


class GovernanceDocumentCreate(BaseModel):
    document_code: Optional[str] = None
    title: str
    description: Optional[str] = None
    content: Optional[str] = None
    doc_type: str
    doc_sub_type: Optional[str] = None
    classification: str = "internal"
    parent_document_id: Optional[int] = None
    owner_id: Optional[int] = None
    author_id: Optional[int] = None
    department_id: Optional[int] = None
    effective_date: Optional[datetime] = None
    expiry_date: Optional[datetime] = None
    review_cycle_months: int = 12
    next_review_date: Optional[datetime] = None
    regulatory_scope: Optional[List[str]] = []
    framework_ids: Optional[List[int]] = []
    tags: Optional[List[str]] = []


class GovernanceDocumentUpdate(BaseModel):
    document_code: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    content: Optional[str] = None
    doc_type: Optional[str] = None
    doc_sub_type: Optional[str] = None
    classification: Optional[str] = None
    parent_document_id: Optional[int] = None
    status: Optional[str] = None
    owner_id: Optional[int] = None
    author_id: Optional[int] = None
    department_id: Optional[int] = None
    effective_date: Optional[datetime] = None
    expiry_date: Optional[datetime] = None
    review_cycle_months: Optional[int] = None
    next_review_date: Optional[datetime] = None
    regulatory_scope: Optional[List[str]] = None
    framework_ids: Optional[List[int]] = None
    tags: Optional[List[str]] = None


class BulkStatusUpdate(BaseModel):
    document_ids: List[int]
    status: str


class BulkArchive(BaseModel):
    document_ids: List[int]


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


def serialize_document(doc: GovernanceDocument) -> dict:
    return {
        "id": doc.id,
        "tenant_id": doc.tenant_id,
        "document_code": doc.document_code,
        "title": doc.title,
        "description": doc.description,
        "content": doc.content,
        "doc_type": doc.doc_type,
        "doc_sub_type": doc.doc_sub_type,
        "classification": doc.classification,
        "parent_document_id": doc.parent_document_id,
        "current_version": doc.current_version,
        "status": doc.status,
        "owner_id": doc.owner_id,
        "owner_name": doc.owner.display_name if doc.owner else None,
        "author_id": doc.author_id,
        "author_name": doc.author.display_name if doc.author else None,
        "department_id": doc.department_id,
        "effective_date": doc.effective_date.isoformat() if doc.effective_date else None,
        "expiry_date": doc.expiry_date.isoformat() if doc.expiry_date else None,
        "review_cycle_months": doc.review_cycle_months,
        "next_review_date": doc.next_review_date.isoformat() if doc.next_review_date else None,
        "last_reviewed_at": doc.last_reviewed_at.isoformat() if doc.last_reviewed_at else None,
        "last_reviewed_by": doc.last_reviewed_by,
        "regulatory_scope": doc.regulatory_scope or [],
        "framework_ids": doc.framework_ids or [],
        "tags": doc.tags or [],
        "approved_by": doc.approved_by,
        "approved_at": doc.approved_at.isoformat() if doc.approved_at else None,
        "published_by": doc.published_by,
        "published_at": doc.published_at.isoformat() if doc.published_at else None,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
    }


@router.get("")
def list_documents(
    tenant_id: Optional[int] = None,
    doc_type: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    owner_id: Optional[int] = None,
    classification: Optional[str] = None,
    framework_id: Optional[int] = None,
    search: Optional[str] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    sort_by: str = "created_at",
    sort_order: str = "desc",
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}
    
    query = db.query(GovernanceDocument).options(
        joinedload(GovernanceDocument.owner)
    ).filter(GovernanceDocument.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(GovernanceDocument.tenant_id == tenant_id)
    if doc_type:
        query = query.filter(GovernanceDocument.doc_type == doc_type)
    if status_filter:
        query = query.filter(GovernanceDocument.status == status_filter)
    if owner_id:
        query = query.filter(GovernanceDocument.owner_id == owner_id)
    if classification:
        query = query.filter(GovernanceDocument.classification == classification)
    if framework_id:
        query = query.filter(GovernanceDocument.framework_ids.contains([framework_id]))
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            or_(
                GovernanceDocument.title.ilike(search_term),
                GovernanceDocument.description.ilike(search_term),
                GovernanceDocument.document_code.ilike(search_term)
            )
        )
    if date_from:
        query = query.filter(GovernanceDocument.created_at >= date_from)
    if date_to:
        query = query.filter(GovernanceDocument.created_at <= date_to)
    
    total = query.count()
    
    sort_column = getattr(GovernanceDocument, sort_by, GovernanceDocument.created_at)
    if sort_order == "asc":
        query = query.order_by(sort_column.asc())
    else:
        query = query.order_by(sort_column.desc())
    
    documents = query.offset(skip).limit(limit).all()
    
    return {
        "items": [serialize_document(doc) for doc in documents],
        "total": total,
        "skip": skip,
        "limit": limit
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_document(
    document: GovernanceDocumentCreate,
    tenant_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
    else:
        tenant_id = get_user_primary_tenant(current_user, db)
        if not tenant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User is not assigned to any tenant"
            )
    
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found"
        )
    
    if document.parent_document_id:
        parent = db.query(GovernanceDocument).filter(
            GovernanceDocument.id == document.parent_document_id,
            GovernanceDocument.tenant_id == tenant_id
        ).first()
        if not parent:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Parent document not found"
            )
    
    db_document = GovernanceDocument(
        tenant_id=tenant_id,
        document_code=document.document_code,
        title=document.title,
        description=document.description,
        content=document.content,
        doc_type=document.doc_type,
        doc_sub_type=document.doc_sub_type,
        classification=document.classification,
        parent_document_id=document.parent_document_id,
        owner_id=document.owner_id or current_user.id,
        author_id=document.author_id or current_user.id,
        department_id=document.department_id,
        effective_date=document.effective_date,
        expiry_date=document.expiry_date,
        review_cycle_months=document.review_cycle_months,
        next_review_date=document.next_review_date,
        regulatory_scope=document.regulatory_scope or [],
        framework_ids=document.framework_ids or [],
        tags=document.tags or [],
        status="draft",
        current_version="1.0"
    )
    db.add(db_document)
    db.flush()
    
    create_audit_log(
        db=db,
        document_id=db_document.id,
        tenant_id=tenant_id,
        user_id=current_user.id,
        action="created",
        action_details=f"Document '{document.title}' created"
    )
    
    db.commit()
    db.refresh(db_document)
    
    return serialize_document(db_document)


@router.get("/policies")
def get_policies(
    tenant_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    return list_documents(
        tenant_id=tenant_id, doc_type="policy", status_filter=None,
        owner_id=None, classification=None, framework_id=None,
        search=None, date_from=None, date_to=None,
        sort_by="created_at", sort_order="desc",
        skip=skip, limit=limit, db=db, current_user=current_user
    )


@router.get("/standards")
def get_standards(
    tenant_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    return list_documents(
        tenant_id=tenant_id, doc_type="standard", status_filter=None,
        owner_id=None, classification=None, framework_id=None,
        search=None, date_from=None, date_to=None,
        sort_by="created_at", sort_order="desc",
        skip=skip, limit=limit, db=db, current_user=current_user
    )


@router.get("/procedures")
def get_procedures(
    tenant_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    return list_documents(
        tenant_id=tenant_id, doc_type="procedure", status_filter=None,
        owner_id=None, classification=None, framework_id=None,
        search=None, date_from=None, date_to=None,
        sort_by="created_at", sort_order="desc",
        skip=skip, limit=limit, db=db, current_user=current_user
    )


@router.get("/guidelines")
def get_guidelines(
    tenant_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    return list_documents(
        tenant_id=tenant_id, doc_type="guideline", status_filter=None,
        owner_id=None, classification=None, framework_id=None,
        search=None, date_from=None, date_to=None,
        sort_by="created_at", sort_order="desc",
        skip=skip, limit=limit, db=db, current_user=current_user
    )


@router.get("/charters")
def get_charters(
    tenant_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    return list_documents(
        tenant_id=tenant_id, doc_type="charter", status_filter=None,
        owner_id=None, classification=None, framework_id=None,
        search=None, date_from=None, date_to=None,
        sort_by="created_at", sort_order="desc",
        skip=skip, limit=limit, db=db, current_user=current_user
    )


@router.get("/frameworks")
def get_framework_documents(
    tenant_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    return list_documents(
        tenant_id=tenant_id, doc_type="framework", status_filter=None,
        owner_id=None, classification=None, framework_id=None,
        search=None, date_from=None, date_to=None,
        sort_by="created_at", sort_order="desc",
        skip=skip, limit=limit, db=db, current_user=current_user
    )


@router.get("/hierarchy")
def get_document_hierarchy(
    tenant_id: Optional[int] = None,
    parent_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(GovernanceDocument).options(
        joinedload(GovernanceDocument.owner)
    ).filter(GovernanceDocument.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(GovernanceDocument.tenant_id == tenant_id)
    
    if parent_id is None:
        query = query.filter(GovernanceDocument.parent_document_id.is_(None))
    else:
        query = query.filter(GovernanceDocument.parent_document_id == parent_id)
    
    documents = query.order_by(GovernanceDocument.doc_type, GovernanceDocument.title).all()
    
    def build_hierarchy(doc):
        result = serialize_document(doc)
        children = db.query(GovernanceDocument).filter(
            GovernanceDocument.parent_document_id == doc.id
        ).all()
        result["children"] = [build_hierarchy(child) for child in children]
        return result
    
    return [build_hierarchy(doc) for doc in documents]


@router.get("/{document_id}")
def get_document(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(GovernanceDocument).options(
        joinedload(GovernanceDocument.owner),
        joinedload(GovernanceDocument.author),
        joinedload(GovernanceDocument.approver),
        joinedload(GovernanceDocument.versions),
        joinedload(GovernanceDocument.reviewers).joinedload(DocumentReviewer.user),
        joinedload(GovernanceDocument.approval_steps).joinedload(DocumentApprovalStep.approver),
        joinedload(GovernanceDocument.parent_document)
    ).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    result = serialize_document(document)
    
    result["versions"] = [
        {
            "id": v.id,
            "version_number": v.version_number,
            "change_type": v.change_type,
            "title": v.title,
            "change_summary": v.change_summary,
            "change_reason": v.change_reason,
            "status": v.status,
            "created_at": v.created_at.isoformat() if v.created_at else None,
            "created_by": v.created_by,
            "creator_name": v.creator.display_name if v.creator else None,
            "approved_by": v.approved_by,
            "approved_at": v.approved_at.isoformat() if v.approved_at else None,
        }
        for v in document.versions
    ]
    
    result["reviewers"] = [
        {
            "id": r.id,
            "user_id": r.user_id,
            "user_name": r.user.display_name if r.user else None,
            "role_type": r.role_type,
            "sequence": r.sequence,
            "is_required": r.is_required,
            "notify_on_update": r.notify_on_update,
            "notify_on_expiry": r.notify_on_expiry,
            "assigned_at": r.assigned_at.isoformat() if r.assigned_at else None,
        }
        for r in document.reviewers
    ]
    
    result["approval_steps"] = [
        {
            "id": s.id,
            "step_sequence": s.step_sequence,
            "step_name": s.step_name,
            "approval_type": s.approval_type,
            "approver_id": s.approver_id,
            "approver_name": s.approver.display_name if s.approver else None,
            "approver_role": s.approver_role,
            "status": s.status,
            "requested_at": s.requested_at.isoformat() if s.requested_at else None,
            "due_date": s.due_date.isoformat() if s.due_date else None,
            "completed_at": s.completed_at.isoformat() if s.completed_at else None,
            "comments": s.comments,
        }
        for s in document.approval_steps
    ]
    
    result["parent_document"] = None
    if document.parent_document:
        result["parent_document"] = {
            "id": document.parent_document.id,
            "title": document.parent_document.title,
            "doc_type": document.parent_document.doc_type,
        }
    
    child_documents = db.query(GovernanceDocument).filter(
        GovernanceDocument.parent_document_id == document_id
    ).all()
    result["child_documents"] = [
        {
            "id": c.id,
            "title": c.title,
            "doc_type": c.doc_type,
            "status": c.status,
        }
        for c in child_documents
    ]
    
    return result


@router.put("/{document_id}")
def update_document(
    document_id: int,
    document_update: GovernanceDocumentUpdate,
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
    
    update_data = document_update.model_dump(exclude_unset=True)
    changed_fields = []
    
    for field, new_value in update_data.items():
        old_value = getattr(document, field)
        if old_value != new_value:
            changed_fields.append({
                "field": field,
                "old_value": str(old_value) if old_value else None,
                "new_value": str(new_value) if new_value else None
            })
            setattr(document, field, new_value)
    
    document.updated_at = datetime.utcnow()
    
    if changed_fields:
        create_audit_log(
            db=db,
            document_id=document_id,
            tenant_id=document.tenant_id,
            user_id=current_user.id,
            action="updated",
            action_details=f"Updated fields: {', '.join([c['field'] for c in changed_fields])}"
        )
    
    db.commit()
    db.refresh(document)
    
    return serialize_document(document)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    document_id: int,
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
    
    child_count = db.query(GovernanceDocument).filter(
        GovernanceDocument.parent_document_id == document_id
    ).count()
    
    if child_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete document with {child_count} child documents. Delete or reassign child documents first."
        )
    
    db.delete(document)
    db.commit()
    
    return None


@router.post("/bulk-update-status")
def bulk_update_status(
    bulk_update: BulkStatusUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    valid_statuses = ["draft", "pending_review", "pending_approval", "approved", "published", "expired", "archived", "exception_applied"]
    if bulk_update.status not in valid_statuses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid status. Must be one of: {', '.join(valid_statuses)}"
        )
    
    documents = db.query(GovernanceDocument).filter(
        GovernanceDocument.id.in_(bulk_update.document_ids),
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).all()
    
    if not documents:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No documents found"
        )
    
    updated_count = 0
    for doc in documents:
        old_status = doc.status
        doc.status = bulk_update.status
        doc.updated_at = datetime.utcnow()
        
        create_audit_log(
            db=db,
            document_id=doc.id,
            tenant_id=doc.tenant_id,
            user_id=current_user.id,
            action="status_changed",
            action_details=f"Status changed from '{old_status}' to '{bulk_update.status}'",
            field_changed="status",
            old_value=old_status,
            new_value=bulk_update.status
        )
        updated_count += 1
    
    db.commit()
    
    return {
        "message": f"Successfully updated {updated_count} documents",
        "updated_count": updated_count
    }


@router.post("/bulk-archive")
def bulk_archive(
    bulk_archive_request: BulkArchive,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    documents = db.query(GovernanceDocument).filter(
        GovernanceDocument.id.in_(bulk_archive_request.document_ids),
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).all()
    
    if not documents:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No documents found"
        )
    
    archived_count = 0
    for doc in documents:
        old_status = doc.status
        doc.status = "archived"
        doc.updated_at = datetime.utcnow()
        
        create_audit_log(
            db=db,
            document_id=doc.id,
            tenant_id=doc.tenant_id,
            user_id=current_user.id,
            action="archived",
            action_details=f"Document archived (previous status: '{old_status}')",
            field_changed="status",
            old_value=old_status,
            new_value="archived"
        )
        archived_count += 1
    
    db.commit()
    
    return {
        "message": f"Successfully archived {archived_count} documents",
        "archived_count": archived_count
    }


@router.get("/{document_id}/audit-logs")
def get_document_audit_logs(
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
    
    logs = db.query(DocumentAuditLog).options(
        joinedload(DocumentAuditLog.user)
    ).filter(
        DocumentAuditLog.document_id == document_id
    ).order_by(DocumentAuditLog.performed_at.desc()).offset(skip).limit(limit).all()
    
    return [
        {
            "id": log.id,
            "action": log.action,
            "action_details": log.action_details,
            "field_changed": log.field_changed,
            "old_value": log.old_value,
            "new_value": log.new_value,
            "performed_by": log.performed_by,
            "performer_name": log.user.display_name if log.user else None,
            "performed_at": log.performed_at.isoformat() if log.performed_at else None,
            "ip_address": log.ip_address,
        }
        for log in logs
    ]
