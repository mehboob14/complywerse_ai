"""The potential risks of a policy exception, recorded by the people asked at its review and approval steps (DECISIONS D62).

A person asked at the open step of an exception that goes through a rule records what could go wrong: several risks, each with a likelihood
and an impact (1 to 5), a rating from them in the risk register's own bands, a note, and optionally the register entry it is the same as.
A person who found none says so, and that is a row too: **an approval needs the approver's own assessment, at least one risk or "none identified"**
(``require_assessment``, switched by ``REQUIRE_ASSESSMENT``). Earlier steps' risks stay visible to later steps and to the implementer, and are
kept for every round. Without a rule (the older flow: anyone allowed to approve decides) a person allowed to approve may record risks too, but
nothing is required of them.

Functions that write only ``flush``: the caller commits. The rows themselves (who, which step, when) are the record; nothing is added to the comments.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ...models import ExceptionApprovalRun, ExceptionRisk, GRCUser, LikelihoodImpactScale, PolicyException, Risk
from ...models._11_enterprise_risk_management import risk_priority_for_score
from . import exception_approvals as A

REQUIRE_ASSESSMENT = True
LEVELS = (1, 2, 3, 4, 5)
TITLE_MAX = 500
NOTE_MAX = 4000
RATING_LABEL = {"low": "Low", "medium": "Medium", "high": "High", "critical": "Critical"}
NEEDS_ASSESSMENT = "Record at least one potential risk, or say that you found none, before you approve."
NOT_YOUR_STEP = "Only the people asked at the open step can record potential risks for this exception."
CLOSED = "That step is closed: its potential risks are kept as they were."


def _problem(detail: str, code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


# ── ratings ──────────────────────────────────────────────────────────────────
def score_and_rating(likelihood: Optional[int], impact: Optional[int]):
    """(likelihood x impact, its band) when both are given, else (None, None): the register's bands (``risk_priority_for_score``)."""
    if likelihood is None or impact is None:
        return None, None
    score = int(likelihood) * int(impact)
    return score, risk_priority_for_score(score)


def level_labels(db: Session, tenant_id: int) -> Dict[str, Dict[int, str]]:
    """What the organisation calls each level of likelihood and impact, when it has set its own scales (Risk Management > Scales)."""
    out: Dict[str, Dict[int, str]] = {"likelihood": {}, "impact": {}}
    for row in db.query(LikelihoodImpactScale).filter(LikelihoodImpactScale.tenant_id == tenant_id):
        if row.scale_type in out:
            out[row.scale_type][int(row.level)] = row.label
    return out


def _level(value: Any, what: str) -> Optional[int]:
    if value in (None, ""):
        return None
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise _problem(f"The {what} is a number from 1 to 5.") from None
    if n not in LEVELS:
        raise _problem(f"The {what} is a number from 1 to 5.")
    return n


# ── who may record, and where ────────────────────────────────────────────────
def context(db: Session, exc: PolicyException, user: GRCUser, older_flow_decider: bool = False) -> Optional[Dict[str, Any]]:
    """Where the person may record potential risks now: the open step they are asked at (``run``, ``step``), or, for an exception no rule
    governs, the plain "pending approval" for someone allowed to approve who is not the requester (``older_flow_decider``, which the caller
    works out from the person's rights). None: they may not."""
    run = A.open_run(db, exc)
    if run is not None:
        step = A._step(run, run.current_step)
        if step is not None and user.id in (run.asked or []) and exc.requested_by != user.id:
            return {"run": run, "step": step, "round": run.round, "position": step["position"], "name": step["name"], "kind": step["kind"]}
        return None
    if exc.status == "pending_approval" and older_flow_decider and exc.requested_by != user.id:
        return {"run": None, "step": None, "round": None, "position": None, "name": None, "kind": "approval"}
    return None


def _mine_at(db: Session, exc_id: int, run_id: Optional[int], position: Optional[int], user_id: int) -> List[ExceptionRisk]:
    q = db.query(ExceptionRisk).filter(ExceptionRisk.exception_id == exc_id, ExceptionRisk.recorded_by == user_id,
                                       ExceptionRisk.step_position == position)
    q = q.filter(ExceptionRisk.run_id == run_id) if run_id is not None else q.filter(ExceptionRisk.run_id.is_(None))
    return q.order_by(ExceptionRisk.id).all()


def assessment_for(db: Session, run_id: Optional[int], exc_id: int, position: Optional[int], user_id: int) -> Dict[str, Any]:
    """What the person has recorded at a step: ``{recorded, none_identified, count}`` (``count`` is the real risks)."""
    rows = _mine_at(db, exc_id, run_id, position, user_id)
    real = [r for r in rows if not r.none_identified]
    return {"recorded": bool(rows), "none_identified": any(r.none_identified for r in rows), "count": len(real)}


