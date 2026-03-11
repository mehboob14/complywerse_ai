from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from ....models import ApprovalRequest, WorkflowAuditLog, WorkflowEngineStep, WorkflowInstance
from .action_handlers import WorkflowActionHandlers
from .condition_evaluator import ConditionEvaluator
from .email_service import WorkflowEmailService
from .recipient_resolver import WorkflowRecipientResolver


class StepExecutor:
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

    def execute(self, db, instance, definition, node, step: WorkflowEngineStep) -> Dict[str, Any]:
        node_type = (node.node_type or "action").lower()
        config = node.config or {}

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
            return self._execute_approval_node(db, instance, definition, step, config)

        if node_type == "subworkflow":
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
    def _resolve_due_at_with_days(timeout_seconds: Optional[int], timeout_days: Optional[int]) -> Optional[datetime]:
        if timeout_seconds is not None:
            return StepExecutor._resolve_due_at(timeout_seconds)
        if timeout_days is None:
            return None
        try:
            days = int(timeout_days)
            return datetime.utcnow() + timedelta(days=max(days, 0))
        except Exception:
            return None

    def _execute_approval_node(self, db, instance, definition, step: WorkflowEngineStep, config: Dict[str, Any]) -> Dict[str, Any]:
        approval_type = (config.get("approval_type") or "single").lower()
        approver_user_ids = self._normalize_user_ids(config.get("approver_user_ids") or [])
        approver_user_ids.extend(self._normalize_user_ids(config.get("reviewer_user_ids") or []))
        approver_user_ids.extend(self._normalize_user_ids(config.get("target_user_ids") or []))
        required = int(config.get("required_approvals", 1))
        on_timeout = (config.get("on_timeout") or "auto_reject").lower()
        reminder_interval_seconds = int(config.get("reminder_interval_seconds") or 0)
        levels = config.get("levels") or []
        role_ids = self._normalize_user_ids(config.get("approver_role_ids") or [])
        role_ids.extend(self._normalize_user_ids(config.get("reviewer_role_ids") or []))
        role_ids.extend(self._normalize_user_ids(config.get("role_ids") or []))

        approver_role_name = config.get("approver_role")
        timeout_seconds = config.get("timeout_seconds")
        timeout_days = config.get("timeout_days")
        escalate_role_ids = self._normalize_user_ids(config.get("escalation_role_ids") or [])
        escalate_user_ids = self._normalize_user_ids(config.get("escalation_user_ids") or [])

        if approval_type == "single" and not approver_user_ids and config.get("approver_user_id"):
            approver_user_ids = self._normalize_user_ids([config.get("approver_user_id")])

        resolved_users = WorkflowRecipientResolver.resolve_user_ids(
            db=db,
            tenant_id=instance.tenant_id,
            user_ids=approver_user_ids,
            role_ids=role_ids,
            role_names=[approver_role_name] if approver_role_name else [],
        )

        if not db.query(ApprovalRequest).filter(ApprovalRequest.workflow_step_id == step.id).first():
            if approval_type == "multi_level":
                first_level = levels[0] if levels else {}
                level_role_ids = self._normalize_user_ids(first_level.get("approver_role_ids") or [])
                level_role_name = first_level.get("approver_role")
                raw_level_users = self._normalize_user_ids(
                    first_level.get("approver_user_ids") or resolved_users or [config.get("approver_user_id")]
                )
                level_user_ids = WorkflowRecipientResolver.resolve_user_ids(
                    db=db,
                    tenant_id=instance.tenant_id,
                    user_ids=raw_level_users,
                    role_ids=level_role_ids,
                    role_names=[level_role_name] if level_role_name else [],
                )
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
                        approver_role=first_level.get("approver_role") or approver_role_name,
                        due_at=self._resolve_due_at_with_days(timeout_seconds, timeout_days),
                        request_metadata={
                            "node_key": step.node_key,
                            "level_index": 0,
                            "levels": levels,
                            "on_timeout": on_timeout,
                            "reminder_interval_seconds": reminder_interval_seconds,
                            "delegate_to_user_id": config.get("delegate_to_user_id"),
                            "escalation_role_ids": escalate_role_ids,
                            "escalation_user_ids": escalate_user_ids,
                        },
                    )
                    db.add(request)
                    db.flush()
            else:
                targets = resolved_users or self._normalize_user_ids([config.get("approver_user_id")])
                for user_id in targets:
                    if user_id is None:
                        continue
                    request = ApprovalRequest(
                        tenant_id=instance.tenant_id,
                        workflow_instance_id=instance.id,
                        workflow_step_id=step.id,
                        approval_type=approval_type,
                        required_approvals=required,
                        approver_user_id=user_id,
                        approver_role=approver_role_name,
                        due_at=self._resolve_due_at_with_days(timeout_seconds, timeout_days),
                        request_metadata={
                            "node_key": step.node_key,
                            "levels": levels,
                            "on_timeout": on_timeout,
                            "reminder_interval_seconds": reminder_interval_seconds,
                            "delegate_to_user_id": config.get("delegate_to_user_id"),
                            "escalation_role_ids": escalate_role_ids,
                            "escalation_user_ids": escalate_user_ids,
                        },
                    )
                    db.add(request)
                    db.flush()

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
                        "resolved_approver_user_ids": resolved_users,
                    },
                )
            )

            pending_requests = db.query(ApprovalRequest).filter(
                ApprovalRequest.workflow_step_id == step.id,
                ApprovalRequest.status == "pending",
            ).all()
            request_user_ids = [item.approver_user_id for item in pending_requests if item.approver_user_id]
            recipients = WorkflowRecipientResolver.resolve_emails_for_users(
                db=db,
                tenant_id=instance.tenant_id,
                user_ids=request_user_ids,
            )
            if recipients:
                WorkflowEmailService.send_email(
                    recipients=recipients,
                    subject="GRC workflow approval requested",
                    body=(
                        f"<p>You have a pending workflow approval task.</p>"
                        f"<p>Workflow instance: <strong>{instance.id}</strong></p>"
                        f"<p>Node: <strong>{step.node_key}</strong></p>"
                    ),
                )

        all_requests = db.query(ApprovalRequest).filter(ApprovalRequest.workflow_step_id == step.id).all()
        rejected = [r for r in all_requests if r.status == "rejected"]
        if rejected:
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
            return {
                "status": "completed",
                "output": {"approved": True, "required": needed, "received": approved},
            }

        pending = len([r for r in all_requests if r.status == "pending"])
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
            next_users = WorkflowRecipientResolver.resolve_user_ids(
                db=db,
                tenant_id=instance.tenant_id,
                user_ids=self._normalize_user_ids(next_cfg.get("approver_user_ids") or []),
                role_ids=self._normalize_user_ids(next_cfg.get("approver_role_ids") or []),
                role_names=[next_cfg.get("approver_role")] if next_cfg.get("approver_role") else [],
            )
            if next_users and not db.query(ApprovalRequest).filter(
                ApprovalRequest.workflow_step_id == step.id,
                ApprovalRequest.status == "pending",
            ).first():
                for user_id in next_users:
                    db.add(
                        ApprovalRequest(
                            tenant_id=instance.tenant_id,
                            workflow_instance_id=instance.id,
                            workflow_step_id=step.id,
                            approval_type="multi_level",
                            required_approvals=int(next_cfg.get("required_approvals", 1)),
                            approver_user_id=user_id,
                            approver_role=next_cfg.get("approver_role"),
                            due_at=self._resolve_due_at_with_days(next_cfg.get("timeout_seconds"), next_cfg.get("timeout_days")),
                            request_metadata={
                                "node_key": step.node_key,
                                "level_index": next_level,
                                "levels": levels,
                                "on_timeout": (meta or {}).get("on_timeout", "auto_reject"),
                                "reminder_interval_seconds": (meta or {}).get("reminder_interval_seconds", 0),
                                "delegate_to_user_id": (meta or {}).get("delegate_to_user_id"),
                                "escalation_role_ids": (meta or {}).get("escalation_role_ids", []),
                                "escalation_user_ids": (meta or {}).get("escalation_user_ids", []),
                            },
                        )
                    )
                db.flush()

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
            return {"status": "waiting_subworkflow", "output": {"state": "started"}}

        if child.status == "completed":
            return {"status": "completed", "output": {"subworkflow_instance_id": child.id, "state": "completed"}}

        if child.status == "failed":
            return {"status": "failed", "error": f"Subworkflow failed: {child.error_message or 'unknown'}"}

        return {"status": "waiting_subworkflow", "output": {"subworkflow_instance_id": child.id, "state": child.status}}
