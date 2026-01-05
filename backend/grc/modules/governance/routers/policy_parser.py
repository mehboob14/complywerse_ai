import os
import json
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from openai import OpenAI

from ....models import (
    GovernanceDocument, GovernanceDocumentVersion, PolicyStatement,
    PolicyStatementCompliance, GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/documents", tags=["Governance - Policy Parser"])

AI_INTEGRATIONS_OPENAI_API_KEY = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
AI_INTEGRATIONS_OPENAI_BASE_URL = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")


class ParsedStatementResponse(BaseModel):
    id: int
    document_id: int
    statement_code: Optional[str]
    statement_text: str
    statement_summary: Optional[str]
    category: Optional[str]
    priority: str
    is_mandatory: bool
    source_section: Optional[str]
    ai_confidence: Optional[float]
    ai_extracted_keywords: List[str]
    compliance_id: Optional[int]

    class Config:
        from_attributes = True


def validate_document_access(user: GRCUser, document: GovernanceDocument, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if document.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this document"
        )


def extract_text_from_file(file_path: str, file_type: str) -> str:
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document file not found on disk"
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
    
    elif file_type in ("docx", "doc"):
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
            detail=f"Unsupported file type: {file_type}. Only PDF and Word documents are supported."
        )
    
    return extracted_text


