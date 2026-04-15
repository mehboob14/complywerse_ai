from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, distinct, or_
from pydantic import BaseModel

from ....models import (
    Framework, FrameworkDomain, ControlObjective, FrameworkControl,
    CommonControlGroup, CommonControlGroupMapping, NormalizedControl,
    Evidence, EvidenceControlMapping, UploadedFramework, ParsedFrameworkControl,
    ControlImplementation, ImplementationEvidence, GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/coverage", tags=["Control Library - Coverage Matrix"])


def calculate_coverage_matrix(db: Session, tenant_id: int, visible_tenant_ids: Optional[List[int]] = None) -> dict:
    tenant_evidence_ids = db.query(Evidence.id).filter(
        Evidence.tenant_id == tenant_id
    ).subquery()

    covered_fc_set = set(
        row[0]
        for row in db.query(EvidenceControlMapping.framework_control_id).filter(
            EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
            EvidenceControlMapping.framework_control_id.isnot(None)
        ).distinct().all()
        if row[0] is not None
    )

    covered_pc_set = set(
        row[0]
        for row in db.query(EvidenceControlMapping.parsed_control_id).filter(
            EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
            EvidenceControlMapping.parsed_control_id.isnot(None)
        ).distinct().all()
        if row[0] is not None
    )

    implementation_covered_pc_set = set(
        row[0]
        for row in db.query(ControlImplementation.parsed_control_id)
        .join(ImplementationEvidence, ImplementationEvidence.implementation_id == ControlImplementation.id)
        .join(Evidence, Evidence.id == ImplementationEvidence.evidence_id)
        .filter(
            Evidence.tenant_id == tenant_id,
            ControlImplementation.parsed_control_id.isnot(None)
        )
        .distinct()
        .all()
        if row[0] is not None
    )

    covered_pc_set.update(implementation_covered_pc_set)

    matrix = {}
    categories = set()

    # Only show Framework records published from this tenant's uploaded frameworks
    _effective_tenants = visible_tenant_ids if visible_tenant_ids else [tenant_id]
    _tenant_pub_fw_ids = db.query(UploadedFramework.published_framework_id).filter(
        UploadedFramework.upload_status == 'published',
        UploadedFramework.published_framework_id.isnot(None),
        or_(
            UploadedFramework.tenant_id.in_(_effective_tenants),
            UploadedFramework.is_shared == True
        )
    ).all()
    _tenant_fw_id_set = list({row[0] for row in _tenant_pub_fw_ids})
    legacy_frameworks = db.query(Framework).filter(
        Framework.id.in_(_tenant_fw_id_set),
        or_(Framework.is_active == True, Framework.is_active.is_(None))
    ).all() if _tenant_fw_id_set else []
    for fw in legacy_frameworks:
        fw_key = str(fw.id)
        matrix[fw_key] = {
            "framework_id": fw.id,
            "framework_name": fw.name,
            "framework_code": fw.short_code,
            "categories": {}
        }

        for domain in fw.domains:
            cat_key = domain.name or "Uncategorized"
            categories.add(cat_key)

            if cat_key not in matrix[fw_key]["categories"]:
                matrix[fw_key]["categories"][cat_key] = {
                    "controls_total": 0,
                    "controls_with_evidence": 0,
                    "coverage_percent": 0
                }

            for objective in domain.objectives:
                controls = db.query(FrameworkControl).filter(
                    FrameworkControl.objective_id == objective.id
                ).all()
                for ctrl in controls:
                    matrix[fw_key]["categories"][cat_key]["controls_total"] += 1
                    if ctrl.id in covered_fc_set:
                        matrix[fw_key]["categories"][cat_key]["controls_with_evidence"] += 1

        for cat_key in matrix[fw_key]["categories"]:
            cat_data = matrix[fw_key]["categories"][cat_key]
            if cat_data["controls_total"] > 0:
                cat_data["coverage_percent"] = round(
                    (cat_data["controls_with_evidence"] / cat_data["controls_total"]) * 100, 2
                )

    tenant_filter = [tenant_id]
    if visible_tenant_ids:
        tenant_filter = visible_tenant_ids

    # Only show unpublished uploaded frameworks (published ones are in the legacy_frameworks list above)
    uploaded_frameworks = db.query(UploadedFramework).filter(
        UploadedFramework.upload_status.in_(['completed', 'parsed', 'classified']),
        or_(UploadedFramework.is_active == True, UploadedFramework.is_active.is_(None)),
        or_(
            UploadedFramework.tenant_id.in_(tenant_filter),
            UploadedFramework.tenant_id.is_(None),
            UploadedFramework.is_shared == True
        )
    ).all()

    for uploaded_framework in uploaded_frameworks:
        parsed_controls = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == uploaded_framework.id
        ).all()

        if not parsed_controls:
            continue

        synthetic_framework_id = -uploaded_framework.id
        fw_key = str(synthetic_framework_id)
        matrix[fw_key] = {
            "framework_id": synthetic_framework_id,
            "framework_name": uploaded_framework.name,
            "framework_code": uploaded_framework.framework_type.upper() if uploaded_framework.framework_type else f"UP-{uploaded_framework.id}",
            "categories": {}
        }

        for parsed_control in parsed_controls:
            cat_key = parsed_control.category or parsed_control.domain or "Uncategorized"
            categories.add(cat_key)

            if cat_key not in matrix[fw_key]["categories"]:
                matrix[fw_key]["categories"][cat_key] = {
                    "controls_total": 0,
                    "controls_with_evidence": 0,
                    "coverage_percent": 0
                }

            matrix[fw_key]["categories"][cat_key]["controls_total"] += 1
            if parsed_control.id in covered_pc_set:
                matrix[fw_key]["categories"][cat_key]["controls_with_evidence"] += 1

        for cat_key in matrix[fw_key]["categories"]:
            cat_data = matrix[fw_key]["categories"][cat_key]
            if cat_data["controls_total"] > 0:
                cat_data["coverage_percent"] = round(
                    (cat_data["controls_with_evidence"] / cat_data["controls_total"]) * 100, 2
                )

    return {
        "matrix": matrix,
        "categories": sorted(list(categories))
    }


