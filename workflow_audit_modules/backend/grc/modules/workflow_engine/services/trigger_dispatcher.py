from datetime import datetime
import logging
import os
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ....models import AuditLog, WorkflowDefinition
from .condition_evaluator import ConditionEvaluator
from ....rich_audit import write_rich_audit_log


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
        "delete": ["governance.delete"],
    },
    "compliance": {
        "create": ["compliance.create", "compliance_gap_detected", "compliance.gap_detected"],
        "update": ["assessment_status_change", "compliance.update",
                   "compliance.assessment_status_change", "compliance_gap_detected",
                   "compliance.certification_expiry_approaching"],
    },
    "compliance.plugin_runs": {
        "create": ["compliance.plugin_runs.create", "compliance.plugin_runs.trigger",
                   "cis_plugin_run_created"],
        "update": ["compliance.plugin_runs.update"],
        "execute": ["compliance.plugin_runs.execute", "compliance.plugin_runs.trigger",
                    "compliance.plugin_runs.create"],
        "failed": ["compliance.plugin_runs.failed", "compliance.plugin_runs.trigger"],
    },
    "assets": {
        "create": ["asset_created", "assets.create"],
        "update": ["asset_updated", "assets.update"],
        "delete": ["asset_deleted", "assets.delete"],
    },
    "audits": {
        "create": ["audit_finding_created", "audits.create", "audit.finding_created"],
        "update": ["audits.update"],
    },
    "control-library": {
        "create": ["control_group_created", "control-library.create"],
        "update": ["control_group_updated", "control-library.update"],
        "delete": ["control_group_deleted", "control-library.delete"],
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
}

# Mirror of scripts/workflow_validator.PATH_TO_RESOURCE — maps the legacy
# (URL module, URL entity) shape to the canonical resource name used by the
# v6 Pattern-B workflow catalog (e.g. `risk.risk_register.create`). Without
# this, real CRUD audit logs only fire the legacy `risk_created`-style
# workflows; the 153 Pattern-B workflows can't be reached.
_CANONICAL_RESOURCE_MAP: Dict[tuple, tuple] = {
    # /erm/* -> risk.<canonical_entity>
    ("erm", "risks"):                ("risk", "risk_register"),
    ("erm", "kris"):                 ("risk", "kris"),
    ("erm", "internal-controls"):    ("risk", "internal_controls"),
    ("erm", "internal_controls"):    ("risk", "internal_controls"),
    ("erm", "mitigation-actions"):   ("risk", "mitigation_actions"),
    ("erm", "mitigation_actions"):   ("risk", "mitigation_actions"),
    ("erm", "incidents"):            ("risk", "incidents"),
    ("erm", "rcsa"):                 ("risk", "rcsa"),
    ("erm", "reviews"):              ("risk", "reviews"),
    ("erm", "risk-assessments"):     ("risk", "risk_assessments"),
    ("erm", "risk_assessments"):     ("risk", "risk_assessments"),
    ("erm", "risk-framework"):       ("risk", "risk_framework"),
    ("erm", "risk_framework"):       ("risk", "risk_framework"),
    ("erm", "vendor-risk"):          ("risk", "vendor_risk"),
    ("erm", "vendor_risk"):          ("risk", "vendor_risk"),
    # Top-level shortcut routes used by some frontend pages
    ("vendor-risk", "*"):            ("risk", "vendor_risk"),
    ("vendor_risk", "*"):            ("risk", "vendor_risk"),
    # Compliance
    ("frameworks", "*"):                       ("compliance", "frameworks"),
    ("controls", "*"):                         ("compliance", "controls"),
    ("evidence", "*"):                         ("compliance", "evidence"),
    ("evidence-requirements", "*"):            ("compliance", "evidence_requirements"),
    ("evidence_requirements", "*"):            ("compliance", "evidence_requirements"),
    ("control-library", "*"):                  ("compliance", "control_library"),
    ("control_library", "*"):                  ("compliance", "control_library"),
    ("compliance", "statements"):              ("compliance", "statements"),
    ("compliance", "assessments"):             ("compliance", "assessments"),
    ("compliance", "frameworks"):              ("compliance", "frameworks"),
    ("compliance", "controls"):                ("compliance", "controls"),
    ("compliance", "evidence"):                ("compliance", "evidence"),
    ("compliance", "control-library"):         ("compliance", "control_library"),
    ("compliance", "control_library"):         ("compliance", "control_library"),
    # Governance
    ("governance", "documents"):               ("governance", "documents"),
    ("governance", "attestations"):            ("governance", "attestations"),
    # The UI POSTs attestation campaign creates to
    # /grc/governance/attestation-campaigns/campaigns — the canonical entity
    # in the v6 catalog is still "attestations", so alias it.
    ("governance", "attestation-campaigns"):   ("governance", "attestations"),
    ("governance", "attestation_campaigns"):   ("governance", "attestations"),
    ("governance", "committees"):              ("governance", "committees"),
    ("governance", "regulatory-changes"):      ("governance", "regulatory_changes"),
    ("governance", "regulatory_changes"):      ("governance", "regulatory_changes"),
    ("governance", "regulatory-feeds"):        ("governance", "regulatory_feeds"),
    ("governance", "regulatory_feeds"):        ("governance", "regulatory_feeds"),
    ("governance", "clause-coverage"):         ("governance", "clause_coverage"),
    ("governance", "clause_coverage"):         ("governance", "clause_coverage"),
    ("governance", "patch-proposals"):         ("governance", "patch_proposals"),
    ("governance", "patch_proposals"):         ("governance", "patch_proposals"),
    ("governance", "critical-rules"):          ("governance", "critical_rules"),
    ("governance", "critical_rules"):          ("governance", "critical_rules"),
    # Vulnerability management
    ("vulnerabilities", "departments"):        ("vulnmgmt", "departments"),
    ("vulnerabilities", "reports"):            ("vulnmgmt", "reports"),
    ("vulnerabilities", "sla"):                ("vulnmgmt", "sla_config"),
    ("vulnerabilities", "sla-config"):         ("vulnmgmt", "sla_config"),
    ("vulnerabilities", "sla_config"):         ("vulnmgmt", "sla_config"),
    ("vulnerabilities", "*"):                  ("vulnmgmt", "vulnerabilities"),
}


