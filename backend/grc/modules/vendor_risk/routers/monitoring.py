"""SLA tracking + vendor incident management endpoints."""

import logging
from typing import List, Literal, Optional
from datetime import datetime
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func

from ....models import (
    Vendor, VendorSLARecord, VendorIncident, GRCUser, TPRAContract, get_db,
)
from ....routers.auth_router import require_auth, get_user_tenants
from ..tpra import monitoring as tpra_monitoring, rbac, service as tpra_service

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Vendor Monitoring"])


# ── Pydantic schemas ──────────────────────────────────────────────

class SLARecordCreate(BaseModel):
    sla_metric: str = Field(..., min_length=1, max_length=255)
    target_value: Optional[float] = None
    actual_value: Optional[float] = None          # what was measured
    measurement_period: Optional[str] = "monthly"
    is_compliant: Optional[bool] = True           # used only when the numbers cannot say
    notes: Optional[str] = None
    # Measured against the contract: which one, in what unit, and which way is good.
    contract_id: Optional[int] = None
    unit: Optional[str] = Field(None, max_length=20)
    direction: Optional[Literal["higher_is_better", "lower_is_better"]] = None


class SLARecordUpdate(SLARecordCreate):
    # Only the fields a request names are written.
    sla_metric: Optional[str] = Field(None, min_length=1, max_length=255)
    measurement_period: Optional[str] = None
    is_compliant: Optional[bool] = None


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
        "contract_id": s.contract_id,
        "unit": s.unit,
        "direction": s.direction,
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
        "linked_issue_id": getattr(inc, "linked_issue_id", None),
        "reported_by": inc.reported_by,
        "created_at": inc.created_at.isoformat() if inc.created_at else None,
        "updated_at": inc.updated_at.isoformat() if inc.updated_at else None,
    }
    if inc.reporter:
        data["reporter"] = {"id": inc.reporter.id, "full_name": inc.reporter.display_name or inc.reporter.username}
    return data


# ── Helper ────────────────────────────────────────────────────────

def get_vendor_for_tenant(vendor_id: int, tenant_ids: List[int], db: Session, writing: bool = False) -> Vendor:
    """The supplier; an archived one is read, never written to."""
    vendor = db.query(Vendor).filter(
        Vendor.id == vendor_id,
        Vendor.tenant_id.in_(tenant_ids),
    ).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    if writing and vendor.deleted_at is not None:
        raise HTTPException(status_code=409, detail="This supplier is archived. Restore it first.")
    return vendor


# ── A service level against its contract ──────────────────────────

_SLA_FIELDS = ("sla_metric", "target_value", "actual_value", "measurement_period", "is_compliant", "notes",
               "contract_id", "unit", "direction")


def sla_met(target: Optional[float], measured: Optional[float], direction: Optional[str],
            recorded: Optional[bool]) -> bool:
    """Whether a level was met: from the target and the measurement when both are known (which way
    is good being part of the level), otherwise what was recorded."""
    if target is None or measured is None or direction is None:
        return True if recorded is None else bool(recorded)
    return measured >= target if direction == "higher_is_better" else measured <= target


def _settle(db: Session, vendor: Vendor, record: VendorSLARecord) -> None:
    """Check the record's contract and work out whether it was met. ValueError says what is wrong."""
    if record.target_value is not None and record.actual_value is not None and record.direction is None:
        raise ValueError("Say whether a higher or a lower value is better")
    if record.contract_id is not None and not db.query(TPRAContract.id).filter(
            TPRAContract.id == record.contract_id, TPRAContract.vendor_id == vendor.id,
            TPRAContract.deleted_at.is_(None)).first():
        raise ValueError("That contract is not one of this supplier's")
    record.unit = " ".join((record.unit or "").split()) or None
    record.is_compliant = sla_met(record.target_value, record.actual_value, record.direction, record.is_compliant)


def _amount(value: float, unit: Optional[str]) -> str:
    return f"{value:g}{unit}" if unit == "%" else f"{value:g} {unit}" if unit else f"{value:g}"


