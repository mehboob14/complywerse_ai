from ....config import get_openai_api_key
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing import Dict, Iterable, List, Optional, Tuple
from datetime import datetime, timedelta, timezone
from pydantic import BaseModel
import logging
import os
import json

from ....models import (
    RiskAppetiteBreach, RiskAppetiteConfig, RiskAppetiteStatement, GRCUser, Risk, RiskKRI, get_db,
)
from ....schemas import (
    RiskAppetiteConfigCreate, RiskAppetiteConfigUpdate, RiskAppetiteConfigResponse
)
from ....routers.auth_router import (require_auth, get_user_tenants, get_user_primary_tenant, require_tenant_permission,
                                     has_tenant_permission)
from ....services import kri_feeds
from ....services.segregation import ensure_independent
from ...workflow_engine.services.notification_service import send_workflow_notification
from ..services.monitor_changes import (LIMIT_FIELDS, approved_statement, changed, decide, limits_snapshot, limits_source,
                                        notify, pending_change, permission_holders, propose)
from .kris import calculate_kri_status

router = APIRouter(prefix="/appetite")
logger = logging.getLogger(__name__)

# Writes: the appetite permission, or the ERM risk permission the risk editors hold today (admins pass).
EDIT_PERMISSIONS = ("risks:risk_appetite:edit", "erm:risks:edit")
CAN_CREATE = [Depends(require_tenant_permission("risks:risk_appetite:create", "erm:risks:create"))]
CAN_EDIT = [Depends(require_tenant_permission(*EDIT_PERMISSIONS))]
CAN_DELETE = [Depends(require_tenant_permission("risks:risk_appetite:delete", "erm:risks:delete"))]
EXCESS_MAX_DAYS = 183     # an approved excess runs out within six months
RESOLVED_SHOWN = 100      # resolved breaches the log returns, newest first


RISK_CATEGORIES = [
    "strategic", "operational", "financial", "compliance", 
    "technology", "third_party", "project_change"
]

APPETITE_LEVELS = {
    "averse": 1,
    "minimal": 2,
    "cautious": 3,
    "moderate": 4,
    "open": 5,
    "hungry": 6
}


# The one breach rule: an open risk whose residual score (else its inherent score) is above its category's
# tolerance threshold (else its max acceptable score). A category with no config, or an unscored risk, has no breach.
def _open_risks(db: Session, tenant_ids: List[int]):
    return db.query(Risk).filter(
        Risk.tenant_id.in_(tenant_ids),
        or_(Risk.status.is_(None), Risk.status.notin_(("closed", "draft"))),     # a draft is not in the register yet
        or_(Risk.closure_status.is_(None), Risk.closure_status != "closed"),
    )


def appetite_category(risk: Risk) -> Optional[str]:
    """The category a risk is held against: its risk category, else its category. reports.py reads it the same way."""
    return risk.risk_category or risk.category


APPETITE_CATEGORY = func.coalesce(func.nullif(Risk.risk_category, ""), Risk.category)    # appetite_category in SQL


def _awaiting_add(config: RiskAppetiteConfig) -> bool:
    return bool((pending_change(config, "limit_change") or {}).get("changes", {}).get("add"))


def _propose_new_limit(db: Session, config: RiskAppetiteConfig, user: GRCUser) -> dict:
    """After a statement version is approved, a new category's limit is proposed, not in force until someone else
    approves it (refusing removes it). Returns what was proposed (empty before any approved version)."""
    if approved_statement(db, config.tenant_id) is None:
        return {}
    propose(config, "limit_change", {"add": True}, user)
    return {"add": True}


def _tolerance(config: RiskAppetiteConfig) -> Optional[float]:
    return config.tolerance_threshold if config.tolerance_threshold is not None else config.max_acceptable_score


def _score(risk: Risk) -> Optional[float]:
    return risk.residual_score if risk.residual_score is not None else risk.inherent_score


def _breaches(score: Optional[float], tolerance: Optional[float]) -> bool:
    return score is not None and tolerance is not None and score > tolerance


def _days_since_update(risk: Risk) -> int:
    """Days since the risk was last updated: not how long it has been over tolerance (nothing records that)."""
    since = risk.updated_at or risk.created_at
    return (datetime.utcnow() - since).days if since else 0


# ── Breach detection: the breach log kept in line with the limits ────────────────────────────────────────────────
Hit = Tuple[float, Optional[float], str]      # measured value, limit, what breached (risk title or KRI name)


def _limit_kris(db: Session, config: RiskAppetiteConfig) -> List[RiskKRI]:
    ids = config.limit_kri_ids or []
    rows = {k.id: k for k in db.query(RiskKRI).filter(RiskKRI.id.in_(ids), RiskKRI.tenant_id == config.tenant_id)} if ids else {}
    return [rows[i] for i in ids if i in rows]


def _kri_reading(db: Session, kri: RiskKRI) -> Tuple[Optional[float], str]:
    """The KRI's published value and its status, as the KRI page shows them (a live-fed KRI reads the metric layer)."""
    live = kri_feeds.current_value(db, [kri.tenant_id], kri.metric_key) if kri.metric_key else None
    value = live if live is not None else kri.current_value
    return value, calculate_kri_status(value, kri) if value is not None else "unknown"


