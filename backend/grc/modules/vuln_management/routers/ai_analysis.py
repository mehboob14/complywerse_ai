from ....config import get_openai_api_key
import os
import json
import re
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload

from ....models import (
    VulnerabilityAIJob, VulnerabilityReport, Vulnerability,
    VulnerabilityAssetLink, ITAsset, GRCUser, get_db
)
from ....schemas import VulnerabilityAIJobResponse, MessageResponse
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/ai", tags=["Vulnerability AI Analysis"])


def get_openai_client():
    from openai import OpenAI
    api_key = get_openai_api_key()
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI features unavailable. OpenAI API key not configured."
        )
    if api_key.startswith("_DUMMY") or api_key == "your-api-key-here" or len(api_key) < 20:
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


def _format_enrichment_block(vuln: Vulnerability) -> str:
    """Render the threat-intel context the AI should reason over.

    Only includes fields that are actually populated so the prompt stays
    short for un-enriched vulns. The presence of KEV, EPSS percentile, and
    the composite priority materially changes the urgency the AI surfaces,
    so this block is the lever that turns "generic patch advice" into
    "actually risk-prioritised guidance".
    """
    lines: list[str] = []
    if vuln.kev_flag:
        kev_when = (
            vuln.kev_date_added.strftime("%Y-%m-%d")
            if vuln.kev_date_added else "date unknown"
        )
        lines.append(
            f"- CISA KEV: YES — actively exploited in the wild (added {kev_when}). "
            "Treat as drop-everything urgent."
        )
    if isinstance(vuln.epss_score, (int, float)):
        pct = (
            f" ({vuln.epss_percentile * 100:.1f}th percentile)"
            if isinstance(vuln.epss_percentile, (int, float)) else ""
        )
        lines.append(
            f"- EPSS exploit probability: {vuln.epss_score:.4f}{pct} "
            "(higher = more likely to be exploited in the next 30 days)."
        )
    if isinstance(vuln.composite_priority, (int, float)):
        lines.append(
            f"- Composite priority: {vuln.composite_priority:.2f} / 10 "
            "(blend of CVSS, EPSS, KEV, asset criticality)."
        )
    if vuln.nvd_published_at:
        lines.append(
            f"- NVD published: {vuln.nvd_published_at.strftime('%Y-%m-%d')}."
        )
    if vuln.exploit_references:
        refs = [
            r for r in (vuln.exploit_references or [])
            if isinstance(r, str)
        ][:6]
        if refs:
            lines.append(
                "- NVD references:\n  "
                + "\n  ".join(refs)
            )
    return "\n".join(lines) if lines else "- No threat-intel enrichment available."


def _format_patch_block(vuln: Vulnerability) -> str:
    """Render vendor patch intelligence (MSRC KB articles, advisories, fix text)."""
    lines: list[str] = []
    patches = vuln.patch_references or []
    if patches:
        rendered = []
        for ref in patches[:10]:
            if not isinstance(ref, dict):
                continue
            rid = ref.get("id") or "?"
            url = ref.get("url") or ""
            source = ref.get("source") or "vendor"
            rendered.append(f"{rid} ({source}) — {url}".strip())
        if rendered:
            lines.append("- Vendor KB articles / patches:\n  " + "\n  ".join(rendered))
    advisories = vuln.vendor_advisory_ids or []
    if advisories:
        lines.append("- Vendor advisories: " + ", ".join(advisories[:10]))
    if vuln.remediation_guidance:
        guidance = vuln.remediation_guidance.strip()
        if len(guidance) > 800:
            guidance = guidance[:800] + "…"
        lines.append("- Vendor remediation guidance (verbatim):\n  " + guidance)
    if vuln.psirt_source:
        lines.append(f"- PSIRT source: {vuln.psirt_source}.")
    return "\n".join(lines) if lines else "- No vendor patch intelligence synced yet."


def _format_asset_block(db: Session, vuln: Vulnerability) -> str:
    """Render linked-asset context so the AI can suggest compensating controls
    proportional to the blast radius (e.g. internet-facing prod DB vs. dev VM).
    """
    try:
        rows = (
            db.query(ITAsset.name, ITAsset.asset_type, ITAsset.criticality,
                     ITAsset.internet_facing, ITAsset.data_classification)
            .join(VulnerabilityAssetLink,
                  VulnerabilityAssetLink.asset_id == ITAsset.id)
            .filter(VulnerabilityAssetLink.vulnerability_id == vuln.id)
            .limit(5)
            .all()
        )
    except Exception:
        rows = []
    if not rows:
        return "- No linked assets recorded."
    lines = []
    for name, atype, crit, inet, dclass in rows:
        bits = [f"{name}"]
        if atype:
            bits.append(f"type={atype}")
        if crit:
            bits.append(f"criticality={crit}")
        if inet:
            bits.append("internet_facing=YES")
        if dclass:
            bits.append(f"data={dclass}")
        lines.append("- " + ", ".join(bits))
    return "\n".join(lines)


_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


def _parse_ai_payload(raw: str) -> dict:
    """Try hard to recover JSON from the AI response.

    OpenAI's `response_format={"type":"json_object"}` already enforces JSON,
    but proxy servers (ModelFarm etc.) sometimes wrap the result in markdown
    fences or prepend a stray sentence. We strip those and re-parse rather
    than fail the whole job over a backtick.
    """
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        pass
    match = _JSON_BLOCK_RE.search(raw)
    if match:
        try:
            return json.loads(match.group(0))
        except (TypeError, ValueError):
            return {}
    return {}


