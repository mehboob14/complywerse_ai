import os
import io
import csv
import json
import math
import threading
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from openai import OpenAI

from ....db import open_tenant_session
from ....models import (
    GovernanceDocument, PolicyGapAnalysisRun, PolicyGapFinding,
    UploadedFramework, ParsedFrameworkControl, GRCUser, get_db,
    Risk
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant
from .policy_parser import extract_text_from_file
from ..action_logger import log_governance_action

router = APIRouter(prefix="/gap-analysis", tags=["Policy Gap Analysis"])

AI_INTEGRATIONS_OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
AI_INTEGRATIONS_OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")


class GapAnalysisRunRequest(BaseModel):
    document_id: int
    framework_ids: Optional[List[int]] = []
    run_all: bool = False


class FindingUpdateRequest(BaseModel):
    assigned_owner_id: Optional[int] = None
    target_remediation_date: Optional[datetime] = None
    remediation_status: Optional[str] = None
    evidence_ids: Optional[List[int]] = None
    evidence_notes: Optional[str] = None


class FindingOverrideRequest(BaseModel):
    override_status: str
    override_justification: str


class RiskAcceptanceRequest(BaseModel):
    risk_acceptance_justification: str
    risk_acceptance_expiry_date: Optional[datetime] = None


def get_document_text(document: GovernanceDocument) -> str:
    if document.content and document.content.strip():
        return document.content

    if document.file_path and document.file_type:
        return extract_text_from_file(document.file_path, document.file_type)

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Document has no content or attached file to analyze"
    )


