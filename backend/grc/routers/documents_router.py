from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from pydantic import BaseModel

from ..models import (
    Document, DocumentVersion, DocumentApprovalWorkflow, DocumentControlLink,
    NormalizedControl, GRCUser, Tenant, DocumentAttestation, get_db
)
from ..schemas import (
    DocumentCreate, DocumentUpdate, DocumentResponse,
    DocumentVersionResponse, DocumentApprovalRequest, DocumentApprovalResponse,
    DocumentControlLinkCreate, MessageResponse
)
from .auth_router import require_auth, get_user_tenants, get_user_primary_tenant


class AttestationRequest(BaseModel):
    user_ids: List[int]
    due_date: Optional[datetime] = None
    attestation_text: Optional[str] = None

router = APIRouter(prefix="/documents", tags=["Documents"])


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


@router.get("", response_model=List[DocumentResponse])
def list_documents(
    tenant_id: Optional[int] = None,
    doc_type: Optional[str] = None,
    status_filter: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(Document).filter(Document.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(Document.tenant_id == tenant_id)
    if doc_type:
        query = query.filter(Document.doc_type == doc_type)
    if status_filter:
        query = query.filter(Document.status == status_filter)
    
    documents = query.order_by(Document.created_at.desc()).offset(skip).limit(limit).all()
    return documents


@router.post("", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
def create_document(
    document: DocumentCreate,
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
    
    db_document = Document(
        tenant_id=tenant_id,
        title=document.title,
        content=document.content,
        doc_type=document.doc_type,
        owner_id=document.owner_id or current_user.id,
        review_cycle_months=document.review_cycle_months,
        next_review_date=datetime.utcnow() + timedelta(days=document.review_cycle_months * 30)
    )
    db.add(db_document)
    db.commit()
    db.refresh(db_document)
    return db_document


@router.get("/pending-approval", response_model=List[DocumentResponse])
def list_pending_approval(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(Document).filter(
        Document.status == "pending_approval",
        Document.tenant_id.in_(user_tenants)
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(Document.tenant_id == tenant_id)
    
    documents = query.order_by(Document.created_at.desc()).all()
    return documents


@router.get("/review-due", response_model=List[DocumentResponse])
def list_review_due(
    tenant_id: Optional[int] = None,
    days_ahead: int = 30,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    cutoff_date = datetime.utcnow() + timedelta(days=days_ahead)
    
    query = db.query(Document).filter(
        Document.next_review_date <= cutoff_date,
        Document.status == "approved",
        Document.tenant_id.in_(user_tenants)
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(Document.tenant_id == tenant_id)
    
    documents = query.order_by(Document.next_review_date).all()
    return documents


@router.get("/{document_id}", response_model=dict)
def get_document(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(Document).options(
        joinedload(Document.versions),
        joinedload(Document.control_links)
    ).filter(
        Document.id == document_id,
        Document.tenant_id.in_(user_tenants)
    ).first()
    
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    return {
        "id": document.id,
        "tenant_id": document.tenant_id,
        "title": document.title,
        "content": document.content,
        "doc_type": document.doc_type,
        "version": document.version,
        "status": document.status,
        "owner_id": document.owner_id,
        "created_at": document.created_at.isoformat(),
        "approved_by": document.approved_by,
        "approved_at": document.approved_at.isoformat() if document.approved_at else None,
        "published_by": document.published_by,
        "published_at": document.published_at.isoformat() if document.published_at else None,
        "review_cycle_months": document.review_cycle_months,
        "next_review_date": document.next_review_date.isoformat() if document.next_review_date else None,
        "versions": [
            {
                "id": v.id,
                "version_number": v.version_number,
                "created_at": v.created_at.isoformat(),
                "created_by": v.created_by,
                "change_summary": v.change_summary
            }
            for v in sorted(document.versions, key=lambda x: x.version_number, reverse=True)
        ],
        "control_links": [
            {"id": link.id, "normalized_control_id": link.normalized_control_id}
            for link in document.control_links
        ]
    }


@router.put("/{document_id}", response_model=DocumentResponse)
def update_document(
    document_id: int,
    document_update: DocumentUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(Document).filter(
        Document.id == document_id,
        Document.tenant_id.in_(user_tenants)
    ).first()
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    version_parts = document.version.split(".")
    new_version = f"{version_parts[0]}.{int(version_parts[1]) + 1}"
    
    db_version = DocumentVersion(
        document_id=document_id,
        version_number=document.version,
        content=document.content,
        created_by=current_user.id,
        change_summary=document_update.change_summary
    )
    db.add(db_version)
    
    update_data = document_update.model_dump(exclude_unset=True, exclude={"change_summary"})
    for field, value in update_data.items():
        setattr(document, field, value)
    
    document.version = new_version
    
    db.commit()
    db.refresh(document)
    return document


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(Document).filter(
        Document.id == document_id,
        Document.tenant_id.in_(user_tenants)
    ).first()
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    db.delete(document)
    db.commit()
    return None


@router.get("/{document_id}/versions", response_model=List[DocumentVersionResponse])
def get_document_versions(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(Document).filter(
        Document.id == document_id,
        Document.tenant_id.in_(user_tenants)
    ).first()
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    versions = db.query(DocumentVersion).filter(
        DocumentVersion.document_id == document_id
    ).order_by(DocumentVersion.version_number.desc()).all()
    return versions


@router.get("/{document_id}/versions/{version}", response_model=DocumentVersionResponse)
def get_document_version(
    document_id: int,
    version: str,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(Document).filter(
        Document.id == document_id,
        Document.tenant_id.in_(user_tenants)
    ).first()
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    doc_version = db.query(DocumentVersion).filter(
        DocumentVersion.document_id == document_id,
        DocumentVersion.version_number == version
    ).first()
    
    if not doc_version:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Version not found"
        )
    
    return doc_version


@router.post("/{document_id}/submit-approval", response_model=MessageResponse)
def submit_for_approval(
    document_id: int,
    approval_request: DocumentApprovalRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(Document).filter(
        Document.id == document_id,
        Document.tenant_id.in_(user_tenants)
    ).first()
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    approver = db.query(GRCUser).filter(GRCUser.id == approval_request.approver_id).first()
    if not approver:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Approver not found"
        )
    
    workflow = DocumentApprovalWorkflow(
        document_id=document_id,
        approver_id=approval_request.approver_id
    )
    db.add(workflow)
    
    document.status = "pending_approval"
    
    db.commit()
    
    return MessageResponse(message="Document submitted for approval")


@router.post("/{document_id}/approve", response_model=DocumentResponse)
def approve_document(
    document_id: int,
    response: DocumentApprovalResponse,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(Document).filter(
        Document.id == document_id,
        Document.tenant_id.in_(user_tenants)
    ).first()
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    if document.status != "pending_approval":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Document is not pending approval"
        )
    
    workflow = db.query(DocumentApprovalWorkflow).filter(
        DocumentApprovalWorkflow.document_id == document_id,
        DocumentApprovalWorkflow.approver_id == current_user.id,
        DocumentApprovalWorkflow.status == "pending"
    ).first()
    
    if workflow:
        workflow.status = "approved"
        workflow.approved_at = datetime.utcnow()
        workflow.comments = response.comments
    
    document.status = "approved"
    document.approved_by = current_user.id
    document.approved_at = datetime.utcnow()
    document.next_review_date = datetime.utcnow() + timedelta(days=document.review_cycle_months * 30)
    
    db.commit()
    db.refresh(document)
    return document


@router.post("/{document_id}/reject", response_model=DocumentResponse)
def reject_document(
    document_id: int,
    response: DocumentApprovalResponse,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(Document).filter(
        Document.id == document_id,
        Document.tenant_id.in_(user_tenants)
    ).first()
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    if document.status != "pending_approval":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Document is not pending approval"
        )
    
    workflow = db.query(DocumentApprovalWorkflow).filter(
        DocumentApprovalWorkflow.document_id == document_id,
        DocumentApprovalWorkflow.approver_id == current_user.id,
        DocumentApprovalWorkflow.status == "pending"
    ).first()
    
    if workflow:
        workflow.status = "rejected"
        workflow.approved_at = datetime.utcnow()
        workflow.comments = response.comments
    
    document.status = "draft"
    
    db.commit()
    db.refresh(document)
    return document


@router.post("/{document_id}/controls", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
def link_document_to_control(
    document_id: int,
    link: DocumentControlLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(Document).filter(
        Document.id == document_id,
        Document.tenant_id.in_(user_tenants)
    ).first()
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    control = db.query(NormalizedControl).filter(
        NormalizedControl.id == link.normalized_control_id
    ).first()
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control not found"
        )
    
    existing = db.query(DocumentControlLink).filter(
        DocumentControlLink.document_id == document_id,
        DocumentControlLink.normalized_control_id == link.normalized_control_id
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Link already exists"
        )
    
    db_link = DocumentControlLink(
        document_id=document_id,
        normalized_control_id=link.normalized_control_id
    )
    db.add(db_link)
    db.commit()
    
    return MessageResponse(message="Control linked successfully")


@router.post("/{document_id}/publish", response_model=dict)
def publish_document(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """
    Publish a document - transitions status from 'approved' to 'published'.
    Makes the document available for attestations.
    """
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(Document).filter(
        Document.id == document_id,
        Document.tenant_id.in_(user_tenants)
    ).first()
    
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    if document.status != "approved":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Document must be approved before publishing. Current status: {document.status}"
        )
    
    version_parts = document.version.split(".")
    major_version = int(version_parts[0])
    if major_version < 1:
        new_version = "1.0"
    else:
        new_version = document.version
    
    document.status = "published"
    document.published_at = datetime.utcnow()
    document.published_by = current_user.id
    document.version = new_version
    
    db.commit()
    db.refresh(document)
    
    return {
        "message": "Document published successfully",
        "document": {
            "id": document.id,
            "title": document.title,
            "version": document.version,
            "status": document.status,
            "published_at": document.published_at.isoformat() if document.published_at else None,
            "published_by": document.published_by
        }
    }


@router.post("/{document_id}/request-attestation", response_model=dict)
def request_attestation(
    document_id: int,
    attestation_request: AttestationRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """
    Request attestations from users for a published document.
    Creates attestation records for each specified user.
    """
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(Document).filter(
        Document.id == document_id,
        Document.tenant_id.in_(user_tenants)
    ).first()
    
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    if document.status != "published":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Attestations can only be requested for published documents. Current status: {document.status}"
        )
    
    due_date = attestation_request.due_date or (datetime.utcnow() + timedelta(days=14))
    attestation_text = attestation_request.attestation_text or f"I acknowledge that I have read, understood, and agree to comply with the '{document.title}'."
    
    created_count = 0
    skipped_count = 0
    
    for user_id in attestation_request.user_ids:
        user = db.query(GRCUser).filter(GRCUser.id == user_id).first()
        if not user:
            skipped_count += 1
            continue
        
        existing = db.query(DocumentAttestation).filter(
            DocumentAttestation.document_id == document_id,
            DocumentAttestation.user_id == user_id,
            DocumentAttestation.status == "pending"
        ).first()
        
        if existing:
            skipped_count += 1
            continue
        
        attestation = DocumentAttestation(
            tenant_id=document.tenant_id,
            document_id=document_id,
            user_id=user_id,
            attestation_type="acknowledgment",
            status="pending",
            requested_by=current_user.id,
            due_date=due_date,
            attestation_text=attestation_text
        )
        db.add(attestation)
        created_count += 1
    
    db.commit()
    
    return {
        "message": f"Attestation requests created successfully",
        "attestations_created": created_count,
        "attestations_skipped": skipped_count,
        "due_date": due_date.isoformat(),
        "document_id": document_id,
        "document_title": document.title
    }