def _breach_signal(db: Session, vendor: Vendor, record: VendorSLARecord, actor_id: Optional[int]) -> Optional[int]:
    """A missed level becomes a monitoring signal, once per record: it shows in the attention
    queue, and reopens the assessment when the supplier's tier says a medium signal should."""
    if record.is_compliant:
        return None
    if record.target_value is not None and record.actual_value is not None:
        detail = (f"Measured {_amount(record.actual_value, record.unit)} against a target of "
                  f"{_amount(record.target_value, record.unit)}"
                  f" ({'higher' if record.direction == 'higher_is_better' else 'lower'} is better).")
    else:
        detail = "Recorded as missed."
    signal, _, created = tpra_monitoring.record_signal(
        db, vendor, signal_type="sla", severity="medium",
        title=f"{vendor.name} missed a service level: {record.sla_metric}", detail=detail + (
            f"\n\n{record.notes}" if record.notes else ""),
        source="SLA tracking", occurred_at=record.recorded_at, external_id=f"sla:{record.id}", actor_id=actor_id)
    return signal.id if created else None


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
    records = query.order_by(VendorSLARecord.recorded_at.desc(), VendorSLARecord.id.desc()).offset(skip).limit(limit).all()

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
    rbac.require_write(db, current_user, "monitoring", "create")
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    vendor = get_vendor_for_tenant(vendor_id, tenant_ids, db, writing=True)

    record = VendorSLARecord(
        tenant_id=vendor.tenant_id,
        vendor_id=vendor_id,
        sla_metric=payload.sla_metric,
        target_value=payload.target_value,
        actual_value=payload.actual_value,
        measurement_period=payload.measurement_period,
        is_compliant=payload.is_compliant,
        notes=payload.notes,
        contract_id=payload.contract_id,
        unit=payload.unit,
        direction=payload.direction,
    )
    try:
        _settle(db, vendor, record)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    db.add(record)
    db.flush()
    tpra_service.write_audit(db, vendor.tenant_id, entity="sla", action="create", vendor_id=vendor.id,
                             entity_id=record.id, actor_id=current_user.id, to_value=record.sla_metric,
                             extra={"met": record.is_compliant})
    signal_id = _breach_signal(db, vendor, record, current_user.id)
    db.commit()
    db.refresh(record)
    return {**serialize_sla_record(record), "signal_id": signal_id}


@router.put("/vendors/{vendor_id}/sla/{record_id}")
def update_sla_record(
    vendor_id: int,
    record_id: int,
    payload: SLARecordUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    rbac.require_write(db, current_user, "monitoring", "edit")
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    vendor = get_vendor_for_tenant(vendor_id, tenant_ids, db, writing=True)
    record = db.query(VendorSLARecord).filter(
        VendorSLARecord.id == record_id,
        VendorSLARecord.vendor_id == vendor_id,
        VendorSLARecord.tenant_id.in_(tenant_ids),
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="SLA record not found")

    before = {k: getattr(record, k) for k in _SLA_FIELDS}
    for key, value in payload.model_dump(exclude_unset=True).items():
        if value is None and key in ("sla_metric", "measurement_period"):
            continue                                   # these can change but never be emptied
        setattr(record, key, value)
    try:
        _settle(db, vendor, record)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    changes = {k: [before[k], getattr(record, k)] for k in _SLA_FIELDS if before[k] != getattr(record, k)}
    if changes:
        tpra_service.write_audit(db, vendor.tenant_id, entity="sla", action="update", vendor_id=vendor.id,
                                 entity_id=record.id, actor_id=current_user.id, to_value=record.sla_metric,
                                 extra={"changes": changes, "met": record.is_compliant})
    signal_id = _breach_signal(db, vendor, record, current_user.id)
    db.commit()
    db.refresh(record)
    return {**serialize_sla_record(record), "signal_id": signal_id}


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
    rbac.require_write(db, current_user, "monitoring", "create")
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    vendor = get_vendor_for_tenant(vendor_id, tenant_ids, db, writing=True)

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

    # ── Linkage: a CRITICAL vendor incident opens an Issue in Issue Management
    # so it shows up in the CISO/auditor "what's open" view and gets a CAPA
    # workflow. Guarded — never blocks incident creation.
    if (incident.severity or "").lower() == "critical":
        try:
            from ....models import Issue
            issue = Issue(
                tenant_id=incident.tenant_id,
                title=f"Vendor incident: {incident.title}",
                description=(incident.description or "") +
                            (f"\n\nImpact: {incident.impact_description}" if incident.impact_description else ""),
                severity="critical",
                status="open",
                issue_type="vendor_breach",
                category="security",
                source_type="incident_report",
                source_id=incident.id,
                workflow_state="new",
                reporter_id=current_user.id,
                detected_at=incident.occurred_at,
            )
            db.add(issue)
            db.flush()
            incident.linked_issue_id = issue.id
            db.commit()
        except Exception:  # noqa: BLE001 — linkage is best-effort
            logger.warning("vendor incident → Issue linkage skipped", exc_info=True)
            db.rollback()

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
    rbac.require_write(db, current_user, "monitoring", "edit")
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    vendor = get_vendor_for_tenant(vendor_id, tenant_ids, db, writing=True)

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
