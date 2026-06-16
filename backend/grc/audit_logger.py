import json
import time
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import Request
from sqlalchemy.orm import Session
from starlette.responses import Response

from .models import SessionLocal, AuditLog, GRCUser
from .routers.auth_router import decode_token


AUDIT_EXCLUDED_PATH_PREFIXES = (
    "/docs",
    "/redoc",
    "/openapi.json",
    "/health",
)

# High-frequency polling endpoints that flood the audit log with noise.
# GETs to these paths are dropped before the row is written. The list is
# (method, path-substring) pairs — match if the request method equals the
# entry's method and the path contains the substring.
_AUDIT_DROPPED_POLLING = (
    ("GET", "/workflow-engine/notifications/in-app"),
    ("GET", "/workflow-engine/notifications/unread-count"),
    ("GET", "/workflow-engine/executions/instances/active"),
    ("GET", "/auth/me"),
    ("GET", "/admin/audit-logs"),  # don't log views of the audit log itself
    # Don't log writes to internal audit-log admin endpoints (e.g. AI summary
    # generation). Otherwise each AI summary call adds a new row to the table
    # the user is browsing, polluting it.
    ("POST", "/admin/audit-logs/"),
    # CIS module high-frequency polls — without these the agent heartbeat
    # (every 30s) and Connect-Wizard status poll (every 2s while a wizard
    # is open) bury the real activity under thousands of identical rows
    # per day. The actual scan-result POSTs are NOT in this list — those
    # are real activity worth recording.
    ("POST", "/agents/heartbeat"),
    ("GET", "/agents/jobs"),
    ("GET", "/connect-wizard/status/"),
)

SENSITIVE_KEYS = {
    "password",
    "password_hash",
    "token",
    "access_token",
    "refresh_token",
    "secret",
    "api_key",
    "authorization",
    "cookie",
}


