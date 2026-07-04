from ....config import get_openai_api_key, get_openai_model

import csv
import io
import json
import os
import logging
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, func, and_, not_, exists, select
from pydantic import BaseModel
from openai import OpenAI

logger = logging.getLogger(__name__)

from ....models import (
    CommonControlGroup, CommonControlGroupMapping, NormalizedControl,
    FrameworkControl, FrameworkDomain, ControlObjective, Framework,
    Evidence, EvidenceControlMapping, AIEvidenceRecommendation,
    GRCUser, get_db, UploadedFramework, ParsedFrameworkControl
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/gap-analysis", tags=["Control Library - Gap Analysis"])


class ExportRequest(BaseModel):
    format: str = "json"
    include_details: bool = True


def get_unmapped_control_count(db: Session, tenant_id: int, framework_id: Optional[int] = None) -> int:
    tenant_group_ids = db.query(CommonControlGroup.id).filter(
        or_(
            CommonControlGroup.tenant_id == tenant_id,
            CommonControlGroup.tenant_id.is_(None)
        )
    ).subquery()
    
    mapped_normalized_ids = db.query(CommonControlGroupMapping.normalized_control_id).filter(
        CommonControlGroupMapping.normalized_control_id.isnot(None),
        CommonControlGroupMapping.group_id.in_(tenant_group_ids)
    ).distinct().subquery()
    
    mapped_framework_ids = db.query(CommonControlGroupMapping.framework_control_id).filter(
        CommonControlGroupMapping.framework_control_id.isnot(None),
        CommonControlGroupMapping.group_id.in_(tenant_group_ids)
    ).distinct().subquery()
    
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
    ).distinct().subquery()
    
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


def serialize_parsed_control(pc: ParsedFrameworkControl) -> dict:
    framework_info = None
    if pc.uploaded_framework:
        fw = pc.uploaded_framework
        framework_info = {
            "id": fw.id,
            "name": fw.name,
            "short_code": fw.name[:20] if fw.name else ""
        }
    
    return {
        "id": pc.id,
        "code": pc.original_reference or pc.control_id,
        "name": pc.title,
        "statement": pc.description,
        "control_type": "parsed",
        "framework": framework_info
    }


