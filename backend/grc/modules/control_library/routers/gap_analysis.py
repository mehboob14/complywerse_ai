import csv
import io
import json
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, func, and_, not_, exists
from pydantic import BaseModel

from ....models import (
    CommonControlGroup, CommonControlGroupMapping, NormalizedControl,
    FrameworkControl, FrameworkDomain, ControlObjective, Framework,
    Evidence, EvidenceControlMapping, AIEvidenceRecommendation,
    GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/gap-analysis", tags=["Control Library - Gap Analysis"])


class ExportRequest(BaseModel):
    format: str = "json"
    include_details: bool = True


def get_unmapped_control_count(db: Session, tenant_id: int, framework_id: Optional[int] = None) -> int:
    mapped_normalized_ids = db.query(CommonControlGroupMapping.normalized_control_id).filter(
        CommonControlGroupMapping.normalized_control_id.isnot(None)
    ).distinct()
    
    mapped_framework_ids = db.query(CommonControlGroupMapping.framework_control_id).filter(
        CommonControlGroupMapping.framework_control_id.isnot(None)
    ).distinct()
    
    normalized_count = db.query(NormalizedControl).filter(
        ~NormalizedControl.id.in_(mapped_normalized_ids)
    ).count()
    
    fc_query = db.query(FrameworkControl).filter(
        ~FrameworkControl.id.in_(mapped_framework_ids)
    )
    
    if framework_id:
        fc_query = fc_query.join(
            ControlObjective, FrameworkControl.objective_id == ControlObjective.id
        ).join(
            FrameworkDomain, ControlObjective.domain_id == FrameworkDomain.id
        ).filter(FrameworkDomain.framework_id == framework_id)
    
    framework_count = fc_query.count()
    
    return normalized_count + framework_count


def get_evidence_gap_count(db: Session, tenant_id: int, framework_id: Optional[int] = None) -> int:
    tenant_evidence_ids = db.query(Evidence.id).filter(
        Evidence.tenant_id == tenant_id
    ).subquery()
    
    controls_with_evidence = db.query(EvidenceControlMapping.framework_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.framework_control_id.isnot(None)
    ).distinct()
    
    fc_query = db.query(FrameworkControl)
    
    if framework_id:
        fc_query = fc_query.join(
            ControlObjective, FrameworkControl.objective_id == ControlObjective.id
        ).join(
            FrameworkDomain, ControlObjective.domain_id == FrameworkDomain.id
        ).filter(FrameworkDomain.framework_id == framework_id)
    
    total_fc = fc_query.count()
    with_evidence = fc_query.filter(FrameworkControl.id.in_(controls_with_evidence)).count()
    
    return total_fc - with_evidence


def calculate_framework_coverage(db: Session, tenant_id: int, framework_id: int) -> dict:
    tenant_evidence_ids = db.query(Evidence.id).filter(
        Evidence.tenant_id == tenant_id
    ).subquery()
    
    controls_with_evidence = db.query(EvidenceControlMapping.framework_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.framework_control_id.isnot(None)
    ).distinct().subquery()
    
    fc_query = db.query(FrameworkControl).join(
        ControlObjective, FrameworkControl.objective_id == ControlObjective.id
    ).join(
        FrameworkDomain, ControlObjective.domain_id == FrameworkDomain.id
    ).filter(FrameworkDomain.framework_id == framework_id)
    
    total = fc_query.count()
    with_evidence = fc_query.filter(
        FrameworkControl.id.in_(controls_with_evidence)
    ).count()
    
    framework = db.query(Framework).filter(Framework.id == framework_id).first()
    
    return {
        "framework_id": framework_id,
        "framework_name": framework.name if framework else "Unknown",
        "framework_code": framework.short_code if framework else "",
        "total_controls": total,
        "controls_with_evidence": with_evidence,
        "controls_without_evidence": total - with_evidence,
        "coverage_percentage": round((with_evidence / total * 100) if total > 0 else 0, 2)
    }


def serialize_framework_control(fc: FrameworkControl) -> dict:
    framework_info = None
    if fc.objective and fc.objective.domain and fc.objective.domain.framework:
        fw = fc.objective.domain.framework
        framework_info = {
            "id": fw.id,
            "name": fw.name,
            "short_code": fw.short_code
        }
    
    return {
        "id": fc.id,
        "code": fc.code,
        "name": fc.name,
        "statement": fc.statement,
        "control_type": "framework",
        "framework": framework_info
    }


def serialize_normalized_control(nc: NormalizedControl) -> dict:
    return {
        "id": nc.id,
        "code": nc.code,
        "name": nc.name,
        "statement": nc.statement,
        "control_type": "normalized"
    }


@router.get("/unmapped-controls")
def get_unmapped_controls(
    framework_id: Optional[int] = None,
    control_type: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    mapped_normalized_ids = db.query(CommonControlGroupMapping.normalized_control_id).filter(
        CommonControlGroupMapping.normalized_control_id.isnot(None)
    ).distinct()
    
    mapped_framework_ids = db.query(CommonControlGroupMapping.framework_control_id).filter(
        CommonControlGroupMapping.framework_control_id.isnot(None)
    ).distinct()
    
    controls = []
    total_normalized = 0
    total_framework = 0
    
    if control_type is None or control_type == "normalized":
        nc_query = db.query(NormalizedControl).filter(
            ~NormalizedControl.id.in_(mapped_normalized_ids)
        )
        total_normalized = nc_query.count()
        
        if control_type == "normalized":
            normalized_controls = nc_query.offset(skip).limit(limit).all()
            controls.extend([serialize_normalized_control(nc) for nc in normalized_controls])
    
    if control_type is None or control_type == "framework":
        fc_query = db.query(FrameworkControl).options(
            joinedload(FrameworkControl.objective)
            .joinedload(ControlObjective.domain)
            .joinedload(FrameworkDomain.framework)
        ).filter(
            ~FrameworkControl.id.in_(mapped_framework_ids)
        )
        
        if framework_id:
            fc_query = fc_query.join(
                ControlObjective, FrameworkControl.objective_id == ControlObjective.id
            ).join(
                FrameworkDomain, ControlObjective.domain_id == FrameworkDomain.id
            ).filter(FrameworkDomain.framework_id == framework_id)
        
        total_framework = fc_query.count()
        
        if control_type == "framework":
            framework_controls = fc_query.offset(skip).limit(limit).all()
            controls.extend([serialize_framework_control(fc) for fc in framework_controls])
    
    if control_type is None:
        all_controls = []
        normalized_controls = db.query(NormalizedControl).filter(
            ~NormalizedControl.id.in_(mapped_normalized_ids)
        ).all()
        all_controls.extend([serialize_normalized_control(nc) for nc in normalized_controls])
        
        fc_base_query = db.query(FrameworkControl).options(
            joinedload(FrameworkControl.objective)
            .joinedload(ControlObjective.domain)
            .joinedload(FrameworkDomain.framework)
        ).filter(
            ~FrameworkControl.id.in_(mapped_framework_ids)
        )
        if framework_id:
            fc_base_query = fc_base_query.join(
                ControlObjective, FrameworkControl.objective_id == ControlObjective.id
            ).join(
                FrameworkDomain, ControlObjective.domain_id == FrameworkDomain.id
            ).filter(FrameworkDomain.framework_id == framework_id)
        
        framework_controls = fc_base_query.all()
        all_controls.extend([serialize_framework_control(fc) for fc in framework_controls])
        
        controls = all_controls[skip:skip + limit]
    
    return {
        "total": total_normalized + total_framework,
        "total_normalized": total_normalized,
        "total_framework": total_framework,
        "skip": skip,
        "limit": limit,
        "controls": controls
    }


@router.get("/controls-without-evidence")
def get_controls_without_evidence(
    framework_id: Optional[int] = None,
    control_type: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    tenant_evidence_ids = db.query(Evidence.id).filter(
        Evidence.tenant_id.in_(user_tenants)
    ).subquery()
    
    nc_with_evidence = db.query(EvidenceControlMapping.normalized_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.normalized_control_id.isnot(None)
    ).distinct()
    
    fc_with_evidence = db.query(EvidenceControlMapping.framework_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.framework_control_id.isnot(None)
    ).distinct()
    
    controls = []
    total_normalized = 0
    total_framework = 0
    
    if control_type is None or control_type == "normalized":
        nc_query = db.query(NormalizedControl).filter(
            ~NormalizedControl.id.in_(nc_with_evidence)
        )
        total_normalized = nc_query.count()
        
        if control_type == "normalized":
            normalized_controls = nc_query.offset(skip).limit(limit).all()
            for nc in normalized_controls:
                control_data = serialize_normalized_control(nc)
                control_data["evidence_count"] = 0
                control_data["has_evidence"] = False
                controls.append(control_data)
    
    if control_type is None or control_type == "framework":
        fc_query = db.query(FrameworkControl).options(
            joinedload(FrameworkControl.objective)
            .joinedload(ControlObjective.domain)
            .joinedload(FrameworkDomain.framework)
        ).filter(
            ~FrameworkControl.id.in_(fc_with_evidence)
        )
        
        if framework_id:
            fc_query = fc_query.join(
                ControlObjective, FrameworkControl.objective_id == ControlObjective.id
            ).join(
                FrameworkDomain, ControlObjective.domain_id == FrameworkDomain.id
            ).filter(FrameworkDomain.framework_id == framework_id)
        
        total_framework = fc_query.count()
        
        if control_type == "framework":
            framework_controls = fc_query.offset(skip).limit(limit).all()
            for fc in framework_controls:
                control_data = serialize_framework_control(fc)
                control_data["evidence_count"] = 0
                control_data["has_evidence"] = False
                controls.append(control_data)
    
    if control_type is None:
        all_controls = []
        normalized_controls = db.query(NormalizedControl).filter(
            ~NormalizedControl.id.in_(nc_with_evidence)
        ).all()
        for nc in normalized_controls:
            control_data = serialize_normalized_control(nc)
            control_data["evidence_count"] = 0
            control_data["has_evidence"] = False
            all_controls.append(control_data)
        
        fc_base_query = db.query(FrameworkControl).options(
            joinedload(FrameworkControl.objective)
            .joinedload(ControlObjective.domain)
            .joinedload(FrameworkDomain.framework)
        ).filter(
            ~FrameworkControl.id.in_(fc_with_evidence)
        )
        if framework_id:
            fc_base_query = fc_base_query.join(
                ControlObjective, FrameworkControl.objective_id == ControlObjective.id
            ).join(
                FrameworkDomain, ControlObjective.domain_id == FrameworkDomain.id
            ).filter(FrameworkDomain.framework_id == framework_id)
        
        framework_controls = fc_base_query.all()
        for fc in framework_controls:
            control_data = serialize_framework_control(fc)
            control_data["evidence_count"] = 0
            control_data["has_evidence"] = False
            all_controls.append(control_data)
        
        controls = all_controls[skip:skip + limit]
    
    return {
        "total": total_normalized + total_framework,
        "total_normalized": total_normalized,
        "total_framework": total_framework,
        "skip": skip,
        "limit": limit,
        "controls": controls
    }


@router.get("/controls-with-low-coverage")
def get_controls_with_low_coverage(
    threshold: int = Query(2, ge=1, description="Minimum required evidence count"),
    framework_id: Optional[int] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    tenant_evidence_ids = db.query(Evidence.id).filter(
        Evidence.tenant_id.in_(user_tenants)
    ).subquery()
    
    fc_evidence_counts = db.query(
        EvidenceControlMapping.framework_control_id,
        func.count(EvidenceControlMapping.id).label("evidence_count")
    ).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.framework_control_id.isnot(None)
    ).group_by(
        EvidenceControlMapping.framework_control_id
    ).subquery()
    
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
    
    evidence_count_map = {}
    for row in db.query(fc_evidence_counts).all():
        evidence_count_map[row.framework_control_id] = row.evidence_count
    
    low_coverage_controls = []
    for fc in all_controls:
        count = evidence_count_map.get(fc.id, 0)
        if count < threshold:
            control_data = serialize_framework_control(fc)
            control_data["evidence_count"] = count
            control_data["threshold"] = threshold
            control_data["gap"] = threshold - count
            low_coverage_controls.append(control_data)
    
    total = len(low_coverage_controls)
    paginated = low_coverage_controls[skip:skip + limit]
    
    return {
        "total": total,
        "threshold": threshold,
        "skip": skip,
        "limit": limit,
        "controls": paginated
    }


@router.get("/unmapped-summary")
def get_unmapped_summary(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    tenant_id = get_user_primary_tenant(current_user, db)
    
    mapped_normalized_ids = db.query(CommonControlGroupMapping.normalized_control_id).filter(
        CommonControlGroupMapping.normalized_control_id.isnot(None)
    ).distinct()
    
    mapped_framework_ids = db.query(CommonControlGroupMapping.framework_control_id).filter(
        CommonControlGroupMapping.framework_control_id.isnot(None)
    ).distinct()
    
    total_normalized_unmapped = db.query(NormalizedControl).filter(
        ~NormalizedControl.id.in_(mapped_normalized_ids)
    ).count()
    
    frameworks = db.query(Framework).filter(Framework.is_active == True).all()
    by_framework = []
    
    for fw in frameworks:
        fc_query = db.query(FrameworkControl).join(
            ControlObjective, FrameworkControl.objective_id == ControlObjective.id
        ).join(
            FrameworkDomain, ControlObjective.domain_id == FrameworkDomain.id
        ).filter(
            FrameworkDomain.framework_id == fw.id,
            ~FrameworkControl.id.in_(mapped_framework_ids)
        )
        
        count = fc_query.count()
        if count > 0:
            by_framework.append({
                "framework_id": fw.id,
                "framework_name": fw.name,
                "framework_code": fw.short_code,
                "unmapped_count": count
            })
    
    total_framework_unmapped = sum(f["unmapped_count"] for f in by_framework)
    
    groups = db.query(CommonControlGroup).filter(
        or_(
            CommonControlGroup.tenant_id.in_(user_tenants),
            CommonControlGroup.tenant_id.is_(None)
        )
    ).all()
    
    by_category = {}
    for group in groups:
        category = group.category or "Uncategorized"
        if category not in by_category:
            by_category[category] = {
                "category": category,
                "group_count": 0,
                "total_mapped_controls": 0
            }
        by_category[category]["group_count"] += 1
        
        mapping_count = db.query(CommonControlGroupMapping).filter(
            CommonControlGroupMapping.group_id == group.id
        ).count()
        by_category[category]["total_mapped_controls"] += mapping_count
    
    return {
        "total_unmapped": total_normalized_unmapped + total_framework_unmapped,
        "unmapped_normalized": total_normalized_unmapped,
        "unmapped_framework": total_framework_unmapped,
        "by_framework": by_framework,
        "by_category": list(by_category.values())
    }


@router.get("/evidence-gaps")
def get_evidence_gaps(
    framework_id: Optional[int] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    recommendations = db.query(AIEvidenceRecommendation).filter(
        AIEvidenceRecommendation.tenant_id.in_(user_tenants)
    ).all()
    
    tenant_evidence_ids = db.query(Evidence.id).filter(
        Evidence.tenant_id.in_(user_tenants)
    ).subquery()
    
    actual_evidence_types = {}
    
    for rec in recommendations:
        control_key = None
        if rec.framework_control_id:
            control_key = f"framework_{rec.framework_control_id}"
        elif rec.normalized_control_id:
            control_key = f"normalized_{rec.normalized_control_id}"
        
        if control_key and control_key not in actual_evidence_types:
            actual_evidence_types[control_key] = set()
            
            if rec.framework_control_id:
                mappings = db.query(EvidenceControlMapping).join(
                    Evidence, EvidenceControlMapping.evidence_id == Evidence.id
                ).filter(
                    EvidenceControlMapping.framework_control_id == rec.framework_control_id,
                    Evidence.tenant_id.in_(user_tenants)
                ).all()
            else:
                mappings = db.query(EvidenceControlMapping).join(
                    Evidence, EvidenceControlMapping.evidence_id == Evidence.id
                ).filter(
                    EvidenceControlMapping.normalized_control_id == rec.normalized_control_id,
                    Evidence.tenant_id.in_(user_tenants)
                ).all()
            
            for m in mappings:
                if m.evidence and m.evidence.evidence_type:
                    actual_evidence_types[control_key].add(m.evidence.evidence_type.lower())
    
    controls_with_gaps = {}
    
    for rec in recommendations:
        control_key = None
        control_type = None
        control_id = None
        
        if rec.framework_control_id:
            control_key = f"framework_{rec.framework_control_id}"
            control_type = "framework"
            control_id = rec.framework_control_id
        elif rec.normalized_control_id:
            control_key = f"normalized_{rec.normalized_control_id}"
            control_type = "normalized"
            control_id = rec.normalized_control_id
        
        if not control_key:
            continue
        
        actual_types = actual_evidence_types.get(control_key, set())
        recommended_type = rec.evidence_type.lower() if rec.evidence_type else ""
        
        is_missing = recommended_type not in actual_types
        
        if is_missing:
            if control_key not in controls_with_gaps:
                control_data = None
                if control_type == "framework":
                    fc = db.query(FrameworkControl).options(
                        joinedload(FrameworkControl.objective)
                        .joinedload(ControlObjective.domain)
                        .joinedload(FrameworkDomain.framework)
                    ).filter(FrameworkControl.id == control_id).first()
                    if fc:
                        control_data = serialize_framework_control(fc)
                else:
                    nc = db.query(NormalizedControl).filter(
                        NormalizedControl.id == control_id
                    ).first()
                    if nc:
                        control_data = serialize_normalized_control(nc)
                
                if control_data:
                    controls_with_gaps[control_key] = {
                        **control_data,
                        "missing_evidence_types": [],
                        "actual_evidence_types": list(actual_types),
                        "total_recommendations": 0,
                        "missing_count": 0
                    }
            
            if control_key in controls_with_gaps:
                controls_with_gaps[control_key]["missing_evidence_types"].append({
                    "evidence_type": rec.evidence_type,
                    "priority": rec.priority,
                    "description": rec.evidence_description
                })
                controls_with_gaps[control_key]["missing_count"] += 1
                controls_with_gaps[control_key]["total_recommendations"] += 1
    
    gaps_list = list(controls_with_gaps.values())
    gaps_list.sort(key=lambda x: x.get("missing_count", 0), reverse=True)
    
    total = len(gaps_list)
    paginated = gaps_list[skip:skip + limit]
    
    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "controls_with_gaps": paginated
    }


@router.get("/framework-gaps/{framework_id}")
def get_framework_gaps(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    tenant_id = get_user_primary_tenant(current_user, db)
    
    framework = db.query(Framework).filter(Framework.id == framework_id).first()
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework not found"
        )
    
    mapped_framework_ids = db.query(CommonControlGroupMapping.framework_control_id).filter(
        CommonControlGroupMapping.framework_control_id.isnot(None)
    ).distinct()
    
    tenant_evidence_ids = db.query(Evidence.id).filter(
        Evidence.tenant_id.in_(user_tenants)
    ).subquery()
    
    fc_with_evidence = db.query(EvidenceControlMapping.framework_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.framework_control_id.isnot(None)
    ).distinct()
    
    fc_evidence_counts = db.query(
        EvidenceControlMapping.framework_control_id,
        func.count(EvidenceControlMapping.id).label("evidence_count")
    ).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.framework_control_id.isnot(None)
    ).group_by(
        EvidenceControlMapping.framework_control_id
    ).subquery()
    
    all_fc = db.query(FrameworkControl).options(
        joinedload(FrameworkControl.objective)
        .joinedload(ControlObjective.domain)
        .joinedload(FrameworkDomain.framework)
    ).join(
        ControlObjective, FrameworkControl.objective_id == ControlObjective.id
    ).join(
        FrameworkDomain, ControlObjective.domain_id == FrameworkDomain.id
    ).filter(FrameworkDomain.framework_id == framework_id).all()
    
    unmapped_controls = []
    no_evidence_controls = []
    low_coverage_controls = []
    
    evidence_count_map = {}
    for row in db.query(fc_evidence_counts).all():
        evidence_count_map[row.framework_control_id] = row.evidence_count
    
    mapped_ids_set = set([r[0] for r in db.query(mapped_framework_ids).all()])
    with_evidence_set = set([r[0] for r in db.query(fc_with_evidence).all()])
    
    for fc in all_fc:
        control_data = serialize_framework_control(fc)
        evidence_count = evidence_count_map.get(fc.id, 0)
        control_data["evidence_count"] = evidence_count
        
        if fc.id not in mapped_ids_set:
            unmapped_controls.append(control_data)
        
        if fc.id not in with_evidence_set:
            no_evidence_controls.append(control_data)
        elif evidence_count < 2:
            low_coverage_controls.append(control_data)
    
    return {
        "framework_id": framework_id,
        "framework_name": framework.name,
        "framework_code": framework.short_code,
        "total_controls": len(all_fc),
        "summary": {
            "unmapped_controls_count": len(unmapped_controls),
            "no_evidence_count": len(no_evidence_controls),
            "low_coverage_count": len(low_coverage_controls)
        },
        "unmapped_controls": unmapped_controls[:20],
        "no_evidence_controls": no_evidence_controls[:20],
        "low_coverage_controls": low_coverage_controls[:20]
    }


@router.get("/group-gaps/{group_id}")
def get_group_gaps(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    group = db.query(CommonControlGroup).filter(
        CommonControlGroup.id == group_id,
        or_(
            CommonControlGroup.tenant_id.in_(user_tenants),
            CommonControlGroup.tenant_id.is_(None)
        )
    ).first()
    
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control group not found"
        )
    
    mappings = db.query(CommonControlGroupMapping).filter(
        CommonControlGroupMapping.group_id == group_id
    ).all()
    
    tenant_evidence_ids = db.query(Evidence.id).filter(
        Evidence.tenant_id.in_(user_tenants)
    ).subquery()
    
    controls_with_gaps = []
    controls_with_low_coverage = []
    
    for mapping in mappings:
        if mapping.normalized_control_id:
            nc = db.query(NormalizedControl).filter(
                NormalizedControl.id == mapping.normalized_control_id
            ).first()
            
            if nc:
                evidence_count = db.query(EvidenceControlMapping).filter(
                    EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
                    EvidenceControlMapping.normalized_control_id == nc.id
                ).count()
                
                control_data = serialize_normalized_control(nc)
                control_data["evidence_count"] = evidence_count
                
                if evidence_count == 0:
                    controls_with_gaps.append(control_data)
                elif evidence_count < 2:
                    controls_with_low_coverage.append(control_data)
        
        if mapping.framework_control_id:
            fc = db.query(FrameworkControl).options(
                joinedload(FrameworkControl.objective)
                .joinedload(ControlObjective.domain)
                .joinedload(FrameworkDomain.framework)
            ).filter(
                FrameworkControl.id == mapping.framework_control_id
            ).first()
            
            if fc:
                evidence_count = db.query(EvidenceControlMapping).filter(
                    EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
                    EvidenceControlMapping.framework_control_id == fc.id
                ).count()
                
                control_data = serialize_framework_control(fc)
                control_data["evidence_count"] = evidence_count
                
                if evidence_count == 0:
                    controls_with_gaps.append(control_data)
                elif evidence_count < 2:
                    controls_with_low_coverage.append(control_data)
    
    return {
        "group_id": group_id,
        "group_name": group.name,
        "group_code": group.code,
        "total_controls": len(mappings),
        "summary": {
            "missing_evidence_count": len(controls_with_gaps),
            "low_coverage_count": len(controls_with_low_coverage)
        },
        "controls_missing_evidence": controls_with_gaps,
        "controls_with_low_coverage": controls_with_low_coverage
    }


@router.get("/dashboard")
def get_gap_analysis_dashboard(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    tenant_id = get_user_primary_tenant(current_user, db)
    
    total_normalized = db.query(NormalizedControl).count()
    total_framework = db.query(FrameworkControl).count()
    total_controls = total_normalized + total_framework
    
    mapped_normalized_ids = db.query(CommonControlGroupMapping.normalized_control_id).filter(
        CommonControlGroupMapping.normalized_control_id.isnot(None)
    ).distinct()
    mapped_framework_ids = db.query(CommonControlGroupMapping.framework_control_id).filter(
        CommonControlGroupMapping.framework_control_id.isnot(None)
    ).distinct()
    
    mapped_normalized = db.query(NormalizedControl).filter(
        NormalizedControl.id.in_(mapped_normalized_ids)
    ).count()
    mapped_framework = db.query(FrameworkControl).filter(
        FrameworkControl.id.in_(mapped_framework_ids)
    ).count()
    mapped_controls = mapped_normalized + mapped_framework
    unmapped_controls = total_controls - mapped_controls
    
    tenant_evidence_ids = db.query(Evidence.id).filter(
        Evidence.tenant_id.in_(user_tenants)
    ).subquery()
    
    nc_with_evidence = db.query(EvidenceControlMapping.normalized_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.normalized_control_id.isnot(None)
    ).distinct().count()
    
    fc_with_evidence = db.query(EvidenceControlMapping.framework_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.framework_control_id.isnot(None)
    ).distinct().count()
    
    controls_with_evidence = nc_with_evidence + fc_with_evidence
    controls_without_evidence = total_controls - controls_with_evidence
    
    frameworks = db.query(Framework).filter(Framework.is_active == True).all()
    coverage_by_framework = []
    
    for fw in frameworks:
        coverage = calculate_framework_coverage(db, tenant_id, fw.id)
        if coverage["total_controls"] > 0:
            coverage_by_framework.append(coverage)
    
    coverage_by_framework.sort(key=lambda x: x["coverage_percentage"])
    
    critical_gaps = []
    
    low_coverage_frameworks = [f for f in coverage_by_framework if f["coverage_percentage"] < 50]
    for fw in low_coverage_frameworks[:3]:
        critical_gaps.append({
            "type": "low_framework_coverage",
            "priority": "high",
            "description": f"{fw['framework_name']} has only {fw['coverage_percentage']}% evidence coverage",
            "framework_id": fw["framework_id"],
            "details": {
                "controls_without_evidence": fw["controls_without_evidence"],
                "total_controls": fw["total_controls"]
            }
        })
    
    critical_recs = db.query(AIEvidenceRecommendation).filter(
        AIEvidenceRecommendation.tenant_id.in_(user_tenants),
        AIEvidenceRecommendation.priority == "critical"
    ).limit(5).all()
    
    for rec in critical_recs:
        control_name = ""
        if rec.framework_control_id:
            fc = db.query(FrameworkControl).filter(
                FrameworkControl.id == rec.framework_control_id
            ).first()
            if fc:
                control_name = fc.name
        elif rec.normalized_control_id:
            nc = db.query(NormalizedControl).filter(
                NormalizedControl.id == rec.normalized_control_id
            ).first()
            if nc:
                control_name = nc.name
        
        critical_gaps.append({
            "type": "missing_critical_evidence",
            "priority": "critical",
            "description": f"Missing critical evidence: {rec.evidence_type} for {control_name}",
            "recommendation_id": rec.id,
            "details": {
                "evidence_type": rec.evidence_type,
                "control_name": control_name
            }
        })
    
    return {
        "total_controls": total_controls,
        "mapped_controls": mapped_controls,
        "unmapped_controls": unmapped_controls,
        "mapping_percentage": round((mapped_controls / total_controls * 100) if total_controls > 0 else 0, 2),
        "controls_with_evidence": controls_with_evidence,
        "controls_without_evidence": controls_without_evidence,
        "evidence_coverage_percentage": round((controls_with_evidence / total_controls * 100) if total_controls > 0 else 0, 2),
        "coverage_by_framework": coverage_by_framework,
        "critical_gaps": critical_gaps[:10]
    }


@router.post("/export")
def export_gap_analysis(
    request: ExportRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    tenant_id = get_user_primary_tenant(current_user, db)
    
    dashboard_data = get_gap_analysis_dashboard(db, current_user)
    
    if request.include_details:
        unmapped_result = get_unmapped_controls(
            framework_id=None,
            control_type=None,
            skip=0,
            limit=500,
            db=db,
            current_user=current_user
        )
        dashboard_data["unmapped_controls_list"] = unmapped_result["controls"]
        
        no_evidence_result = get_controls_without_evidence(
            framework_id=None,
            control_type=None,
            skip=0,
            limit=500,
            db=db,
            current_user=current_user
        )
        dashboard_data["no_evidence_controls_list"] = no_evidence_result["controls"]
    
    if request.format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        
        writer.writerow(["Gap Analysis Report"])
        writer.writerow(["Generated", datetime.utcnow().isoformat()])
        writer.writerow([])
        
        writer.writerow(["Summary Statistics"])
        writer.writerow(["Metric", "Value"])
        writer.writerow(["Total Controls", dashboard_data["total_controls"]])
        writer.writerow(["Mapped Controls", dashboard_data["mapped_controls"]])
        writer.writerow(["Unmapped Controls", dashboard_data["unmapped_controls"]])
        writer.writerow(["Mapping %", f"{dashboard_data['mapping_percentage']}%"])
        writer.writerow(["Controls with Evidence", dashboard_data["controls_with_evidence"]])
        writer.writerow(["Controls without Evidence", dashboard_data["controls_without_evidence"]])
        writer.writerow(["Evidence Coverage %", f"{dashboard_data['evidence_coverage_percentage']}%"])
        writer.writerow([])
        
        writer.writerow(["Framework Coverage"])
        writer.writerow(["Framework", "Total Controls", "With Evidence", "Without Evidence", "Coverage %"])
        for fw in dashboard_data["coverage_by_framework"]:
            writer.writerow([
                fw["framework_name"],
                fw["total_controls"],
                fw["controls_with_evidence"],
                fw["controls_without_evidence"],
                f"{fw['coverage_percentage']}%"
            ])
        writer.writerow([])
        
        writer.writerow(["Critical Gaps"])
        writer.writerow(["Priority", "Type", "Description"])
        for gap in dashboard_data["critical_gaps"]:
            writer.writerow([gap["priority"], gap["type"], gap["description"]])
        
        if request.include_details and "unmapped_controls_list" in dashboard_data:
            writer.writerow([])
            writer.writerow(["Unmapped Controls"])
            writer.writerow(["ID", "Code", "Name", "Type", "Framework"])
            for control in dashboard_data["unmapped_controls_list"]:
                framework_name = ""
                if control.get("framework"):
                    framework_name = control["framework"].get("name", "")
                writer.writerow([
                    control["id"],
                    control["code"],
                    control["name"],
                    control["control_type"],
                    framework_name
                ])
        
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=gap_analysis_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"}
        )
    
    return {
        "format": "json",
        "generated_at": datetime.utcnow().isoformat(),
        "data": dashboard_data
    }
