"""Scenario Analysis: saved scenarios estimated in a currency, run on the FAIR / Monte Carlo engine, compared with
appetite and approved by a second person (Risk Management redesign, wave 4, L1).

The workshop gives a frequency (events per year, or 1 in N years) and a per-event loss range (least, typical, severe).
They map onto the existing engine as one loss component: frequency (f, f, f), every event a loss (probability 1), loss
PERT(least, typical, severe). The old score-based what-if (/analytics/scenario-analysis) stays as it is.
"""
from datetime import datetime
from typing import Dict, Iterable, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy.orm import Session

from ....models import GRCUser, Issue, IssueAction, Risk, RiskAppetiteConfig, RiskScenario, get_db
from ....routers.auth_router import get_user_tenants, require_auth, require_tenant_permission
from ....services.segregation import ensure_independent
from ...issue_management.services.risk_actions import add_risk_action
from ...workflow_engine.services.notification_service import send_workflow_notification
from ..quantification.engine import DEFAULT_ITERATIONS, MAX_ITERATIONS, simulate
from ..quantification.service import validate_loss_model_payload
from ..services.holders import holder_ids
from .appetite import _limit_kris, _naive_utc

router = APIRouter(prefix="/scenarios", tags=["ERM - Scenario Analysis"])

EDIT_GRANTS = ("risks:risk_assessment:edit", "erm:risks:edit")      # who reviews and approves
CAN_CREATE = [Depends(require_tenant_permission("risks:risk_assessment:create", "erm:risks:create"))]
CAN_EDIT = [Depends(require_tenant_permission(*EDIT_GRANTS))]
CAN_DELETE = [Depends(require_tenant_permission("risks:risk_assessment:delete", "erm:risks:delete"))]
CAN_ADD_ACTION = [Depends(require_tenant_permission("risks:risk_treatment:create", "erm:mitigation_actions:create",
                                                    "erm:risks:create"))]

ESTIMATE_FIELDS = ("risk_ids", "currency", "frequency_per_year", "loss_low", "loss_typical", "loss_severe")
EDITABLE = ("draft", "estimated")
NO_TOLERANCE = "No loss tolerance set"


