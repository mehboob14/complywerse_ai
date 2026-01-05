from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from pydantic import BaseModel

from ....models import (
    Evidence, EvidenceControlMapping, NormalizedControl, FrameworkControl,
    ControlObjective, FrameworkDomain, Framework, GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/links", tags=["Evidence - Control Links"])


class ControlLinkCreate(BaseModel):
    normalized_control_id: Optional[int] = None
    framework_control_id: Optional[int] = None


class BulkControlLinkCreate(BaseModel):
    control_links: List[ControlLinkCreate]


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def serialize_control_mapping(mapping: EvidenceControlMapping) -> dict:
    result = {
        "id": mapping.id,
        "evidence_id": mapping.evidence_id,
        "normalized_control_id": mapping.normalized_control_id,
        "framework_control_id": mapping.framework_control_id,
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
        if not link.normalized_control_id and not link.framework_control_id:
            skipped.append({
                "reason": "Either normalized_control_id or framework_control_id is required"
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
        
        existing = db.query(EvidenceControlMapping).filter(
            EvidenceControlMapping.evidence_id == evidence_id,
            EvidenceControlMapping.normalized_control_id == link.normalized_control_id,
            EvidenceControlMapping.framework_control_id == link.framework_control_id
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
            framework_control_id=link.framework_control_id
        )
        db.add(mapping)
        db.flush()
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
