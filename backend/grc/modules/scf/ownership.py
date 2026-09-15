"""SCF Stage C — ownership, due dates, work queue, SoD helpers."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional, Sequence

from sqlalchemy.orm import Session

from grc.models import (
    AuditLog,
    SCFControl,
    SCFControlState,
    SCFScope,
    TenantArtifact,
)
from grc.modules.scf.scope_service import get_applicable_scf_ids
from grc.rich_audit import write_rich_audit_log

logger = logging.getLogger(__name__)

CADENCE_DAYS = {"Quarterly": 90, "Semi-Annual": 180, "Annual": 365}

_ARTIFACT_WORK_STATUSES = ("draft", "in_review", "planned", "in_progress")


def compute_next_due(
    last_assessed_at: Optional[datetime],
    conformity_cadence: Optional[str],
) -> Optional[datetime]:
    """Return last_assessed_at + cadence days. Missing/unknown cadence → Annual (365)."""
    if last_assessed_at is None:
        return None
    days = CADENCE_DAYS.get((conformity_cadence or "").strip())
    if days is None:
        days = CADENCE_DAYS["Annual"]
    return last_assessed_at + timedelta(days=days)


def refuse_self_approval(actor_id: Optional[int], author_id: Optional[int]) -> None:
    """Raise if actor would approve their own work (SoD)."""
    if actor_id is None or author_id is None:
        return
    if int(actor_id) == int(author_id):
        raise ValueError(
            "Segregation of duties: reviewer cannot approve their own work"
        )


def refuse_artifact_self_approval(
    actor_id: Optional[int],
    created_by_id: Optional[int],
    assigned_to_id: Optional[int] = None,
) -> None:
    """Raise if actor is the artifact author (creator or assignee)."""
    if actor_id is None:
        return
    for author_id in (created_by_id, assigned_to_id):
        if author_id is not None and int(actor_id) == int(author_id):
            raise ValueError(
                "Segregation of duties: you cannot approve an artifact you authored or are assigned to"
            )


def _as_int_list(raw: Any) -> List[int]:
    if raw is None:
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            return []
    if not isinstance(raw, (list, tuple)):
        return []
    out: List[int] = []
    for x in raw:
        try:
            out.append(int(x))
        except (TypeError, ValueError):
            continue
    return out


def state_snapshot(state: SCFControlState) -> Dict[str, Any]:
    return {
        "id": state.id,
        "scf_id": state.scf_id,
        "scope_id": state.scope_id,
        "owner_user_id": state.owner_user_id,
        "reviewer_user_id": state.reviewer_user_id,
        "assigned_user_ids": _as_int_list(state.assigned_user_ids),
        "next_due_at": state.next_due_at.isoformat() if state.next_due_at else None,
        "status": state.status,
        "is_applicable": state.is_applicable,
        "applicability_source": state.applicability_source,
    }


def ownership_status_for(
    state: Optional[SCFControlState],
    *,
    now: Optional[datetime] = None,
) -> str:
    if state is None or state.owner_user_id is None:
        return "unowned"
    due = state.next_due_at
    if due is not None and due < (now or datetime.utcnow()):
        return "overdue"
    return "ok"


def ensure_state(
    db: Session,
    tenant_id: int,
    scope_id: int,
    scf_id: str,
) -> SCFControlState:
    row = (
        db.query(SCFControlState)
        .filter(
            SCFControlState.tenant_id == tenant_id,
            SCFControlState.scope_id == scope_id,
            SCFControlState.scf_id == scf_id,
        )
        .first()
    )
    if row is not None:
        return row
    row = SCFControlState(
        tenant_id=tenant_id,
        scope_id=scope_id,
        scf_id=scf_id,
    )
    db.add(row)
    db.flush()
    return row


def _notify_ownership(
    db: Session,
    *,
    tenant_id: int,
    scf_id: str,
    user_ids: Iterable[int],
) -> None:
    ids = sorted({int(u) for u in user_ids if u is not None})
    if not ids:
        return
    try:
        from grc.modules.workflow_engine.services.notification_service import (
            send_workflow_notification,
        )

        send_workflow_notification(
            db,
            tenant_id=tenant_id,
            subject=f"Control {scf_id} assigned to you",
            message=f"You have been assigned ownership or contributor rights on SCF control {scf_id}.",
            workflow_instance_id=None,
            user_ids=ids,
            notification_type="info",
        )
    except Exception:
        logger.exception("ownership notify failed for scf_id=%s", scf_id)


def assign_ownership(
    db: Session,
    *,
    tenant_id: int,
    scope: SCFScope,
    scf_id: str,
    owner_user_id: Optional[int] = None,
    reviewer_user_id: Optional[int] = None,
    assigned_user_ids: Optional[Sequence[int]] = None,
    actor_user_id: Optional[int] = None,
    set_due: bool = True,
) -> SCFControlState:
    state = ensure_state(db, tenant_id, scope.id, scf_id)
    before = state_snapshot(state)

    if owner_user_id is not None:
        state.owner_user_id = int(owner_user_id)
    if reviewer_user_id is not None:
        state.reviewer_user_id = int(reviewer_user_id)
    if assigned_user_ids is not None:
        state.assigned_user_ids = _as_int_list(assigned_user_ids)

    if set_due and state.next_due_at is None:
        ctl = (
            db.query(SCFControl)
            .filter(
                SCFControl.release_id == scope.release_id,
                SCFControl.scf_id == scf_id,
            )
            .first()
        )
        cadence = ctl.conformity_cadence if ctl else None
        state.next_due_at = compute_next_due(datetime.utcnow(), cadence)

    state.updated_at = datetime.utcnow()
    db.flush()
    after = state_snapshot(state)

    write_rich_audit_log(
        db=db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="ownership_assign",
        resource_type="scf_control_state",
        resource_id=state.id,
        resource_name=scf_id,
        summary=f"Assigned ownership on {scf_id}",
        before=before,
        after=after,
    )

    notify_ids = set(_as_int_list(state.assigned_user_ids))
    if state.owner_user_id is not None:
        notify_ids.add(int(state.owner_user_id))
    _notify_ownership(db, tenant_id=tenant_id, scf_id=scf_id, user_ids=notify_ids)
    return state


def bulk_assign(
    db: Session,
    *,
    tenant_id: int,
    scope: SCFScope,
    owner_user_id: int,
    actor_user_id: Optional[int] = None,
    scf_ids: Optional[Sequence[str]] = None,
    domain: Optional[str] = None,
    assigned_user_ids: Optional[Sequence[int]] = None,
) -> Dict[str, Any]:
    targets: List[str] = []
    if scf_ids:
        targets = [str(x).strip() for x in scf_ids if str(x).strip()]
    elif domain:
        domain_key = domain.strip()
        applicable = get_applicable_scf_ids(db, tenant_id, scope.id)
        q = db.query(SCFControl.scf_id).filter(SCFControl.release_id == scope.release_id)
        q = q.filter(
            (SCFControl.domain_name == domain_key)
            | (SCFControl.domain_identifier == domain_key)
        )
        if applicable:
            q = q.filter(SCFControl.scf_id.in_(sorted(applicable)))
        targets = [r[0] for r in q.all()]
    else:
        raise ValueError("Provide scf_ids or domain")

    updated: List[str] = []
    for scf_id in targets:
        assign_ownership(
            db,
            tenant_id=tenant_id,
            scope=scope,
            scf_id=scf_id,
            owner_user_id=owner_user_id,
            assigned_user_ids=assigned_user_ids,
            actor_user_id=actor_user_id,
            set_due=True,
        )
        updated.append(scf_id)
    return {"count": len(updated), "scf_ids": updated}


def list_history(
    db: Session,
    tenant_id: int,
    scf_id: str,
    *,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """Audit rows for this control's ownership / applicability trail."""
    rows = (
        db.query(AuditLog)
        .filter(
            AuditLog.tenant_id == tenant_id,
            AuditLog.resource_type == "scf_control_state",
        )
        .order_by(AuditLog.timestamp.desc())
        .limit(500)
        .all()
    )
    out: List[Dict[str, Any]] = []
    needle = scf_id
    for row in rows:
        changes = row.changes or {}
        if not isinstance(changes, dict):
            continue
        resource_name = changes.get("resource_name")
        blob = json.dumps(changes, default=str)
        if resource_name != needle and needle not in blob:
            continue
        out.append({
            "id": row.id,
            "action": row.action,
            "user_id": row.user_id,
            "resource_id": row.resource_id,
            "resource_name": resource_name,
            "summary": (changes.get("summary") if isinstance(changes, dict) else None),
            "changes": changes,
            "timestamp": row.timestamp.isoformat() if row.timestamp else None,
        })
        if len(out) >= limit:
            break
    return out


