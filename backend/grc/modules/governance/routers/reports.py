import csv
import io
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from sqlalchemy import func
from ....models import (
    GovernanceDocument, PolicyGapAnalysisRun, PolicyGapFinding,
    AuditLog, GRCUser, UploadedFramework, PolicyStatement,
    PolicyStatementVersion, AttestationCampaign, AttestationRequest, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/reports", tags=["Reports & Export"])


def _csv_response(output: io.StringIO, filename: str):
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@router.get("/gap-analysis/{run_id}/csv")
def export_gap_report(
    run_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    run = db.query(PolicyGapAnalysisRun).filter(
        PolicyGapAnalysisRun.id == run_id,
        PolicyGapAnalysisRun.tenant_id.in_(user_tenants)
    ).first()
    if not run:
        raise HTTPException(status_code=404, detail="Gap analysis run not found")

    findings = db.query(PolicyGapFinding).filter(
        PolicyGapFinding.analysis_run_id == run_id
    ).order_by(PolicyGapFinding.clause_reference).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Clause Reference", "Clause Title", "Compliance Status",
        "Risk Severity", "Gap Description", "Missing Requirement",
        "Remediation Recommendation", "Policy Section Reference",
        "Confidence Score", "AI Reasoning",
        "Regulatory Impact", "Operational Impact", "Financial Impact", "Reputational Impact",
        "Remediation Status"
    ])

    for f in findings:
        writer.writerow([
            f.clause_reference or "", f.clause_title or "", f.compliance_status or "",
            f.risk_severity or "", f.gap_description or "", f.missing_requirement or "",
            f.remediation_recommendation or "", f.policy_section_reference or "",
            f.confidence_score if f.confidence_score is not None else "", f.ai_reasoning or "",
            f.impact_regulatory, f.impact_operational, f.impact_financial, f.impact_reputational,
            f.remediation_status or ""
        ])

    fw_name = (run.framework_name or "unknown").replace(" ", "_")
    filename = f"gap_analysis_{fw_name}_{datetime.utcnow().strftime('%Y%m%d')}.csv"
    return _csv_response(output, filename)


@router.get("/compliance-summary/csv")
def export_compliance_summary(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    frameworks = db.query(UploadedFramework).filter(
        UploadedFramework.tenant_id.in_(user_tenants),
        UploadedFramework.is_active == True
    ).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Framework", "Version", "Total Clauses Analyzed",
        "Fully Compliant", "Partially Compliant", "Not Addressed", "Not Applicable",
        "Compliance %", "Last Assessment Date", "Status"
    ])

    for fw in frameworks:
        latest_run = db.query(PolicyGapAnalysisRun).filter(
            PolicyGapAnalysisRun.uploaded_framework_id == fw.id,
            PolicyGapAnalysisRun.status == "completed"
        ).order_by(PolicyGapAnalysisRun.completed_at.desc()).first()

        writer.writerow([
            fw.name or "", fw.version or "",
            latest_run.total_clauses_analyzed if latest_run else 0,
            latest_run.fully_compliant_count if latest_run else 0,
            latest_run.partially_compliant_count if latest_run else 0,
            latest_run.not_addressed_count if latest_run else 0,
            latest_run.not_applicable_count if latest_run else 0,
            latest_run.compliance_percentage if latest_run else "N/A",
            latest_run.completed_at.strftime("%Y-%m-%d %H:%M") if latest_run and latest_run.completed_at else "Never",
            fw.upload_status or ""
        ])

    return _csv_response(output, f"compliance_summary_{datetime.utcnow().strftime('%Y%m%d')}.csv")


