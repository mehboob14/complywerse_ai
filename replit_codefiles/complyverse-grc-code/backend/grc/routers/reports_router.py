from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
from io import BytesIO
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
import openpyxl

from ..models import (
    Risk, RiskMitigationAction, RiskKRI, RiskKRIMeasurement, RiskIncident,
    Evidence, EvidenceAIAssessment, EvidenceControlMapping,
    GovernanceDocument, PolicyGapFinding, PolicyGapAnalysisRun,
    AttestationCampaign, AttestationRequest,
    RegulatoryChange, GovernanceCommittee, OversightAction, CommitteeMeeting,
    ITAsset, AssetRiskAssessment,
    UploadedFramework, ParsedFrameworkControl, ClauseApplicability,
    ComplianceAssessmentDocument, ComplianceAssessmentDocumentItem,
    InternalControl, Vulnerability,
    GRCUser, Tenant, get_db
)
from .auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/reports", tags=["Reports"])


def _now_iso():
    return datetime.utcnow().isoformat()


def _apply_tenant_filter(query, model, user_tenants: List[int], tenant_id: Optional[int]):
    query = query.filter(model.tenant_id.in_(user_tenants))
    if tenant_id:
        query = query.filter(model.tenant_id == tenant_id)
    return query


def _apply_date_filter(query, date_col, date_from: Optional[str], date_to: Optional[str]):
    if date_from:
        try:
            query = query.filter(date_col >= datetime.fromisoformat(date_from))
        except (ValueError, TypeError):
            pass
    if date_to:
        try:
            query = query.filter(date_col <= datetime.fromisoformat(date_to))
        except (ValueError, TypeError):
            pass
    return query


def _dt(val):
    return val.isoformat() if val else None


def _make_excel(headers: List[str], rows: List[List], sheet_name: str = "Report") -> BytesIO:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet_name
    ws.append(headers)
    for row in rows:
        ws.append([str(v) if v is not None and not isinstance(v, (int, float)) else v for v in row])
    for col_idx, _ in enumerate(headers, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(col_idx)].width = 20
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


def _excel_response(buf: BytesIO, filename: str):
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# =============================================================================
# 1. RISK MANAGEMENT REPORTS
# =============================================================================

def _risk_register_summary(db: Session, user_tenants, tenant_id, date_from, date_to):
    q = _apply_tenant_filter(db.query(Risk), Risk, user_tenants, tenant_id)
    q = _apply_date_filter(q, Risk.created_at, date_from, date_to)
    risks = q.order_by(Risk.created_at.desc()).all()

    by_status = {}
    by_category = {}
    total_inherent = 0
    total_residual = 0
    scored = 0
    for r in risks:
        s = r.status or "open"
        by_status[s] = by_status.get(s, 0) + 1
        c = r.risk_category or r.category or "other"
        by_category[c] = by_category.get(c, 0) + 1
        if r.inherent_score:
            total_inherent += r.inherent_score
            scored += 1
        if r.residual_score:
            total_residual += r.residual_score

    owner_cache = {}
    def _owner_name(oid):
        if not oid:
            return None
        if oid not in owner_cache:
            u = db.query(GRCUser).filter(GRCUser.id == oid).first()
            owner_cache[oid] = u.display_name if u else None
        return owner_cache[oid]

    data = [{
        "id": r.id, "title": r.title, "category": r.risk_category or r.category,
        "sub_category": r.risk_sub_category, "status": r.status,
        "owner": _owner_name(r.owner_id),
        "inherent_likelihood": r.inherent_likelihood, "inherent_impact": r.inherent_impact,
        "inherent_score": r.inherent_score,
        "residual_likelihood": r.residual_likelihood, "residual_impact": r.residual_impact,
        "residual_score": r.residual_score,
        "treatment_plan": r.treatment_plan, "due_date": _dt(r.due_date),
        "review_date": _dt(r.review_date), "created_at": _dt(r.created_at)
    } for r in risks]

    return {
        "report_name": "Risk Register Summary",
        "generated_at": _now_iso(),
        "filters": {"tenant_id": tenant_id, "date_from": date_from, "date_to": date_to},
        "summary": {
            "total_risks": len(risks),
            "by_status": by_status,
            "by_category": by_category,
            "avg_inherent_score": round(total_inherent / scored, 2) if scored else 0,
            "avg_residual_score": round(total_residual / scored, 2) if scored else 0,
        },
        "data": data,
    }


@router.get("/risk/register-summary")
def risk_register_summary(
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"report_name": "Risk Register Summary", "generated_at": _now_iso(), "filters": {}, "summary": {}, "data": []}
    return _risk_register_summary(db, user_tenants, tenant_id, date_from, date_to)


def _risk_heatmap(db: Session, user_tenants, tenant_id, date_from, date_to):
    q = _apply_tenant_filter(db.query(Risk), Risk, user_tenants, tenant_id)
    q = _apply_date_filter(q, Risk.created_at, date_from, date_to)
    risks = q.all()

    cells: Dict[str, Any] = {}
    for r in risks:
        lk = r.inherent_likelihood or 0
        im = r.inherent_impact or 0
        if lk > 0 and im > 0:
            key = f"{lk}-{im}"
            if key not in cells:
                cells[key] = {"likelihood": lk, "impact": im, "count": 0, "risks": []}
            cells[key]["count"] += 1
            cells[key]["risks"].append({"id": r.id, "title": r.title, "score": r.inherent_score})

    data = list(cells.values())
    return {
        "report_name": "Risk Heatmap Data",
        "generated_at": _now_iso(),
        "filters": {"tenant_id": tenant_id, "date_from": date_from, "date_to": date_to},
        "summary": {"total_risks_plotted": sum(c["count"] for c in data), "cells": len(data)},
        "data": data,
    }


@router.get("/risk/heatmap")
def risk_heatmap(
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"report_name": "Risk Heatmap Data", "generated_at": _now_iso(), "filters": {}, "summary": {}, "data": []}
    return _risk_heatmap(db, user_tenants, tenant_id, date_from, date_to)


