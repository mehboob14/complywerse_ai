import json
import time
from typing import Any, Dict, Optional

from fastapi import Request
from starlette.responses import Response

from .models import AuditLog, GRCUser
from .db import open_tenant_session
from .routers.auth_router import decode_token


AUDIT_EXCLUDED_PATH_PREFIXES = (
    "/docs",
    "/redoc",
    "/openapi.json",
    "/health",
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


def _action_from_method(method: str, status_code: int) -> str:
    method_upper = method.upper()
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
    return not any(path.startswith(prefix) for prefix in AUDIT_EXCLUDED_PATH_PREFIXES)


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
) -> None:
    try:
        path = request.url.path or ""
        tenant = getattr(request.state, "tenant", None)
        tenant_slug = getattr(request.state, "tenant_slug", None)
        tenant_id = (tenant or {}).get("id") if isinstance(tenant, dict) else getattr(tenant, "id", None)

        if not tenant_slug:
            # No tenant context => nothing to audit (audit log lives in tenant DB).
            return

        db = open_tenant_session(tenant_slug)
        try:
            user_id = None
            actor_username = None
            actor_display = None

            # Try cookie auth first, then fall back to Authorization Bearer header
            token = request.cookies.get("grc_auth_token")
            if not token:
                auth_header = request.headers.get("authorization", "")
                if auth_header.startswith("Bearer "):
                    token = auth_header[7:]

            if token:
                payload = decode_token(token)
                actor_username = payload.get("sub") if payload else None
                if actor_username:
                    user = db.query(GRCUser).filter(GRCUser.username == actor_username).first()
                    if user:
                        user_id = user.id
                        actor_display = user.display_name or user.username

            if not tenant_id:
                return

            resource_type, resource_id = _extract_resource(path)
            status_code = getattr(response, "status_code", 200)
            duration_ms = int((time.time() - started_at) * 1000)
            method = request.method.upper()

            details = {
                "method": method,
                "path": path,
                "query": dict(request.query_params),
                "status_code": status_code,
                "duration_ms": duration_ms,
                "user_agent": request.headers.get("user-agent"),
                "request": request_payload,
                # Store actor info so display always works even if user is later deleted
                "actor": actor_username,
                "actor_display": actor_display,
            }

            log = AuditLog(
                tenant_id=tenant_id,
                user_id=user_id,
                action=_action_from_method(method, status_code),
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
