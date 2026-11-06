"""The implementation of an approved exception: the compensating controls its implementer records, and marking it implemented (DECISIONS D62).

When the last approval is given under a rule that has an implementer, ``exception_approvals.open_implementation`` asks the implementer(s): any
one of them can act. They see everything the approvers saw, the potential risks included, and record **compensating controls**: what covers
the gap, which potential risks and which assets of the exception it is for, who owns it, by when, whether it is planned or in place, and its
evidence (a link, or an item of the Evidence library). The first control moves the implementation from ``waiting`` to ``in_progress``;
**Mark implemented** needs at least one control, and potential risks that no control covers need the person's confirmation. The exception's
``status`` is never touched: approved stays approved (the library, At a glance and the posture figures keep their meaning).

Functions that write only ``flush``: the caller commits. The rows are the record; only marking it implemented leaves a line in the exception's comments.
"""
from __future__ import annotations

import copy
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ...models import Evidence, ExceptionApprovalRun, ExceptionControl, ExceptionRisk, GRCUser, PolicyException
from . import exception_approvals as A

TITLE_MAX = 500
NOTE_MAX = 4000
LABEL_MAX = 160
MAX_EVIDENCE = 20
STATUSES = ("planned", "in_place")
OPEN_STATES = ("waiting", "in_progress")
NOT_YOURS = "Only the people asked to implement this exception can record compensating controls."
CLOSED = "The implementation is finished: its compensating controls are kept as they were."
NONE_WAITING = "This exception has no implementation waiting."