class ScenarioIn(BaseModel):
    title: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    risk_ids: Optional[List[int]] = None
    workshop_notes: Optional[str] = None
    currency: Optional[str] = None
    frequency_per_year: Optional[float] = Field(None, gt=0, le=10_000)
    one_in_years: Optional[float] = Field(None, gt=0, le=100_000)   # the workshop's "1 in N years"
    loss_low: Optional[float] = Field(None, ge=0)
    loss_typical: Optional[float] = Field(None, ge=0)
    loss_severe: Optional[float] = Field(None, ge=0)

    @field_validator("currency")
    @classmethod
    def _iso(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip().upper()
        if len(v) != 3 or not v.isalpha():
            raise ValueError("currency must be a three-letter ISO 4217 code")
        return v

    @model_validator(mode="after")
    def _ordered(self):
        low, typical, severe = self.loss_low, self.loss_typical, self.loss_severe
        if typical is not None and severe is not None and severe < typical:
            raise ValueError("the severe loss must be at least the typical loss")
        if low is not None and typical is not None and low > typical:
            raise ValueError("the least loss must not be above the typical loss")
        return self

    def changes(self) -> dict:
        data = self.model_dump(exclude_unset=True)
        one_in = data.pop("one_in_years", None)
        if one_in:
            data["frequency_per_year"] = 1.0 / one_in
        if "title" in data and not (data["title"] or "").strip():
            raise HTTPException(status_code=422, detail="A scenario needs a title")
        return data


class RunIn(BaseModel):
    iterations: int = Field(DEFAULT_ITERATIONS, ge=100, le=MAX_ITERATIONS)


class NoteIn(BaseModel):
    note: Optional[str] = None


class ActionIn(BaseModel):
    risk_id: int
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    due_date: Optional[datetime] = None


# ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────
def _tenants(db: Session, user: GRCUser) -> List[int]:
    return get_user_tenants(user, db) or []


def _get(db: Session, scenario_id: int, user: GRCUser) -> RiskScenario:
    row = db.query(RiskScenario).filter(RiskScenario.id == scenario_id,
                                        RiskScenario.tenant_id.in_(_tenants(db, user))).first()
    if not row:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return row


def _editable(row: RiskScenario) -> None:
    if row.status == "approved":
        raise HTTPException(status_code=409, detail="An approved scenario is read-only: re-open it as a new draft")
    if row.status not in EDITABLE:
        raise HTTPException(status_code=409, detail="This scenario is with the approver: send it back to change it")


def _tell(db: Session, row: RiskScenario, user_ids: Iterable[Optional[int]], actor: GRCUser, subject: str,
          message: str) -> None:
    """In-app (and email where set up) to whoever acts next, never the one who just acted, with a link to the scenario."""
    to = sorted({u for u in user_ids if u and u != actor.id})
    if to:
        send_workflow_notification(db, tenant_id=row.tenant_id, subject=subject, message=message, workflow_instance_id=None,
                                   user_ids=to, link=f"/erm/analytics/scenario?id={row.id}")


def _risks(db: Session, tenant_id: int, ids: Iterable[int]) -> List[Risk]:
    ids = list(dict.fromkeys(ids or []))
    found = {r.id: r for r in db.query(Risk).filter(Risk.id.in_(ids), Risk.tenant_id == tenant_id)} if ids else {}
    missing = [i for i in ids if i not in found]
    if missing:
        raise HTTPException(status_code=422, detail=f"Not in your risk register: {', '.join(map(str, missing))}")
    return [found[i] for i in ids]


def _names(db: Session, ids: Iterable[Optional[int]]) -> Dict[int, str]:
    ids = {i for i in ids if i}
    return {u.id: u.display_name or u.username for u in db.query(GRCUser).filter(GRCUser.id.in_(ids))} if ids else {}


def _category(risk: Risk) -> str:
    return risk.risk_category or risk.category


def appetite_comparison(db: Session, row: RiskScenario, risks: List[Risk]) -> List[dict]:
    """The severe (1-in-100) loss against each linked risk category's money tolerance: a limit KRI of the category's
    appetite measured in the scenario's currency (its red line). No such limit: "No loss tolerance set" (a score
    tolerance is not a loss tolerance, and other currencies are not converted)."""
    severe = (row.result or {}).get("one_in_100")
    out = []
    for category in sorted({_category(r) for r in risks if _category(r)}):
        config = db.query(RiskAppetiteConfig).filter(RiskAppetiteConfig.tenant_id == row.tenant_id,
                                                     RiskAppetiteConfig.category == category).first()
        limit = next((k for k in (_limit_kris(db, config) if config else [])
                      if (k.unit or "").strip().upper() == row.currency and k.amber_threshold is not None
                      and k.threshold_direction != "higher_is_better"), None)
        if limit is None:
            out.append({"category": category, "tolerance": None, "reason": NO_TOLERANCE})
            continue
        out.append({"category": category, "tolerance": limit.amber_threshold, "currency": row.currency,
                    "limit": limit.name, "severe_loss": severe,
                    "within": None if severe is None else severe <= limit.amber_threshold})
    return out


def _actions(db: Session, row: RiskScenario) -> List[dict]:
    ids = row.action_ids or []
    if not ids:
        return []
    rows = (db.query(IssueAction, Issue.source_id).join(Issue, Issue.id == IssueAction.issue_id)
            .filter(IssueAction.id.in_(ids)).order_by(IssueAction.id).all())
    return [{"id": a.id, "risk_id": risk_id, "title": a.title, "status": a.status, "issue_id": a.issue_id,
             "due_date": a.due_date.isoformat() if a.due_date else None} for a, risk_id in rows]


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _out(db: Session, row: RiskScenario, user: GRCUser) -> dict:
    risks = _risks_present(db, row)
    names = _names(db, (row.created_by, row.estimated_by, row.reviewed_by, row.approved_by))
    return {
        "id": row.id, "title": row.title, "description": row.description, "status": row.status,
        "risk_ids": row.risk_ids or [],
        "risks": [{"id": r.id, "title": r.title, "category": _category(r), "residual_score": r.residual_score}
                  for r in risks],
        "workshop_notes": row.workshop_notes, "currency": row.currency,
        "frequency_per_year": row.frequency_per_year, "loss_low": row.loss_low,
        "loss_typical": row.loss_typical, "loss_severe": row.loss_severe,
        "result": row.result, "last_run_at": _iso(row.last_run_at), "previous_run_at": _iso(row.previous_run_at),
        "created_by_name": names.get(row.created_by), "estimated_by_name": names.get(row.estimated_by),
        "reviewed_by_name": names.get(row.reviewed_by), "approved_by_name": names.get(row.approved_by),
        "reviewed_at": _iso(row.reviewed_at), "approved_at": _iso(row.approved_at), "review_note": row.review_note,
        "reopened_from_id": row.reopened_from_id,
        "can_approve": row.status == "reviewed" and user.id not in (row.estimated_by, row.reviewed_by),
        "appetite": appetite_comparison(db, row, risks),
        "actions": _actions(db, row),
        "created_at": _iso(row.created_at), "updated_at": _iso(row.updated_at),
    }


def _risks_present(db: Session, row: RiskScenario) -> List[Risk]:
    """Linked risks still in the register (a risk deleted later drops out of the view, not out of the record)."""
    ids = row.risk_ids or []
    found = {r.id: r for r in db.query(Risk).filter(Risk.id.in_(ids), Risk.tenant_id == row.tenant_id)} if ids else {}
    return [found[i] for i in ids if i in found]


def _engine_inputs(row: RiskScenario) -> dict:
    """The scenario as the FAIR engine's model; 422 when the workshop has not given what it needs."""
    if row.frequency_per_year is None or row.loss_typical is None or row.loss_severe is None:
        raise HTTPException(status_code=422, detail="Enter the frequency, the typical loss and the severe loss first")
    if not (row.workshop_notes or "").strip():
        raise HTTPException(status_code=422, detail="Add the workshop notes: the reasoning behind the estimates")
    f = float(row.frequency_per_year)
    component = {"key": "loss", "label": "Loss per event", "kind": "primary", "probability": 1.0,
                 "min": float(row.loss_low or 0.0), "ml": float(row.loss_typical), "max": float(row.loss_severe),
                 "rationale": row.workshop_notes}
    try:
        validate_loss_model_payload({"min": f, "ml": f, "max": f}, {"min": 1.0, "ml": 1.0, "max": 1.0}, [component])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return {"tef": (f, f, f), "pos": (1.0, 1.0, 1.0),
            "components": [{k: component[k] for k in ("key", "label", "min", "ml", "max", "probability")}]}


def approved_scenarios(db: Session, tenant_ids: Iterable[int]) -> List[dict]:
    """Approved scenarios with their tail losses, newest approval first: what a committee pack lists."""
    rows = (db.query(RiskScenario).filter(RiskScenario.tenant_id.in_(list(tenant_ids)), RiskScenario.status == "approved")
            .order_by(RiskScenario.approved_at.desc(), RiskScenario.id.desc()).all())
    names = _names(db, (r.approved_by for r in rows))
    return [{"id": r.id, "title": r.title, "currency": r.currency, "mean": (r.result or {}).get("mean"),
             "one_in_20": (r.result or {}).get("one_in_20"), "one_in_100": (r.result or {}).get("one_in_100"),
             "last_run_at": _iso(r.last_run_at), "approved_at": _iso(r.approved_at),
             "approved_by_name": names.get(r.approved_by)} for r in rows]


# ── routes ───────────────────────────────────────────────────────────────────────────────────────────────────────
@router.get("")
def list_scenarios(current_user: GRCUser = Depends(require_auth), db: Session = Depends(get_db)):
    rows = (db.query(RiskScenario).filter(RiskScenario.tenant_id.in_(_tenants(db, current_user)))
            .order_by(RiskScenario.updated_at.desc(), RiskScenario.id.desc()).all())
    return [{"id": r.id, "title": r.title, "status": r.status, "currency": r.currency,
             "risk_count": len(r.risk_ids or []), "last_run_at": _iso(r.last_run_at),
             "mean": (r.result or {}).get("mean"), "severe_loss": (r.result or {}).get("one_in_100"),
             "updated_at": _iso(r.updated_at)} for r in rows]


@router.post("", status_code=status.HTTP_201_CREATED, dependencies=CAN_CREATE)
def create_scenario(body: ScenarioIn, current_user: GRCUser = Depends(require_auth), db: Session = Depends(get_db)):
    tenants = _tenants(db, current_user)
    if not tenants:
        raise HTTPException(status_code=403, detail="No tenant")
    data = body.changes()
    if not (data.get("title") or "").strip():
        raise HTTPException(status_code=422, detail="A scenario needs a title")
    _risks(db, tenants[0], data.get("risk_ids") or [])
    row = RiskScenario(tenant_id=tenants[0], created_by=current_user.id, status="draft",
                       **{**data, "title": data["title"].strip(), "currency": data.get("currency") or "USD"})
    db.add(row)
    db.commit()
    return _out(db, row, current_user)


@router.get("/{scenario_id}")
def get_scenario(scenario_id: int, current_user: GRCUser = Depends(require_auth), db: Session = Depends(get_db)):
    return _out(db, _get(db, scenario_id, current_user), current_user)


@router.put("/{scenario_id}", dependencies=CAN_EDIT)
def update_scenario(scenario_id: int, body: ScenarioIn, current_user: GRCUser = Depends(require_auth),
                    db: Session = Depends(get_db)):
    row = _get(db, scenario_id, current_user)
    _editable(row)
    data = body.changes()
    if "risk_ids" in data:
        _risks(db, row.tenant_id, data["risk_ids"] or [])
    low, typical, severe = (data.get(k, getattr(row, k)) for k in ("loss_low", "loss_typical", "loss_severe"))
    if typical is not None and ((severe is not None and severe < typical) or (low is not None and low > typical)):
        raise HTTPException(status_code=422, detail="Losses must run least <= typical <= severe")
    inputs_changed = any(k in data and data[k] != getattr(row, k) for k in ESTIMATE_FIELDS)
    for key, value in data.items():
        setattr(row, key, value.strip() if key == "title" else value)
    if inputs_changed and row.status == "estimated":
        row.status = "draft"          # the last run no longer matches the inputs
    db.commit()
    return _out(db, row, current_user)


@router.post("/{scenario_id}/run", dependencies=CAN_EDIT)
def run_scenario(scenario_id: int, body: Optional[RunIn] = None, current_user: GRCUser = Depends(require_auth),
                 db: Session = Depends(get_db)):
    row = _get(db, scenario_id, current_user)
    _editable(row)
    model = _engine_inputs(row)
    sim = simulate(model, iterations=(body or RunIn()).iterations)
    now = datetime.utcnow()
    row.previous_run_at, row.last_run_at = row.last_run_at, now
    row.result = {
        "mean": sim["ale_mean"], "median": sim["ale_median"], "p90": sim["p90"],
        "one_in_20": sim["p95"], "one_in_100": sim["p99"], "lec_points": sim["lec_points"],
        "iterations": sim["iterations"], "seed": sim["seed"], "engine_version": sim["engine_version"],
        "currency": row.currency, "run_at": now.isoformat(),
        "inputs": {k: getattr(row, k) for k in ("frequency_per_year", "loss_low", "loss_typical", "loss_severe")},
    }
    row.status, row.estimated_by = "estimated", current_user.id
    _tell(db, row, holder_ids(db, *EDIT_GRANTS, tenant_id=row.tenant_id, but_not=(current_user.id,)), current_user,
          f"Scenario to review: {row.title}", f"{current_user.display_name or current_user.username} ran the scenario "
          f"{row.title}. Review its estimates and result.")
    db.commit()
    return _out(db, row, current_user)


@router.post("/{scenario_id}/review", dependencies=CAN_EDIT)
def review_scenario(scenario_id: int, body: NoteIn, current_user: GRCUser = Depends(require_auth),
                    db: Session = Depends(get_db)):
    row = _get(db, scenario_id, current_user)
    if row.status != "estimated":
        raise HTTPException(status_code=409, detail="Run the scenario on its current inputs before the review")
    row.status, row.reviewed_by, row.reviewed_at = "reviewed", current_user.id, datetime.utcnow()
    row.review_note = (body.note or "").strip() or None
    _tell(db, row, holder_ids(db, *EDIT_GRANTS, tenant_id=row.tenant_id, but_not=(row.estimated_by, current_user.id)), current_user,
          f"Scenario to approve: {row.title}", f"{current_user.display_name or current_user.username} reviewed the "
          f"scenario {row.title}. Approve it or send it back.")
    db.commit()
    return _out(db, row, current_user)


@router.post("/{scenario_id}/approve", dependencies=CAN_EDIT)
def approve_scenario(scenario_id: int, body: NoteIn, current_user: GRCUser = Depends(require_auth),
                     db: Session = Depends(get_db)):
    row = _get(db, scenario_id, current_user)
    if row.status != "reviewed":
        raise HTTPException(status_code=409, detail="Only a reviewed scenario can be approved")
    ensure_independent(row.estimated_by, current_user, "approve this scenario")
    ensure_independent(row.reviewed_by, current_user, "approve this scenario")
    row.status, row.approved_by, row.approved_at = "approved", current_user.id, datetime.utcnow()
    if (body.note or "").strip():
        row.review_note = body.note.strip()
    _tell(db, row, [row.estimated_by], current_user, f"Scenario approved: {row.title}",
          f"{current_user.display_name or current_user.username} approved the scenario {row.title}.")
    db.commit()
    return _out(db, row, current_user)


@router.post("/{scenario_id}/send-back", dependencies=CAN_EDIT)
def send_back_scenario(scenario_id: int, body: NoteIn, current_user: GRCUser = Depends(require_auth),
                       db: Session = Depends(get_db)):
    row = _get(db, scenario_id, current_user)
    if row.status not in ("estimated", "reviewed"):
        raise HTTPException(status_code=409, detail="Only an estimated or reviewed scenario can be sent back")
    note = (body.note or "").strip()
    if not note:
        raise HTTPException(status_code=422, detail="Say why it is sent back")
    row.status, row.review_note, row.reviewed_by, row.reviewed_at = "draft", note, None, None
    _tell(db, row, [row.estimated_by], current_user, f"Scenario sent back: {row.title}",
          f"{current_user.display_name or current_user.username} sent the scenario {row.title} back: {note}")
    db.commit()
    return _out(db, row, current_user)


@router.delete("/{scenario_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=CAN_DELETE)
def delete_scenario(scenario_id: int, current_user: GRCUser = Depends(require_auth), db: Session = Depends(get_db)):
    """Delete a draft. A scenario that was run, reviewed or approved stays on the record."""
    row = _get(db, scenario_id, current_user)
    if row.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft scenario is deleted; this one stays on the record.")
    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{scenario_id}/reopen", status_code=status.HTTP_201_CREATED, dependencies=CAN_CREATE)
def reopen_scenario(scenario_id: int, current_user: GRCUser = Depends(require_auth), db: Session = Depends(get_db)):
    """A new draft from an approved scenario; the approved one stays as it was approved."""
    row = _get(db, scenario_id, current_user)
    if row.status != "approved":
        raise HTTPException(status_code=409, detail="Only an approved scenario is re-opened")
    copy = RiskScenario(tenant_id=row.tenant_id, created_by=current_user.id, status="draft", reopened_from_id=row.id,
                        **{k: getattr(row, k) for k in ("title", "description", "risk_ids", "workshop_notes", "currency",
                                                        "frequency_per_year", "loss_low", "loss_typical", "loss_severe")})
    db.add(copy)
    db.commit()
    return _out(db, copy, current_user)


@router.post("/{scenario_id}/actions", status_code=status.HTTP_201_CREATED, dependencies=CAN_ADD_ACTION)
def add_scenario_action(scenario_id: int, body: ActionIn, current_user: GRCUser = Depends(require_auth),
                        db: Session = Depends(get_db)):
    """An agreed action on one of the scenario's risks, on that risk's treatment issue (the CAPA engine)."""
    row = _get(db, scenario_id, current_user)
    if row.status == "approved":
        _editable(row)
    if body.risk_id not in (row.risk_ids or []):
        raise HTTPException(status_code=422, detail="Add actions only on the scenario's own risks")
    [risk] = _risks(db, row.tenant_id, [body.risk_id])
    action = add_risk_action(db, risk, current_user.id, title=body.title.strip(), due_date=_naive_utc(body.due_date),
                             description=body.description)
    row.action_ids = [*(row.action_ids or []), action.id]
    db.commit()
    return _out(db, row, current_user)