def get_framework_coverage(db: Session, tenant_id: int, framework_id: int) -> dict:
    tenant_evidence_ids = db.query(Evidence.id).filter(
        Evidence.tenant_id == tenant_id
    ).subquery()
    
    covered_fc_ids = db.query(EvidenceControlMapping.framework_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.framework_control_id.isnot(None)
    ).distinct()
    
    covered_ids_set = set(row[0] for row in covered_fc_ids.all())
    
    framework = db.query(Framework).filter(
        Framework.id == framework_id,
        or_(Framework.is_active == True, Framework.is_active.is_(None))
    ).first()
    if not framework:
        return None
    
    all_controls = []
    uncovered_controls = []
    domain_coverage = {}
    category_coverage = {}
    
    for domain in framework.domains:
        domain_key = domain.name or domain.code
        domain_coverage[domain_key] = {
            "domain_id": domain.id,
            "domain_code": domain.code,
            "domain_name": domain.name,
            "total_controls": 0,
            "covered_controls": 0,
            "coverage_percent": 0
        }
        
        cat_key = domain.name or "Uncategorized"
        if cat_key not in category_coverage:
            category_coverage[cat_key] = {
                "category_name": cat_key,
                "total_controls": 0,
                "covered_controls": 0,
                "coverage_percent": 0
            }
        
        for objective in domain.objectives:
            controls = db.query(FrameworkControl).filter(
                FrameworkControl.objective_id == objective.id
            ).all()
            
            for ctrl in controls:
                all_controls.append(ctrl)
                is_covered = ctrl.id in covered_ids_set
                
                domain_coverage[domain_key]["total_controls"] += 1
                category_coverage[cat_key]["total_controls"] += 1
                
                if is_covered:
                    domain_coverage[domain_key]["covered_controls"] += 1
                    category_coverage[cat_key]["covered_controls"] += 1
                else:
                    uncovered_controls.append({
                        "id": ctrl.id,
                        "code": ctrl.code,
                        "name": ctrl.name,
                        "domain": domain.name,
                        "objective": objective.name
                    })
    
    for d_key in domain_coverage:
        d = domain_coverage[d_key]
        if d["total_controls"] > 0:
            d["coverage_percent"] = round((d["covered_controls"] / d["total_controls"]) * 100, 2)
    
    for c_key in category_coverage:
        c = category_coverage[c_key]
        if c["total_controls"] > 0:
            c["coverage_percent"] = round((c["covered_controls"] / c["total_controls"]) * 100, 2)
    
    total_controls = len(all_controls)
    covered_controls = total_controls - len(uncovered_controls)
    
    return {
        "framework_id": framework.id,
        "framework_name": framework.name,
        "framework_code": framework.short_code,
        "total_controls": total_controls,
        "covered_controls": covered_controls,
        "uncovered_controls": len(uncovered_controls),
        "coverage_percent": round((covered_controls / total_controls * 100) if total_controls > 0 else 0, 2),
        "uncovered_control_list": uncovered_controls[:50],
        "by_domain": list(domain_coverage.values()),
        "by_category": list(category_coverage.values())
    }


