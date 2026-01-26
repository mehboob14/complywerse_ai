from typing import Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_

from ..models import (
    Framework, FrameworkDomain, ControlObjective, FrameworkControl,
    NormalizedControl, ControlMapping, Evidence, EvidenceControlMapping,
    Risk, Document, ITAsset, GRCUser, get_db, GovernanceDocument,
    DocumentApprovalStep, AttestationCampaign, RegulatoryChange,
    PolicyStatement, PolicyStatementCompliance, RCSAAssessment,
    UploadedFramework, ParsedFrameworkControl, RiskIncident, RiskMitigationAction,
    RiskKRI, EvidenceAIAssessment
)
from .auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


def calculate_framework_compliance(framework_id: int, user_tenants: list, db: Session) -> dict:
    total_controls = db.query(func.count(FrameworkControl.id)).join(
        ControlObjective, FrameworkControl.objective_id == ControlObjective.id
    ).join(
        FrameworkDomain, ControlObjective.domain_id == FrameworkDomain.id
    ).filter(
        FrameworkDomain.framework_id == framework_id
    ).scalar() or 0
    
    if total_controls == 0:
        return {"score": 0, "status": "not_started", "total_controls": 0, "covered_controls": 0}
    
    framework_control_ids = db.query(FrameworkControl.id).join(
        ControlObjective, FrameworkControl.objective_id == ControlObjective.id
    ).join(
        FrameworkDomain, ControlObjective.domain_id == FrameworkDomain.id
    ).filter(
        FrameworkDomain.framework_id == framework_id
    ).all()
    framework_control_ids = [fc[0] for fc in framework_control_ids]
    
    normalized_control_ids = db.query(ControlMapping.normalized_control_id).filter(
        ControlMapping.framework_control_id.in_(framework_control_ids)
    ).distinct().all()
    normalized_control_ids = [nc[0] for nc in normalized_control_ids]
    
    if not user_tenants:
        return {"score": 0, "status": "not_started", "total_controls": total_controls, "covered_controls": 0}
    
    controls_with_evidence = 0
    if normalized_control_ids:
        controls_with_evidence = db.query(func.count(func.distinct(EvidenceControlMapping.normalized_control_id))).join(
            Evidence, EvidenceControlMapping.evidence_id == Evidence.id
        ).filter(
            EvidenceControlMapping.normalized_control_id.in_(normalized_control_ids),
            Evidence.tenant_id.in_(user_tenants),
            Evidence.status == "approved"
        ).scalar() or 0
    
    controls_with_direct_evidence = 0
    if framework_control_ids:
        controls_with_direct_evidence = db.query(func.count(func.distinct(EvidenceControlMapping.framework_control_id))).join(
            Evidence, EvidenceControlMapping.evidence_id == Evidence.id
        ).filter(
            EvidenceControlMapping.framework_control_id.in_(framework_control_ids),
            Evidence.tenant_id.in_(user_tenants),
            Evidence.status == "approved"
        ).scalar() or 0
    
    covered_controls = max(controls_with_evidence, controls_with_direct_evidence)
    
    score = round((covered_controls / total_controls) * 100) if total_controls > 0 else 0
    
    if score >= 90:
        status = "compliant"
    elif score >= 70:
        status = "partial"
    elif score >= 30:
        status = "in_progress"
    else:
        status = "not_started"
    
    return {
        "score": score,
        "status": status,
        "total_controls": total_controls,
        "covered_controls": covered_controls
    }


