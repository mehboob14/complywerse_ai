from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ....models import (
    PolicyStatement, PolicyStatementCompliance, GovernanceDocument,
    GRCUser, Evidence, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/statements", tags=["Policy Statements"])


class StatementUpdateRequest(BaseModel):
    category: Optional[str] = None
    sub_category: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    is_mandatory: Optional[bool] = None
    review_date: Optional[datetime] = None


class ComplianceUpdateRequest(BaseModel):
    compliance_status: str
    compliance_score: Optional[float] = None
    findings: Optional[str] = None
    remediation_notes: Optional[str] = None
    remediation_due_date: Optional[datetime] = None
    next_assessment_date: Optional[datetime] = None
    owner_id: Optional[int] = None
    department: Optional[str] = None


class EvidenceLinkRequest(BaseModel):
    evidence_ids: List[int]


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def get_or_create_compliance_record(db: Session, statement_id: int, tenant_id: int) -> PolicyStatementCompliance:
    record = db.query(PolicyStatementCompliance).filter(
        PolicyStatementCompliance.statement_id == statement_id,
        PolicyStatementCompliance.tenant_id == tenant_id
    ).first()
    
    if not record:
        record = PolicyStatementCompliance(
            tenant_id=tenant_id,
            statement_id=statement_id,
            compliance_status="not_assessed"
        )
        db.add(record)
        db.commit()
        db.refresh(record)
    
    return record


@router.get("")
def list_policy_statements(
    tenant_id: Optional[int] = None,
    document_id: Optional[int] = None,
    category: Optional[str] = None,
    compliance_status: Optional[str] = None,
    priority: Optional[str] = None,
    statement_status: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"statements": [], "total": 0}
    
    query = db.query(PolicyStatement).filter(PolicyStatement.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(PolicyStatement.tenant_id == tenant_id)
    
    if document_id:
        query = query.filter(PolicyStatement.document_id == document_id)
    
    if category:
        query = query.filter(PolicyStatement.category == category)
    
    if priority:
        query = query.filter(PolicyStatement.priority == priority)
    
    if statement_status:
        query = query.filter(PolicyStatement.status == statement_status)
    
    if compliance_status:
        statement_ids = db.query(PolicyStatementCompliance.statement_id).filter(
            PolicyStatementCompliance.compliance_status == compliance_status
        ).subquery()
        query = query.filter(PolicyStatement.id.in_(statement_ids))
    
    total = query.count()
    statements = query.order_by(PolicyStatement.id.desc()).offset(skip).limit(limit).all()
    
    result = []
    for stmt in statements:
        compliance = db.query(PolicyStatementCompliance).filter(
            PolicyStatementCompliance.statement_id == stmt.id
        ).first()
        
        document = db.query(GovernanceDocument).filter(
            GovernanceDocument.id == stmt.document_id
        ).first()
        
        result.append({
            "id": stmt.id,
            "tenant_id": stmt.tenant_id,
            "document_id": stmt.document_id,
            "document_title": document.title if document else None,
            "document_code": document.document_code if document else None,
            "statement_code": stmt.statement_code,
            "statement_text": stmt.statement_text,
            "statement_summary": stmt.statement_summary,
            "category": stmt.category,
            "sub_category": stmt.sub_category,
            "priority": stmt.priority,
            "is_mandatory": stmt.is_mandatory,
            "status": stmt.status,
            "effective_date": stmt.effective_date.isoformat() if stmt.effective_date else None,
            "review_date": stmt.review_date.isoformat() if stmt.review_date else None,
            "source_section": stmt.source_section,
            "ai_confidence": stmt.ai_confidence,
            "compliance_status": compliance.compliance_status if compliance else "not_assessed",
            "compliance_score": compliance.compliance_score if compliance else None,
            "next_assessment_date": compliance.next_assessment_date.isoformat() if compliance and compliance.next_assessment_date else None,
            "created_at": stmt.created_at.isoformat() if stmt.created_at else None
        })
    
    return {"statements": result, "total": total, "skip": skip, "limit": limit}


@router.get("/by-document/{document_id}")
def get_statements_by_document(
    document_id: int,
    category: Optional[str] = None,
    compliance_status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"statements": [], "total": 0}
    
    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    query = db.query(PolicyStatement).filter(PolicyStatement.document_id == document_id)
    
    if category:
        query = query.filter(PolicyStatement.category == category)
    
    if compliance_status:
        statement_ids = db.query(PolicyStatementCompliance.statement_id).filter(
            PolicyStatementCompliance.compliance_status == compliance_status
        ).subquery()
        query = query.filter(PolicyStatement.id.in_(statement_ids))
    
    statements = query.order_by(PolicyStatement.statement_code).all()
    
    result = []
    for stmt in statements:
        compliance = db.query(PolicyStatementCompliance).filter(
            PolicyStatementCompliance.statement_id == stmt.id
        ).first()
        
        result.append({
            "id": stmt.id,
            "statement_code": stmt.statement_code,
            "statement_text": stmt.statement_text,
            "statement_summary": stmt.statement_summary,
            "category": stmt.category,
            "sub_category": stmt.sub_category,
            "priority": stmt.priority,
            "is_mandatory": stmt.is_mandatory,
            "status": stmt.status,
            "source_section": stmt.source_section,
            "source_page": stmt.source_page,
            "ai_confidence": stmt.ai_confidence,
            "ai_extracted_keywords": stmt.ai_extracted_keywords,
            "ai_suggested_controls": stmt.ai_suggested_controls,
            "compliance_status": compliance.compliance_status if compliance else "not_assessed",
            "compliance_score": compliance.compliance_score if compliance else None,
            "findings": compliance.findings if compliance else None,
            "evidence_ids": compliance.evidence_ids if compliance else []
        })
    
    return {
        "document_id": document_id,
        "document_title": document.title,
        "document_code": document.document_code,
        "statements": result,
        "total": len(result)
    }


@router.get("/{statement_id}")
def get_statement_details(
    statement_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=404, detail="Statement not found")
    
    statement = db.query(PolicyStatement).filter(
        PolicyStatement.id == statement_id,
        PolicyStatement.tenant_id.in_(user_tenants)
    ).first()
    
    if not statement:
        raise HTTPException(status_code=404, detail="Statement not found")
    
    compliance = db.query(PolicyStatementCompliance).filter(
        PolicyStatementCompliance.statement_id == statement_id
    ).first()
    
    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == statement.document_id
    ).first()
    
    owner = None
    assessor = None
    if compliance:
        if compliance.owner_id:
            owner = db.query(GRCUser).filter(GRCUser.id == compliance.owner_id).first()
        if compliance.assessed_by:
            assessor = db.query(GRCUser).filter(GRCUser.id == compliance.assessed_by).first()
    
    evidence_list = []
    if compliance and compliance.evidence_ids:
        for eid in compliance.evidence_ids:
            ev = db.query(Evidence).filter(Evidence.id == eid).first()
            if ev:
                evidence_list.append({
                    "id": ev.id,
                    "name": ev.name,
                    "file_name": ev.file_name,
                    "status": ev.status
                })
    
    return {
        "id": statement.id,
        "tenant_id": statement.tenant_id,
        "document_id": statement.document_id,
        "document_title": document.title if document else None,
        "document_code": document.document_code if document else None,
        "document_version_id": statement.document_version_id,
        "statement_code": statement.statement_code,
        "statement_text": statement.statement_text,
        "statement_summary": statement.statement_summary,
        "category": statement.category,
        "sub_category": statement.sub_category,
        "priority": statement.priority,
        "is_mandatory": statement.is_mandatory,
        "status": statement.status,
        "effective_date": statement.effective_date.isoformat() if statement.effective_date else None,
        "review_date": statement.review_date.isoformat() if statement.review_date else None,
        "source_section": statement.source_section,
        "source_page": statement.source_page,
        "ai_confidence": statement.ai_confidence,
        "ai_extracted_keywords": statement.ai_extracted_keywords,
        "ai_suggested_controls": statement.ai_suggested_controls,
        "created_at": statement.created_at.isoformat() if statement.created_at else None,
        "updated_at": statement.updated_at.isoformat() if statement.updated_at else None,
        "compliance": {
            "id": compliance.id if compliance else None,
            "compliance_status": compliance.compliance_status if compliance else "not_assessed",
            "compliance_score": compliance.compliance_score if compliance else None,
            "owner_id": compliance.owner_id if compliance else None,
            "owner_name": owner.display_name if owner else None,
            "department": compliance.department if compliance else None,
            "assessment_date": compliance.assessment_date.isoformat() if compliance and compliance.assessment_date else None,
            "assessed_by": compliance.assessed_by if compliance else None,
            "assessor_name": assessor.display_name if assessor else None,
            "next_assessment_date": compliance.next_assessment_date.isoformat() if compliance and compliance.next_assessment_date else None,
            "findings": compliance.findings if compliance else None,
            "remediation_notes": compliance.remediation_notes if compliance else None,
            "remediation_due_date": compliance.remediation_due_date.isoformat() if compliance and compliance.remediation_due_date else None,
            "evidence_ids": compliance.evidence_ids if compliance else [],
            "control_ids": compliance.control_ids if compliance else []
        } if compliance else None,
        "evidence": evidence_list
    }


@router.put("/{statement_id}")
def update_statement(
    statement_id: int,
    update_data: StatementUpdateRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=404, detail="Statement not found")
    
    statement = db.query(PolicyStatement).filter(
        PolicyStatement.id == statement_id,
        PolicyStatement.tenant_id.in_(user_tenants)
    ).first()
    
    if not statement:
        raise HTTPException(status_code=404, detail="Statement not found")
    
    if update_data.category is not None:
        statement.category = update_data.category
    if update_data.sub_category is not None:
        statement.sub_category = update_data.sub_category
    if update_data.priority is not None:
        statement.priority = update_data.priority
    if update_data.status is not None:
        statement.status = update_data.status
    if update_data.is_mandatory is not None:
        statement.is_mandatory = update_data.is_mandatory
    if update_data.review_date is not None:
        statement.review_date = update_data.review_date
    
    statement.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(statement)
    
    return {
        "message": "Statement updated successfully",
        "statement_id": statement.id,
        "updated_fields": {k: v for k, v in update_data.dict().items() if v is not None}
    }


@router.put("/{statement_id}/compliance")
def update_compliance_status(
    statement_id: int,
    compliance_data: ComplianceUpdateRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=404, detail="Statement not found")
    
    statement = db.query(PolicyStatement).filter(
        PolicyStatement.id == statement_id,
        PolicyStatement.tenant_id.in_(user_tenants)
    ).first()
    
    if not statement:
        raise HTTPException(status_code=404, detail="Statement not found")
    
    valid_statuses = ["compliant", "partially_compliant", "non_compliant", "not_assessed", "not_applicable"]
    if compliance_data.compliance_status not in valid_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid compliance status. Must be one of: {valid_statuses}"
        )
    
    compliance = get_or_create_compliance_record(db, statement_id, statement.tenant_id)
    
    compliance.compliance_status = compliance_data.compliance_status
    compliance.assessment_date = datetime.utcnow()
    compliance.assessed_by = current_user.id
    
    if compliance_data.compliance_score is not None:
        compliance.compliance_score = compliance_data.compliance_score
    if compliance_data.findings is not None:
        compliance.findings = compliance_data.findings
    if compliance_data.remediation_notes is not None:
        compliance.remediation_notes = compliance_data.remediation_notes
    if compliance_data.remediation_due_date is not None:
        compliance.remediation_due_date = compliance_data.remediation_due_date
    if compliance_data.next_assessment_date is not None:
        compliance.next_assessment_date = compliance_data.next_assessment_date
    if compliance_data.owner_id is not None:
        compliance.owner_id = compliance_data.owner_id
    if compliance_data.department is not None:
        compliance.department = compliance_data.department
    
    compliance.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(compliance)
    
    return {
        "message": "Compliance status updated successfully",
        "statement_id": statement_id,
        "compliance_id": compliance.id,
        "compliance_status": compliance.compliance_status,
        "assessment_date": compliance.assessment_date.isoformat() if compliance.assessment_date else None
    }


