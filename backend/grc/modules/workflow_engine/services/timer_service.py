from datetime import datetime, timedelta
import logging

from ....models import ApprovalRequest, WorkflowAuditLog, WorkflowEngineSchedule, WorkflowEngineStep
from .notification_service import send_workflow_notification


logger = logging.getLogger(__name__)


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

        if due_steps:
            logger.info("workflow.timer.steps_due count=%s", len(due_steps))

        for step in due_steps:
            logger.debug("workflow.timer.step_resume_queued step_id=%s", step.id)
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

        if schedules:
            logger.info("workflow.scheduler.due count=%s", len(schedules))

        for schedule in schedules:
            logger.info(
                "workflow.scheduler.fire schedule_id=%s tenant_id=%s workflow_definition_id=%s schedule_type=%s",
                schedule.id,
                schedule.tenant_id,
                schedule.workflow_definition_id,
                schedule.schedule_type,
            )
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
                logger.info("workflow.scheduler.completed_once schedule_id=%s", schedule.id)
            elif schedule.schedule_type == "cron" and schedule.cron_expression:
                schedule.next_run_at = _compute_next_cron(schedule.cron_expression, datetime.utcnow())
                logger.info(
                    "workflow.scheduler.next_run schedule_id=%s next_run_at=%s",
                    schedule.id,
                    schedule.next_run_at.isoformat() if schedule.next_run_at else None,
                )
            else:
                interval = int(schedule.interval_minutes or 60)
                schedule.next_run_at = datetime.utcnow() + timedelta(minutes=interval)
                logger.info(
                    "workflow.scheduler.next_run schedule_id=%s interval_minutes=%s next_run_at=%s",
                    schedule.id,
                    interval,
                    schedule.next_run_at.isoformat() if schedule.next_run_at else None,
                )

        fired += len(schedules)

        # 3. SLA reminders and timeout evaluation for pending approvals
        fired += self._process_approval_sla(db)

        if fired:
            logger.info("workflow.timer.cycle_fired total=%s", fired)

        return fired

    @staticmethod
    def _parse_iso_datetime(value):
        if not value:
            return None
        try:
            text = str(value).strip()
            if text.endswith("Z"):
                text = text[:-1] + "+00:00"
            return datetime.fromisoformat(text)
        except Exception:
            return None

    def _process_approval_sla(self, db) -> int:
        """Send pre-deadline escalation reminders and queue runtime timeout handling."""
        now = datetime.utcnow()
        pending = (
            db.query(ApprovalRequest)
            .filter(
                ApprovalRequest.status == "pending",
                ApprovalRequest.due_at.isnot(None),
            )
            .order_by(ApprovalRequest.due_at.asc())
            .limit(300)
            .all()
        )

        if not pending:
            return 0

        touched = 0
        for approval in pending:
            metadata = dict(approval.request_metadata or {})
            due_at = approval.due_at
            if due_at is None:
                continue

            # Reminder: notify escalation recipients before the due date.
            reminder_before_seconds = int(metadata.get("reminder_before_seconds") or 0)
            reminder_sent_at = self._parse_iso_datetime(metadata.get("reminder_sent_at"))
            if reminder_before_seconds > 0 and reminder_sent_at is None:
                remaining_seconds = int((due_at - now).total_seconds())
                if 0 < remaining_seconds <= reminder_before_seconds:
                    escalation_user_ids = metadata.get("escalation_user_ids") or []
                    escalation_role_ids = metadata.get("escalation_role_ids") or []
                    if not escalation_user_ids and approval.approver_user_id:
                        escalation_user_ids = [approval.approver_user_id]

                    channels = metadata.get("notification_channels") or ["in_app", "email"]
                    remaining_days = max(1, int((remaining_seconds + 86399) // 86400))
                    result = send_workflow_notification(
                        db,
                        tenant_id=approval.tenant_id,
                        user_ids=escalation_user_ids,
                        role_ids=escalation_role_ids,
                        channels=channels,
                        workflow_instance_id=approval.workflow_instance_id,
                        notification_type="warning",
                        subject="Approval Escalation Reminder",
                        message=(
                            f"Approval request #{approval.id} is still pending and due in "
                            f"{remaining_days} day(s) on {due_at.strftime('%Y-%m-%d %H:%M UTC')}."
                        ),
                    )

                    metadata["reminder_sent_at"] = now.isoformat()
                    approval.request_metadata = metadata
                    db.add(
                        WorkflowAuditLog(
                            tenant_id=approval.tenant_id,
                            workflow_definition_id=None,
                            workflow_instance_id=approval.workflow_instance_id,
                            workflow_step_id=approval.workflow_step_id,
                            event_type="approval.escalation_reminder_sent",
                            message="Escalation reminder sent before approval due date",
                            payload={
                                "approval_request_id": approval.id,
                                "remaining_seconds": remaining_seconds,
                                "notified_users": result.get("notified_users", 0),
                                "channels": result.get("channels", []),
                            },
                        )
                    )
                    touched += 1

            # Timeout: queue runtime to apply configured on_timeout policy.
            if due_at <= now:
                queued_at = self._parse_iso_datetime(metadata.get("timeout_resume_queued_at"))
                if queued_at is None or (now - queued_at) >= timedelta(minutes=5):
                    self.event_queue.publish({"kind": "resume_step", "step_id": approval.workflow_step_id})
                    metadata["timeout_resume_queued_at"] = now.isoformat()
                    approval.request_metadata = metadata
                    touched += 1

        if touched:
            logger.info("workflow.sla.processed touched=%s", touched)

        return touched
