"""/licenses — software license management (entitlements vs installed software).

GET    /licenses                  the register: every entitlement line + live consumed/position/status
POST   /licenses                  add an entitlement                      -> {id}
PUT    /licenses/{id}             edit (only the keys sent are changed)   -> {id}
DELETE /licenses/{id}             remove an entitlement (and its seats)
GET    /licenses/positions        effective license position per product + the unlicensed list
GET    /licenses/summary          dashboard card aggregates
GET    /licenses/asset/{id}       one asset's installed products with their license status
POST   /licenses/import           CSV / XLSX of entitlements (?dry_run=true to validate only)
GET    /licenses/import/template  the CSV template

Literal routes are registered BEFORE the /{license_id} catch-alls. Writes require
assets:asset_inventory:create|edit|delete; reads require a signed-in tenant user.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from grc.models import GRCUser, get_db
from grc.routers.auth_router import get_user_primary_tenant, require_auth, require_tenant_permission

from . import importer, service

router = APIRouter(prefix="/licenses", tags=["License Management"])

# Reads need a signed-in tenant user (same as the asset routes). Writes ride on the
# IT-asset inventory permissions, the exact strings the UI gates its Add / Edit /
# Delete / Import controls on; Administrator and the tenant's primary contact pass.
_can_create = require_tenant_permission("assets:asset_inventory:create")
_can_edit = require_tenant_permission("assets:asset_inventory:edit")
_can_delete = require_tenant_permission("assets:asset_inventory:delete")


def _tenant(current_user: GRCUser, db: Session) -> int:
    tid = get_user_primary_tenant(current_user, db)
    if not tid:
        raise HTTPException(status_code=400, detail="User is not assigned to any tenant.")
    return tid


def _actor(current_user: GRCUser) -> Optional[str]:
    return getattr(current_user, "email", None) or getattr(current_user, "username", None)


class EntitlementBody(BaseModel):
    """Writable entitlement fields. Types are left loose on purpose: the service
    validates and coerces (so a bad value is a readable 400, not a 422 array) and
    ignores anything else the client echoes back (consumed / position / status...)."""
    model_config = ConfigDict(extra="ignore")

    publisher: Optional[Any] = None
    product: Optional[Any] = None
    edition: Optional[Any] = None
    license_type: Optional[Any] = None
    license_metric: Optional[Any] = None
    total_quantity: Optional[Any] = None
    unit_cost: Optional[Any] = None
    currency: Optional[Any] = None
    po_reference: Optional[Any] = None
    contract_reference: Optional[Any] = None
    reseller: Optional[Any] = None
    purchase_date: Optional[Any] = None
    start_date: Optional[Any] = None
    expiry_date: Optional[Any] = None
    maintenance_included: Optional[Any] = None
    maintenance_expiry: Optional[Any] = None
    support_level: Optional[Any] = None
    downgrade_rights: Optional[Any] = None
    product_key: Optional[Any] = None        # write-only; stored encrypted, never returned
    software_key: Optional[Any] = None       # optional join key(s) to the scanned software
    status: Optional[Any] = None             # active | expired | retired
    notes: Optional[Any] = None


@router.get("")
def list_licenses(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    return service.list_entitlements(db, _tenant(current_user, db))


@router.post("", dependencies=[Depends(_can_create)])
def create_license(body: EntitlementBody, db: Session = Depends(get_db),
                   current_user: GRCUser = Depends(require_auth)):
    tid = _tenant(current_user, db)
    try:
        row = service.create_entitlement(db, tid, body.model_dump(exclude_unset=True), user=_actor(current_user))
    except service.EncryptionUnavailable as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(exc))
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    return {"id": row.id}


@router.get("/positions")
def license_positions(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    return service.compute_license_positions(db, _tenant(current_user, db))


@router.get("/summary")
def license_summary(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    return service.compute_summary(db, _tenant(current_user, db))


@router.get("/asset/{asset_id}")
def asset_licenses(asset_id: int, db: Session = Depends(get_db),
                   current_user: GRCUser = Depends(require_auth)):
    out = service.asset_licenses(db, _tenant(current_user, db), asset_id)
    if out is None:
        raise HTTPException(status_code=404, detail="Asset not found.")
    return out


@router.get("/import/template", response_class=PlainTextResponse)
def import_template(current_user: GRCUser = Depends(require_auth)):
    return PlainTextResponse(
        importer.template_csv(), media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="license_entitlements_template.csv"'},
    )


@router.post("/import", dependencies=[Depends(_can_create)])
def import_licenses(file: UploadFile = File(...), dry_run: bool = Query(False),
                    db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tid = _tenant(current_user, db)
    content = file.file.read(importer.MAX_BYTES + 1)
    try:
        return importer.import_entitlements(db, tid, content, file.filename or "upload.csv",
                                            user=_actor(current_user), dry_run=dry_run)
    except service.EncryptionUnavailable as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(exc))
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001 - a malformed workbook must be a 400, not a 500
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Could not read the file: {exc}")


@router.put("/{license_id}", dependencies=[Depends(_can_edit)])
def update_license(license_id: int, body: EntitlementBody, db: Session = Depends(get_db),
                   current_user: GRCUser = Depends(require_auth)):
    tid = _tenant(current_user, db)
    try:
        row = service.update_entitlement(db, tid, license_id, body.model_dump(exclude_unset=True))
    except service.EncryptionUnavailable as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(exc))
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    if row is None:
        raise HTTPException(status_code=404, detail="License not found.")
    return {"id": row.id}


@router.delete("/{license_id}", dependencies=[Depends(_can_delete)])
def delete_license(license_id: int, db: Session = Depends(get_db),
                   current_user: GRCUser = Depends(require_auth)):
    if not service.delete_entitlement(db, _tenant(current_user, db), license_id):
        raise HTTPException(status_code=404, detail="License not found.")
    return {"id": license_id, "deleted": True}
