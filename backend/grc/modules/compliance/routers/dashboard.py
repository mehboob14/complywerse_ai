from typing import Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, or_

from ....models import (
    PolicyStatement, PolicyStatementCompliance, GovernanceDocument,
    CertificationJourney, ControlImplementation, ImplementationEvidence,
    UploadedFramework, ParsedFrameworkControl, FrameworkControl,
    GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/dashboard", tags=["Compliance Dashboard"])


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    from fastapi import HTTPException, status
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


@router.get("/summary")
def get_compliance_summary(
    tenant_id: Optional[int] = None,
    document_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {
            "total_statements": 0,
            "by_status": {},
            "by_category": {},
            "by_priority": {},
            "compliance_score": 0.0
        }
    
    query = db.query(PolicyStatement).filter(PolicyStatement.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(PolicyStatement.tenant_id == tenant_id)
    
    if document_id:
        query = query.filter(PolicyStatement.document_id == document_id)
    
    statements = query.all()
    total_statements = len(statements)
    
    if total_statements == 0:
        return {
            "total_statements": 0,
            "by_status": {},
            "by_category": {},
            "by_priority": {},
            "compliance_score": 0.0
        }
    
    by_status = {
        "compliant": 0,
        "partially_compliant": 0,
        "non_compliant": 0,
        "not_assessed": 0,
        "not_applicable": 0
    }
    by_category = {}
    by_priority = {}
    
    total_score = 0.0
    scored_count = 0
    
    for stmt in statements:
        compliance = db.query(PolicyStatementCompliance).filter(
            PolicyStatementCompliance.statement_id == stmt.id
        ).first()
        
        status_val = compliance.compliance_status if compliance else "not_assessed"
        by_status[status_val] = by_status.get(status_val, 0) + 1
        
        category = stmt.category or "uncategorized"
        by_category[category] = by_category.get(category, 0) + 1
        
        priority = stmt.priority or "medium"
        by_priority[priority] = by_priority.get(priority, 0) + 1
        
        if compliance and compliance.compliance_score is not None:
            total_score += compliance.compliance_score
            scored_count += 1
    
    avg_score = round(total_score / scored_count, 1) if scored_count > 0 else 0.0
    
    compliant_count = by_status.get("compliant", 0)
    partially_count = by_status.get("partially_compliant", 0)
    non_compliant_count = by_status.get("non_compliant", 0)
    not_applicable_count = by_status.get("not_applicable", 0)
    
    applicable_count = total_statements - not_applicable_count
    if applicable_count > 0:
        weighted_score = ((compliant_count * 100) + (partially_count * 50)) / applicable_count
    else:
        weighted_score = 0.0
    
    return {
        "total_statements": total_statements,
        "by_status": by_status,
        "by_category": by_category,
        "by_priority": by_priority,
        "compliance_score": round(weighted_score, 1),
        "average_score": avg_score,
        "compliance_rate": round((compliant_count / applicable_count) * 100, 1) if applicable_count > 0 else 0.0,
        "statistics": {
            "mandatory_count": sum(1 for s in statements if s.is_mandatory),
            "active_count": sum(1 for s in statements if s.status == "active"),
            "assessed_count": total_statements - by_status.get("not_assessed", 0)
        }
    }


@router.get("/trends")
def get_compliance_trends(
    tenant_id: Optional[int] = None,
    months: int = Query(6, le=24, description="Number of months to look back"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"trends": [], "period_months": months}
    
    now = datetime.utcnow()
    trends = []
    
    for i in range(months - 1, -1, -1):
        month_start = (now.replace(day=1) - timedelta(days=i * 30)).replace(day=1)
        if i > 0:
            next_month = (month_start + timedelta(days=32)).replace(day=1)
        else:
            next_month = now
        
        query = db.query(PolicyStatementCompliance).filter(
            PolicyStatementCompliance.tenant_id.in_(user_tenants),
            PolicyStatementCompliance.assessment_date.isnot(None),
            PolicyStatementCompliance.assessment_date < next_month
        )
        
        if tenant_id:
            validate_tenant_access(current_user, tenant_id, db)
            query = query.filter(PolicyStatementCompliance.tenant_id == tenant_id)
        
        records = query.all()
        
        compliant = sum(1 for r in records if r.compliance_status == "compliant")
        partial = sum(1 for r in records if r.compliance_status == "partially_compliant")
        non_compliant = sum(1 for r in records if r.compliance_status == "non_compliant")
        total_assessed = len(records)
        
        applicable = compliant + partial + non_compliant
        compliance_rate = round((compliant / applicable) * 100, 1) if applicable > 0 else 0.0
        
        trends.append({
            "month": month_start.strftime("%Y-%m"),
            "total_assessed": total_assessed,
            "compliant": compliant,
            "partially_compliant": partial,
            "non_compliant": non_compliant,
            "compliance_rate": compliance_rate
        })
    
    return {
        "trends": trends,
        "period_months": months,
        "summary": {
            "current_rate": trends[-1]["compliance_rate"] if trends else 0.0,
            "previous_rate": trends[-2]["compliance_rate"] if len(trends) > 1 else 0.0,
            "trend_direction": "improving" if len(trends) > 1 and trends[-1]["compliance_rate"] > trends[-2]["compliance_rate"] else "declining" if len(trends) > 1 and trends[-1]["compliance_rate"] < trends[-2]["compliance_rate"] else "stable"
        }
    }


@router.get("/overdue")
def get_overdue_assessments(
    tenant_id: Optional[int] = None,
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"overdue": [], "total": 0}
    
    now = datetime.utcnow()
    
    query = db.query(PolicyStatementCompliance).filter(
        PolicyStatementCompliance.tenant_id.in_(user_tenants),
        PolicyStatementCompliance.next_assessment_date.isnot(None),
        PolicyStatementCompliance.next_assessment_date < now
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(PolicyStatementCompliance.tenant_id == tenant_id)
    
    total = query.count()
    overdue_records = query.order_by(PolicyStatementCompliance.next_assessment_date.asc()).limit(limit).all()
    
    result = []
    for record in overdue_records:
        statement = db.query(PolicyStatement).filter(
            PolicyStatement.id == record.statement_id
        ).first()
        
        document = None
        if statement:
            document = db.query(GovernanceDocument).filter(
                GovernanceDocument.id == statement.document_id
            ).first()
        
        owner = None
        if record.owner_id:
            owner = db.query(GRCUser).filter(GRCUser.id == record.owner_id).first()
        
        days_overdue = (now - record.next_assessment_date).days
        
        result.append({
            "compliance_id": record.id,
            "statement_id": record.statement_id,
            "statement_code": statement.statement_code if statement else None,
            "statement_summary": statement.statement_summary if statement else None,
            "document_id": statement.document_id if statement else None,
            "document_title": document.title if document else None,
            "document_code": document.document_code if document else None,
            "category": statement.category if statement else None,
            "priority": statement.priority if statement else None,
            "compliance_status": record.compliance_status,
            "next_assessment_date": record.next_assessment_date.isoformat() if record.next_assessment_date else None,
            "days_overdue": days_overdue,
            "owner_id": record.owner_id,
            "owner_name": owner.display_name if owner else None,
            "department": record.department,
            "last_assessment_date": record.assessment_date.isoformat() if record.assessment_date else None
        })
    
    by_priority = {}
    by_category = {}
    for item in result:
        priority = item.get("priority") or "medium"
        by_priority[priority] = by_priority.get(priority, 0) + 1
        
        category = item.get("category") or "uncategorized"
        by_category[category] = by_category.get(category, 0) + 1
    
    return {
        "overdue": result,
        "total": total,
        "by_priority": by_priority,
        "by_category": by_category,
        "summary": {
            "critical_overdue": by_priority.get("critical", 0),
            "high_overdue": by_priority.get("high", 0),
            "average_days_overdue": round(sum(r["days_overdue"] for r in result) / len(result), 1) if result else 0
        }
    }


@router.get("/by-document")
def get_compliance_by_document(
    tenant_id: Optional[int] = None,
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"documents": [], "total": 0}
    
    query = db.query(PolicyStatement).filter(PolicyStatement.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(PolicyStatement.tenant_id == tenant_id)
    
    statements = query.all()
    
    document_stats = {}
    
    for stmt in statements:
        doc_id = stmt.document_id
        if doc_id not in document_stats:
            document = db.query(GovernanceDocument).filter(GovernanceDocument.id == doc_id).first()
            document_stats[doc_id] = {
                "document_id": doc_id,
                "document_title": document.title if document else None,
                "document_code": document.document_code if document else None,
                "doc_type": document.doc_type if document else None,
                "total_statements": 0,
                "compliant": 0,
                "partially_compliant": 0,
                "non_compliant": 0,
                "not_assessed": 0,
                "not_applicable": 0
            }
        
        document_stats[doc_id]["total_statements"] += 1
        
        compliance = db.query(PolicyStatementCompliance).filter(
            PolicyStatementCompliance.statement_id == stmt.id
        ).first()
        
        status = compliance.compliance_status if compliance else "not_assessed"
        document_stats[doc_id][status] = document_stats[doc_id].get(status, 0) + 1
    
    documents_list = []
    for doc_id, stats in document_stats.items():
        applicable = stats["total_statements"] - stats["not_applicable"]
        if applicable > 0:
            compliance_rate = round((stats["compliant"] / applicable) * 100, 1)
        else:
            compliance_rate = 0.0
        
        stats["compliance_rate"] = compliance_rate
        documents_list.append(stats)
    
    documents_list.sort(key=lambda x: x["compliance_rate"])
    
    return {
        "documents": documents_list[:limit],
        "total": len(documents_list)
    }


# ─── Frameworks Aggregate Dashboard ──────────────────────────────────────
# Powers the comprehensive compliance dashboard at /frameworks. Returns
# everything the page needs in one round trip: KPIs across all active
# journeys, status mix for the donut chart, per-framework progress bars,
# top-domain rollup for the heat strip, and a recent-activity feed.

def _classify_status(status: Optional[str], has_evidence: bool) -> str:
    """Mirror the effective-status promotion done in calculate_progress_summary
    — if a control has any evidence but isn't marked implemented/verified/NA,
    treat it as in_progress for dashboard counts."""
    if status in ("implemented", "verified", "not_applicable"):
        return status
    if has_evidence:
        return "in_progress"
    return status or "not_started"


@router.get("/frameworks-aggregate")
def get_frameworks_aggregate(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """One-shot aggregate for the frameworks dashboard.

    Returns:
        {
          "kpis": {...},
          "status_mix": [{name, value, color}],
          "by_framework": [{journey_id, framework_id, name, framework_name,
                             total, implemented, in_progress, not_started,
                             verified, not_applicable, completion_pct,
                             readiness_pct, target_date, status,
                             classification}],
          "by_domain": [{domain, total, completed, completion_pct}],
          "recent_activity": [{journey_id, framework_name, control_code,
                                control_name, status, when, type}]
        }
    """
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {
            "kpis": {},
            "status_mix": [],
            "by_framework": [],
            "by_domain": [],
            "recent_activity": [],
        }

    journeys_q = db.query(CertificationJourney).filter(
        CertificationJourney.tenant_id.in_(user_tenants)
    )
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        journeys_q = journeys_q.filter(CertificationJourney.tenant_id == tenant_id)
    journeys = journeys_q.all()

    # ── Per-journey progress rollup ──────────────────────────────────────
    by_framework = []
    total_controls_all = 0
    implemented_all = 0
    verified_all = 0
    in_progress_all = 0
    not_started_all = 0
    not_applicable_all = 0
    approved_evidence_all = 0
    fully_evidenced_all = 0
    readiness_sum = 0.0
    readiness_count = 0
    domain_totals: dict = {}
    status_mix_counts = {
        "not_started": 0,
        "in_progress": 0,
        "implemented": 0,
        "verified": 0,
        "not_applicable": 0,
    }

    for journey in journeys:
        impls = db.query(ControlImplementation).options(
            joinedload(ControlImplementation.parsed_control),
            joinedload(ControlImplementation.framework_control),
            joinedload(ControlImplementation.evidence_attachments),
        ).filter(ControlImplementation.journey_id == journey.id).all()

        j_total = len(impls)
        j_implemented = 0
        j_verified = 0
        j_in_progress = 0
        j_not_started = 0
        j_not_applicable = 0
        j_approved_evidence = 0

        for impl in impls:
            has_evidence = bool(impl.evidence_attachments)
            approved = any(
                ev.review_status == "approved" for ev in impl.evidence_attachments
            )
            effective = _classify_status(impl.status, has_evidence)

            if effective == "implemented":
                j_implemented += 1
            elif effective == "verified":
                j_implemented += 1
                j_verified += 1
            elif effective == "in_progress":
                j_in_progress += 1
            elif effective == "not_applicable":
                j_not_applicable += 1
            else:
                j_not_started += 1

            status_mix_counts[
                effective if effective in status_mix_counts else "not_started"
            ] += 1

            if approved:
                j_approved_evidence += 1

            # Domain rollup — restricted to ACTIVE journeys only (per UX brief:
            # the heat-map is meant to surface where ongoing work stands, not
            # to mix in already-completed certifications).
            if journey.status in ("in_progress", "not_started"):
                if impl.parsed_control and impl.parsed_control.domain:
                    dn = impl.parsed_control.domain
                elif (impl.framework_control and impl.framework_control.objective
                      and impl.framework_control.objective.domain):
                    dn = impl.framework_control.objective.domain.name
                else:
                    dn = "General"
                d = domain_totals.setdefault(
                    dn, {"domain": dn, "total": 0, "completed": 0}
                )
                d["total"] += 1
                if effective in ("implemented", "verified"):
                    d["completed"] += 1

        applicable = j_total - j_not_applicable
        completion_pct = round(
            (j_implemented / applicable * 100) if applicable > 0 else 0, 1
        )
        readiness_pct = round(
            (j_approved_evidence / applicable * 100) if applicable > 0 else 0, 1
        )

        # Resolve framework display name + classification
        framework_name = None
        classification = None
        if journey.uploaded_framework_id:
            uf = db.query(UploadedFramework).filter(
                UploadedFramework.id == journey.uploaded_framework_id
            ).first()
            if uf:
                framework_name = uf.name
                classification = getattr(uf, "classification", None)
        if not framework_name and getattr(journey, "framework", None):
            framework_name = journey.framework.name

        by_framework.append({
            "journey_id": journey.id,
            "framework_id": journey.uploaded_framework_id or journey.framework_id,
            "name": journey.name,
            "framework_name": framework_name or journey.name,
            "classification": classification,
            "status": journey.status,
            "target_date": journey.target_date.isoformat() if journey.target_date else None,
            "started_at": journey.started_at.isoformat() if journey.started_at else None,
            "total": j_total,
            "implemented": j_implemented,
            "verified": j_verified,
            "in_progress": j_in_progress,
            "not_started": j_not_started,
            "not_applicable": j_not_applicable,
            "completion_pct": completion_pct,
            "readiness_pct": readiness_pct,
        })

        total_controls_all += j_total
        implemented_all += j_implemented
        verified_all += j_verified
        in_progress_all += j_in_progress
        not_started_all += j_not_started
        not_applicable_all += j_not_applicable
        approved_evidence_all += j_approved_evidence

        if applicable > 0:
            readiness_sum += readiness_pct
            readiness_count += 1

    # Sort journeys by readiness descending so the most-advanced ones surface first
    by_framework.sort(key=lambda x: x["readiness_pct"], reverse=True)

    # ── Domain rollup — top 10 by total ──────────────────────────────────
    by_domain = sorted(
        [
            {
                "domain": d["domain"],
                "total": d["total"],
                "completed": d["completed"],
                "completion_pct": round(
                    (d["completed"] / d["total"] * 100) if d["total"] > 0 else 0, 1
                ),
            }
            for d in domain_totals.values()
        ],
        key=lambda x: x["total"],
        reverse=True,
    )[:10]

    # ── Status mix for donut chart ───────────────────────────────────────
    STATUS_COLORS = {
        "verified": "#10b981",
        "implemented": "#22c55e",
        "in_progress": "#3b82f6",
        "not_started": "#94a3b8",
        "not_applicable": "#e2e8f0",
    }
    STATUS_LABELS = {
        "verified": "Verified",
        "implemented": "Implemented",
        "in_progress": "In Progress",
        "not_started": "Not Started",
        "not_applicable": "Not Applicable",
    }
    status_mix = [
        {
            "key": k,
            "name": STATUS_LABELS[k],
            "value": v,
            "color": STATUS_COLORS[k],
        }
        for k, v in status_mix_counts.items()
        if v > 0
    ]

    # ── Recent activity ──────────────────────────────────────────────────
    # Mix recent implementation changes + evidence uploads. ControlImplementation
    # lacks an updated_at column, so we use implementation_date / verified_date /
    # latest ImplementationEvidence.uploaded_at as the activity timestamp.
    activity = []
    journey_ids = [j.id for j in journeys]
    if journey_ids:
        # Recent evidence uploads (most reliable signal)
        recent_evidence = db.query(ImplementationEvidence).join(
            ControlImplementation,
            ControlImplementation.id == ImplementationEvidence.implementation_id,
        ).filter(
            ControlImplementation.journey_id.in_(journey_ids)
        ).order_by(ImplementationEvidence.uploaded_at.desc()).limit(20).all()

        for ev in recent_evidence:
            impl = db.query(ControlImplementation).filter(
                ControlImplementation.id == ev.implementation_id
            ).first()
            if not impl:
                continue
            ctrl_code = None
            ctrl_name = None
            if impl.parsed_control:
                ctrl_code = impl.parsed_control.control_id
                ctrl_name = impl.parsed_control.title
            elif impl.framework_control:
                ctrl_code = impl.framework_control.code
                ctrl_name = impl.framework_control.name
            journey = next((j for j in journeys if j.id == impl.journey_id), None)
            framework_name = next(
                (f["framework_name"] for f in by_framework if f["journey_id"] == impl.journey_id),
                "Framework",
            )
            activity.append({
                "type": "evidence_uploaded",
                "journey_id": impl.journey_id,
                "framework_name": framework_name,
                "control_code": ctrl_code,
                "control_name": ctrl_name,
                "status": ev.review_status or "pending",
                "when": ev.uploaded_at.isoformat() if ev.uploaded_at else None,
            })

        # Most-recently implemented controls (status change signal)
        recent_implementations = db.query(ControlImplementation).filter(
            ControlImplementation.journey_id.in_(journey_ids),
            ControlImplementation.implementation_date.isnot(None),
        ).order_by(ControlImplementation.implementation_date.desc()).limit(10).all()

        for impl in recent_implementations:
            ctrl_code = None
            ctrl_name = None
            if impl.parsed_control:
                ctrl_code = impl.parsed_control.control_id
                ctrl_name = impl.parsed_control.title
            elif impl.framework_control:
                ctrl_code = impl.framework_control.code
                ctrl_name = impl.framework_control.name
            framework_name = next(
                (f["framework_name"] for f in by_framework if f["journey_id"] == impl.journey_id),
                "Framework",
            )
            activity.append({
                "type": "implemented",
                "journey_id": impl.journey_id,
                "framework_name": framework_name,
                "control_code": ctrl_code,
                "control_name": ctrl_name,
                "status": impl.status,
                "when": impl.implementation_date.isoformat() if impl.implementation_date else None,
            })

    activity = [a for a in activity if a["when"]]
    activity.sort(key=lambda x: x["when"], reverse=True)
    activity = activity[:15]

    # ── KPIs ─────────────────────────────────────────────────────────────
    active_journeys = sum(1 for j in journeys if j.status in ("in_progress", "not_started"))
    completed_journeys = sum(1 for j in journeys if j.status == "completed")
    applicable_total = total_controls_all - not_applicable_all
    avg_completion = round(
        (implemented_all / applicable_total * 100) if applicable_total > 0 else 0, 1
    )
    avg_readiness = round(
        (readiness_sum / readiness_count) if readiness_count > 0 else 0, 1
    )

    kpis = {
        "active_journeys": active_journeys,
        "completed_journeys": completed_journeys,
        "total_journeys": len(journeys),
        "total_controls": total_controls_all,
        "implemented": implemented_all,
        "verified": verified_all,
        "in_progress": in_progress_all,
        "not_started": not_started_all,
        "not_applicable": not_applicable_all,
        "approved_evidence_count": approved_evidence_all,
        "avg_completion_pct": avg_completion,
        "avg_readiness_pct": avg_readiness,
        "open_gaps": not_started_all + in_progress_all,
    }

    return {
        "kpis": kpis,
        "status_mix": status_mix,
        "by_framework": by_framework,
        "by_domain": by_domain,
        "recent_activity": activity,
    }
