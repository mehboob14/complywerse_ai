from datetime import datetime, timedelta
from typing import Any, Dict, List
import json
import logging
import urllib.request

logger = logging.getLogger(__name__)

from ....models import (
    ComplianceAssessmentDocumentItem,
    Evidence,
    FrameworkControl,
    GovernanceDocument,
    GRCUser,
    ITAsset,
    Risk,
    RiskIncident,
    Role,
    TenantUser,
    UserRole,
    Vulnerability,
    VulnerabilitySLAConfig,
    WorkflowAuditLog,
    WorkflowNotification,
)
from .condition_evaluator import ConditionEvaluator
from .email_service import send_email


# ---------------------------------------------------------------------------
# Dynamic email template helpers
# ---------------------------------------------------------------------------

import re as _re


def _resolve_template(text: str, context: Dict[str, Any]) -> str:
    """Replace {{key}} placeholders with values from context dict."""
    def _sub(m: "_re.Match") -> str:
        key = m.group(1).strip()
        val = context.get(key)
        # Return the value if found, otherwise blank (never keep {{placeholder}} text)
        return str(val) if val is not None else ""
    return _re.sub(r'\{\{([^}]+)\}\}', _sub, text)


def _build_template_context(db, instance, definition) -> Dict[str, Any]:
    """Build a flat template-variable context from the workflow trigger payload."""
    payload: Dict[str, Any] = instance.trigger_payload or {}
    resource_type = str(payload.get("resource_type") or "").lower()
    resource_id = payload.get("resource_id")

    ctx: Dict[str, Any] = {
        "workflow_name":    definition.name or "",
        "event_timestamp":  payload.get("timestamp", datetime.utcnow().isoformat()),
        "resource_type":    resource_type,
        "resource_id":      str(resource_id or ""),
        "action":           payload.get("action", ""),
        "tenant_id":        str(instance.tenant_id),
        "severity":         str(payload.get("severity") or ""),
        "status":           str(payload.get("status") or ""),
        "created_by_name":  "",
        "created_by_email": "",
    }

    # Resolve the user who triggered the event
    triggered_by_id = payload.get("user_id")
    if triggered_by_id:
        try:
            actor: Any = db.query(GRCUser).filter(GRCUser.id == int(triggered_by_id)).first()
            if actor:
                ctx["created_by_name"]  = actor.display_name or actor.username or ""
                ctx["created_by_email"] = actor.email or ""
        except Exception:
            pass

    # Merge flat keys from the audit-log changes dict (top-level, e.g. severity/status)
    changes = payload.get("changes") or {}
    if isinstance(changes, dict):
        for k, v in changes.items():
            if k not in ("request", "query") and v is not None and k not in ctx:
                ctx[k] = str(v)

    # Also unpack the stored request body (populated on create where resource_id
    # is absent from the URL, e.g. POST /grc/erm/risks).
    # This gives us title, description, category, due_date, owner_id, etc.
    request_body: Dict[str, Any] = {}
    if isinstance(changes, dict):
        request_body = changes.get("request") or {}
    if isinstance(request_body, dict):
        # Use request_body values even if key already exists in ctx (pre-initialized as "")
        # so that real values like status="open" overwrite the empty-string defaults.
        for k, v in request_body.items():
            if v is not None and (k not in ctx or ctx.get(k) == ""):
                ctx[k] = str(v)

    # For create events resource_id is None (POST URL has no ID), but the record
    # was already committed before the audit log fired.  Find it by title/name so
    # the full DB enrichment block below can run.
    if not resource_id:
        _lookup_title = request_body.get("title") or ctx.get("title")
        _lookup_name  = request_body.get("name")  or ctx.get("name")
        try:
            if resource_type == "risks" and _lookup_title:
                _found = db.query(Risk).filter(
                    Risk.tenant_id == instance.tenant_id,
                    Risk.title == _lookup_title,
                ).order_by(Risk.id.desc()).first()
                if _found:
                    resource_id = _found.id
            elif resource_type == "vulnerabilities" and _lookup_title:
                _found = db.query(Vulnerability).filter(
                    Vulnerability.tenant_id == instance.tenant_id,
                    Vulnerability.title == _lookup_title,
                ).order_by(Vulnerability.id.desc()).first()
                if _found:
                    resource_id = _found.id
            elif resource_type == "evidence" and _lookup_name:
                _found = db.query(Evidence).filter(
                    Evidence.tenant_id == instance.tenant_id,
                    Evidence.name == _lookup_name,
                ).order_by(Evidence.id.desc()).first()
                if _found:
                    resource_id = _found.id
        except Exception:
            pass

    # If we still have no resource_id, do best-effort enrichment from request
    # body field aliases and bail out (no DB enrichment possible).
    if not resource_id:
        # risk_category → category  (frontend field name differs from DB column)
        if not ctx.get("category") and request_body.get("risk_category"):
            ctx["category"] = str(request_body["risk_category"])
        # owner lookup: frontend may send business_owner_id or owner_id
        owner_id_raw = request_body.get("owner_id") or request_body.get("business_owner_id")
        if owner_id_raw:
            try:
                owner_user: Any = db.query(GRCUser).filter(GRCUser.id == int(owner_id_raw)).first()
                if owner_user:
                    ctx["owner_name"]  = owner_user.display_name or owner_user.username or ""
                    ctx["owner_email"] = owner_user.email or ""
            except Exception:
                pass
        return ctx

    # DB enrichment — fetch the full record for authoritative values.

    try:
        rid = int(resource_id)
        tid = instance.tenant_id

        if resource_type == "risks":
            obj: Any = db.query(Risk).filter(Risk.id == rid, Risk.tenant_id == tid).first()
            if obj:
                ctx.update({
                    "title":          obj.title or "",
                    "description":    obj.description or "",
                    "category":       obj.category or "",
                    "status":         obj.status or "",
                    "inherent_score": str(obj.inherent_score or ""),
                    "residual_score": str(obj.residual_score or ""),
                    "risk_appetite":  obj.risk_appetite or "",
                    "due_date":       obj.due_date.strftime("%Y-%m-%d") if obj.due_date else "",
                    "register_type":  obj.register_type or "",
                    "risk_sub_category": obj.risk_sub_category or "",
                })
                # Risk owner — check owner_id first, fall back to business_owner_id
                resolved_owner_id = obj.owner_id or getattr(obj, 'business_owner_id', None)
                if resolved_owner_id:
                    owner_user = db.query(GRCUser).filter(GRCUser.id == resolved_owner_id).first()
                    if owner_user:
                        ctx["owner_name"]  = owner_user.display_name or owner_user.username or ""
                        ctx["owner_email"] = owner_user.email or ""
            else:
                # Record was deleted — populate from request body or path context
                ctx["deleted_resource_id"] = str(rid)
                if not ctx.get("title"):
                    ctx["title"] = request_body.get("title") or f"Risk #{rid}"
                if not ctx.get("category") and request_body.get("risk_category"):
                    ctx["category"] = str(request_body["risk_category"])

        elif resource_type == "evidence":
            obj = db.query(Evidence).filter(Evidence.id == rid, Evidence.tenant_id == tid).first()
            if obj:
                ctx.update({
                    "name":          obj.name or "",
                    "description":   obj.description or "",
                    "status":        obj.status or "",
                    "evidence_type": obj.evidence_type or "",
                    "file_name":     obj.file_name or "",
                    "expiry_date":   obj.expiry_date.strftime("%Y-%m-%d") if obj.expiry_date else "",
                    "quality_score": str(obj.quality_score or ""),
                    "version":       str(obj.version or ""),
                })

        elif resource_type == "vulnerabilities":
            obj = db.query(Vulnerability).filter(Vulnerability.id == rid, Vulnerability.tenant_id == tid).first()
            if obj:
                ctx.update({
                    "title":              obj.title or "",
                    "description":        obj.description or "",
                    "severity":           obj.severity or "",
                    "cvss_score":         str(obj.cvss_score or ""),
                    "status":             obj.status or "",
                    "cve_id":             obj.cve_id or "",
                    "cwe_id":             obj.cwe_id or "",
                    "affected_component": obj.affected_component or "",
                    "affected_host":      obj.affected_host or "",
                    "affected_url":       obj.affected_url or "",
                    "due_date":           obj.due_date.strftime("%Y-%m-%d") if obj.due_date else "",
                    "vuln_id":            obj.vuln_id or "",
                    "recommendation":     obj.recommendation or obj.ai_recommendation or "",
                    "remediation_plan":   obj.recommendation or obj.ai_recommendation or "",
                })
                # SLA config: look up remediation_days by severity
                if obj.severity:
                    try:
                        sla = db.query(VulnerabilitySLAConfig).filter(
                            VulnerabilitySLAConfig.tenant_id == tid,
                            VulnerabilitySLAConfig.severity == obj.severity.lower(),
                            VulnerabilitySLAConfig.is_active.is_(True),
                        ).first()
                        if sla:
                            ctx["sla_remediation_days"] = str(sla.remediation_days)
                            # Compute SLA due date from discovered_at if not already set
                            if not ctx.get("due_date") or ctx["due_date"] == "":
                                discovered = obj.discovered_at or obj.created_at or datetime.utcnow()
                                ctx["sla_due_date"] = (discovered + timedelta(days=sla.remediation_days)).strftime("%Y-%m-%d")
                            else:
                                ctx["sla_due_date"] = ctx["due_date"]
                    except Exception:
                        pass
                # Assignee (owner)
                resolved_assignee_id = obj.assigned_to
                if resolved_assignee_id:
                    try:
                        assignee = db.query(GRCUser).filter(GRCUser.id == resolved_assignee_id).first()
                        if assignee:
                            ctx["assignee_name"]  = assignee.display_name or assignee.username or ""
                            ctx["assignee_email"] = assignee.email or ""
                            ctx["owner_name"]     = ctx["assignee_name"]
                            ctx["owner_email"]    = ctx["assignee_email"]
                    except Exception:
                        pass

            else:
                # Record was deleted — populate from context
                ctx["deleted_resource_id"] = str(rid)
                if not ctx.get("title"):
                    ctx["title"] = request_body.get("title") or f"Vulnerability #{rid}"

        elif resource_type == "incidents":
            obj = db.query(RiskIncident).filter(RiskIncident.id == rid, RiskIncident.tenant_id == tid).first()
            if obj:
                ctx.update({
                    "title":            obj.title or "",
                    "description":      obj.description or "",
                    "severity":         obj.severity or "",
                    "status":           obj.status or "",
                    "financial_impact": str(obj.financial_impact or ""),
                    "incident_date":    obj.incident_date.strftime("%Y-%m-%d") if obj.incident_date else "",
                })

        elif resource_type in ("governance", "policies"):
            obj = db.query(GovernanceDocument).filter(GovernanceDocument.id == rid, GovernanceDocument.tenant_id == tid).first()
            if obj:
                ctx.update({
                    "title":            obj.title or "",
                    "description":      getattr(obj, 'description', '') or "",
                    "doc_type":         obj.doc_type or "",
                    "status":           obj.status or "",
                    "current_version":  obj.current_version or "",
                    "next_review_date": obj.next_review_date.strftime("%Y-%m-%d") if obj.next_review_date else "",
                    "expiry_date":      obj.expiry_date.strftime("%Y-%m-%d") if obj.expiry_date else "",
                })

        elif resource_type == "assets":
            obj = db.query(ITAsset).filter(ITAsset.id == rid, ITAsset.tenant_id == tid).first()
            if obj:
                ctx.update({
                    "name":           obj.name or "",
                    "description":    obj.description or "",
                    "asset_type":     obj.asset_type or "",
                    "criticality":    obj.criticality or "",
                    "status":         obj.status or "",
                    "host_name":      obj.host_name or "",
                    "ip_address":     obj.ip_address or "",
                    "vendor":         obj.vendor or "",
                    "location":       obj.location or "",
                    "valuation":      str(obj.valuation or ""),
                    "custodian":      obj.custodian or "",
                    "confidentiality_rating": str(obj.confidentiality_rating or ""),
                    "integrity_rating":       str(obj.integrity_rating or ""),
                    "availability_rating":    str(obj.availability_rating or ""),
                })
                # Resolve asset owner
                if obj.owner_id:
                    try:
                        asset_owner = db.query(GRCUser).filter(GRCUser.id == obj.owner_id).first()
                        if asset_owner:
                            ctx["owner_name"]  = asset_owner.display_name or asset_owner.username or ""
                            ctx["owner_email"] = asset_owner.email or ""
                    except Exception:
                        pass
            else:
                # Asset was deleted — populate from request body
                ctx["deleted_resource_id"] = str(rid)
                if not ctx.get("name"):
                    ctx["name"] = request_body.get("name") or f"Asset #{rid}"

    except Exception:
        pass  # enrichment failure must not prevent email delivery

    # Post-enrichment fallback: if owner is still blank, try business_owner_id
    # from the request body (covers risks created before this fix was deployed).
    if not ctx.get("owner_name") and not ctx.get("owner_email"):
        owner_id_raw = request_body.get("owner_id") or request_body.get("business_owner_id")
        if owner_id_raw:
            try:
                _owner = db.query(GRCUser).filter(GRCUser.id == int(owner_id_raw)).first()
                if _owner:
                    ctx["owner_name"]  = _owner.display_name or _owner.username or ""
                    ctx["owner_email"] = _owner.email or ""
            except Exception:
                pass

    # Final fallback: if owner is STILL blank, use the triggering user as owner.
    if not ctx.get("owner_name"):
        ctx["owner_name"]  = ctx.get("created_by_name", "")
        ctx["owner_email"] = ctx.get("created_by_email", "")

    return ctx


