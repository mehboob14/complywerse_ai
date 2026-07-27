"""Vendor CRUD + dashboard endpoints."""

from typing import List, Optional
from datetime import datetime, timedelta
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, and_

from ....models import (
    Vendor, VendorAssessment, VendorSLARecord, VendorIncident,
    GRCUser, Tenant, get_db,
)
from ....rich_audit import write_rich_audit_log, model_to_dict
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(tags=["Vendors"])


# ── Pydantic schemas ──────────────────────────────────────────────

class VendorCreate(BaseModel):
    tenant_id: Optional[int] = None
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    tier: Optional[str] = "medium"
    status: Optional[str] = "active"
    vendor_type: Optional[str] = None
    industry: Optional[str] = None
    website: Optional[str] = None
    primary_contact_name: Optional[str] = None
    primary_contact_email: Optional[str] = None
    primary_contact_phone: Optional[str] = None
    contract_start_date: Optional[datetime] = None
    contract_end_date: Optional[datetime] = None
    contract_value: Optional[float] = None
    services_provided: Optional[list] = []
    data_access_level: Optional[str] = "none"
    data_types_accessed: Optional[list] = []
    geographic_locations: Optional[list] = []
    owner_id: Optional[int] = None
    business_unit_id: Optional[int] = None
    notes: Optional[str] = None


class VendorUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    tier: Optional[str] = None
    status: Optional[str] = None
    vendor_type: Optional[str] = None
    industry: Optional[str] = None
    website: Optional[str] = None
    primary_contact_name: Optional[str] = None
    primary_contact_email: Optional[str] = None
    primary_contact_phone: Optional[str] = None
    contract_start_date: Optional[datetime] = None
    contract_end_date: Optional[datetime] = None
    contract_value: Optional[float] = None
    services_provided: Optional[list] = None
    data_access_level: Optional[str] = None
    data_types_accessed: Optional[list] = None
    geographic_locations: Optional[list] = None
    inherent_risk_score: Optional[float] = None
    residual_risk_score: Optional[float] = None
    risk_rating: Optional[str] = None
    owner_id: Optional[int] = None
    business_unit_id: Optional[int] = None
    notes: Optional[str] = None


# ── Serializers ───────────────────────────────────────────────────

def serialize_vendor(v: Vendor, include_counts: bool = False) -> dict:
    data = {
        "id": v.id,
        "tenant_id": v.tenant_id,
        "name": v.name,
        "description": v.description,
        "tier": v.tier,
        "status": v.status,
        "vendor_type": v.vendor_type,
        "industry": v.industry,
        "website": v.website,
        "primary_contact_name": v.primary_contact_name,
        "primary_contact_email": v.primary_contact_email,
        "primary_contact_phone": v.primary_contact_phone,
        "contract_start_date": v.contract_start_date.isoformat() if v.contract_start_date else None,
        "contract_end_date": v.contract_end_date.isoformat() if v.contract_end_date else None,
        "contract_value": v.contract_value,
        "services_provided": v.services_provided or [],
        "data_access_level": v.data_access_level,
        "data_types_accessed": v.data_types_accessed or [],
        "geographic_locations": v.geographic_locations or [],
        "inherent_risk_score": v.inherent_risk_score,
        "residual_risk_score": v.residual_risk_score,
        "risk_rating": v.risk_rating,
        "owner_id": v.owner_id,
        "business_unit_id": v.business_unit_id,
        "notes": v.notes,
        "created_at": v.created_at.isoformat() if v.created_at else None,
        "updated_at": v.updated_at.isoformat() if v.updated_at else None,
    }
    if include_counts:
        data["assessments_count"] = len(v.assessments) if v.assessments else 0
        data["incidents_count"] = len(v.incidents) if v.incidents else 0
        data["sla_records_count"] = len(v.sla_records) if v.sla_records else 0
    if v.owner:
        data["owner"] = {"id": v.owner.id, "full_name": v.owner.display_name or v.owner.username, "email": v.owner.email}
    return data


# ── Helper ────────────────────────────────────────────────────────

