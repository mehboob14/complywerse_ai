from ....config import get_openai_model
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, timedelta
import logging
import os
import re
import io
import uuid
import json
import html

logger = logging.getLogger(__name__)
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Form
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, and_, select
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel, Field
from openai import OpenAI

from ....models import (
    GovernanceDocument, GovernanceDocumentVersion, DocumentReviewer,
    DocumentApprovalStep, DocumentAuditLog, DocumentAnnotation, GRCUser,
    Tenant, PolicyStatement, InternalControl, ParsedFrameworkControl,
    UploadedFramework, CertificationJourney, PolicyReviewHistory, get_db
)
from ....models import (
    AttestationCampaign, AuditObservationDocumentLink, BcmPlan, BcmRecoveryStrategy,
    DocumentAttestationAcknowledgment, DocumentAttestationCampaign, DocumentAttestationRecipient,
    DocumentSignature, DocumentSignoffAssignment, DocumentObligation, DocumentWorkflowAction, DocumentWorkflowInstance,
    ElectronicSignature, IssueGovernanceLink, MeetingAgendaItem, OversightAction, PolicyAttestation, PolicyException,
    PolicyGapAnalysisRun, PolicyGapFinding, RegulatoryImplementationTask, StatementControlMapping, StudioSession,
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant
from ..action_logger import log_governance_action
from ..ai_drafting import (
    build_tenant_context,
    build_framework_index,
    run_drafting_pipeline,
)

AI_INTEGRATIONS_OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
AI_INTEGRATIONS_OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")

from .. import doc_lifecycle  # noqa: E402
from .. import permissions  # noqa: E402

GOVERNANCE_UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "uploads", "governance")
os.makedirs(GOVERNANCE_UPLOAD_DIR, exist_ok=True)

ALLOWED_FILE_TYPES = {
    'pdf': 'application/pdf',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'doc': 'application/msword',
    'xls': 'application/vnd.ms-excel'
}

router = APIRouter(prefix="/documents", tags=["Governance - Documents"])


GOVERNANCE_DOMAIN_KEYWORDS: Dict[str, List[str]] = {
    "Governance and Oversight": [
        "governance", "oversight", "board", "committee", "strategy", "leadership", "management review",
        "policy management", "authority", "accountability"
    ],
    "Risk Management": [
        "risk", "assessment", "treatment", "mitigation", "register", "appetite", "tolerance", "residual"
    ],
    "Asset Management": [
        "asset", "inventory", "classification", "ownership", "lifecycle", "media", "disposal"
    ],
    "Identity and Access Management": [
        "access", "identity", "authentication", "authorization", "privilege", "user account", "segregation of duties",
        "joiner", "mover", "leaver", "password", "mfa", "remote access"
    ],
    "Security Operations and Monitoring": [
        "monitoring", "logging", "alert", "soc", "security event", "anomaly", "detection", "use case", "telemetry"
    ],
    "Incident Response and Resilience": [
        "incident", "response", "crisis", "breach", "resilience", "recovery", "continuity", "disaster", "forensic"
    ],
    "Vulnerability and Patch Management": [
        "vulnerability", "patch", "remediation", "hardening", "baseline", "configuration", "exposure", "scan"
    ],
    "Change and Release Management": [
        "change", "release", "deployment", "version", "promotion", "rollback", "cab", "testing"
    ],
    "Third-Party and Supplier Management": [
        "third party", "vendor", "supplier", "outsourcing", "service provider", "due diligence", "contract"
    ],
    "Data Protection and Privacy": [
        "data protection", "privacy", "personal data", "retention", "disposal", "encryption", "backup", "confidentiality"
    ],
    "Secure Development": [
        "development", "sdlc", "secure coding", "code review", "testing", "application security", "devsecops"
    ],
    "Physical and Environmental Security": [
        "physical", "environmental", "facility", "visitor", "perimeter", "surveillance"
    ],
    "Awareness and Competence": [
        "awareness", "training", "competence", "education", "disciplinary", "culture"
    ],
    "Compliance and Assurance": [
        "compliance", "audit", "assurance", "regulatory", "attestation", "evidence", "inspection"
    ],
}


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
    applicable_framework_ids: Optional[List[int]] = []
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
    applicable_framework_ids: Optional[List[int]] = None
    # Edit metadata (not a document column) — the "why" for a content edit,
    # captured into the version snapshot + audit trail.
    change_reason: Optional[str] = None
    tags: Optional[List[str]] = None


class BulkStatusUpdate(BaseModel):
    document_ids: List[int]
    status: str


class BulkArchive(BaseModel):
    document_ids: List[int]


class BulkAssignOwner(BaseModel):
    document_ids: List[int]
    owner_id: int


class BulkSetReviewDate(BaseModel):
    document_ids: List[int]
    next_review_date: datetime
    review_cycle_months: Optional[int] = None


class BulkPublish(BaseModel):
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


def serialize_document(doc: GovernanceDocument, db: Session = None) -> dict:
    result = {
        "id": doc.id,
        "tenant_id": doc.tenant_id,
        "document_code": doc.document_code,
        "title": doc.title,
        "description": doc.description,
        "content": doc.content,
        "file_name": doc.file_name,
        "file_size": doc.file_size,
        "file_type": doc.file_type,
        "has_file": doc.file_path is not None,
        "doc_type": doc.doc_type,
        "doc_sub_type": doc.doc_sub_type,
        "classification": doc.classification,
        "parent_document_id": doc.parent_document_id,
        "current_version": doc.current_version,
        "version_in_force": permissions.in_force_number(doc),
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
        "applicable_framework_ids": getattr(doc, "applicable_framework_ids", None) or [],
        "tags": doc.tags or [],
        "approved_by": doc.approved_by,
        "approved_at": doc.approved_at.isoformat() if doc.approved_at else None,
        "published_by": doc.published_by,
        "published_at": doc.published_at.isoformat() if doc.published_at else None,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
    }
    
    if db:
        try:
            from ...compliance.schema_migrations import ensure_assigned_column
            ensure_assigned_column(db)
        except Exception:
            pass
        policy_count = db.query(PolicyStatement).filter(
            PolicyStatement.document_id == doc.id
        ).count()
        result["policy_statement_count"] = policy_count
    else:
        result["policy_statement_count"] = len(doc.policy_statements) if hasattr(doc, 'policy_statements') and doc.policy_statements else 0
    
    if hasattr(doc, 'workflow_instance') and doc.workflow_instance:
        wf = doc.workflow_instance
        result["workflow_instance"] = {
            "id": wf.id,
            "template_id": wf.template_id,
            "template_name": wf.template.name if wf.template else None,
            "current_step_id": wf.current_step_id,
            "current_step_sequence": wf.current_step_sequence,
            "current_step_name": wf.current_step.name if wf.current_step else None,
            "status": wf.status,
            "started_at": wf.started_at.isoformat() if wf.started_at else None,
            "completed_at": wf.completed_at.isoformat() if wf.completed_at else None,
        }
    else:
        result["workflow_instance"] = None
    
    return result


def _in_force_for(db: Session, user: GRCUser, sees_every_draft: bool):
    """For a list: per document, the version row in force this person reads instead of it (None: the document itself). The rights
    are read once by the caller (``sees_every_draft``: ``visible_filter`` gave None); only a document not published now that holds
    a newer number than the one published last is looked at, for its owner, its author and its sign-off (``permissions.sees_draft``
    without the rights part)."""
    def row_of(doc: GovernanceDocument):
        last = permissions.published_last(doc)
        if (sees_every_draft or doc.status == "published" or not last or last == doc.current_version
                or user.id in (doc.owner_id, doc.author_id) or permissions.participant(db, user, doc.id)):
            return None
        return permissions.in_force_row(db, doc)
    return row_of


def _serve_in_force(result: dict, row: Optional[GovernanceDocumentVersion]) -> dict:
    """A serialized document with the text and the file of the version in force ``row`` (when the person reads that one)."""
    if row is not None:
        result.update(content=row.content, file_name=row.file_name, file_size=row.file_size, file_type=row.file_type,
                      has_file=bool(row.file_path))
    return result


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
    brief: bool = False,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """The documents the person may read, with their text. ``brief=1`` is the list for pickers in other modules (linking a risk,
    an issue, evidence or another document): only ``id``, ``title``, ``doc_type``, ``status`` and ``current_version`` (the number
    the person reads), no text, file or description; for someone outside the library it holds the documents in force as well as
    their own and those they are asked about, for a library reader what the library shows them."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}

    query = db.query(GovernanceDocument).options(
        joinedload(GovernanceDocument.owner)
    ).filter(GovernanceDocument.tenant_id.in_(user_tenants))
    # only what the person may read (in the body, not a dependency: the six type lists below call this function)
    visible = permissions.visible_filter(db, current_user)
    if brief and visible is not None and not permissions.can_read_library(db, current_user):
        visible = or_(GovernanceDocument.published_version.isnot(None), GovernanceDocument.status == "published", visible)
    if visible is not None:
        query = query.filter(visible)
    
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
    in_force = _in_force_for(db, current_user, visible is None)
    if brief:
        def item(doc):
            row = in_force(doc)
            return {"id": doc.id, "title": doc.title, "doc_type": doc.doc_type, "status": doc.status,
                    "current_version": row.version_number if row is not None else doc.current_version,
                    "document_code": doc.document_code, "parent_document_id": doc.parent_document_id, "tags": doc.tags or []}
        return {"items": [item(doc) for doc in documents], "total": total, "skip": skip, "limit": limit}

    return {
        "items": [_serve_in_force(serialize_document(doc, db), in_force(doc)) for doc in documents],
        "total": total,
        "skip": skip,
        "limit": limit
    }


def _resolve_tenant_slug_for_autoparse(tenant_id: int) -> Optional[str]:
    """Resolve a tenant's slug from its id via the master DB so we can dispatch
    the tenant-scoped auto-parse job after a document is created. Returns None
    (auto-parse simply skips) if it can't be resolved. Never raises."""
    try:
        from ....db import MasterSession
        from ....models import Tenant as MasterTenant
        master = MasterSession()
        try:
            row = master.query(MasterTenant.slug).filter(MasterTenant.id == tenant_id).first()
            return row[0] if row else None
        finally:
            master.close()
    except Exception:
        logger.warning("Could not resolve tenant slug for tenant_id=%s", tenant_id, exc_info=True)
        return None


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
        # Default the audited-against frameworks to the referenced/drafting
        # frameworks when the user didn't pick a separate applicable set.
        applicable_framework_ids=(document.applicable_framework_ids or document.framework_ids or []),
        tags=document.tags or [],
        status="draft",
        current_version="1.0"
    )
    from ..doc_details import schedule
    schedule(db_document)
    db.add(db_document)
    db.flush()
    # its first version from the start, as a document made in the AI Studio has, so its history and changes count from 1.0
    db.add(GovernanceDocumentVersion(
        document_id=db_document.id, version_number="1.0", change_type="major", title=db_document.title, content=db_document.content,
        change_summary="Initial version", status="current", created_by=current_user.id,
    ))
    
    create_audit_log(
        db=db,
        document_id=db_document.id,
        tenant_id=tenant_id,
        user_id=current_user.id,
        action="created",
        action_details=f"Document '{document.title}' created"
    )
    
    db.commit()
    
    # Log the action for review
    log_governance_action(
        db=db,
        tenant_id=tenant_id,
        action_type="document_draft_created",
        action_description=f"Governance document draft created: '{document.title}' ({document.doc_type})",
        entity_type="governance_document",
        action_user_id=current_user.id,
        entity_id=db_document.id,
        action_metadata={
            "document_code": document.document_code,
            "doc_type": document.doc_type,
            "doc_sub_type": document.doc_sub_type,
            "classification": document.classification
        }
    )
    db.commit()

    db.refresh(db_document)

    # Auto-run policy parsing on create so the user never has to open the doc
    # and click "Run parsing". Guarded + non-fatal (see maybe_autoparse_document):
    # skips already-parsed / content-less docs, and a dispatch failure never
    # fails the create.
    try:
        from .policy_parser import maybe_autoparse_document
        maybe_autoparse_document(
            db, _resolve_tenant_slug_for_autoparse(tenant_id), db_document.id, current_user.id
        )
    except Exception:
        logger.warning("auto-parse hook failed for doc %s", db_document.id, exc_info=True)

    return serialize_document(db_document, db)


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