def _breaching(db: Session, config: RiskAppetiteConfig) -> Dict[Tuple[str, int], Hit]:
    """Each open risk over the category's tolerance (the one rule above) and each active limit KRI at red."""
    out: Dict[Tuple[str, int], Hit] = {}
    if _awaiting_add(config):
        return out      # a limit added after an approved statement is not in force until someone else approves it
    tolerance = _tolerance(config)
    for risk in _open_risks(db, [config.tenant_id]).filter(APPETITE_CATEGORY == config.category):
        if _breaches(_score(risk), tolerance):
            out[("risk", risk.id)] = (_score(risk), tolerance, risk.title)
    for kri in _limit_kris(db, config):
        value, kri_status = _kri_reading(db, kri)
        if kri.is_active is not False and kri_status == "red":
            out[("kri", kri.id)] = (value, kri.amber_threshold, kri.name)
    if config.concentration_limit is not None:      # third party: critical or important vendors sharing one fourth party
        from ...vendor_risk.tpra.outsourcing import worst_concentration
        worst = worst_concentration(db, config.tenant_id)
        if worst and worst["count"] > config.concentration_limit:
            out[("concentration", None)] = (worst["count"], config.concentration_limit,
                                            f"{worst['platform']} (critical or important vendors relying on it)")
    return out


def _escalate(db: Session, config: RiskAppetiteConfig, hit: Hit, what: str) -> None:
    """Tell the category's escalation owner, unless the category's alerts are off."""
    if config.alert_enabled is False or not config.escalation_owner_id:
        return
    label = config.category.replace("_", " ").title()
    limit = f"{hit[1]:g}" if hit[1] is not None else "its limit"
    send_workflow_notification(db, tenant_id=config.tenant_id, subject=f"Risk appetite breach: {label}",
                               message=f"{what}: {hit[2]} is at {hit[0]:g} against the {label} limit of {limit}.",
                               workflow_instance_id=None, user_ids=[config.escalation_owner_id], link="/erm/appetite")


def check_appetite(db: Session, tenant_ids: List[int], categories: Optional[Iterable[Optional[str]]] = None) -> Dict[str, int]:
    """Bring the breach log in line with the limits, idempotently: open a breach for each newly breaching risk or red
    limit KRI, resolve the open ones back within limit (or whose category has no limit now), reopen an expired excess.
    The escalation owner hears of each opened or reopened breach. The caller commits. Two checks at the same instant
    open a breach once: the open-breach index refuses the second, which is skipped (_open_breach)."""
    db.flush()      # sessions here do not autoflush: the change being checked must reach the queries
    configs = db.query(RiskAppetiteConfig).filter(RiskAppetiteConfig.tenant_id.in_(tenant_ids))
    active = db.query(RiskAppetiteBreach).filter(RiskAppetiteBreach.tenant_id.in_(tenant_ids),
                                                 RiskAppetiteBreach.status != "resolved")
    if categories is not None:
        wanted = [c for c in categories if c]
        configs = configs.filter(RiskAppetiteConfig.category.in_(wanted))
        active = active.filter(RiskAppetiteBreach.category.in_(wanted))
    by_key = {(c.tenant_id, c.category): c for c in configs}
    open_by_key: Dict[Tuple[int, str], List[RiskAppetiteBreach]] = {}
    for breach in active:
        open_by_key.setdefault((breach.tenant_id, breach.category), []).append(breach)

    now, counts = datetime.utcnow(), {"opened": 0, "resolved": 0, "reopened": 0}
    for key in by_key.keys() | open_by_key.keys():
        config = by_key.get(key)
        breaching = _breaching(db, config) if config else {}
        for breach in open_by_key.get(key, []):
            kind = "risk" if breach.risk_id else "kri" if breach.kri_id else "concentration"
            hit = breaching.pop((kind, breach.risk_id or breach.kri_id), None)
            if hit is None:
                breach.status, breach.resolved_at = "resolved", now
                counts["resolved"] += 1
                continue
            breach.measured_value, breach.limit_value = hit[0], hit[1]
            if breach.status == "excess_approved" and breach.excess_expires_at and breach.excess_expires_at <= now:
                breach.status = "open"
                counts["reopened"] += 1
                _escalate(db, config, hit, "An approved excess has lapsed")
        for (kind, item_id), hit in breaching.items():
            if _open_breach(db, RiskAppetiteBreach(
                    tenant_id=key[0], category=key[1], risk_id=item_id if kind == "risk" else None,
                    kri_id=item_id if kind == "kri" else None, measured_value=hit[0], limit_value=hit[1], detected_at=now,
                    status="open")):
                counts["opened"] += 1
                _escalate(db, config, hit, "New breach")
    return counts


def _open_breach(db: Session, breach: RiskAppetiteBreach) -> bool:
    """Open the breach unless a check running at the same moment just opened it (the open-breach index refuses a second
    one): only that row is undone, the rest of this check stands."""
    db.flush()          # what this check changed so far stays out of the savepoint
    try:
        with db.begin_nested():
            db.add(breach)
    except IntegrityError:
        return False
    return True


def recheck_kri_limits(db: Session, kri: RiskKRI) -> None:
    """A KRI's published value or thresholds changed: the limits it measures are re-checked now (the breach log), not
    when the appetite page is next opened. Runs after that change is committed; a failure is logged, never undoes it."""
    try:
        categories = [c.category for c in db.query(RiskAppetiteConfig).filter(RiskAppetiteConfig.tenant_id == kri.tenant_id)
                      if kri.id in (c.limit_kri_ids or [])]
        if categories:
            check_appetite(db, [kri.tenant_id], categories)
            db.commit()
    except Exception:  # noqa: BLE001 — the published value stands; the next check catches up
        db.rollback()
        logger.exception("kri %s: the appetite limits it measures could not be re-checked", kri.id)


