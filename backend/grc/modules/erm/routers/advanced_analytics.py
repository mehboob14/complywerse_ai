from ....config import get_openai_api_key, get_openai_model

from typing import List, Optional
import os
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, case, and_
from pydantic import BaseModel

from ....models import (
    Risk, RiskKRI, RiskKRIMeasurement, RiskControlLink, RiskIncident,
    NormalizedControl, BusinessUnit, GRCUser, get_db, RiskMitigationAction
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/analytics", tags=["ERM - Advanced Analytics"])


LIKELIHOOD_LABELS = ["Rare", "Unlikely", "Possible", "Likely", "Almost Certain"]
IMPACT_LABELS = ["Insignificant", "Minor", "Moderate", "Major", "Catastrophic"]


class HeatmapCell(BaseModel):
    likelihood: int
    impact: int
    score: float
    count: int
    risks: list


class HeatmapResponse(BaseModel):
    cells: List[HeatmapCell]
    total_risks: int
    max_count: int
    likelihood_labels: List[str]
    impact_labels: List[str]


@router.get("/heatmap", response_model=HeatmapResponse)
def get_interactive_heatmap(
    risk_type: Optional[str] = None,
    category: Optional[str] = None,
    treatment: Optional[str] = None,
    business_unit_id: Optional[int] = None,
    score_type: str = Query("residual", pattern="^(inherent|residual)$"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return HeatmapResponse(cells=[], total_risks=0, max_count=0,
                               likelihood_labels=LIKELIHOOD_LABELS, impact_labels=IMPACT_LABELS)

    query = db.query(Risk).filter(
        Risk.tenant_id.in_(user_tenants),
        Risk.closure_status.is_(None)
    )

    if category:
        query = query.filter(Risk.risk_category == category)
    if treatment:
        query = query.filter(Risk.treatment_plan == treatment)
    if business_unit_id:
        query = query.filter(Risk.business_unit_id == business_unit_id)

    risks = query.all()

    grid = {}
    for r in risks:
        if score_type == "inherent":
            lk = r.inherent_likelihood
            imp = r.inherent_impact
        else:
            lk = r.residual_likelihood
            imp = r.residual_impact

        if not lk or not imp:
            continue

        key = (lk, imp)
        if key not in grid:
            grid[key] = []
        grid[key].append({
            "id": r.id,
            "title": r.title,
            "category": r.risk_category,
            "status": r.status,
            "owner": (r.owner.display_name or r.owner.username) if r.owner else None,
            "business_unit": r.business_unit.name if r.business_unit else None,
            "inherent_score": r.inherent_score,
            "residual_score": r.residual_score,
        })

    cells = []
    max_count = 0
    for lk in range(1, 6):
        for imp in range(1, 6):
            key = (lk, imp)
            risk_list = grid.get(key, [])
            count = len(risk_list)
            if count > max_count:
                max_count = count
            cells.append(HeatmapCell(
                likelihood=lk, impact=imp, score=lk * imp,
                count=count, risks=risk_list
            ))

    return HeatmapResponse(
        cells=cells, total_risks=len(risks), max_count=max_count,
        likelihood_labels=LIKELIHOOD_LABELS, impact_labels=IMPACT_LABELS
    )


class BowTieControl(BaseModel):
    id: int
    name: str
    code: Optional[str] = None
    effectiveness: Optional[str] = None


class BowTieThreat(BaseModel):
    id: int
    title: str
    category: Optional[str] = None
    likelihood: Optional[int] = None


class BowTieConsequence(BaseModel):
    id: int
    title: str
    severity: Optional[str] = None
    impact: Optional[int] = None
    financial_impact: Optional[float] = None


class BowTieResponse(BaseModel):
    risk_id: int
    risk_title: str
    risk_description: Optional[str] = None
    risk_category: Optional[str] = None
    inherent_score: Optional[float] = None
    residual_score: Optional[float] = None
    threats: List[BowTieThreat]
    preventive_controls: List[BowTieControl]
    mitigating_controls: List[BowTieControl]
    consequences: List[BowTieConsequence]


@router.get("/bowtie/{risk_id}", response_model=BowTieResponse)
def get_bowtie_analysis(
    risk_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    risk = db.query(Risk).options(
        joinedload(Risk.control_links).joinedload(RiskControlLink.normalized_control),
        joinedload(Risk.incidents),
        joinedload(Risk.mitigation_actions),
    ).filter(Risk.id == risk_id, Risk.tenant_id.in_(user_tenants)).first()

    if not risk:
        raise HTTPException(status_code=404, detail="Risk not found")

    threats = []
    incidents = risk.incidents or []
    if incidents:
        for inc in incidents:
            threats.append(BowTieThreat(
                id=inc.id,
                title=inc.title,
                category=inc.severity if hasattr(inc, 'severity') else None,
                likelihood=risk.inherent_likelihood
            ))
    else:
        threats.append(BowTieThreat(
            id=0,
            title=f"Potential {risk.risk_category or 'operational'} threat",
            category=risk.risk_category,
            likelihood=risk.inherent_likelihood
        ))

    preventive_controls = []
    mitigating_controls = []
    for link in (risk.control_links or []):
        ctrl = link.normalized_control
        if ctrl:
            control_data = BowTieControl(
                id=ctrl.id,
                name=ctrl.title or ctrl.description or f"Control {ctrl.id}",
                code=ctrl.control_code if hasattr(ctrl, 'control_code') else None,
                effectiveness="effective"
            )
            if len(preventive_controls) <= len(mitigating_controls):
                preventive_controls.append(control_data)
            else:
                mitigating_controls.append(control_data)

    for action in (risk.mitigation_actions or []):
        mitigating_controls.append(BowTieControl(
            id=action.id,
            name=action.title or f"Mitigation Action {action.id}",
            code=None,
            effectiveness=action.status if hasattr(action, 'status') else None
        ))

    consequences = []
    impact_labels_map = {1: "Insignificant", 2: "Minor", 3: "Moderate", 4: "Major", 5: "Catastrophic"}
    if risk.inherent_impact:
        consequences.append(BowTieConsequence(
            id=1,
            title=f"{impact_labels_map.get(risk.inherent_impact, 'Unknown')} operational disruption",
            severity=impact_labels_map.get(risk.inherent_impact, "Unknown"),
            impact=risk.inherent_impact,
        ))
    if risk.risk_category == "financial" or (risk.inherent_impact and risk.inherent_impact >= 3):
        consequences.append(BowTieConsequence(
            id=2,
            title="Financial loss or regulatory penalty",
            severity="Major" if (risk.inherent_impact or 0) >= 4 else "Moderate",
            impact=risk.inherent_impact,
        ))
    if risk.risk_category == "compliance" or (risk.inherent_impact and risk.inherent_impact >= 4):
        consequences.append(BowTieConsequence(
            id=3,
            title="Regulatory non-compliance or reputational damage",
            severity="Major",
            impact=risk.inherent_impact,
        ))
    if not consequences:
        consequences.append(BowTieConsequence(
            id=1,
            title="Business impact",
            severity="Moderate",
            impact=3,
        ))

    return BowTieResponse(
        risk_id=risk.id,
        risk_title=risk.title,
        risk_description=risk.description,
        risk_category=risk.risk_category,
        inherent_score=risk.inherent_score,
        residual_score=risk.residual_score,
        threats=threats,
        preventive_controls=preventive_controls,
        mitigating_controls=mitigating_controls,
        consequences=consequences,
    )


class ScenarioInput(BaseModel):
    risk_id: int
    adjusted_likelihood: int
    adjusted_impact: int
    scenario_name: Optional[str] = "Custom Scenario"
    notes: Optional[str] = None


class ScenarioResult(BaseModel):
    risk_id: int
    risk_title: str
    risk_category: Optional[str] = None
    original_likelihood: Optional[int] = None
    original_impact: Optional[int] = None
    original_score: Optional[float] = None
    adjusted_likelihood: int
    adjusted_impact: int
    adjusted_score: float
    score_change: float
    score_change_pct: Optional[float] = None
    severity_original: str
    severity_adjusted: str
    scenario_name: str


class ScenarioAnalysisRequest(BaseModel):
    scenarios: List[ScenarioInput]


class ScenarioAnalysisResponse(BaseModel):
    results: List[ScenarioResult]
    summary: dict


def get_severity(score: float) -> str:
    if score <= 4:
        return "Low"
    elif score <= 9:
        return "Medium"
    elif score <= 16:
        return "High"
    else:
        return "Critical"


@router.post("/scenario-analysis")
def run_scenario_analysis(
    request: ScenarioAnalysisRequest,
    score_type: str = Query("residual", pattern="^(inherent|residual)$"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="No tenant access")

    risk_ids = [s.risk_id for s in request.scenarios]
    risks = db.query(Risk).filter(
        Risk.id.in_(risk_ids),
        Risk.tenant_id.in_(user_tenants)
    ).all()
    risk_map = {r.id: r for r in risks}

    results = []
    total_original = 0
    total_adjusted = 0

    for scenario in request.scenarios:
        risk = risk_map.get(scenario.risk_id)
        if not risk:
            continue

        if score_type == "inherent":
            orig_lk = risk.inherent_likelihood or 0
            orig_imp = risk.inherent_impact or 0
            orig_score = risk.inherent_score or 0
        else:
            orig_lk = risk.residual_likelihood or 0
            orig_imp = risk.residual_impact or 0
            orig_score = risk.residual_score or 0

        adj_score = scenario.adjusted_likelihood * scenario.adjusted_impact
        change = adj_score - orig_score
        change_pct = (change / orig_score * 100) if orig_score > 0 else None

        total_original += orig_score
        total_adjusted += adj_score

        results.append(ScenarioResult(
            risk_id=risk.id,
            risk_title=risk.title,
            risk_category=risk.risk_category,
            original_likelihood=orig_lk,
            original_impact=orig_imp,
            original_score=orig_score,
            adjusted_likelihood=scenario.adjusted_likelihood,
            adjusted_impact=scenario.adjusted_impact,
            adjusted_score=adj_score,
            score_change=change,
            score_change_pct=round(change_pct, 1) if change_pct is not None else None,
            severity_original=get_severity(orig_score),
            severity_adjusted=get_severity(adj_score),
            scenario_name=scenario.scenario_name or "Custom Scenario",
        ))

    increased = sum(1 for r in results if r.score_change > 0)
    decreased = sum(1 for r in results if r.score_change < 0)
    unchanged = sum(1 for r in results if r.score_change == 0)

    return {
        "results": results,
        "summary": {
            "total_risks_analyzed": len(results),
            "total_original_score": total_original,
            "total_adjusted_score": total_adjusted,
            "total_change": total_adjusted - total_original,
            "risks_increased": increased,
            "risks_decreased": decreased,
            "risks_unchanged": unchanged,
        }
    }


@router.get("/scenario-presets")
def get_scenario_presets(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    return [
        {
            "id": "best_case",
            "name": "Best Case",
            "description": "All risks reduced by one level in both likelihood and impact",
            "likelihood_adjustment": -1,
            "impact_adjustment": -1
        },
        {
            "id": "worst_case",
            "name": "Worst Case",
            "description": "All risks increased by one level in both likelihood and impact",
            "likelihood_adjustment": 1,
            "impact_adjustment": 1
        },
        {
            "id": "economic_downturn",
            "name": "Economic Downturn",
            "description": "Financial and operational risks increase, others unchanged",
            "categories_affected": ["financial", "operational"],
            "likelihood_adjustment": 1,
            "impact_adjustment": 1
        },
        {
            "id": "cyber_attack",
            "name": "Cyber Attack",
            "description": "Technology and compliance risks increase significantly",
            "categories_affected": ["technology", "compliance"],
            "likelihood_adjustment": 2,
            "impact_adjustment": 1
        },
        {
            "id": "regulatory_change",
            "name": "Regulatory Change",
            "description": "Compliance risks increase, others slightly affected",
            "categories_affected": ["compliance"],
            "likelihood_adjustment": 1,
            "impact_adjustment": 2
        },
    ]


class AggregationResponse(BaseModel):
    enterprise_summary: dict
    by_category: list
    by_business_unit: list
    by_status: list
    risk_trend: list


@router.get("/aggregation")
def get_risk_aggregation(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"enterprise_summary": {}, "by_category": [], "by_business_unit": [], "by_status": [], "risk_trend": []}

    risks = db.query(Risk).options(
        joinedload(Risk.business_unit),
        joinedload(Risk.owner),
    ).filter(
        Risk.tenant_id.in_(user_tenants),
        Risk.closure_status.is_(None)
    ).all()

    total_inherent = sum(r.inherent_score or 0 for r in risks)
    total_residual = sum(r.residual_score or 0 for r in risks)
    avg_inherent = total_inherent / len(risks) if risks else 0
    avg_residual = total_residual / len(risks) if risks else 0
    risk_reduction = ((total_inherent - total_residual) / total_inherent * 100) if total_inherent > 0 else 0

    critical_risks = [r for r in risks if (r.residual_score or 0) > 16]
    high_risks = [r for r in risks if 9 < (r.residual_score or 0) <= 16]
    medium_risks = [r for r in risks if 4 < (r.residual_score or 0) <= 9]
    low_risks = [r for r in risks if (r.residual_score or 0) <= 4]

    enterprise_summary = {
        "total_risks": len(risks),
        "total_inherent_score": round(total_inherent, 1),
        "total_residual_score": round(total_residual, 1),
        "avg_inherent_score": round(avg_inherent, 1),
        "avg_residual_score": round(avg_residual, 1),
        "risk_reduction_pct": round(risk_reduction, 1),
        "critical_count": len(critical_risks),
        "high_count": len(high_risks),
        "medium_count": len(medium_risks),
        "low_count": len(low_risks),
    }

    cat_map = {}
    for r in risks:
        cat = r.risk_category or "uncategorized"
        if cat not in cat_map:
            cat_map[cat] = {"category": cat, "count": 0, "total_inherent": 0, "total_residual": 0, "critical": 0, "high": 0, "medium": 0, "low": 0}
        cat_map[cat]["count"] += 1
        cat_map[cat]["total_inherent"] += r.inherent_score or 0
        cat_map[cat]["total_residual"] += r.residual_score or 0
        score = r.residual_score or 0
        if score > 16:
            cat_map[cat]["critical"] += 1
        elif score > 9:
            cat_map[cat]["high"] += 1
        elif score > 4:
            cat_map[cat]["medium"] += 1
        else:
            cat_map[cat]["low"] += 1

    for cat in cat_map.values():
        cat["avg_inherent"] = round(cat["total_inherent"] / cat["count"], 1) if cat["count"] > 0 else 0
        cat["avg_residual"] = round(cat["total_residual"] / cat["count"], 1) if cat["count"] > 0 else 0
        cat["reduction_pct"] = round((cat["total_inherent"] - cat["total_residual"]) / cat["total_inherent"] * 100, 1) if cat["total_inherent"] > 0 else 0

    bu_map = {}
    for r in risks:
        bu_name = r.business_unit.name if r.business_unit else "Unassigned"
        bu_id = r.business_unit_id or 0
        key = (bu_id, bu_name)
        if key not in bu_map:
            bu_map[key] = {"business_unit_id": bu_id, "business_unit": bu_name, "count": 0, "total_inherent": 0, "total_residual": 0, "critical": 0, "high": 0, "medium": 0, "low": 0}
        bu_map[key]["count"] += 1
        bu_map[key]["total_inherent"] += r.inherent_score or 0
        bu_map[key]["total_residual"] += r.residual_score or 0
        score = r.residual_score or 0
        if score > 16:
            bu_map[key]["critical"] += 1
        elif score > 9:
            bu_map[key]["high"] += 1
        elif score > 4:
            bu_map[key]["medium"] += 1
        else:
            bu_map[key]["low"] += 1

    for bu in bu_map.values():
        bu["avg_inherent"] = round(bu["total_inherent"] / bu["count"], 1) if bu["count"] > 0 else 0
        bu["avg_residual"] = round(bu["total_residual"] / bu["count"], 1) if bu["count"] > 0 else 0

    status_map = {}
    for r in risks:
        st = r.status or "open"
        if st not in status_map:
            status_map[st] = {"status": st, "count": 0, "avg_score": 0, "total_score": 0}
        status_map[st]["count"] += 1
        status_map[st]["total_score"] += r.residual_score or 0

    for st in status_map.values():
        st["avg_score"] = round(st["total_score"] / st["count"], 1) if st["count"] > 0 else 0

    return {
        "enterprise_summary": enterprise_summary,
        "by_category": sorted(cat_map.values(), key=lambda x: x["total_residual"], reverse=True),
        "by_business_unit": sorted(bu_map.values(), key=lambda x: x["total_residual"], reverse=True),
        "by_status": list(status_map.values()),
        "risk_trend": [],
    }


class KRIAlertResponse(BaseModel):
    id: int
    kri_id: int
    kri_name: str
    risk_id: int
    risk_title: str
    current_value: Optional[float] = None
    threshold_breached: str
    green_threshold: Optional[float] = None
    amber_threshold: Optional[float] = None
    status: str
    severity: str
    triggered_at: str
    owner: Optional[str] = None
    recommended_action: str


@router.get("/kri-triggers")
def get_kri_triggers(
    severity: Optional[str] = None,
    acknowledged: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"alerts": [], "summary": {}}

    kris = db.query(RiskKRI).join(Risk).options(
        joinedload(RiskKRI.risk),
        joinedload(RiskKRI.owner),
        joinedload(RiskKRI.measurements),
    ).filter(
        Risk.tenant_id.in_(user_tenants),
        RiskKRI.is_active == True
    ).all()

    alerts = []
    for kri in kris:
        if kri.current_value is None:
            continue
        if kri.green_threshold is None or kri.amber_threshold is None:
            continue

        breach_status = None
        if kri.threshold_direction == "lower_is_better":
            if kri.current_value > kri.amber_threshold:
                breach_status = "red"
            elif kri.current_value > kri.green_threshold:
                breach_status = "amber"
        else:
            if kri.current_value < kri.amber_threshold:
                breach_status = "red"
            elif kri.current_value < kri.green_threshold:
                breach_status = "amber"

        if breach_status is None:
            continue

        sev = "critical" if breach_status == "red" else "warning"
        if severity and sev != severity:
            continue

        if kri.threshold_direction == "lower_is_better":
            threshold_val = kri.amber_threshold if breach_status == "red" else kri.green_threshold
            excess = kri.current_value - threshold_val
            action = f"Reduce {kri.name} by at least {round(excess, 1)} {kri.unit or 'units'} to return within threshold"
        else:
            threshold_val = kri.amber_threshold if breach_status == "red" else kri.green_threshold
            deficit = threshold_val - kri.current_value
            action = f"Increase {kri.name} by at least {round(deficit, 1)} {kri.unit or 'units'} to return within threshold"

        alerts.append(KRIAlertResponse(
            id=len(alerts) + 1,
            kri_id=kri.id,
            kri_name=kri.name,
            risk_id=kri.risk_id,
            risk_title=kri.risk.title if kri.risk else "Unknown",
            current_value=kri.current_value,
            threshold_breached=breach_status,
            green_threshold=kri.green_threshold,
            amber_threshold=kri.amber_threshold,
            status=breach_status,
            severity=sev,
            triggered_at=kri.last_measured_at.isoformat() if kri.last_measured_at else datetime.utcnow().isoformat(),
            owner=(kri.owner.display_name or kri.owner.username) if kri.owner else None,
            recommended_action=action,
        ))

    summary = {
        "total_alerts": len(alerts),
        "critical_alerts": sum(1 for a in alerts if a.severity == "critical"),
        "warning_alerts": sum(1 for a in alerts if a.severity == "warning"),
        "total_kris_monitored": len(kris),
        "kris_in_breach": len(alerts),
        "kris_healthy": len(kris) - len(alerts),
    }

    return {
        "alerts": sorted(alerts, key=lambda x: (0 if x.severity == "critical" else 1, x.kri_name)),
        "summary": summary,
    }


def _get_openai_client():
    from openai import OpenAI
    api_key = get_openai_api_key()
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    if not api_key:
        if not base_url:
            raise HTTPException(
                status_code=503,
                detail="AI features unavailable. OpenAI API key not configured."
            )
    if base_url and not api_key:
        api_key = "not-needed"
        raise HTTPException(
            status_code=503,
            detail="AI features unavailable. OpenAI API key not configured."
        )
    return OpenAI(api_key=api_key, base_url=base_url)


class ScenarioAIExplainRequest(BaseModel):
    results: List[dict]
    summary: dict
    scenario_type: Optional[str] = "Custom Scenario"


@router.post("/scenario-analysis/ai-explain")
def ai_explain_scenario(
    request: ScenarioAIExplainRequest,
    current_user: GRCUser = Depends(require_auth)
):
    try:
        client = _get_openai_client()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=503, detail="AI service unavailable")

    results_summary = []
    for r in request.results[:20]:
        results_summary.append({
            "risk": r.get("risk_title", "Unknown"),
            "category": r.get("risk_category", ""),
            "original_score": r.get("original_score", 0),
            "adjusted_score": r.get("adjusted_score", 0),
            "change": r.get("score_change", 0),
            "change_pct": r.get("score_change_pct"),
            "severity_before": r.get("severity_original", ""),
            "severity_after": r.get("severity_adjusted", ""),
        })

    prompt = f"""You are a senior enterprise risk management consultant. Analyze the following scenario analysis results and provide a clear, plain-English business impact summary suitable for non-risk professionals and executive leadership.

Scenario Type: {request.scenario_type}

Summary Statistics:
- Total risks analyzed: {request.summary.get('total_risks_analyzed', 0)}
- Total original risk score: {request.summary.get('total_original_score', 0)}
- Total adjusted risk score: {request.summary.get('total_adjusted_score', 0)}
- Net change: {request.summary.get('total_change', 0)}
- Risks with increased scores: {request.summary.get('risks_increased', 0)}
- Risks with decreased scores: {request.summary.get('risks_decreased', 0)}
- Risks unchanged: {request.summary.get('risks_unchanged', 0)}

Individual Risk Results:
{json.dumps(results_summary, indent=2)}

Please provide a comprehensive explanation covering:
1. **Scenario Overview**: What this scenario means in practical business terms
2. **Most Affected Risks**: Which risks are most impacted and why (focus on the biggest changes)
3. **Aggregate Impact**: What the overall score changes mean for the organization's risk posture
4. **Severity Shifts**: Highlight any risks that changed severity levels (e.g., Medium → High)
5. **Recommended Actions**: 3-5 specific, actionable recommendations based on the results

Write in a professional but accessible tone. Avoid jargon. Use concrete language that a board member or business executive would understand."""

    try:
        response = client.chat.completions.create(
            model=os.environ.get("AI_MODEL", "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": "You are an enterprise risk management expert providing clear business impact analysis."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=1500,
        )
        explanation = response.choices[0].message.content
        return {"explanation": explanation}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")


class BowTieAINarrativeRequest(BaseModel):
    threats: Optional[List[dict]] = None
    preventive_controls: Optional[List[dict]] = None
    risk_event: Optional[dict] = None
    mitigating_controls: Optional[List[dict]] = None
    consequences: Optional[List[dict]] = None


@router.post("/bowtie/{risk_id}/ai-narrative")
def generate_bowtie_ai_narrative(
    risk_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    risk = db.query(Risk).options(
        joinedload(Risk.control_links).joinedload(RiskControlLink.normalized_control),
        joinedload(Risk.incidents),
        joinedload(Risk.mitigation_actions),
    ).filter(Risk.id == risk_id, Risk.tenant_id.in_(user_tenants)).first()

    if not risk:
        raise HTTPException(status_code=404, detail="Risk not found")

    impact_labels_map = {1: "Insignificant", 2: "Minor", 3: "Moderate", 4: "Major", 5: "Catastrophic"}
    likelihood_labels_map = {1: "Rare", 2: "Unlikely", 3: "Possible", 4: "Likely", 5: "Almost Certain"}

    threats_info = []
    incidents = risk.incidents or []
    if incidents:
        for inc in incidents:
            threats_info.append({"title": inc.title, "severity": getattr(inc, 'severity', None)})
    else:
        threats_info.append({"title": f"Potential {risk.risk_category or 'operational'} threat", "category": risk.risk_category})

    preventive_controls_info = []
    mitigating_controls_info = []
    for link in (risk.control_links or []):
        ctrl = link.normalized_control
        if ctrl:
            ctrl_data = {"name": ctrl.title or ctrl.description or f"Control {ctrl.id}", "code": getattr(ctrl, 'control_code', None)}
            if len(preventive_controls_info) <= len(mitigating_controls_info):
                preventive_controls_info.append(ctrl_data)
            else:
                mitigating_controls_info.append(ctrl_data)

    for action in (risk.mitigation_actions or []):
        mitigating_controls_info.append({"name": action.title or f"Mitigation Action {action.id}", "status": getattr(action, 'status', None)})

    consequences_info = []
    if risk.inherent_impact:
        consequences_info.append(f"{impact_labels_map.get(risk.inherent_impact, 'Unknown')} operational disruption")
    if risk.risk_category == "financial" or (risk.inherent_impact and risk.inherent_impact >= 3):
        consequences_info.append("Financial loss or regulatory penalty")
    if risk.risk_category == "compliance" or (risk.inherent_impact and risk.inherent_impact >= 4):
        consequences_info.append("Regulatory non-compliance or reputational damage")
    if not consequences_info:
        consequences_info.append("Business impact")

    prompt = f"""You are a senior risk management analyst. Analyze the following bow-tie risk data and generate a comprehensive plain-English narrative explaining the full causal chain.

Risk Event:
- Title: {risk.title}
- Description: {risk.description or 'No description provided'}
- Category: {risk.risk_category or 'Unspecified'}
- Inherent Score: {risk.inherent_score or 'N/A'} (Likelihood: {likelihood_labels_map.get(risk.inherent_likelihood, 'N/A')}, Impact: {impact_labels_map.get(risk.inherent_impact, 'N/A')})
- Residual Score: {risk.residual_score or 'N/A'} (Likelihood: {likelihood_labels_map.get(risk.residual_likelihood, 'N/A')}, Impact: {impact_labels_map.get(risk.residual_impact, 'N/A')})

Threats/Causes ({len(threats_info)}):
{json.dumps(threats_info, indent=2)}

Preventive Controls ({len(preventive_controls_info)}):
{json.dumps(preventive_controls_info, indent=2)}

Mitigating Controls ({len(mitigating_controls_info)}):
{json.dumps(mitigating_controls_info, indent=2)}

Potential Consequences:
{json.dumps(consequences_info, indent=2)}

Generate a narrative with the following sections:
1. **Threat Landscape**: What threats exist and how they could trigger the risk event
2. **Preventive Controls Assessment**: What preventive controls are in place (or missing) and their effectiveness
3. **Risk Event Analysis**: The risk event itself and its significance
4. **Mitigating Controls Assessment**: What mitigating controls exist (or are missing) to reduce impact
5. **Consequence Analysis**: What consequences could materialize if controls fail
6. **Recommendations**: Specific actionable recommendations to strengthen the control environment

Write in clear, professional language suitable for risk committee presentation. Be specific and actionable."""

    try:
        from openai import OpenAI
        client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        response = client.chat.completions.create(
            model=get_openai_model(),
            messages=[
                {"role": "system", "content": "You are an expert enterprise risk management analyst specializing in bow-tie risk analysis. Provide clear, actionable narratives."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=2000
        )
        narrative = response.choices[0].message.content
    except Exception as e:
        narrative = f"""## Bow-Tie Analysis Narrative for: {risk.title}

### Threat Landscape
This risk faces {len(threats_info)} identified threat(s): {', '.join(t.get('title', 'Unknown') for t in threats_info)}. {'These threats stem from historical incidents that have materialized in the past.' if incidents else 'These are potential threats based on the risk category and profile.'}

### Preventive Controls Assessment
{'There are ' + str(len(preventive_controls_info)) + ' preventive control(s) in place: ' + ', '.join(c.get('name', 'Unknown') for c in preventive_controls_info) + '. These controls aim to reduce the likelihood of the risk event occurring.' if preventive_controls_info else 'No preventive controls have been identified. This is a significant gap that should be addressed urgently.'}

### Risk Event Analysis
The risk "{risk.title}" is categorized as {risk.risk_category or 'unspecified'} with an inherent score of {risk.inherent_score or 'N/A'} ({likelihood_labels_map.get(risk.inherent_likelihood, 'N/A')} likelihood, {impact_labels_map.get(risk.inherent_impact, 'N/A')} impact). After applying controls, the residual score is {risk.residual_score or 'N/A'}, representing a {round(((risk.inherent_score or 0) - (risk.residual_score or 0)) / (risk.inherent_score or 1) * 100)}% reduction.

### Mitigating Controls Assessment
{'There are ' + str(len(mitigating_controls_info)) + ' mitigating control(s) in place: ' + ', '.join(c.get('name', 'Unknown') for c in mitigating_controls_info) + '. These controls help reduce the impact should the risk event materialize.' if mitigating_controls_info else 'No mitigating controls have been identified. The organization is exposed to full impact should this risk materialize.'}

### Consequence Analysis
If controls fail, the following consequences could materialize: {'; '.join(consequences_info)}. The severity level is assessed as {impact_labels_map.get(risk.inherent_impact, 'Unknown')}.

### Recommendations
1. {'Strengthen existing preventive controls and consider additional controls to reduce likelihood.' if preventive_controls_info else 'Urgently implement preventive controls to reduce the likelihood of this risk materializing.'}
2. {'Review and test mitigating controls to ensure they remain effective.' if mitigating_controls_info else 'Implement mitigating controls to reduce the potential impact of this risk.'}
3. Conduct regular reviews of the bow-tie analysis to ensure it remains current and comprehensive.
4. Consider developing key risk indicators (KRIs) to provide early warning of this risk materializing."""

    return {
        "risk_id": risk.id,
        "risk_title": risk.title,
        "narrative": narrative,
        "generated_at": datetime.utcnow().isoformat()
    }