@router.get("/hierarchy", dependencies=[Depends(permissions.require_library_reader)])
def get_document_hierarchy(
    tenant_id: Optional[int] = None,
    parent_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    # ponytail: a document under a draft the person may not see is left out with it; lift it to the top if that ever matters
    visible = permissions.visible_filter(db, current_user)
    in_force = _in_force_for(db, current_user, visible is None)
    query = db.query(GovernanceDocument).options(
        joinedload(GovernanceDocument.owner)
    ).filter(GovernanceDocument.tenant_id.in_(user_tenants))
    if visible is not None:
        query = query.filter(visible)
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(GovernanceDocument.tenant_id == tenant_id)
    
    if parent_id is None:
        query = query.filter(GovernanceDocument.parent_document_id.is_(None))
    else:
        query = query.filter(GovernanceDocument.parent_document_id == parent_id)
    
    documents = query.order_by(GovernanceDocument.doc_type, GovernanceDocument.title).all()

    # each document's versions for the tree, base first: one query of columns only (never the versions' content)
    from .. import change_chain
    V = GovernanceDocumentVersion
    rows = (db.query(V.id, V.document_id, V.version_number, V.change_type, V.status, V.created_at, V.created_by,
                     V.change_reason, V.change_summary, V.file_path)
            .join(GovernanceDocument, GovernanceDocument.id == V.document_id)
            .filter(GovernanceDocument.tenant_id.in_(user_tenants))
            .order_by(V.created_at.asc(), V.id.asc()).all())
    names = change_chain._names(db, [r.created_by for r in rows])
    versions_of: Dict[int, List[Dict[str, Any]]] = {}
    for r in rows:
        vs = versions_of.setdefault(r.document_id, [])
        if vs and vs[-1]["number"] == r.version_number:      # a snapshot that repeats the number before it (the gap fix's pre-fix copy)
            continue
        vs.append({"id": r.id, "number": r.version_number, "kind": r.change_type, "current": r.status == "current",
                   "at": r.created_at.isoformat() if r.created_at else None, "by": names.get(r.created_by),
                   "reason": (r.change_reason or "")[:300], "summary": (r.change_summary or "")[:200], "has_file": bool(r.file_path)})

    def build_hierarchy(doc):
        row = in_force(doc)
        result = _serve_in_force(serialize_document(doc, db), row)
        vs = [v for v in versions_of.get(doc.id, []) if row is None or v["id"] <= row.id]   # never the newer version's card
        result["version_count"] = len(vs)
        result["versions"] = vs if len(vs) <= 6 else [vs[0]] + vs[-5:]       # the base and the newest five
        children = db.query(GovernanceDocument).filter(
            GovernanceDocument.parent_document_id == doc.id, *([visible] if visible is not None else [])
        ).order_by(GovernanceDocument.doc_type, GovernanceDocument.title, GovernanceDocument.id).all()
        result["children"] = [build_hierarchy(child) for child in children]
        return result
    
    return [build_hierarchy(doc) for doc in documents]


@router.get("/reviews/upcoming", dependencies=[Depends(permissions.require_library_reader)])
def get_upcoming_reviews(
    days: int = 90,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    now = datetime.utcnow()
    cutoff = now + timedelta(days=days)
    visible = permissions.visible_filter(db, current_user)
    
    documents = db.query(GovernanceDocument).filter(
        GovernanceDocument.tenant_id.in_(user_tenants),
        GovernanceDocument.next_review_date != None,
        GovernanceDocument.next_review_date <= cutoff,
        GovernanceDocument.status != "retired",
        *([visible] if visible is not None else [])
    ).order_by(GovernanceDocument.next_review_date.asc()).all()
    
    results = []
    for doc in documents:
        is_overdue = doc.next_review_date and doc.next_review_date < now
        days_until = (doc.next_review_date - now).days if doc.next_review_date else None
        
        owner_name = None
        if doc.owner_id:
            owner = db.query(GRCUser).filter(GRCUser.id == doc.owner_id).first()
            if owner:
                owner_name = owner.display_name
        
        results.append({
            "document_id": doc.id,
            "title": doc.title,
            "doc_type": doc.doc_type,
            "status": doc.status,
            "review_cycle_months": doc.review_cycle_months,
            "next_review_date": doc.next_review_date.isoformat() if doc.next_review_date else None,
            "is_overdue": is_overdue,
            "days_until_review": days_until,
            "owner_name": owner_name
        })
    
    overdue_count = sum(1 for r in results if r["is_overdue"])
    upcoming_count = len(results) - overdue_count
    
    return {
        "total": len(results),
        "overdue_count": overdue_count,
        "upcoming_count": upcoming_count,
        "reviews": results
    }


@router.get("/{document_id}", dependencies=[Depends(permissions.require_doc_reader)])
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
    
    result = serialize_document(document, db)
    # while a new version is on its way the published one stays in force: whoever may not change, publish or sign off the
    # document reads that one (its text, file and number; the newer one is only named), everyone else the newest
    in_force = permissions.in_force_row(db, document)
    row = in_force if in_force is not None and not permissions.sees_draft(db, current_user, document) else None
    result["in_force_version_id"] = in_force.id if in_force is not None else None
    if row is not None:
        _serve_in_force(result, row)
        result["current_version"] = row.version_number
        result["newer_version"] = {"number": document.current_version, "status": document.status}
    if document.status == "archived":           # when and by whom, for the document's banner (the newest change to archived)
        A = DocumentAuditLog
        last = (db.query(A).filter(A.document_id == document.id, or_(A.action == "archived", and_(A.field_changed == "status", A.new_value == "archived")))
                .order_by(A.performed_at.desc(), A.id.desc()).first())
        result["archived_at"] = last.performed_at.isoformat() if last is not None and last.performed_at else None
        result["archived_by_name"] = last.user.display_name if last is not None and last.user else None

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
        for v in document.versions if row is None or v.id <= row.id
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
    
    visible = permissions.visible_filter(db, current_user)
    child_documents = db.query(GovernanceDocument).filter(
        GovernanceDocument.parent_document_id == document_id, *([visible] if visible is not None else [])
    ).order_by(GovernanceDocument.id).all()
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


def _fold_change(db: Session, document: GovernanceDocument, row, held_text, new_text, user_id: int, kind: str, reason) -> None:
    """Keep on ``row`` (a version that takes one more change) who made each change it holds (see ``change_chain.fold``)."""
    from .. import change_chain as C, doc_version

    try:
        before = doc_version.before_pending(db, document, row)
        names = {u.id: (u.display_name or u.username) for u in db.query(GRCUser).filter(GRCUser.id.in_({user_id, row.created_by} - {None}))}
        folded = C.fold(C.version_text(before) if before is not None else "", held_text or "", new_text or "",
                        row.change_set if isinstance(row.change_set, dict) else None, kind=kind, by=names.get(user_id, ""), by_id=user_id,
                        at=datetime.utcnow().isoformat(), version=row.version_number, reason=reason or "",
                        held_by=names.get(row.created_by, ""), held_by_id=row.created_by,
                        held_at=row.created_at.isoformat() if row.created_at else None)
        if folded is not None:
            row.change_set = folded
    except Exception:       # noqa: BLE001 - the chain is derived from the texts when this is missing
        logger.warning("could not record who made the change to version %s of document %s", row.version_number, document.id, exc_info=True)


def _snapshot_content_version(
    db: Session, document: GovernanceDocument, *, old_content, old_title, old_version,
    change_type: str, change_reason, user_id: int, summary: Optional[str] = None,
) -> str:
    """Snapshot document content into version history. Assumes document.content
    already holds the NEW content. Preserves the original as a baseline on the
    first edit, supersedes the prior current, inserts a new current, and bumps
    document.current_version: the major number for a "major" change, else the
    minor one. Returns the new version number."""
    from .versions import increment_version
    from .. import doc_version

    existing = db.query(GovernanceDocumentVersion).filter(
        GovernanceDocumentVersion.document_id == document.id
    ).count()
    if existing and change_type == "signoff":
        # a sign-off stamp is not a new version: it is written into the version being signed (the user's rule, 2026-10-17)
        stamped = db.query(GovernanceDocumentVersion).filter(GovernanceDocumentVersion.document_id == document.id,
                                                             GovernanceDocumentVersion.status == "current").order_by(GovernanceDocumentVersion.id.desc()).first()
        if stamped is not None:
            _fold_change(db, document, stamped, old_content, document.content, user_id, "signoff", change_reason)
            stamped.content, stamped.title = document.content, document.title
            return document.current_version or old_version
    if existing:
        number, pending = doc_version.target(db, document, change_type)
        if pending is not None:          # not published yet: the change goes into the one pending version
            _fold_change(db, document, pending, old_content, document.content, user_id, "manual", change_reason)
            doc_version.update_pending(pending, number, change_type, title=document.title, content=document.content,
                                       summary=summary or f"{change_type} update".strip(), reason=change_reason)
            document.current_version = number
            return number
    if existing == 0:
        db.add(GovernanceDocumentVersion(
            document_id=document.id, version_number=old_version, change_type="baseline",
            title=old_title, content=old_content, change_summary="Baseline snapshot (before first edit)",
            status="superseded", created_by=user_id, created_at=datetime.utcnow(),
        ))
    else:
        db.query(GovernanceDocumentVersion).filter(
            GovernanceDocumentVersion.document_id == document.id,
            GovernanceDocumentVersion.status == "current",
        ).update({"status": "superseded"})
    new_version_number = increment_version(old_version, "major" if change_type == "major" else "minor")
    db.add(GovernanceDocumentVersion(
        document_id=document.id, version_number=new_version_number, change_type=change_type,
        title=document.title, content=document.content, change_summary=summary or f"{change_type} update".strip(),
        change_reason=change_reason, status="current", created_by=user_id, created_at=datetime.utcnow(),
    ))
    document.current_version = new_version_number
    return new_version_number


# Friendly Document-Description row labels we know how to refresh on sign-off.
_DOC_CONTROL_LABELS = {
    "effective_date": "effective date",
    "version": "version",
    "next_review_date": "next review date",
    "classification": "document classification",
    "approval_authority": "approval authority",
}


def _patch_signoff_content(content: Optional[str], signoffs: list, control_fields: dict) -> str:
    """Fill the Approval Signoff table (by Role) and refresh the Document
    Description table (by label) inside the markdown content. Parses table rows
    structurally (matching cells), NOT by blind underscore replacement, so it is
    unambiguous across the identical `___________________` placeholder cells."""
    if not content:
        return content or ""
    value_by_label = {
        _DOC_CONTROL_LABELS.get(k, k).lower(): str(v)
        for k, v in (control_fields or {}).items() if v
    }
    sign_by_role = {}
    for s in (signoffs or []):
        role = (s.get("role") or "").strip().lower()
        if role:
            sign_by_role[role] = s

    def _is_sep(cells):
        return all(re.fullmatch(r":?-{2,}:?", (c or "").strip() or "") for c in cells if (c or "").strip())

    out = []
    for line in content.split("\n"):
        stripped = line.strip()
        if not (stripped.startswith("|") and stripped.endswith("|")):
            out.append(line)
            continue
        cells = [c.strip() for c in stripped.strip("|").split("|")]
        if _is_sep(cells):
            out.append(line)
            continue
        # Document Description: 2-col "| Label | Value |".
        if len(cells) == 2:
            label = cells[0].strip("*").strip().lower()
            if label in value_by_label:
                out.append("| " + cells[0] + " | " + value_by_label[label] + " |")
                continue
        # Approval Signoff: "| Role | Name | Designation | Signature / Date |".
        if len(cells) >= 3:
            role = cells[0].strip("*").strip().lower()
            match = None
            for r, s in sign_by_role.items():
                if r and (r in role or role in r):
                    match = s
                    break
            if match:
                name = (match.get("name") or "").strip()
                date = (match.get("date") or "").strip()
                if name:
                    cells[1] = name
                if match.get("designation"):
                    cells[2] = match["designation"].strip()
                sig = " — ".join([p for p in (name, date) if p]) or cells[-1]
                cells[-1] = sig
                out.append("| " + " | ".join(cells) + " |")
                continue
        out.append(line)
    return "\n".join(out)


@router.put("/{document_id}", dependencies=[Depends(permissions.require_doc_editor)])
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
    if "status" in update_data and update_data["status"] == document.status:
        update_data.pop("status")       # not a status change: an edit of a published text is reviewed again (changed_after_review)
    if update_data.get("status") in ("approved", "published"):
        permissions.ensure_publisher(db, current_user)
    if update_data.get("parent_document_id") is not None and update_data["parent_document_id"] != document.parent_document_id:
        from ..doc_details import check_details
        try:
            check_details(db, parent_document_id=update_data["parent_document_id"], document_id=document.id)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    # change_reason is edit metadata, not a document column — pull it out so the
    # field loop doesn't try to setattr/getattr a non-existent attribute.
    change_reason = update_data.pop("change_reason", None)

    # Capture prior state BEFORE mutating so we can snapshot + audit it.
    old_content = document.content
    old_title = document.title
    old_version = document.current_version or "1.0"
    old_status = document.status
    content_changing = (
        "content" in update_data
        and (update_data.get("content") or "") != (old_content or "")
    )

    changed_fields = []
    for field, new_value in update_data.items():
        old_value = getattr(document, field)
        if old_value != new_value:
            changed_fields.append({"field": field, "old_value": old_value, "new_value": new_value})
            setattr(document, field, new_value)

    document.updated_at = datetime.utcnow()

    # Content edit → version snapshot (mirrors the statement edit→snapshot→history
    # pattern) so document body is fully versioned + restorable with who/when/why.
    if content_changing:
        from ..doc_version import decide, summary_of
        decision = decide(old_content or "", document.content or "", title=document.title)
        _snapshot_content_version(
            db, document, old_content=old_content, old_title=old_title,
            old_version=old_version, change_type=decision["change"], change_reason=change_reason,
            user_id=current_user.id, summary=summary_of("Content edited", decision),
        )
        if "status" not in update_data:          # the new text is reviewed again, as an AI Studio save is
            doc_lifecycle.changed_after_review(db, document, old_status, current_user.id,
                                               f"Content edited (version {document.current_version}), so it needs approving again")
        if document.status == "published":       # published and edited in one request: the new number is the one in force
            document.published_version = document.current_version

    def _preview(v):
        s = "" if v is None else str(v)
        return (s[:2000] + "…") if len(s) > 2000 else s

    # Rich audit: content edits capture old/new (+ reason); metadata edits log names.
    if content_changing:
        create_audit_log(
            db=db, document_id=document_id, tenant_id=document.tenant_id,
            user_id=current_user.id, action="content_edited", field_changed="content",
            old_value=_preview(old_content), new_value=_preview(document.content),
            action_details=change_reason or "Document content edited",
        )
    non_content = [c for c in changed_fields if c["field"] != "content"]
    if non_content:
        create_audit_log(
            db=db, document_id=document_id, tenant_id=document.tenant_id,
            user_id=current_user.id, action="updated",
            action_details=f"Updated fields: {', '.join(c['field'] for c in non_content)}",
        )

    db.commit()
    db.refresh(document)

    return serialize_document(document, db)


class SignoffEntry(BaseModel):
    role: str                       # matches the Approval Signoff row's Role label
    name: Optional[str] = None
    designation: Optional[str] = None
    date: Optional[str] = None


class DocumentSignoffRequest(BaseModel):
    signoffs: List[SignoffEntry] = []
    # Document-control header fields to refresh (all optional).
    effective_date: Optional[str] = None
    version: Optional[str] = None
    next_review_date: Optional[str] = None
    classification: Optional[str] = None
    approval_authority: Optional[str] = None
    # Also stamp the structured approval columns (approved_by/at).
    mark_approved: bool = False


@router.post("/{document_id}/signoff", dependencies=[Depends(permissions.require_doc_editor)])
def signoff_document(
    document_id: int,
    body: DocumentSignoffRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Fill the Approval Signoff table (approver name/designation/date) and the
    Document Description header (version/effective/next-review/classification) in
    the document content — the 'sign / fill placeholders later' flow. Snapshots a
    version (change_type=signoff) + writes an audit row, and optionally stamps the
    structured approved_by/approved_at columns. Non-destructive: only matched
    table cells change."""
    user_tenants = get_user_tenants(current_user, db)
    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants),
    ).first()
    if not document:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    old_content = document.content
    old_title = document.title
    old_version = document.current_version or "1.0"

    control_fields = {
        "effective_date": body.effective_date, "version": body.version,
        "next_review_date": body.next_review_date, "classification": body.classification,
        "approval_authority": body.approval_authority,
    }
    signoffs = [s.model_dump() for s in body.signoffs]
    new_content = _patch_signoff_content(old_content, signoffs, control_fields)
    content_changed = new_content != (old_content or "")

    # Mirror structured document-control columns from the header edits.
    if body.classification:
        document.classification = body.classification
    if body.effective_date:
        try:
            document.effective_date = datetime.fromisoformat(body.effective_date)
        except (ValueError, TypeError):
            pass
    if body.next_review_date:
        try:
            document.next_review_date = datetime.fromisoformat(body.next_review_date)
        except (ValueError, TypeError):
            pass
    if body.mark_approved:
        permissions.ensure_publisher(db, current_user)          # recording an approval by hand needs the publish right
        document.approved_by = current_user.id
        document.approved_at = datetime.utcnow()

    reason = "Sign-off: " + ", ".join(
        [f"{s['role']}={s.get('name') or '—'}" for s in signoffs] or ["document-control fields"]
    )
    if content_changed:
        document.content = new_content
        _snapshot_content_version(
            db, document, old_content=old_content, old_title=old_title,
            old_version=old_version, change_type="signoff", change_reason=reason,
            user_id=current_user.id,
        )
        if document.status == "published":       # the stamp is a new number of the published text: the one in force
            document.published_version = document.current_version
    document.updated_at = datetime.utcnow()
    create_audit_log(
        db=db, document_id=document_id, tenant_id=document.tenant_id,
        user_id=current_user.id, action="signed", field_changed="signoff",
        old_value=None, new_value=reason, action_details=reason,
    )
    db.commit()
    db.refresh(document)
    return serialize_document(document, db)


# Deleting a document. Its ORM cascade already removes versions, reviewers,
# approval steps, audit logs, control/risk/regulatory/asset links, the workflow
# instance and the statements (with their compliance records, evidence links and
# versions). Every other row that points at the document or at those rows is
# listed here: a row that exists only for this document goes with it, and a
# record that merely links to it is kept and unlinked, the way unlinking a
# control from a document already works (mappings.py). Without this, deleting a
# parsed document failed on its statements' control mappings.
# tests/test_governance_document_delete.py fails when a new table points at any
# of these rows without being listed.
_DELETE_WITH_DOCUMENT = (  # a table goes before the tables it points at
    StatementControlMapping.statement_id,
    IssueGovernanceLink.governance_document_id,
    IssueGovernanceLink.policy_statement_id,
    PolicyGapFinding.document_id,
    PolicyGapFinding.analysis_run_id,
    PolicyGapAnalysisRun.document_id,
    DocumentAttestationAcknowledgment.campaign_id,
    DocumentAttestationRecipient.campaign_id,
    DocumentAttestationCampaign.document_id,
    PolicyAttestation.document_id,
    DocumentSignature.document_id,
    ElectronicSignature.document_id,
    DocumentSignoffAssignment.document_id,
    DocumentObligation.document_id,
    DocumentAnnotation.document_id,
    PolicyReviewHistory.document_id,
    AuditObservationDocumentLink.document_id,
    DocumentWorkflowAction.instance_id,
)
_UNLINK_FROM_DOCUMENT = (
    InternalControl.source_document_id,
    InternalControl.source_statement_id,
    PolicyGapFinding.applied_statement_id,
    PolicyGapFinding.applied_version_id,
    PolicyAttestation.parent_attestation_id,
    PolicyAttestation.document_version_id,
    DocumentSignature.version_id,
    PolicyException.document_id,
    AttestationCampaign.linked_document_id,
    RegulatoryImplementationTask.linked_policy_id,
    MeetingAgendaItem.linked_document_id,
    OversightAction.linked_policy_id,
    BcmPlan.document_ref_id,
    BcmRecoveryStrategy.activation_procedure_ref,
    StudioSession.document_id,  # the AI Studio draft, its chat and versions stay; it can be moved to the library again
)


def _clear_document_references(db: Session, document_id: int) -> None:
    """Delete or unlink every row that would stop ``document_id`` from being deleted."""
    def ids(model):
        return select(model.id).where(model.document_id == document_id)

    owned = {  # table -> ids of its rows that go with the document
        GovernanceDocument.__tablename__: [document_id],
        PolicyStatement.__tablename__: ids(PolicyStatement),
        GovernanceDocumentVersion.__tablename__: ids(GovernanceDocumentVersion),
        PolicyGapAnalysisRun.__tablename__: ids(PolicyGapAnalysisRun),
        PolicyAttestation.__tablename__: ids(PolicyAttestation),
        DocumentAttestationCampaign.__tablename__: ids(DocumentAttestationCampaign),
        DocumentWorkflowInstance.__tablename__: ids(DocumentWorkflowInstance),
    }

    def rows(column):
        target = next(iter(column.expression.foreign_keys)).column.table.name
        return db.query(column.class_).filter(column.in_(owned[target]))

    # the tasks that mirror this document's approvals and acknowledgements go with it
    from ....models import CriticalTask
    obligations = select(DocumentObligation.id).where(DocumentObligation.document_id == document_id)
    for task in db.query(CriticalTask).filter(CriticalTask.source_module == "document_lifecycle",
                                              CriticalTask.source_entity_id.in_(obligations)).all():
        db.delete(task)
    db.flush()
    for column in _UNLINK_FROM_DOCUMENT:
        rows(column).update({column: None}, synchronize_session=False)
    for column in _DELETE_WITH_DOCUMENT:
        rows(column).delete(synchronize_session=False)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(permissions.require_doc_deleter)])
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
    
    _clear_document_references(db, document_id)
    db.delete(document)
    try:
        db.commit()
    except IntegrityError as exc:  # a reference the lists above do not know about yet
        db.rollback()
        table = getattr(getattr(exc.orig, "diag", None), "table_name", None) or "another record"
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This document is still referenced by {table.removeprefix('grc_').replace('_', ' ')}; remove that link first.",
        )

    return None


@router.get("/{document_id}/review-history", dependencies=[Depends(permissions.require_doc_reader)])
def get_review_history(
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
        raise HTTPException(status_code=404, detail="Document not found")
    
    reviews = db.query(PolicyReviewHistory).filter(
        PolicyReviewHistory.document_id == document_id,
        PolicyReviewHistory.tenant_id.in_(user_tenants)
    ).order_by(PolicyReviewHistory.created_at.desc()).all()
    
    return [{
        "id": r.id,
        "review_type": r.review_type,
        "review_status": r.review_status,
        "scheduled_date": r.scheduled_date.isoformat() if r.scheduled_date else None,
        "started_at": r.started_at.isoformat() if r.started_at else None,
        "completed_at": r.completed_at.isoformat() if r.completed_at else None,
        "reviewer_id": r.reviewer_id,
        "review_notes": r.review_notes,
        "changes_made": r.changes_made,
        "outcome": r.outcome,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in reviews]


class StartReviewRequest(BaseModel):
    review_type: str = "periodic"


class CompleteReviewRequest(BaseModel):
    review_notes: str = ""
    changes_made: str = ""
    outcome: str = "no_changes"


@router.post("/{document_id}/start-review", dependencies=[Depends(permissions.require_doc_editor)])
def start_review(
    document_id: int,
    request_body: Optional[StartReviewRequest] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    review_type = request_body.review_type if request_body else "periodic"
    
    review = PolicyReviewHistory(
        tenant_id=document.tenant_id,
        document_id=document_id,
        review_type=review_type,
        review_status="in_progress",
        scheduled_date=document.next_review_date,
        started_at=datetime.utcnow(),
        reviewer_id=current_user.id,
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    
    return {
        "id": review.id,
        "review_type": review.review_type,
        "review_status": review.review_status,
        "scheduled_date": review.scheduled_date.isoformat() if review.scheduled_date else None,
        "started_at": review.started_at.isoformat() if review.started_at else None,
        "reviewer_id": review.reviewer_id,
        "message": "Review started successfully"
    }


@router.post("/{document_id}/complete-review", dependencies=[Depends(permissions.require_doc_editor)])
def complete_review(
    document_id: int,
    request_body: CompleteReviewRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    review = db.query(PolicyReviewHistory).filter(
        PolicyReviewHistory.document_id == document_id,
        PolicyReviewHistory.review_status == "in_progress",
        PolicyReviewHistory.tenant_id.in_(user_tenants)
    ).order_by(PolicyReviewHistory.created_at.desc()).first()
    
    if not review:
        review = PolicyReviewHistory(
            tenant_id=document.tenant_id,
            document_id=document_id,
            review_type="periodic",
            review_status="in_progress",
            started_at=datetime.utcnow(),
            reviewer_id=current_user.id,
        )
        db.add(review)
        db.flush()
    
    now = datetime.utcnow()
    review.review_status = "completed"
    review.completed_at = now
    review.review_notes = request_body.review_notes
    review.changes_made = request_body.changes_made
    review.outcome = request_body.outcome
    review.reviewer_id = current_user.id
    
    document.last_reviewed_at = now
    document.last_reviewed_by = current_user.id
    if document.review_cycle_months:
        from dateutil.relativedelta import relativedelta
        document.next_review_date = now + relativedelta(months=document.review_cycle_months)
    
    document.updated_at = now
    
    create_audit_log(
        db=db,
        document_id=document_id,
        tenant_id=document.tenant_id,
        user_id=current_user.id,
        action="review_completed",
        action_details=f"Review completed with outcome: {request_body.outcome}"
    )
    
    db.commit()
    db.refresh(review)
    db.refresh(document)
    
    return {
        "id": review.id,
        "review_status": review.review_status,
        "completed_at": review.completed_at.isoformat() if review.completed_at else None,
        "outcome": review.outcome,
        "next_review_date": document.next_review_date.isoformat() if document.next_review_date else None,
        "message": "Review completed successfully"
    }


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
    
    permissions.ensure_all_editable(db, current_user, documents)
    if bulk_update.status in ("approved", "published"):
        permissions.ensure_publisher(db, current_user)
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
        db.flush()
        doc_lifecycle.on_status_changed(db, doc, old_status, bulk_update.status, current_user.id)
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
    
    permissions.ensure_all_editable(db, current_user, documents)
    archived_count = 0
    for doc in documents:
        old_status = doc.status
        doc.status = "archived"
        doc.updated_at = datetime.utcnow()
        doc_lifecycle.on_status_changed(db, doc, old_status, "archived", current_user.id)
        
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


@router.post("/bulk-assign-owner")
def bulk_assign_owner(
    bulk_request: BulkAssignOwner,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    documents = db.query(GovernanceDocument).filter(
        GovernanceDocument.id.in_(bulk_request.document_ids),
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).all()

    if not documents:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No documents found"
        )

    permissions.ensure_all_editable(db, current_user, documents)
    updated_count = 0
    for doc in documents:
        old_owner = doc.owner_id
        doc.owner_id = bulk_request.owner_id
        doc.updated_at = datetime.utcnow()

        create_audit_log(
            db=db,
            document_id=doc.id,
            tenant_id=doc.tenant_id,
            user_id=current_user.id,
            action="owner_assigned",
            action_details=f"Owner changed from '{old_owner}' to '{bulk_request.owner_id}'",
            field_changed="owner_id",
            old_value=str(old_owner) if old_owner is not None else None,
            new_value=str(bulk_request.owner_id)
        )
        updated_count += 1

    db.commit()

    return {
        "message": f"Successfully assigned owner to {updated_count} documents",
        "updated_count": updated_count
    }


@router.post("/bulk-set-review-date")
def bulk_set_review_date(
    bulk_request: BulkSetReviewDate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    documents = db.query(GovernanceDocument).filter(
        GovernanceDocument.id.in_(bulk_request.document_ids),
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).all()

    if not documents:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No documents found"
        )

    permissions.ensure_all_editable(db, current_user, documents)
    updated_count = 0
    for doc in documents:
        old_review_date = doc.next_review_date
        doc.next_review_date = bulk_request.next_review_date
        if bulk_request.review_cycle_months is not None:
            doc.review_cycle_months = bulk_request.review_cycle_months
        doc.updated_at = datetime.utcnow()

        create_audit_log(
            db=db,
            document_id=doc.id,
            tenant_id=doc.tenant_id,
            user_id=current_user.id,
            action="review_date_updated",
            action_details=f"Next review date set to '{bulk_request.next_review_date.isoformat()}'",
            field_changed="next_review_date",
            old_value=old_review_date.isoformat() if old_review_date else None,
            new_value=bulk_request.next_review_date.isoformat()
        )
        updated_count += 1

    db.commit()

    return {
        "message": f"Successfully updated review date for {updated_count} documents",
        "updated_count": updated_count
    }


@router.post("/bulk-publish")
def bulk_publish(
    bulk_request: BulkPublish,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    documents = db.query(GovernanceDocument).filter(
        GovernanceDocument.id.in_(bulk_request.document_ids),
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).all()

    if not documents:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No documents found"
        )

    permissions.ensure_publisher(db, current_user)
    published_count = 0
    skipped_count = 0
    for doc in documents:
        if doc.status != "approved":
            skipped_count += 1
            continue

        old_status = doc.status
        doc.status = "published"
        doc.published_by = current_user.id
        doc.published_at = datetime.utcnow()
        doc.updated_at = datetime.utcnow()
        db.flush()
        doc_lifecycle.on_status_changed(db, doc, old_status, "published", current_user.id)

        create_audit_log(
            db=db,
            document_id=doc.id,
            tenant_id=doc.tenant_id,
            user_id=current_user.id,
            action="published",
            action_details=f"Document published by {current_user.display_name}",
            field_changed="status",
            old_value=old_status,
            new_value="published"
        )
        published_count += 1

    db.commit()

    return {
        "message": f"Published {published_count} documents, skipped {skipped_count}",
        "published_count": published_count,
        "skipped_count": skipped_count
    }


@router.put("/{document_id}/status", dependencies=[Depends(permissions.require_doc_editor)])
def update_document_status(
    document_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    new_status = body.get("status")
    valid_statuses = ["draft", "pending_review", "pending_approval", "approved", "published", "expired", "archived"]
    if new_status not in valid_statuses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid status. Must be one of: {', '.join(valid_statuses)}"
        )
    if new_status in ("approved", "published"):               # approving or publishing by hand skips the sign-off
        permissions.ensure_publisher(db, current_user)

    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()

    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )

    old_status = document.status
    document.status = new_status
    document.updated_at = datetime.utcnow()

    if new_status == "published":
        document.published_by = current_user.id
        document.published_at = datetime.utcnow()
    db.flush()
    create_audit_log(
        db=db,
        document_id=document_id,
        tenant_id=document.tenant_id,
        user_id=current_user.id,
        action="status_changed",
        action_details=f"Status changed from '{old_status}' to '{new_status}' by {current_user.display_name}",
        field_changed="status",
        old_value=old_status,
        new_value=new_status
    )
    doc_lifecycle.on_status_changed(db, document, old_status, new_status, current_user.id)     # after: its own row (nobody to sign) is the last

    # When the document reaches an approved/published state, any gap-remediation
    # clauses applied to it (left in_progress pending sign-off) are now formally
    # accepted — close them out. Applying a clause keeps the finding in_progress
    # until this review/approval step completes.
    if new_status in ("approved", "published"):
        from ....models import PolicyGapFinding
        _now = datetime.utcnow()
        applied_findings = db.query(PolicyGapFinding).filter(
            PolicyGapFinding.document_id == document.id,
            PolicyGapFinding.tenant_id == document.tenant_id,
            PolicyGapFinding.applied_at.isnot(None),
            PolicyGapFinding.remediation_status == "in_progress",
        ).all()
        for _f in applied_findings:
            _f.remediation_status = "closed"
            _f.actual_close_date = _now
            _f.updated_at = _now

    db.commit()
    db.refresh(document)

    return serialize_document(document, db)


@router.post("/{document_id}/restore")
def restore_document(
    document: GovernanceDocument = Depends(permissions.require_doc_editor),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """An archived document back as a draft (documents are archived, never deleted: D29), by whoever may change it. Nothing comes
    back in force: it is reviewed, approved and published again. No version is made; its next change makes the next one (D28)."""
    if document.status != "archived":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only an archived document can be restored.")
    document.status = "draft"
    document.updated_at = datetime.utcnow()
    db.flush()
    create_audit_log(
        db=db,
        document_id=document.id,
        tenant_id=document.tenant_id,
        user_id=current_user.id,
        action="restored",
        action_details="Restored from the archive: it is a draft again",
        field_changed="status",
        old_value="archived",
        new_value="draft"
    )
    doc_lifecycle.on_status_changed(db, document, "archived", "draft", current_user.id)
    db.commit()
    db.refresh(document)
    return serialize_document(document, db)


@router.post("/{document_id}/publish", dependencies=[Depends(permissions.require_doc_publisher)])
def publish_document(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Publish an approved document"""
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
    
    if document.status != "approved":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Only approved documents can be published. Current status: {document.status}"
        )
    
    old_status = document.status
    document.status = "published"
    doc_lifecycle.on_status_changed(db, document, old_status, "published", current_user.id)
    document.published_by = current_user.id
    document.published_at = datetime.utcnow()
    document.updated_at = datetime.utcnow()
    
    create_audit_log(
        db=db,
        document_id=document_id,
        tenant_id=document.tenant_id,
        user_id=current_user.id,
        action="published",
        action_details=f"Document published by {current_user.display_name}",
        field_changed="status",
        old_value=old_status,
        new_value="published"
    )
    
    db.commit()
    db.refresh(document)
    
    return serialize_document(document, db)


@router.get("/{document_id}/audit-logs", dependencies=[Depends(permissions.require_doc_reader)])
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
    # the text before and after an edit is the newest version's: not for someone who reads the version in force
    hide = not permissions.sees_draft(db, current_user, document)
    
    return [
        {
            "id": log.id,
            "action": log.action,
            "action_details": log.action_details,
            "field_changed": log.field_changed,
            "old_value": None if hide and log.field_changed == "content" else log.old_value,
            "new_value": None if hide and log.field_changed == "content" else log.new_value,
            "performed_by": log.performed_by,
            "performer_name": log.user.display_name if log.user else None,
            "performed_at": log.performed_at.isoformat() if log.performed_at else None,
            "ip_address": log.ip_address,
        }
        for log in logs
    ]


@router.post("/{document_id}/upload-file", dependencies=[Depends(permissions.require_doc_editor)])
async def upload_document_file(
    document_id: int,
    file: UploadFile = File(...),
    change_summary: Optional[str] = Form(None),
    change_reason: Optional[str] = Form(None),
    create_new_version: bool = Form(True),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Upload a file (PDF, Word, Excel) for an existing governance document"""
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
    
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No file provided"
        )
    
    file_ext = file.filename.lower().split('.')[-1] if '.' in file.filename else ''
    if file_ext not in ALLOWED_FILE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Only PDF, Word (.doc, .docx), and Excel (.xls, .xlsx) files are supported"
        )
    
    unique_id = str(uuid.uuid4())
    safe_filename = f"{unique_id}_{file.filename}"
    file_path = os.path.join(GOVERNANCE_UPLOAD_DIR, safe_filename)
    
    content = await file.read()
    file_size = len(content)
    
    with open(file_path, "wb") as f:
        f.write(content)
    
    old_file_name = document.file_name
    old_status = document.status
    
    current_ver = document.current_version or "1.0"
    V = GovernanceDocumentVersion
    current_row = (db.query(V).filter(V.document_id == document_id, V.version_number == current_ver)
                   .order_by(V.id.desc()).first())
    # the version in force (or published last) is never written over: a file for it is a new version, whatever the form asked
    if (create_new_version and document.file_name) or current_ver in (permissions.in_force_number(document), permissions.published_last(document)):
        from .. import doc_version
        new_version, change_type, decided = doc_version.for_new_file(
            current_ver, document.file_path, document.file_name, file_path, file.filename,
            old_content=document.content, title=document.title)
        number, pending = doc_version.target(db, document, change_type)
        if pending is not None:          # not published yet: the new file goes into the one pending version
            doc_version.update_pending(pending, number, change_type, title=document.title,
                                       summary=change_summary or f"File updated: {file.filename}. {decided}", reason=change_reason,
                                       files={"file_name": file.filename, "file_path": file_path, "file_size": file_size, "file_type": file_ext})
            new_version = number
            document.current_version = new_version
        else:
            if current_row is None:         # an older document with no row for its number: what it held is kept first, as that version
                db.add(V(document_id=document_id, version_number=current_ver, change_type="baseline", title=document.title,
                         content=document.content, file_name=document.file_name, file_path=document.file_path, file_size=document.file_size,
                         file_type=document.file_type, change_summary="Original document, before it was changed", status="superseded",
                         created_by=current_user.id))
            elif not current_row.file_path and document.file_path:      # its file was put in place before its row held it
                current_row.file_name, current_row.file_path = document.file_name, document.file_path
                current_row.file_size, current_row.file_type = document.file_size, document.file_type
        
            existing_versions = db.query(GovernanceDocumentVersion).filter(
                GovernanceDocumentVersion.document_id == document_id,
                GovernanceDocumentVersion.status == "current"
            ).all()
            for v in existing_versions:
                v.status = "superseded"
        
            version = GovernanceDocumentVersion(
                document_id=document_id,
                version_number=new_version,
                change_type=change_type,
                title=document.title,
                content=document.content,
                file_name=file.filename,
                file_path=file_path,
                file_size=file_size,
                file_type=file_ext,
                change_summary=change_summary or f"File updated: {file.filename}. {decided}",
                change_reason=change_reason,
                status="current",
                created_by=current_user.id
            )
            db.add(version)
            document.current_version = new_version
    else:       # the same version with another file: the row of that version holds it (made when there is none)
        if current_row is None:
            db.query(V).filter(V.document_id == document_id, V.status == "current").update({"status": "superseded"})
            current_row = V(document_id=document_id, version_number=current_ver, change_type="major", title=document.title,
                            content=document.content, change_summary=change_summary or f"File uploaded: {file.filename}",
                            change_reason=change_reason, status="current", created_by=current_user.id)
            db.add(current_row)
        current_row.file_name, current_row.file_path, current_row.file_size, current_row.file_type = file.filename, file_path, file_size, file_ext
    
    document.file_name = file.filename
    document.file_path = file_path
    document.file_size = file_size
    document.file_type = file_ext
    document.updated_at = datetime.utcnow()
    # a new file is a new version: a reviewed document is reviewed again from the start, as every other new version is
    doc_lifecycle.changed_after_review(db, document, old_status, current_user.id,
                                       f"A new file was uploaded (version {document.current_version}), so it needs approving again")
    
    create_audit_log(
        db=db,
        document_id=document.id,
        tenant_id=document.tenant_id,
        user_id=current_user.id,
        action="file_uploaded",
        action_details=f"File uploaded: {file.filename} ({file_size} bytes)" + doc_lifecycle.outcome(old_status, document.status),
        field_changed="file_name",
        old_value=old_file_name,
        new_value=file.filename
    )
    
    # Log the action for review
    log_governance_action(
        db=db,
        tenant_id=document.tenant_id,
        action_type="document_file_uploaded",
        action_description=f"File uploaded to document: '{document.title}' - {file.filename}",
        entity_type="governance_document",
        action_user_id=current_user.id,
        entity_id=document.id,
        action_metadata={
            "document_code": document.document_code,
            "doc_type": document.doc_type,
            "file_name": file.filename,
            "file_size": file_size,
            "version": document.current_version
        }
    )
    
    db.commit()
    db.refresh(document)

    # Auto-run parsing after a file is attached (guarded + non-fatal). Skips
    # docs that are already parsed — re-parsing an existing doc stays manual.
    try:
        from .policy_parser import maybe_autoparse_document
        maybe_autoparse_document(
            db, _resolve_tenant_slug_for_autoparse(document.tenant_id), document.id, current_user.id
        )
    except Exception:
        logger.warning("auto-parse hook failed for doc %s", document.id, exc_info=True)

    return {
        "message": "File uploaded successfully",
        "document": serialize_document(document, db)
    }


@router.get("/{document_id}/download-file", dependencies=[Depends(permissions.require_doc_reader)])
def download_document_file(
    document_id: int,
    version_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Download the attached file for a governance document"""
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
    in_force = permissions.version_for(db, current_user, document)      # someone who reads the version in force: its file
    
    if version_id:
        version = db.query(GovernanceDocumentVersion).filter(
            GovernanceDocumentVersion.id == version_id,
            GovernanceDocumentVersion.document_id == document_id
        ).first()
        
        if not version or (in_force is not None and version.id > in_force.id):     # never a newer version than the one in force
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Version not found"
            )
        
        if not version.file_path or not os.path.exists(version.file_path):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="File not found for this version"
            )
        
        return FileResponse(
            path=version.file_path,
            filename=version.file_name or f"document_{document_id}_v{version.version_number}",
            media_type=ALLOWED_FILE_TYPES.get(version.file_type, "application/octet-stream")
        )
    src = in_force or document
    
    if not src.file_path or not os.path.exists(src.file_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No file attached to this document"
        )
    
    return FileResponse(
        path=src.file_path,
        filename=src.file_name or f"document_{document_id}",
        media_type=ALLOWED_FILE_TYPES.get(src.file_type, "application/octet-stream")
    )


@router.get("/{document_id}/export", dependencies=[Depends(permissions.require_doc_reader)])
def export_document(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Download any governance document.

    If the document has an uploaded file on disk, the native file is served
    exactly as ``download_document_file`` does. Otherwise the document's
    markdown ``content`` is rendered to a PDF (via the shared artifact
    exporter) so that content-only / AI-drafted documents are downloadable
    too.
    """
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

    src = permissions.version_for(db, current_user, document) or document      # the version in force, for who reads that one
    # Prefer the native uploaded file when present on disk.
    if src.file_path and os.path.exists(src.file_path):
        return FileResponse(
            path=src.file_path,
            filename=src.file_name or f"document_{document_id}",
            media_type=ALLOWED_FILE_TYPES.get(src.file_type, "application/octet-stream")
        )

    # Content-only document: render its markdown content to a PDF.
    if src.content:
        from grc.routers._artifact_export import build_export  # local import: heavy libs
        title = document.title or "document"
        data, media_type, ext = build_export("pdf", title=title, content=src.content or "")
        safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", title.strip())[:80] or "document"
        return StreamingResponse(
            io.BytesIO(data),
            media_type=media_type,
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.{ext}"'}
        )

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Document has no file or content to export"
    )


READ_DETAILS_MAX_BYTES = 50 * 1024 * 1024


@router.post("/read-details")
def read_document_details(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """What a file says about the document it holds (title, type, description, classification, owner, department, review cycle,
    dates), to fill in the form before it is uploaded. Saves nothing: the file is read from a temporary copy that is deleted.
    Not async: the reading (and Comply Agent, up to doc_details.AI_SECONDS) runs on a worker thread, not the event loop."""
    import tempfile
    from ..doc_details import read

    data = file.file.read(READ_DETAILS_MAX_BYTES + 1)
    if len(data) > READ_DETAILS_MAX_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File size must be less than 50MB")
    name = os.path.basename(file.filename or "document")
    fd, path = tempfile.mkstemp(suffix=os.path.splitext(name)[1].lower()[:10])
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        return read(path, name, db)
    finally:
        try:
            os.unlink(path)
        except OSError:
            logger.warning("could not delete the temporary copy %s", path)


@router.post("/upload-with-file", status_code=status.HTTP_201_CREATED)
async def create_document_with_file(
    file: UploadFile = File(...),
    title: str = Form(...),
    doc_type: str = Form(...),
    description: Optional[str] = Form(None),
    document_code: Optional[str] = Form(None),
    classification: str = Form("internal"),
    owner_id: Optional[int] = Form(None),
    tenant_id: Optional[int] = Form(None),
    # JSON-encoded list of UploadedFramework ids the doc should link to.
    # Sent as a JSON string because List[int] in multipart Form isn't
    # consistently supported across FastAPI versions and front-end
    # FormData encoders. Parsed below; safe if absent or malformed.
    framework_ids: Optional[str] = Form(None),
    # The frameworks it is audited against, the same JSON form; defaults to the
    # linked ones, as creating a document does.
    applicable_framework_ids: Optional[str] = Form(None),
    department_id: Optional[int] = Form(None),
    review_cycle_months: int = Form(12),
    effective_date: Optional[datetime] = Form(None),
    next_review_date: Optional[datetime] = Form(None),          # effective date (or today) + the review cycle when not given
    parent_document_id: Optional[int] = Form(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Create a new governance document with an attached file"""
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
    else:
        tenant_id = get_user_primary_tenant(current_user, db)
        if not tenant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User is not assigned to any tenant"
            )
    
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No file provided"
        )
    
    file_ext = file.filename.lower().split('.')[-1] if '.' in file.filename else ''
    if file_ext not in ALLOWED_FILE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Only PDF, Word (.doc, .docx), and Excel (.xls, .xlsx) files are supported"
        )
    if parent_document_id and not db.query(GovernanceDocument).filter(
            GovernanceDocument.id == parent_document_id, GovernanceDocument.tenant_id == tenant_id).first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent document not found")
    from ..doc_details import check_details

    try:
        check_details(db, owner_id=owner_id, department_id=department_id, review_cycle_months=review_cycle_months)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    
    unique_id = str(uuid.uuid4())
    safe_filename = f"{unique_id}_{os.path.basename(file.filename.replace(chr(92), '/'))}"     # no folders from the upload's name
    file_path = os.path.join(GOVERNANCE_UPLOAD_DIR, safe_filename)
    
    content = await file.read()
    file_size = len(content)
    
    with open(file_path, "wb") as f:
        f.write(content)
    
    # Decode framework_ids JSON if the client supplied any. Tolerant of
    # missing / malformed input — the upload still succeeds, the doc
    # just isn't framework-tagged in that case.
    def _ids(value: Optional[str]) -> List[int]:
        try:
            raw = json.loads(value) if value else []
            return [int(v) for v in raw if v is not None] if isinstance(raw, list) else []
        except (json.JSONDecodeError, TypeError, ValueError):
            return []

    parsed_framework_ids = _ids(framework_ids)
    parsed_applicable_ids = _ids(applicable_framework_ids) or parsed_framework_ids
    from ..doc_version import detect, first_summary
    start_version, found_in = detect(file_path, file.filename)

    document = GovernanceDocument(
        tenant_id=tenant_id,
        title=title,
        description=description,
        document_code=document_code,
        doc_type=doc_type,
        classification=classification,
        owner_id=owner_id or current_user.id,
        author_id=current_user.id,
        department_id=department_id,
        parent_document_id=parent_document_id,
        review_cycle_months=review_cycle_months,
        effective_date=effective_date,
        next_review_date=next_review_date,
        file_name=file.filename,
        file_path=file_path,
        file_size=file_size,
        file_type=file_ext,
        status="draft",
        current_version=start_version,
        framework_ids=parsed_framework_ids,
        applicable_framework_ids=parsed_applicable_ids,
    )
    from ..doc_details import schedule
    schedule(document)
    db.add(document)
    db.flush()

    version = GovernanceDocumentVersion(
        document_id=document.id,
        version_number=start_version,
        change_type="major",
        title=title,
        file_name=file.filename,
        file_path=file_path,
        file_size=file_size,
        file_type=file_ext,
        change_summary=first_summary(start_version, found_in),
        status="current",
        created_by=current_user.id
    )
    db.add(version)
    
    create_audit_log(
        db=db,
        document_id=document.id,
        tenant_id=tenant_id,
        user_id=current_user.id,
        action="created",
        action_details=f"Document created with file: {file.filename}"
    )
    
    db.commit()
    
    # Log the action for review
    log_governance_action(
        db=db,
        tenant_id=tenant_id,
        action_type="document_uploaded",
        action_description=f"Governance document uploaded: '{document.title}' ({document.doc_type}) - File: {file.filename}",
        entity_type="governance_document",
        action_user_id=current_user.id,
        entity_id=document.id,
        action_metadata={
            "document_code": document.document_code,
            "doc_type": document.doc_type,
            "file_name": file.filename,
            "file_size": file_size,
            "classification": document.classification
        }
    )
    db.commit()

    db.refresh(document)

    # Auto-run parsing on upload-create so the extracted policy statements are
    # ready without a manual "Run parsing" click (guarded + non-fatal).
    try:
        from .policy_parser import maybe_autoparse_document
        maybe_autoparse_document(
            db, _resolve_tenant_slug_for_autoparse(tenant_id), document.id, current_user.id
        )
    except Exception:
        logger.warning("auto-parse hook failed for doc %s", document.id, exc_info=True)

    return {
        "message": "Document created successfully",
        "document": serialize_document(document, db)
    }