def _risk_treatment_status(db: Session, user_tenants, tenant_id, date_from, date_to):
    risk_ids = [r.id for r in _apply_tenant_filter(db.query(Risk.id), Risk, user_tenants, tenant_id).all()]
    if not risk_ids:
        return {"report_name": "Treatment/Mitigation Status", "generated_at": _now_iso(), "filters": {}, "summary": {"total_actions": 0}, "data": []}

    q = db.query(RiskMitigationAction).filter(RiskMitigationAction.risk_id.in_(risk_ids))
    q = _apply_date_filter(q, RiskMitigationAction.created_at, date_from, date_to)
    actions = q.all()

    by_status = {}
    by_priority = {}
    for a in actions:
        s = a.status or "open"
        by_status[s] = by_status.get(s, 0) + 1
        p = a.priority or "medium"
        by_priority[p] = by_priority.get(p, 0) + 1

    data = [{
        "id": a.id, "risk_id": a.risk_id, "title": a.title,
        "status": a.status, "priority": a.priority,
        "due_date": _dt(a.due_date), "completed_at": _dt(a.completed_at),
        "created_at": _dt(a.created_at),
    } for a in actions]

    return {
        "report_name": "Treatment/Mitigation Status",
        "generated_at": _now_iso(),
        "filters": {"tenant_id": tenant_id, "date_from": date_from, "date_to": date_to},
        "summary": {"total_actions": len(actions), "by_status": by_status, "by_priority": by_priority},
        "data": data,
    }


@router.get("/risk/treatment-status")
def risk_treatment_status(
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"report_name": "Treatment/Mitigation Status", "generated_at": _now_iso(), "filters": {}, "summary": {}, "data": []}
    return _risk_treatment_status(db, user_tenants, tenant_id, date_from, date_to)


def _risk_accepted(db: Session, user_tenants, tenant_id, date_from, date_to):
    q = _apply_tenant_filter(db.query(Risk), Risk, user_tenants, tenant_id)
    q = q.filter((Risk.status == "accepted") | (Risk.risk_appetite == "accept"))
    q = _apply_date_filter(q, Risk.created_at, date_from, date_to)
    risks = q.all()

    data = [{
        "id": r.id, "title": r.title, "category": r.risk_category or r.category,
        "status": r.status, "inherent_score": r.inherent_score,
        "residual_score": r.residual_score,
        "treatment_plan": r.treatment_plan,
        "gap_finding_id": r.gap_finding_id,
        "created_at": _dt(r.created_at),
    } for r in risks]

    return {
        "report_name": "Accepted Risks Report",
        "generated_at": _now_iso(),
        "filters": {"tenant_id": tenant_id, "date_from": date_from, "date_to": date_to},
        "summary": {"total_accepted": len(risks), "with_gap_finding": sum(1 for r in risks if r.gap_finding_id)},
        "data": data,
    }


@router.get("/risk/accepted-risks")
def risk_accepted(
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"report_name": "Accepted Risks Report", "generated_at": _now_iso(), "filters": {}, "summary": {}, "data": []}
    return _risk_accepted(db, user_tenants, tenant_id, date_from, date_to)


def _kri_status(db: Session, user_tenants, tenant_id, date_from, date_to):
    risk_ids = [r.id for r in _apply_tenant_filter(db.query(Risk.id), Risk, user_tenants, tenant_id).all()]
    if not risk_ids:
        return {"report_name": "KRI Status Report", "generated_at": _now_iso(), "filters": {}, "summary": {"total_kris": 0}, "data": []}

    kris = db.query(RiskKRI).filter(RiskKRI.risk_id.in_(risk_ids)).all()

    def _kri_rag(k):
        if k.current_value is None:
            return "no_data"
        val = k.current_value
        if k.threshold_direction == "higher_is_better":
            if k.green_threshold and val >= k.green_threshold:
                return "green"
            if k.amber_threshold and val >= k.amber_threshold:
                return "amber"
            return "red"
        else:
            if k.green_threshold and val <= k.green_threshold:
                return "green"
            if k.amber_threshold and val <= k.amber_threshold:
                return "amber"
            return "red"

    rag_counts = {"green": 0, "amber": 0, "red": 0, "no_data": 0}
    data = []
    for k in kris:
        rag = _kri_rag(k)
        rag_counts[rag] = rag_counts.get(rag, 0) + 1
        data.append({
            "id": k.id, "risk_id": k.risk_id, "name": k.name,
            "metric_type": k.metric_type, "current_value": k.current_value,
            "green_threshold": k.green_threshold, "amber_threshold": k.amber_threshold,
            "rag_status": rag, "frequency": k.frequency,
            "last_measured_at": _dt(k.last_measured_at),
        })

    return {
        "report_name": "KRI Status Report",
        "generated_at": _now_iso(),
        "filters": {"tenant_id": tenant_id},
        "summary": {"total_kris": len(kris), "by_rag": rag_counts},
        "data": data,
    }


@router.get("/risk/kri-status")
def kri_status(
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"report_name": "KRI Status Report", "generated_at": _now_iso(), "filters": {}, "summary": {}, "data": []}
    return _kri_status(db, user_tenants, tenant_id, date_from, date_to)


