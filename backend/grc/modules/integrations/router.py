import logging
import threading
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from grc.db import open_tenant_session
from grc.models import get_db, GRCUser, IntegrationConnection, SyncHistory, IntegrationAuditLog
from grc.routers.auth_router import require_auth, get_user_primary_tenant, require_tenant_permission
from .services.sync_service import SyncService
from .services.exception_service import ExceptionService
from .services.scoring_service import ScoringService
from .services.sla_integration_service import SLAIntegrationService
from .services.control_mapping_service import ControlMappingService
from .services.analytics_service import AnalyticsService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/integrations", tags=["Integrations"])


class ConnectionCreate(BaseModel):
    connection_name: str = Field(..., min_length=1, max_length=200)
    integration_type: str = Field(default="nexpose", max_length=50)
    console_url: str = Field(..., min_length=1, max_length=500)
    console_port: int = Field(default=3780)
    auth_method: str = Field(default="api_key", max_length=20)
    credential_env_prefix: str = Field(..., min_length=1, max_length=100)
    username: Optional[str] = Field(default=None, max_length=255)
    password: Optional[str] = Field(default=None, max_length=500)
    sync_schedule: str = Field(default="0 */4 * * *", max_length=50)
    # Auto-link scanner findings to matching inventory assets. Stored in
    # provider_config; None here means "use the default" (ON for a scanner feed).
    auto_link_assets: Optional[bool] = None
    # Push GRC decisions (false positives, exceptions) to the scanner via its
    # API. Stored in provider_config; default OFF — modifying a customer's
    # scanner configuration is opt-in per connection.
    scanner_writeback: Optional[bool] = None


class ConnectionUpdate(BaseModel):
    connection_name: Optional[str] = None
    console_url: Optional[str] = None
    console_port: Optional[int] = None
    auth_method: Optional[str] = None
    credential_env_prefix: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    sync_schedule: Optional[str] = None
    is_active: Optional[bool] = None
    auto_link_assets: Optional[bool] = None
    scanner_writeback: Optional[bool] = None


class ExceptionRequestCreate(BaseModel):
    vulnerability_id: int
    connection_id: int
    exception_type: str = Field(..., max_length=50)
    reason: str = Field(..., max_length=50)
    justification: str = Field(..., min_length=10, max_length=2000)
    expires_at: Optional[str] = None


class ExceptionReview(BaseModel):
    review_notes: Optional[str] = Field(default=None, max_length=1000)


def _connection_to_dict(c: IntegrationConnection) -> dict:
    return {
        "id": c.id,
        "tenant_id": c.tenant_id,
        "integration_type": c.integration_type,
        "connection_name": c.connection_name,
        "console_url": c.console_url,
        "console_port": c.console_port,
        "auth_method": c.auth_method,
        "credential_env_prefix": c.credential_env_prefix,
        "username": c.username,
        "has_password": bool(c.password),
        "sync_schedule": c.sync_schedule,
        "is_active": c.is_active,
        # Auto-link scanner findings to matching assets — default ON when unset.
        "auto_link_assets": (c.provider_config or {}).get("auto_link_assets", True),
        # Push GRC decisions to the scanner — default OFF when unset (opt-in).
        "scanner_writeback": bool((c.provider_config or {}).get("scanner_writeback", False)),
        "status": c.status,
        "last_sync_at": c.last_sync_at.isoformat() if c.last_sync_at else None,
        "last_sync_status": c.last_sync_status,
        "last_sync_stats": c.last_sync_stats,
        "consecutive_failures": c.consecutive_failures,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


@router.get("/connections")
def list_connections(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("admin:integrations:view")),
    integration_type: Optional[str] = None,
    is_active: Optional[bool] = None,
):
    tenant_id = get_user_primary_tenant(current_user, db)
    query = db.query(IntegrationConnection).filter(
        IntegrationConnection.tenant_id == tenant_id,
    )
    if integration_type:
        query = query.filter(IntegrationConnection.integration_type == integration_type)
    if is_active is not None:
        query = query.filter(IntegrationConnection.is_active == is_active)

    connections = query.order_by(IntegrationConnection.created_at.desc()).all()
    return {"connections": [_connection_to_dict(c) for c in connections]}


