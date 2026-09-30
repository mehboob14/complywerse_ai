"""Provider connection settings — /tr-integrations.

Its own prefix (not /integrations) so it can never shadow the legacy
/integrations/{connection_id} scanner routes. Reads are auth-only and never
return secret values; writes need `vendor_risk:integrations:manage` (or the
scanner-connections edit right; Regulatory Intelligence also accepts
`governance:regulatory_changes:edit`). Administrators bypass, as elsewhere.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..models import GRCUser, get_db, TR_PROVIDER_WC1, TR_PROVIDER_TRRI
from ..routers.auth_router import require_auth, get_user_primary_tenant
from ..modules.vendor_risk.tpra.rbac import user_has_any_permission
from . import connections, registry
from .catalog import PROVIDERS, list_providers
from .http import ProviderError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tr-integrations", tags=["Thomson Reuters / LSEG data providers"])


class ConnectionIn(BaseModel):
    mode: Optional[str] = None                     # simulated | live
    name: Optional[str] = None
    base_url: Optional[str] = None
    credentials: Optional[Dict[str, Any]] = None   # write-only; blank = keep
    clear_credentials: Optional[List[str]] = None
    config: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None


def _tenant(user: GRCUser, db: Session) -> int:
    tid = get_user_primary_tenant(user, db)
    if not tid:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenant context")
    return tid


def _provider(provider: str) -> str:
    if provider not in PROVIDERS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown provider '{provider}'")
    return provider


def require_manage(db: Session, user: GRCUser, provider: str) -> None:
    names = ["vendor_risk:integrations:manage", "integrations:connections:edit"]
    if provider == TR_PROVIDER_TRRI:
        names.append("governance:regulatory_changes:edit")
    if not user_has_any_permission(db, user, names):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Permission denied — requires vendor_risk:integrations:manage")


@router.get("/providers")
def get_providers(module: Optional[str] = None, user: GRCUser = Depends(require_auth)):
    return {"items": list_providers(module)}


@router.get("/connections")
def list_connections(module: Optional[str] = None, db: Session = Depends(get_db),
                     user: GRCUser = Depends(require_auth)):
    tid = _tenant(user, db)
    items = []
    for meta in list_providers(module):
        conn = connections.get_connection(db, tid, meta["provider"])
        items.append(connections.serialize(conn, meta["provider"]))
    return {"items": items}


@router.get("/connections/{provider}")
def get_connection(provider: str, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tid = _tenant(user, db)
    _provider(provider)
    return connections.serialize(connections.get_connection(db, tid, provider), provider)


@router.put("/connections/{provider}")
def save_connection(provider: str, body: ConnectionIn, db: Session = Depends(get_db),
                    user: GRCUser = Depends(require_auth)):
    tid = _tenant(user, db)
    _provider(provider)
    require_manage(db, user, provider)
    try:
        conn = connections.upsert_connection(
            db, tid, provider, mode=body.mode, base_url_value=body.base_url, name=body.name,
            credentials_in=body.credentials, clear_credentials=body.clear_credentials,
            config_in=body.config, is_active=body.is_active, actor_id=user.id,
        )
    except connections.ConnectionError_ as e:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    db.commit()
    logger.info("tr connection saved tenant=%s provider=%s mode=%s by user=%s", tid, provider, conn.mode, user.id)
    return connections.serialize(conn, provider)


@router.post("/connections/{provider}/test")
def test_connection(provider: str, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tid = _tenant(user, db)
    _provider(provider)
    require_manage(db, user, provider)
    try:
        conn = connections.require_active(db, tid, provider)
    except connections.NotConfigured as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e))
    try:
        result = registry.client_for(conn).test()
        connections.record_result(conn, True)
    except (ProviderError, ValueError) as e:
        connections.record_result(conn, False, str(e))
        result = {"ok": False, "message": str(e)}
    db.commit()
    return {**result, "connection": connections.serialize(conn, provider)}


@router.get("/connections/{provider}/wc1/groups")
def wc1_groups(provider: str, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """World-Check One groups visible to the stored credentials (group picker)."""
    tid = _tenant(user, db)
    if provider != TR_PROVIDER_WC1:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Groups are only available for World-Check One")
    require_manage(db, user, provider)
    try:
        conn = connections.require_active(db, tid, provider)
        groups = registry.wc1_client(conn).list_groups()
    except connections.NotConfigured as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e))
    except (ProviderError, ValueError) as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"World-Check One: {e}")
    db.commit()  # simulated client may have touched its cache
    return {"items": groups}
