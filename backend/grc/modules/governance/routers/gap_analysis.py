from ....config import get_openai_model
import contextlib
import logging
import os
import io
import csv
import json
import math
import re
import threading
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from pydantic import BaseModel
from openai import OpenAI

from ....db import open_tenant_session
from ....models import (
    GovernanceDocument, GovernanceDocumentVersion, PolicyGapAnalysisRun,
    PolicyGapFinding, UploadedFramework, ParsedFrameworkControl, GRCUser,
    get_db, Risk, PolicyStatement, PolicyStatementVersion,
    StatementControlMapping, NormalizedControl, NormalizedControlLink,
    InternalControl, InternalControlFrameworkLink, DocumentControlLink,
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant
from ....services.ai_gateway.errors import AIBlocked
from .policy_parser import extract_text_from_file, _create_version_snapshot, public_job_error
from ..action_logger import log_governance_action
from ..permissions import ensure_editor, ensure_not_archived, require_doc_changer, require_doc_editor, require_doc_reader

router = APIRouter(prefix="/gap-analysis", tags=["Policy Gap Analysis"])
logger = logging.getLogger(__name__)

AI_INTEGRATIONS_OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
AI_INTEGRATIONS_OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
_WORD_RE = re.compile(r"[a-z0-9]+")
_FUZZY_STOP = {"the", "and", "for", "with", "from", "that", "this", "into", "over", "under", "control", "controls", "policy", "shall", "must"}
_OPEN_GAP_STATUSES = ("not_addressed", "partially_compliant")


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
            model=get_openai_model(),
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
    except AIBlocked:       # the data-protection guard refused: its message is already written for a person
        raise
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
        # Remediation fix workflow — AI clause draft + apply audit.
        "suggested_clause_text": finding.suggested_clause_text,
        "suggested_clause_generated_at": finding.suggested_clause_generated_at.isoformat() if finding.suggested_clause_generated_at else None,
        "replacement_mode": finding.replacement_mode,  # "replace" | "append" | null
        "original_clause_text": finding.original_clause_text,
        "applied_at": finding.applied_at.isoformat() if finding.applied_at else None,
        "applied_by": finding.applied_by,
        "applied_clause_text": finding.applied_clause_text,
        "applied_version_id": finding.applied_version_id,
        "applied_statement_id": finding.applied_statement_id,
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
        "ai_model_used": None,              # kept in the database; the page never shows a model name (the key stays for old readers)
        "error_message": public_job_error(run.error_message),       # the stored text stays for the logs
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
    ensure_editor(db, current_user, document)
    ensure_not_archived(document)                      # its gap runs stay as they are until it is restored

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

    # The rate limit before any run is made: a refused run leaves nothing behind. It fails open without Redis (optional
    # locally), and then Celery, whose broker is that Redis, is not tried: the job runs on a thread at once.
    from ....tasks.base import tenant_rate_limit, RateLimitExceeded
    try:
        redis_up = tenant_rate_limit(tenant_slug, bucket="gap_analysis")
    except RateLimitExceeded:
        raise HTTPException(status_code=429, detail="Too many gap-analysis runs in the last minute; try again shortly")

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
            ai_model_used=get_openai_model(),
            started_at=datetime.utcnow(),
            created_by=current_user.id
        )
        db.add(run)
        db.flush()
        all_runs.append(run)

    db.commit()

    run_ids = [r.id for r in all_runs]
    serialized = [serialize_run(r) for r in all_runs]

    # Same fallback strategy as the parse-policy endpoint — Celery first,
    # in-thread daemon if the broker is unreachable or DISABLE_CELERY_DISPATCH=1.
    import os as _os
    task_id: str
    dispatched_via = "celery"
    force_thread = not redis_up or _os.environ.get("DISABLE_CELERY_DISPATCH", "").strip().lower() in ("1", "true", "yes", "on")

    if not force_thread:
        try:
            from ....tasks.governance import run_gap_analysis as _gap_task
            async_result = _gap_task.delay(tenant_slug, run_ids, request.document_id, current_user.id)
            task_id = async_result.id
        except Exception as _celery_exc:  # noqa: BLE001
            logger.warning("gap_analysis: celery dispatch failed, falling back to a thread (%s: %.140s)",
                           type(_celery_exc).__name__, _celery_exc)
            force_thread = True

    if force_thread:
        try:
            from ....tasks.governance import dispatch_gap_analysis_in_thread
            task_id = dispatch_gap_analysis_in_thread(
                tenant_slug, run_ids, request.document_id, current_user.id,
            )
        except Exception:  # noqa: BLE001
            # nothing will run them: the runs say so, instead of 'running' for every viewer for ever
            import logging
            logging.getLogger(__name__).exception("gap analysis dispatch failed for document %s", request.document_id)
            for r in all_runs:
                r.status, r.error_message, r.completed_at = "failed", "The gap analysis could not be started.", datetime.utcnow()
            db.commit()
            raise HTTPException(status_code=503, detail="The gap analysis could not be started now. Try again in a minute.")
        dispatched_via = "thread"

    with contextlib.suppress(Exception):            # the runs are on their way: a diagnostic never turns that into an error
        logger.info("gap_analysis dispatched via %s task_id=%s tenant=%s doc=%s runs=%s", dispatched_via, task_id, tenant_slug,
                    request.document_id, len(run_ids))

    return {
        "message": f"Gap analysis queued for {len(all_runs)} framework(s). Check status for results.",
        "document_id": request.document_id,
        "task_id": task_id,
        "dispatched_via": dispatched_via,
        "runs": serialized,
        "status": "queued"
    }