def calculate_uploaded_framework_coverage(db: Session, tenant_id: int, uploaded_framework_id: int) -> dict:
    tenant_evidence_ids = select(Evidence.id).where(
        Evidence.tenant_id == tenant_id
    )

    controls_with_evidence = select(EvidenceControlMapping.parsed_control_id).where(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.parsed_control_id.isnot(None)
    ).distinct()
    
    total = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == uploaded_framework_id
    ).count()
    
    with_evidence = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == uploaded_framework_id,
        ParsedFrameworkControl.id.in_(controls_with_evidence)
    ).count()
    
    framework = db.query(UploadedFramework).filter(UploadedFramework.id == uploaded_framework_id).first()
    
    return {
        "framework_id": uploaded_framework_id,
        "framework_type": "uploaded",
        "framework_name": framework.name if framework else "Unknown",
        "framework_code": framework.name[:20] if framework and framework.name else "",
        "total_controls": total,
        "controls_with_evidence": with_evidence,
        "controls_without_evidence": total - with_evidence,
        "coverage_percentage": round((with_evidence / total * 100) if total > 0 else 0, 2)
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
    
    tenant_group_ids = db.query(CommonControlGroup.id).filter(
        or_(
            CommonControlGroup.tenant_id.in_(user_tenants),
            CommonControlGroup.tenant_id.is_(None)
        )
    ).subquery()
    
    mapped_normalized_ids = db.query(CommonControlGroupMapping.normalized_control_id).filter(
        CommonControlGroupMapping.normalized_control_id.isnot(None),
        CommonControlGroupMapping.group_id.in_(tenant_group_ids)
    ).distinct().subquery()
    
    mapped_framework_ids = db.query(CommonControlGroupMapping.framework_control_id).filter(
        CommonControlGroupMapping.framework_control_id.isnot(None),
        CommonControlGroupMapping.group_id.in_(tenant_group_ids)
    ).distinct().subquery()
    
    mapped_parsed_ids = db.query(CommonControlGroupMapping.parsed_control_id).filter(
        CommonControlGroupMapping.parsed_control_id.isnot(None),
        CommonControlGroupMapping.group_id.in_(tenant_group_ids)
    ).distinct().subquery()
    
    controls = []
    total_normalized = 0
    total_framework = 0
    total_parsed = 0
    
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
    
    if control_type is None or control_type == "parsed":
        pc_query = db.query(ParsedFrameworkControl).options(
            joinedload(ParsedFrameworkControl.uploaded_framework)
        ).filter(
            ~ParsedFrameworkControl.id.in_(mapped_parsed_ids)
        )
        
        if framework_id:
            pc_query = pc_query.filter(ParsedFrameworkControl.uploaded_framework_id == framework_id)
        
        total_parsed = pc_query.count()
        
        if control_type == "parsed":
            parsed_controls = pc_query.offset(skip).limit(limit).all()
            controls.extend([serialize_parsed_control(pc) for pc in parsed_controls])
    
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
        
        pc_base_query = db.query(ParsedFrameworkControl).options(
            joinedload(ParsedFrameworkControl.uploaded_framework)
        ).filter(
            ~ParsedFrameworkControl.id.in_(mapped_parsed_ids)
        )
        if framework_id:
            pc_base_query = pc_base_query.filter(ParsedFrameworkControl.uploaded_framework_id == framework_id)
        parsed_controls = pc_base_query.all()
        all_controls.extend([serialize_parsed_control(pc) for pc in parsed_controls])
        
        controls = all_controls[skip:skip + limit]
    
    return {
        "total": total_normalized + total_framework + total_parsed,
        "total_normalized": total_normalized,
        "total_framework": total_framework,
        "total_parsed": total_parsed,
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
    ).distinct().subquery()
    
    fc_with_evidence = db.query(EvidenceControlMapping.framework_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.framework_control_id.isnot(None)
    ).distinct().subquery()
    
    pc_with_evidence = db.query(EvidenceControlMapping.parsed_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.parsed_control_id.isnot(None)
    ).distinct().subquery()
    
    controls = []
    total_normalized = 0
    total_framework = 0
    total_parsed = 0
    
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
    
    if control_type is None or control_type == "parsed":
        pc_query = db.query(ParsedFrameworkControl).options(
            joinedload(ParsedFrameworkControl.uploaded_framework)
        ).filter(
            ~ParsedFrameworkControl.id.in_(pc_with_evidence)
        )
        
        if framework_id:
            pc_query = pc_query.filter(ParsedFrameworkControl.uploaded_framework_id == framework_id)
        
        total_parsed = pc_query.count()
        
        if control_type == "parsed":
            parsed_controls = pc_query.offset(skip).limit(limit).all()
            for pc in parsed_controls:
                control_data = serialize_parsed_control(pc)
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
        
        pc_base_query = db.query(ParsedFrameworkControl).options(
            joinedload(ParsedFrameworkControl.uploaded_framework)
        ).filter(
            ~ParsedFrameworkControl.id.in_(pc_with_evidence)
        )
        if framework_id:
            pc_base_query = pc_base_query.filter(ParsedFrameworkControl.uploaded_framework_id == framework_id)
        parsed_controls = pc_base_query.all()
        for pc in parsed_controls:
            control_data = serialize_parsed_control(pc)
            control_data["evidence_count"] = 0
            control_data["has_evidence"] = False
            all_controls.append(control_data)
        
        controls = all_controls[skip:skip + limit]
    
    return {
        "total": total_normalized + total_framework + total_parsed,
        "total_normalized": total_normalized,
        "total_framework": total_framework,
        "total_parsed": total_parsed,
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
    
    fc_evidence_counts_q = db.query(
        EvidenceControlMapping.framework_control_id,
        func.count(EvidenceControlMapping.id).label("evidence_count")
    ).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.framework_control_id.isnot(None)
    ).group_by(
        EvidenceControlMapping.framework_control_id
    ).all()
    
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
    for row in fc_evidence_counts_q:
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
    
    tenant_group_ids = db.query(CommonControlGroup.id).filter(
        or_(
            CommonControlGroup.tenant_id.in_(user_tenants),
            CommonControlGroup.tenant_id.is_(None)
        )
    ).subquery()
    
    mapped_normalized_ids = db.query(CommonControlGroupMapping.normalized_control_id).filter(
        CommonControlGroupMapping.normalized_control_id.isnot(None),
        CommonControlGroupMapping.group_id.in_(tenant_group_ids)
    ).distinct().subquery()
    
    mapped_framework_ids = db.query(CommonControlGroupMapping.framework_control_id).filter(
        CommonControlGroupMapping.framework_control_id.isnot(None),
        CommonControlGroupMapping.group_id.in_(tenant_group_ids)
    ).distinct().subquery()
    
    total_normalized_unmapped = db.query(NormalizedControl).filter(
        ~NormalizedControl.id.in_(mapped_normalized_ids)
    ).count()
    
    # Only count unmapped controls in frameworks published from this tenant's uploads
    _unmap_pub_ids = db.query(UploadedFramework.published_framework_id).filter(
        UploadedFramework.upload_status == 'published',
        UploadedFramework.published_framework_id.isnot(None),
        or_(
            UploadedFramework.tenant_id.in_(user_tenants),
            UploadedFramework.is_shared == True
        )
    ).all() if user_tenants else []
    _unmap_fw_id_set = list({row[0] for row in _unmap_pub_ids})
    frameworks = db.query(Framework).filter(
        Framework.id.in_(_unmap_fw_id_set),
        Framework.is_active == True
    ).all() if _unmap_fw_id_set else []
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
    framework_type: Optional[str] = Query(None, description="'legacy' or 'uploaded'. If not specified, tries legacy first then uploaded."),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    tenant_id = get_user_primary_tenant(current_user, db)
    
    if framework_type == "uploaded":
        return _get_uploaded_framework_gaps(framework_id, db, user_tenants, tenant_id)
    
    framework = db.query(Framework).filter(Framework.id == framework_id).first()
    if not framework:
        uploaded_fw = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
        if uploaded_fw:
            return _get_uploaded_framework_gaps(framework_id, db, user_tenants, tenant_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework not found"
        )
    
    tenant_group_ids = db.query(CommonControlGroup.id).filter(
        or_(
            CommonControlGroup.tenant_id.in_(user_tenants),
            CommonControlGroup.tenant_id.is_(None)
        )
    ).subquery()
    
    mapped_framework_ids_q = db.query(CommonControlGroupMapping.framework_control_id).filter(
        CommonControlGroupMapping.framework_control_id.isnot(None),
        CommonControlGroupMapping.group_id.in_(tenant_group_ids)
    ).distinct().all()
    
    tenant_evidence_ids = db.query(Evidence.id).filter(
        Evidence.tenant_id.in_(user_tenants)
    ).subquery()
    
    fc_with_evidence_q = db.query(EvidenceControlMapping.framework_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.framework_control_id.isnot(None)
    ).distinct().all()
    
    fc_evidence_counts_q = db.query(
        EvidenceControlMapping.framework_control_id,
        func.count(EvidenceControlMapping.id).label("evidence_count")
    ).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.framework_control_id.isnot(None)
    ).group_by(
        EvidenceControlMapping.framework_control_id
    ).all()
    
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
    for row in fc_evidence_counts_q:
        evidence_count_map[row.framework_control_id] = row.evidence_count
    
    mapped_ids_set = set([r[0] for r in mapped_framework_ids_q])
    with_evidence_set = set([r[0] for r in fc_with_evidence_q])
    
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
        "framework_type": "legacy",
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