# ---------------------------------------------------------------------------
# HTML email templates
# ---------------------------------------------------------------------------

def _notification_html(subject: str, body: str, cta_url: str = "", cta_label: str = "") -> str:
    import html as _html
    # Escape HTML special chars, then restore line breaks as <br> tags
    body_html = _html.escape(body).replace("\n", "<br>\n")
    cta = (
        f'<p style="margin:24px 0"><a href="{cta_url}" style="background:#2563eb;color:#fff;'
        f'padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">{cta_label}</a></p>'
        if cta_url else ""
    )
    return f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px">
      <h2 style="color:#1e293b">{_html.escape(subject)}</h2>
      <p style="color:#475569;line-height:1.8">{body_html}</p>
      {cta}
      <hr style="border:none;border-top:1px solid #e2e8f0;margin-top:32px"/>
      <p style="font-size:12px;color:#94a3b8">Sent by ComplyVerse Workflow Engine</p>
    </div>
    """


def _get_manager_emails(db, tenant_id) -> List[str]:
    """Return email addresses of all active users in the tenant (fallback: all users).

    Per-tenant DB: every active grc_users row is a tenant member, so we
    query it directly. The previous implementation joined through
    grc_tenant_users, which is only populated for the bootstrap admin and
    would miss every user created via /admin/users.
    """
    tenant_users = (
        db.query(GRCUser)
        .filter(GRCUser.is_active.is_(True))
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
            "send_notification_email": WorkflowActionHandlers._send_notification_email,
            "request_evidence_upload": WorkflowActionHandlers._request_evidence_upload,
            "assign_control_owner": WorkflowActionHandlers._assign_control_owner,
            "generate_report": WorkflowActionHandlers._generate_report,
            "escalate_to_management": WorkflowActionHandlers._escalate_to_management,
            # NOTE: call_webhook_api removed — outbound HTTP to user-supplied URLs
            # is an SSRF risk.  Use a dedicated integration node if webhooks are needed.
            # Cross-module integration actions
            "update_risk_status": WorkflowActionHandlers._update_risk_status,
            "trigger_policy_review": WorkflowActionHandlers._trigger_policy_review,
            "update_vuln_status": WorkflowActionHandlers._update_vuln_status,
            "update_asset_classification": WorkflowActionHandlers._update_asset_classification,
            "send_in_app_alert": WorkflowActionHandlers._send_in_app_alert,
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

        logger.info(
            "workflow.email.prepare instance_id=%s definition_id=%s to=%r user_ids=%s role_ids=%s",
            instance.id, definition.id, to, user_ids, role_ids,
        )

        # Resolve {{variable}} placeholders using the trigger event context
        ctx = _build_template_context(db, instance, definition)
        subject = _resolve_template(subject, ctx)
        body = _resolve_template(body, ctx)

        recipients = []
        if to:
            recipients.extend([to] if isinstance(to, str) else to)
        recipients.extend(_emails_for_user_ids(db, user_ids))
        recipients.extend(_emails_for_role_ids(db, instance.tenant_id, role_ids))
        if not recipients:
            logger.info(
                "workflow.email.no_direct_recipients — falling back to manager emails instance_id=%s",
                instance.id,
            )
            recipients = _get_manager_emails(db, instance.tenant_id)
        recipients = list(dict.fromkeys([r for r in recipients if r]))

        if not recipients:
            logger.warning(
                "workflow.email.skipped no_recipients instance_id=%s definition_id=%s — "
                "no 'to' address, no user/role IDs, and no manager emails found for tenant_id=%s",
                instance.id, definition.id, instance.tenant_id,
            )
            db.add(WorkflowAuditLog(
                tenant_id=instance.tenant_id,
                workflow_definition_id=definition.id,
                workflow_instance_id=instance.id,
                event_type="action.send_notification_email",
                message="Email skipped: no recipients resolved",
                payload={"subject": subject, "to_raw": str(to), "user_ids": user_ids, "role_ids": role_ids},
            ))
            return {"action": "send_notification_email", "results": [], "warning": "no_recipients"}

        logger.info(
            "workflow.email.sending instance_id=%s recipients=%s subject=%r",
            instance.id, recipients, subject,
        )

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
            if not result.get("success"):
                logger.warning(
                    "workflow.email.send_failed instance_id=%s to=%s reason=%s",
                    instance.id, recipient, result.get("message"),
                )

        db.add(WorkflowAuditLog(
            tenant_id=instance.tenant_id,
            workflow_definition_id=definition.id,
            workflow_instance_id=instance.id,
            event_type="action.send_notification_email",
            message=f"Notification email attempted for {len(results)} recipient(s)",
            payload={"recipients": [r["to"] for r in results], "subject": subject, "results": results},
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

    # ------------------------------------------------------------------
    # send_in_app_alert — creates WorkflowNotification in-app records
    # ------------------------------------------------------------------
    @staticmethod
    def _send_in_app_alert(db, instance, definition, payload: Dict[str, Any]) -> Dict[str, Any]:
        user_ids = _normalize_ids(payload.get("recipient_user_ids") or payload.get("user_ids") or [])
        role_ids = _normalize_ids(payload.get("recipient_role_ids") or payload.get("role_ids") or [])
        notification_type = str(payload.get("notification_type") or payload.get("alert_type") or "info")
        subject = payload.get("subject") or f"Workflow Alert: {definition.name}"
        message = payload.get("message") or payload.get("body") or "A workflow action has been triggered."

        # Resolve {{variable}} placeholders
        ctx = _build_template_context(db, instance, definition)
        subject = _resolve_template(subject, ctx)
        message = _resolve_template(message, ctx)

        # Collect target user IDs
        target_user_ids: List[int] = list(user_ids)
        for role_id in role_ids:
            rows = (
                db.query(GRCUser.id)
                .join(UserRole, UserRole.user_id == GRCUser.id)
                .filter(
                    UserRole.tenant_id == instance.tenant_id,
                    UserRole.role_id == role_id,
                    GRCUser.is_active.is_(True),
                )
                .all()
            )
            target_user_ids.extend([r[0] for r in rows])
        # Deduplicate
        target_user_ids = list(dict.fromkeys(target_user_ids))

        created_count = 0
        for uid in target_user_ids:
            db.add(WorkflowNotification(
                tenant_id=instance.tenant_id,
                user_id=uid,
                workflow_instance_id=instance.id,
                notification_type=notification_type,
                subject=subject,
                message=message,
                is_read=False,
            ))
            created_count += 1

        db.add(WorkflowAuditLog(
            tenant_id=instance.tenant_id,
            workflow_definition_id=definition.id,
            workflow_instance_id=instance.id,
            event_type="action.send_in_app_alert",
            message=f"In-app alert created for {created_count} user(s)",
            payload={"user_ids": target_user_ids, "subject": subject, "notification_type": notification_type},
        ))
        return {"action": "send_in_app_alert", "created": created_count, "user_ids": target_user_ids}

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
