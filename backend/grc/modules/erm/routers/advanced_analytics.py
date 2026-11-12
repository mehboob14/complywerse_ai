from ....config import get_openai_api_key, get_openai_model
from ....services.ai_gateway.field_policies import ai_view

from typing import List, Literal, Optional
import os
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, case, and_, or_
from pydantic import BaseModel, Field

from ....models import (
    Risk, RiskKRI, RiskKRIMeasurement, RiskIncident,
    BusinessUnit, GRCUser, get_db, Issue, risk_priority_for_score,
    IncidentRiskLink, IssueAction, RiskBowtieItem, RiskControl,
)
from ....routers.auth_router import require_auth, get_user_tenants, require_tenant_permission
from ...issue_management.services.risk_actions import (
    OPEN_ACTION_STATUSES, add_risk_action, migrate_legacy_actions, risk_actions_query,
)
from ..services.risk_control_links import risk_control_links


def _risk_actions(db: Session, risk: Risk):
    """The risk's actions: the CAPA actions on its treatment issue (old rows are copied there first)."""
    migrate_legacy_actions(db, [risk.tenant_id])
    return risk_actions_query(db, [risk.tenant_id]).filter(Issue.source_id == risk.id).all()

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
    category: Optional[str] = None,
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
        Risk.closure_status.is_(None),
        Risk.status.is_distinct_from("draft"),
    )

    if category:
        query = query.filter(Risk.risk_category == category)
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
    id: int                                   # the control's own id
    link_id: Optional[int] = None             # its link (grc_risk_controls)
    name: str
    code: Optional[str] = None
    kind: Optional[str] = None                # internal | library | framework
    control_type: Optional[str] = None        # preventive | detective | corrective, None when not set
    effectiveness: Optional[str] = None       # effective | partially_effective | ineffective | not assessed
    last_tested_at: Optional[str] = None
    next_test_due: Optional[str] = None


class BowTieItem(BaseModel):
    """A saved cause or consequence. gap: no preventive control (cause) or mitigating control (consequence) on it."""
    id: int
    side: str
    title: str
    impact_category: Optional[str] = None
    control_link_ids: List[int] = []
    source: Optional[str] = None
    gap: bool = False
    gap_action_id: Optional[int] = None
    gap_action_open: bool = False


class BowTieSuggestion(BaseModel):
    title: str
    source: str                               # loss_event | risk_cause | risk_consequence


class BowTieResponse(BaseModel):
    risk_id: int
    risk_title: str
    risk_description: Optional[str] = None
    risk_category: Optional[str] = None
    inherent_score: Optional[float] = None
    residual_score: Optional[float] = None
    threats: List[BowTieItem]                 # the causes
    controls: List[BowTieControl] = []
    preventive_controls: List[BowTieControl]
    mitigating_controls: List[BowTieControl]
    # Linked controls whose type is not set: no side of the bow-tie can be claimed for them.
    unclassified_controls: List[BowTieControl] = []
    consequences: List[BowTieItem]
    suggested_causes: List[BowTieSuggestion] = []
    suggested_consequences: List[BowTieSuggestion] = []
    impact_categories: List[str] = []


MITIGATING_CONTROL_TYPES = {"detective", "corrective"}
IMPACT_CATEGORIES = ("financial", "regulatory", "reputational", "customer", "operational")
GAP_SIDE = {"cause": "preventive", "consequence": "mitigating"}
CAN_EDIT_BOWTIE = [Depends(require_tenant_permission("risks:risk_assessment:edit", "erm:risks:edit"))]


def _side(control_type: Optional[str]) -> str:
    kind = (control_type or "").lower()
    return "preventive" if kind == "preventive" else "mitigating" if kind in MITIGATING_CONTROL_TYPES else "unclassified"


def _controls_by_side(db: Session, risk: Risk) -> dict:
    """The risk's linked controls of every kind (the one risk–control link) split by their own type: preventive before
    the event, detective/corrective after it, untyped apart."""
    sides = {"preventive": [], "mitigating": [], "unclassified": []}
    for c in risk_control_links(db, [risk.id])[risk.id]:
        sides[_side(c["control_type"])].append(c)
    return sides