def _get_uploaded_framework_gaps(framework_id: int, db: Session, user_tenants: list, tenant_id: int) -> dict:
    framework = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uploaded framework not found"
        )
    
    tenant_group_ids = db.query(CommonControlGroup.id).filter(
        or_(
            CommonControlGroup.tenant_id.in_(user_tenants),
            CommonControlGroup.tenant_id.is_(None)
        )
    ).subquery()
    
    mapped_parsed_ids_q = db.query(CommonControlGroupMapping.parsed_control_id).filter(
        CommonControlGroupMapping.parsed_control_id.isnot(None),
        CommonControlGroupMapping.group_id.in_(tenant_group_ids)
    ).distinct().all()
    
    tenant_evidence_ids = db.query(Evidence.id).filter(
        Evidence.tenant_id.in_(user_tenants)
    ).subquery()
    
    pc_with_evidence_q = db.query(EvidenceControlMapping.parsed_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.parsed_control_id.isnot(None)
    ).distinct().all()
    
    pc_evidence_counts_q = db.query(
        EvidenceControlMapping.parsed_control_id,
        func.count(EvidenceControlMapping.id).label("evidence_count")
    ).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.parsed_control_id.isnot(None)
    ).group_by(
        EvidenceControlMapping.parsed_control_id
    ).all()
    
    all_pc = db.query(ParsedFrameworkControl).options(
        joinedload(ParsedFrameworkControl.uploaded_framework)
    ).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework_id
    ).all()
    
    unmapped_controls = []
    no_evidence_controls = []
    low_coverage_controls = []
    
    evidence_count_map = {}
    for row in pc_evidence_counts_q:
        evidence_count_map[row.parsed_control_id] = row.evidence_count
    
    mapped_ids_set = set([r[0] for r in mapped_parsed_ids_q])
    with_evidence_set = set([r[0] for r in pc_with_evidence_q])
    
    for pc in all_pc:
        control_data = serialize_parsed_control(pc)
        evidence_count = evidence_count_map.get(pc.id, 0)
        control_data["evidence_count"] = evidence_count
        
        if pc.id not in mapped_ids_set:
            unmapped_controls.append(control_data)
        
        if pc.id not in with_evidence_set:
            no_evidence_controls.append(control_data)
        elif evidence_count < 2:
            low_coverage_controls.append(control_data)
    
    return {
        "framework_id": framework_id,
        "framework_name": framework.name,
        "framework_code": framework.name[:20] if framework.name else "",
        "framework_type": "uploaded",
        "total_controls": len(all_pc),
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
    total_parsed = db.query(ParsedFrameworkControl).join(
        UploadedFramework, ParsedFrameworkControl.uploaded_framework_id == UploadedFramework.id
    ).filter(UploadedFramework.is_active == True).count()
    total_controls = total_normalized + total_framework + total_parsed
    
    # Wrap subqueries in `select()` so SQLAlchemy 2.x doesn't warn about
    # implicit Subquery -> Select coercion in `.in_()` clauses.
    tenant_group_ids = select(CommonControlGroup.id).where(
        or_(
            CommonControlGroup.tenant_id.in_(user_tenants),
            CommonControlGroup.tenant_id.is_(None)
        )
    )

    mapped_normalized_ids = select(CommonControlGroupMapping.normalized_control_id).where(
        CommonControlGroupMapping.normalized_control_id.isnot(None),
        CommonControlGroupMapping.group_id.in_(tenant_group_ids)
    ).distinct()
    mapped_framework_ids = select(CommonControlGroupMapping.framework_control_id).where(
        CommonControlGroupMapping.framework_control_id.isnot(None),
        CommonControlGroupMapping.group_id.in_(tenant_group_ids)
    ).distinct()
    mapped_parsed_ids = select(CommonControlGroupMapping.parsed_control_id).where(
        CommonControlGroupMapping.parsed_control_id.isnot(None),
        CommonControlGroupMapping.group_id.in_(tenant_group_ids)
    ).distinct()

    mapped_normalized = db.query(NormalizedControl).filter(
        NormalizedControl.id.in_(mapped_normalized_ids)
    ).count()
    mapped_framework = db.query(FrameworkControl).filter(
        FrameworkControl.id.in_(mapped_framework_ids)
    ).count()
    mapped_parsed = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.id.in_(mapped_parsed_ids)
    ).count()
    mapped_controls = mapped_normalized + mapped_framework + mapped_parsed
    unmapped_controls = total_controls - mapped_controls

    tenant_evidence_ids = select(Evidence.id).where(
        Evidence.tenant_id.in_(user_tenants)
    )

    nc_with_evidence = db.query(EvidenceControlMapping.normalized_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.normalized_control_id.isnot(None)
    ).distinct().count()

    fc_with_evidence = db.query(EvidenceControlMapping.framework_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.framework_control_id.isnot(None)
    ).distinct().count()

    pc_with_evidence = db.query(EvidenceControlMapping.parsed_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.parsed_control_id.isnot(None)
    ).distinct().count()
    
    controls_with_evidence = nc_with_evidence + fc_with_evidence + pc_with_evidence
    controls_without_evidence = total_controls - controls_with_evidence

    # ── Prefer the locked master baseline as the library scope ─────────────
    # The legacy counts above sum THREE control models (normalized + framework
    # + parsed) across ALL runs, which double-counts (a parsed control is the
    # same thing a normalized control links to) and inflates the denominator.
    # When a baseline exists, scope every headline number to its unified
    # controls so they match the rest of the product (the unified library).
    from ..services.scoped_session import get_baseline_run
    _base = get_baseline_run(db, tenant_id)
    if _base is not None:
        _baseline_nc_ids = select(NormalizedControl.id).where(
            NormalizedControl.run_id == _base.id
        )
        total_controls = db.query(NormalizedControl).filter(
            NormalizedControl.run_id == _base.id
        ).count()
        mapped_controls = db.query(CommonControlGroupMapping.normalized_control_id).filter(
            CommonControlGroupMapping.normalized_control_id.in_(_baseline_nc_ids)
        ).distinct().count()
        unmapped_controls = total_controls - mapped_controls
        _tev_ids = select(Evidence.id).where(Evidence.tenant_id.in_(user_tenants))
        controls_with_evidence = db.query(EvidenceControlMapping.normalized_control_id).filter(
            EvidenceControlMapping.evidence_id.in_(_tev_ids),
            EvidenceControlMapping.normalized_control_id.in_(_baseline_nc_ids),
        ).distinct().count()
        controls_without_evidence = total_controls - controls_with_evidence

    coverage_by_framework = []

    # Only show Framework records published from this tenant's uploaded frameworks
    _dash_pub_ids = db.query(UploadedFramework.published_framework_id).filter(
        UploadedFramework.upload_status == 'published',
        UploadedFramework.published_framework_id.isnot(None),
        UploadedFramework.is_active == True,
        or_(
            UploadedFramework.tenant_id.in_(user_tenants),
            UploadedFramework.is_shared == True
        )
    ).all() if user_tenants else []
    _dash_fw_id_set = list({row[0] for row in _dash_pub_ids})
    frameworks = db.query(Framework).filter(
        Framework.id.in_(_dash_fw_id_set),
        Framework.is_active == True
    ).all() if _dash_fw_id_set else []
    for fw in frameworks:
        coverage = calculate_framework_coverage(db, tenant_id, fw.id)
        if coverage["total_controls"] > 0:
            coverage["framework_type"] = "legacy"
            coverage_by_framework.append(coverage)

    # Only show unpublished uploaded frameworks (published ones are in frameworks list above)
    uploaded_frameworks = db.query(UploadedFramework).filter(
        UploadedFramework.upload_status.in_(['completed', 'parsed', 'classified']),
        UploadedFramework.is_active == True,
        or_(
            UploadedFramework.tenant_id.in_(user_tenants),
            UploadedFramework.is_shared == True
        )
    ).all() if user_tenants else []
    for ufw in uploaded_frameworks:
        coverage = calculate_uploaded_framework_coverage(db, tenant_id, ufw.id)
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
        
        # Use a plain Response (not StreamingResponse): the app's
        # audit_log_middleware (BaseHTTPMiddleware) breaks streaming bodies on
        # POST with "Unexpected message received: http.request".
        from fastapi.responses import Response as _PlainResponse
        return _PlainResponse(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=gap_analysis_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"}
        )
    
    return {
        "format": "json",
        "generated_at": datetime.utcnow().isoformat(),
        "data": dashboard_data
    }


