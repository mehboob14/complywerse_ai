"""CTEM mobilise — assign a dangerous finding to a responsible person, in-platform.

Assign fix = pick ONE person who owns the remediation until the scanner says the
finding is gone. They get an owner stamp + a remediation plan + an in-app/email
notify. An approver is OPTIONAL (a go-ahead gate), never required and never the
close. The scanner re-scan is the only proof-of-fixed — the plan is never set to
`verified` here. (ServiceNow via itsm_service still exists but is a separate,
legacy path, not part of this story.)
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Sequence

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

TRIGGER = "ctem.finding_mobilised"
DEFINITION_NAME = "CTEM remediations"
KIND = "ctem_mobilise"


class MobiliseError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def correlation_id(scope_id: int, vuln_id: int) -> str:
    return f"ctem-mobilise:{int(scope_id)}:{int(vuln_id)}"


def _user_label(user) -> str:
    return (
        getattr(user, "display_name", None)
        or getattr(user, "username", None)
        or getattr(user, "email", None)
        or f"User #{getattr(user, 'id', '?')}"
    )


def _ensure_definition(db: Session, tenant_id: int, actor_id: Optional[int]):
    from ..models import WorkflowDefinition
    existing = (
        db.query(WorkflowDefinition)
        .filter(
            WorkflowDefinition.tenant_id == tenant_id,
            WorkflowDefinition.trigger_event == TRIGGER,
        )
        .first()
    )
    if existing:
        if not existing.is_active:
            existing.is_active = True
        return existing
    defn = WorkflowDefinition(
        tenant_id=tenant_id,
        name=DEFINITION_NAME,
        description=(
            "Assigns a CTEM finding to a person inside the platform, waits for "
            "approval, and notifies. Proof of fixed stays the scanner re-scan."
        ),
        trigger_event=TRIGGER,
        trigger_events=[TRIGGER],
        is_active=True,
        created_by_id=actor_id,
    )
    db.add(defn)
    db.flush()
    return defn


def _ensure_plan(db: Session, vuln) -> bool:
    """Create a recommended plan so the mobilised counter can see this finding.
    Never auto-approves — that is the workflow approval's job."""
    from ..models import VulnRemediationPlan
    existing = (
        db.query(VulnRemediationPlan)
        .filter(
            VulnRemediationPlan.tenant_id == vuln.tenant_id,
            VulnRemediationPlan.vulnerability_id == vuln.id,
        )
        .first()
    )
    if existing:
        return False
    db.add(VulnRemediationPlan(
        tenant_id=vuln.tenant_id,
        vulnerability_id=vuln.id,
        fix_type="patch",
        title=f"Remediate {vuln.vuln_id or vuln.id}",
        summary=(
            f"Created when this finding was assigned as an in-platform CTEM task. "
            f"Approval is the workflow gate; a scanner re-scan is still the proof "
            f"the weak spot is gone."
        ),
        fix_artifact="Fix on the host, then wait for the next Nessus scan to verify.",
        rationale="Finding mobilised via the CTEM workflow engine.",
        source="workflow",
        status="recommended",
    ))
    db.flush()
    return True


def _live_instance(db: Session, tenant_id: int, scope_id: int, vuln_id: int):
    from ..models import WorkflowInstance
    cid = correlation_id(scope_id, vuln_id)
    return (
        db.query(WorkflowInstance)
        .filter(
            WorkflowInstance.tenant_id == tenant_id,
            WorkflowInstance.correlation_id == cid,
            WorkflowInstance.status == "running",
        )
        .order_by(WorkflowInstance.id.desc())
        .first()
    )


def _notify(db: Session, *, tenant_id: int, instance_id: int, user_ids: Sequence[int],
            subject: str, message: str, notification_type: str = "info") -> None:
    try:
        from ..modules.workflow_engine.services.notification_service import send_workflow_notification
        send_workflow_notification(
            db,
            tenant_id=tenant_id,
            subject=subject,
            message=message,
            workflow_instance_id=instance_id,
            user_ids=list(user_ids),
            channels=["in_app", "email"],
            notification_type=notification_type,
        )
    except Exception:  # noqa: BLE001 — notify must not roll back the assignment
        logger.exception("ctem mobilise notify failed (non-fatal)")


