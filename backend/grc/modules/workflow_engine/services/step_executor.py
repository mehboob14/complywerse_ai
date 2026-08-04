from datetime import datetime, timedelta
import logging
from typing import Any, Dict, Optional

from ....models import ApprovalRequest, Role, UserRole, WorkflowAuditLog, WorkflowEngineStep, WorkflowInstance
from ....rich_audit import workflow_actor_context
from .action_handlers import (
    WorkflowActionHandlers,
    _build_template_context,
    _resolve_template,
    _default_notification_subject,
    _default_notification_message,
)
from .condition_evaluator import ConditionEvaluator
from .notification_service import send_workflow_notification


logger = logging.getLogger(__name__)


# Allowed node types for the workflow watcher's dynamic execution.
# Any node_type not in this set (or any action_name not in _SAFE_ACTIONS)
# is returned as "blocked" and skipped safely rather than executing
# arbitrary code or making outbound HTTP calls.
_ALLOWED_NODE_TYPES = {
    "start",
    "notification",  # standalone in-app + email notification node
    "email",         # SMTP email node
    "condition",     # boolean branch
    "approval",      # human gate with approve / reject paths
    "timer",         # wait / schedule
    "escalation",    # escalate to managers / designated users
    "end",
}
# Only these action_names are permitted inside legacy "action" nodes.
_SAFE_ACTIONS = {
    # Notifications & communication
    "send_notification_email",
    "send_in_app_alert",
    "escalate_to_management",
    # NOTE: call_webhook_api excluded — outbound HTTP to user-supplied URLs is
    # an SSRF risk; use a dedicated integration node if webhooks are needed.
    "generate_report",
    # Evidence & compliance
    "request_evidence_upload",
    "request_evidence_review",
    "approve_evidence",
    "reject_evidence",
    "update_compliance_status",
    "start_compliance_assessment",
    "close_compliance_gap",
    "link_evidence_to_control",
    "assign_control_owner",
    # Risk
    "create_risk_entry",
    "update_risk_status",
    "assign_risk_owner",
    "trigger_risk_review",
    "create_remediation_task",
    # Vulnerability
    "assign_vulnerability_owner",
    "update_vulnerability_status",
    "create_vulnerability_entry",
    # Governance
    "create_policy_review_task",
    "publish_policy",
    "submit_policy_exception",
    "approve_policy_exception",
    "request_attestation",
    # Audit Management retired — kept so legacy workflow instances still resolve
    "create_audit_finding",
    "create_audit_plan",
    "close_audit_finding",
    "assign_auditor",
    # Control library
    "update_control_effectiveness",
    "set_control_not_applicable",
    # KRI management
    "create_kri",
    "update_kri_value",
    "resolve_kri_breach",
    # Incident management
    "create_incident",
    "update_incident_status",
    "assign_incident_owner",
    "close_incident",
    # Mitigation plans
    "create_mitigation_plan",
    "update_mitigation_status",
    "link_risk_to_mitigation",
    # RCSA
    "initiate_rcsa",
    "submit_rcsa_results",
    "review_rcsa",
    # Risk reviews
    "schedule_risk_review",
    "complete_risk_review",
    # Risk assessments
    "create_risk_assessment",
    "update_risk_assessment_status",
    "assign_risk_assessor",
    # Internal controls
    "create_internal_control",
    "test_internal_control",
    "update_control_test_result",
    # Risk appetite
    "set_risk_appetite",
    "update_risk_tolerance",
    # Risk dependencies
    "add_risk_dependency",
}