class PolicyAIDraftRequest(BaseModel):
    doc_type: str
    title: str
    framework_ids: Optional[List[int]] = None
    regulatory_scope: Optional[List[str]] = None
    description: Optional[str] = None
    include_sections: Optional[List[str]] = None
    parent_document_id: Optional[int] = None


class PolicySuggestRequest(BaseModel):
    framework_ids: List[int]
    doc_type: Optional[str] = None


def infer_governance_domain(control: ParsedFrameworkControl) -> str:
    explicit_domain = (control.domain or control.category or "").strip()
    if explicit_domain:
        return explicit_domain

    haystack = " ".join(
        filter(
            None,
            [
                control.title,
                control.description,
                control.full_text,
                control.parent_section,
            ],
        )
    ).lower()

    best_domain = "General Governance"
    best_score = 0
    for domain, keywords in GOVERNANCE_DOMAIN_KEYWORDS.items():
        score = sum(1 for keyword in keywords if keyword in haystack)
        if score > best_score:
            best_domain = domain
            best_score = score

    return best_domain


def build_framework_control_context(
    frameworks: List[UploadedFramework],
    db: Session,
    per_framework_limit: int = 80,
    representative_controls_per_domain: int = 4,
) -> Tuple[str, List[dict], List[str]]:
    context_parts: List[str] = []
    framework_alignment: List[dict] = []
    all_domains: List[str] = []

    for framework in frameworks:
        controls = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == framework.id
        ).order_by(
            ParsedFrameworkControl.priority.desc(),
            ParsedFrameworkControl.original_reference.asc(),
            ParsedFrameworkControl.control_id.asc(),
        ).limit(per_framework_limit).all()

        if not controls:
            continue

        grouped_controls: Dict[str, dict] = {}
        framework_refs: List[str] = []

        for control in controls:
            reference = control.original_reference or control.control_id
            domain = infer_governance_domain(control)
            bucket = grouped_controls.setdefault(domain, {"count": 0, "samples": []})
            bucket["count"] += 1
            if len(bucket["samples"]) < representative_controls_per_domain:
                bucket["samples"].append({
                    "reference": reference,
                    "title": control.title,
                    "description": (control.description or control.full_text or "")[:240],
                })
            if len(framework_refs) < 15:
                framework_refs.append(reference)

        sorted_domains = sorted(
            grouped_controls.items(),
            key=lambda item: (-item[1]["count"], item[0]),
        )
        top_domains = [domain for domain, _ in sorted_domains[:8]]
        all_domains.extend(top_domains)

        context_parts.append(f"Framework: {framework.name}")
        context_parts.append(f"Total Controls Reviewed: {len(controls)}")
        context_parts.append("Primary Governance Domains and Representative Controls:")
        for domain, bucket in sorted_domains[:8]:
            context_parts.append(f"- {domain} ({bucket['count']} controls)")
            for sample in bucket["samples"]:
                sample_line = f"  - {sample['reference']}: {sample['title']}"
                if sample["description"]:
                    sample_line += f" | {sample['description']}"
                context_parts.append(sample_line)
        context_parts.append("")

        framework_alignment.append({
            "framework": framework.name,
            "controls": framework_refs,
            "domains": top_domains,
        })

    ordered_domains = list(dict.fromkeys(all_domains))
    return "\n".join(context_parts).strip(), framework_alignment, ordered_domains