@router.get("", response_model=List[RiskAppetiteConfigResponse])
def get_appetite_configs(
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db)
):
    """Get all risk appetite configurations for user's tenants"""
    tenant_ids = get_user_tenants(current_user, db)
    
    configs = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.tenant_id.in_(tenant_ids)
    ).all()
    
    return configs


@router.get("/with-stats")
def get_appetite_configs_with_stats(
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db)
):
    """Get appetite configs with risk count statistics, limit KRIs and open breaches (the breach log is brought up to date first)"""
    tenant_ids = get_user_tenants(current_user, db)
    check_appetite(db, tenant_ids)
    db.commit()

    configs = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.tenant_id.in_(tenant_ids)
    ).all()
    open_breaches = dict(db.query(RiskAppetiteBreach.category, func.count(RiskAppetiteBreach.id)).filter(
        RiskAppetiteBreach.tenant_id.in_(tenant_ids), RiskAppetiteBreach.status != "resolved",
    ).group_by(RiskAppetiteBreach.category).all())
    in_force = {t: approved_statement(db, t) for t in tenant_ids}
    names = _names(db, [(c.limit_change or {}).get(k) for c in configs for k in ("proposed_by", "decided_by")])

    result = []
    for config in configs:
        risks_in_category = _open_risks(db, tenant_ids).filter(APPETITE_CATEGORY == config.category).all()
        
        appetite_value = APPETITE_LEVELS.get(config.appetite_level, 4)
        exceeding_count = 0
        tolerance_breaches = []
        
        tolerance = _tolerance(config)

        for risk in risks_in_category:
            if _breaches(_score(risk), tolerance):
                exceeding_count += 1
                tolerance_breaches.append({
                    "risk_id": risk.id,
                    "risk_title": risk.title,
                    "category": appetite_category(risk),
                    "current_score": _score(risk),
                    "tolerance": tolerance,
                    "days_over": _days_since_update(risk),
                })
        
        escalation_owner_data = None
        if config.escalation_owner:
            escalation_owner_data = {
                "id": config.escalation_owner.id,
                "email": config.escalation_owner.email,
                "full_name": config.escalation_owner.display_name or config.escalation_owner.username
            }
        
        result.append({
            "id": config.id,
            "tenant_id": config.tenant_id,
            "category": config.category,
            "appetite_level": config.appetite_level,
            "appetite_value": appetite_value,
            "max_acceptable_score": config.max_acceptable_score,
            "tolerance_threshold": tolerance,
            "escalation_owner_id": config.escalation_owner_id,
            "escalation_owner": escalation_owner_data,
            "alert_enabled": config.alert_enabled,
            "description": config.description,
            "risks_count": len(risks_in_category),
            "exceeding_count": exceeding_count,
            "tolerance_breaches": tolerance_breaches,
            "limit_kri_ids": config.limit_kri_ids or [],
            "limit_kris": [{"id": k.id, "name": k.name, "current_value": value, "status": kri_status}
                           for k in _limit_kris(db, config) for value, kri_status in [_kri_reading(db, k)]],
            "open_breach_count": open_breaches.get(config.category, 0),
            "concentration_limit": config.concentration_limit,
            "limit_change": _change_out(config.limit_change, names),
            "limits_source": limits_source(config, in_force.get(config.tenant_id)),
        })

    return result


def _change_out(change: Optional[dict], names: Dict[int, str]) -> Optional[dict]:
    return {**change, "proposed_by_name": names.get(change.get("proposed_by")),
            "decided_by_name": names.get(change.get("decided_by"))} if change else None


@router.get("/breaches")
def get_tolerance_breaches(
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db)
):
    """Get all risks exceeding their category's tolerance threshold"""
    tenant_ids = get_user_tenants(current_user, db)
    
    configs = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.tenant_id.in_(tenant_ids)
    ).all()
    
    config_map = {c.category: c for c in configs}
    
    breaches = []
    
    risks = _open_risks(db, tenant_ids).all()

    for risk in risks:
        config = config_map.get(appetite_category(risk))
        if not config:
            continue
        tolerance = _tolerance(config)
        score = _score(risk)

        if _breaches(score, tolerance):
            owner_data = None
            if risk.owner:
                owner_data = {
                    "id": risk.owner.id,
                    "email": risk.owner.email,
                    "full_name": risk.owner.display_name or risk.owner.username
                }
                
            breaches.append({
                "risk_id": risk.id,
                "risk_title": risk.title,
                "category": appetite_category(risk),
                "current_score": score,
                "tolerance": tolerance,
                "excess": score - tolerance,
                "days_over": _days_since_update(risk),
                "owner_id": risk.owner_id,
                "owner": owner_data
            })
    
    return {
        "total_breaches": len(breaches),
        "breaches": sorted(breaches, key=lambda x: x["excess"], reverse=True)
    }


# ── Shared bits for statements and breaches ──────────────────────────────────────────────────────────────────────
class NoteBody(BaseModel):
    note: Optional[str] = None
    effective_from: Optional[datetime] = None


class TextBody(BaseModel):
    statement: Optional[str] = None
    plan: Optional[str] = None


