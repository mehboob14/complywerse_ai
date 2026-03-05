import json
import time
from typing import Any, Dict, Optional

from fastapi import Request
from starlette.responses import Response

from .models import SessionLocal, AuditLog, GRCUser
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


def _extract_resource(path: str) -> tuple[str, Optional[int]]:
    normalized = path.replace("/grc", "", 1).strip("/")
    if not normalized:
        return "system", None

    parts = [part for part in normalized.split("/") if part]
    resource_type = parts[0]
    resource_id = None
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

        details = {
            "method": method,
            "path": path,
            "query": dict(request.query_params),
            "status_code": status_code,
            "duration_ms": duration_ms,
            "user_agent": request.headers.get("user-agent"),
            "request": request_payload,
        }

        db = SessionLocal()
        try:
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