def get_uploaded_framework_coverage(
    db: Session,
    tenant_id: int,
    uploaded_framework_id: int,
    visible_tenant_ids: Optional[List[int]] = None
) -> dict:
    tenant_evidence_ids = db.query(Evidence.id).filter(
        Evidence.tenant_id == tenant_id
    ).subquery()

    covered_pc_ids = db.query(EvidenceControlMapping.parsed_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.parsed_control_id.isnot(None)
    ).distinct()

    implementation_covered_pc_ids = db.query(ControlImplementation.parsed_control_id).join(
        ImplementationEvidence,
        ImplementationEvidence.implementation_id == ControlImplementation.id
    ).join(
        Evidence,
        Evidence.id == ImplementationEvidence.evidence_id
    ).filter(
        Evidence.tenant_id == tenant_id,
        ControlImplementation.parsed_control_id.isnot(None)
    ).distinct()

    covered_ids_set = set(row[0] for row in covered_pc_ids.all())

    tenant_filter = [tenant_id]
    if visible_tenant_ids:
        tenant_filter = visible_tenant_ids

    uploaded_framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == uploaded_framework_id,
        or_(UploadedFramework.is_active == True, UploadedFramework.is_active.is_(None)),
        or_(
            UploadedFramework.tenant_id.in_(tenant_filter),
            UploadedFramework.tenant_id.is_(None),
            UploadedFramework.is_shared == True
        )
    ).first()
    if not uploaded_framework:
        return None

    parsed_controls = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == uploaded_framework_id
    ).all()

    uncovered_controls = []
    domain_coverage = {}
    category_coverage = {}

    for parsed_control in parsed_controls:
        domain_key = parsed_control.domain or "General"
        if domain_key not in domain_coverage:
            domain_coverage[domain_key] = {
                "domain_id": None,
                "domain_code": domain_key,
                "domain_name": domain_key,
                "total_controls": 0,
                "covered_controls": 0,
                "coverage_percent": 0
            }

        category_key = parsed_control.category or parsed_control.domain or "Uncategorized"
        if category_key not in category_coverage:
            category_coverage[category_key] = {
                "category_name": category_key,
                "total_controls": 0,
                "covered_controls": 0,
                "coverage_percent": 0
            }

        is_covered = parsed_control.id in covered_ids_set
        domain_coverage[domain_key]["total_controls"] += 1
        category_coverage[category_key]["total_controls"] += 1

        if is_covered:
            domain_coverage[domain_key]["covered_controls"] += 1
            category_coverage[category_key]["covered_controls"] += 1
        else:
            uncovered_controls.append({
                "id": parsed_control.id,
                "code": parsed_control.control_id or parsed_control.original_reference or f"PC-{parsed_control.id}",
                "name": parsed_control.title,
                "domain": parsed_control.domain,
                "objective": parsed_control.requirement
            })

    for domain_data in domain_coverage.values():
        if domain_data["total_controls"] > 0:
            domain_data["coverage_percent"] = round(
                (domain_data["covered_controls"] / domain_data["total_controls"]) * 100, 2
            )

    for category_data in category_coverage.values():
        if category_data["total_controls"] > 0:
            category_data["coverage_percent"] = round(
                (category_data["covered_controls"] / category_data["total_controls"]) * 100, 2
            )

    total_controls = len(parsed_controls)
    covered_controls = total_controls - len(uncovered_controls)

    return {
        "framework_id": -uploaded_framework.id,
        "framework_name": uploaded_framework.name,
        "framework_code": uploaded_framework.framework_type.upper() if uploaded_framework.framework_type else f"UP-{uploaded_framework.id}",
        "total_controls": total_controls,
        "covered_controls": covered_controls,
        "uncovered_controls": len(uncovered_controls),
        "coverage_percent": round((covered_controls / total_controls * 100) if total_controls > 0 else 0, 2),
        "uncovered_control_list": uncovered_controls[:50],
        "by_domain": list(domain_coverage.values()),
        "by_category": list(category_coverage.values())
    }


