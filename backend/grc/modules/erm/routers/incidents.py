from ....config import get_openai_api_key, get_openai_model

import os
import json
from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload
from pydantic import BaseModel

from ....models import (
    Risk, RiskIncident, GRCUser, get_db, NormalizedControl, FrameworkControl,
    ControlObjective, FrameworkDomain, Framework, UploadedFramework
)
from ....schemas import (
    RiskIncidentCreate, RiskIncidentUpdate, RiskIncidentResponse, RiskIncidentValidation, RiskIncidentLossFields,
    MessageResponse
)
from ....routers.auth_router import (
    require_auth, get_user_tenants, get_user_primary_tenant, refuse_imported_accounts, require_tenant_permission,
)
from ....services.ai_gateway.field_policies import ai_view
from ....services.segregation import ensure_independent
from ..loss_taxonomy import BUSINESS_LINES, EVENT_TYPES, taxonomy, taxonomy_key
from ..schema_migrations import ensure_incident_schema
from .incident_links import apply_inline_links, serialize_links

router = APIRouter(prefix="/incidents", tags=["ERM - Incidents"])

# Writes need the incident right; the risk right keeps today's risk editors working.
_may_create = require_tenant_permission("erm:incidents:create", "erm:risks:create")
_may_edit = require_tenant_permission("erm:incidents:edit", "erm:risks:edit")
_may_delete = require_tenant_permission("erm:incidents:delete", "erm:risks:delete")

# Statuses that end an incident: reaching either stamps resolved_at.
_DONE_STATUSES = ("resolved", "closed")


class IncidentAIAnalyzeRequest(BaseModel):
    title: str
    description: str
    severity: Optional[str] = None
    incident_date: Optional[str] = None
    department: Optional[str] = None


class IncidentAISuggestRequest(BaseModel):
    title: str
    description: Optional[str] = None
    severity: Optional[str] = None
    risk_id: Optional[int] = None


def get_openai_client():
    from openai import OpenAI
    api_key = get_openai_api_key()
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


def get_user_tenant_id(user: GRCUser, db: Session) -> int:
    tenant_id = get_user_primary_tenant(user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not assigned to any tenant"
        )
    return tenant_id


def _loss_keys(data: dict) -> dict:
    """event_type / business_line as taxonomy keys (a label is taken too); 400 for anything else."""
    try:
        for field, table, what in (("event_type", EVENT_TYPES, "event type"), ("business_line", BUSINESS_LINES, "business line")):
            if field in data:
                data[field] = taxonomy_key(data[field], table, what)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return data