def _render_suggestions_as_markdown(summary: str, suggestions: list[dict]) -> str:
    """Synthesise a markdown view of the structured suggestions for backward-
    compatible display (the existing AI Recommendation banner reads
    `vuln.ai_recommendation` as freeform text)."""
    parts: list[str] = []
    if summary:
        parts.append(summary.strip())
    for i, s in enumerate(suggestions, start=1):
        if not isinstance(s, dict):
            continue
        title = (s.get("title") or "").strip()
        desc = (s.get("description") or "").strip()
        priority = (s.get("priority") or "").strip().lower()
        effort = (s.get("effort") or "").strip().lower()
        meta_bits = []
        if priority:
            meta_bits.append(f"priority: {priority}")
        if effort:
            meta_bits.append(f"effort: {effort}")
        meta = f" *(_{', '.join(meta_bits)}_)*" if meta_bits else ""
        parts.append(f"### {i}. {title}{meta}\n{desc}".rstrip())
    return "\n\n".join(parts).strip()


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

    enrichment_block = _format_enrichment_block(vuln)
    patch_block = _format_patch_block(vuln)
    asset_block = _format_asset_block(db, vuln)

    job = VulnerabilityAIJob(
        vulnerability_id=vuln_id,
        tenant_id=vuln.tenant_id,
        job_type="suggest_fix",
        status="processing",
        started_at=datetime.utcnow(),
        created_by=current_user.id,
        input_data={
            "vulnerability_title": vuln.title,
            "severity": vuln.severity,
            "kev_flag": bool(vuln.kev_flag),
            "epss_score": vuln.epss_score,
            "composite_priority": vuln.composite_priority,
            "has_patch_intel": bool(
                (vuln.patch_references or [])
                or (vuln.vendor_advisory_ids or [])
                or vuln.remediation_guidance
            ),
        },
    )
    db.add(job)
    db.commit()

    try:
        prompt = f"""You are a senior security engineer building a concrete
remediation plan for a single vulnerability. Use ALL the context below —
do NOT give generic advice. If CISA KEV is YES, lead with urgency. If
patch articles exist, name the specific KB/advisory IDs. If the asset is
internet-facing or highly critical, recommend compensating controls
until the patch lands.

VULNERABILITY
Title: {vuln.title}
Severity: {vuln.severity or 'unknown'}
Status: {vuln.status or 'open'}
CVSS Score: {vuln.cvss_score if vuln.cvss_score is not None else 'N/A'}
CVE: {vuln.cve_id or 'N/A'}
CWE: {vuln.cwe_id or 'N/A'}
Description: {(vuln.description or 'Not provided').strip()}
Affected Component: {vuln.affected_component or 'N/A'}
Affected Host: {vuln.affected_host or 'N/A'}

THREAT INTELLIGENCE
{enrichment_block}

VENDOR PATCH INTELLIGENCE
{patch_block}

LINKED ASSETS
{asset_block}

CURRENT MANUAL RECOMMENDATION (if any)
{(vuln.recommendation or 'None').strip()}

Respond with a single JSON object of EXACTLY this shape — no prose
before or after, no markdown fences:
{{
  "summary": "<2-3 sentence overall recommendation, mentioning KEV / EPSS / patch status explicitly when applicable>",
  "suggestions": [
    {{
      "title": "<short imperative action, ≤ 80 chars>",
      "description": "<2-5 sentences. Be specific: name KB IDs, paths, commands, configuration keys. Include verification step.>",
      "priority": "critical | high | medium | low",
      "effort": "low | medium | high",
      "category": "patch | config | compensating_control | monitoring | isolation | detection"
    }}
  ]
}}

Provide 3 to 5 suggestions, ordered from most to least urgent. The first
must be the single highest-leverage action; if a patch exists, it is
almost always that. Subsequent suggestions should cover compensating
controls, monitoring, and verification."""

        client = get_openai_client()
        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": (
                        "You are a cybersecurity remediation expert. You always "
                        "respond with valid JSON matching the requested schema."
                    )},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=1800,
                response_format={"type": "json_object"},
            )
        except TypeError:
            # ModelFarm / older proxies sometimes reject `response_format`.
            # Retry without it; the parser below tolerates fenced output.
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": (
                        "You are a cybersecurity remediation expert. You always "
                        "respond with valid JSON matching the requested schema."
                    )},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=1800,
            )

        raw = response.choices[0].message.content or ""
        parsed = _parse_ai_payload(raw)
        summary = (parsed.get("summary") or "").strip()
        raw_suggestions = parsed.get("suggestions") or []
        # Normalise — drop anything that isn't a dict with at least a title.
        suggestions: list[dict] = []
        for s in raw_suggestions:
            if not isinstance(s, dict):
                continue
            title = (s.get("title") or "").strip()
            if not title:
                continue
            suggestions.append({
                "title": title[:200],
                "description": (s.get("description") or "").strip(),
                "priority": (s.get("priority") or "medium").strip().lower(),
                "effort": (s.get("effort") or "").strip().lower() or None,
                "category": (s.get("category") or "").strip().lower() or None,
            })

        if suggestions:
            recommendation = _render_suggestions_as_markdown(summary, suggestions)
        else:
            # Fall back to whatever the model returned so the user still gets
            # something useful even if the JSON shape was off.
            recommendation = raw.strip()
            summary = summary or recommendation[:280]

        job.status = "completed"
        job.completed_at = datetime.utcnow()
        job.output_data = {
            "summary": summary,
            "suggestions": suggestions,
            "recommendation": recommendation,
        }

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