def _sanitize_value(value: Any) -> Any:
    if isinstance(value, dict):
        sanitized: Dict[str, Any] = {}
        for key, nested_value in value.items():
            if key.lower() in SENSITIVE_KEYS:
                sanitized[key] = "***"
            else:
                sanitized[key] = _sanitize_value(nested_value)
        return sanitized
    if isinstance(value, list):
        return [_sanitize_value(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


# Modules whose URL structure is /<module>/<entity>/[id]/...
# These use their second path segment as the resource_type.
_MODULE_SUB_ENTITY_PREFIXES = {
    "erm",
    "evidence-mgmt",
    "vuln-management",
    "audit-management",
    "control-library",
    # CIS / Issues / Criticality additions — every one of these nests
    # resources under a clear second-segment entity name (runs,
    # benchmark-mappings, handshake, heartbeat, issues, actions,
    # info-system, etc.) so the audit log captures resource_type at
    # the right granularity instead of bucketing everything under the
    # top-level module label.
    "compliance-plugins",
    "connect-wizard",
    "agents",
    "issue-management",
    "criticality-assessments",
}

# Map module path slugs → canonical resource type names
_MODULE_RESOURCE_ALIASES: dict[str, str] = {
    "erm": "risks",
    "evidence-mgmt": "evidence",
    "vuln-management": "vulnerabilities",
    "framework-upload": "frameworks",
    "governance": "governance",
    "compliance": "compliance",
    "audit-management": "audits",
    "control-library": "controls",
    "vendor-risk": "vendor_risk",
    "chatbot": "chatbot",
    "integrations": "integrations",
    "workflow-engine": "workflow",
}


def _extract_resource(path: str) -> tuple[str, Optional[int]]:
    normalized = path.replace("/grc", "", 1).strip("/")
    if not normalized:
        return "system", None

    parts = [part for part in normalized.split("/") if part]
    if not parts:
        return "system", None

    module = parts[0]
    resource_id: Optional[int] = None

    # Sub-entity modules: /erm/risks/5  →  resource_type="risks", resource_id=5
    if module in _MODULE_SUB_ENTITY_PREFIXES and len(parts) >= 2:
        resource_type = parts[1]
        # ID is the third segment when it is numeric
        if len(parts) > 2 and parts[2].isdigit():
            resource_id = int(parts[2])
    else:
        # Standard modules: /governance/12/status  →  resource_type="governance", resource_id=12
        resource_type = _MODULE_RESOURCE_ALIASES.get(module, module)
        if len(parts) > 1 and parts[1].isdigit():
            resource_id = int(parts[1])

    return resource_type, resource_id


# Single-word verbs that, when appearing as the trailing path segment at depth
# 3+, indicate a sub-action rather than a sub-resource. Plural nouns like
# "comments", "users", "controls", "assets", "findings" are intentionally
# excluded — POSTs to those endpoints are real CRUD creates of sub-resources.
_KNOWN_SUB_ACTION_VERBS = {
    # Approval / decision lifecycle
    "approve", "reject", "submit", "withdraw", "decision", "escalate",
    "claim", "complete", "cancel", "request",
    # Lifecycle state
    "publish", "unpublish", "archive", "unarchive", "restore",
    "activate", "deactivate", "enable", "disable",
    # Execution
    "trigger", "execute", "run", "rerun", "retry", "schedule",
    # Communication
    "send", "dispatch", "notify",
    # Data / processing
    "import", "export", "generate", "regenerate", "refresh", "sync",
    "validate", "verify", "parse", "analyze", "optimize",
    "ask", "suggest", "reword",
    # Domain
    "measure", "assign", "reassign", "clone", "duplicate", "merge",
}


def _extract_sub_action(path: str) -> Optional[str]:
    """Detect sub-action endpoints like /ai-suggest, /parse-policy, /publish.

    Returns the sub-action name (snake_case) when the trailing path segment is
    clearly a verb (hyphenated phrase OR in the known-verb whitelist).
    Returns None for sub-resource collections (e.g. POST /risks/5/comments)
    so they remain a true CRUD "create".

    Examples:
      /grc/erm/kris                          → None  (true collection create)
      /grc/erm/kris/5                        → None  (true item update)
      /grc/erm/risks/5/comments              → None  (true sub-resource create)
      /grc/erm/kris/ai-suggest               → 'ai_suggest'   (hyphen → verb)
      /grc/erm/kris/5/measure                → 'measure'      (whitelisted)
      /grc/governance/documents/2/parse-policy → 'parse_policy' (hyphen)
      /grc/governance/documents/2/publish    → 'publish'      (whitelisted)
      /grc/governance/documents/bulk-archive → 'bulk_archive' (hyphen)
    """
    normalized = path.replace("/grc", "", 1).strip("/")
    parts = [p for p in normalized.split("/") if p]

    # Need at least <module>/<resource>/<sub> to qualify as a sub-action
    if len(parts) < 3:
        return None

    last = parts[-1]
    # Numeric trailing segment is a resource ID, not a sub-action
    if last.isdigit():
        return None

    last_lower = last.lower()
    # Hyphenated trailing segment: in this codebase these are always verb
    # phrases (ai-suggest, parse-policy, bulk-archive, start-review, etc.)
    if "-" in last:
        return last_lower.replace("-", "_")
    # Single-word verb whitelist
    if last_lower in _KNOWN_SUB_ACTION_VERBS:
        return last_lower

    # Otherwise: assume sub-resource collection (true CRUD), let standard
    # create/update/delete classification handle it.
    return None


def _action_from_method(method: str, status_code: int, path: str = "") -> str:
    method_upper = method.upper()
    failed_suffix = "_failed" if status_code >= 400 else ""

    # Sub-action detection: prefer accurate verb over generic create/update
    if method_upper in {"POST", "PUT", "PATCH"} and path:
        sub_action = _extract_sub_action(path)
        if sub_action:
            return f"{sub_action}{failed_suffix}"

    if method_upper == "POST":
        return "create" if status_code < 400 else "create_failed"
    if method_upper in {"PUT", "PATCH"}:
        return "update" if status_code < 400 else "update_failed"
    if method_upper == "DELETE":
        return "delete" if status_code < 400 else "delete_failed"
    if method_upper == "GET":
        return "read"
    return method.lower()


def should_audit_request(request: Request) -> bool:
    method = request.method.upper()
    if method in {"OPTIONS", "HEAD"}:
        return False

    path = request.url.path or ""
    if any(path.startswith(prefix) for prefix in AUDIT_EXCLUDED_PATH_PREFIXES):
        return False

    # Drop high-frequency polling endpoints — they bury the real activity
    # under tens of thousands of identical "read" rows per day.
    for drop_method, drop_substr in _AUDIT_DROPPED_POLLING:
        if method == drop_method and drop_substr in path:
            return False

    return True


# Resource type → tuple of payload keys that, when present in the request body,
# should be promoted to the audit log's resource_id column. Lets us tag rows
# like POST /workflow-engine/executions/trigger with the workflow_definition_id
# the user actually triggered, so the audit log says "Workflow #1644" instead
# of just "Workflow Action".
_PAYLOAD_RESOURCE_ID_KEYS: dict[str, tuple[str, ...]] = {
    "workflow": ("workflow_definition_id", "definition_id", "workflow_id"),
}


def _extract_resource_id_from_payload(
    resource_type: str, payload: Optional[Dict[str, Any]]
) -> Optional[int]:
    if not payload or not isinstance(payload, dict):
        return None
    keys = _PAYLOAD_RESOURCE_ID_KEYS.get(resource_type)
    if not keys:
        return None
    for k in keys:
        v = payload.get(k)
        if isinstance(v, int):
            return v
        if isinstance(v, str) and v.isdigit():
            return int(v)
    return None


# Map raw action verb → past-tense human label. Mirrors the frontend's
# ACTION_VERBS map so summaries read naturally on every channel that consumes
# the audit row (admin UI, exports, workflow notifications).
_HUMAN_VERBS = {
    "create": "Created",
    "create_failed": "Failed to create",
    "update": "Updated",
    "update_failed": "Failed to update",
    "delete": "Deleted",
    "delete_failed": "Failed to delete",
    "read": "Viewed",
    "login": "Logged in",
    "logout": "Logged out",
    "upload": "Uploaded",
    "download": "Downloaded",
    "approve": "Approved",
    "reject": "Rejected",
    "submit": "Submitted",
    "withdraw": "Withdrew",
    "publish": "Published",
    "unpublish": "Unpublished",
    "archive": "Archived",
    "restore": "Restored",
    "activate": "Activated",
    "deactivate": "Deactivated",
    "trigger": "Triggered",
    "execute": "Ran",
    "rerun": "Re-ran",
    "retry": "Retried",
    "schedule": "Scheduled",
    "send": "Sent",
    "import": "Imported",
    "export": "Exported",
    "generate": "Generated",
    "regenerate": "Regenerated",
    "sync": "Synced",
    "ai_suggest": "AI-suggested edits to",
    "parse_policy": "Parsed policy on",
    "measure": "Recorded a measurement on",
    "decision": "Recorded a decision on",
    "assign": "Assigned",
    "reassign": "Reassigned",
    "clone": "Cloned",
    "duplicate": "Duplicated",
    "natural_language": "Generated workflow from prompt",
    "natural_language_failed": "Failed to generate workflow from prompt",
    "email_config": "Updated email configuration for",
}

_HUMAN_RESOURCE = {
    "workflow": "workflow",
    "workflow_engine": "workflow",
    "risks": "risk",
    "evidence": "evidence item",
    "vulnerabilities": "vulnerability",
    "frameworks": "framework",
    "compliance": "compliance record",
    "governance": "document",
    "controls": "control",
    "vendor_risk": "vendor",
    "audits": "audit",
    "integrations": "integration",
    "users": "user",
    "auth": "session",
    "admin": "admin record",
    "chatbot": "chatbot session",
}


def _humanize_action(action: str) -> str:
    if action in _HUMAN_VERBS:
        return _HUMAN_VERBS[action]
    # Unknown verb — title-case the snake_case
    return action.replace("_", " ").capitalize() if action else "Performed action on"


def _humanize_resource(resource_type: str) -> str:
    return _HUMAN_RESOURCE.get(resource_type, resource_type.replace("_", " ") or "record")


def _build_summary(
    action: str,
    resource_type: str,
    resource_id: Optional[int],
    payload: Optional[Dict[str, Any]],
    status_code: int,
) -> str:
    """Build a one-line natural-language description of what happened."""
    verb = _humanize_action(action)
    noun = _humanize_resource(resource_type)

    name: Optional[str] = None
    if isinstance(payload, dict):
        for k in ("name", "title", "username", "email", "label", "subject"):
            v = payload.get(k)
            if isinstance(v, str) and v.strip():
                name = v.strip()
                break

    if name:
        target = f'{noun} "{name}"'
    elif resource_id is not None:
        target = f"{noun} #{resource_id}"
    else:
        target = noun

    summary = f"{verb} {target}"
    if status_code >= 500:
        summary += f" (server error {status_code})"
    elif status_code >= 400 and "_failed" not in action:
        summary += f" ({status_code})"
    return summary


async def parse_request_payload(request: Request, body: bytes) -> Optional[Dict[str, Any]]:
    content_type = (request.headers.get("content-type") or "").lower()
    if not body:
        return None

    if "application/json" in content_type:
        try:
            payload = json.loads(body.decode("utf-8"))
            return _sanitize_value(payload)
        except Exception:
            return {"raw": "unparseable_json"}

    if "application/x-www-form-urlencoded" in content_type:
        try:
            form = await request.form()
            return _sanitize_value(dict(form))
        except Exception:
            return {"raw": "unparseable_form"}

    if "multipart/form-data" in content_type:
        return {"multipart": True}

    return None


def write_audit_log(
    request: Request,
    response: Response,
    started_at: float,
    request_payload: Optional[Dict[str, Any]] = None,
    response_error: Optional[Any] = None,
) -> None:
    try:
        path = request.url.path or ""
        tenant = getattr(request.state, "tenant", None)
        tenant_id = getattr(tenant, "id", None)

        token = request.cookies.get("grc_auth_token")
        user_id = None
        if token:
            payload = decode_token(token)
            username = payload.get("sub") if payload else None
            if username:
                db_lookup = SessionLocal()
                try:
                    user = db_lookup.query(GRCUser).filter(GRCUser.username == username).first()
                    if user:
                        user_id = user.id
                        if tenant_id is None and payload:
                            tenant_id = payload.get("tenant_id")
                finally:
                    db_lookup.close()

        if not tenant_id:
            return

        resource_type, resource_id = _extract_resource(path)
        status_code = getattr(response, "status_code", 200)
        duration_ms = int((time.time() - started_at) * 1000)
        method = request.method.upper()
        action = _action_from_method(method, status_code, path)

        # Promote fields out of the request body into the audit row when the
        # URL didn't already give us a numeric ID — e.g. POST /executions/trigger
        # → workflow_definition_id from body becomes resource_id.
        if resource_id is None:
            resource_id = _extract_resource_id_from_payload(resource_type, request_payload)

        summary = _build_summary(action, resource_type, resource_id, request_payload, status_code)

        # Pull a human-readable resource name from the request body so the UI
        # can render it without re-fetching the row's referenced object.
        resource_name: Optional[str] = None
        if isinstance(request_payload, dict):
            for k in ("name", "title", "username", "email", "label", "subject"):
                v = request_payload.get(k)
                if isinstance(v, str) and v.strip():
                    resource_name = v.strip()
                    break

        details = {
            "method": method,
            "path": path,
            "query": dict(request.query_params),
            "status_code": status_code,
            "duration_ms": duration_ms,
            "user_agent": request.headers.get("user-agent"),
            "request": request_payload,
            # Natural-language fields the admin UI (and downstream consumers)
            # render directly. Keeping them inside `changes` preserves the
            # existing schema (no migration needed).
            "summary": summary,
            "resource_name": resource_name,
        }
        # Capture response error body (e.g. FastAPI's {"detail": "..."}) so the
        # AI summary can surface the real failure reason instead of just the
        # HTTP status code. Only populated when middleware passed it in.
        if response_error is not None:
            details["response_error"] = _sanitize_value(response_error)

        db = SessionLocal()
        try:
            log = AuditLog(
                tenant_id=tenant_id,
                user_id=user_id,
                action=action,
                resource_type=resource_type,
                resource_id=resource_id,
                changes=_sanitize_value(details),
                ip_address=request.client.host if request.client else None,
            )
            db.add(log)
            db.commit()
        finally:
            db.close()
    except Exception:
        return


def write_rich_audit_log(
    db: Session,
    tenant_id: int,
    user_id: Optional[int],
    action: str,
    resource_type: str,
    resource_id: Optional[int] = None,
    resource_name: Optional[str] = None,
    resource_url: Optional[str] = None,
    summary: Optional[str] = None,
    before: Optional[Dict[str, Any]] = None,
    after: Optional[Dict[str, Any]] = None,
    snapshot: Optional[Dict[str, Any]] = None,
    actor_type: str = "user",
    actor_workflow_id: Optional[int] = None,
    ip_address: Optional[str] = None,
) -> None:
    """Thin shim — delegates to the canonical implementation in rich_audit.py.
    Kept here only for backward-compat with any direct imports from audit_logger.
    All new code should import from grc.rich_audit directly.
    """
    from .rich_audit import write_rich_audit_log as _canonical
    _canonical(
        db=db,
        tenant_id=tenant_id,
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        resource_name=resource_name,
        resource_url=resource_url,
        summary=summary,
        before=before,
        after=after,
        snapshot=snapshot,
        actor_type=actor_type,
        actor_workflow_id=actor_workflow_id,
        ip_address=ip_address,
    )
