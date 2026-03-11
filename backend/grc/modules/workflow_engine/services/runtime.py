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
    SessionLocal,
    WorkflowAuditLog,
    WorkflowDefinition,
    WorkflowEdge,
    WorkflowEngineStep,
    WorkflowEngineWebhookEndpoint,
    WorkflowInstance,
    WorkflowNode,
)
from .condition_evaluator import ConditionEvaluator
from .email_service import WorkflowEmailService
from .event_queue import WorkflowEventQueue
from .recipient_resolver import WorkflowRecipientResolver
from .state_machine import WorkflowStateMachine
from .step_executor import StepExecutor
from .timer_service import TimerService
from .trigger_dispatcher import TriggerDispatcher

logger = logging.getLogger(__name__)


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

    def publish_event(self, event_name: str, tenant_id: int, payload: Dict, correlation_id: str = None) -> None:
        self.dispatcher.publish_event(event_name, tenant_id, payload, correlation_id)

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            db = SessionLocal()
            try:
                self.dispatcher.poll_platform_events(db)
                self.timer_service.schedule_due_steps(db)
                db.commit()
            except Exception as exc:
                db.rollback()
                logger.exception("Workflow poll cycle error: %s", exc)
            finally:
                db.close()

            self._consume_batch(max_items=50)
            time.sleep(0.5)

    def _consume_batch(self, max_items: int = 50) -> None:
        for _ in range(max_items):
            item = self.event_queue.consume(timeout=0.01)
            if not item:
                break
            db = SessionLocal()
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
            return

        start_node = self._get_start_node(db, definition.id)
        if not start_node:
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

        self.event_queue.publish({"kind": "resume_instance", "instance_id": instance.id})

    def _resume_step(self, db: Session, step_id: Optional[int]) -> None:
        if not step_id:
            return
        step = db.query(WorkflowEngineStep).filter(WorkflowEngineStep.id == step_id).first()
        if not step:
            return
        instance = db.query(WorkflowInstance).filter(WorkflowInstance.id == step.workflow_instance_id).first()
        if not instance or instance.status in {"failed", "completed", "cancelled"}:
            return
        if WorkflowStateMachine.can_transition_step(step.status, "running"):
            step.status = "running"
        self.event_queue.publish({"kind": "resume_instance", "instance_id": instance.id})

    def _run_instance(self, db: Session, instance_id: Optional[int]) -> None:
        if not instance_id:
            return

        instance = db.query(WorkflowInstance).filter(WorkflowInstance.id == instance_id).first()
        if not instance:
            return
        if instance.status in {"completed", "failed", "cancelled"}:
            return

        definition = db.query(WorkflowDefinition).filter(WorkflowDefinition.id == instance.workflow_definition_id).first()
        if not definition:
            instance.status = "failed"
            instance.failed_at = datetime.utcnow()
            instance.error_message = "Workflow definition not found"
            self._notify_webhooks(instance, "workflow.instance.failed")
            return

        visited = 0
        while visited < 200:
            visited += 1
            if not instance.current_node_key:
                self._mark_instance_completed(db, instance)
                self._notify_webhooks(instance, "workflow.instance.completed")
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
                self._mark_instance_failed(db, instance, f"Node not found: {instance.current_node_key}")
                self._notify_webhooks(instance, "workflow.instance.failed")
                break

            waiting_step = (
                db.query(WorkflowEngineStep)
                .filter(
                    WorkflowEngineStep.workflow_instance_id == instance.id,
                    WorkflowEngineStep.node_key == node.node_key,
                    WorkflowEngineStep.status.in_(["waiting_timer", "waiting_approval"]),
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
                    step = waiting_step
            else:
                step = WorkflowEngineStep(
                    workflow_instance_id=instance.id,
                    node_key=node.node_key,
                    node_type=node.node_type,
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
                self._mark_instance_failed(db, instance, result.get("error", "Step execution failed"))
                self._notify_webhooks(instance, "workflow.instance.failed")
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

            if not next_node_key or node.is_terminal or node.node_type.lower() == "end":
                self._mark_instance_completed(db, instance)
                self._notify_webhooks(instance, "workflow.instance.completed")
                break

            instance.current_node_key = next_node_key

        if visited >= 200:
            self._mark_instance_failed(db, instance, "Execution limit exceeded (possible cycle)")
            self._notify_webhooks(instance, "workflow.instance.failed")

    def _resolve_next_node_key(self, db: Session, definition_id: int, source_node_key: str, data: Dict) -> Optional[str]:
        edges = (
            db.query(WorkflowEdge)
            .filter(
                WorkflowEdge.workflow_definition_id == definition_id,
                WorkflowEdge.source_node_key == source_node_key,
            )
            .order_by(WorkflowEdge.priority.asc(), WorkflowEdge.id.asc())
            .all()
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
                escalation_role_ids = metadata.get("escalation_role_ids") or []
                escalation_user_ids = metadata.get("escalation_user_ids") or []
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

                if not next_users and delegate_to_user_id:
                    try:
                        parsed_delegate = int(delegate_to_user_id)
                        if parsed_delegate > 0:
                            next_users.append(parsed_delegate)
                    except Exception:
                        pass

                if escalation_role_ids or escalation_user_ids:
                    next_users.extend(
                        WorkflowRecipientResolver.resolve_user_ids(
                            db=db,
                            tenant_id=instance.tenant_id,
                            user_ids=escalation_user_ids,
                            role_ids=escalation_role_ids,
                        )
                    )

                next_users = sorted({int(uid) for uid in next_users if uid})

                created_escalation = 0
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

                    escalation_recipients = WorkflowRecipientResolver.resolve_emails_for_users(
                        db=db,
                        tenant_id=instance.tenant_id,
                        user_ids=next_users,
                    )
                    if escalation_recipients:
                        WorkflowEmailService.send_email(
                            recipients=escalation_recipients,
                            subject="Workflow approval escalated",
                            body=(
                                f"<p>An approval request has been escalated to you.</p>"
                                f"<p>Workflow instance: <strong>{instance.id}</strong></p>"
                                f"<p>Please review it as soon as possible.</p>"
                            ),
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
                request.due_at = datetime.utcnow() + timedelta(seconds=max(reminder_seconds, 0))
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
        db = SessionLocal()
        try:
            hooks = db.query(WorkflowEngineWebhookEndpoint).filter(
                WorkflowEngineWebhookEndpoint.tenant_id == instance.tenant_id,
                WorkflowEngineWebhookEndpoint.event_name == event_name,
                WorkflowEngineWebhookEndpoint.is_active == True,
                WorkflowEngineWebhookEndpoint.callback_url.isnot(None),
            ).all()

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