class GapPrioritizationRequest(BaseModel):
    framework_id: Optional[int] = None
    max_gaps: int = 20


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


def collect_compliance_gaps(db: Session, tenant_id: int, framework_id: Optional[int], max_gaps: int) -> List[dict]:
    gaps = []
    
    tenant_evidence_ids = db.query(Evidence.id).filter(
        Evidence.tenant_id == tenant_id
    ).subquery()
    
    fc_with_evidence = db.query(EvidenceControlMapping.framework_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.framework_control_id.isnot(None)
    ).distinct().subquery()
    
    query = db.query(UploadedFramework).filter(
        UploadedFramework.upload_status.in_(['parsed', 'completed', 'published']),
        UploadedFramework.is_active == True
    )
    if tenant_id:
        query = query.filter(
            (UploadedFramework.tenant_id == tenant_id) | 
            (UploadedFramework.is_shared == True) |
            (UploadedFramework.tenant_id == None)
        )
    if framework_id:
        query = query.filter(UploadedFramework.id == framework_id)
    
    uploaded_frameworks = query.all()
    
    for fw in uploaded_frameworks:
        controls = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == fw.id
        ).all()
        
        for ctrl in controls:
            evidence_mappings = db.query(EvidenceControlMapping).join(
                Evidence, EvidenceControlMapping.evidence_id == Evidence.id
            ).filter(
                Evidence.tenant_id == tenant_id,
                EvidenceControlMapping.parsed_control_id == ctrl.id
            ).all()
            
            has_evidence = len(evidence_mappings) > 0
            has_expired = False
            
            if has_evidence:
                for mapping in evidence_mappings:
                    if mapping.evidence and mapping.evidence.expiry_date:
                        if mapping.evidence.expiry_date < datetime.utcnow():
                            has_expired = True
                            break
            
            if not has_evidence:
                gaps.append({
                    "gap_type": "missing_evidence",
                    "control_id": ctrl.id,
                    "control_code": ctrl.original_reference or ctrl.control_id,
                    "control_title": ctrl.title or "Untitled Control",
                    "control_description": ctrl.description or "",
                    "framework_id": fw.id,
                    "framework_name": fw.name,
                    "domain": ctrl.domain or "",
                    "criticality": ctrl.priority or "medium"
                })
            elif has_expired:
                gaps.append({
                    "gap_type": "expired_evidence",
                    "control_id": ctrl.id,
                    "control_code": ctrl.original_reference or ctrl.control_id,
                    "control_title": ctrl.title or "Untitled Control",
                    "control_description": ctrl.description or "",
                    "framework_id": fw.id,
                    "framework_name": fw.name,
                    "domain": ctrl.domain or "",
                    "criticality": ctrl.priority or "medium"
                })
            
            if len(gaps) >= max_gaps * 2:
                break
        
        if len(gaps) >= max_gaps * 2:
            break
    
    return gaps[:max_gaps * 2]


