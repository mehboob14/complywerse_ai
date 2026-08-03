"""SLA tracking + vendor incident management endpoints."""

from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func

from ....models import (
    Vendor, VendorSLARecord, VendorIncident, GRCUser, get_db,
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(tags=["Vendor Monitoring"])


# ── Pydantic schemas ──────────────────────────────────────────────

class SLARecordCreate(BaseModel):
    sla_metric: str = Field(..., min_length=1, max_length=255)
    target_value: Optional[float] = None
    actual_value: Optional[float] = None
    measurement_period: Optional[str] = "monthly"
    is_compliant: Optional[bool] = True
    notes: Optional[str] = None


class IncidentCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    severity: Optional[str] = "medium"
    status: Optional[str] = "open"
    occurred_at: Optional[datetime] = None
    impact_description: Optional[str] = None
    corrective_actions: Optional[str] = None


class IncidentUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    severity: Optional[str] = None
    status: Optional[str] = None
    occurred_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    impact_description: Optional[str] = None
    corrective_actions: Optional[str] = None


# ── Serializers ───────────────────────────────────────────────────

def serialize_sla_record(s: VendorSLARecord) -> dict:
    return {
        "id": s.id,
        "tenant_id": s.tenant_id,
        "vendor_id": s.vendor_id,
        "sla_metric": s.sla_metric,
        "target_value": s.target_value,
        "actual_value": s.actual_value,
        "measurement_period": s.measurement_period,
        "is_compliant": s.is_compliant,
        "notes": s.notes,
        "recorded_at": s.recorded_at.isoformat() if s.recorded_at else None,
    }


def serialize_incident(inc: VendorIncident) -> dict:
    data = {
        "id": inc.id,
        "tenant_id": inc.tenant_id,
        "vendor_id": inc.vendor_id,
        "title": inc.title,
        "description": inc.description,
        "severity": inc.severity,
        "status": inc.status,
        "occurred_at": inc.occurred_at.isoformat() if inc.occurred_at else None,
        "resolved_at": inc.resolved_at.isoformat() if inc.resolved_at else None,
        "impact_description": inc.impact_description,
        "corrective_actions": inc.corrective_actions,
        "reported_by": inc.reported_by,
        "created_at": inc.created_at.isoformat() if inc.created_at else None,
        "updated_at": inc.updated_at.isoformat() if inc.updated_at else None,
    }
    if inc.reporter:
        data["reporter"] = {"id": inc.reporter.id, "full_name": inc.reporter.display_name or inc.reporter.username}
    return data


# ── Helper ────────────────────────────────────────────────────────

def get_vendor_for_tenant(vendor_id: int, tenant_ids: List[int], db: Session) -> Vendor:
    vendor = db.query(Vendor).filter(
        Vendor.id == vendor_id,
        Vendor.tenant_id.in_(tenant_ids),
    ).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return vendor


# ── SLA endpoints ─────────────────────────────────────────────────

@router.get("/vendors/{vendor_id}/sla")
def list_sla_records(
    vendor_id: int,
    measurement_period: Optional[str] = Query(None),
    is_compliant: Optional[bool] = Query(None),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        return {"items": [], "total": 0, "skip": skip, "limit": limit, "compliance_rate": None}

    vendor = get_vendor_for_tenant(vendor_id, tenant_ids, db)

    query = db.query(VendorSLARecord).filter(
        VendorSLARecord.vendor_id == vendor_id,
        VendorSLARecord.tenant_id.in_(tenant_ids),
    )
    if measurement_period:
        query = query.filter(VendorSLARecord.measurement_period == measurement_period)
    if is_compliant is not None:
        query = query.filter(VendorSLARecord.is_compliant == is_compliant)

    total = query.count()
    records = query.order_by(VendorSLARecord.recorded_at.desc()).offset(skip).limit(limit).all()

    # Compliance summary
    total_records = db.query(func.count(VendorSLARecord.id)).filter(
        VendorSLARecord.vendor_id == vendor_id,
        VendorSLARecord.tenant_id.in_(tenant_ids),
    ).scalar() or 0
    compliant_count = db.query(func.count(VendorSLARecord.id)).filter(
        VendorSLARecord.vendor_id == vendor_id,
        VendorSLARecord.tenant_id.in_(tenant_ids),
        VendorSLARecord.is_compliant == True,
    ).scalar() or 0

    return {
        "items": [serialize_sla_record(s) for s in records],
        "total": total,
        "skip": skip,
        "limit": limit,
        "compliance_rate": round(compliant_count / total_records * 100, 1) if total_records > 0 else None,
    }


@router.post("/vendors/{vendor_id}/sla", status_code=status.HTTP_201_CREATED)
def create_sla_record(
    vendor_id: int,
    payload: SLARecordCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    vendor = get_vendor_for_tenant(vendor_id, tenant_ids, db)

    record = VendorSLARecord(
        tenant_id=vendor.tenant_id,
        vendor_id=vendor_id,
        sla_metric=payload.sla_metric,
        target_value=payload.target_value,
        actual_value=payload.actual_value,
        measurement_period=payload.measurement_period,
        is_compliant=payload.is_compliant,
        notes=payload.notes,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return serialize_sla_record(record)


# ── Incident endpoints ───────────────────────────────────────────

@router.get("/vendors/{vendor_id}/incidents")
def list_incidents(
    vendor_id: int,
    severity: Optional[str] = Query(None),
    incident_status: Optional[str] = Query(None, alias="status"),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}

    vendor = get_vendor_for_tenant(vendor_id, tenant_ids, db)

    query = db.query(VendorIncident).options(
        joinedload(VendorIncident.reporter),
    ).filter(
        VendorIncident.vendor_id == vendor_id,
        VendorIncident.tenant_id.in_(tenant_ids),
    )
    if severity:
        query = query.filter(VendorIncident.severity == severity)
    if incident_status:
        query = query.filter(VendorIncident.status == incident_status)

    total = query.count()
    incidents = query.order_by(VendorIncident.created_at.desc()).offset(skip).limit(limit).all()

    return {
        "items": [serialize_incident(inc) for inc in incidents],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.post("/vendors/{vendor_id}/incidents", status_code=status.HTTP_201_CREATED)
def create_incident(
    vendor_id: int,
    payload: IncidentCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    vendor = get_vendor_for_tenant(vendor_id, tenant_ids, db)

    incident = VendorIncident(
        tenant_id=vendor.tenant_id,
        vendor_id=vendor_id,
        title=payload.title,
        description=payload.description,
        severity=payload.severity,
        status=payload.status,
        occurred_at=payload.occurred_at or datetime.utcnow(),
        impact_description=payload.impact_description,
        corrective_actions=payload.corrective_actions,
        reported_by=current_user.id,
    )
    db.add(incident)
    db.commit()
    db.refresh(incident)

    # Reload with reporter relationship
    incident = db.query(VendorIncident).options(
        joinedload(VendorIncident.reporter),
    ).filter(VendorIncident.id == incident.id).first()

    return serialize_incident(incident)


@router.put("/vendors/{vendor_id}/incidents/{incident_id}")
def update_incident(
    vendor_id: int,
    incident_id: int,
    payload: IncidentUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    vendor = get_vendor_for_tenant(vendor_id, tenant_ids, db)

    incident = db.query(VendorIncident).options(
        joinedload(VendorIncident.reporter),
    ).filter(
        VendorIncident.id == incident_id,
        VendorIncident.vendor_id == vendor_id,
        VendorIncident.tenant_id.in_(tenant_ids),
    ).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(incident, key, value)

    incident.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(incident)

    incident = db.query(VendorIncident).options(
        joinedload(VendorIncident.reporter),
    ).filter(VendorIncident.id == incident.id).first()

    return serialize_incident(incident)