def _naive_utc(value: Optional[datetime]) -> Optional[datetime]:
    return value.astimezone(timezone.utc).replace(tzinfo=None) if value and value.tzinfo else value


def _required(text: Optional[str], what: str) -> str:
    text = (text or "").strip()
    if not text:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Write the {what}.")
    return text


def _names(db: Session, ids: Iterable[Optional[int]]) -> Dict[int, str]:
    ids = {i for i in ids if i}
    return {u.id: u.display_name or u.username for u in db.query(GRCUser).filter(GRCUser.id.in_(ids))} if ids else {}


def _row(row) -> dict:
    return {c.name: getattr(row, c.name) for c in row.__table__.columns}


def _get(db: Session, model, row_id: int, user: GRCUser, *allowed: str):
    """The tenant's row, refused (409) unless its status is one of `allowed`."""
    row = db.query(model).filter(model.id == row_id, model.tenant_id.in_(get_user_tenants(user, db))).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    if row.status not in allowed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"This is {row.status.replace('_', ' ')}.")
    return row


# ── Statements: versions the board approves ──────────────────────────────────────────────────────────────────────
OPEN_STATEMENT = ("draft", "pending_approval")


def _statement_out(db: Session, s: RiskAppetiteStatement) -> dict:
    names = _names(db, (s.created_by, s.submitted_by, s.approved_by))
    return {**_row(s), "created_by_name": names.get(s.created_by), "submitted_by_name": names.get(s.submitted_by),
            "approved_by_name": names.get(s.approved_by)}


@router.get("/statements")
def list_statements(current_user: GRCUser = Depends(require_auth), db: Session = Depends(get_db)):
    """Every version, newest first."""
    rows = db.query(RiskAppetiteStatement).filter(RiskAppetiteStatement.tenant_id.in_(get_user_tenants(current_user, db))
                                                  ).order_by(RiskAppetiteStatement.version.desc()).all()
    return [_statement_out(db, s) for s in rows]


@router.get("/statements/current")
def current_statement(current_user: GRCUser = Depends(require_auth), db: Session = Depends(get_db)):
    """The approved version in force, or null."""
    s = db.query(RiskAppetiteStatement).filter(RiskAppetiteStatement.tenant_id.in_(get_user_tenants(current_user, db)),
                                               RiskAppetiteStatement.status == "approved",
                                               ).order_by(RiskAppetiteStatement.version.desc()).first()
    return _statement_out(db, s) if s else None


@router.post("/statements", dependencies=CAN_EDIT)
def create_statement(body: TextBody, current_user: GRCUser = Depends(require_auth), db: Session = Depends(get_db)):
    """A new draft version. One version is open (draft or awaiting approval) at a time."""
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    text = _required(body.statement, "statement")
    pending = db.query(RiskAppetiteStatement).filter(RiskAppetiteStatement.tenant_id == tenant_id,
                                                     RiskAppetiteStatement.status.in_(OPEN_STATEMENT)).first()
    if pending:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=f"Version {pending.version} is still open: edit or decide it first.")
    version = (db.query(func.max(RiskAppetiteStatement.version)).filter(
        RiskAppetiteStatement.tenant_id == tenant_id).scalar() or 0) + 1
    s = RiskAppetiteStatement(tenant_id=tenant_id, version=version, statement=text, status="draft", created_by=current_user.id)
    db.add(s)
    db.commit()
    return _statement_out(db, s)


@router.put("/statements/{statement_id}", dependencies=CAN_EDIT)
def edit_statement(statement_id: int, body: TextBody, current_user: GRCUser = Depends(require_auth),
                   db: Session = Depends(get_db)):
    s = _get(db, RiskAppetiteStatement, statement_id, current_user, "draft")
    s.statement = _required(body.statement, "statement")
    db.commit()
    return _statement_out(db, s)


@router.post("/statements/{statement_id}/submit", dependencies=CAN_EDIT)
def submit_statement(statement_id: int, current_user: GRCUser = Depends(require_auth), db: Session = Depends(get_db)):
    s = _get(db, RiskAppetiteStatement, statement_id, current_user, "draft")
    s.status, s.submitted_by = "pending_approval", current_user.id
    db.commit()
    return _statement_out(db, s)


@router.post("/statements/{statement_id}/approve", dependencies=CAN_EDIT)
def approve_statement(statement_id: int, body: NoteBody, current_user: GRCUser = Depends(require_auth),
                      db: Session = Depends(get_db)):
    """Approve the version (not by its submitter); the version approved before it is superseded. The limits in force are
    frozen into it, and from then on a limit change is proposed and decided by someone else."""
    s = _get(db, RiskAppetiteStatement, statement_id, current_user, "pending_approval")
    ensure_independent(s.submitted_by, current_user, "approve this statement")
    now = datetime.utcnow()
    for previous in db.query(RiskAppetiteStatement).filter(RiskAppetiteStatement.tenant_id == s.tenant_id,
                                                           RiskAppetiteStatement.status == "approved"):
        previous.status = "superseded"
    s.status, s.approved_by, s.approved_at = "approved", current_user.id, now
    s.limits = limits_snapshot(db, s.tenant_id)
    s.effective_from = _naive_utc(body.effective_from) or now
    s.approval_note = (body.note or "").strip() or None
    db.commit()
    return _statement_out(db, s)