def calculate_audit_savings(db: Session, tenant_id: int) -> dict:
    tenant_evidence = db.query(Evidence).filter(
        Evidence.tenant_id == tenant_id
    ).all()
    
    evidence_ids = [e.id for e in tenant_evidence]
    
    if not evidence_ids:
        return {
            "total_evidence": 0,
            "multi_framework_evidence": 0,
            "single_framework_effort": 0,
            "actual_effort": 0,
            "savings_percent": 0,
            "controls_covered": 0
        }
    
    mappings = db.query(EvidenceControlMapping).filter(
        EvidenceControlMapping.evidence_id.in_(evidence_ids),
        or_(
            EvidenceControlMapping.framework_control_id.isnot(None),
            EvidenceControlMapping.parsed_control_id.isnot(None)
        )
    ).all()
    
    evidence_to_frameworks = {}
    for m in mappings:
        if m.evidence_id not in evidence_to_frameworks:
            evidence_to_frameworks[m.evidence_id] = set()
        
        if m.framework_control_id:
            fc = db.query(FrameworkControl).options(
                joinedload(FrameworkControl.objective)
                .joinedload(ControlObjective.domain)
                .joinedload(FrameworkDomain.framework)
            ).filter(FrameworkControl.id == m.framework_control_id).first()

            if fc and fc.objective and fc.objective.domain and fc.objective.domain.framework:
                evidence_to_frameworks[m.evidence_id].add(fc.objective.domain.framework.id)

        if m.parsed_control_id:
            parsed_control = db.query(ParsedFrameworkControl).options(
                joinedload(ParsedFrameworkControl.uploaded_framework)
            ).filter(ParsedFrameworkControl.id == m.parsed_control_id).first()

            if (
                parsed_control
                and parsed_control.uploaded_framework
                and (
                    parsed_control.uploaded_framework.tenant_id == tenant_id
                    or parsed_control.uploaded_framework.is_shared
                )
            ):
                evidence_to_frameworks[m.evidence_id].add(-parsed_control.uploaded_framework.id)
    
    multi_framework_evidence = sum(1 for fws in evidence_to_frameworks.values() if len(fws) > 1)
    
    single_framework_effort = len(mappings)
    actual_effort = len(tenant_evidence)
    savings = single_framework_effort - actual_effort if single_framework_effort > actual_effort else 0
    savings_percent = round((savings / single_framework_effort * 100) if single_framework_effort > 0 else 0, 2)
    
    unique_controls = set()
    for mapping in mappings:
        if mapping.framework_control_id:
            unique_controls.add(f"legacy:{mapping.framework_control_id}")
        if mapping.parsed_control_id:
            unique_controls.add(f"parsed:{mapping.parsed_control_id}")
    
    return {
        "total_evidence": len(tenant_evidence),
        "multi_framework_evidence": multi_framework_evidence,
        "single_framework_effort": single_framework_effort,
        "actual_effort": actual_effort,
        "savings_percent": savings_percent,
        "controls_covered": len(unique_controls),
        "average_controls_per_evidence": round(len(mappings) / len(tenant_evidence), 2) if tenant_evidence else 0
    }


@router.get("/matrix")
def get_coverage_matrix(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User has no tenant assigned"
        )
    
    result = calculate_coverage_matrix(db, tenant_id, user_tenants)
    
    frameworks = []
    for fw_key, fw_data in result["matrix"].items():
        total = sum(c["controls_total"] for c in fw_data["categories"].values())
        covered = sum(c["controls_with_evidence"] for c in fw_data["categories"].values())
        frameworks.append({
            "framework_id": fw_data["framework_id"],
            "framework_name": fw_data["framework_name"],
            "framework_code": fw_data["framework_code"],
            "total_controls": total,
            "covered_controls": covered,
            "coverage_percent": round((covered / total * 100) if total > 0 else 0, 2),
            "categories": fw_data["categories"]
        })
    
    return {
        "frameworks": frameworks,
        "categories": result["categories"]
    }


