"""Connectors CRUD + OAuth dispatcher.

Endpoints:

  GET    /connectors/providers                  → catalogue of providers
  GET    /connectors                            → tenant's saved connectors
  POST   /connectors                            → create a connector
  PATCH  /connectors/{id}                       → update fields / creds
  DELETE /connectors/{id}                       → remove
  POST   /connectors/{id}/test                  → re-test against live API
  POST   /connectors/{id}/sync                  → on-demand sync (dispatches to Celery)

  GET    /connectors/oauth/start?provider=...   → kick off OAuth2 flow
  GET    /connectors/oauth/callback             → receive code, store tokens

Auth: every endpoint goes through `require_auth` and is tenant-scoped
via `get_user_primary_tenant`.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...models import GRCUser, IntegrationConnection, get_db
from ...routers.auth_router import require_auth, get_user_primary_tenant
from ...services.connector_credentials import (
    decrypt_credentials,
    encrypt_credentials,
    has_master_key,
)
from .registry import PROVIDER_REGISTRY, ProviderMeta, build_adapter, list_providers

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/connectors", tags=["External Connectors"])


# ─── Request / response schemas ─────────────────────────────────────

class ConnectorCreate(BaseModel):
    provider: str                       # registry key (servicenow, splunk, …)
    connection_name: str
    console_url: Optional[str] = None
    # Mixed bag — frontend posts every visible field here. The router
    # partitions into credentials vs provider_config based on
    # `ProviderField.is_credential`.
    fields: Dict[str, Any] = {}
    sync_schedule: Optional[str] = None
    verify_ssl: bool = True


class ConnectorUpdate(BaseModel):
    connection_name: Optional[str] = None
    console_url: Optional[str] = None
    fields: Optional[Dict[str, Any]] = None
    sync_schedule: Optional[str] = None
    is_active: Optional[bool] = None
    verify_ssl: Optional[bool] = None


# ─── Serialisation ──────────────────────────────────────────────────

def _serialise_provider(meta: ProviderMeta) -> Dict[str, Any]:
    return {
        "provider": meta.provider,
        "label": meta.label,
        "category": meta.category,
        "description": meta.description,
        "auth_method": meta.auth_method,
        "beta": meta.beta,
        "docs_url": meta.docs_url,
        "oauth_scopes": meta.oauth_scopes,
        "fields": [
            {
                "key": f.key,
                "label": f.label,
                "kind": f.kind,
                "required": f.required,
                "placeholder": f.placeholder,
                "help_text": f.help_text,
                "options": f.options,
                "is_credential": f.is_credential,
            }
            for f in meta.fields
        ],
    }


def _serialise_connection(conn: IntegrationConnection) -> Dict[str, Any]:
    meta = PROVIDER_REGISTRY.get(conn.integration_type)
    cat = conn.category or (meta.category if meta else "vuln_scanner")
    return {
        "id": conn.id,
        "provider": conn.integration_type,
        "provider_label": meta.label if meta else conn.integration_type,
        "category": cat,
        "connection_name": conn.connection_name,
        "console_url": conn.console_url,
        "auth_method": conn.auth_method,
        "sync_schedule": conn.sync_schedule,
        "is_active": conn.is_active,
        "status": conn.status,
        "last_sync_at": conn.last_sync_at.isoformat() if conn.last_sync_at else None,
        "last_sync_status": conn.last_sync_status,
        "last_sync_stats": conn.last_sync_stats,
        "consecutive_failures": conn.consecutive_failures,
        "provider_config": conn.provider_config or {},
        # Never echo credentials back.
        "has_credentials": bool(conn.encrypted_credentials),
        "beta": meta.beta if meta else False,
        "created_at": conn.created_at.isoformat() if conn.created_at else None,
    }


def _split_fields(meta: ProviderMeta, fields: Dict[str, Any]) -> tuple[Dict[str, Any], Dict[str, Any], Optional[str]]:
    """Partition the flat fields dict into (credentials, provider_config, console_url)."""
    creds: Dict[str, Any] = {}
    cfg: Dict[str, Any] = {}
    console_url: Optional[str] = None
    cred_keys = {f.key for f in meta.fields if f.is_credential}
    cfg_keys = {f.key for f in meta.fields if not f.is_credential}
    for key, value in (fields or {}).items():
        if key == "console_url":
            console_url = value
        elif key in cred_keys:
            creds[key] = value
        elif key in cfg_keys:
            cfg[key] = value
    return creds, cfg, console_url


# ─── Provider catalogue ─────────────────────────────────────────────

@router.get("/providers")
def get_providers(
    category: Optional[str] = Query(default=None),
    current_user: GRCUser = Depends(require_auth),
):
    return {
        "encryption_enabled": has_master_key(),
        "categories": ["ticketing", "siem", "pentest", "collab", "transcribe", "easm_source"],
        "providers": [_serialise_provider(p) for p in list_providers(category)],
    }


# ─── Connector CRUD ─────────────────────────────────────────────────

@router.get("")
def list_connectors(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant context")
    # Only return non-vuln-scanner connections via this endpoint — vuln
    # scanners keep using the legacy `/integrations/connections` surface.
    rows = (
        db.query(IntegrationConnection)
        .filter(
            IntegrationConnection.tenant_id == tenant_id,
            IntegrationConnection.category.in_(
                ["ticketing", "siem", "pentest", "collab", "transcribe", "easm_source"]
            ),
        )
        .order_by(IntegrationConnection.created_at.desc())
        .all()
    )
    return {"items": [_serialise_connection(r) for r in rows]}


@router.post("")
def create_connector(
    body: ConnectorCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant context")
    meta = PROVIDER_REGISTRY.get(body.provider)
    if not meta:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {body.provider}")

    creds, cfg, console_url = _split_fields(meta, body.fields)
    console_url = body.console_url or console_url

    # Validate required fields
    missing = [
        f.label for f in meta.fields
        if f.required and f.key not in (body.fields or {})
    ]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required fields: {', '.join(missing)}")

    conn = IntegrationConnection(
        tenant_id=tenant_id,
        integration_type=body.provider,
        category=meta.category,
        connection_name=body.connection_name,
        console_url=console_url or "",
        console_port=0,
        auth_method=meta.auth_method,
        encrypted_credentials=encrypt_credentials(creds) if creds else None,
        provider_config=cfg or {},
        sync_schedule=body.sync_schedule or "0 */4 * * *",
        is_active=True,
        status="pending",
        created_by_user_id=getattr(current_user, "id", None),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)

    # Run a connection test inline so the user gets immediate feedback.
    test_result = _run_test(conn)
    conn.status = "connected" if test_result.success else "error"
    db.commit()

    return {
        "connection": _serialise_connection(conn),
        "test_result": {
            "success": test_result.success,
            "message": test_result.message,
            "server_version": test_result.server_version,
            "details": test_result.details,
        },
    }


@router.patch("/{connector_id}")
def update_connector(
    connector_id: int,
    body: ConnectorUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    conn = _get_connector(connector_id, db, current_user)
    meta = PROVIDER_REGISTRY.get(conn.integration_type)

    if body.connection_name is not None:
        conn.connection_name = body.connection_name
    if body.console_url is not None:
        conn.console_url = body.console_url
    if body.sync_schedule is not None:
        conn.sync_schedule = body.sync_schedule
    if body.is_active is not None:
        conn.is_active = body.is_active
    if body.fields and meta:
        creds, cfg, console_url = _split_fields(meta, body.fields)
        if creds:
            # Merge with existing creds so the user can update one field
            # without re-entering all of them.
            existing = decrypt_credentials(conn.encrypted_credentials) or {}
            existing.update(creds)
            conn.encrypted_credentials = encrypt_credentials(existing)
        if cfg:
            merged_cfg = dict(conn.provider_config or {})
            merged_cfg.update(cfg)
            conn.provider_config = merged_cfg
        if console_url:
            conn.console_url = console_url

    conn.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(conn)
    return {"connection": _serialise_connection(conn)}


@router.delete("/{connector_id}")
def delete_connector(
    connector_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    conn = _get_connector(connector_id, db, current_user)
    db.delete(conn)
    db.commit()
    return {"deleted": connector_id}


@router.post("/{connector_id}/test")
def test_connector(
    connector_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    conn = _get_connector(connector_id, db, current_user)
    result = _run_test(conn)
    conn.status = "connected" if result.success else "error"
    db.commit()
    return {
        "success": result.success,
        "message": result.message,
        "server_version": result.server_version,
        "details": result.details,
    }


@router.post("/{connector_id}/sync")
def sync_connector(
    connector_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Dispatch a sync task to Celery. The actual sync runs in
    `backend/grc/tasks/connectors.py:run_connector_sync`. Falls back to
    in-process sync when Celery isn't reachable."""
    conn = _get_connector(connector_id, db, current_user)
    try:
        from ...db import MasterSession
        from ...models import Tenant as MasterTenant
        from ...tasks.connectors import run_connector_sync

        master = MasterSession()
        try:
            row = master.query(MasterTenant.slug).filter(
                MasterTenant.id == conn.tenant_id
            ).first()
            slug = row[0] if row else None
        finally:
            master.close()
        if not slug:
            raise RuntimeError("Could not resolve tenant slug for connector dispatch")
        run_connector_sync.delay(slug, connector_id)
        return {"queued": True, "connector_id": connector_id}
    except Exception:
        logger.exception("Failed to dispatch connector sync to Celery; running inline")
        from .sync_runner import run_inline_sync
        result = run_inline_sync(conn, db)
        return {"queued": False, "inline": True, "result": result}


