import os
import json
import logging
from typing import Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_, case, extract

from ..models import (
    Risk, RiskScoreHistory, RiskAppetiteConfig, RiskMitigationAction,
    RiskIncident, RiskKRI, RiskKRIMeasurement,
    InternalControl, InternalControlTest,
    Evidence, EvidenceControlMapping,
    GovernanceDocument, PolicyException, PolicyAttestation,
    AttestationCampaign, AttestationRequest,
    RegulatoryChange, RegulatoryImpactAssessment, RegulatoryImplementationTask,
    RegulatoryFeedItem, RegulatoryFeedSource,
    UploadedFramework, ParsedFrameworkControl,
    CertificationJourney, ControlImplementation,
    FrameworkControl, Framework,
    get_db
)
from .auth_router import require_auth, get_user_tenants

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/enriched-dashboard", tags=["Enriched Dashboard"])


@router.get("/executive/risk-velocity")
def get_risk_velocity(
    days: int = Query(90, ge=7, le=365),
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    cutoff = datetime.utcnow() - timedelta(days=days)

    history = db.query(
        func.date(RiskScoreHistory.recorded_at).label("date"),
        func.avg(RiskScoreHistory.inherent_score).label("avg_inherent"),
        func.avg(RiskScoreHistory.residual_score).label("avg_residual"),
        func.count(RiskScoreHistory.id).label("changes")
    ).join(
        Risk, RiskScoreHistory.risk_id == Risk.id
    ).filter(
        Risk.tenant_id.in_(user_tenants),
        RiskScoreHistory.recorded_at >= cutoff
    ).group_by(
        func.date(RiskScoreHistory.recorded_at)
    ).order_by(
        func.date(RiskScoreHistory.recorded_at)
    ).all()

    risks = db.query(Risk).filter(Risk.tenant_id.in_(user_tenants)).all()
    current_avg = sum(r.residual_score or 0 for r in risks) / max(len(risks), 1)

    old_history = db.query(
        func.avg(RiskScoreHistory.residual_score)
    ).join(Risk, RiskScoreHistory.risk_id == Risk.id).filter(
        Risk.tenant_id.in_(user_tenants),
        RiskScoreHistory.recorded_at < cutoff,
        RiskScoreHistory.recorded_at >= cutoff - timedelta(days=days)
    ).scalar() or current_avg

    velocity = round(current_avg - (old_history or 0), 2)

    return {
        "velocity_score": velocity,
        "velocity_direction": "increasing" if velocity > 0 else "decreasing" if velocity < 0 else "stable",
        "current_avg_residual": round(current_avg, 2),
        "period_days": days,
        "trend_data": [
            {
                "date": str(h.date),
                "avg_inherent": round(float(h.avg_inherent or 0), 2),
                "avg_residual": round(float(h.avg_residual or 0), 2),
                "changes": h.changes
            }
            for h in history
        ]
    }


@router.get("/executive/risk-appetite-gauge")
def get_risk_appetite_gauge(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    configs = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.tenant_id.in_(user_tenants)
    ).all()

    risks = db.query(Risk).filter(
        Risk.tenant_id.in_(user_tenants),
        Risk.status != "closed"
    ).all()

    categories = {}
    for r in risks:
        cat = r.category or "uncategorized"
        if cat not in categories:
            categories[cat] = {"scores": [], "count": 0}
        categories[cat]["scores"].append(r.residual_score or 0)
        categories[cat]["count"] += 1

    gauges = []
    breaches = 0
    for cfg in configs:
        cat_data = categories.get(cfg.category, {"scores": [], "count": 0})
        avg_score = sum(cat_data["scores"]) / max(len(cat_data["scores"]), 1)
        max_score = max(cat_data["scores"]) if cat_data["scores"] else 0
        is_breached = avg_score > cfg.max_acceptable_score
        if is_breached:
            breaches += 1
        gauges.append({
            "category": cfg.category,
            "appetite_level": cfg.appetite_level,
            "max_acceptable_score": cfg.max_acceptable_score,
            "tolerance_threshold": cfg.tolerance_threshold,
            "current_avg_score": round(avg_score, 2),
            "current_max_score": round(max_score, 2),
            "risk_count": cat_data["count"],
            "is_breached": is_breached,
            "utilization_pct": round((avg_score / cfg.max_acceptable_score * 100) if cfg.max_acceptable_score else 0, 1)
        })

    return {
        "gauges": gauges,
        "total_categories": len(configs),
        "breached_categories": breaches,
        "overall_health": "critical" if breaches > len(configs) / 2 else "warning" if breaches > 0 else "healthy"
    }


@router.get("/executive/emerging-risks")
def get_emerging_risks(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    cutoff = datetime.utcnow() - timedelta(days=90)

    risks = db.query(Risk).filter(
        Risk.tenant_id.in_(user_tenants),
        Risk.status != "closed"
    ).all()

    emerging = []
    for risk in risks:
        latest = db.query(RiskScoreHistory).filter(
            RiskScoreHistory.risk_id == risk.id,
            RiskScoreHistory.recorded_at >= cutoff
        ).order_by(RiskScoreHistory.recorded_at.desc()).first()

        oldest = db.query(RiskScoreHistory).filter(
            RiskScoreHistory.risk_id == risk.id,
            RiskScoreHistory.recorded_at >= cutoff
        ).order_by(RiskScoreHistory.recorded_at.asc()).first()

        if latest and oldest and latest.residual_score and oldest.residual_score:
            score_change = (latest.residual_score or 0) - (oldest.residual_score or 0)
        else:
            score_change = 0

        emerging.append({
            "id": risk.id,
            "title": risk.title,
            "category": risk.category,
            "current_score": risk.residual_score or 0,
            "inherent_score": risk.inherent_score or 0,
            "score_change_90d": round(score_change, 2),
            "status": risk.status,
            "treatment_plan": risk.treatment_plan
        })

    emerging.sort(key=lambda x: x["score_change_90d"], reverse=True)
    return {"emerging_risks": emerging[:10], "total_risks_analyzed": len(risks)}


@router.get("/executive/risk-concentration")
def get_risk_concentration(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    risks = db.query(Risk).filter(
        Risk.tenant_id.in_(user_tenants),
        Risk.status != "closed"
    ).all()

    by_category = {}
    by_score = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    total = len(risks)

    for r in risks:
        cat = r.category or "uncategorized"
        by_category[cat] = by_category.get(cat, 0) + 1
        score = r.residual_score or 0
        if score >= 20:
            by_score["critical"] += 1
        elif score >= 15:
            by_score["high"] += 1
        elif score >= 8:
            by_score["medium"] += 1
        else:
            by_score["low"] += 1

    max_concentration = max(by_category.values()) / total * 100 if total > 0 else 0
    num_categories = len(by_category)
    ideal_pct = 100 / num_categories if num_categories > 0 else 100
    concentration_index = round(max_concentration / ideal_pct, 2) if ideal_pct > 0 else 1

    return {
        "by_category": [{"category": k, "count": v, "percentage": round(v / total * 100, 1) if total > 0 else 0} for k, v in sorted(by_category.items(), key=lambda x: x[1], reverse=True)],
        "by_severity": by_score,
        "total_risks": total,
        "concentration_index": concentration_index,
        "most_concentrated": max(by_category, key=by_category.get) if by_category else None,
        "diversification": "well_diversified" if concentration_index < 1.5 else "moderately_concentrated" if concentration_index < 2.5 else "highly_concentrated"
    }


@router.get("/executive/board-readiness")
def get_board_readiness(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    risks = db.query(Risk).filter(
        Risk.tenant_id.in_(user_tenants),
        Risk.status != "closed"
    ).all()

    total = len(risks)
    with_treatment = sum(1 for r in risks if r.treatment_plan and r.treatment_plan.strip())
    with_owner = sum(1 for r in risks if r.owner_id)

    actions = db.query(RiskMitigationAction).join(
        Risk, RiskMitigationAction.risk_id == Risk.id
    ).filter(Risk.tenant_id.in_(user_tenants)).all()

    risks_with_actions = len(set(a.risk_id for a in actions))
    completed_actions = sum(1 for a in actions if a.status == "completed")
    total_actions = len(actions)

    treatment_score = (with_treatment / total * 100) if total > 0 else 0
    ownership_score = (with_owner / total * 100) if total > 0 else 0
    action_score = (risks_with_actions / total * 100) if total > 0 else 0
    completion_score = (completed_actions / total_actions * 100) if total_actions > 0 else 0

    board_readiness = round((treatment_score * 0.3 + ownership_score * 0.2 + action_score * 0.3 + completion_score * 0.2), 1)

    return {
        "board_readiness_score": board_readiness,
        "components": {
            "treatment_plans": {"score": round(treatment_score, 1), "with_plan": with_treatment, "total": total},
            "risk_ownership": {"score": round(ownership_score, 1), "with_owner": with_owner, "total": total},
            "mitigation_actions": {"score": round(action_score, 1), "risks_with_actions": risks_with_actions, "total": total},
            "action_completion": {"score": round(completion_score, 1), "completed": completed_actions, "total": total_actions}
        },
        "readiness_level": "excellent" if board_readiness >= 80 else "good" if board_readiness >= 60 else "needs_improvement" if board_readiness >= 40 else "critical"
    }


@router.get("/executive/summary")
def get_executive_summary(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    risks = db.query(Risk).filter(Risk.tenant_id.in_(user_tenants), Risk.status != "closed").all()
    incidents = db.query(RiskIncident).filter(RiskIncident.tenant_id.in_(user_tenants)).all()
    recent_incidents = [i for i in incidents if i.created_at and i.created_at >= datetime.utcnow() - timedelta(days=30)]

    total_risks = len(risks)
    critical_risks = sum(1 for r in risks if (r.residual_score or 0) >= 20)
    high_risks = sum(1 for r in risks if 15 <= (r.residual_score or 0) < 20)
    avg_residual = round(sum(r.residual_score or 0 for r in risks) / max(total_risks, 1), 1)
    avg_inherent = round(sum(r.inherent_score or 0 for r in risks) / max(total_risks, 1), 1)
    risk_reduction_pct = round((1 - avg_residual / avg_inherent) * 100, 1) if avg_inherent > 0 else 0

    total_financial_impact = sum(i.financial_impact or 0 for i in incidents)

    configs = db.query(RiskAppetiteConfig).filter(RiskAppetiteConfig.tenant_id.in_(user_tenants)).all()
    appetite_breaches = 0
    for cfg in configs:
        cat_risks = [r for r in risks if r.category == cfg.category]
        if cat_risks:
            avg = sum(r.residual_score or 0 for r in cat_risks) / len(cat_risks)
            if avg > cfg.max_acceptable_score:
                appetite_breaches += 1

    return {
        "total_risks": total_risks,
        "critical_risks": critical_risks,
        "high_risks": high_risks,
        "avg_inherent_score": avg_inherent,
        "avg_residual_score": avg_residual,
        "risk_reduction_pct": risk_reduction_pct,
        "recent_incidents_30d": len(recent_incidents),
        "total_financial_impact": total_financial_impact,
        "appetite_breaches": appetite_breaches,
        "total_appetite_categories": len(configs),
        "overall_risk_posture": "critical" if critical_risks > 5 or appetite_breaches > 2 else "elevated" if critical_risks > 2 or appetite_breaches > 0 else "moderate" if high_risks > 5 else "healthy"
    }


@router.get("/compliance-health/posture")
def get_compliance_posture(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    journeys = db.query(CertificationJourney).filter(
        CertificationJourney.tenant_id.in_(user_tenants)
    ).all()

    frameworks = []
    total_score = 0
    for j in journeys:
        fw = db.query(UploadedFramework).filter(UploadedFramework.id == j.uploaded_framework_id).first() if hasattr(j, 'uploaded_framework_id') and j.uploaded_framework_id else None
        controls_total = db.query(func.count(ParsedFrameworkControl.id)).filter(
            ParsedFrameworkControl.uploaded_framework_id == j.uploaded_framework_id
        ).scalar() if fw else 0

        impls = db.query(ControlImplementation).filter(
            ControlImplementation.journey_id == j.id
        ).all() if hasattr(ControlImplementation, 'journey_id') else []

        implemented = sum(1 for i in impls if i.status in ("implemented", "verified"))
        score = round(implemented / controls_total * 100, 1) if controls_total > 0 else 0
        total_score += score

        frameworks.append({
            "journey_id": j.id,
            "framework_name": fw.name if fw else j.name if hasattr(j, 'name') else f"Framework {j.id}",
            "total_controls": controls_total,
            "implemented_controls": implemented,
            "compliance_score": score,
            "status": j.status if hasattr(j, 'status') else "active"
        })

    overall = round(total_score / max(len(frameworks), 1), 1)

    return {
        "overall_posture_score": overall,
        "posture_level": "strong" if overall >= 80 else "moderate" if overall >= 60 else "weak" if overall >= 40 else "critical",
        "frameworks": frameworks,
        "total_frameworks": len(frameworks)
    }


@router.get("/compliance-health/control-effectiveness")
def get_control_effectiveness(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    controls = db.query(InternalControl).filter(
        InternalControl.tenant_id.in_(user_tenants),
        InternalControl.status == "active"
    ).all()

    total = len(controls)
    by_design = {"effective": 0, "partially_effective": 0, "ineffective": 0, "not_tested": 0}
    by_operating = {"effective": 0, "partially_effective": 0, "ineffective": 0, "not_tested": 0}
    by_type = {}
    by_nature = {}

    for c in controls:
        d = c.design_effectiveness or "not_tested"
        o = c.operating_effectiveness or "not_tested"
        by_design[d] = by_design.get(d, 0) + 1
        by_operating[o] = by_operating.get(o, 0) + 1

        ct = c.control_type or "unknown"
        if ct not in by_type:
            by_type[ct] = {"total": 0, "effective": 0}
        by_type[ct]["total"] += 1
        if d == "effective" and o == "effective":
            by_type[ct]["effective"] += 1

        cn = c.control_nature or "unknown"
        if cn not in by_nature:
            by_nature[cn] = {"total": 0, "effective": 0}
        by_nature[cn]["total"] += 1
        if d == "effective" and o == "effective":
            by_nature[cn]["effective"] += 1

    design_effective_pct = round(by_design["effective"] / total * 100, 1) if total > 0 else 0
    operating_effective_pct = round(by_operating["effective"] / total * 100, 1) if total > 0 else 0
    overall_rate = round((design_effective_pct + operating_effective_pct) / 2, 1)

    return {
        "overall_effectiveness_rate": overall_rate,
        "total_controls": total,
        "design_effectiveness": by_design,
        "operating_effectiveness": by_operating,
        "by_control_type": {k: {"total": v["total"], "effective": v["effective"], "rate": round(v["effective"] / v["total"] * 100, 1) if v["total"] > 0 else 0} for k, v in by_type.items()},
        "by_control_nature": {k: {"total": v["total"], "effective": v["effective"], "rate": round(v["effective"] / v["total"] * 100, 1) if v["total"] > 0 else 0} for k, v in by_nature.items()},
        "key_controls_effective": sum(1 for c in controls if c.is_key_control and c.design_effectiveness == "effective" and c.operating_effectiveness == "effective"),
        "total_key_controls": sum(1 for c in controls if c.is_key_control)
    }


@router.get("/compliance-health/audit-readiness")
def get_audit_readiness(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    evidence_count = db.query(func.count(Evidence.id)).filter(
        Evidence.tenant_id.in_(user_tenants)
    ).scalar() or 0

    controls = db.query(InternalControl).filter(
        InternalControl.tenant_id.in_(user_tenants),
        InternalControl.status == "active"
    ).all()

    tested = sum(1 for c in controls if c.last_tested_at)
    total_controls = len(controls)

    recent_tests = db.query(InternalControlTest).filter(
        InternalControlTest.tenant_id.in_(user_tenants),
        InternalControlTest.test_date >= datetime.utcnow() - timedelta(days=365)
    ).all()

    tests_passed = sum(1 for t in recent_tests if t.result == "effective")
    tests_total = len(recent_tests)

    evidence_score = min(evidence_count / max(total_controls, 1) * 50, 50)
    testing_score = (tested / total_controls * 25) if total_controls > 0 else 0
    pass_score = (tests_passed / tests_total * 25) if tests_total > 0 else 0

    audit_readiness = round(evidence_score + testing_score + pass_score, 1)

    return {
        "audit_readiness_score": min(audit_readiness, 100),
        "components": {
            "evidence_coverage": {"score": round(evidence_score, 1), "evidence_count": evidence_count, "controls_needing_evidence": total_controls},
            "testing_coverage": {"score": round(testing_score, 1), "tested": tested, "total": total_controls},
            "test_pass_rate": {"score": round(pass_score, 1), "passed": tests_passed, "total": tests_total}
        },
        "readiness_level": "audit_ready" if audit_readiness >= 80 else "nearly_ready" if audit_readiness >= 60 else "preparation_needed" if audit_readiness >= 40 else "significant_gaps"
    }


@router.get("/compliance-health/attestation-status")
def get_attestation_status(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    campaigns = db.query(AttestationCampaign).filter(
        AttestationCampaign.tenant_id.in_(user_tenants)
    ).all()

    active_campaigns = [c for c in campaigns if c.status == "active"]
    now = datetime.utcnow()

    campaign_data = []
    total_pending = 0
    total_completed = 0
    total_overdue = 0

    for c in active_campaigns:
        requests = db.query(AttestationRequest).filter(
            AttestationRequest.campaign_id == c.id
        ).all()
        completed = sum(1 for r in requests if r.status == "completed")
        pending = sum(1 for r in requests if r.status == "pending")
        overdue = sum(1 for r in requests if r.status == "pending" and c.due_date and c.due_date < now)

        total_pending += pending
        total_completed += completed
        total_overdue += overdue

        campaign_data.append({
            "id": c.id,
            "name": c.name,
            "campaign_type": c.campaign_type,
            "due_date": c.due_date.isoformat() if c.due_date else None,
            "total_requests": len(requests),
            "completed": completed,
            "pending": pending,
            "overdue": overdue,
            "completion_rate": round(completed / len(requests) * 100, 1) if requests else 0
        })

    attestations = db.query(PolicyAttestation).filter(
        PolicyAttestation.tenant_id.in_(user_tenants)
    ).all()

    acknowledged = sum(1 for a in attestations if a.attestation_type == "acknowledgment")

    return {
        "active_campaigns": len(active_campaigns),
        "total_pending": total_pending,
        "total_completed": total_completed,
        "total_overdue": total_overdue,
        "overall_completion_rate": round(total_completed / (total_completed + total_pending) * 100, 1) if (total_completed + total_pending) > 0 else 0,
        "campaigns": campaign_data,
        "policy_acknowledgments": acknowledged
    }


@router.get("/compliance-health/exception-aging")
def get_exception_aging(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    exceptions = db.query(PolicyException).filter(
        PolicyException.tenant_id.in_(user_tenants),
        PolicyException.status.in_(["pending", "approved"])
    ).all()

    now = datetime.utcnow()
    aging = {"0_30": 0, "31_60": 0, "61_90": 0, "90_plus": 0}
    by_priority = {}
    by_status = {}

    for e in exceptions:
        age = (now - e.requested_at).days if e.requested_at else 0
        if age <= 30:
            aging["0_30"] += 1
        elif age <= 60:
            aging["31_60"] += 1
        elif age <= 90:
            aging["61_90"] += 1
        else:
            aging["90_plus"] += 1

        p = e.priority or "medium"
        by_priority[p] = by_priority.get(p, 0) + 1
        s = e.status
        by_status[s] = by_status.get(s, 0) + 1

    expiring_soon = sum(1 for e in exceptions if e.status == "approved" and hasattr(e, 'expiry_date') and e.expiry_date and e.expiry_date <= now + timedelta(days=30))

    return {
        "total_active_exceptions": len(exceptions),
        "aging_buckets": aging,
        "by_priority": by_priority,
        "by_status": by_status,
        "expiring_within_30_days": expiring_soon,
        "avg_age_days": round(sum((now - e.requested_at).days for e in exceptions if e.requested_at) / max(len(exceptions), 1), 1)
    }


@router.get("/compliance-health/evidence-status")
def get_evidence_status(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    evidence = db.query(Evidence).filter(
        Evidence.tenant_id.in_(user_tenants)
    ).all()

    total = len(evidence)
    by_status = {}
    recent_30d = 0
    now = datetime.utcnow()

    for e in evidence:
        s = e.status if hasattr(e, 'status') and e.status else "uploaded"
        by_status[s] = by_status.get(s, 0) + 1
        if hasattr(e, 'created_at') and e.created_at and e.created_at >= now - timedelta(days=30):
            recent_30d += 1

    mappings = db.query(EvidenceControlMapping).all()
    mapped_evidence_ids = set(m.evidence_id for m in mappings)
    mapped_count = sum(1 for e in evidence if e.id in mapped_evidence_ids)

    return {
        "total_evidence": total,
        "by_status": by_status,
        "mapped_to_controls": mapped_count,
        "unmapped": total - mapped_count,
        "mapping_rate": round(mapped_count / total * 100, 1) if total > 0 else 0,
        "collected_last_30d": recent_30d,
        "collection_velocity": round(recent_30d / 30, 1)
    }


@router.get("/treatment/portfolio")
def get_treatment_portfolio(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    actions = db.query(RiskMitigationAction).join(
        Risk, RiskMitigationAction.risk_id == Risk.id
    ).filter(Risk.tenant_id.in_(user_tenants)).all()

    risks = db.query(Risk).filter(Risk.tenant_id.in_(user_tenants)).all()
    risk_map = {r.id: r for r in risks}

    portfolio = []
    for a in actions:
        risk = risk_map.get(a.risk_id)
        portfolio.append({
            "id": a.id,
            "title": a.title,
            "action_type": a.action_type,
            "status": a.status,
            "priority": a.priority,
            "due_date": a.due_date.isoformat() if a.due_date else None,
            "risk_title": risk.title if risk else None,
            "risk_inherent_score": risk.inherent_score if risk else None,
            "risk_residual_score": risk.residual_score if risk else None,
            "expected_reduction": a.expected_residual_reduction,
            "actual_reduction": a.actual_residual_reduction,
            "effectiveness": round((a.actual_residual_reduction or 0) / (a.expected_residual_reduction or 1) * 100, 1) if a.expected_residual_reduction else None
        })

    return {
        "total_actions": len(actions),
        "portfolio": portfolio[:50]
    }


@router.get("/treatment/effectiveness")
def get_treatment_effectiveness(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    actions = db.query(RiskMitigationAction).join(
        Risk, RiskMitigationAction.risk_id == Risk.id
    ).filter(Risk.tenant_id.in_(user_tenants)).all()

    completed = [a for a in actions if a.status == "completed"]
    with_data = [a for a in completed if a.expected_residual_reduction and a.actual_residual_reduction]

    scatter_data = []
    for a in with_data:
        scatter_data.append({
            "id": a.id,
            "title": a.title,
            "expected": a.expected_residual_reduction,
            "actual": a.actual_residual_reduction,
            "effectiveness_pct": round(a.actual_residual_reduction / a.expected_residual_reduction * 100, 1) if a.expected_residual_reduction else 0
        })

    avg_effectiveness = round(sum(d["effectiveness_pct"] for d in scatter_data) / max(len(scatter_data), 1), 1) if scatter_data else 0

    risks = db.query(Risk).filter(Risk.tenant_id.in_(user_tenants)).all()
    total_inherent = sum(r.inherent_score or 0 for r in risks)
    total_residual = sum(r.residual_score or 0 for r in risks)
    overall_reduction = round(total_inherent - total_residual, 1)

    return {
        "avg_effectiveness_pct": avg_effectiveness,
        "completed_actions": len(completed),
        "actions_with_data": len(with_data),
        "total_risk_reduction": overall_reduction,
        "scatter_data": scatter_data
    }


@router.get("/treatment/strategy-mix")
def get_treatment_strategy_mix(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    risks = db.query(Risk).filter(
        Risk.tenant_id.in_(user_tenants),
        Risk.status != "closed"
    ).all()

    strategy = {}
    for r in risks:
        tp = r.treatment_plan or "not_specified"
        strategy[tp] = strategy.get(tp, 0) + 1

    actions = db.query(RiskMitigationAction).join(
        Risk, RiskMitigationAction.risk_id == Risk.id
    ).filter(Risk.tenant_id.in_(user_tenants)).all()

    action_types = {}
    for a in actions:
        at = a.action_type or "mitigate"
        action_types[at] = action_types.get(at, 0) + 1

    total = len(risks)
    return {
        "risk_treatment_strategies": [{"strategy": k, "count": v, "percentage": round(v / total * 100, 1) if total > 0 else 0} for k, v in sorted(strategy.items(), key=lambda x: x[1], reverse=True)],
        "action_types": [{"type": k, "count": v} for k, v in sorted(action_types.items(), key=lambda x: x[1], reverse=True)],
        "total_risks": total,
        "total_actions": len(actions)
    }


@router.get("/treatment/action-velocity")
def get_action_velocity(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    actions = db.query(RiskMitigationAction).join(
        Risk, RiskMitigationAction.risk_id == Risk.id
    ).filter(Risk.tenant_id.in_(user_tenants)).all()

    completed = [a for a in actions if a.status == "completed" and a.completed_at and a.created_at]
    durations = [(a.completed_at - a.created_at).days for a in completed]
    avg_days = round(sum(durations) / max(len(durations), 1), 1) if durations else 0

    now = datetime.utcnow()
    overdue = sum(1 for a in actions if a.status not in ("completed", "cancelled") and a.due_date and a.due_date < now)
    on_track = sum(1 for a in actions if a.status not in ("completed", "cancelled") and a.due_date and a.due_date >= now)

    by_status = {}
    for a in actions:
        s = a.status or "open"
        by_status[s] = by_status.get(s, 0) + 1

    return {
        "avg_completion_days": avg_days,
        "completed_actions": len(completed),
        "overdue_actions": overdue,
        "on_track_actions": on_track,
        "by_status": by_status,
        "total_actions": len(actions)
    }


@router.get("/treatment/burndown")
def get_treatment_burndown(
    months: int = Query(6, ge=1, le=24),
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    actions = db.query(RiskMitigationAction).join(
        Risk, RiskMitigationAction.risk_id == Risk.id
    ).filter(Risk.tenant_id.in_(user_tenants)).all()

    now = datetime.utcnow()
    burndown = []

    for i in range(months, -1, -1):
        month_date = now - timedelta(days=i * 30)
        month_str = month_date.strftime("%Y-%m")
        remaining = sum(1 for a in actions if a.status not in ("completed", "cancelled") or (a.completed_at and a.completed_at > month_date))
        completed_by = sum(1 for a in actions if a.status == "completed" and a.completed_at and a.completed_at <= month_date)
        burndown.append({"month": month_str, "remaining": remaining, "completed_cumulative": completed_by})

    return {"burndown": burndown, "total_actions": len(actions)}


@router.get("/incidents/summary")
def get_incident_summary(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    incidents = db.query(RiskIncident).filter(
        RiskIncident.tenant_id.in_(user_tenants)
    ).all()

    total = len(incidents)
    by_severity = {}
    by_status = {}
    total_financial = 0
    now = datetime.utcnow()
    last_30d = 0
    last_90d = 0

    for i in incidents:
        sev = i.severity or "medium"
        by_severity[sev] = by_severity.get(sev, 0) + 1
        st = i.status or "open"
        by_status[st] = by_status.get(st, 0) + 1
        total_financial += i.financial_impact or 0
        if i.created_at and i.created_at >= now - timedelta(days=30):
            last_30d += 1
        if i.created_at and i.created_at >= now - timedelta(days=90):
            last_90d += 1

    return {
        "total_incidents": total,
        "by_severity": by_severity,
        "by_status": by_status,
        "total_financial_impact": total_financial,
        "incidents_last_30d": last_30d,
        "incidents_last_90d": last_90d,
        "avg_financial_impact": round(total_financial / total, 2) if total > 0 else 0
    }


@router.get("/incidents/response-times")
def get_incident_response_times(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    incidents = db.query(RiskIncident).filter(
        RiskIncident.tenant_id.in_(user_tenants)
    ).all()

    detect_times = []
    resolve_times = []

    for i in incidents:
        if i.incident_date and i.discovered_date:
            mttd = (i.discovered_date - i.incident_date).total_seconds() / 3600
            if mttd >= 0:
                detect_times.append(mttd)
        if i.incident_date and i.resolved_at:
            mttr = (i.resolved_at - i.incident_date).total_seconds() / 3600
            if mttr >= 0:
                resolve_times.append(mttr)

    avg_mttd = round(sum(detect_times) / max(len(detect_times), 1), 1) if detect_times else 0
    avg_mttr = round(sum(resolve_times) / max(len(resolve_times), 1), 1) if resolve_times else 0

    by_severity = {}
    for i in incidents:
        sev = i.severity or "medium"
        if sev not in by_severity:
            by_severity[sev] = {"mttd_hours": [], "mttr_hours": []}
        if i.incident_date and i.discovered_date:
            by_severity[sev]["mttd_hours"].append((i.discovered_date - i.incident_date).total_seconds() / 3600)
        if i.incident_date and i.resolved_at:
            by_severity[sev]["mttr_hours"].append((i.resolved_at - i.incident_date).total_seconds() / 3600)

    severity_metrics = {}
    for sev, data in by_severity.items():
        severity_metrics[sev] = {
            "avg_mttd_hours": round(sum(data["mttd_hours"]) / max(len(data["mttd_hours"]), 1), 1) if data["mttd_hours"] else 0,
            "avg_mttr_hours": round(sum(data["mttr_hours"]) / max(len(data["mttr_hours"]), 1), 1) if data["mttr_hours"] else 0
        }

    return {
        "avg_mttd_hours": avg_mttd,
        "avg_mttr_hours": avg_mttr,
        "incidents_analyzed": len(incidents),
        "by_severity": severity_metrics,
        "funnel": [
            {"stage": "Detection (MTTD)", "avg_hours": avg_mttd},
            {"stage": "Response", "avg_hours": round(avg_mttr * 0.3, 1)},
            {"stage": "Resolution (MTTR)", "avg_hours": avg_mttr}
        ]
    }


@router.get("/incidents/root-causes")
def get_incident_root_causes(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    incidents = db.query(RiskIncident).filter(
        RiskIncident.tenant_id.in_(user_tenants)
    ).all()

    causes = {}
    for i in incidents:
        rc = i.root_cause or "Unknown"
        rc_key = rc.strip()[:100] if rc else "Unknown"
        if rc_key not in causes:
            causes[rc_key] = {"count": 0, "financial_impact": 0, "severities": []}
        causes[rc_key]["count"] += 1
        causes[rc_key]["financial_impact"] += i.financial_impact or 0
        causes[rc_key]["severities"].append(i.severity or "medium")

    sorted_causes = sorted(causes.items(), key=lambda x: x[1]["count"], reverse=True)
    total = len(incidents)
    cumulative = 0
    pareto = []
    for cause, data in sorted_causes:
        cumulative += data["count"]
        pareto.append({
            "root_cause": cause,
            "count": data["count"],
            "percentage": round(data["count"] / total * 100, 1) if total > 0 else 0,
            "cumulative_pct": round(cumulative / total * 100, 1) if total > 0 else 0,
            "financial_impact": data["financial_impact"]
        })

    return {"root_causes": pareto[:20], "total_incidents": total}


@router.get("/incidents/trends")
def get_incident_trends(
    months: int = Query(12, ge=1, le=24),
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    incidents = db.query(RiskIncident).filter(
        RiskIncident.tenant_id.in_(user_tenants)
    ).all()

    now = datetime.utcnow()
    trend_data = []
    for i in range(months - 1, -1, -1):
        month_start = (now - timedelta(days=i * 30)).replace(day=1)
        month_end = (month_start + timedelta(days=32)).replace(day=1)
        month_str = month_start.strftime("%Y-%m")

        month_incidents = [inc for inc in incidents if inc.incident_date and month_start <= inc.incident_date < month_end]
        critical = sum(1 for inc in month_incidents if inc.severity == "critical")
        high = sum(1 for inc in month_incidents if inc.severity == "high")
        financial = sum(inc.financial_impact or 0 for inc in month_incidents)

        trend_data.append({
            "month": month_str,
            "total": len(month_incidents),
            "critical": critical,
            "high": high,
            "medium": sum(1 for inc in month_incidents if inc.severity == "medium"),
            "low": sum(1 for inc in month_incidents if inc.severity == "low"),
            "financial_impact": financial
        })

    return {"trends": trend_data, "total_incidents": len(incidents)}


@router.get("/incidents/lessons-learned")
def get_lessons_learned(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    incidents = db.query(RiskIncident).filter(
        RiskIncident.tenant_id.in_(user_tenants)
    ).all()

    with_lessons = [i for i in incidents if i.lessons_learned and i.lessons_learned.strip()]
    with_corrective = [i for i in incidents if i.corrective_actions and i.corrective_actions.strip()]

    resolved = [i for i in incidents if i.status in ("resolved", "closed")]
    resolved_with_lessons = [i for i in resolved if i.lessons_learned and i.lessons_learned.strip()]

    return {
        "total_incidents": len(incidents),
        "with_lessons_learned": len(with_lessons),
        "with_corrective_actions": len(with_corrective),
        "lessons_capture_rate": round(len(with_lessons) / max(len(incidents), 1) * 100, 1),
        "resolved_incidents": len(resolved),
        "resolved_with_lessons": len(resolved_with_lessons),
        "implementation_rate": round(len(resolved_with_lessons) / max(len(resolved), 1) * 100, 1),
        "recent_lessons": [
            {
                "id": i.id,
                "title": i.title,
                "severity": i.severity,
                "lessons_learned": i.lessons_learned[:200] if i.lessons_learned else None,
                "corrective_actions": i.corrective_actions[:200] if i.corrective_actions else None,
                "incident_date": i.incident_date.isoformat() if i.incident_date else None
            }
            for i in sorted(with_lessons, key=lambda x: x.incident_date or datetime.min, reverse=True)[:10]
        ]
    }


@router.get("/controls/testing-summary")
def get_control_testing_summary(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    tests = db.query(InternalControlTest).filter(
        InternalControlTest.tenant_id.in_(user_tenants)
    ).all()

    by_result = {"effective": 0, "partially_effective": 0, "ineffective": 0}
    by_type = {"design": 0, "operating": 0}
    total_exceptions = 0
    monthly = {}

    for t in tests:
        r = t.result or "effective"
        by_result[r] = by_result.get(r, 0) + 1
        tt = t.test_type or "design"
        by_type[tt] = by_type.get(tt, 0) + 1
        total_exceptions += t.exceptions_found or 0

        if t.test_date:
            month = t.test_date.strftime("%Y-%m")
            if month not in monthly:
                monthly[month] = {"effective": 0, "partially_effective": 0, "ineffective": 0, "total": 0}
            monthly[month][r] = monthly[month].get(r, 0) + 1
            monthly[month]["total"] += 1

    sorted_monthly = sorted(monthly.items())
    total = len(tests)

    return {
        "total_tests": total,
        "by_result": by_result,
        "by_type": by_type,
        "pass_rate": round(by_result["effective"] / total * 100, 1) if total > 0 else 0,
        "total_exceptions_found": total_exceptions,
        "monthly_trend": [{"month": k, **v} for k, v in sorted_monthly[-12:]],
        "avg_sample_size": round(sum(t.sample_size or 0 for t in tests) / max(total, 1), 1)
    }


@router.get("/controls/deficiency-tracker")
def get_deficiency_tracker(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    tests = db.query(InternalControlTest).filter(
        InternalControlTest.tenant_id.in_(user_tenants),
        InternalControlTest.result.in_(["partially_effective", "ineffective"])
    ).all()

    controls = db.query(InternalControl).filter(
        InternalControl.tenant_id.in_(user_tenants)
    ).all()
    control_map = {c.id: c for c in controls}

    deficiencies = []
    for t in tests:
        ctrl = control_map.get(t.control_id)
        deficiencies.append({
            "test_id": t.id,
            "control_id": ctrl.control_id if ctrl else None,
            "control_name": ctrl.name if ctrl else None,
            "control_type": ctrl.control_type if ctrl else None,
            "is_key_control": ctrl.is_key_control if ctrl else False,
            "test_type": t.test_type,
            "result": t.result,
            "test_date": t.test_date.isoformat() if t.test_date else None,
            "exceptions_found": t.exceptions_found or 0,
            "findings": t.findings[:200] if t.findings else None,
            "severity": "high" if (ctrl and ctrl.is_key_control) else "medium" if t.result == "ineffective" else "low"
        })

    deficiencies.sort(key=lambda x: {"high": 0, "medium": 1, "low": 2}.get(x["severity"], 3))

    return {
        "total_deficiencies": len(deficiencies),
        "by_severity": {
            "high": sum(1 for d in deficiencies if d["severity"] == "high"),
            "medium": sum(1 for d in deficiencies if d["severity"] == "medium"),
            "low": sum(1 for d in deficiencies if d["severity"] == "low")
        },
        "deficiencies": deficiencies[:30]
    }


@router.get("/controls/effectiveness-by-type")
def get_effectiveness_by_type(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    controls = db.query(InternalControl).filter(
        InternalControl.tenant_id.in_(user_tenants),
        InternalControl.status == "active"
    ).all()

    by_type = {}
    for c in controls:
        ct = c.control_type or "unknown"
        if ct not in by_type:
            by_type[ct] = {"total": 0, "design_effective": 0, "operating_effective": 0, "both_effective": 0, "key_controls": 0}
        by_type[ct]["total"] += 1
        if c.design_effectiveness == "effective":
            by_type[ct]["design_effective"] += 1
        if c.operating_effectiveness == "effective":
            by_type[ct]["operating_effective"] += 1
        if c.design_effectiveness == "effective" and c.operating_effectiveness == "effective":
            by_type[ct]["both_effective"] += 1
        if c.is_key_control:
            by_type[ct]["key_controls"] += 1

    result = []
    for ct, data in by_type.items():
        result.append({
            "control_type": ct,
            "total": data["total"],
            "design_effective_rate": round(data["design_effective"] / data["total"] * 100, 1) if data["total"] > 0 else 0,
            "operating_effective_rate": round(data["operating_effective"] / data["total"] * 100, 1) if data["total"] > 0 else 0,
            "overall_effective_rate": round(data["both_effective"] / data["total"] * 100, 1) if data["total"] > 0 else 0,
            "key_controls": data["key_controls"]
        })

    return {"by_type": result, "total_controls": len(controls)}


@router.get("/controls/upcoming-tests")
def get_upcoming_tests(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    now = datetime.utcnow()

    controls = db.query(InternalControl).filter(
        InternalControl.tenant_id.in_(user_tenants),
        InternalControl.status == "active",
        InternalControl.next_test_date != None
    ).order_by(InternalControl.next_test_date.asc()).all()

    upcoming = []
    overdue = []
    for c in controls:
        item = {
            "control_id": c.control_id,
            "name": c.name,
            "control_type": c.control_type,
            "is_key_control": c.is_key_control,
            "next_test_date": c.next_test_date.isoformat() if c.next_test_date else None,
            "last_tested": c.last_tested_at.isoformat() if c.last_tested_at else None,
            "days_until": (c.next_test_date - now).days if c.next_test_date else None
        }
        if c.next_test_date and c.next_test_date < now:
            overdue.append(item)
        else:
            upcoming.append(item)

    return {
        "upcoming_tests": upcoming[:20],
        "overdue_tests": overdue,
        "total_scheduled": len(controls),
        "overdue_count": len(overdue),
        "due_within_30d": sum(1 for c in controls if c.next_test_date and now <= c.next_test_date <= now + timedelta(days=30))
    }


@router.get("/regulatory/change-tracker")
def get_regulatory_change_tracker(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    changes = db.query(RegulatoryChange).filter(
        RegulatoryChange.tenant_id.in_(user_tenants)
    ).order_by(RegulatoryChange.published_date.desc().nullslast()).all()

    by_status = {}
    by_priority = {}
    by_source = {}

    for c in changes:
        s = c.status or "identified"
        by_status[s] = by_status.get(s, 0) + 1
        p = c.priority or "medium"
        by_priority[p] = by_priority.get(p, 0) + 1
        src = c.source or "unknown"
        by_source[src] = by_source.get(src, 0) + 1

    return {
        "total_changes": len(changes),
        "by_status": by_status,
        "by_priority": by_priority,
        "by_source": by_source,
        "recent_changes": [
            {
                "id": c.id,
                "title": c.title,
                "source": c.source,
                "status": c.status,
                "priority": c.priority,
                "effective_date": c.effective_date.isoformat() if c.effective_date else None,
                "published_date": c.published_date.isoformat() if c.published_date else None
            }
            for c in changes[:15]
        ]
    }


@router.get("/regulatory/impact-summary")
def get_regulatory_impact_summary(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    assessments = db.query(RegulatoryImpactAssessment).filter(
        RegulatoryImpactAssessment.tenant_id.in_(user_tenants)
    ).all()

    by_impact = {}
    by_type = {}
    gaps_found = 0

    for a in assessments:
        il = a.impact_level or "medium"
        by_impact[il] = by_impact.get(il, 0) + 1
        at = a.assessment_type or "unknown"
        by_type[at] = by_type.get(at, 0) + 1
        if a.gap_identified:
            gaps_found += 1

    return {
        "total_assessments": len(assessments),
        "by_impact_level": by_impact,
        "by_assessment_type": by_type,
        "gaps_identified": gaps_found,
        "gap_rate": round(gaps_found / max(len(assessments), 1) * 100, 1)
    }


@router.get("/regulatory/implementation-progress")
def get_regulatory_implementation_progress(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    tasks = db.query(RegulatoryImplementationTask).filter(
        RegulatoryImplementationTask.tenant_id.in_(user_tenants)
    ).all()

    by_status = {}
    by_type = {}
    now = datetime.utcnow()
    overdue = 0

    for t in tasks:
        s = t.status or "pending"
        by_status[s] = by_status.get(s, 0) + 1
        tt = t.task_type or "unknown"
        by_type[tt] = by_type.get(tt, 0) + 1
        if t.status not in ("completed", "blocked") and t.due_date and t.due_date < now:
            overdue += 1

    completed = by_status.get("completed", 0)
    total = len(tasks)
    completion_rate = round(completed / total * 100, 1) if total > 0 else 0

    changes = db.query(RegulatoryChange).filter(
        RegulatoryChange.tenant_id.in_(user_tenants)
    ).all()

    change_progress = []
    for c in changes:
        c_tasks = [t for t in tasks if t.regulatory_change_id == c.id]
        c_completed = sum(1 for t in c_tasks if t.status == "completed")
        if c_tasks:
            change_progress.append({
                "change_id": c.id,
                "title": c.title,
                "total_tasks": len(c_tasks),
                "completed_tasks": c_completed,
                "progress_pct": round(c_completed / len(c_tasks) * 100, 1)
            })

    return {
        "total_tasks": total,
        "by_status": by_status,
        "by_type": by_type,
        "overdue_tasks": overdue,
        "completion_rate": completion_rate,
        "change_progress": sorted(change_progress, key=lambda x: x["progress_pct"])[:15]
    }


@router.get("/regulatory/feed-analysis")
def get_regulatory_feed_analysis(
    db: Session = Depends(get_db),
    current_user=Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    items = db.query(RegulatoryFeedItem).filter(
        RegulatoryFeedItem.tenant_id.in_(user_tenants)
    ).all()

    by_status = {}
    for item in items:
        s = item.status or "new"
        by_status[s] = by_status.get(s, 0) + 1

    sources = db.query(RegulatoryFeedSource).filter(
        RegulatoryFeedSource.tenant_id.in_(user_tenants)
    ).all()

    analyzed = [i for i in items if i.status == "analyzed" and i.ai_analysis]

    return {
        "total_feed_items": len(items),
        "by_status": by_status,
        "active_sources": len([s for s in sources if s.is_active]),
        "total_sources": len(sources),
        "analyzed_count": len(analyzed),
        "pending_analysis": by_status.get("new", 0),
        "analysis_rate": round(len(analyzed) / max(len(items), 1) * 100, 1)
    }