def mobilise_finding(
    db: Session,
    *,
    tenant_id: int,
    scope,
    vuln_id: int,
    assignee_user_id: int,
    approver_user_id: Optional[int] = None,
    actor_user_id: int,
) -> Dict[str, Any]:
    """Assign the finding, open a workflow approval, notify both people.

    Idempotent: a live (running) task for this scope×finding is returned as-is.
    Never commits — caller owns the transaction.
    """
    from ..models import (
        ApprovalRequest, GRCUser, Vulnerability, WorkflowAuditLog,
        WorkflowEngineStep, WorkflowInstance,
    )
    from . import ctem_scopes as scopes_svc

    asset_ids = scopes_svc.resolve_scope_assets(db, tenant_id, scope.membership_rule)
    in_scope = set(scopes_svc.scope_vulnerability_ids(db, tenant_id, scope.membership_rule))
    if vuln_id not in in_scope:
        raise MobiliseError(409, "This finding is not in this scope")

    vuln = (
        db.query(Vulnerability)
        .filter(Vulnerability.id == vuln_id, Vulnerability.tenant_id == tenant_id)
        .first()
    )
    if not vuln:
        raise MobiliseError(404, "Finding not found")

    assignee = db.query(GRCUser).filter(GRCUser.id == assignee_user_id).first()
    if not assignee:
        raise MobiliseError(404, "Assignee not found")
    # Approver is OPTIONAL. Default flow = assign the responsible person, no
    # approval. An approver is only looked up when the caller names one.
    approver = None
    if approver_user_id is not None:
        approver = db.query(GRCUser).filter(GRCUser.id == approver_user_id).first()
        if not approver:
            raise MobiliseError(404, "Approver not found")

    live = _live_instance(db, tenant_id, scope.id, vuln_id)
    if live:
        pending = (
            db.query(ApprovalRequest)
            .filter(
                ApprovalRequest.workflow_instance_id == live.id,
                ApprovalRequest.status == "pending",
            )
            .first()
        )
        return {
            "created": False,
            "workflow_instance_id": live.id,
            "approval_request_id": pending.id if pending else None,
            "vulnerability_id": vuln.id,
            "assignee_user_id": vuln.assigned_to,
            "status": live.status,
        }

    vuln.assigned_to = assignee.id
    vuln.updated_at = datetime.utcnow()
    if (vuln.status or "open") == "open":
        vuln.status = "in_progress"
    plan_created = _ensure_plan(db, vuln)

    defn = _ensure_definition(db, tenant_id, actor_user_id)
    title = vuln.title or vuln.vuln_id or f"Finding #{vuln.id}"
    payload = {
        "kind": KIND,
        "resource_type": "vulnerabilities",
        "resource_id": vuln.id,
        "vulnerability_id": vuln.id,
        "scope_id": scope.id,
        "scope_name": scope.name,
        "assignee_user_id": assignee.id,
        "assignee_user_ids": [assignee.id],
        "approver_user_id": approver.id if approver else None,
        "user_id": actor_user_id,
        "title": title,
    }
    instance = WorkflowInstance(
        workflow_definition_id=defn.id,
        tenant_id=tenant_id,
        status="running",
        current_node_key="approve" if approver else "assigned",
        trigger_event=TRIGGER,
        trigger_payload=payload,
        context={"kind": KIND, "vulnerability_id": vuln.id, "scope_id": scope.id},
        correlation_id=correlation_id(scope.id, vuln.id),
    )
    db.add(instance)
    db.flush()

    # The active step is the WORK, owned by the person who will fix it. An
    # approval is an OPTIONAL gate — created only when an approver was named.
    # Either way the finding is closed by the scanner re-scan, never by a click.
    step = WorkflowEngineStep(
        workflow_instance_id=instance.id,
        node_key="approve" if approver else "assigned",
        node_type="approval" if approver else "task",
        status="waiting_approval" if approver else "in_progress",
        assigned_to_user_id=approver.id if approver else assignee.id,
        input_payload=payload,
    )
    db.add(step)
    db.flush()

    meta = {
        "kind": KIND,
        "title": title,
        "summary": (
            f"'{title}' is assigned to {_user_label(assignee)} to fix "
            f"(scope: {scope.name}). Proof of fixed stays a Nessus re-scan."
        ),
        "vulnerability_id": vuln.id,
        "scope_id": scope.id,
        "assignee_user_id": assignee.id,
        "approver_user_id": approver.id if approver else None,
    }
    # Only create an approval when an approver was explicitly named — otherwise
    # the assignment stands on its own (the person is on the hook, no gate).
    approval = None
    if approver:
        approval = ApprovalRequest(
            tenant_id=tenant_id,
            workflow_instance_id=instance.id,
            workflow_step_id=step.id,
            status="pending",
            approval_type="single",
            required_approvals=1,
            received_approvals=0,
            approver_user_id=approver.id,
            request_metadata=meta,
        )
        db.add(approval)
        db.flush()

    db.add(WorkflowAuditLog(
        tenant_id=tenant_id,
        workflow_definition_id=defn.id,
        workflow_instance_id=instance.id,
        workflow_step_id=step.id,
        event_type="instance.started",
        message=f"CTEM mobilise: '{title}' assigned to {_user_label(assignee)}",
        payload=meta,
        created_by_id=actor_user_id,
    ))

    # Always tell the person who now owns the fix — and send the FIX PACKAGE
    # with it: what the finding is (CVE, severity), which control(s) of the
    # org's fabric address it, and the scanner's own remediation text. The
    # assignee must be able to act from the email alone, without browsing the
    # register or the control library.
    fix_package, tail = "", ""
    try:
        what = " · ".join(x for x in ((vuln.cve_id or "").strip() or None,
                                      (vuln.severity or "").strip() or None) if x)
        if what:
            fix_package = f" ({what})"
        ctrl_lines = []
        for _cl in (getattr(vuln, "control_links", None) or [])[:5]:
            _c = (getattr(_cl, "framework_control", None) or getattr(_cl, "normalized_control", None)
                  or getattr(_cl, "parsed_framework_control", None) or getattr(_cl, "internal_control", None))
            if _c is None:
                continue
            _code = getattr(_c, "code", None) or getattr(_c, "control_id", None) or ""
            _name = getattr(_c, "name", None) or getattr(_c, "title", None) or ""
            line = f"{_code} — {_name}".strip(" —")
            if line and line not in ctrl_lines:
                ctrl_lines.append(line)
        if ctrl_lines:
            tail += " Control(s) that address it: " + "; ".join(ctrl_lines) + "."
        guidance = (getattr(vuln, "remediation_guidance", None) or "").strip()
        if guidance:
            tail += f" Recommended fix: {guidance[:400]}"
    except Exception:
        logger.exception("mobilise: fix-package enrichment failed (non-fatal)")
    if approver:
        assignee_msg = (
            f"You are assigned to fix '{title}'{fix_package} in CTEM scope '{scope.name}'. "
            f"It is waiting on a go-ahead from {_user_label(approver)}. "
            f"A scanner re-scan is what proves the weak spot is gone." + tail
        )
    else:
        assignee_msg = (
            f"You are assigned to fix '{title}'{fix_package} in CTEM scope '{scope.name}'. "
            f"Do the work on the host. A scanner re-scan is what proves the weak spot is gone." + tail
        )
    _notify(
        db, tenant_id=tenant_id, instance_id=instance.id,
        user_ids=[assignee.id],
        subject=f"Fix assigned: {title}",
        message=assignee_msg,
        notification_type="info",
    )
    if approver and approver.id != assignee.id:
        _notify(
            db, tenant_id=tenant_id, instance_id=instance.id,
            user_ids=[approver.id],
            subject=f"Go-ahead needed: {title}",
            message=meta["summary"],
            notification_type="warning",
        )

    return {
        "created": True,
        "workflow_instance_id": instance.id,
        "approval_request_id": approval.id if approval else None,
        "vulnerability_id": vuln.id,
        "assignee_user_id": assignee.id,
        "approver_user_id": approver.id if approver else None,
        "plan_created": plan_created,
        "member_assets": len(asset_ids),
        "status": instance.status,
    }