def _bowtie_control(c: dict) -> BowTieControl:
    return BowTieControl(id=c["control_id"], link_id=c["link_id"], name=c["name"] or f"Control {c['control_id']}",
                         code=c["code"], kind=c["kind"], control_type=c["control_type"],
                         effectiveness=c["effectiveness"] or "not assessed",
                         last_tested_at=c["last_tested_at"], next_test_due=c["next_test_due"])


def _items_with_gaps(db: Session, items: list, sides: dict) -> List[BowTieItem]:
    """A cause needs a preventive control and a consequence a mitigating one. An item with no controls placed on it
    takes every control on its side; one with controls placed takes only those."""
    linked = {c["link_id"] for cs in sides.values() for c in cs}
    side_ids = {side: {c["link_id"] for c in sides[GAP_SIDE[side]]} for side in GAP_SIDE}
    action_ids = [i.gap_action_id for i in items if i.gap_action_id]
    open_actions = {a for (a,) in db.query(IssueAction.id).filter(
        IssueAction.id.in_(action_ids), IssueAction.status.in_(OPEN_ACTION_STATUSES))} if action_ids else set()
    out = []
    for i in items:
        placed = [x for x in (i.control_link_ids or []) if x in linked]
        wanted = side_ids.get(i.side, set())
        covered = bool(set(placed) & wanted) if placed else bool(wanted)
        out.append(BowTieItem(id=i.id, side=i.side, title=i.title, impact_category=i.impact_category,
                              control_link_ids=placed, source=i.source, gap=not covered, gap_action_id=i.gap_action_id,
                              gap_action_open=i.gap_action_id in open_actions))
    return out


def _bowtie_items(db: Session, risk: Risk) -> list:
    return db.query(RiskBowtieItem).filter(RiskBowtieItem.risk_id == risk.id).order_by(
        RiskBowtieItem.position, RiskBowtieItem.id).all()


def _suggestions(db: Session, risk: Risk, items: list) -> tuple:
    """Causes from the risk's cause text and its loss events' root causes; consequences from its consequence text.
    Only those not saved yet."""
    saved = {(i.side, i.title.strip().lower()) for i in items}
    event_ids = [i for (i,) in db.query(IncidentRiskLink.incident_id).filter(IncidentRiskLink.risk_id == risk.id)]
    events = db.query(RiskIncident).filter(RiskIncident.tenant_id == risk.tenant_id, or_(
        RiskIncident.risk_id == risk.id, RiskIncident.id.in_(event_ids))).order_by(RiskIncident.id).all()
    found = {"cause": [("risk_cause", risk.root_cause)] + [("loss_event", e.root_cause) for e in events],
             "consequence": [("risk_consequence", risk.consequences)]}
    out = {}
    for side, pairs in found.items():
        seen, out[side] = set(), []
        for source, text in pairs:
            title = (text or "").strip()[:500]
            if title and (side, title.lower()) not in saved and title.lower() not in seen:
                seen.add(title.lower())
                out[side].append(BowTieSuggestion(title=title, source=source))
    return out["cause"], out["consequence"]


def _bowtie_risk(db: Session, risk_id: int, current_user: GRCUser) -> Risk:
    risk = db.query(Risk).filter(Risk.id == risk_id, Risk.tenant_id.in_(get_user_tenants(current_user, db))).first()
    if not risk:
        raise HTTPException(status_code=404, detail="Risk not found")
    return risk


