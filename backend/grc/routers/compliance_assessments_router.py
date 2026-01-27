import os
import uuid
import io
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
import openpyxl
from openpyxl.utils import get_column_letter
import pandas as pd

from ..models import (
    ComplianceAssessmentDocument, ComplianceAssessmentDocumentItem,
    GRCUser, Tenant, get_db
)
from .auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/compliance/assessments", tags=["Compliance Assessments"])

UPLOAD_DIR = "backend/grc/uploads/compliance_assessments"
os.makedirs(UPLOAD_DIR, exist_ok=True)

COLUMN_MAPPINGS = {
    "item_number": ["sr", "sr.", "sr#", "s#", "s.no", "s.no.", "no", "no.", "item", "item no", "item number", "control id", "control #", "id", "ref", "reference", "#"],
    "area_domain": ["area", "domain", "category", "section", "control area", "control domain", "control category", "subject area", "topic", "area / domain", "area/domain"],
    "control_description": ["control", "control description", "description", "question", "requirement", "control statement", "control text", "control requirement", "security control", "checklist item", "audit question", "control measure", "control measure / activity", "question/parameter", "parameter"],
    "compliance_status": ["status", "compliance status", "compliance", "assessment status", "result", "response", "finding", "compliant", "complied", "compliance status(y/n)"],
    "gaps_identified": ["gap", "gaps", "gaps identified", "gap identified", "finding", "findings", "observations", "observation", "issues", "issue", "remarks", "audit remarks", "information security remarks", "internal audit"],
    "proposed_solution": ["solution", "proposed solution", "remediation", "recommendation", "recommendations", "action", "corrective action", "proposed action", "mitigation", "proposed solution for compliance"],
    "responsible_party": ["responsible", "responsibility", "responsible party", "owner", "responsible person", "assigned to", "assignee", "department", "itg comments"],
    "timeline": ["timeline", "due date", "target date", "deadline", "completion date", "expected date", "target", "date", "timeline for compliance"],
    "priority": ["priority", "severity", "criticality", "risk level", "importance", "risk rating", "risk"],
    "evidence_reference": ["evidence", "evidence reference", "evidence ref", "documentation", "doc reference", "proof", "supporting evidence"],
    "remarks": ["remarks", "comments", "notes", "additional comments", "additional notes", "remark", "itg comments"]
}

COLUMN_KEYWORDS_PRIORITY = [
    ("compliance_status", ["status", "compliance", "compliant"]),
    ("control_description", ["control measure", "control description", "question/parameter", "checklist"]),
    ("area_domain", ["area / domain", "area/domain", "domain", "category", "section"]),
    ("gaps_identified", ["gaps identified", "gap assessment", "finding", "observation"]),
    ("proposed_solution", ["proposed solution", "solution for compliance", "remediation", "recommendation"]),
    ("responsible_party", ["responsible", "owner", "assigned", "assignee", "itg comment"]),
    ("timeline", ["timeline", "due date", "deadline", "target date"]),
    ("item_number", ["sr", "s#", "s.no", "no.", "item"]),
    ("priority", ["priority", "severity", "criticality", "risk level"]),
    ("evidence_reference", ["evidence", "documentation"]),
    ("remarks", ["remark", "comment", "note"]),
]

STATUS_MAPPINGS = {
    "complied": ["complied", "yes", "y", "complete", "completed", "done", "met", "satisfied", "in place", "implemented", "fully complied", "fully implemented", "pass", "passed", "conform", "conforms", "conforming"],
    "partially_complied": ["partial", "partially", "partially complied", "partial compliance", "in progress", "wip", "work in progress", "partially met", "partially implemented", "partially done", "some"],
    "not_complied": ["not complied", "no", "n", "not met", "not satisfied", "not implemented", "non-compliant", "non compliant", "fail", "failed", "missing", "absent", "not in place", "gap", "not done"],
    "in_progress": ["in progress", "ongoing", "pending", "wip", "work in progress", "under development", "being implemented"],
    "na": ["na", "n/a", "not applicable", "not relevant", "n.a.", "n.a", "-", "none"]
}


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def normalize_status(value: str) -> str:
    if not value:
        return "in_progress"
    value_lower = str(value).lower().strip()
    for status_key, variants in STATUS_MAPPINGS.items():
        if value_lower in variants:
            return status_key
    return "in_progress"