@router.get("/by-framework")
def get_coverage_by_framework(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User has no tenant assigned"
        )
    
    tenant_evidence_ids = db.query(Evidence.id).filter(
        Evidence.tenant_id == tenant_id
    ).subquery()
    
    covered_fc_ids = db.query(EvidenceControlMapping.framework_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.framework_control_id.isnot(None)
    ).distinct()

    covered_pc_ids = db.query(EvidenceControlMapping.parsed_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.parsed_control_id.isnot(None)
    ).distinct()

    covered_ids_set = set(row[0] for row in covered_fc_ids.all())

    implementation_covered_ids = set(
        row[0]
        for row in db.query(ControlImplementation.parsed_control_id)
        .join(ImplementationEvidence, ImplementationEvidence.implementation_id == ControlImplementation.id)
        .join(Evidence, Evidence.id == ImplementationEvidence.evidence_id)
        .filter(
            Evidence.tenant_id == tenant_id,
            ControlImplementation.parsed_control_id.isnot(None)
        )
        .distinct()
        .all()
        if row[0] is not None
    )

    covered_parsed_ids_set = set(row[0] for row in covered_pc_ids.all())
    covered_parsed_ids_set.update(implementation_covered_ids)

    # Only show Framework records published from this tenant's uploaded frameworks
    _by_fw_pub_ids = db.query(UploadedFramework.published_framework_id).filter(
        UploadedFramework.upload_status == 'published',
        UploadedFramework.published_framework_id.isnot(None),
        or_(
            UploadedFramework.tenant_id.in_(user_tenants),
            UploadedFramework.is_shared == True
        )
    ).all()
    _by_fw_id_set = list({row[0] for row in _by_fw_pub_ids})
    frameworks = db.query(Framework).filter(
        Framework.id.in_(_by_fw_id_set),
        or_(Framework.is_active == True, Framework.is_active.is_(None))
    ).all() if _by_fw_id_set else []
    results = []
    
    for fw in frameworks:
        total = 0
        covered = 0
        by_category = {}
        
        for domain in fw.domains:
            cat_key = domain.name or "Uncategorized"
            if cat_key not in by_category:
                by_category[cat_key] = {
                    "category_name": cat_key,
                    "total_controls": 0,
                    "covered_controls": 0,
                    "coverage_percent": 0
                }
            
            for objective in domain.objectives:
                controls = db.query(FrameworkControl).filter(
                    FrameworkControl.objective_id == objective.id
                ).all()
                
                for ctrl in controls:
                    total += 1
                    by_category[cat_key]["total_controls"] += 1
                    if ctrl.id in covered_ids_set:
                        covered += 1
                        by_category[cat_key]["covered_controls"] += 1
        
        for cat_data in by_category.values():
            if cat_data["total_controls"] > 0:
                cat_data["coverage_percent"] = round(
                    (cat_data["covered_controls"] / cat_data["total_controls"]) * 100, 2
                )
        
        results.append({
            "framework_id": fw.id,
            "framework_name": fw.name,
            "framework_code": fw.short_code,
            "total_controls": total,
            "covered_controls": covered,
            "coverage_percent": round((covered / total * 100) if total > 0 else 0, 2),
            "by_category": list(by_category.values())
        })

    # Only show unpublished uploaded frameworks (published ones are in the frameworks list above)
    uploaded_frameworks = db.query(UploadedFramework).filter(
        UploadedFramework.upload_status.in_(['completed', 'parsed', 'classified']),
        or_(UploadedFramework.is_active == True, UploadedFramework.is_active.is_(None)),
        or_(
            UploadedFramework.tenant_id.in_(user_tenants),
            UploadedFramework.tenant_id.is_(None),
            UploadedFramework.is_shared == True
        )
    ).all()

    for uploaded_framework in uploaded_frameworks:
        parsed_controls = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == uploaded_framework.id
        ).all()

        if not parsed_controls:
            continue

        total = 0
        covered = 0
        by_category = {}

        for parsed_control in parsed_controls:
            category_key = parsed_control.category or parsed_control.domain or "Uncategorized"
            if category_key not in by_category:
                by_category[category_key] = {
                    "category_name": category_key,
                    "total_controls": 0,
                    "covered_controls": 0,
                    "coverage_percent": 0
                }

            total += 1
            by_category[category_key]["total_controls"] += 1
            if parsed_control.id in covered_parsed_ids_set:
                covered += 1
                by_category[category_key]["covered_controls"] += 1

        for category_data in by_category.values():
            if category_data["total_controls"] > 0:
                category_data["coverage_percent"] = round(
                    (category_data["covered_controls"] / category_data["total_controls"]) * 100, 2
                )

        results.append({
            "framework_id": -uploaded_framework.id,
            "framework_name": uploaded_framework.name,
            "framework_code": uploaded_framework.framework_type.upper() if uploaded_framework.framework_type else f"UP-{uploaded_framework.id}",
            "total_controls": total,
            "covered_controls": covered,
            "coverage_percent": round((covered / total * 100) if total > 0 else 0, 2),
            "by_category": list(by_category.values())
        })
    
    return {"frameworks": results}


