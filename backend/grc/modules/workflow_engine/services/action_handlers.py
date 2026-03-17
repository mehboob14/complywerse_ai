from datetime import datetime, timedelta
from typing import Any, Dict, List
import json
import urllib.request

from ....models import (
    AuditFinding,
    ComplianceAssessmentDocumentItem,
    Evidence,
    FrameworkControl,
    GovernanceDocument,
    GRCUser,
    Risk,
    Role,
    TenantUser,
    UserRole,
    Vulnerability,
    WorkflowAuditLog,
)
from .condition_evaluator import ConditionEvaluator
from .email_service import send_email


# ---------------------------------------------------------------------------
# HTML email templates
# ---------------------------------------------------------------------------

def _notification_html(subject: str, body: str, cta_url: str = "", cta_label: str = "") -> str:
    cta = (
        f'<p style="margin:24px 0"><a href="{cta_url}" style="background:#2563eb;color:#fff;'
        f'padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">{cta_label}</a></p>'
        if cta_url else ""
    )
    return f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px">
      <h2 style="color:#1e293b">{subject}</h2>
      <p style="color:#475569;line-height:1.6">{body}</p>
      {cta}
      <hr style="border:none;border-top:1px solid #e2e8f0;margin-top:32px"/>
      <p style="font-size:12px;color:#94a3b8">Sent by ComplyVerse Workflow Engine</p>
    </div>
    """


def _get_manager_emails(db, tenant_id) -> List[str]:
    """Return email addresses of all active users in the tenant (fallback: all users)."""
    tenant_users = (
        db.query(GRCUser)
        .join(TenantUser, TenantUser.user_id == GRCUser.id)
        .filter(TenantUser.tenant_id == int(tenant_id), GRCUser.is_active.is_(True))
        .all()
    )
    return [u.email for u in tenant_users if u.email]


def _normalize_ids(values) -> List[int]:
    out: List[int] = []
    for v in values or []:
        try:
            parsed = int(v)
            if parsed > 0:
                out.append(parsed)
        except Exception:
            continue
    return out


def _emails_for_user_ids(db, user_ids: List[int]) -> List[str]:
    if not user_ids:
        return []
    users = db.query(GRCUser).filter(GRCUser.id.in_(user_ids), GRCUser.is_active.is_(True)).all()
    return [u.email for u in users if u.email]


def _emails_for_role_ids(db, tenant_id: int, role_ids: List[int]) -> List[str]:
    if not role_ids:
        return []
    rows = (
        db.query(GRCUser.email)
        .join(UserRole, UserRole.user_id == GRCUser.id)
        .join(Role, Role.id == UserRole.role_id)
        .filter(
            UserRole.tenant_id == int(tenant_id),
            Role.id.in_(role_ids),
            GRCUser.is_active.is_(True),
        )
        .distinct()
        .all()
    )
    return [r[0] for r in rows if r[0]]


def _parse_utc_timestamp(value: Any):
    if not value:
        return None
    try:
        s = str(value).strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        return datetime.fromisoformat(s)
    except Exception:
        return None


def _duration_to_seconds(value: Any, unit: str) -> int:
    try:
        amount = int(value)
    except Exception:
        amount = 0
    if amount <= 0:
        amount = 1
    unit = (unit or "hours").lower()
    if unit == "days":
        return amount * 86400
    return amount * 3600


def _is_resolved_context(instance) -> bool:
    status = str(getattr(instance, "status", "") or "").lower()
    if status in {"completed", "resolved", "closed", "cancelled"}:
        return True
    ctx = getattr(instance, "context", {}) or {}
    if bool(ctx.get("resolved") or ctx.get("is_resolved")):
        return True
    resolution_status = str(ctx.get("resolution_status") or "").lower()
    return resolution_status in {"resolved", "closed", "completed"}


# ---------------------------------------------------------------------------
# Main dispatcher
# ---------------------------------------------------------------------------

class WorkflowActionHandlers:
    @staticmethod
    def execute(db, instance, definition, node, config: Dict[str, Any]) -> Dict[str, Any]:
        action_name = (config or {}).get("action_name", "generic_action")
        payload = dict((config or {}).get("payload", {}) or {})
        # Allow action configuration either in config.payload or directly on config
        for k, v in (config or {}).items():
            if k in {"action_name", "payload"}:
                continue
            payload.setdefault(k, v)

        dispatch = {
            "create_risk_entry": WorkflowActionHandlers._create_risk_entry,
            "update_compliance_status": WorkflowActionHandlers._update_compliance_status,
            "create_audit_finding": WorkflowActionHandlers._create_audit_finding,
            "send_notification_email": WorkflowActionHandlers._send_notification_email,
            "request_evidence_upload": WorkflowActionHandlers._request_evidence_upload,
            "assign_control_owner": WorkflowActionHandlers._assign_control_owner,
            "generate_report": WorkflowActionHandlers._generate_report,
            "escalate_to_management": WorkflowActionHandlers._escalate_to_management,
            "call_webhook_api": WorkflowActionHandlers._call_webhook_api,
            # Cross-module integration actions
            "update_risk_status": WorkflowActionHandlers._update_risk_status,
            "trigger_policy_review": WorkflowActionHandlers._trigger_policy_review,
            "update_vuln_status": WorkflowActionHandlers._update_vuln_status,
            "update_asset_classification": WorkflowActionHandlers._update_asset_classification,
        }

        handler = dispatch.get(action_name)
        if handler:
            return handler(db, instance, definition, payload)

        if str(action_name).startswith("platform_action."):
            return WorkflowActionHandlers._execute_platform_capability_action(
                db,
                instance,
                definition,
                action_name,
                payload,
            )

        # Unknown action — log and return noop
        db.add(WorkflowAuditLog(
            tenant_id=instance.tenant_id,
            workflow_definition_id=definition.id,
            workflow_instance_id=instance.id,
            event_type=f"action.unknown",
            message=f"Unknown action: {action_name}",
            payload=payload,
        ))
        return {"action": action_name, "result": "noop"}

    @staticmethod
    def _execute_platform_capability_action(db, instance, definition, action_name: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        # Format: platform_action.<action>.<module>.<submodule>.<functionality>
        parts = (action_name or "").split(".")
        platform_action = parts[1] if len(parts) > 1 else "trigger"
        module_key = parts[2] if len(parts) > 2 else "general"
        submodule_key = parts[3] if len(parts) > 3 else "general"
        functionality_key = ".".join(parts[4:]) if len(parts) > 4 else "capability"
        endpoint = payload.get("endpoint")

        db.add(WorkflowAuditLog(
            tenant_id=instance.tenant_id,
            workflow_definition_id=definition.id,
            workflow_instance_id=instance.id,
            event_type="action.platform_capability",
            message=(
                f"Platform capability action queued: {platform_action} "
                f"({module_key}/{submodule_key}/{functionality_key})"
            ),
            payload={
                "action_name": action_name,
                "platform_action": platform_action,
                "module": module_key,
                "submodule": submodule_key,
                "functionality": functionality_key,
                "endpoint": endpoint,
                "input_payload": payload,
            },
        ))

        return {
            "action": action_name,
            "result": "queued",
            "platform_action": platform_action,
            "module": module_key,
            "submodule": submodule_key,
            "functionality": functionality_key,
            "endpoint": endpoint,
        }

    # ------------------------------------------------------------------
    # send_notification_email — uses tenant SMTP settings
    # ------------------------------------------------------------------
    @staticmethod
    def _send_notification_email(db, instance, definition, payload: Dict[str, Any]) -> Dict[str, Any]:
        to = payload.get("to") or payload.get("email")
        user_ids = _normalize_ids(payload.get("recipient_user_ids") or payload.get("user_ids") or [])
        role_ids = _normalize_ids(payload.get("recipient_role_ids") or payload.get("role_ids") or [])
        subject = payload.get("subject") or f"Workflow Notification: {definition.name}"
        body = payload.get("body") or payload.get("message") or "A workflow action has been triggered."

        recipients = []
        if to:
            recipients.extend([to] if isinstance(to, str) else to)
        recipients.extend(_emails_for_user_ids(db, user_ids))
        recipients.extend(_emails_for_role_ids(db, instance.tenant_id, role_ids))
        if not recipients:
            recipients = _get_manager_emails(db, instance.tenant_id)
        recipients = list(dict.fromkeys([r for r in recipients if r]))

        results = []
        for recipient in recipients:
            result = send_email(
                db,
                tenant_id=instance.tenant_id,
                to=recipient,
                subject=subject,
                body_html=_notification_html(subject, body),
                body_text=body,
            )
            results.append({"to": recipient, **result})

        db.add(WorkflowAuditLog(
            tenant_id=instance.tenant_id,
            workflow_definition_id=definition.id,
            workflow_instance_id=instance.id,
            event_type="action.send_notification_email",
            message=f"Notification email sent to {len(results)} recipient(s)",
            payload={"recipients": [r["to"] for r in results], "subject": subject},
        ))

        return {"action": "send_notification_email", "results": results}

    # ------------------------------------------------------------------
    # request_evidence_upload — creates a pending Evidence record
    # ------------------------------------------------------------------
    @staticmethod
    def _request_evidence_upload(db, instance, definition, payload: Dict[str, Any]) -> Dict[str, Any]:
        name = payload.get("name") or f"Evidence Request — {definition.name}"
        description = payload.get("description") or "Requested by workflow engine"
        assigned_user_id = payload.get("assigned_user_id")
        due_days = int(payload.get("due_days") or 7)
        expiry = datetime.utcnow() + timedelta(days=due_days)

        evidence = Evidence(
            tenant_id=instance.tenant_id,
            name=name,
            description=description,
            status="pending_review",
            uploaded_by=assigned_user_id,
            expiry_date=expiry,
            evidence_type=payload.get("evidence_type") or "document",
            source_system="workflow_engine",
        )
        db.add(evidence)
        db.flush()

        # Notify the assigned user if configured
        if assigned_user_id:
            user: GRCUser = db.query(GRCUser).filter(GRCUser.id == assigned_user_id).first()
            if user and user.email:
                subject = f"Evidence Upload Requested: {name}"
                body = (
                    f"You have been asked to upload evidence as part of the <b>{definition.name}</b> workflow.<br><br>"
                    f"<b>What to upload:</b> {name}<br>"
                    f"<b>Due by:</b> {expiry.strftime('%Y-%m-%d')}<br><br>"
                    f"Please log in to ComplyVerse and upload the required evidence."
                )
                send_email(db, instance.tenant_id, user.email, subject, _notification_html(subject, body))

        db.add(WorkflowAuditLog(
            tenant_id=instance.tenant_id,
            workflow_definition_id=definition.id,
            workflow_instance_id=instance.id,
            event_type="action.request_evidence_upload",
            message=f"Evidence upload requested: {name}",
            payload={"evidence_id": evidence.id, "name": name, "due_days": due_days},
        ))

        return {"action": "request_evidence_upload", "evidence_id": evidence.id}

    # ------------------------------------------------------------------
    # assign_control_owner — updates FrameworkControl owner or logs assignment
    # ------------------------------------------------------------------
    @staticmethod
    def _assign_control_owner(db, instance, definition, payload: Dict[str, Any]) -> Dict[str, Any]:
        control_id = payload.get("control_id")
        user_id = payload.get("user_id")

        result = "logged"

        if control_id:
            control = db.query(FrameworkControl).filter(
                FrameworkControl.id == int(control_id)
            ).first()
            if control:
                # Store as a string (user full name or email) if we can resolve it
                if user_id:
                    user: GRCUser = db.query(GRCUser).filter(GRCUser.id == int(user_id)).first()
                    if user:
                        control.control_owner = user.display_name or user.email
                        result = "updated"

                        # Notify the new owner
                        subject = f"You have been assigned as control owner: {control.name}"
                        body = (
                            f"You have been assigned as the owner of control <b>{control.code} — {control.name}</b> "
                            f"as part of the <b>{definition.name}</b> workflow."
                        )
                        send_email(db, instance.tenant_id, user.email, subject, _notification_html(subject, body))

        db.add(WorkflowAuditLog(
            tenant_id=instance.tenant_id,
            workflow_definition_id=definition.id,
            workflow_instance_id=instance.id,
            event_type="action.assign_control_owner",
            message=f"Control owner assignment: control_id={control_id}, user_id={user_id}",
            payload={"control_id": control_id, "user_id": user_id, "result": result},
        ))

        return {"action": "assign_control_owner", "control_id": control_id, "user_id": user_id, "result": result}

    # ------------------------------------------------------------------
    # generate_report — creates a WorkflowAuditLog record as the "report"
    # ------------------------------------------------------------------
    @staticmethod
    def _generate_report(db, instance, definition, payload: Dict[str, Any]) -> Dict[str, Any]:
        report_type = payload.get("report_type") or "workflow_summary"
        format_ = payload.get("format") or "json"
        recipients = payload.get("recipients") or []

        # Build a simple summary report from audit logs
        logs = (
            db.query(WorkflowAuditLog)
            .filter(WorkflowAuditLog.workflow_instance_id == instance.id)
            .order_by(WorkflowAuditLog.created_at)
            .all()
        )

        report_data = {
            "workflow_name": definition.name,
            "instance_id": instance.id,
            "generated_at": datetime.utcnow().isoformat(),
            "status": instance.status,
            "steps": [
                {
                    "event": log.event_type,
                    "message": log.message,
                    "timestamp": log.created_at.isoformat() if log.created_at else None,
                }
                for log in logs
            ],
        }

        # Email the report to recipients
        if recipients:
            subject = f"Workflow Report: {definition.name}"
            rows = "".join(
                f"<tr><td style='padding:6px;border:1px solid #e2e8f0'>{s['event']}</td>"
                f"<td style='padding:6px;border:1px solid #e2e8f0'>{s['message']}</td>"
                f"<td style='padding:6px;border:1px solid #e2e8f0'>{s['timestamp'] or ''}</td></tr>"
                for s in report_data["steps"]
            )
            body_html = f"""
            <h3>Workflow Report: {definition.name}</h3>
            <p>Status: <b>{instance.status}</b> | Generated: {report_data['generated_at']}</p>
            <table style='border-collapse:collapse;width:100%'>
              <thead>
                <tr>
                  <th style='padding:6px;border:1px solid #e2e8f0;background:#f8fafc'>Event</th>
                  <th style='padding:6px;border:1px solid #e2e8f0;background:#f8fafc'>Message</th>
                  <th style='padding:6px;border:1px solid #e2e8f0;background:#f8fafc'>Timestamp</th>
                </tr>
              </thead>
              <tbody>{rows}</tbody>
            </table>
            """
            for r in recipients:
                send_email(db, instance.tenant_id, r, subject, body_html)

        db.add(WorkflowAuditLog(
            tenant_id=instance.tenant_id,
            workflow_definition_id=definition.id,
            workflow_instance_id=instance.id,
            event_type="action.generate_report",
            message=f"Report generated: type={report_type}, format={format_}",
            payload=report_data,
        ))

        return {"action": "generate_report", "report_type": report_type, "steps_count": len(logs)}

    # ------------------------------------------------------------------
    # escalate_to_management — multi-level escalation with fallback to legacy flat config
    # -----------------------------------------------------------------------------------
    @staticmethod
    def _escalate_to_management(db, instance, definition, payload: Dict[str, Any]) -> Dict[str, Any]:
        escalation_levels = payload.get("escalation_levels")

        # ── New multi-level mode ──────────────────────────────────────────────
        if escalation_levels and isinstance(escalation_levels, list) and len(escalation_levels) > 0:
            instance_context = instance.context or {}
            escalation_state = dict(instance_context.get("escalation_state") or {})
            current_level_num = int(escalation_state.get("current_level") or instance_context.get("escalation_current_level") or 1)

            # Find the matching level config; fall back to first level
            level_cfg = next(
                (lv for lv in escalation_levels if lv.get("level") == current_level_num),
                escalation_levels[0],
            )

            # Escalation mode:
            # - always: send this level immediately
            # - if_unresolved_timeout: only when previous level has remained unresolved until timeout
            # - on_condition: only when escalation_condition evaluates true
            escalation_mode = str(level_cfg.get("escalation_mode") or "always").lower()
            if escalation_mode not in {"always", "if_unresolved_timeout", "on_condition"}:
                escalation_mode = "always"

            should_escalate = True
            skip_reason = ""

            if escalation_mode == "if_unresolved_timeout":
                if _is_resolved_context(instance):
                    should_escalate = False
                    skip_reason = "resolved_before_escalation"
                else:
                    previous_level = int(current_level_num) - 1
                    previous_cfg = next((lv for lv in escalation_levels if int(lv.get("level") or 0) == previous_level), None)
                    if previous_cfg:
                        timeout_value = (
                            previous_cfg.get("timeout_value")
                            if previous_cfg.get("timeout_value") is not None
                            else previous_cfg.get("timeout_hours", 24)
                        )
                        timeout_unit = str(previous_cfg.get("timeout_unit") or "hours")
                        required_delay = _duration_to_seconds(timeout_value, timeout_unit)
                        last_notified_at = _parse_utc_timestamp(escalation_state.get("last_notified_at"))
                        if last_notified_at:
                            elapsed = max(0, int((datetime.utcnow() - last_notified_at).total_seconds()))
                            if elapsed < required_delay:
                                should_escalate = False
                                skip_reason = "timeout_not_reached"
                    else:
                        # Level 1 behaves as immediate when no previous level exists.
                        should_escalate = True

            if escalation_mode == "on_condition":
                condition = level_cfg.get("escalation_condition") or payload.get("escalation_condition") or {}
                data = {
                    "trigger": instance.trigger_payload or {},
                    "context": instance_context,
                    "instance": {
                        "id": instance.id,
                        "status": instance.status,
                    },
                    "workflow": {
                        "id": definition.id,
                        "name": definition.name,
                    },
                }
                if not ConditionEvaluator.evaluate(condition, data):
                    should_escalate = False
                    skip_reason = "condition_not_met"

            if not should_escalate:
                db.add(WorkflowAuditLog(
                    tenant_id=instance.tenant_id,
                    workflow_definition_id=definition.id,
                    workflow_instance_id=instance.id,
                    event_type="action.escalate_to_management.skipped",
                    message=f"Escalation Level {current_level_num} skipped: {skip_reason}",
                    payload={
                        "level": current_level_num,
                        "mode": escalation_mode,
                        "reason": skip_reason,
                    },
                ))
                return {
                    "action": "escalate_to_management",
                    "level": current_level_num,
                    "status": "skipped",
                    "reason": skip_reason,
                    "mode": escalation_mode,
                }

            user_ids = _normalize_ids(level_cfg.get("user_ids") or [])
            role_ids = _normalize_ids(level_cfg.get("role_ids") or [])
            subject = level_cfg.get("subject") or f"Alert Level {current_level_num}: {definition.name}"
            message = level_cfg.get("message") or "This event requires your attention."

            recipients = list(dict.fromkeys(
                _emails_for_user_ids(db, user_ids)
                + _emails_for_role_ids(db, instance.tenant_id, role_ids)
            ))

            # Fallback to manager emails if no recipients configured
            if not recipients:
                recipients = _get_manager_emails(db, instance.tenant_id)

            body_html = (
                f"<b>Alert (Level {current_level_num}):</b> {definition.name}<br><br>"
                f"{message}<br><br>"
                f"<b>Instance ID:</b> {instance.id}<br>"
                f"<b>Triggered at:</b> {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}"
            )

            results = []
            for r in recipients:
                result = send_email(
                    db,
                    tenant_id=instance.tenant_id,
                    to=r,
                    subject=subject,
                    body_html=_notification_html(subject, body_html),
                    body_text=f"[Level {current_level_num}] {definition.name} — {message}",
                )
                results.append({"to": r, **result})

            # Advance the level counter and persist escalation timeline in context
            next_level_num = current_level_num + 1
            total_levels = len(escalation_levels)
            if instance.context is None:
                instance.context = {}
            instance.context = {
                **instance.context,
                "escalation_current_level": next_level_num,
                "escalation_state": {
                    **escalation_state,
                    "current_level": next_level_num,
                    "last_notified_level": current_level_num,
                    "last_notified_at": datetime.utcnow().isoformat(),
                },
            }
            try:
                db.add(instance)
                db.flush()
            except Exception:
                pass

            db.add(WorkflowAuditLog(
                tenant_id=instance.tenant_id,
                workflow_definition_id=definition.id,
                workflow_instance_id=instance.id,
                event_type="action.escalate_to_management",
                message=f"Escalation Level {current_level_num}/{total_levels}: notified {len(results)} recipient(s)",
                payload={
                    "level": current_level_num,
                    "total_levels": total_levels,
                    "mode": escalation_mode,
                    "recipients": [r["to"] for r in results],
                    "subject": subject,
                },
            ))
            return {
                "action": "escalate_to_management",
                "level": current_level_num,
                "total_levels": total_levels,
                "mode": escalation_mode,
                "escalated_to": len(results),
                "results": results,
            }

        # ── Legacy flat config (backward-compat) ─────────────────────────────
        reason = payload.get("reason") or "Escalation triggered by workflow engine"
        custom_recipients = payload.get("recipients")  # optional explicit list
        escalation_user_ids = _normalize_ids(payload.get("escalate_user_ids") or [])
        escalation_role_ids = _normalize_ids(payload.get("escalate_role_ids") or [])

        recipients = []
        if custom_recipients:
            recipients.extend(custom_recipients)
        recipients.extend(_emails_for_user_ids(db, escalation_user_ids))
        recipients.extend(_emails_for_role_ids(db, instance.tenant_id, escalation_role_ids))
        if not recipients:
            recipients = _get_manager_emails(db, instance.tenant_id)
        recipients = list(dict.fromkeys([r for r in recipients if r]))

        subject = f"Escalation Alert: {definition.name}"
        body = (
            f"A workflow has escalated to management attention.<br><br>"
            f"<b>Workflow:</b> {definition.name}<br>"
            f"<b>Instance ID:</b> {instance.id}<br>"
            f"<b>Reason:</b> {reason}<br>"
            f"<b>Escalated at:</b> {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}"
        )

        results = []
        for r in recipients:
            result = send_email(
                db,
                tenant_id=instance.tenant_id,
                to=r,
                subject=subject,
                body_html=_notification_html(subject, body),
                body_text=f"{definition.name} — {reason}",
            )
            results.append({"to": r, **result})

        db.add(WorkflowAuditLog(
            tenant_id=instance.tenant_id,
            workflow_definition_id=definition.id,
            workflow_instance_id=instance.id,
            event_type="action.escalate_to_management",
            message=f"Escalated to {len(results)} manager(s): {reason}",
            payload={"recipients": [r["to"] for r in results], "reason": reason},
        ))

        return {"action": "escalate_to_management", "escalated_to": len(results), "results": results}

    # ------------------------------------------------------------------
    # Already-implemented actions (unchanged)
    # ------------------------------------------------------------------
    @staticmethod
    def _create_risk_entry(db, instance, definition, payload: Dict[str, Any]) -> Dict[str, Any]:
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
    def _update_compliance_status(db, instance, definition, payload: Dict[str, Any]) -> Dict[str, Any]:
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
    def _create_audit_finding(db, instance, definition, payload: Dict[str, Any]) -> Dict[str, Any]:
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
            db.add(WorkflowAuditLog(
                tenant_id=instance.tenant_id,
                workflow_definition_id=definition.id,
                workflow_instance_id=instance.id,
                event_type="action.call_webhook_api",
                message="Outbound webhook invoked",
                payload={"url": url, "method": method, "status": status},
            ))
            return {"action": "call_webhook_api", "result": "sent", "status": status}
        except Exception as exc:
            db.add(WorkflowAuditLog(
                tenant_id=instance.tenant_id,
                workflow_definition_id=definition.id,
                workflow_instance_id=instance.id,
                event_type="action.call_webhook_api_failed",
                message="Outbound webhook failed",
                payload={"url": url, "method": method, "error": str(exc)},
            ))
            return {"action": "call_webhook_api", "result": "failed", "error": str(exc)}

    # ------------------------------------------------------------------
    # Cross-module integration actions
    # ------------------------------------------------------------------

    @staticmethod
    def _update_risk_status(db, instance, definition, payload: Dict[str, Any]) -> Dict[str, Any]:
        risk_id = payload.get("risk_id")
        new_status = payload.get("status")
        if not risk_id or not new_status:
            return {"action": "update_risk_status", "result": "missing_fields"}

        risk = db.query(Risk).filter(
            Risk.id == int(risk_id),
            Risk.tenant_id == instance.tenant_id,
        ).first()
        if not risk:
            return {"action": "update_risk_status", "result": "risk_not_found"}

        risk.status = new_status
        if payload.get("treatment_plan"):
            risk.treatment_plan = payload["treatment_plan"]

        db.add(WorkflowAuditLog(
            tenant_id=instance.tenant_id,
            workflow_definition_id=definition.id,
            workflow_instance_id=instance.id,
            event_type="action.update_risk_status",
            message=f"Risk #{risk_id} status updated to '{new_status}'",
            payload={"risk_id": risk_id, "status": new_status},
        ))
        return {"action": "update_risk_status", "risk_id": risk_id, "status": new_status}

    @staticmethod
    def _trigger_policy_review(db, instance, definition, payload: Dict[str, Any]) -> Dict[str, Any]:
        doc_id = payload.get("document_id")
        if not doc_id:
            return {"action": "trigger_policy_review", "result": "missing_document_id"}

        doc = db.query(GovernanceDocument).filter(
            GovernanceDocument.id == int(doc_id),
            GovernanceDocument.tenant_id == instance.tenant_id,
        ).first()
        if not doc:
            return {"action": "trigger_policy_review", "result": "document_not_found"}

        doc.status = "review_required"
        doc.next_review_date = datetime.utcnow()

        db.add(WorkflowAuditLog(
            tenant_id=instance.tenant_id,
            workflow_definition_id=definition.id,
            workflow_instance_id=instance.id,
            event_type="action.trigger_policy_review",
            message=f"Policy review triggered for document #{doc_id}",
            payload={"document_id": doc_id},
        ))
        return {"action": "trigger_policy_review", "document_id": doc_id, "status": "review_required"}

    @staticmethod
    def _update_vuln_status(db, instance, definition, payload: Dict[str, Any]) -> Dict[str, Any]:
        vuln_id = payload.get("vulnerability_id")
        new_status = payload.get("status")
        if not vuln_id or not new_status:
            return {"action": "update_vuln_status", "result": "missing_fields"}

        vuln = db.query(Vulnerability).filter(
            Vulnerability.id == int(vuln_id),
            Vulnerability.tenant_id == instance.tenant_id,
        ).first()
        if not vuln:
            return {"action": "update_vuln_status", "result": "vulnerability_not_found"}

        vuln.status = new_status
        if new_status == "resolved":
            vuln.resolved_at = datetime.utcnow()
        if payload.get("resolution_notes"):
            vuln.resolution_notes = payload["resolution_notes"]

        db.add(WorkflowAuditLog(
            tenant_id=instance.tenant_id,
            workflow_definition_id=definition.id,
            workflow_instance_id=instance.id,
            event_type="action.update_vuln_status",
            message=f"Vulnerability #{vuln_id} status updated to '{new_status}'",
            payload={"vulnerability_id": vuln_id, "status": new_status},
        ))
        return {"action": "update_vuln_status", "vulnerability_id": vuln_id, "status": new_status}

    @staticmethod
    def _update_asset_classification(db, instance, definition, payload: Dict[str, Any]) -> Dict[str, Any]:
        from ....models import ITAsset
        asset_id = payload.get("asset_id")
        classification = payload.get("classification")
        if not asset_id or not classification:
            return {"action": "update_asset_classification", "result": "missing_fields"}

        asset = db.query(ITAsset).filter(
            ITAsset.id == int(asset_id),
            ITAsset.tenant_id == instance.tenant_id,
        ).first()
        if not asset:
            return {"action": "update_asset_classification", "result": "asset_not_found"}

        # ITAsset uses 'criticality' field (low/medium/high/critical)
        asset.criticality = classification

        db.add(WorkflowAuditLog(
            tenant_id=instance.tenant_id,
            workflow_definition_id=definition.id,
            workflow_instance_id=instance.id,
            event_type="action.update_asset_classification",
            message=f"Asset #{asset_id} classification updated to '{classification}'",
            payload={"asset_id": asset_id, "classification": classification},
        ))
        return {"action": "update_asset_classification", "asset_id": asset_id, "classification": classification}