def _resolve_canonical_resource(module: str, entity: str) -> tuple:
    """Return (canonical_module, canonical_entity) for a (URL module, URL entity).
    Falls back to (None, None) when no mapping applies — callers should then
    use the legacy behaviour. The '*' wildcard entity matches whenever there's
    no more-specific (module, entity) mapping — including the common case
    where the second path segment is a numeric ID (e.g. /grc/evidence/4).
    """
    if (module, entity) in _CANONICAL_RESOURCE_MAP:
        return _CANONICAL_RESOURCE_MAP[(module, entity)]
    if (module, "*") in _CANONICAL_RESOURCE_MAP:
        return _CANONICAL_RESOURCE_MAP[(module, "*")]
    return (None, None)


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

        # Loop-prevention guard (Task #45 / T009). Skip audit rows that the
        # workflow engine itself wrote, so a workflow's own audit emissions can
        # never trigger another workflow run. NULL rows (legacy / pre-column)
        # and any non-"workflow" source (user, integration, cron, system) are
        # all eligible to fire workflows — the deny-list keeps integration and
        # automation events flowing while still cutting the self-loop.
        logs = (
            db.query(AuditLog)
            .filter(AuditLog.id > self.last_audit_log_id)
            .filter((AuditLog.actor_source == None) | (AuditLog.actor_source != "workflow"))  # noqa: E711
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
        path = str(changes.get("path") or changes.get("resource_url") or "").strip()
        if path:
            parts = [part for part in path.split("/") if part and part != "grc"]
            if len(parts) >= 2:
                module = parts[0].lower()
                entity = parts[1].lower()

                # Nested sub-resource paths like /erm/risks/{id}/mitigation-actions
                # need special handling: the FastAPI middleware logs the action
                # as the sub-resource name (e.g. "mitigation_actions") which
                # never matches a workflow trigger. Re-route to the canonical
                # sub-resource module so workflows for the child entity fire.
                if (
                    len(parts) >= 4
                    and parts[2].isdigit()
                    and action in (parts[3].lower().replace("-", "_"), "create", "update", "delete")
                ):
                    sub_entity = parts[3].lower()
                    sub_module = module
                    sub_v6_module, sub_v6_entity = _resolve_canonical_resource(sub_module, sub_entity)
                    # Treat the operation as a create on the sub-resource —
                    # POST is the only way it gets logged with the sub name.
                    sub_verb = "create" if action in (sub_entity.replace("-", "_"),) else action
                    if sub_v6_module and sub_v6_entity:
                        sub_event = f"{sub_v6_module}.{sub_v6_entity}.{sub_verb}"
                        if sub_event not in event_names:
                            event_names.append(sub_event)
                    # Also emit the generic compound form so legacy
                    # `risks.mitigation_actions.create` workflows match.
                    canonical_for_sub = _MODULE_ALIASES.get(sub_module, sub_module)
                    if canonical_for_sub != sub_entity:
                        generic_sub = f"{canonical_for_sub}.{sub_entity.replace('-', '_')}.{sub_verb}"
                        if generic_sub not in event_names:
                            event_names.append(generic_sub)

                # Normalise module name
                canonical = _MODULE_ALIASES.get(module, module)
                # Only add a generic compound event when the entity is distinct
                # from the canonical type.  Skipping when they are equal prevents
                # spurious events like 'risks.risks.create'.
                if not entity.isdigit() and canonical != entity:
                    generic = f"{canonical}.{entity}.{action}"
                    if generic not in event_names:
                        event_names.append(generic)

                # ALSO emit the v6-catalog canonical event name so Pattern-B
                # workflows (e.g. risk.risk_register.create) can match real
                # CRUD audit logs. Without this only legacy `<noun>_<verb>`
                # workflows fire.
                v6_module, v6_entity = _resolve_canonical_resource(module, entity)
                if v6_module and v6_entity:
                    v6_event = f"{v6_module}.{v6_entity}.{action}"
                    if v6_event not in event_names:
                        event_names.append(v6_event)
                    # Also emit the .trigger flavour for non-CRUD success actions
                    if (action not in ("create", "update", "delete", "read")
                            and not action.endswith("_failed")):
                        trig = f"{v6_module}.{v6_entity}.trigger"
                        if trig not in event_names:
                            event_names.append(trig)

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

                # Non-CRUD actions (ai_generate_charter, publish, review, etc.)
                # also emit a generic "{module}.{entity}.trigger" event so that
                # workflow definitions using the "trigger" verb can catch them.
                # Exclude failed actions (e.g. ai_generate_charter_failed) and
                # actions with non-success HTTP status codes.
                if action not in ("create", "update", "delete", "read") and not action.endswith("_failed"):
                    status_code = changes.get("status_code")
                    is_success = status_code is None or (isinstance(status_code, int) and status_code < 400)
                    if is_success:
                        trigger_event = f"{canonical}.{entity}.trigger"
                        if trigger_event not in event_names:
                            event_names.append(trigger_event)

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
                    try:
                        write_rich_audit_log(
                            db=db,
                            tenant_id=tenant_id,
                            user_id=None,
                            action="create",
                            resource_type="workflow_engine",
                            resource_id=definition.id,
                            resource_name=definition.name,
                            summary=f"Workflow Engine auto-triggered '{definition.name}' on event '{event_name}'",
                            actor_type="workflow_engine",
                            actor_workflow_id=definition.id,
                            after={"workflow_definition_id": definition.id, "trigger_event": event_name,
                                   "tenant_id": tenant_id, "correlation_id": event.get("correlation_id")},
                            resource_url=f"/workflow-engine/{definition.id}",
                            # Tag this audit row as workflow-originated so the dispatcher's
                            # poll filter (see poll_platform_events) skips it on the next
                            # cycle and we don't fire workflows on workflow-self-writes.
                            actor_source="workflow",
                        )
                        db.commit()
                    except Exception as _we:
                        logger.warning("workflow.dispatcher.audit_log_failed: %s", _we)

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
