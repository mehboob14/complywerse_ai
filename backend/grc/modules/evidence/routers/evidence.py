from typing import List, Optional
from datetime import datetime, timedelta
import os
import uuid
import threading
import logging
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Form, BackgroundTasks
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, func
from pydantic import BaseModel

from ....models import (
    Evidence, EvidenceVersion, EvidenceControlMapping, EvidenceAIAssessment,
    RiskEvidenceLink, AssetEvidenceLink, EvidenceIncidentLink, EvidencePolicyLink,
    AssessmentItemEvidence, RCSAResponseEvidence,
    GRCUser, Tenant, get_db, engine
)
from ....db import open_tenant_session
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

EVIDENCE_UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "uploads", "evidence")
os.makedirs(EVIDENCE_UPLOAD_DIR, exist_ok=True)

ALLOWED_FILE_TYPES = {
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'txt': 'text/plain',
    'md': 'text/markdown',
    'csv': 'text/csv',
    'json': 'application/json',
    'xml': 'application/xml',
    'html': 'text/html',
    'htm': 'text/html',
    'rtf': 'application/rtf',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'bmp': 'image/bmp',
    'tif': 'image/tiff',
    'tiff': 'image/tiff',
    'webp': 'image/webp'
}

EVIDENCE_TYPES = [
    "screenshot",
    "document",
    "certificate",
    "audit_report",
    "log",
    "policy",
    "procedure",
    "configuration",
    "attestation",
    "training_record",
    "access_review",
    "vulnerability_scan",
    "penetration_test",
    "backup_log",
    "change_record",
    "incident_report",
    "other"
]

OCR_PROCESSABLE_TYPES = {
    'pdf',
    'docx',
    'xls', 'xlsx',
    'txt', 'text', 'log', 'md', 'csv', 'json', 'xml', 'html', 'htm', 'rtf',
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp'
}


logger = logging.getLogger(__name__)


def process_evidence_background(evidence_id: int, tenant_slug: str):
    """Background task to process OCR and AI assessment for uploaded evidence.

    Runs on upload for OCR-processable files: OCR first, then (once OCR has
    content) the AI assessment. Failures are LOGGED (not swallowed) so a
    non-running AI assessment can be diagnosed from the backend logs.

    IMPORTANT: this is database-per-tenant, so the thread MUST open a
    tenant-scoped session (`open_tenant_session(slug)`). Binding to the master
    `engine` — as this once did — queries the wrong database, finds no evidence
    row, and silently returns, which is why auto-OCR never ran.
    """
    from .ocr import process_evidence_ocr
    from .ai_assessment import run_ai_assessment

    if not tenant_slug:
        logger.error("process_evidence_background called without tenant_slug for evidence %s", evidence_id)
        return

    db = open_tenant_session(tenant_slug)
    try:
        evidence = db.query(Evidence).filter(Evidence.id == evidence_id).first()
        if not evidence:
            return
        
        file_ext = ""
        if evidence.file_name:
            file_ext = os.path.splitext(evidence.file_name)[1].lower().strip(".")
        elif evidence.file_type:
            mime = evidence.file_type.lower().strip()
            mime_to_ext = {
                'application/pdf': 'pdf',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
                'text/plain': 'txt',
                'text/markdown': 'md',
                'text/csv': 'csv',
                'application/json': 'json',
                'application/xml': 'xml',
                'text/xml': 'xml',
                'text/html': 'html',
                'application/rtf': 'rtf',
                'text/rtf': 'rtf',
                'image/jpeg': 'jpg',
                'image/png': 'png',
                'image/gif': 'gif',
                'image/bmp': 'bmp',
                'image/tiff': 'tiff',
                'image/webp': 'webp',
            }
            file_ext = mime_to_ext.get(mime, mime.split("/")[-1] if "/" in mime else "")
        
        if file_ext in OCR_PROCESSABLE_TYPES:
            try:
                ocr_result = process_evidence_ocr(evidence, db)

                if ocr_result.status == "completed" and evidence.ocr_content:
                    try:
                        run_ai_assessment(evidence, db, user_id=getattr(evidence, "uploaded_by", None))
                    except Exception:
                        logger.exception(
                            "Auto AI-assessment failed for evidence %s after OCR completed", evidence_id
                        )
                elif ocr_result.status == "completed":
                    logger.warning(
                        "Evidence %s OCR completed but produced no content — skipping AI assessment", evidence_id
                    )
            except Exception:
                logger.exception("OCR processing failed for evidence %s", evidence_id)
                try:
                    evidence.ocr_status = "failed"
                    db.commit()
                except Exception:
                    db.rollback()
    except Exception:
        logger.exception("Background OCR/assessment task crashed for evidence %s", evidence_id)
    finally:
        db.close()