def get_document_depth_instruction(doc_type: str) -> dict:
    if doc_type == "procedure":
        return {
            "minimum_words": 2200,
            "template_name": "ISO-aligned procedure",
            "section_outline": [
                "1. Document Control",
                "2. Purpose",
                "3. Scope and Applicability",
                "4. Normative References and Related Documents",
                "5. Terms and Definitions",
                "6. Roles and Responsibilities",
                "7. Preconditions and Trigger Events",
                "8. Procedure Steps",
                "9. Records and Evidence Retention",
                "10. Monitoring, Exceptions, and Escalation",
                "11. Review and Revision History"
            ],
            "statement_style": "Break activities into ordered steps, sub-steps, decision points, required records, and escalation rules."
        }

    if doc_type == "standard":
        return {
            "minimum_words": 1800,
            "template_name": "ISO-aligned standard",
            "section_outline": [
                "1. Document Control",
                "2. Purpose",
                "3. Scope and Applicability",
                "4. Normative References",
                "5. Control Objectives",
                "6. Mandatory Standard Requirements",
                "7. Roles and Responsibilities",
                "8. Measurement and Exceptions",
                "9. Enforcement",
                "10. Review and Revision History"
            ],
            "statement_style": "Write mandatory requirements as precise atomic statements with numbered sub-clauses."
        }

    if doc_type == "guideline":
        return {
            "minimum_words": 1600,
            "template_name": "ISO-aligned guideline",
            "section_outline": [
                "1. Document Control",
                "2. Purpose",
                "3. Scope and Intended Audience",
                "4. Guidance Principles",
                "5. Recommended Practices",
                "6. Roles and Responsibilities",
                "7. Examples and Implementation Notes",
                "8. Related Standards and Procedures",
                "9. Review and Revision History"
            ],
            "statement_style": "Provide practical guidance with clear recommendations, examples, and implementation notes."
        }

    return {
        "minimum_words": 1800,
        "template_name": "ISO-aligned policy",
        "section_outline": [
            "1. Document Control",
            "2. Purpose",
            "3. Scope and Applicability",
            "4. Normative References",
            "5. Terms and Definitions",
            "6. Policy Objectives",
            "7. Policy Statements",
            "8. Roles and Responsibilities",
            "9. Governance, Monitoring, and Exceptions",
            "10. Compliance and Enforcement",
            "11. Review and Revision History"
        ],
        "statement_style": "Write policy requirements as atomic statements, each addressing a single obligation, and decompose them into numbered clauses where needed."
    }