def find_column_mapping(header: str) -> Optional[str]:
    if not header:
        return None
    header_lower = header.lower().strip()
    header_clean = ''.join(c for c in header_lower if c.isalnum() or c in ' /')
    
    for field, variants in COLUMN_MAPPINGS.items():
        if header_lower in variants or header_clean in variants:
            return field
    
    for field, keywords in COLUMN_KEYWORDS_PRIORITY:
        for keyword in keywords:
            if keyword in header_lower:
                return field
    
    return None


def parse_excel_file(file_content: bytes, file_name: str) -> tuple[List[dict], dict]:
    items = []
    column_map = {}
    current_area = None
    
    try:
        if file_name.endswith('.csv'):
            df = pd.read_csv(io.BytesIO(file_content))
            headers = df.columns.tolist()
            for idx, header in enumerate(headers):
                field = find_column_mapping(str(header))
                if field:
                    column_map[field] = header
            
            for _, row in df.iterrows():
                item = extract_row_data(row, column_map, current_area)
                if item.get("control_description"):
                    if item.get("area_domain"):
                        current_area = item["area_domain"]
                    elif current_area:
                        item["area_domain"] = current_area
                    items.append(item)
        else:
            wb = openpyxl.load_workbook(io.BytesIO(file_content), data_only=True)
            ws = wb.active
            
            headers = []
            header_row_idx = 1
            for row_idx in range(1, min(10, ws.max_row + 1)):
                row_values = [cell.value for cell in ws[row_idx] if cell.value]
                if len(row_values) >= 3:
                    potential_headers = [cell.value for cell in ws[row_idx]]
                    matches = sum(1 for h in potential_headers if h and find_column_mapping(str(h)))
                    if matches >= 2:
                        headers = potential_headers
                        header_row_idx = row_idx
                        break
            
            if not headers:
                headers = [cell.value for cell in ws[1]]
                header_row_idx = 1
            
            for col_idx, header in enumerate(headers):
                if header:
                    field = find_column_mapping(str(header))
                    if field:
                        column_map[field] = col_idx
            
            merged_ranges = list(ws.merged_cells.ranges)
            
            for row_idx in range(header_row_idx + 1, ws.max_row + 1):
                row_data = {}
                row_values = [cell.value for cell in ws[row_idx]]
                
                for cell in ws[row_idx]:
                    for merged_range in merged_ranges:
                        if cell.coordinate in merged_range:
                            top_left_cell = ws.cell(row=merged_range.min_row, column=merged_range.min_col)
                            if top_left_cell.value:
                                for field, col_idx in column_map.items():
                                    if col_idx == cell.column - 1:
                                        if field == "area_domain":
                                            current_area = str(top_left_cell.value).strip()
                
                for field, col_idx in column_map.items():
                    if col_idx < len(row_values):
                        value = row_values[col_idx]
                        if value is not None:
                            row_data[field] = str(value).strip() if value else None
                
                if not row_data.get("area_domain") and current_area:
                    row_data["area_domain"] = current_area
                elif row_data.get("area_domain"):
                    current_area = row_data["area_domain"]
                
                if row_data.get("control_description"):
                    if row_data.get("compliance_status"):
                        row_data["compliance_status"] = normalize_status(row_data["compliance_status"])
                    items.append(row_data)
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to parse file: {str(e)}"
        )
    
    return items, column_map


def extract_row_data(row, column_map: dict, current_area: str) -> dict:
    item = {}
    for field, col_name in column_map.items():
        value = row.get(col_name)
        if pd.notna(value):
            item[field] = str(value).strip()
    
    if item.get("compliance_status"):
        item["compliance_status"] = normalize_status(item["compliance_status"])
    
    if not item.get("area_domain") and current_area:
        item["area_domain"] = current_area
    
    return item


def calculate_assessment_stats(items: List[ComplianceAssessmentDocumentItem]) -> dict:
    stats = {
        "total": len(items),
        "complied": 0,
        "partially_complied": 0,
        "not_complied": 0,
        "in_progress": 0,
        "na": 0,
        "overall_score": 0.0
    }
    
    for item in items:
        status_val = item.compliance_status or "in_progress"
        if status_val in stats:
            stats[status_val] += 1
    
    applicable_items = stats["total"] - stats["na"]
    if applicable_items > 0:
        stats["overall_score"] = round(
            (stats["complied"] + (stats["partially_complied"] * 0.5)) / applicable_items * 100, 2
        )
    
    return stats