@router.post("/connections", status_code=201)
def create_connection(
    body: ConnectionCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("admin:integrations:create")),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    user_id = current_user.id

    existing = db.query(IntegrationConnection).filter(
        IntegrationConnection.tenant_id == tenant_id,
        IntegrationConnection.connection_name == body.connection_name,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Connection name already exists for this tenant")

    connection = IntegrationConnection(
        tenant_id=tenant_id,
        integration_type=body.integration_type,
        connection_name=body.connection_name,
        console_url=body.console_url,
        console_port=body.console_port,
        auth_method=body.auth_method,
        credential_env_prefix=body.credential_env_prefix,
        username=body.username,
        password=body.password,
        sync_schedule=body.sync_schedule,
        created_by_user_id=user_id,
    )
    _cfg = {}
    if body.auto_link_assets is not None:
        _cfg["auto_link_assets"] = bool(body.auto_link_assets)
    if body.scanner_writeback is not None:
        _cfg["scanner_writeback"] = bool(body.scanner_writeback)
    if _cfg:
        connection.provider_config = _cfg
    db.add(connection)
    db.commit()
    db.refresh(connection)

    SyncService._audit(db, tenant_id, "connection", connection.id, "create",
                       performed_by_user_id=user_id)

    return {"connection": _connection_to_dict(connection)}


@router.get("/connections/{connection_id}")
def get_connection(
    connection_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("admin:integrations:view")),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    connection = db.query(IntegrationConnection).filter(
        IntegrationConnection.id == connection_id,
        IntegrationConnection.tenant_id == tenant_id,
    ).first()
    if not connection:
        raise HTTPException(status_code=404, detail="Connection not found")
    return {"connection": _connection_to_dict(connection)}


@router.put("/connections/{connection_id}")
def update_connection(
    connection_id: int,
    body: ConnectionUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("admin:integrations:edit")),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    user_id = current_user.id

    connection = db.query(IntegrationConnection).filter(
        IntegrationConnection.id == connection_id,
        IntegrationConnection.tenant_id == tenant_id,
    ).first()
    if not connection:
        raise HTTPException(status_code=404, detail="Connection not found")

    payload = body.dict(exclude_unset=True)
    # These are not columns — they live in provider_config. Pull them out of
    # the generic setattr loop (which would raise on a non-attribute) and merge.
    auto_link = payload.pop("auto_link_assets", None)
    writeback = payload.pop("scanner_writeback", None)

    changes = {}
    for field_name, val in payload.items():
        old_val = getattr(connection, field_name)
        if old_val != val:
            changes[field_name] = {"old": str(old_val), "new": str(val)}
            setattr(connection, field_name, val)

    if auto_link is not None:
        cfg = dict(connection.provider_config or {})
        if cfg.get("auto_link_assets") != bool(auto_link):
            changes["auto_link_assets"] = {"old": str(cfg.get("auto_link_assets")), "new": str(bool(auto_link))}
            cfg["auto_link_assets"] = bool(auto_link)
            connection.provider_config = cfg  # reassign so SQLAlchemy flags the JSON dirty

    if writeback is not None:
        cfg = dict(connection.provider_config or {})
        if cfg.get("scanner_writeback") != bool(writeback):
            changes["scanner_writeback"] = {"old": str(cfg.get("scanner_writeback")), "new": str(bool(writeback))}
            cfg["scanner_writeback"] = bool(writeback)
            connection.provider_config = cfg

    connection.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(connection)

    if changes:
        SyncService._audit(db, tenant_id, "connection", connection.id, "update",
                           performed_by_user_id=user_id, details={"changes": changes})

    return {"connection": _connection_to_dict(connection)}


def _purge_connection_cascade(db, connection_id: int) -> None:
    """Delete every row that FKs to this integration connection (sync history, audit
    logs, scan records, …) in dependency order, so the connection row itself can be
    removed. Findings are handled by the caller (detached, not deleted). Generic —
    walks information_schema so a newly added child table can't silently block the
    delete the way the ORM cascade gaps did."""
    from sqlalchemy import text as _sql

    def _child_fks(table):
        return db.execute(_sql("""
            SELECT tc.table_name, kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
              ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND ccu.table_name = :t AND ccu.column_name = 'id'
        """), {"t": table}).fetchall()

    def _has_id(table):
        return db.execute(_sql(
            "SELECT 1 FROM information_schema.columns WHERE table_name=:t AND column_name='id'"
        ), {"t": table}).fetchone() is not None

    def _cascade(table, ids, depth=0):
        if not ids or depth > 6:
            return
        for ctable, ccol in _child_fks(table):
            if ctable == table:
                continue
            if _has_id(ctable):
                child_ids = [r[0] for r in db.execute(
                    _sql(f'SELECT id FROM "{ctable}" WHERE "{ccol}" = ANY(:ids)'), {"ids": ids}
                ).fetchall()]
                _cascade(ctable, child_ids, depth + 1)
            db.execute(_sql(f'DELETE FROM "{ctable}" WHERE "{ccol}" = ANY(:ids)'), {"ids": ids})

    _cascade("grc_integration_connections", [connection_id])


@router.delete("/connections/{connection_id}")
def delete_connection(
    connection_id: int,
    purge: bool = False,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("admin:integrations:delete")),
):
    from sqlalchemy import text as _sql

    tenant_id = get_user_primary_tenant(current_user, db)
    user_id = current_user.id

    connection = db.query(IntegrationConnection).filter(
        IntegrationConnection.id == connection_id,
        IntegrationConnection.tenant_id == tenant_id,
    ).first()
    if not connection:
        raise HTTPException(status_code=404, detail="Connection not found")

    if purge:
        # HARD delete — permanently remove the connection so its name is freed and it
        # stops cluttering the list. Findings are PRESERVED (detached: connection_id
        # set NULL), only connection-scoped logs are removed.
        name = connection.connection_name
        db.execute(_sql("UPDATE grc_vulnerabilities SET connection_id = NULL WHERE connection_id = :id"),
                   {"id": connection_id})
        _purge_connection_cascade(db, connection_id)
        db.execute(_sql("DELETE FROM grc_integration_connections WHERE id = :id"), {"id": connection_id})
        db.commit()
        logger.info("Hard-deleted integration connection %s (%s) for tenant %s by user %s",
                    connection_id, name, tenant_id, user_id)
        return {"message": "Connection deleted", "id": connection_id, "purged": True}

    # DEFAULT — soft deactivate (reversible; keeps config + history).
    connection.is_active = False
    connection.status = "deactivated"
    connection.updated_at = datetime.utcnow()
    db.commit()

    SyncService._audit(db, tenant_id, "connection", connection.id, "deactivate",
                       performed_by_user_id=user_id,
                       details={"connection_name": connection.connection_name})

    return {"message": "Connection deactivated", "id": connection.id, "purged": False}


