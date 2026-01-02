import os
import json
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from pydantic import BaseModel
from openai import OpenAI

from ....models import (
    UploadedFramework, ParsedFrameworkControl, ControlEvidenceMapping,
    GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/parser", tags=["Framework Upload - Parser"])

AI_INTEGRATIONS_OPENAI_API_KEY = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
AI_INTEGRATIONS_OPENAI_BASE_URL = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")


class ParsedControlUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    domain: Optional[str] = None
    category: Optional[str] = None
    is_mandatory: Optional[bool] = None
    priority: Optional[str] = None


class ParsedControlResponse(BaseModel):
    id: int
    uploaded_framework_id: int
    control_id: str
    original_reference: Optional[str]
    title: str
    description: Optional[str]
    full_text: Optional[str]
    domain: Optional[str]
    category: Optional[str]
    is_mandatory: bool
    priority: str
    section_number: Optional[str]
    parent_section: Optional[str]
    ai_confidence: Optional[float]
    ai_notes: Optional[str]
    is_verified: bool
    verified_by: Optional[int]
    verified_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    evidence_mappings: List[dict]

    class Config:
        from_attributes = True


def validate_framework_access(user: GRCUser, framework: UploadedFramework, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if framework.tenant_id and framework.tenant_id not in user_tenants and not framework.is_shared:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this framework"
        )


def serialize_parsed_control(control: ParsedFrameworkControl) -> dict:
    return {
        "id": control.id,
        "uploaded_framework_id": control.uploaded_framework_id,
        "control_id": control.control_id,
        "original_reference": control.original_reference,
        "title": control.title,
        "description": control.description,
        "full_text": control.full_text,
        "domain": control.domain,
        "category": control.category,
        "is_mandatory": control.is_mandatory,
        "priority": control.priority,
        "section_number": control.section_number,
        "parent_section": control.parent_section,
        "ai_confidence": control.ai_confidence,
        "ai_notes": control.ai_notes,
        "is_verified": control.is_verified,
        "verified_by": control.verified_by,
        "verified_at": control.verified_at.isoformat() if control.verified_at else None,
        "created_at": control.created_at.isoformat() if control.created_at else None,
        "updated_at": control.updated_at.isoformat() if control.updated_at else None,
        "evidence_mappings": [
            {
                "id": em.id,
                "evidence_type": em.evidence_type,
                "evidence_description": em.evidence_description,
                "is_required": em.is_required,
                "suggested_by_ai": em.suggested_by_ai
            }
            for em in control.evidence_mappings
        ]
    }


def extract_text_from_file(framework: UploadedFramework) -> str:
    if not os.path.exists(framework.file_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework file not found on disk"
        )
    
    extracted_text = ""
    
    if framework.file_type == "pdf":
        from PyPDF2 import PdfReader
        reader = PdfReader(framework.file_path)
        text_parts = []
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)
        extracted_text = "\n\n".join(text_parts)
    
    elif framework.file_type == "docx":
        from docx import Document
        doc = Document(framework.file_path)
        text_parts = []
        for paragraph in doc.paragraphs:
            if paragraph.text.strip():
                text_parts.append(paragraph.text)
        for table in doc.tables:
            for row in table.rows:
                row_text = " | ".join(cell.text.strip() for cell in row.cells if cell.text.strip())
                if row_text:
                    text_parts.append(row_text)
        extracted_text = "\n".join(text_parts)
    
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type: {framework.file_type}"
        )
    
    return extracted_text