@router.get("/runs/{document_id}", dependencies=[Depends(require_doc_reader)])
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

    # A run still 'running' long after its job could have ended (the worker or the server stopped; Celery stops a job at 20
    # minutes) is shown as failed, so the page stops polling. Nothing is written (a GET writes nothing): a job that does
    # finish late still records its result.
    STALE_AFTER_SECONDS = 1800  # 30 minutes
    now = datetime.utcnow()
    rows = [serialize_run(r) for r in runs]
    for r, row in zip(runs, rows):
        if r.status == "running" and r.started_at and (now - r.started_at).total_seconds() > STALE_AFTER_SECONDS:
            row.update(status="failed", error_message="The gap analysis did not finish. Run it again.")

    return {
        "document_id": document_id,
        "runs": rows,
        "total": len(runs)
    }


@router.get("/findings/document/{document_id}", dependencies=[Depends(require_doc_reader)])
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
    require_doc_reader(run.document_id, db, current_user)

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


# ---------------------------------------------------------------------------
# Apply-fix workflow: AI drafts the actual clause text needed to close a gap;
# user reviews/edits in a popup; on approve the document content is updated
# and the finding is marked as remediated. Two-step so the user always sees
# (and can edit) the proposed text before it lands in the document.
# ---------------------------------------------------------------------------


class ApplyFixRequest(BaseModel):
    """Body of POST /findings/{id}/apply-fix.

    `mode` chooses splice strategy:
      - "replace" — `current_text` MUST appear verbatim somewhere in the
        document; that exact slice is replaced with `proposed_text`.
      - "append" — `proposed_text` is appended under a new section heading;
        `current_text` is ignored.

    We don't trust the stored draft — we use the text the user actually
    approves at the moment of application.
    """
    mode: str = "append"
    proposed_text: str
    current_text: Optional[str] = None
    section_heading: Optional[str] = None
    change_reason: Optional[str] = None  # optional commit-style note for the version row


def _generate_clause_fix(document: GovernanceDocument, finding: PolicyGapFinding) -> dict:
    """Ask GPT-4o to either:
      (a) identify a specific existing block of policy text that should be
          REPLACED to close the gap, returning that exact verbatim slice
          plus the proposed replacement, OR
      (b) recommend APPENDING a brand-new clause when no existing block is
          a good candidate.

    Returns: { mode, current_text|None, proposed_text }
    Raises HTTPException on misconfiguration / AI failure.
    """
    if not AI_INTEGRATIONS_OPENAI_API_KEY or not AI_INTEGRATIONS_OPENAI_BASE_URL:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OpenAI integration not configured"
        )

    client = OpenAI(
        api_key=AI_INTEGRATIONS_OPENAI_API_KEY,
        base_url=AI_INTEGRATIONS_OPENAI_BASE_URL
    )

    from .. import change_chain as _chain

    # the text a fix is applied to: the content, or for a document that is its Word or PDF file, the file's text
    full_content = _chain.document_text(document) or ""
    # Cap to keep the prompt within model budget. Most policies fit; truncated
    # tail is rarely the right place to splice anyway.
    existing_text_excerpt = full_content[:12000]

    system_msg = (
        "You are a senior policy writer for a GRC team. Given a policy "
        "document and a compliance gap, you decide whether the gap is best "
        "closed by REPLACING an existing paragraph/clause (when one is "
        "partially relevant but incomplete) or by APPENDING a brand-new "
        "clause (when nothing in the policy is close to the gap topic). "
        "If you choose REPLACE, you MUST quote the original verbatim — "
        "exactly as it appears in the document, including punctuation and "
        "newlines — so the application can locate and substitute it. Output "
        "STRICT JSON only, no prose."
    )
    user_msg = f"""DOCUMENT TITLE: "{document.title or 'Untitled'}"
DOCUMENT TYPE: {document.doc_type or 'policy'}

FRAMEWORK: {finding.framework_name or 'unknown framework'}
FRAMEWORK CLAUSE REFERENCE: {finding.clause_reference or 'n/a'}
FRAMEWORK CLAUSE TITLE: {finding.clause_title or 'n/a'}
FRAMEWORK CLAUSE REQUIREMENT TEXT:
\"\"\"
{finding.clause_requirement_text or '(not provided)'}
\"\"\"

GAP DESCRIPTION:
\"\"\"
{finding.gap_description or '(not provided)'}
\"\"\"

MISSING REQUIREMENT:
\"\"\"
{finding.missing_requirement or '(not provided)'}
\"\"\"

REMEDIATION RECOMMENDATION (advisory):
\"\"\"
{finding.remediation_recommendation or '(not provided)'}
\"\"\"

EXISTING POLICY DOCUMENT CONTENT (this is the source — for "replace" mode, current_text MUST be a verbatim substring of this):
\"\"\"
{existing_text_excerpt}
\"\"\"

Choose mode:
- "replace" — pick this when the document already has a paragraph/clause that addresses the same topic but is incomplete or wrong. Quote it VERBATIM as `current_text` (must be a literal substring of the document). Provide the full revised paragraph as `proposed_text` (preserving the surrounding tone, voice, and formatting style).
- "append" — pick this when no existing paragraph is a reasonable candidate. Set `current_text` to null and provide a self-contained new clause as `proposed_text`.

Return STRICT JSON ONLY in this exact shape:
{{
  "mode": "replace" | "append",
  "current_text": "<verbatim substring from the document, or null when mode is append>",
  "proposed_text": "<the new or revised clause>"
}}

Rules for proposed_text:
- 3–10 sentences typical
- No markdown headings (the application adds the heading)
- Use "shall" / "must" for mandatory requirements
- Match the tone of the existing policy
- For "replace" mode, `proposed_text` should be a strict superset/correction of `current_text` (don't drop content that was correct; expand or fix what was missing)
"""

    try:
        response = client.chat.completions.create(
            model=get_openai_model(),
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg},
            ],
            response_format={"type": "json_object"},
            temperature=0.2,
            max_completion_tokens=1500,
        )
        raw = response.choices[0].message.content or "{}"
        parsed = json.loads(raw)

        mode = (parsed.get("mode") or "append").strip().lower()
        if mode not in ("replace", "append"):
            mode = "append"
        proposed_text = (parsed.get("proposed_text") or "").strip()
        current_text = parsed.get("current_text")
        if isinstance(current_text, str):
            current_text = current_text.strip("\r\n").rstrip()
            # Sanity: enforce the rule that for replace mode the quoted text
            # must actually appear in the document. If the AI hallucinated,
            # fall back to append mode rather than failing — the user will
            # see "append" in the UI and can still edit/approve.
            if mode == "replace" and (not current_text or current_text not in full_content):
                mode = "append"
                current_text = None
        else:
            current_text = None
            if mode == "replace":
                mode = "append"

        if not proposed_text:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="AI returned an empty proposed clause"
            )

        return {
            "mode": mode,
            "current_text": current_text,
            "proposed_text": proposed_text,
        }
    except HTTPException:
        raise
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI returned invalid JSON: {str(e)}"
        )
    except Exception as e:
        msg = str(e)
        if "FREE_CLOUD_BUDGET_EXCEEDED" in msg:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="Cloud budget exceeded. Please upgrade your plan."
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI clause-draft failed: {msg}"
        )