@router.get("/risk/export")
def risk_export(
    report_type: str = Query("register-summary"),
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        user_tenants = []

    funcs = {
        "register-summary": _risk_register_summary,
        "heatmap": _risk_heatmap,
        "treatment-status": _risk_treatment_status,
        "accepted-risks": _risk_accepted,
        "kri-status": _kri_status,
    }
    fn = funcs.get(report_type, _risk_register_summary)
    report = fn(db, user_tenants, tenant_id, date_from, date_to)
    rows_data = report.get("data", [])
    if not rows_data:
        headers = ["No Data"]
        rows = []
    else:
        headers = list(rows_data[0].keys())
        rows = [[r.get(h) for h in headers] for r in rows_data]
    buf = _make_excel(headers, rows, report.get("report_name", "Report"))
    return _excel_response(buf, f"risk_{report_type}.xlsx")


# =============================================================================
# 2. COMPLIANCE & FRAMEWORKS REPORTS
# =============================================================================

def _framework_status(db: Session, user_tenants, tenant_id, date_from, date_to):
    q = _apply_tenant_filter(db.query(PolicyGapAnalysisRun), PolicyGapAnalysisRun, user_tenants, tenant_id)
    q = q.filter(PolicyGapAnalysisRun.status == "completed")
    q = _apply_date_filter(q, PolicyGapAnalysisRun.started_at, date_from, date_to)
    runs = q.order_by(PolicyGapAnalysisRun.started_at.desc()).all()

    data = [{
        "id": r.id, "framework_name": r.framework_name,
        "document_id": r.document_id,
        "total_clauses": r.total_clauses_analyzed,
        "fully_compliant": r.fully_compliant_count,
        "partially_compliant": r.partially_compliant_count,
        "not_addressed": r.not_addressed_count,
        "not_applicable": r.not_applicable_count,
        "compliance_percentage": r.compliance_percentage,
        "completed_at": _dt(r.completed_at),
    } for r in runs]

    avg_score = round(sum(r.compliance_percentage or 0 for r in runs) / len(runs), 2) if runs else 0

    return {
        "report_name": "Framework Compliance Status",
        "generated_at": _now_iso(),
        "filters": {"tenant_id": tenant_id, "date_from": date_from, "date_to": date_to},
        "summary": {"total_runs": len(runs), "avg_compliance_percentage": avg_score},
        "data": data,
    }


@router.get("/compliance/framework-status")
def compliance_framework_status(
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"report_name": "Framework Compliance Status", "generated_at": _now_iso(), "filters": {}, "summary": {}, "data": []}
    return _framework_status(db, user_tenants, tenant_id, date_from, date_to)


def _control_implementation(db: Session, user_tenants, tenant_id, date_from, date_to):
    q = db.query(EvidenceControlMapping)
    ev_ids = [e.id for e in _apply_tenant_filter(db.query(Evidence.id), Evidence, user_tenants, tenant_id).all()]
    if not ev_ids:
        return {"report_name": "Control Implementation Status", "generated_at": _now_iso(), "filters": {}, "summary": {"total_mappings": 0}, "data": []}
    q = q.filter(EvidenceControlMapping.evidence_id.in_(ev_ids))
    mappings = q.all()

    by_coverage = {}
    for m in mappings:
        ct = m.coverage_type or "unknown"
        by_coverage[ct] = by_coverage.get(ct, 0) + 1

    data = [{
        "id": m.id, "evidence_id": m.evidence_id,
        "normalized_control_id": m.normalized_control_id,
        "framework_control_id": m.framework_control_id,
        "parsed_control_id": m.parsed_control_id,
        "coverage_type": m.coverage_type,
        "confidence_score": m.confidence_score,
        "framework_name": m.framework_name,
        "control_code": m.control_code,
        "created_at": _dt(m.created_at),
    } for m in mappings]

    return {
        "report_name": "Control Implementation Status",
        "generated_at": _now_iso(),
        "filters": {"tenant_id": tenant_id},
        "summary": {"total_mappings": len(mappings), "by_coverage_type": by_coverage},
        "data": data,
    }


@router.get("/compliance/control-implementation")
def compliance_control_implementation(
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"report_name": "Control Implementation Status", "generated_at": _now_iso(), "filters": {}, "summary": {}, "data": []}
    return _control_implementation(db, user_tenants, tenant_id, date_from, date_to)


def _assessment_results(db: Session, user_tenants, tenant_id, date_from, date_to):
    q = _apply_tenant_filter(db.query(ComplianceAssessmentDocument), ComplianceAssessmentDocument, user_tenants, tenant_id)
    q = _apply_date_filter(q, ComplianceAssessmentDocument.created_at, date_from, date_to)
    docs = q.order_by(ComplianceAssessmentDocument.created_at.desc()).all()

    data = [{
        "id": d.id, "name": d.name, "assessment_type": d.assessment_type,
        "source": d.source, "status": d.status,
        "overall_score": d.overall_score,
        "total_items": d.total_items,
        "complied": d.complied_count,
        "partially_complied": d.partially_complied_count,
        "not_complied": d.not_complied_count,
        "in_progress": d.in_progress_count,
        "na": d.na_count,
        "created_at": _dt(d.created_at),
    } for d in docs]

    return {
        "report_name": "Assessment Results Summary",
        "generated_at": _now_iso(),
        "filters": {"tenant_id": tenant_id, "date_from": date_from, "date_to": date_to},
        "summary": {
            "total_assessments": len(docs),
            "avg_score": round(sum(d.overall_score or 0 for d in docs) / len(docs), 2) if docs else 0,
        },
        "data": data,
    }


@router.get("/compliance/assessment-results")
def compliance_assessment_results(
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"report_name": "Assessment Results Summary", "generated_at": _now_iso(), "filters": {}, "summary": {}, "data": []}
    return _assessment_results(db, user_tenants, tenant_id, date_from, date_to)


def _applicability(db: Session, user_tenants, tenant_id, date_from, date_to):
    q = _apply_tenant_filter(db.query(ClauseApplicability), ClauseApplicability, user_tenants, tenant_id)
    items = q.all()

    applicable_count = sum(1 for i in items if i.is_applicable)
    excluded_count = sum(1 for i in items if not i.is_applicable)

    by_framework: Dict[int, Dict[str, int]] = {}
    for i in items:
        fid = i.uploaded_framework_id
        if fid not in by_framework:
            by_framework[fid] = {"applicable": 0, "excluded": 0}
        if i.is_applicable:
            by_framework[fid]["applicable"] += 1
        else:
            by_framework[fid]["excluded"] += 1

    data = [{
        "id": i.id, "uploaded_framework_id": i.uploaded_framework_id,
        "control_id": i.control_id, "is_applicable": i.is_applicable,
        "justification": i.justification, "status": i.status,
        "created_at": _dt(i.created_at),
    } for i in items]

    return {
        "report_name": "Applicability Statement Report",
        "generated_at": _now_iso(),
        "filters": {"tenant_id": tenant_id},
        "summary": {
            "total_controls": len(items),
            "applicable": applicable_count,
            "excluded": excluded_count,
            "by_framework": by_framework,
        },
        "data": data,
    }


@router.get("/compliance/applicability")
def compliance_applicability(
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"report_name": "Applicability Statement Report", "generated_at": _now_iso(), "filters": {}, "summary": {}, "data": []}
    return _applicability(db, user_tenants, tenant_id, date_from, date_to)


@router.get("/compliance/export")
def compliance_export(
    report_type: str = Query("framework-status"),
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        user_tenants = []
    funcs = {
        "framework-status": _framework_status,
        "control-implementation": _control_implementation,
        "assessment-results": _assessment_results,
        "applicability": _applicability,
    }
    fn = funcs.get(report_type, _framework_status)
    report = fn(db, user_tenants, tenant_id, date_from, date_to)
    rows_data = report.get("data", [])
    if not rows_data:
        headers = ["No Data"]
        rows = []
    else:
        headers = list(rows_data[0].keys())
        rows = [[r.get(h) for h in headers] for r in rows_data]
    buf = _make_excel(headers, rows, report.get("report_name", "Report"))
    return _excel_response(buf, f"compliance_{report_type}.xlsx")


# =============================================================================
# 3. GOVERNANCE & POLICY REPORTS
# =============================================================================

def _gap_analysis_summary(db: Session, user_tenants, tenant_id, date_from, date_to):
    q = _apply_tenant_filter(db.query(PolicyGapFinding), PolicyGapFinding, user_tenants, tenant_id)
    q = _apply_date_filter(q, PolicyGapFinding.created_at, date_from, date_to)
    findings = q.order_by(PolicyGapFinding.created_at.desc()).all()

    by_framework = {}
    by_severity = {}
    by_status = {}
    for f in findings:
        fw = f.framework_name or "Unknown"
        by_framework[fw] = by_framework.get(fw, 0) + 1
        sev = f.risk_severity or "medium"
        by_severity[sev] = by_severity.get(sev, 0) + 1
        st = f.remediation_status or "open"
        by_status[st] = by_status.get(st, 0) + 1

    data = [{
        "id": f.id, "document_id": f.document_id,
        "framework_name": f.framework_name,
        "clause_reference": f.clause_reference, "clause_title": f.clause_title,
        "compliance_status": f.compliance_status,
        "gap_description": f.gap_description,
        "risk_severity": f.risk_severity,
        "remediation_status": f.remediation_status,
        "risk_accepted": f.risk_accepted,
        "created_at": _dt(f.created_at),
    } for f in findings]

    return {
        "report_name": "Gap Analysis Summary",
        "generated_at": _now_iso(),
        "filters": {"tenant_id": tenant_id, "date_from": date_from, "date_to": date_to},
        "summary": {
            "total_findings": len(findings),
            "by_framework": by_framework,
            "by_severity": by_severity,
            "by_status": by_status,
        },
        "data": data,
    }


@router.get("/governance/gap-analysis-summary")
def governance_gap_analysis_summary(
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"report_name": "Gap Analysis Summary", "generated_at": _now_iso(), "filters": {}, "summary": {}, "data": []}
    return _gap_analysis_summary(db, user_tenants, tenant_id, date_from, date_to)


def _policy_status(db: Session, user_tenants, tenant_id, date_from, date_to):
    q = _apply_tenant_filter(db.query(GovernanceDocument), GovernanceDocument, user_tenants, tenant_id)
    q = _apply_date_filter(q, GovernanceDocument.created_at, date_from, date_to)
    docs = q.order_by(GovernanceDocument.created_at.desc()).all()

    by_status = {}
    by_type = {}
    for d in docs:
        s = d.status or "draft"
        by_status[s] = by_status.get(s, 0) + 1
        t = d.doc_type or "other"
        by_type[t] = by_type.get(t, 0) + 1

    owner_cache = {}
    def _owner_name(oid):
        if not oid:
            return None
        if oid not in owner_cache:
            u = db.query(GRCUser).filter(GRCUser.id == oid).first()
            owner_cache[oid] = u.display_name if u else None
        return owner_cache[oid]

    data = [{
        "id": d.id, "title": d.title, "doc_type": d.doc_type,
        "status": d.status, "version": d.current_version,
        "owner": _owner_name(d.owner_id),
        "effective_date": _dt(d.effective_date),
        "next_review_date": _dt(d.next_review_date),
        "expiry_date": _dt(d.expiry_date),
        "created_at": _dt(d.created_at), "updated_at": _dt(d.updated_at),
    } for d in docs]

    return {
        "report_name": "Policy Document Status",
        "generated_at": _now_iso(),
        "filters": {"tenant_id": tenant_id, "date_from": date_from, "date_to": date_to},
        "summary": {"total_documents": len(docs), "by_status": by_status, "by_type": by_type},
        "data": data,
    }


@router.get("/governance/policy-status")
def governance_policy_status(
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"report_name": "Policy Document Status", "generated_at": _now_iso(), "filters": {}, "summary": {}, "data": []}
    return _policy_status(db, user_tenants, tenant_id, date_from, date_to)


def _attestation_tracking(db: Session, user_tenants, tenant_id, date_from, date_to):
    q = _apply_tenant_filter(db.query(AttestationCampaign), AttestationCampaign, user_tenants, tenant_id)
    q = _apply_date_filter(q, AttestationCampaign.created_at, date_from, date_to)
    campaigns = q.order_by(AttestationCampaign.created_at.desc()).all()

    data = []
    for c in campaigns:
        requests = db.query(AttestationRequest).filter(AttestationRequest.campaign_id == c.id).all()
        total_req = len(requests)
        completed = sum(1 for r in requests if r.status == "completed")
        pending = sum(1 for r in requests if r.status == "pending")
        overdue = sum(1 for r in requests if r.status == "overdue")
        escalated = sum(1 for r in requests if r.status == "escalated")
        response_rate = round(completed / total_req * 100, 1) if total_req else 0

        data.append({
            "id": c.id, "name": c.name, "campaign_type": c.campaign_type,
            "status": c.status,
            "start_date": _dt(c.start_date), "due_date": _dt(c.due_date),
            "total_requests": total_req, "completed": completed,
            "pending": pending, "overdue": overdue, "escalated": escalated,
            "response_rate": response_rate,
        })

    return {
        "report_name": "Attestation Tracking",
        "generated_at": _now_iso(),
        "filters": {"tenant_id": tenant_id, "date_from": date_from, "date_to": date_to},
        "summary": {
            "total_campaigns": len(campaigns),
            "avg_response_rate": round(sum(d["response_rate"] for d in data) / len(data), 1) if data else 0,
        },
        "data": data,
    }


@router.get("/governance/attestation-tracking")
def governance_attestation_tracking(
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"report_name": "Attestation Tracking", "generated_at": _now_iso(), "filters": {}, "summary": {}, "data": []}
    return _attestation_tracking(db, user_tenants, tenant_id, date_from, date_to)


def _committee_actions(db: Session, user_tenants, tenant_id, date_from, date_to):
    q = _apply_tenant_filter(db.query(OversightAction), OversightAction, user_tenants, tenant_id)
    q = _apply_date_filter(q, OversightAction.created_at, date_from, date_to)
    actions = q.order_by(OversightAction.created_at.desc()).all()

    by_status = {}
    by_committee: Dict[int, int] = {}
    for a in actions:
        s = a.status or "open"
        by_status[s] = by_status.get(s, 0) + 1
        by_committee[a.committee_id] = by_committee.get(a.committee_id, 0) + 1

    committee_cache = {}
    def _committee_name(cid):
        if cid not in committee_cache:
            c = db.query(GovernanceCommittee).filter(GovernanceCommittee.id == cid).first()
            committee_cache[cid] = c.name if c else None
        return committee_cache[cid]

    data = [{
        "id": a.id, "title": a.title, "committee_id": a.committee_id,
        "committee_name": _committee_name(a.committee_id),
        "status": a.status, "priority": getattr(a, 'action_type', None),
        "assigned_to": a.assigned_to,
        "due_date": _dt(a.due_date), "completed_at": _dt(a.completed_at),
        "created_at": _dt(a.created_at),
    } for a in actions]

    return {
        "report_name": "Committee Actions",
        "generated_at": _now_iso(),
        "filters": {"tenant_id": tenant_id, "date_from": date_from, "date_to": date_to},
        "summary": {"total_actions": len(actions), "by_status": by_status},
        "data": data,
    }


@router.get("/governance/committee-actions")
def governance_committee_actions(
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"report_name": "Committee Actions", "generated_at": _now_iso(), "filters": {}, "summary": {}, "data": []}
    return _committee_actions(db, user_tenants, tenant_id, date_from, date_to)


def _regulatory_changes(db: Session, user_tenants, tenant_id, date_from, date_to):
    q = _apply_tenant_filter(db.query(RegulatoryChange), RegulatoryChange, user_tenants, tenant_id)
    q = _apply_date_filter(q, RegulatoryChange.created_at, date_from, date_to)
    changes = q.order_by(RegulatoryChange.created_at.desc()).all()

    by_status = {}
    by_priority = {}
    by_source = {}
    for c in changes:
        s = c.status or "identified"
        by_status[s] = by_status.get(s, 0) + 1
        p = c.priority or "medium"
        by_priority[p] = by_priority.get(p, 0) + 1
        src = c.source or "other"
        by_source[src] = by_source.get(src, 0) + 1

    data = [{
        "id": c.id, "title": c.title, "source": c.source,
        "status": c.status, "priority": c.priority,
        "effective_date": _dt(c.effective_date),
        "created_at": _dt(c.created_at),
    } for c in changes]

    return {
        "report_name": "Regulatory Changes",
        "generated_at": _now_iso(),
        "filters": {"tenant_id": tenant_id, "date_from": date_from, "date_to": date_to},
        "summary": {
            "total_changes": len(changes),
            "by_status": by_status, "by_priority": by_priority, "by_source": by_source,
        },
        "data": data,
    }


@router.get("/governance/regulatory-changes")
def governance_regulatory_changes(
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"report_name": "Regulatory Changes", "generated_at": _now_iso(), "filters": {}, "summary": {}, "data": []}
    return _regulatory_changes(db, user_tenants, tenant_id, date_from, date_to)


@router.get("/governance/export")
def governance_export(
    report_type: str = Query("gap-analysis-summary"),
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        user_tenants = []
    funcs = {
        "gap-analysis-summary": _gap_analysis_summary,
        "policy-status": _policy_status,
        "attestation-tracking": _attestation_tracking,
        "committee-actions": _committee_actions,
        "regulatory-changes": _regulatory_changes,
    }
    fn = funcs.get(report_type, _gap_analysis_summary)
    report = fn(db, user_tenants, tenant_id, date_from, date_to)
    rows_data = report.get("data", [])
    if not rows_data:
        headers = ["No Data"]
        rows = []
    else:
        headers = list(rows_data[0].keys())
        rows = [[r.get(h) for h in headers] for r in rows_data]
    buf = _make_excel(headers, rows, report.get("report_name", "Report"))
    return _excel_response(buf, f"governance_{report_type}.xlsx")


# =============================================================================
# 4. ERM / RCSA REPORTS
# =============================================================================

def _internal_controls(db: Session, user_tenants, tenant_id, date_from, date_to):
    q = _apply_tenant_filter(db.query(InternalControl), InternalControl, user_tenants, tenant_id)
    q = _apply_date_filter(q, InternalControl.created_at, date_from, date_to)
    controls = q.order_by(InternalControl.created_at.desc()).all()

    by_status = {}
    by_effectiveness = {"effective": 0, "partially_effective": 0, "ineffective": 0, "not_tested": 0}
    by_type = {}
    key_controls = 0
    for c in controls:
        s = c.status or "draft"
        by_status[s] = by_status.get(s, 0) + 1
        ct = c.control_type or "preventive"
        by_type[ct] = by_type.get(ct, 0) + 1
        de = c.design_effectiveness or "not_tested"
        by_effectiveness[de] = by_effectiveness.get(de, 0) + 1
        if c.is_key_control:
            key_controls += 1

    data = [{
        "id": c.id, "control_id": c.control_id, "name": c.name,
        "category": c.category, "control_type": c.control_type,
        "control_nature": c.control_nature, "status": c.status,
        "design_effectiveness": c.design_effectiveness,
        "operating_effectiveness": c.operating_effectiveness,
        "is_key_control": c.is_key_control,
        "frequency": c.frequency,
        "last_tested_at": _dt(c.last_tested_at),
        "next_test_date": _dt(c.next_test_date),
        "created_at": _dt(c.created_at),
    } for c in controls]

    return {
        "report_name": "Internal Controls Effectiveness",
        "generated_at": _now_iso(),
        "filters": {"tenant_id": tenant_id, "date_from": date_from, "date_to": date_to},
        "summary": {
            "total_controls": len(controls),
            "key_controls": key_controls,
            "by_status": by_status,
            "by_effectiveness": by_effectiveness,
            "by_type": by_type,
        },
        "data": data,
    }


@router.get("/erm/internal-controls")
def erm_internal_controls(
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"report_name": "Internal Controls Effectiveness", "generated_at": _now_iso(), "filters": {}, "summary": {}, "data": []}
    return _internal_controls(db, user_tenants, tenant_id, date_from, date_to)


def _incidents(db: Session, user_tenants, tenant_id, date_from, date_to):
    q = _apply_tenant_filter(db.query(RiskIncident), RiskIncident, user_tenants, tenant_id)
    q = _apply_date_filter(q, RiskIncident.created_at, date_from, date_to)
    incidents = q.order_by(RiskIncident.created_at.desc()).all()

    by_severity = {}
    by_status = {}
    total_resolution_days = 0
    resolved_count = 0
    for inc in incidents:
        sev = inc.severity or "medium"
        by_severity[sev] = by_severity.get(sev, 0) + 1
        st = inc.status or "open"
        by_status[st] = by_status.get(st, 0) + 1
        if inc.resolved_at and inc.incident_date:
            delta = (inc.resolved_at - inc.incident_date).days
            total_resolution_days += max(delta, 0)
            resolved_count += 1

    data = [{
        "id": inc.id, "title": inc.title, "risk_id": inc.risk_id,
        "severity": inc.severity, "status": inc.status,
        "incident_date": _dt(inc.incident_date),
        "resolved_at": _dt(inc.resolved_at),
        "financial_impact": inc.financial_impact,
        "root_cause": inc.root_cause,
        "created_at": _dt(inc.created_at),
    } for inc in incidents]

    return {
        "report_name": "Incident Summary",
        "generated_at": _now_iso(),
        "filters": {"tenant_id": tenant_id, "date_from": date_from, "date_to": date_to},
        "summary": {
            "total_incidents": len(incidents),
            "by_severity": by_severity,
            "by_status": by_status,
            "avg_resolution_days": round(total_resolution_days / resolved_count, 1) if resolved_count else None,
        },
        "data": data,
    }


@router.get("/erm/incidents")
def erm_incidents(
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"report_name": "Incident Summary", "generated_at": _now_iso(), "filters": {}, "summary": {}, "data": []}
    return _incidents(db, user_tenants, tenant_id, date_from, date_to)


def _kri_dashboard(db: Session, user_tenants, tenant_id, date_from, date_to):
    risk_ids = [r.id for r in _apply_tenant_filter(db.query(Risk.id), Risk, user_tenants, tenant_id).all()]
    if not risk_ids:
        return {"report_name": "KRI Dashboard", "generated_at": _now_iso(), "filters": {}, "summary": {"total_kris": 0}, "data": []}

    kris = db.query(RiskKRI).filter(RiskKRI.risk_id.in_(risk_ids), RiskKRI.is_active == True).all()

    def _kri_rag(k):
        if k.current_value is None:
            return "no_data"
        val = k.current_value
        if k.threshold_direction == "higher_is_better":
            if k.green_threshold and val >= k.green_threshold:
                return "green"
            if k.amber_threshold and val >= k.amber_threshold:
                return "amber"
            return "red"
        else:
            if k.green_threshold and val <= k.green_threshold:
                return "green"
            if k.amber_threshold and val <= k.amber_threshold:
                return "amber"
            return "red"

    breached = 0
    data = []
    for k in kris:
        rag = _kri_rag(k)
        if rag == "red":
            breached += 1
        last_measurements = db.query(RiskKRIMeasurement).filter(
            RiskKRIMeasurement.kri_id == k.id
        ).order_by(RiskKRIMeasurement.measured_at.desc()).limit(5).all()

        data.append({
            "id": k.id, "risk_id": k.risk_id, "name": k.name,
            "metric_type": k.metric_type, "current_value": k.current_value,
            "green_threshold": k.green_threshold, "amber_threshold": k.amber_threshold,
            "rag_status": rag, "frequency": k.frequency,
            "last_measured_at": _dt(k.last_measured_at),
            "recent_measurements": [{"value": m.value, "status": m.status, "date": _dt(m.measured_at)} for m in last_measurements],
        })

    return {
        "report_name": "KRI Dashboard",
        "generated_at": _now_iso(),
        "filters": {"tenant_id": tenant_id},
        "summary": {"total_kris": len(kris), "breached": breached},
        "data": data,
    }


@router.get("/erm/kri-dashboard")
def erm_kri_dashboard(
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"report_name": "KRI Dashboard", "generated_at": _now_iso(), "filters": {}, "summary": {}, "data": []}
    return _kri_dashboard(db, user_tenants, tenant_id, date_from, date_to)


@router.get("/erm/export")
def erm_export(
    report_type: str = Query("incidents"),
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        user_tenants = []
    funcs = {
        "internal-controls": _internal_controls,
        "incidents": _incidents,
        "kri-dashboard": _kri_dashboard,
    }
    fn = funcs.get(report_type, _incidents)
    report = fn(db, user_tenants, tenant_id, date_from, date_to)
    rows_data = report.get("data", [])
    if not rows_data:
        headers = ["No Data"]
        rows = []
    else:
        headers = [h for h in rows_data[0].keys() if h != "recent_measurements"]
        rows = [[r.get(h) for h in headers] for r in rows_data]
    buf = _make_excel(headers, rows, report.get("report_name", "Report"))
    return _excel_response(buf, f"erm_{report_type}.xlsx")


# =============================================================================
# 5. IT ASSETS & VULNERABILITIES REPORTS
# =============================================================================

def _asset_inventory(db: Session, user_tenants, tenant_id, date_from, date_to):
    q = _apply_tenant_filter(db.query(ITAsset), ITAsset, user_tenants, tenant_id)
    q = _apply_date_filter(q, ITAsset.created_at, date_from, date_to)
    assets = q.order_by(ITAsset.created_at.desc()).all()

    by_type = {}
    by_criticality = {}
    by_status = {}
    total_value = 0
    for a in assets:
        t = a.asset_type or "other"
        by_type[t] = by_type.get(t, 0) + 1
        cr = a.criticality or "medium"
        by_criticality[cr] = by_criticality.get(cr, 0) + 1
        s = a.status or "active"
        by_status[s] = by_status.get(s, 0) + 1
        if a.valuation:
            total_value += a.valuation

    owner_cache = {}
    def _owner_name(oid):
        if not oid:
            return None
        if oid not in owner_cache:
            u = db.query(GRCUser).filter(GRCUser.id == oid).first()
            owner_cache[oid] = u.display_name if u else None
        return owner_cache[oid]

    data = [{
        "id": a.id, "name": a.name, "asset_type": a.asset_type,
        "criticality": a.criticality, "status": a.status,
        "owner": _owner_name(a.owner_id),
        "valuation": a.valuation, "vendor": a.vendor, "location": a.location,
        "created_at": _dt(a.created_at),
    } for a in assets]

    return {
        "report_name": "IT Asset Inventory",
        "generated_at": _now_iso(),
        "filters": {"tenant_id": tenant_id, "date_from": date_from, "date_to": date_to},
        "summary": {
            "total_assets": len(assets),
            "total_value": total_value,
            "by_type": by_type, "by_criticality": by_criticality, "by_status": by_status,
        },
        "data": data,
    }


@router.get("/assets/inventory")
def assets_inventory(
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"report_name": "IT Asset Inventory", "generated_at": _now_iso(), "filters": {}, "summary": {}, "data": []}
    return _asset_inventory(db, user_tenants, tenant_id, date_from, date_to)


def _asset_risk_assessment(db: Session, user_tenants, tenant_id, date_from, date_to):
    asset_ids = [a.id for a in _apply_tenant_filter(db.query(ITAsset.id), ITAsset, user_tenants, tenant_id).all()]
    if not asset_ids:
        return {"report_name": "Asset Risk Assessment", "generated_at": _now_iso(), "filters": {}, "summary": {"total_assessments": 0}, "data": []}

    q = db.query(AssetRiskAssessment).filter(AssetRiskAssessment.asset_id.in_(asset_ids))
    q = _apply_date_filter(q, AssetRiskAssessment.assessment_date, date_from, date_to)
    assessments = q.order_by(AssetRiskAssessment.assessment_date.desc()).all()

    asset_cache = {}
    def _asset_name(aid):
        if aid not in asset_cache:
            a = db.query(ITAsset).filter(ITAsset.id == aid).first()
            asset_cache[aid] = a.name if a else None
        return asset_cache[aid]

    data = [{
        "id": a.id, "asset_id": a.asset_id,
        "asset_name": _asset_name(a.asset_id),
        "risk_score": a.risk_score,
        "coverage_percentage": a.coverage_percentage,
        "assessment_date": _dt(a.assessment_date),
    } for a in assessments]

    return {
        "report_name": "Asset Risk Assessment",
        "generated_at": _now_iso(),
        "filters": {"tenant_id": tenant_id, "date_from": date_from, "date_to": date_to},
        "summary": {
            "total_assessments": len(assessments),
            "avg_risk_score": round(sum(a.risk_score or 0 for a in assessments) / len(assessments), 2) if assessments else 0,
        },
        "data": data,
    }


@router.get("/assets/risk-assessment")
def assets_risk_assessment(
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"report_name": "Asset Risk Assessment", "generated_at": _now_iso(), "filters": {}, "summary": {}, "data": []}
    return _asset_risk_assessment(db, user_tenants, tenant_id, date_from, date_to)


def _vulnerability_status(db: Session, user_tenants, tenant_id, date_from, date_to):
    q = _apply_tenant_filter(db.query(Vulnerability), Vulnerability, user_tenants, tenant_id)
    q = _apply_date_filter(q, Vulnerability.created_at, date_from, date_to)
    vulns = q.order_by(Vulnerability.created_at.desc()).all()

    by_severity = {}
    by_status = {}
    for v in vulns:
        sev = v.severity or "medium"
        by_severity[sev] = by_severity.get(sev, 0) + 1
        st = v.status or "open"
        by_status[st] = by_status.get(st, 0) + 1

    data = [{
        "id": v.id, "vuln_id": v.vuln_id, "title": v.title,
        "severity": v.severity, "cvss_score": v.cvss_score,
        "status": v.status, "cve_id": v.cve_id,
        "affected_component": v.affected_component,
        "due_date": _dt(v.due_date),
        "discovered_at": _dt(v.discovered_at),
        "resolved_at": _dt(v.resolved_at),
        "created_at": _dt(v.created_at),
    } for v in vulns]

    return {
        "report_name": "Vulnerability Status Report",
        "generated_at": _now_iso(),
        "filters": {"tenant_id": tenant_id, "date_from": date_from, "date_to": date_to},
        "summary": {
            "total_vulnerabilities": len(vulns),
            "by_severity": by_severity, "by_status": by_status,
        },
        "data": data,
    }


@router.get("/vulnerability/status")
def vulnerability_status(
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"report_name": "Vulnerability Status Report", "generated_at": _now_iso(), "filters": {}, "summary": {}, "data": []}
    return _vulnerability_status(db, user_tenants, tenant_id, date_from, date_to)


def _vulnerability_aging(db: Session, user_tenants, tenant_id, date_from, date_to):
    now = datetime.utcnow()
    q = _apply_tenant_filter(db.query(Vulnerability), Vulnerability, user_tenants, tenant_id)
    q = q.filter(Vulnerability.status.in_(["open", "in_progress"]))
    q = q.filter(Vulnerability.due_date < now)
    vulns = q.order_by(Vulnerability.due_date.asc()).all()

    by_severity = {}
    aging_buckets = {"0-30_days": 0, "31-60_days": 0, "61-90_days": 0, "90+_days": 0}
    for v in vulns:
        sev = v.severity or "medium"
        by_severity[sev] = by_severity.get(sev, 0) + 1
        overdue_days = (now - v.due_date).days if v.due_date else 0
        if overdue_days <= 30:
            aging_buckets["0-30_days"] += 1
        elif overdue_days <= 60:
            aging_buckets["31-60_days"] += 1
        elif overdue_days <= 90:
            aging_buckets["61-90_days"] += 1
        else:
            aging_buckets["90+_days"] += 1

    data = [{
        "id": v.id, "vuln_id": v.vuln_id, "title": v.title,
        "severity": v.severity, "status": v.status,
        "due_date": _dt(v.due_date),
        "overdue_days": (now - v.due_date).days if v.due_date else 0,
        "discovered_at": _dt(v.discovered_at),
    } for v in vulns]

    return {
        "report_name": "Vulnerability Aging",
        "generated_at": _now_iso(),
        "filters": {"tenant_id": tenant_id},
        "summary": {
            "total_overdue": len(vulns),
            "by_severity": by_severity,
            "aging_buckets": aging_buckets,
        },
        "data": data,
    }


@router.get("/vulnerability/aging")
def vulnerability_aging(
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"report_name": "Vulnerability Aging", "generated_at": _now_iso(), "filters": {}, "summary": {}, "data": []}
    return _vulnerability_aging(db, user_tenants, tenant_id, date_from, date_to)


@router.get("/assets/export")
def assets_export(
    report_type: str = Query("inventory"),
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        user_tenants = []
    funcs = {
        "inventory": _asset_inventory,
        "risk-assessment": _asset_risk_assessment,
        "vulnerability-status": _vulnerability_status,
        "vulnerability-aging": _vulnerability_aging,
    }
    fn = funcs.get(report_type, _asset_inventory)
    report = fn(db, user_tenants, tenant_id, date_from, date_to)
    rows_data = report.get("data", [])
    if not rows_data:
        headers = ["No Data"]
        rows = []
    else:
        headers = list(rows_data[0].keys())
        rows = [[r.get(h) for h in headers] for r in rows_data]
    buf = _make_excel(headers, rows, report.get("report_name", "Report"))
    return _excel_response(buf, f"assets_{report_type}.xlsx")


# =============================================================================
# 6. EVIDENCE MANAGEMENT REPORTS
# =============================================================================

def _evidence_collection_status(db: Session, user_tenants, tenant_id, date_from, date_to):
    q = _apply_tenant_filter(db.query(Evidence), Evidence, user_tenants, tenant_id)
    q = _apply_date_filter(q, Evidence.uploaded_at, date_from, date_to)
    items = q.order_by(Evidence.uploaded_at.desc()).all()

    by_status = {}
    for e in items:
        s = e.status or "draft"
        by_status[s] = by_status.get(s, 0) + 1

    ev_ids = [e.id for e in items]
    mapping_counts = {}
    if ev_ids:
        mappings = db.query(
            EvidenceControlMapping.evidence_id,
            func.count(EvidenceControlMapping.id).label("cnt")
        ).filter(EvidenceControlMapping.evidence_id.in_(ev_ids)).group_by(
            EvidenceControlMapping.evidence_id
        ).all()
        mapping_counts = {m.evidence_id: m.cnt for m in mappings}

    data = [{
        "id": e.id, "name": e.name, "file_name": e.file_name,
        "status": e.status, "evidence_type": e.evidence_type,
        "control_mappings_count": mapping_counts.get(e.id, 0),
        "uploaded_at": _dt(e.uploaded_at),
        "expiry_date": _dt(e.expiry_date),
    } for e in items]

    return {
        "report_name": "Evidence Collection Status",
        "generated_at": _now_iso(),
        "filters": {"tenant_id": tenant_id, "date_from": date_from, "date_to": date_to},
        "summary": {
            "total_evidence": len(items),
            "by_status": by_status,
            "with_mappings": sum(1 for e in items if mapping_counts.get(e.id, 0) > 0),
            "without_mappings": sum(1 for e in items if mapping_counts.get(e.id, 0) == 0),
        },
        "data": data,
    }


@router.get("/evidence/collection-status")
def evidence_collection_status(
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"report_name": "Evidence Collection Status", "generated_at": _now_iso(), "filters": {}, "summary": {}, "data": []}
    return _evidence_collection_status(db, user_tenants, tenant_id, date_from, date_to)


def _evidence_expiry_review(db: Session, user_tenants, tenant_id, date_from, date_to):
    now = datetime.utcnow()
    upcoming_window = now + timedelta(days=90)

    q = _apply_tenant_filter(db.query(Evidence), Evidence, user_tenants, tenant_id)
    q = q.filter(
        (Evidence.expiry_date != None) & (Evidence.expiry_date <= upcoming_window) |
        (Evidence.recertification_date != None) & (Evidence.recertification_date <= upcoming_window)
    )
    items = q.order_by(Evidence.expiry_date.asc()).all()

    expired = sum(1 for e in items if e.expiry_date and e.expiry_date < now)
    expiring_soon = sum(1 for e in items if e.expiry_date and now <= e.expiry_date <= upcoming_window)

    data = [{
        "id": e.id, "name": e.name, "status": e.status,
        "expiry_date": _dt(e.expiry_date),
        "recertification_date": _dt(e.recertification_date),
        "is_expired": bool(e.expiry_date and e.expiry_date < now),
        "days_until_expiry": (e.expiry_date - now).days if e.expiry_date else None,
    } for e in items]

    return {
        "report_name": "Evidence Expiry/Review",
        "generated_at": _now_iso(),
        "filters": {"tenant_id": tenant_id},
        "summary": {
            "total_flagged": len(items),
            "expired": expired,
            "expiring_within_90_days": expiring_soon,
        },
        "data": data,
    }


@router.get("/evidence/expiry-review")
def evidence_expiry_review(
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"report_name": "Evidence Expiry/Review", "generated_at": _now_iso(), "filters": {}, "summary": {}, "data": []}
    return _evidence_expiry_review(db, user_tenants, tenant_id, date_from, date_to)


def _evidence_ai_assessment(db: Session, user_tenants, tenant_id, date_from, date_to):
    ev_ids = [e.id for e in _apply_tenant_filter(db.query(Evidence.id), Evidence, user_tenants, tenant_id).all()]
    if not ev_ids:
        return {"report_name": "AI Assessment Summary", "generated_at": _now_iso(), "filters": {}, "summary": {"total_assessments": 0}, "data": []}

    q = db.query(EvidenceAIAssessment).filter(EvidenceAIAssessment.evidence_id.in_(ev_ids))
    q = _apply_date_filter(q, EvidenceAIAssessment.assessed_at, date_from, date_to)
    assessments = q.order_by(EvidenceAIAssessment.assessed_at.desc()).all()

    total_relevance = 0
    total_adequacy = 0
    total_confidence = 0
    total_audit = 0
    scored = 0
    for a in assessments:
        if a.relevance_score is not None:
            total_relevance += a.relevance_score
            scored += 1
        if a.adequacy_score is not None:
            total_adequacy += a.adequacy_score
        if a.confidence_score is not None:
            total_confidence += a.confidence_score
        if a.audit_readiness is not None:
            total_audit += a.audit_readiness

    data = [{
        "id": a.id, "evidence_id": a.evidence_id,
        "relevance_score": a.relevance_score,
        "adequacy_score": a.adequacy_score,
        "confidence_score": a.confidence_score,
        "audit_readiness": a.audit_readiness,
        "content_summary": a.content_summary,
        "assessed_at": _dt(a.assessed_at),
    } for a in assessments]

    return {
        "report_name": "AI Assessment Summary",
        "generated_at": _now_iso(),
        "filters": {"tenant_id": tenant_id, "date_from": date_from, "date_to": date_to},
        "summary": {
            "total_assessments": len(assessments),
            "avg_relevance_score": round(total_relevance / scored, 2) if scored else 0,
            "avg_adequacy_score": round(total_adequacy / scored, 2) if scored else 0,
            "avg_confidence_score": round(total_confidence / scored, 2) if scored else 0,
            "avg_audit_readiness": round(total_audit / scored, 2) if scored else 0,
        },
        "data": data,
    }


@router.get("/evidence/ai-assessment")
def evidence_ai_assessment(
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"report_name": "AI Assessment Summary", "generated_at": _now_iso(), "filters": {}, "summary": {}, "data": []}
    return _evidence_ai_assessment(db, user_tenants, tenant_id, date_from, date_to)


@router.get("/evidence/export")
def evidence_export(
    report_type: str = Query("collection-status"),
    tenant_id: Optional[int] = None, date_from: Optional[str] = None,
    date_to: Optional[str] = None, db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        user_tenants = []
    funcs = {
        "collection-status": _evidence_collection_status,
        "expiry-review": _evidence_expiry_review,
        "ai-assessment": _evidence_ai_assessment,
    }
    fn = funcs.get(report_type, _evidence_collection_status)
    report = fn(db, user_tenants, tenant_id, date_from, date_to)
    rows_data = report.get("data", [])
    if not rows_data:
        headers = ["No Data"]
        rows = []
    else:
        headers = list(rows_data[0].keys())
        rows = [[r.get(h) for h in headers] for r in rows_data]
    buf = _make_excel(headers, rows, report.get("report_name", "Report"))
    return _excel_response(buf, f"evidence_{report_type}.xlsx")
