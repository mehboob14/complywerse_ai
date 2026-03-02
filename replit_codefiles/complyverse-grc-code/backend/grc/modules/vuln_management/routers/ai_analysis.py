import os
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload

from ....models import (
    VulnerabilityAIJob, VulnerabilityReport, Vulnerability, GRCUser, get_db
)
from ....schemas import VulnerabilityAIJobResponse, MessageResponse
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/ai", tags=["Vulnerability AI Analysis"])


def get_openai_client():
    from openai import OpenAI
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI features unavailable. OpenAI API key not configured."
        )
    is_modelfarm = "modelfarm" in (base_url or "")
    if not is_modelfarm and (api_key.startswith("_DUMMY") or api_key == "your-api-key-here" or len(api_key) < 20):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI features unavailable. OpenAI API key not configured."
        )
    return OpenAI(api_key=api_key, base_url=base_url)


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


@router.post("/analyze-report/{report_id}", response_model=VulnerabilityAIJobResponse)
def analyze_report(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    report = db.query(VulnerabilityReport).filter(
        VulnerabilityReport.id == report_id,
        VulnerabilityReport.tenant_id.in_(user_tenants)
    ).first()
    
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    job = VulnerabilityAIJob(
        report_id=report_id,
        tenant_id=report.tenant_id,
        job_type="analyze_report",
        status="processing",
        started_at=datetime.utcnow(),
        created_by=current_user.id,
        input_data={"report_name": report.name, "vulnerability_count": report.total_vulnerabilities}
    )
    db.add(job)
    db.commit()
    
    try:
        vulnerabilities = db.query(Vulnerability).filter(
            Vulnerability.report_id == report_id
        ).limit(20).all()
        
        vuln_summary = "\n".join([
            f"- {v.title} (Severity: {v.severity}, CVE: {v.cve_id or 'N/A'})"
            for v in vulnerabilities
        ])
        
        prompt = f"""Analyze this vulnerability report summary and provide:
1. Overall risk assessment
2. Priority recommendations for remediation
3. Common vulnerability patterns identified
4. Suggested mitigation strategies

Report: {report.name}
Scan Tool: {report.scan_tool or 'Unknown'}
Total Vulnerabilities: {report.total_vulnerabilities}
Critical: {report.critical_count}, High: {report.high_count}, Medium: {report.medium_count}, Low: {report.low_count}

Sample Vulnerabilities:
{vuln_summary}

Provide a concise, actionable analysis."""

        client = get_openai_client()
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a cybersecurity expert analyzing vulnerability scan results."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=1000
        )
        
        analysis = response.choices[0].message.content
        
        job.status = "completed"
        job.completed_at = datetime.utcnow()
        job.output_data = {"analysis": analysis}
        
        report.status = "analyzed"
        db.commit()
        
    except Exception as e:
        job.status = "failed"
        job.error_message = str(e)
        job.completed_at = datetime.utcnow()
        db.commit()
    
    db.refresh(job)
    
    return VulnerabilityAIJobResponse(
        id=job.id,
        report_id=job.report_id,
        vulnerability_id=job.vulnerability_id,
        tenant_id=job.tenant_id,
        job_type=job.job_type,
        status=job.status,
        input_data=job.input_data,
        output_data=job.output_data,
        error_message=job.error_message,
        started_at=job.started_at,
        completed_at=job.completed_at,
        created_at=job.created_at,
        created_by=job.created_by
    )


