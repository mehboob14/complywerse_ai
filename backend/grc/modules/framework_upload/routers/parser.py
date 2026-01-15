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
    FrameworkControlAlignment, AssessmentItem, AssessmentEvidence,
    AssessmentRemediation, GRCUser, get_db
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


def chunk_text(text: str, chunk_size: int = 40000, overlap: int = 2000) -> List[str]:
    """Split text into overlapping chunks for processing large documents."""
    if len(text) <= chunk_size:
        return [text]
    
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        if end < len(text):
            break_point = text.rfind('\n\n', start + chunk_size - overlap, end)
            if break_point == -1:
                break_point = text.rfind('\n', start + chunk_size - overlap, end)
            if break_point == -1:
                break_point = text.rfind('. ', start + chunk_size - overlap, end)
            if break_point > start:
                end = break_point + 1
        
        chunks.append(text[start:end])
        start = end - overlap if end < len(text) else end
    
    return chunks


def infer_evidence_types(control_data: dict) -> List[str]:
    """Infer appropriate evidence types based on control content."""
    text = f"{control_data.get('title', '')} {control_data.get('description', '')} {control_data.get('full_text', '')}".lower()
    
    evidence_types = []
    
    if any(word in text for word in ['policy', 'policies', 'governance', 'management approval', 'board', 'documented']):
        evidence_types.append('policy')
    
    if any(word in text for word in ['procedure', 'process', 'workflow', 'steps', 'method', 'guideline', 'instruction']):
        evidence_types.append('procedure')
    
    if any(word in text for word in ['configuration', 'setting', 'parameter', 'system', 'network', 'firewall', 'server', 'encryption', 'tls', 'ssl']):
        evidence_types.append('configuration')
    
    if any(word in text for word in ['log', 'audit trail', 'monitoring', 'event', 'alert', 'detection', 'tracking']):
        evidence_types.append('log')
    
    if any(word in text for word in ['report', 'assessment', 'review', 'audit', 'test', 'scan', 'evaluation', 'analysis']):
        evidence_types.append('report')
    
    if any(word in text for word in ['contract', 'agreement', 'sla', 'vendor', 'third party', 'supplier', 'outsourcing']):
        evidence_types.append('contract')
    
    if not evidence_types:
        evidence_types = ['policy', 'procedure']
    
    return evidence_types


def normalize_priority(priority: str) -> str:
    """Normalize priority values to expected enum values (high/medium/low)."""
    priority_lower = (priority or "medium").lower().strip()
    if priority_lower in ["critical", "high"]:
        return "high"
    elif priority_lower in ["medium", "moderate"]:
        return "medium"
    elif priority_lower in ["low", "minimal"]:
        return "low"
    return "medium"


def deduplicate_controls(controls: List[dict]) -> List[dict]:
    """Remove duplicate controls based on title and original_reference, maintaining order by reference."""
    seen = set()
    unique_controls = []
    
    for control in controls:
        control["priority"] = normalize_priority(control.get("priority", "medium"))
        
        key = (
            control.get('original_reference', '').strip().lower(),
            control.get('title', '').strip().lower()[:100]
        )
        if key[0] or key[1]:
            if key not in seen:
                seen.add(key)
                unique_controls.append(control)
        else:
            unique_controls.append(control)
    
    unique_controls.sort(key=lambda c: (
        c.get('original_reference', 'zzz').lower(),
        c.get('title', '').lower()
    ))
    
    return unique_controls