@router.post("/statements/{statement_id}/reject", dependencies=CAN_EDIT)
def reject_statement(statement_id: int, body: NoteBody, current_user: GRCUser = Depends(require_auth),
                     db: Session = Depends(get_db)):
    """Send the version back to draft, with the reason."""
    note = _required(body.note, "reason for sending it back")
    s = _get(db, RiskAppetiteStatement, statement_id, current_user, "pending_approval")
    s.status, s.approval_note = "draft", note
    db.commit()
    return _statement_out(db, s)


# ── Breach log: plan, then a second person's decision ────────────────────────────────────────────────────────────
class ExcessBody(BaseModel):
    expires_at: datetime
    note: Optional[str] = None


def _breach_out(db: Session, rows: List[RiskAppetiteBreach], user: GRCUser) -> List[dict]:
    """Rows with what breached, who planned and decided, days open, and whether this user may propose a plan (a risk
    editor, or the risk's owner, the KRI's owner or the category's escalation owner)."""
    risks = {r.id: r for r in db.query(Risk.id, Risk.title, Risk.owner_id).filter(Risk.id.in_({b.risk_id for b in rows if b.risk_id}))}
    kris = {k.id: k for k in db.query(RiskKRI.id, RiskKRI.name, RiskKRI.owner_id).filter(RiskKRI.id.in_({b.kri_id for b in rows if b.kri_id}))}
    escalation = dict(db.query(RiskAppetiteConfig.category, RiskAppetiteConfig.escalation_owner_id).filter(
        RiskAppetiteConfig.tenant_id.in_({b.tenant_id for b in rows})))
    names = _names(db, [u for b in rows for u in (b.plan_by, b.decided_by)])
    editor, now, out = has_tenant_permission(db, user, *EDIT_PERMISSIONS), datetime.utcnow(), []
    for b in rows:
        risk, kri = risks.get(b.risk_id), kris.get(b.kri_id)
        owners = {getattr(risk, "owner_id", None), getattr(kri, "owner_id", None), escalation.get(b.category)}
        out.append({**_row(b), "risk_title": getattr(risk, "title", None), "kri_name": getattr(kri, "name", None),
                    "plan_by_name": names.get(b.plan_by), "decided_by_name": names.get(b.decided_by),
                    "days_open": ((b.resolved_at or now) - b.detected_at).days if b.detected_at else 0,
                    "can_plan": editor or user.id in owners})
    return out


@router.get("/breach-log")
def get_breach_log(current_user: GRCUser = Depends(require_auth), db: Session = Depends(get_db)):
    """The breach log, brought up to date first: open breaches (oldest first), then the latest resolved ones."""
    tenant_ids = get_user_tenants(current_user, db)
    check_appetite(db, tenant_ids)
    db.commit()
    query = db.query(RiskAppetiteBreach).filter(RiskAppetiteBreach.tenant_id.in_(tenant_ids))
    active = query.filter(RiskAppetiteBreach.status != "resolved").order_by(RiskAppetiteBreach.detected_at).all()
    resolved = query.filter(RiskAppetiteBreach.status == "resolved").order_by(
        RiskAppetiteBreach.resolved_at.desc()).limit(RESOLVED_SHOWN).all()
    return _breach_out(db, active + resolved, current_user)


@router.post("/check")
def run_appetite_check(current_user: GRCUser = Depends(require_auth), db: Session = Depends(get_db)):
    """Re-check every category now: {opened, resolved, reopened}."""
    counts = check_appetite(db, get_user_tenants(current_user, db))
    db.commit()
    return counts


@router.post("/breaches/{breach_id}/plan")
def propose_plan(breach_id: int, body: TextBody, current_user: GRCUser = Depends(require_auth), db: Session = Depends(get_db)):
    """Propose (or revise) the plan to bring this back within appetite."""
    breach = _get(db, RiskAppetiteBreach, breach_id, current_user, "open", "plan_proposed")
    if not _breach_out(db, [breach], current_user)[0]["can_plan"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="The risk or KRI owner, the escalation owner or a risk editor proposes the plan.")
    breach.plan = _required(body.plan, "plan")
    breach.plan_by, breach.plan_at, breach.status = current_user.id, datetime.utcnow(), "plan_proposed"
    db.commit()
    label = _label(breach.category)
    notify(db, breach.tenant_id, permission_holders(db, breach.tenant_id, EDIT_PERMISSIONS),
           f"Appetite breach plan to decide: {label}",
           f"A plan to bring a {label} breach back within appetite waits for your decision.", "/erm/appetite",
           actor_id=current_user.id)
    return _breach_out(db, [breach], current_user)[0]


def _label(category: str) -> str:
    return category.replace("_", " ").title()


DECIDED = {"plan_approved": "approved", "excess_approved": "approved as a time-limited excess", "open": "sent back"}


def _decide(db: Session, breach: RiskAppetiteBreach, user: GRCUser, outcome: str, note: Optional[str]) -> dict:
    breach.status, breach.decided_by, breach.decided_at = outcome, user.id, datetime.utcnow()
    breach.decision_note = (note or "").strip() or None
    db.commit()
    label = _label(breach.category)
    notify(db, breach.tenant_id, [breach.plan_by], f"Appetite breach plan {DECIDED[outcome]}: {label}",
           f"Your plan for the {label} breach was {DECIDED[outcome]}."
           + (f" Note: {breach.decision_note}" if breach.decision_note else ""), "/erm/appetite", actor_id=user.id)
    return _breach_out(db, [breach], user)[0]