@router.post("/findings/{finding_id}/generate-fix")
def generate_finding_fix(
    finding_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Draft (or re-draft) the AI clause text for closing this gap. Persists
    `suggested_clause_text` on the finding row so the popup can render it
    immediately on subsequent opens without re-paying for the AI call.
    """
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

    if finding.compliance_status not in ("not_addressed", "partially_compliant"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only not_addressed or partially_compliant findings can be remediated with a clause draft."
        )

    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == finding.document_id,
        GovernanceDocument.tenant_id.in_(user_tenants),
    ).first()
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source document not found"
        )
    ensure_editor(db, current_user, document)
    ensure_not_archived(document)                      # a fix could not be applied to it

    drafted = _generate_clause_fix(document, finding)
    finding.suggested_clause_text = drafted["proposed_text"]
    finding.replacement_mode = drafted["mode"]
    finding.original_clause_text = drafted["current_text"]
    finding.suggested_clause_generated_at = datetime.utcnow()
    finding.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(finding)

    return {
        "finding_id": finding.id,
        "mode": finding.replacement_mode,
        "current_text": finding.original_clause_text,
        "proposed_text": finding.suggested_clause_text,
        # Backwards-compat: prior frontend reads `suggested_clause_text`.
        "suggested_clause_text": finding.suggested_clause_text,
        "suggested_clause_generated_at": finding.suggested_clause_generated_at.isoformat()
            if finding.suggested_clause_generated_at else None,
    }


def _gap_name(finding: PolicyGapFinding) -> str:
    return " ".join(p for p in (finding.framework_name, finding.clause_reference) if p) or "a framework clause"


def _write_text(db: Session, document: GovernanceDocument, user: GRCUser, old_text: str, new_text: str, *, change_type: str,
                origin: str, summary: str, reason: str, done: str):
    """Put ``new_text`` into the document as every other save does: its next version, the versions before it kept. A document that
    is its Word or PDF file gets a new file, as a take back does (a Word file is edited in place, a PDF becomes a Word copy). The
    version's change set says who made the change. Does not commit. Returns ``(version row, number, notes, is_file)``."""
    from .. import change_chain as C, doc_lifecycle
    from .documents import _snapshot_content_version, create_audit_log

    is_file = not (document.content or "").strip()
    old_version, old_status = document.current_version or "1.0", document.status
    name = user.display_name or user.username or "A user"
    notes: List[str] = []
    if is_file:
        from ..studio import service as studio

        try:
            data, notes = studio.file_bytes(db, document, new_text)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"The document's file could not be written: {exc}")
        row, number, _ = studio.write_file_version(db, document, user, data, change_type=change_type, summary=summary, reason=reason, done=done)
    else:
        document.content, document.updated_at = new_text, datetime.utcnow()
        number = _snapshot_content_version(db, document, old_content=old_text, old_title=document.title, old_version=old_version,
                                           change_type=change_type, change_reason=reason, user_id=user.id, summary=summary)
        db.flush()
        row = (db.query(GovernanceDocumentVersion).filter(GovernanceDocumentVersion.document_id == document.id,
                                                          GovernanceDocumentVersion.version_number == number)
               .order_by(GovernanceDocumentVersion.id.desc()).first())
        doc_lifecycle.changed_after_review(db, document, old_status, user.id, f"{done} (version {number}), so it needs approving again")
        create_audit_log(db=db, document_id=document.id, tenant_id=document.tenant_id, user_id=user.id, action="content_edited",
                         field_changed="current_version", old_value=old_version, new_value=number,
                         action_details=f"{reason}; version {number}" + doc_lifecycle.outcome(old_status, document.status, document))
    if row is not None:
        cs = C.build_change_set(old_text, new_text, [], default_kind=origin, by=name, by_id=user.id, at=datetime.utcnow().isoformat())
        for item in cs["items"]:
            item["reason"] = reason
        row.change_set = cs
    return row, number, notes, is_file


def _take_back(text: str, finding: PolicyGapFinding) -> Optional[str]:
    """``text`` without what this finding's fix put into it, every other change kept: a replaced clause gets its earlier wording
    back; an added clause goes, with the heading it was added under when that heading holds nothing else. None when the clause
    is not in the text as it was applied (it was edited since)."""
    clause = (finding.applied_clause_text or "").strip()
    # an added clause went in after everything the document held then: its last copy (an earlier one was there already)
    at = (text.rfind(clause) if finding.replacement_mode != "replace" else text.find(clause)) if clause else -1
    if at < 0:
        return None
    if finding.replacement_mode == "replace":
        if finding.original_clause_text is None:
            return None
        return text[:at] + finding.original_clause_text.rstrip() + text[at + len(clause):]
    start, rest = at, text[at + len(clause):]
    head = re.search(r"(?:\A|\n)\n*#{1,6}[ \t][^\n]*\n\s*\Z", text[:at])        # the heading line right above the clause
    if head and re.match(r"\s*(?:#|\Z)", rest):                                  # ... which holds only this clause
        start = head.start()
    left = text[:start].rstrip("\n")
    return left + ("\n\n" + rest.lstrip("\n") if rest.strip() else "")