def _normalize_doc_title(s: str) -> str:
    """Normalize a document title for fuzzy duplicate detection.

    Lowercase, drop everything that isn't a letter or digit, collapse runs.
    "ISO 27001 Information Security Policy v2.0" → "iso27001informationsecuritypolicy".
    Used as the first-pass exact-match guard before the semantic dedup AI call.
    """
    return "".join(ch for ch in (s or "").lower() if ch.isalnum())


# Words to strip when computing a token-based similarity score. They appear
# in nearly every governance-document title and would inflate match scores
# for unrelated titles otherwise.
_TITLE_STOPWORDS = {
    "the", "and", "of", "for", "on", "in", "to", "a", "an", "is", "or", "by",
    "with", "from", "as", "at", "policy", "policies", "procedure", "procedures",
    "standard", "standards", "guideline", "guidelines", "charter", "framework",
    "document", "documents", "v", "version", "iso", "nist", "soc", "pci", "dss",
    "hipaa", "gdpr", "sama", "nca", "sbp",
}

# Common security/governance abbreviations expanded so a title using the
# acronym is still tokenized in a way that overlaps with the spelled-out
# form. e.g. "ISMS Policy" → tokens {information, security, management,
# system}; "Information Security Management System" → same set.
_TITLE_SYNONYMS = {
    "isms": "information security management system",
    "infosec": "information security",
    "infosecurity": "information security",
    "bcp": "business continuity plan",
    "bcm": "business continuity management",
    "drp": "disaster recovery plan",
    "dr": "disaster recovery",
    "iam": "identity access management",
    "mfa": "multi factor authentication",
    "2fa": "two factor authentication",
    "ir": "incident response",
    "irm": "incident response management",
    "ac": "access control",
    "acm": "access control management",
    "cm": "change management",
    "vm": "vulnerability management",
    "tprm": "third party risk management",
    "vrm": "vendor risk management",
    "dlp": "data loss prevention",
    "byod": "bring your own device",
    "soc": "security operations centre",
    "soa": "statement of applicability",
    "ai": "artificial intelligence",
    "rmp": "risk management plan",
    "ssp": "system security plan",
    "appsec": "application security",
    "siem": "security information event management",
}


def _title_token_set(title: str) -> set:
    """Tokenize a title for similarity comparison: lowercase, expand synonyms,
    drop stopwords and short tokens. Returns a set of meaningful words.

    "ISMS Policy v2" → {information, security, management, system}
    "Information Security Management System Policy" → {information, security, management, system}
    """
    if not title:
        return set()
    raw = title.lower()
    # Replace non-alphanumerics with spaces, then split.
    cleaned = "".join(ch if ch.isalnum() else " " for ch in raw)
    tokens = []
    for tok in cleaned.split():
        # Expand abbreviations into their constituent words.
        expansion = _TITLE_SYNONYMS.get(tok)
        if expansion:
            tokens.extend(expansion.split())
        else:
            tokens.append(tok)
    # Drop stopwords + 1-char numerics like "v2" leftover digits.
    return {
        t for t in tokens
        if t not in _TITLE_STOPWORDS and len(t) > 1 and not t.isdigit()
    }


def _title_similarity(a: str, b: str) -> float:
    """Jaccard similarity over the tokenized representations. 1.0 = identical
    meaningful tokens, 0.0 = nothing in common."""
    ta, tb = _title_token_set(a), _title_token_set(b)
    if not ta or not tb:
        return 0.0
    inter = ta & tb
    union = ta | tb
    return len(inter) / len(union) if union else 0.0