@router.get("/by-category")
def get_coverage_by_category(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User has no tenant assigned"
        )
    
    tenant_evidence_ids = db.query(Evidence.id).filter(
        Evidence.tenant_id == tenant_id
    ).subquery()
    
    covered_fc_ids = db.query(EvidenceControlMapping.framework_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.framework_control_id.isnot(None)
    ).distinct()

    covered_pc_ids = db.query(EvidenceControlMapping.parsed_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.parsed_control_id.isnot(None)
    ).distinct()

    implementation_covered_pc_ids = db.query(ControlImplementation.parsed_control_id).join(
        ImplementationEvidence,
        ImplementationEvidence.implementation_id == ControlImplementation.id
    ).join(
        Evidence,
        Evidence.id == ImplementationEvidence.evidence_id
    ).filter(
        Evidence.tenant_id == tenant_id,
        ControlImplementation.parsed_control_id.isnot(None)
    ).distinct()

    covered_ids_set = set(row[0] for row in covered_fc_ids.all())
    covered_parsed_ids_set = set(row[0] for row in covered_pc_ids.all())
    covered_parsed_ids_set.update(row[0] for row in implementation_covered_pc_ids.all())
    
    domains = db.query(FrameworkDomain).all()
    categories = {}
    
    for domain in domains:
        cat_key = domain.name or "Uncategorized"
        if cat_key not in categories:
            categories[cat_key] = {
                "category_name": cat_key,
                "total_controls": 0,
                "covered_controls": 0,
                "coverage_percent": 0,
                "frameworks": {}
            }
        
        framework = domain.framework
        fw_key = str(framework.id) if framework else "unknown"
        
        if fw_key not in categories[cat_key]["frameworks"]:
            categories[cat_key]["frameworks"][fw_key] = {
                "framework_id": framework.id if framework else None,
                "framework_name": framework.name if framework else "Unknown",
                "total_controls": 0,
                "covered_controls": 0,
                "coverage_percent": 0
            }
        
        for objective in domain.objectives:
            controls = db.query(FrameworkControl).filter(
                FrameworkControl.objective_id == objective.id
            ).all()
            
            for ctrl in controls:
                categories[cat_key]["total_controls"] += 1
                categories[cat_key]["frameworks"][fw_key]["total_controls"] += 1
                if ctrl.id in covered_ids_set:
                    categories[cat_key]["covered_controls"] += 1
                    categories[cat_key]["frameworks"][fw_key]["covered_controls"] += 1

    uploaded_frameworks = db.query(UploadedFramework).filter(
        or_(UploadedFramework.is_active == True, UploadedFramework.is_active.is_(None)),
        or_(
            UploadedFramework.tenant_id.in_(user_tenants),
            UploadedFramework.tenant_id.is_(None),
            UploadedFramework.is_shared == True
        )
    ).all()

    for uploaded_framework in uploaded_frameworks:
        parsed_controls = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == uploaded_framework.id
        ).all()

        if not parsed_controls:
            continue

        synthetic_framework_id = -uploaded_framework.id
        framework_key = str(synthetic_framework_id)

        for parsed_control in parsed_controls:
            category_key = parsed_control.category or parsed_control.domain or "Uncategorized"
            if category_key not in categories:
                categories[category_key] = {
                    "category_name": category_key,
                    "total_controls": 0,
                    "covered_controls": 0,
                    "coverage_percent": 0,
                    "frameworks": {}
                }

            if framework_key not in categories[category_key]["frameworks"]:
                categories[category_key]["frameworks"][framework_key] = {
                    "framework_id": synthetic_framework_id,
                    "framework_name": uploaded_framework.name,
                    "total_controls": 0,
                    "covered_controls": 0,
                    "coverage_percent": 0
                }

            categories[category_key]["total_controls"] += 1
            categories[category_key]["frameworks"][framework_key]["total_controls"] += 1

            if parsed_control.id in covered_parsed_ids_set:
                categories[category_key]["covered_controls"] += 1
                categories[category_key]["frameworks"][framework_key]["covered_controls"] += 1
    
    for cat_data in categories.values():
        if cat_data["total_controls"] > 0:
            cat_data["coverage_percent"] = round(
                (cat_data["covered_controls"] / cat_data["total_controls"]) * 100, 2
            )
        for fw_data in cat_data["frameworks"].values():
            if fw_data["total_controls"] > 0:
                fw_data["coverage_percent"] = round(
                    (fw_data["covered_controls"] / fw_data["total_controls"]) * 100, 2
                )
        cat_data["frameworks"] = list(cat_data["frameworks"].values())
    
    return {"categories": list(categories.values())}


@router.get("/by-domain")
def get_coverage_by_domain(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User has no tenant assigned"
        )
    
    tenant_evidence_ids = db.query(Evidence.id).filter(
        Evidence.tenant_id == tenant_id
    ).subquery()
    
    covered_fc_ids = db.query(EvidenceControlMapping.framework_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.framework_control_id.isnot(None)
    ).distinct()
    
    covered_ids_set = set(row[0] for row in covered_fc_ids.all())
    
    domains = db.query(FrameworkDomain).options(
        joinedload(FrameworkDomain.framework)
    ).all()
    
    results = []
    for domain in domains:
        total = 0
        covered = 0
        
        for objective in domain.objectives:
            controls = db.query(FrameworkControl).filter(
                FrameworkControl.objective_id == objective.id
            ).all()
            
            for ctrl in controls:
                total += 1
                if ctrl.id in covered_ids_set:
                    covered += 1
        
        results.append({
            "domain_id": domain.id,
            "domain_code": domain.code,
            "domain_name": domain.name,
            "framework_id": domain.framework.id if domain.framework else None,
            "framework_name": domain.framework.name if domain.framework else None,
            "framework_code": domain.framework.short_code if domain.framework else None,
            "total_controls": total,
            "covered_controls": covered,
            "coverage_percent": round((covered / total * 100) if total > 0 else 0, 2)
        })
    
    return {"domains": results}