def _norm_ws(s: Optional[str]) -> str:
    """Collapse runs of whitespace so text extracted differently (statement vs.
    verbatim document slice) can still be compared."""
    return " ".join((s or "").split())


def _find_matching_statement(
    db: Session, document_id: int, tenant_ids: list, target_text: str
) -> Optional[PolicyStatement]:
    """Best-effort: find the active PolicyStatement for this document whose text
    corresponds to `target_text` (the verbatim slice the clause replaced).
    Exact match wins outright; otherwise substring containment (either
    direction) beats word-overlap, and nothing below the overlap threshold is
    returned. Returns None when there's no confident match."""
    target = _norm_ws(target_text)
    if not target:
        return None
    statements = db.query(PolicyStatement).filter(
        PolicyStatement.document_id == document_id,
        PolicyStatement.tenant_id.in_(tenant_ids),
        PolicyStatement.status == "active",
    ).all()

    target_tokens = set(target.lower().split())
    best, best_score = None, 0.0
    for st in statements:
        stext = _norm_ws(st.statement_text)
        if not stext:
            continue
        if stext == target:
            return st
        if stext in target or target in stext:
            shorter, longer = sorted((len(stext), len(target)))
            score = 2.0 + (shorter / longer if longer else 0.0)
        else:
            st_tokens = set(stext.lower().split())
            union = st_tokens | target_tokens
            overlap = (len(st_tokens & target_tokens) / len(union)) if union else 0.0
            score = overlap if overlap >= 0.5 else 0.0
        if score > best_score:
            best, best_score = st, score
    return best


def _sync_statement_on_apply(
    db: Session, document: GovernanceDocument, finding: PolicyGapFinding,
    mode: str, current_text: Optional[str], proposed_text: str,
    new_version: GovernanceDocumentVersion, user_id: int, tenant_ids: list,
) -> None:
    """Keep the policy-statement register in step with an applied clause:
      - "replace" — update the matching statement's text (version-snapshot first)
      - "append"  — create a new statement carrying the added clause

    Stores applied_statement_id / applied_statement_prev_text on the finding so
    an override/undo can restore (replace) or retract (append) it. Best-effort:
    a failure here is logged but never blocks the document change."""
    try:
        if mode == "replace" and current_text:
            matched = _find_matching_statement(db, document.id, tenant_ids, current_text)
            if not matched:
                return
            reason = f"Gap remediation — {finding.framework_name or ''} {finding.clause_reference or ''}".strip()
            finding.applied_statement_prev_text = matched.statement_text
            _create_version_snapshot(db, matched, "gap_remediation", user_id, change_reason=reason)
            # Splice within the statement if it embeds the replaced slice,
            # otherwise the statement corresponds to the slice — take it whole.
            if current_text in (matched.statement_text or ""):
                matched.statement_text = matched.statement_text.replace(current_text, proposed_text, 1)
            else:
                matched.statement_text = proposed_text
            matched.document_version_id = new_version.id
            matched.updated_at = datetime.utcnow()
            finding.applied_statement_id = matched.id
        elif mode == "append":
            existing_count = db.query(PolicyStatement).filter(
                PolicyStatement.document_id == document.id
            ).count()
            statement_code = f"PS-{document.id:04d}-{existing_count + 1:03d}"
            new_stmt = PolicyStatement(
                tenant_id=document.tenant_id,
                document_id=document.id,
                document_version_id=new_version.id,
                statement_code=statement_code,
                statement_text=proposed_text[:10000],
                priority="medium",
                is_mandatory=True,
                source_section=finding.clause_reference or None,
                status="active",
                created_by=user_id,
                created_at=datetime.utcnow(),
            )
            db.add(new_stmt)
            db.flush()
            reason = f"Added to close gap — {finding.framework_name or ''} {finding.clause_reference or ''}".strip()
            _create_version_snapshot(db, new_stmt, "gap_remediation", user_id, change_reason=reason)
            finding.applied_statement_id = new_stmt.id
            finding.applied_statement_prev_text = None  # marks a created statement
    except Exception as sync_exc:  # noqa: BLE001
        logger.warning("gap apply: statement sync skipped: %s: %s", type(sync_exc).__name__, sync_exc)