@router.post("/connections/{connection_id}/test")
def test_connection(
    connection_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("admin:integrations:edit")),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    result = SyncService.test_connection(db, connection_id, tenant_id)
    return {
        "success": result.success,
        "message": result.message,
        "server_version": result.server_version,
        "details": result.details,
    }


@router.post("/connections/{connection_id}/sync")
def trigger_sync(
    connection_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("admin:integrations:edit")),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    user_id = current_user.id

    # Validate the connection up front so a bad/inactive one returns an immediate,
    # clear error instead of failing silently in the background worker below.
    conn = db.query(IntegrationConnection).filter(
        IntegrationConnection.id == connection_id,
        IntegrationConnection.tenant_id == tenant_id,
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    if not conn.is_active:
        raise HTTPException(
            status_code=400,
            detail="Connection is deactivated — reactivate it before syncing.",
        )

    # A real scanner sync makes 200+ sequential API calls and can run 30-120s.
    # Holding the HTTP request open that long trips the dev/reverse-proxy gateway
    # timeout: the browser's request dies and the UI reports "Sync failed" even
    # though the sync actually COMPLETES on the server (it just can't deliver the
    # response). So we run it in a background worker with its own tenant DB
    # session and return immediately; the client polls the connection's
    # last_sync_at / status to see when it lands.
    slug = getattr(request.state, "tenant_slug", None)
    if not slug:
        # No tenant context to reopen a session with in a worker — fall back to
        # the synchronous path rather than silently doing nothing.
        try:
            return SyncService.run_full_sync(
                db, connection_id, tenant_id,
                triggered_by_user_id=user_id, sync_type="manual",
            )
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except Exception as e:
            logger.exception(f"Sync trigger failed: {e}")
            raise HTTPException(status_code=500, detail="Sync failed — check logs")

    def _run_bg():
        bg = open_tenant_session(slug)
        try:
            SyncService.run_full_sync(
                bg, connection_id, tenant_id,
                triggered_by_user_id=user_id, sync_type="manual",
            )
        except Exception:
            logger.exception("Background sync failed for connection %s", connection_id)
        finally:
            bg.close()

    threading.Thread(
        target=_run_bg, name=f"sync-conn-{connection_id}", daemon=True
    ).start()
    return {
        "status": "running",
        "connection_id": connection_id,
        "message": "Sync started — it runs in the background; the page updates when it finishes.",
    }


@router.get("/connections/{connection_id}/history")
def get_sync_history(
    connection_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("admin:integrations:view")),
    limit: int = Query(default=20, le=100),
    offset: int = Query(default=0, ge=0),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    records, total = SyncService.get_sync_history(db, connection_id, tenant_id, limit, offset)

    return {
        "total": total,
        "records": [
            {
                "id": r.id,
                "sync_type": r.sync_type,
                "started_at": r.started_at.isoformat() if r.started_at else None,
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
                "duration_ms": r.duration_ms,
                "status": r.status,
                "assets_new": r.assets_new,
                "assets_updated": r.assets_updated,
                "vulns_new": r.vulns_new,
                "vulns_updated": r.vulns_updated,
                "vulns_closed": r.vulns_closed,
                "errors_count": r.errors_count,
            }
            for r in records
        ],
    }


@router.get("/connections/{connection_id}/audit-log")
def get_audit_log(
    connection_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("admin:integrations:view")),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
):
    tenant_id = get_user_primary_tenant(current_user, db)

    query = db.query(IntegrationAuditLog).filter(
        IntegrationAuditLog.tenant_id == tenant_id,
        IntegrationAuditLog.entity_type == "connection",
        IntegrationAuditLog.entity_id == connection_id,
    ).order_by(IntegrationAuditLog.created_at.desc())

    total = query.count()
    records = query.offset(offset).limit(limit).all()

    return {
        "total": total,
        "records": [
            {
                "id": r.id,
                "action": r.action,
                "performed_by": r.performed_by,
                "metadata_info": r.metadata_info,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in records
        ],
    }


@router.get("/exceptions")
def list_exceptions(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:view")),
    status: Optional[str] = None,
    vulnerability_id: Optional[int] = None,
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    records, total = ExceptionService.list_exception_requests(
        db, tenant_id, status=status, vulnerability_id=vulnerability_id,
        limit=limit, offset=offset,
    )
    return {
        "total": total,
        "records": [
            {
                "id": r.id,
                "vulnerability_id": r.vulnerability_id,
                "connection_id": r.connection_id,
                "exception_type": r.exception_type,
                "reason": r.reason,
                "justification": r.justification[:200],
                "status": r.status,
                "requested_by_user_id": r.requested_by_user_id,
                "reviewed_by_user_id": r.reviewed_by_user_id,
                "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
                "push_status": r.push_status,
                "nexpose_exception_id": r.nexpose_exception_id,
                "expires_at": r.expires_at.isoformat() if r.expires_at else None,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in records
        ],
    }


@router.get("/exceptions/{exception_id}")
def get_exception(
    exception_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:view")),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    req = ExceptionService.get_exception_request(db, tenant_id, exception_id)
    if not req:
        raise HTTPException(status_code=404, detail="Exception request not found")
    return {
        "id": req.id,
        "vulnerability_id": req.vulnerability_id,
        "connection_id": req.connection_id,
        "exception_type": req.exception_type,
        "reason": req.reason,
        "justification": req.justification,
        "status": req.status,
        "requested_by_user_id": req.requested_by_user_id,
        "reviewed_by_user_id": req.reviewed_by_user_id,
        "reviewed_at": req.reviewed_at.isoformat() if req.reviewed_at else None,
        "review_notes": req.review_notes,
        "push_status": req.push_status,
        "push_error": req.push_error,
        "nexpose_exception_id": req.nexpose_exception_id,
        "expires_at": req.expires_at.isoformat() if req.expires_at else None,
        "created_at": req.created_at.isoformat() if req.created_at else None,
    }


@router.post("/exceptions", status_code=201)
def create_exception(
    body: ExceptionRequestCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:edit")),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    expires = None
    if body.expires_at:
        try:
            expires = datetime.fromisoformat(body.expires_at)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid expires_at date format")

    try:
        req = ExceptionService.create_exception_request(
            db, tenant_id,
            vulnerability_id=body.vulnerability_id,
            connection_id=body.connection_id,
            exception_type=body.exception_type,
            reason=body.reason,
            justification=body.justification,
            requested_by_user_id=current_user.id,
            expires_at=expires,
        )
        return {"id": req.id, "status": req.status}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/exceptions/{exception_id}/approve")
def approve_exception(
    exception_id: int,
    body: ExceptionReview,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("admin:integrations:edit")),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    try:
        result = ExceptionService.approve_exception(
            db, tenant_id, exception_id,
            reviewed_by_user_id=current_user.id,
            review_notes=body.review_notes,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/exceptions/{exception_id}/reject")
def reject_exception(
    exception_id: int,
    body: ExceptionReview,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("admin:integrations:edit")),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    try:
        result = ExceptionService.reject_exception(
            db, tenant_id, exception_id,
            reviewed_by_user_id=current_user.id,
            review_notes=body.review_notes,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class ExceptionRevoke(BaseModel):
    revoke_reason: Optional[str] = Field(default=None, max_length=1000)


@router.post("/exceptions/{exception_id}/revoke")
def revoke_exception(
    exception_id: int,
    body: ExceptionRevoke,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("admin:integrations:edit")),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    try:
        result = ExceptionService.revoke_exception(
            db, tenant_id, exception_id,
            revoked_by_user_id=current_user.id,
            revoke_reason=body.revoke_reason,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/exceptions/{exception_id}/withdraw")
def withdraw_exception(
    exception_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:edit")),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    try:
        result = ExceptionService.withdraw_exception(
            db, tenant_id, exception_id,
            user_id=current_user.id,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/scoring/recalculate/{vulnerability_id}")
def recalculate_score(
    vulnerability_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:edit")),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    try:
        return ScoringService.recalculate_vulnerability_score(db, vulnerability_id, tenant_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/scoring/batch-recalculate")
def batch_recalculate(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("admin:integrations:edit")),
    connection_id: Optional[int] = None,
):
    tenant_id = get_user_primary_tenant(current_user, db)
    return ScoringService.batch_recalculate(db, tenant_id, connection_id)


@router.post("/sla/assign-deadlines")
def assign_sla_deadlines(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("admin:integrations:edit")),
    connection_id: Optional[int] = None,
):
    tenant_id = get_user_primary_tenant(current_user, db)
    return SLAIntegrationService.assign_sla_for_synced_vulns(db, tenant_id, connection_id)


@router.get("/sla/breaches")
def get_sla_breaches(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:view")),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    return SLAIntegrationService.check_sla_breaches(db, tenant_id)


@router.post("/sla/send-notifications")
def send_sla_notifications(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("admin:integrations:edit")),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    return SLAIntegrationService.run_sla_notifications(db, tenant_id)


@router.post("/control-mapping/auto-map/{vulnerability_id}")
def auto_map_controls(
    vulnerability_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:edit")),
    use_ai: bool = Query(default=True),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    try:
        return ControlMappingService.auto_map_vulnerability(
            db, vulnerability_id, tenant_id, use_ai=use_ai,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/control-mapping/batch-map")
def batch_map_controls(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("admin:integrations:edit")),
    connection_id: Optional[int] = None,
    use_ai: bool = Query(default=False),
    limit: int = Query(default=50, le=200),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    return ControlMappingService.batch_auto_map(
        db, tenant_id, connection_id=connection_id, use_ai=use_ai, limit=limit,
    )


@router.get("/analytics/overview")
def analytics_overview(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:view")),
    connection_id: Optional[int] = None,
):
    tenant_id = get_user_primary_tenant(current_user, db)
    return AnalyticsService.get_overview(db, tenant_id, connection_id)


@router.get("/analytics/trends")
def analytics_trends(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:view")),
    days: int = Query(default=30, le=365),
    connection_id: Optional[int] = None,
):
    tenant_id = get_user_primary_tenant(current_user, db)
    return AnalyticsService.get_trends(db, tenant_id, days, connection_id)


@router.get("/analytics/mttr")
def analytics_mttr(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:view")),
    connection_id: Optional[int] = None,
):
    tenant_id = get_user_primary_tenant(current_user, db)
    return AnalyticsService.get_mttr(db, tenant_id, connection_id)


@router.get("/analytics/sla-compliance")
def analytics_sla_compliance(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:view")),
    connection_id: Optional[int] = None,
):
    tenant_id = get_user_primary_tenant(current_user, db)
    return AnalyticsService.get_sla_compliance(db, tenant_id, connection_id)


@router.get("/analytics/top-assets")
def analytics_top_assets(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:view")),
    limit: int = Query(default=10, le=50),
    connection_id: Optional[int] = None,
):
    tenant_id = get_user_primary_tenant(current_user, db)
    return AnalyticsService.get_top_affected_assets(db, tenant_id, limit, connection_id)


@router.get("/analytics/scanner-coverage")
def analytics_scanner_coverage(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:view")),
    connection_id: Optional[int] = None,
):
    tenant_id = get_user_primary_tenant(current_user, db)
    return AnalyticsService.get_scanner_coverage(db, tenant_id, connection_id)


@router.get("/analytics/connection-stats")
def analytics_connection_stats(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("admin:integrations:view")),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    return AnalyticsService.get_connection_stats(db, tenant_id)


@router.get("/analytics/exception-stats")
def analytics_exception_stats(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:view")),
    connection_id: Optional[int] = None,
):
    tenant_id = get_user_primary_tenant(current_user, db)
    return AnalyticsService.get_exception_analytics(db, tenant_id, connection_id)


@router.get("/analytics/scoring-distribution")
def analytics_scoring_distribution(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:view")),
    connection_id: Optional[int] = None,
):
    tenant_id = get_user_primary_tenant(current_user, db)
    return AnalyticsService.get_scoring_distribution(db, tenant_id, connection_id)


class ManualControlMapping(BaseModel):
    vulnerability_id: int
    framework_control_id: int
    compliance_impact: str = Field(default="at_risk", max_length=50)
    notes: Optional[str] = Field(default=None, max_length=500)


@router.post("/control-mapping/manual")
def manual_control_mapping(
    body: ManualControlMapping,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:edit")),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    from grc.models import Vulnerability, FrameworkControl, VulnerabilityControlLink

    vuln = db.query(Vulnerability).filter(
        Vulnerability.id == body.vulnerability_id,
        Vulnerability.tenant_id == tenant_id,
    ).first()
    if not vuln:
        raise HTTPException(status_code=404, detail="Vulnerability not found")

    ctrl = db.query(FrameworkControl).filter(
        FrameworkControl.id == body.framework_control_id,
        FrameworkControl.tenant_id == tenant_id,
    ).first()
    if not ctrl:
        raise HTTPException(status_code=404, detail="Framework control not found")

    existing = db.query(VulnerabilityControlLink).filter(
        VulnerabilityControlLink.vulnerability_id == body.vulnerability_id,
        VulnerabilityControlLink.framework_control_id == body.framework_control_id,
    ).first()

    if existing:
        existing.compliance_impact = body.compliance_impact
        existing.mapping_source = "manual"
        existing.confidence_score = 1.0
        existing.notes = body.notes
        existing.is_active = True
        db.commit()
        return {"status": "updated", "link_id": existing.id}

    from datetime import datetime as dt
    link = VulnerabilityControlLink(
        vulnerability_id=body.vulnerability_id,
        framework_control_id=body.framework_control_id,
        compliance_impact=body.compliance_impact,
        mapping_source="manual",
        confidence_score=1.0,
        notes=body.notes,
        is_active=True,
        created_at=dt.utcnow(),
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return {"status": "created", "link_id": link.id}