def require_assessment(db: Session, run: ExceptionApprovalRun, step: Dict[str, Any], user: GRCUser) -> None:
    """Refuses an approval from someone who has not said what could go wrong at this step (or that nothing could)."""
    if not REQUIRE_ASSESSMENT:
        return
    if not assessment_for(db, run.id, run.exception_id, step["position"], user.id)["recorded"]:
        raise _problem(NEEDS_ASSESSMENT)


# ── reading ──────────────────────────────────────────────────────────────────
def view(r: ExceptionRisk, names: Dict[int, str], viewer_id: Optional[int], editable: bool, labels: Dict[str, Dict[int, str]]) -> Dict[str, Any]:
    return {"id": r.id, "round": r.round, "step_position": r.step_position, "step_name": r.step_name, "step_kind": r.step_kind,
            "recorded_by": {"id": r.recorded_by, "name": names.get(r.recorded_by, f"User #{r.recorded_by}")},
            "title": r.title, "description": r.description, "likelihood": r.likelihood, "impact": r.impact, "score": r.score,
            "rating": r.rating, "rating_label": RATING_LABEL.get(r.rating or ""),
            "likelihood_label": labels["likelihood"].get(r.likelihood) if r.likelihood else None,
            "impact_label": labels["impact"].get(r.impact) if r.impact else None,
            "none_identified": bool(r.none_identified), "register_risk_id": r.register_risk_id, "source": r.source or "manual",
            "created_at": _iso(r.created_at), "mine": r.recorded_by == viewer_id, "can_edit": editable and r.recorded_by == viewer_id}


def rows_of(db: Session, exc_id: int) -> List[ExceptionRisk]:
    return db.query(ExceptionRisk).filter(ExceptionRisk.exception_id == exc_id).order_by(ExceptionRisk.round, ExceptionRisk.step_position, ExceptionRisk.id).all()


def _editable(db: Session, exc: PolicyException, r: ExceptionRisk, user: GRCUser, older_flow_decider: bool) -> bool:
    """A risk can still be changed by its author while the step it was recorded at is the open one."""
    if r.recorded_by != user.id or exc.status != "pending_approval":
        return False
    ctx = context(db, exc, user, older_flow_decider)
    return ctx is not None and ctx["position"] == r.step_position and (ctx["run"].id if ctx["run"] is not None else None) == r.run_id


def listing(db: Session, exc: PolicyException, user: GRCUser, older_flow_decider: bool = False) -> Dict[str, Any]:
    """``{risks, my_turn}`` for the risks panel."""
    rows = rows_of(db, exc.id)
    names = A._names(db, {r.recorded_by for r in rows})
    labels = level_labels(db, exc.tenant_id)
    ctx = context(db, exc, user, older_flow_decider)
    out = []
    for r in rows:
        mine_open = ctx is not None and r.recorded_by == user.id and ctx["position"] == r.step_position and \
            (ctx["run"].id if ctx["run"] is not None else None) == r.run_id
        out.append(view(r, names, user.id, mine_open, labels))
    turn = None
    if ctx is not None:
        have = assessment_for(db, ctx["run"].id if ctx["run"] is not None else None, exc.id, ctx["position"], user.id)
        turn = {"round": ctx["round"], "step_position": ctx["position"], "step_name": ctx["name"], "kind": ctx["kind"],
                "recorded": have["recorded"], "none_identified": have["none_identified"]}
    return {"risks": out, "my_turn": turn}


def count_real(db: Session, exc_id: int) -> int:
    return db.query(ExceptionRisk.id).filter(ExceptionRisk.exception_id == exc_id, ExceptionRisk.none_identified.is_(False)).count()


def counts_for(db: Session, exception_ids: Iterable[int]) -> Dict[int, int]:
    """exception id -> its real potential risks, for many at once."""
    ids = list(exception_ids)
    if not ids:
        return {}
    out: Dict[int, int] = {}
    for (eid,) in db.query(ExceptionRisk.exception_id).filter(ExceptionRisk.exception_id.in_(ids), ExceptionRisk.none_identified.is_(False)):
        out[eid] = out.get(eid, 0) + 1
    return out


# ── writing ──────────────────────────────────────────────────────────────────
def _clean(payload: Dict[str, Any], partial: bool = False) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    if not partial or "title" in payload:
        title = str(payload.get("title") or "").strip()
        if not title and not payload.get("none_identified"):
            raise _problem("Say what could go wrong.")
        if len(title) > TITLE_MAX:
            raise _problem(f"What could go wrong is at most {TITLE_MAX} characters.")
        out["title"] = title or None
    if not partial or "description" in payload:
        note = str(payload.get("description") or "").strip()
        if len(note) > NOTE_MAX:
            raise _problem(f"The note is at most {NOTE_MAX} characters.")
        out["description"] = note or None
    for field, what in (("likelihood", "likelihood"), ("impact", "impact")):
        if not partial or field in payload:
            out[field] = _level(payload.get(field), what)
    return out