GAP_PRIORITIZATION_PROMPT = """You are a Senior GRC Compliance Expert with 20+ years of experience in regulatory compliance, risk management, and audit.
Your task is to analyze compliance gaps and prioritize them by business impact.

COMPLIANCE GAPS TO ANALYZE:
{gaps_data}

INSTRUCTIONS:
1. Analyze each gap considering:
   - Regulatory requirements and penalties
   - Business operational impact
   - Data protection and security implications
   - Audit readiness and findings risk
   - Remediation complexity

2. Assign a business_impact rating: "critical", "high", "medium", or "low"
3. Provide clear reasoning for each rating
4. Suggest practical remediation actions
5. Identify quick wins (low effort, high impact fixes)

Return your analysis in this exact JSON format:
{{
    "prioritized_gaps": [
        {{
            "rank": 1,
            "gap_type": "<missing_evidence|expired_evidence|unmapped_control>",
            "control_id": <control_id_number>,
            "control_title": "<control title>",
            "framework_name": "<framework name>",
            "business_impact": "<critical|high|medium|low>",
            "impact_reasoning": "<2-3 sentence explanation of business impact>",
            "regulatory_risk": "<explanation of regulatory implications>",
            "remediation_effort": "<low|medium|high>",
            "suggested_actions": ["<action 1>", "<action 2>"],
            "deadline_recommendation": "<timeframe like '1 week', '2 weeks', '1 month'>"
        }}
    ],
    "summary": {{
        "critical_gaps": <count>,
        "high_gaps": <count>,
        "medium_gaps": <count>,
        "low_gaps": <count>,
        "key_themes": ["<theme 1>", "<theme 2>", "<theme 3>"]
    }},
    "quick_wins": [
        {{
            "gap_description": "<brief description>",
            "effort": "low",
            "impact": "high",
            "recommendation": "<specific action>"
        }}
    ]
}}

IMPORTANT:
- Rank gaps by business_impact (critical first, then high, medium, low)
- Be specific in reasoning - reference regulatory frameworks and business consequences
- Suggest actionable remediation steps
- Identify at least 2-3 quick wins if possible"""


