from ..config import get_openai_api_key
import os
import json
import logging
import re
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, or_, and_
from pydantic import BaseModel
from openai import OpenAI

logger = logging.getLogger(__name__)

from ..models import (
    NormalizedControl, ControlMapping, GRCRequiredEvidence,
    FrameworkControl, Framework, GRCUser, get_db,
    ParsedFrameworkControl, UploadedFramework, Evidence, EvidenceControlMapping
)
from ..schemas import (
    NormalizedControlCreate, NormalizedControlUpdate, NormalizedControlResponse,
    ControlMappingCreate, ControlMappingResponse,
    RequiredEvidenceCreate, RequiredEvidenceResponse,
    MessageResponse
)
from .auth_router import require_auth, get_user_tenants


class ControlAIRecommendationRequest(BaseModel):
    control_id: int
    control_title: str
    control_description: Optional[str] = None
    framework_name: Optional[str] = None


class FrameworkControlEvidenceLinkCreate(BaseModel):
    evidence_id: int


def _natural_tokens(value: Optional[str]) -> tuple:
    text = (value or "").strip()
    if not text:
        return ((3, ""),)

    parts = re.findall(r"\d+|[A-Za-z]+|[^A-Za-z0-9]+", text)
    tokens = []
    for part in parts:
        if part.isdigit():
            tokens.append((0, int(part)))
        elif part.isalpha():
            tokens.append((1, part.lower()))
        else:
            tokens.append((2, part))
    return tuple(tokens)


def _framework_control_natural_key(control: ParsedFrameworkControl) -> tuple:
    display_reference = control.original_reference or control.control_id or ""
    framework_name = (control.uploaded_framework.name if control.uploaded_framework else "").lower()
    title = (control.title or "").lower()
    return (
        _natural_tokens(display_reference),
        framework_name,
        title,
        control.id
    )


def get_framework_control_or_404(
    framework_control_id: int,
    user_tenants: List[int],
    db: Session
) -> ParsedFrameworkControl:
    access_filter = or_(
        UploadedFramework.tenant_id.in_(user_tenants),
        UploadedFramework.tenant_id.is_(None)
    ) if user_tenants else UploadedFramework.tenant_id.is_(None)

    control = db.query(ParsedFrameworkControl).join(
        UploadedFramework,
        ParsedFrameworkControl.uploaded_framework_id == UploadedFramework.id
    ).filter(
        ParsedFrameworkControl.id == framework_control_id,
        UploadedFramework.is_active == True,
        access_filter
    ).first()

    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework control not found"
        )
    return control


def get_openai_client() -> OpenAI:
    api_key = get_openai_api_key()
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

router = APIRouter(prefix="/controls", tags=["Normalized Controls"])

AI_RECOMMENDATION_PROMPT = """You are a Senior GRC Auditor with 20+ years of experience, holding CISA, CISSP, CRISC, and ISO 27001 Lead Auditor certifications.

Given the following compliance control, generate comprehensive audit test procedures and evidence requirements that would satisfy an external auditor.

CONTROL INFORMATION:
- Control ID: {control_id}
- Control Title: {control_title}
- Control Description: {control_description}
- Framework: {framework_name}

Generate professional, audit-ready recommendations in the following JSON format:
{{
    "test_procedures": [
        {{
            "procedure_type": "<walkthrough|inquiry|observation|inspection|reperformance>",
            "description": "<detailed description of the test procedure>",
            "frequency": "<frequency of testing, e.g., quarterly, annually, continuously>",
            "sample_size": "<recommended sample size or 'N/A' if not applicable>"
        }}
    ],
    "evidence_requirements": [
        {{
            "evidence_type": "<policy|procedure|report|screenshot|log|configuration|certificate|attestation|training|other>",
            "title": "<concise title for this evidence>",
            "description": "<detailed description of what this evidence should contain>",
            "mandatory": <true or false>
        }}
    ],
    "key_risks_addressed": ["<risk 1>", "<risk 2>", ...],
    "audit_focus_areas": ["<focus area 1>", "<focus area 2>", ...]
}}

REQUIREMENTS:
1. Generate 2-5 test procedures covering different testing methodologies (inquiry, inspection, observation, etc.)
2. Generate 3-7 evidence requirements covering policies, procedures, and actual evidence artifacts
3. Identify 2-5 key risks that this control addresses
4. Identify 2-4 audit focus areas that auditors would typically scrutinize
5. Be specific and actionable - procedures should be executable by an auditor
6. Evidence requirements should be comprehensive and realistic
7. Respond ONLY with valid JSON, no additional text"""