def apply_approval_decision(db: Session, approval, actor) -> None:
    """When a CTEM mobilise approval is decided, advance the plan (to
    `approved` only — never `verified`) and close the instance.

    Safe no-op for non-CTEM approvals. Never commits.
    """
    meta = approval.request_metadata or {}
    if meta.get("kind") != KIND:
        return

    from ..models import VulnRemediationPlan, WorkflowEngineStep, WorkflowInstance

    instance = db.query(WorkflowInstance).filter(
        WorkflowInstance.id == approval.workflow_instance_id
    ).first()
    step = db.query(WorkflowEngineStep).filter(
        WorkflowEngineStep.id == approval.workflow_step_id
    ).first()
    now = datetime.utcnow()
    who = _user_label(actor)
    vuln_id = meta.get("vulnerability_id")
    approved = approval.status == "approved"

    if step:
        step.status = "completed" if approved else "failed"
        step.completed_at = now
        step.output_payload = {"decision": approval.status, "by": getattr(actor, "id", None)}

    if instance and instance.status == "running":
        if approved:
            instance.status = "completed"
            instance.completed_at = now
            instance.current_node_key = None
        else:
            instance.status = "failed"
            instance.failed_at = now
            instance.error_message = "Approval rejected"
            instance.current_node_key = None

    if approved and vuln_id:
        plan = (
            db.query(VulnRemediationPlan)
            .filter(
                VulnRemediationPlan.vulnerability_id == int(vuln_id),
                VulnRemediationPlan.tenant_id == approval.tenant_id,
            )
            .first()
        )
        if plan and plan.status in ("recommended", "approved"):
            if plan.approved_at is None:
                plan.approved_by_id = getattr(actor, "id", None)
                plan.approved_by_name = who
                plan.approved_at = now
            plan.status = "approved"
            if plan.change_window_start is None:
                plan.change_window_start = now + timedelta(days=1)
                plan.change_window_end = plan.change_window_start + timedelta(hours=26)
            plan.updated_at = now

    title = meta.get("title") or f"Finding #{vuln_id}"
    assignee_id = meta.get("assignee_user_id")
    if assignee_id:
        if approved:
            _notify(
                db, tenant_id=approval.tenant_id,
                instance_id=approval.workflow_instance_id,
                user_ids=[int(assignee_id)],
                subject=f"Fix approved: {title}",
                message=(
                    f"'{title}' is approved for you to fix. Do the work on the host. "
                    f"Proof of fixed is the next Nessus scan — not this approval."
                ),
                notification_type="success",
            )
        else:
            _notify(
                db, tenant_id=approval.tenant_id,
                instance_id=approval.workflow_instance_id,
                user_ids=[int(assignee_id)],
                subject=f"Fix rejected: {title}",
                message=f"The CTEM assignment for '{title}' was rejected.",
                notification_type="warning",
            )