@router.get("/stats")
def get_dashboard_stats(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    frameworks_count = db.query(func.count(Framework.id)).filter(Framework.is_active == True).scalar()
    controls_count = db.query(func.count(NormalizedControl.id)).scalar()
    
    if user_tenants:
        tenant_filter = user_tenants
        if tenant_id and tenant_id in user_tenants:
            tenant_filter = [tenant_id]
        
        evidence_count = db.query(func.count(Evidence.id)).filter(
            Evidence.tenant_id.in_(tenant_filter)
        ).scalar()
        
        open_risks = db.query(func.count(Risk.id)).filter(
            Risk.status.in_(["identified", "under_review", "mitigating"]),
            Risk.tenant_id.in_(tenant_filter)
        ).scalar()
        
        documents_count = db.query(func.count(Document.id)).filter(
            Document.tenant_id.in_(tenant_filter)
        ).scalar()
        
        assets_count = db.query(func.count(ITAsset.id)).filter(
            ITAsset.tenant_id.in_(tenant_filter)
        ).scalar()
    else:
        evidence_count = 0
        open_risks = 0
        documents_count = 0
        assets_count = 0
    
    frameworks = db.query(Framework).filter(Framework.is_active == True).all()
    compliance_overview = []
    
    for fw in frameworks[:5]:
        compliance_data = calculate_framework_compliance(fw.id, user_tenants, db)
        compliance_overview.append({
            "framework": fw.name,
            "short_code": fw.short_code,
            "score": compliance_data["score"],
            "status": compliance_data["status"],
            "total_controls": compliance_data["total_controls"],
            "covered_controls": compliance_data["covered_controls"]
        })
    
    recent_activity = []
    if user_tenants:
        recent_evidence = db.query(Evidence).filter(
            Evidence.tenant_id.in_(user_tenants)
        ).order_by(Evidence.uploaded_at.desc()).limit(5).all()
        
        for ev in recent_evidence:
            recent_activity.append({
                "type": "evidence",
                "action": "uploaded",
                "name": ev.name,
                "timestamp": ev.uploaded_at.isoformat(),
                "status": ev.status
            })
        
        recent_risks = db.query(Risk).filter(
            Risk.tenant_id.in_(user_tenants)
        ).order_by(Risk.created_at.desc()).limit(3).all()
        
        for risk in recent_risks:
            recent_activity.append({
                "type": "risk",
                "action": "created",
                "name": risk.title,
                "timestamp": risk.created_at.isoformat(),
                "status": risk.status
            })
        
        recent_activity.sort(key=lambda x: x["timestamp"], reverse=True)
        recent_activity = recent_activity[:5]
    
    return {
        "stats": {
            "frameworks": frameworks_count or 0,
            "controls": controls_count or 0,
            "evidence": evidence_count or 0,
            "open_risks": open_risks or 0,
            "documents": documents_count or 0,
            "assets": assets_count or 0
        },
        "compliance_overview": compliance_overview,
        "recent_activity": recent_activity
    }


@router.get("/compliance/{framework_id}")
def get_framework_compliance_detail(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    framework = db.query(Framework).filter(Framework.id == framework_id).first()
    if not framework:
        return {"error": "Framework not found"}
    
    domains = db.query(FrameworkDomain).filter(
        FrameworkDomain.framework_id == framework_id
    ).order_by(FrameworkDomain.order).all()
    
    domain_compliance = []
    for domain in domains:
        domain_control_count = db.query(func.count(FrameworkControl.id)).join(
            ControlObjective, FrameworkControl.objective_id == ControlObjective.id
        ).filter(
            ControlObjective.domain_id == domain.id
        ).scalar() or 0
        
        domain_control_ids = db.query(FrameworkControl.id).join(
            ControlObjective, FrameworkControl.objective_id == ControlObjective.id
        ).filter(
            ControlObjective.domain_id == domain.id
        ).all()
        domain_control_ids = [dc[0] for dc in domain_control_ids]
        
        covered = 0
        if domain_control_ids and user_tenants:
            covered = db.query(func.count(func.distinct(EvidenceControlMapping.framework_control_id))).join(
                Evidence, EvidenceControlMapping.evidence_id == Evidence.id
            ).filter(
                EvidenceControlMapping.framework_control_id.in_(domain_control_ids),
                Evidence.tenant_id.in_(user_tenants),
                Evidence.status == "approved"
            ).scalar() or 0
        
        score = round((covered / domain_control_count) * 100) if domain_control_count > 0 else 0
        
        domain_compliance.append({
            "domain_id": domain.id,
            "code": domain.code,
            "name": domain.name,
            "total_controls": domain_control_count,
            "covered_controls": covered,
            "score": score
        })
    
    overall = calculate_framework_compliance(framework_id, user_tenants, db)
    
    return {
        "framework": {
            "id": framework.id,
            "name": framework.name,
            "short_code": framework.short_code
        },
        "overall_compliance": overall,
        "domain_compliance": domain_compliance
    }


@router.get("/unified")
def get_unified_dashboard(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """
    Unified dashboard aggregating Governance, Risk, and Compliance metrics
    with trends, deadlines, and activity feed.
    """
    user_tenants = get_user_tenants(current_user, db)
    now = datetime.utcnow()
    
    # Default empty response structure
    empty_response = {
        "executive_summary": {
            "overall_compliance_score": 0,
            "risk_score": 0,
            "open_issues": 0,
            "pending_actions": 0,
            "trend": "stable"
        },
        "governance": {
            "total_documents": 0,
            "by_status": {},
            "pending_approvals": 0,
            "expiring_30_days": 0,
            "overdue_reviews": 0,
            "recent_publications": []
        },
        "risk": {
            "total_risks": 0,
            "open_risks": 0,
            "by_category": {},
            "by_score_range": {"critical": 0, "high": 0, "medium": 0, "low": 0},
            "avg_residual_score": 0,
            "heatmap": [],
            "incidents_open": 0,
            "mitigations_overdue": 0
        },
        "compliance": {
            "frameworks_tracked": 0,
            "framework_coverage": [],
            "overall_maturity": 0,
            "controls_implemented": 0,
            "controls_total": 0,
            "evidence_items": 0,
            "assessments_pending": 0
        },
        "attestations": {
            "active_campaigns": 0,
            "pending_responses": 0,
            "completion_rate": 0,
            "overdue": 0
        },
        "regulatory_changes": {
            "total_changes": 0,
            "pending_review": 0,
            "high_impact": 0,
            "recent": []
        },
        "upcoming_deadlines": [],
        "recent_activity": [],
        "kpis": {
            "compliance_trend": [],
            "risk_trend": [],
            "evidence_trend": []
        }
    }
    
    if not user_tenants:
        return empty_response
    
    tenant_filter = user_tenants
    if tenant_id and tenant_id in user_tenants:
        tenant_filter = [tenant_id]
    
    # ===== EXECUTIVE SUMMARY =====
    # Calculate overall compliance from uploaded frameworks
    uploaded_frameworks = db.query(UploadedFramework).filter(
        UploadedFramework.tenant_id.in_(tenant_filter),
        UploadedFramework.upload_status.in_(['parsed', 'completed', 'published']),
        UploadedFramework.is_active == True
    ).all()
    
    framework_scores = []
    framework_coverage = []
    total_controls = 0
    implemented_controls = 0
    
    for fw in uploaded_frameworks:
        controls = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == fw.id
        ).all()
        
        fw_total = len(controls)
        fw_implemented = sum(1 for c in controls if getattr(c, 'implementation_status', None) in ['implemented', 'partial'] or getattr(c, 'is_verified', False))
        
        total_controls += fw_total
        implemented_controls += fw_implemented
        
        score = round((fw_implemented / fw_total) * 100) if fw_total > 0 else 0
        framework_scores.append(score)
        
        framework_coverage.append({
            "framework_id": fw.id,
            "name": fw.name,
            "short_code": getattr(fw, 'short_code', None) or fw.name[:10] if fw.name else "FW",
            "version": getattr(fw, 'version', None) or "1.0",
            "total_controls": fw_total,
            "implemented_controls": fw_implemented,
            "score": score,
            "status": "compliant" if score >= 80 else "partial" if score >= 50 else "at_risk"
        })
    
    overall_compliance = round(sum(framework_scores) / len(framework_scores)) if framework_scores else 0
    
    # Risk metrics
    risks = db.query(Risk).filter(Risk.tenant_id.in_(tenant_filter)).all()
    open_risks = [r for r in risks if r.status in ['identified', 'under_review', 'mitigating', 'open']]
    
    risk_scores = [r.residual_score or r.inherent_score or 0 for r in risks if (r.residual_score or r.inherent_score)]
    avg_risk_score = round(sum(risk_scores) / len(risk_scores)) if risk_scores else 0
    
    # Risk categorization
    by_category = {}
    by_score_range = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    
    for risk in risks:
        cat = risk.risk_category or risk.category or "operational"
        by_category[cat] = by_category.get(cat, 0) + 1
        
        score = risk.residual_score or risk.inherent_score or 0
        if score >= 20:
            by_score_range["critical"] += 1
        elif score >= 12:
            by_score_range["high"] += 1
        elif score >= 6:
            by_score_range["medium"] += 1
        else:
            by_score_range["low"] += 1
    
    # Risk heatmap data
    heatmap = {}
    for risk in risks:
        likelihood = risk.residual_likelihood or risk.inherent_likelihood or 0
        impact = risk.residual_impact or risk.inherent_impact or 0
        if likelihood > 0 and impact > 0:
            key = f"{likelihood}-{impact}"
            if key not in heatmap:
                heatmap[key] = {"likelihood": likelihood, "impact": impact, "count": 0}
            heatmap[key]["count"] += 1
    
    # Incidents
    incidents_open = db.query(func.count(RiskIncident.id)).filter(
        RiskIncident.tenant_id.in_(tenant_filter),
        RiskIncident.status.in_(['reported', 'investigating', 'open'])
    ).scalar() or 0
    
    # Overdue mitigations (join through Risk for tenant filtering)
    mitigations_overdue = db.query(func.count(RiskMitigationAction.id)).join(
        Risk, RiskMitigationAction.risk_id == Risk.id
    ).filter(
        Risk.tenant_id.in_(tenant_filter),
        RiskMitigationAction.due_date < now,
        RiskMitigationAction.status.notin_(['completed', 'cancelled'])
    ).scalar() or 0
    
    # ===== GOVERNANCE =====
    gov_documents = db.query(GovernanceDocument).filter(
        GovernanceDocument.tenant_id.in_(tenant_filter)
    ).all()
    
    doc_by_status = {}
    for doc in gov_documents:
        status = doc.status or "draft"
        doc_by_status[status] = doc_by_status.get(status, 0) + 1
    
    pending_approvals = db.query(func.count(DocumentApprovalStep.id)).join(
        GovernanceDocument, DocumentApprovalStep.document_id == GovernanceDocument.id
    ).filter(
        GovernanceDocument.tenant_id.in_(tenant_filter),
        DocumentApprovalStep.status == "pending"
    ).scalar() or 0
    
    expiring_30 = db.query(func.count(GovernanceDocument.id)).filter(
        GovernanceDocument.tenant_id.in_(tenant_filter),
        GovernanceDocument.expiry_date.isnot(None),
        GovernanceDocument.expiry_date >= now,
        GovernanceDocument.expiry_date <= now + timedelta(days=30)
    ).scalar() or 0
    
    overdue_reviews = db.query(func.count(GovernanceDocument.id)).filter(
        GovernanceDocument.tenant_id.in_(tenant_filter),
        GovernanceDocument.next_review_date.isnot(None),
        GovernanceDocument.next_review_date < now
    ).scalar() or 0
    
    recent_pubs = db.query(GovernanceDocument).filter(
        GovernanceDocument.tenant_id.in_(tenant_filter),
        GovernanceDocument.status == "published",
        GovernanceDocument.published_at.isnot(None)
    ).order_by(GovernanceDocument.published_at.desc()).limit(5).all()
    
    # ===== ATTESTATIONS =====
    active_campaigns = db.query(func.count(AttestationCampaign.id)).filter(
        AttestationCampaign.tenant_id.in_(tenant_filter),
        AttestationCampaign.status == "active"
    ).scalar() or 0
    
    # ===== REGULATORY CHANGES =====
    reg_changes = db.query(RegulatoryChange).filter(
        RegulatoryChange.tenant_id.in_(tenant_filter)
    ).order_by(RegulatoryChange.created_at.desc()).limit(10).all()
    
    pending_review_changes = sum(1 for rc in reg_changes if getattr(rc, 'status', None) in ['pending', 'under_review'])
    high_impact_changes = sum(1 for rc in reg_changes if getattr(rc, 'priority', None) in ['high', 'critical'])
    
    # ===== COMPLIANCE / STATEMENTS =====
    statements = db.query(PolicyStatement).filter(
        PolicyStatement.tenant_id.in_(tenant_filter)
    ).all()
    
    compliances = db.query(PolicyStatementCompliance).filter(
        PolicyStatementCompliance.tenant_id.in_(tenant_filter)
    ).all()
    
    compliance_map = {c.statement_id: c for c in compliances}
    compliant_count = sum(1 for c in compliances if c.compliance_status == "compliant")
    maturity_score = round((compliant_count / len(compliances)) * 100) if compliances else 0
    
    # ===== EVIDENCE =====
    evidence_count = db.query(func.count(Evidence.id)).filter(
        Evidence.tenant_id.in_(tenant_filter)
    ).scalar() or 0
    
    # ===== UPCOMING DEADLINES =====
    deadlines = []
    
    # Expiring documents
    expiring_docs = db.query(GovernanceDocument).filter(
        GovernanceDocument.tenant_id.in_(tenant_filter),
        GovernanceDocument.expiry_date.isnot(None),
        GovernanceDocument.expiry_date >= now,
        GovernanceDocument.expiry_date <= now + timedelta(days=90)
    ).order_by(GovernanceDocument.expiry_date.asc()).limit(5).all()
    
    for doc in expiring_docs:
        days_until = (doc.expiry_date - now).days
        deadlines.append({
            "type": "document_expiry",
            "title": f"Policy Expiring: {doc.title}",
            "due_date": doc.expiry_date.isoformat(),
            "days_remaining": days_until,
            "urgency": "critical" if days_until <= 7 else "high" if days_until <= 30 else "medium",
            "link": f"/governance/documents/{doc.id}"
        })
    
    # Overdue mitigations (top 5) - join through Risk for tenant filtering
    overdue_actions = db.query(RiskMitigationAction).join(
        Risk, RiskMitigationAction.risk_id == Risk.id
    ).filter(
        Risk.tenant_id.in_(tenant_filter),
        RiskMitigationAction.due_date < now,
        RiskMitigationAction.status.notin_(['completed', 'cancelled'])
    ).order_by(RiskMitigationAction.due_date.asc()).limit(5).all()
    
    for action in overdue_actions:
        days_overdue = (now - action.due_date).days
        deadlines.append({
            "type": "mitigation_overdue",
            "title": f"Overdue: {getattr(action, 'action_title', None) or action.title}",
            "due_date": action.due_date.isoformat(),
            "days_remaining": -days_overdue,
            "urgency": "critical",
            "link": f"/erm/risks"
        })
    
    # Sort deadlines by urgency/date
    deadlines.sort(key=lambda x: x["days_remaining"])
    
    # ===== RECENT ACTIVITY =====
    activity = []
    
    # Recent evidence uploads
    recent_evidence = db.query(Evidence).filter(
        Evidence.tenant_id.in_(tenant_filter)
    ).order_by(Evidence.uploaded_at.desc()).limit(5).all()
    
    for ev in recent_evidence:
        activity.append({
            "type": "evidence",
            "action": "uploaded",
            "title": ev.name,
            "timestamp": ev.uploaded_at.isoformat() if ev.uploaded_at else now.isoformat(),
            "status": ev.status,
            "link": f"/evidence/{ev.id}"
        })
    
    # Recent risks
    recent_risks = db.query(Risk).filter(
        Risk.tenant_id.in_(tenant_filter)
    ).order_by(Risk.created_at.desc()).limit(3).all()
    
    for risk in recent_risks:
        activity.append({
            "type": "risk",
            "action": "created",
            "title": risk.title,
            "timestamp": risk.created_at.isoformat() if risk.created_at else now.isoformat(),
            "status": risk.status,
            "link": f"/erm/risks"
        })
    
    # Recent incidents
    recent_incidents = db.query(RiskIncident).filter(
        RiskIncident.tenant_id.in_(tenant_filter)
    ).order_by(RiskIncident.created_at.desc()).limit(3).all()
    
    for inc in recent_incidents:
        incident_timestamp = getattr(inc, 'incident_date', None) or getattr(inc, 'created_at', None) or now
        activity.append({
            "type": "incident",
            "action": "reported",
            "title": inc.title,
            "timestamp": incident_timestamp.isoformat() if incident_timestamp else now.isoformat(),
            "status": getattr(inc, 'status', None) or "open",
            "link": f"/erm/incidents"
        })
    
    # Sort by timestamp
    activity.sort(key=lambda x: x["timestamp"], reverse=True)
    activity = activity[:10]
    
    # ===== TREND DATA =====
    # Compliance trend (last 6 months)
    compliance_trend = []
    for i in range(5, -1, -1):
        month_start = (now - timedelta(days=i * 30)).replace(day=1, hour=0, minute=0, second=0)
        month_label = month_start.strftime("%b")
        
        # Count evidence uploaded that month
        evidence_in_month = db.query(func.count(Evidence.id)).filter(
            Evidence.tenant_id.in_(tenant_filter),
            Evidence.uploaded_at >= month_start,
            Evidence.uploaded_at < month_start + timedelta(days=30)
        ).scalar() or 0
        
        compliance_trend.append({
            "month": month_label,
            "value": evidence_in_month
        })
    
    # Risk trend (last 6 months)
    risk_trend = []
    for i in range(5, -1, -1):
        month_start = (now - timedelta(days=i * 30)).replace(day=1, hour=0, minute=0, second=0)
        month_label = month_start.strftime("%b")
        
        open_in_month = db.query(func.count(Risk.id)).filter(
            Risk.tenant_id.in_(tenant_filter),
            Risk.created_at <= month_start + timedelta(days=30),
            or_(Risk.closed_at == None, Risk.closed_at > month_start + timedelta(days=30))
        ).scalar() or 0
        
        risk_trend.append({
            "month": month_label,
            "value": open_in_month
        })
    
    # Determine overall trend
    def get_trend(scores):
        if len(scores) < 2:
            return "stable"
        if scores[-1] > scores[-2]:
            return "improving"
        elif scores[-1] < scores[-2]:
            return "declining"
        return "stable"
    
    trend = get_trend(framework_scores) if len(framework_scores) > 1 else "stable"
    
    return {
        "executive_summary": {
            "overall_compliance_score": overall_compliance,
            "risk_score": avg_risk_score,
            "open_issues": len(open_risks) + incidents_open,
            "pending_actions": pending_approvals + mitigations_overdue,
            "trend": trend
        },
        "governance": {
            "total_documents": len(gov_documents),
            "by_status": doc_by_status,
            "pending_approvals": pending_approvals,
            "expiring_30_days": expiring_30,
            "overdue_reviews": overdue_reviews,
            "recent_publications": [
                {
                    "id": doc.id,
                    "title": doc.title,
                    "doc_type": doc.doc_type,
                    "published_at": doc.published_at.isoformat() if doc.published_at else None
                }
                for doc in recent_pubs
            ]
        },
        "risk": {
            "total_risks": len(risks),
            "open_risks": len(open_risks),
            "by_category": by_category,
            "by_score_range": by_score_range,
            "avg_residual_score": avg_risk_score,
            "heatmap": list(heatmap.values()),
            "incidents_open": incidents_open,
            "mitigations_overdue": mitigations_overdue
        },
        "compliance": {
            "frameworks_tracked": len(uploaded_frameworks),
            "framework_coverage": framework_coverage,
            "overall_maturity": maturity_score,
            "controls_implemented": implemented_controls,
            "controls_total": total_controls,
            "evidence_items": evidence_count,
            "assessments_pending": 0
        },
        "attestations": {
            "active_campaigns": active_campaigns,
            "pending_responses": 0,
            "completion_rate": 0,
            "overdue": 0
        },
        "regulatory_changes": {
            "total_changes": len(reg_changes),
            "pending_review": pending_review_changes,
            "high_impact": high_impact_changes,
            "recent": [
                {
                    "id": rc.id,
                    "title": rc.title,
                    "regulator": getattr(rc, 'source', None) or "Unknown",
                    "impact_level": getattr(rc, 'priority', None) or "medium",
                    "status": getattr(rc, 'status', None) or "pending",
                    "publication_date": rc.published_date.isoformat() if getattr(rc, 'published_date', None) else None
                }
                for rc in reg_changes[:5]
            ]
        },
        "upcoming_deadlines": deadlines[:10],
        "recent_activity": activity,
        "kpis": {
            "compliance_trend": compliance_trend,
            "risk_trend": risk_trend,
            "evidence_trend": compliance_trend
        }
    }