def analyze_clauses_batch(policy_text: str, clauses: List[dict], framework_name: str, document_title: str = "") -> List[dict]:
    if not AI_INTEGRATIONS_OPENAI_API_KEY or not AI_INTEGRATIONS_OPENAI_BASE_URL:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OpenAI integration not configured"
        )

    client = OpenAI(
        api_key=AI_INTEGRATIONS_OPENAI_API_KEY,
        base_url=AI_INTEGRATIONS_OPENAI_BASE_URL
    )

    clauses_text = ""
    for c in clauses:
        clauses_text += f"\n--- Clause: {c['reference']} ---\n"
        clauses_text += f"Title: {c['title']}\n"
        clauses_text += f"Requirement: {c['requirement']}\n"

    title_context = f'The policy document is titled: "{document_title}".\n' if document_title else ""

    system_message = f"""You are a GRC compliance expert performing a SCOPED policy gap analysis.

ABSOLUTE RULE - SCOPE FILTERING:
{title_context}You MUST first determine the specific topic/domain of this policy (e.g., "Security Awareness & Training", "Access Control", "Incident Response", "Data Protection", etc.).

Then for EACH framework clause:
- If the clause's subject matter is OUTSIDE the policy's domain, you MUST mark it as "not_applicable". 
- "not_addressed" means the clause IS within the policy's scope but the policy fails to cover it.
- NEVER mark a clause as "not_addressed" if it belongs to a completely different domain than the policy.

Examples of correct scope filtering:
- Training Policy + "Network Monitoring" clause → not_applicable (different domain)
- Training Policy + "Malicious Code Detection" clause → not_applicable (different domain)  
- Training Policy + "Event Data Correlation" clause → not_applicable (different domain)
- Training Policy + "Security Awareness Requirements" clause → analyze normally (same domain)
- Access Control Policy + "Password Complexity" clause → analyze normally (same domain)
- Access Control Policy + "Backup Procedures" clause → not_applicable (different domain)

You MUST respond with valid JSON only."""

    prompt = f"""Analyze the following policy document against each framework clause from "{framework_name}".

POLICY DOCUMENT TITLE: "{document_title}"

POLICY DOCUMENT TEXT:
---
{policy_text[:40000]}
---

FRAMEWORK CLAUSES TO ANALYZE:
{clauses_text}

INSTRUCTIONS:
1. First identify the policy's specific topic/domain from its title and content.
2. For each clause, determine if it falls within the policy's domain.
3. If a clause is outside the policy's domain → compliance_status = "not_applicable"
4. If a clause is within scope but not covered → compliance_status = "not_addressed"  
5. If partially covered → "partially_compliant"
6. If fully covered → "fully_compliant"

For each clause, return a JSON object with these fields:
- clause_reference: The clause reference ID (exactly as provided)
- clause_title: The clause title (exactly as provided)
- compliance_status: One of "fully_compliant", "partially_compliant", "not_addressed", "not_applicable"
- policy_section_reference: Which section/paragraph of the policy addresses this clause (or null if not addressed or not applicable)
- policy_section_text: The actual verbatim text from the policy that addresses this clause (quote the relevant sentence or paragraph directly from the policy, or null if not addressed or not applicable)
- gap_description: Description of the gap (null if fully compliant or not applicable)
- missing_requirement: Specific missing control or requirement (null if fully compliant or not applicable)
- remediation_recommendation: Recommended action to close the gap (null if fully compliant or not applicable)
- confidence_score: Your confidence in this assessment from 0.0 to 1.0
- ai_reasoning: Brief explanation. For not_applicable: explain why the clause is outside this policy's domain.
- risk_severity: One of "critical", "high", "medium", "low" (use "low" for not_applicable)
- impact_regulatory: boolean
- impact_operational: boolean
- impact_financial: boolean
- impact_reputational: boolean

Return a JSON object with a "findings" array containing one object per clause."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_completion_tokens=8192
        )

        result_text = response.choices[0].message.content or "{}"
        result = json.loads(result_text)
        return result.get("findings", [])

    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to parse OpenAI response: {str(e)}"
        )
    except Exception as e:
        error_msg = str(e)
        if "FREE_CLOUD_BUDGET_EXCEEDED" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="Cloud budget exceeded. Please upgrade your plan."
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"OpenAI API error: {error_msg}"
        )


DOMAIN_KEYWORD_MAP = {
    "access control": {"access", "authentication", "authorization", "password", "identity", "privilege", "login", "credential", "mfa", "multi-factor", "sso", "rbac", "permissions", "session"},
    "training": {"training", "awareness", "education", "competency", "learning", "phishing", "simulation", "curriculum", "certification"},
    "awareness": {"training", "awareness", "education", "competency", "learning", "phishing", "simulation"},
    "incident": {"incident", "breach", "response", "escalation", "forensic", "containment", "eradication", "recovery", "triage"},
    "network": {"network", "firewall", "ids", "ips", "monitoring", "traffic", "segmentation", "dmz", "proxy", "packet", "routing", "switching"},
    "encryption": {"encryption", "cryptography", "cipher", "key management", "tls", "ssl", "pki", "certificate", "hashing", "decryption"},
    "backup": {"backup", "restore", "recovery", "replication", "archival", "retention", "disaster recovery", "continuity"},
    "change management": {"change management", "change control", "release", "deployment", "rollback", "configuration management"},
    "risk": {"risk assessment", "risk management", "risk register", "risk appetite", "risk tolerance", "threat", "vulnerability"},
    "asset": {"asset", "inventory", "classification", "valuation", "cmdb", "hardware", "software asset"},
    "data protection": {"data protection", "data loss", "dlp", "data classification", "privacy", "pii", "personal data", "gdpr", "data handling"},
    "physical security": {"physical", "facility", "cctv", "badge", "visitor", "perimeter", "environmental", "fire suppression"},
    "vendor": {"vendor", "third party", "supplier", "outsourcing", "procurement", "sla", "contract", "due diligence"},
    "logging": {"logging", "log", "audit trail", "siem", "event", "correlation", "monitoring", "detection", "alerting"},
    "malware": {"malware", "antivirus", "anti-malware", "malicious code", "ransomware", "trojan", "virus", "endpoint protection"},
    "patch": {"patch", "update", "vulnerability management", "remediation", "hotfix", "firmware"},
    "policy": {"policy", "standard", "procedure", "guideline", "governance", "compliance", "framework"},
    "business continuity": {"business continuity", "bcp", "disaster recovery", "drp", "resilience", "contingency"},
}


def _extract_policy_domains(document_title: str, policy_text: str) -> set:
    title_lower = document_title.lower() if document_title else ""
    first_2000 = policy_text[:2000].lower() if policy_text else ""
    combined = title_lower + " " + first_2000

    matched_domains = set()
    for domain, keywords in DOMAIN_KEYWORD_MAP.items():
        for kw in keywords:
            if kw in combined:
                matched_domains.add(domain)
                break

    return matched_domains


def _get_clause_domains(clause_title: str, clause_requirement: str = "") -> set:
    combined = (clause_title + " " + clause_requirement).lower()
    matched = set()
    for domain, keywords in DOMAIN_KEYWORD_MAP.items():
        for kw in keywords:
            if kw in combined:
                matched.add(domain)
                break
    return matched


def post_process_scope_filter(findings: List[dict], document_title: str, policy_text: str) -> List[dict]:
    policy_domains = _extract_policy_domains(document_title, policy_text)

    if not policy_domains:
        return findings

    for finding in findings:
        status = finding.get("compliance_status")
        if status not in ("not_addressed", "partially_compliant"):
            continue

        clause_title = finding.get("clause_title", "")
        clause_domains = _get_clause_domains(clause_title)

        if clause_domains and not clause_domains.intersection(policy_domains):
            finding["compliance_status"] = "not_applicable"
            finding["gap_description"] = None
            finding["missing_requirement"] = None
            finding["remediation_recommendation"] = None
            finding["policy_section_reference"] = None
            finding["policy_section_text"] = None
            finding["risk_severity"] = "low"
            finding["impact_regulatory"] = False
            finding["impact_operational"] = False
            finding["impact_financial"] = False
            finding["impact_reputational"] = False
            original_reasoning = finding.get("ai_reasoning", "")
            finding["ai_reasoning"] = f"Auto-corrected: This clause's domain ({', '.join(clause_domains)}) is outside the policy's scope ({', '.join(policy_domains)}). {original_reasoning}"
            finding["confidence_score"] = 0.95

    return findings


def _get_latest_run_ids(db: Session, document_id: int, tenant_ids: list) -> List[int]:
    from sqlalchemy import func as sqlfunc
    latest_runs = db.query(
        sqlfunc.max(PolicyGapAnalysisRun.id).label("latest_id")
    ).filter(
        PolicyGapAnalysisRun.document_id == document_id,
        PolicyGapAnalysisRun.tenant_id.in_(tenant_ids),
        PolicyGapAnalysisRun.status == "completed"
    ).group_by(
        PolicyGapAnalysisRun.uploaded_framework_id
    ).all()
    return [r.latest_id for r in latest_runs if r.latest_id]


def serialize_finding(finding: PolicyGapFinding, db: Session) -> dict:
    owner_name = None
    if finding.assigned_owner_id:
        owner = db.query(GRCUser).filter(GRCUser.id == finding.assigned_owner_id).first()
        if owner:
            owner_name = owner.display_name

    return {
        "id": finding.id,
        "tenant_id": finding.tenant_id,
        "analysis_run_id": finding.analysis_run_id,
        "document_id": finding.document_id,
        "uploaded_framework_id": finding.uploaded_framework_id,
        "framework_name": finding.framework_name,
        "clause_reference": finding.clause_reference,
        "clause_title": finding.clause_title,
        "clause_requirement_text": finding.clause_requirement_text,
        "policy_section_reference": finding.policy_section_reference,
        "policy_section_text": finding.policy_section_text,
        "compliance_status": finding.compliance_status,
        "not_applicable_justification": finding.not_applicable_justification,
        "gap_description": finding.gap_description,
        "missing_requirement": finding.missing_requirement,
        "remediation_recommendation": finding.remediation_recommendation,
        "confidence_score": finding.confidence_score,
        "ai_reasoning": finding.ai_reasoning,
        "risk_severity": finding.risk_severity,
        "impact_regulatory": finding.impact_regulatory,
        "impact_operational": finding.impact_operational,
        "impact_financial": finding.impact_financial,
        "impact_reputational": finding.impact_reputational,
        "remediation_status": finding.remediation_status,
        "assigned_owner_id": finding.assigned_owner_id,
        "assigned_owner_name": owner_name,
        "target_remediation_date": finding.target_remediation_date.isoformat() if finding.target_remediation_date else None,
        "actual_close_date": finding.actual_close_date.isoformat() if finding.actual_close_date else None,
        "risk_accepted": finding.risk_accepted,
        "risk_acceptance_justification": finding.risk_acceptance_justification,
        "risk_acceptance_approved_by": finding.risk_acceptance_approved_by,
        "risk_acceptance_approved_at": finding.risk_acceptance_approved_at.isoformat() if finding.risk_acceptance_approved_at else None,
        "risk_acceptance_expiry_date": finding.risk_acceptance_expiry_date.isoformat() if finding.risk_acceptance_expiry_date else None,
        "risk_register_id": finding.risk_register_id,
        "evidence_ids": finding.evidence_ids or [],
        "evidence_notes": finding.evidence_notes,
        "is_overridden": finding.is_overridden,
        "override_status": finding.override_status,
        "override_justification": finding.override_justification,
        "overridden_by": finding.overridden_by,
        "overridden_at": finding.overridden_at.isoformat() if finding.overridden_at else None,
        "created_at": finding.created_at.isoformat() if finding.created_at else None,
        "updated_at": finding.updated_at.isoformat() if finding.updated_at else None,
    }


def serialize_run(run: PolicyGapAnalysisRun) -> dict:
    return {
        "id": run.id,
        "tenant_id": run.tenant_id,
        "document_id": run.document_id,
        "uploaded_framework_id": run.uploaded_framework_id,
        "framework_name": run.framework_name,
        "status": run.status,
        "run_type": run.run_type,
        "total_clauses_analyzed": run.total_clauses_analyzed,
        "fully_compliant_count": run.fully_compliant_count,
        "partially_compliant_count": run.partially_compliant_count,
        "not_addressed_count": run.not_addressed_count,
        "not_applicable_count": run.not_applicable_count,
        "compliance_percentage": run.compliance_percentage,
        "ai_model_used": run.ai_model_used,
        "error_message": run.error_message,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "created_by": run.created_by,
        "clauses_total": getattr(run, "clauses_total", 0) or 0,
        "clauses_processed": getattr(run, "clauses_processed", 0) or 0,
    }


def _gap_analysis_body(db, run_ids: list, document_id: int, user_id: int, tenant_slug: str = None):
    """Body of the gap-analysis job. Takes an open tenant-scoped session."""
    try:
        document = db.query(GovernanceDocument).filter(GovernanceDocument.id == document_id).first()
        if not document:
            for run_id in run_ids:
                run = db.query(PolicyGapAnalysisRun).filter(PolicyGapAnalysisRun.id == run_id).first()
                if run:
                    run.status = "failed"
                    run.error_message = "Document not found"
                    run.completed_at = datetime.utcnow()
            db.commit()
            return

        policy_text = get_document_text(document)
        if not policy_text:
            for run_id in run_ids:
                run = db.query(PolicyGapAnalysisRun).filter(PolicyGapAnalysisRun.id == run_id).first()
                if run:
                    run.status = "failed"
                    run.error_message = "No text could be extracted from the document"
                    run.completed_at = datetime.utcnow()
            db.commit()
            return

        for run_id in run_ids:
            run = db.query(PolicyGapAnalysisRun).filter(PolicyGapAnalysisRun.id == run_id).first()
            if not run:
                continue

            try:
                framework = db.query(UploadedFramework).filter(UploadedFramework.id == run.uploaded_framework_id).first()
                if not framework:
                    run.status = "failed"
                    run.error_message = "Framework not found"
                    run.completed_at = datetime.utcnow()
                    db.commit()
                    continue

                controls = db.query(ParsedFrameworkControl).filter(
                    ParsedFrameworkControl.uploaded_framework_id == framework.id
                ).order_by(ParsedFrameworkControl.control_id).all()

                clauses = []
                for ctrl in controls:
                    ref = ctrl.original_reference or ctrl.control_id
                    clauses.append({
                        "reference": ref,
                        "title": ctrl.title,
                        "requirement": (ctrl.full_text or ctrl.description or ctrl.title)[:2000],
                        "control_obj": ctrl
                    })

                # Live progress: initialise totals so the UI can render a real
                # percentage instead of an indeterminate sweep.
                try:
                    run.clauses_total = len(clauses)
                    run.clauses_processed = 0
                    db.commit()
                except Exception:
                    db.rollback()

                batch_size = 15
                all_findings_data = []

                for i in range(0, len(clauses), batch_size):
                    batch = clauses[i:i + batch_size]
                    batch_for_api = [{"reference": c["reference"], "title": c["title"], "requirement": c["requirement"]} for c in batch]
                    findings_data = analyze_clauses_batch(policy_text, batch_for_api, framework.name, document.title or "")
                    all_findings_data.extend(findings_data)
                    try:
                        run.clauses_processed = min(len(clauses), (run.clauses_processed or 0) + len(batch))
                        db.commit()
                    except Exception:
                        db.rollback()

                all_findings_data = post_process_scope_filter(all_findings_data, document.title or "", policy_text)

                clause_map = {c["reference"]: c["control_obj"] for c in clauses}

                fully_compliant = 0
                partially_compliant = 0
                not_addressed = 0
                not_applicable = 0

                for fd in all_findings_data:
                    c_status = fd.get("compliance_status", "not_addressed")
                    if c_status == "fully_compliant":
                        fully_compliant += 1
                    elif c_status == "partially_compliant":
                        partially_compliant += 1
                    elif c_status == "not_applicable":
                        not_applicable += 1
                    else:
                        not_addressed += 1

                    ctrl_ref = fd.get("clause_reference", "")
                    matched_ctrl = clause_map.get(ctrl_ref)

                    finding = PolicyGapFinding(
                        tenant_id=document.tenant_id,
                        analysis_run_id=run.id,
                        document_id=document.id,
                        uploaded_framework_id=framework.id,
                        framework_name=framework.name,
                        clause_reference=ctrl_ref,
                        clause_title=fd.get("clause_title", ""),
                        clause_requirement_text=(matched_ctrl.full_text or matched_ctrl.description) if matched_ctrl else None,
                        policy_section_reference=fd.get("policy_section_reference"),
                        policy_section_text=fd.get("policy_section_text"),
                        compliance_status=c_status,
                        gap_description=fd.get("gap_description"),
                        missing_requirement=fd.get("missing_requirement"),
                        remediation_recommendation=fd.get("remediation_recommendation"),
                        confidence_score=fd.get("confidence_score"),
                        ai_reasoning=fd.get("ai_reasoning"),
                        risk_severity=fd.get("risk_severity", "medium"),
                        impact_regulatory=fd.get("impact_regulatory", False),
                        impact_operational=fd.get("impact_operational", False),
                        impact_financial=fd.get("impact_financial", False),
                        impact_reputational=fd.get("impact_reputational", False),
                        remediation_status="open" if c_status not in ("fully_compliant", "not_applicable") else "closed",
                    )
                    db.add(finding)

                total_analyzed = len(all_findings_data)
                assessable = total_analyzed - not_applicable
                compliance_pct = round((fully_compliant / assessable) * 100, 2) if assessable > 0 else 100.0

                run.total_clauses_analyzed = total_analyzed
                run.fully_compliant_count = fully_compliant
                run.partially_compliant_count = partially_compliant
                run.not_addressed_count = not_addressed
                run.not_applicable_count = not_applicable
                run.compliance_percentage = compliance_pct
                run.status = "completed"
                run.completed_at = datetime.utcnow()
                if run.clauses_total:
                    run.clauses_processed = run.clauses_total
                db.commit()

            except Exception as e:
                run.status = "failed"
                run.error_message = str(e)[:1000]
                run.completed_at = datetime.utcnow()
                db.commit()

    except Exception as e:
        for run_id in run_ids:
            try:
                run = db.query(PolicyGapAnalysisRun).filter(PolicyGapAnalysisRun.id == run_id).first()
                if run and run.status == "running":
                    run.status = "failed"
                    run.error_message = str(e)[:1000]
                    run.completed_at = datetime.utcnow()
                db.commit()
            except:
                pass
    except Exception:
        # Bubble up — Celery task wrapper records job_status in Redis.
        raise


def _run_gap_analysis_background(run_ids: list, document_id: int, user_id: int, tenant_slug: str):
    """Legacy in-process entry: opens its own session, calls `_gap_analysis_body`."""
    db = open_tenant_session(tenant_slug)
    try:
        return _gap_analysis_body(db, run_ids, document_id, user_id, tenant_slug)
    finally:
        db.close()


@router.post("/run")
def run_gap_analysis(
    request: GapAnalysisRunRequest,
    http_request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_slug = getattr(http_request.state, "tenant_slug", None)
    if not tenant_slug:
        raise HTTPException(status_code=400, detail="Tenant context required")

    user_tenants = get_user_tenants(current_user, db)

    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == request.document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()

    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found or access denied"
        )

    policy_text = get_document_text(document)
    if not policy_text or not policy_text.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No text could be extracted from the document"
        )

    if request.run_all:
        frameworks = db.query(UploadedFramework).filter(
            UploadedFramework.tenant_id == document.tenant_id,
            UploadedFramework.is_active == True,
            UploadedFramework.upload_status.in_(["parsed", "published"])
        ).all()
    elif request.framework_ids:
        frameworks = db.query(UploadedFramework).filter(
            UploadedFramework.id.in_(request.framework_ids),
            UploadedFramework.is_active == True
        ).all()
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide framework_ids or set run_all=true"
        )

    if not frameworks:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No frameworks found to analyze against"
        )

    all_runs = []

    for framework in frameworks:
        controls = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == framework.id
        ).order_by(ParsedFrameworkControl.control_id).all()

        if not controls:
            continue

        run = PolicyGapAnalysisRun(
            tenant_id=document.tenant_id,
            document_id=document.id,
            uploaded_framework_id=framework.id,
            framework_name=framework.name,
            status="running",
            run_type="manual",
            ai_model_used="gpt-4o",
            started_at=datetime.utcnow(),
            created_by=current_user.id
        )
        db.add(run)
        db.flush()
        all_runs.append(run)

    db.commit()

    run_ids = [r.id for r in all_runs]
    serialized = [serialize_run(r) for r in all_runs]

    from ....tasks.base import tenant_rate_limit, RateLimitExceeded
    try:
        tenant_rate_limit(tenant_slug, bucket="gap_analysis")
    except RateLimitExceeded:
        raise HTTPException(status_code=429, detail="Too many gap-analysis runs in the last minute; try again shortly")

    from ....tasks.governance import run_gap_analysis as _gap_task
    async_result = _gap_task.delay(tenant_slug, run_ids, request.document_id, current_user.id)
    print(f"[DISPATCH] gap_analysis → celery task_id={async_result.id} tenant={tenant_slug} doc={request.document_id} runs={len(run_ids)}", flush=True)

    return {
        "message": f"Gap analysis queued for {len(all_runs)} framework(s). Check status for results.",
        "document_id": request.document_id,
        "task_id": async_result.id,
        "runs": serialized,
        "status": "queued"
    }


@router.get("/runs/{document_id}")
def get_analysis_runs(
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found or access denied"
        )

    runs = db.query(PolicyGapAnalysisRun).filter(
        PolicyGapAnalysisRun.document_id == document_id,
        PolicyGapAnalysisRun.tenant_id.in_(user_tenants)
    ).order_by(PolicyGapAnalysisRun.started_at.desc()).all()

    # Staleness sweep: a worker that crashed mid-run leaves a row in
    # status='running' that the UI polls forever. If `started_at` is older
    # than the threshold, mark it failed so polling can stop and the user
    # gets a clear error instead of an indefinite spinner.
    STALE_AFTER_SECONDS = 1800  # 30 minutes
    now = datetime.utcnow()
    stale_dirty = False
    for r in runs:
        if r.status == "running" and r.started_at:
            age = (now - r.started_at).total_seconds()
            if age > STALE_AFTER_SECONDS:
                r.status = "failed"
                r.error_message = "Worker did not finish within timeout (stale run cleared)"
                r.completed_at = now
                stale_dirty = True
    if stale_dirty:
        db.commit()

    return {
        "document_id": document_id,
        "runs": [serialize_run(r) for r in runs],
        "total": len(runs)
    }


@router.get("/findings/document/{document_id}")
def get_document_findings(
    document_id: int,
    compliance_status: Optional[str] = None,
    risk_severity: Optional[str] = None,
    remediation_status: Optional[str] = None,
    framework_name: Optional[str] = None,
    sort_by: str = "clause_reference",
    sort_order: str = "asc",
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()

    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found or access denied"
        )

    latest_run_ids = _get_latest_run_ids(db, document_id, user_tenants)

    query = db.query(PolicyGapFinding).filter(
        PolicyGapFinding.document_id == document_id,
        PolicyGapFinding.tenant_id.in_(user_tenants)
    )

    if latest_run_ids:
        query = query.filter(PolicyGapFinding.analysis_run_id.in_(latest_run_ids))

    if compliance_status:
        query = query.filter(PolicyGapFinding.compliance_status == compliance_status)
    if risk_severity:
        query = query.filter(PolicyGapFinding.risk_severity == risk_severity)
    if remediation_status:
        query = query.filter(PolicyGapFinding.remediation_status == remediation_status)
    if framework_name:
        query = query.filter(PolicyGapFinding.framework_name.ilike(f"%{framework_name}%"))

    sort_column = getattr(PolicyGapFinding, sort_by, PolicyGapFinding.clause_reference)
    if sort_order == "desc":
        query = query.order_by(sort_column.desc())
    else:
        query = query.order_by(sort_column.asc())

    total = query.count()
    findings = query.offset(skip).limit(limit).all()

    return {
        "document_id": document_id,
        "findings": [serialize_finding(f, db) for f in findings],
        "total": total,
        "skip": skip,
        "limit": limit
    }


@router.get("/findings/{run_id}")
def get_run_findings(
    run_id: int,
    compliance_status: Optional[str] = None,
    risk_severity: Optional[str] = None,
    remediation_status: Optional[str] = None,
    framework_name: Optional[str] = None,
    sort_by: str = "clause_reference",
    sort_order: str = "asc",
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    run = db.query(PolicyGapAnalysisRun).filter(
        PolicyGapAnalysisRun.id == run_id,
        PolicyGapAnalysisRun.tenant_id.in_(user_tenants)
    ).first()

    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Analysis run not found or access denied"
        )

    query = db.query(PolicyGapFinding).filter(
        PolicyGapFinding.analysis_run_id == run_id
    )

    if compliance_status:
        query = query.filter(PolicyGapFinding.compliance_status == compliance_status)
    if risk_severity:
        query = query.filter(PolicyGapFinding.risk_severity == risk_severity)
    if remediation_status:
        query = query.filter(PolicyGapFinding.remediation_status == remediation_status)
    if framework_name:
        query = query.filter(PolicyGapFinding.framework_name.ilike(f"%{framework_name}%"))

    sort_column = getattr(PolicyGapFinding, sort_by, PolicyGapFinding.clause_reference)
    if sort_order == "desc":
        query = query.order_by(sort_column.desc())
    else:
        query = query.order_by(sort_column.asc())

    total = query.count()
    findings = query.offset(skip).limit(limit).all()

    return {
        "run_id": run_id,
        "run": serialize_run(run),
        "findings": [serialize_finding(f, db) for f in findings],
        "total": total,
        "skip": skip,
        "limit": limit
    }


@router.put("/findings/{finding_id}")
def update_finding(
    finding_id: int,
    update: FindingUpdateRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    finding = db.query(PolicyGapFinding).filter(
        PolicyGapFinding.id == finding_id,
        PolicyGapFinding.tenant_id.in_(user_tenants)
    ).first()

    if not finding:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Finding not found or access denied"
        )

    if update.assigned_owner_id is not None:
        finding.assigned_owner_id = update.assigned_owner_id
    if update.target_remediation_date is not None:
        finding.target_remediation_date = update.target_remediation_date
    if update.remediation_status is not None:
        finding.remediation_status = update.remediation_status
        if update.remediation_status == "closed":
            finding.actual_close_date = datetime.utcnow()
    if update.evidence_ids is not None:
        finding.evidence_ids = update.evidence_ids
    if update.evidence_notes is not None:
        finding.evidence_notes = update.evidence_notes

    finding.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(finding)

    return serialize_finding(finding, db)


@router.put("/findings/{finding_id}/override")
def override_finding(
    finding_id: int,
    override: FindingOverrideRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    finding = db.query(PolicyGapFinding).filter(
        PolicyGapFinding.id == finding_id,
        PolicyGapFinding.tenant_id.in_(user_tenants)
    ).first()

    if not finding:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Finding not found or access denied"
        )

    valid_statuses = ["fully_compliant", "partially_compliant", "not_addressed", "not_applicable"]
    if override.override_status not in valid_statuses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid override status. Must be one of: {', '.join(valid_statuses)}"
        )

    finding.is_overridden = True
    finding.override_status = override.override_status
    finding.override_justification = override.override_justification
    finding.overridden_by = current_user.id
    finding.overridden_at = datetime.utcnow()
    finding.compliance_status = override.override_status
    finding.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(finding)

    return serialize_finding(finding, db)


@router.put("/findings/{finding_id}/accept-risk")
def accept_risk(
    finding_id: int,
    acceptance: RiskAcceptanceRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    finding = db.query(PolicyGapFinding).filter(
        PolicyGapFinding.id == finding_id,
        PolicyGapFinding.tenant_id.in_(user_tenants)
    ).first()

    if not finding:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Finding not found or access denied"
        )

    # Update finding with risk acceptance
    finding.risk_accepted = True
    finding.risk_acceptance_justification = acceptance.risk_acceptance_justification
    finding.risk_acceptance_approved_by = current_user.id
    finding.risk_acceptance_approved_at = datetime.utcnow()
    finding.risk_acceptance_expiry_date = acceptance.risk_acceptance_expiry_date
    finding.remediation_status = "accepted_risk"
    finding.updated_at = datetime.utcnow()

    # Create or update risk in risk register
    if not finding.risk_register_id:
        # Get document details for context
        document = db.query(GovernanceDocument).filter(
            GovernanceDocument.id == finding.document_id
        ).first()
        
        # Determine risk severity mapping
        severity_to_impact = {
            "low": 2,
            "medium": 3,
            "high": 4,
            "critical": 5
        }
        
        impact_value = severity_to_impact.get(finding.risk_severity, 3)
        likelihood_value = 3  # Default medium likelihood
        
        # Create comprehensive risk title and description
        risk_title = f"Gap Analysis: {finding.clause_reference} - {finding.clause_title}"
        if len(risk_title) > 250:
            risk_title = risk_title[:247] + "..."
            
        risk_description = f"""**Source:** Gap Analysis Finding #{finding.id}
