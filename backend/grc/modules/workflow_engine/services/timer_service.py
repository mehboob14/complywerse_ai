from datetime import datetime, timedelta

from ....models import WorkflowEngineSchedule, WorkflowEngineStep


class TimerService:
    def __init__(self, event_queue):
        self.event_queue = event_queue

    def schedule_due_steps(self, db) -> int:
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
            else:
                interval = int(schedule.interval_minutes or 60)
                schedule.next_run_at = datetime.utcnow() + timedelta(minutes=interval)

        return len(due_steps) + len(schedules)