def _problem(detail: str, code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


# ── the run that is being implemented ────────────────────────────────────────
def implementing_run(db: Session, exc: PolicyException) -> Optional[ExceptionApprovalRun]:
    """The run whose implementation is open (waiting or in progress)."""
    return db.query(ExceptionApprovalRun).filter(ExceptionApprovalRun.exception_id == exc.id, ExceptionApprovalRun.implementation_state.in_(OPEN_STATES)) \
        .order_by(ExceptionApprovalRun.round.desc()).first()


def shown_run(db: Session, exc: PolicyException) -> Optional[ExceptionApprovalRun]:
    """The run whose controls the panel shows: the open implementation, else the latest that had one."""
    return db.query(ExceptionApprovalRun).filter(ExceptionApprovalRun.exception_id == exc.id, ExceptionApprovalRun.implementation_state.isnot(None)) \
        .order_by(ExceptionApprovalRun.round.desc()).first()


def may_implement(db: Session, exc: PolicyException, user: GRCUser) -> Optional[ExceptionApprovalRun]:
    """The run being implemented when this person is one of the people asked; None otherwise."""
    run = implementing_run(db, exc)
    if run is not None and exc.status == "approved" and user.id in ((run.implementation or {}).get("asked") or []):
        return run
    return None


# ── reading ──────────────────────────────────────────────────────────────────
def controls_of(db: Session, exc: PolicyException, run: Optional[ExceptionApprovalRun] = None) -> List[ExceptionControl]:
    q = db.query(ExceptionControl).filter(ExceptionControl.exception_id == exc.id)
    if run is not None:
        q = q.filter(ExceptionControl.run_id == run.id)
    return q.order_by(ExceptionControl.id).all()


def risks_of(db: Session, exc: PolicyException, run: Optional[ExceptionApprovalRun]) -> List[ExceptionRisk]:
    """The real potential risks recorded in the round that is being implemented."""
    q = db.query(ExceptionRisk).filter(ExceptionRisk.exception_id == exc.id, ExceptionRisk.none_identified.is_(False))
    if run is not None:
        q = q.filter(ExceptionRisk.run_id == run.id)
    return q.order_by(ExceptionRisk.id).all()


def uncovered(risks: Iterable[ExceptionRisk], controls: Iterable[ExceptionControl]) -> List[ExceptionRisk]:
    """The potential risks no control lists as covered."""
    covered = {int(i) for c in controls for i in (c.risk_ids or [])}
    return [r for r in risks if r.id not in covered]


def view(c: ExceptionControl, names: Dict[int, str], evidence_names: Dict[int, str], editable: bool) -> Dict[str, Any]:
    evidence = []
    for e in c.evidence or []:
        if e.get("kind") == "evidence":
            evidence.append({"kind": "evidence", "evidence_id": e.get("evidence_id"), "label": evidence_names.get(e.get("evidence_id")) or e.get("label") or "Evidence"})
        else:
            evidence.append({"kind": "link", "url": e.get("url"), "label": e.get("label") or e.get("url")})
    return {"id": c.id, "title": c.title, "description": c.description, "risk_ids": [int(i) for i in c.risk_ids or []],
            "asset_ids": [int(i) for i in c.asset_ids or []],
            "owner": {"id": c.owner_id, "name": names.get(c.owner_id, f"User #{c.owner_id}")} if c.owner_id else None,
            "due_date": _iso(c.due_date), "status": c.status or "planned", "evidence": evidence,
            "created_by": {"id": c.created_by, "name": names.get(c.created_by, f"User #{c.created_by}")} if c.created_by else None,
            "source": c.source or "manual", "created_at": _iso(c.created_at), "can_edit": editable}


def listing(db: Session, exc: PolicyException, user: GRCUser) -> Dict[str, Any]:
    """``{controls, implementation, uncovered_risks}`` for the controls panel."""
    run = shown_run(db, exc)
    rows = controls_of(db, exc, run) if run is not None else []
    people = {c.owner_id for c in rows if c.owner_id} | {c.created_by for c in rows if c.created_by}
    names = A._names(db, people)
    ev_ids = {e.get("evidence_id") for c in rows for e in (c.evidence or []) if e.get("kind") == "evidence" and e.get("evidence_id")}
    ev_names = {i: n for i, n in db.query(Evidence.id, Evidence.name).filter(Evidence.id.in_(ev_ids), Evidence.tenant_id == exc.tenant_id)} if ev_ids else {}
    mine = may_implement(db, exc, user) is not None
    risks = risks_of(db, exc, run) if run is not None else []
    return {"controls": [view(c, names, ev_names, mine) for c in rows],
            "implementation": A.implementation_view(db, run, exc, user.id) if run is not None else None,
            "uncovered_risks": [{"id": r.id, "title": r.title} for r in uncovered(risks, rows)]}


def counts_for(db: Session, exception_ids: Iterable[int]) -> Dict[int, int]:
    ids = list(exception_ids)
    out: Dict[int, int] = {}
    if ids:
        for (eid,) in db.query(ExceptionControl.exception_id).filter(ExceptionControl.exception_id.in_(ids)):
            out[eid] = out.get(eid, 0) + 1
    return out


# ── writing ──────────────────────────────────────────────────────────────────
def _evidence(db: Session, exc: PolicyException, raw: Any) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for item in (raw or [])[:MAX_EVIDENCE]:
        kind = (item or {}).get("kind")
        label = str((item or {}).get("label") or "").strip()[:LABEL_MAX]
        if kind == "link":
            url = str(item.get("url") or "").strip()
            if not url.lower().startswith(("http://", "https://")) or len(url) > 1000:
                raise _problem("A link has to start with http:// or https://.")
            out.append({"kind": "link", "url": url, "label": label or url[:LABEL_MAX]})
        elif kind == "evidence":
            try:
                eid = int(item.get("evidence_id"))
            except (TypeError, ValueError):
                raise _problem("The evidence chosen does not exist.") from None
            row = db.query(Evidence.id, Evidence.name).filter(Evidence.id == eid, Evidence.tenant_id == exc.tenant_id).first()
            if row is None:
                raise _problem("The evidence chosen does not exist.")
            out.append({"kind": "evidence", "evidence_id": eid, "label": label or (row[1] or "Evidence")[:LABEL_MAX]})
        else:
            raise _problem("Evidence is a link or an item of the Evidence library.")
    return out


def _ids(raw: Any, allowed: Iterable[int], what: str) -> List[int]:
    allowed = set(allowed)
    out: List[int] = []
    sentence = f"{'An' if what[0] in 'aeiou' else 'A'} {what} chosen does not belong to this exception."
    for x in raw or []:
        try:
            i = int(x)
        except (TypeError, ValueError):
            raise _problem(sentence) from None
        if i not in allowed:
            raise _problem(sentence)
        if i not in out:
            out.append(i)
    return out


def _clean(db: Session, exc: PolicyException, run: ExceptionApprovalRun, payload: Dict[str, Any], partial: bool) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    if not partial or "title" in payload:
        title = str(payload.get("title") or "").strip()
        if not title:
            raise _problem("Say what the control is.")
        if len(title) > TITLE_MAX:
            raise _problem(f"The control's name is at most {TITLE_MAX} characters.")
        out["title"] = title
    if not partial or "description" in payload:
        text = str(payload.get("description") or "").strip()
        if len(text) > NOTE_MAX:
            raise _problem(f"The description is at most {NOTE_MAX} characters.")
        out["description"] = text or None
    if not partial or "risk_ids" in payload:
        out["risk_ids"] = _ids(payload.get("risk_ids"), (r.id for r in risks_of(db, exc, run)), "potential risk")
    if not partial or "asset_ids" in payload:
        out["asset_ids"] = _ids(payload.get("asset_ids"), exc.linked_asset_ids or [], "asset")
    if not partial or "owner_id" in payload:
        owner = payload.get("owner_id")
        if owner in (None, "", 0):
            out["owner_id"] = None
        else:
            try:
                owner = int(owner)
            except (TypeError, ValueError):
                raise _problem("The owner chosen does not exist.") from None
            if not A._people(db, [owner]):
                raise _problem("The owner chosen is not an active person of this platform.")
            out["owner_id"] = owner
    if not partial or "due_date" in payload:
        raw = payload.get("due_date")
        try:
            out["due_date"] = datetime.fromisoformat(str(raw)[:19]) if raw else None
        except ValueError:
            raise _problem("The due date is not a date.") from None
    if not partial or "status" in payload:
        state = payload.get("status") or "planned"
        if state not in STATUSES:
            raise _problem("A control is planned or in place.")
        out["status"] = state
    if "evidence" in payload:
        out["evidence"] = _evidence(db, exc, payload.get("evidence"))
    return out


def _open_for(db: Session, exc: PolicyException, user: GRCUser) -> ExceptionApprovalRun:
    run = may_implement(db, exc, user)
    if run is None:
        closed = shown_run(db, exc)
        if closed is not None and closed.implementation_state in ("done", "cancelled"):
            raise _problem(CLOSED, status.HTTP_409_CONFLICT)
        raise _problem(NOT_YOURS, status.HTTP_403_FORBIDDEN)
    return run


def add(db: Session, exc: PolicyException, user: GRCUser, payload: Dict[str, Any]) -> ExceptionControl:
    run = _open_for(db, exc, user)
    fields = _clean(db, exc, run, payload, partial=False)
    now = datetime.utcnow()
    row = ExceptionControl(tenant_id=exc.tenant_id, exception_id=exc.id, run_id=run.id, created_by=user.id, created_at=now, updated_at=now,
                           source="ai" if payload.get("source") == "ai" else "manual", evidence=fields.pop("evidence", []), **fields)
    db.add(row)
    if run.implementation_state == "waiting":
        run.implementation_state = "in_progress"
        run.updated_at = now
    db.flush()
    return row


def _row(db: Session, exc: PolicyException, cid: int) -> ExceptionControl:
    row = db.query(ExceptionControl).filter(ExceptionControl.id == cid, ExceptionControl.exception_id == exc.id).first()
    if row is None:
        raise _problem("Compensating control not found.", status.HTTP_404_NOT_FOUND)
    return row


def update(db: Session, exc: PolicyException, user: GRCUser, cid: int, payload: Dict[str, Any]) -> ExceptionControl:
    run = _open_for(db, exc, user)
    row = _row(db, exc, cid)
    fields = _clean(db, exc, run, payload, partial=True)
    for key, value in fields.items():
        setattr(row, key, value)
    row.updated_at = datetime.utcnow()
    db.flush()
    return row


def delete(db: Session, exc: PolicyException, user: GRCUser, cid: int) -> None:
    _open_for(db, exc, user)
    row = _row(db, exc, cid)
    db.delete(row)
    db.flush()


def complete(db: Session, exc: PolicyException, user: GRCUser, note: Optional[str] = None, confirm_uncovered: bool = False) -> ExceptionApprovalRun:
    """Mark the implementation done: needs a control; potential risks no control covers need ``confirm_uncovered``."""
    run = _open_for(db, exc, user)
    run = A._lock(db, ExceptionApprovalRun, run.id)
    if run.implementation_state not in OPEN_STATES:
        raise _problem(NONE_WAITING, status.HTTP_409_CONFLICT)
    controls = controls_of(db, exc, run)
    if not controls:
        raise _problem("Record at least one compensating control before you mark it implemented.")
    gaps = uncovered(risks_of(db, exc, run), controls)
    if gaps and not confirm_uncovered:
        shown = "; ".join((r.title or "")[:80] for r in gaps[:3]) + (f" and {len(gaps) - 3} more" if len(gaps) > 3 else "")
        raise _problem(f"{len(gaps)} potential {'risk has' if len(gaps) == 1 else 'risks have'} no compensating control: {shown}. Mark it implemented anyway?",
                       status.HTTP_409_CONFLICT)
    now = datetime.utcnow()
    impl = copy.deepcopy(run.implementation or {})
    impl.update({"completed_by": user.id, "completed_at": now.isoformat(), "note": (note or "").strip()[:NOTE_MAX] or None})
    run.implementation = impl
    flag_modified(run, "implementation")
    run.implementation_state, run.updated_at = "done", now
    A._log(db, exc, user.id, "Implemented", impl["note"])
    A._alert(db, exc.tenant_id, [exc.requested_by], f"Exception implemented: {exc.title}",
             f"The compensating controls for '{exc.title}' are recorded and it is marked implemented.", exc.id)
    db.flush()
    return run


def register_text(db: Session, exc: PolicyException) -> Optional[str]:
    """The compensating controls as lines of text for the register entry "Move to risk register" makes, or None when none were recorded."""
    rows = controls_of(db, exc)
    if not rows:
        return None
    return "\n".join(f"{i}. {c.title} ({'in place' if c.status == 'in_place' else 'planned'})" for i, c in enumerate(rows, 1))