router = APIRouter(prefix="/items", tags=["Evidence - Items"])


class EvidenceCreate(BaseModel):
    name: str
    description: Optional[str] = None
    evidence_type: Optional[str] = None
    collection_date: Optional[datetime] = None
    validity_period_days: Optional[int] = None
    source_system: Optional[str] = None


class EvidenceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    evidence_type: Optional[str] = None
    collection_date: Optional[datetime] = None
    validity_period_days: Optional[int] = None
    source_system: Optional[str] = None
    status: Optional[str] = None
    content_summary: Optional[str] = None


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def serialize_evidence(evidence: Evidence, include_counts: bool = True, db: Session = None) -> dict:
    result = {
        "id": evidence.id,
        "tenant_id": evidence.tenant_id,
        "name": evidence.name,
        "description": evidence.description,
        "file_path": evidence.file_path,
        "file_name": evidence.file_name,
        "file_type": evidence.file_type,
        "version": evidence.version,
        "uploaded_by": evidence.uploaded_by,
        "uploader_name": evidence.uploader.display_name if evidence.uploader else None,
        "owner_id": getattr(evidence, "owner_id", None),
        "owner_name": (evidence.owner.display_name if getattr(evidence, "owner", None) else None),
        "department": (evidence.uploader.department if evidence.uploader else None),
        "uploaded_at": evidence.uploaded_at.isoformat() if evidence.uploaded_at else None,
        "status": evidence.status,
        "ocr_status": evidence.ocr_status,
        "ocr_processed_at": evidence.ocr_processed_at.isoformat() if evidence.ocr_processed_at else None,
        "evidence_type": evidence.evidence_type,
        "collection_date": evidence.collection_date.isoformat() if evidence.collection_date else None,
        "validity_period_days": evidence.validity_period_days,
        "expiry_date": evidence.expiry_date.isoformat() if evidence.expiry_date else None,
        "is_stale": evidence.is_stale,
        "source_system": evidence.source_system,
        "content_summary": evidence.content_summary,
        "quality_score": evidence.quality_score,
        "submitted_by": evidence.submitted_by,
        "submitted_at": evidence.submitted_at.isoformat() if evidence.submitted_at else None,
        "reviewed_by": evidence.reviewed_by,
        "reviewed_at": evidence.reviewed_at.isoformat() if evidence.reviewed_at else None,
        "review_comments": evidence.review_comments,
        "approved_by": evidence.approved_by,
        "approved_at": evidence.approved_at.isoformat() if evidence.approved_at else None,
        "risk_links_count": len(evidence.risk_links or []) if hasattr(evidence, "risk_links") else 0,
        "asset_links_count": len(evidence.asset_links or []) if hasattr(evidence, "asset_links") else 0,
        "incident_links_count": len(evidence.incident_links or []) if hasattr(evidence, "incident_links") else 0,
        "policy_links_count": len(evidence.policy_links or []) if hasattr(evidence, "policy_links") else 0,
    }

    if include_counts and db:
        control_mappings_count = db.query(EvidenceControlMapping).filter(
            EvidenceControlMapping.evidence_id == evidence.id
        ).count()
        result["control_mappings_count"] = control_mappings_count
    
    return result