**Framework:** {finding.framework_name}
**Control Reference:** {finding.clause_reference}
**Policy Document:** {document.title if document else 'Unknown'} (ID: {finding.document_id})

**Gap Description:**
{finding.gap_description or 'See gap finding for details'}

**Missing Requirement:**
{finding.missing_requirement or 'N/A'}

**Risk Acceptance Justification:**
{acceptance.risk_acceptance_justification}
"""
        
        # Create new risk entry
        new_risk = Risk(
            tenant_id=finding.tenant_id,
            title=risk_title,
            description=risk_description,
            category="compliance",
            risk_category="compliance",
            risk_sub_category="gap_analysis",
            register_type=finding.framework_name,
            owner_id=finding.assigned_owner_id or current_user.id,
            inherent_likelihood=likelihood_value,
            inherent_impact=impact_value,
            inherent_score=float(likelihood_value * impact_value),
            residual_likelihood=likelihood_value,
            residual_impact=impact_value,
            residual_score=float(likelihood_value * impact_value),
            status="accepted",  # Mark as accepted since this is risk acceptance
            treatment_plan=f"Risk accepted. Monitored until expiry: {acceptance.risk_acceptance_expiry_date.strftime('%Y-%m-%d') if acceptance.risk_acceptance_expiry_date else 'No expiry'}",
            review_date=acceptance.risk_acceptance_expiry_date,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        
        db.add(new_risk)
        db.flush()  # Get the ID
        
        # Link finding to risk
        finding.risk_register_id = new_risk.id

    db.commit()
    
    # Log the action for review
    log_governance_action(
        db=db,
        tenant_id=finding.tenant_id,
        action_type="risk_acceptance",
        action_description=f"Risk accepted for finding: {finding.clause_reference} ({finding.framework_name})",
        entity_type="policy_gap_finding",
        action_user_id=current_user.id,
        entity_id=finding.id,
        action_metadata={
            "document_id": finding.document_id,
            "framework_name": finding.framework_name,
            "risk_register_id": finding.risk_register_id,
            "expiry_date": finding.risk_acceptance_expiry_date.isoformat() if finding.risk_acceptance_expiry_date else None,
            "justification": acceptance.risk_acceptance_justification[:200] if acceptance.risk_acceptance_justification else None
        }
    )
    db.commit()
    
    db.refresh(finding)

    return serialize_finding(finding, db)


@router.get("/compliance-summary/{document_id}")
def get_compliance_summary(
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found or access denied"
        )

    latest_run_ids = _get_latest_run_ids(db, document_id, user_tenants)

    findings_query = db.query(PolicyGapFinding).filter(
        PolicyGapFinding.document_id == document_id,
        PolicyGapFinding.tenant_id.in_(user_tenants)
    )
    if latest_run_ids:
        findings_query = findings_query.filter(PolicyGapFinding.analysis_run_id.in_(latest_run_ids))

    findings = findings_query.all()

    framework_groups = {}
    for f in findings:
        fw_name = f.framework_name
        if fw_name not in framework_groups:
            framework_groups[fw_name] = {
                "framework_name": fw_name,
                "total_clauses": 0,
                "fully_compliant": 0,
                "partially_compliant": 0,
                "not_addressed": 0,
                "not_applicable": 0,
            }
        grp = framework_groups[fw_name]
        grp["total_clauses"] += 1
        effective_status = f.compliance_status
        if effective_status == "fully_compliant":
            grp["fully_compliant"] += 1
        elif effective_status == "partially_compliant":
            grp["partially_compliant"] += 1
        elif effective_status == "not_applicable":
            grp["not_applicable"] += 1
        else:
            grp["not_addressed"] += 1

    summary = []
    for grp in framework_groups.values():
        assessable = grp["total_clauses"] - grp["not_applicable"]
        grp["compliance_percentage"] = round((grp["fully_compliant"] / assessable) * 100, 2) if assessable > 0 else 100.0
        summary.append(grp)

    return {
        "document_id": document_id,
        "frameworks": summary,
        "total_frameworks": len(summary)
    }


@router.get("/export/{document_id}")
def export_findings_csv(
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found or access denied"
        )

    findings = db.query(PolicyGapFinding).filter(
        PolicyGapFinding.document_id == document_id,
        PolicyGapFinding.tenant_id.in_(user_tenants)
    ).order_by(PolicyGapFinding.framework_name, PolicyGapFinding.clause_reference).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Framework Clause", "Policy Ref", "Compliance Status", "Gap Description",
        "Risk Rating", "Recommended Action", "Owner", "Target Date", "Status",
        "Evidence", "Last Updated"
    ])

    for f in findings:
        owner_name = ""
        if f.assigned_owner_id:
            owner = db.query(GRCUser).filter(GRCUser.id == f.assigned_owner_id).first()
            if owner:
                owner_name = owner.display_name or ""

        writer.writerow([
            f"{f.framework_name} - {f.clause_reference}",
            f.policy_section_reference or "",
            f.compliance_status or "",
            f.gap_description or "",
            f.risk_severity or "",
            f.remediation_recommendation or "",
            owner_name,
            f.target_remediation_date.strftime("%Y-%m-%d") if f.target_remediation_date else "",
            f.remediation_status or "",
            f.evidence_notes or "",
            f.updated_at.strftime("%Y-%m-%d %H:%M") if f.updated_at else "",
        ])

    output.seek(0)

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=gap_analysis_{document_id}_{datetime.utcnow().strftime('%Y%m%d')}.csv"
        }
    )
