"""Per-tenant provider connections (decision Q4).

Secrets are encrypted with ``services.connector_credentials`` and are WRITE-ONLY:
the API reports which secret fields are set, never their values. Saving a LIVE
connection requires ``CONNECTOR_MASTER_KEY`` so real credentials are never
stored in the dev-mode (base64) format; SIMULATED connections need no secrets.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from ..models import TRProviderConnection
from ..services.connector_credentials import decrypt_credentials, encrypt_credentials, has_master_key
from .catalog import config_defaults, provider_meta

MODES = ("simulated", "live")


class ConnectionError_(ValueError):
    """Invalid connection configuration (surfaced to the caller as HTTP 400)."""


class NotConfigured(LookupError):
    """No active connection for this provider in this tenant."""


def get_connection(db: Session, tenant_id: int, provider: str) -> Optional[TRProviderConnection]:
    return (
        db.query(TRProviderConnection)
        .filter(TRProviderConnection.tenant_id == tenant_id, TRProviderConnection.provider == provider)
        .first()
    )


def require_active(db: Session, tenant_id: int, provider: str) -> TRProviderConnection:
    conn = get_connection(db, tenant_id, provider)
    if conn is None or not conn.is_active:
        label = provider_meta(provider)["label"]
        raise NotConfigured(
            f"{label} is not configured for this tenant. An administrator can enable it "
            f"(simulated or live) under TPRM → Settings → Data providers."
        )
    return conn


def credentials(conn: TRProviderConnection) -> Dict[str, Any]:
    return decrypt_credentials(conn.encrypted_credentials) or {}


def effective_config(conn: TRProviderConnection) -> Dict[str, Any]:
    cfg = dict(config_defaults(conn.provider))
    cfg.update(conn.config or {})
    return cfg


def base_url(conn: TRProviderConnection) -> str:
    return (conn.base_url or provider_meta(conn.provider)["default_base_url"]).rstrip("/")


def upsert_connection(
    db: Session, tenant_id: int, provider: str, *, mode: Optional[str] = None,
    base_url_value: Optional[str] = None, name: Optional[str] = None,
    credentials_in: Optional[Dict[str, Any]] = None, clear_credentials: Optional[list] = None,
    config_in: Optional[Dict[str, Any]] = None, is_active: Optional[bool] = None,
    actor_id: Optional[int] = None,
) -> TRProviderConnection:
    meta = provider_meta(provider)
    conn = get_connection(db, tenant_id, provider)
    if conn is None:
        conn = TRProviderConnection(
            tenant_id=tenant_id, provider=provider, name=meta["label"], mode="simulated",
            config={}, cache={}, created_by=actor_id,
        )
        db.add(conn)

    if mode is not None:
        if mode not in MODES:
            raise ConnectionError_(f"mode must be one of {', '.join(MODES)}")
        conn.mode = mode
    if name is not None:
        conn.name = name.strip()[:200] or meta["label"]
    if base_url_value is not None:
        v = base_url_value.strip()
        if v and not v.lower().startswith("https://"):
            raise ConnectionError_("Base URL must use https://")
        conn.base_url = v or None

    allowed_secret = {f["key"] for f in meta["credential_fields"]}
    allowed_config = {f["key"] for f in meta["config_fields"]}

    if any(v not in (None, "") for v in (credentials_in or {}).values()) and not has_master_key():
        raise ConnectionError_(
            "Storing provider credentials needs encrypted credential storage: set "
            "CONNECTOR_MASTER_KEY on the backend first (simulated mode needs no credentials)."
        )

    if credentials_in or clear_credentials:
        current = credentials(conn)
        for k, v in (credentials_in or {}).items():
            if k not in allowed_secret:
                raise ConnectionError_(f"Unknown credential field '{k}'")
            # Blank means "keep the stored value" (secrets are write-only in the UI).
            if v not in (None, ""):
                current[k] = str(v)
        for k in clear_credentials or []:
            current.pop(k, None)
        conn.encrypted_credentials = encrypt_credentials(current) if current else None

    if config_in is not None:
        cfg = dict(conn.config or {})
        for k, v in config_in.items():
            if k not in allowed_config:
                raise ConnectionError_(f"Unknown setting '{k}'")
            cfg[k] = v
        conn.config = cfg

    if is_active is not None:
        conn.is_active = bool(is_active)

    if conn.mode == "live":
        if not has_master_key():
            raise ConnectionError_(
                "Live mode needs encrypted credential storage: set CONNECTOR_MASTER_KEY on the "
                "backend before saving real provider credentials."
            )
        stored = credentials(conn)
        missing = [f["label"] for f in meta["credential_fields"] if f["required"] and not stored.get(f["key"])]
        if missing:
            raise ConnectionError_("Live mode requires: " + ", ".join(missing))

    conn.status = "not_tested"
    conn.updated_at = datetime.utcnow()
    db.flush()
    return conn


def record_result(conn: TRProviderConnection, ok: bool, error: Optional[str] = None) -> None:
    now = datetime.utcnow()
    conn.last_tested_at = now
    if ok:
        conn.status = "connected"
        conn.last_success_at = now
        conn.last_error = None
        conn.consecutive_failures = 0
    else:
        conn.status = "error"
        conn.last_error = (error or "Unknown error")[:2000]
        conn.consecutive_failures = (conn.consecutive_failures or 0) + 1


def serialize(conn: Optional[TRProviderConnection], provider: str) -> dict:
    meta = provider_meta(provider)
    base = {
        "provider": provider, "label": meta["label"], "vendor": meta["vendor"],
        "category": meta["category"], "module": meta["module"], "description": meta["description"],
        "credential_fields": meta["credential_fields"], "config_fields": meta["config_fields"],
        "default_base_url": meta["default_base_url"], "docs_url": meta["docs_url"],
        "encryption_configured": has_master_key(),
    }
    if conn is None:
        return {**base, "configured": False, "is_active": False, "mode": None,
                "config": config_defaults(provider), "credentials_set": {}, "status": "not_configured"}
    stored = credentials(conn)
    return {
        **base, "configured": True, "id": conn.id, "name": conn.name, "mode": conn.mode,
        "is_active": bool(conn.is_active), "base_url": conn.base_url,
        "config": effective_config(conn),
        # Which secrets are present — never their values.
        "credentials_set": {f["key"]: bool(stored.get(f["key"])) for f in meta["credential_fields"]},
        "status": conn.status, "last_tested_at": conn.last_tested_at,
        "last_success_at": conn.last_success_at, "last_error": conn.last_error,
        "consecutive_failures": conn.consecutive_failures or 0,
        "updated_at": conn.updated_at,
    }