@router.post("/breaches/{breach_id}/reject-plan", dependencies=CAN_EDIT)
def reject_plan(breach_id: int, body: NoteBody, current_user: GRCUser = Depends(require_auth), db: Session = Depends(get_db)):
    """Send the proposed plan back with the reason (not by its author): the breach is open again for a better plan."""
    note = _required(body.note, "reason for sending the plan back")
    breach = _get(db, RiskAppetiteBreach, breach_id, current_user, "plan_proposed")
    ensure_independent(breach.plan_by, current_user, "send back this plan")
    return _decide(db, breach, current_user, "open", note)


@router.post("/breaches/{breach_id}/approve-plan", dependencies=CAN_EDIT)
def approve_plan(breach_id: int, body: NoteBody, current_user: GRCUser = Depends(require_auth), db: Session = Depends(get_db)):
    """Approve the proposed plan (not by its author). The breach resolves itself once back within limit."""
    breach = _get(db, RiskAppetiteBreach, breach_id, current_user, "plan_proposed")
    ensure_independent(breach.plan_by, current_user, "approve this plan")
    return _decide(db, breach, current_user, "plan_approved", body.note)


@router.post("/breaches/{breach_id}/approve-excess", dependencies=CAN_EDIT)
def approve_excess(breach_id: int, body: ExcessBody, current_user: GRCUser = Depends(require_auth),
                   db: Session = Depends(get_db)):
    """Allow the excess until a date at most six months away (not by the plan's author). It reopens when it lapses."""
    breach = _get(db, RiskAppetiteBreach, breach_id, current_user, "plan_proposed", "plan_approved")
    ensure_independent(breach.plan_by, current_user, "approve this excess")
    note = _required(body.note, "reason for allowing the excess")
    expires, now = _naive_utc(body.expires_at), datetime.utcnow()
    if not now < expires <= now + timedelta(days=EXCESS_MAX_DAYS):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="An excess runs out on a future date within six months.")
    breach.excess_expires_at = expires
    return _decide(db, breach, current_user, "excess_approved", note)


@router.post("", response_model=RiskAppetiteConfigResponse, dependencies=CAN_CREATE)
def create_appetite_config(
    config: RiskAppetiteConfigCreate,
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db)
):
    """Create a new risk appetite configuration in the user's own tenant (a tenant_id the client sends is ignored)"""
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    existing = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.tenant_id == tenant_id,
        RiskAppetiteConfig.category == config.category
    ).first()
    from ....routers.auth_router import refuse_imported_accounts
    refuse_imported_accounts(db, [config.escalation_owner_id], kept=[existing.escalation_owner_id] if existing else [])
    
    if existing:
        # Upsert: update existing config (its limits through _limit_write)
        proposed = _limit_write(db, existing, {"appetite_level": config.appetite_level,
                                               "max_acceptable_score": config.max_acceptable_score,
                                               "tolerance_threshold": config.tolerance_threshold,
                                               "escalation_owner_id": config.escalation_owner_id}, current_user)
        existing.alert_enabled = config.alert_enabled
        existing.description = config.description
        db.commit()
        _tell_limit_approvers(db, existing, proposed, current_user)
        db.refresh(existing)
        return existing
    
    db_config = RiskAppetiteConfig(
        tenant_id=tenant_id,
        category=config.category,
        appetite_level=config.appetite_level,
        max_acceptable_score=config.max_acceptable_score,
        tolerance_threshold=config.tolerance_threshold,
        escalation_owner_id=config.escalation_owner_id,
        alert_enabled=config.alert_enabled,
        description=config.description
    )
    
    db.add(db_config)
    proposed = _propose_new_limit(db, db_config, current_user)
    db.commit()
    _tell_limit_approvers(db, db_config, proposed, current_user)
    db.refresh(db_config)
    
    return db_config


@router.put("/{config_id}", response_model=RiskAppetiteConfigResponse, dependencies=CAN_EDIT)
def update_appetite_config(
    config_id: int,
    config_update: RiskAppetiteConfigUpdate,
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db)
):
    """Update a risk appetite configuration"""
    tenant_ids = get_user_tenants(current_user, db)
    
    db_config = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.id == config_id,
        RiskAppetiteConfig.tenant_id.in_(tenant_ids)
    ).first()
    
    if not db_config:
        raise HTTPException(status_code=404, detail="Appetite config not found")
    
    update_data = config_update.model_dump(exclude_unset=True)
    from ....routers.auth_router import refuse_imported_accounts
    refuse_imported_accounts(db, [update_data.get("escalation_owner_id")], kept=[db_config.escalation_owner_id])
    proposed = _limit_write(db, db_config, {k: update_data.pop(k) for k in LIMIT_FIELDS if k in update_data}, current_user)
    for key, value in update_data.items():
        setattr(db_config, key, value)
    check_appetite(db, [db_config.tenant_id], [db_config.category])     # a new tolerance can open or close breaches

    db.commit()
    _tell_limit_approvers(db, db_config, proposed, current_user)
    db.refresh(db_config)

    return db_config


def _limit_write(db: Session, config: RiskAppetiteConfig, sent: dict, user: GRCUser) -> dict:
    """Limits change at once until a statement version is approved; after that the change is proposed and the limits in
    force stay until someone else approves it. Returns what was proposed (empty when applied or nothing changed)."""
    if approved_statement(db, config.tenant_id) is None:
        for key, value in sent.items():
            setattr(config, key, value)
        return {}
    if (config.tolerance_threshold is None and sent.get("tolerance_threshold") == config.max_acceptable_score
            and sent.get("max_acceptable_score", config.max_acceptable_score) == config.max_acceptable_score):
        sent = {k: v for k, v in sent.items() if k != "tolerance_threshold"}   # the page shows the max as the tolerance
    proposed = changed(config, sent)
    if proposed:
        propose(config, "limit_change", proposed, user)
    return proposed