def parse_with_openai(text: str, framework_name: str) -> List[dict]:
    if not AI_INTEGRATIONS_OPENAI_API_KEY or not AI_INTEGRATIONS_OPENAI_BASE_URL:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OpenAI integration not configured"
        )
    
    # the newest OpenAI model is "gpt-5" which was released August 7, 2025.
    # do not change this unless explicitly requested by the user
    client = OpenAI(
        api_key=AI_INTEGRATIONS_OPENAI_API_KEY,
        base_url=AI_INTEGRATIONS_OPENAI_BASE_URL
    )
    
    prompt = f"""You are a compliance expert analyzing regulatory framework documents to extract structured control requirements.

Analyze the following document text from "{framework_name}" and extract all control requirements.

For each control requirement you find, extract:
1. original_reference: The original section, clause, or requirement number (e.g., "4.1.2", "REQ-001")
2. title: A concise title summarizing the control (max 200 chars)
3. description: A detailed description of what the control requires
4. full_text: The complete original text of the requirement
5. domain: Categorize into one of: Governance, Risk, Security, Access Control, Incident Management, Business Continuity, Data Protection, Compliance, Operations
6. category: A sub-category within the domain (e.g., "Authentication", "Encryption", "Policy Management")
7. is_mandatory: true if the requirement uses "shall", "must", "required"; false if "should", "may", "recommended"
8. priority: "high" for critical security/compliance items, "medium" for standard requirements, "low" for best practices
9. evidence_types: Array of suggested evidence types needed to demonstrate compliance. Choose from: policy, procedure, configuration, log, report, contract
10. ai_confidence: Your confidence score from 0.0 to 1.0 in the extraction accuracy

Document text to analyze:
---
{text[:50000]}
---

Return a JSON object with a "controls" array containing all extracted controls. Example format:
{{
  "controls": [
    {{
      "original_reference": "4.1.2",
      "title": "Access Control Policy",
      "description": "Organizations must establish and maintain...",
      "full_text": "The organization shall establish...",
      "domain": "Access Control",
      "category": "Policy Management",
      "is_mandatory": true,
      "priority": "high",
      "evidence_types": ["policy", "procedure"],
      "ai_confidence": 0.95
    }}
  ]
}}"""

    try:
        response = client.chat.completions.create(
            model="gpt-5",
            messages=[
                {"role": "system", "content": "You are a compliance expert that extracts structured control requirements from regulatory documents. Always respond with valid JSON."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_completion_tokens=8192
        )
        
        result_text = response.choices[0].message.content or "{}"
        result = json.loads(result_text)
        return result.get("controls", [])
    
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to parse OpenAI response: {str(e)}"
        )
    except Exception as e:
        error_msg = str(e)
        if "FREE_CLOUD_BUDGET_EXCEEDED" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="Cloud budget exceeded. Please upgrade your plan."
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"OpenAI API error: {error_msg}"
        )


@router.post("/{framework_id}/parse")
def parse_framework_document(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == framework_id
    ).first()
    
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uploaded framework not found"
        )
    
    validate_framework_access(current_user, framework, db)
    
    framework.upload_status = "parsing"
    db.commit()
    
    try:
        extracted_text = extract_text_from_file(framework)
        
        if not extracted_text.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No text could be extracted from the document"
            )
        
        parsed_controls_data = parse_with_openai(extracted_text, framework.name)
        
        if not parsed_controls_data:
            framework.upload_status = "parsed"
            framework.parsed_at = datetime.utcnow()
            framework.parse_error = "No controls found in document"
            db.commit()
            return {"message": "No controls found", "controls": []}
        
        db.query(ControlEvidenceMapping).filter(
            ControlEvidenceMapping.parsed_control_id.in_(
                db.query(ParsedFrameworkControl.id).filter(
                    ParsedFrameworkControl.uploaded_framework_id == framework_id
                )
            )
        ).delete(synchronize_session=False)
        
        db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == framework_id
        ).delete(synchronize_session=False)
        
        created_controls = []
        for idx, control_data in enumerate(parsed_controls_data, start=1):
            control_id = f"FW-{framework_id:03d}-{idx:03d}"
            
            parsed_control = ParsedFrameworkControl(
                uploaded_framework_id=framework_id,
                control_id=control_id,
                original_reference=control_data.get("original_reference"),
                title=control_data.get("title", "Untitled Control")[:500],
                description=control_data.get("description"),
                full_text=control_data.get("full_text"),
                domain=control_data.get("domain"),
                category=control_data.get("category"),
                is_mandatory=control_data.get("is_mandatory", True),
                priority=control_data.get("priority", "medium"),
                section_number=control_data.get("original_reference"),
                ai_confidence=control_data.get("ai_confidence"),
                is_verified=False
            )
            db.add(parsed_control)
            db.flush()
            
            evidence_types = control_data.get("evidence_types", [])
            for evidence_type in evidence_types:
                if evidence_type in ["policy", "procedure", "configuration", "log", "report", "contract"]:
                    evidence_mapping = ControlEvidenceMapping(
                        parsed_control_id=parsed_control.id,
                        evidence_type=evidence_type,
                        is_required=True,
                        suggested_by_ai=True
                    )
                    db.add(evidence_mapping)
            
            created_controls.append(parsed_control)
        
        framework.upload_status = "parsed"
        framework.parsed_at = datetime.utcnow()
        framework.parse_error = None
        db.commit()
        
        for control in created_controls:
            db.refresh(control)
        
        return {
            "message": f"Successfully parsed {len(created_controls)} controls",
            "framework_id": framework_id,
            "controls_count": len(created_controls),
            "controls": [serialize_parsed_control(c) for c in created_controls]
        }
    
    except HTTPException:
        framework.upload_status = "failed"
        framework.parse_error = "Parsing failed"
        db.commit()
        raise
    except Exception as e:
        framework.upload_status = "failed"
        framework.parse_error = str(e)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Parsing failed: {str(e)}"
        )