def parse_with_openai(text: str, framework_name: str, chunk_number: int = 1, total_chunks: int = 1) -> List[dict]:
    if not AI_INTEGRATIONS_OPENAI_API_KEY or not AI_INTEGRATIONS_OPENAI_BASE_URL:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OpenAI integration not configured"
        )
    
    client = OpenAI(
        api_key=AI_INTEGRATIONS_OPENAI_API_KEY,
        base_url=AI_INTEGRATIONS_OPENAI_BASE_URL
    )
    
    chunk_context = ""
    if total_chunks > 1:
        chunk_context = f"\n\nNOTE: This is chunk {chunk_number} of {total_chunks} from the document. Extract ALL controls from this section."
    
    prompt = f"""You are an expert regulatory compliance analyst specializing in extracting control requirements from regulatory frameworks, standards, and guidelines.

TASK: Analyze the following document text from "{framework_name}" and extract EVERY control requirement, sub-control, and compliance obligation.{chunk_context}

CRITICAL INSTRUCTIONS:
1. Be EXHAUSTIVE - Extract ALL requirements, not just major ones. Include sub-requirements, nested controls, and all "shall/must/should" statements.
2. Look for requirements in different formats: numbered lists, tables, paragraphs, appendices, annexes.
3. Each "shall", "must", "should", "required", "expected" statement is likely a separate control.
4. Preserve the ORIGINAL numbering/reference (e.g., "Principle 1", "4.1.2.a", "REQ-001", "Article 32(1)(a)").
5. For Basel/banking frameworks: Look for Principles, Core Principles, Essential Criteria, Additional Criteria.
6. For ISO frameworks: Look for clauses, sub-clauses, and annex requirements.
7. For NIST/security frameworks: Look for control families, controls, and control enhancements.

For EACH control requirement, extract:
1. original_reference: The EXACT original section/clause/requirement number as it appears in the document
2. title: A concise, descriptive title (max 200 chars) that captures the control's purpose
3. description: A comprehensive description of what the control requires and its purpose
4. full_text: The complete original text of the requirement (important for audit purposes)
5. domain: Categorize into ONE of these domains:
   - Governance (board oversight, organizational structure, accountability)
   - Risk Management (risk identification, assessment, mitigation, appetite)
   - Security (information security, cybersecurity, physical security)
   - Access Control (authentication, authorization, identity management)
   - Incident Management (incident response, breach notification, crisis management)
   - Business Continuity (disaster recovery, backup, resilience)
   - Data Protection (privacy, data handling, encryption, retention)
   - Compliance (regulatory reporting, audit, monitoring)
   - Operations (operational processes, change management, IT operations)
   - Third Party (vendor management, outsourcing, supply chain)
   - Capital & Liquidity (for banking: capital adequacy, liquidity risk)
   - Credit Risk (for banking: credit assessment, provisioning)
6. category: A specific sub-category (e.g., "Board Responsibilities", "Authentication", "Encryption Standards")
7. is_mandatory: true if uses "shall", "must", "required", "expected"; false if "should", "may", "recommended"
8. priority: 
   - "critical" for fundamental/foundational requirements
   - "high" for important security/compliance items
   - "medium" for standard requirements  
   - "low" for best practices or advisory items
9. evidence_types: Array of evidence types needed. Choose from: policy, procedure, configuration, log, report, contract, attestation, screenshot, diagram, training_record
10. ai_confidence: Confidence score 0.0-1.0 in extraction accuracy
11. implementation_guidance: Brief guidance on how to implement this control (optional but helpful)

Document text to analyze:
---
{text}
---

Return a JSON object with a "controls" array. Be thorough - regulatory documents typically contain dozens to hundreds of controls.

Example output format:
{{
  "controls": [
    {{
      "original_reference": "Principle 1",
      "title": "Board Responsibilities for Risk Management",
      "description": "The board of directors has overall responsibility for approving and reviewing the risk management framework...",
      "full_text": "The board has overall responsibility for...",
      "domain": "Governance",
      "category": "Board Oversight",
      "is_mandatory": true,
      "priority": "critical",
      "evidence_types": ["policy", "report", "attestation"],
      "ai_confidence": 0.95,
      "implementation_guidance": "Document board-level risk committee charter and meeting minutes showing oversight"
    }},
    {{
      "original_reference": "Principle 1.1",
      "title": "Risk Appetite Framework Approval",
      "description": "The board must approve the risk appetite framework and ensure it is aligned with strategy...",
      "full_text": "The board shall approve the bank's risk appetite framework...",
      "domain": "Risk Management",
      "category": "Risk Appetite",
      "is_mandatory": true,
      "priority": "high",
      "evidence_types": ["policy", "report"],
      "ai_confidence": 0.92,
      "implementation_guidance": "Maintain documented risk appetite statement with board approval"
    }}
  ]
}}

Extract ALL controls - do not summarize or skip any requirements."""

    try:
        # the newest OpenAI model is "gpt-5" which was released August 7, 2025.
        # gpt-5.x models don't support temperature parameter and use max_completion_tokens instead of max_tokens
        response = client.chat.completions.create(
            model="gpt-5.2",
            messages=[
                {"role": "system", "content": "You are an expert regulatory compliance analyst with deep expertise in GRC frameworks (ISO 27001, PCI DSS, NIST CSF, Basel, SWIFT CSP, etc.). Your task is to exhaustively extract EVERY control requirement from regulatory documents. Be extremely thorough - do not miss any controls, sub-controls, or requirements. Parse the complete document structure and identify all mandatory and advisory controls. Always respond with valid JSON containing all extracted controls."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_completion_tokens=16384
        )
        
        result_text = response.choices[0].message.content or "{}"
        result = json.loads(result_text)
        controls = result.get("controls", [])
        
        for control in controls:
            if not control.get("evidence_types") or len(control.get("evidence_types", [])) == 0:
                control["evidence_types"] = infer_evidence_types(control)
        
        return controls
    
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


def parse_document_with_chunking(text: str, framework_name: str) -> List[dict]:
    """Parse a document using chunking for large files."""
    chunks = chunk_text(text, chunk_size=35000, overlap=1500)
    
    all_controls = []
    
    for idx, chunk in enumerate(chunks, start=1):
        chunk_controls = parse_with_openai(chunk, framework_name, chunk_number=idx, total_chunks=len(chunks))
        all_controls.extend(chunk_controls)
    
    unique_controls = deduplicate_controls(all_controls)
    
    return unique_controls


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
    
    file_path = framework.file_path
    file_type = framework.file_type
    framework_name = framework.name
    
    framework.upload_status = "parsing"
    db.commit()
    
    try:
        if not os.path.exists(file_path):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Framework file not found on disk"
            )
        
        extracted_text = ""
        if file_type == "pdf":
            from PyPDF2 import PdfReader
            reader = PdfReader(file_path)
            text_parts = []
            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text_parts.append(page_text)
            extracted_text = "\n\n".join(text_parts)
        elif file_type == "docx":
            from docx import Document
            doc = Document(file_path)
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
                detail=f"Unsupported file type: {file_type}"
            )
        
        if not extracted_text.strip():
            db.rollback()
            fw = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
            if fw:
                fw.upload_status = "parsed"
                fw.parsed_at = datetime.utcnow()
                fw.parse_error = "No text could be extracted from the document"
                db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No text could be extracted from the document"
            )
        
        parsed_controls_data = parse_document_with_chunking(extracted_text, framework_name)
        
        if not parsed_controls_data:
            fw = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
            if fw:
                fw.upload_status = "parsed"
                fw.parsed_at = datetime.utcnow()
                fw.parse_error = "No controls found in document"
                db.commit()
            return {"message": "No controls found", "controls": []}
        
        fw_check = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
        if not fw_check:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Framework was deleted during parsing"
            )
        
        existing_controls = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == framework_id
        ).all()
        existing_control_ids = [c.id for c in existing_controls]
        
        if existing_control_ids:
            assessment_item_ids = db.query(AssessmentItem.id).filter(
                AssessmentItem.parsed_control_id.in_(existing_control_ids)
            ).all()
            ai_ids = [a.id for a in assessment_item_ids]
            
            if ai_ids:
                db.query(AssessmentRemediation).filter(
                    AssessmentRemediation.assessment_item_id.in_(ai_ids)
                ).delete(synchronize_session=False)
                
                db.query(AssessmentEvidence).filter(
                    AssessmentEvidence.assessment_item_id.in_(ai_ids)
                ).delete(synchronize_session=False)
                
                db.query(AssessmentItem).filter(
                    AssessmentItem.id.in_(ai_ids)
                ).delete(synchronize_session=False)
            
            db.query(FrameworkControlAlignment).filter(
                FrameworkControlAlignment.parsed_control_id.in_(existing_control_ids)
            ).delete(synchronize_session=False)
            
            db.query(ControlEvidenceMapping).filter(
                ControlEvidenceMapping.parsed_control_id.in_(existing_control_ids)
            ).delete(synchronize_session=False)
            
            db.query(ParsedFrameworkControl).filter(
                ParsedFrameworkControl.id.in_(existing_control_ids)
            ).delete(synchronize_session=False)
        
        db.flush()
        
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
        
        fw_final = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
        if fw_final:
            fw_final.upload_status = "parsed"
            fw_final.parsed_at = datetime.utcnow()
            fw_final.parse_error = None
        
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
        db.rollback()
        try:
            fw = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
            if fw:
                fw.upload_status = "failed"
                fw.parse_error = "Parsing failed"
                db.commit()
        except Exception:
            pass
        raise
    except Exception as e:
        db.rollback()
        error_msg = str(e)
        try:
            fw = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
            if fw:
                fw.upload_status = "failed"
                fw.parse_error = error_msg[:500]
                db.commit()
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Parsing failed: {error_msg}"
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
