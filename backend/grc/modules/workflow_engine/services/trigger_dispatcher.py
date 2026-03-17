from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from ....models import AuditLog, WorkflowDefinition
from .condition_evaluator import ConditionEvaluator


# ---------------------------------------------------------------------------
# Event name mapping: (resource_type, action) → [workflow trigger names]
# ---------------------------------------------------------------------------

_EVENT_MAP: Dict[str, Dict[str, List[str]]] = {
    "incidents": {
        "create": ["incident_reported", "incidents.create"],
        "update": ["incidents.update"],
    },
    "risks": {
        "create": ["risks.create"],
        "update": ["risk_score_exceeds_threshold", "risks.update"],
    },
    "evidence": {
        "create": ["evidence.create"],
        "update": ["evidence_expires", "evidence.update"],
        "delete": ["evidence.delete"],
    },
    "vulnerabilities": {
        "create": ["new_vulnerability_detected", "vulnerabilities.create"],
        "update": ["vulnerabilities.update"],
    },
    "kri": {
        "create": ["kri_breach", "kri.create"],
        "update": ["kri_breach", "kri.update"],
    },
    "policies": {
        "create": ["policy_review_due", "policies.create"],
        "update": ["policy_review_due", "policies.update"],
    },
    "governance": {
        "create": ["governance.create"],
        "update": ["assessment_status_change", "governance.update"],
    },
    "compliance": {
        "create": ["compliance.create"],
        "update": ["assessment_status_change", "compliance.update"],
    },
    "assets": {
        "create": ["assets.create"],
        "update": ["assets.update"],
    },
    "audits": {
        "create": ["audits.create"],
        "update": ["audits.update"],
    },
}

# Module path aliases → normalised resource type
_MODULE_ALIASES: Dict[str, str] = {
    "erm": "risks",
    "evidence-mgmt": "evidence",
    "vuln-management": "vulnerabilities",
    "framework-upload": "frameworks",
    "compliance": "compliance",
    "governance": "governance",
    "audit-management": "audits",
    "control-library": "controls",
}


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
            enriched_payload = self._build_payload(log)

            for event_name in event_names:
                self.publish_event(
                    event_name=event_name,
                    tenant_id=log.tenant_id,
                    payload=enriched_payload,
                    correlation_id=f"audit:{log.id}",
                )
            processed += 1

        return processed

    @staticmethod
    def _derive_event_names(log: AuditLog) -> List[str]:
        action = (log.action or "read").strip().lower()
        resource_type = (log.resource_type or "system").strip().lower()

        event_names: List[str] = [f"{resource_type}.{action}"]

        # Direct mapping from _EVENT_MAP
        resource_map = _EVENT_MAP.get(resource_type, {})
        for mapped_event in resource_map.get(action, []):
            if mapped_event not in event_names:
                event_names.append(mapped_event)

        # Path-based enrichment
        changes = (log.changes or {}) if isinstance(log.changes, dict) else {}
        path = str(changes.get("path") or "").strip()
        if path:
            parts = [part for part in path.split("/") if part and part != "grc"]
            if len(parts) >= 2:
                module = parts[0].lower()
                entity = parts[1].lower()

                # Normalise module name
                canonical = _MODULE_ALIASES.get(module, module)
                if not entity.isdigit():
                    generic = f"{canonical}.{entity}.{action}"
                    if generic not in event_names:
                        event_names.append(generic)

                # Apply entity-level event map after alias resolution
                entity_map = _EVENT_MAP.get(canonical, {})
                for mapped in entity_map.get(action, []):
                    if mapped not in event_names:
                        event_names.append(mapped)

                # Legacy erm.incidents special case
                if canonical == "risks" and entity == "incidents":
                    for mapped in _EVENT_MAP.get("incidents", {}).get(action, []):
                        if mapped not in event_names:
                            event_names.append(mapped)

        return event_names

    @staticmethod
    def _build_payload(log: AuditLog) -> Dict[str, Any]:
        """Build an enriched event payload from an audit log entry."""
        payload: Dict[str, Any] = {
            "audit_log_id": log.id,
            "resource_type": log.resource_type,
            "resource_id": log.resource_id,
            "action": log.action,
            "changes": log.changes or {},
            "timestamp": log.timestamp.isoformat() if log.timestamp else datetime.utcnow().isoformat(),
            "user_id": log.user_id,
            "tenant_id": log.tenant_id,
        }

        # Infer severity / score from changes for risk/vuln events
        changes = log.changes or {}
        if isinstance(changes, dict):
            if "risk_score" in changes:
                payload["risk_score"] = changes["risk_score"]
                try:
                    score = float(changes["risk_score"])
                    payload["severity"] = "critical" if score >= 20 else "high" if score >= 12 else "medium"
                except (TypeError, ValueError):
                    pass
            if "severity" in changes:
                payload["severity"] = changes["severity"]
            if "status" in changes:
                payload["status"] = changes["status"]

        return payload

    def publish_event(self, event_name: str, tenant_id: int, payload: Dict[str, Any], correlation_id: Optional[str] = None) -> None:
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

        # Match on exact trigger_event OR wildcard patterns (e.g. "risks.*")
        definitions = db.query(WorkflowDefinition).filter(
            WorkflowDefinition.tenant_id == tenant_id,
            WorkflowDefinition.is_active == True,
        ).all()

        triggered = 0
        for definition in definitions:
            trigger = definition.trigger_event or ""
            # Exact match or prefix wildcard (e.g. "risks.*" matches "risks.update")
            if trigger == event_name or (trigger.endswith(".*") and event_name.startswith(trigger[:-2])):
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