def _quarter_start(d: datetime) -> datetime:
    return datetime(d.year, 3 * ((d.month - 1) // 3) + 1, 1)


def _net_by_currency(events, *keys) -> list:
    """Net loss summed per currency (and per any other key named): amounts in different currencies are never added."""
    sums: dict = {}
    for e in events:
        if e.net_loss is not None:
            group = tuple(getattr(e, k) for k in keys) + (e.currency,)
            sums[group] = sums.get(group, 0.0) + float(e.net_loss)
    rows = [{**dict(zip(keys, g[:-1])), "currency": g[-1], "net_loss": round(v, 2)} for g, v in sums.items()]
    return sorted(rows, key=lambda r: tuple(str(r[k] or "") for k in (*keys, "currency")))


def _normalize_tags(raw) -> Optional[list]:
    if raw is None:
        return None
    if isinstance(raw, str):
        parts = [p.strip() for p in raw.replace(";", ",").split(",") if p.strip()]
        return parts or None
    if isinstance(raw, (list, tuple)):
        parts = [str(p).strip() for p in raw if str(p).strip()]
        return parts or None
    return None


def _enrich_incident_response(incident: RiskIncident, db: Session) -> RiskIncidentResponse:
    data = RiskIncidentResponse.model_validate(incident)
    if incident.risk:
        data.risk_title = incident.risk.title
    tags = getattr(incident, "tags", None)
    if isinstance(tags, list):
        data.tags = tags
    elif isinstance(tags, str) and tags.strip():
        data.tags = [t.strip() for t in tags.split(",") if t.strip()]
    else:
        data.tags = []
    assignee = getattr(incident, "assignee", None)
    if assignee:
        data.assignee_name = (
            getattr(assignee, "display_name", None)
            or getattr(assignee, "username", None)
            or getattr(assignee, "email", None)
        )
    try:
        links = serialize_links(db, incident.id)
        data.link_counts = {k: len(v) for k, v in links.items()}
    except Exception:
        data.link_counts = {"assets": 0, "vulnerabilities": 0, "risks": 0, "evidence": 0}
    return data


def _fallback_incident_suggestion(title: str, description: Optional[str] = None, severity: Optional[str] = None) -> dict:
    text = f"{title} {description or ''}".lower()
    suggested_severity = severity or "medium"
    if any(k in text for k in ["outage", "breach", "fraud", "ransomware", "critical"]):
        suggested_severity = "high"
    elif any(k in text for k in ["minor", "delay", "small"]):
        suggested_severity = "low"

    return {
        "suggested_severity": suggested_severity,
        "root_cause": "Initial root cause assessment pending detailed investigation",
        "corrective_actions": "Contain impact, investigate underlying cause, implement remediation, and monitor recurrence",
        "operational_impact": "Moderate operational disruption",
        "event_type": next((key for words, key in _EVENT_TYPE_HINTS if any(w in text for w in words)), None),
        "business_line": None,
        "rationale": "Heuristic suggestion generated from incident title and description"
    }


# Keyword guesses at the Basel event type when the AI is unavailable; first match wins.
_EVENT_TYPE_HINTS = (
    (("insider", "employee fraud", "staff fraud", "rogue"), "internal_fraud"),
    (("fraud", "skimming", "phishing", "forgery", "theft"), "external_fraud"),
    (("outage", "downtime", "system failure", "crash"), "business_disruption"),
    (("fire", "flood", "earthquake", "vandalism"), "physical_assets"),
    (("error", "mistake", "failed trade", "reconciliation"), "execution_delivery"),
)


def _risk_context(risk) -> str:
    r = ai_view(risk, "erm.incident_suggest")           # what the field policy lets this prompt carry
    return f"{r['title']} | category={r['category']} | status={r['status']}"


def _ai_suggest_incident_payload(title: str, description: Optional[str], severity: Optional[str], risk_context: Optional[str] = None) -> dict:
    client = get_openai_client()
    prompt = f"""You are a GRC incident response specialist.
Suggest manual incident form values and return ONLY valid JSON with keys:
suggested_severity, root_cause, corrective_actions, operational_impact, event_type, business_line, rationale

Incident Title: {title}
Incident Description: {description or 'Not provided'}
Current Severity: {severity or 'Not provided'}
Risk Context: {risk_context or 'Not provided'}

Constraints:
- suggested_severity must be one of: low, medium, high, critical
- event_type is the Basel level-1 event type, one of: {', '.join(EVENT_TYPES)}
- business_line is the Basel business line, one of: {', '.join(BUSINESS_LINES)}, or null when unclear
- Keep root_cause and corrective_actions concise and practical
"""

    try:
        response = client.chat.completions.create(
            model=get_openai_model(),
            messages=[
                {"role": "system", "content": "You are a precise assistant. Return JSON only."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=700,
            temperature=0.2
        )
        content = (response.choices[0].message.content or "").strip()
        if content.startswith("```json"):
            content = content[7:]
        if content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]
        parsed = json.loads(content.strip())
        fallback = _fallback_incident_suggestion(title, description, severity)
        fallback.update({k: v for k, v in parsed.items() if v is not None
                         and not (k == "event_type" and v not in EVENT_TYPES)
                         and not (k == "business_line" and v not in BUSINESS_LINES)})      # taxonomy keys only
        return fallback
    except Exception:
        return _fallback_incident_suggestion(title, description, severity)


@router.get("", response_model=List[RiskIncidentResponse])
def list_incidents(
    risk_id: Optional[int] = None,
    severity: Optional[str] = None,
    status_filter: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    event_type: Optional[str] = None,
    validation_status: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    ensure_incident_schema(db)
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(RiskIncident).options(
        joinedload(RiskIncident.risk),
        joinedload(RiskIncident.assignee),
    ).filter(RiskIncident.tenant_id.in_(user_tenants))
    
    if risk_id:
        query = query.filter(RiskIncident.risk_id == risk_id)
    if severity:
        query = query.filter(RiskIncident.severity == severity)
    if status_filter:
        query = query.filter(RiskIncident.status == status_filter)
    if start_date:
        query = query.filter(RiskIncident.incident_date >= start_date)
    if end_date:
        query = query.filter(RiskIncident.incident_date <= end_date)
    if event_type:
        query = query.filter(RiskIncident.event_type == event_type)
    if validation_status == "pending":       # never validated (rows from before loss events) is pending too
        query = query.filter(or_(RiskIncident.validation_status == "pending", RiskIncident.validation_status.is_(None)))
    elif validation_status:
        query = query.filter(RiskIncident.validation_status == validation_status)

    incidents = query.order_by(RiskIncident.incident_date.desc()).offset(skip).limit(limit).all()
    return [_enrich_incident_response(incident, db) for incident in incidents]


@router.post("", response_model=RiskIncidentResponse, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(_may_create)])
def create_incident(
    incident: RiskIncidentCreate,
    ai_assist: bool = False,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    ensure_incident_schema(db)
    tenant_id = get_user_tenant_id(current_user, db)
    
    if incident.risk_id:
        risk = db.query(Risk).filter(
            Risk.id == incident.risk_id,
            Risk.tenant_id == tenant_id
        ).first()
        if not risk:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Risk not found"
            )

    suggestion = None
    if ai_assist:
        linked_risk = None
        if incident.risk_id:
            linked_risk = db.query(Risk).filter(
                Risk.id == incident.risk_id,
                Risk.tenant_id == tenant_id
            ).first()
        risk_context = _risk_context(linked_risk) if linked_risk else None
        i = ai_view(incident, "erm.incident_suggest", model="RiskIncident")      # the create payload has the record's fields
        suggestion = _ai_suggest_incident_payload(
            title=i["title"],
            description=i["description"],
            severity=i["severity"],
            risk_context=risk_context
        )

    severity = incident.severity or (suggestion.get("suggested_severity") if suggestion else "medium")
    operational_impact = incident.operational_impact or (suggestion.get("operational_impact") if suggestion else None)
    root_cause = incident.root_cause or (suggestion.get("root_cause") if suggestion else None)
    corrective_actions = incident.corrective_actions or (suggestion.get("corrective_actions") if suggestion else None)
    
    refuse_imported_accounts(db, [incident.assigned_to])
    loss = _loss_keys(incident.model_dump(include=set(RiskIncidentLossFields.model_fields), exclude_none=True))
    loss["discovered_date"] = incident.discovered_date or datetime.utcnow()
    db_incident = RiskIncident(
        tenant_id=tenant_id,
        risk_id=incident.risk_id,
        title=incident.title,
        description=incident.description,
        incident_date=incident.incident_date,
        severity=severity,
        financial_impact=incident.financial_impact,
        operational_impact=operational_impact,
        root_cause=root_cause,
        corrective_actions=corrective_actions,
        reported_by=current_user.id,
        assigned_to=incident.assigned_to,
        tags=_normalize_tags(incident.tags),
        **loss,
    )
    db.add(db_incident)
    db.flush()

    # Inline cross-module links from the create payload.
    link_body = incident.model_dump(exclude_unset=True)
    apply_inline_links(
        db, incident=db_incident, tenant_id=tenant_id,
        body=link_body, user_id=current_user.id, replace=False,
    )
    # Mirror primary risk_id into the multi-risk link table when set.
    if incident.risk_id:
        apply_inline_links(
            db, incident=db_incident, tenant_id=tenant_id,
            body={"linked_risk_ids": [incident.risk_id]},
            user_id=current_user.id, replace=False,
        )

    db.commit()
    db.refresh(db_incident)
    db_incident = db.query(RiskIncident).options(
        joinedload(RiskIncident.risk),
        joinedload(RiskIncident.assignee),
    ).filter(RiskIncident.id == db_incident.id).first()
    return _enrich_incident_response(db_incident, db)


@router.post("/ai-suggest", dependencies=[Depends(require_tenant_permission(
    "erm:incidents:create", "erm:risks:create", "erm:incidents:edit", "erm:risks:edit"))])  # AI budget: writers only
def suggest_incident_with_ai(
    request: IncidentAISuggestRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    risk_context = None

    if request.risk_id:
        risk = db.query(Risk).filter(
            Risk.id == request.risk_id,
            Risk.tenant_id.in_(user_tenants)
        ).first()
        if not risk:
            raise HTTPException(status_code=404, detail="Risk not found")
        risk_context = _risk_context(risk)

    return {
        "title": request.title,
        "suggestion": _ai_suggest_incident_payload(
            title=request.title,
            description=request.description,
            severity=request.severity,
            risk_context=risk_context
        )
    }


@router.get("/taxonomy")
def get_loss_taxonomy(current_user: GRCUser = Depends(require_auth)):
    """Basel level-1 event types and business lines, as keys and labels."""
    return taxonomy()


@router.get("/dashboard")
def get_incident_dashboard(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {
            "total_incidents": 0,
            "by_severity": {},
            "by_status": {},
            "total_financial_impact": 0,
            "open_incidents": 0,
            "investigating": 0,
            "resolved_this_month": 0,
            "avg_resolution_time_days": 0,
            "recent_incidents": [],
            "net_loss_this_quarter": [],
            "net_loss_last_quarter": [],
            "net_loss_by_event_type": [],
            "near_misses": 0,
            "awaiting_validation": 0,
        }
    
    incidents = db.query(RiskIncident).filter(
        RiskIncident.tenant_id.in_(user_tenants)
    ).all()
    
    by_severity = {}
    by_status = {}
    total_impact = 0
    resolution_times = []
    month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    resolved_this_month = 0
    
    for inc in incidents:
        if inc.status in _DONE_STATUSES and inc.resolved_at and inc.resolved_at >= month_start:
            resolved_this_month += 1
        by_severity[inc.severity] = by_severity.get(inc.severity, 0) + 1
        by_status[inc.status] = by_status.get(inc.status, 0) + 1
        if inc.financial_impact:
            total_impact += inc.financial_impact
        if inc.resolved_at and inc.discovered_date:
            days = (inc.resolved_at - inc.discovered_date).days
            resolution_times.append(days)
    
    recent = db.query(RiskIncident).filter(
        RiskIncident.tenant_id.in_(user_tenants)
    ).order_by(RiskIncident.incident_date.desc()).limit(5).all()

    # A loss counts in the quarter it was booked (accounting date), else the quarter it occurred.
    this_quarter = _quarter_start(datetime.utcnow())
    last_quarter = _quarter_start(this_quarter - timedelta(days=1))
    booked = lambda e: e.accounting_date or e.incident_date  # noqa: E731

    return {
        "total_incidents": len(incidents),
        "by_severity": by_severity,
        "by_status": by_status,
        "total_financial_impact": total_impact,
        # Anything not resolved or closed is still open (mitigating included).
        "open_incidents": sum(n for st, n in by_status.items() if st not in _DONE_STATUSES),
        "investigating": by_status.get("investigating", 0),
        "resolved_this_month": resolved_this_month,
        "avg_resolution_time_days": round(sum(resolution_times) / len(resolution_times), 1) if resolution_times else 0,
        "recent_incidents": [
            {"id": i.id, "title": i.title, "severity": i.severity, "status": i.status}
            for i in recent
        ],
        "net_loss_this_quarter": _net_by_currency(e for e in incidents if booked(e) >= this_quarter),
        "net_loss_last_quarter": _net_by_currency(e for e in incidents if last_quarter <= booked(e) < this_quarter),
        "net_loss_by_event_type": _net_by_currency(incidents, "event_type"),
        "near_misses": sum(1 for e in incidents if e.is_near_miss),
        "awaiting_validation": sum(1 for e in incidents if (e.validation_status or "pending") == "pending"),
    }


@router.post("/ai-analyze")
def analyze_incident_with_ai(
    request: IncidentAIAnalyzeRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    risks = db.query(Risk).filter(Risk.tenant_id.in_(user_tenants)).all()
    risk_views = [ai_view(r, "erm.incident_analyze") for r in risks[:30]]      # what the field policy lets this prompt carry
    risk_summary = "\n".join([
        f"- Risk ID {r['id']}: {r['title']} (Category: {r['category']}, Status: {r['status']})"
        for r in risk_views
    ])
    
    # Only frameworks this tenant has published (or that are shared), not the whole library.
    tenant_framework_ids = db.query(UploadedFramework.published_framework_id).filter(
        UploadedFramework.upload_status == "published",
        UploadedFramework.published_framework_id.isnot(None),
        UploadedFramework.is_active == True,  # noqa: E712
        or_(UploadedFramework.tenant_id.in_(user_tenants), UploadedFramework.is_shared == True),  # noqa: E712
    )
    controls = db.query(FrameworkControl).join(
        ControlObjective, FrameworkControl.objective_id == ControlObjective.id
    ).join(
        FrameworkDomain, ControlObjective.domain_id == FrameworkDomain.id
    ).join(
        Framework, FrameworkDomain.framework_id == Framework.id
    ).filter(Framework.id.in_(tenant_framework_ids)).limit(50).all()
    
    control_summary = "\n".join([
        f"- Control ID {c.id}: {c.name} (Code: {c.code})"
        for c in controls
    ])
    
    similar_incidents = db.query(RiskIncident).filter(
        RiskIncident.tenant_id.in_(user_tenants)
    ).order_by(RiskIncident.incident_date.desc()).limit(20).all()
    
    incident_history = "\n".join([
        f"- Incident ID {i['id']}: {i['title']} (Severity: {i['severity']}, Date: {i['incident_date'] or 'N/A'})"
        for i in (ai_view(i, "erm.incident_analyze") for i in similar_incidents)
    ])
    
    prompt = f"""You are a GRC (Governance, Risk, Compliance) expert analyzing a security incident. Analyze the following incident and provide a comprehensive AI-powered assessment.

INCIDENT DETAILS:
Title: {request.title}
Description: {request.description}
Severity: {request.severity or 'Not specified'}
Incident Date: {request.incident_date or 'Not specified'}
Department: {request.department or 'Not specified'}

AVAILABLE ORGANIZATIONAL RISKS:
{risk_summary if risk_summary else 'No risks in system'}

AVAILABLE FRAMEWORK CONTROLS:
{control_summary if control_summary else 'No controls in system'}

PREVIOUS INCIDENTS:
{incident_history if incident_history else 'No previous incidents'}

Provide a comprehensive analysis in the following JSON format:
{{
    "root_cause_analysis": {{
        "primary_cause": "Brief description of the primary root cause",
        "contributing_factors": ["Factor 1", "Factor 2", "Factor 3"],
        "category": "technical|human|process|external",
        "preventability": "high|medium|low"
    }},
    "related_risks": [
        {{
            "risk_id": <integer ID from the risks above>,
            "risk_title": "Title from the risk above",
            "relevance": "high|medium|low",
            "explanation": "Why this risk is related"
        }}
    ],
    "related_controls": [
        {{
            "control_id": <integer ID from controls above>,
            "control_title": "Title from control above",
            "framework": "Framework name",
            "relevance": "high|medium|low",
            "status_recommendation": "Review or improvement recommendation"
        }}
    ],
    "recommended_actions": [
        "Action 1",
        "Action 2",
        "Action 3"
    ],
    "similar_incidents": [
        {{
            "incident_id": <integer ID>,
            "title": "Title from incidents above",
            "similarity": 0.0 to 1.0
        }}
    ],
    "impact_assessment": {{
        "financial_impact": "critical|high|medium|low",
        "reputational_impact": "critical|high|medium|low",
        "regulatory_impact": "critical|high|medium|low",
        "operational_impact": "critical|high|medium|low"
    }}
}}

Ensure the risk_id, control_id, and incident_id values match actual IDs from the data provided above. If there are no relevant matches, return empty arrays for those sections.
Return ONLY valid JSON, no additional text."""

    try:
        client = get_openai_client()
        response = client.chat.completions.create(
            model=get_openai_model(),
            messages=[
                {"role": "system", "content": "You are a GRC expert specializing in incident analysis, root cause determination, and control recommendations. Always respond with valid JSON."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=2000,
            temperature=0.3
        )
        
        ai_response = response.choices[0].message.content.strip()
        if ai_response.startswith("```json"):
            ai_response = ai_response[7:]
        if ai_response.startswith("```"):
            ai_response = ai_response[3:]
        if ai_response.endswith("```"):
            ai_response = ai_response[:-3]
        
        analysis = json.loads(ai_response.strip())
        
        return analysis
        
    except json.JSONDecodeError as e:
        return {
            "root_cause_analysis": {
                "primary_cause": "Unable to parse AI response",
                "contributing_factors": [],
                "category": "process",
                "preventability": "medium"
            },
            "related_risks": [],
            "related_controls": [],
            "recommended_actions": ["Review incident details and retry analysis"],
            "similar_incidents": [],
            "impact_assessment": {
                "financial_impact": "medium",
                "reputational_impact": "medium",
                "regulatory_impact": "medium",
                "operational_impact": "medium"
            },
            "error": f"Failed to parse AI response: {str(e)}"
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI analysis failed: {str(e)}"
        )


@router.get("/{incident_id}", response_model=RiskIncidentResponse)
def get_incident(
    incident_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    ensure_incident_schema(db)
    user_tenants = get_user_tenants(current_user, db)
    
    incident = db.query(RiskIncident).options(
        joinedload(RiskIncident.risk),
        joinedload(RiskIncident.assignee),
    ).filter(
        RiskIncident.id == incident_id,
        RiskIncident.tenant_id.in_(user_tenants)
    ).first()
    
    if not incident:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Incident not found"
        )
    
    return _enrich_incident_response(incident, db)


@router.put("/{incident_id}", response_model=RiskIncidentResponse, dependencies=[Depends(_may_edit)])
def update_incident(
    incident_id: int,
    incident_update: RiskIncidentUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    ensure_incident_schema(db)
    user_tenants = get_user_tenants(current_user, db)
    
    incident = db.query(RiskIncident).filter(
        RiskIncident.id == incident_id,
        RiskIncident.tenant_id.in_(user_tenants)
    ).first()
    
    if not incident:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Incident not found"
        )
    
    update_data = incident_update.model_dump(exclude_unset=True)
    refuse_imported_accounts(db, [update_data.get("assigned_to")], kept=[incident.assigned_to])
    link_keys = {
        "linked_asset_ids", "linked_vulnerability_ids",
        "linked_risk_ids", "linked_evidence_ids",
    }
    link_payload = {k: update_data.pop(k) for k in list(update_data.keys()) if k in link_keys}

    if "tags" in update_data:
        update_data["tags"] = _normalize_tags(update_data["tags"])
    _loss_keys(update_data)
    for required in ("incident_date", "discovered_date"):       # a date can be changed, not cleared
        if required in update_data and update_data[required] is None:
            update_data.pop(required)

    if update_data.get("status") in _DONE_STATUSES and not incident.resolved_at:
        update_data["resolved_at"] = datetime.utcnow()
    
    for key, value in update_data.items():
        setattr(incident, key, value)

    if link_payload:
        apply_inline_links(
            db, incident=incident, tenant_id=incident.tenant_id,
            body=link_payload, user_id=current_user.id, replace=True,
        )
    
    db.commit()
    incident = db.query(RiskIncident).options(
        joinedload(RiskIncident.risk),
        joinedload(RiskIncident.assignee),
    ).filter(RiskIncident.id == incident_id).first()
    return _enrich_incident_response(incident, db)


def _missing_for_validation(incident: RiskIncident) -> List[str]:
    """What a loss event needs before a second person can validate it: a near miss has no amount to check."""
    needed = [("event type", incident.event_type)]
    if not incident.is_near_miss:
        gross = incident.financial_impact if incident.gross_loss is None else incident.gross_loss   # a row from before loss events
        needed += [("gross loss", gross), ("currency", incident.currency)]
    return [name for name, value in needed if value is None or value == ""]


def _decide_validation(incident_id: int, outcome: str, note: Optional[str], db: Session, user: GRCUser) -> RiskIncidentResponse:
    """The template's gate "Validate classification and amounts": someone other than the reporter validates or returns."""
    incident = db.query(RiskIncident).filter(
        RiskIncident.id == incident_id, RiskIncident.tenant_id.in_(get_user_tenants(user, db))
    ).first()
    if not incident:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")
    ensure_independent(incident.reported_by, user, f"{'validate' if outcome == 'validated' else 'return'} this loss event")
    note = (note or "").strip() or None
    if outcome == "validated":
        missing = _missing_for_validation(incident)
        if missing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail=f"Add the {', '.join(missing)} before validating this loss event.")
    elif not note:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Say what needs fixing before returning it.")
    incident.validation_status, incident.validation_note = outcome, note
    incident.validated_by, incident.validated_at = user.id, datetime.utcnow()
    db.commit()
    incident = db.query(RiskIncident).options(
        joinedload(RiskIncident.risk), joinedload(RiskIncident.assignee),
    ).filter(RiskIncident.id == incident_id).first()
    return _enrich_incident_response(incident, db)


@router.post("/{incident_id}/validate", response_model=RiskIncidentResponse, dependencies=[Depends(_may_edit)])
def validate_loss_event(incident_id: int, body: RiskIncidentValidation, db: Session = Depends(get_db),
                        current_user: GRCUser = Depends(require_auth)):
    return _decide_validation(incident_id, "validated", body.note, db, current_user)


@router.post("/{incident_id}/return", response_model=RiskIncidentResponse, dependencies=[Depends(_may_edit)])
def return_loss_event(incident_id: int, body: RiskIncidentValidation, db: Session = Depends(get_db),
                      current_user: GRCUser = Depends(require_auth)):
    return _decide_validation(incident_id, "returned", body.note, db, current_user)


@router.delete("/{incident_id}", response_model=MessageResponse, dependencies=[Depends(_may_delete)])
def delete_incident(
    incident_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    incident = db.query(RiskIncident).filter(
        RiskIncident.id == incident_id,
        RiskIncident.tenant_id.in_(user_tenants)
    ).first()
    
    if not incident:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Incident not found"
        )

    _clear_incident_references(db, incident_id)
    db.delete(incident)
    db.commit()
    return {"message": "Incident deleted successfully", "id": incident_id}


def _clear_incident_references(db: Session, incident_id: int) -> None:
    """Remove what stops an incident from being deleted.

    Link rows (risk, asset, vulnerability, evidence, risk-assessment links) go
    with it; records that merely point at it (a risk's source incident, a BCM
    drill, an audit-register finding) stay and are unlinked. Found from the
    models, so a table added later that references incidents is covered too.
    """
    from sqlalchemy import inspect as sa_inspect
    from ....models import Base

    existing = set(sa_inspect(db.get_bind()).get_table_names())
    for table in Base.metadata.tables.values():
        if table.name not in existing:
            continue
        for column in table.columns:
            if any(fk.target_fullname == "grc_risk_incidents.id" for fk in column.foreign_keys):
                statement = (table.update().values({column.name: None}) if column.nullable
                             else table.delete())
                db.execute(statement.where(column == incident_id))