def serialize_evidence_detail(evidence: Evidence, db: Session) -> dict:
    result = serialize_evidence(evidence, include_counts=False, db=db)

    if hasattr(evidence, "recertification_date"):
        rc = getattr(evidence, "recertification_date", None)
        result["recertification_date"] = rc.isoformat() if rc else None

    result["control_mappings"] = [
        {
            "id": m.id,
            "normalized_control_id": m.normalized_control_id,
            "normalized_control_code": m.normalized_control.code if m.normalized_control else None,
            "normalized_control_name": m.normalized_control.name if m.normalized_control else None,
            "framework_control_id": m.framework_control_id,
            "framework_control_code": m.framework_control.code if m.framework_control else None,
            "framework_control_name": m.framework_control.name if m.framework_control else None,
        }
        for m in evidence.control_mappings
    ]
    
    result["versions"] = [
        {
            "id": v.id,
            "version_number": v.version_number,
            "file_path": v.file_path,
            "changes": v.changes,
            "created_by": v.created_by,
            "created_at": v.created_at.isoformat() if v.created_at else None,
        }
        for v in sorted(evidence.versions, key=lambda x: x.version_number, reverse=True)
    ]
    
    if evidence.ai_assessments:
        latest = sorted(evidence.ai_assessments, key=lambda x: x.assessed_at, reverse=True)[0]
        result["latest_assessment"] = {
            "id": latest.id,
            "relevance_score": latest.relevance_score,
            "adequacy_score": latest.adequacy_score,
            "confidence_score": latest.confidence_score,
            "gap_analysis": latest.gap_analysis,
            "audit_readiness": latest.audit_readiness,
            "content_summary": latest.content_summary,
            "recommendations": latest.recommendations,
            "assessed_at": latest.assessed_at.isoformat() if latest.assessed_at else None,
        }
    else:
        result["latest_assessment"] = None
    
    result["risk_links"] = [
        {
            "id": link.id,
            "risk_id": link.risk_id,
            "risk_title": link.risk.title if link.risk else None,
        }
        for link in evidence.risk_links
    ] if hasattr(evidence, 'risk_links') and evidence.risk_links else []
    
    result["asset_links"] = [
        {
            "id": link.id,
            "asset_id": link.asset_id,
            "asset_name": link.asset.name if link.asset else None,
        }
        for link in evidence.asset_links
    ] if hasattr(evidence, 'asset_links') and evidence.asset_links else []
    
    result["incident_links"] = [
        {
            "id": link.id,
            "incident_id": link.incident_id,
        }
        for link in evidence.incident_links
    ] if hasattr(evidence, 'incident_links') and evidence.incident_links else []
    
    result["policy_links"] = [
        {
            "id": link.id,
            "policy_statement_id": link.policy_statement_id,
        }
        for link in evidence.policy_links
    ] if hasattr(evidence, 'policy_links') and evidence.policy_links else []
    
    return result


@router.get("")
def list_evidence(
    tenant_id: Optional[int] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    evidence_type: Optional[str] = None,
    is_stale: Optional[bool] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}
    
    query = db.query(Evidence).options(
        joinedload(Evidence.uploader)
    ).filter(Evidence.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(Evidence.tenant_id == tenant_id)
    # `stale` is not a workflow status column value — it is Evidence.is_stale
    # (past expiry / expired lifecycle). Accept status=stale as a first-class
    # filter alias so list clients can filter the same way as the UI Status menu.
    if status_filter == "stale":
        query = query.filter(Evidence.is_stale == True)  # noqa: E712
    elif status_filter:
        query = query.filter(Evidence.status == status_filter)
    if evidence_type:
        query = query.filter(Evidence.evidence_type == evidence_type)
    if is_stale is not None and status_filter != "stale":
        query = query.filter(Evidence.is_stale == is_stale)
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            or_(
                Evidence.name.ilike(search_term),
                Evidence.description.ilike(search_term),
                Evidence.file_name.ilike(search_term),
                Evidence.source_system.ilike(search_term)
            )
        )
    
    total = query.count()
    
    evidence_list = query.order_by(Evidence.uploaded_at.desc()).offset(skip).limit(limit).all()
    
    return {
        "items": [serialize_evidence(e, include_counts=True, db=db) for e in evidence_list],
        "total": total,
        "skip": skip,
        "limit": limit
    }