def _tell_limit_approvers(db: Session, config: RiskAppetiteConfig, proposed: dict, user: GRCUser) -> None:
    if proposed:
        label = _label(config.category)
        notify(db, config.tenant_id, permission_holders(db, config.tenant_id, EDIT_PERMISSIONS),
               f"Appetite limit change to approve: {label}",
               f"A change to the {label} limits waits for your approval. The approved limits stay in force until then.",
               "/erm/appetite", actor_id=user.id)


def _decide_limits(db: Session, config_id: int, user: GRCUser, approve: bool, note: Optional[str]) -> dict:
    """Approve (apply, or remove the limit) or send back the category's pending limit change, not by its proposer; the
    breach log follows at once and the proposer is told."""
    config = db.query(RiskAppetiteConfig).filter(RiskAppetiteConfig.id == config_id,
                                                 RiskAppetiteConfig.tenant_id.in_(get_user_tenants(user, db))).first()
    if not config:
        raise HTTPException(status_code=404, detail="Appetite config not found")
    changes = decide(config, "limit_change", user, approve, note, "limit change")
    change, tenant_id, category = config.limit_change, config.tenant_id, config.category
    added = bool(changes.get("add"))
    removed = (approve and bool(changes.get("remove"))) or (added and not approve)
    if removed:
        db.delete(config)       # its open breaches resolve below: the category has no limit now
    elif approve:
        for key, value in changes.items():
            if key in LIMIT_FIELDS:
                setattr(config, key, value)
    if approve:
        check_appetite(db, [tenant_id], [category])
    db.commit()
    label = _label(category)
    notify(db, tenant_id, [change.get("proposed_by")], f"Appetite limit change {'approved' if approve else 'sent back'}: {label}",
           f"Your change to the {label} limits was {'approved and is in force' if approve else 'sent back'}."
           + (f" Note: {change['note']}" if change.get("note") else ""), "/erm/appetite", actor_id=user.id)
    return {"id": config_id, "category": category, "limit_change": change, "removed": removed}


@router.post("/{config_id}/limit-change/approve", dependencies=CAN_EDIT)
def approve_limit_change(config_id: int, body: NoteBody, current_user: GRCUser = Depends(require_auth),
                         db: Session = Depends(get_db)):
    return _decide_limits(db, config_id, current_user, True, body.note)


@router.post("/{config_id}/limit-change/reject", dependencies=CAN_EDIT)
def reject_limit_change(config_id: int, body: NoteBody, current_user: GRCUser = Depends(require_auth),
                        db: Session = Depends(get_db)):
    return _decide_limits(db, config_id, current_user, False, body.note)


class LimitKRIsBody(BaseModel):
    kri_ids: List[int]


@router.put("/{config_id}/kris", dependencies=CAN_EDIT)
def set_limit_kris(config_id: int, body: LimitKRIsBody, current_user: GRCUser = Depends(require_auth),
                   db: Session = Depends(get_db)):
    """Replace the KRIs that measure this category's limit (the tenant's own KRIs only)."""
    config = db.query(RiskAppetiteConfig).filter(RiskAppetiteConfig.id == config_id,
                                                 RiskAppetiteConfig.tenant_id.in_(get_user_tenants(current_user, db))).first()
    if not config:
        raise HTTPException(status_code=404, detail="Appetite config not found")
    ids = list(dict.fromkeys(body.kri_ids))
    found = {k for (k,) in db.query(RiskKRI.id).filter(RiskKRI.id.in_(ids), RiskKRI.tenant_id == config.tenant_id)} if ids else set()
    if set(ids) - found:
        raise HTTPException(status_code=404, detail="KRI not found")
    proposed = _limit_write(db, config, {"limit_kri_ids": ids}, current_user)
    check_appetite(db, [config.tenant_id], [config.category])
    db.commit()
    _tell_limit_approvers(db, config, proposed, current_user)
    return {"id": config.id, "limit_kri_ids": config.limit_kri_ids or [], "limit_change": config.limit_change}


@router.delete("/{config_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=CAN_DELETE)
def delete_appetite_config(
    config_id: int,
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db)
):
    """Delete a risk appetite configuration"""
    tenant_ids = get_user_tenants(current_user, db)

    db_config = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.id == config_id,
        RiskAppetiteConfig.tenant_id.in_(tenant_ids)
    ).first()

    if not db_config:
        raise HTTPException(status_code=404, detail="Appetite config not found")
    if approved_statement(db, db_config.tenant_id) is not None:     # an approved limit goes only with a second person's approval
        propose(db_config, "limit_change", {"remove": True}, current_user)
        db.commit()
        _tell_limit_approvers(db, db_config, {"remove": True}, current_user)
        return JSONResponse(status_code=status.HTTP_202_ACCEPTED, content={
            "detail": "Removing this limit waits for someone else's approval.", "limit_change": db_config.limit_change})

    db.delete(db_config)
    db.commit()


