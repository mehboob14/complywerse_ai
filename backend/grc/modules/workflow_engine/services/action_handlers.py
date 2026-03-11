from datetime import datetime
from typing import Any, Dict
import json
import urllib.request

from ....models import (
    AuditFinding,
    ComplianceAssessmentDocumentItem,
    Risk,
    WorkflowAuditLog,
)
from .email_service import WorkflowEmailService
from .recipient_resolver import WorkflowRecipientResolver


class WorkflowActionHandlers:
    @staticmethod
    def execute(db, instance, definition, node, config: Dict[str, Any]) -> Dict[str, Any]:
        action_name = (config or {}).get("action_name", "generic_action")
        payload = (config or {}).get("payload", {})

        if action_name == "create_risk_entry":
            return WorkflowActionHandlers._create_risk_entry(db, instance, payload)

        if action_name == "update_compliance_status":
            return WorkflowActionHandlers._update_compliance_status(db, payload)

        if action_name == "create_audit_finding":
            return WorkflowActionHandlers._create_audit_finding(db, instance, payload)

        if action_name in {
            "request_evidence_upload",
            "assign_control_owner",
            "generate_report",
            "escalate_to_management",
        }:
            db.add(
                WorkflowAuditLog(
                    tenant_id=instance.tenant_id,
                    workflow_definition_id=definition.id,
                    workflow_instance_id=instance.id,
                    event_type=f"action.{action_name}",
                    message=f"Executed action {action_name}",
                    payload=payload,
                )
            )
            return {"action": action_name, "result": "logged"}

        if action_name == "send_notification_email":
            return WorkflowActionHandlers._send_notification_email(db, instance, definition, payload)

        if action_name == "call_webhook_api":
            return WorkflowActionHandlers._call_webhook_api(db, instance, definition, payload)

        return {"action": action_name, "result": "noop"}

    @staticmethod
    def _create_risk_entry(db, instance, payload: Dict[str, Any]) -> Dict[str, Any]:
        title = payload.get("title") or f"Workflow-generated risk {datetime.utcnow().isoformat()}"
        category = payload.get("category") or "operational"
        risk = Risk(
            tenant_id=instance.tenant_id,
            title=title,
            description=payload.get("description"),
            category=category,
            risk_category=payload.get("risk_category") or category,
            owner_id=payload.get("owner_id"),
            status=payload.get("status") or "open",
            treatment_plan=payload.get("treatment_plan"),
        )
        db.add(risk)
        db.flush()
        return {"action": "create_risk_entry", "risk_id": risk.id}

    @staticmethod
    def _update_compliance_status(db, payload: Dict[str, Any]) -> Dict[str, Any]:
        item_id = payload.get("assessment_item_id")
        new_status = payload.get("status")
        if not item_id or not new_status:
            return {"action": "update_compliance_status", "result": "missing_fields"}

        item = db.query(ComplianceAssessmentDocumentItem).filter(
            ComplianceAssessmentDocumentItem.id == int(item_id)
        ).first()
        if not item:
            return {"action": "update_compliance_status", "result": "item_not_found"}

        item.compliance_status = new_status
        item.remarks = payload.get("remarks") or item.remarks
        return {"action": "update_compliance_status", "assessment_item_id": item.id, "status": item.compliance_status}

    @staticmethod
    def _create_audit_finding(db, instance, payload: Dict[str, Any]) -> Dict[str, Any]:
        engagement_id = payload.get("engagement_id")
        title = payload.get("title")
        if not engagement_id or not title:
            return {"action": "create_audit_finding", "result": "missing_engagement_or_title"}

        finding = AuditFinding(
            tenant_id=instance.tenant_id,
            engagement_id=int(engagement_id),
            title=title,
            condition=payload.get("condition"),
            criteria=payload.get("criteria"),
            cause=payload.get("cause"),
            effect=payload.get("effect"),
            severity=payload.get("severity") or "medium",
            status=payload.get("status") or "open",
            owner_id=payload.get("owner_id"),
            ai_generated=bool(payload.get("ai_generated", False)),
        )
        db.add(finding)
        db.flush()
        return {"action": "create_audit_finding", "finding_id": finding.id}

    @staticmethod
    def _send_notification_email(db, instance, definition, payload: Dict[str, Any]) -> Dict[str, Any]:
        user_ids = payload.get("user_ids") or []
        role_ids = payload.get("role_ids") or []
        role_names = payload.get("role_names") or []

        resolved_user_ids = WorkflowRecipientResolver.resolve_user_ids(
            db=db,
            tenant_id=instance.tenant_id,
            user_ids=user_ids,
            role_ids=role_ids,
            role_names=role_names,
        )

        if payload.get("include_trigger_user"):
            trigger_user_id = (instance.trigger_payload or {}).get("user_id")
            if trigger_user_id:
                resolved_user_ids = sorted({*resolved_user_ids, int(trigger_user_id)})

        recipients = WorkflowRecipientResolver.resolve_emails_for_users(
            db=db,
            tenant_id=instance.tenant_id,
            user_ids=resolved_user_ids,
        )

        subject = payload.get("subject") or f"Workflow notification: {definition.name}"
        trigger_resource = (instance.trigger_payload or {}).get("resource_type")
        trigger_resource_id = (instance.trigger_payload or {}).get("resource_id")
        default_body = (
            f"<p>Workflow <strong>{definition.name}</strong> has an update.</p>"
            f"<p>Instance ID: {instance.id}</p>"
            f"<p>Triggered by: {trigger_resource or 'system'}"
            f"{f' #{trigger_resource_id}' if trigger_resource_id else ''}</p>"
        )
        body = payload.get("body_html") or default_body

        result = WorkflowEmailService.send_email(
            recipients=recipients,
            subject=subject,
            body=body,
        )

        db.add(
            WorkflowAuditLog(
                tenant_id=instance.tenant_id,
                workflow_definition_id=definition.id,
                workflow_instance_id=instance.id,
                event_type="action.send_notification_email",
                message="Notification email action executed",
                payload={
                    "recipient_user_ids": resolved_user_ids,
                    "recipient_emails": recipients,
                    "subject": subject,
                    "send_result": result,
                },
            )
        )
        return {
            "action": "send_notification_email",
            "result": "sent" if result.get("sent") else "failed",
            "details": result,
        }

    @staticmethod
    def _call_webhook_api(db, instance, definition, payload: Dict[str, Any]) -> Dict[str, Any]:
        url = payload.get("url")
        method = str(payload.get("method") or "POST").upper()
        headers = payload.get("headers") or {}
        body = payload.get("body") or {}

        if not url:
            return {"action": "call_webhook_api", "result": "missing_url"}

        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(body).encode("utf-8"),
                headers={"Content-Type": "application/json", **headers},
                method=method,
            )
            with urllib.request.urlopen(req, timeout=8) as response:
                status = int(getattr(response, "status", 200))
            db.add(
                WorkflowAuditLog(
                    tenant_id=instance.tenant_id,
                    workflow_definition_id=definition.id,
                    workflow_instance_id=instance.id,
                    event_type="action.call_webhook_api",
                    message="Outbound webhook invoked",
                    payload={"url": url, "method": method, "status": status},
                )
            )
            return {"action": "call_webhook_api", "result": "sent", "status": status}
        except Exception as exc:
            db.add(
                WorkflowAuditLog(
                    tenant_id=instance.tenant_id,
                    workflow_definition_id=definition.id,
                    workflow_instance_id=instance.id,
                    event_type="action.call_webhook_api_failed",
                    message="Outbound webhook failed",
                    payload={"url": url, "method": method, "error": str(exc)},
                )
            )
            return {"action": "call_webhook_api", "result": "failed", "error": str(exc)}
