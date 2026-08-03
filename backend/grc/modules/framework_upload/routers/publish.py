from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel

from ....models import (
    UploadedFramework, ParsedFrameworkControl, Framework, FrameworkDomain,
    ControlObjective, FrameworkControl, GRCUser, get_db, ControlEvidenceMapping,
    CuratedEvidenceItem
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/publish", tags=["Framework Upload - Publish"])


class PublishFrameworkRequest(BaseModel):
    short_code: str
    regulator: Optional[str] = None
    jurisdiction: Optional[str] = None
    region: Optional[str] = "Global"
    is_mandatory: Optional[bool] = False
    enforcement_type: Optional[str] = None


def validate_framework_access(user: GRCUser, framework: UploadedFramework, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if framework.tenant_id and framework.tenant_id not in user_tenants and not framework.is_shared:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this framework"
        )


def generate_short_code(name: str) -> str:
    words = name.upper().split()
    if len(words) >= 2:
        return ''.join([w[0] for w in words[:3]])
    return name[:5].upper().replace(' ', '')


@router.get("/{framework_id}/status")
def get_publish_status(
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
    
    parsed_count = db.query(func.count(ParsedFrameworkControl.id)).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework_id
    ).scalar() or 0
    
    can_publish = (
        framework.upload_status == 'parsed' and
        parsed_count > 0 and
        framework.published_framework_id is None
    )
    
    return {
        "framework_id": framework_id,
        "framework_name": framework.name,
        "upload_status": framework.upload_status,
        "parsed_controls_count": parsed_count,
        "is_published": framework.published_framework_id is not None,
        "published_framework_id": framework.published_framework_id,
        "published_at": framework.published_at.isoformat() if framework.published_at else None,
        "can_publish": can_publish,
        "suggested_short_code": generate_short_code(framework.name) if can_publish else None
    }


@router.post("/{framework_id}")
def publish_framework_to_library(
    framework_id: int,
    request: PublishFrameworkRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    uploaded_framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == framework_id
    ).first()
    
    if not uploaded_framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uploaded framework not found"
        )
    
    validate_framework_access(current_user, uploaded_framework, db)
    
    if uploaded_framework.published_framework_id is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This framework has already been published"
        )
    
    if uploaded_framework.upload_status != 'parsed':
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Framework must be parsed before publishing. Current status: " + uploaded_framework.upload_status
        )
    
    parsed_controls = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework_id
    ).all()
    
    if not parsed_controls:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No parsed controls found. Please parse the framework first."
        )
    
    existing = db.query(Framework).filter(
        Framework.short_code == request.short_code
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"A framework with short code '{request.short_code}' already exists"
        )
    
    new_framework = Framework(
        name=uploaded_framework.name,
        short_code=request.short_code,
        regulator=request.regulator or uploaded_framework.source_organization,
        jurisdiction=request.jurisdiction,
        region=request.region or "Global",
        version=uploaded_framework.version,
        description=uploaded_framework.description,
        is_mandatory=request.is_mandatory,
        enforcement_type=request.enforcement_type,
        is_active=True,
        is_custom=True
    )
    db.add(new_framework)
    db.flush()
    
    domains_by_name = {}
    objectives_by_domain_category = {}
    control_order = 0
    parsed_to_published_control_map = {}
    
    for pc in parsed_controls:
        domain_name = pc.domain or "General"
        category_name = pc.category or "General"
        
        if domain_name not in domains_by_name:
            domain_code = ''.join([w[0].upper() for w in domain_name.split()[:3]]) or "GEN"
            domain_order = len(domains_by_name)
            
            domain = FrameworkDomain(
                framework_id=new_framework.id,
                code=f"{request.short_code}-{domain_code}",
                name=domain_name,
                description=f"Controls related to {domain_name}",
                order=domain_order
            )
            db.add(domain)
            db.flush()
            domains_by_name[domain_name] = domain
        
        domain = domains_by_name[domain_name]
        objective_key = (domain_name, category_name)
        
        if objective_key not in objectives_by_domain_category:
            obj_code = ''.join([w[0].upper() for w in category_name.split()[:3]]) or "GEN"
            obj_order = len([k for k in objectives_by_domain_category if k[0] == domain_name])
            
            objective = ControlObjective(
                domain_id=domain.id,
                code=f"{domain.code}-{obj_code}",
                name=category_name,
                description=f"Objective for {category_name}",
                order=obj_order
            )
            db.add(objective)
            db.flush()
            objectives_by_domain_category[objective_key] = objective
        
        objective = objectives_by_domain_category[objective_key]
        
        control_order += 1
        control = FrameworkControl(
            objective_id=objective.id,
            code=pc.control_id or pc.original_reference or f"CTRL-{control_order:03d}",
            name=pc.title[:255] if pc.title else f"Control {control_order}",
            statement=pc.description,
            control_objective=pc.full_text,
            is_mandatory=pc.is_mandatory,
            risk_category="security",
            evidence_type="policy",
            implementation_guidance=f"Originally from: {uploaded_framework.name}",
            order=control_order
        )
        db.add(control)
        db.flush()
        parsed_to_published_control_map[pc.id] = control.id
    
    parsed_control_ids = [pc.id for pc in parsed_controls]
    evidence_mappings = db.query(ControlEvidenceMapping).filter(
        ControlEvidenceMapping.parsed_control_id.in_(parsed_control_ids)
    ).all()
    
    evidence_count = 0
    for em in evidence_mappings:
        published_control_id = parsed_to_published_control_map.get(em.parsed_control_id)
        if published_control_id:
            evidence_type = em.evidence_type or "document"
            curated_item = CuratedEvidenceItem(
                framework_control_id=published_control_id,
                sub_control_id=None,
                title=em.evidence_description or f"{evidence_type.title()} Evidence",
                description=em.evidence_description or f"Required {evidence_type} documentation",
                artifact_type=evidence_type,
                format_guidance=None,
                frequency="annual",
                is_required=em.is_required if em.is_required is not None else True
            )
            db.add(curated_item)
            evidence_count += 1
    
    uploaded_framework.published_framework_id = new_framework.id
    uploaded_framework.published_at = datetime.utcnow()
    uploaded_framework.upload_status = 'published'
    
    db.commit()
    db.refresh(new_framework)
    
    domains_count = len(domains_by_name)
    objectives_count = len(objectives_by_domain_category)
    controls_count = len(parsed_controls)
    
    return {
        "message": f"Successfully published '{uploaded_framework.name}' to the frameworks library",
        "framework": {
            "id": new_framework.id,
            "name": new_framework.name,
            "short_code": new_framework.short_code,
            "version": new_framework.version,
            "is_custom": new_framework.is_custom
        },
        "migration_summary": {
            "domains_created": domains_count,
            "objectives_created": objectives_count,
            "controls_created": controls_count,
            "evidence_requirements_created": evidence_count
        },
        "uploaded_framework_id": uploaded_framework.id,
        "published_at": uploaded_framework.published_at.isoformat()
    }