def get_vendor_or_404(vendor_id: int, tenant_ids: List[int], db: Session) -> Vendor:
    vendor = db.query(Vendor).filter(
        Vendor.id == vendor_id,
        Vendor.tenant_id.in_(tenant_ids),
    ).first()
    if not vendor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor not found")
    return vendor


# ── Endpoints ─────────────────────────────────────────────────────

@router.get("/vendors")
def list_vendors(
    tier: Optional[str] = Query(None, description="Filter by tier: critical, high, medium, low"),
    vendor_status: Optional[str] = Query(None, alias="status", description="Filter by status"),
    search: Optional[str] = Query(None, description="Search by name"),
    vendor_type: Optional[str] = Query(None),
    data_access_level: Optional[str] = Query(None),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}

    query = db.query(Vendor).options(
        joinedload(Vendor.owner),
    ).filter(Vendor.tenant_id.in_(tenant_ids))

    if tier:
        query = query.filter(Vendor.tier == tier)
    if vendor_status:
        query = query.filter(Vendor.status == vendor_status)
    if vendor_type:
        query = query.filter(Vendor.vendor_type == vendor_type)
    if data_access_level:
        query = query.filter(Vendor.data_access_level == data_access_level)
    if search:
        query = query.filter(Vendor.name.ilike(f"%{search}%"))

    vendors = query.order_by(Vendor.created_at.desc()).offset(skip).limit(limit).all()
    total = query.count()

    return {
        "items": [serialize_vendor(v) for v in vendors],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.post("/vendors", status_code=status.HTTP_201_CREATED)
def create_vendor(
    payload: VendorCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    tenant_id = payload.tenant_id if payload.tenant_id and payload.tenant_id in tenant_ids else tenant_ids[0]

    vendor = Vendor(
        tenant_id=tenant_id,
        name=payload.name,
        description=payload.description,
        tier=payload.tier,
        status=payload.status,
        vendor_type=payload.vendor_type,
        industry=payload.industry,
        website=payload.website,
        primary_contact_name=payload.primary_contact_name,
        primary_contact_email=payload.primary_contact_email,
        primary_contact_phone=payload.primary_contact_phone,
        contract_start_date=payload.contract_start_date,
        contract_end_date=payload.contract_end_date,
        contract_value=payload.contract_value,
        services_provided=payload.services_provided,
        data_access_level=payload.data_access_level,
        data_types_accessed=payload.data_types_accessed,
        geographic_locations=payload.geographic_locations,
        owner_id=payload.owner_id,
        business_unit_id=payload.business_unit_id,
        notes=payload.notes,
    )
    db.add(vendor)
    db.flush()
    write_rich_audit_log(
        db=db,
        tenant_id=tenant_id,
        user_id=current_user.id,
        action="create",
        resource_type="vendor",
        resource_id=vendor.id,
        resource_name=vendor.name,
        summary=f"Created vendor '{vendor.name}' (tier: {vendor.tier or 'unset'})",
        after=model_to_dict(vendor),
    )
    db.commit()
    db.refresh(vendor)
    return serialize_vendor(vendor)


@router.get("/vendors/dashboard")
def vendor_dashboard(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        return {"total_vendors": 0}

    base = db.query(Vendor).filter(Vendor.tenant_id.in_(tenant_ids))

    total = base.count()

    # By tier
    by_tier_rows = (
        db.query(Vendor.tier, func.count(Vendor.id))
        .filter(Vendor.tenant_id.in_(tenant_ids))
        .group_by(Vendor.tier)
        .all()
    )
    by_tier = {row[0] or "unset": row[1] for row in by_tier_rows}

    # By status
    by_status_rows = (
        db.query(Vendor.status, func.count(Vendor.id))
        .filter(Vendor.tenant_id.in_(tenant_ids))
        .group_by(Vendor.status)
        .all()
    )
    by_status = {row[0] or "unset": row[1] for row in by_status_rows}

    # Expiring contracts (next 30 days)
    now = datetime.utcnow()
    threshold = now + timedelta(days=30)
    expiring = (
        base.filter(
            Vendor.contract_end_date != None,
            Vendor.contract_end_date >= now,
            Vendor.contract_end_date <= threshold,
        )
        .order_by(Vendor.contract_end_date.asc())
        .limit(10)
        .all()
    )

    # Average risk score
    avg_inherent = (
        db.query(func.avg(Vendor.inherent_risk_score))
        .filter(
            Vendor.tenant_id.in_(tenant_ids),
            Vendor.inherent_risk_score != None,
        )
        .scalar()
    )
    avg_residual = (
        db.query(func.avg(Vendor.residual_risk_score))
        .filter(
            Vendor.tenant_id.in_(tenant_ids),
            Vendor.residual_risk_score != None,
        )
        .scalar()
    )

    # Recent assessments
    recent_assessments = (
        db.query(VendorAssessment)
        .options(joinedload(VendorAssessment.vendor))
        .filter(VendorAssessment.tenant_id.in_(tenant_ids))
        .order_by(VendorAssessment.created_at.desc())
        .limit(5)
        .all()
    )

    # Open incidents count
    open_incidents = (
        db.query(func.count(VendorIncident.id))
        .filter(
            VendorIncident.tenant_id.in_(tenant_ids),
            VendorIncident.status.in_(["open", "investigating"]),
        )
        .scalar()
    )

    return {
        "total_vendors": total,
        "by_tier": by_tier,
        "by_status": by_status,
        "expiring_contracts": [
            {
                "id": v.id,
                "name": v.name,
                "tier": v.tier,
                "contract_end_date": v.contract_end_date.isoformat() if v.contract_end_date else None,
            }
            for v in expiring
        ],
        "avg_inherent_risk_score": round(avg_inherent, 2) if avg_inherent else None,
        "avg_residual_risk_score": round(avg_residual, 2) if avg_residual else None,
        "recent_assessments": [
            {
                "id": a.id,
                "vendor_id": a.vendor_id,
                "vendor_name": a.vendor.name if a.vendor else None,
                "assessment_type": a.assessment_type,
                "status": a.status,
                "risk_rating": a.risk_rating,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in recent_assessments
        ],
        "open_incidents": open_incidents or 0,
    }


@router.get("/vendors/{vendor_id}")
def get_vendor(
    vendor_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    vendor = (
        db.query(Vendor)
        .options(
            joinedload(Vendor.owner),
            joinedload(Vendor.assessments),
            joinedload(Vendor.incidents),
            joinedload(Vendor.sla_records),
        )
        .filter(Vendor.id == vendor_id, Vendor.tenant_id.in_(tenant_ids))
        .first()
    )
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    return serialize_vendor(vendor, include_counts=True)


@router.put("/vendors/{vendor_id}")
def update_vendor(
    vendor_id: int,
    payload: VendorUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    vendor = get_vendor_or_404(vendor_id, tenant_ids, db)

    before_snapshot = model_to_dict(vendor)
    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(vendor, key, value)

    vendor.updated_at = datetime.utcnow()
    write_rich_audit_log(
        db=db,
        tenant_id=vendor.tenant_id,
        user_id=current_user.id,
        action="update",
        resource_type="vendor",
        resource_id=vendor.id,
        resource_name=vendor.name,
        summary=f"Updated vendor '{vendor.name}'",
        before=before_snapshot,
        after=model_to_dict(vendor),
    )
    db.commit()
    db.refresh(vendor)
    return serialize_vendor(vendor)


@router.delete("/vendors/{vendor_id}")
def delete_vendor(
    vendor_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    vendor = get_vendor_or_404(vendor_id, tenant_ids, db)
    vendor_name = vendor.name
    tenant_id = vendor.tenant_id
    before_snapshot = model_to_dict(vendor)
    write_rich_audit_log(
        db=db,
        tenant_id=tenant_id,
        user_id=current_user.id,
        action="delete",
        resource_type="vendor",
        resource_id=vendor_id,
        resource_name=vendor_name,
        summary=f"Deleted vendor '{vendor_name}'",
        before=before_snapshot,
    )
    db.delete(vendor)
    db.commit()
    return {"message": f"Vendor '{vendor_name}' deleted successfully"}
