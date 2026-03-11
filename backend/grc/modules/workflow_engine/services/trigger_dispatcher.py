from datetime import datetime
from typing import Any, Dict

from sqlalchemy.orm import Session

from ....models import AuditLog, WorkflowDefinition
from .condition_evaluator import ConditionEvaluator


class TriggerDispatcher:
    def __init__(self, event_queue):
        self.event_queue = event_queue
        self.last_audit_log_id = 0

    def poll_platform_events(self, db: Session) -> int:
        logs = (
            db.query(AuditLog)
            .filter(AuditLog.id > self.last_audit_log_id)
            .order_by(AuditLog.id.asc())
            .limit(200)
            .all()
        )

        processed = 0
        for log in logs:
            self.last_audit_log_id = max(self.last_audit_log_id, log.id)
            event_names = self._derive_event_names(log)
            payload = {
                "audit_log_id": log.id,
                "resource_type": log.resource_type,
                "resource_id": log.resource_id,
                "changes": log.changes or {},
                "timestamp": log.timestamp.isoformat() if log.timestamp else datetime.utcnow().isoformat(),
                "user_id": log.user_id,
            }
            for event_name in event_names:
                self.publish_event(
                    event_name=event_name,
                    tenant_id=log.tenant_id,
                    payload=payload,
                    correlation_id=f"audit:{log.id}",
                )
            processed += 1
        return processed

    @staticmethod
    def _derive_event_names(log: AuditLog) -> list[str]:
        action = (log.action or "read").strip().lower()
        resource_type = (log.resource_type or "system").strip().lower()
        event_names: list[str] = [f"{resource_type}.{action}"]

        changes = (log.changes or {}) if isinstance(log.changes, dict) else {}
        path = str(changes.get("path") or "").strip()
        if path:
            parts = [part for part in path.split("/") if part and part != "grc"]
            if len(parts) >= 2:
                module = parts[0].lower()
                entity = parts[1].lower()
                if not entity.isdigit():
                    event_names.append(f"{module}.{entity}.{action}")

                    aliases = {
                        "evidence-mgmt": "evidence",
                        "vuln-management": "vulnerabilities",
                        "framework-upload": "frameworks",
                    }
                    module_alias = aliases.get(module)
                    if module_alias:
                        event_names.append(f"{module_alias}.{entity}.{action}")

                    if module == "erm" and entity == "incidents":
                        event_names.append(f"incidents.{action}")

                # Semantic aliases for common GRC workflow use-cases.
                path_lower = path.lower()
                if module == "governance" and entity == "documents" and action == "create":
                    event_names.append("governance.policy_draft.created")
                    if "upload-file" in path_lower or "upload-with-file" in path_lower:
                        event_names.append("governance.documents.file_uploaded")

                if module in {"evidence-mgmt", "evidence"} and entity == "items" and action == "create":
                    if "upload" in path_lower:
                        event_names.append("evidence.items.uploaded")

        unique: list[str] = []
        for event in event_names:
            if event not in unique:
                unique.append(event)
        return unique

    def publish_event(self, event_name: str, tenant_id: int, payload: Dict[str, Any], correlation_id: str = None) -> None:
        self.event_queue.publish(
            {
                "kind": "event",
                "event_name": event_name,
                "tenant_id": tenant_id,
                "payload": payload or {},
                "correlation_id": correlation_id,
            }
        )

    def dispatch_event(self, db: Session, event: Dict[str, Any]) -> int:
        event_name = event.get("event_name")
        tenant_id = event.get("tenant_id")
        payload = event.get("payload") or {}

        if not event_name or not tenant_id:
            return 0

        definitions = db.query(WorkflowDefinition).filter(
            WorkflowDefinition.tenant_id == tenant_id,
            WorkflowDefinition.is_active == True,
            WorkflowDefinition.trigger_event == event_name,
        ).all()

        triggered = 0
        for definition in definitions:
            if ConditionEvaluator.evaluate(definition.trigger_conditions or {}, payload):
                self.event_queue.publish(
                    {
                        "kind": "start_instance",
                        "workflow_definition_id": definition.id,
                        "tenant_id": tenant_id,
                        "trigger_event": event_name,
                        "trigger_payload": payload,
                        "correlation_id": event.get("correlation_id"),
                    }
                )
                triggered += 1

        return triggered
