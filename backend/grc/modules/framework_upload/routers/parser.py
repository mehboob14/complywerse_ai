import os
import json
import threading
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from pydantic import BaseModel
from openai import OpenAI

from ....models import (
    UploadedFramework, ParsedFrameworkControl, ControlEvidenceMapping,
    FrameworkControlAlignment, AssessmentItem, AssessmentEvidence,
    AssessmentRemediation, GRCUser, get_db, SessionLocal
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


def chunk_text(text: str, chunk_size: int = 30000, overlap: int = 3000) -> List[str]:
    """Split text into overlapping chunks for processing large documents.
    
    Uses smaller chunks with larger overlap to ensure no controls are missed
    at chunk boundaries. Prioritizes breaking at section boundaries.
    """
    if len(text) <= chunk_size:
        return [text]
    
    chunks = []
    start = 0
    
    while start < len(text):
        end = min(start + chunk_size, len(text))
        
        if end < len(text):
            search_start = max(start + chunk_size - overlap - 1000, start)
            search_end = min(end + 500, len(text))
            search_region = text[search_start:search_end]
            
            import re
            section_patterns = [
                r'\n\s*(?:Chapter|Section|Article|Part|Annex|Appendix)\s+\d+',
                r'\n\s*\d+\.\s+[A-Z]',
                r'\n\s*[A-Z]\.\s+[A-Z]',
                r'\n\s*Principle\s+\d+',
                r'\n\s*Requirement\s+\d+',
                r'\n\s*Control\s+\d+',
                r'\n\n\s*\d+\.\d+\s+',
                r'\n\n\n',
                r'\n\n',
            ]
            
            best_break = -1
            for pattern in section_patterns:
                matches = list(re.finditer(pattern, search_region, re.IGNORECASE))
                if matches:
                    last_match = matches[-1]
                    break_pos = search_start + last_match.start()
                    if break_pos > start + (chunk_size // 2):
                        best_break = break_pos
                        break
            
            if best_break > start:
                end = best_break
            else:
                break_point = text.rfind('\n\n', start + chunk_size - overlap, end)
                if break_point == -1:
                    break_point = text.rfind('\n', start + chunk_size - overlap, end)
                if break_point == -1:
                    break_point = text.rfind('. ', start + chunk_size - overlap, end)
                if break_point > start:
                    end = break_point + 1
        
        chunk_text_segment = text[start:end]
        if chunk_text_segment.strip():
            chunks.append(chunk_text_segment)
        
        next_start = end - overlap
        if next_start <= start:
            next_start = end
        start = next_start
        
        if start >= len(text):
            break
    
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


def extract_document_structure(text: str, framework_name: str) -> dict:
    """First pass: Extract the document's table of contents and structure to ensure completeness."""
    if not AI_INTEGRATIONS_OPENAI_API_KEY or not AI_INTEGRATIONS_OPENAI_BASE_URL:
        return {"sections": [], "total_expected_controls": 0}
    
    client = OpenAI(
        api_key=AI_INTEGRATIONS_OPENAI_API_KEY,
        base_url=AI_INTEGRATIONS_OPENAI_BASE_URL
    )
    
    sample_text = text[:25000] if len(text) > 25000 else text
    
    try:
        response = client.chat.completions.create(
            model="gpt-5.2",
            messages=[
                {"role": "system", "content": "You are an expert at analyzing regulatory document structures. Extract the complete table of contents and section structure."},
                {"role": "user", "content": f"""Analyze this regulatory framework document "{framework_name}" and extract its complete structure.

Document excerpt:
---
{sample_text}
---

Return JSON with:
1. "sections": Array of all major sections/chapters with their numbering
2. "control_patterns": Common patterns used for control numbering (e.g., "X.Y.Z", "Principle N", "REQ-XXX")
3. "total_expected_controls": Estimated total number of controls/requirements in the full document
4. "framework_type": Type of framework (ISO, NIST, PCI, Banking, etc.)

Example:
{{
  "sections": ["Chapter 1", "Chapter 2", "Annex A", "Annex B"],
  "control_patterns": ["N.N.N", "Principle N"],
  "total_expected_controls": 150,
  "framework_type": "ISO"
}}"""}
            ],
            response_format={"type": "json_object"},
            max_completion_tokens=4096
        )
        
        result = json.loads(response.choices[0].message.content or "{}")
        return result
    except Exception:
        return {"sections": [], "total_expected_controls": 0}


def parse_with_openai(text: str, framework_name: str, chunk_number: int = 1, total_chunks: int = 1, doc_structure: dict = None) -> List[dict]:
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
        chunk_context = f"""

IMPORTANT CONTEXT:
- This is chunk {chunk_number} of {total_chunks} from a large document
- You MUST extract EVERY control from this section - do not skip any
- If a control spans chunk boundaries, extract what you see with a note
- Previous/next chunks will capture overlapping content"""
    
    structure_hint = ""
    if doc_structure:
        patterns = doc_structure.get("control_patterns", [])
        fw_type = doc_structure.get("framework_type", "")
        if patterns:
            structure_hint = f"\n\nDOCUMENT STRUCTURE HINTS:\n- Framework type: {fw_type}\n- Control numbering patterns found: {', '.join(patterns)}\n- Look for controls matching these patterns"
    
    prompt = f"""You are an expert regulatory compliance analyst. Your task is to perform EXHAUSTIVE extraction of ALL control requirements from this regulatory framework document.

DOCUMENT: "{framework_name}"{chunk_context}{structure_hint}

=== CRITICAL EXTRACTION RULES ===

1. EXTRACT EVERYTHING - Do NOT skip, summarize, or consolidate controls
2. PRESERVE EXACT WORDING - Copy the original text verbatim in full_text field
3. PRESERVE EXACT NUMBERING - Use the document's original reference numbers exactly as written
4. HIERARCHICAL EXTRACTION - Extract parent controls AND all sub-controls separately
5. GRANULARITY - Each "shall", "must", "should", "required" statement = separate control

=== WHAT TO LOOK FOR ===

MANDATORY requirements (is_mandatory=true):
- "shall", "must", "is required to", "are expected to", "needs to"

ADVISORY requirements (is_mandatory=false):  
- "should", "may", "is recommended", "is encouraged"

CONTROL LOCATIONS - Check ALL of these:
- Numbered sections (1.1, 1.2, 1.2.1, etc.)
- Lettered sub-items (a, b, c or i, ii, iii)
- Tables with requirements
- Bullet points with obligations
- Principles/Articles/Clauses
- Annexes and Appendices
- Notes and Remarks with requirements
- Definitions that include obligations

=== OUTPUT FORMAT ===

For EACH control, provide:
{{
  "original_reference": "EXACT number/reference from document (e.g., '4.1.2.a', 'Principle 3', 'A.5.1.1')",
  "title": "Clear descriptive title (max 200 chars)",
  "description": "Detailed explanation of what this control requires",
  "full_text": "COMPLETE VERBATIM text of the requirement - copy exactly as written",
  "domain": "One of: Governance|Risk Management|Security|Access Control|Incident Management|Business Continuity|Data Protection|Compliance|Operations|Third Party|Capital & Liquidity|Credit Risk|Human Resources|Physical Security|Network Security|Application Security",
  "category": "Specific sub-category",
  "is_mandatory": true/false,
  "priority": "critical|high|medium|low",
  "evidence_types": ["policy", "procedure", "configuration", "log", "report", "contract", "attestation"],
  "ai_confidence": 0.0-1.0,
  "parent_reference": "Reference of parent control if this is a sub-control (optional)"
}}

=== DOCUMENT TEXT TO ANALYZE ===
---
{text}
---

=== FINAL INSTRUCTIONS ===

1. Read through the ENTIRE text carefully
2. Extract EVERY requirement you find - err on the side of including more
3. Do NOT combine multiple requirements into one control
4. If uncertain whether something is a control, INCLUDE IT with lower confidence
5. Regulatory documents typically have 50-500+ controls - extract them ALL

Return a JSON object with a "controls" array containing ALL extracted controls."""

    try:
        response = client.chat.completions.create(
            model="gpt-5.2",
            messages=[
                {"role": "system", "content": """You are an expert regulatory compliance analyst specializing in GRC framework analysis. Your specialty is EXHAUSTIVE extraction of control requirements from complex regulatory documents.

CRITICAL BEHAVIORS:
1. You NEVER skip controls - every requirement must be captured
2. You preserve EXACT original wording and numbering
3. You extract hierarchically - parent controls AND all sub-controls
4. You treat each "shall/must/should" statement as a potential separate control
5. You check tables, annexes, appendices, notes - everywhere for requirements
6. You return valid JSON with complete control data

You are thorough, meticulous, and never miss a requirement."""},
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
    """Parse a document using a two-pass approach for comprehensive extraction.
    
    Pass 1: Extract document structure to understand numbering patterns
    Pass 2: Process each chunk with structure context for exhaustive extraction
    """
    doc_structure = extract_document_structure(text, framework_name)
    
    chunks = chunk_text(text, chunk_size=30000, overlap=3000)
    
    all_controls = []
    
    for idx, chunk in enumerate(chunks, start=1):
        chunk_controls = parse_with_openai(
            chunk, 
            framework_name, 
            chunk_number=idx, 
            total_chunks=len(chunks),
            doc_structure=doc_structure
        )
        all_controls.extend(chunk_controls)
    
    unique_controls = deduplicate_controls(all_controls)
    
    expected_count = doc_structure.get("total_expected_controls", 0)
    if expected_count > 0 and len(unique_controls) < expected_count * 0.7:
        pass
    
    return unique_controls


def run_background_parsing(framework_id: int, file_path: str, file_type: str, framework_name: str):
    """Run parsing in a background thread to avoid HTTP timeout."""
    db = SessionLocal()
    try:
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
            fw = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
            if fw:
                fw.upload_status = "failed"
                fw.parse_error = f"Unsupported file type: {file_type}"
                db.commit()
            return
        
        if not extracted_text.strip():
            fw = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
            if fw:
                fw.upload_status = "failed"
                fw.parse_error = "No text could be extracted from the document"
                db.commit()
            return
        
        parsed_controls_data = parse_document_with_chunking(extracted_text, framework_name)
        
        if not parsed_controls_data:
            fw = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
            if fw:
                fw.upload_status = "parsed"
                fw.parsed_at = datetime.utcnow()
                fw.parse_error = "No controls found in document"
                db.commit()
            return
        
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
        
        fw_final = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
        if fw_final:
            fw_final.upload_status = "parsed"
            fw_final.parsed_at = datetime.utcnow()
            fw_final.parse_error = None
        
        db.commit()
        
    except Exception as e:
        error_msg = str(e)
        try:
            fw = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
            if fw:
                fw.upload_status = "failed"
                fw.parse_error = error_msg[:500]
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


@router.post("/{framework_id}/parse")
def parse_framework_document(
    framework_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Start parsing a framework document in the background.
    
    Returns immediately with status 'parsing'. The actual parsing runs in
    the background. Poll the framework status to check when parsing completes.
    """
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == framework_id
    ).first()
    
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uploaded framework not found"
        )
    
    validate_framework_access(current_user, framework, db)
    
    if framework.upload_status == "parsing":
        return {
            "message": "Parsing already in progress",
            "framework_id": framework_id,
            "status": "parsing"
        }
    
    file_path = framework.file_path
    file_type = framework.file_type
    framework_name = framework.name
    
    if not os.path.exists(file_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework file not found on disk"
        )
    
    framework.upload_status = "parsing"
    framework.parse_error = None
    db.commit()
    
    thread = threading.Thread(
        target=run_background_parsing,
        args=(framework_id, file_path, file_type, framework_name),
        daemon=True
    )
    thread.start()
    
    return {
        "message": "Parsing started in background. Refresh the page periodically to check status.",
        "framework_id": framework_id,
        "status": "parsing"
    }


@router.get("/{framework_id}/parse-status")
def get_parse_status(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Check the parsing status of a framework."""
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == framework_id
    ).first()
    
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uploaded framework not found"
        )
    
    validate_framework_access(current_user, framework, db)
    
    controls_count = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework_id
    ).count() if framework.upload_status == "parsed" else 0
    
    return {
        "framework_id": framework_id,
        "status": framework.upload_status,
        "parse_error": framework.parse_error,
        "parsed_at": framework.parsed_at.isoformat() if framework.parsed_at else None,
        "controls_count": controls_count
    }


@router.post("/{framework_id}/parse-sync")
def parse_framework_document_sync(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Parse a framework document synchronously (for small documents only).
    
    Warning: This may timeout for large documents. Use the async /parse endpoint instead.
    """
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