@router.post("/ai-recommendations")
def get_control_ai_recommendations(
    request: ControlAIRecommendationRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Generate AI-powered test procedures and evidence requirements for a control."""
    try:
        client = get_openai_client()
        
        prompt = AI_RECOMMENDATION_PROMPT.format(
            control_id=request.control_id,
            control_title=request.control_title,
            control_description=request.control_description or "Not provided",
            framework_name=request.framework_name or "General compliance framework"
        )
        
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a Senior GRC Auditor providing audit test procedures and evidence requirements. Respond only with valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=2000
        )
        
        response_text = response.choices[0].message.content.strip()
        
        # Parse the JSON response
        cleaned = response_text
        if cleaned.startswith("```json"):
            cleaned = cleaned[7:]
        if cleaned.startswith("```"):
            cleaned = cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        
        try:
            result = json.loads(cleaned.strip())
        except json.JSONDecodeError:
            logger.error(f"Failed to parse AI response: {response_text[:500]}")
            result = {
                "test_procedures": [
                    {
                        "procedure_type": "inquiry",
                        "description": f"Interview control owner to understand implementation of: {request.control_title}",
                        "frequency": "annually",
                        "sample_size": "N/A"
                    },
                    {
                        "procedure_type": "inspection",
                        "description": f"Obtain and review documentation supporting: {request.control_title}",
                        "frequency": "annually",
                        "sample_size": "All available documentation"
                    }
                ],
                "evidence_requirements": [
                    {
                        "evidence_type": "policy",
                        "title": "Relevant Policy Document",
                        "description": f"Policy document addressing: {request.control_title}",
                        "mandatory": True
                    },
                    {
                        "evidence_type": "procedure",
                        "title": "Procedure Documentation",
                        "description": f"Documented procedures for implementing: {request.control_title}",
                        "mandatory": True
                    }
                ],
                "key_risks_addressed": ["Control not operating effectively", "Non-compliance with requirements"],
                "audit_focus_areas": ["Evidence of control operation", "Completeness of documentation"]
            }
        
        return {
            "control_id": request.control_id,
            "test_procedures": result.get("test_procedures", []),
            "evidence_requirements": result.get("evidence_requirements", []),
            "key_risks_addressed": result.get("key_risks_addressed", []),
            "audit_focus_areas": result.get("audit_focus_areas", [])
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating AI recommendations: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate AI recommendations: {str(e)}"
        )


@router.get("", response_model=List[NormalizedControlResponse])
def list_controls(
    code: Optional[str] = None,
    name: Optional[str] = None,
    owner: Optional[str] = None,
    maturity_level: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    query = db.query(NormalizedControl)
    
    if code:
        query = query.filter(NormalizedControl.code.ilike(f"%{code}%"))
    if name:
        query = query.filter(NormalizedControl.name.ilike(f"%{name}%"))
    if owner:
        query = query.filter(NormalizedControl.control_owner.ilike(f"%{owner}%"))
    if maturity_level is not None:
        query = query.filter(NormalizedControl.maturity_level == maturity_level)
    
    controls = query.offset(skip).limit(limit).all()
    return controls


@router.post("", response_model=NormalizedControlResponse, status_code=status.HTTP_201_CREATED)
def create_control(
    control: NormalizedControlCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    existing = db.query(NormalizedControl).filter(NormalizedControl.code == control.code).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Control with this code already exists"
        )
    
    db_control = NormalizedControl(
        code=control.code,
        name=control.name,
        statement=control.statement,
        objective=control.objective,
        control_owner=control.control_owner,
        implementation_guidance=control.implementation_guidance,
        testing_guidance=control.testing_guidance,
        maturity_level=control.maturity_level
    )
    db.add(db_control)
    db.commit()
    db.refresh(db_control)
    return db_control


@router.get("/matrix")
def get_control_matrix(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    frameworks = db.query(Framework).filter(Framework.is_active == True).all()
    controls = db.query(NormalizedControl).options(
        joinedload(NormalizedControl.control_mappings)
        .joinedload(ControlMapping.framework_control)
    ).all()
    
    matrix = []
    for control in controls:
        row = {
            "id": control.id,
            "code": control.code,
            "name": control.name,
            "mappings": {}
        }
        for mapping in control.control_mappings:
            if mapping.framework_control and mapping.framework_control.objective:
                domain = mapping.framework_control.objective.domain
                if domain:
                    framework_code = domain.framework.short_code
                    row["mappings"][framework_code] = {
                        "control_id": mapping.framework_control_id,
                        "control_code": mapping.framework_control.code,
                        "mapping_type": mapping.mapping_type
                    }
        matrix.append(row)
    
    return {
        "frameworks": [{"id": f.id, "short_code": f.short_code, "name": f.name} for f in frameworks],
        "controls": matrix
    }


@router.get("/framework-controls/summary")
def get_framework_controls_summary(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Get summary of controls per uploaded framework"""
    user_tenants = get_user_tenants(current_user, db)

    # Names of frameworks that have a tenant-specific copy — used to exclude null-tenant duplicates
    tenant_specific_names_sq = db.query(UploadedFramework.name).filter(
        UploadedFramework.tenant_id.in_(user_tenants),
        UploadedFramework.is_active == True
    ) if user_tenants else db.query(UploadedFramework.name).filter(False)

    # Dedup: include tenant-specific frameworks, and null-tenant ones only when no tenant copy exists
    dedup_filter = or_(
        UploadedFramework.tenant_id.in_(user_tenants),
        and_(
            UploadedFramework.tenant_id.is_(None),
            ~UploadedFramework.name.in_(tenant_specific_names_sq)
        )
    )

    frameworks = db.query(
        UploadedFramework.id,
        UploadedFramework.name,
        UploadedFramework.version,
        UploadedFramework.framework_type,
        UploadedFramework.upload_status,
        func.count(ParsedFrameworkControl.id).label("control_count")
    ).outerjoin(
        ParsedFrameworkControl,
        UploadedFramework.id == ParsedFrameworkControl.uploaded_framework_id
    ).filter(
        dedup_filter,
        UploadedFramework.upload_status.in_(['published', 'completed', 'parsed', 'classified']),
        UploadedFramework.is_active == True
    ).group_by(
        UploadedFramework.id,
        UploadedFramework.name,
        UploadedFramework.version,
        UploadedFramework.framework_type,
        UploadedFramework.upload_status
    ).all()

    # Only include frameworks that have at least one control
    frameworks_with_controls = [f for f in frameworks if f.control_count > 0]

    # Total controls using the same dedup filter as the list endpoint
    total_controls = db.query(func.count(ParsedFrameworkControl.id)).join(
        UploadedFramework,
        ParsedFrameworkControl.uploaded_framework_id == UploadedFramework.id
    ).filter(
        dedup_filter,
        UploadedFramework.is_active == True
    ).scalar() or 0

    return {
        "frameworks": [
            {
                "id": f.id,
                "name": f.name,
                "version": f.version,
                "framework_type": f.framework_type,
                "status": f.upload_status,
                "control_count": f.control_count
            }
            for f in frameworks_with_controls
        ],
        "total_frameworks": len(frameworks_with_controls),
        "total_controls": total_controls
    }


@router.get("/framework-controls")
def list_framework_controls(
    framework_id: Optional[int] = None,
    domain: Optional[str] = None,
    search: Optional[str] = None,
    sort_by: Optional[str] = "framework_name",
    sort_order: Optional[str] = "asc",
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Get all parsed controls from uploaded frameworks with framework info"""
    user_tenants = get_user_tenants(current_user, db)

    if framework_id:
        # Direct lookup: user specified a framework ID explicitly.
        # Skip the dedup filter and just verify the framework is accessible
        # (either belongs to this tenant or is a shared null-tenant framework).
        access_filter = or_(
            UploadedFramework.tenant_id.in_(user_tenants),
            UploadedFramework.tenant_id.is_(None)
        ) if user_tenants else UploadedFramework.tenant_id.is_(None)

        query = db.query(ParsedFrameworkControl).join(
            UploadedFramework,
            ParsedFrameworkControl.uploaded_framework_id == UploadedFramework.id
        ).filter(
            access_filter,
            UploadedFramework.is_active == True,
            ParsedFrameworkControl.uploaded_framework_id == framework_id
        )
    else:
        # General listing: apply dedup so we don't show duplicate null-tenant
        # frameworks when the tenant has their own copy.
        tenant_specific_names_sq = db.query(UploadedFramework.name).filter(
            UploadedFramework.tenant_id.in_(user_tenants),
            UploadedFramework.is_active == True
        ) if user_tenants else db.query(UploadedFramework.name).filter(False)

        dedup_filter = or_(
            UploadedFramework.tenant_id.in_(user_tenants),
            and_(
                UploadedFramework.tenant_id.is_(None),
                ~UploadedFramework.name.in_(tenant_specific_names_sq)
            )
        )

        query = db.query(ParsedFrameworkControl).join(
            UploadedFramework,
            ParsedFrameworkControl.uploaded_framework_id == UploadedFramework.id
        ).filter(
            dedup_filter,
            UploadedFramework.is_active == True
        )
    
    if domain:
        query = query.filter(ParsedFrameworkControl.domain.ilike(f"%{domain}%"))
    
    if search:
        query = query.filter(
            (ParsedFrameworkControl.control_id.ilike(f"%{search}%")) |
            (ParsedFrameworkControl.title.ilike(f"%{search}%")) |
            (ParsedFrameworkControl.original_reference.ilike(f"%{search}%")) |
            (ParsedFrameworkControl.description.ilike(f"%{search}%"))
        )
    
    sort_key = (sort_by or "framework_name").lower()
    sort_direction = "desc" if (sort_order or "").lower() == "desc" else "asc"
    descending = sort_direction == "desc"

    evidence_count_sq = None
    if sort_key in {"evidence", "evidence_count"}:
        evidence_count_sq = db.query(
            EvidenceControlMapping.parsed_control_id.label("parsed_control_id"),
            func.count(EvidenceControlMapping.id).label("evidence_count")
        ).group_by(EvidenceControlMapping.parsed_control_id).subquery()
        query = query.outerjoin(
            evidence_count_sq,
            ParsedFrameworkControl.id == evidence_count_sq.c.parsed_control_id
        )

    if sort_key in {"control_id", "id", "reference"}:
        primary_sort = ParsedFrameworkControl.control_id
    elif sort_key in {"title", "name"}:
        primary_sort = ParsedFrameworkControl.title
    elif sort_key in {"domain"}:
        primary_sort = ParsedFrameworkControl.domain
    elif sort_key in {"priority"}:
        primary_sort = ParsedFrameworkControl.priority
    elif sort_key in {"status", "is_verified", "verification"}:
        primary_sort = ParsedFrameworkControl.is_verified
    elif sort_key in {"evidence", "evidence_count"}:
        primary_sort = func.coalesce(evidence_count_sq.c.evidence_count, 0)
    else:
        primary_sort = UploadedFramework.name

    order_clause = primary_sort.desc() if descending else primary_sort.asc()
    framework_order = UploadedFramework.name.desc() if descending else UploadedFramework.name.asc()
    control_order = ParsedFrameworkControl.control_id.desc() if descending else ParsedFrameworkControl.control_id.asc()

    total = query.count()

    if sort_key in {"control_id", "id", "reference"}:
        controls = query.options(
            joinedload(ParsedFrameworkControl.uploaded_framework)
        ).all()
        controls = sorted(controls, key=_framework_control_natural_key, reverse=descending)
        controls = controls[skip:skip + limit]
    else:
        controls = query.options(
            joinedload(ParsedFrameworkControl.uploaded_framework)
        ).order_by(
            order_clause,
            framework_order,
            control_order
        ).offset(skip).limit(limit).all()
    
    control_ids = [c.id for c in controls]
    evidence_counts = {}
    if control_ids:
        counts = db.query(
            EvidenceControlMapping.parsed_control_id,
            func.count(EvidenceControlMapping.id).label("count")
        ).filter(
            EvidenceControlMapping.parsed_control_id.in_(control_ids)
        ).group_by(
            EvidenceControlMapping.parsed_control_id
        ).all()
        evidence_counts = {c.parsed_control_id: c.count for c in counts}
    
    result = []
    for control in controls:
        result.append({
            "id": control.id,
            "control_id": control.control_id,
            "original_reference": control.original_reference,
            "title": control.title,
            "description": control.description,
            "full_text": control.full_text,
            "domain": control.domain,
            "category": control.category,
            "is_mandatory": control.is_mandatory,
            "priority": control.priority,
            # Native implementation-order tier (NDMO P1/P2/P3 → Year 1/2/3
            # roadmap) and control-level prerequisite dependencies. Null/[] for
            # frameworks that declare neither.
            "priority_level": control.priority_level,
            "dependencies": control.dependencies or [],
            "version_history": control.version_history or [],
            "control_description": control.control_description,
            "assessment_criteria": control.assessment_criteria or [],
            "section_number": control.section_number,
            "parent_section": control.parent_section,
            "ai_confidence": control.ai_confidence,
            "ai_notes": control.ai_notes,
            "is_verified": control.is_verified,
            "framework_id": control.uploaded_framework_id,
            "framework_name": control.uploaded_framework.name if control.uploaded_framework else None,
            "framework_version": control.uploaded_framework.version if control.uploaded_framework else None,
            "created_at": control.created_at.isoformat() if control.created_at else None,
            "evidence_count": evidence_counts.get(control.id, 0),
            "evidence_requirements": control.evidence_requirements or [],
        })
    
    return {
        "controls": result,
        "total": total,
        "skip": skip,
        "limit": limit
    }


@router.get("/framework-control/{framework_control_id}", response_model=dict)
def get_framework_control_detail(
    framework_control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Get details of a specific framework control with evidence requirements"""
    user_tenants = get_user_tenants(current_user, db)
    control = get_framework_control_or_404(framework_control_id, user_tenants, db)
    
    # Get evidence count
    evidence_count = db.query(func.count(EvidenceControlMapping.id)).filter(
        EvidenceControlMapping.parsed_control_id == framework_control_id
    ).scalar() or 0
    
    return {
        "id": control.id,
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
        "framework_id": control.uploaded_framework_id,
        "framework_name": control.uploaded_framework.name if control.uploaded_framework else None,
        "framework_version": control.uploaded_framework.version if control.uploaded_framework else None,
        "created_at": control.created_at.isoformat() if control.created_at else None,
        "evidence_requirements": control.evidence_requirements or [],
        "evidence_count": evidence_count,
    }


@router.get("/framework-control/{framework_control_id}/evidence")
def list_framework_control_evidence(
    framework_control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    control = get_framework_control_or_404(framework_control_id, user_tenants, db)

    links = db.query(EvidenceControlMapping).options(
        joinedload(EvidenceControlMapping.evidence)
    ).filter(
        EvidenceControlMapping.parsed_control_id == control.id
    ).join(
        Evidence,
        Evidence.id == EvidenceControlMapping.evidence_id
    ).filter(
        Evidence.tenant_id.in_(user_tenants)
    ).order_by(
        EvidenceControlMapping.created_at.desc()
    ).all()

    result = []
    for link in links:
        ev = link.evidence
        if not ev:
            continue
        result.append({
            "id": link.id,
            "evidence_id": ev.id,
            "title": ev.name or ev.file_name or f"Evidence #{ev.id}",
            "description": ev.description,
            "evidence_type": ev.evidence_type,
            "status": ev.status,
            "file_name": ev.file_name,
            "linked_at": link.created_at.isoformat() if link.created_at else None,
        })
    return result


@router.post("/framework-control/{framework_control_id}/evidence", status_code=status.HTTP_201_CREATED)
def link_evidence_to_framework_control(
    framework_control_id: int,
    data: FrameworkControlEvidenceLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    control = get_framework_control_or_404(framework_control_id, user_tenants, db)

    evidence = db.query(Evidence).filter(
        Evidence.id == data.evidence_id,
        Evidence.tenant_id.in_(user_tenants)
    ).first()
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )

    existing = db.query(EvidenceControlMapping).filter(
        EvidenceControlMapping.parsed_control_id == control.id,
        EvidenceControlMapping.evidence_id == evidence.id
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Evidence already linked to this control"
        )

    link = EvidenceControlMapping(
        evidence_id=evidence.id,
        parsed_control_id=control.id,
        uploaded_framework_id=control.uploaded_framework_id,
        created_by_ai=False
    )
    db.add(link)
    db.commit()
    db.refresh(link)

    return {
        "id": link.id,
        "evidence_id": evidence.id,
        "title": evidence.name or evidence.file_name or f"Evidence #{evidence.id}",
        "description": evidence.description,
        "evidence_type": evidence.evidence_type,
        "status": evidence.status,
        "file_name": evidence.file_name,
        "linked_at": link.created_at.isoformat() if link.created_at else None,
    }


@router.delete("/framework-control/{framework_control_id}/evidence/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def unlink_evidence_from_framework_control(
    framework_control_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    control = get_framework_control_or_404(framework_control_id, user_tenants, db)

    link = db.query(EvidenceControlMapping).join(
        Evidence,
        Evidence.id == EvidenceControlMapping.evidence_id
    ).filter(
        EvidenceControlMapping.id == link_id,
        EvidenceControlMapping.parsed_control_id == control.id,
        Evidence.tenant_id.in_(user_tenants)
    ).first()
    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence link not found"
        )

    db.delete(link)
    db.commit()
    return None


@router.get("/{control_id}", response_model=dict)
def get_control(
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    control = db.query(NormalizedControl).options(
        joinedload(NormalizedControl.control_mappings)
        .joinedload(ControlMapping.framework_control),
        joinedload(NormalizedControl.required_evidence)
    ).filter(NormalizedControl.id == control_id).first()
    
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control not found"
        )
    
    return {
        "id": control.id,
        "code": control.code,
        "name": control.name,
        "statement": control.statement,
        "objective": control.objective,
        "control_owner": control.control_owner,
        "implementation_guidance": control.implementation_guidance,
        "testing_guidance": control.testing_guidance,
        "maturity_level": control.maturity_level,
        "created_at": control.created_at.isoformat(),
        "mappings": [
            {
                "id": m.id,
                "framework_control_id": m.framework_control_id,
                "framework_control_code": m.framework_control.code if m.framework_control else None,
                "framework_control_name": m.framework_control.name if m.framework_control else None,
                "mapping_type": m.mapping_type
            }
            for m in control.control_mappings
        ],
        "required_evidence": [
            {
                "id": e.id,
                "name": e.name,
                "description": e.description,
                "evidence_type": e.evidence_type,
                "validation_criteria": e.validation_criteria
            }
            for e in control.required_evidence
        ]
    }


@router.put("/{control_id}", response_model=NormalizedControlResponse)
def update_control(
    control_id: int,
    control_update: NormalizedControlUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    control = db.query(NormalizedControl).filter(NormalizedControl.id == control_id).first()
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control not found"
        )
    
    update_data = control_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(control, field, value)
    
    db.commit()
    db.refresh(control)
    return control


@router.delete("/{control_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_control(
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    control = db.query(NormalizedControl).filter(NormalizedControl.id == control_id).first()
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control not found"
        )
    
    db.delete(control)
    db.commit()
    return None


@router.get("/{control_id}/mappings", response_model=List[ControlMappingResponse])
def get_control_mappings(
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    control = db.query(NormalizedControl).filter(NormalizedControl.id == control_id).first()
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control not found"
        )
    
    mappings = db.query(ControlMapping).filter(
        ControlMapping.normalized_control_id == control_id
    ).all()
    return mappings


@router.post("/{control_id}/mappings", response_model=ControlMappingResponse, status_code=status.HTTP_201_CREATED)
def create_control_mapping(
    control_id: int,
    mapping: ControlMappingCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    control = db.query(NormalizedControl).filter(NormalizedControl.id == control_id).first()
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Normalized control not found"
        )
    
    framework_control = db.query(FrameworkControl).filter(
        FrameworkControl.id == mapping.framework_control_id
    ).first()
    if not framework_control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework control not found"
        )
    
    existing = db.query(ControlMapping).filter(
        ControlMapping.normalized_control_id == control_id,
        ControlMapping.framework_control_id == mapping.framework_control_id
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mapping already exists"
        )
    
    db_mapping = ControlMapping(
        normalized_control_id=control_id,
        framework_control_id=mapping.framework_control_id,
        mapping_type=mapping.mapping_type
    )
    db.add(db_mapping)
    db.commit()
    db.refresh(db_mapping)
    return db_mapping


@router.delete("/{control_id}/mappings/{mapping_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_control_mapping(
    control_id: int,
    mapping_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    mapping = db.query(ControlMapping).filter(
        ControlMapping.id == mapping_id,
        ControlMapping.normalized_control_id == control_id
    ).first()
    if not mapping:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mapping not found"
        )
    
    db.delete(mapping)
    db.commit()
    return None


@router.get("/{control_id}/evidences", response_model=List[RequiredEvidenceResponse])
def get_control_evidences(
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    control = db.query(NormalizedControl).filter(NormalizedControl.id == control_id).first()
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control not found"
        )
    
    evidences = db.query(GRCRequiredEvidence).filter(
        GRCRequiredEvidence.normalized_control_id == control_id
    ).all()
    return evidences


@router.post("/{control_id}/evidences", response_model=RequiredEvidenceResponse, status_code=status.HTTP_201_CREATED)
def add_required_evidence(
    control_id: int,
    evidence: RequiredEvidenceCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    control = db.query(NormalizedControl).filter(NormalizedControl.id == control_id).first()
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control not found"
        )
    
    db_evidence = GRCRequiredEvidence(
        normalized_control_id=control_id,
        name=evidence.name,
        description=evidence.description,
        evidence_type=evidence.evidence_type,
        validation_criteria=evidence.validation_criteria
    )
    db.add(db_evidence)
    db.commit()
    db.refresh(db_evidence)
    return db_evidence
