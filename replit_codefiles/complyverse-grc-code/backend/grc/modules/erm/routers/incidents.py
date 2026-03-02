import os
import json
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from pydantic import BaseModel

from ....models import (
    Risk, RiskIncident, GRCUser, get_db, NormalizedControl, FrameworkControl,
    ControlObjective, FrameworkDomain, Framework
)
from ....schemas import (
    RiskIncidentCreate, RiskIncidentUpdate, RiskIncidentResponse,
    MessageResponse
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/incidents", tags=["ERM - Incidents"])


class IncidentAIAnalyzeRequest(BaseModel):
    title: str
    description: str
    severity: Optional[str] = None
    incident_date: Optional[str] = None
    department: Optional[str] = None


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


def get_user_tenant_id(user: GRCUser, db: Session) -> int:
    tenant_id = get_user_primary_tenant(user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not assigned to any tenant"
        )
    return tenant_id


@router.get("", response_model=List[RiskIncidentResponse])
def list_incidents(
    risk_id: Optional[int] = None,
    severity: Optional[str] = None,
    status_filter: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(RiskIncident).filter(RiskIncident.tenant_id.in_(user_tenants))
    
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
    
    incidents = query.order_by(RiskIncident.incident_date.desc()).offset(skip).limit(limit).all()
    
    result = []
    for incident in incidents:
        incident_data = RiskIncidentResponse.model_validate(incident)
        if incident.risk:
            incident_data.risk_title = incident.risk.title
        result.append(incident_data)
    
    return result


@router.post("", response_model=RiskIncidentResponse, status_code=status.HTTP_201_CREATED)
def create_incident(
    incident: RiskIncidentCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
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
    
    db_incident = RiskIncident(
        tenant_id=tenant_id,
        risk_id=incident.risk_id,
        title=incident.title,
        description=incident.description,
        incident_date=incident.incident_date,
        severity=incident.severity,
        financial_impact=incident.financial_impact,
        operational_impact=incident.operational_impact,
        root_cause=incident.root_cause,
        corrective_actions=incident.corrective_actions,
        reported_by=current_user.id,
        assigned_to=incident.assigned_to
    )
    db.add(db_incident)
    db.commit()
    db.refresh(db_incident)
    return db_incident


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
            "avg_resolution_time_days": 0,
            "recent_incidents": []
        }
    
    incidents = db.query(RiskIncident).filter(
        RiskIncident.tenant_id.in_(user_tenants)
    ).all()
    
    by_severity = {}
    by_status = {}
    total_impact = 0
    resolution_times = []
    
    for inc in incidents:
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
    
    return {
        "total_incidents": len(incidents),
        "by_severity": by_severity,
        "by_status": by_status,
        "total_financial_impact": total_impact,
        "open_incidents": by_status.get("open", 0) + by_status.get("investigating", 0),
        "avg_resolution_time_days": round(sum(resolution_times) / len(resolution_times), 1) if resolution_times else 0,
        "recent_incidents": [
            {"id": i.id, "title": i.title, "severity": i.severity, "status": i.status}
            for i in recent
        ]
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
    risk_summary = "\n".join([
        f"- Risk ID {r.id}: {r.title} (Category: {r.category}, Status: {r.status})"
        for r in risks[:30]
    ])
    
    controls = db.query(FrameworkControl).join(
        ControlObjective, FrameworkControl.objective_id == ControlObjective.id
    ).join(
        FrameworkDomain, ControlObjective.domain_id == FrameworkDomain.id
    ).join(
        Framework, FrameworkDomain.framework_id == Framework.id
    ).limit(50).all()
    
    control_summary = "\n".join([
        f"- Control ID {c.id}: {c.name} (Code: {c.code})"
        for c in controls
    ])
    
    similar_incidents = db.query(RiskIncident).filter(
        RiskIncident.tenant_id.in_(user_tenants)
    ).order_by(RiskIncident.incident_date.desc()).limit(20).all()
    
    incident_history = "\n".join([
        f"- Incident ID {i.id}: {i.title} (Severity: {i.severity}, Date: {i.incident_date.strftime('%Y-%m-%d') if i.incident_date else 'N/A'})"
        for i in similar_incidents
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
            model="gpt-4o",
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
    user_tenants = get_user_tenants(current_user, db)
    
    incident = db.query(RiskIncident).options(
        joinedload(RiskIncident.risk)
    ).filter(
        RiskIncident.id == incident_id,
        RiskIncident.tenant_id.in_(user_tenants)
    ).first()
    
    if not incident:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Incident not found"
        )
    
    incident_data = RiskIncidentResponse.model_validate(incident)
    if incident.risk:
        incident_data.risk_title = incident.risk.title
    return incident_data


@router.put("/{incident_id}", response_model=RiskIncidentResponse)
def update_incident(
    incident_id: int,
    incident_update: RiskIncidentUpdate,
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
    
    update_data = incident_update.model_dump(exclude_unset=True)
    
    if update_data.get("status") == "resolved" and not incident.resolved_at:
        update_data["resolved_at"] = datetime.utcnow()
    
    for key, value in update_data.items():
        setattr(incident, key, value)
    
    db.commit()
    db.refresh(incident)
    return incident


@router.delete("/{incident_id}", response_model=MessageResponse)
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
    
    db.delete(incident)
    db.commit()
    return {"message": "Incident deleted successfully", "id": incident_id}