# When a suggestion's tokenized similarity to ANY existing title is at or
# above this threshold, treat it as a duplicate without calling the AI.
# Conservative threshold: this stage only catches *very* close matches
# (>= 85% Jaccard overlap on meaningful tokens). The semantic GPT stage
# downstream catches the looser cases with full context.
#
# Why so conservative: at 0.5 we hit false positives like
# "Information Security Management Policy" vs "Supplier Security
# Management Policy" — 2 of 4 shared tokens (security, management) =
# 0.5 = exact threshold hit, but they're semantically different policies
# (internal IT security vs third-party/vendor security). Raising to 0.85
# keeps obvious cases (e.g. identical token sets after synonym expansion)
# while routing genuine gray-area calls to the semantic stage that can
# reason about scope.
_TITLE_SIMILARITY_HARD_DUP = 0.85


# Document statuses that count as "the org already has this on the books".
# Drafts and pending-review docs count too, because the user is actively
# building them — re-suggesting them would be noise. Archived/expired/exception
# rows are intentionally excluded so a retired policy gets re-recommended.
_EXISTING_DOC_STATUSES = {
    "draft", "pending_review", "pending_approval", "approved", "published"
}


def _semantic_dedup_against_existing(
    client: OpenAI,
    suggestions: List[Dict],
    existing_documents: List[Dict],
) -> Tuple[set, List[Dict]]:
    """Ask GPT-4o which of the new suggestions are substantially equivalent
    to a document the tenant already has.

    Returns (set_of_indices_to_drop, list_of_match_dicts). Each match dict
    has shape {suggested_title, matched_existing_id, matched_existing_title,
    reason}. Failure-mode is "drop nothing" — we never want a flaky AI call
    to silently remove legitimate suggestions, so any error returns empty
    results.
    """
    if not suggestions or not existing_documents:
        return set(), []

    suggestion_payload = [
        {
            "i": idx,
            "title": str(s.get("title") or "").strip(),
            "doc_type": str(s.get("doc_type") or "").strip(),
            "description": str(s.get("description") or "")[:300],
        }
        for idx, s in enumerate(suggestions)
    ]
    existing_payload = [
        {
            "title": d.get("title") or "",
            "doc_type": d.get("doc_type") or "",
        }
        for d in existing_documents
    ]

    system_msg = (
        "You are a governance librarian. You output ONLY strict JSON. Your job "
        "is to flag a NEW suggestion as a duplicate ONLY when it covers the SAME "
        "SPECIFIC topic as an existing document (an alias, rename, or reordering "
        "of the same subject). A complete governance library deliberately "
        "contains many distinct sub-domain policies, standards, and procedures, "
        "so DO NOT treat a broad parent policy (e.g. 'Information Security "
        "Policy') as covering its sub-topics — distinct documents like 'Access "
        "Control Policy' or 'Encryption Policy' are NOT duplicates of it. When "
        "in doubt, KEEP the suggestion (false-negative is far better than wiping "
        "out the framework's policy set)."
    )
    user_msg = f"""Two lists below: NEW (suggested documents to potentially add) and EXISTING (documents the organisation already maintains).

For each NEW item, mark it as a duplicate ONLY when it is the SAME SPECIFIC document as an EXISTING item (an alias / rename / reordering of the same subject). Otherwise KEEP it.

DUPLICATE (drop) ONLY when ANY of these is true:
- Same subject, different abbreviation: "Information Security Policy" vs "InfoSec Policy" vs "ISMS Policy" vs "ISMS Manual"
- Same subject, reordered words: "Access Control Policy" vs "Policy on Access Control" vs "User Access Management Policy"
- Same subject, different doc_type label: existing "Access Control Procedure" vs new "Access Control Policy" — same scope, drop
- Renamed equivalent: "Disaster Recovery Plan" vs "Business Continuity Plan" when only one of the two would normally be maintained
- Singular/plural, hyphen, casing, version variants: "Risk Management Policy" vs "Risk Management Policies"
- Localized variants: "Data Protection Policy" vs "Privacy Policy" vs "GDPR Policy" — same primary topic
- Standards covering same domain: existing "Cryptographic Controls Standard" vs new "Encryption Standard" — same topic

NOT duplicate (KEEP — this is the default):
- A NEW sub-domain document when only a BROAD parent exists: existing "Information Security Policy" vs new "Access Control Policy" / "Encryption Policy" / "Acceptable Use Policy" / "Password Policy" → KEEP all of them. A parent policy does NOT make its sub-domain policies duplicates; the org needs the distinct documents.
- Genuinely distinct primary topics: "Acceptable Use Policy" vs "Vendor Risk Management Policy"
- Materially narrower OPERATIONAL document with concrete procedure not in the parent: existing "Information Security Policy" vs new "Vulnerability Scanning Procedure" → keep
- Different lifecycle phase: existing "Incident Response Policy" vs new "Incident Response Tabletop Exercise Procedure" → keep

Return STRICT JSON ONLY:
{{"duplicates": [{{"i": <int index from NEW>, "matches_existing_title": "<existing title>", "reason": "<one short sentence>"}}]}}

Only include entries that ARE duplicates. Use the integer "i" from NEW exactly as given.

EXISTING:
{json.dumps(existing_payload, ensure_ascii=False)}

NEW:
{json.dumps(suggestion_payload, ensure_ascii=False)}
"""

    try:
        response = client.chat.completions.create(
            model=get_openai_model(),
            response_format={"type": "json_object"},
            temperature=0.0,
            max_tokens=2000,
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg},
            ],
        )
        raw = response.choices[0].message.content or "{}"
        parsed = json.loads(raw)
        # Build a title → existing-doc lookup so we can attach the matched
        # existing record to each drop. Used by callers to render the skip
        # alongside the doc that justified it.
        existing_by_title = {(d.get("title") or "").strip().lower(): d for d in existing_documents}
        dropped_indices: set = set()
        match_records: List[Dict] = []
        for entry in (parsed.get("duplicates") or []):
            try:
                idx = int(entry.get("i"))
            except (TypeError, ValueError):
                continue
            if not (0 <= idx < len(suggestions)):
                continue
            suggested_title = (suggestions[idx].get("title") or "").strip()
            matched_title = (entry.get("matches_existing_title") or "").strip()
            reason_text = (entry.get("reason") or "").strip()[:200]
            matched_doc = existing_by_title.get(matched_title.lower()) if matched_title else None
            # Only emit a skip when we can pin it to a real existing doc.
            # If the AI returned a duplicate flag but the matched title
            # doesn't resolve to one of EXISTING, we drop the entry — the
            # user explicitly asked us not to show inaccurate skips.
            if not matched_doc or not suggested_title:
                continue
            dropped_indices.add(idx)
            match_records.append({
                "suggested_title": suggested_title,
                "matched_existing_id": matched_doc.get("id"),
                "matched_existing_title": matched_doc.get("title"),
                "matched_existing_doc_type": matched_doc.get("doc_type"),
                "matched_existing_status": matched_doc.get("status"),
                "reason": reason_text or "Semantic match against an existing document.",
                "match_type": "semantic",
            })
        return dropped_indices, match_records
    except Exception:
        # Defensive: never let a flaky dedup call hide real suggestions.
        return set(), []


def _fetch_existing_documents_for_frameworks(
    framework_ids: List[int],
    tenant_ids: List[int],
    requested_doc_type: Optional[str],
    db: Session,
) -> List[Dict]:
    """Return active documents in the tenant's library, used as the
    deduplication pool for AI policy suggestions.

    Important: we intentionally do NOT filter by framework_ids here. Many
    tenants upload policies/procedures without tagging them to a specific
    framework, so a framework-scoped query would miss "Information Security
    Policy" sitting untagged in the library and the AI would happily
    re-suggest it. Dedup against the WHOLE library; the cost is small (a
    tenant rarely has more than a few hundred docs) and the false-negative
    cost (re-suggesting a doc that already exists) is what the user is
    complaining about.

    Documents tagged to one of the requested frameworks are surfaced first
    in the response (so the UI's "Already covered" panel still shows the
    framework-relevant ones at the top).
    """
    if not tenant_ids:
        return []

    query = db.query(GovernanceDocument).filter(
        GovernanceDocument.tenant_id.in_(tenant_ids),
    )
    if requested_doc_type:
        query = query.filter(GovernanceDocument.doc_type == requested_doc_type)

    rows = query.all()
    fid_set = set(framework_ids or [])
    out: List[Dict] = []
    for d in rows:
        if (d.status or "").lower() not in _EXISTING_DOC_STATUSES:
            continue
        # Best-effort normalize JSON framework_ids. Tolerant of stringy ids
        # stored in older rows.
        normalized: set = set()
        for v in (d.framework_ids or []):
            try:
                normalized.add(int(v))
            except (TypeError, ValueError):
                continue
        # Whether this doc is tagged to one of the requested frameworks
        # (used purely for ranking — it's still in the dedup pool either way).
        is_framework_tagged = bool(fid_set & normalized) if fid_set else False
        out.append({
            "id": d.id,
            "title": d.title,
            "doc_type": d.doc_type,
            "status": d.status,
            "framework_ids": list(normalized),
            "is_framework_tagged": is_framework_tagged,
        })
    # Surface framework-tagged docs first, then everything else. Stable order
    # within each group.
    out.sort(key=lambda d: (0 if d["is_framework_tagged"] else 1, d["title"] or ""))
    return out