@router.get("/bowtie/{risk_id}", response_model=BowTieResponse)
def get_bowtie_analysis(
    risk_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    risk = _bowtie_risk(db, risk_id, current_user)
    sides = _controls_by_side(db, risk)
    items = _bowtie_items(db, risk)
    placed = _items_with_gaps(db, items, sides)
    suggested_causes, suggested_consequences = _suggestions(db, risk, items)
    controls = {side: [_bowtie_control(c) for c in cs] for side, cs in sides.items()}
    return BowTieResponse(
        risk_id=risk.id,
        risk_title=risk.title,
        risk_description=risk.description,
        risk_category=risk.risk_category,
        inherent_score=risk.inherent_score,
        residual_score=risk.residual_score,
        threats=[i for i in placed if i.side == "cause"],
        controls=[c for cs in controls.values() for c in cs],
        preventive_controls=controls["preventive"],
        mitigating_controls=controls["mitigating"],
        unclassified_controls=controls["unclassified"],
        consequences=[i for i in placed if i.side == "consequence"],
        suggested_causes=suggested_causes,
        suggested_consequences=suggested_consequences,
        impact_categories=list(IMPACT_CATEGORIES),
    )


ImpactCategory = Literal["financial", "regulatory", "reputational", "customer", "operational"]


class BowTieItemCreate(BaseModel):
    side: Literal["cause", "consequence"]
    title: str = Field(..., min_length=1, max_length=500)
    impact_category: Optional[ImpactCategory] = None
    control_link_ids: Optional[List[int]] = None
    source: Literal["loss_event", "risk_cause", "risk_consequence", "manual"] = "manual"


class BowTieItemUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=500)
    impact_category: Optional[ImpactCategory] = None
    control_link_ids: Optional[List[int]] = None
    position: Optional[int] = None


def _check_placed(db: Session, risk: Risk, ids: Optional[List[int]]) -> List[int]:
    if not ids:
        return []
    linked = {i for (i,) in db.query(RiskControl.id).filter(RiskControl.risk_id == risk.id)}
    if set(ids) - linked:
        raise HTTPException(status_code=422, detail="Only controls linked to this risk can be placed on its bow-tie.")
    return list(dict.fromkeys(ids))


def _bowtie_item(db: Session, risk: Risk, item_id: int) -> RiskBowtieItem:
    item = db.query(RiskBowtieItem).filter(RiskBowtieItem.id == item_id, RiskBowtieItem.risk_id == risk.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Cause or consequence not found")
    return item


def _item_out(db: Session, risk: Risk, item: RiskBowtieItem) -> BowTieItem:
    return _items_with_gaps(db, [item], _controls_by_side(db, risk))[0]


@router.post("/bowtie/{risk_id}/items", response_model=BowTieItem, status_code=status.HTTP_201_CREATED,
             dependencies=CAN_EDIT_BOWTIE)
def add_bowtie_item(risk_id: int, body: BowTieItemCreate, db: Session = Depends(get_db),
                    current_user: GRCUser = Depends(require_auth)):
    risk = _bowtie_risk(db, risk_id, current_user)
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="A cause or consequence needs a title.")
    last = db.query(func.max(RiskBowtieItem.position)).filter(RiskBowtieItem.risk_id == risk.id).scalar()
    item = RiskBowtieItem(
        tenant_id=risk.tenant_id, risk_id=risk.id, side=body.side, title=title,
        impact_category=body.impact_category if body.side == "consequence" else None,
        control_link_ids=_check_placed(db, risk, body.control_link_ids), source=body.source,
        position=(last or 0) + 1, created_by=current_user.id)
    db.add(item)
    db.commit()
    return _item_out(db, risk, item)


@router.put("/bowtie/{risk_id}/items/{item_id}", response_model=BowTieItem, dependencies=CAN_EDIT_BOWTIE)
def update_bowtie_item(risk_id: int, item_id: int, body: BowTieItemUpdate, db: Session = Depends(get_db),
                       current_user: GRCUser = Depends(require_auth)):
    risk = _bowtie_risk(db, risk_id, current_user)
    item = _bowtie_item(db, risk, item_id)
    changes = body.model_dump(exclude_unset=True)
    if "control_link_ids" in changes:
        changes["control_link_ids"] = _check_placed(db, risk, changes["control_link_ids"])
    if "title" in changes:
        changes["title"] = (changes["title"] or "").strip()
        if not changes["title"]:
            raise HTTPException(status_code=422, detail="A cause or consequence needs a title.")
    if item.side != "consequence":
        changes.pop("impact_category", None)
    for field, value in changes.items():
        setattr(item, field, value)
    db.commit()
    return _item_out(db, risk, item)