def my_work_queue(
    db: Session,
    tenant_id: int,
    user_id: int,
    *,
    scope: Optional[SCFScope] = None,
) -> Dict[str, Any]:
    now = datetime.utcnow()
    if scope is None:
        from grc.modules.scf.scope_service import ensure_default_scope

        try:
            scope = ensure_default_scope(db, tenant_id)
        except RuntimeError:
            return {
                "controls": [],
                "na_reviews": [],
                "overdue": [],
                "artifacts": [],
                "failing": [],
                "failing_note": "SCF not provisioned",
            }

    applicable = get_applicable_scf_ids(db, tenant_id, scope.id)
    states = (
        db.query(SCFControlState)
        .filter(
            SCFControlState.tenant_id == tenant_id,
            SCFControlState.scope_id == scope.id,
        )
        .all()
    )

    ctl_names = {
        r.scf_id: r.name
        for r in db.query(SCFControl.scf_id, SCFControl.name)
        .filter(SCFControl.release_id == scope.release_id)
        .all()
    }

    controls: List[Dict[str, Any]] = []
    overdue: List[Dict[str, Any]] = []
    na_reviews: List[Dict[str, Any]] = []

    for st in states:
        assigned = _as_int_list(st.assigned_user_ids)
        owned = st.owner_user_id is not None and int(st.owner_user_id) == int(user_id)
        in_assignees = int(user_id) in assigned
        is_applicable = st.scf_id in applicable if applicable else (st.is_applicable is not False)

        if st.status == "pending_review":
            if st.requested_by is not None and int(st.requested_by) != int(user_id):
                if st.reviewer_user_id is None or int(st.reviewer_user_id) == int(user_id):
                    na_reviews.append({
                        "scf_id": st.scf_id,
                        "name": ctl_names.get(st.scf_id),
                        "requested_by": st.requested_by,
                        "reviewer_user_id": st.reviewer_user_id,
                        "status": st.status,
                        "is_applicable": st.is_applicable,
                        "reason": st.applicability_reason,
                    })

        if (owned or in_assignees) and is_applicable:
            item = {
                "scf_id": st.scf_id,
                "name": ctl_names.get(st.scf_id),
                "next_due_at": st.next_due_at.isoformat() if st.next_due_at else None,
                "owner_user_id": st.owner_user_id,
                "assigned_user_ids": assigned,
                "ownership_status": ownership_status_for(st, now=now),
                "designation": st.designation,
            }
            controls.append(item)
            if st.next_due_at is not None and st.next_due_at < now:
                overdue.append(item)

    artifacts_rows = (
        db.query(TenantArtifact)
        .filter(
            TenantArtifact.tenant_id == tenant_id,
            TenantArtifact.assigned_to_id == user_id,
            TenantArtifact.status.in_(_ARTIFACT_WORK_STATUSES),
        )
        .order_by(TenantArtifact.updated_at.desc())
        .limit(100)
        .all()
    )
    artifacts = [
        {
            "id": a.id,
            "name": a.name,
            "status": a.status,
            "framework_key": a.framework_key,
            "control_ref": a.control_ref,
            "updated_at": a.updated_at.isoformat() if a.updated_at else None,
        }
        for a in artifacts_rows
    ]

    failing: List[Dict[str, Any]] = []
    failing_note: Optional[str] = (
        "failing checks not joined here; use automation overall_status on control detail"
    )

    return {
        "scope_id": scope.id,
        "controls": controls,
        "na_reviews": na_reviews,
        "overdue": overdue,
        "artifacts": artifacts,
        "failing": failing,
        "failing_note": failing_note,
    }


def states_by_scf_id(
    db: Session,
    tenant_id: int,
    scope_id: int,
) -> Dict[str, SCFControlState]:
    rows = (
        db.query(SCFControlState)
        .filter(
            SCFControlState.tenant_id == tenant_id,
            SCFControlState.scope_id == scope_id,
        )
        .all()
    )
    return {r.scf_id: r for r in rows}


def ownership_fields(
    state: Optional[SCFControlState],
    *,
    owner_name: Optional[str] = None,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    now = now or datetime.utcnow()
    return {
        "owner_user_id": state.owner_user_id if state else None,
        "owner_name": owner_name,
        "reviewer_user_id": state.reviewer_user_id if state else None,
        "assigned_user_ids": _as_int_list(state.assigned_user_ids) if state else [],
        "next_due_at": (
            state.next_due_at.isoformat() if state and state.next_due_at else None
        ),
        "ownership_status": ownership_status_for(state, now=now),
    }


def user_in_assigned(state: Optional[SCFControlState], user_id: int) -> bool:
    if state is None:
        return False
    return int(user_id) in _as_int_list(state.assigned_user_ids)