# ─── OAuth2 round-trip ──────────────────────────────────────────────

@router.get("/oauth/start")
def oauth_start(
    provider: str = Query(...),
    connector_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Build the provider's OAuth consent URL and return it for the
    frontend to open in a popup / new tab.

    Currently routes:
      * msteams / office365 → Microsoft authority
      * zoom               → Zoom marketplace
    """
    conn = _get_connector(connector_id, db, current_user)
    if conn.integration_type != provider:
        raise HTTPException(status_code=400, detail="Provider mismatch")
    state = secrets.token_urlsafe(24)
    # Persist state for callback validation.
    cfg = dict(conn.provider_config or {})
    cfg["_oauth_state"] = state
    conn.provider_config = cfg
    db.commit()

    creds = decrypt_credentials(conn.encrypted_credentials) or {}
    client_id = creds.get("client_id")
    if not client_id:
        raise HTTPException(status_code=400, detail="Connector has no client_id configured")

    redirect_uri = f"{_base_url(provider)}/connectors/oauth/callback"

    if provider in ("msteams", "office365"):
        tenant_id_ms = cfg.get("ms_tenant_id") or "common"
        scopes = " ".join((PROVIDER_REGISTRY[provider].oauth_scopes) or [
            "https://graph.microsoft.com/.default"
        ])
        url = (
            f"https://login.microsoftonline.com/{tenant_id_ms}/oauth2/v2.0/authorize"
            f"?client_id={client_id}&response_type=code&redirect_uri={redirect_uri}"
            f"&scope={scopes}&state={state}_{connector_id}"
        )
    elif provider == "zoom":
        url = (
            f"https://zoom.us/oauth/authorize"
            f"?response_type=code&client_id={client_id}"
            f"&redirect_uri={redirect_uri}&state={state}_{connector_id}"
        )
    else:
        raise HTTPException(status_code=400, detail=f"Provider {provider} does not use OAuth2")

    return {"authorize_url": url, "state": state}


@router.get("/oauth/callback")
def oauth_callback(
    request: Request,
    code: str = Query(...),
    state: str = Query(...),
    db: Session = Depends(get_db),
):
    """Exchange the code for tokens and stash them on the connector row.

    `state` is `<random>_<connector_id>` so we can look the row up
    without trusting client-side cookies.
    """
    try:
        _, connector_id_str = state.rsplit("_", 1)
        connector_id = int(connector_id_str)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid state")

    conn = db.query(IntegrationConnection).filter(
        IntegrationConnection.id == connector_id
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connector not found")

    expected_state = (conn.provider_config or {}).get("_oauth_state")
    if not expected_state or not state.startswith(expected_state + "_"):
        raise HTTPException(status_code=400, detail="OAuth state mismatch")

    creds = decrypt_credentials(conn.encrypted_credentials) or {}
    token_payload = _exchange_oauth_code(conn.integration_type, code, creds, conn.provider_config or {})
    conn.oauth_tokens = encrypt_credentials(token_payload)
    conn.status = "connected"
    # Clean up the consumed state so it can't be replayed.
    cfg = dict(conn.provider_config or {})
    cfg.pop("_oauth_state", None)
    conn.provider_config = cfg
    db.commit()

    return RedirectResponse(url="/admin?tab=connectors&oauth=success")


# ─── Helpers ────────────────────────────────────────────────────────

def _get_connector(connector_id: int, db: Session, user: GRCUser) -> IntegrationConnection:
    tenant_id = get_user_primary_tenant(user, db)
    conn = db.query(IntegrationConnection).filter(
        IntegrationConnection.id == connector_id,
        IntegrationConnection.tenant_id == tenant_id,
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connector not found")
    return conn


def _run_test(conn: IntegrationConnection):
    creds = decrypt_credentials(conn.encrypted_credentials) or {}
    tokens = decrypt_credentials(conn.oauth_tokens) or {}
    adapter = build_adapter(
        provider=conn.integration_type,
        console_url=conn.console_url,
        credentials=creds,
        config=conn.provider_config or {},
        oauth_tokens=tokens,
    )
    return adapter.test_connection()


def _base_url(provider: str) -> str:
    import os
    base = os.environ.get("PUBLIC_API_BASE_URL") or os.environ.get("BACKEND_BASE_URL")
    if not base:
        # Last-resort default for local dev.
        base = "http://localhost:8000"
    return base.rstrip("/")


def _exchange_oauth_code(provider: str, code: str, creds: Dict[str, Any], cfg: Dict[str, Any]) -> Dict[str, Any]:
    import os
    import requests as _requests
    redirect_uri = f"{_base_url(provider)}/connectors/oauth/callback"
    client_id = creds.get("client_id")
    client_secret = creds.get("client_secret")

    if provider in ("msteams", "office365"):
        tenant = cfg.get("ms_tenant_id") or "common"
        resp = _requests.post(
            f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
            },
            timeout=30,
        )
    elif provider == "zoom":
        resp = _requests.post(
            "https://zoom.us/oauth/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
            },
            auth=(client_id, client_secret),
            timeout=30,
        )
    else:
        raise HTTPException(status_code=400, detail=f"OAuth not configured for {provider}")

    if resp.status_code != 200:
        raise HTTPException(
            status_code=400,
            detail=f"OAuth token exchange failed ({resp.status_code}): {resp.text[:200]}",
        )
    body = resp.json()
    now = int(datetime.utcnow().timestamp())
    return {
        "access_token": body.get("access_token"),
        "refresh_token": body.get("refresh_token"),
        "expires_at": now + int(body.get("expires_in", 3600)),
        "token_type": body.get("token_type"),
        "scope": body.get("scope"),
    }