@router.get("/heatmap-data")
def get_heatmap_data(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User has no tenant assigned"
        )
    
    result = calculate_coverage_matrix(db, tenant_id, user_tenants)
    
    rows = []
    columns = result["categories"]
    values = []
    
    for fw_key, fw_data in result["matrix"].items():
        rows.append({
            "id": fw_data["framework_id"],
            "name": fw_data["framework_name"],
            "code": fw_data["framework_code"]
        })
        
        row_values = []
        for cat in columns:
            cat_data = fw_data["categories"].get(cat, {"coverage_percent": 0})
            coverage = cat_data.get("coverage_percent", 0)
            
            if coverage <= 33:
                color = "red"
            elif coverage <= 66:
                color = "yellow"
            else:
                color = "green"
            
            row_values.append({
                "value": coverage,
                "color": color,
                "controls_total": cat_data.get("controls_total", 0),
                "controls_with_evidence": cat_data.get("controls_with_evidence", 0)
            })
        
        values.append(row_values)
    
    return {
        "rows": rows,
        "columns": columns,
        "values": values,
        "color_scale": {
            "red": {"min": 0, "max": 33, "label": "Low Coverage"},
            "yellow": {"min": 34, "max": 66, "label": "Partial Coverage"},
            "green": {"min": 67, "max": 100, "label": "Good Coverage"}
        }
    }


@router.get("/framework/{framework_id}")
def get_framework_coverage_detail(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User has no tenant assigned"
        )
    
    if framework_id < 0:
        result = get_uploaded_framework_coverage(db, tenant_id, abs(framework_id), user_tenants)
    else:
        framework = db.query(Framework).filter(
            Framework.id == framework_id,
            or_(Framework.is_active == True, Framework.is_active.is_(None))
        ).first()
        if not framework:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Framework not found"
            )
        result = get_framework_coverage(db, tenant_id, framework_id)

    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework not found"
        )
    
    return result


@router.get("/group/{group_id}")
def get_group_coverage(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    tenant_id = get_user_primary_tenant(current_user, db)
    
    group = db.query(CommonControlGroup).filter(
        CommonControlGroup.id == group_id
    ).first()
    
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control group not found"
        )
    
    if group.tenant_id is not None and group.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this group"
        )
    
    mappings = db.query(CommonControlGroupMapping).filter(
        CommonControlGroupMapping.group_id == group_id
    ).all()
    
    tenant_evidence_ids = db.query(Evidence.id).filter(
        Evidence.tenant_id == tenant_id
    ).subquery()
    
    covered_fc_ids = db.query(EvidenceControlMapping.framework_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.framework_control_id.isnot(None)
    ).distinct()
    
    covered_nc_ids = db.query(EvidenceControlMapping.normalized_control_id).filter(
        EvidenceControlMapping.evidence_id.in_(tenant_evidence_ids),
        EvidenceControlMapping.normalized_control_id.isnot(None)
    ).distinct()
    
    covered_fc_set = set(row[0] for row in covered_fc_ids.all())
    covered_nc_set = set(row[0] for row in covered_nc_ids.all())
    
    total_controls = 0
    covered_controls = 0
    controls_detail = []
    
    for mapping in mappings:
        if mapping.normalized_control_id:
            nc = db.query(NormalizedControl).filter(
                NormalizedControl.id == mapping.normalized_control_id
            ).first()
            if nc:
                is_covered = nc.id in covered_nc_set
                total_controls += 1
                if is_covered:
                    covered_controls += 1
                controls_detail.append({
                    "type": "normalized",
                    "id": nc.id,
                    "code": nc.code,
                    "name": nc.name,
                    "has_evidence": is_covered
                })
        
        if mapping.framework_control_id:
            fc = db.query(FrameworkControl).options(
                joinedload(FrameworkControl.objective)
                .joinedload(ControlObjective.domain)
                .joinedload(FrameworkDomain.framework)
            ).filter(
                FrameworkControl.id == mapping.framework_control_id
            ).first()
            if fc:
                is_covered = fc.id in covered_fc_set
                total_controls += 1
                if is_covered:
                    covered_controls += 1
                controls_detail.append({
                    "type": "framework",
                    "id": fc.id,
                    "code": fc.code,
                    "name": fc.name,
                    "framework": fc.objective.domain.framework.name if fc.objective and fc.objective.domain and fc.objective.domain.framework else None,
                    "has_evidence": is_covered
                })
    
    return {
        "group_id": group.id,
        "group_code": group.code,
        "group_name": group.name,
        "category": group.category,
        "domain": group.domain,
        "total_controls": total_controls,
        "covered_controls": covered_controls,
        "coverage_percent": round((covered_controls / total_controls * 100) if total_controls > 0 else 0, 2),
        "controls": controls_detail
    }