@router.post("/{statement_id}/evidence")
def link_evidence_to_compliance(
    statement_id: int,
    evidence_data: EvidenceLinkRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=404, detail="Statement not found")
    
    statement = db.query(PolicyStatement).filter(
        PolicyStatement.id == statement_id,
        PolicyStatement.tenant_id.in_(user_tenants)
    ).first()
    
    if not statement:
        raise HTTPException(status_code=404, detail="Statement not found")
    
    valid_evidence_ids = []
    for eid in evidence_data.evidence_ids:
        ev = db.query(Evidence).filter(
            Evidence.id == eid,
            Evidence.tenant_id.in_(user_tenants)
        ).first()
        if ev:
            valid_evidence_ids.append(eid)
    
    if not valid_evidence_ids:
        raise HTTPException(status_code=400, detail="No valid evidence IDs provided")
    
    compliance = get_or_create_compliance_record(db, statement_id, statement.tenant_id)
    
    existing_ids = compliance.evidence_ids or []
    updated_ids = list(set(existing_ids + valid_evidence_ids))
    compliance.evidence_ids = updated_ids
    compliance.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(compliance)
    
    return {
        "message": "Evidence linked successfully",
        "statement_id": statement_id,
        "compliance_id": compliance.id,
        "evidence_ids": compliance.evidence_ids,
        "newly_linked": [eid for eid in valid_evidence_ids if eid not in existing_ids]
    }
