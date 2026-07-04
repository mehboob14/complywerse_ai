from typing import Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, or_

from ....models import (
    PolicyStatement, PolicyStatementCompliance, GovernanceDocument,
    CertificationJourney, ControlImplementation, ImplementationEvidence,
    UploadedFramework, ParsedFrameworkControl, FrameworkControl,
    GRCUser, get_db, ComplianceHistory,
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


@router.get("/compliance-trend")
def get_compliance_trend(
    days: int = 30,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Tenant-wide compliance trend over time for the frameworks dashboard.

    Aggregates the per-journey ``grc_compliance_history`` snapshots into one
    controls-weighted daily series (completion % + readiness %), filtered to the
    requested window. ``days`` accepts 7 / 15 / 30 / 365 (or any positive int);
    the series fills in as snapshots accumulate."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"days": days, "trend": []}
    try:
        days = max(1, min(int(days), 3650))
    except (TypeError, ValueError):
        days = 30
    cutoff = datetime.utcnow() - timedelta(days=days)
    try:
        rows = db.query(ComplianceHistory).filter(
            ComplianceHistory.tenant_id.in_(user_tenants),
            ComplianceHistory.snapshot_day >= cutoff,
        ).order_by(ComplianceHistory.snapshot_day.asc()).all()
    except Exception:  # noqa: BLE001 — history table may not exist yet
        db.rollback()
        return {"days": days, "trend": []}

    by_day: dict = {}
    for r in rows:
        key = r.snapshot_day.strftime("%Y-%m-%d")
        agg = by_day.setdefault(key, {
            "label": r.snapshot_day.strftime("%b %d"), "comp_w": 0.0, "ready_w": 0.0, "w": 0,
        })
        weight = int(r.total_controls or 0) or 1
        agg["comp_w"] += float(r.completion_pct or 0) * weight
        agg["ready_w"] += float(r.readiness_pct or 0) * weight
        agg["w"] += weight

    trend = []
    for key in sorted(by_day):
        a = by_day[key]
        w = a["w"] or 1
        trend.append({
            "label": a["label"],
            "completion": round(a["comp_w"] / w, 1),
            "readiness": round(a["ready_w"] / w, 1),
        })
    return {"days": days, "trend": trend}


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


# ============================================================================
# Compliance module sections-overview — one scored section per compliance page
# (Frameworks · Control Library · Evidence · Assessments · Statements), blended
# into one board-level compliance score. Same shape as the ERM/governance
# dashboards: every metric carries numerator/denominator/weight/formula.
# ============================================================================
from collections import Counter as _CCounter
from sqlalchemy.exc import SQLAlchemyError as _SQLErr


def _cm(key, label, weight, num, den, formula, inverse=False, empty_score=None):
    if den:
        pct = (num / den) * 100
        score = round(100 - pct, 1) if inverse else round(pct, 1)
    else:
        score = empty_score
    return {"key": key, "label": label, "weight": weight, "score": score,
            "numerator": round(num, 1) if isinstance(num, float) else num,
            "denominator": round(den, 1) if isinstance(den, float) else den,
            "formula": formula, "inverse": inverse, "target": 85}


def _sec_score(metrics):
    avail = [m for m in metrics if m["score"] is not None]
    tw = sum(m["weight"] for m in avail)
    return round(sum(m["score"] * m["weight"] for m in avail) / tw, 1) if avail and tw else None




@router.get("/sections-overview")
def get_compliance_sections_overview(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Compliance module board view — one scored section per Compliance nav page:
    Frameworks · Controls · Evidence · Control Library."""
    from collections import Counter as _CCounter
    from sqlalchemy.exc import SQLAlchemyError as _SQLErr
    from ....models import (
        Evidence, EvidenceControlMapping, NormalizedControl, NormalizationRun,
        NormalizedControlLink, FrameworkControlAlignment, ClauseApplicability,
        ControlEvidenceRequirement,
    )
    user_tenants = get_user_tenants(current_user, db)
    scoped = [tenant_id] if (tenant_id and tenant_id in user_tenants) else user_tenants
    now = datetime.utcnow()
    if not scoped:
        return {"as_of": now.isoformat(), "sections": {}, "attention_queue": {},
                "performance": {"score": None, "grade": None, "components": []}}

    # ---------- Frameworks (upload → publish pipeline) ----------
    try:
        ufs = db.query(UploadedFramework.id, UploadedFramework.upload_status,
                       UploadedFramework.published_framework_id).filter(
            UploadedFramework.tenant_id.in_(scoped)).all()
    except _SQLErr:
        db.rollback(); ufs = []
    uf_ids = [r.id for r in ufs]
    uf_total = len(ufs)
    uf_published = sum(1 for r in ufs if r.published_framework_id or r.upload_status == "published")
    uf_failed = sum(1 for r in ufs if r.upload_status in ("failed", "error"))
    uf_parsed = sum(1 for r in ufs if r.upload_status in ("parsed", "classified", "published"))
    fw_metrics = [
        _cm("publish_rate", "Published to library", 0.45, uf_published, uf_total,
            "uploaded frameworks published / all uploaded frameworks"),
        _cm("parse_progress", "Parsed", 0.30, uf_parsed, uf_total,
            "uploaded frameworks parsed or beyond / all uploaded frameworks"),
        _cm("parse_health", "Parse health", 0.25, uf_failed, uf_total,
            "1 - (failed parses / all uploaded frameworks)", inverse=True, empty_score=100),
    ]

    # ---------- Controls (parsed framework controls: verify, evidence, align, applicability) ----------
    try:
        pfc = db.query(ParsedFrameworkControl.id, ParsedFrameworkControl.is_verified).filter(
            ParsedFrameworkControl.uploaded_framework_id.in_(uf_ids)).all() if uf_ids else []
        pfc_ids = {r.id for r in pfc}
        ev_pfc = {x[0] for x in db.query(EvidenceControlMapping.parsed_control_id).filter(
            EvidenceControlMapping.parsed_control_id.isnot(None)).all()}
        aligned_pfc = {x[0] for x in db.query(FrameworkControlAlignment.parsed_control_id).all()}
        applic = db.query(ClauseApplicability.control_id, ClauseApplicability.status).filter(
            ClauseApplicability.uploaded_framework_id.in_(uf_ids)).all() if uf_ids else []
        cer = db.query(ControlEvidenceRequirement.status,
                       ControlEvidenceRequirement.is_mandatory).filter(
            ControlEvidenceRequirement.parsed_control_id.in_(pfc_ids)).all() if pfc_ids else []
    except _SQLErr:
        db.rollback(); pfc, pfc_ids, ev_pfc, aligned_pfc, applic, cer = [], set(), set(), set(), [], []
    pfc_total = len(pfc)
    pfc_verified = sum(1 for r in pfc if r.is_verified)
    pfc_with_ev = len(ev_pfc & pfc_ids)
    pfc_aligned = len(aligned_pfc & pfc_ids)
    applic_decided = sum(1 for c in applic if c.status in ("approved", "rejected"))
    cer_mandatory = [r for r in cer if r.is_mandatory]
    cer_satisfied = sum(1 for r in cer_mandatory if r.status == "approved")
    ctrl_metrics = [
        _cm("evidence_coverage", "Controls with evidence", 0.25, pfc_with_ev, pfc_total,
            "framework controls with >=1 linked evidence / all framework controls"),
        _cm("requirements_satisfied", "Required evidence approved", 0.25, cer_satisfied, len(cer_mandatory),
            "mandatory evidence requirements approved / all mandatory evidence requirements"),
        _cm("verified", "Verified", 0.20, pfc_verified, pfc_total,
            "framework controls verified / all framework controls"),
        _cm("library_aligned", "Aligned to library", 0.20, pfc_aligned, pfc_total,
            "framework controls aligned to the unified library / all framework controls"),
        _cm("applicability", "Applicability decided", 0.10, applic_decided, pfc_total,
            "framework controls with an approved/rejected applicability decision / all"),
    ]

    # ---------- Evidence (the evidence library) ----------
    try:
        ev = db.query(Evidence.status, Evidence.is_stale, Evidence.id,
                      Evidence.ocr_status).filter(Evidence.tenant_id.in_(scoped)).all()
        linked_ev = {x[0] for x in db.query(EvidenceControlMapping.evidence_id).all()}
    except _SQLErr:
        db.rollback(); ev, linked_ev = [], set()
    ev_total = len(ev)
    ev_approved = sum(1 for e in ev if e.status == "approved")
    ev_stale = sum(1 for e in ev if e.is_stale)
    ev_linked = sum(1 for e in ev if e.id in linked_ev)
    ev_ocr_universe = [e for e in ev if e.ocr_status in ("pending", "completed", "processing", "failed")]
    ev_ocr_done = sum(1 for e in ev_ocr_universe if e.ocr_status == "completed")
    ev_metrics = [
        _cm("approval_rate", "Approved", 0.30, ev_approved, ev_total,
            "approved evidence / all evidence"),
        _cm("freshness", "Fresh (not stale)", 0.25, ev_stale, ev_total,
            "1 - (stale evidence / all evidence)", inverse=True, empty_score=100),
        _cm("ocr_processed", "OCR processed", 0.20, ev_ocr_done, len(ev_ocr_universe),
            "evidence with OCR completed / evidence needing OCR (machine-readable for AI mapping)"),
        _cm("linked", "Linked to controls", 0.25, ev_linked, ev_total,
            "evidence mapped to >=1 control / all evidence"),
    ]

    # ---------- Control Library (unified/normalized library quality) ----------
    try:
        base = db.query(NormalizationRun).filter(
            NormalizationRun.tenant_id.in_(scoped), NormalizationRun.is_baseline == True  # noqa: E712
        ).order_by(NormalizationRun.id.desc()).first()
        if base:
            nc = db.query(NormalizedControl.id, NormalizedControl.review_status,
                          NormalizedControl.recommended_evidence).filter(
                NormalizedControl.run_id == base.id).all()
            nc_ids = {r.id for r in nc}
            total_nc = len(nc)
            approved_nc = sum(1 for r in nc if r.review_status == "approved")
            rec_nc = sum(1 for r in nc if r.recommended_evidence not in (None, [], {}, ""))
            lk = _CCounter(x[0] for x in db.query(NormalizedControlLink.normalized_control_id).all() if x[0] in nc_ids)
            mapped_nc = len(lk); unified_nc = sum(1 for v in lk.values() if v >= 2)
            source_total = sum(lk.values())  # raw framework requirements feeding the library
            covered_nc = len({n for (_e, n) in db.query(
                EvidenceControlMapping.evidence_id, EvidenceControlMapping.normalized_control_id).all()
                if n in nc_ids})
        else:
            total_nc = rec_nc = mapped_nc = unified_nc = source_total = covered_nc = 0
    except _SQLErr:
        db.rollback(); base = None; total_nc = rec_nc = mapped_nc = unified_nc = source_total = covered_nc = 0
    # Board-level library value: how much effort normalization saves (consolidation
    # + deduplication) and whether the library is actually operational (evidence).
    # Dropped "Framework-mapped" and "Approved" — on a locked, curated baseline both
    # are 100% by construction, so they told a leader nothing and inflated the score.
    cl_metrics = [
        _cm("consolidation", "Consolidated into sets", 0.30, unified_nc, total_nc,
            "normalized controls unifying >=2 framework requirements / all (cross-framework reuse breadth)"),
        _cm("dedup_savings", "Deduplication savings", 0.25, total_nc, source_total,
            "1 - (managed controls / source framework requirements) = requirements collapsed by normalization",
            inverse=True),
        _cm("evidence_recommended", "Evidence-ready", 0.25, rec_nc, total_nc,
            "normalized controls that specify their required evidence / all (library knows what each control needs)"),
        _cm("evidence_coverage", "Evidence-backed", 0.20, covered_nc, total_nc,
            "normalized controls with >=1 linked evidence artifact / all (evidence actually collected)"),
    ]

    sections = {
        "frameworks": {"key": "frameworks", "label": "Frameworks", "weight": 0.25,
                       "score": _sec_score(fw_metrics), "metrics": fw_metrics,
                       "counts": {"uploaded": uf_total, "published": uf_published,
                                  "failed": uf_failed}},
        "controls": {"key": "controls", "label": "Controls", "weight": 0.25,
                     "score": _sec_score(ctrl_metrics), "metrics": ctrl_metrics,
                     "counts": {"total": pfc_total, "verified": pfc_verified,
                                "with_evidence": pfc_with_ev, "aligned": pfc_aligned}},
        "evidence": {"key": "evidence", "label": "Evidence", "weight": 0.25,
                     "score": _sec_score(ev_metrics), "metrics": ev_metrics,
                     "counts": {"total": ev_total, "approved": ev_approved,
                                "stale": ev_stale, "linked": ev_linked}},
        "control_library": {"key": "control_library", "label": "Control Library", "weight": 0.25,
                            "score": _sec_score(cl_metrics), "metrics": cl_metrics,
                            "counts": {"controls": total_nc, "unified": unified_nc,
                                       "standalone": total_nc - unified_nc,
                                       "baseline": base.label if base else None}},
    }

    components = [{"key": s["key"], "label": s["label"], "score": s["score"],
                   "weight": s["weight"], "target": 85} for s in sections.values()]
    scored = [c for c in components if c["score"] is not None]
    wsum = sum(c["weight"] for c in scored)
    perf = round(sum(c["score"] * c["weight"] for c in scored) / wsum, 1) if scored and wsum else None
    grade = (None if perf is None else "excellent" if perf >= 85 else "good" if perf >= 70
             else "fair" if perf >= 50 else "poor")

    return {
        "as_of": now.isoformat(),
        "sections": sections,
        "attention_queue": {
            # Non-overlapping actionable buckets (a control gap is counted once).
            "frameworks_unpublished": uf_total - uf_published,
            "controls_without_evidence": (pfc_total - pfc_with_ev) if pfc_total else 0,
            "controls_unverified": (pfc_total - pfc_verified) if pfc_total else 0,
            "evidence_stale": ev_stale,
            "total": ((uf_total - uf_published)
                      + ((pfc_total - pfc_with_ev) if pfc_total else 0) + ev_stale),
        },
        "performance": {
            "score": perf, "grade": grade,
            "formula": "weighted mean of section scores: frameworks 25% + controls 25% + evidence 25% + control library 25%",
            "components": components,
        },
    }