@router.post("/ai-suggest-policies")
def suggest_policies_for_framework(
    request: PolicySuggestRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Given framework IDs, use AI to suggest what policies, procedures, and standards can be developed.

    The suggestion is gap-aware: existing tenant documents linked to the same
    framework(s) are listed in the prompt as "already covered", and any AI
    suggestion whose normalized title collides with an existing title is
    filtered out before the response is returned.
    """
    logger.info("[ai-suggest] step1 request: framework_ids=%s doc_type=%r user_id=%s",
                request.framework_ids, request.doc_type, getattr(current_user, "id", None))
    if not request.framework_ids:
        raise HTTPException(status_code=400, detail="At least one framework must be selected")

    frameworks = db.query(UploadedFramework).filter(
        UploadedFramework.id.in_(request.framework_ids)
    ).all()
    logger.info("[ai-suggest] step2 frameworks resolved: requested=%s found=%d names=%s",
                request.framework_ids, len(frameworks), [f.name for f in frameworks])

    if not frameworks:
        raise HTTPException(status_code=404, detail="No frameworks found")

    controls_summary, framework_alignment, domain_context = build_framework_control_context(frameworks, db)
    logger.info("[ai-suggest] step3 control context: controls_summary_len=%d domains=%s",
                len(controls_summary or ""), domain_context)

    if not AI_INTEGRATIONS_OPENAI_API_KEY or not AI_INTEGRATIONS_OPENAI_BASE_URL:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OpenAI integration not configured"
        )
    
    client = OpenAI(
        api_key=AI_INTEGRATIONS_OPENAI_API_KEY,
        base_url=AI_INTEGRATIONS_OPENAI_BASE_URL
    )
    
    framework_names = ", ".join([f.name for f in frameworks])
    requested_doc_type = (request.doc_type or "").strip().lower() or None
    allowed_doc_types = {"policy", "standard", "procedure", "guideline", "charter", "framework"}
    if requested_doc_type and requested_doc_type not in allowed_doc_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported doc_type '{request.doc_type}'. Allowed values: {', '.join(sorted(allowed_doc_types))}"
        )

    # Pull the documents the tenant already has covering these framework(s)
    # so we can both (a) tell the model not to re-suggest them and (b) hard
    # filter any near-duplicates the model emits anyway.
    user_tenant_ids = get_user_tenants(current_user, db)
    existing_documents = _fetch_existing_documents_for_frameworks(
        request.framework_ids, user_tenant_ids, requested_doc_type, db
    )
    logger.info("[ai-suggest] step4 existing docs: requested_doc_type=%r tenant_ids=%s existing=%d titles=%s",
                requested_doc_type, user_tenant_ids, len(existing_documents),
                [d.get("title") for d in existing_documents][:20])
    existing_normalized_titles = {
        _normalize_doc_title(d["title"]) for d in existing_documents if d.get("title")
    }
    existing_documents_section = ""
    if existing_documents:
        # Compact representation — title + type is enough to dedupe against.
        # Group by doc_type so the prompt reads cleanly even with 200+ rows.
        grouped: Dict[str, List[str]] = {}
        for d in existing_documents:
            grouped.setdefault(d.get("doc_type") or "document", []).append(d["title"])
        lines = []
        for dt, titles in sorted(grouped.items()):
            lines.append(f"- {dt}s ({len(titles)}): " + "; ".join(sorted(set(titles))))
        existing_documents_section = (
            "\n\nDOCUMENTS THE ORG ALREADY HAS (do NOT re-suggest these or close paraphrases):\n"
            + "\n".join(lines)
        )

    doc_type_instruction = (
        f"Suggest only {requested_doc_type} documents. Do not include any other document types."
        if requested_doc_type
        else "Cover policy, standard, procedure, and guideline needs systematically."
    )
    suggestion_count_instruction = (
        "Provide 12-20 suggestions, ordered by priority (high first)."
        if requested_doc_type
        else "Provide 18-30 suggestions covering policies, procedures, standards, and guidelines. Order by priority (high first) and ensure the list covers the major domains implied by the controls. The output must be domain-balanced rather than over-indexed on generic information security titles."
    )

    prompt = f"""You are an expert governance and compliance consultant. Based on the following regulatory framework controls, suggest the governance documents an organization should create to achieve domain-specific compliance coverage.

{controls_summary}{existing_documents_section}

Analysis requirements:
- Cluster the controls into governance domains before suggesting documents.
- Suggest documents only when they are justified by the control themes.
- DO NOT suggest a document that is already on the "DOCUMENTS THE ORG ALREADY HAS" list above. Skip it AND skip close paraphrases (e.g. if "Information Security Policy" exists, do not suggest "ISMS Policy" or "InfoSec Policy"; if "Access Control Policy" exists, do not suggest "User Access Management Policy"). Treat the existing list as the canonical coverage for those topics — only propose documents that fill genuine gaps.
- Prefer specific domain-aware titles over generic titles.
- {doc_type_instruction}
- Avoid duplicate or overlapping suggestions unless one is clearly a parent policy and another is a detailed procedure.
- Keep the suggested document titles general and reusable. Do not make them company-specific.
- Make procedures and standards domain-specific and operationally meaningful, not generic supporting documents.
- Where applicable, distinguish parent policy documents from subordinate standards, procedures, or guidelines.
- Cover these major inferred domains: {', '.join(domain_context) if domain_context else 'Use the control themes provided.'}

For each suggestion, provide ONLY these fields — keep it concise so the list returns fast:
- doc_type: the document type
- title: a clear, professional, reusable title
- description: ONE short sentence (max ~25 words) on what the document covers — do NOT write a paragraph
- priority: high, medium, or low based on regulatory importance
- relevant_controls: up to 4 specific control references from the framework

Do NOT include key sections, rationale, domain, or any other fields — they are not needed and slow the response.

Return a compact JSON object with EXACTLY this structure:
{{
  "framework_names": "{framework_names}",
  "suggestions": [
    {{
      "doc_type": "policy",
      "title": "Information Security Policy",
      "description": "Defines objectives, principles, and responsibilities for protecting information assets.",
      "priority": "high",
      "relevant_controls": ["A.5.1", "A.5.2"]
    }}
  ],
  "total_suggestions": 0
}}

{suggestion_count_instruction}
"""

    try:
        response = client.chat.completions.create(
            model=get_openai_model(),
            messages=[
                {"role": "system", "content": "You are an expert governance and compliance consultant. Always respond with valid JSON and prioritize domain accuracy, clause coverage, and non-generic titles."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_completion_tokens=5000
        )

        _finish = response.choices[0].finish_reason
        result_text = response.choices[0].message.content or "{}"
        logger.info("[ai-suggest] step5 AI call: model=%s finish_reason=%s content_len=%d",
                    get_openai_model(), _finish, len(result_text))
        result = json.loads(result_text)
        if isinstance(result, dict) and isinstance(result.get("suggestions"), list):
            _raw_count = len(result.get("suggestions", []))
            _raw_doctypes = sorted({str(s.get("doc_type", "")).strip().lower() for s in result.get("suggestions", [])})
            if requested_doc_type:
                result["suggestions"] = [
                    suggestion
                    for suggestion in result.get("suggestions", [])
                    if str(suggestion.get("doc_type", "")).strip().lower() == requested_doc_type
                ]
            logger.info("[ai-suggest] step6 parsed: raw_suggestions=%d raw_doc_types=%s after_doc_type_filter(%r)=%d",
                        _raw_count, _raw_doctypes, requested_doc_type, len(result.get("suggestions", [])))

            raw_suggestions = result.get("suggestions", [])

            # Three-stage dedup pipeline against the tenant's existing
            # documents:
            #  1. Exact normalized-title match — covers casing/punctuation/
            #     version-suffix variants. Free, cheap.
            #  2. Token-set Jaccard with synonym expansion — covers cases
            #     like "ISMS Policy" ≈ "Information Security Policy" and
            #     "InfoSec Policy" ≈ "Information Security Policy". Free.
            #  3. Semantic AI dedup — for the remaining suggestions, ask
            #     GPT-4o whether each is substantially equivalent to any
            #     existing document. Catches the long-tail cases the
            #     heuristics miss without AI hallucinations.
            existing_titles_for_compare = [d["title"] for d in existing_documents if d.get("title")]
            existing_norm_lookup = {
                _normalize_doc_title(d["title"]): d for d in existing_documents if d.get("title")
            }

            # Every entry in skipped_matches carries the *matched existing
            # doc* so the UI never has to guess which platform document
            # justified the skip. If no real existing doc can be pinned to
            # a suggestion, that suggestion is NOT recorded as a skip
            # (we'd rather pass through to the AI list than show an
            # inaccurate "we skipped X" claim — which was the prior bug).
            after_stage1: List[Dict] = []
            skipped_matches: List[Dict] = []

            stage1_count = 0
            for suggestion in raw_suggestions:
                title = str(suggestion.get("title") or "").strip()
                norm = _normalize_doc_title(title)
                matched = existing_norm_lookup.get(norm) if norm else None
                if matched and title:
                    skipped_matches.append({
                        "suggested_title": title,
                        "matched_existing_id": matched.get("id"),
                        "matched_existing_title": matched.get("title"),
                        "matched_existing_doc_type": matched.get("doc_type"),
                        "matched_existing_status": matched.get("status"),
                        "reason": "Identical normalised title already exists.",
                        "match_type": "exact_normalized",
                    })
                    stage1_count += 1
                    continue
                after_stage1.append(suggestion)

            stage2_count = 0
            after_stage2: List[Dict] = []
            for suggestion in after_stage1:
                title = str(suggestion.get("title") or "").strip()
                matched_doc = None
                best_score = 0.0
                for existing in existing_documents:
                    existing_title = existing.get("title") or ""
                    if not existing_title:
                        continue
                    score = _title_similarity(title, existing_title)
                    if score >= _TITLE_SIMILARITY_HARD_DUP and score > best_score:
                        best_score = score
                        matched_doc = existing
                if matched_doc and title:
                    skipped_matches.append({
                        "suggested_title": title,
                        "matched_existing_id": matched_doc.get("id"),
                        "matched_existing_title": matched_doc.get("title"),
                        "matched_existing_doc_type": matched_doc.get("doc_type"),
                        "matched_existing_status": matched_doc.get("status"),
                        "reason": f"Title shares {int(best_score * 100)}% of meaningful tokens with an existing document.",
                        "match_type": "token_overlap",
                    })
                    stage2_count += 1
                    continue
                after_stage2.append(suggestion)

            # Stage 3: semantic dedup pass. Skip the call entirely when
            # there's nothing to compare against or no remaining
            # suggestions — saves a round-trip and tokens.
            after_stage3 = after_stage2
            stage3_count = 0
            if existing_titles_for_compare and after_stage2:
                semantic_skip_ids, semantic_matches = _semantic_dedup_against_existing(
                    client=client,
                    suggestions=after_stage2,
                    existing_documents=existing_documents,
                )
                # Safety backstop: a single broad existing document (e.g. a generic
                # "Information Security Policy") must not be allowed to invalidate the
                # entire suggested policy set. One existing doc can legitimately match
                # only a handful of suggestions, so cap the semantic drops at a small
                # multiple of the existing-document count. If the model flags more than
                # that, treat the pass as over-aggressive and discard it (exact + token
                # title dedup already removed real duplicates). Prevents the "0 results"
                # failure where the AI collapses every sub-domain policy into a parent.
                semantic_cap = 3 * max(1, len(existing_documents))
                if semantic_skip_ids and len(semantic_skip_ids) > semantic_cap:
                    logger.warning(
                        "Semantic dedup over-aggressive: flagged %d/%d suggestions as "
                        "duplicates against %d existing doc(s); discarding the semantic "
                        "pass to avoid wiping the suggestion set.",
                        len(semantic_skip_ids), len(after_stage2), len(existing_documents),
                    )
                    semantic_skip_ids, semantic_matches = set(), []
                if semantic_skip_ids:
                    after_stage3 = [s for i, s in enumerate(after_stage2) if i not in semantic_skip_ids]
                    skipped_matches.extend(semantic_matches)
                    stage3_count = len(semantic_matches)

            result["suggestions"] = after_stage3
            result["total_suggestions"] = len(after_stage3)

            result["framework_alignment"] = framework_alignment
            result["domains_covered"] = domain_context
            # Surface the gap-awareness summary so the UI can show "12 already
            # covered" alongside "18 missing documents to create".
            result["already_covered"] = [
                {"id": d["id"], "title": d["title"], "doc_type": d["doc_type"], "status": d["status"]}
                for d in existing_documents
            ]
            result["already_covered_count"] = len(existing_documents)
            # New authoritative field: only contains skips that are pinned
            # to a real existing doc. The UI renders this directly.
            result["skipped_matches"] = skipped_matches
            # Legacy: titles only. Kept for any old client that still
            # reads it. Derived from skipped_matches so it can't drift.
            result["skipped_duplicate_titles"] = [m["suggested_title"] for m in skipped_matches]
            result["skipped_breakdown"] = {
                "exact_normalized": stage1_count,
                "token_overlap": stage2_count,
                "semantic": stage3_count,
            }
            logger.info("[ai-suggest] step7 dedup done: stage1_exact=%d stage2_token=%d stage3_semantic=%d "
                        "-> FINAL suggestions=%d (already_covered=%d)",
                        stage1_count, stage2_count, stage3_count, len(result["suggestions"]), len(existing_documents))
        else:
            logger.warning("[ai-suggest] step6b UNEXPECTED AI shape: type=%s keys=%s — returning as-is "
                           "(frontend will see 0 suggestions). Raw preview=%r",
                           type(result).__name__,
                           list(result.keys()) if isinstance(result, dict) else None,
                           result_text[:300])
        return result

    except json.JSONDecodeError as e:
        logger.error("[ai-suggest] FAILED json parse: %s | content preview=%r", e, (result_text[:300] if 'result_text' in dir() else None))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to parse AI response: {str(e)}"
        )
    except Exception as e:
        logger.exception("[ai-suggest] FAILED with exception: %s", e)
        error_msg = str(e)
        if "FREE_CLOUD_BUDGET_EXCEEDED" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="Cloud budget exceeded. Please upgrade your plan."
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI API error: {error_msg}"
        )


@router.post("/ai-draft")
def generate_policy_ai_draft(
    request: PolicyAIDraftRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Kick off an async drafting job.

    The synchronous pipeline took 30–90s for bank-grade output and was
    blowing past HTTP timeouts at the proxy. This endpoint now:

      1. Validates the request (parent doc, tenant context).
      2. Allocates a Redis-tracked job id.
      3. Dispatches `ai_drafting.generate_draft` to Celery.
      4. Returns `{job_id, status: 'queued'}` immediately.

    The frontend polls `GET /governance/documents/ai-draft-jobs/{job_id}`
    every second or two until `status == 'completed'|'failed'`.

    Falls back to in-process execution if Celery isn't reachable — the
    user-visible behaviour is identical, just slower without an opt-out.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tenant context for drafting",
        )

    # Validate parent document up-front so the user gets immediate
    # feedback rather than a failed job 60s later.
    parent_content = None
    if request.parent_document_id:
        user_tenants = get_user_tenants(current_user, db)
        parent = db.query(GovernanceDocument).filter(
            GovernanceDocument.id == request.parent_document_id,
            GovernanceDocument.tenant_id.in_(user_tenants),
        ).first()
        if not parent:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Parent document not found",
            )
        permissions.ensure_reader(db, current_user, parent)      # its text goes into the prompt: only for who may read it
        parent_content = (permissions.version_for(db, current_user, parent) or parent).content     # as the person reads it

    from ....tasks.ai_drafting import create_job

    request_payload = {
        "tenant_id": tenant_id,
        "user_id": current_user.id,
        "user_name": current_user.display_name or current_user.username,
        "doc_type": request.doc_type,
        "title": request.title,
        "description": request.description,
        "framework_ids": request.framework_ids or [],
        "parent_document_id": request.parent_document_id,
        "parent_content": parent_content,           # tasks/ai_drafting drafts from this text, not the parent's newest
        "include_sections": request.include_sections or [],
    }
    job_id = create_job(
        tenant_id=tenant_id,
        request_summary={
            "doc_type": request.doc_type,
            "title": request.title,
            "framework_ids": request.framework_ids or [],
        },
    )

    # Resolve tenant slug for the TenantTask first-arg contract.
    from ....db import MasterSession
    from ....models import Tenant as MasterTenant
    master = MasterSession()
    try:
        row = master.query(MasterTenant.slug).filter(MasterTenant.id == tenant_id).first()
        tenant_slug = row[0] if row else None
    finally:
        master.close()

    if not tenant_slug:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not resolve tenant slug for async drafting",
        )

    # Run in a daemon thread inside this FastAPI process. This avoids the
    # "broker accepts the task but no worker is consuming" failure mode
    # we hit when relying on Celery. The thread writes progress to Redis
    # the same way the Celery task would; the polling endpoint is
    # identical for both code paths.
    from ....tasks.ai_drafting import dispatch_in_thread
    dispatch_in_thread(tenant_slug, job_id, request_payload)
    return {
        "job_id": job_id,
        "status": "queued",
        "poll_url": f"/governance/documents/ai-draft-jobs/{job_id}",
    }


@router.get("/ai-draft-jobs/{job_id}")
def get_ai_draft_job(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Poll a running / completed drafting job.

    Returns the same payload `generate_draft` writes to Redis — frontend
    keeps polling until `status in ('completed', 'failed')` and then
    reads the `result` field for the generated document.
    """
    from ....tasks.ai_drafting import get_job

    tenant_id = get_user_primary_tenant(current_user, db)
    payload = get_job(job_id)
    if not payload:
        raise HTTPException(status_code=404, detail="Drafting job not found or expired")
    # Tenant scoping — never let a tenant peek at another tenant's job.
    if payload.get("tenant_id") and payload["tenant_id"] != tenant_id:
        raise HTTPException(status_code=404, detail="Drafting job not found or expired")
    return payload


class CompareWithDocumentBody(BaseModel):
    target_document_id: int


@router.post("/{document_id}/compare-with-document", dependencies=[Depends(permissions.require_doc_reader)])
def compare_with_document(
    document_id: int,
    body: CompareWithDocumentBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Side-by-side comparison of two governance documents owned by the tenant,
    with an optional AI gap analysis when OpenAI is configured.

    Mirrors the response shape of `/governance/nca-templates/{id}/compare` so
    the frontend compare modal can render either source identically.
    """
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="No tenant access")

    source = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants),
    ).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source document not found")

    target = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == body.target_document_id,
        GovernanceDocument.tenant_id.in_(user_tenants),
    ).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target document not found")

    permissions.ensure_reader(db, current_user, target)

    if source.id == target.id:
        raise HTTPException(status_code=400, detail="Cannot compare a document with itself")

    # each side as this person reads it: the version in force, for someone who may not see a newer one
    source_content = ((permissions.version_for(db, current_user, source) or source).content or "").strip() or "(empty document)"
    target_content = ((permissions.version_for(db, current_user, target) or target).content or "").strip() or "(empty document)"

    gap_analysis = None
    if AI_INTEGRATIONS_OPENAI_API_KEY:
        try:
            client_kwargs = {"api_key": AI_INTEGRATIONS_OPENAI_API_KEY}
            if AI_INTEGRATIONS_OPENAI_BASE_URL:
                client_kwargs["base_url"] = AI_INTEGRATIONS_OPENAI_BASE_URL
            client = OpenAI(**client_kwargs)

            prompt = f"""Compare two governance documents. Identify gaps, missing sections, redundancies, and areas where one is weaker or stronger than the other. Be concise and specific.

SOURCE DOCUMENT ({source.title} — {source.doc_type}):
{source_content[:8000]}

TARGET DOCUMENT ({target.title} — {target.doc_type}):
{target_content[:8000]}

Return strict JSON with keys:
- summary (2-3 sentences)
- missing_from_source (array of items present in target but absent in source)
- missing_from_target (array of items present in source but absent in target)
- alignment_score (0-100 integer, how well the two documents align in scope and content)
- recommended_additions (array of 3-7 specific clauses/sections the source should add to fully align with the target)
"""

            completion = client.chat.completions.create(
                model=get_openai_model(),
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                temperature=0.3,
            )
            gap_raw = completion.choices[0].message.content or "{}"
            gap_analysis = json.loads(gap_raw)
            # Map to the same shape the NCA-template compare endpoint returns
            if "missing_from_source" in gap_analysis:
                gap_analysis["missing_from_user_document"] = gap_analysis.pop("missing_from_source")
            if "missing_from_target" in gap_analysis:
                gap_analysis["present_in_user_only"] = gap_analysis.pop("missing_from_target")
        except Exception:
            import logging
            logging.getLogger(__name__).exception("Document-vs-document AI gap analysis failed")

    return {
        # 'template' key kept for frontend shape parity with the NCA compare endpoint
        "template": {
            "id": f"doc-{target.id}",
            "title": target.title,
            "category": target.doc_type or "Document",
            "content": target_content,
        },
        "document": {
            "id": source.id,
            "title": source.title,
            "doc_type": source.doc_type,
            "content": source_content,
        },
        "gap_analysis": gap_analysis,
    }


@router.get("/{document_id}/view-html", dependencies=[Depends(permissions.require_doc_reader)])
def get_document_html(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Convert uploaded document to HTML for in-platform viewing"""
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    src = permissions.version_for(db, current_user, document) or document      # the version in force, for who reads that one
    
    # If document has a file, always prefer file-based conversion (better HTML)
    if src.file_path and os.path.exists(src.file_path):
        html_content = ""
        file_type = src.file_type or ""
        
        try:
            if file_type == "pdf":
                from PyPDF2 import PdfReader
                reader = PdfReader(src.file_path)
                sections = []
                for i, page in enumerate(reader.pages):
                    page_text = page.extract_text()
                    if page_text:
                        lines = page_text.split('\n')
                        page_html_parts = []
                        for line in lines:
                            stripped = line.strip()
                            if not stripped:
                                continue
                            if stripped.isupper() and len(stripped) < 100:
                                page_html_parts.append(f'<h3 style="color: #e2e8f0; margin-top: 1.5rem; margin-bottom: 0.5rem; font-weight: 600;">{html.escape(stripped)}</h3>')
                            elif len(stripped) < 80 and not stripped.endswith('.') and not stripped.endswith(','):
                                page_html_parts.append(f'<h4 style="color: #cbd5e1; margin-top: 1rem; margin-bottom: 0.25rem; font-weight: 500;">{html.escape(stripped)}</h4>')
                            else:
                                page_html_parts.append(f'<p style="color: #94a3b8; margin-bottom: 0.5rem; line-height: 1.6;">{html.escape(stripped)}</p>')
                        
                        sections.append(f'<div class="page" style="margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 1px solid #334155;"><div style="color: #475569; font-size: 0.75rem; margin-bottom: 0.5rem;">Page {i+1}</div>{"".join(page_html_parts)}</div>')
                html_content = "".join(sections)
            
            elif file_type in ("docx", "doc"):
                from docx import Document as DocxDocument
                doc = DocxDocument(src.file_path)
                parts = []
                for para in doc.paragraphs:
                    text = para.text.strip()
                    if not text:
                        continue
                    style_name = (para.style.name or "").lower() if para.style else ""
                    if "heading 1" in style_name:
                        parts.append(f'<h1 style="color: #f1f5f9; margin-top: 2rem; margin-bottom: 0.75rem; font-size: 1.5rem; font-weight: 700;">{html.escape(text)}</h1>')
                    elif "heading 2" in style_name:
                        parts.append(f'<h2 style="color: #e2e8f0; margin-top: 1.5rem; margin-bottom: 0.5rem; font-size: 1.25rem; font-weight: 600;">{html.escape(text)}</h2>')
                    elif "heading 3" in style_name:
                        parts.append(f'<h3 style="color: #cbd5e1; margin-top: 1rem; margin-bottom: 0.5rem; font-size: 1.1rem; font-weight: 500;">{html.escape(text)}</h3>')
                    elif "heading" in style_name:
                        parts.append(f'<h4 style="color: #cbd5e1; margin-top: 0.75rem; margin-bottom: 0.25rem; font-weight: 500;">{html.escape(text)}</h4>')
                    elif "title" in style_name:
                        parts.append(f'<h1 style="color: #f1f5f9; margin-top: 1rem; margin-bottom: 1rem; font-size: 1.75rem; font-weight: 700; text-align: center;">{html.escape(text)}</h1>')
                    elif "list" in style_name:
                        parts.append(f'<li style="color: #94a3b8; margin-left: 1.5rem; margin-bottom: 0.25rem; line-height: 1.6;">{html.escape(text)}</li>')
                    else:
                        is_bold = all(run.bold for run in para.runs if run.text.strip()) if para.runs else False
                        if is_bold and len(text) < 100:
                            parts.append(f'<h4 style="color: #cbd5e1; margin-top: 0.75rem; margin-bottom: 0.25rem; font-weight: 600;">{html.escape(text)}</h4>')
                        else:
                            parts.append(f'<p style="color: #94a3b8; margin-bottom: 0.5rem; line-height: 1.6;">{html.escape(text)}</p>')
                
                for table in doc.tables:
                    table_html = '<table style="width: 100%; border-collapse: collapse; margin: 1rem 0; border: 1px solid #334155;">'
                    for i, row in enumerate(table.rows):
                        table_html += '<tr>'
                        for cell in row.cells:
                            tag = 'th' if i == 0 else 'td'
                            style = 'padding: 0.5rem; border: 1px solid #334155; color: #94a3b8;'
                            if i == 0:
                                style += ' background-color: #1e293b; color: #e2e8f0; font-weight: 600;'
                            table_html += f'<{tag} style="{style}">{html.escape(cell.text.strip())}</{tag}>'
                        table_html += '</tr>'
                    table_html += '</table>'
                    parts.append(table_html)
                
                html_content = "".join(parts)
            
            else:
                raise HTTPException(status_code=400, detail=f"Unsupported file type: {file_type}")
        
        except HTTPException:
            raise
        except Exception as e:
            if src.content:
                lines = src.content.split('\n')
                html_parts = []
                for line in lines:
                    stripped = line.strip()
                    if not stripped:
                        continue
                    html_parts.append(f'<p style="color: #94a3b8; margin-bottom: 0.5rem; line-height: 1.6;">{html.escape(stripped)}</p>')
                return {
                    "document_id": document.id,
                    "title": document.title,
                    "content_type": "html",
                    "html": "".join(html_parts),
                    "file_type": src.file_type
                }
            raise HTTPException(status_code=500, detail=f"Error converting document: {str(e)}")
        
        return {
            "document_id": document.id,
            "title": document.title,
            "content_type": "html",
            "html": html_content,
            "file_type": file_type
        }
    
    # Fall back to content field if no file
    if src.content:
        lines = src.content.split('\n')
        html_parts = []
        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue
            if stripped.isupper() and len(stripped) < 100:
                html_parts.append(f'<h3 style="color: #e2e8f0; margin-top: 1.5rem; margin-bottom: 0.5rem; font-weight: 600;">{html.escape(stripped)}</h3>')
            elif len(stripped) < 80 and not stripped.endswith('.') and not stripped.endswith(','):
                html_parts.append(f'<h4 style="color: #cbd5e1; margin-top: 1rem; margin-bottom: 0.25rem; font-weight: 500;">{html.escape(stripped)}</h4>')
            else:
                html_parts.append(f'<p style="color: #94a3b8; margin-bottom: 0.5rem; line-height: 1.6;">{html.escape(stripped)}</p>')
        return {
            "document_id": document.id,
            "title": document.title,
            "content_type": "html",
            "html": "".join(html_parts),
            "file_type": src.file_type
        }

    raise HTTPException(status_code=404, detail="Document file not found")


# ============================================================================
# Document annotations / remarks
# ----------------------------------------------------------------------------
# Auditors and reviewers can attach remarks to a document. Two anchor kinds
# are supported today:
#   - text_range : anchored to a character offset range in the document's
#                   plain-text representation (works for `content`-based
#                   docs, markdown, and the in-browser viewer's text mode)
#   - general    : free-form comment with no specific anchor
#
# Threading is intentionally NOT supported in v1 — flat annotations are
# easier to anchor and render; reply chains can be added later by
# introducing `parent_annotation_id` without a breaking change.
# ============================================================================

class AnnotationCreateRequest(BaseModel):
    anchor_kind: str = Field("general", pattern=r"^(text_range|general)$")
    anchor_data: Optional[Dict[str, Any]] = None
    comment: str = Field(..., min_length=1, max_length=4000)


class AnnotationUpdateRequest(BaseModel):
    comment: Optional[str] = Field(None, min_length=1, max_length=4000)
    status: Optional[str] = Field(None, pattern=r"^(open|resolved)$")


def _serialize_annotation(a: DocumentAnnotation, user_lookup: Dict[int, GRCUser]) -> dict:
    user = user_lookup.get(a.user_id)
    return {
        "id": a.id,
        "document_id": a.document_id,
        "anchor_kind": a.anchor_kind,
        "anchor_data": a.anchor_data or {},
        "comment": a.comment,
        "status": a.status,
        "user_id": a.user_id,
        "user_name": (user.display_name or user.email) if user else None,
        "created_at": a.created_at,
        "updated_at": a.updated_at,
    }


def _assert_doc_access(document_id: int, user_tenants: List[int], db: Session) -> GovernanceDocument:
    doc = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants),
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found in your tenant.")
    return doc


@router.get("/{document_id}/annotations", dependencies=[Depends(permissions.require_doc_reader)])
def list_document_annotations(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    doc = _assert_doc_access(document_id, user_tenants, db)
    rows = db.query(DocumentAnnotation).filter(
        DocumentAnnotation.document_id == doc.id,
        DocumentAnnotation.tenant_id == doc.tenant_id,
    ).order_by(DocumentAnnotation.created_at.asc()).all()
    user_ids = list({r.user_id for r in rows})
    users = db.query(GRCUser).filter(GRCUser.id.in_(user_ids)).all() if user_ids else []
    user_lookup = {u.id: u for u in users}
    return {
        "annotations": [_serialize_annotation(a, user_lookup) for a in rows],
        "total": len(rows),
    }


@router.post("/{document_id}/annotations", status_code=status.HTTP_201_CREATED, dependencies=[Depends(permissions.require_doc_reader)])
def create_document_annotation(
    document_id: int,
    payload: AnnotationCreateRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    doc = _assert_doc_access(document_id, user_tenants, db)
    permissions.ensure_annotator(db, current_user, doc)
    annotation = DocumentAnnotation(
        tenant_id=doc.tenant_id,
        document_id=doc.id,
        user_id=current_user.id,
        anchor_kind=payload.anchor_kind,
        anchor_data=payload.anchor_data or {},
        comment=payload.comment.strip(),
        status="open",
    )
    db.add(annotation)
    db.commit()
    db.refresh(annotation)
    return _serialize_annotation(annotation, {current_user.id: current_user})


@router.put("/{document_id}/annotations/{annotation_id}", dependencies=[Depends(permissions.require_doc_reader)])
def update_document_annotation(
    document_id: int,
    annotation_id: int,
    payload: AnnotationUpdateRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    doc = _assert_doc_access(document_id, user_tenants, db)
    permissions.ensure_annotator(db, current_user, doc)
    annotation = db.query(DocumentAnnotation).filter(
        DocumentAnnotation.id == annotation_id,
        DocumentAnnotation.document_id == doc.id,
        DocumentAnnotation.tenant_id == doc.tenant_id,
    ).first()
    if not annotation:
        raise HTTPException(status_code=404, detail="Annotation not found.")
    # Comment edits restricted to the author; status can be flipped by
    # any tenant member (so a different reviewer can mark resolved).
    if payload.comment is not None:
        if annotation.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Only the author can edit this remark.")
        annotation.comment = payload.comment.strip()
    if payload.status is not None:
        annotation.status = payload.status
    db.commit()
    db.refresh(annotation)
    user = db.query(GRCUser).filter(GRCUser.id == annotation.user_id).first()
    return _serialize_annotation(annotation, {annotation.user_id: user} if user else {})


@router.delete("/{document_id}/annotations/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT,
               dependencies=[Depends(permissions.require_doc_reader)])
def delete_document_annotation(
    document_id: int,
    annotation_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    doc = _assert_doc_access(document_id, user_tenants, db)
    permissions.ensure_annotator(db, current_user, doc)
    annotation = db.query(DocumentAnnotation).filter(
        DocumentAnnotation.id == annotation_id,
        DocumentAnnotation.document_id == doc.id,
        DocumentAnnotation.tenant_id == doc.tenant_id,
    ).first()
    if not annotation:
        raise HTTPException(status_code=404, detail="Annotation not found.")
    if annotation.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the author can delete this remark.")
    db.delete(annotation)
    db.commit()
    return None