@router.delete("/bowtie/{risk_id}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT,
               dependencies=CAN_EDIT_BOWTIE)
def delete_bowtie_item(risk_id: int, item_id: int, db: Session = Depends(get_db),
                       current_user: GRCUser = Depends(require_auth)):
    risk = _bowtie_risk(db, risk_id, current_user)
    db.delete(_bowtie_item(db, risk, item_id))
    db.commit()
    return None


@router.post("/bowtie/{risk_id}/items/{item_id}/raise-action", status_code=status.HTTP_201_CREATED,
             dependencies=CAN_EDIT_BOWTIE)
def raise_gap_action(risk_id: int, item_id: int, db: Session = Depends(get_db),
                     current_user: GRCUser = Depends(require_auth)):
    """A gap becomes an action on the risk (Actions & Acceptances, on the CAPA engine): one per gap while it is open."""
    risk = _bowtie_risk(db, risk_id, current_user)
    item = _bowtie_item(db, risk, item_id)
    out = _item_out(db, risk, item)
    need = GAP_SIDE[item.side]
    if out.gap_action_open:
        return {"action_id": item.gap_action_id, "created": False}
    if not out.gap:
        raise HTTPException(status_code=409, detail=f"This {item.side} has a {need} control: there is no gap to act on.")
    action = add_risk_action(
        db, risk, current_user.id, title=f"Add a {need} control for: {item.title}"[:255], action_type="mitigate",
        description=f"Bow-tie gap: the {item.side} \"{item.title}\" has no {need} control linked to this risk.")
    item.gap_action_id = action.id
    db.commit()
    return {"action_id": action.id, "issue_id": action.issue_id, "created": True}


class ScenarioInput(BaseModel):
    risk_id: int
    # Left out when the request names a preset: the preset sets them.
    adjusted_likelihood: Optional[int] = Field(None, ge=1, le=5)
    adjusted_impact: Optional[int] = Field(None, ge=1, le=5)
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
    preset_id: Optional[str] = None


class ScenarioAnalysisResponse(BaseModel):
    results: List[ScenarioResult]
    summary: dict


def get_severity(score: float) -> str:
    return (risk_priority_for_score(score) or "").capitalize()


SCENARIO_PRESETS = [
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
        "description": "Technology and compliance risks increase significantly, others unchanged",
        "categories_affected": ["technology", "compliance"],
        "likelihood_adjustment": 2,
        "impact_adjustment": 1
    },
    {
        "id": "regulatory_change",
        "name": "Regulatory Change",
        "description": "Compliance risks increase, others unchanged",
        "categories_affected": ["compliance"],
        "likelihood_adjustment": 1,
        "impact_adjustment": 2
    },
]


