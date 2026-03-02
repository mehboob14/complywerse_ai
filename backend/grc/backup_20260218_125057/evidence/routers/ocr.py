import os
import base64
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from PyPDF2 import PdfReader
from openai import OpenAI

from ....models import Evidence, GRCUser, get_db
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/ocr", tags=["Evidence - OCR"])

AI_INTEGRATIONS_OPENAI_API_KEY = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
AI_INTEGRATIONS_OPENAI_BASE_URL = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")

PROCESSABLE_FILE_TYPES = {"pdf", "png", "jpg", "jpeg"}
IMAGE_FILE_TYPES = {"png", "jpg", "jpeg"}

OCR_PROMPT = "Extract all text from this document/image. Return only the extracted text, preserving the original structure and formatting as much as possible."


class BatchProcessRequest(BaseModel):
    evidence_ids: List[int]


class OCRContentResponse(BaseModel):
    evidence_id: int
    ocr_content: Optional[str]
    ocr_status: str
    ocr_processed_at: Optional[str]


class OCRProcessResponse(BaseModel):
    evidence_id: int
    status: str
    extracted_text: Optional[str]
    message: Optional[str]


class BatchProcessResponse(BaseModel):
    total: int
    processed: int
    failed: int
    results: List[OCRProcessResponse]


def validate_evidence_access(user: GRCUser, evidence: Evidence, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if evidence.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this evidence"
        )


def get_openai_client() -> OpenAI:
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    is_modelfarm = base_url and "modelfarm" in base_url
    if not api_key and not is_modelfarm:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI features unavailable. OpenAI API key not configured."
        )
    if not is_modelfarm and (api_key.startswith("_DUMMY") or api_key == "your-api-key-here" or len(api_key) < 20):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI features unavailable. OpenAI API key not configured."
        )
    return OpenAI(
        api_key=api_key,
        base_url=base_url
    )


def extract_text_from_pdf(file_path: str) -> Optional[str]:
    try:
        reader = PdfReader(file_path)
        text_parts = []
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)
        extracted_text = "\n\n".join(text_parts)
        return extracted_text.strip() if extracted_text.strip() else None
    except Exception:
        return None


def extract_text_with_vision(file_path: str, file_type: str) -> str:
    client = get_openai_client()
    
    with open(file_path, "rb") as f:
        file_data = f.read()
    
    base64_data = base64.standard_b64encode(file_data).decode("utf-8")
    
    if file_type == "pdf":
        media_type = "application/pdf"
    elif file_type == "png":
        media_type = "image/png"
    elif file_type in ("jpg", "jpeg"):
        media_type = "image/jpeg"
    else:
        media_type = f"image/{file_type}"
    
    data_url = f"data:{media_type};base64,{base64_data}"
    
    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": OCR_PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {"url": data_url}
                        }
                    ]
                }
            ],
            max_tokens=4096
        )
        return response.choices[0].message.content or ""
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


def get_file_extension(evidence: Evidence) -> str:
    """Extract file extension from file_name or file_path."""
    if evidence.file_name:
        ext = os.path.splitext(evidence.file_name)[1].lower().strip(".")
        if ext:
            return ext
    if evidence.file_path:
        ext = os.path.splitext(evidence.file_path)[1].lower().strip(".")
        if ext:
            return ext
    return ""


def process_evidence_ocr(evidence: Evidence, db: Session) -> OCRProcessResponse:
    if not evidence.file_path or not os.path.exists(evidence.file_path):
        evidence.ocr_status = "failed"
        evidence.ocr_processed_at = datetime.utcnow()
        db.commit()
        return OCRProcessResponse(
            evidence_id=evidence.id,
            status="failed",
            extracted_text=None,
            message="File not found on disk"
        )
    
    file_type = get_file_extension(evidence)
    if file_type not in PROCESSABLE_FILE_TYPES:
        evidence.ocr_status = "failed"
        evidence.ocr_processed_at = datetime.utcnow()
        db.commit()
        return OCRProcessResponse(
            evidence_id=evidence.id,
            status="failed",
            extracted_text=None,
            message=f"Unsupported file type: {file_type}. Supported types: PDF, PNG, JPG, JPEG"
        )
    
    evidence.ocr_status = "processing"
    db.commit()
    
    try:
        extracted_text = None
        
        if file_type == "pdf":
            extracted_text = extract_text_from_pdf(evidence.file_path)
            if not extracted_text:
                extracted_text = extract_text_with_vision(evidence.file_path, file_type)
        else:
            extracted_text = extract_text_with_vision(evidence.file_path, file_type)
        
        evidence.ocr_content = extracted_text
        evidence.ocr_status = "completed"
        evidence.ocr_processed_at = datetime.utcnow()
        db.commit()
        
        return OCRProcessResponse(
            evidence_id=evidence.id,
            status="completed",
            extracted_text=extracted_text,
            message="OCR processing completed successfully"
        )
    
    except HTTPException:
        evidence.ocr_status = "failed"
        evidence.ocr_processed_at = datetime.utcnow()
        db.commit()
        raise
    
    except Exception as e:
        evidence.ocr_status = "failed"
        evidence.ocr_processed_at = datetime.utcnow()
        db.commit()
        return OCRProcessResponse(
            evidence_id=evidence.id,
            status="failed",
            extracted_text=None,
            message=f"OCR processing failed: {str(e)}"
        )


@router.post("/{evidence_id}/process-ocr", response_model=OCRProcessResponse)
def process_ocr(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    evidence = db.query(Evidence).filter(Evidence.id == evidence_id).first()
    
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    validate_evidence_access(current_user, evidence, db)
    
    return process_evidence_ocr(evidence, db)


@router.post("/batch-process", response_model=BatchProcessResponse)
def batch_process_ocr(
    request: BatchProcessRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    results = []
    processed_count = 0
    failed_count = 0
    
    for evidence_id in request.evidence_ids:
        evidence = db.query(Evidence).filter(Evidence.id == evidence_id).first()
        
        if not evidence:
            results.append(OCRProcessResponse(
                evidence_id=evidence_id,
                status="failed",
                extracted_text=None,
                message="Evidence not found"
            ))
            failed_count += 1
            continue
        
        if evidence.tenant_id not in user_tenants:
            results.append(OCRProcessResponse(
                evidence_id=evidence_id,
                status="failed",
                extracted_text=None,
                message="Access denied"
            ))
            failed_count += 1
            continue
        
        try:
            result = process_evidence_ocr(evidence, db)
            results.append(result)
            if result.status == "completed":
                processed_count += 1
            else:
                failed_count += 1
        except HTTPException as e:
            results.append(OCRProcessResponse(
                evidence_id=evidence_id,
                status="failed",
                extracted_text=None,
                message=e.detail
            ))
            failed_count += 1
        except Exception as e:
            results.append(OCRProcessResponse(
                evidence_id=evidence_id,
                status="failed",
                extracted_text=None,
                message=str(e)
            ))
            failed_count += 1
    
    return BatchProcessResponse(
        total=len(request.evidence_ids),
        processed=processed_count,
        failed=failed_count,
        results=results
    )


@router.get("/{evidence_id}/ocr-content", response_model=OCRContentResponse)
def get_ocr_content(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    evidence = db.query(Evidence).filter(Evidence.id == evidence_id).first()
    
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    validate_evidence_access(current_user, evidence, db)
    
    return OCRContentResponse(
        evidence_id=evidence.id,
        ocr_content=evidence.ocr_content,
        ocr_status=evidence.ocr_status or "pending",
        ocr_processed_at=evidence.ocr_processed_at.isoformat() if evidence.ocr_processed_at else None
    )