def task_index(db: Session, tenant_id: int, vuln_ids: Sequence[int]) -> Dict[int, Dict[str, Any]]:
    """Live/latest CTEM mobilise task per finding, keyed by vulnerability_id."""
    if not vuln_ids:
        return {}
    try:
        from ..models import ApprovalRequest, WorkflowInstance
        insts = (
            db.query(WorkflowInstance)
            .filter(
                WorkflowInstance.tenant_id == tenant_id,
                WorkflowInstance.trigger_event == TRIGGER,
            )
            .order_by(WorkflowInstance.id.desc())
            .all()
        )
    except Exception:  # noqa: BLE001 — hermetic tests without workflow tables
        logger.debug("ctem mobilise task_index unavailable")
        return {}

    wanted = set(int(v) for v in vuln_ids)
    by_vuln: Dict[int, Dict[str, Any]] = {}
    inst_ids: List[int] = []
    for inst in insts:
        vid = (inst.trigger_payload or {}).get("vulnerability_id")
        try:
            vid = int(vid)
        except (TypeError, ValueError):
            continue
        if vid not in wanted or vid in by_vuln:
            continue
        by_vuln[vid] = {
            "instance_id": inst.id,
            "status": inst.status,
            "assignee_user_id": (inst.trigger_payload or {}).get("assignee_user_id"),
            "approver_user_id": (inst.trigger_payload or {}).get("approver_user_id"),
            "approval_id": None,
        }
        inst_ids.append(inst.id)

    if not inst_ids:
        return by_vuln
    try:
        pending = (
            db.query(ApprovalRequest)
            .filter(
                ApprovalRequest.workflow_instance_id.in_(inst_ids),
                ApprovalRequest.status == "pending",
            )
            .all()
        )
        pending_by_inst = {p.workflow_instance_id: p.id for p in pending}
        for row in by_vuln.values():
            row["approval_id"] = pending_by_inst.get(row["instance_id"])
    except Exception:  # noqa: BLE001
        logger.debug("ctem mobilise approval lookup unavailable")
    return by_vuln
