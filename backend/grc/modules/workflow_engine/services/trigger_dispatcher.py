from datetime import datetime
import logging
import os
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ....models import AuditLog, WorkflowDefinition
from .condition_evaluator import ConditionEvaluator


logger = logging.getLogger(__name__)


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


# ---------------------------------------------------------------------------
# Event name mapping: (resource_type, action) → [workflow trigger names]
# ---------------------------------------------------------------------------

_EVENT_MAP: Dict[str, Dict[str, List[str]]] = {
    "incidents": {
        "create": ["incident_reported", "incidents.create", "erm.incident_reported"],
        "update": ["incidents.update"],
    },
    "risks": {
        "create": ["risk_created", "risks.create", "risks.created"],
        "update": ["risk_updated", "risk_score_exceeds_threshold", "risk_status_changed", "risks.update",
                   "risks.status_changed", "risks.score_threshold_exceeded"],
        "delete": ["risk_deleted", "risks.delete"],
    },
    "evidence": {
        "create": ["evidence_uploaded", "evidence.create", "evidence.uploaded"],
        "update": ["evidence_approved", "evidence_expires", "evidence.update",
                   "evidence.approved", "evidence.expires"],
        "delete": ["evidence.delete"],
    },
    "vulnerabilities": {
        "create": ["vulnerability_created", "new_vulnerability_detected", "vulnerabilities.create", "vulnerabilities.detected"],
        "update": ["vulnerability_updated", "vulnerability_sla_breach", "vulnerability_sla_warning", "vulnerabilities.update",
                   "vulnerabilities.sla_breach", "vulnerabilities.sla_warning"],
        "delete": ["vulnerability_deleted", "vulnerabilities.delete"],
    },
    "kri": {
        "create": ["kri_breach", "kri.create", "erm.kri_breach"],
        "update": ["kri_breach", "kri.update", "erm.kri_breach"],
    },
    "policies": {
        "create": ["policies.create"],
        "update": ["policy_approved", "policies.update", "governance.policy_approved"],
        "submit_for_review": ["policy_submitted_for_review"],
    },
    "governance": {
        "create": ["governance.create"],
        "update": ["assessment_status_change", "control_review_due", "attestation_overdue",
                   "governance.update", "compliance.assessment_status_change",
                   "governance.control_review_due", "governance.attestation_overdue"],
    },
    "compliance": {
        "create": ["compliance.create", "compliance_gap_detected", "compliance.gap_detected"],
        "update": ["assessment_status_change", "compliance.update",
                   "compliance.assessment_status_change", "compliance_gap_detected",
                   "compliance.certification_expiry_approaching"],
    },
    "assets": {
        "create": ["asset_created", "assets.create"],
        "update": ["asset_updated", "assets.update"],
        "delete": ["asset_deleted", "assets.delete"],
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
        self._bootstrap_complete = False
        # Default behavior is real-time dispatch only; no historical replay flood on process restart.
        self.replay_historical_audits = _env_bool("WORKFLOW_DISPATCH_REPLAY_AUDIT_LOGS", False)
        # Read events are typically high-volume and low-signal for workflow automation.
        self.include_read_events = _env_bool("WORKFLOW_DISPATCH_INCLUDE_READ_EVENTS", False)

    def poll_platform_events(self, db: Session) -> int:
        if not self._bootstrap_complete:
            self._bootstrap_complete = True
            if not self.replay_historical_audits:
                latest_id = db.query(func.max(AuditLog.id)).scalar() or 0
                self.last_audit_log_id = int(latest_id)
                logger.info(
                    "workflow.dispatcher.bootstrap mode=tail latest_audit_log_id=%s",
                    self.last_audit_log_id,
                )

        logs = (
            db.query(AuditLog)
            .filter(AuditLog.id > self.last_audit_log_id)
            .order_by(AuditLog.id.asc())
            .limit(200)
            .all()
        )

        processed = 0
        skipped_read_logs = 0
        for log in logs:
            self.last_audit_log_id = max(self.last_audit_log_id, log.id)

            if (log.action or "").strip().lower() == "read" and not self.include_read_events:
                skipped_read_logs += 1
                continue

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

            logger.debug(
                "workflow.dispatcher.audit_log_processed audit_log_id=%s tenant_id=%s mapped_events=%s",
                log.id,
                log.tenant_id,
                len(event_names),
            )

        if processed or skipped_read_logs:
            logger.info(
                "workflow.dispatcher.poll_cycle processed_logs=%s skipped_read_logs=%s",
                processed,
                skipped_read_logs,
            )

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

        # Special: governance document submitted for review
        # Fires when PUT /{doc_id}/status is called with {"status": "pending_review"}
        if resource_type == "governance" and action == "update":
            changes_inner = (log.changes or {}) if isinstance(log.changes, dict) else {}
            requested = changes_inner.get("request") or {}
            if isinstance(requested, dict) and requested.get("status") == "pending_review":
                if "policy_submitted_for_review" not in event_names:
                    event_names.append("policy_submitted_for_review")

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
                # Only add a generic compound event when the entity is distinct
                # from the canonical type.  Skipping when they are equal prevents
                # spurious events like 'risks.risks.create'.
                if not entity.isdigit() and canonical != entity:
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
        logger.debug(
            "workflow.dispatcher.publish_event event_name=%s tenant_id=%s correlation_id=%s",
            event_name,
            tenant_id,
            correlation_id,
        )
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

        logger.debug(
            "workflow.dispatcher.dispatch_event.start event_name=%s tenant_id=%s correlation_id=%s",
            event_name,
            tenant_id,
            event.get("correlation_id"),
        )

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
                    logger.info(
                        "workflow.dispatcher.dispatch_event.triggered workflow_definition_id=%s event_name=%s tenant_id=%s",
                        definition.id,
                        event_name,
                        tenant_id,
                    )

        if triggered > 0:
            logger.info(
                "workflow.dispatcher.dispatch_event.done event_name=%s tenant_id=%s triggered=%s",
                event_name,
                tenant_id,
                triggered,
            )
        else:
            logger.info(
                "workflow.dispatcher.dispatch_event.no_match event_name=%s tenant_id=%s "
                "— no active workflow definition found for this trigger event",
                event_name,
                tenant_id,
            )

        return triggered
