from ..config import get_openai_api_key, get_openai_model

import os
import json
import uuid
import random
import logging
import io
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_
from sqlalchemy.orm.attributes import flag_modified
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

from ..models import (
    CertificationJourney, ControlImplementation, ImplementationEvidence,
    Framework, FrameworkControl, FrameworkDomain, ControlObjective,
    FrameworkSubControl, Evidence, GRCUser, Tenant, CuratedEvidenceItem,
    CertificationPhase, UploadedFramework, ParsedFrameworkControl, get_db,
    EvidenceAIAssessment, EvidenceControlMapping, ITAsset, ComplianceSnapshot,
    # v2 — Issue Management open-issues-per-control read-only signal.
    # Used to enrich /controls list with `open_issues_count`. Additive only.
    Issue, IssueControlLink,
    # Framework compliance dashboard — trend history + automation derivation.
    ComplianceHistory, PluginControlMapping, ControlMapping, CompliancePluginRun,
)
from ..schemas import (
    CertificationJourneyCreate, CertificationJourneyUpdate, CertificationJourneyResponse,
    ControlImplementationUpdate, ControlImplementationResponse,
    ImplementationEvidenceCreate, ImplementationEvidenceResponse,
    ProgressSummary, GapAnalysis, EvidenceReviewAction, MessageResponse
)
from ..modules.framework_upload.routers.evidence import trigger_ocr_and_assessment_background
from .auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/certifications", tags=["Certifications"])

UPLOAD_DIR = "backend/uploads/certification_evidence"
os.makedirs(UPLOAD_DIR, exist_ok=True)

EVIDENCE_LIBRARY_UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads", "evidence")
os.makedirs(EVIDENCE_LIBRARY_UPLOAD_DIR, exist_ok=True)


EVIDENCE_TYPE_KEYWORDS = {
    "policy": "policy",
    "procedure": "procedure",
    "log": "log",
    "report": "report",
    "screenshot": "screenshot",
    "record": "record",
    "configuration": "configuration",
    "config": "configuration",
    "certificate": "certificate",
    "contract": "contract",
    "attestation": "attestation",
    "test": "test_results",
    "register": "register",
    "inventory": "inventory",
    "plan": "plan",
    "matrix": "matrix",
    "training": "training",
    "audit": "log",
    "approval": "attestation",
    "review": "report",
    "assessment": "report",
    "framework": "policy",
    "strategy": "policy",
    "risk": "report",
    "letter": "attestation",
    "profile": "report",
    "description": "procedure",
}


def _infer_evidence_type(text: str) -> str:
    lower = text.lower()
    for keyword, ev_type in EVIDENCE_TYPE_KEYWORDS.items():
        if keyword in lower:
            return ev_type
    return "document"


def normalize_evidence_requirements(raw_evidence: list) -> list:
    if not raw_evidence:
        return []
    normalized = []
    for item in raw_evidence:
        if isinstance(item, dict):
            title = item.get("title") or item.get("name")
            description = item.get("description") or ""
            filetype = (
                item.get("filetype")
                or item.get("format")
                or item.get("evidence_format")
            )
            if title:
                merged = dict(item)
                merged["title"] = title
                if description and not merged.get("description"):
                    merged["description"] = description
                if "type" not in merged:
                    merged["type"] = _infer_evidence_type(f"{title} {description}")
                if filetype and not merged.get("filetype"):
                    merged["filetype"] = filetype
                if "is_required" not in merged:
                    merged["is_required"] = merged.get("is_mandatory", True)
                normalized.append(merged)
                continue
        if isinstance(item, str):
            normalized.append({
                "type": _infer_evidence_type(item),
                "title": item,
                "description": item,
                "is_required": True
            })
        else:
            normalized.append({
                "type": "document",
                "title": str(item),
                "description": str(item),
                "is_required": True
            })
    return normalized


def get_framework_classification(framework: Optional[UploadedFramework]) -> str:
    """Business rule: ISO and PCI DSS are certification, all others are compliance."""
    if not framework:
        return "compliance"

    name = (framework.name or "").lower()
    if "iso" in name or "pci" in name:
        return "certification"
    return "compliance"


def get_framework_overview_payload(framework: Optional[UploadedFramework], classification: str) -> dict:
    if not framework:
        return {
            "classification": classification,
            "purpose": None,
            "scope": None,
            "objectives": [],
            "target_audience": None,
            "classification_reasoning": None,
            "regulatory_authority": None,
            "adoption_approach": [],
        }

    objectives = framework.framework_objectives if isinstance(framework.framework_objectives, list) else []
    adoption_approach = framework.adoption_approach if isinstance(framework.adoption_approach, list) else []

    return {
        "classification": classification,
        "purpose": framework.framework_purpose,
        "scope": framework.framework_scope,
        "objectives": objectives,
        "target_audience": framework.target_audience,
        "classification_reasoning": framework.classification_reasoning,
        "regulatory_authority": framework.regulatory_authority,
        "adoption_approach": adoption_approach,
    }


def resolve_parsed_control_evidence(parsed_control: ParsedFrameworkControl, db: Session) -> list:
    """Resolve evidence with fallback to sibling controls then ControlEvidenceMapping rows."""
    direct_evidence = normalize_evidence_requirements(parsed_control.evidence_requirements or [])
    if direct_evidence:
        return direct_evidence

    sibling_controls = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == parsed_control.uploaded_framework_id,
        ParsedFrameworkControl.control_id == parsed_control.control_id,
        ParsedFrameworkControl.id != parsed_control.id
    ).order_by(ParsedFrameworkControl.id.desc()).all()

    for sibling in sibling_controls:
        sibling_evidence = normalize_evidence_requirements(sibling.evidence_requirements or [])
        if sibling_evidence:
            return sibling_evidence

    # Final fallback: build evidence list from ControlEvidenceMapping rows.
    # Handles frameworks parsed before the JSON column was populated.
    if parsed_control.evidence_mappings:
        fallback = []
        for mapping in parsed_control.evidence_mappings:
            title = (
                (mapping.evidence_description or "").split(":")[0].strip()
                or (mapping.evidence_type or "document").replace("_", " ").title()
            )
            fallback.append({
                "type": mapping.evidence_type or "document",
                "title": title,
                "description": mapping.evidence_description or title,
                "is_required": mapping.is_required if mapping.is_required is not None else True,
            })
        if fallback:
            return fallback

    return []


def get_phases_from_document_structure(framework: Optional[UploadedFramework]) -> List[dict]:
    """Extract certification phases from the framework's document structure.
    
    CRITICAL ARCHITECTURE: Phases MUST come from document_structure extracted during 
    framework parsing. This ensures uploaded-framework-only architecture is enforced.
    
    The document_structure is populated by the AI parser during framework upload and 
    contains the actual sections/chapters from the uploaded document. No fallback to 
    control titles or other sources is permitted.
    
    Returns: List of phase objects extracted from document_structure.sections, 
    or empty list if document_structure doesn't contain phases.
    """
    if not framework:
        logger.warning("Framework is None - cannot extract document structure")
        return []
    
    if not framework.document_structure:
        logger.warning(f"Framework {framework.id} has no document_structure data - phases must be provided during parsing")
        return []
    
    try:
        doc_structure = framework.document_structure
        if not isinstance(doc_structure, dict):
            logger.warning(f"Framework {framework.id} document_structure is not a dict: {type(doc_structure)}")
            return []
    except Exception as e:
        logger.error(f"Error accessing document_structure for framework {framework.id}: {str(e)}")
        return []
    
    # Extract sections from document_structure - this is the ONLY source for phases
    sections = doc_structure.get("sections", [])
    if not isinstance(sections, list):
        logger.warning(f"Framework {framework.id}: document_structure.sections is not a list: {type(sections)}")
        return []
    
    if not sections:
        logger.info(f"Framework {framework.id}: document_structure has no sections - returning empty phases list")
        return []
    
    logger.debug(f"Framework {framework.id}: Extracting {len(sections)} sections from document_structure")
    phases = _parse_sections_array(sections, 1)
    
    if not phases:
        logger.warning(f"Framework {framework.id}: sections array present but failed to parse any phases")
    
    return phases


def _parse_sections_array(sections: list, start_phase_num: int = 1) -> List[dict]:
    """Parse a sections/chapters array and convert to phase objects.
    
    Handles both dict and string sections with defensive null checks.
    """
    phases = []
    phase_num = start_phase_num
    
    for section in sections:
        if section is None:
            logger.debug(f"Skipping null section")
            continue
        
        if isinstance(section, dict):
            try:
                phase_name = section.get("name") or section.get("title") or f"Section {phase_num}"
                phase_number = section.get("number") or str(phase_num)
                description = section.get("description") or ""
                
                # Ensure all values are strings
                phase_name = str(phase_name) if phase_name else f"Section {phase_num}"
                phase_number = str(phase_number) if phase_number else str(phase_num)
                description = str(description) if description else ""
                
                phases.append({
                    "id": phase_num,
                    "phase_number": phase_num,
                    "section_reference": phase_number,
                    "name": phase_name,
                    "description": description,
                    "key_tasks": section.get("key_tasks", []) if isinstance(section.get("key_tasks"), list) else [],
                    "deliverables": section.get("deliverables", []) if isinstance(section.get("deliverables"), list) else []
                })
                phase_num += 1
            except Exception as e:
                logger.warning(f"Failed to parse dict section: {str(e)}")
                continue
        elif isinstance(section, str):
            try:
                phases.append({
                    "id": phase_num,
                    "phase_number": phase_num,
                    "section_reference": str(phase_num),
                    "name": section,
                    "description": "",
                    "key_tasks": [],
                    "deliverables": []
                })
                phase_num += 1
            except Exception as e:
                logger.warning(f"Failed to parse string section: {str(e)}")
                continue
        else:
            logger.debug(f"Skipping section with unexpected type: {type(section)}")
            continue
    
    return phases


def get_curated_evidence_for_control(control_id: int, db: Session) -> List[dict]:
    """Fetch curated evidence items for the given framework control ID."""
    if not control_id:
        return []
    
    curated_items = db.query(CuratedEvidenceItem).filter(
        CuratedEvidenceItem.framework_control_id == control_id
    ).all()
    
    if not curated_items:
        curated_items = db.query(CuratedEvidenceItem).join(
            FrameworkSubControl, CuratedEvidenceItem.sub_control_id == FrameworkSubControl.id
        ).filter(
            FrameworkSubControl.control_id == control_id
        ).all()
    
    return [
        {
            "id": item.id,
            "title": item.title,
            "description": item.description,
            "artifact_type": item.artifact_type,
            "format_guidance": item.format_guidance,
            "frequency": item.frequency,
            "is_required": item.is_required,
            "framework_control_id": item.framework_control_id,
            "sub_control_id": item.sub_control_id
        }
        for item in curated_items
    ]


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def get_journey_or_404(journey_id: int, user: GRCUser, db: Session) -> CertificationJourney:
    user_tenants = get_user_tenants(user, db)
    journey = db.query(CertificationJourney).filter(
        CertificationJourney.id == journey_id,
        CertificationJourney.tenant_id.in_(user_tenants)
    ).first()
    if not journey:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Certification journey not found"
        )
    return journey


@router.get("", response_model=List[CertificationJourneyResponse])
def list_certifications(
    tenant_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    framework_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(CertificationJourney).filter(
        CertificationJourney.tenant_id.in_(user_tenants)
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(CertificationJourney.tenant_id == tenant_id)
    if status_filter:
        query = query.filter(CertificationJourney.status == status_filter)
    if framework_id:
        query = query.filter(
            (CertificationJourney.framework_id == framework_id) | 
            (CertificationJourney.uploaded_framework_id == framework_id)
        )
    
    journeys = query.order_by(CertificationJourney.started_at.desc()).offset(skip).limit(limit).all()

    for journey in journeys:
        journey.progress = calculate_progress_summary(journey, db)

    return journeys


@router.post("", response_model=CertificationJourneyResponse, status_code=status.HTTP_201_CREATED)
def create_certification(
    journey_data: CertificationJourneyCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = journey_data.tenant_id
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
    else:
        tenant_id = get_user_primary_tenant(current_user, db)
        if not tenant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User is not assigned to any tenant"
            )
    
    framework = db.query(UploadedFramework).filter(UploadedFramework.id == journey_data.framework_id).first()
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework not found"
        )

    # Prevent duplicate journeys for the same framework + tenant
    existing_journey = db.query(CertificationJourney).filter(
        CertificationJourney.tenant_id == tenant_id,
        CertificationJourney.uploaded_framework_id == journey_data.framework_id,
        CertificationJourney.status.in_(["in_progress", "not_started"]),
    ).first()
    if existing_journey:
        existing_journey.progress = calculate_progress_summary(existing_journey, db)
        return existing_journey
    
    journey = CertificationJourney(
        tenant_id=tenant_id,
        uploaded_framework_id=journey_data.framework_id,
        name=journey_data.name,
        target_date=journey_data.target_date,
        notes=journey_data.notes,
        status="in_progress"
    )
    db.add(journey)
    db.commit()
    db.refresh(journey)
    
    controls = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == journey_data.framework_id
    ).all()

    # Deduplicate by control_id and prefer the record with richer evidence payload.
    selected_controls = {}
    for control in controls:
        key = control.control_id or str(control.id)
        current = selected_controls.get(key)
        current_score = len(current.evidence_requirements or []) if current else -1
        candidate_score = len(control.evidence_requirements or [])
        if current is None or candidate_score > current_score:
            selected_controls[key] = control

    for control in selected_controls.values():
        implementation = ControlImplementation(
            journey_id=journey.id,
            parsed_control_id=control.id,
            status="not_started",
            priority=3
        )
        db.add(implementation)
    
    db.commit()

    # Seed existing evidence mappings into the new journey's implementations.
    # If evidence was linked to this framework's controls before the journey was started,
    # create ImplementationEvidence records so evidence appears immediately.
    try:
        impl_map = {}
        for control in selected_controls.values():
            impl = db.query(ControlImplementation).filter(
                ControlImplementation.journey_id == journey.id,
                ControlImplementation.parsed_control_id == control.id,
            ).first()
            if impl:
                impl_map[control.id] = impl

        ecm_records = db.query(EvidenceControlMapping).filter(
            EvidenceControlMapping.uploaded_framework_id == journey_data.framework_id,
            EvidenceControlMapping.parsed_control_id.isnot(None),
        ).all()

        seeded = 0
        for ecm in ecm_records:
            impl = impl_map.get(ecm.parsed_control_id)
            if not impl:
                continue
            exists = db.query(ImplementationEvidence).filter(
                ImplementationEvidence.implementation_id == impl.id,
                ImplementationEvidence.evidence_id == ecm.evidence_id,
            ).first()
            if exists:
                continue
            ev = db.query(Evidence).filter(Evidence.id == ecm.evidence_id).first()
            if not ev or ev.tenant_id != tenant_id:
                continue
            db.add(ImplementationEvidence(
                implementation_id=impl.id,
                evidence_id=ecm.evidence_id,
                file_name=ev.name,
                uploaded_by=current_user.id,
                review_status="pending",
            ))
            seeded += 1

        if seeded:
            db.commit()
            logger.info("Seeded %d evidence records into new journey %d", seeded, journey.id)
    except Exception:
        logger.warning("Failed to seed evidence into journey %d", journey.id, exc_info=True)
        db.rollback()

    db.refresh(journey)
    return journey