@router.post("/findings/{finding_id}/apply-fix")
def apply_finding_fix(
    finding_id: int,
    body: ApplyFixRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Apply the (user-approved) clause to the document. Two modes:
      - "replace" — splice `proposed_text` in for the verbatim `current_text`
      - "append" — append `proposed_text` under a new section heading

    The change is saved as every other save is: the document's next version (major or minor, as Comply Agent or the rule judges
    it), the versions before it kept. A document that is its Word or PDF file gets the fix in a new file (a Word file edited in
    place, a PDF a Word copy). The finding links to that version; Override takes the fix back out on its own (``override_finding``).
    """
    user_tenants = get_user_tenants(current_user, db)

    proposed_text = (body.proposed_text or "").strip()
    if not proposed_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Proposed clause text cannot be empty"
        )
    mode = (body.mode or "append").strip().lower()
    if mode not in ("replace", "append"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="mode must be 'replace' or 'append'"
        )

    finding = db.query(PolicyGapFinding).filter(
        PolicyGapFinding.id == finding_id,
        PolicyGapFinding.tenant_id.in_(user_tenants)
    ).first()
    if not finding:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Finding not found or access denied"
        )

    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == finding.document_id,
        GovernanceDocument.tenant_id.in_(user_tenants),
    ).first()
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source document not found"
        )
    ensure_editor(db, current_user, document)
    ensure_not_archived(document)

    from .. import change_chain as C, doc_version

    # the text the fix goes into: the content, or for a document that is its Word or PDF file, the file's text
    original_content = C.document_text(document)
    if original_content is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="The text of this document's file cannot be read, so the fix cannot be written into it.")
    original_version_label = document.current_version or "1.0"
    original_status = document.status

    # ---- Compute the new content. --------------------------------------
    if mode == "replace":
        current_text = (body.current_text or "").rstrip()
        if not current_text:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="current_text is required for replace mode"
            )
        if current_text not in original_content:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The original text could not be found in the document — it may have been edited since the AI draft was generated. Please regenerate the fix."
            )
        new_content = original_content.replace(current_text, proposed_text, 1)
    else:
        # Append under a heading anchored to the framework clause.
        heading_parts: List[str] = []
        if body.section_heading and body.section_heading.strip():
            heading_parts.append(body.section_heading.strip())
        else:
            if finding.framework_name:
                heading_parts.append(finding.framework_name)
            if finding.clause_reference:
                heading_parts.append(finding.clause_reference)
            if finding.clause_title:
                heading_parts.append(finding.clause_title)
        heading = " — ".join(heading_parts) if heading_parts else "Compliance Update"
        new_content = original_content + f"\n\n## {heading}\n\n{proposed_text}\n"

    # ---- Write it as every other save is: the document's next version. ----
    # Applying a remediation edits the document, so a reviewed one is reviewed again from the start by the same people (a new
    # round, also while in review or approval), as every other new version is; a draft stays a draft.
    gap = _gap_name(finding)
    reason = (body.change_reason or "").strip()[:2000] or f"Gap fix for {gap}"
    decision = doc_version.decide(original_content, new_content, title=document.title)
    drafted = proposed_text == (finding.suggested_clause_text or "").strip()        # Comply Agent's draft, as it wrote it
    new_version, new_version_label, notes, is_file = _write_text(
        db, document, current_user, original_content, new_content, change_type=decision["change"], origin="ai" if drafted else "manual",
        summary=doc_version.summary_of(f"Gap fix ({'clause replaced' if mode == 'replace' else 'clause added'}) for {gap}", decision),
        reason=reason, done="A gap fix was applied")

    now = datetime.utcnow()
    finding.applied_clause_text = proposed_text
    finding.replacement_mode = mode
    finding.original_clause_text = body.current_text if mode == "replace" else None
    finding.applied_at = now
    finding.applied_by = current_user.id
    finding.applied_version_id = new_version.id if new_version is not None else None
    finding.applied_prev_status = original_status
    # The clause now lives in the document, so the gap is addressed — flip the
    # compliance status to fully_compliant so the register reflects the fix.
    # Remediation stays IN PROGRESS (NOT auto-closed): it closes only once the
    # document's reviewer/approver approve the change (see update_document_status
    # in the documents router). An override/undo reverts both.
    finding.compliance_status = "fully_compliant"
    finding.remediation_status = "in_progress"
    finding.actual_close_date = None
    finding.updated_at = now

    # Keep the policy-statement register in sync with the applied clause: update
    # the AI-matched statement (replace) or add one (append). Best-effort.
    _sync_statement_on_apply(
        db, document, finding, mode,
        body.current_text if mode == "replace" else None,
        proposed_text, new_version, current_user.id, user_tenants,
    )

    db.commit()
    if is_file:
        from ..studio import service as studio

        studio.reanchor(db, document, current_user.id)
    db.refresh(finding)
    db.refresh(document)

    return {
        "finding_id": finding.id,
        "document_id": document.id,
        "mode": mode,
        "applied_at": finding.applied_at.isoformat() if finding.applied_at else None,
        "remediation_status": finding.remediation_status,
        "applied_version_id": finding.applied_version_id,
        "applied_version_number": new_version_label,
        "previous_version_number": original_version_label,
        "compliance_status": finding.compliance_status,
        "document_status": document.status,
        "in_place": False,               # always false now that every fix makes its own version (kept for older screens)
        "notes": notes,                  # about the document's file (e.g. a PDF became a Word copy)
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
    require_doc_editor(finding.document_id, db, current_user)

    if update.assigned_owner_id is not None:
        from ....routers.auth_router import refuse_imported_accounts
        refuse_imported_accounts(db, [update.assigned_owner_id], kept=[finding.assigned_owner_id])
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
    require_doc_editor(finding.document_id, db, current_user)

    valid_statuses = ["fully_compliant", "partially_compliant", "not_addressed", "not_applicable"]
    if override.override_status not in valid_statuses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid override status. Must be one of: {', '.join(valid_statuses)}"
        )

    # If this finding's remediation clause was applied to the document, an override is an UNDO: that fix's text is taken back
    # out of the document, every other change kept, as a take back is saved (the document's next version), and the applied audit
    # trail is cleared before the override is recorded.
    taken_back, refiled, left = None, None, False
    if finding.applied_at:
        document = db.query(GovernanceDocument).filter(
            GovernanceDocument.id == finding.document_id,
            GovernanceDocument.tenant_id.in_(user_tenants),
        ).first()
        if document:
            ensure_not_archived(document)       # taking the fix back out changes the document
            from .. import change_chain as C, doc_version

            old_text = C.document_text(document)
            new_text = _take_back(old_text, finding) if old_text is not None else None
            if new_text is None:
                # its clause was changed or removed in the document since: that edit stands, so the document (and the statement
                # that follows it) is left as it is - the reply says so - and the finding is overridden
                left = True
            elif new_text != old_text:
                gap = _gap_name(finding)
                why = (override.override_justification or "").strip()
                reason = f"Gap fix for {gap} taken back" + (f": {why}" if why else "")
                _row, taken_back, _notes, is_file = _write_text(
                    db, document, current_user, old_text, new_text, change_type=doc_version.by_rule(old_text, new_text), origin="revert",
                    summary=f"Gap fix for {gap} taken back", reason=reason[:2000], done="A gap fix was taken back")
                refiled = document if is_file else None
        # Revert the statement change too: restore the prior text (replace) or
        # retract the statement that was created (append).
        if finding.applied_statement_id and not left:
            stmt = db.query(PolicyStatement).filter(
                PolicyStatement.id == finding.applied_statement_id,
                PolicyStatement.tenant_id.in_(user_tenants),
            ).first()
            if stmt:
                if finding.applied_statement_prev_text is not None:
                    _create_version_snapshot(db, stmt, "gap_remediation_undo", current_user.id)
                    stmt.statement_text = finding.applied_statement_prev_text
                else:
                    stmt.status = "superseded"
                stmt.updated_at = datetime.utcnow()
        finding.applied_at = None
        finding.applied_by = None
        finding.applied_clause_text = None
        finding.applied_version_id = None
        finding.applied_prev_status = None
        finding.applied_statement_id = None
        finding.applied_statement_prev_text = None
        finding.actual_close_date = None
        finding.remediation_status = "open"

    finding.is_overridden = True
    finding.override_status = override.override_status
    finding.override_justification = override.override_justification
    finding.overridden_by = current_user.id
    finding.overridden_at = datetime.utcnow()
    finding.compliance_status = override.override_status
    finding.updated_at = datetime.utcnow()

    db.commit()
    if refiled is not None:
        from ..studio import service as studio

        studio.reanchor(db, refiled, current_user.id)
    db.refresh(finding)

    # taken_back_version: the version the document is at after its fix was taken back (None: no fix was taken back);
    # fix_left_in_document: its fix's clause was changed in the document since, so the document was left as it is
    return {**serialize_finding(finding, db), "taken_back_version": taken_back, "fix_left_in_document": left}


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
    require_doc_editor(finding.document_id, db, current_user)

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


@router.get("/compliance-summary/{document_id}", dependencies=[Depends(require_doc_reader)])
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


# ---------------------------------------------------------------------------
# Recommended controls to link against open gap findings (from frameworks the
# user actually ran gap analysis against).
# ---------------------------------------------------------------------------


def _tokens(text: Optional[str]) -> set:
    words = set(_WORD_RE.findall((text or "").lower()))
    return {w for w in words if len(w) > 2 and w not in _FUZZY_STOP}


def _resolve_parsed_control(db: Session, finding: PolicyGapFinding) -> Optional[ParsedFrameworkControl]:
    if not finding.uploaded_framework_id or not finding.clause_reference:
        return None
    ref = (finding.clause_reference or "").strip()
    if not ref:
        return None
    return db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == finding.uploaded_framework_id,
        or_(
            ParsedFrameworkControl.original_reference == ref,
            ParsedFrameworkControl.control_id == ref,
            func.lower(ParsedFrameworkControl.original_reference) == ref.lower(),
            func.lower(ParsedFrameworkControl.control_id) == ref.lower(),
        ),
    ).first()


def _doc_statement_ids(db: Session, document_id: int, user_tenants: list) -> List[int]:
    return [
        sid for (sid,) in db.query(PolicyStatement.id).filter(
            PolicyStatement.document_id == document_id,
            PolicyStatement.tenant_id.in_(user_tenants),
            PolicyStatement.status == "active",
        ).all()
    ]


def _already_linked_sets(db: Session, document_id: int, user_tenants: list, stmt_ids: List[int]) -> dict:
    """Return sets of control ids already linked to this document, by kind."""
    linked_parsed: set = set()
    linked_normalized: set = set()
    linked_internal: set = set()

    # Document ↔ normalized
    for (ncid,) in db.query(DocumentControlLink.normalized_control_id).filter(
        DocumentControlLink.document_id == document_id
    ).all():
        if ncid:
            linked_normalized.add(ncid)

    # Internal controls whose source document is this one
    for (icid,) in db.query(InternalControl.id).filter(
        InternalControl.tenant_id.in_(user_tenants),
        InternalControl.source_document_id == document_id,
    ).all():
        linked_internal.add(icid)

    # Locked statement mappings count as confirmed links
    if stmt_ids:
        for m in db.query(StatementControlMapping).filter(
            StatementControlMapping.statement_id.in_(stmt_ids),
            StatementControlMapping.tenant_id.in_(user_tenants),
            StatementControlMapping.is_locked == True,  # noqa: E712
        ).all():
            if m.control_kind == "parsed" and m.parsed_control_id:
                linked_parsed.add(m.parsed_control_id)
            elif m.control_kind == "normalized" and m.normalized_control_id:
                linked_normalized.add(m.normalized_control_id)
            elif m.control_kind == "internal" and m.internal_control_id:
                linked_internal.add(m.internal_control_id)

    return {
        "parsed": linked_parsed,
        "normalized": linked_normalized,
        "internal": linked_internal,
    }


def _truncate_text(text: Optional[str], limit: int = 600) -> Optional[str]:
    if not text:
        return None
    text = text.strip()
    if not text:
        return None
    return text[:limit] if len(text) > limit else text


def _ctrl_entry(
    kind: str,
    cid: int,
    code: Optional[str],
    title: Optional[str],
    match_reason: str,
    already_linked: bool,
    framework_name: Optional[str] = None,
    description: Optional[str] = None,
    domain: Optional[str] = None,
) -> dict:
    return {
        "kind": kind,
        "id": cid,
        "code": code,
        "title": title,
        "match_reason": match_reason,
        "already_linked": already_linked,
        "framework_name": framework_name,
        "description": _truncate_text(description),
        "domain": domain,
    }


def _recommend_for_finding(
    db: Session,
    finding: PolicyGapFinding,
    linked: dict,
    tenant_ids: list,
) -> List[dict]:
    """Build linkable control candidates for one open gap finding.

    Returns at most one preferred control per finding so the UI never surfaces
    paired Parsed + Normalized rows for the same clause. Preference:
    internal (framework_link) > normalized > parsed > internal (fuzzy).
    """
    candidates: List[dict] = []
    seen: set = set()  # (kind, id)

    def add(kind, cid, code, title, reason, fw_name=None, description=None, domain=None):
        key = (kind, cid)
        if cid is None or key in seen:
            return
        seen.add(key)
        already = cid in linked.get(kind, set())
        candidates.append(_ctrl_entry(
            kind, cid, code, title, reason, already, fw_name,
            description=description, domain=domain,
        ))

    parsed = _resolve_parsed_control(db, finding)
    if parsed:
        parsed_desc = (
            parsed.description or parsed.full_text
            or getattr(parsed, "control_description", None)
        )
        add(
            "parsed", parsed.id,
            parsed.original_reference or parsed.control_id,
            parsed.title,
            "framework_clause",
            finding.framework_name,
            description=parsed_desc,
            domain=getattr(parsed, "domain", None),
        )

        # Related normalized controls via NormalizedControlLink
        nc_rows = db.query(NormalizedControl).join(
            NormalizedControlLink,
            NormalizedControlLink.normalized_control_id == NormalizedControl.id,
        ).filter(
            NormalizedControlLink.parsed_control_id == parsed.id,
        ).all()
        nc_ids = []
        for nc in nc_rows:
            nc_ids.append(nc.id)
            add(
                "normalized", nc.id, nc.code, nc.name, "normalized_link",
                finding.framework_name,
                description=nc.statement or nc.objective,
                domain=getattr(nc, "domain", None),
            )

        # Internal controls linked to those normalized controls
        if nc_ids:
            for icfl in db.query(InternalControlFrameworkLink).filter(
                InternalControlFrameworkLink.normalized_control_id.in_(nc_ids),
            ).all():
                ic = db.query(InternalControl).filter(
                    InternalControl.id == icfl.internal_control_id,
                    InternalControl.tenant_id.in_(tenant_ids),
                ).first()
                if ic:
                    add(
                        "internal", ic.id, ic.control_id, ic.name, "framework_link",
                        finding.framework_name,
                        description=ic.description,
                        domain=getattr(ic, "category", None),
                    )

    # Fuzzy match internal controls by code/title against the gap clause
    clause_toks = _tokens(f"{finding.clause_reference or ''} {finding.clause_title or ''}")
    ref_lower = (finding.clause_reference or "").strip().lower()
    title_lower = (finding.clause_title or "").strip().lower()
    if clause_toks or ref_lower:
        candidates_ic = db.query(InternalControl).filter(
            InternalControl.tenant_id.in_(tenant_ids),
            InternalControl.status.in_(["active", "draft", "pending_approval"]),
        ).limit(400).all()
        scored = []
        for ic in candidates_ic:
            if ("internal", ic.id) in seen:
                continue
            code_l = (ic.control_id or "").lower()
            name_l = (ic.name or "").lower()
            score = 0
            if ref_lower and (ref_lower in code_l or code_l in ref_lower):
                score += 5
            if title_lower and title_lower in name_l:
                score += 4
            overlap = len(clause_toks & _tokens(f"{ic.control_id} {ic.name}"))
            score += overlap
            if score >= 3:
                scored.append((score, ic))
        scored.sort(key=lambda x: x[0], reverse=True)
        for _sc, ic in scored[:3]:
            add(
                "internal", ic.id, ic.control_id, ic.name, "fuzzy_match",
                finding.framework_name,
                description=ic.description,
                domain=getattr(ic, "category", None),
            )

    if not candidates:
        return []

    kind_rank = {"internal": 4, "normalized": 3, "framework": 2, "parsed": 1}
    reason_rank = {
        "framework_link": 4,
        "normalized_link": 3,
        "framework_clause": 2,
        "fuzzy_match": 1,
    }
    candidates.sort(
        key=lambda c: (
            kind_rank.get(c["kind"], 0),
            reason_rank.get(c["match_reason"], 0),
        ),
        reverse=True,
    )
    return [candidates[0]]


@router.get("/document/{document_id}/recommended-controls", dependencies=[Depends(require_doc_reader)])
def get_gap_recommended_controls(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Recommend linkable controls for open gaps from the latest completed gap
    runs (frameworks the user actually analyzed against).

    For each not_addressed / partially_compliant finding, resolve candidates
    (ParsedFrameworkControl + related NormalizedControl / InternalControl) and
    return the single preferred control: internal > normalized > parsed.
    already_linked comes from DocumentControlLink, InternalControl.source_document_id,
    and locked StatementControlMapping.
    """
    user_tenants = get_user_tenants(current_user, db)

    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants),
    ).first()
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found or access denied",
        )

    latest_run_ids = _get_latest_run_ids(db, document_id, user_tenants)
    if not latest_run_ids:
        return {
            "document_id": document_id,
            "framework_ids": [],
            "findings": [],
            "total_recommendations": 0,
            "unlinked_count": 0,
        }

    findings = db.query(PolicyGapFinding).filter(
        PolicyGapFinding.document_id == document_id,
        PolicyGapFinding.tenant_id.in_(user_tenants),
        PolicyGapFinding.analysis_run_id.in_(latest_run_ids),
        PolicyGapFinding.compliance_status.in_(_OPEN_GAP_STATUSES),
    ).order_by(PolicyGapFinding.framework_name, PolicyGapFinding.clause_reference).all()

    stmt_ids = _doc_statement_ids(db, document_id, user_tenants)
    linked = _already_linked_sets(db, document_id, user_tenants, stmt_ids)

    framework_ids = sorted({
        f.uploaded_framework_id for f in findings if f.uploaded_framework_id
    })

    grouped = []
    total_recs = 0
    unlinked = 0
    for f in findings:
        controls = _recommend_for_finding(db, f, linked, user_tenants)
        if not controls:
            continue
        total_recs += len(controls)
        unlinked += sum(1 for c in controls if not c["already_linked"])
        grouped.append({
            "finding_id": f.id,
            "clause_reference": f.clause_reference,
            "clause_title": f.clause_title,
            "clause_requirement_text": _truncate_text(f.clause_requirement_text, 1200),
            "compliance_status": f.compliance_status,
            "gap_description": _truncate_text(f.gap_description, 800),
            "missing_requirement": _truncate_text(f.missing_requirement, 800),
            "remediation_recommendation": _truncate_text(f.remediation_recommendation, 800),
            "ai_reasoning": _truncate_text(f.ai_reasoning, 800),
            "confidence_score": f.confidence_score,
            "risk_severity": f.risk_severity,
            "framework_name": f.framework_name,
            "uploaded_framework_id": f.uploaded_framework_id,
            "controls": controls,
        })

    return {
        "document_id": document_id,
        "framework_ids": framework_ids,
        "findings": grouped,
        "total_recommendations": total_recs,
        "unlinked_count": unlinked,
    }