@router.post("/upload")
async def upload_assessment(
    name: str = Form(...),
    assessment_type: str = Form(...),
    source: Optional[str] = Form(None),
    due_date: Optional[str] = Form(None),
    assessor: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    tenant_id: Optional[int] = Form(None),
    file: UploadFile = File(...),
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
    
    if not file.filename.endswith(('.xlsx', '.xls', '.csv')):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be an Excel (.xlsx, .xls) or CSV file"
        )
    
    file_content = await file.read()
    file_ext = os.path.splitext(file.filename)[1]
    file_id = str(uuid.uuid4())
    file_path = os.path.join(UPLOAD_DIR, f"{file_id}{file_ext}")
    
    with open(file_path, "wb") as f:
        f.write(file_content)
    
    items_data, column_map = parse_excel_file(file_content, file.filename)
    
    if not items_data:
        os.remove(file_path)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No valid assessment items found in the file. Please check the column headers."
        )
    
    parsed_due_date = None
    if due_date:
        try:
            parsed_due_date = datetime.fromisoformat(due_date.replace('Z', '+00:00'))
        except:
            pass
    
    db_assessment = ComplianceAssessmentDocument(
        tenant_id=tenant_id,
        name=name,
        assessment_type=assessment_type,
        source=source,
        file_name=file.filename,
        file_path=file_path,
        due_date=parsed_due_date,
        assessor=assessor,
        notes=notes,
        status="draft",
        created_by=current_user.id,
        total_items=len(items_data)
    )
    db.add(db_assessment)
    db.flush()
    
    for idx, item_data in enumerate(items_data):
        db_item = ComplianceAssessmentDocumentItem(
            assessment_id=db_assessment.id,
            tenant_id=tenant_id,
            item_number=item_data.get("item_number") or str(idx + 1),
            area_domain=item_data.get("area_domain"),
            control_description=item_data.get("control_description"),
            compliance_status=item_data.get("compliance_status", "in_progress"),
            gaps_identified=item_data.get("gaps_identified"),
            proposed_solution=item_data.get("proposed_solution"),
            responsible_party=item_data.get("responsible_party"),
            timeline=item_data.get("timeline"),
            priority=item_data.get("priority"),
            evidence_reference=item_data.get("evidence_reference"),
            remarks=item_data.get("remarks")
        )
        db.add(db_item)
    
    db.flush()
    
    items = db.query(ComplianceAssessmentDocumentItem).filter(
        ComplianceAssessmentDocumentItem.assessment_id == db_assessment.id
    ).all()
    stats = calculate_assessment_stats(items)
    
    db_assessment.complied_count = stats["complied"]
    db_assessment.partially_complied_count = stats["partially_complied"]
    db_assessment.not_complied_count = stats["not_complied"]
    db_assessment.in_progress_count = stats["in_progress"]
    db_assessment.na_count = stats["na"]
    db_assessment.overall_score = stats["overall_score"]
    
    db.commit()
    db.refresh(db_assessment)
    
    return {
        "id": db_assessment.id,
        "name": db_assessment.name,
        "assessment_type": db_assessment.assessment_type,
        "source": db_assessment.source,
        "file_name": db_assessment.file_name,
        "status": db_assessment.status,
        "total_items": db_assessment.total_items,
        "complied_count": db_assessment.complied_count,
        "partially_complied_count": db_assessment.partially_complied_count,
        "not_complied_count": db_assessment.not_complied_count,
        "in_progress_count": db_assessment.in_progress_count,
        "na_count": db_assessment.na_count,
        "overall_score": db_assessment.overall_score,
        "columns_detected": list(column_map.keys()),
        "message": f"Successfully uploaded assessment with {len(items_data)} items"
    }