def add(db: Session, exc: PolicyException, user: GRCUser, payload: Dict[str, Any], older_flow_decider: bool = False) -> ExceptionRisk:
    """Record a potential risk (or "none identified") at the step the person is asked at."""
    ctx = context(db, exc, user, older_flow_decider)
    if ctx is None:
        raise _problem(NOT_YOUR_STEP, status.HTTP_403_FORBIDDEN)
    run_id = ctx["run"].id if ctx["run"] is not None else None
    none = bool(payload.get("none_identified"))
    mine = _mine_at(db, exc.id, run_id, ctx["position"], user.id)
    now = datetime.utcnow()
    if none:
        if any(not r.none_identified for r in mine):
            raise _problem("You recorded potential risks at this step: remove them first to say you found none.", status.HTTP_409_CONFLICT)
        if any(r.none_identified for r in mine):
            return next(r for r in mine if r.none_identified)
        fields = {"title": None, "description": str(payload.get("description") or "").strip()[:NOTE_MAX] or None, "likelihood": None, "impact": None}
    else:
        fields = _clean({**payload, "none_identified": False})
        for r in mine:                                      # a real risk replaces the person's "none identified" at this step
            if r.none_identified:
                db.delete(r)
    score, rating = score_and_rating(fields["likelihood"], fields["impact"])
    row = ExceptionRisk(tenant_id=exc.tenant_id, exception_id=exc.id, run_id=run_id, round=ctx["round"], step_position=ctx["position"],
                        step_name=ctx["name"], step_kind=ctx["kind"], recorded_by=user.id, none_identified=none, score=score, rating=rating,
                        source="ai" if payload.get("source") == "ai" else "manual", created_at=now, updated_at=now, **fields)
    db.add(row)
    db.flush()
    return row


def _own(db: Session, exc: PolicyException, rid: int) -> ExceptionRisk:
    row = db.query(ExceptionRisk).filter(ExceptionRisk.id == rid, ExceptionRisk.exception_id == exc.id).first()
    if row is None:
        raise _problem("Potential risk not found.", status.HTTP_404_NOT_FOUND)
    return row


def _may_change(db: Session, exc: PolicyException, row: ExceptionRisk, user: GRCUser, older_flow_decider: bool) -> None:
    if row.recorded_by != user.id:
        raise _problem("Only the person who recorded a potential risk can change or remove it.", status.HTTP_403_FORBIDDEN)
    if not _editable(db, exc, row, user, older_flow_decider):
        raise _problem(CLOSED, status.HTTP_409_CONFLICT)


def update(db: Session, exc: PolicyException, user: GRCUser, rid: int, payload: Dict[str, Any], older_flow_decider: bool = False) -> ExceptionRisk:
    row = _own(db, exc, rid)
    _may_change(db, exc, row, user, older_flow_decider)
    if row.none_identified:
        raise _problem("That says you found none: remove it to record a risk.", status.HTTP_409_CONFLICT)
    fields = _clean(payload, partial=True)
    for key, value in fields.items():
        setattr(row, key, value)
    row.score, row.rating = score_and_rating(row.likelihood, row.impact)
    row.updated_at = datetime.utcnow()
    db.flush()
    return row


def delete(db: Session, exc: PolicyException, user: GRCUser, rid: int, older_flow_decider: bool = False) -> None:
    row = _own(db, exc, rid)
    _may_change(db, exc, row, user, older_flow_decider)
    db.delete(row)
    db.flush()


def link_register(db: Session, exc: PolicyException, user: GRCUser, rid: int, register_risk_id: Optional[int], older_flow_decider: bool = False) -> ExceptionRisk:
    """Link a potential risk to an entry of the risk register (or unlink it with None). The entry has to exist in this organisation."""
    row = _own(db, exc, rid)
    _may_change(db, exc, row, user, older_flow_decider)
    if row.none_identified:
        raise _problem("That says you found none: there is nothing to link.", status.HTTP_409_CONFLICT)
    if register_risk_id in (None, "", 0):
        row.register_risk_id = None
    else:
        try:
            wanted = int(register_risk_id)
        except (TypeError, ValueError):
            raise _problem("The register entry chosen does not exist.") from None
        if db.query(Risk.id).filter(Risk.id == wanted, Risk.tenant_id == exc.tenant_id).first() is None:
            raise _problem("The register entry chosen does not exist.")
        row.register_risk_id = wanted
    row.updated_at = datetime.utcnow()
    db.flush()
    return row


def register_text(db: Session, exc: PolicyException) -> Optional[str]:
    """The potential risks as lines of text for the register entry "Move to risk register" makes, or None when none were recorded."""
    rows = [r for r in rows_of(db, exc.id) if not r.none_identified and r.title]
    if not rows:
        return None
    return "\n".join(f"{i}. {r.title}" + (f" ({RATING_LABEL.get(r.rating or '', '').lower()} rating)" if r.rating else "") for i, r in enumerate(rows, 1))