@router.post("/suggest-fix/{vuln_id}", response_model=VulnerabilityAIJobResponse)
def suggest_fix(
    vuln_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    vuln = db.query(Vulnerability).filter(
        Vulnerability.id == vuln_id,
        Vulnerability.tenant_id.in_(user_tenants)
    ).first()
    
    if not vuln:
        raise HTTPException(status_code=404, detail="Vulnerability not found")
    
    job = VulnerabilityAIJob(
        vulnerability_id=vuln_id,
        tenant_id=vuln.tenant_id,
        job_type="suggest_fix",
        status="processing",
        started_at=datetime.utcnow(),
        created_by=current_user.id,
        input_data={"vulnerability_title": vuln.title, "severity": vuln.severity}
    )
    db.add(job)
    db.commit()
    
    try:
        prompt = f"""Provide detailed remediation guidance for this vulnerability:

Title: {vuln.title}
Severity: {vuln.severity}
CVSS Score: {vuln.cvss_score or 'N/A'}
CVE: {vuln.cve_id or 'N/A'}
CWE: {vuln.cwe_id or 'N/A'}
Description: {vuln.description or 'Not provided'}
Affected Component: {vuln.affected_component or 'Not specified'}
Affected Host: {vuln.affected_host or 'Not specified'}
Current Recommendation: {vuln.recommendation or 'None provided'}

Please provide:
1. Step-by-step remediation instructions
2. Code examples or configuration changes if applicable
3. Testing steps to verify the fix
4. Potential impact of the remediation
5. Temporary mitigation if immediate fix isn't possible

Be specific and actionable."""

        client = get_openai_client()
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a cybersecurity remediation expert providing detailed fix recommendations."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=1500
        )
        
        recommendation = response.choices[0].message.content
        
        job.status = "completed"
        job.completed_at = datetime.utcnow()
        job.output_data = {"recommendation": recommendation}
        
        vuln.ai_recommendation = recommendation
        db.commit()
        
    except Exception as e:
        job.status = "failed"
        job.error_message = str(e)
        job.completed_at = datetime.utcnow()
        db.commit()
    
    db.refresh(job)
    
    return VulnerabilityAIJobResponse(
        id=job.id,
        report_id=job.report_id,
        vulnerability_id=job.vulnerability_id,
        tenant_id=job.tenant_id,
        job_type=job.job_type,
        status=job.status,
        input_data=job.input_data,
        output_data=job.output_data,
        error_message=job.error_message,
        started_at=job.started_at,
        completed_at=job.completed_at,
        created_at=job.created_at,
        created_by=job.created_by
    )


@router.get("/jobs", response_model=List[VulnerabilityAIJobResponse])
def list_ai_jobs(
    tenant_id: Optional[int] = None,
    job_type: Optional[str] = None,
    status_filter: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(VulnerabilityAIJob).filter(
        VulnerabilityAIJob.tenant_id.in_(user_tenants)
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(VulnerabilityAIJob.tenant_id == tenant_id)
    if job_type:
        query = query.filter(VulnerabilityAIJob.job_type == job_type)
    if status_filter:
        query = query.filter(VulnerabilityAIJob.status == status_filter)
    
    jobs = query.order_by(VulnerabilityAIJob.created_at.desc()).offset(skip).limit(limit).all()
    
    return [
        VulnerabilityAIJobResponse(
            id=j.id,
            report_id=j.report_id,
            vulnerability_id=j.vulnerability_id,
            tenant_id=j.tenant_id,
            job_type=j.job_type,
            status=j.status,
            input_data=j.input_data,
            output_data=j.output_data,
            error_message=j.error_message,
            started_at=j.started_at,
            completed_at=j.completed_at,
            created_at=j.created_at,
            created_by=j.created_by
        )
        for j in jobs
    ]


@router.get("/jobs/{job_id}", response_model=VulnerabilityAIJobResponse)
def get_ai_job(
    job_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    job = db.query(VulnerabilityAIJob).filter(
        VulnerabilityAIJob.id == job_id,
        VulnerabilityAIJob.tenant_id.in_(user_tenants)
    ).first()
    
    if not job:
        raise HTTPException(status_code=404, detail="AI job not found")
    
    return VulnerabilityAIJobResponse(
        id=job.id,
        report_id=job.report_id,
        vulnerability_id=job.vulnerability_id,
        tenant_id=job.tenant_id,
        job_type=job.job_type,
        status=job.status,
        input_data=job.input_data,
        output_data=job.output_data,
        error_message=job.error_message,
        started_at=job.started_at,
        completed_at=job.completed_at,
        created_at=job.created_at,
        created_by=job.created_by
    )