@router.get("/types")
def get_evidence_types(
    current_user: GRCUser = Depends(require_auth)
):
    return {
        "types": [
            {"value": t, "label": t.replace("_", " ").title()}
            for t in EVIDENCE_TYPES
        ]
    }


@router.get("/dashboard/summary")
def get_evidence_dashboard(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {
            "total_count": 0,
            "by_status": {},
            "by_type": {},
            "stale_count": 0,
            "expiring_soon_count": 0,
            "pending_review_count": 0
        }
    
    query = db.query(Evidence).filter(Evidence.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(Evidence.tenant_id == tenant_id)
    
    evidence_list = query.all()
    
    by_status = {}
    by_type = {}
    stale_count = 0
    expiring_soon_count = 0
    pending_review_count = 0
    
    thirty_days_from_now = datetime.utcnow() + timedelta(days=30)
    
    for e in evidence_list:
        status_val = e.status or "draft"
        by_status[status_val] = by_status.get(status_val, 0) + 1
        
        type_val = e.evidence_type or "other"
        by_type[type_val] = by_type.get(type_val, 0) + 1
        
        if e.is_stale:
            stale_count += 1
        
        if e.expiry_date and e.expiry_date <= thirty_days_from_now and e.expiry_date > datetime.utcnow():
            expiring_soon_count += 1
        
        if e.status == "pending_review":
            pending_review_count += 1

    # 6-month trend: evidence uploaded (by uploaded_at) vs approved (by
    # approved_at) per calendar month, ascending. Built in-memory from the
    # already-loaded list (no extra DB query). Null dates are skipped.
    now = datetime.utcnow()
    months: List[str] = []
    year, month = now.year, now.month
    for _ in range(6):
        months.append(f"{year:04d}-{month:02d}")
        month -= 1
        if month == 0:
            month = 12
            year -= 1
    months.reverse()  # oldest -> newest
    uploaded_by_month = {m: 0 for m in months}
    approved_by_month = {m: 0 for m in months}
    for e in evidence_list:
        if e.uploaded_at:
            key = f"{e.uploaded_at.year:04d}-{e.uploaded_at.month:02d}"
            if key in uploaded_by_month:
                uploaded_by_month[key] += 1
        if e.approved_at:
            key = f"{e.approved_at.year:04d}-{e.approved_at.month:02d}"
            if key in approved_by_month:
                approved_by_month[key] += 1
    by_month = [
        {"month": m, "uploaded": uploaded_by_month[m], "approved": approved_by_month[m]}
        for m in months
    ]

    return {
        "total_count": len(evidence_list),
        "by_status": by_status,
        "by_type": by_type,
        "stale_count": stale_count,
        "expiring_soon_count": expiring_soon_count,
        "pending_review_count": pending_review_count,
        "by_month": by_month
    }


@router.get("/dashboard/by-owner")
def get_evidence_by_owner(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Group tenant evidence by designated owner (falls back to uploader
    when no owner_id is set). Additive read-only dashboard route. Uses only
    existing columns/relationships; no due_date so no on-time% is returned."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"owners": []}

    query = db.query(Evidence).options(
        joinedload(Evidence.uploader)
    ).filter(Evidence.tenant_id.in_(user_tenants))

    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(Evidence.tenant_id == tenant_id)

    if hasattr(Evidence, "owner"):
        query = query.options(joinedload(Evidence.owner))

    evidence_list = query.all()

    now = datetime.utcnow()
    groups: dict = {}
    for e in evidence_list:
        owner_id = getattr(e, "owner_id", None) or e.uploaded_by
        owner_obj = getattr(e, "owner", None) or e.uploader
        owner_name = owner_obj.display_name if owner_obj else None

        bucket = groups.get(owner_id)
        if bucket is None:
            bucket = {
                "owner_id": owner_id,
                "owner_name": owner_name,
                "total": 0,
                "pending": 0,
                "approved": 0,
                "expired": 0,
            }
            groups[owner_id] = bucket
        elif bucket["owner_name"] is None and owner_name:
            bucket["owner_name"] = owner_name

        bucket["total"] += 1
        if e.status == "pending_review":
            bucket["pending"] += 1
        if e.status == "approved":
            bucket["approved"] += 1
        if e.expiry_date and e.expiry_date < now:
            bucket["expired"] += 1

    owners = sorted(groups.values(), key=lambda g: g["total"], reverse=True)
    return {"owners": owners}


@router.get("/{evidence_id}")
def get_evidence(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    evidence = db.query(Evidence).options(
        joinedload(Evidence.uploader),
        joinedload(Evidence.control_mappings),
        joinedload(Evidence.versions),
        joinedload(Evidence.ai_assessments),
        joinedload(Evidence.risk_links),
        joinedload(Evidence.asset_links),
        joinedload(Evidence.incident_links),
        joinedload(Evidence.policy_links)
    ).filter(
        Evidence.id == evidence_id,
        Evidence.tenant_id.in_(user_tenants)
    ).first()
    
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    return serialize_evidence_detail(evidence, db)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_evidence(
    evidence_data: EvidenceCreate,
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
    
    expiry_date = None
    if evidence_data.collection_date and evidence_data.validity_period_days:
        expiry_date = evidence_data.collection_date + timedelta(days=evidence_data.validity_period_days)
    
    db_evidence = Evidence(
        tenant_id=tenant_id,
        name=evidence_data.name,
        description=evidence_data.description,
        evidence_type=evidence_data.evidence_type,
        collection_date=evidence_data.collection_date,
        validity_period_days=evidence_data.validity_period_days,
        expiry_date=expiry_date,
        source_system=evidence_data.source_system,
        uploaded_by=current_user.id,
        status="draft"
    )
    db.add(db_evidence)
    db.commit()
    db.refresh(db_evidence)
    
    return serialize_evidence(db_evidence, include_counts=False, db=db)


@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_evidence(
    name: str = Form(...),
    description: Optional[str] = Form(None),
    evidence_type: Optional[str] = Form(None),
    collection_date: Optional[str] = Form(None),
    validity_period_days: Optional[int] = Form(None),
    source_system: Optional[str] = Form(None),
    owner_id: Optional[int] = Form(None),
    tenant_id: Optional[int] = Form(None),
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = None,
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
    
    file_ext = ""
    if file.filename:
        file_ext = os.path.splitext(file.filename)[1].lower()
    
    if file_ext and file_ext[1:] not in ALLOWED_FILE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type not allowed. Allowed types: {', '.join(ALLOWED_FILE_TYPES.keys())}"
        )
    
    tenant_upload_dir = os.path.join(EVIDENCE_UPLOAD_DIR, str(tenant_id))
    os.makedirs(tenant_upload_dir, exist_ok=True)
    
    file_id = str(uuid.uuid4())
    file_path = os.path.join(tenant_upload_dir, f"{file_id}{file_ext}")
    
    contents = await file.read()
    with open(file_path, "wb") as f:
        f.write(contents)
    
    file_size = len(contents)
    
    parsed_collection_date = None
    if collection_date:
        try:
            parsed_collection_date = datetime.fromisoformat(collection_date.replace('Z', '+00:00'))
        except ValueError:
            pass
    
    expiry_date = None
    if parsed_collection_date and validity_period_days:
        expiry_date = parsed_collection_date + timedelta(days=validity_period_days)
    
    ocr_status_val = "pending" if file_ext and file_ext[1:] in OCR_PROCESSABLE_TYPES else "not_applicable"
    
    db_evidence = Evidence(
        tenant_id=tenant_id,
        name=name,
        description=description,
        file_path=file_path,
        file_name=file.filename,
        file_type=file.content_type,
        evidence_type=evidence_type,
        collection_date=parsed_collection_date,
        validity_period_days=validity_period_days,
        expiry_date=expiry_date,
        source_system=source_system,
        uploaded_by=current_user.id,
        status="draft",
        ocr_status=ocr_status_val
    )
    # owner_id was added later. Set conditionally so older deployments
    # without the column still work.
    if owner_id and hasattr(Evidence, "owner_id"):
        try:
            setattr(db_evidence, "owner_id", owner_id)
        except Exception:
            pass

    db.add(db_evidence)
    db.commit()
    db.refresh(db_evidence)
    
    if ocr_status_val == "pending":
        thread = threading.Thread(
            target=process_evidence_background,
            args=(db_evidence.id, tenant.slug),
            daemon=True
        )
        thread.start()
    
    result = serialize_evidence(db_evidence, include_counts=False, db=db)
    result["file_size"] = file_size
    result["ocr_processing"] = ocr_status_val == "pending"
    
    return result


@router.put("/{evidence_id}")
def update_evidence(
    evidence_id: int,
    evidence_update: EvidenceUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    evidence = db.query(Evidence).filter(
        Evidence.id == evidence_id,
        Evidence.tenant_id.in_(user_tenants)
    ).first()
    
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    update_data = evidence_update.model_dump(exclude_unset=True)
    
    for field, value in update_data.items():
        setattr(evidence, field, value)
    
    if 'validity_period_days' in update_data or 'collection_date' in update_data:
        collection = evidence.collection_date
        validity = evidence.validity_period_days
        if collection and validity:
            evidence.expiry_date = collection + timedelta(days=validity)
        elif not validity:
            evidence.expiry_date = None
    
    db.commit()
    db.refresh(evidence)
    
    return serialize_evidence(evidence, include_counts=True, db=db)


@router.delete("/{evidence_id}")
def delete_evidence(
    evidence_id: int,
    force: bool = Query(False, description="Force delete even if linked to controls"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    evidence = db.query(Evidence).filter(
        Evidence.id == evidence_id,
        Evidence.tenant_id.in_(user_tenants)
    ).first()
    
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    mapping_count = db.query(EvidenceControlMapping).filter(
        EvidenceControlMapping.evidence_id == evidence_id
    ).count()
    
    if mapping_count > 0 and not force:
        return {
            "warning": True,
            "message": f"Evidence is linked to {mapping_count} control(s). Use force=true to delete anyway.",
            "control_mappings_count": mapping_count
        }
    
    if evidence.file_path and os.path.exists(evidence.file_path):
        try:
            os.remove(evidence.file_path)
        except OSError:
            pass
    
    # Delete all related records that reference this evidence
    # Delete assessment item evidence links
    db.query(AssessmentItemEvidence).filter(
        AssessmentItemEvidence.evidence_id == evidence_id
    ).delete(synchronize_session=False)
    
    # Delete RCSA response evidence links
    db.query(RCSAResponseEvidence).filter(
        RCSAResponseEvidence.evidence_id == evidence_id
    ).delete(synchronize_session=False)
    
    # Delete AI assessments
    db.query(EvidenceAIAssessment).filter(
        EvidenceAIAssessment.evidence_id == evidence_id
    ).delete(synchronize_session=False)
    
    # Delete control mappings
    db.query(EvidenceControlMapping).filter(
        EvidenceControlMapping.evidence_id == evidence_id
    ).delete(synchronize_session=False)
    
    # Delete versions
    db.query(EvidenceVersion).filter(
        EvidenceVersion.evidence_id == evidence_id
    ).delete(synchronize_session=False)
    
    # Delete risk evidence links
    db.query(RiskEvidenceLink).filter(
        RiskEvidenceLink.evidence_id == evidence_id
    ).delete(synchronize_session=False)
    
    # Delete asset evidence links
    db.query(AssetEvidenceLink).filter(
        AssetEvidenceLink.evidence_id == evidence_id
    ).delete(synchronize_session=False)
    
    # Delete incident evidence links
    db.query(EvidenceIncidentLink).filter(
        EvidenceIncidentLink.evidence_id == evidence_id
    ).delete(synchronize_session=False)
    
    # Delete policy evidence links
    db.query(EvidencePolicyLink).filter(
        EvidencePolicyLink.evidence_id == evidence_id
    ).delete(synchronize_session=False)
    
    # Now delete the evidence itself
    db.delete(evidence)
    db.commit()
    
    return {"message": "Evidence deleted successfully"}