def _preset_shift(preset: dict, risk: Risk, lk: int, imp: int) -> tuple:
    """Likelihood and impact under a preset: shifted (kept within 1-5) for the categories it names, else as they are."""
    affected = preset.get("categories_affected")
    if affected and (risk.risk_category or risk.category or "").lower() not in affected:
        return lk, imp
    clamp = lambda v: max(1, min(5, v))
    return clamp(lk + preset["likelihood_adjustment"]), clamp(imp + preset["impact_adjustment"])


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
    preset = next((p for p in SCENARIO_PRESETS if p["id"] == request.preset_id), None)
    if request.preset_id and not preset:
        raise HTTPException(status_code=400, detail="Unknown scenario preset")

    risk_ids = [s.risk_id for s in request.scenarios]
    risks = db.query(Risk).filter(
        Risk.id.in_(risk_ids),
        Risk.tenant_id.in_(user_tenants)
    ).all()
    risk_map = {r.id: r for r in risks}

    results = []
    skipped = []
    total_original = 0
    total_adjusted = 0

    for scenario in request.scenarios:
        risk = risk_map.get(scenario.risk_id)
        if not risk:
            continue

        if score_type == "inherent":
            orig_lk, orig_imp = risk.inherent_likelihood, risk.inherent_impact
        else:
            orig_lk, orig_imp = risk.residual_likelihood, risk.residual_impact
        # An unscored risk has nothing to compare against: report it, never treat it as 0 or 3.
        if not orig_lk or not orig_imp:
            skipped.append({"risk_id": risk.id, "risk_title": risk.title,
                            "reason": f"No {score_type} likelihood and impact"})
            continue

        if preset:
            adj_lk, adj_imp = _preset_shift(preset, risk, orig_lk, orig_imp)
        elif scenario.adjusted_likelihood and scenario.adjusted_impact:
            adj_lk, adj_imp = scenario.adjusted_likelihood, scenario.adjusted_impact
        else:
            skipped.append({"risk_id": risk.id, "risk_title": risk.title,
                            "reason": "No adjusted likelihood and impact"})
            continue

        # Both sides are likelihood x impact, so a risk the scenario leaves alone shows no change.
        orig_score = orig_lk * orig_imp
        adj_score = adj_lk * adj_imp
        change = adj_score - orig_score

        total_original += orig_score
        total_adjusted += adj_score

        results.append(ScenarioResult(
            risk_id=risk.id,
            risk_title=risk.title,
            risk_category=risk.risk_category,
            original_likelihood=orig_lk,
            original_impact=orig_imp,
            original_score=orig_score,
            adjusted_likelihood=adj_lk,
            adjusted_impact=adj_imp,
            adjusted_score=adj_score,
            score_change=change,
            score_change_pct=round(change / orig_score * 100, 1),
            severity_original=get_severity(orig_score),
            severity_adjusted=get_severity(adj_score),
            scenario_name=scenario.scenario_name or "Custom Scenario",
        ))

    increased = sum(1 for r in results if r.score_change > 0)
    decreased = sum(1 for r in results if r.score_change < 0)
    unchanged = sum(1 for r in results if r.score_change == 0)

    return {
        "results": results,
        "skipped": skipped,
        "summary": {
            "total_risks_analyzed": len(results),
            "total_original_score": total_original,
            "total_adjusted_score": total_adjusted,
            "total_change": total_adjusted - total_original,
            "risks_increased": increased,
            "risks_decreased": decreased,
            "risks_unchanged": unchanged,
            "risks_skipped": len(skipped),
        }
    }


