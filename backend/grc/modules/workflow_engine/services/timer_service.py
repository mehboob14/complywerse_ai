from datetime import datetime, timedelta

from ....models import ApprovalRequest, WorkflowAuditLog, WorkflowDefinition, WorkflowEngineSchedule, WorkflowEngineStep, WorkflowInstance


def _compute_next_cron(cron_expr: str, after: datetime) -> datetime:
    """Compute next run time from a cron expression. Uses croniter if available, else adds 1 hour."""
    try:
        from croniter import croniter
        ci = croniter(cron_expr, after)
        return ci.get_next(datetime)
    except ImportError:
        # croniter not installed — fall back to 1-hour intervals
        return after + timedelta(hours=1)
    except Exception:
        return after + timedelta(hours=1)


class TimerService:
    def __init__(self, event_queue):
        self.event_queue = event_queue

    def schedule_due_steps(self, db) -> int:
        fired = 0

        # 1. Resume waiting timer steps that are due
        due_steps = (
            db.query(WorkflowEngineStep)
            .filter(
                WorkflowEngineStep.status == "waiting_timer",
                WorkflowEngineStep.next_run_at.isnot(None),
                WorkflowEngineStep.next_run_at <= datetime.utcnow(),
            )
            .order_by(WorkflowEngineStep.next_run_at.asc())
            .limit(200)
            .all()
        )

        for step in due_steps:
            self.event_queue.publish({"kind": "resume_step", "step_id": step.id})
        fired += len(due_steps)

        # 2. Fire due schedules (interval, once, and cron)
        schedules = (
            db.query(WorkflowEngineSchedule)
            .filter(
                WorkflowEngineSchedule.is_active == True,
                WorkflowEngineSchedule.next_run_at.isnot(None),
                WorkflowEngineSchedule.next_run_at <= datetime.utcnow(),
            )
            .order_by(WorkflowEngineSchedule.next_run_at.asc())
            .limit(200)
            .all()
        )

        for schedule in schedules:
            self.event_queue.publish(
                {
                    "kind": "start_instance",
                    "workflow_definition_id": schedule.workflow_definition_id,
                    "tenant_id": schedule.tenant_id,
                    "trigger_event": f"scheduler.{schedule.id}",
                    "trigger_payload": schedule.payload or {},
                    "correlation_id": f"schedule:{schedule.id}:{int(datetime.utcnow().timestamp())}",
                }
            )
            schedule.last_run_at = datetime.utcnow()

            if schedule.schedule_type == "once":
                schedule.is_active = False
                schedule.next_run_at = None
            elif schedule.schedule_type == "cron" and schedule.cron_expression:
                schedule.next_run_at = _compute_next_cron(schedule.cron_expression, datetime.utcnow())
            else:
                interval = int(schedule.interval_minutes or 60)
                schedule.next_run_at = datetime.utcnow() + timedelta(minutes=interval)

        fired += len(schedules)

        # 3. SLA breach detection — escalate overdue pending approvals
        fired += self._check_sla_breaches(db)

        return fired

    def _check_sla_breaches(self, db) -> int:
        """Find pending approvals that have breached their SLA and escalate them."""
        now = datetime.utcnow()
        overdue = (
            db.query(ApprovalRequest)
            .filter(
                ApprovalRequest.status == "pending",
                ApprovalRequest.due_at.isnot(None),
                ApprovalRequest.due_at <= now,
            )
            .limit(100)
            .all()
        )

        escalated = 0
        for approval in overdue:
            meta = approval.request_metadata or {}
            on_timeout = meta.get("on_timeout", "auto_reject")
            delegate_to = meta.get("delegate_to_user_id")

            instance = db.query(WorkflowInstance).filter(
                WorkflowInstance.id == approval.workflow_instance_id
            ).first()

            if not instance:
                continue

            definition = db.query(WorkflowDefinition).filter(
                WorkflowDefinition.id == instance.workflow_definition_id
            ).first()

            if on_timeout == "auto_approve":
                approval.status = "approved"
                approval.decision_comment = "Auto-approved due to SLA timeout"
                approval.responded_at = now
                db.add(WorkflowAuditLog(
                    tenant_id=instance.tenant_id,
                    workflow_definition_id=instance.workflow_definition_id,
                    workflow_instance_id=instance.id,
                    event_type="approval.sla_auto_approved",
                    message=f"Approval #{approval.id} auto-approved after SLA breach",
                    payload={"approval_id": approval.id, "due_at": approval.due_at.isoformat()},
                ))
                # Resume the waiting step
                step = db.query(WorkflowEngineStep).filter(
                    WorkflowEngineStep.id == approval.workflow_step_id
                ).first()
                if step:
                    self.event_queue.publish({"kind": "resume_step", "step_id": step.id})

            elif on_timeout == "delegate" and delegate_to:
                # Reassign to delegate
                approval.approver_user_id = int(delegate_to)
                # Extend due date by same original SLA window (default 24h)
                approval.due_at = now + timedelta(hours=24)
                db.add(WorkflowAuditLog(
                    tenant_id=instance.tenant_id,
                    workflow_definition_id=instance.workflow_definition_id,
                    workflow_instance_id=instance.id,
                    event_type="approval.sla_delegated",
                    message=f"Approval #{approval.id} delegated to user {delegate_to} after SLA breach",
                    payload={"approval_id": approval.id, "delegated_to": delegate_to},
                ))

            else:
                # Default: auto_reject
                approval.status = "rejected"
                approval.decision_comment = "Auto-rejected due to SLA timeout"
                approval.responded_at = now
                db.add(WorkflowAuditLog(
                    tenant_id=instance.tenant_id,
                    workflow_definition_id=instance.workflow_definition_id,
                    workflow_instance_id=instance.id,
                    event_type="approval.sla_auto_rejected",
                    message=f"Approval #{approval.id} auto-rejected after SLA breach",
                    payload={"approval_id": approval.id, "due_at": approval.due_at.isoformat()},
                ))
                step = db.query(WorkflowEngineStep).filter(
                    WorkflowEngineStep.id == approval.workflow_step_id
                ).first()
                if step:
                    self.event_queue.publish({"kind": "resume_step", "step_id": step.id})

            # Send escalation email to management
            try:
                from .email_service import send_email, _notification_html
                wf_name = definition.name if definition else f"Workflow #{instance.workflow_definition_id}"
                subject = f"SLA Breach Alert: Approval overdue in {wf_name}"
                body = (
                    f"An approval request has breached its SLA deadline.<br><br>"
                    f"<b>Workflow:</b> {wf_name}<br>"
                    f"<b>Approval ID:</b> {approval.id}<br>"
                    f"<b>Due:</b> {approval.due_at.strftime('%Y-%m-%d %H:%M UTC')}<br>"
                    f"<b>Action taken:</b> {on_timeout.replace('_', ' ').title()}"
                )
                from ....models import TenantUser, GRCUser
                users = (
                    db.query(GRCUser)
                    .join(TenantUser, TenantUser.user_id == GRCUser.id)
                    .filter(TenantUser.tenant_id == instance.tenant_id, GRCUser.is_active.is_(True))
                    .limit(5)
                    .all()
                )
                for u in users:
                    if u.email:
                        send_email(db, instance.tenant_id, u.email, subject,
                                   _notification_html(subject, body))
            except Exception:
                pass  # Email failure must not break SLA processing

            escalated += 1

        return escalated