def parse_policy_statements_with_openai(text: str, document_title: str) -> List[dict]:
    if not AI_INTEGRATIONS_OPENAI_API_KEY or not AI_INTEGRATIONS_OPENAI_BASE_URL:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OpenAI integration not configured"
        )
    
    client = OpenAI(
        api_key=AI_INTEGRATIONS_OPENAI_API_KEY,
        base_url=AI_INTEGRATIONS_OPENAI_BASE_URL
    )
    
    prompt = f"""You are a governance and compliance expert analyzing policy documents to extract individual policy statements.

Analyze the following document titled "{document_title}" and extract all distinct policy statements.

For each policy statement you find, extract:
1. statement_text: The actual policy statement (the complete, verbatim text)
2. statement_summary: A brief 1-2 sentence summary of what the statement requires
3. category: Categorize into one of: security, privacy, operational, compliance, governance, risk_management, hr, it, financial, legal, environmental, quality
4. priority: "critical" for mandatory security/compliance items, "high" for important requirements, "medium" for standard policies, "low" for guidelines
5. is_mandatory: true if the statement uses "shall", "must", "required", "mandatory"; false if "should", "may", "recommended", "encouraged"
6. source_section: The section or chapter title/number where this statement appears (e.g., "Section 4.2 - Access Control", "Chapter 3")
7. ai_confidence: Your confidence score from 0.0 to 1.0 in the accuracy of this extraction
8. ai_extracted_keywords: Array of 3-5 key terms/concepts from this statement (e.g., ["access control", "authentication", "password"])

Document text to analyze:
---
{text[:50000]}
---

Return a JSON object with a "statements" array containing all extracted policy statements. Example format:
{{
  "statements": [
    {{
      "statement_text": "All employees must complete information security awareness training within 30 days of hire.",
      "statement_summary": "Mandatory security training for new employees within 30 days",
      "category": "security",
      "priority": "high",
      "is_mandatory": true,
      "source_section": "Section 5.1 - Security Awareness",
      "ai_confidence": 0.95,
      "ai_extracted_keywords": ["security training", "awareness", "new employees", "onboarding"]
    }}
  ]
}}"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a governance expert that extracts structured policy statements from organizational documents. Always respond with valid JSON."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_completion_tokens=8192
        )
        
        result_text = response.choices[0].message.content or "{}"
        result = json.loads(result_text)
        return result.get("statements", [])
    
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


def serialize_statement(statement: PolicyStatement, compliance_id: Optional[int] = None) -> dict:
    return {
        "id": statement.id,
        "document_id": statement.document_id,
        "document_version_id": statement.document_version_id,
        "statement_code": statement.statement_code,
        "statement_text": statement.statement_text,
        "statement_summary": statement.statement_summary,
        "category": statement.category,
        "priority": statement.priority,
        "is_mandatory": statement.is_mandatory,
        "source_section": statement.source_section,
        "source_page": statement.source_page,
        "ai_confidence": statement.ai_confidence,
        "ai_extracted_keywords": statement.ai_extracted_keywords or [],
        "ai_suggested_controls": statement.ai_suggested_controls or [],
        "status": statement.status,
        "effective_date": statement.effective_date.isoformat() if statement.effective_date else None,
        "created_at": statement.created_at.isoformat() if statement.created_at else None,
        "compliance_id": compliance_id
    }


@router.post("/{document_id}/parse-policy")
def parse_policy_document(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id
    ).first()
    
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Governance document not found"
        )
    
    validate_document_access(current_user, document, db)
    
    file_path = document.file_path
    file_type = document.file_type
    version_id = None
    
    if not file_path:
        current_version = db.query(GovernanceDocumentVersion).filter(
            GovernanceDocumentVersion.document_id == document_id,
            GovernanceDocumentVersion.status == "current"
        ).order_by(GovernanceDocumentVersion.created_at.desc()).first()
        
        if current_version and current_version.file_path:
            file_path = current_version.file_path
            file_type = current_version.file_type
            version_id = current_version.id
    
    if not file_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No file attached to this document"
        )
    
    try:
        extracted_text = extract_text_from_file(file_path, file_type)
        
        if not extracted_text.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No text could be extracted from the document"
            )
        
        parsed_statements_data = parse_policy_statements_with_openai(extracted_text, document.title)
        
        if not parsed_statements_data:
            return {
                "message": "No policy statements found in document",
                "document_id": document_id,
                "statements": [],
                "total_statements": 0
            }
        
        existing_statement_ids = [s.id for s in db.query(PolicyStatement.id).filter(
            PolicyStatement.document_id == document_id
        ).all()]
        
        if existing_statement_ids:
            db.query(PolicyStatementCompliance).filter(
                PolicyStatementCompliance.statement_id.in_(existing_statement_ids)
            ).delete(synchronize_session='fetch')
            
            db.query(PolicyStatement).filter(
                PolicyStatement.id.in_(existing_statement_ids)
            ).delete(synchronize_session='fetch')
        
        created_statements = []
        for idx, statement_data in enumerate(parsed_statements_data, start=1):
            statement_code = f"PS-{document_id:04d}-{idx:03d}"
            
            policy_statement = PolicyStatement(
                tenant_id=document.tenant_id,
                document_id=document_id,
                document_version_id=version_id,
                statement_code=statement_code,
                statement_text=statement_data.get("statement_text", "")[:10000],
                statement_summary=statement_data.get("statement_summary", "")[:500] if statement_data.get("statement_summary") else None,
                category=statement_data.get("category"),
                priority=statement_data.get("priority", "medium"),
                is_mandatory=statement_data.get("is_mandatory", True),
                source_section=statement_data.get("source_section"),
                ai_confidence=statement_data.get("ai_confidence"),
                ai_extracted_keywords=statement_data.get("ai_extracted_keywords", []),
                status="active",
                created_by=current_user.id
            )
            db.add(policy_statement)
            db.flush()
            
            compliance_record = PolicyStatementCompliance(
                tenant_id=document.tenant_id,
                statement_id=policy_statement.id,
                compliance_status="not_assessed",
                owner_id=document.owner_id
            )
            db.add(compliance_record)
            db.flush()
            
            created_statements.append(serialize_statement(policy_statement, compliance_record.id))
        
        db.commit()
        
        return {
            "message": f"Successfully parsed {len(created_statements)} policy statements",
            "document_id": document_id,
            "document_title": document.title,
            "statements": created_statements,
            "total_statements": len(created_statements)
        }
    
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error parsing document: {str(e)}"
        )


@router.get("/{document_id}/policy-statements")
def get_document_policy_statements(
    document_id: int,
    category: Optional[str] = None,
    priority: Optional[str] = None,
    is_mandatory: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id
    ).first()
    
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Governance document not found"
        )
    
    validate_document_access(current_user, document, db)
    
    query = db.query(PolicyStatement).filter(
        PolicyStatement.document_id == document_id
    )
    
    if category:
        query = query.filter(PolicyStatement.category == category)
    if priority:
        query = query.filter(PolicyStatement.priority == priority)
    if is_mandatory is not None:
        query = query.filter(PolicyStatement.is_mandatory == is_mandatory)
    
    statements = query.order_by(PolicyStatement.statement_code).all()
    
    result = []
    for statement in statements:
        compliance = db.query(PolicyStatementCompliance).filter(
            PolicyStatementCompliance.statement_id == statement.id
        ).first()
        result.append(serialize_statement(statement, compliance.id if compliance else None))
    
    return {
        "document_id": document_id,
        "document_title": document.title,
        "statements": result,
        "total_statements": len(result)
    }
