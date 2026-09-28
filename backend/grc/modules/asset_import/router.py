"""/asset-import endpoints — smart Excel/CSV import wizard (isolated module).

analyze : parse + auto-map + preview (NO writes)
commit  : apply the confirmed mapping -> create/update assets (+ provenance batch)
undo    : remove the assets a batch created
Template download reuses the existing GET /assets/template/download.
"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from grc.models import GRCUser, get_db
from grc.routers.auth_router import get_user_primary_tenant, require_auth

from . import service
from .schema import AnalyzeResponse, CommitResponse, UndoResponse

router = APIRouter(prefix="/asset-import", tags=["Asset Import"])

_MAX_BYTES = 15 * 1024 * 1024  # 15 MB upload cap


async def _read_capped(file: UploadFile) -> bytes:
    content = await file.read()
    if len(content) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 15 MB).")
    if not content:
        raise HTTPException(status_code=400, detail="Empty file.")
    return content


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_file(
    file: UploadFile = File(...),
    kind: str = "asset",
    current_user: GRCUser = Depends(require_auth),
):
    content = await _read_capped(file)
    try:
        return service.analyze(content, file.filename or "upload", kind=kind)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Could not read the file: {e}")


@router.post("/commit", response_model=CommitResponse)
async def commit_file(
    file: UploadFile = File(...),
    mapping: str = Form(...),          # JSON: {source_header: canonical_field|null}
    options: str = Form("{}"),         # JSON: {dupe_strategy: "skip"|"update", header_row: int}
    kind: str = Form("asset"),         # "asset" | "vuln"
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="User is not assigned to any tenant.")
    try:
        colmap = json.loads(mapping)
        opts = json.loads(options or "{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Malformed mapping/options JSON.")
    content = await _read_capped(file)
    fn = file.filename or "upload"
    strat = str(opts.get("dupe_strategy", "skip"))
    hrow = opts.get("header_row")
    try:
        if kind == "vuln":
            return service.commit_vulns(db, tenant_id, content, fn, colmap, dupe_strategy=strat, header_row=hrow)
        return service.commit(db, tenant_id, content, fn, colmap, dupe_strategy=strat, header_row=hrow)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Import failed: {e}")


@router.post("/ai-map")
def ai_map(
    payload: dict = Body(...),
    current_user: GRCUser = Depends(require_auth),
):
    """LLM fallback for bizarre columns the rule-based mapper couldn't place.
    Reuses the already-parsed columns + samples (no re-upload). Returns per-header
    {field, confidence, why}, enforced to the allowed field set."""
    from . import mapping as M
    from .ai_assist import ai_suggest_mapping
    kind = str(payload.get("kind") or "asset")
    columns = [str(c) for c in (payload.get("columns") or [])]
    samples = payload.get("samples") if isinstance(payload.get("samples"), dict) else {}
    return ai_suggest_mapping(columns, samples, M.fields_for(kind))


@router.post("/validate")
async def validate_file(
    file: UploadFile = File(...),
    mapping: str = Form(...),
    options: str = Form("{}"),
    kind: str = Form("asset"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Dry-run the confirmed mapping — create/update/skip counts + per-row data
    issues, before anything is written. Powers the smart preview step."""
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="User is not assigned to any tenant.")
    try:
        colmap = json.loads(mapping)
        opts = json.loads(options or "{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Malformed mapping/options JSON.")
    content = await _read_capped(file)
    fn = file.filename or "upload"
    strat = str(opts.get("dupe_strategy", "skip"))
    hrow = opts.get("header_row")
    try:
        if kind == "vuln":
            return service.validate_vulns(db, tenant_id, content, fn, colmap, dupe_strategy=strat, header_row=hrow)
        return service.validate(db, tenant_id, content, fn, colmap, dupe_strategy=strat, header_row=hrow)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Validation failed: {e}")


@router.get("/history")
def import_history(
    kind: str = "asset",
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Past import batches (newest first) so the UI can list them and offer undo."""
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="User is not assigned to any tenant.")
    return service.history(db, tenant_id, kind=kind)


@router.post("/undo/{batch_id}", response_model=UndoResponse)
def undo_batch(
    batch_id: str,
    kind: str = "asset",
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="User is not assigned to any tenant.")
    if kind == "vuln":
        return service.undo_vulns(db, tenant_id, batch_id)
    return service.undo(db, tenant_id, batch_id)
