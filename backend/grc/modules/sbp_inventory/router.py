"""/sbp-inventory — State Bank of Pakistan offsite IT-asset inventory.

fields          : the 52-column template spec (labels/groups/which are editable)
asset/{id}      : the full derived+stored row for one asset
PATCH asset/{id}: save the stored/reason/override fields
export.xlsx     : the whole tenant as the SBP submission workbook
"""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from grc.models import GRCUser, ITAsset, get_db
from grc.routers.auth_router import get_user_primary_tenant, require_auth

from . import registry as R
from . import service

router = APIRouter(prefix="/sbp-inventory", tags=["SBP Inventory"])


def _tenant(current_user: GRCUser, db: Session) -> int:
    tid = get_user_primary_tenant(current_user, db)
    if not tid:
        raise HTTPException(status_code=400, detail="User is not assigned to any tenant.")
    return tid


@router.get("/fields")
def fields(current_user: GRCUser = Depends(require_auth)):
    meta = R.field_meta()
    groups = []
    for m in meta:
        if m["group"] not in groups:
            groups.append(m["group"])
    return {"fields": meta, "groups": groups, "count": len(meta)}


@router.get("/asset/{asset_id}")
def asset_row(asset_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tid = _tenant(current_user, db)
    asset = db.query(ITAsset).filter(ITAsset.id == asset_id, ITAsset.tenant_id == tid).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found.")
    return {"asset_id": asset.id, "asset_name": getattr(asset, "name", None),
            "fields": service.build_row(db, tid, asset)}


@router.patch("/asset/{asset_id}")
def save_row(asset_id: int, values: dict = Body(...),
             db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tid = _tenant(current_user, db)
    asset = db.query(ITAsset).filter(ITAsset.id == asset_id, ITAsset.tenant_id == tid).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found.")
    data = service.set_stored(db, tid, asset_id, values or {}, user=getattr(current_user, "email", None))
    return {"asset_id": asset_id, "saved": len(data), "fields": service.build_row(db, tid, asset)}


@router.get("/export.xlsx")
def export(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tid = _tenant(current_user, db)
    content = service.export_xlsx(db, tid)
    return StreamingResponse(
        iter([content]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="SBP_Asset_Inventory.xlsx"'},
    )
