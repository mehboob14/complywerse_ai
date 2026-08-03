import logging
import threading
import time
import json
import urllib.request
from datetime import datetime, timedelta
from typing import Dict, Optional

from sqlalchemy.orm import Session

from ....models import (
    ApprovalRequest,
    Role,
    SessionLocal,
    UserRole,
    WorkflowAuditLog,
    WorkflowDefinition,
    WorkflowEdge,
    WorkflowEngineStep,
    WorkflowEngineWebhookEndpoint,
    WorkflowInstance,
    WorkflowNode,
)
from ....rich_audit import write_rich_audit_log
from .condition_evaluator import ConditionEvaluator
from .event_queue import WorkflowEventQueue
from .notification_service import send_workflow_notification
from .state_machine import WorkflowStateMachine
from .step_executor import StepExecutor
from .timer_service import TimerService
from .trigger_dispatcher import TriggerDispatcher, iter_tenant_sessions, open_tenant_session_for_id

logger = logging.getLogger(__name__)


def _node_runtime_type(node: WorkflowNode) -> str:
    if node.is_start:
        return "start"
    if node.is_terminal:
        return "end"
    node_type = (node.node_type or "").lower()
    if node_type in {"start", "end", "action", "notification", "email", "condition", "approval", "timer", "escalation", "subworkflow", "blocked"}:
        return node_type
    cfg = node.config or {}
    if cfg.get("trigger_type"):
        return "start"
    if cfg.get("approval_type"):
        return "approval"
    if cfg.get("timer_kind") or cfg.get("wait_seconds") or cfg.get("wait_until"):
        return "timer"
    if cfg.get("condition_kind") or cfg.get("condition"):
        return "condition"
    if cfg.get("action_name"):
        return "action"
    return "action"


def _is_terminal(node: WorkflowNode) -> bool:
    return bool(node.is_terminal) or _node_runtime_type(node) == "end"