@router.get("/{framework_id}/controls")
def list_parsed_controls(
    framework_id: int,
    domain: Optional[str] = None,
    category: Optional[str] = None,
    is_verified: Optional[bool] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == framework_id
    ).first()
    
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uploaded framework not found"
        )
    
    validate_framework_access(current_user, framework, db)
    
    query = db.query(ParsedFrameworkControl).options(
        joinedload(ParsedFrameworkControl.evidence_mappings)
    ).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework_id
    )
    
    if domain:
        query = query.filter(ParsedFrameworkControl.domain == domain)
    if category:
        query = query.filter(ParsedFrameworkControl.category == category)
    if is_verified is not None:
        query = query.filter(ParsedFrameworkControl.is_verified == is_verified)
    
    total = query.count()
    controls = query.order_by(ParsedFrameworkControl.control_id).offset(skip).limit(limit).all()
    
    return {
        "items": [serialize_parsed_control(c) for c in controls],
        "total": total,
        "skip": skip,
        "limit": limit,
        "framework_id": framework_id,
        "framework_name": framework.name
    }


@router.put("/controls/{control_id}")
def update_parsed_control(
    control_id: int,
    update_data: ParsedControlUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    control = db.query(ParsedFrameworkControl).options(
        joinedload(ParsedFrameworkControl.evidence_mappings),
        joinedload(ParsedFrameworkControl.uploaded_framework)
    ).filter(
        ParsedFrameworkControl.id == control_id
    ).first()
    
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Parsed control not found"
        )
    
    validate_framework_access(current_user, control.uploaded_framework, db)
    
    if update_data.title is not None:
        control.title = update_data.title[:500]
    if update_data.description is not None:
        control.description = update_data.description
    if update_data.domain is not None:
        control.domain = update_data.domain
    if update_data.category is not None:
        control.category = update_data.category
    if update_data.is_mandatory is not None:
        control.is_mandatory = update_data.is_mandatory
    if update_data.priority is not None:
        if update_data.priority in ["high", "medium", "low"]:
            control.priority = update_data.priority
    
    control.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(control)
    
    return serialize_parsed_control(control)


@router.post("/controls/{control_id}/verify")
def verify_parsed_control(
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    control = db.query(ParsedFrameworkControl).options(
        joinedload(ParsedFrameworkControl.evidence_mappings),
        joinedload(ParsedFrameworkControl.uploaded_framework)
    ).filter(
        ParsedFrameworkControl.id == control_id
    ).first()
    
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Parsed control not found"
        )
    
    validate_framework_access(current_user, control.uploaded_framework, db)
    
    control.is_verified = True
    control.verified_by = current_user.id
    control.verified_at = datetime.utcnow()
    control.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(control)
    
    return {
        "message": "Control verified successfully",
        "control": serialize_parsed_control(control)
    }


@router.delete("/controls/{control_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_parsed_control(
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    control = db.query(ParsedFrameworkControl).options(
        joinedload(ParsedFrameworkControl.uploaded_framework)
    ).filter(
        ParsedFrameworkControl.id == control_id
    ).first()
    
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Parsed control not found"
        )
    
    validate_framework_access(current_user, control.uploaded_framework, db)
    
    db.delete(control)
    db.commit()
    
    return None


parser_router = router