class StepExecutor:
    @staticmethod
    def _resolve_node_type(node) -> str:
        node_type = (getattr(node, "node_type", None) or "").lower()
        # 1. Direct match against whitelist
        if node_type in _ALLOWED_NODE_TYPES:
            return node_type
        # 2. Legacy "action" type — allow safe action names and all platform_action.* nodes
        if node_type == "action":
            cfg = getattr(node, "config", {}) or {}
            action_name = (cfg.get("action_name") or "").strip().lower()
            # Escalation is a first-class node (multi-level, per-level day/hour
            # waits, in-app + email) handled by the standalone escalation
            # executor — route it there even though the palette serialises it as
            # an "action" with action_name=escalate_to_management.
            if action_name == "escalate_to_management" or cfg.get("escalation_levels"):
                return "escalation"
            if action_name in _SAFE_ACTIONS or action_name.startswith("platform_action."):
                return "action"
            return "blocked"
        # 3. Config-based type inference for nodes without explicit node_type
        cfg = getattr(node, "config", {}) or {}
        if cfg.get("trigger_type"):
            return "start"
        if cfg.get("approval_type"):
            return "approval"
        if cfg.get("timer_kind") or cfg.get("wait_seconds") or cfg.get("wait_until"):
            return "timer"
        if cfg.get("condition_kind") or cfg.get("condition"):
            return "condition"
        if (
            cfg.get("escalation_type")
            or cfg.get("escalate_to_user_ids")
            or cfg.get("escalation_level")
            or cfg.get("escalation_levels")
        ):
            return "escalation"
        if cfg.get("action_name"):
            action_name = (cfg.get("action_name") or "").strip().lower()
            if action_name in _SAFE_ACTIONS or action_name.startswith("platform_action."):
                return "action"
            return "blocked"
        return "blocked"

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
    def _default_recipient_user_ids(definition) -> list[int]:
        """Fallback recipient for a notification node that has none configured —
        the workflow's creator — so alerts / emails are never silently dropped."""
        owner_id = getattr(definition, "created_by_id", None)
        try:
            return [int(owner_id)] if owner_id else []
        except Exception:  # noqa: BLE001
            return []

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

    @staticmethod
    def _build_node_meta(node, node_type: str, config: Dict[str, Any]) -> Dict[str, Any]:
        """Compact node self-description appended to every step's output_payload.

        Auditors reading a step row should be able to tell:
        - what the node does (description + label)
        - where it dispatches to (endpoint / action_name)
        - which module + submodule + verb it inherited from

        Sources (in order of preference):
        1. node.config — values the seeder already wrote
        2. node_type — fallback for built-in nodes (timer, condition, ...)
        """
        cfg = config or {}
        action_name = cfg.get("action_name") or cfg.get("action") or ""
        endpoint = cfg.get("endpoint") or cfg.get("path") or ""
        module = cfg.get("module") or ""
        submodule = cfg.get("submodule") or ""
        verb = cfg.get("verb") or cfg.get("verb_action") or ""
        description = cfg.get("description") or cfg.get("node_description") or ""

        # Parse from action_name when richer fields are missing:
        # platform_action.<verb>.<module>.<submodule>.<functionality>
        if action_name and not (module and submodule and verb):
            parts = (action_name or "").split(".")
            if len(parts) >= 5 and parts[0] == "platform_action":
                verb = verb or parts[1]
                module = module or parts[2]
                submodule = submodule or parts[3]

        # Derive a human inherited_from string
        if module and submodule:
            inherited_from = f"{module}/{submodule}"
        elif module:
            inherited_from = module
        else:
            inherited_from = node_type or "workflow_engine"

        # Smart description for platform_action.* nodes — turn
        # "platform_action.create.risk_management.vendor_risk.assessment"
        # into "Creates an assessment in vendor_risk." so the audit reader
        # never sees a raw node name without context.
        if not description and action_name.startswith("platform_action."):
            parts = action_name.split(".")
            if len(parts) >= 5:
                _verb = parts[1]
                _entity = parts[4].replace("_", " ")
                _mod = parts[3].replace("_", " ")
                verb_phrase = {
                    "create": "Creates a",
                    "update": "Updates a",
                    "delete": "Deletes a",
                    "approve": "Approves a",
                    "reject": "Rejects a",
                    "trigger": "Triggers a",
                    "submit": "Submits a",
                    "publish": "Publishes a",
                    "upload": "Uploads a",
                    "assign": "Assigns a",
                    "export": "Exports a",
                }.get(_verb, _verb.capitalize() + " a")
                description = f"{verb_phrase} {_entity} in {_mod}."

        # Recipient-aware descriptions for notification / email / alert nodes
        if not description and node_type in ("notification", "email") or action_name in ("send_notification_email", "send_in_app_alert"):
            _payload = cfg.get("payload") or {}
            _ch = (
                cfg.get("channels")
                or cfg.get("notification_channels")
                or (["in_app"] if action_name == "send_in_app_alert" else ["email"])
            )
            _subject = cfg.get("subject") or _payload.get("subject")
            channel_str = " + ".join(_ch) if isinstance(_ch, list) else str(_ch)
            if _subject:
                description = f"Sends a {channel_str} notification with subject: {_subject}."
            else:
                description = f"Sends a {channel_str} notification."

        # Fallback description for built-in node types
        if not description:
            DEFAULT_DESCRIPTIONS = {
                "start": "Entry point where the workflow begins.",
                "end": "Terminates the workflow.",
                "noop": "No-op placeholder.",
                "timer": "Waits for a duration before advancing.",
                "condition": "Evaluates a boolean expression and branches.",
                "notification": "Sends an in-app or email notification to designated recipients.",
                "email": "Sends an SMTP email.",
                "approval": "Human approval gate that waits for an approve or reject decision.",
                "escalation": "Notifies escalation targets when triggered.",
                "subworkflow": "Invokes another workflow as a sub-process.",
                "action": "Invokes a platform action handler.",
            }
            description = DEFAULT_DESCRIPTIONS.get(node_type, f"{node_type} node")

        meta = {
            "node_key": getattr(node, "node_key", None),
            "node_type": node_type,
            "label": cfg.get("label") or getattr(node, "label", None) or action_name or node_type,
            "description": description,
            "action_name": action_name or None,
            "endpoint": endpoint or None,
            "verb": verb or None,
            "module": module or None,
            "submodule": submodule or None,
            "inherited_from": inherited_from,
        }
        # Drop empty values to keep payloads compact
        return {k: v for k, v in meta.items() if v not in (None, "", [], {})}

    def execute(self, db, instance, definition, node, step: WorkflowEngineStep) -> Dict[str, Any]:
        # Outer wrapper — call the original logic and stamp node_meta onto the
        # result's output dict so every step's output_payload carries node
        # self-description (description, endpoint, module, inherited_from).
        node_type = self._resolve_node_type(node)
        config = node.config or {}
        node_meta = self._build_node_meta(node, node_type, config)

        result = self._execute_inner(db, instance, definition, node, step)
        if isinstance(result, dict) and isinstance(result.get("output"), dict):
            result["output"] = {**result["output"], "node_meta": node_meta}
        return result

    def _execute_inner(self, db, instance, definition, node, step: WorkflowEngineStep) -> Dict[str, Any]:
        node_type = self._resolve_node_type(node)
        raw_node_type = (getattr(node, "node_type", None) or "").lower()
        config = node.config or {}

        # Compact summary of WHAT this node is configured to do, so the log
        # makes it obvious which node ran and with what settings (and, when a
        # node does nothing, why). Only non-empty, non-sensitive keys.
        _cfg_keys = (
            "action_name", "trigger_type", "subject", "to", "message", "body",
            "recipient_user_ids", "user_ids", "recipient_role_ids", "role_ids",
            "notification_channels", "condition_kind", "approval_type",
            "timer_kind", "wait_seconds", "module", "submodule",
        )
        _cfg_summary = {
            k: config.get(k) for k in _cfg_keys
            if isinstance(config, dict) and config.get(k) not in (None, "", [], {})
        }
        logger.info(
            "workflow.step.execute.start instance_id=%s step_id=%s node_key=%s node_type=%s "
            "(raw_type=%s) action=%s config=%s",
            instance.id,
            step.id,
            step.node_key,
            node_type,
            raw_node_type,
            _cfg_summary.get("action_name", "-"),
            _cfg_summary,
        )

        if node_type in {"start", "noop"}:
            return {"status": "completed", "output": {"started": True}}

        # ── Trigger node (first node after Start used as the trigger) ────────
        # This node represents the triggering EVENT (e.g. "evidence deleted"),
        # not an action to perform — so we pass straight through without
        # executing it. It is tagged at save time by the definitions router.
        if isinstance(config, dict) and config.get("_is_trigger_node"):
            logger.info(
                "workflow.step.trigger_node_skipped instance_id=%s step_id=%s node_key=%s action=%s "
                "(this node is the workflow trigger — not executed)",
                instance.id, step.id, step.node_key, config.get("action_name"),
            )
            return {"status": "completed", "output": {"trigger_node": True, "skipped": True}}

        # ── Blocked / unsupported node type ─────────────────────────────────
        if node_type == "blocked":
            original_type = (getattr(node, "node_type", None) or "unknown")
            action_name = (node.config or {}).get("action_name", "")
            reason = (
                f"Action '{action_name}' is not in the allowed action list"
                if action_name
                else f"Node type '{original_type}' is not supported"
            )
            logger.warning(
                "workflow.step.blocked instance_id=%s step_id=%s node_key=%s reason=%s",
                instance.id, step.id, step.node_key, reason,
            )
            db.add(
                WorkflowAuditLog(
                    tenant_id=instance.tenant_id,
                    workflow_definition_id=definition.id,
                    workflow_instance_id=instance.id,
                    workflow_step_id=step.id,
                    event_type="step.blocked",
                    message=f"Step blocked: {reason}",
                    payload={"node_type": original_type, "action_name": action_name},
                )
            )
            return {"status": "completed", "output": {"blocked": True, "reason": reason}}

        # ── Notification node (in-app + optional email) ──────────────────────
        if node_type == "notification":
            # v6 / Pattern-B catalog workflows nest recipients under
            # config.payload.* rather than at the config root — check both
            # shapes (matching the send_in_app_alert branch) so those
            # notification nodes keep delivering.
            _payload = config.get("payload") or {}
            user_ids = self._normalize_user_ids(
                config.get("user_ids")
                or config.get("recipient_user_ids")
                or _payload.get("recipients")
                or _payload.get("recipient_user_ids")
                or []
            )
            role_ids = self._normalize_role_ids(
                config.get("role_ids")
                or config.get("recipient_role_ids")
                or _payload.get("recipient_role_ids")
                or _payload.get("role_ids")
                or []
            )
            # Owner fallback so a notification with no configured recipient still
            # reaches someone (the workflow creator) instead of nobody.
            if not user_ids and not role_ids:
                user_ids = self._default_recipient_user_ids(definition)
            channels = self._notification_channels(config)
            template_context = _build_template_context(db, instance, definition)
            subject = config.get("subject") or _default_notification_subject(instance, definition, template_context)
            message = (
                config.get("message") or config.get("body")
                or _default_notification_message(instance, definition, template_context)
            )
            subject = _resolve_template(subject, template_context)
            message = _resolve_template(message, template_context)
            logger.info(
                "workflow.notification.resolve instance_id=%s node_key=%s channels=%s "
                "user_ids=%s role_ids=%s subject=%r%s",
                instance.id, step.node_key, channels, user_ids, role_ids, subject,
                "" if (user_ids or role_ids) else "  ⚠ NO RECIPIENTS — nothing will be delivered",
            )
            send_workflow_notification(
                db,
                tenant_id=instance.tenant_id,
                user_ids=user_ids,
                role_ids=role_ids,
                channels=channels,
                workflow_instance_id=instance.id,
                notification_type=config.get("notification_type") or "info",
                subject=subject,
                message=message,
            )
            logger.info(
                "workflow.step.execute.notification instance_id=%s step_id=%s node_key=%s",
                instance.id, step.id, step.node_key,
            )
            return {"status": "completed", "output": {"notified": True, "user_count": len(user_ids)}}

        # ── Email node (SMTP via send_notification_email action) ─────────────
        if node_type == "email":
            email_config = {**config, "action_name": "send_notification_email"}
            email_output = WorkflowActionHandlers.execute(db, instance, definition, node, email_config)
            logger.info(
                "workflow.step.execute.email instance_id=%s step_id=%s node_key=%s",
                instance.id, step.id, step.node_key,
            )
            return {"status": "completed", "output": email_output}

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
            # Support human-readable duration strings like "48h", "7d", "30m", "3600s".
            # This handles node configs that use `duration` instead of `wait_seconds`.
            if wait_seconds is None and not wait_until:
                duration_str = (config.get("duration") or "").strip().lower()
                if duration_str:
                    try:
                        if duration_str.endswith("d"):
                            wait_seconds = int(float(duration_str[:-1]) * 86400)
                        elif duration_str.endswith("h"):
                            wait_seconds = int(float(duration_str[:-1]) * 3600)
                        elif duration_str.endswith("m"):
                            wait_seconds = int(float(duration_str[:-1]) * 60)
                        elif duration_str.endswith("s"):
                            wait_seconds = int(float(duration_str[:-1]))
                    except (ValueError, TypeError):
                        pass

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

        # ── Standalone escalation node ────────────────────────────────────────
        if node_type == "escalation":
            logger.info(
                "workflow.step.execute.escalation instance_id=%s step_id=%s node_key=%s",
                instance.id, step.id, step.node_key,
            )
            return self._execute_escalation_node(db, instance, definition, step, config)

        if node_type == "subworkflow":
            logger.info(
                "workflow.step.execute.subworkflow instance_id=%s step_id=%s node_key=%s",
                instance.id,
                step.id,
                step.node_key,
            )
            return self._execute_subworkflow_node(db, instance, config)

        if node_type == "action":
            # ── In-app alert (no email, in-system only) ──────────────────────
            if config.get("action_name") == "send_in_app_alert":
                # Pattern-B seeded workflows nest the recipient/subject/message
                # under a `payload` object; legacy workflows put them at the
                # config root. Read from both.
                _payload = config.get("payload") or {}
                user_ids = self._normalize_user_ids(
                    config.get("recipient_user_ids")
                    or _payload.get("recipient_user_ids")
                    or _payload.get("recipients")
                    or []
                )
                role_ids = self._normalize_role_ids(
                    config.get("recipient_role_ids")
                    or _payload.get("recipient_role_ids")
                    or _payload.get("role_ids")
                    or []
                )
                # Owner fallback: an in-app alert with no configured recipient
                # would be delivered to nobody. Default to the workflow's
                # creator so the alert is never silently dropped.
                if not user_ids and not role_ids:
                    user_ids = self._default_recipient_user_ids(definition)
                    if user_ids:
                        logger.info(
                            "workflow.in_app_alert.recipient_fallback instance_id=%s node_key=%s owner_user_id=%s",
                            instance.id, step.node_key, user_ids,
                        )
                template_context = _build_template_context(db, instance, definition)
                subject = config.get("subject") or _payload.get("subject") or _default_notification_subject(instance, definition, template_context)
                message = (
                    config.get("message") or _payload.get("message") or _payload.get("message_template")
                    or _default_notification_message(instance, definition, template_context)
                )
                subject = _resolve_template(subject, template_context)
                message = _resolve_template(message, template_context)
                # Wrap in workflow context so that any audit rows emitted by
                # downstream callees (now or in future) are tagged correctly.
                with workflow_actor_context(
                    "workflow",
                    actor_type="workflow_engine",
                    actor_workflow_id=definition.id,
                ):
                    send_workflow_notification(
                        db,
                        tenant_id=instance.tenant_id,
                        user_ids=user_ids,
                        role_ids=role_ids,
                        channels=["in_app"],
                        workflow_instance_id=instance.id,
                        notification_type=config.get("alert_type") or "info",
                        subject=subject,
                        message=message,
                    )
                logger.info(
                    "workflow.step.execute.in_app_alert instance_id=%s step_id=%s node_key=%s users=%s roles=%s",
                    instance.id, step.id, step.node_key, user_ids, role_ids,
                )
                return {"status": "completed", "output": {"notified": True, "user_count": len(user_ids)}}

            # Tag every audit row written downstream by the action handler (and
            # any platform CRUD endpoint it calls into) with
            # ``actor_source="workflow"`` and ``actor_type="workflow_engine"``.
            # The actor_source tag prevents the trigger dispatcher from
            # re-firing workflows on these rows (loop prevention). The
            # actor_type tag ensures the Admin Audit Logs "Workflow Engine"
            # filter returns these rows correctly.
            with workflow_actor_context(
                "workflow",
                actor_type="workflow_engine",
                actor_workflow_id=definition.id,
            ):
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
            # Return "completed" so the runtime follows the rejection edge
            # (edge condition: step.approved == false) rather than failing
            # the whole workflow instance.
            return {
                "status": "completed",
                "output": {"approved": False, "rejected": True, "rejected_count": len(rejected)},
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

    # ------------------------------------------------------------------
    # Escalation node
    # ------------------------------------------------------------------
    # ── Escalation helpers ────────────────────────────────────────────────────
    @staticmethod
    def _escalation_wait_seconds(level: Dict[str, Any]) -> int:
        """Per-level wait before escalating to the NEXT level.

        Primary fields are ``wait_days`` + ``wait_hours`` (both can be set, e.g.
        2 days and 6 hours). Falls back to the legacy ``timeout_value`` +
        ``timeout_unit`` (days|hours) shape for older saved configs.
        """
        def _num(v) -> float:
            try:
                return float(v)
            except (TypeError, ValueError):
                return 0.0

        days = _num(level.get("wait_days"))
        hours = _num(level.get("wait_hours"))
        if days or hours:
            return int(days * 86400 + hours * 3600)

        raw_value = level.get("timeout_value")
        if raw_value is None:
            raw_value = level.get("timeout_hours")
        value = _num(raw_value)
        unit = str(level.get("timeout_unit") or "hours").strip().lower()
        if value:
            return int(value * (86400 if unit == "days" else 3600))
        return 0

    @staticmethod
    def _escalation_channels(level: Dict[str, Any]) -> list[str]:
        """Resolve which channels a level notifies on — defaults to BOTH
        in-app and email so an escalation is never silent."""
        raw = level.get("channels") or level.get("notification_channels")
        if isinstance(raw, list) and raw:
            out: list[str] = []
            for channel in raw:
                key = str(channel or "").strip().lower()
                if key in {"in_app", "in-app", "app"}:
                    out.append("in_app")
                elif key in {"email", "mail"}:
                    out.append("email")
            if out:
                return list(dict.fromkeys(out))
        return ["in_app", "email"]

    def _parse_escalation_levels(self, config: Dict[str, Any]) -> list[Dict[str, Any]]:
        """Normalise the node config into an ordered list of level dicts.

        Supports the new ``escalation_levels`` array AND the legacy flat
        single-level config (user_ids/role_ids/subject/message at top level)."""
        raw = config.get("escalation_levels")
        levels: list[Dict[str, Any]] = []
        if isinstance(raw, list):
            for idx, lv in enumerate(raw):
                if isinstance(lv, dict):
                    level = dict(lv)
                    level.setdefault("level", idx + 1)
                    levels.append(level)
        if levels:
            return levels

        # Legacy flat / AI-template single-level escalate node.
        user_ids = (
            config.get("user_ids")
            or config.get("escalate_to_user_ids")
            or config.get("escalate_user_ids")
            or []
        )
        role_ids = (
            config.get("role_ids")
            or config.get("escalate_to_role_ids")
            or config.get("escalate_role_ids")
            or []
        )
        return [
            {
                "level": 1,
                "user_ids": user_ids,
                "role_ids": role_ids,
                "subject": config.get("subject"),
                "message": config.get("message") or config.get("body") or config.get("reason"),
                "escalation_mode": "always",
            }
        ]

    @staticmethod
    def _escalation_condition_met(instance, step: WorkflowEngineStep, condition: Dict[str, Any]) -> bool:
        """Evaluate an ``on_condition`` escalation gate. Fail-open (escalate)
        when the condition is empty or evaluation errors, so a misconfigured
        condition never silently swallows an escalation."""
        if not isinstance(condition, dict) or not condition.get("path"):
            return True
        data = {
            "trigger": instance.trigger_payload or {},
            "context": instance.context or {},
            "step": step.input_payload or {},
        }
        try:
            return bool(ConditionEvaluator.evaluate(condition, data))
        except Exception:  # noqa: BLE001
            return True

    @staticmethod
    def _escalation_resolved(instance) -> bool:
        """Best-effort check for whether the escalated item was resolved before
        the next level fires — used by the ``if_unresolved_timeout`` rule."""
        resolved_states = {"resolved", "closed", "done", "mitigated", "completed"}
        ctx = instance.context or {}
        if ctx.get("resolved") is True:
            return True
        if str(ctx.get("status") or "").strip().lower() in resolved_states:
            return True
        tp = instance.trigger_payload or {}
        return str(tp.get("status") or "").strip().lower() in resolved_states

    def _send_escalation_level(
        self, db, instance, definition, step: WorkflowEngineStep,
        level: Dict[str, Any], ctx: Dict[str, Any], level_num: int, total: int,
    ) -> list[int]:
        """Notify one escalation level's recipients (users + roles) over the
        configured channels, with informative default subject/message, and
        audit it. Returns the resolved recipient user-id list."""
        user_ids = self._normalize_user_ids(level.get("user_ids") or [])
        role_ids = self._normalize_role_ids(level.get("role_ids") or [])

        subject = _resolve_template(str(level.get("subject") or ""), ctx).strip()
        if not subject:
            subject = f"Escalation Level {level_num}/{total}: {definition.name}"
        message = _resolve_template(str(level.get("message") or ""), ctx).strip()
        if not message:
            message = _default_notification_message(instance, definition, ctx)

        channels = self._escalation_channels(level)

        role_user_ids = self._resolve_role_user_ids(db, instance.tenant_id, role_ids)
        resolved_ids = list(dict.fromkeys([*user_ids, *role_user_ids]))

        # Fallback to the workflow owner so an escalation is never silently
        # dropped when a level has no recipients configured.
        if resolved_ids:
            send_user_ids, send_role_ids = user_ids, role_ids
        else:
            owner_ids = self._default_recipient_user_ids(definition)
            resolved_ids = owner_ids
            send_user_ids, send_role_ids = owner_ids, []

        if resolved_ids:
            send_workflow_notification(
                db,
                tenant_id=instance.tenant_id,
                user_ids=send_user_ids,
                role_ids=send_role_ids,
                channels=channels,
                workflow_instance_id=instance.id,
                notification_type="error" if level_num > 1 else "warning",
                subject=subject,
                message=message,
            )
        else:
            logger.warning(
                "workflow.step.escalation.no_targets instance_id=%s step_id=%s level=%s "
                "— add users or roles to this escalation level",
                instance.id, step.id, level_num,
            )

        db.add(
            WorkflowAuditLog(
                tenant_id=instance.tenant_id,
                workflow_definition_id=definition.id,
                workflow_instance_id=instance.id,
                workflow_step_id=step.id,
                event_type="step.escalation.level",
                message=(
                    f"Escalation level {level_num}/{total} at node {step.node_key}: "
                    f"notified {len(resolved_ids)} recipient(s) via {', '.join(channels)}"
                ),
                payload={
                    "level": level_num,
                    "total_levels": total,
                    "recipients": resolved_ids,
                    "channels": channels,
                    "subject": subject,
                },
            )
        )
        logger.info(
            "workflow.step.escalation.level instance_id=%s step_id=%s level=%s/%s "
            "recipients=%s channels=%s",
            instance.id, step.id, level_num, total, resolved_ids, channels,
        )
        return resolved_ids

    def _execute_escalation_node(self, db, instance, definition, step: WorkflowEngineStep, config: Dict[str, Any]) -> Dict[str, Any]:
        """Multi-level escalation node.

        Each level fires after its OWN configured delay — "Escalate after"
        (``wait_days`` + ``wait_hours``), measured from when the previous level
        fired (for Level 1, from when the workflow reaches this node; 0 =
        immediately). When a level's delay elapses, its rule is evaluated and,
        if it passes, the level notifies its users + roles (in-app + email):
          • always                — fire after the delay.
          • if_unresolved_timeout — fire only if the item is still unresolved
                                    when the delay elapses (the SLA case).
          • on_condition          — fire only if ``escalation_condition``
                                    ({path, operator, value}) evaluates true.

        Progress (``escalation_sent_levels``) AND which level's pre-delay has
        already elapsed (``escalation_awaited_level``) are persisted on
        ``step.output_payload`` so the node resumes correctly via the
        waiting_timer/next_run_at mechanism the timer node uses.
        """
        levels = self._parse_escalation_levels(config)
        total = len(levels)

        prev_output = step.output_payload if isinstance(step.output_payload, dict) else {}
        sent = int(prev_output.get("escalation_sent_levels") or 0)
        awaited = int(prev_output.get("escalation_awaited_level", -1))
        history = list(prev_output.get("escalation_history") or [])

        ctx = _build_template_context(db, instance, definition)

        while sent < total:
            level = levels[sent]

            # 1) Wait this level's "Escalate after" delay before it fires. The
            #    delay is measured from the previous level (node entry for L1).
            delay = self._escalation_wait_seconds(level)
            if delay > 0 and awaited != sent:
                run_at = datetime.utcnow() + timedelta(seconds=delay)
                logger.info(
                    "workflow.step.escalation.waiting instance_id=%s step_id=%s "
                    "level=%s fire_at=%s",
                    instance.id, step.id, sent + 1, run_at.isoformat(),
                )
                return {
                    "status": "waiting_timer",
                    "next_run_at": run_at,
                    "output": {
                        "escalated": sent > 0,
                        "escalation_sent_levels": sent,
                        "escalation_awaited_level": sent,  # this level's wait is now in flight
                        "escalation_history": history,
                        "pending_level": sent + 1,
                        "next_escalation_at": run_at.isoformat(),
                    },
                }

            # 2) Delay elapsed (or zero) — evaluate this level's rule, then fire.
            mode = str(level.get("escalation_mode") or "always").strip().lower()
            if mode == "if_unresolved_timeout" and self._escalation_resolved(instance):
                return self._finish_escalation(
                    db, instance, definition, step, sent, history,
                    stopped_reason="resolved",
                )
            if mode == "on_condition" and not self._escalation_condition_met(
                instance, step, level.get("escalation_condition") or {}
            ):
                return self._finish_escalation(
                    db, instance, definition, step, sent, history,
                    stopped_reason="condition_not_met",
                )

            recipients = self._send_escalation_level(
                db, instance, definition, step, level, ctx, sent + 1, total,
            )
            history.append({
                "level": sent + 1,
                "recipients": recipients,
                "at": datetime.utcnow().isoformat(),
            })
            sent += 1
            # awaited stays at the just-fired index; the next loop iteration has
            # sent > awaited, so the next level's delay is honoured.

        return self._finish_escalation(
            db, instance, definition, step, sent, history, all_levels=True,
        )

    def _finish_escalation(
        self, db, instance, definition, step: WorkflowEngineStep,
        sent: int, history: list, *, all_levels: bool = False, stopped_reason: str = "",
    ) -> Dict[str, Any]:
        """Terminal state for the escalation node — emits a summary audit row
        and returns ``completed`` so the workflow proceeds to the next node."""
        if stopped_reason:
            msg = f"Escalation stopped after level {sent}: {stopped_reason}"
        else:
            msg = f"Escalation complete — all {sent} level(s) notified"
        db.add(
            WorkflowAuditLog(
                tenant_id=instance.tenant_id,
                workflow_definition_id=definition.id,
                workflow_instance_id=instance.id,
                workflow_step_id=step.id,
                event_type="step.escalation.complete",
                message=msg,
                payload={"sent_levels": sent, "stopped_reason": stopped_reason or None},
            )
        )
        logger.info(
            "workflow.step.escalation.complete instance_id=%s step_id=%s sent_levels=%s reason=%s",
            instance.id, step.id, sent, stopped_reason or "all_levels",
        )
        return {
            "status": "completed",
            "output": {
                "escalated": sent > 0,
                "escalation_sent_levels": sent,
                "escalation_history": history,
                "all_levels_escalated": all_levels,
                "final_level": sent,
                "stopped_reason": stopped_reason or None,
            },
        }