class WorkflowRuntime:
    def __init__(self) -> None:
        self.event_queue = WorkflowEventQueue()
        self.step_executor = StepExecutor()
        self.dispatcher = TriggerDispatcher(self.event_queue)
        self.timer_service = TimerService(self.event_queue)
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="workflow-runtime")
        self._thread.start()
        logger.info("Workflow runtime started")

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)
        logger.info("Workflow runtime stopped")

    def is_running(self) -> bool:
        return bool(self._thread and self._thread.is_alive() and not self._stop_event.is_set())

    def publish_event(self, event_name: str, tenant_id: int, payload: Dict, correlation_id: str = None) -> None:
        self.dispatcher.publish_event(event_name, tenant_id, payload, correlation_id)

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            polled = 0
            scheduled = 0
            try:
                # Workflow tables + the audit log live in each tenant's own
                # database (per-tenant DB architecture), so we iterate one
                # session per active tenant and run BOTH the audit-event poll
                # and the timer pass on it — a single tenant iteration per
                # cycle keeps connection churn down. Each tenant is committed
                # independently; one tenant's failure can't kill the cycle.
                for tenant_id, _slug, sess in iter_tenant_sessions():
                    try:
                        polled += self.dispatcher.poll_tenant_audit_events(tenant_id, sess)
                        scheduled += self.timer_service.schedule_due_steps_for_tenant(sess, tenant_id)
                        sess.commit()
                    except Exception:  # noqa: BLE001
                        sess.rollback()
                        logger.exception("workflow.runtime.tenant_cycle_failed tenant_id=%s", tenant_id)
                # Threshold events (issue SLA breach, agent offline, CIS
                # pass-rate drop) — self-throttled to once per 60 s and opens
                # its own per-tenant sessions internally.
                threshold_fired = self.dispatcher.poll_threshold_events()
                if polled or scheduled or threshold_fired:
                    logger.info(
                        "workflow.runtime.cycle polled_events=%s scheduled_items=%s threshold_events=%s queue_size=%s",
                        polled,
                        scheduled,
                        threshold_fired,
                        self.event_queue.size(),
                    )
            except Exception as exc:
                logger.exception("Workflow poll cycle error: %s", exc)

            self._consume_batch(max_items=50)
            time.sleep(0.5)

    def _consume_batch(self, max_items: int = 50) -> None:
        for _ in range(max_items):
            item = self.event_queue.consume(timeout=0.01)
            if not item:
                break
            # Every queued item carries the tenant it belongs to; its workflow
            # rows live in that tenant's DB, so we must process it on a session
            # opened against that tenant (not the master catalog).
            tenant_id = item.get("tenant_id")
            db = open_tenant_session_for_id(tenant_id)
            if db is None:
                logger.warning(
                    "workflow.runtime.item_skipped reason=no_tenant_session kind=%s tenant_id=%s",
                    item.get("kind"), tenant_id,
                )
                continue
            try:
                self._handle_item(db, item)
                db.commit()
            except Exception as exc:
                db.rollback()
                logger.exception("Workflow queue item failed: %s", exc)
            finally:
                db.close()

    def _handle_item(self, db: Session, item: Dict) -> None:
        kind = item.get("kind")
        if kind == "event":
            logger.debug("workflow.runtime.handle_item kind=%s", kind)
        else:
            logger.info("workflow.runtime.handle_item kind=%s", kind)
        if kind == "event":
            self.dispatcher.dispatch_event(db, item)
            return
        if kind == "start_instance":
            self._start_instance(db, item)
            return
        if kind == "resume_step":
            self._resume_step(db, item.get("step_id"))
            return
        if kind == "resume_instance":
            self._run_instance(db, item.get("instance_id"))
            return

    def _start_instance(self, db: Session, item: Dict) -> None:
        definition = db.query(WorkflowDefinition).filter(WorkflowDefinition.id == item.get("workflow_definition_id")).first()
        if not definition or not definition.is_active:
            logger.warning(
                "workflow.runtime.start_instance.skipped workflow_definition_id=%s reason=missing_or_inactive",
                item.get("workflow_definition_id"),
            )
            return

        start_node = self._get_start_node(db, definition.id)
        if not start_node:
            logger.warning(
                "workflow.runtime.start_instance.skipped workflow_definition_id=%s reason=no_start_node",
                definition.id,
            )
            return

        # Deduplication guard: prevent duplicate instance when both the
        # embedded runtime and the standalone watcher are running at the
        # same time, or after a process restart that reuses audit log ids.
        correlation_id = item.get("correlation_id")
        if correlation_id:
            existing = (
                db.query(WorkflowInstance)
                .filter(
                    WorkflowInstance.workflow_definition_id == definition.id,
                    WorkflowInstance.correlation_id == correlation_id,
                    WorkflowInstance.tenant_id == item.get("tenant_id"),
                )
                .first()
            )
            if existing:
                logger.debug(
                    "workflow.runtime.start_instance.deduplicated "
                    "workflow_definition_id=%s correlation_id=%s existing_instance_id=%s",
                    definition.id,
                    correlation_id,
                    existing.id,
                )
                return

        instance = WorkflowInstance(
            workflow_definition_id=definition.id,
            tenant_id=item.get("tenant_id"),
            status="running",
            current_node_key=start_node.node_key,
            trigger_event=item.get("trigger_event"),
            trigger_payload=item.get("trigger_payload") or {},
            context={},
            correlation_id=item.get("correlation_id"),
        )
        db.add(instance)
        db.flush()

        db.add(
            WorkflowAuditLog(
                tenant_id=instance.tenant_id,
                workflow_definition_id=definition.id,
                workflow_instance_id=instance.id,
                event_type="instance.started",
                message=f"Workflow instance started for {definition.name}",
                payload={"trigger_event": item.get("trigger_event")},
            )
        )

        # Write a main AuditLog entry so the Admin Audit Logs page shows this
        # lifecycle event with actor_type="workflow_engine".  actor_source is
        # set to "workflow" so the trigger dispatcher skips this row and does
        # not re-fire another workflow on it.
        try:
            write_rich_audit_log(
                db=db,
                tenant_id=instance.tenant_id,
                user_id=None,
                action="execute",
                resource_type="workflow_engine",
                resource_id=definition.id,
                resource_name=definition.name,
                summary=f"Workflow Engine started execution of '{definition.name}'",
                actor_type="workflow_engine",
                actor_workflow_id=definition.id,
                after={
                    "workflow_instance_id": instance.id,
                    "trigger_event": item.get("trigger_event"),
                    "status": "running",
                },
                resource_url=f"/workflow-engine/{definition.id}",
                actor_source="workflow",
            )
        except Exception as _e:
            logger.warning("workflow.runtime.start_instance.audit_log_failed: %s", _e)

        logger.info(
            "workflow.runtime.instance_started instance_id=%s workflow_definition_id=%s tenant_id=%s start_node=%s trigger_event=%s correlation_id=%s",
            instance.id,
            definition.id,
            instance.tenant_id,
            start_node.node_key,
            item.get("trigger_event"),
            item.get("correlation_id"),
        )

        self.event_queue.publish({"kind": "resume_instance", "instance_id": instance.id, "tenant_id": instance.tenant_id})

    def _resume_step(self, db: Session, step_id: Optional[int]) -> None:
        if not step_id:
            return
        step = db.query(WorkflowEngineStep).filter(WorkflowEngineStep.id == step_id).first()
        if not step:
            logger.warning("workflow.runtime.resume_step.skipped reason=step_not_found step_id=%s", step_id)
            return
        instance = db.query(WorkflowInstance).filter(WorkflowInstance.id == step.workflow_instance_id).first()
        if not instance or instance.status in {"failed", "completed", "cancelled"}:
            logger.warning(
                "workflow.runtime.resume_step.skipped step_id=%s reason=instance_not_runnable instance_id=%s",
                step_id,
                step.workflow_instance_id,
            )
            return
        if WorkflowStateMachine.can_transition_step(step.status, "running"):
            step.status = "running"
        self.event_queue.publish({"kind": "resume_instance", "instance_id": instance.id, "tenant_id": instance.tenant_id})
        logger.info("workflow.runtime.resume_step.queued step_id=%s instance_id=%s", step_id, instance.id)

    def _run_instance(self, db: Session, instance_id: Optional[int]) -> None:
        if not instance_id:
            return

        instance = db.query(WorkflowInstance).filter(WorkflowInstance.id == instance_id).first()
        if not instance:
            logger.warning("workflow.runtime.run_instance.skipped reason=instance_not_found instance_id=%s", instance_id)
            return
        if instance.status in {"completed", "failed", "cancelled"}:
            logger.info(
                "workflow.runtime.run_instance.skipped reason=terminal_status instance_id=%s status=%s",
                instance.id,
                instance.status,
            )
            return

        definition = db.query(WorkflowDefinition).filter(WorkflowDefinition.id == instance.workflow_definition_id).first()
        if not definition:
            instance.status = "failed"
            instance.failed_at = datetime.utcnow()
            instance.error_message = "Workflow definition not found"
            self._notify_webhooks(instance, "workflow.instance.failed")
            logger.error("workflow.runtime.run_instance.failed reason=definition_not_found instance_id=%s", instance.id)
            return

        visited = 0
        while visited < 200:
            visited += 1
            if not instance.current_node_key:
                self._mark_instance_completed(db, instance)
                self._notify_webhooks(instance, "workflow.instance.completed")
                self._write_instance_lifecycle_log(db, instance, definition, "completed")
                logger.info("workflow.runtime.instance_completed instance_id=%s", instance.id)
                break

            node = (
                db.query(WorkflowNode)
                .filter(
                    WorkflowNode.workflow_definition_id == definition.id,
                    WorkflowNode.node_key == instance.current_node_key,
                )
                .first()
            )
            if not node:
                _node_err = f"Node not found: {instance.current_node_key}"
                self._mark_instance_failed(db, instance, _node_err)
                self._notify_webhooks(instance, "workflow.instance.failed")
                self._write_instance_lifecycle_log(db, instance, definition, "failed", error=_node_err)
                logger.error(
                    "workflow.runtime.instance_failed instance_id=%s reason=node_not_found node_key=%s",
                    instance.id,
                    instance.current_node_key,
                )
                break

            # Look for an existing step on this node in any non-terminal status.
            # IMPORTANT: include "running" so that steps already transitioned by
            # _resume_step() (waiting_timer → running) are REUSED rather than
            # causing a new step to be created on every cycle (the runaway bug).
            waiting_step = (
                db.query(WorkflowEngineStep)
                .filter(
                    WorkflowEngineStep.workflow_instance_id == instance.id,
                    WorkflowEngineStep.node_key == node.node_key,
                    WorkflowEngineStep.status.in_([
                        "waiting_timer", "waiting_approval",
                        "waiting_subworkflow", "running",
                    ]),
                )
                .order_by(WorkflowEngineStep.id.desc())
                .first()
            )
            if waiting_step:
                if waiting_step.status == "waiting_timer":
                    break
                if waiting_step.status == "waiting_approval":
                    if self._handle_approval_timeouts(db, instance, definition, waiting_step):
                        continue
                    approval_required = self._approval_still_pending(db, waiting_step.id)
                    if approval_required:
                        break
                    if WorkflowStateMachine.can_transition_step(waiting_step.status, "running"):
                        waiting_step.status = "running"
                    step = waiting_step
                elif waiting_step.status == "waiting_subworkflow":
                    if WorkflowStateMachine.can_transition_step(waiting_step.status, "running"):
                        waiting_step.status = "running"
                    step = waiting_step
                else:
                    # "running" — step was already transitioned by _resume_step();
                    # reuse it directly so we don't create a duplicate.
                    step = waiting_step
            else:
                step = WorkflowEngineStep(
                    workflow_instance_id=instance.id,
                    node_key=node.node_key,
                    node_type=_node_runtime_type(node),
                    status="running",
                    input_payload={
                        "trigger": instance.trigger_payload or {},
                        "context": instance.context or {},
                    },
                )
                db.add(step)
                db.flush()

            result = self.step_executor.execute(db, instance, definition, node, step)
            next_status = result.get("status", "completed")
            step.output_payload = result.get("output", {})
            step.attempts = (step.attempts or 0) + 1

            logger.info(
                "workflow.runtime.step_result instance_id=%s step_id=%s node_key=%s node_type=%s status=%s",
                instance.id,
                step.id,
                node.node_key,
                _node_runtime_type(node),
                next_status,
            )

            if next_status == "waiting_timer":
                step.status = "waiting_timer"
                step.next_run_at = result.get("next_run_at")
                instance.status = "waiting"
                db.add(
                    WorkflowAuditLog(
                        tenant_id=instance.tenant_id,
                        workflow_definition_id=definition.id,
                        workflow_instance_id=instance.id,
                        workflow_step_id=step.id,
                        event_type="step.waiting_timer",
                        message=f"Timer waiting at node {node.node_key}",
                        payload={"next_run_at": step.next_run_at.isoformat() if step.next_run_at else None},
                    )
                )
                break

            if next_status == "waiting_approval":
                step.status = "waiting_approval"
                instance.status = "waiting"
                db.add(
                    WorkflowAuditLog(
                        tenant_id=instance.tenant_id,
                        workflow_definition_id=definition.id,
                        workflow_instance_id=instance.id,
                        workflow_step_id=step.id,
                        event_type="step.waiting_approval",
                        message=f"Approval waiting at node {node.node_key}",
                        payload=step.output_payload or {},
                    )
                )
                break

            if next_status == "waiting_subworkflow":
                step.status = "waiting_subworkflow"
                instance.status = "waiting"
                db.add(
                    WorkflowAuditLog(
                        tenant_id=instance.tenant_id,
                        workflow_definition_id=definition.id,
                        workflow_instance_id=instance.id,
                        workflow_step_id=step.id,
                        event_type="step.waiting_subworkflow",
                        message=f"Sub-workflow waiting at node {node.node_key}",
                        payload=step.output_payload or {},
                    )
                )
                break

            if next_status == "failed":
                step.status = "failed"
                step.completed_at = datetime.utcnow()
                error_msg = result.get("error", "Step execution failed")
                db.add(
                    WorkflowAuditLog(
                        tenant_id=instance.tenant_id,
                        workflow_definition_id=definition.id,
                        workflow_instance_id=instance.id,
                        workflow_step_id=step.id,
                        event_type="step.failed",
                        message=f"Step failed at node {node.node_key}: {error_msg}",
                        payload={"node_key": node.node_key, "error": error_msg},
                    )
                )
                self._mark_instance_failed(db, instance, error_msg)
                self._notify_webhooks(instance, "workflow.instance.failed")
                self._write_instance_lifecycle_log(db, instance, definition, "failed", error=error_msg)
                logger.error(
                    "workflow.runtime.instance_failed instance_id=%s step_id=%s error=%s",
                    instance.id,
                    step.id,
                    error_msg,
                )
                break

            step.status = "completed"
            step.completed_at = datetime.utcnow()
            instance.status = "running"

            next_node_key = self._resolve_next_node_key(db, definition.id, node.node_key, {
                "trigger": instance.trigger_payload or {},
                "context": instance.context or {},
                "step": step.output_payload or {},
            })

            db.add(
                WorkflowAuditLog(
                    tenant_id=instance.tenant_id,
                    workflow_definition_id=definition.id,
                    workflow_instance_id=instance.id,
                    workflow_step_id=step.id,
                    event_type="step.completed",
                    message=f"Completed node {node.node_key}",
                    payload={"next_node_key": next_node_key},
                )
            )

            if not next_node_key or _is_terminal(node):
                self._mark_instance_completed(db, instance)
                self._notify_webhooks(instance, "workflow.instance.completed")
                self._write_instance_lifecycle_log(db, instance, definition, "completed")
                logger.info("workflow.runtime.instance_completed instance_id=%s", instance.id)
                break

            instance.current_node_key = next_node_key
            logger.info(
                "workflow.runtime.instance_advance instance_id=%s next_node_key=%s",
                instance.id,
                next_node_key,
            )

        if visited >= 200:
            self._mark_instance_failed(db, instance, "Execution limit exceeded (possible cycle)")
            self._notify_webhooks(instance, "workflow.instance.failed")
            self._write_instance_lifecycle_log(
                db, instance, definition, "failed", error="Execution limit exceeded (possible cycle)"
            )
            logger.error("workflow.runtime.instance_failed instance_id=%s reason=execution_limit", instance.id)

    def _resolve_next_node_key(self, db: Session, definition_id: int, source_node_key: str, data: Dict) -> Optional[str]:
        edges = (
            db.query(WorkflowEdge)
            .filter(
                WorkflowEdge.workflow_definition_id == definition_id,
                WorkflowEdge.source_node_key == source_node_key,
            )
            .order_by(WorkflowEdge.id.asc())
            .all()
        )

        edges = sorted(
            edges,
            key=lambda e: int((e.condition or {}).get("priority", 100)),
        )

        for edge in edges:
            if ConditionEvaluator.evaluate(edge.condition or {}, data):
                return edge.target_node_key
        return None

    def _get_start_node(self, db: Session, definition_id: int):
        start = (
            db.query(WorkflowNode)
            .filter(
                WorkflowNode.workflow_definition_id == definition_id,
                WorkflowNode.is_start == True,
            )
            .first()
        )
        if start:
            return start

        start = (
            db.query(WorkflowNode)
            .filter(
                WorkflowNode.workflow_definition_id == definition_id,
            )
            .all()
        )
        for node in start:
            if (node.node_type or "").lower() == "start" or (node.node_key or "").lower() == "start":
                return node

        return (
            db.query(WorkflowNode)
            .filter(WorkflowNode.workflow_definition_id == definition_id)
            .order_by(WorkflowNode.id.asc())
            .first()
        )

    @staticmethod
    def _approval_still_pending(db: Session, workflow_step_id: int) -> bool:
        from ....models import ApprovalRequest

        pending = db.query(ApprovalRequest).filter(
            ApprovalRequest.workflow_step_id == workflow_step_id,
            ApprovalRequest.status == "pending",
        ).count()
        return pending > 0

    @staticmethod
    def _mark_instance_completed(db: Session, instance: WorkflowInstance) -> None:
        if WorkflowStateMachine.can_transition_instance(instance.status, "completed") or instance.status == "running":
            instance.status = "completed"
        instance.completed_at = datetime.utcnow()
        instance.current_node_key = None

    @staticmethod
    def _mark_instance_failed(db: Session, instance: WorkflowInstance, error: str) -> None:
        if WorkflowStateMachine.can_transition_instance(instance.status, "failed") or instance.status == "running":
            instance.status = "failed"
        instance.failed_at = datetime.utcnow()
        instance.error_message = error

    @staticmethod
    def _write_instance_lifecycle_log(
        db: Session,
        instance: WorkflowInstance,
        definition: WorkflowDefinition,
        status: str,
        error: Optional[str] = None,
    ) -> None:
        """Write a main AuditLog entry for a workflow instance lifecycle change.

        Tagged with actor_type='workflow_engine' and actor_source='workflow' so:
        - The Admin Audit Logs "Workflow Engine" filter returns these rows.
        - The trigger dispatcher skips them and does not re-fire workflows.
        """
        summary_map = {
            "completed": f"Workflow Engine completed execution of '{definition.name}'",
            "failed": f"Workflow Engine execution of '{definition.name}' failed",
        }
        after_payload: Dict = {
            "workflow_instance_id": instance.id,
            "status": status,
        }
        if error:
            after_payload["error"] = error

        # Attach each step's node_meta (and a short result tag) so the AI
        # summary can render a #### Steps section explaining what each node
        # did, which module it inherited from, and the endpoint it called.
        try:
            steps = (
                db.query(WorkflowEngineStep)
                .filter(WorkflowEngineStep.workflow_instance_id == instance.id)
                .order_by(WorkflowEngineStep.id.asc())
                .all()
            )
            step_snapshots = []
            for s in steps:
                out = s.output_payload if isinstance(s.output_payload, dict) else {}
                meta = out.get("node_meta") or {}
                snapshot = {
                    "node_key": s.node_key,
                    "node_type": s.node_type,
                    "status": s.status,
                }
                # surface the descriptive fields auditors care about
                for k in ("label", "description", "action_name", "endpoint",
                          "verb", "module", "submodule", "inherited_from"):
                    if meta.get(k):
                        snapshot[k] = meta[k]
                # short result hint without dragging the full payload
                if "result" in out:
                    snapshot["result"] = out.get("result")
                if "approved" in out:
                    snapshot["approved"] = out.get("approved")
                if "rejected" in out:
                    snapshot["rejected"] = out.get("rejected")
                step_snapshots.append(snapshot)
            if step_snapshots:
                after_payload["steps"] = step_snapshots
        except Exception as _se:
            logger.warning("workflow.runtime.step_snapshot_failed: %s", _se)

        try:
            write_rich_audit_log(
                db=db,
                tenant_id=instance.tenant_id,
                user_id=None,
                action="execute",
                resource_type="workflow_engine",
                resource_id=definition.id,
                resource_name=definition.name,
                summary=summary_map.get(status, f"Workflow Engine instance {status}"),
                actor_type="workflow_engine",
                actor_workflow_id=definition.id,
                after=after_payload,
                resource_url=f"/workflow-engine/{definition.id}",
                actor_source="workflow",
            )
        except Exception as _e:
            logger.warning("workflow.runtime.lifecycle_audit_log_failed status=%s: %s", status, _e)

    def _handle_approval_timeouts(self, db: Session, instance: WorkflowInstance, definition: WorkflowDefinition, step: WorkflowEngineStep) -> bool:
        timed_out = db.query(ApprovalRequest).filter(
            ApprovalRequest.workflow_step_id == step.id,
            ApprovalRequest.status == "pending",
            ApprovalRequest.due_at.isnot(None),
            ApprovalRequest.due_at <= datetime.utcnow(),
        ).all()

        if not timed_out:
            return False

        state_changed = False
        for request in timed_out:
            metadata = request.request_metadata or {}
            timeout_strategy = str(metadata.get("on_timeout") or "auto_reject").strip().lower()
            reminder_seconds = int(metadata.get("reminder_interval_seconds") or 0)
            delegate_to_user_id = metadata.get("delegate_to_user_id")
            escalation_user_ids = metadata.get("escalation_user_ids") or []
            escalation_role_ids = metadata.get("escalation_role_ids") or []
            notification_channels = metadata.get("notification_channels") or ["in_app", "email"]
            approval_window_seconds = metadata.get("approval_window_seconds")

            if timeout_strategy == "auto_approve":
                request.status = "approved"
                request.decision_comment = "Auto-approved due to timeout policy"
                request.responded_at = datetime.utcnow()
                db.add(
                    WorkflowAuditLog(
                        tenant_id=instance.tenant_id,
                        workflow_definition_id=definition.id,
                        workflow_instance_id=instance.id,
                        workflow_step_id=step.id,
                        event_type="approval.timeout_auto_approved",
                        message="Approval auto-approved due to timeout policy",
                        payload={"approval_request_id": request.id},
                    )
                )
                state_changed = True
                continue

            if timeout_strategy == "escalate":
                next_users = []
                levels = metadata.get("levels") or []
                try:
                    current_level = int(metadata.get("level_index", 0))
                except Exception:
                    current_level = 0

                next_cfg = {}
                if isinstance(levels, list) and current_level + 1 < len(levels):
                    next_cfg = levels[current_level + 1] or {}
                    for raw_user in (next_cfg.get("approver_user_ids") or []):
                        try:
                            parsed = int(raw_user)
                            if parsed > 0:
                                next_users.append(parsed)
                        except Exception:
                            continue

                    role_ids = []
                    for raw_role in (next_cfg.get("approver_role_ids") or []):
                        try:
                            parsed_role = int(raw_role)
                            if parsed_role > 0:
                                role_ids.append(parsed_role)
                        except Exception:
                            continue
                    if role_ids:
                        role_users = (
                            db.query(UserRole.user_id)
                            .join(Role, Role.id == UserRole.role_id)
                            .filter(
                                UserRole.tenant_id == instance.tenant_id,
                                Role.id.in_(role_ids),
                            )
                            .distinct()
                            .all()
                        )
                        for row in role_users:
                            try:
                                parsed_user = int(row[0])
                                if parsed_user > 0:
                                    next_users.append(parsed_user)
                            except Exception:
                                continue

                if not next_users and delegate_to_user_id:
                    try:
                        parsed_delegate = int(delegate_to_user_id)
                        if parsed_delegate > 0:
                            next_users.append(parsed_delegate)
                    except Exception:
                        pass

                created_escalation = 0
                next_users = list(dict.fromkeys(next_users))
                for user_id in next_users:
                    already_pending = db.query(ApprovalRequest).filter(
                        ApprovalRequest.workflow_step_id == step.id,
                        ApprovalRequest.approver_user_id == user_id,
                        ApprovalRequest.status == "pending",
                    ).first()
                    if already_pending:
                        continue

                    next_due_at = None
                    next_timeout_seconds = next_cfg.get("timeout_seconds")
                    try:
                        timeout_value = int(next_timeout_seconds) if next_timeout_seconds is not None else None
                    except Exception:
                        timeout_value = None
                    if timeout_value is not None:
                        next_due_at = datetime.utcnow() + timedelta(seconds=max(timeout_value, 0))

                    db.add(
                        ApprovalRequest(
                            tenant_id=instance.tenant_id,
                            workflow_instance_id=instance.id,
                            workflow_step_id=step.id,
                            approval_type="multi_level" if isinstance(levels, list) and len(levels) > 1 else request.approval_type,
                            required_approvals=int(next_cfg.get("required_approvals", request.required_approvals or 1)),
                            approver_user_id=user_id,
                            approver_role=next_cfg.get("approver_role") or request.approver_role,
                            due_at=next_due_at,
                            request_metadata={
                                "node_key": (metadata or {}).get("node_key"),
                                "level_index": current_level + 1,
                                "levels": levels,
                                "on_timeout": timeout_strategy,
                                "reminder_interval_seconds": reminder_seconds,
                                "delegate_to_user_id": delegate_to_user_id,
                            },
                        )
                    )
                    created_escalation += 1

                if created_escalation > 0:
                    request.status = "rejected"
                    request.decision_comment = "Timed out and escalated"
                    request.responded_at = datetime.utcnow()

                    escalation_notify_users = escalation_user_ids or next_users
                    send_workflow_notification(
                        db,
                        tenant_id=instance.tenant_id,
                        user_ids=escalation_notify_users,
                        role_ids=escalation_role_ids,
                        channels=notification_channels,
                        workflow_instance_id=instance.id,
                        notification_type="error",
                        subject=f"Approval Escalated: {definition.name}",
                        message=(
                            f"Approval request #{request.id} was not approved within the configured window and "
                            f"has been escalated."
                        ),
                    )

                    db.add(
                        WorkflowAuditLog(
                            tenant_id=instance.tenant_id,
                            workflow_definition_id=definition.id,
                            workflow_instance_id=instance.id,
                            workflow_step_id=step.id,
                            event_type="approval.escalated",
                            message="Approval escalated due to timeout",
                            payload={"approval_request_id": request.id, "escalated_to_count": created_escalation},
                        )
                    )
                    state_changed = True
                    continue

            parsed_delegate_id = None
            if delegate_to_user_id is not None:
                try:
                    parsed_delegate_id = int(delegate_to_user_id)
                except Exception:
                    parsed_delegate_id = None

            if parsed_delegate_id and request.approver_user_id != parsed_delegate_id:
                request.approver_user_id = parsed_delegate_id
                extension_seconds = 86400
                try:
                    parsed_extension = int(approval_window_seconds) if approval_window_seconds is not None else 0
                    if parsed_extension > 0:
                        extension_seconds = parsed_extension
                except Exception:
                    extension_seconds = 86400
                request.due_at = datetime.utcnow() + timedelta(seconds=extension_seconds)
                send_workflow_notification(
                    db,
                    tenant_id=instance.tenant_id,
                    user_ids=[parsed_delegate_id],
                    role_ids=[],
                    channels=notification_channels,
                    workflow_instance_id=instance.id,
                    notification_type="warning",
                    subject=f"Approval Delegated: {definition.name}",
                    message=(
                        f"Approval request #{request.id} has been delegated to you due to timeout. "
                        f"New due date: {request.due_at.strftime('%Y-%m-%d %H:%M UTC')}."
                    ),
                )
                db.add(
                    WorkflowAuditLog(
                        tenant_id=instance.tenant_id,
                        workflow_definition_id=definition.id,
                        workflow_instance_id=instance.id,
                        workflow_step_id=step.id,
                        event_type="approval.delegated",
                        message="Approval delegated due to timeout",
                        payload={"approval_request_id": request.id, "delegate_to_user_id": parsed_delegate_id},
                    )
                )
                state_changed = True
            else:
                request.status = "rejected"
                request.decision_comment = "Auto-rejected due to timeout"
                request.responded_at = datetime.utcnow()
                db.add(
                    WorkflowAuditLog(
                        tenant_id=instance.tenant_id,
                        workflow_definition_id=definition.id,
                        workflow_instance_id=instance.id,
                        workflow_step_id=step.id,
                        event_type="approval.timeout",
                        message="Approval timed out and was auto-rejected",
                        payload={"approval_request_id": request.id},
                    )
                )
                state_changed = True

        return state_changed

    def _notify_webhooks(self, instance: WorkflowInstance, event_name: str) -> None:
        # Webhook endpoints live in the per-tenant DB, and this is a best-effort
        # side-effect: a missing table, an unreachable tenant DB, or a delivery
        # failure must NEVER propagate — otherwise it would roll back the
        # instance-completion the caller just committed.
        db = open_tenant_session_for_id(instance.tenant_id)
        if db is None:
            return
        try:
            try:
                hooks = db.query(WorkflowEngineWebhookEndpoint).filter(
                    WorkflowEngineWebhookEndpoint.tenant_id == instance.tenant_id,
                    WorkflowEngineWebhookEndpoint.event_name == event_name,
                    WorkflowEngineWebhookEndpoint.is_active == True,
                    WorkflowEngineWebhookEndpoint.callback_url.isnot(None),
                ).all()
            except Exception as exc:  # noqa: BLE001 — e.g. table not provisioned on this tenant DB
                logger.debug(
                    "workflow.webhooks.skip tenant_id=%s event=%s reason=%s",
                    instance.tenant_id, event_name, exc,
                )
                return

            payload = {
                "event_name": event_name,
                "tenant_id": instance.tenant_id,
                "instance_id": instance.id,
                "workflow_definition_id": instance.workflow_definition_id,
                "status": instance.status,
                "correlation_id": instance.correlation_id,
                "timestamp": datetime.utcnow().isoformat(),
            }

            body = json.dumps(payload).encode("utf-8")
            for hook in hooks:
                try:
                    req = urllib.request.Request(
                        hook.callback_url,
                        data=body,
                        headers={
                            "Content-Type": "application/json",
                            "X-Workflow-Event": event_name,
                            "X-Workflow-Token": hook.token,
                        },
                        method="POST",
                    )
                    urllib.request.urlopen(req, timeout=3)
                except Exception:
                    logger.warning("Workflow webhook delivery failed for hook %s", hook.id)
        finally:
            db.close()


_runtime_instance: Optional[WorkflowRuntime] = None


def get_runtime() -> WorkflowRuntime:
    global _runtime_instance
    if _runtime_instance is None:
        _runtime_instance = WorkflowRuntime()
    return _runtime_instance


def start_runtime() -> None:
    runtime = get_runtime()
    runtime.start()


def stop_runtime() -> None:
    global _runtime_instance
    if _runtime_instance is not None:
        _runtime_instance.stop()


def runtime_status() -> dict:
    runtime = get_runtime()
    return {
        "running": runtime.is_running(),
        "worker_thread": "workflow-runtime",
    }