class GapRecommendedControlLinkRequest(BaseModel):
    control_kind: str  # parsed | normalized | internal
    control_id: int
    finding_id: Optional[int] = None


@router.post("/document/{document_id}/recommended-controls/link", dependencies=[Depends(require_doc_changer)])
def link_gap_recommended_control(
    document_id: int,
    body: GapRecommendedControlLinkRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Link a recommended control to the document using the appropriate path:
      - internal  → InternalControl.source_document_id
      - normalized → DocumentControlLink (+ lock StatementControlMapping if present)
      - parsed    → lock/create StatementControlMapping on an active statement
    """
    user_tenants = get_user_tenants(current_user, db)

    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants),
    ).first()
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found or access denied",
        )

    kind = (body.control_kind or "").strip().lower()
    if kind not in ("parsed", "normalized", "internal"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="control_kind must be parsed, normalized, or internal",
        )

    method = None

    if kind == "internal":
        control = db.query(InternalControl).filter(
            InternalControl.id == body.control_id,
            InternalControl.tenant_id.in_(user_tenants),
        ).first()
        if not control:
            raise HTTPException(status_code=404, detail="Internal control not found")
        if control.source_document_id == document_id:
            return {
                "document_id": document_id,
                "control_kind": kind,
                "control_id": body.control_id,
                "linked": True,
                "method": "already_linked",
            }
        if control.source_document_id and control.source_document_id != document_id:
            # Clear statement source when relocating, matching mappings.link_document_to_control
            control.source_statement_id = None
        control.source_document_id = document_id
        control.updated_at = datetime.utcnow()
        method = "internal_source_document"

    elif kind == "normalized":
        nc = db.query(NormalizedControl).filter(NormalizedControl.id == body.control_id).first()
        if not nc:
            raise HTTPException(status_code=404, detail="Normalized control not found")
        existing = db.query(DocumentControlLink).filter(
            DocumentControlLink.document_id == document_id,
            DocumentControlLink.normalized_control_id == body.control_id,
        ).first()
        if not existing:
            db.add(DocumentControlLink(
                document_id=document_id,
                normalized_control_id=body.control_id,
                link_type="implements",
                created_by=current_user.id,
            ))
            method = "document_control_link"
        else:
            method = "already_linked"
        # Also lock any existing statement mappings for this normalized control
        stmt_ids = _doc_statement_ids(db, document_id, user_tenants)
        if stmt_ids:
            updated = 0
            for m in db.query(StatementControlMapping).filter(
                StatementControlMapping.statement_id.in_(stmt_ids),
                StatementControlMapping.tenant_id.in_(user_tenants),
                StatementControlMapping.control_kind == "normalized",
                StatementControlMapping.normalized_control_id == body.control_id,
            ).all():
                m.is_locked = True
                updated += 1
            if updated and method == "already_linked":
                method = "statement_mapping_lock"

    else:  # parsed
        pc = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.id == body.control_id
        ).first()
        if not pc:
            raise HTTPException(status_code=404, detail="Parsed framework control not found")

        stmt_ids = _doc_statement_ids(db, document_id, user_tenants)
        if not stmt_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Document has no active policy statements to map. Parse the document first, or link a normalized/internal control instead.",
            )

        mappings = db.query(StatementControlMapping).filter(
            StatementControlMapping.statement_id.in_(stmt_ids),
            StatementControlMapping.tenant_id.in_(user_tenants),
            StatementControlMapping.control_kind == "parsed",
            StatementControlMapping.parsed_control_id == body.control_id,
        ).all()

        if mappings:
            for m in mappings:
                m.is_locked = True
            method = "statement_mapping_lock"
        else:
            # Create a locked mapping on the first active statement (prefer one
            # whose text overlaps the finding's policy section when available).
            target_stmt_id = stmt_ids[0]
            if body.finding_id:
                finding = db.query(PolicyGapFinding).filter(
                    PolicyGapFinding.id == body.finding_id,
                    PolicyGapFinding.document_id == document_id,
                    PolicyGapFinding.tenant_id.in_(user_tenants),
                ).first()
                if finding and finding.policy_section_text:
                    needle = _tokens(finding.policy_section_text)
                    if needle:
                        best_id, best_score = target_stmt_id, 0
                        for st in db.query(PolicyStatement).filter(PolicyStatement.id.in_(stmt_ids)).all():
                            score = len(needle & _tokens(st.statement_text))
                            if score > best_score:
                                best_id, best_score = st.id, score
                        target_stmt_id = best_id

            stmt = db.query(PolicyStatement).filter(PolicyStatement.id == target_stmt_id).first()
            fw_name = None
            if pc.uploaded_framework_id:
                uf = db.query(UploadedFramework).filter(
                    UploadedFramework.id == pc.uploaded_framework_id
                ).first()
                if uf:
                    fw_name = uf.name
            m = StatementControlMapping(
                tenant_id=document.tenant_id,
                statement_id=target_stmt_id,
                control_kind="parsed",
                parsed_control_id=pc.id,
                control_code=pc.original_reference or pc.control_id,
                control_title=(pc.title or "")[:500],
                framework_name=fw_name,
                domain=pc.domain,
                confidence=1.0,
                coverage_type="partial",
                rationale="Linked from gap analysis recommendation",
                link_source="manual",
                is_locked=True,
                created_by_ai=False,
            )
            db.add(m)
            method = "statement_mapping_create"

    db.commit()
    return {
        "document_id": document_id,
        "control_kind": kind,
        "control_id": body.control_id,
        "linked": True,
        "method": method,
        "finding_id": body.finding_id,
    }


@router.get("/export/{document_id}", dependencies=[Depends(require_doc_reader)])
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