@router.get("")
def list_assessments(
    tenant_id: Optional[int] = None,
    assessment_type: Optional[str] = None,
    status_filter: Optional[str] = None,
    source: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"assessments": [], "total": 0, "summary": {}}
    
    query = db.query(ComplianceAssessmentDocument).filter(
        ComplianceAssessmentDocument.tenant_id.in_(user_tenants)
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(ComplianceAssessmentDocument.tenant_id == tenant_id)
    if assessment_type:
        query = query.filter(ComplianceAssessmentDocument.assessment_type == assessment_type)
    if status_filter:
        query = query.filter(ComplianceAssessmentDocument.status == status_filter)
    if source:
        query = query.filter(ComplianceAssessmentDocument.source == source)
    
    total = query.count()
    assessments = query.order_by(ComplianceAssessmentDocument.created_at.desc()).offset(skip).limit(limit).all()
    
    total_items = sum(a.total_items or 0 for a in assessments)
    total_complied = sum(a.complied_count or 0 for a in assessments)
    total_not_complied = sum(a.not_complied_count or 0 for a in assessments)
    
    return {
        "assessments": [
            {
                "id": a.id,
                "name": a.name,
                "assessment_type": a.assessment_type,
                "source": a.source,
                "file_name": a.file_name,
                "status": a.status,
                "due_date": a.due_date.isoformat() if a.due_date else None,
                "assessor": a.assessor,
                "overall_score": a.overall_score,
                "total_items": a.total_items,
                "complied_count": a.complied_count,
                "partially_complied_count": a.partially_complied_count,
                "not_complied_count": a.not_complied_count,
                "in_progress_count": a.in_progress_count,
                "na_count": a.na_count,
                "created_at": a.created_at.isoformat(),
                "updated_at": a.updated_at.isoformat() if a.updated_at else None
            }
            for a in assessments
        ],
        "total": total,
        "summary": {
            "total_assessments": total,
            "total_items": total_items,
            "total_complied": total_complied,
            "total_not_complied": total_not_complied,
            "by_type": {},
            "by_status": {}
        }
    }


@router.get("/{assessment_id}")
def get_assessment(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    assessment = db.query(ComplianceAssessmentDocument).options(
        joinedload(ComplianceAssessmentDocument.items)
    ).filter(
        ComplianceAssessmentDocument.id == assessment_id,
        ComplianceAssessmentDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not assessment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assessment not found"
        )
    
    items_by_domain = {}
    for item in assessment.items:
        domain = item.area_domain or "Uncategorized"
        if domain not in items_by_domain:
            items_by_domain[domain] = []
        items_by_domain[domain].append({
            "id": item.id,
            "item_number": item.item_number,
            "area_domain": item.area_domain,
            "control_description": item.control_description,
            "compliance_status": item.compliance_status,
            "gaps_identified": item.gaps_identified,
            "proposed_solution": item.proposed_solution,
            "responsible_party": item.responsible_party,
            "timeline": item.timeline,
            "priority": item.priority,
            "evidence_reference": item.evidence_reference,
            "remarks": item.remarks,
            "created_at": item.created_at.isoformat(),
            "updated_at": item.updated_at.isoformat() if item.updated_at else None
        })
    
    return {
        "id": assessment.id,
        "tenant_id": assessment.tenant_id,
        "name": assessment.name,
        "assessment_type": assessment.assessment_type,
        "source": assessment.source,
        "file_name": assessment.file_name,
        "status": assessment.status,
        "due_date": assessment.due_date.isoformat() if assessment.due_date else None,
        "assessor": assessment.assessor,
        "overall_score": assessment.overall_score,
        "total_items": assessment.total_items,
        "complied_count": assessment.complied_count,
        "partially_complied_count": assessment.partially_complied_count,
        "not_complied_count": assessment.not_complied_count,
        "in_progress_count": assessment.in_progress_count,
        "na_count": assessment.na_count,
        "notes": assessment.notes,
        "created_at": assessment.created_at.isoformat(),
        "updated_at": assessment.updated_at.isoformat() if assessment.updated_at else None,
        "items": [
            {
                "id": item.id,
                "item_number": item.item_number,
                "area_domain": item.area_domain,
                "control_description": item.control_description,
                "compliance_status": item.compliance_status,
                "gaps_identified": item.gaps_identified,
                "proposed_solution": item.proposed_solution,
                "responsible_party": item.responsible_party,
                "timeline": item.timeline,
                "priority": item.priority,
                "evidence_reference": item.evidence_reference,
                "remarks": item.remarks,
                "created_at": item.created_at.isoformat(),
                "updated_at": item.updated_at.isoformat() if item.updated_at else None
            }
            for item in assessment.items
        ],
        "items_by_domain": items_by_domain
    }


@router.put("/{assessment_id}")
def update_assessment(
    assessment_id: int,
    name: Optional[str] = None,
    assessment_type: Optional[str] = None,
    source: Optional[str] = None,
    status: Optional[str] = None,
    due_date: Optional[str] = None,
    assessor: Optional[str] = None,
    notes: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    assessment = db.query(ComplianceAssessmentDocument).filter(
        ComplianceAssessmentDocument.id == assessment_id,
        ComplianceAssessmentDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not assessment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assessment not found"
        )
    
    if name is not None:
        assessment.name = name
    if assessment_type is not None:
        assessment.assessment_type = assessment_type
    if source is not None:
        assessment.source = source
    if status is not None:
        assessment.status = status
    if assessor is not None:
        assessment.assessor = assessor
    if notes is not None:
        assessment.notes = notes
    if due_date is not None:
        try:
            assessment.due_date = datetime.fromisoformat(due_date.replace('Z', '+00:00'))
        except:
            pass
    
    assessment.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(assessment)
    
    return {
        "id": assessment.id,
        "name": assessment.name,
        "assessment_type": assessment.assessment_type,
        "source": assessment.source,
        "status": assessment.status,
        "due_date": assessment.due_date.isoformat() if assessment.due_date else None,
        "assessor": assessment.assessor,
        "notes": assessment.notes,
        "updated_at": assessment.updated_at.isoformat()
    }


@router.put("/items/{item_id}")
def update_assessment_item(
    item_id: int,
    compliance_status: Optional[str] = None,
    gaps_identified: Optional[str] = None,
    proposed_solution: Optional[str] = None,
    responsible_party: Optional[str] = None,
    timeline: Optional[str] = None,
    priority: Optional[str] = None,
    evidence_reference: Optional[str] = None,
    remarks: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    item = db.query(ComplianceAssessmentDocumentItem).filter(
        ComplianceAssessmentDocumentItem.id == item_id,
        ComplianceAssessmentDocumentItem.tenant_id.in_(user_tenants)
    ).first()
    
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assessment item not found"
        )
    
    if compliance_status is not None:
        item.compliance_status = normalize_status(compliance_status)
    if gaps_identified is not None:
        item.gaps_identified = gaps_identified
    if proposed_solution is not None:
        item.proposed_solution = proposed_solution
    if responsible_party is not None:
        item.responsible_party = responsible_party
    if timeline is not None:
        item.timeline = timeline
    if priority is not None:
        item.priority = priority
    if evidence_reference is not None:
        item.evidence_reference = evidence_reference
    if remarks is not None:
        item.remarks = remarks
    
    item.updated_at = datetime.utcnow()
    db.commit()
    
    assessment = db.query(ComplianceAssessmentDocument).filter(
        ComplianceAssessmentDocument.id == item.assessment_id
    ).first()
    
    if assessment:
        items = db.query(ComplianceAssessmentDocumentItem).filter(
            ComplianceAssessmentDocumentItem.assessment_id == assessment.id
        ).all()
        stats = calculate_assessment_stats(items)
        
        assessment.complied_count = stats["complied"]
        assessment.partially_complied_count = stats["partially_complied"]
        assessment.not_complied_count = stats["not_complied"]
        assessment.in_progress_count = stats["in_progress"]
        assessment.na_count = stats["na"]
        assessment.overall_score = stats["overall_score"]
        assessment.updated_at = datetime.utcnow()
        db.commit()
    
    db.refresh(item)
    
    return {
        "id": item.id,
        "item_number": item.item_number,
        "area_domain": item.area_domain,
        "control_description": item.control_description,
        "compliance_status": item.compliance_status,
        "gaps_identified": item.gaps_identified,
        "proposed_solution": item.proposed_solution,
        "responsible_party": item.responsible_party,
        "timeline": item.timeline,
        "priority": item.priority,
        "evidence_reference": item.evidence_reference,
        "remarks": item.remarks,
        "updated_at": item.updated_at.isoformat()
    }


@router.delete("/{assessment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_assessment(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    assessment = db.query(ComplianceAssessmentDocument).filter(
        ComplianceAssessmentDocument.id == assessment_id,
        ComplianceAssessmentDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not assessment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assessment not found"
        )
    
    if assessment.file_path and os.path.exists(assessment.file_path):
        try:
            os.remove(assessment.file_path)
        except:
            pass
    
    db.delete(assessment)
    db.commit()
    return None


@router.get("/{assessment_id}/export")
def export_assessment(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    assessment = db.query(ComplianceAssessmentDocument).options(
        joinedload(ComplianceAssessmentDocument.items)
    ).filter(
        ComplianceAssessmentDocument.id == assessment_id,
        ComplianceAssessmentDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not assessment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assessment not found"
        )
    
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Assessment Items"
    
    headers = [
        "Item #", "Area/Domain", "Control Description", "Compliance Status",
        "Gaps Identified", "Proposed Solution", "Responsible Party",
        "Timeline", "Priority", "Evidence Reference", "Remarks"
    ]
    ws.append(headers)
    
    for cell in ws[1]:
        cell.font = openpyxl.styles.Font(bold=True)
        cell.fill = openpyxl.styles.PatternFill(start_color="366092", end_color="366092", fill_type="solid")
        cell.font = openpyxl.styles.Font(bold=True, color="FFFFFF")
    
    for item in assessment.items:
        ws.append([
            item.item_number,
            item.area_domain,
            item.control_description,
            item.compliance_status,
            item.gaps_identified,
            item.proposed_solution,
            item.responsible_party,
            item.timeline,
            item.priority,
            item.evidence_reference,
            item.remarks
        ])
    
    for col_idx in range(1, len(headers) + 1):
        ws.column_dimensions[get_column_letter(col_idx)].width = 20
    
    ws.column_dimensions['C'].width = 50
    ws.column_dimensions['E'].width = 40
    ws.column_dimensions['F'].width = 40
    
    summary_ws = wb.create_sheet("Summary")
    summary_ws.append(["Assessment Summary"])
    summary_ws.append([])
    summary_ws.append(["Name", assessment.name])
    summary_ws.append(["Type", assessment.assessment_type])
    summary_ws.append(["Source", assessment.source or ""])
    summary_ws.append(["Status", assessment.status])
    summary_ws.append(["Assessor", assessment.assessor or ""])
    summary_ws.append(["Due Date", assessment.due_date.strftime("%Y-%m-%d") if assessment.due_date else ""])
    summary_ws.append([])
    summary_ws.append(["Compliance Statistics"])
    summary_ws.append(["Total Items", assessment.total_items])
    summary_ws.append(["Complied", assessment.complied_count])
    summary_ws.append(["Partially Complied", assessment.partially_complied_count])
    summary_ws.append(["Not Complied", assessment.not_complied_count])
    summary_ws.append(["In Progress", assessment.in_progress_count])
    summary_ws.append(["N/A", assessment.na_count])
    summary_ws.append(["Overall Score", f"{assessment.overall_score or 0}%"])
    
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    
    safe_name = "".join(c for c in assessment.name if c.isalnum() or c in (' ', '-', '_')).strip()
    filename = f"{safe_name}_export.xlsx"
    
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.get("/types/list")
def get_assessment_types():
    return {
        "assessment_types": [
            {"value": "gap_assessment", "label": "Gap Assessment"},
            {"value": "security_checklist", "label": "Security Checklist"},
            {"value": "internal_audit", "label": "Internal Audit"},
            {"value": "external_audit", "label": "External Audit"},
            {"value": "regulatory_assessment", "label": "Regulatory Assessment"},
            {"value": "vendor_assessment", "label": "Vendor Assessment"},
            {"value": "self_assessment", "label": "Self Assessment"},
            {"value": "maturity_assessment", "label": "Maturity Assessment"}
        ],
        "sources": [
            {"value": "SBP", "label": "State Bank of Pakistan"},
            {"value": "Internal", "label": "Internal"},
            {"value": "External Auditor", "label": "External Auditor"},
            {"value": "Regulator", "label": "Regulator"},
            {"value": "Vendor", "label": "Vendor"},
            {"value": "Other", "label": "Other"}
        ],
        "compliance_statuses": [
            {"value": "complied", "label": "Complied"},
            {"value": "partially_complied", "label": "Partially Complied"},
            {"value": "not_complied", "label": "Not Complied"},
            {"value": "in_progress", "label": "In Progress"},
            {"value": "na", "label": "N/A"}
        ],
        "priorities": [
            {"value": "critical", "label": "Critical"},
            {"value": "high", "label": "High"},
            {"value": "medium", "label": "Medium"},
            {"value": "low", "label": "Low"}
        ]
    }