@router.get("/scenario-presets")
def get_scenario_presets(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    return SCENARIO_PRESETS


class AggregationResponse(BaseModel):
    enterprise_summary: dict
    by_category: list
    by_business_unit: list
    by_status: list


BANDS = ("critical", "high", "medium", "low")


def _summarise(risks: list) -> dict:
    """Averages over the risks that carry a score and the count in each band. 1-25 scores are
    ordinal, so they are never summed into a total; an unscored risk has no band."""
    inherent = [r.inherent_score for r in risks if r.inherent_score]
    residual = [r.residual_score for r in risks if r.residual_score]
    both = [r for r in risks if r.inherent_score and r.residual_score]
    both_inherent = sum(r.inherent_score for r in both)
    bands = [risk_priority_for_score(r.residual_score or r.inherent_score) for r in risks]
    return {
        "count": len(risks),
        "avg_inherent": round(sum(inherent) / len(inherent), 1) if inherent else None,
        "avg_residual": round(sum(residual) / len(residual), 1) if residual else None,
        "reduction_pct": round((both_inherent - sum(r.residual_score for r in both)) / both_inherent * 100, 1) if both_inherent else None,
        **{band: bands.count(band) for band in BANDS},
        "unscored": bands.count(None),
    }


def _group(risks: list, key) -> dict:
    groups = {}
    for r in risks:
        groups.setdefault(key(r), []).append(r)
    return groups


@router.get("/aggregation")
def get_risk_aggregation(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"enterprise_summary": {}, "by_category": [], "by_business_unit": [], "by_status": []}

    risks = db.query(Risk).options(
        joinedload(Risk.business_unit),
        joinedload(Risk.owner),
    ).filter(
        Risk.tenant_id.in_(user_tenants),
        Risk.closure_status.is_(None),
        Risk.status.is_distinct_from("draft"),
    ).all()

    overall = _summarise(risks)
    enterprise_summary = {
        "total_risks": overall["count"],
        "avg_inherent_score": overall["avg_inherent"],
        "avg_residual_score": overall["avg_residual"],
        "risk_reduction_pct": overall["reduction_pct"],
        **{f"{band}_count": overall[band] for band in BANDS},
        "unscored_count": overall["unscored"],
    }
    by_category = [{"category": cat, **_summarise(rs)}
                   for cat, rs in _group(risks, lambda r: r.risk_category or "uncategorized").items()]
    by_business_unit = [
        {"business_unit_id": bu_id, "business_unit": name, **_summarise(rs)}
        for (bu_id, name), rs in _group(
            risks, lambda r: (r.business_unit_id or 0, r.business_unit.name if r.business_unit else "Unassigned")).items()
    ]
    by_status = [{"status": st, "count": len(rs), "avg_score": _summarise(rs)["avg_residual"]}
                 for st, rs in _group(risks, lambda r: r.status or "open").items()]

    return {
        "enterprise_summary": enterprise_summary,
        "by_category": sorted(by_category, key=lambda x: x["count"], reverse=True),
        "by_business_unit": sorted(by_business_unit, key=lambda x: x["count"], reverse=True),
        "by_status": by_status,
    }


class KRIAlertResponse(BaseModel):
    id: int
    kri_id: int
    kri_name: str
    risk_id: Optional[int] = None       # a standalone KRI watches no single risk
    risk_title: Optional[str] = None
    current_value: Optional[float] = None
    threshold_breached: str
    green_threshold: Optional[float] = None
    amber_threshold: Optional[float] = None
    threshold_direction: str
    status: str
    severity: str
    triggered_at: Optional[str] = None  # when the value was last measured; none if never recorded
    owner: Optional[str] = None
    recommended_action: str


@router.get("/kri-triggers")
def get_kri_triggers(
    severity: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"alerts": [], "summary": {}}

    # Outer join: standalone KRIs have no risk, and older rows may carry their tenant only through the risk.
    kris = db.query(RiskKRI).outerjoin(Risk, RiskKRI.risk_id == Risk.id).options(
        joinedload(RiskKRI.risk),
        joinedload(RiskKRI.owner),
        joinedload(RiskKRI.measurements),
    ).filter(
        or_(RiskKRI.tenant_id.in_(user_tenants), Risk.tenant_id.in_(user_tenants)),
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

        measured_at = kri.last_measured_at or max((m.measured_at for m in kri.measurements if m.measured_at), default=None)
        alerts.append(KRIAlertResponse(
            id=kri.id,
            kri_id=kri.id,
            kri_name=kri.name,
            risk_id=kri.risk_id,
            risk_title=kri.risk.title if kri.risk else None,
            current_value=kri.current_value,
            threshold_breached=breach_status,
            green_threshold=kri.green_threshold,
            amber_threshold=kri.amber_threshold,
            # the direction the breach test above used: anything but lower_is_better reads as higher_is_better
            threshold_direction="lower_is_better" if kri.threshold_direction == "lower_is_better" else "higher_is_better",
            status=breach_status,
            severity=sev,
            triggered_at=measured_at.isoformat() if measured_at else None,
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
        joinedload(Risk.incidents),
    ).filter(Risk.id == risk_id, Risk.tenant_id.in_(user_tenants)).first()

    if not risk:
        raise HTTPException(status_code=404, detail="Risk not found")

    impact_labels_map = {1: "Insignificant", 2: "Minor", 3: "Moderate", 4: "Major", 5: "Catastrophic"}
    likelihood_labels_map = {1: "Rare", 2: "Unlikely", 3: "Possible", 4: "Likely", 5: "Almost Certain"}

    r = ai_view(risk, "erm.bowtie_narrative")           # what the field policy lets this prompt carry
    saved = [ai_view(i, "erm.bowtie_narrative") for i in _bowtie_items(db, risk)]       # the causes and consequences saved
    threats_info = [{"title": i["title"]} for i in saved if i["side"] == "cause"]
    incidents = risk.incidents or []
    if not threats_info and incidents:
        for inc in incidents:
            i = ai_view(inc, "erm.bowtie_narrative")
            threats_info.append({"title": i["title"], "severity": i["severity"]})
    elif not threats_info:
        threats_info.append({"title": f"Potential {risk.risk_category or 'operational'} threat", "category": risk.risk_category})

    sides = {
        side: [{"name": c["name"] or f"Control {c['control_id']}", "code": c["code"], "_restricted": c["restricted"]}
               for c in ctrls]
        for side, ctrls in _controls_by_side(db, risk).items()
    }
    preventive_controls_info = sides["preventive"]
    mitigating_controls_info = sides["mitigating"]
    unclassified_controls_info = sides["unclassified"]

    for action in _risk_actions(db, risk):
        mitigating_controls_info.append({"name": action.title or f"Mitigation Action {action.id}", "status": getattr(action, 'status', None)})

    consequences_info = [f"{i['title']} ({i['impact_category']})" if i["impact_category"] else i["title"]
                         for i in saved if i["side"] == "consequence"]
    if not consequences_info:          # none saved: the ones the risk's category and impact suggest
        if risk.inherent_impact:
            consequences_info.append(f"{impact_labels_map.get(risk.inherent_impact, 'Unknown')} operational disruption")
        if risk.risk_category == "financial" or (risk.inherent_impact and risk.inherent_impact >= 3):
            consequences_info.append("Financial loss or regulatory penalty")
        if risk.risk_category == "compliance" or (risk.inherent_impact and risk.inherent_impact >= 4):
            consequences_info.append("Regulatory non-compliance or reputational damage")
        if not consequences_info:
            consequences_info.append("Business impact")

    def _for_model(items):
        # SCF control names and codes are SCF content (CC BY-ND, no AI derivatives).
        # The model still learns how many controls sit on each side of the bow-tie;
        # the offline fallback narrative below keeps the real names, since no model
        # is involved there.
        out = []
        for item in items:
            if item.get("_restricted"):
                out.append({"name": "Linked control (wording withheld: licensed text)", "code": None})
            else:
                out.append({k: v for k, v in item.items() if k != "_restricted"})
        return out

    prompt = f"""You are a senior risk management analyst. Analyze the following bow-tie risk data and generate a comprehensive plain-English narrative explaining the full causal chain.

Risk Event:
- Title: {r['title']}
- Description: {r['description'] or 'No description provided'}
- Category: {r['risk_category'] or 'Unspecified'}
- Inherent Score: {r['inherent_score'] or 'N/A'} (Likelihood: {likelihood_labels_map.get(r['inherent_likelihood'], 'N/A')}, Impact: {impact_labels_map.get(r['inherent_impact'], 'N/A')})
- Residual Score: {r['residual_score'] or 'N/A'} (Likelihood: {likelihood_labels_map.get(r['residual_likelihood'], 'N/A')}, Impact: {impact_labels_map.get(r['residual_impact'], 'N/A')})

Threats/Causes ({len(threats_info)}):
{json.dumps(threats_info, indent=2)}

Preventive Controls ({len(preventive_controls_info)}):
{json.dumps(_for_model(preventive_controls_info), indent=2)}

Mitigating Controls ({len(mitigating_controls_info)}):
{json.dumps(_for_model(mitigating_controls_info), indent=2)}

Linked Controls With No Type Set ({len(unclassified_controls_info)}):
{json.dumps(_for_model(unclassified_controls_info), indent=2)}

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