@router.post("/seed-defaults", dependencies=CAN_CREATE)
def seed_default_appetite_configs(
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db)
):
    """Seed default appetite configurations for all categories, in the user's own tenant (a client tenant_id is ignored)"""
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    tenant_id = get_user_primary_tenant(current_user, db) or tenant_ids[0]
    
    created, proposed_any = [], False
    
    for category in RISK_CATEGORIES:
        existing = db.query(RiskAppetiteConfig).filter(
            RiskAppetiteConfig.tenant_id == tenant_id,
            RiskAppetiteConfig.category == category
        ).first()
        
        if not existing:
            db_config = RiskAppetiteConfig(
                tenant_id=tenant_id,
                category=category,
                appetite_level="moderate",
                max_acceptable_score=15.0,
                tolerance_threshold=15.0,
                alert_enabled=True,
                description=f"Default appetite configuration for {category} risks"
            )
            db.add(db_config)
            if _propose_new_limit(db, db_config, current_user):
                proposed_any = True
            created.append(category)
    
    db.commit()
    if proposed_any:
        notify(db, tenant_id, permission_holders(db, tenant_id, EDIT_PERMISSIONS), "Default appetite limits to approve",
               f"{len(created)} default limits wait for your approval. They are not in force until then.",
               "/erm/appetite", actor_id=current_user.id)
    
    return {
        "message": f"Created appetite configs for {len(created)} categories",
        "created_categories": created
    }


class AppetiteAISuggestRequest(BaseModel):
    category: str
    description: Optional[str] = None


class AppetiteAISuggestResponse(BaseModel):
    category: str
    appetite_level: str
    tolerance_threshold: float
    max_acceptable_score: float
    description: str
    escalation_criteria: str
    rationale: str


def get_openai_client():
    from openai import OpenAI
    api_key = get_openai_api_key()
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    is_modelfarm = base_url and "modelfarm" in base_url
    if not api_key and not is_modelfarm:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI features unavailable. OpenAI API key not configured."
        )
    if not is_modelfarm and (api_key.startswith("_DUMMY") or api_key == "your-api-key-here" or len(api_key) < 20):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI features unavailable. OpenAI API key not configured."
        )
    return OpenAI(
        api_key=api_key,
        base_url=base_url
    )


APPETITE_AI_PROMPT = """You are an expert Enterprise Risk Management (ERM) consultant specializing in risk appetite frameworks. Based on industry best practices (ISO 31000, COSO ERM, Basel III), suggest appropriate risk appetite thresholds for the given risk category.

RISK CATEGORY: {category}
{description_section}

APPETITE LEVELS (from most conservative to most aggressive):
- averse: Organization avoids this risk entirely (score 1)
- minimal: Organization accepts minimal exposure (score 2)
- cautious: Organization prefers low-risk options (score 3)
- moderate: Organization balances risk and reward (score 4)
- open: Organization is willing to accept higher risk for potential returns (score 5)
- hungry: Organization actively seeks this risk for competitive advantage (score 6)

SCORING: Risk scores range from 1-25 (likelihood 1-5 × impact 1-5).

Respond ONLY with valid JSON (no markdown, no explanation outside JSON):
{{
  "appetite_level": "<one of: averse, minimal, cautious, moderate, open, hungry>",
  "tolerance_threshold": <number between 1 and 25>,
  "max_acceptable_score": <number between 1 and 25>,
  "description": "<2-3 sentence description of the appetite stance for this category>",
  "escalation_criteria": "<when should risks in this category be escalated to senior management>",
  "rationale": "<brief rationale for why these thresholds are appropriate based on industry best practices>"
}}"""


@router.post("/ai-suggest", response_model=AppetiteAISuggestResponse, dependencies=[Depends(require_tenant_permission(
    "risks:risk_appetite:create", "erm:risks:create", *EDIT_PERMISSIONS))])  # AI budget: writers only
def ai_suggest_appetite(
    request: AppetiteAISuggestRequest,
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db)
):
    client = get_openai_client()

    description_section = ""
    if request.description:
        description_section = f"ADDITIONAL CONTEXT: {request.description}"

    prompt = APPETITE_AI_PROMPT.format(
        category=request.category,
        description_section=description_section
    )

    try:
        response = client.chat.completions.create(
            model=os.environ.get("AI_INTEGRATIONS_OPENAI_MODEL", "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": "You are an enterprise risk management expert. Respond only with valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=500
        )

        response_text = response.choices[0].message.content.strip()
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]

        result = json.loads(response_text.strip())
        result["category"] = request.category

        if result.get("appetite_level") not in APPETITE_LEVELS:
            result["appetite_level"] = "moderate"
        if not isinstance(result.get("tolerance_threshold"), (int, float)) or not (1 <= result["tolerance_threshold"] <= 25):
            result["tolerance_threshold"] = 15.0
        if not isinstance(result.get("max_acceptable_score"), (int, float)) or not (1 <= result["max_acceptable_score"] <= 25):
            result["max_acceptable_score"] = 12.0

        return result

    except json.JSONDecodeError:
        return {
            "category": request.category,
            "appetite_level": "moderate",
            "tolerance_threshold": 15.0,
            "max_acceptable_score": 12.0,
            "description": f"Default moderate appetite for {request.category} risks. Organization balances risk and reward.",
            "escalation_criteria": "Escalate when risk score exceeds tolerance threshold or when multiple risks in this category breach limits simultaneously.",
            "rationale": "AI response could not be parsed. Default moderate values applied based on general best practices."
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI suggestion failed: {str(e)}"
        )