@router.get("/evidence-reuse")
def get_evidence_reuse_stats(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User has no tenant assigned"
        )
    
    tenant_evidence = db.query(Evidence).filter(
        Evidence.tenant_id == tenant_id
    ).all()
    
    evidence_ids = [e.id for e in tenant_evidence]
    
    if not evidence_ids:
        return {
            "total_evidence": 0,
            "multi_framework_evidence": 0,
            "average_controls_per_evidence": 0,
            "top_reused_evidence": []
        }
    
    evidence_stats = []
    multi_framework_count = 0
    
    for evidence in tenant_evidence:
        mappings = db.query(EvidenceControlMapping).filter(
            EvidenceControlMapping.evidence_id == evidence.id,
            EvidenceControlMapping.framework_control_id.isnot(None)
        ).all()
        
        frameworks_covered = set()
        for m in mappings:
            fc = db.query(FrameworkControl).options(
                joinedload(FrameworkControl.objective)
                .joinedload(ControlObjective.domain)
                .joinedload(FrameworkDomain.framework)
            ).filter(FrameworkControl.id == m.framework_control_id).first()
            
            if fc and fc.objective and fc.objective.domain and fc.objective.domain.framework:
                frameworks_covered.add(fc.objective.domain.framework.id)
        
        if len(frameworks_covered) > 1:
            multi_framework_count += 1
        
        evidence_stats.append({
            "evidence_id": evidence.id,
            "evidence_name": evidence.name,
            "controls_linked": len(mappings),
            "frameworks_covered": len(frameworks_covered)
        })
    
    evidence_stats.sort(key=lambda x: x["controls_linked"], reverse=True)
    
    total_mappings = sum(e["controls_linked"] for e in evidence_stats)
    avg_controls = round(total_mappings / len(tenant_evidence), 2) if tenant_evidence else 0
    
    return {
        "total_evidence": len(tenant_evidence),
        "multi_framework_evidence": multi_framework_count,
        "average_controls_per_evidence": avg_controls,
        "top_reused_evidence": evidence_stats[:10]
    }


@router.get("/audit-savings")
def get_audit_savings(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User has no tenant assigned"
        )
    
    return calculate_audit_savings(db, tenant_id)


@router.get("/trends")
def get_coverage_trends(
    period: str = Query("monthly", pattern="^(weekly|monthly)$"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User has no tenant assigned"
        )
    
    if period == "weekly":
        num_periods = 12
        delta = timedelta(weeks=1)
        period_format = "%Y-W%U"
    else:
        num_periods = 12
        delta = timedelta(days=30)
        period_format = "%Y-%m"
    
    now = datetime.utcnow()
    trends = []
    
    frameworks = db.query(Framework).filter(Framework.is_active == True).all()
    total_controls = 0
    for fw in frameworks:
        for domain in fw.domains:
            for objective in domain.objectives:
                ctrl_count = db.query(FrameworkControl).filter(
                    FrameworkControl.objective_id == objective.id
                ).count()
                total_controls += ctrl_count
    
    for i in range(num_periods, -1, -1):
        period_end = now - (delta * i)
        period_start = period_end - delta
        
        evidence_count = db.query(Evidence).filter(
            Evidence.tenant_id == tenant_id,
            Evidence.uploaded_at <= period_end
        ).count()
        
        evidence_ids_to_date = db.query(Evidence.id).filter(
            Evidence.tenant_id == tenant_id,
            Evidence.uploaded_at <= period_end
        ).subquery()
        
        covered_controls = db.query(
            func.count(distinct(EvidenceControlMapping.framework_control_id))
        ).filter(
            EvidenceControlMapping.evidence_id.in_(evidence_ids_to_date),
            EvidenceControlMapping.framework_control_id.isnot(None)
        ).scalar() or 0
        
        coverage_percent = round((covered_controls / total_controls * 100) if total_controls > 0 else 0, 2)
        
        trends.append({
            "period": period_end.strftime(period_format),
            "date": period_end.isoformat(),
            "total_controls": total_controls,
            "covered_controls": covered_controls,
            "coverage_percent": coverage_percent,
            "evidence_count": evidence_count
        })
    
    return {
        "period_type": period,
        "trends": trends
    }
