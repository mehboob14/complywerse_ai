from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from pydantic import BaseModel

from ....models import (
    CCMRule, CCMAnomaly, CCMException, AuditFinding,
    InternalControl, GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/ccm", tags=["Audit - Continuous Control Monitoring"])


class CCMRuleCreate(BaseModel):
    rule_code: str
    name: str
    description: Optional[str] = None
    control_area: str
    control_id: Optional[int] = None
    rule_type: Optional[str] = "threshold"
    threshold_value: Optional[float] = None
    threshold_operator: Optional[str] = None
    severity: Optional[str] = "medium"
    parameters: Optional[dict] = {}


class CCMRuleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    control_area: Optional[str] = None
    rule_type: Optional[str] = None
    threshold_value: Optional[float] = None
    threshold_operator: Optional[str] = None
    severity: Optional[str] = None
    is_active: Optional[bool] = None
    parameters: Optional[dict] = None


class AnomalyCreate(BaseModel):
    rule_id: int
    title: str
    description: Optional[str] = None
    severity: Optional[str] = "medium"
    transaction_ref: Optional[str] = None
    transaction_amount: Optional[float] = None
    control_area: Optional[str] = None
    metadata_json: Optional[dict] = {}


class ExceptionDecision(BaseModel):
    decision: str
    decision_notes: Optional[str] = None
    escalate_to_id: Optional[int] = None
    create_finding: Optional[bool] = False
    engagement_id: Optional[int] = None


def serialize_rule(r: CCMRule) -> dict:
    return {
        "id": r.id,
        "tenant_id": r.tenant_id,
        "rule_code": r.rule_code,
        "name": r.name,
        "description": r.description,
        "control_area": r.control_area,
        "control_id": r.control_id,
        "rule_type": r.rule_type,
        "threshold_value": r.threshold_value,
        "threshold_operator": r.threshold_operator,
        "severity": r.severity,
        "is_active": r.is_active,
        "parameters": r.parameters,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def serialize_anomaly(a: CCMAnomaly) -> dict:
    exceptions = []
    if a.exceptions:
        for ex in a.exceptions:
            exceptions.append({
                "id": ex.id,
                "workflow_status": ex.workflow_status,
                "assigned_to_id": ex.assigned_to_id,
                "reviewed_by_id": ex.reviewed_by_id,
                "reviewed_at": ex.reviewed_at.isoformat() if ex.reviewed_at else None,
                "decision": ex.decision,
                "decision_notes": ex.decision_notes,
                "escalated_to_id": ex.escalated_to_id,
                "finding_id": ex.finding_id,
                "closed_at": ex.closed_at.isoformat() if ex.closed_at else None,
            })
    
    return {
        "id": a.id,
        "tenant_id": a.tenant_id,
        "rule_id": a.rule_id,
        "rule_code": a.rule.rule_code if a.rule else None,
        "rule_name": a.rule.name if a.rule else None,
        "title": a.title,
        "description": a.description,
        "severity": a.severity,
        "detected_at": a.detected_at.isoformat() if a.detected_at else None,
        "transaction_ref": a.transaction_ref,
        "transaction_amount": a.transaction_amount,
        "control_area": a.control_area,
        "is_false_positive": a.is_false_positive,
        "false_positive_reason": a.false_positive_reason,
        "status": a.status,
        "exceptions": exceptions,
    }


@router.get("/rules")
def list_ccm_rules(
    control_area: Optional[str] = None,
    is_active: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"rules": [], "total": 0}
    
    query = db.query(CCMRule).filter(CCMRule.tenant_id.in_(user_tenants))
    
    if control_area:
        query = query.filter(CCMRule.control_area == control_area)
    if is_active is not None:
        query = query.filter(CCMRule.is_active == is_active)
    
    rules = query.order_by(CCMRule.created_at.desc()).all()
    return {"rules": [serialize_rule(r) for r in rules], "total": len(rules)}


@router.post("/rules", status_code=status.HTTP_201_CREATED)
def create_ccm_rule(
    data: CCMRuleCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant access")
    
    rule = CCMRule(
        tenant_id=tenant_id,
        rule_code=data.rule_code,
        name=data.name,
        description=data.description,
        control_area=data.control_area,
        control_id=data.control_id,
        rule_type=data.rule_type,
        threshold_value=data.threshold_value,
        threshold_operator=data.threshold_operator,
        severity=data.severity,
        parameters=data.parameters or {},
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return serialize_rule(rule)


@router.put("/rules/{rule_id}")
def update_ccm_rule(
    rule_id: int,
    data: CCMRuleUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    rule = db.query(CCMRule).filter(
        CCMRule.id == rule_id,
        CCMRule.tenant_id.in_(user_tenants)
    ).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    
    for field, value in data.dict(exclude_unset=True).items():
        setattr(rule, field, value)
    
    rule.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(rule)
    return serialize_rule(rule)


@router.delete("/rules/{rule_id}")
def delete_ccm_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    rule = db.query(CCMRule).filter(
        CCMRule.id == rule_id,
        CCMRule.tenant_id.in_(user_tenants)
    ).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    
    db.delete(rule)
    db.commit()
    return {"message": "Rule deleted"}


@router.get("/anomalies")
def list_anomalies(
    severity: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    control_area: Optional[str] = None,
    hours: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"anomalies": [], "total": 0, "stats": {}}
    
    query = db.query(CCMAnomaly).options(
        joinedload(CCMAnomaly.rule),
        joinedload(CCMAnomaly.exceptions),
    ).filter(CCMAnomaly.tenant_id.in_(user_tenants))
    
    if severity:
        query = query.filter(CCMAnomaly.severity == severity)
    if status_filter:
        query = query.filter(CCMAnomaly.status == status_filter)
    if control_area:
        query = query.filter(CCMAnomaly.control_area == control_area)
    if hours:
        cutoff = datetime.utcnow() - timedelta(hours=hours)
        query = query.filter(CCMAnomaly.detected_at >= cutoff)
    
    anomalies = query.order_by(CCMAnomaly.detected_at.desc()).all()
    
    total = len(anomalies)
    high_count = sum(1 for a in anomalies if a.severity == "high")
    medium_count = sum(1 for a in anomalies if a.severity == "medium")
    low_count = sum(1 for a in anomalies if a.severity == "low")
    false_positive_count = sum(1 for a in anomalies if a.is_false_positive)
    false_positive_rate = (false_positive_count / total * 100) if total > 0 else 0
    
    return {
        "anomalies": [serialize_anomaly(a) for a in anomalies],
        "total": total,
        "stats": {
            "high_severity": high_count,
            "medium_severity": medium_count,
            "low_severity": low_count,
            "false_positive_count": false_positive_count,
            "false_positive_rate": round(false_positive_rate, 1),
        }
    }


@router.post("/anomalies", status_code=status.HTTP_201_CREATED)
def create_anomaly(
    data: AnomalyCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant access")
    
    rule = db.query(CCMRule).filter(
        CCMRule.id == data.rule_id,
        CCMRule.tenant_id == tenant_id
    ).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    
    anomaly = CCMAnomaly(
        tenant_id=tenant_id,
        rule_id=data.rule_id,
        title=data.title,
        description=data.description,
        severity=data.severity or rule.severity,
        transaction_ref=data.transaction_ref,
        transaction_amount=data.transaction_amount,
        control_area=data.control_area or rule.control_area,
        metadata_json=data.metadata_json or {},
    )
    db.add(anomaly)
    db.commit()
    db.refresh(anomaly)
    
    exception = CCMException(
        anomaly_id=anomaly.id,
        workflow_status="flagged",
    )
    db.add(exception)
    db.commit()
    
    return serialize_anomaly(anomaly)


@router.post("/anomalies/{anomaly_id}/review")
def review_anomaly(
    anomaly_id: int,
    data: ExceptionDecision,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    anomaly = db.query(CCMAnomaly).options(
        joinedload(CCMAnomaly.exceptions)
    ).filter(
        CCMAnomaly.id == anomaly_id,
        CCMAnomaly.tenant_id.in_(user_tenants)
    ).first()
    if not anomaly:
        raise HTTPException(status_code=404, detail="Anomaly not found")
    
    exception = anomaly.exceptions[0] if anomaly.exceptions else None
    if not exception:
        exception = CCMException(anomaly_id=anomaly_id, workflow_status="flagged")
        db.add(exception)
        db.commit()
        db.refresh(exception)
    
    exception.reviewed_by_id = current_user.id
    exception.reviewed_at = datetime.utcnow()
    exception.decision = data.decision
    exception.decision_notes = data.decision_notes
    
    if data.decision == "false_positive":
        anomaly.is_false_positive = True
        anomaly.false_positive_reason = data.decision_notes
        anomaly.status = "closed"
        exception.workflow_status = "closed"
        exception.closed_at = datetime.utcnow()
    elif data.decision == "accept":
        anomaly.status = "accepted"
        exception.workflow_status = "closed"
        exception.closed_at = datetime.utcnow()
    elif data.decision == "escalate":
        anomaly.status = "escalated"
        exception.workflow_status = "escalated"
        exception.escalated_to_id = data.escalate_to_id
        exception.escalated_at = datetime.utcnow()
    elif data.decision == "create_finding":
        anomaly.status = "finding_created"
        exception.workflow_status = "closed"
        exception.closed_at = datetime.utcnow()
        
        if data.engagement_id:
            finding = AuditFinding(
                tenant_id=anomaly.tenant_id,
                engagement_id=data.engagement_id,
                title=f"CCM Alert: {anomaly.title}",
                condition=anomaly.description,
                criteria=f"CCM Rule: {anomaly.rule.name}" if anomaly.rule else "CCM Rule Violation",
                severity=anomaly.severity,
                status="open",
                framework_mappings=[],
            )
            db.add(finding)
            db.commit()
            db.refresh(finding)
            exception.finding_id = finding.id
    
    db.commit()
    return {"message": f"Anomaly reviewed with decision: {data.decision}"}


@router.get("/stats")
def get_ccm_stats(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"stats": {}}
    
    today = datetime.utcnow().date()
    today_start = datetime.combine(today, datetime.min.time())
    
    total_rules = db.query(func.count(CCMRule.id)).filter(
        CCMRule.tenant_id.in_(user_tenants),
        CCMRule.is_active == True
    ).scalar() or 0
    
    total_anomalies = db.query(func.count(CCMAnomaly.id)).filter(
        CCMAnomaly.tenant_id.in_(user_tenants)
    ).scalar() or 0
    
    today_anomalies = db.query(func.count(CCMAnomaly.id)).filter(
        CCMAnomaly.tenant_id.in_(user_tenants),
        CCMAnomaly.detected_at >= today_start
    ).scalar() or 0
    
    high_severity_active = db.query(func.count(CCMAnomaly.id)).filter(
        CCMAnomaly.tenant_id.in_(user_tenants),
        CCMAnomaly.severity == "high",
        CCMAnomaly.status.in_(["flagged", "escalated"])
    ).scalar() or 0
    
    false_positives = db.query(func.count(CCMAnomaly.id)).filter(
        CCMAnomaly.tenant_id.in_(user_tenants),
        CCMAnomaly.is_false_positive == True
    ).scalar() or 0
    
    fp_rate = (false_positives / total_anomalies * 100) if total_anomalies > 0 else 0
    
    return {
        "stats": {
            "active_rules": total_rules,
            "total_anomalies": total_anomalies,
            "today_anomalies": today_anomalies,
            "high_severity_active": high_severity_active,
            "false_positive_count": false_positives,
            "false_positive_rate": round(fp_rate, 1),
        }
    }