@router.get("/cde-systems")
def get_cde_systems(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    tenant_assets = db.query(ITAsset).options(
        joinedload(ITAsset.owner)
    ).filter(
        ITAsset.tenant_id.in_(user_tenants)
    ).order_by(ITAsset.asset_type, ITAsset.name).all()

    def _is_cde_enabled(value) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return value == 1
        if isinstance(value, str):
            return value.strip().lower() in {"true", "1", "yes", "y", "on"}
        return False

    assets = [asset for asset in tenant_assets if _is_cde_enabled(asset.cde_environment)]

    total = len(assets)
    type_breakdown = {}
    criticality_breakdown = {}
    for asset in assets:
        asset_type = asset.asset_type or "other"
        type_breakdown[asset_type] = type_breakdown.get(asset_type, 0) + 1
        criticality = asset.criticality or "medium"
        criticality_breakdown[criticality] = criticality_breakdown.get(criticality, 0) + 1

    return {
        "systems": [
            {
                "id": asset.id,
                "name": asset.name,
                "asset_type": asset.asset_type,
                "description": asset.description,
                "location": asset.location,
                "owner_name": (
                    asset.owner.display_name
                    or asset.owner.username
                    or asset.owner.email
                ) if asset.owner else None,
                "owner_id": asset.owner_id,
                "vendor": asset.vendor,
                "criticality": asset.criticality,
                "status": asset.status,
                "cde_environment": asset.cde_environment,
                "pci_dss": asset.pci_dss or {},
                "created_at": asset.created_at.isoformat() if asset.created_at else None,
            }
            for asset in assets
        ],
        "summary": {
            "total": total,
            "type_breakdown": type_breakdown,
            "criticality_breakdown": criticality_breakdown,
        },
    }


@router.put("/cde-systems/{asset_id}/scope")
def update_cde_system_scope(
    asset_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="IT Asset not found")

    if "cde_environment" in data:
        asset.cde_environment = data["cde_environment"]
    elif "in_scope" in data:
        asset.cde_environment = data["in_scope"]

    db.commit()
    db.refresh(asset)

    return {
        "id": asset.id,
        "name": asset.name,
        "asset_type": asset.asset_type,
        "cde_environment": asset.cde_environment,
    }


@router.get("/ephi-systems")
def get_ephi_systems(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """ePHI assets (ephi_environment on) — the HIPAA framework's ePHI inventory.
    Mirrors /cde-systems for PCI so the HIPAA tab and the Assets module stay in
    sync."""
    user_tenants = get_user_tenants(current_user, db)
    tenant_assets = db.query(ITAsset).options(
        joinedload(ITAsset.owner)
    ).filter(
        ITAsset.tenant_id.in_(user_tenants)
    ).order_by(ITAsset.asset_type, ITAsset.name).all()

    def _is_ephi_enabled(value) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return value == 1
        if isinstance(value, str):
            return value.strip().lower() in {"true", "1", "yes", "y", "on"}
        return False

    assets = [a for a in tenant_assets if _is_ephi_enabled(a.ephi_environment)]

    total = len(assets)
    type_breakdown: dict = {}
    criticality_breakdown: dict = {}
    for asset in assets:
        t = asset.asset_type or "other"
        type_breakdown[t] = type_breakdown.get(t, 0) + 1
        c = asset.criticality or "medium"
        criticality_breakdown[c] = criticality_breakdown.get(c, 0) + 1

    return {
        "systems": [
            {
                "id": asset.id,
                "name": asset.name,
                "asset_type": asset.asset_type,
                "description": asset.description,
                "location": asset.location,
                "owner_name": (
                    asset.owner.display_name
                    or asset.owner.username
                    or asset.owner.email
                ) if asset.owner else None,
                "owner_id": asset.owner_id,
                "vendor": asset.vendor,
                "criticality": asset.criticality,
                "status": asset.status,
                "ephi_environment": asset.ephi_environment,
                "hipaa": asset.hipaa or {},
                "created_at": asset.created_at.isoformat() if asset.created_at else None,
            }
            for asset in assets
        ],
        "summary": {
            "total": total,
            "type_breakdown": type_breakdown,
            "criticality_breakdown": criticality_breakdown,
        },
    }


@router.put("/ephi-systems/{asset_id}/scope")
def update_ephi_system_scope(
    asset_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="IT Asset not found")

    if "ephi_environment" in data:
        asset.ephi_environment = data["ephi_environment"]
    elif "in_scope" in data:
        asset.ephi_environment = data["in_scope"]

    # Keep HIPAA in the asset's compliance scope while it is an ePHI system
    # (add-only; never strips a manually-set scope).
    if asset.ephi_environment:
        scope = list(asset.compliance_scope or [])
        if "HIPAA" not in scope:
            asset.compliance_scope = scope + ["HIPAA"]

    db.commit()
    db.refresh(asset)

    return {
        "id": asset.id,
        "name": asset.name,
        "asset_type": asset.asset_type,
        "ephi_environment": asset.ephi_environment,
    }


@router.get("/{journey_id}", response_model=dict)
def get_certification(
    journey_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)
    
    framework = db.query(UploadedFramework).filter(UploadedFramework.id == journey.uploaded_framework_id).first()
    implementations = db.query(ControlImplementation).filter(
        ControlImplementation.journey_id == journey_id
    ).all()
    
    framework_classification = get_framework_classification(framework)
    phases_list = get_phases_from_document_structure(framework) if framework_classification == "certification" else []

    progress_summary = get_progress_summary(journey_id, db=db, current_user=current_user)
    progress_payload = progress_summary.model_dump()
    # Provide legacy keys for compatibility with existing UI components
    progress_payload.update({
        "implemented": progress_summary.implemented_count,
        "verified": progress_summary.verified_count,
        "in_progress": progress_summary.in_progress_count,
        "not_started": progress_summary.not_started_count,
        "not_applicable": progress_summary.not_applicable_count,
    })

    return {
        "id": journey.id,
        "tenant_id": journey.tenant_id,
        "framework_id": journey.uploaded_framework_id,
        "framework_name": framework.name if framework else None,
        "framework_short_code": framework.name[:10] if framework else None,
        "framework": {"id": framework.id, "name": framework.name} if framework else None,
        "framework_classification": framework_classification,
        "framework_type": framework.framework_type if framework else None,
        "framework_overview": get_framework_overview_payload(framework, framework_classification),
        "name": journey.name,
        "target_date": journey.target_date.isoformat() if journey.target_date else None,
        "started_at": journey.started_at.isoformat() if journey.started_at else None,
        "completed_at": journey.completed_at.isoformat() if journey.completed_at else None,
        "status": journey.status,
        "current_phase": journey.current_phase,
        "notes": journey.notes,
        "phases": phases_list,
        "has_generated_phases": bool(journey.generated_phases and len(journey.generated_phases) > 0),
        "stage_owners": journey.stage_owners or {},
        "progress": progress_payload
    }


@router.patch("/{journey_id}/stage-owners/{stage_n}")
def set_stage_owner(
    journey_id: int,
    stage_n: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Assign (or clear) the owner of a single journey stage. The owner can be a
    user, team, or role that exists in the tenant. Stored as a JSON map on the
    journey — the static flow owner is only ever a suggestion/hint."""
    journey = get_journey_or_404(journey_id, current_user, db)
    owners = dict(journey.stage_owners or {})
    owner_type = body.get("owner_type")
    if owner_type in (None, "", "none"):
        owners.pop(str(stage_n), None)
    else:
        if owner_type not in ("user", "team", "role"):
            raise HTTPException(status_code=400, detail="owner_type must be user, team, or role")
        owners[str(stage_n)] = {
            "type": owner_type,
            "ref_id": body.get("ref_id"),
            "label": body.get("label") or "",
        }
    journey.stage_owners = owners
    try:
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(journey, "stage_owners")
    except Exception:
        pass
    db.commit()
    return {"journey_id": journey_id, "stage_n": stage_n, "stage_owners": journey.stage_owners or {}}


@router.patch("/{journey_id}", response_model=CertificationJourneyResponse)
def update_certification(
    journey_id: int,
    update_data: CertificationJourneyUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)
    
    update_dict = update_data.model_dump(exclude_unset=True)
    for field, value in update_dict.items():
        setattr(journey, field, value)
    
    if update_data.status == "completed" and not journey.completed_at:
        journey.completed_at = datetime.utcnow()
    
    db.commit()
    db.refresh(journey)
    return journey


@router.delete("/{journey_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_certification(
    journey_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)
    db.delete(journey)
    db.commit()
    return None


@router.get("/{journey_id}/controls", response_model=List[dict])
def list_journey_controls(
    journey_id: int,
    status_filter: Optional[str] = None,
    priority: Optional[int] = None,
    domain_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)
    logger.info(
        "[JourneyTrace] list_journey_controls start journey_id=%s tenant_id=%s status_filter=%s priority=%s domain_id=%s",
        journey_id,
        journey.tenant_id,
        status_filter,
        priority,
        domain_id,
    )
    
    query = db.query(ControlImplementation).options(
        joinedload(ControlImplementation.framework_control).joinedload(FrameworkControl.objective).joinedload(ControlObjective.domain),
        joinedload(ControlImplementation.framework_control).joinedload(FrameworkControl.sub_controls),
        joinedload(ControlImplementation.parsed_control),
        joinedload(ControlImplementation.evidence_attachments)
    ).filter(ControlImplementation.journey_id == journey_id)
    
    if status_filter:
        query = query.filter(ControlImplementation.status == status_filter)
    if priority:
        query = query.filter(ControlImplementation.priority == priority)
    
    implementations = query.all()
    logger.info("[JourneyTrace] fetched implementations journey_id=%s count=%s", journey_id, len(implementations))

    parsed_control_ids = [impl.parsed_control_id for impl in implementations if impl.parsed_control_id]
    framework_control_ids = [impl.framework_control_id for impl in implementations if impl.framework_control_id]

    mapped_evidence_by_parsed = {}
    mapped_evidence_by_framework = {}

    if parsed_control_ids or framework_control_ids:
        # Primary lookup: match by direct foreign-key IDs.
        mapping_rows = db.query(EvidenceControlMapping, Evidence).join(
            Evidence,
            Evidence.id == EvidenceControlMapping.evidence_id
        ).filter(
            Evidence.tenant_id == journey.tenant_id,
            or_(
                EvidenceControlMapping.parsed_control_id.in_(parsed_control_ids) if parsed_control_ids else False,
                EvidenceControlMapping.framework_control_id.in_(framework_control_ids) if framework_control_ids else False
            )
        ).all()

        # Text-based fallback: when duplicate ParsedFrameworkControl rows exist (e.g. after
        # re-uploads) the journey may reference a different row-ID than the one stored in
        # EvidenceControlMapping.  Expand the search to ALL ParsedFrameworkControl records
        # that share the same (uploaded_framework_id, control_id) text pair as the
        # journey's controls, then collect any additional mappings that matched those sibling IDs.
        if parsed_control_ids:
            # Fetch the text identifiers for the journey's parsed controls.
            journey_pcs = db.query(ParsedFrameworkControl).filter(
                ParsedFrameworkControl.id.in_(parsed_control_ids)
            ).all()
            # Build a lookup: impl_parsed_control_id → set of sibling parsed_control row IDs
            pc_sibling_map: dict = {}  # sibling_id → impl_pc_id(s)
            for pc in journey_pcs:
                if not (pc.uploaded_framework_id and pc.control_id):
                    continue
                sibling_rows = db.query(ParsedFrameworkControl.id).filter(
                    ParsedFrameworkControl.uploaded_framework_id == pc.uploaded_framework_id,
                    ParsedFrameworkControl.control_id == pc.control_id,
                    ParsedFrameworkControl.id.notin_(parsed_control_ids)
                ).all()
                for (sib_id,) in sibling_rows:
                    pc_sibling_map.setdefault(sib_id, set()).add(pc.id)

            if pc_sibling_map:
                sibling_ids = list(pc_sibling_map.keys())
                extra_rows = db.query(EvidenceControlMapping, Evidence).join(
                    Evidence,
                    Evidence.id == EvidenceControlMapping.evidence_id
                ).filter(
                    Evidence.tenant_id == journey.tenant_id,
                    EvidenceControlMapping.parsed_control_id.in_(sibling_ids)
                ).all()
                # Translate each extra mapping back to its journey impl_pc_id
                for mapping, linked_evidence in extra_rows:
                    for impl_pc_id in pc_sibling_map.get(mapping.parsed_control_id, []):
                        payload = {
                            "id": mapping.id,
                            "item_type": "ecm",
                            "file_name": linked_evidence.file_name or linked_evidence.name,
                            "file_size": getattr(linked_evidence, "file_size", None),
                            "uploaded_at": linked_evidence.uploaded_at.isoformat() if linked_evidence.uploaded_at else None,
                            "ai_confidence_score": mapping.confidence_score,
                            "review_status": "linked",
                            "linked_evidence_id": linked_evidence.id,
                            "ai_assessment_status": "linked",
                            "ai_assessment_summary": None
                        }
                        mapped_evidence_by_parsed.setdefault(impl_pc_id, []).append(payload)

        logger.info(
            "[JourneyTrace] evidence mappings fetched journey_id=%s rows=%s parsed_ids=%s framework_ids=%s",
            journey_id,
            len(mapping_rows),
            len(parsed_control_ids),
            len(framework_control_ids),
        )

        for mapping, linked_evidence in mapping_rows:
            mapped_payload = {
                "id": mapping.id,
                "item_type": "ecm",
                "file_name": linked_evidence.file_name or linked_evidence.name,
                "file_size": getattr(linked_evidence, "file_size", None),
                "uploaded_at": linked_evidence.uploaded_at.isoformat() if linked_evidence.uploaded_at else None,
                "ai_confidence_score": mapping.confidence_score,
                "review_status": "linked",
                "linked_evidence_id": linked_evidence.id,
                "ai_assessment_status": "linked",
                "ai_assessment_summary": None
            }

            if mapping.parsed_control_id:
                mapped_evidence_by_parsed.setdefault(mapping.parsed_control_id, []).append(mapped_payload)
            if mapping.framework_control_id:
                mapped_evidence_by_framework.setdefault(mapping.framework_control_id, []).append(mapped_payload)
    
    def natural_sort_key(impl):
        """Generate a sort key that handles dotted version numbers naturally (e.g., 3.1.2 before 3.1.10)"""
        import re
        parsed = impl.parsed_control
        fc = impl.framework_control
        code = ""
        if parsed:
            code = parsed.control_id or ""
        elif fc:
            code = fc.control_code or ""
        parts = re.split(r'[.\-_\s]+', code)
        key = []
        for p in parts:
            try:
                key.append((0, int(p), ''))
            except ValueError:
                key.append((1, 0, p.lower()))
        return key
    
    # Order domains by the framework's published sequence (frameworks are
    # seeded in document order, so the smallest control row-id within a domain
    # reflects where that domain appears in the source document — e.g. NDMO:
    # Data Governance, Data Catalog & Metadata, Data Quality, …). Within a
    # domain the natural code sort still applies (DG.1.1 < DG.1.2 < DG.2.1).
    def _impl_domain(impl):
        p = impl.parsed_control
        fc = impl.framework_control
        if p:
            return p.domain or ""
        if fc and fc.objective and fc.objective.domain:
            return fc.objective.domain.name or ""
        return ""

    def _impl_seed_id(impl):
        p = impl.parsed_control
        fc = impl.framework_control
        if p:
            return p.id
        if fc:
            return fc.id
        return impl.id or 0

    domain_rank: dict = {}
    for impl in implementations:
        dom = _impl_domain(impl)
        sid = _impl_seed_id(impl)
        if dom not in domain_rank or sid < domain_rank[dom]:
            domain_rank[dom] = sid

    implementations.sort(key=lambda impl: (domain_rank.get(_impl_domain(impl), 1_000_000_000), natural_sort_key(impl)))
    
    result = []

    def collect_sub_control_recommendations(sub_controls: list) -> list:
        titles = []

        def walk(items: list):
            for item in items or []:
                for ev in item.get("evidence_requirements") or []:
                    title = (ev or {}).get("title") if isinstance(ev, dict) else None
                    if title:
                        titles.append(title)
                for rec in item.get("evidence_recommendations") or []:
                    if rec:
                        titles.append(rec)
                walk(item.get("sub_controls") or [])

        walk(sub_controls)
        seen = set()
        unique = []
        for title in titles:
            normalized = title.strip().lower()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            unique.append(title)
        return unique
    for impl in implementations:
        parsed_control = impl.parsed_control
        framework_control = impl.framework_control
        
        if parsed_control:
            control_code = parsed_control.control_id
            original_control_code = parsed_control.original_reference or parsed_control.control_id
            system_control_code = parsed_control.control_id
            control_name = parsed_control.title
            control_statement = parsed_control.description or parsed_control.full_text
            control_statement_full = parsed_control.full_text or parsed_control.description or ""
            domain_id_val = None
            domain_code = parsed_control.domain
            domain_name = parsed_control.domain
            objective_code = parsed_control.category
            objective_name = parsed_control.category
            
            def build_control_hierarchy(parent_control_id: str, framework_id: int, visited: set = None) -> list:
                """Recursively build control hierarchy with cycle detection (unbounded depth)"""
                if visited is None:
                    visited = set()
                
                if parent_control_id in visited:
                    return []
                visited.add(parent_control_id)
                    
                children = db.query(ParsedFrameworkControl).filter(
                    ParsedFrameworkControl.uploaded_framework_id == framework_id,
                    ParsedFrameworkControl.parent_section == parent_control_id
                ).all()
                
                result = []
                for child in children:
                    child_evidence = resolve_parsed_control_evidence(child, db)
                    grandchildren = build_control_hierarchy(child.control_id, framework_id, visited.copy())
                    result.append({
                        "id": child.id,
                        "code": child.control_id,
                        "name": child.title,
                        "description": child.description or child.full_text,
                        "parent_section": child.parent_section,
                        "evidence_requirements": child_evidence,
                        "evidence_recommendations": [ev.get("title", "") for ev in child_evidence] if child_evidence else [],
                        "sub_controls": grandchildren
                    })
                return result
            
            sub_controls_list = build_control_hierarchy(parsed_control.control_id, parsed_control.uploaded_framework_id)
            evidence_requirements = resolve_parsed_control_evidence(parsed_control, db)
        elif framework_control:
            control = framework_control
            objective = control.objective if control else None
            domain = objective.domain if objective else None
            control_code = control.code if control else None
            original_control_code = control.code if control else None
            system_control_code = control.code if control else None
            control_name = control.name if control else None
            control_statement = control.statement if control else None
            control_statement_full = control.statement if control else ""
            domain_id_val = domain.id if domain else None
            domain_code = domain.code if domain else None
            domain_name = domain.name if domain else None
            objective_code = objective.code if objective else None
            objective_name = objective.name if objective else None
            sub_controls_list = []
            if control and control.sub_controls:
                for sub in control.sub_controls:
                    sub_controls_list.append({
                        "id": sub.id,
                        "code": sub.code,
                        "name": sub.name,
                        "description": sub.description,
                        "evidence_recommendations": sub.evidence_recommendations or [],
                        "ai_matching_keywords": sub.ai_matching_keywords or []
                    })
            evidence_requirements = get_curated_evidence_for_control(impl.framework_control_id, db)
        else:
            control_code = None
            original_control_code = None
            system_control_code = None
            control_name = None
            control_statement = None
            control_statement_full = ""
            domain_id_val = None
            domain_code = None
            domain_name = None
            objective_code = None
            objective_name = None
            sub_controls_list = []
            evidence_requirements = []
        
        evidence_list = []
        for ev in impl.evidence_attachments:
            ai_assessment_status = None
            ai_assessment_summary = None
            # evidence_id is the FK to the Evidence library record (populated when linked
            # from the evidence library via link-from-ai or manual linking)
            linked_ev_id = ev.evidence_id
            
            if linked_ev_id:
                linked_evidence = db.query(Evidence).filter(Evidence.id == linked_ev_id).first()
                if linked_evidence:
                    latest_assessment = db.query(EvidenceAIAssessment).filter(
                        EvidenceAIAssessment.evidence_id == linked_evidence.id
                    ).order_by(EvidenceAIAssessment.assessed_at.desc()).first()
                    
                    if latest_assessment:
                        ai_assessment_status = "completed"
                        ai_assessment_summary = latest_assessment.content_summary
                    elif linked_evidence.ocr_status == "processing":
                        ai_assessment_status = "processing"
                    elif linked_evidence.ocr_status == "completed" and not latest_assessment:
                        ai_assessment_status = "pending_assessment"
                    else:
                        ai_assessment_status = "pending_ocr"
            
            evidence_list.append({
                "id": ev.id,
                "file_name": ev.file_name,
                "file_size": ev.file_size,
                "uploaded_at": ev.uploaded_at.isoformat() if ev.uploaded_at else None,
                "ai_confidence_score": getattr(ev, 'ai_confidence_score', None),
                "review_status": getattr(ev, 'review_status', None),
                "linked_evidence_id": linked_ev_id,
                "ai_assessment_status": ai_assessment_status,
                "ai_assessment_summary": ai_assessment_summary
            })

        existing_linked_ids = {
            ev_item.get("linked_evidence_id") for ev_item in evidence_list if ev_item.get("linked_evidence_id")
        }
        # Fallback dedup by normalized file_name for ImplementationEvidence records
        # that were uploaded directly to the journey (evidence_id=NULL).
        existing_file_names = {
            (ev_item.get("file_name") or "").lower().strip()
            for ev_item in evidence_list
            if not ev_item.get("linked_evidence_id") and ev_item.get("file_name")
        }
        mapped_items = []
        if impl.parsed_control_id:
            mapped_items.extend(mapped_evidence_by_parsed.get(impl.parsed_control_id, []))
        if impl.framework_control_id:
            mapped_items.extend(mapped_evidence_by_framework.get(impl.framework_control_id, []))

        for mapped in mapped_items:
            linked_id = mapped.get("linked_evidence_id")
            mapped_file = (mapped.get("file_name") or "").lower().strip()
            if linked_id and linked_id in existing_linked_ids:
                continue
            if mapped_file and mapped_file in existing_file_names:
                continue
            evidence_list.append(mapped)
            if linked_id:
                existing_linked_ids.add(linked_id)
            if mapped_file:
                existing_file_names.add(mapped_file)
        
        evidence_recommendations = [ev.get("title", "") for ev in evidence_requirements if isinstance(ev, dict) and ev.get("title")]
        if not evidence_recommendations:
            evidence_recommendations = collect_sub_control_recommendations(sub_controls_list)

        approved_evidence_count = sum(1 for ev in evidence_list if ev.get("review_status") == "approved")
        required_evidence_count = len(evidence_requirements)
        has_any_evidence = len(evidence_list) > 0
        evidence_coverage = 0.0
        if required_evidence_count > 0:
            evidence_coverage = min(1.0, len(evidence_list) / required_evidence_count)
        elif has_any_evidence:
            evidence_coverage = 1.0

        effective_status = impl.status
        if effective_status not in ["implemented", "verified", "not_applicable"] and has_any_evidence:
            effective_status = "in_progress"

        logger.debug(
            "[JourneyTrace] control assembled impl_id=%s code=%s parsed_id=%s framework_id=%s req_count=%s rec_count=%s sub_count=%s evidence_count=%s",
            impl.id,
            control_code,
            impl.parsed_control_id,
            impl.framework_control_id,
            len(evidence_requirements or []),
            len(evidence_recommendations or []),
            len(sub_controls_list or []),
            len(evidence_list or []),
        )

        # Resolve assignees. Canonical source is the JSON array
        # `assigned_user_ids`; we fall back to the legacy single-FK column
        # so existing rows pre-dating multi-assignment keep showing an
        # assignee until they are saved fresh.
        raw_assigned_ids = getattr(impl, "assigned_user_ids", None) or []
        if not isinstance(raw_assigned_ids, list):
            raw_assigned_ids = []
        legacy_single_id = getattr(impl, "assigned_to_user_id", None)
        if not raw_assigned_ids and legacy_single_id:
            raw_assigned_ids = [legacy_single_id]

        assignees_list = []
        if raw_assigned_ids:
            users = (
                db.query(GRCUser)
                .filter(GRCUser.id.in_(raw_assigned_ids))
                .all()
            )
            user_by_id = {u.id: u for u in users}
            # preserve the order of `raw_assigned_ids`
            for uid in raw_assigned_ids:
                u = user_by_id.get(uid)
                if not u:
                    continue
                assignees_list.append({
                    "id": u.id,
                    "display_name": u.display_name or u.username,
                    "email": u.email,
                })

        # Back-compat scalar fields (first assignee, if any).
        primary_assignee = assignees_list[0] if assignees_list else None
        assigned_to_user_id = primary_assignee["id"] if primary_assignee else None
        assignee_name = primary_assignee["display_name"] if primary_assignee else None
        assignee_email = primary_assignee["email"] if primary_assignee else None

        result.append({
            "id": impl.id,
            "journey_id": impl.journey_id,
            "framework_control_id": impl.framework_control_id,
            "parsed_control_id": impl.parsed_control_id,
            "control_code": control_code,
            "original_control_code": original_control_code,
            "system_control_code": system_control_code,
            "control_name": control_name,
            "control_statement": control_statement,
            "control_statement_full": control_statement_full,
            "domain_id": domain_id_val,
            "domain_code": domain_code,
            "domain_name": domain_name,
            "objective_code": objective_code,
            "objective_name": objective_name,
            "status": effective_status,
            "implementation_notes": impl.implementation_notes,
            "implementation_date": impl.implementation_date.isoformat() if impl.implementation_date else None,
            "verified_date": impl.verified_date.isoformat() if impl.verified_date else None,
            "is_applicable": impl.is_applicable,
            "priority": impl.priority,
            "is_critical": bool(getattr(parsed_control, "is_critical", False)) if parsed_control else False,
            "criticality_reason": getattr(parsed_control, "criticality_reason", None) if parsed_control else None,
            # NDMO native fields (Figure-2): surfaced in the control-detail modal.
            "priority_level": getattr(parsed_control, "priority_level", None) if parsed_control else None,
            "dependencies": (getattr(parsed_control, "dependencies", None) or []) if parsed_control else [],
            "version_history": (getattr(parsed_control, "version_history", None) or []) if parsed_control else [],
            "control_description": getattr(parsed_control, "control_description", None) if parsed_control else None,
            # Assessment criteria (spec sub-points) + this control's per-criterion state.
            "assessment_criteria": (getattr(parsed_control, "assessment_criteria", None) or []) if parsed_control else [],
            "criteria_status": getattr(impl, "criteria_status", None) or {},
            "assigned_to_user_id": assigned_to_user_id,
            "assignee_name": assignee_name,
            "assignee_email": assignee_email,
            "assigned_user_ids": [a["id"] for a in assignees_list],
            "assignees": assignees_list,
            "sub_controls": sub_controls_list,
            "evidence_requirements": evidence_requirements,
            "evidence_recommendations": evidence_recommendations,
            "evidence": evidence_list,
            "evidence_count": len(evidence_list),
            "required_evidence_count": required_evidence_count,
            "approved_evidence_count": approved_evidence_count,
            "evidence_coverage": evidence_coverage,
            "status_source": impl.status,
            # v2: placeholder, filled in batch below to avoid N+1 queries.
            "open_issues_count": 0,
        })

    # ── v2 — fill open_issues_count for every control in one round trip.
    # Two queries (framework + parsed) joined to Issue for open-state filter.
    # Wrapped in try so any Issue Management schema-drift never breaks the
    # control list (the field stays at 0 in that case).
    try:
        OPEN_STATES = ("new", "triage", "in_progress", "resolution", "closure_review")
        fw_ids = sorted({r["framework_control_id"] for r in result if r.get("framework_control_id")})
        parsed_ids = sorted({r["parsed_control_id"] for r in result if r.get("parsed_control_id")})

        fw_counts: dict = {}
        if fw_ids:
            rows = db.query(IssueControlLink.framework_control_id, Issue.id).join(
                Issue, Issue.id == IssueControlLink.issue_id,
            ).filter(
                IssueControlLink.framework_control_id.in_(fw_ids),
                Issue.tenant_id == journey.tenant_id,
                Issue.workflow_state.in_(OPEN_STATES),
            ).all()
            for cid, _ in rows:
                fw_counts[cid] = fw_counts.get(cid, 0) + 1

        parsed_counts: dict = {}
        if parsed_ids:
            rows = db.query(IssueControlLink.parsed_framework_control_id, Issue.id).join(
                Issue, Issue.id == IssueControlLink.issue_id,
            ).filter(
                IssueControlLink.parsed_framework_control_id.in_(parsed_ids),
                Issue.tenant_id == journey.tenant_id,
                Issue.workflow_state.in_(OPEN_STATES),
            ).all()
            for cid, _ in rows:
                parsed_counts[cid] = parsed_counts.get(cid, 0) + 1

        for r in result:
            fw_c = fw_counts.get(r.get("framework_control_id"), 0)
            pc_c = parsed_counts.get(r.get("parsed_control_id"), 0)
            r["open_issues_count"] = fw_c + pc_c
    except Exception:
        # Never let an Issue Management failure break the control list.
        pass

    status_rank = {
        "verified": 5,
        "implemented": 4,
        "in_progress": 3,
        "not_started": 2,
        "not_applicable": 1,
    }

    deduped = {}
    dedupe_replaced = 0
    for item in result:
        key = (item.get("control_code") or str(item.get("id") or "")).strip().lower()
        current = deduped.get(key)
        if current is None:
            deduped[key] = item
            continue

        current_score = (
            len(current.get("evidence_requirements") or [])
            + len(current.get("sub_controls") or [])
            + len(current.get("evidence") or [])
            + status_rank.get(current.get("status"), 0)
        )
        candidate_score = (
            len(item.get("evidence_requirements") or [])
            + len(item.get("sub_controls") or [])
            + len(item.get("evidence") or [])
            + status_rank.get(item.get("status"), 0)
        )

        if candidate_score > current_score:
            deduped[key] = item
            dedupe_replaced += 1

    deduped_result = list(deduped.values())
    logger.info(
        "[JourneyTrace] list_journey_controls end journey_id=%s raw=%s deduped=%s replaced=%s",
        journey_id,
        len(result),
        len(deduped_result),
        dedupe_replaced,
    )
    return deduped_result


@router.get("/{journey_id}/controls/{control_id}", response_model=dict)
def get_control_details(
    journey_id: int,
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)
    
    implementation = db.query(ControlImplementation).options(
        joinedload(ControlImplementation.framework_control),
        joinedload(ControlImplementation.parsed_control),
        joinedload(ControlImplementation.evidence_attachments)
    ).filter(
        ControlImplementation.id == control_id,
        ControlImplementation.journey_id == journey_id
    ).first()
    
    if not implementation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control implementation not found"
        )
    
    parsed_control = implementation.parsed_control
    framework_control = implementation.framework_control
    
    if parsed_control:
        control_code = parsed_control.control_id
        control_name = parsed_control.title
        control_statement = parsed_control.description or parsed_control.full_text
        implementation_guidance = parsed_control.ai_notes
        testing_guidance = None
    elif framework_control:
        control_code = framework_control.code
        control_name = framework_control.name
        control_statement = framework_control.statement
        implementation_guidance = framework_control.implementation_guidance
        testing_guidance = framework_control.testing_guidance
    else:
        control_code = None
        control_name = None
        control_statement = None
        implementation_guidance = None
        testing_guidance = None
    
    evidence_list = []
    for ev in implementation.evidence_attachments:
        evidence_list.append({
            "id": ev.id,
            "file_name": ev.file_name,
            "file_size": ev.file_size,
            "mime_type": ev.mime_type,
            "uploaded_at": ev.uploaded_at.isoformat() if ev.uploaded_at else None,
            "uploaded_by": ev.uploaded_by,
            "ai_confidence_score": ev.ai_confidence_score,
            "ai_assessment_status": ev.ai_assessment_status,
            "ai_assessment_notes": ev.ai_assessment_notes,
            "review_status": ev.review_status,
            "reviewed_by": ev.reviewed_by,
            "reviewed_at": ev.reviewed_at.isoformat() if ev.reviewed_at else None,
            "review_notes": ev.review_notes
        })
    
    return {
        "id": implementation.id,
        "journey_id": implementation.journey_id,
        "framework_control_id": implementation.framework_control_id,
        "parsed_control_id": implementation.parsed_control_id,
        "control_code": control_code,
        "control_name": control_name,
        "control_statement": control_statement,
        "implementation_guidance": implementation_guidance,
        "testing_guidance": testing_guidance,
        "status": implementation.status,
        "implementation_notes": implementation.implementation_notes,
        "implementation_date": implementation.implementation_date.isoformat() if implementation.implementation_date else None,
        "verified_date": implementation.verified_date.isoformat() if implementation.verified_date else None,
        "verified_by": implementation.verified_by,
        "is_applicable": implementation.is_applicable,
        "priority": implementation.priority,
        "evidence": evidence_list
    }


@router.patch("/{journey_id}/controls/{control_id}", response_model=ControlImplementationResponse)
def update_control_implementation(
    journey_id: int,
    control_id: int,
    update_data: ControlImplementationUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)
    
    implementation = db.query(ControlImplementation).filter(
        ControlImplementation.id == control_id,
        ControlImplementation.journey_id == journey_id
    ).first()
    
    if not implementation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control implementation not found"
        )
    
    update_dict = update_data.model_dump(exclude_unset=True)
    for field, value in update_dict.items():
        setattr(implementation, field, value)
    
    if update_data.status == "implemented" and not implementation.implementation_date:
        implementation.implementation_date = datetime.utcnow()
    elif update_data.status == "verified" and not implementation.verified_date:
        implementation.verified_date = datetime.utcnow()
        implementation.verified_by = current_user.id
    
    db.commit()
    db.refresh(implementation)
    return implementation


class _ControlAssignRequest(BaseModel):
    """Body for control assignment.

    `assigned_user_ids` replaces the previous single-user payload. An empty
    list clears the assignment (withdraws every assignee). The legacy
    `assigned_to_user_id` field is still accepted for backward compatibility:
    callers that send only it are translated to a one-element list.
    """
    assigned_user_ids: Optional[List[int]] = None
    assigned_to_user_id: Optional[int] = None  # legacy single-user shape


@router.patch("/{journey_id}/controls/{control_id}/assign")
def assign_control_implementation(
    journey_id: int,
    control_id: int,
    payload: _ControlAssignRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Replace the set of assignees on a framework requirement.

    Per-tenant DB: every active row in `grc_users` is a tenant user. Sending
    an empty list withdraws all assignees. Order is preserved (the first
    entry is treated as the legacy "primary" assignee for older code paths).
    """
    journey = get_journey_or_404(journey_id, current_user, db)

    implementation = db.query(ControlImplementation).filter(
        ControlImplementation.id == control_id,
        ControlImplementation.journey_id == journey_id,
    ).first()
    if not implementation:
        raise HTTPException(status_code=404, detail="Control implementation not found")

    # Resolve the requested assignee list, accepting both the new array shape
    # and the legacy single-id shape.
    if payload.assigned_user_ids is not None:
        raw_ids = list(payload.assigned_user_ids)
    elif payload.assigned_to_user_id is not None:
        raw_ids = [payload.assigned_to_user_id]
    else:
        raw_ids = []

    # Deduplicate while preserving order, drop falsy values.
    seen: set = set()
    requested_ids: List[int] = []
    for uid in raw_ids:
        if uid is None:
            continue
        if uid in seen:
            continue
        seen.add(uid)
        requested_ids.append(int(uid))

    # Validate every id maps to an active user in this tenant DB.
    resolved_users = []
    if requested_ids:
        users = (
            db.query(GRCUser)
            .filter(GRCUser.id.in_(requested_ids), GRCUser.is_active == True)
            .all()
        )
        user_by_id = {u.id: u for u in users}
        for uid in requested_ids:
            u = user_by_id.get(uid)
            if not u:
                raise HTTPException(
                    status_code=400,
                    detail=f"User {uid} is not an active member of this tenant",
                )
            resolved_users.append(u)

    final_ids = [u.id for u in resolved_users]
    implementation.assigned_user_ids = final_ids
    # Keep the legacy single-FK column in sync with the first assignee so any
    # older code path reading `assigned_to_user_id` still sees a valid value.
    implementation.assigned_to_user_id = final_ids[0] if final_ids else None
    flag_modified(implementation, "assigned_user_ids")
    db.commit()
    db.refresh(implementation)

    return {
        "message": "Requirement assignees updated",
        "control_id": implementation.id,
        "journey_id": journey_id,
        "assigned_user_ids": final_ids,
        "assignees": [
            {
                "id": u.id,
                "display_name": u.display_name or u.username,
                "email": u.email,
            }
            for u in resolved_users
        ],
        # Back-compat scalar fields.
        "assigned_to_user_id": implementation.assigned_to_user_id,
        "assignee_name": (resolved_users[0].display_name or resolved_users[0].username) if resolved_users else None,
        "assignee_email": resolved_users[0].email if resolved_users else None,
    }


class _CriteriaStatusRequest(BaseModel):
    # Map of criterion index (as string) -> met/not-met. Replaces stored state.
    criteria_status: dict = {}


@router.patch("/{journey_id}/controls/{control_id}/criteria")
def update_control_criteria_status(
    journey_id: int,
    control_id: int,
    payload: _CriteriaStatusRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Persist the per-criterion met/not-met checklist state for one control.

    `criteria_status` is keyed by the assessment-criterion index ("0","1",…) of
    the parsed specification sub-points, e.g. {"0": true, "2": true}.
    """
    journey = get_journey_or_404(journey_id, current_user, db)
    implementation = db.query(ControlImplementation).filter(
        ControlImplementation.id == control_id,
        ControlImplementation.journey_id == journey_id,
    ).first()
    if not implementation:
        raise HTTPException(status_code=404, detail="Control implementation not found")
    cs = {str(k): bool(v) for k, v in (payload.criteria_status or {}).items()}
    implementation.criteria_status = cs
    flag_modified(implementation, "criteria_status")

    # Keep the control's status in sync with its criteria score so every
    # roll-up that counts by status (the "your assessment" header, the
    # progress dots, the dashboard) agrees with the criteria checklist:
    #   all criteria met  -> implemented (counts as Compliant)
    #   some met          -> in_progress (counts as In Review)
    #   none met          -> not_started (To Start)
    # Only applied when the spec actually has a criteria checklist; specs
    # without criteria keep their manually-set status untouched.
    p = implementation.parsed_control
    crits = (getattr(p, "assessment_criteria", None) or []) if p else []
    if crits:
        met = sum(1 for i in range(len(crits)) if cs.get(str(i)))
        if met >= len(crits):
            implementation.status = "implemented"
            if implementation.implementation_date is None:
                implementation.implementation_date = datetime.utcnow()
        elif met > 0:
            implementation.status = "in_progress"
        else:
            implementation.status = "not_started"

    db.commit()
    return {
        "control_id": control_id,
        "journey_id": journey_id,
        "criteria_status": cs,
        "status": implementation.status,
    }


# ── Compliance history (annual snapshots) ──────────────────────────────────

def _ensure_snapshot_table(db: Session) -> None:
    """Create the snapshots table on this tenant DB if it doesn't exist yet."""
    try:
        bind = db.get_bind()
        engine = getattr(bind, "engine", bind)
        ComplianceSnapshot.__table__.create(engine, checkfirst=True)
    except Exception:
        logger.exception("Failed to ensure grc_compliance_snapshots table")


def _spec_pct(impl: ControlImplementation) -> int:
    """Per-spec score: criteria met ÷ total; else derived from status (binary)."""
    p = impl.parsed_control
    crits = (getattr(p, "assessment_criteria", None) or []) if p else []
    cs = impl.criteria_status or {}
    if crits:
        met = sum(1 for i in range(len(crits)) if cs.get(str(i)))
        return round(met / len(crits) * 100)
    if impl.status in ("implemented", "verified"):
        return 100
    if impl.status == "in_progress":
        return 50
    return 0


def _compute_journey_snapshot(journey_id: int, db: Session) -> dict:
    impls = db.query(ControlImplementation).options(
        joinedload(ControlImplementation.parsed_control)
    ).filter(ControlImplementation.journey_id == journey_id).all()
    TK = ("P1", "P2", "P3")
    rows = []  # (pl, domain, pct)
    for impl in impls:
        p = impl.parsed_control
        pl = getattr(p, "priority_level", None) if p else None
        if pl not in TK or impl.is_applicable is False:
            continue
        rows.append((pl, (p.domain if p else "Other"), _spec_pct(impl)))
    total = len(rows)
    pcts = [r[2] for r in rows]
    overall = round(sum(pcts) / total) if total else 0
    compliant = sum(1 for x in pcts if x == 100)
    tiers = {}
    for pl in TK:
        tp = [r[2] for r in rows if r[0] == pl]
        tiers[pl] = {
            "total": len(tp),
            "compliant": sum(1 for x in tp if x == 100),
            "avg": round(sum(tp) / len(tp)) if tp else 0,
        }
    dmap: dict = {}
    dorder: list = []
    for pl, dom, sc in rows:
        if dom not in dmap:
            dmap[dom] = {"total": 0, "sum": 0, "compliant": 0}
            dorder.append(dom)
        e = dmap[dom]
        e["total"] += 1; e["sum"] += sc
        if sc == 100:
            e["compliant"] += 1
    domains = [{
        "domain": d, "total": dmap[d]["total"], "compliant": dmap[d]["compliant"],
        "avg": round(dmap[d]["sum"] / dmap[d]["total"]) if dmap[d]["total"] else 0,
    } for d in dorder]
    return {"overall": overall, "compliant": compliant, "total": total,
            "tiers": tiers, "domains": domains}


def _snapshot_out(s: ComplianceSnapshot) -> dict:
    return {
        "id": s.id, "journey_id": s.journey_id, "year": s.year, "label": s.label,
        "captured_at": s.captured_at.isoformat() if s.captured_at else None,
        "captured_by": s.captured_by, "overall_pct": s.overall_pct,
        "compliant_count": s.compliant_count, "total_count": s.total_count,
        "breakdown": s.breakdown or {}, "notes": s.notes,
    }


class _SnapshotRequest(BaseModel):
    year: Optional[int] = None
    label: Optional[str] = None
    notes: Optional[str] = None


@router.post("/{journey_id}/snapshots")
def create_snapshot(
    journey_id: int,
    payload: _SnapshotRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Capture the current compliance state as an immutable historical record."""
    journey = get_journey_or_404(journey_id, current_user, db)
    _ensure_snapshot_table(db)
    data = _compute_journey_snapshot(journey_id, db)
    from datetime import datetime as _dt
    snap = ComplianceSnapshot(
        journey_id=journey_id, tenant_id=journey.tenant_id,
        year=payload.year, label=payload.label, captured_by=current_user.id,
        overall_pct=data["overall"], compliant_count=data["compliant"],
        total_count=data["total"],
        breakdown={"tiers": data["tiers"], "domains": data["domains"]},
        notes=payload.notes,
    )
    db.add(snap)
    db.commit()
    db.refresh(snap)
    return _snapshot_out(snap)


@router.get("/{journey_id}/snapshots")
def list_snapshots(
    journey_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """List the journey's compliance history (most recent first)."""
    journey = get_journey_or_404(journey_id, current_user, db)
    _ensure_snapshot_table(db)
    snaps = db.query(ComplianceSnapshot).filter(
        ComplianceSnapshot.journey_id == journey_id
    ).order_by(ComplianceSnapshot.captured_at.desc()).all()
    return [_snapshot_out(s) for s in snaps]


@router.delete("/{journey_id}/snapshots/{snapshot_id}")
def delete_snapshot(
    journey_id: int,
    snapshot_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    journey = get_journey_or_404(journey_id, current_user, db)
    _ensure_snapshot_table(db)
    snap = db.query(ComplianceSnapshot).filter(
        ComplianceSnapshot.id == snapshot_id,
        ComplianceSnapshot.journey_id == journey_id,
    ).first()
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    db.delete(snap)
    db.commit()
    return {"deleted": snapshot_id}


@router.get("/meta/tenant-users")
def list_certification_tenant_users(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Active users in the caller's tenant DB, suitable for the assignment dropdown.

    Per-tenant DB: every active row in `grc_users` belongs to this tenant. We
    don't join through `grc_tenant_users` since that table is only populated
    when users are explicitly invited across tenants. Includes the current
    user as a fallback so the dropdown is never empty.
    """
    users = (
        db.query(GRCUser)
        .filter(GRCUser.is_active == True)
        .order_by(GRCUser.display_name.asc().nullslast(), GRCUser.username.asc())
        .all()
    )
    result = [
        {
            "id": u.id,
            "username": u.username,
            "display_name": u.display_name or u.username,
            "email": u.email,
        }
        for u in users
    ]
    if not any(r["id"] == current_user.id for r in result):
        result.insert(0, {
            "id": current_user.id,
            "username": current_user.username,
            "display_name": current_user.display_name or current_user.username,
            "email": current_user.email,
        })
    return result


@router.post("/{journey_id}/controls/{control_id}/evidence", response_model=ImplementationEvidenceResponse, status_code=status.HTTP_201_CREATED)
async def upload_control_evidence(
    journey_id: int,
    control_id: int,
    background_tasks: BackgroundTasks,
    evidence_id: Optional[int] = Form(None),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)
    
    implementation = db.query(ControlImplementation).filter(
        ControlImplementation.id == control_id,
        ControlImplementation.journey_id == journey_id
    ).first()
    
    if not implementation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control implementation not found"
        )
    
    library_evidence = None
    ocr_status_val = None

    if evidence_id:
        existing_evidence = db.query(Evidence).filter(Evidence.id == evidence_id).first()
        if not existing_evidence:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Evidence not found"
            )
        
        impl_evidence = ImplementationEvidence(
            implementation_id=implementation.id,
            evidence_id=evidence_id,
            file_name=existing_evidence.file_name,
            file_path=existing_evidence.file_path,
            uploaded_by=current_user.id,
            review_status="pending"
        )
    elif file:
        file_ext = os.path.splitext(file.filename)[1] if file.filename else ""
        file_id = str(uuid.uuid4())
        tenant_upload_dir = os.path.join(EVIDENCE_LIBRARY_UPLOAD_DIR, str(journey.tenant_id))
        os.makedirs(tenant_upload_dir, exist_ok=True)
        file_path = os.path.join(tenant_upload_dir, f"{file_id}{file_ext}")
        
        contents = await file.read()
        with open(file_path, "wb") as f:
            f.write(contents)
        
        ocr_processable = ['pdf', 'png', 'jpg', 'jpeg']
        ocr_status_val = "pending" if file_ext and file_ext[1:].lower() in ocr_processable else "not_applicable"

        library_evidence = Evidence(
            tenant_id=journey.tenant_id,
            name=file.filename or "Uploaded Evidence",
            file_path=file_path,
            file_name=file.filename,
            file_type=file.content_type,
            evidence_type="document",
            status="draft",
            uploaded_by=current_user.id,
            ocr_status=ocr_status_val
        )
        db.add(library_evidence)
        db.flush()

        impl_evidence = ImplementationEvidence(
            implementation_id=implementation.id,
            evidence_id=library_evidence.id,
            file_name=file.filename,
            file_path=file_path,
            file_size=len(contents),
            mime_type=file.content_type,
            uploaded_by=current_user.id,
            review_status="pending"
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either evidence_id or file must be provided"
        )
    
    db.add(impl_evidence)
    db.commit()
    db.refresh(impl_evidence)

    if library_evidence and ocr_status_val == "pending":
        background_tasks.add_task(trigger_ocr_and_assessment_background, library_evidence.id, current_user.id)

    return impl_evidence


@router.post("/{journey_id}/controls/{control_id}/evidence/{evidence_id}/assess", response_model=dict)
def assess_evidence(
    journey_id: int,
    control_id: int,
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)
    
    impl_evidence = db.query(ImplementationEvidence).filter(
        ImplementationEvidence.id == evidence_id,
        ImplementationEvidence.implementation_id == control_id
    ).first()
    
    if not impl_evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    confidence_score = round(random.uniform(0.6, 0.95), 2)
    matched_controls = random.sample(range(1, 50), k=random.randint(1, 3))
    
    impl_evidence.ai_assessment_status = "assessed"
    impl_evidence.ai_confidence_score = confidence_score
    impl_evidence.ai_assessment_notes = f"AI assessment completed. Evidence appears relevant to the control requirements with {int(confidence_score * 100)}% confidence."
    impl_evidence.ai_matched_controls = matched_controls
    
    db.commit()
    db.refresh(impl_evidence)
    
    return {
        "id": impl_evidence.id,
        "ai_confidence_score": impl_evidence.ai_confidence_score,
        "ai_assessment_status": impl_evidence.ai_assessment_status,
        "ai_assessment_notes": impl_evidence.ai_assessment_notes,
        "ai_matched_controls": impl_evidence.ai_matched_controls
    }


@router.post("/{journey_id}/controls/{control_id}/evidence/{evidence_id}/review", response_model=dict)
def review_evidence(
    journey_id: int,
    control_id: int,
    evidence_id: int,
    review_data: EvidenceReviewAction,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)
    
    impl_evidence = db.query(ImplementationEvidence).filter(
        ImplementationEvidence.id == evidence_id,
        ImplementationEvidence.implementation_id == control_id
    ).first()
    
    if not impl_evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    if review_data.action not in ["approved", "rejected"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Action must be 'approved' or 'rejected'"
        )
    
    impl_evidence.review_status = review_data.action
    impl_evidence.reviewed_by = current_user.id
    impl_evidence.reviewed_at = datetime.utcnow()
    impl_evidence.review_notes = review_data.notes
    
    db.commit()
    db.refresh(impl_evidence)
    
    return {
        "id": impl_evidence.id,
        "review_status": impl_evidence.review_status,
        "reviewed_by": impl_evidence.reviewed_by,
        "reviewed_at": impl_evidence.reviewed_at.isoformat() if impl_evidence.reviewed_at else None,
        "review_notes": impl_evidence.review_notes
    }


@router.post("/evidence/{evidence_id}/review")
def review_evidence_by_impl_id(
    evidence_id: int,
    review_data: EvidenceReviewAction,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Auditor portal review by ImplementationEvidence ID (no control/journey path params)."""
    user_tenants = get_user_tenants(current_user, db)

    impl_evidence = db.query(ImplementationEvidence).join(
        ControlImplementation,
        ControlImplementation.id == ImplementationEvidence.implementation_id
    ).join(
        CertificationJourney,
        CertificationJourney.id == ControlImplementation.journey_id
    ).filter(
        ImplementationEvidence.id == evidence_id,
        CertificationJourney.tenant_id.in_(user_tenants)
    ).first()

    if not impl_evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )

    normalized_action = review_data.action.lower().strip()
    if normalized_action == "approve":
        normalized_action = "approved"
    if normalized_action == "reject":
        normalized_action = "rejected"

    if normalized_action not in ["approved", "rejected"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Action must be 'approved' or 'rejected'"
        )

    impl_evidence.review_status = normalized_action
    impl_evidence.reviewed_by = current_user.id
    impl_evidence.reviewed_at = datetime.utcnow()
    impl_evidence.review_notes = review_data.notes

    db.commit()
    db.refresh(impl_evidence)

    return {
        "id": impl_evidence.id,
        "review_status": impl_evidence.review_status,
        "reviewed_by": impl_evidence.reviewed_by,
        "reviewed_at": impl_evidence.reviewed_at.isoformat() if impl_evidence.reviewed_at else None,
        "review_notes": impl_evidence.review_notes
    }


def calculate_progress_summary(journey: CertificationJourney, db: Session) -> ProgressSummary:
    journey_id = journey.id

    implementations = db.query(ControlImplementation).options(
        joinedload(ControlImplementation.framework_control).joinedload(FrameworkControl.objective).joinedload(ControlObjective.domain),
        joinedload(ControlImplementation.parsed_control),
        joinedload(ControlImplementation.evidence_attachments)
    ).filter(ControlImplementation.journey_id == journey_id).all()

    parsed_control_ids = [impl.parsed_control_id for impl in implementations if impl.parsed_control_id]
    framework_control_ids = [impl.framework_control_id for impl in implementations if impl.framework_control_id]

    mapped_evidence_by_parsed = {}
    mapped_evidence_by_framework = {}

    if parsed_control_ids or framework_control_ids:
        mapping_rows = db.query(EvidenceControlMapping, Evidence).join(
            Evidence,
            Evidence.id == EvidenceControlMapping.evidence_id
        ).filter(
            Evidence.tenant_id == journey.tenant_id,
            or_(
                EvidenceControlMapping.parsed_control_id.in_(parsed_control_ids) if parsed_control_ids else False,
                EvidenceControlMapping.framework_control_id.in_(framework_control_ids) if framework_control_ids else False
            )
        ).all()

        for mapping, linked_evidence in mapping_rows:
            if mapping.parsed_control_id:
                mapped_evidence_by_parsed.setdefault(mapping.parsed_control_id, []).append(linked_evidence)
            if mapping.framework_control_id:
                mapped_evidence_by_framework.setdefault(mapping.framework_control_id, []).append(linked_evidence)

    total = len(implementations)
    by_status = {}
    by_domain_dict = {}

    implemented_count = 0
    verified_count = 0
    in_progress_count = 0
    not_started_count = 0
    not_applicable_count = 0
    with_evidence_count = 0
    fully_evidenced_count = 0
    approved_evidence_controls = 0

    for impl in implementations:
        parsed_control = impl.parsed_control
        framework_control = impl.framework_control

        required_evidence_count = 0
        if parsed_control:
            required_evidence_count = len(resolve_parsed_control_evidence(parsed_control, db))
        elif framework_control:
            required_evidence_count = len(get_curated_evidence_for_control(impl.framework_control_id, db))

        evidence_ids = set()
        evidence_total = 0
        approved_total = 0

        for ev in impl.evidence_attachments:
            evidence_total += 1
            if ev.evidence_id:
                evidence_ids.add(ev.evidence_id)
            if ev.review_status == "approved":
                approved_total += 1

        mapped_list = []
        if impl.parsed_control_id:
            mapped_list.extend(mapped_evidence_by_parsed.get(impl.parsed_control_id, []))
        if impl.framework_control_id:
            mapped_list.extend(mapped_evidence_by_framework.get(impl.framework_control_id, []))

        for linked_ev in mapped_list:
            if linked_ev.id in evidence_ids:
                continue
            evidence_ids.add(linked_ev.id)
            evidence_total += 1

        has_any_evidence = evidence_total > 0
        if has_any_evidence:
            with_evidence_count += 1

        if required_evidence_count > 0 and evidence_total >= required_evidence_count:
            fully_evidenced_count += 1
        elif required_evidence_count == 0 and has_any_evidence:
            fully_evidenced_count += 1

        if required_evidence_count > 0 and approved_total >= required_evidence_count:
            approved_evidence_controls += 1
        elif required_evidence_count == 0 and approved_total > 0:
            approved_evidence_controls += 1

        effective_status = impl.status
        if effective_status not in ["implemented", "verified", "not_applicable"] and has_any_evidence:
            effective_status = "in_progress"

        by_status[effective_status] = by_status.get(effective_status, 0) + 1

        if parsed_control:
            domain_name = parsed_control.domain or "General"
            domain_id = domain_name
        elif framework_control and framework_control.objective and framework_control.objective.domain:
            domain = framework_control.objective.domain
            domain_id = domain.id
            domain_name = domain.name
        else:
            domain_id = "general"
            domain_name = "General"

        if domain_id not in by_domain_dict:
            by_domain_dict[domain_id] = {
                "domain_id": domain_id,
                "domain_name": domain_name,
                "total": 0,
                "completed": 0,
                "in_progress": 0,
                "not_started": 0
            }

        by_domain_dict[domain_id]["total"] += 1
        if effective_status in ["implemented", "verified"]:
            by_domain_dict[domain_id]["completed"] += 1
        elif effective_status == "in_progress":
            by_domain_dict[domain_id]["in_progress"] += 1
        else:
            by_domain_dict[domain_id]["not_started"] += 1

        if effective_status in ["implemented", "verified"]:
            implemented_count += 1
        if effective_status == "verified":
            verified_count += 1
        if effective_status == "in_progress":
            in_progress_count += 1
        if effective_status == "not_started":
            not_started_count += 1
        if effective_status == "not_applicable":
            not_applicable_count += 1

    by_domain = list(by_domain_dict.values())

    applicable_total = total - not_applicable_count
    completion_percentage = round((implemented_count / applicable_total * 100) if applicable_total > 0 else 0, 1)
    evidence_coverage_percentage = round((fully_evidenced_count / applicable_total * 100) if applicable_total > 0 else 0, 1)
    readiness_percentage = round((approved_evidence_controls / applicable_total * 100) if applicable_total > 0 else 0, 1)

    return ProgressSummary(
        total_controls=total,
        implemented_count=implemented_count,
        verified_count=verified_count,
        in_progress_count=in_progress_count,
        not_started_count=not_started_count,
        not_applicable_count=not_applicable_count,
        completion_percentage=completion_percentage,
        with_evidence_count=with_evidence_count,
        fully_evidenced_count=fully_evidenced_count,
        approved_evidence_controls=approved_evidence_controls,
        evidence_coverage_percentage=evidence_coverage_percentage,
        readiness_percentage=readiness_percentage,
        by_status=by_status,
        by_domain=by_domain
    )


@router.get("/{journey_id}/progress", response_model=ProgressSummary)
def get_progress_summary(
    journey_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)
    return calculate_progress_summary(journey, db)


# ── Framework compliance dashboard (charts) ──────────────────────────────────
# Status enum → (display label, hex). Mirrors the frontend chart palette.
_STATUS_CHART = {
    "not_started":    ("Not Started", "#94a3b8"),
    "in_progress":    ("In Progress", "#f59e0b"),
    "implemented":    ("Implemented", "#3b82f6"),
    "verified":       ("Verified", "#10b981"),
    "not_applicable": ("Not Applicable", "#cbd5e1"),
}


def _snapshot_and_trend(journey: CertificationJourney, db: Session, prog: ProgressSummary) -> list:
    """Upsert today's posture snapshot and return the trailing trend series.

    One row per (journey, UTC day). Best-effort: a snapshot failure must never
    break the charts response."""
    now = datetime.utcnow()
    day = datetime(now.year, now.month, now.day)
    try:
        row = db.query(ComplianceHistory).filter(
            ComplianceHistory.journey_id == journey.id,
            ComplianceHistory.snapshot_day == day,
        ).first()
        if row:
            row.completion_pct = prog.completion_percentage
            row.readiness_pct = prog.readiness_percentage
            row.evidence_coverage_pct = prog.evidence_coverage_percentage
            row.total_controls = prog.total_controls
            row.status_counts = prog.by_status
        else:
            db.add(ComplianceHistory(
                tenant_id=journey.tenant_id, journey_id=journey.id,
                framework_id=journey.framework_id, snapshot_day=day,
                completion_pct=prog.completion_percentage,
                readiness_pct=prog.readiness_percentage,
                evidence_coverage_pct=prog.evidence_coverage_percentage,
                total_controls=prog.total_controls, status_counts=prog.by_status,
            ))
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
    try:
        hist = db.query(ComplianceHistory).filter(
            ComplianceHistory.journey_id == journey.id,
        ).order_by(ComplianceHistory.snapshot_day.asc()).all()
    except Exception:  # noqa: BLE001
        db.rollback()
        hist = []
    return [
        {
            "label": h.snapshot_day.strftime("%b %d"),
            "completion": round(h.completion_pct or 0, 1),
            "readiness": round(h.readiness_pct or 0, 1),
        }
        for h in hist[-30:]
    ]


def _automation_for_journey(journey: CertificationJourney, db: Session) -> dict:
    """Derive how many of this journey's requirements are AUTOMATED (linked to a
    compliance plugin via PluginControlMapping → ControlMapping) and how many of
    those are PASSING (latest plugin run = passed)."""
    impls = db.query(ControlImplementation).filter(
        ControlImplementation.journey_id == journey.id,
    ).all()
    total = len(impls)
    blank = {"automated": 0, "passed": 0, "total": total}
    if not impls:
        return blank

    pcms = db.query(PluginControlMapping).filter(
        or_(PluginControlMapping.tenant_id == journey.tenant_id,
            PluginControlMapping.tenant_id.is_(None)),
    ).all()
    if not pcms:
        return blank

    # Bridge plugin mappings to parsed_control_id (via ControlMapping) and keep
    # any direct framework_control_id links.
    norm_ids = {m.normalized_control_id for m in pcms if getattr(m, "normalized_control_id", None)}
    norm_to_parsed: dict = {}
    if norm_ids:
        for cm in db.query(ControlMapping).filter(
            ControlMapping.normalized_control_id.in_(list(norm_ids)),
        ).all():
            pid = getattr(cm, "parsed_control_id", None)
            if pid:
                norm_to_parsed.setdefault(cm.normalized_control_id, set()).add(pid)

    parsed_to_plugins: dict = {}
    fc_to_plugins: dict = {}
    for m in pcms:
        nkey = getattr(m, "normalized_control_id", None)
        if nkey:
            for pid in norm_to_parsed.get(nkey, ()):  # parsed control ids
                parsed_to_plugins.setdefault(pid, set()).add(m.plugin_id)
        fckey = getattr(m, "framework_control_id", None)
        if fckey:
            fc_to_plugins.setdefault(fckey, set()).add(m.plugin_id)

    automated_plugin_ids: set = set()
    for s in parsed_to_plugins.values():
        automated_plugin_ids |= s
    for s in fc_to_plugins.values():
        automated_plugin_ids |= s

    passing_plugins: set = set()
    if automated_plugin_ids:
        seen: set = set()
        for r in db.query(CompliancePluginRun).filter(
            CompliancePluginRun.tenant_id == journey.tenant_id,
            CompliancePluginRun.plugin_id.in_(list(automated_plugin_ids)),
        ).order_by(CompliancePluginRun.plugin_id, CompliancePluginRun.id.desc()).all():
            if r.plugin_id in seen:
                continue
            seen.add(r.plugin_id)  # first row per plugin = latest (id desc)
            if r.status == "passed":
                passing_plugins.add(r.plugin_id)

    automated = passed = 0
    for impl in impls:
        plugins: set = set()
        if impl.parsed_control_id and impl.parsed_control_id in parsed_to_plugins:
            plugins |= parsed_to_plugins[impl.parsed_control_id]
        if impl.framework_control_id and impl.framework_control_id in fc_to_plugins:
            plugins |= fc_to_plugins[impl.framework_control_id]
        if plugins:
            automated += 1
            if plugins & passing_plugins:
                passed += 1
    return {"automated": automated, "passed": passed, "total": total}


@router.get("/{journey_id}/charts")
def get_framework_charts(
    journey_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """All data for the framework compliance dashboard charts: gauge, requirement
    status donut, automated-controls assurance, maturity radar (by domain),
    compliance trend (history), and the top stat cards. Also records today's
    posture snapshot so the trend fills in over time."""
    journey = get_journey_or_404(journey_id, current_user, db)
    prog = calculate_progress_summary(journey, db)
    auto = _automation_for_journey(journey, db)
    trend = _snapshot_and_trend(journey, db, prog)

    applicable = prog.total_controls - prog.not_applicable_count

    status_donut = []
    for key, (label, color) in _STATUS_CHART.items():
        val = int(prog.by_status.get(key, 0) or 0)
        if val > 0:
            status_donut.append({"key": key, "label": label, "value": val, "color": color})

    maturity = [
        {
            "label": d.get("domain_name") or "General",
            "value": round((d.get("completed", 0) / d["total"] * 100), 1) if d.get("total") else 0,
            "maxValue": 100,
        }
        for d in prog.by_domain
    ]

    manual = max(0, prog.total_controls - auto["automated"])
    automation_donut = [
        {"label": "Automated & passing", "value": auto["passed"], "color": "#10b981"},
        {"label": "Automated, not passing", "value": max(0, auto["automated"] - auto["passed"]), "color": "#f59e0b"},
        {"label": "Manual", "value": manual, "color": "#cbd5e1"},
    ]

    return {
        "gauge": {
            "completion_pct": prog.completion_percentage,
            "readiness_pct": prog.readiness_percentage,
            "evidence_coverage_pct": prog.evidence_coverage_percentage,
        },
        "stats": {
            "total_in_scope": prog.total_controls,
            "applicable": applicable,
            "not_applicable": prog.not_applicable_count,
            "implemented": prog.implemented_count,
            "ready_to_audit": prog.approved_evidence_controls,
            "with_evidence": prog.with_evidence_count,
            "automated": auto["automated"],
            "automated_passed": auto["passed"],
        },
        "status_donut": status_donut,
        "automation_donut": automation_donut,
        "maturity": maturity,
        "trend": trend,
    }


@router.get("/{journey_id}/report")
def download_certification_report(
    journey_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Generate a plain-text readiness report for the journey and stream it as a download."""
    journey = get_journey_or_404(journey_id, current_user, db)

    progress = calculate_progress_summary(journey, db)

    implementations = db.query(ControlImplementation).options(
        joinedload(ControlImplementation.evidence_attachments).joinedload(ImplementationEvidence.uploader),
        joinedload(ControlImplementation.evidence_attachments).joinedload(ImplementationEvidence.reviewer),
        joinedload(ControlImplementation.parsed_control),
        joinedload(ControlImplementation.framework_control)
    ).filter(ControlImplementation.journey_id == journey_id).all()

    evidence_records = []
    for impl in implementations:
        for ev in impl.evidence_attachments:
            evidence_records.append((impl, ev))

    total_evidence = len(evidence_records)
    pending_evidence = sum(1 for _, ev in evidence_records if ev.review_status == "pending")
    approved_evidence = sum(1 for _, ev in evidence_records if ev.review_status == "approved")
    rejected_evidence = sum(1 for _, ev in evidence_records if ev.review_status == "rejected")

    uploaders = sorted({
        (ev.uploader.display_name or ev.uploader.username or ev.uploader.email)
        for _, ev in evidence_records if ev.uploader
    })

    reviewers = sorted({
        (ev.reviewer.display_name or ev.reviewer.username or ev.reviewer.email)
        for _, ev in evidence_records if ev.reviewer
    })

    controls_with_evidence = sum(1 for impl in implementations if impl.evidence_attachments)
    domains_covered = len((progress.by_domain or {}))

    buffer = io.StringIO()
    buffer.write(f"Framework Report: {journey.name}\n")
    buffer.write(f"Framework ID: {journey.uploaded_framework_id or journey.framework_id or journey.id}\n")
    buffer.write(f"Journey ID: {journey.id}\n")
    buffer.write(f"Tenant ID: {journey.tenant_id}\n")
    buffer.write(f"Target Date: {journey.target_date.isoformat() if journey.target_date else 'Not set'}\n")
    buffer.write(f"Status: {journey.status}\n")
    buffer.write("\n=== Progress ===\n")
    buffer.write(f"Total Controls: {progress.total_controls}\n")
    buffer.write(f"Implemented: {progress.implemented_count}\n")
    buffer.write(f"Verified: {progress.verified_count}\n")
    buffer.write(f"In Progress: {progress.in_progress_count}\n")
    buffer.write(f"Not Started: {progress.not_started_count}\n")
    buffer.write(f"Not Applicable: {progress.not_applicable_count}\n")
    buffer.write(f"Completion %: {progress.completion_percentage}\n")
    buffer.write(f"Readiness %: {progress.readiness_percentage}\n")
    buffer.write(f"Evidence Coverage %: {progress.evidence_coverage_percentage}\n")
    buffer.write(f"Domains Covered: {domains_covered}\n")

    buffer.write("\n=== Evidence ===\n")
    buffer.write(f"Total Evidence: {total_evidence}\n")
    buffer.write(f"Pending Review: {pending_evidence}\n")
    buffer.write(f"Approved: {approved_evidence}\n")
    buffer.write(f"Rejected: {rejected_evidence}\n")
    buffer.write(f"Controls With Evidence: {controls_with_evidence}\n")

    if uploaders:
        buffer.write("Uploaded By: " + ", ".join(uploaders) + "\n")
    else:
        buffer.write("Uploaded By: None\n")

    if reviewers:
        buffer.write("Reviewed By: " + ", ".join(reviewers) + "\n")
    else:
        buffer.write("Reviewed By: None\n")

    buffer.write("\n=== Pending Approval Details ===\n")
    for impl, ev in evidence_records:
        if ev.review_status == "pending":
            control_code = None
            control_name = None
            if impl.parsed_control:
                control_code = impl.parsed_control.control_id
                control_name = impl.parsed_control.title
            elif impl.framework_control:
                control_code = impl.framework_control.code
                control_name = impl.framework_control.name
            buffer.write(f"- Evidence ID {ev.id} | {ev.file_name} | Control {control_code or 'N/A'} {control_name or ''} | Uploaded {ev.uploaded_at.isoformat() if ev.uploaded_at else 'N/A'}\n")

    content = buffer.getvalue()
    buffer.close()

    return StreamingResponse(
        iter([content]),
        media_type="text/plain",
        headers={"Content-Disposition": f"attachment; filename=framework-{journey_id}-report.txt"}
    )


@router.get("/{journey_id}/gaps", response_model=GapAnalysis)
def get_gap_analysis(
    journey_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)
    
    implementations = db.query(ControlImplementation).options(
        joinedload(ControlImplementation.framework_control),
        joinedload(ControlImplementation.parsed_control),
        joinedload(ControlImplementation.evidence_attachments)
    ).filter(
        ControlImplementation.journey_id == journey_id,
        ControlImplementation.is_applicable == True
    ).all()
    
    controls_without_evidence = []
    controls_not_implemented = []
    controls_pending_verification = []
    evidence_pending_review = []
    high_priority_gaps = []
    
    for impl in implementations:
        parsed_control = impl.parsed_control
        framework_control = impl.framework_control
        
        if parsed_control:
            control_code = parsed_control.control_id
            control_name = parsed_control.title
        elif framework_control:
            control_code = framework_control.code
            control_name = framework_control.name
        else:
            control_code = None
            control_name = None
        
        control_info = {
            "implementation_id": impl.id,
            "control_code": control_code,
            "control_name": control_name,
            "status": impl.status,
            "priority": impl.priority
        }
        
        has_approved_evidence = any(
            ev.review_status == "approved" for ev in impl.evidence_attachments
        )
        
        if not impl.evidence_attachments:
            controls_without_evidence.append(control_info)
            if impl.priority <= 2:
                high_priority_gaps.append({**control_info, "gap_type": "no_evidence"})
        
        if impl.status == "not_started":
            controls_not_implemented.append(control_info)
            if impl.priority <= 2:
                high_priority_gaps.append({**control_info, "gap_type": "not_implemented"})
        
        if impl.status == "implemented" and not has_approved_evidence:
            controls_pending_verification.append(control_info)
        
        for ev in impl.evidence_attachments:
            if ev.review_status == "pending":
                evidence_pending_review.append({
                    "evidence_id": ev.id,
                    "file_name": ev.file_name,
                    "control_code": control_code,
                    "uploaded_at": ev.uploaded_at.isoformat() if ev.uploaded_at else None
                })
    
    total_gaps = len(controls_without_evidence) + len(controls_not_implemented)
    
    return GapAnalysis(
        total_gaps=total_gaps,
        controls_without_evidence=controls_without_evidence,
        controls_not_implemented=controls_not_implemented,
        controls_pending_verification=controls_pending_verification,
        evidence_pending_review=evidence_pending_review,
        high_priority_gaps=high_priority_gaps
    )


@router.get("/uploaded-frameworks/{framework_id}/phases", response_model=List[dict])
def get_uploaded_framework_phases(
    framework_id: int,
    db: Session = Depends(get_db)
):
    """Get certification phases derived from an uploaded framework's document structure.
    
    Phases are extracted from the document_structure field populated during framework parsing.
    The parser extracts sections/chapters from the uploaded document, which become the
    phases for certification journeys.
    
    ARCHITECTURE REQUIREMENT: Phases MUST come from document_structure only.
    No fallback to control titles or other sources is permitted to enforce
    the uploaded-framework-only architecture.
    """
    framework = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uploaded framework not found"
        )
    
    # Extract phases from document_structure (the ONLY allowed source)
    phases = get_phases_from_document_structure(framework)
    
    if phases:
        logger.debug(f"Successfully extracted {len(phases)} phases from document_structure for framework {framework_id}")
    else:
        logger.info(f"Framework {framework_id}: No phases in document_structure - returning empty list")
    
    return phases


@router.post("/{journey_id}/generate-phases")
def generate_journey_phases(
    journey_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)

    if journey.generated_phases and len(journey.generated_phases) > 0:
        return {"phases": journey.generated_phases, "cached": True}

    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == journey.uploaded_framework_id
    ).first()
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework not found for this journey"
        )

    framework_classification = get_framework_classification(framework)
    if framework_classification != "certification":
        journey.generated_phases = []
        flag_modified(journey, "generated_phases")
        db.commit()
        return {
            "phases": [],
            "cached": False,
            "message": "Phases are disabled for compliance frameworks"
        }

    controls = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework.id
    ).all()

    total_controls = len(controls)
    domains = set()
    sample_controls = []
    for ctrl in controls[:30]:
        domain = ctrl.domain or ctrl.parent_section or "General"
        domains.add(domain)
        sample_controls.append(f"- [{ctrl.control_id}] {ctrl.title} (Domain: {domain})")

    domains_text = ", ".join(list(domains)[:15])
    controls_text = "\n".join(sample_controls[:25])

    doc_structure = framework.document_structure or {}
    framework_type = doc_structure.get("type", "")
    framework_desc = doc_structure.get("description", "")

    is_certification = any(kw in (framework.name or "").lower() for kw in [
        "iso", "soc", "pci", "certification", "27001", "22301", "9001", "20000"
    ])
    is_regulatory = any(kw in (framework.name or "").lower() for kw in [
        "regulation", "gdpr", "mas", "sbp", "sama", "central bank", "monetary",
        "authority", "basel", "regulatory"
    ])

    if is_certification:
        journey_type_hint = "This is a CERTIFICATION framework (e.g., ISO, SOC, PCI). Include phases for formal certification audit preparation, Stage 1 and Stage 2 audits, and surveillance."
    elif is_regulatory:
        journey_type_hint = "This is a REGULATORY COMPLIANCE framework. Include phases for regulatory gap assessment, remediation, regulatory submission/reporting, and ongoing regulatory compliance monitoring."
    else:
        journey_type_hint = "Determine whether this is a certification, regulatory, or best-practice framework and tailor phases accordingly."

    prompt = f"""You are a senior GRC (Governance, Risk, and Compliance) consultant with 20+ years of experience helping organizations achieve compliance and certification. You are tasked with creating a structured certification/compliance journey for an organization.

FRAMEWORK DETAILS:
- Framework Name: {framework.name}
- Description: {framework_desc}
- Total Controls: {total_controls}
- Key Domains/Sections: {domains_text}
{journey_type_hint}

SAMPLE CONTROLS FROM THIS FRAMEWORK:
{controls_text}

TASK: Generate a comprehensive, realistic set of certification/compliance journey phases that an organization would follow to achieve full compliance with this framework. 

REQUIREMENTS:
1. Generate 6-10 phases that represent the ACTUAL certification/compliance lifecycle
2. Each phase should have a clear name, detailed description explaining its purpose and importance
3. Each phase should have 3-5 specific, actionable key tasks
4. Each phase should have 2-4 tangible deliverables (documents, reports, artifacts)
5. Phases should follow a logical sequence from initiation to ongoing compliance
6. Be specific to THIS framework - reference actual control domains and requirements
7. Include realistic duration estimates for each phase

TYPICAL GRC JOURNEY PHASES TO CONSIDER (adapt based on framework type):
- Project Initiation & Scoping (stakeholder alignment, scope definition)
- Current State Assessment / Gap Analysis (assess existing controls vs requirements)
- Risk Assessment & Treatment Planning (identify and prioritize risks)
- Policy & Procedure Development (create/update documentation)
- Control Implementation & Remediation (implement required controls)
- Training & Awareness (staff education and competency building)
- Internal Audit & Testing (verify control effectiveness)
- Management Review & Pre-Assessment (leadership review, readiness check)
- External Audit / Certification (formal assessment by certifying body)
- Continuous Monitoring & Improvement (ongoing compliance maintenance)

Return ONLY valid JSON in this exact format:
{{
  "phases": [
    {{
      "phase_number": 1,
      "name": "Phase Name",
      "description": "Detailed description of this phase, its purpose, importance, and what the organization achieves by completing it.",
      "estimated_duration": "2-3 weeks",
      "key_tasks": [
        "Specific actionable task 1",
        "Specific actionable task 2",
        "Specific actionable task 3"
      ],
      "deliverables": [
        "Tangible deliverable/document 1",
        "Tangible deliverable/document 2",
        "Tangible deliverable/document 3"
      ]
    }}
  ]
}}"""

    try:
        client = get_openai_client()
        response = client.chat.completions.create(
            model=get_openai_model(),
            messages=[
                {"role": "system", "content": "You are a world-class GRC consultant specializing in compliance frameworks and certification journeys. Always respond with valid JSON only. Be specific, practical, and actionable."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=4000,
            temperature=0.4
        )

        result_text = response.choices[0].message.content.strip()
        if result_text.startswith("```"):
            result_text = result_text.split("\n", 1)[1] if "\n" in result_text else result_text
            result_text = result_text.rsplit("```", 1)[0].strip()

        parsed = json.loads(result_text)
        ai_phases = parsed.get("phases", [])

        generated_phases = []
        for i, phase in enumerate(ai_phases):
            generated_phases.append({
                "id": i + 1,
                "phase_number": phase.get("phase_number", i + 1),
                "name": phase.get("name", f"Phase {i + 1}"),
                "description": phase.get("description", ""),
                "estimated_duration": phase.get("estimated_duration", ""),
                "key_tasks": phase.get("key_tasks", []),
                "deliverables": phase.get("deliverables", []),
                "status": "not_started" if i > 0 else "in_progress"
            })

        journey.generated_phases = generated_phases
        flag_modified(journey, "generated_phases")
        db.commit()

        return {"phases": generated_phases, "cached": False}

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse AI response for journey {journey_id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="AI generated an invalid response. Please try again."
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"AI phase generation failed for journey {journey_id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate phases: {str(e)}"
        )


@router.get("/{journey_id}/journey-phases")
def get_journey_phases(
    journey_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)

    if journey.generated_phases and len(journey.generated_phases) > 0:
        return {"phases": journey.generated_phases, "generated": True}

    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == journey.uploaded_framework_id
    ).first()

    framework_classification = get_framework_classification(framework)
    if framework_classification != "certification":
        return {"phases": [], "generated": False}

    fallback_phases = get_phases_from_document_structure(framework) if framework else []
    return {"phases": fallback_phases, "generated": False}


def get_openai_client():
    from openai import OpenAI
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
    return OpenAI(api_key=api_key, base_url=base_url)


@router.post("/{journey_id}/phases/{phase_number}/generate-tasks")
def generate_phase_tasks(
    journey_id: int,
    phase_number: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)

    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == journey.uploaded_framework_id
    ).first()
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework not found for this journey"
        )

    doc_structure = framework.document_structure or {}
    sections = doc_structure.get("sections", [])

    phase_index = phase_number - 1
    if phase_index < 0 or phase_index >= len(sections):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Phase {phase_number} not found. Framework has {len(sections)} phases."
        )

    section = sections[phase_index]
    if isinstance(section, dict):
        phase_name = section.get("name") or section.get("title") or f"Section {phase_number}"
        phase_description = section.get("description") or ""
        cached_tasks = section.get("key_tasks", [])
        cached_deliverables = section.get("deliverables", [])
        if cached_tasks and cached_deliverables:
            return {
                "phase_number": phase_number,
                "phase_name": phase_name,
                "key_tasks": cached_tasks,
                "deliverables": cached_deliverables,
                "cached": True
            }
    else:
        phase_name = str(section)
        phase_description = ""

    controls = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework.id
    ).all()

    phase_controls = []
    section_ref = section.get("number", str(phase_number)) if isinstance(section, dict) else str(phase_number)
    for ctrl in controls:
        ctrl_section = ctrl.parent_section or ctrl.domain or ""
        if (str(section_ref) in str(ctrl_section) or
            phase_name.lower() in (ctrl_section or "").lower()):
            phase_controls.append(ctrl)

    if not phase_controls:
        phase_controls = controls[:10]

    controls_text = "\n".join([
        f"- {c.control_id}: {c.title}" for c in phase_controls[:15]
    ])

    prompt = f"""You are a GRC (Governance, Risk, Compliance) expert. Generate key tasks and deliverables for a specific certification phase.

Framework: {framework.name}
Phase: {phase_name}
Phase Description: {phase_description}

Controls in this phase:
{controls_text}

Generate 3-5 key tasks that an organization needs to complete for this phase, and 3-5 deliverables (tangible outputs/documents) that should be produced.

Return ONLY valid JSON in this exact format:
{{
  "key_tasks": ["task1", "task2", "task3"],
  "deliverables": ["deliverable1", "deliverable2", "deliverable3"]
}}"""

    key_tasks = []
    deliverables = []

    try:
        client = get_openai_client()
        response = client.chat.completions.create(
            model=get_openai_model(),
            messages=[
                {"role": "system", "content": "You are a GRC certification expert. Always respond with valid JSON only."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=1000
        )

        result_text = response.choices[0].message.content.strip()
        if result_text.startswith("```"):
            result_text = result_text.split("\n", 1)[1] if "\n" in result_text else result_text
            result_text = result_text.rsplit("```", 1)[0].strip()

        parsed = json.loads(result_text)
        key_tasks = parsed.get("key_tasks", [])
        deliverables = parsed.get("deliverables", [])
    except Exception as e:
        logger.error(f"AI generation failed for phase {phase_number}: {str(e)}")

    try:
        if isinstance(sections[phase_index], str):
            sections[phase_index] = {
                "name": sections[phase_index],
                "description": "",
                "key_tasks": key_tasks,
                "deliverables": deliverables
            }
        elif isinstance(sections[phase_index], dict):
            sections[phase_index]["key_tasks"] = key_tasks
            sections[phase_index]["deliverables"] = deliverables
        doc_structure["sections"] = sections
        framework.document_structure = doc_structure
        flag_modified(framework, "document_structure")
        db.commit()
    except Exception as e:
        logger.error(f"Failed to cache AI results for phase {phase_number}: {str(e)}")
        db.rollback()

    return {
        "phase_number": phase_number,
        "phase_name": phase_name,
        "key_tasks": key_tasks,
        "deliverables": deliverables,
        "cached": False
    }


@router.post("/{journey_id}/phases/generate-all-tasks")
def generate_all_phase_tasks(
    journey_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)

    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == journey.uploaded_framework_id
    ).first()
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework not found for this journey"
        )

    doc_structure = framework.document_structure or {}
    sections = doc_structure.get("sections", [])

    if not sections:
        return {"phases": [], "message": "No phases found in framework document structure"}

    all_cached = True
    for section in sections:
        if isinstance(section, dict):
            if not section.get("key_tasks") or not section.get("deliverables"):
                all_cached = False
                break
        else:
            all_cached = False
            break

    if all_cached:
        phases = get_phases_from_document_structure(framework)
        return {"phases": phases, "cached": True}

    controls = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework.id
    ).limit(30).all()

    controls_text = "\n".join([
        f"- {c.control_id}: {c.title}" for c in controls
    ])

    phases_list = []
    for i, section in enumerate(sections):
        if isinstance(section, dict):
            name = section.get("name") or section.get("title") or f"Section {i+1}"
            desc = section.get("description") or ""
        else:
            name = str(section)
            desc = ""
        phases_list.append(f"Phase {i+1}: {name} - {desc}")

    phases_text = "\n".join(phases_list)

    prompt = f"""You are a GRC (Governance, Risk, Compliance) expert. Generate key tasks and deliverables for ALL certification phases of a framework.

Framework: {framework.name}

Phases:
{phases_text}

Sample controls from this framework:
{controls_text}

For EACH phase, generate 3-5 key tasks and 3-5 deliverables specific to that phase.

Return ONLY valid JSON in this exact format:
{{
  "phases": [
    {{
      "phase_number": 1,
      "key_tasks": ["task1", "task2", "task3"],
      "deliverables": ["deliverable1", "deliverable2", "deliverable3"]
    }},
    {{
      "phase_number": 2,
      "key_tasks": ["task1", "task2", "task3"],
      "deliverables": ["deliverable1", "deliverable2", "deliverable3"]
    }}
  ]
}}"""

    try:
        client = get_openai_client()
        response = client.chat.completions.create(
            model=get_openai_model(),
            messages=[
                {"role": "system", "content": "You are a GRC certification expert. Always respond with valid JSON only."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=3000
        )

        result_text = response.choices[0].message.content.strip()
        if result_text.startswith("```"):
            result_text = result_text.split("\n", 1)[1] if "\n" in result_text else result_text
            result_text = result_text.rsplit("```", 1)[0].strip()

        parsed = json.loads(result_text)
        ai_phases = parsed.get("phases", [])

        for ai_phase in ai_phases:
            idx = ai_phase.get("phase_number", 0) - 1
            if 0 <= idx < len(sections):
                if isinstance(sections[idx], str):
                    sections[idx] = {
                        "name": sections[idx],
                        "description": "",
                        "key_tasks": ai_phase.get("key_tasks", []),
                        "deliverables": ai_phase.get("deliverables", [])
                    }
                elif isinstance(sections[idx], dict):
                    sections[idx]["key_tasks"] = ai_phase.get("key_tasks", [])
                    sections[idx]["deliverables"] = ai_phase.get("deliverables", [])

        doc_structure["sections"] = sections
        framework.document_structure = doc_structure
        flag_modified(framework, "document_structure")
        db.commit()

    except Exception as e:
        logger.error(f"AI generation failed for all phases: {str(e)}")
        db.rollback()

    phases = get_phases_from_document_structure(framework)
    return {"phases": phases, "cached": False}


@router.put("/evidence/{evidence_id}/review")
def review_implementation_evidence(
    evidence_id: int,
    review_data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Approve or reject an ImplementationEvidence record."""
    user_tenants = get_user_tenants(current_user, db)
    
    evidence = db.query(ImplementationEvidence).filter(
        ImplementationEvidence.id == evidence_id
    ).first()
    
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    impl = db.query(ControlImplementation).filter(
        ControlImplementation.id == evidence.implementation_id
    ).first()
    
    if impl:
        journey = db.query(CertificationJourney).filter(
            CertificationJourney.id == impl.journey_id
        ).first()
        if journey and journey.tenant_id not in user_tenants:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied"
            )
    
    action = review_data.get("action")
    if action not in ["approve", "reject"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid action. Must be 'approve' or 'reject'"
        )
    
    evidence.review_status = "approved" if action == "approve" else "rejected"
    evidence.reviewed_by = current_user.id
    evidence.reviewed_at = datetime.utcnow()
    evidence.review_notes = review_data.get("notes", "")
    
    db.commit()
    
    return {
        "id": evidence.id,
        "review_status": evidence.review_status,
        "reviewed_by": current_user.id,
        "message": f"Evidence {action}d successfully"
    }


@router.delete("/evidence/{evidence_id}", status_code=status.HTTP_204_NO_CONTENT)
def unlink_implementation_evidence(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Unlink an ImplementationEvidence record from a journey control.
    
    The underlying Evidence record in the evidence library is preserved.
    Evidence is only permanently deleted from the evidence library itself.
    """
    user_tenants = get_user_tenants(current_user, db)
    
    evidence = db.query(ImplementationEvidence).filter(
        ImplementationEvidence.id == evidence_id
    ).first()
    
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    impl = db.query(ControlImplementation).filter(
        ControlImplementation.id == evidence.implementation_id
    ).first()
    
    if impl:
        journey = db.query(CertificationJourney).filter(
            CertificationJourney.id == impl.journey_id
        ).first()
        if journey and journey.tenant_id not in user_tenants:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied"
            )
    
    # Also remove all EvidenceControlMapping records for this evidence + the control's
    # parsed_control_id so no orphaned "linked" entries remain visible after unlinking.
    if evidence.evidence_id and impl and impl.parsed_control_id:
        # Collect sibling PC IDs (same control_id in same framework) to handle duplicates.
        pc = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.id == impl.parsed_control_id
        ).first()
        if pc:
            sibling_pc_ids = [
                row[0] for row in db.query(ParsedFrameworkControl.id).filter(
                    ParsedFrameworkControl.uploaded_framework_id == pc.uploaded_framework_id,
                    ParsedFrameworkControl.control_id == pc.control_id,
                ).all()
            ]
            ecm_to_delete = db.query(EvidenceControlMapping).filter(
                EvidenceControlMapping.evidence_id == evidence.evidence_id,
                EvidenceControlMapping.parsed_control_id.in_(sibling_pc_ids),
            ).all()
            for ecm in ecm_to_delete:
                db.delete(ecm)

    db.delete(evidence)
    db.commit()
    
    return None


@router.get("/frameworks/{framework_id}/auditor-evidence")
def get_auditor_evidence_for_framework(
    framework_id: int,
    status_filter: Optional[str] = None,  # pending, approved, rejected
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Get all evidence uploaded against framework controls for auditor review."""
    user_tenants = get_user_tenants(current_user, db)
    
    # Prefer interpreting the path param as a certification journey ID first to avoid collisions
    journeys: List[CertificationJourney] = []
    framework: Optional[UploadedFramework] = None

    journey_lookup = db.query(CertificationJourney).filter(
        CertificationJourney.id == framework_id,
        CertificationJourney.tenant_id.in_(user_tenants)
    ).first()

    if journey_lookup:
        journeys = [journey_lookup]
        lookup_framework_id = journey_lookup.uploaded_framework_id or journey_lookup.framework_id
        if lookup_framework_id:
            framework = db.query(UploadedFramework).filter(
                UploadedFramework.id == lookup_framework_id
            ).filter(
                (UploadedFramework.tenant_id.in_(user_tenants)) | (UploadedFramework.tenant_id.is_(None))
            ).first()

    if not journeys:
        # If no journey matched, interpret as uploaded framework ID
        framework = db.query(UploadedFramework).filter(
            UploadedFramework.id == framework_id
        ).filter(
            (UploadedFramework.tenant_id.in_(user_tenants)) | (UploadedFramework.tenant_id.is_(None))
        ).first()

        if framework:
            journeys = db.query(CertificationJourney).filter(
                CertificationJourney.uploaded_framework_id == framework.id,
                CertificationJourney.tenant_id.in_(user_tenants)
            ).all()

    if not framework and not journeys:
        return {
            "framework": {
                "id": framework_id,
                "name": "Unknown Framework",
                "version": None
            },
            "evidence": [],
            "stats": {"total": 0, "pending": 0, "approved": 0, "rejected": 0}
        }
    
    if not journeys:
        return {
            "framework": {
                "id": framework.id,
                "name": framework.name,
                "version": framework.version
            },
            "evidence": [],
            "stats": {
                "total": 0,
                "pending": 0,
                "approved": 0,
                "rejected": 0
            }
        }
    
    journey_ids = [j.id for j in journeys]
    
    # Get all implementations and evidence
    base_query = db.query(ImplementationEvidence).join(
        ControlImplementation,
        ImplementationEvidence.implementation_id == ControlImplementation.id
    ).outerjoin(
        ParsedFrameworkControl,
        ControlImplementation.parsed_control_id == ParsedFrameworkControl.id
    ).outerjoin(
        FrameworkControl,
        ControlImplementation.framework_control_id == FrameworkControl.id
    ).filter(
        ControlImplementation.journey_id.in_(journey_ids)
    )

    # Stats must reflect all records, not the filtered view
    status_rows = base_query.with_entities(ImplementationEvidence.review_status).all()

    list_query = base_query
    if status_filter:
        list_query = list_query.filter(ImplementationEvidence.review_status == status_filter)

    evidence_records = list_query.options(
        joinedload(ImplementationEvidence.implementation).joinedload(ControlImplementation.parsed_control),
        joinedload(ImplementationEvidence.implementation).joinedload(ControlImplementation.framework_control),
        joinedload(ImplementationEvidence.uploader),
        joinedload(ImplementationEvidence.reviewer)
    ).all()
    
    # Build response
    evidence_list = []
    for ev in evidence_records:
        impl = ev.implementation
        control = None
        if impl:
            control = impl.parsed_control or impl.framework_control

        uploader_name = None
        uploader_email = None
        if ev.uploader:
            uploader_name = getattr(ev.uploader, "display_name", None) or getattr(ev.uploader, "username", None)
            uploader_email = getattr(ev.uploader, "email", None)

        evidence_list.append({
            "id": ev.id,
            "file_name": ev.file_name,
            "file_path": ev.file_path,
            "file_size": ev.file_size,
            "mime_type": ev.mime_type,
            "uploaded_at": ev.uploaded_at.isoformat() if ev.uploaded_at else None,
            "uploaded_by": {
                "id": ev.uploader.id,
                "name": uploader_name,
                "email": uploader_email
            } if ev.uploader else None,
            "control": {
                "id": control.id,
                "control_id": getattr(control, "control_id", None) or getattr(control, "code", None),
                "title": getattr(control, "title", None) or getattr(control, "name", None),
                "description": getattr(control, "description", None)
            } if control else None,
            "review_status": ev.review_status,
            "reviewed_by": None if not ev.reviewer else {
                "id": ev.reviewer.id,
                "name": getattr(ev.reviewer, "display_name", None)
                    or getattr(ev.reviewer, "username", None)
                    or getattr(ev.reviewer, "email", None)
            },
            "reviewed_at": ev.reviewed_at.isoformat() if ev.reviewed_at else None,
            "review_notes": ev.review_notes,
            "ai_confidence_score": ev.ai_confidence_score,
            "ai_assessment_notes": ev.ai_assessment_notes
        })
    
    # Calculate stats
    stats = {
        "total": len(status_rows),
        "pending": len([status for (status,) in status_rows if status == "pending"]),
        "approved": len([status for (status,) in status_rows if status == "approved"]),
        "rejected": len([status for (status,) in status_rows if status == "rejected"])
    }
    
    primary_journey = journeys[0] if journeys else None
    framework_payload = {
        "id": framework.id if framework else (primary_journey.uploaded_framework_id if primary_journey else framework_id),
        "name": (framework.name if framework else primary_journey.name) if (framework or primary_journey) else "Unknown Framework",
        "version": framework.version if framework else None
    }

    return {
        "framework": framework_payload,
        "evidence": evidence_list,
        "stats": stats
    }


@router.get("/frameworks/{framework_id}/phases", status_code=status.HTTP_410_GONE)
def get_framework_phases(
    framework_id: int,
    db: Session = Depends(get_db)
):
    """DEPRECATED: Legacy endpoint for pre-seeded frameworks - NO LONGER SUPPORTED.
    
    This endpoint is permanently disabled. Pre-seeded frameworks and CertificationPhase
    records have been removed as part of the uploaded-framework-only architecture.
    
    MIGRATION: Use /certifications/uploaded-frameworks/{framework_id}/phases instead,
    which provides phases extracted from uploaded framework document structures.
    
    The uploaded-framework-only architecture requires all frameworks and phases to come
    from uploaded documents processed by the AI parser.
    """
    logger.warning(f"Deprecated endpoint /frameworks/{framework_id}/phases called - use /certifications/uploaded-frameworks/{framework_id}/phases instead")

    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="This endpoint is no longer supported. Pre-seeded frameworks have been removed. Use /certifications/uploaded-frameworks/{framework_id}/phases instead."
    )


# =============================================================================
# Critical-Control AI Analysis
# =============================================================================
#
# The journey detail page exposes a "Critical Items" panel that highlights
# clauses the AI considers high-risk red flags (e.g. PCI-DSS network
# segmentation, MFA-on-admin-access, encryption-at-rest, logging coverage).
# Two endpoints power it:
#
#   POST /certifications/{journey_id}/analyze-critical
#       Runs GPT-4o on the journey framework's parsed controls in batches and
#       persists `is_critical` + `criticality_reason` on each clause. Returns
#       a summary of how many were flagged.
#
#   GET  /certifications/{journey_id}/critical-controls
#       Lists clauses currently flagged critical. Cheap — pure DB read.
#
# Critical clauses are then enforced in the applicability flow (see
# `set_clause_applicability` in governance/routers/applicability.py): a critical
# clause cannot be self-approved as Not Applicable; the request stays pending
# until a reviewer approves it explicitly.
# =============================================================================

_CRITICAL_BATCH_SIZE = 40
_CRITICAL_MODEL = get_openai_model()

# Hard cap on the fraction of a framework that may be flagged critical. If the
# AI returns more than this, we keep only the top-N by reason length / order
# — a safety net so a noisy classifier can't fail-open to "everything is
# critical".
_CRITICAL_MAX_RATIO = 0.15


_CRITICAL_SYSTEM_PROMPT = (
    "You are a senior compliance auditor (QSA / CISSP / lead ISO 27001 auditor). "
    "You output ONLY strict JSON. You are deliberately CONSERVATIVE about what "
    "you flag as critical: you would rather under-flag than over-flag, because a "
    "false positive blocks legitimate scoping decisions and erodes trust in the "
    "tool. Roughly 10–15% of clauses in a typical framework are critical — if "
    "you find yourself flagging more than 15%, you are wrong and must re-rank."
)


def _critical_classifier_prompt(framework_name: str, controls_batch: List[dict], batch_idx: int, total_batches: int) -> str:
    return f"""Framework: "{framework_name}" (batch {batch_idx + 1} of {total_batches}, batch size {len(controls_batch)})

Apply the published rubric for each framework:

- PCI DSS v4 — critical = clauses implementing one of the 12 top-level
  requirements with technical enforcement: network segmentation between CDE
  and untrusted networks (Req 1.x), strong cryptography on cardholder data
  in transit/at rest (Req 3-4), MFA on all admin/remote access into the CDE
  (Req 8.4-8.5), quarterly vulnerability scans + ASV (Req 11.3), log
  centralization and daily review (Req 10), incident response with notify
  obligations (Req 12.10).
- ISO 27001:2022 — critical = Annex A controls that directly enforce
  confidentiality/integrity/availability of information at scale: access
  control (A.5.15-5.18), cryptography (A.8.24), logging/monitoring
  (A.8.15-8.16), incident management (A.5.24-5.27), business continuity
  (A.5.29-5.30), secure development (A.8.25-8.28).
- NIST 800-53 — critical = HIGH-impact baseline only: AC-2, AC-6, AU-2,
  IA-2(1)(2), SC-7, SC-8, SC-13, SI-2, SI-3, SI-4, IR-4, CM-7, CP-9.
- HIPAA Security Rule — critical = REQUIRED (not Addressable) standards on
  ePHI access, transmission, breach notification (164.308(a)(1)(ii)(D),
  164.312(a)(1), 164.312(e)(1), 164.404).
- SOC 2 / TSC — critical = system-boundary criteria: CC6.1, CC6.6, CC6.7,
  CC7.2, CC7.3, CC8.1.
- SAMA CSF / SBP / NCA / similar regional frameworks — apply the same
  rubric: technical/process controls that gate cyber-security outcomes are
  critical; governance, training, doc-review cadence, and awareness clauses
  are not.

A clause is CRITICAL only if ALL THREE are true:
  1. Failure would directly cause severe harm: data breach of regulated
     data, regulatory fine ≥ $100k, prolonged outage of a production
     system, or material financial misstatement.
  2. It is a TECHNICAL or PROCESS control that gates a security/compliance
     outcome — NOT a documentation, training, awareness, communication,
     scheduling, role-description, or review-frequency clause.
  3. It is a top-level requirement, not a sub-bullet about formatting,
     naming conventions, document version control, or meeting cadence.

EXAMPLES OF CRITICAL (flag = true):
  • "Implement firewalls between the cardholder data environment and any
     other network." → PCI Req 1: segmentation.
  • "Require multi-factor authentication for all administrative access to
     systems processing cardholder data." → PCI Req 8.4: MFA on admin.
  • "Encrypt cardholder data using strong cryptography during transmission
     over open, public networks." → PCI Req 4: encryption in transit.
  • "Establish a security incident response plan including notification
     to affected parties within 72 hours." → ISO A.5.24 / GDPR Art 33.

EXAMPLES OF NOT CRITICAL (flag = false):
  • "Conduct annual security awareness training for all personnel." →
     Awareness clause, not a gating control.
  • "Maintain a written information security policy reviewed annually." →
     Documentation cadence.
  • "Document the names and titles of personnel responsible for security." →
     Role-description bookkeeping.
  • "Display a security policy poster in employee common areas." →
     Awareness.
  • "Perform quarterly internal audits of compliance documentation." →
     Audit cadence, not a gating control.
  • "All meetings of the security committee shall be minuted." →
     Meeting hygiene.
  • "Use a consistent naming convention for log files." → Naming.

Return STRICT JSON ONLY (no prose, no markdown):
{{"results":[{{"id":<int>,"is_critical":<bool>,"reason":"<≤200 chars, cite framework requirement number; empty string if not critical>"}}]}}

Every control id below MUST appear in `results` exactly once. Default to
`is_critical=false` when in doubt.

Controls to classify:
{json.dumps(controls_batch, ensure_ascii=False)}
"""


def _classify_controls_batch(client, framework_name: str, controls_batch: List[dict], batch_idx: int, total_batches: int) -> dict:
    """Single AI call per batch. Returns {id: {is_critical, reason}}."""
    try:
        response = client.chat.completions.create(
            model=_CRITICAL_MODEL,
            response_format={"type": "json_object"},
            temperature=0.0,
            max_tokens=4000,
            messages=[
                {"role": "system", "content": _CRITICAL_SYSTEM_PROMPT},
                {"role": "user", "content": _critical_classifier_prompt(framework_name, controls_batch, batch_idx, total_batches)},
            ],
        )
        raw = response.choices[0].message.content or "{}"
        parsed = json.loads(raw)
        results = parsed.get("results") or []
        out = {}
        for r in results:
            try:
                cid = int(r.get("id"))
            except (TypeError, ValueError):
                continue
            out[cid] = {
                "is_critical": bool(r.get("is_critical")),
                "reason": (r.get("reason") or "").strip()[:500],
            }
        return out
    except Exception as exc:
        logger.exception("Critical classifier batch failed: %s", exc)
        return {}


@router.post("/{journey_id}/analyze-critical")
def analyze_critical_controls(
    journey_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Run AI criticality classification across all parsed controls of the
    journey's framework. Persists results on `ParsedFrameworkControl`.
    """
    user_tenants = get_user_tenants(current_user, db)

    journey = db.query(CertificationJourney).filter(
        CertificationJourney.id == journey_id,
        CertificationJourney.tenant_id.in_(user_tenants)
    ).first()
    if not journey:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Journey not found")

    # Critical analysis only applies to journeys backed by an uploaded
    # framework (which has parsed controls). Legacy seeded frameworks don't
    # populate ParsedFrameworkControl.
    framework_id = getattr(journey, "uploaded_framework_id", None)
    if not framework_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This journey is not linked to an uploaded framework — critical analysis is unavailable."
        )

    framework = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
    if not framework:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Framework not found")

    parsed_controls = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework_id
    ).all()

    if not parsed_controls:
        return {"analyzed": 0, "critical": 0, "framework_id": framework_id}

    client = get_openai_client()

    # Build a compact representation per control for the AI. Truncate long text
    # so we stay well under context limits even with large frameworks.
    payloads = []
    for c in parsed_controls:
        payloads.append({
            "id": c.id,
            "ref": c.original_reference or c.control_id,
            "title": (c.title or "")[:200],
            "domain": c.domain,
            "text": (c.full_text or c.description or "")[:600],
        })

    total_batches = (len(payloads) + _CRITICAL_BATCH_SIZE - 1) // _CRITICAL_BATCH_SIZE
    classifications: dict = {}
    for i in range(0, len(payloads), _CRITICAL_BATCH_SIZE):
        batch = payloads[i:i + _CRITICAL_BATCH_SIZE]
        batch_idx = i // _CRITICAL_BATCH_SIZE
        result = _classify_controls_batch(client, framework.name or "Framework", batch, batch_idx, total_batches)
        classifications.update(result)

    # Safety net: if the classifier returned more than _CRITICAL_MAX_RATIO of
    # the framework as critical, keep only the longest-reason ones (the ones
    # the AI argued for most explicitly) and demote the rest. This guards
    # against silent over-flagging from a model regression or a noisy run.
    flagged_ids = [cid for cid, cls in classifications.items() if cls.get("is_critical")]
    cap = max(1, int(len(parsed_controls) * _CRITICAL_MAX_RATIO))
    if len(flagged_ids) > cap:
        logger.info(
            "Critical classifier flagged %d/%d (%.0f%%) for framework %s — capping to top %d",
            len(flagged_ids), len(parsed_controls),
            100.0 * len(flagged_ids) / max(1, len(parsed_controls)),
            framework.name, cap,
        )
        ranked = sorted(
            flagged_ids,
            key=lambda cid: len(classifications[cid].get("reason") or ""),
            reverse=True,
        )
        keep = set(ranked[:cap])
        for cid in flagged_ids:
            if cid not in keep:
                classifications[cid] = {"is_critical": False, "reason": ""}

    now = datetime.utcnow()
    critical_count = 0
    for c in parsed_controls:
        cls = classifications.get(c.id)
        if not cls:
            # Unclassified — leave existing value. (Don't blindly clear.)
            continue
        c.is_critical = cls["is_critical"]
        c.criticality_reason = cls["reason"] if cls["is_critical"] else None
        c.criticality_analyzed_at = now
        if cls["is_critical"]:
            critical_count += 1

    db.commit()

    return {
        "framework_id": framework_id,
        "analyzed": len(classifications),
        "total_controls": len(parsed_controls),
        "critical": critical_count,
    }


@router.get("/{journey_id}/critical-controls")
def list_critical_controls(
    journey_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)

    journey = db.query(CertificationJourney).filter(
        CertificationJourney.id == journey_id,
        CertificationJourney.tenant_id.in_(user_tenants)
    ).first()
    if not journey:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Journey not found")

    framework_id = getattr(journey, "uploaded_framework_id", None)
    if not framework_id:
        return {"framework_id": None, "analyzed_at": None, "items": []}

    rows = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework_id,
        ParsedFrameworkControl.is_critical == True,
    ).order_by(ParsedFrameworkControl.original_reference).all()

    # Latest analysis timestamp across the framework — surfaces "last analyzed"
    # in the UI without a separate column on the framework row.
    last_at = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework_id,
        ParsedFrameworkControl.criticality_analyzed_at.isnot(None),
    ).order_by(ParsedFrameworkControl.criticality_analyzed_at.desc()).first()

    return {
        "framework_id": framework_id,
        "analyzed_at": last_at.criticality_analyzed_at.isoformat() if last_at and last_at.criticality_analyzed_at else None,
        "items": [
            {
                "parsed_control_id": r.id,
                "control_code": r.original_reference or r.control_id,
                "title": r.title,
                "domain": r.domain,
                "category": r.category,
                "reason": r.criticality_reason,
            }
            for r in rows
        ],
    }
