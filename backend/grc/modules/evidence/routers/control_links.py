from typing import List, Optional
import re
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, or_
from pydantic import BaseModel

from ....models import (
    Evidence, EvidenceControlMapping, NormalizedControl, FrameworkControl,
    ControlObjective, FrameworkDomain, Framework, GRCUser, get_db,
    ParsedFrameworkControl, UploadedFramework, ControlImplementation,
    ImplementationEvidence, CertificationJourney
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/links", tags=["Evidence - Control Links"])


class ControlLinkCreate(BaseModel):
    normalized_control_id: Optional[int] = None
    framework_control_id: Optional[int] = None
    parsed_control_id: Optional[int] = None
    uploaded_framework_id: Optional[int] = None


class BulkControlLinkCreate(BaseModel):
    control_links: List[ControlLinkCreate]


class AIClauseLinkCreate(BaseModel):
    """Create a control link based on AI clause mapping suggestion"""
    framework_name: str
    control_id: str
    clause_reference: Optional[str] = None
    confidence: Optional[float] = None
    matching_rationale: Optional[str] = None


@router.get("/available-controls")
def list_available_controls(
    q: Optional[str] = Query(None, description="Search term for framework or control titles"),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Return uploaded frameworks with their parsed controls (for manual linking UI)."""
    user_tenants = get_user_tenants(current_user, db)
    scope_filter = or_(
        UploadedFramework.tenant_id.in_(user_tenants),
        UploadedFramework.is_shared == True,
        UploadedFramework.tenant_id.is_(None)
    )

    frameworks_q = db.query(UploadedFramework).filter(scope_filter)
    if q:
        frameworks_q = frameworks_q.filter(UploadedFramework.name.ilike(f"%{q}%"))
    frameworks = frameworks_q.order_by(UploadedFramework.name.asc()).all()

    response = []
    for fw in frameworks:
        controls_q = db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.uploaded_framework_id == fw.id)
        if q:
            controls_q = controls_q.filter(
                or_(
                    ParsedFrameworkControl.control_id.ilike(f"%{q}%"),
                    ParsedFrameworkControl.original_reference.ilike(f"%{q}%"),
                    ParsedFrameworkControl.title.ilike(f"%{q}%"),
                )
            )
        controls = controls_q.order_by(ParsedFrameworkControl.control_id.asc()).limit(limit).all()
        response.append({
            "id": fw.id,
            "name": fw.name,
            "short_code": fw.name,
            "controls": [
                {
                    "id": c.id,
                    "control_id": c.control_id,
                    "original_reference": c.original_reference,
                    "title": c.title,
                }
                for c in controls
            ]
        })

    normalized_controls = db.query(NormalizedControl).order_by(NormalizedControl.code.asc()).limit(limit).all()

    return {
        "frameworks": response,
        "normalized_controls": [
            {"id": nc.id, "code": nc.code, "name": nc.name}
            for nc in normalized_controls
        ]
    }


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def _normalize_text(value: Optional[str]) -> str:
    if not value:
        return ""
    return re.sub(r"[^a-z0-9]", "", value.lower())


def serialize_control_mapping(mapping: EvidenceControlMapping) -> dict:
    result = {
        "id": mapping.id,
        "evidence_id": mapping.evidence_id,
        "normalized_control_id": mapping.normalized_control_id,
        "framework_control_id": mapping.framework_control_id,
        "parsed_control_id": mapping.parsed_control_id,
        "uploaded_framework_id": mapping.uploaded_framework_id,
    }
    
    if mapping.normalized_control:
        result["normalized_control"] = {
            "id": mapping.normalized_control.id,
            "code": mapping.normalized_control.code,
            "name": mapping.normalized_control.name,
            "statement": mapping.normalized_control.statement,
        }
    else:
        result["normalized_control"] = None
    
    if mapping.framework_control:
        fc = mapping.framework_control
        framework_info = None
        if fc.objective and fc.objective.domain and fc.objective.domain.framework:
            fw = fc.objective.domain.framework
            framework_info = {
                "id": fw.id,
                "name": fw.name,
                "short_code": fw.short_code,
            }
        
        result["framework_control"] = {
            "id": fc.id,
            "code": fc.code,
            "name": fc.name,
            "statement": fc.statement,
            "framework": framework_info,
        }
    else:
        result["framework_control"] = None

    if mapping.parsed_control:
        result["parsed_control"] = {
            "id": mapping.parsed_control.id,
            "control_id": mapping.parsed_control.control_id,
            "original_reference": mapping.parsed_control.original_reference,
            "title": mapping.parsed_control.title,
            "uploaded_framework_id": mapping.parsed_control.uploaded_framework_id,
        }
        if mapping.parsed_control.uploaded_framework:
            result["parsed_control"]["framework"] = {
                "id": mapping.parsed_control.uploaded_framework.id,
                "name": mapping.parsed_control.uploaded_framework.name,
                "short_code": mapping.parsed_control.uploaded_framework.name,
            }
    else:
        result["parsed_control"] = None
    
    return result


@router.get("/{evidence_id}/controls")
def get_evidence_controls(
    evidence_id: int,
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
    
    mappings = db.query(EvidenceControlMapping).options(
        joinedload(EvidenceControlMapping.normalized_control),
        joinedload(EvidenceControlMapping.framework_control)
        .joinedload(FrameworkControl.objective)
        .joinedload(ControlObjective.domain)
        .joinedload(FrameworkDomain.framework)
        ,
        joinedload(EvidenceControlMapping.parsed_control)
        .joinedload(ParsedFrameworkControl.uploaded_framework)
    ).filter(
        EvidenceControlMapping.evidence_id == evidence_id
    ).all()
    
    by_framework = {}
    normalized_controls = []
    
    for mapping in mappings:
        serialized = serialize_control_mapping(mapping)
        
        if mapping.normalized_control:
            normalized_controls.append(serialized)
        
        if mapping.framework_control:
            fc = mapping.framework_control
            if fc.objective and fc.objective.domain and fc.objective.domain.framework:
                fw = fc.objective.domain.framework
                fw_key = str(fw.id)
                if fw_key not in by_framework:
                    by_framework[fw_key] = {
                        "framework_id": fw.id,
                        "framework_name": fw.name,
                        "framework_code": fw.short_code,
                        "controls": []
                    }
                by_framework[fw_key]["controls"].append(serialized)

        elif mapping.parsed_control and mapping.parsed_control.uploaded_framework:
            fw = mapping.parsed_control.uploaded_framework
            fw_key = f"parsed-{fw.id}"
            if fw_key not in by_framework:
                by_framework[fw_key] = {
                    "framework_id": fw.id,
                    "framework_name": fw.name,
                    "framework_code": fw.short_code if hasattr(fw, "short_code") else fw.name,
                    "controls": []
                }
            by_framework[fw_key]["controls"].append(serialized)
    
    return {
        "evidence_id": evidence_id,
        "evidence_name": evidence.name,
        "total_mappings": len(mappings),
        "normalized_controls": normalized_controls,
        "by_framework": list(by_framework.values())
    }


@router.post("/{evidence_id}/controls", status_code=status.HTTP_201_CREATED)
def link_evidence_to_controls(
    evidence_id: int,
    links: BulkControlLinkCreate,
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
    
    created_mappings = []
    skipped = []
    
    for link in links.control_links:
        if not link.normalized_control_id and not link.framework_control_id and not link.parsed_control_id:
            skipped.append({
                "reason": "One of normalized_control_id, framework_control_id, or parsed_control_id is required"
            })
            continue
        
        if link.normalized_control_id:
            control = db.query(NormalizedControl).filter(
                NormalizedControl.id == link.normalized_control_id
            ).first()
            if not control:
                skipped.append({
                    "normalized_control_id": link.normalized_control_id,
                    "reason": "Normalized control not found"
                })
                continue
        
        if link.framework_control_id:
            fc = db.query(FrameworkControl).filter(
                FrameworkControl.id == link.framework_control_id
            ).first()
            if not fc:
                skipped.append({
                    "framework_control_id": link.framework_control_id,
                    "reason": "Framework control not found"
                })
                continue

        parsed_control = None
        if link.parsed_control_id:
            parsed_control = db.query(ParsedFrameworkControl).filter(
                ParsedFrameworkControl.id == link.parsed_control_id
            ).first()
            if not parsed_control:
                skipped.append({
                    "parsed_control_id": link.parsed_control_id,
                    "reason": "Parsed control not found"
                })
                continue
        
        existing = db.query(EvidenceControlMapping).filter(
            EvidenceControlMapping.evidence_id == evidence_id,
            EvidenceControlMapping.normalized_control_id == link.normalized_control_id,
            EvidenceControlMapping.framework_control_id == link.framework_control_id,
            EvidenceControlMapping.parsed_control_id == link.parsed_control_id
        ).first()
        
        if existing:
            skipped.append({
                "normalized_control_id": link.normalized_control_id,
                "framework_control_id": link.framework_control_id,
                "reason": "Mapping already exists"
            })
            continue
        
        mapping = EvidenceControlMapping(
            evidence_id=evidence_id,
            normalized_control_id=link.normalized_control_id,
            framework_control_id=link.framework_control_id,
            parsed_control_id=link.parsed_control_id,
            uploaded_framework_id=link.uploaded_framework_id or (parsed_control.uploaded_framework_id if parsed_control else None),
        )
        db.add(mapping)
        db.flush()

        # Auto-link into journey implementations so it appears on controls/auditor screens
        impl_query = db.query(ControlImplementation).join(CertificationJourney).filter(
            CertificationJourney.tenant_id.in_(user_tenants)
        )
        if link.parsed_control_id:
            impl_query = impl_query.filter(ControlImplementation.parsed_control_id == link.parsed_control_id)
        elif link.framework_control_id:
            impl_query = impl_query.filter(ControlImplementation.framework_control_id == link.framework_control_id)
        implementations = impl_query.all()

        for impl in implementations:
            exists_impl_ev = db.query(ImplementationEvidence).filter(
                ImplementationEvidence.implementation_id == impl.id,
                ImplementationEvidence.evidence_id == evidence_id
            ).first()
            if exists_impl_ev:
                continue
            impl_ev = ImplementationEvidence(
                implementation_id=impl.id,
                evidence_id=evidence_id,
                file_name=evidence.file_name or evidence.name,
                file_path=evidence.file_path,
                file_size=getattr(evidence, "file_size", None),
                mime_type=evidence.file_type,
                uploaded_by=current_user.id,
                review_status="pending",
                ai_confidence_score=None,
                ai_assessment_notes=None,
            )
            db.add(impl_ev)

        created_mappings.append(mapping.id)
    
    db.commit()
    
    new_mappings = db.query(EvidenceControlMapping).options(
        joinedload(EvidenceControlMapping.normalized_control),
        joinedload(EvidenceControlMapping.framework_control)
    ).filter(
        EvidenceControlMapping.id.in_(created_mappings)
    ).all()
    
    return {
        "evidence_id": evidence_id,
        "created_count": len(created_mappings),
        "skipped_count": len(skipped),
        "created_mappings": [serialize_control_mapping(m) for m in new_mappings],
        "skipped": skipped
    }


@router.delete("/{evidence_id}/controls/{mapping_id}")
def unlink_evidence_from_control(
    evidence_id: int,
    mapping_id: int,
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
    
    mapping = db.query(EvidenceControlMapping).filter(
        EvidenceControlMapping.id == mapping_id,
        EvidenceControlMapping.evidence_id == evidence_id
    ).first()
    
    if not mapping:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control mapping not found"
        )
    
    db.delete(mapping)
    db.commit()
    
    return {"message": "Control mapping removed successfully"}


@router.post("/{evidence_id}/link-from-ai", status_code=status.HTTP_201_CREATED)
def link_evidence_from_ai_suggestion(
    evidence_id: int,
    link_data: AIClauseLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """
    Create a control mapping based on an AI clause mapping suggestion.
    This allows users to confirm AI-suggested links with a single click.
    """
    user_tenants = get_user_tenants(current_user, db)
    
    # Verify evidence access and provide precise error semantics
    evidence_any_tenant = db.query(Evidence).filter(Evidence.id == evidence_id).first()
    if not evidence_any_tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )

    if evidence_any_tenant.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this evidence in the current tenant context"
        )

    evidence = evidence_any_tenant
    
    framework_scope_filter = or_(
        UploadedFramework.tenant_id.in_(user_tenants),
        UploadedFramework.is_shared == True,
        UploadedFramework.tenant_id.is_(None)
    )

    # Find the framework by name using multiple matching strategies
    # Strategy 1: Exact match (case-insensitive)
    framework = db.query(UploadedFramework).filter(
        framework_scope_filter,
        func.lower(UploadedFramework.name) == func.lower(link_data.framework_name)
    ).first()
    
    # Strategy 2: Framework name contains search term
    if not framework:
        framework = db.query(UploadedFramework).filter(
            framework_scope_filter,
            UploadedFramework.name.ilike(f"%{link_data.framework_name}%")
        ).first()
    
    # Strategy 3: Search term contains framework name (handles "SBP ETGRMF v2018" matching "SBP ETGRMF")
    if not framework:
        all_frameworks = db.query(UploadedFramework).filter(
            framework_scope_filter
        ).all()
        search_lower = link_data.framework_name.lower()
        for fw in all_frameworks:
            if fw.name.lower() in search_lower:
                framework = fw
                break

    # Strategy 4: Normalized match (ignore spaces, punctuation, separators)
    if not framework:
        normalized_framework_name = _normalize_text(link_data.framework_name)
        all_frameworks = db.query(UploadedFramework).filter(
            framework_scope_filter
        ).all()
        for fw in all_frameworks:
            normalized_fw_name = _normalize_text(fw.name)
            if not normalized_framework_name or not normalized_fw_name:
                continue
            if normalized_fw_name == normalized_framework_name:
                framework = fw
                break
            if normalized_fw_name in normalized_framework_name or normalized_framework_name in normalized_fw_name:
                framework = fw
                break

    # Strategy 4b: Token overlap match for long AI display names vs uploaded names
    if not framework:
        all_frameworks = db.query(UploadedFramework).filter(framework_scope_filter).all()
        search_tokens = {
            token for token in re.findall(r"[a-z0-9]+", (link_data.framework_name or "").lower())
            if len(token) >= 3
        }
        best_match = None
        best_score = 0
        for fw in all_frameworks:
            fw_tokens = {
                token for token in re.findall(r"[a-z0-9]+", (fw.name or "").lower())
                if len(token) >= 3
            }
            if not fw_tokens or not search_tokens:
                continue
            overlap = len(search_tokens.intersection(fw_tokens))
            if overlap > best_score:
                best_score = overlap
                best_match = fw
        if best_match and best_score >= 2:
            framework = best_match
    
    # Strategy 5: If framework name fails, infer framework from matched control identifiers
    if not framework:
        identifier_candidates = {
            link_data.control_id,
            link_data.clause_reference,
        }
        identifier_candidates = {value for value in identifier_candidates if value}

        inferred_controls = []
        if identifier_candidates:
            inferred_controls = db.query(ParsedFrameworkControl).join(
                UploadedFramework,
                ParsedFrameworkControl.uploaded_framework_id == UploadedFramework.id
            ).filter(
                framework_scope_filter
            ).filter(
                (ParsedFrameworkControl.control_id.in_(identifier_candidates)) |
                (ParsedFrameworkControl.original_reference.in_(identifier_candidates)) |
                (ParsedFrameworkControl.section_number.in_(identifier_candidates))
            ).all()

        if len(inferred_controls) == 1:
            control_candidate = inferred_controls[0]
            framework = db.query(UploadedFramework).filter(
                UploadedFramework.id == control_candidate.uploaded_framework_id
            ).first()

    if not framework:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Framework '{link_data.framework_name}' was not found in your tenant uploaded compliance frameworks"
        )
    
    # Find the control by control_id within this framework
    # First pass: strict direct match
    control = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework.id
    ).filter(
        (ParsedFrameworkControl.control_id == link_data.control_id) |
        (ParsedFrameworkControl.original_reference == link_data.control_id) |
        (ParsedFrameworkControl.section_number == link_data.control_id)
    ).first()

    # Second pass: use clause reference when provided
    if not control and link_data.clause_reference:
        control = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == framework.id
        ).filter(
            (ParsedFrameworkControl.control_id == link_data.clause_reference) |
            (ParsedFrameworkControl.original_reference == link_data.clause_reference) |
            (ParsedFrameworkControl.section_number == link_data.clause_reference)
        ).first()

    # Third pass: normalized/fuzzy match across key identifier fields used in compliance
    if not control:
        search_tokens = {
            _normalize_text(link_data.control_id),
            _normalize_text(link_data.clause_reference),
        }
        search_tokens = {token for token in search_tokens if token}

        controls_in_framework = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == framework.id
        ).all()

        for candidate in controls_in_framework:
            candidate_tokens = {
                _normalize_text(candidate.control_id),
                _normalize_text(candidate.original_reference),
                _normalize_text(candidate.section_number),
            }
            candidate_tokens = {token for token in candidate_tokens if token}

            if search_tokens.intersection(candidate_tokens):
                control = candidate
                break

            matched = False
            for s in search_tokens:
                for c in candidate_tokens:
                    if len(s) >= 3 and len(c) >= 3 and (s in c or c in s):
                        matched = True
                        break
                if matched:
                    break
            if matched:
                control = candidate
                break

    # Fourth pass: title contains control token (last resort for exact framework only)
    if not control and link_data.control_id:
        normalized_control = _normalize_text(link_data.control_id)
        controls_in_framework = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == framework.id
        ).all()
        for candidate in controls_in_framework:
            if normalized_control and normalized_control in _normalize_text(candidate.title):
                control = candidate
                break
    
    if not control:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Could not match AI control '{link_data.control_id}' (clause '{link_data.clause_reference}') "
                f"in framework '{framework.name}'. Please verify the framework upload and run AI assessment again."
            )
        )
    
    # Check if mapping already exists
    existing = db.query(EvidenceControlMapping).filter(
        EvidenceControlMapping.evidence_id == evidence_id,
        EvidenceControlMapping.parsed_control_id == control.id
    ).first()
    
    if existing:
        return {
            "message": "Link already exists",
            "already_linked": True,
            "mapping_id": existing.id,
            "evidence_id": evidence_id,
            "framework_name": framework.name,
            "control_id": control.control_id,
            "control_title": control.title
        }
    
    # Create the mapping
    mapping = EvidenceControlMapping(
        evidence_id=evidence_id,
        parsed_control_id=control.id,
        uploaded_framework_id=framework.id,
        framework_name=framework.name,
        control_code=control.control_id,
        clause_reference=link_data.clause_reference,
        control_title=control.title,
        confidence_score=link_data.confidence,
        matching_rationale=link_data.matching_rationale,
        coverage_type="user_confirmed"
    )
    db.add(mapping)
    db.flush()
    
    # Also create ImplementationEvidence records for any certification journeys 
    # that include this control, so it appears on the certification controls page
    control_implementations = db.query(ControlImplementation).filter(
        ControlImplementation.parsed_control_id == control.id
    ).all()
    
    impl_evidence_created = 0
    for impl in control_implementations:
        # Check if this evidence is already linked to this implementation
        existing_impl_evidence = db.query(ImplementationEvidence).filter(
            ImplementationEvidence.implementation_id == impl.id,
            ImplementationEvidence.evidence_id == evidence_id
        ).first()
        
        if not existing_impl_evidence:
            impl_evidence = ImplementationEvidence(
                implementation_id=impl.id,
                evidence_id=evidence_id,
                file_name=evidence.name,
                uploaded_by=current_user.id,
                ai_confidence_score=link_data.confidence,
                ai_assessment_notes=link_data.matching_rationale,
                review_status="pending"
            )
            db.add(impl_evidence)
            impl_evidence_created += 1
    
    db.commit()
    db.refresh(mapping)
    
    return {
        "message": "Evidence linked to control successfully",
        "already_linked": False,
        "mapping_id": mapping.id,
        "evidence_id": evidence_id,
        "framework_name": framework.name,
        "control_id": control.control_id,
        "control_title": control.title,
        "original_reference": control.original_reference,
        "implementation_evidence_created": impl_evidence_created
    }


@router.get("/{evidence_id}/ai-link-status")
def get_ai_link_status(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """
    Get the link status for all AI-suggested clause mappings for an evidence.
    Returns which controls are already linked vs pending.
    """
    user_tenants = get_user_tenants(current_user, db)
    
    # Verify evidence access
    evidence = db.query(Evidence).filter(
        Evidence.id == evidence_id,
        Evidence.tenant_id.in_(user_tenants)
    ).first()
    
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    # Get all existing mappings for this evidence (to parsed controls)
    existing_mappings = db.query(EvidenceControlMapping).filter(
        EvidenceControlMapping.evidence_id == evidence_id,
        EvidenceControlMapping.parsed_control_id.isnot(None)
    ).all()
    
    # Build a lookup of linked control IDs
    linked_controls = {}
    for mapping in existing_mappings:
        if mapping.parsed_control_id:
            control = db.query(ParsedFrameworkControl).filter(
                ParsedFrameworkControl.id == mapping.parsed_control_id
            ).first()
            if control:
                framework = db.query(UploadedFramework).filter(
                    UploadedFramework.id == control.uploaded_framework_id
                ).first()
                if framework:
                    key = f"{framework.name}:{control.control_id}"
                    linked_controls[key] = {
                        "mapping_id": mapping.id,
                        "control_id": control.control_id,
                        "original_reference": control.original_reference,
                        "framework_name": framework.name
                    }
    
    return {
        "evidence_id": evidence_id,
        "linked_controls": linked_controls,
        "total_linked": len(linked_controls)
    }


@router.get("/coverage")
def get_evidence_coverage(
    framework_id: Optional[int] = None,
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {
            "total_controls": 0,
            "controls_with_evidence": 0,
            "controls_without_evidence": 0,
            "coverage_percentage": 0,
            "frameworks": []
        }
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
    
    evidence_filter = Evidence.tenant_id.in_(user_tenants)
    if tenant_id:
        evidence_filter = Evidence.tenant_id == tenant_id
    
    tenant_evidence_ids = db.query(Evidence.id).filter(evidence_filter).subquery()
    
    covered_fc_ids = db.query(EvidenceControlMapping.framework_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.framework_control_id.isnot(None)
    ).distinct().subquery()
    
    fc_query = db.query(FrameworkControl).options(
        joinedload(FrameworkControl.objective)
        .joinedload(ControlObjective.domain)
        .joinedload(FrameworkDomain.framework)
    )
    
    if framework_id:
        fc_query = fc_query.join(
            ControlObjective, FrameworkControl.objective_id == ControlObjective.id
        ).join(
            FrameworkDomain, ControlObjective.domain_id == FrameworkDomain.id
        ).filter(FrameworkDomain.framework_id == framework_id)
    
    all_controls = fc_query.all()
    
    covered_ids_list = [row[0] for row in db.query(covered_fc_ids.c.framework_control_id).all()]
    covered_ids_set = set(covered_ids_list)
    
    frameworks_data = {}
    
    for control in all_controls:
        if not control.objective or not control.objective.domain or not control.objective.domain.framework:
            continue
        
        fw = control.objective.domain.framework
        fw_key = str(fw.id)
        
        if fw_key not in frameworks_data:
            frameworks_data[fw_key] = {
                "framework_id": fw.id,
                "framework_name": fw.name,
                "framework_code": fw.short_code,
                "total_controls": 0,
                "controls_with_evidence": 0,
                "controls_without_evidence": 0,
                "coverage_percentage": 0,
                "controls": []
            }
        
        has_evidence = control.id in covered_ids_set
        frameworks_data[fw_key]["total_controls"] += 1
        
        if has_evidence:
            frameworks_data[fw_key]["controls_with_evidence"] += 1
        else:
            frameworks_data[fw_key]["controls_without_evidence"] += 1
        
        frameworks_data[fw_key]["controls"].append({
            "id": control.id,
            "code": control.code,
            "name": control.name,
            "has_evidence": has_evidence
        })
    
    for fw_key in frameworks_data:
        fw_data = frameworks_data[fw_key]
        if fw_data["total_controls"] > 0:
            fw_data["coverage_percentage"] = round(
                (fw_data["controls_with_evidence"] / fw_data["total_controls"]) * 100, 1
            )
    
    total_controls = sum(fw["total_controls"] for fw in frameworks_data.values())
    total_with_evidence = sum(fw["controls_with_evidence"] for fw in frameworks_data.values())
    total_without = sum(fw["controls_without_evidence"] for fw in frameworks_data.values())
    
    overall_coverage = 0
    if total_controls > 0:
        overall_coverage = round((total_with_evidence / total_controls) * 100, 1)
    
    return {
        "total_controls": total_controls,
        "controls_with_evidence": total_with_evidence,
        "controls_without_evidence": total_without,
        "coverage_percentage": overall_coverage,
        "frameworks": list(frameworks_data.values())
    }