@router.get("/audit-log/csv")
def export_audit_log(
    days: int = 90,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    cutoff = datetime.utcnow() - timedelta(days=days)

    logs = db.query(AuditLog).filter(
        AuditLog.tenant_id.in_(user_tenants),
        AuditLog.timestamp >= cutoff
    ).order_by(AuditLog.timestamp.desc()).limit(5000).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Timestamp", "User ID", "Action", "Resource Type", "Resource ID", "Changes"])

    for log in logs:
        writer.writerow([
            log.timestamp.strftime("%Y-%m-%d %H:%M:%S") if log.timestamp else "",
            log.user_id or "", log.action or "", log.resource_type or "",
            log.resource_id or "", log.changes or ""
        ])

    return _csv_response(output, f"audit_log_{datetime.utcnow().strftime('%Y%m%d')}.csv")


@router.get("/policy-statements/{document_id}/csv")
def export_policy_statements(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    statements = db.query(PolicyStatement).filter(
        PolicyStatement.document_id == document_id
    ).order_by(PolicyStatement.statement_code).all()

    stmt_ids = [s.id for s in statements]
    version_counts = {}
    last_changes = {}
    if stmt_ids:
        vc_rows = db.query(
            PolicyStatementVersion.statement_id,
            func.count(PolicyStatementVersion.id).label("cnt"),
            func.max(PolicyStatementVersion.changed_at).label("last_changed")
        ).filter(
            PolicyStatementVersion.statement_id.in_(stmt_ids)
        ).group_by(PolicyStatementVersion.statement_id).all()
        for row in vc_rows:
            version_counts[row.statement_id] = row.cnt
            last_changes[row.statement_id] = row.last_changed

        latest_versions = db.query(PolicyStatementVersion).filter(
            PolicyStatementVersion.statement_id.in_(stmt_ids)
        ).order_by(PolicyStatementVersion.statement_id, PolicyStatementVersion.version_number.desc()).all()
        seen = set()
        for v in latest_versions:
            if v.statement_id not in seen:
                seen.add(v.statement_id)
                last_changes[v.statement_id] = {
                    "type": v.change_type,
                    "at": v.changed_at,
                }

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Statement Code", "Statement Text", "Summary",
        "Category", "Priority", "Is Mandatory",
        "Source Section", "Status", "AI Confidence",
        "Version Count", "Last Change Type", "Last Changed At"
    ])

    for s in statements:
        lc = last_changes.get(s.id, {})
        writer.writerow([
            s.statement_code or "", s.statement_text or "", s.statement_summary or "",
            s.category or "", s.priority or "", s.is_mandatory,
            s.source_section or "", s.status or "",
            s.ai_confidence if s.ai_confidence is not None else "",
            version_counts.get(s.id, 0),
            lc.get("type", "") if isinstance(lc, dict) else "",
            lc.get("at", "").isoformat() if isinstance(lc, dict) and lc.get("at") else ""
        ])

    doc_title = (document.title or "document").replace(" ", "_")[:50]
    return _csv_response(output, f"policy_statements_{doc_title}_{datetime.utcnow().strftime('%Y%m%d')}.csv")


@router.get("/campaigns/{campaign_id}/export-csv")
def export_campaign_attestations(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Export attestation campaign results as CSV for audit evidence."""
    user_tenants = get_user_tenants(current_user, db)

    campaign = db.query(AttestationCampaign).filter(
        AttestationCampaign.id == campaign_id,
        AttestationCampaign.tenant_id.in_(user_tenants)
    ).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    requests = db.query(AttestationRequest).filter(
        AttestationRequest.campaign_id == campaign_id
    ).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "User Name", "Email", "Status",
        "Assigned Date", "Due Date", "Completed Date",
        "IP Address", "User Comments", "Evidence Attached"
    ])

    for r in requests:
        user = db.query(GRCUser).filter(GRCUser.id == r.user_id).first()
        writer.writerow([
            (user.display_name or user.username) if user else "",
            user.email if user else "",
            r.status or "",
            r.assigned_at.isoformat() if r.assigned_at else "",
            r.due_date.isoformat() if r.due_date else "",
            r.completed_at.isoformat() if r.completed_at else "",
            r.ip_address or "",
            r.user_comments or "",
            "Yes" if r.evidence_id else "No",
        ])

    campaign_name = (campaign.name or "campaign").replace(" ", "_")[:50]
    return _csv_response(output, f"attestation_{campaign_name}_{datetime.utcnow().strftime('%Y%m%d')}.csv")