@router.delete("/{framework_id}/unpublish")
def unpublish_framework(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    uploaded_framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == framework_id
    ).first()
    
    if not uploaded_framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uploaded framework not found"
        )
    
    validate_framework_access(current_user, uploaded_framework, db)
    
    if uploaded_framework.published_framework_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This framework is not published"
        )
    
    published_framework = db.query(Framework).filter(
        Framework.id == uploaded_framework.published_framework_id
    ).first()
    
    if published_framework:
        db.delete(published_framework)
    
    uploaded_framework.published_framework_id = None
    uploaded_framework.published_at = None
    uploaded_framework.upload_status = 'parsed'
    
    db.commit()
    
    return {
        "message": f"Successfully unpublished '{uploaded_framework.name}'",
        "framework_id": framework_id,
        "status": "parsed"
    }


@router.post("/{framework_id}/sync-evidence")
def sync_evidence_requirements(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Sync evidence requirements from parsed controls to published framework controls.
    
    Use this to retroactively populate evidence requirements for frameworks 
    that were published before the evidence sync feature was added.
    """
    uploaded_framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == framework_id
    ).first()
    
    if not uploaded_framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uploaded framework not found"
        )
    
    validate_framework_access(current_user, uploaded_framework, db)
    
    if uploaded_framework.published_framework_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This framework is not published yet"
        )
    
    parsed_controls = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework_id
    ).all()
    
    if not parsed_controls:
        return {
            "message": "No parsed controls found",
            "evidence_synced": 0
        }
    
    published_controls = db.query(FrameworkControl).join(
        ControlObjective
    ).join(
        FrameworkDomain
    ).filter(
        FrameworkDomain.framework_id == uploaded_framework.published_framework_id
    ).all()
    
    control_code_to_id = {c.code: c.id for c in published_controls}
    control_name_to_id = {c.name: c.id for c in published_controls}
    
    evidence_synced = 0
    for pc in parsed_controls:
        control_code = pc.control_id or pc.original_reference
        published_control_id = control_code_to_id.get(control_code)
        
        if not published_control_id and pc.title:
            title_key = pc.title[:255] if pc.title else None
            published_control_id = control_name_to_id.get(title_key)
        
        if not published_control_id:
            continue
        
        existing_evidence = db.query(CuratedEvidenceItem).filter(
            CuratedEvidenceItem.framework_control_id == published_control_id
        ).count()
        
        if existing_evidence > 0:
            continue
        
        evidence_mappings = db.query(ControlEvidenceMapping).filter(
            ControlEvidenceMapping.parsed_control_id == pc.id
        ).all()
        
        for em in evidence_mappings:
            evidence_type = em.evidence_type or "document"
            curated_item = CuratedEvidenceItem(
                framework_control_id=published_control_id,
                sub_control_id=None,
                title=em.evidence_description or f"{evidence_type.title()} Evidence",
                description=em.evidence_description or f"Required {evidence_type} documentation",
                artifact_type=evidence_type,
                format_guidance=None,
                frequency="annual",
                is_required=em.is_required if em.is_required is not None else True
            )
            db.add(curated_item)
            evidence_synced += 1
    
    db.commit()
    
    return {
        "message": f"Successfully synced evidence requirements",
        "framework_id": framework_id,
        "published_framework_id": uploaded_framework.published_framework_id,
        "evidence_synced": evidence_synced
    }


publish_router = router
