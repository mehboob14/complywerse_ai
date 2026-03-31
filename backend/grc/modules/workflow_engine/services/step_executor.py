from datetime import datetime, timedelta
import logging
from typing import Any, Dict, Optional

from ....models import ApprovalRequest, Role, UserRole, WorkflowAuditLog, WorkflowEngineStep, WorkflowInstance
from .action_handlers import WorkflowActionHandlers
from .condition_evaluator import ConditionEvaluator
from .notification_service import send_workflow_notification


logger = logging.getLogger(__name__)


class StepExecutor:
    @staticmethod
    def _resolve_node_type(node) -> str:
        node_type = (getattr(node, "node_type", None) or "").lower()
        if node_type in {"start", "action", "condition", "approval", "timer", "subworkflow", "end"}:
            return node_type
        cfg = getattr(node, "config", {}) or {}
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

    @staticmethod
    def _normalize_user_ids(values) -> list[int]:
        normalized: list[int] = []
        for value in values or []:
            try:
                parsed = int(value)
                if parsed > 0:
                    normalized.append(parsed)
            except Exception:
                continue
        return normalized

    @staticmethod
    def _normalize_role_ids(values) -> list[int]:
        normalized: list[int] = []
        for value in values or []:
            try:
                parsed = int(value)
                if parsed > 0:
                    normalized.append(parsed)
            except Exception:
                continue
        return normalized

    @staticmethod
    def _resolve_role_user_ids(db, tenant_id: int, role_ids: list[int]) -> list[int]:
        if not role_ids:
            return []
        users = (
            db.query(UserRole.user_id)
            .join(Role, Role.id == UserRole.role_id)
            .filter(
                UserRole.tenant_id == tenant_id,
                Role.id.in_(role_ids),
            )
            .distinct()
            .all()
        )
        return [u[0] for u in users]

    def execute(self, db, instance, definition, node, step: WorkflowEngineStep) -> Dict[str, Any]:
        node_type = self._resolve_node_type(node)
        config = node.config or {}

        logger.info(
            "workflow.step.execute.start instance_id=%s step_id=%s node_key=%s node_type=%s",
            instance.id,
            step.id,
            step.node_key,
            node_type,
        )

        if node_type in {"start", "noop"}:
            return {"status": "completed", "output": {"started": True}}

        if node_type == "condition":
            condition = config.get("condition", {})
            eval_data = {
                "trigger": instance.trigger_payload or {},
                "context": instance.context or {},
                "step": step.input_payload or {},
            }
            result = ConditionEvaluator.evaluate(condition, eval_data)
            logger.info(
                "workflow.step.execute.condition instance_id=%s step_id=%s node_key=%s result=%s",
                instance.id,
                step.id,
                step.node_key,
                result,
            )
            return {"status": "completed", "output": {"condition_result": result}}

        if node_type == "timer":
            wait_seconds = config.get("wait_seconds")
            wait_until = config.get("wait_until")

            if wait_until:
                try:
                    run_at = datetime.fromisoformat(wait_until)
                except Exception:
                    run_at = datetime.utcnow() + timedelta(seconds=60)
            else:
                seconds = int(wait_seconds or 60)
                run_at = datetime.utcnow() + timedelta(seconds=seconds)

            return {
                "status": "waiting_timer",
                "next_run_at": run_at,
                "output": {"resume_at": run_at.isoformat()},
            }

        if node_type == "approval":
            logger.info(
                "workflow.step.execute.approval instance_id=%s step_id=%s node_key=%s",
                instance.id,
                step.id,
                step.node_key,
            )
            return self._execute_approval_node(db, instance, definition, step, config)

        if node_type == "subworkflow":
            logger.info(
                "workflow.step.execute.subworkflow instance_id=%s step_id=%s node_key=%s",
                instance.id,
                step.id,
                step.node_key,
            )
            return self._execute_subworkflow_node(db, instance, config)

        if node_type == "action":
            action_output = WorkflowActionHandlers.execute(db, instance, definition, node, config)
            updated_context = dict(instance.context or {})
            updated_context.setdefault("actions", []).append(
                {
                    "name": action_output.get("action", config.get("action_name", "generic_action")),
                    "payload": config.get("payload", {}),
                    "executed_at": datetime.utcnow().isoformat(),
                    "result": action_output,
                }
            )
            instance.context = updated_context
            logger.info(
                "workflow.step.execute.action instance_id=%s step_id=%s node_key=%s action=%s",
                instance.id,
                step.id,
                step.node_key,
                action_output.get("action", config.get("action_name", "generic_action")),
            )
            return {"status": "completed", "output": action_output}

        if node_type == "end":
            return {"status": "completed", "output": {"ended": True}}

        return {"status": "completed", "output": {"node_type": node_type, "handled": True}}

    @staticmethod
    def _resolve_due_at(timeout_seconds: Optional[int]) -> Optional[datetime]:
        if timeout_seconds is None:
            return None
        try:
            seconds = int(timeout_seconds)
            return datetime.utcnow() + timedelta(seconds=seconds)
        except Exception:
            return None

    @staticmethod
    def _resolve_timeout_seconds(config: Dict[str, Any], level_config: Optional[Dict[str, Any]] = None) -> Optional[int]:
        cfg = level_config or config or {}

        direct_candidates = [
            cfg.get("timeout_seconds"),
            cfg.get("approval_window_seconds"),
            cfg.get("sla_seconds"),
        ]
        for raw in direct_candidates:
            if raw is None:
                continue
            try:
                parsed = int(raw)
                return parsed if parsed > 0 else None
            except Exception:
                continue

        value = cfg.get("timeout_value")
        if value is None:
            value = cfg.get("approval_window_value")
        unit = str(cfg.get("timeout_unit") or cfg.get("approval_window_unit") or "hours").lower()
        if value is not None:
            try:
                amount = int(value)
            except Exception:
                amount = 0
            if amount <= 0:
                return None
            if unit == "days":
                return amount * 86400
            if unit == "minutes":
                return amount * 60
            return amount * 3600

        return None

    @staticmethod
    def _resolve_reminder_seconds(config: Dict[str, Any]) -> int:
        direct = config.get("escalation_reminder_before_seconds")
        if direct is None:
            direct = config.get("reminder_before_seconds")
        if direct is not None:
            try:
                parsed = int(direct)
                return parsed if parsed > 0 else 0
            except Exception:
                return 0

        value = config.get("escalation_reminder_before_value")
        if value is None:
            value = config.get("reminder_before_value")
        unit = str(config.get("escalation_reminder_before_unit") or config.get("reminder_before_unit") or "days").lower()
        if value is not None:
            try:
                amount = int(value)
            except Exception:
                amount = 0
            if amount <= 0:
                return 0
            if unit == "days":
                return amount * 86400
            if unit == "hours":
                return amount * 3600
            return amount * 60

        return 0

    @staticmethod
    def _notification_channels(config: Dict[str, Any]) -> list[str]:
        channels = config.get("notification_channels") or []
        if channels:
            normalized = []
            for channel in channels:
                key = str(channel or "").strip().lower()
                if key in {"in_app", "in-app", "app"}:
                    normalized.append("in_app")
                elif key in {"email", "mail"}:
                    normalized.append("email")
            if normalized:
                return list(dict.fromkeys(normalized))

        notify_in_app = bool(config.get("notify_in_app", True))
        notify_email = bool(config.get("notify_email", True))
        output: list[str] = []
        if notify_in_app:
            output.append("in_app")
        if notify_email:
            output.append("email")
        return output or ["in_app", "email"]

    def _execute_approval_node(self, db, instance, definition, step: WorkflowEngineStep, config: Dict[str, Any]) -> Dict[str, Any]:
        approval_type = (config.get("approval_type") or "single").lower()
        approver_user_ids = self._normalize_user_ids(config.get("approver_user_ids") or [])
        approver_role_ids = self._normalize_role_ids(config.get("approver_role_ids") or [])
        required = int(config.get("required_approvals", 1))
        on_timeout = (config.get("on_timeout") or "auto_reject").lower()
        reminder_interval_seconds = int(config.get("reminder_interval_seconds") or 0)
        reminder_before_seconds = self._resolve_reminder_seconds(config)
        channels = self._notification_channels(config)
        escalation_user_ids = self._normalize_user_ids(config.get("escalation_user_ids") or [])
        escalation_role_ids = self._normalize_role_ids(config.get("escalation_role_ids") or [])
        levels = config.get("levels") or []

        role_users = self._resolve_role_user_ids(db, instance.tenant_id, approver_role_ids)
        if role_users:
            approver_user_ids = list(dict.fromkeys([*approver_user_ids, *role_users]))

        if approval_type == "single" and not approver_user_ids and config.get("approver_user_id"):
            approver_user_ids = self._normalize_user_ids([config.get("approver_user_id")])

        if not db.query(ApprovalRequest).filter(ApprovalRequest.workflow_step_id == step.id).first():
            if approval_type == "multi_level":
                first_level = levels[0] if levels else {}
                first_level_role_ids = self._normalize_role_ids(first_level.get("approver_role_ids") or [])
                level_user_ids = self._normalize_user_ids(
                    first_level.get("approver_user_ids") or approver_user_ids or [config.get("approver_user_id")]
                )
                if first_level_role_ids:
                    level_user_ids = list(
                        dict.fromkeys(
                            [
                                *level_user_ids,
                                *self._resolve_role_user_ids(db, instance.tenant_id, first_level_role_ids),
                            ]
                        )
                    )
                level_timeout_seconds = self._resolve_timeout_seconds(config, first_level)
                for user_id in level_user_ids:
                    if user_id is None:
                        continue
                    request = ApprovalRequest(
                        tenant_id=instance.tenant_id,
                        workflow_instance_id=instance.id,
                        workflow_step_id=step.id,
                        approval_type="multi_level",
                        required_approvals=int(first_level.get("required_approvals", 1)),
                        approver_user_id=user_id,
                            approver_role=(
                                first_level.get("approver_role")
                                or ",".join(str(rid) for rid in first_level_role_ids)
                                or config.get("approver_role")
                            ),
                            due_at=self._resolve_due_at(level_timeout_seconds),
                        request_metadata={
                            "node_key": step.node_key,
                            "level_index": 0,
                            "levels": levels,
                            "on_timeout": on_timeout,
                            "reminder_interval_seconds": reminder_interval_seconds,
                            "reminder_before_seconds": reminder_before_seconds,
                            "delegate_to_user_id": config.get("delegate_to_user_id"),
                            "escalation_user_ids": escalation_user_ids,
                            "escalation_role_ids": escalation_role_ids,
                            "notification_channels": channels,
                            "approval_window_seconds": level_timeout_seconds,
                        },
                    )
                    db.add(request)
                    db.flush()
            else:
                targets = approver_user_ids or [config.get("approver_user_id")]
                timeout_seconds = self._resolve_timeout_seconds(config)
                for user_id in self._normalize_user_ids(targets):
                    if user_id is None:
                        continue
                    request = ApprovalRequest(
                        tenant_id=instance.tenant_id,
                        workflow_instance_id=instance.id,
                        workflow_step_id=step.id,
                        approval_type=approval_type,
                        required_approvals=required,
                        approver_user_id=user_id,
                        approver_role=(config.get("approver_role") or ",".join(str(rid) for rid in approver_role_ids)),
                        due_at=self._resolve_due_at(timeout_seconds),
                        request_metadata={
                            "node_key": step.node_key,
                            "levels": levels,
                            "on_timeout": on_timeout,
                            "reminder_interval_seconds": reminder_interval_seconds,
                            "reminder_before_seconds": reminder_before_seconds,
                            "delegate_to_user_id": config.get("delegate_to_user_id"),
                            "escalation_user_ids": escalation_user_ids,
                            "escalation_role_ids": escalation_role_ids,
                            "notification_channels": channels,
                            "approval_window_seconds": timeout_seconds,
                        },
                    )
                    db.add(request)
                    db.flush()

            notify_users = [r.approver_user_id for r in db.query(ApprovalRequest).filter(ApprovalRequest.workflow_step_id == step.id).all() if r.approver_user_id]
            if notify_users:
                due_at = db.query(ApprovalRequest).filter(ApprovalRequest.workflow_step_id == step.id).order_by(ApprovalRequest.id.asc()).first()
                due_text = due_at.due_at.strftime("%Y-%m-%d %H:%M UTC") if due_at and due_at.due_at else "Not set"
                send_workflow_notification(
                    db,
                    tenant_id=instance.tenant_id,
                    user_ids=notify_users,
                    role_ids=[],
                    channels=channels,
                    workflow_instance_id=instance.id,
                    notification_type="warning",
                    subject=f"Approval Required: {definition.name}",
                    message=(
                        f"Approval is required for workflow '{definition.name}' at step '{step.node_key}'. "
                        f"Due by: {due_text}."
                    ),
                )

            db.add(
                WorkflowAuditLog(
                    tenant_id=instance.tenant_id,
                    workflow_definition_id=definition.id,
                    workflow_instance_id=instance.id,
                    workflow_step_id=step.id,
                    event_type="approval.requested",
                    message=f"Approval requested for node {step.node_key}",
                    payload={
                        "approval_type": approval_type,
                        "on_timeout": on_timeout,
                        "reminder_interval_seconds": reminder_interval_seconds,
                        "reminder_before_seconds": reminder_before_seconds,
                        "notification_channels": channels,
                    },
                )
            )

            logger.info(
                "workflow.step.approval.requests_created instance_id=%s step_id=%s approval_type=%s approver_users=%s approver_roles=%s on_timeout=%s",
                instance.id,
                step.id,
                approval_type,
                approver_user_ids,
                approver_role_ids,
                on_timeout,
            )

        all_requests = db.query(ApprovalRequest).filter(ApprovalRequest.workflow_step_id == step.id).all()
        rejected = [r for r in all_requests if r.status == "rejected"]
        if rejected:
            logger.warning(
                "workflow.step.approval.rejected instance_id=%s step_id=%s rejected_count=%s",
                instance.id,
                step.id,
                len(rejected),
            )
            return {
                "status": "failed",
                "error": "Approval rejected",
                "output": {"approved": False, "rejected_count": len(rejected)},
            }

        if approval_type == "multi_level":
            return self._evaluate_multi_level(db, instance, step, all_requests)

        approved = len([r for r in all_requests if r.status == "approved"])
        needed = required if approval_type == "quorum" else max(required, 1)

        if approved >= needed:
            logger.info(
                "workflow.step.approval.completed instance_id=%s step_id=%s required=%s received=%s",
                instance.id,
                step.id,
                needed,
                approved,
            )
            return {
                "status": "completed",
                "output": {"approved": True, "required": needed, "received": approved},
            }

        pending = len([r for r in all_requests if r.status == "pending"])
        logger.info(
            "workflow.step.approval.waiting instance_id=%s step_id=%s required=%s received=%s pending=%s",
            instance.id,
            step.id,
            needed,
            approved,
            pending,
        )
        return {
            "status": "waiting_approval",
            "output": {"approved": False, "required": needed, "received": approved, "pending": pending},
        }

    def _evaluate_multi_level(self, db, instance, step: WorkflowEngineStep, all_requests: list) -> Dict[str, Any]:
        max_level = -1
        for req in all_requests:
            max_level = max(max_level, int((req.request_metadata or {}).get("level_index", 0)))

        current_level_requests = [
            r for r in all_requests if int((r.request_metadata or {}).get("level_index", 0)) == max_level
        ]
        approved = len([r for r in current_level_requests if r.status == "approved"])
        pending = [r for r in current_level_requests if r.status == "pending"]

        meta = (current_level_requests[0].request_metadata if current_level_requests else {}) or {}
        levels = meta.get("levels") or []
        level_cfg = levels[max_level] if max_level < len(levels) else {}
        required_level = int(level_cfg.get("required_approvals", 1))

        if approved >= required_level:
            next_level = max_level + 1
            if next_level >= len(levels):
                return {
                    "status": "completed",
                    "output": {"approved": True, "level": max_level, "received": approved},
                }

            next_cfg = levels[next_level]
            next_users = self._normalize_user_ids(next_cfg.get("approver_user_ids") or [])
            next_role_ids = self._normalize_role_ids(next_cfg.get("approver_role_ids") or [])
            if next_role_ids:
                next_users = list(
                    dict.fromkeys(
                        [
                            *next_users,
                            *self._resolve_role_user_ids(db, instance.tenant_id, next_role_ids),
                        ]
                    )
                )
            if next_users and not db.query(ApprovalRequest).filter(
                ApprovalRequest.workflow_step_id == step.id,
                ApprovalRequest.status == "pending",
            ).first():
                next_timeout_seconds = self._resolve_timeout_seconds(meta, next_cfg)
                for user_id in next_users:
                    db.add(
                        ApprovalRequest(
                            tenant_id=instance.tenant_id,
                            workflow_instance_id=instance.id,
                            workflow_step_id=step.id,
                            approval_type="multi_level",
                            required_approvals=int(next_cfg.get("required_approvals", 1)),
                            approver_user_id=user_id,
                            approver_role=next_cfg.get("approver_role") or ",".join(str(rid) for rid in next_role_ids),
                            due_at=self._resolve_due_at(next_timeout_seconds),
                            request_metadata={
                                "node_key": step.node_key,
                                "level_index": next_level,
                                "levels": levels,
                                "on_timeout": (meta or {}).get("on_timeout", "auto_reject"),
                                "reminder_interval_seconds": (meta or {}).get("reminder_interval_seconds", 0),
                                "reminder_before_seconds": (meta or {}).get("reminder_before_seconds", 0),
                                "delegate_to_user_id": (meta or {}).get("delegate_to_user_id"),
                                "escalation_user_ids": (meta or {}).get("escalation_user_ids", []),
                                "escalation_role_ids": (meta or {}).get("escalation_role_ids", []),
                                "notification_channels": (meta or {}).get("notification_channels", ["in_app", "email"]),
                                "approval_window_seconds": next_timeout_seconds,
                            },
                        )
                    )
                db.flush()

                due_candidate = self._resolve_due_at(next_timeout_seconds)
                due_text = due_candidate.strftime("%Y-%m-%d %H:%M UTC") if due_candidate else "Not set"
                send_workflow_notification(
                    db,
                    tenant_id=instance.tenant_id,
                    user_ids=next_users,
                    role_ids=next_role_ids,
                    channels=(meta or {}).get("notification_channels", ["in_app", "email"]),
                    workflow_instance_id=instance.id,
                    notification_type="warning",
                    subject=f"Approval Required: {step.node_key}",
                    message=(
                        f"You have a pending approval at level {next_level + 1} for workflow instance #{instance.id}. "
                        f"Due by: {due_text}."
                    ),
                )

            return {
                "status": "waiting_approval",
                "output": {"approved": False, "level": next_level, "pending": len(next_users)},
            }

        return {
            "status": "waiting_approval",
            "output": {"approved": False, "level": max_level, "required": required_level, "received": approved, "pending": len(pending)},
        }

    def _execute_subworkflow_node(self, db, instance, config: Dict[str, Any]) -> Dict[str, Any]:
        child_definition_id = config.get("workflow_definition_id")
        if not child_definition_id:
            logger.error(
                "workflow.step.subworkflow.failed instance_id=%s reason=missing_child_definition",
                instance.id,
            )
            return {"status": "failed", "error": "Subworkflow definition id missing"}

        correlation_id = f"subworkflow:{instance.id}:{child_definition_id}"
        child = db.query(WorkflowInstance).filter(
            WorkflowInstance.correlation_id == correlation_id,
            WorkflowInstance.tenant_id == instance.tenant_id,
        ).order_by(WorkflowInstance.id.desc()).first()

        if not child:
            from .runtime import get_runtime

            runtime = get_runtime()
            runtime.event_queue.publish(
                {
                    "kind": "start_instance",
                    "workflow_definition_id": int(child_definition_id),
                    "tenant_id": instance.tenant_id,
                    "trigger_event": "subworkflow.trigger",
                    "trigger_payload": {
                        "parent_instance_id": instance.id,
                        "payload": config.get("payload") or {},
                    },
                    "correlation_id": correlation_id,
                }
            )
            logger.info(
                "workflow.step.subworkflow.started parent_instance_id=%s child_definition_id=%s correlation_id=%s",
                instance.id,
                int(child_definition_id),
                correlation_id,
            )
            return {"status": "waiting_subworkflow", "output": {"state": "started"}}

        if child.status == "completed":
            logger.info(
                "workflow.step.subworkflow.completed parent_instance_id=%s child_instance_id=%s",
                instance.id,
                child.id,
            )
            return {"status": "completed", "output": {"subworkflow_instance_id": child.id, "state": "completed"}}

        if child.status == "failed":
            logger.error(
                "workflow.step.subworkflow.failed parent_instance_id=%s child_instance_id=%s error=%s",
                instance.id,
                child.id,
                child.error_message or "unknown",
            )
            return {"status": "failed", "error": f"Subworkflow failed: {child.error_message or 'unknown'}"}

        return {"status": "waiting_subworkflow", "output": {"subworkflow_instance_id": child.id, "state": child.status}}