def parse_ai_response(response_text: str) -> dict:
    try:
        cleaned = response_text.strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned[7:]
        if cleaned.startswith("```"):
            cleaned = cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        return json.loads(cleaned.strip())
    except json.JSONDecodeError:
        return {
            "prioritized_gaps": [],
            "summary": {
                "critical_gaps": 0,
                "high_gaps": 0,
                "medium_gaps": 0,
                "low_gaps": 0,
                "key_themes": []
            },
            "quick_wins": []
        }


@router.post("/ai-prioritize")
def ai_prioritize_gaps(
    request: GapPrioritizationRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    
    gaps = collect_compliance_gaps(db, tenant_id, request.framework_id, request.max_gaps)
    
    if not gaps:
        return {
            "analysis_date": datetime.utcnow().isoformat(),
            "total_gaps_analyzed": 0,
            "prioritized_gaps": [],
            "summary": {
                "critical_gaps": 0,
                "high_gaps": 0,
                "medium_gaps": 0,
                "low_gaps": 0,
                "key_themes": []
            },
            "quick_wins": [],
            "message": "No compliance gaps found. Your controls have adequate evidence coverage."
        }
    
    gaps_for_ai = gaps[:request.max_gaps]
    gaps_data = json.dumps(gaps_for_ai, indent=2)
    
    try:
        client = get_openai_client()
        
        response = client.chat.completions.create(
            model=get_openai_model(),
            messages=[
                {
                    "role": "system",
                    "content": "You are a Senior GRC Compliance Expert. Analyze compliance gaps and return structured JSON prioritization."
                },
                {
                    "role": "user",
                    "content": GAP_PRIORITIZATION_PROMPT.format(gaps_data=gaps_data)
                }
            ],
            temperature=0.3,
            max_tokens=4000
        )
        
        ai_result = parse_ai_response(response.choices[0].message.content)
        
        return {
            "analysis_date": datetime.utcnow().isoformat(),
            "total_gaps_analyzed": len(gaps_for_ai),
            "prioritized_gaps": ai_result.get("prioritized_gaps", []),
            "summary": ai_result.get("summary", {
                "critical_gaps": 0,
                "high_gaps": 0,
                "medium_gaps": 0,
                "low_gaps": 0,
                "key_themes": []
            }),
            "quick_wins": ai_result.get("quick_wins", [])
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"AI gap prioritization error: {str(e)}")
        
        prioritized = []
        for idx, gap in enumerate(gaps_for_ai):
            prioritized.append({
                "rank": idx + 1,
                "gap_type": gap["gap_type"],
                "control_id": gap["control_id"],
                "control_title": gap["control_title"],
                "framework_name": gap["framework_name"],
                "business_impact": "medium",
                "impact_reasoning": f"Control '{gap['control_title']}' requires attention. {gap['gap_type'].replace('_', ' ').title()} detected.",
                "regulatory_risk": f"{gap['framework_name']} compliance requirement.",
                "remediation_effort": "medium",
                "suggested_actions": [
                    f"Upload evidence for {gap['control_title']}",
                    "Review control implementation status"
                ],
                "deadline_recommendation": "2 weeks"
            })
        
        return {
            "analysis_date": datetime.utcnow().isoformat(),
            "total_gaps_analyzed": len(gaps_for_ai),
            "prioritized_gaps": prioritized,
            "summary": {
                "critical_gaps": 0,
                "high_gaps": 0,
                "medium_gaps": len(prioritized),
                "low_gaps": 0,
                "key_themes": ["Evidence Collection", "Compliance Documentation"]
            },
            "quick_wins": [],
            "fallback": True,
            "error": "AI analysis unavailable. Basic prioritization provided."
        }
