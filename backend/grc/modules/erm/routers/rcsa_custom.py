"""RCSA Custom Templates — bring-your-own-Excel-template endpoints.

Mounted alongside the existing `/rcsa` endpoints; non-invasive — does not
touch ``RCSATemplate`` / ``RCSAQuestion`` / ``RCSACampaign``. A tenant can
keep using the question-based templates AND have one (or many) custom
matrix templates side-by-side.

Endpoint family rooted at ``/erm/rcsa/custom-templates``:

    POST   /custom-templates                     upload + parse + store
    GET    /custom-templates                     list this tenant's templates
    GET    /custom-templates/{id}                detail (schema + counts)
    DELETE /custom-templates/{id}                soft-delete (is_active=False)
    GET    /custom-templates/{id}/download       re-download the original .xlsx
    POST   /custom-templates/{id}/export         export current rows as .xlsx in the same layout

    POST   /custom-templates/{id}/import-rows    seed/append rows from the originally uploaded data
    GET    /custom-templates/{id}/rows           list rows (paginated, filterable)
    POST   /custom-templates/{id}/rows           create one row
    GET    /custom-templates/{id}/rows/{row_id}  fetch one row
    PUT    /custom-templates/{id}/rows/{row_id}  update one row
    DELETE /custom-templates/{id}/rows/{row_id}  delete one row

    POST   /custom-templates/{id}/rows/{row_id}/promote-to-risk
                                                 link this row to the platform's Risk Register

Permission model: re-uses ``erm:rcsa:*`` permissions already in the catalog.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from ....models import (
    GRCUser,
    RCSACustomRow,
    RCSACustomRowEvidence,
    RCSACustomTemplate,
    Risk,
    get_db,
)
from ....routers.auth_router import (
    require_auth,
    get_user_primary_tenant,
    require_tenant_permission,
)
from ..services.rcsa_template_parser import (
    export_rows_to_excel,
    parse_rcsa_template,
)


# Disk root for row-level evidence. Mirrors the framework-risk-evidence
# layout: one shared folder, UUID-prefixed filenames so collisions are
# impossible across tenants.
_EVIDENCE_DIR = "uploads/rcsa_custom_evidence"
os.makedirs(_EVIDENCE_DIR, exist_ok=True)
_MAX_EVIDENCE_BYTES = 50 * 1024 * 1024  # 50 MB

# Cap on AI explanation refresh frequency — protects against accidental
# "click → click → click" token burns from the operator.
_EXPLAIN_REFRESH_COOLDOWN_SECONDS = 5


logger = logging.getLogger(__name__)


router = APIRouter(
    prefix="/rcsa/custom-templates",
    tags=["RCSA — Custom Templates"],
)


# Permission gates — re-use existing RCSA permissions to keep RBAC familiar.
_require_view = require_tenant_permission("erm:rcsa:view")
_require_edit = require_tenant_permission("erm:rcsa:edit")


_MAX_FILE_BYTES = 25 * 1024 * 1024  # 25 MB. Typical RCSA template is < 1 MB.


# ─── Pydantic schemas ────────────────────────────────────────────────────────


class CustomTemplateSummary(BaseModel):
    id: int
    name: str
    description: Optional[str]
    function_area: Optional[str]
    original_filename: str
    sheet_name: Optional[str]
    is_active: bool
    column_count: int
    row_count: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CustomTemplateDetail(BaseModel):
    id: int
    name: str
    description: Optional[str]
    function_area: Optional[str]
    original_filename: str
    sheet_name: Optional[str]
    is_active: bool
    column_schema: Dict[str, Any]
    row_count: int
    file_sha256: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CustomRowResponse(BaseModel):
    id: int
    template_id: int
    risk_id_text: Optional[str]
    inherent_overall_label: Optional[str]
    residual_overall_label: Optional[str]
    inherent_overall_score: Optional[int]
    residual_overall_score: Optional[int]
    data: Dict[str, Any]
    field_origins: Optional[Dict[str, Any]]
    linked_risk_id: Optional[int]
    assigned_user_id: Optional[int] = None
    assigned_user_name: Optional[str] = None
    assigned_user_email: Optional[str] = None
    evidence_count: int = 0
    has_ai_explanation: bool = False
    ai_explanation_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class TenantUserOption(BaseModel):
    """Lean tenant-user payload for the row-assignment dropdown."""
    id: int
    display_name: str
    email: Optional[str] = None


class AssignRowRequest(BaseModel):
    """`null` here means 'unassign'; absent body is rejected at the endpoint."""
    assigned_user_id: Optional[int] = None


class RowEvidenceResponse(BaseModel):
    id: int
    row_id: int
    file_name: str
    file_size: Optional[int] = None
    mime_type: Optional[str] = None
    description: Optional[str] = None
    uploaded_by: Optional[int] = None
    uploaded_by_name: Optional[str] = None
    uploaded_at: datetime
    # When set, this row was linked from the global Evidence Library
    # rather than uploaded fresh. The frontend renders a "From library"
    # badge + a jump-to-evidence link instead of the upload-time meta.
    linked_evidence_id: Optional[int] = None

    class Config:
        from_attributes = True


class LinkEvidenceFromLibraryRequest(BaseModel):
    """Body for `POST .../evidence/from-library`."""
    evidence_id: int
    description: Optional[str] = None


class RowExplanationResponse(BaseModel):
    row_id: int
    explanation: str
    generated_at: datetime
    from_cache: bool


class CustomRowCreate(BaseModel):
    data: Dict[str, Any] = Field(default_factory=dict)
    risk_id_text: Optional[str] = None
    field_origins: Optional[Dict[str, Any]] = None


class CustomRowUpdate(BaseModel):
    data: Optional[Dict[str, Any]] = None
    risk_id_text: Optional[str] = None
    field_origins: Optional[Dict[str, Any]] = None


class PromoteToRiskRequest(BaseModel):
    title_override: Optional[str] = None
    description_override: Optional[str] = None


# ─── Helpers ────────────────────────────────────────────────────────────────


def _tenant_id_or_403(current_user: GRCUser, db: Session) -> int:
    tid = get_user_primary_tenant(current_user, db)
    if not tid:
        raise HTTPException(status_code=403, detail="No tenant context")
    return tid


def _get_template_or_404(template_id: int, tenant_id: int, db: Session) -> RCSACustomTemplate:
    t = (
        db.query(RCSACustomTemplate)
        .filter(
            RCSACustomTemplate.id == template_id,
            RCSACustomTemplate.tenant_id == tenant_id,
        )
        .first()
    )
    if not t:
        raise HTTPException(status_code=404, detail="Custom RCSA template not found")
    return t


def _get_row_or_404(row_id: int, tenant_id: int, template_id: int, db: Session) -> RCSACustomRow:
    r = (
        db.query(RCSACustomRow)
        .filter(
            RCSACustomRow.id == row_id,
            RCSACustomRow.tenant_id == tenant_id,
            RCSACustomRow.template_id == template_id,
        )
        .first()
    )
    if not r:
        raise HTTPException(status_code=404, detail="RCSA assessment item not found")
    return r


# The keys we try to extract into the denormalised columns. We accept either
# the schema-generated snake_case (e.g. inherent_risk_assessment_overall_risk_assessment)
# or a "loose" key (overall_risk_assessment) so this works regardless of which
# template the operator uploaded.
_INHERENT_OVERALL_HINTS = ("inherent", "overall")
_RESIDUAL_OVERALL_HINTS = ("residual", "overall")
_INHERENT_CONCEPT_HINTS = ("inherent", "concept")
_RESIDUAL_CONCEPT_HINTS = ("residual", "concept")
_RISK_ID_HINTS = ("risk_id",)


def _find_value_by_hints(data: Dict[str, Any], hints: tuple[str, ...]) -> Any:
    """Pick the first key whose name contains every hint, in any order."""
    for k, v in data.items():
        k_lower = k.lower()
        if all(h in k_lower for h in hints):
            return v
    return None


def _denorm_from_data(template: RCSACustomTemplate, data: Dict[str, Any]) -> Dict[str, Any]:
    """Pull the convenience columns out of the row payload."""
    return {
        "risk_id_text": (str(_find_value_by_hints(data, _RISK_ID_HINTS))[:60]
                         if _find_value_by_hints(data, _RISK_ID_HINTS) else None),
        "inherent_overall_label": (str(_find_value_by_hints(data, _INHERENT_OVERALL_HINTS))[:40]
                                   if _find_value_by_hints(data, _INHERENT_OVERALL_HINTS) else None),
        "residual_overall_label": (str(_find_value_by_hints(data, _RESIDUAL_OVERALL_HINTS))[:40]
                                   if _find_value_by_hints(data, _RESIDUAL_OVERALL_HINTS) else None),
        "inherent_overall_score": _coerce_int(_find_value_by_hints(data, _INHERENT_CONCEPT_HINTS)),
        "residual_overall_score": _coerce_int(_find_value_by_hints(data, _RESIDUAL_CONCEPT_HINTS)),
    }


def _coerce_int(v: Any) -> Optional[int]:
    if v is None or v == "":
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _row_to_response(r: RCSACustomRow) -> CustomRowResponse:
    assignee = getattr(r, "assignee", None)
    # Use the relationship's len() rather than re-querying — the evidence
    # collection is cascade-loaded with the row.
    try:
        ev_count = len(r.evidence_items) if r.evidence_items is not None else 0
    except Exception:
        ev_count = 0
    return CustomRowResponse(
        id=r.id,
        template_id=r.template_id,
        risk_id_text=r.risk_id_text,
        inherent_overall_label=r.inherent_overall_label,
        residual_overall_label=r.residual_overall_label,
        inherent_overall_score=r.inherent_overall_score,
        residual_overall_score=r.residual_overall_score,
        data=r.data or {},
        field_origins=r.field_origins,
        linked_risk_id=r.linked_risk_id,
        assigned_user_id=getattr(r, "assigned_user_id", None),
        assigned_user_name=(
            (assignee.display_name if getattr(assignee, "display_name", None) else None)
            or (assignee.username if assignee else None)
            if assignee else None
        ),
        assigned_user_email=(getattr(assignee, "email", None) if assignee else None),
        evidence_count=ev_count,
        has_ai_explanation=bool(getattr(r, "ai_explanation", None)),
        ai_explanation_at=getattr(r, "ai_explanation_at", None),
        created_at=r.created_at,
        updated_at=r.updated_at,
    )


def _evidence_to_response(e: RCSACustomRowEvidence) -> RowEvidenceResponse:
    uploader = getattr(e, "uploader", None)
    return RowEvidenceResponse(
        id=e.id,
        row_id=e.row_id,
        file_name=e.file_name,
        file_size=e.file_size,
        mime_type=e.mime_type,
        description=e.description,
        uploaded_by=e.uploaded_by,
        uploaded_by_name=(
            (uploader.display_name if getattr(uploader, "display_name", None) else None)
            or (uploader.username if uploader else None)
            if uploader else None
        ),
        uploaded_at=e.uploaded_at,
        linked_evidence_id=getattr(e, "linked_evidence_id", None),
    )


# ─── Literal-path endpoints ──────────────────────────────────────────────
# These MUST precede `/{template_id}` so FastAPI doesn't coerce them into
# template_id=int and 422 the request. Tenant-users + my-assignments +
# evidence-library all live here.


@router.get("/tenant-users", response_model=List[TenantUserOption])
def list_tenant_users_for_assignment(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_view),
):
    """Active users in the caller's tenant DB. Mirrors
    `/critical-tasks/tenant-users` so the dropdown picks up users created
    via `POST /admin/users` that aren't in the legacy `grc_tenant_users`
    join."""
    users = (
        db.query(GRCUser)
        .filter(GRCUser.is_active.is_(True))
        .order_by(GRCUser.display_name.asc().nullslast(), GRCUser.username.asc())
        .all()
    )
    result = [
        TenantUserOption(
            id=u.id,
            display_name=(u.display_name or u.username or u.email or f"User #{u.id}"),
            email=u.email,
        )
        for u in users
    ]
    if not any(u.id == current_user.id for u in result):
        result.insert(
            0,
            TenantUserOption(
                id=current_user.id,
                display_name=(
                    current_user.display_name
                    or current_user.username
                    or current_user.email
                    or f"User #{current_user.id}"
                ),
                email=current_user.email,
            ),
        )
    return result


# ── My assignments ──────────────────────────────────────────────────────
# Returns every RCSACustomRow assigned to the caller across all of the
# tenant's templates. Surfaces in the "My Work" tab on the custom-
# templates index so an operator can jump straight to the items they own.


class MyAssignmentEntry(BaseModel):
    row_id: int
    template_id: int
    template_name: str
    risk_id_text: Optional[str] = None
    inherent_overall_label: Optional[str] = None
    residual_overall_label: Optional[str] = None
    inherent_overall_score: Optional[int] = None
    residual_overall_score: Optional[int] = None
    evidence_count: int = 0
    updated_at: datetime


@router.get("/my-assignments", response_model=List[MyAssignmentEntry])
def list_my_assignments(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_view),
):
    """Items the calling user owns across every custom RCSA template in
    this tenant. Used by the My Assignments view on the custom-templates
    index page."""
    tenant_id = _tenant_id_or_403(current_user, db)
    rows = (
        db.query(RCSACustomRow)
        .options(joinedload(RCSACustomRow.template), joinedload(RCSACustomRow.evidence_items))
        .filter(
            RCSACustomRow.tenant_id == tenant_id,
            RCSACustomRow.assigned_user_id == current_user.id,
        )
        .order_by(RCSACustomRow.updated_at.desc())
        .all()
    )
    return [
        MyAssignmentEntry(
            row_id=r.id,
            template_id=r.template_id,
            template_name=(r.template.name if r.template else f"Template #{r.template_id}"),
            risk_id_text=r.risk_id_text,
            inherent_overall_label=r.inherent_overall_label,
            residual_overall_label=r.residual_overall_label,
            inherent_overall_score=r.inherent_overall_score,
            residual_overall_score=r.residual_overall_score,
            evidence_count=len(r.evidence_items or []),
            updated_at=r.updated_at,
        )
        for r in rows
    ]


# ── Evidence Library picker ─────────────────────────────────────────────
# Lean Evidence list for the "Pick from library" combobox on the row
# evidence panel. Search by name; capped at 200 to keep the dropdown
# responsive.


class EvidenceLibraryOption(BaseModel):
    id: int
    name: str
    file_name: Optional[str] = None
    file_type: Optional[str] = None
    evidence_type: Optional[str] = None
    status: Optional[str] = None
    uploaded_at: Optional[datetime] = None


@router.get("/evidence-library", response_model=List[EvidenceLibraryOption])
def list_evidence_library(
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_view),
):
    """Tenant-scoped evidence search for the 'Pick from library'
    combobox. Lazy fetch with substring filter on name + file_name."""
    from ....models import Evidence  # local import keeps top of file lean
    tenant_id = _tenant_id_or_403(current_user, db)
    q = db.query(Evidence).filter(Evidence.tenant_id == tenant_id)
    if search and search.strip():
        like = f"%{search.strip()}%"
        q = q.filter(Evidence.name.ilike(like) | Evidence.file_name.ilike(like))
    items = q.order_by(Evidence.uploaded_at.desc()).limit(200).all()
    return [
        EvidenceLibraryOption(
            id=e.id,
            name=e.name,
            file_name=e.file_name,
            file_type=e.file_type,
            evidence_type=e.evidence_type,
            status=e.status,
            uploaded_at=e.uploaded_at,
        )
        for e in items
    ]


# ─── Template endpoints ─────────────────────────────────────────────────────


@router.post("", response_model=CustomTemplateDetail, status_code=201)
async def upload_custom_template(
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    function_area: Optional[str] = Form(None),
    sheet_name: Optional[str] = Form(None),
    seed_from_file: bool = Form(True),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_edit),
):
    """Upload an RCSA Excel template, parse its schema, persist both the
    schema and the original bytes. When ``seed_from_file=True`` (default)
    every data row already present in the spreadsheet is inserted as a
    ``RCSACustomRow`` so the operator immediately sees their existing
    register in the platform.
    """
    tenant_id = _tenant_id_or_403(current_user, db)

    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(422, "File must be a .xlsx (Excel 2007+) workbook")

    content = await file.read()
    if not content:
        raise HTTPException(422, "Uploaded file is empty")
    if len(content) > _MAX_FILE_BYTES:
        raise HTTPException(413, f"File exceeds the {_MAX_FILE_BYTES // (1024 * 1024)} MB limit")

    try:
        parsed = parse_rcsa_template(
            content, original_filename=file.filename, sheet_name=sheet_name,
        )
    except ValueError as exc:
        raise HTTPException(422, f"Template parse failed: {exc}")

    tpl = RCSACustomTemplate(
        tenant_id=tenant_id,
        name=(name or parsed.title or file.filename).strip()[:255],
        description=(description or "").strip() or None,
        function_area=(function_area or parsed.sheet_name or "").strip() or None,
        original_filename=file.filename,
        sheet_name=parsed.sheet_name,
        column_schema=parsed.to_schema_json(),
        original_file=content,
        file_sha256=parsed.file_sha256,
        is_active=True,
        created_by=current_user.id,
    )
    db.add(tpl)
    db.flush()  # populate tpl.id

    seeded = 0
    if seed_from_file and parsed.data_rows:
        for row_data in parsed.data_rows:
            denorm = _denorm_from_data(tpl, row_data)
            db.add(
                RCSACustomRow(
                    tenant_id=tenant_id,
                    template_id=tpl.id,
                    data=row_data,
                    field_origins={k: "imported" for k in row_data.keys()},
                    created_by=current_user.id,
                    **denorm,
                )
            )
            seeded += 1
    db.commit()
    db.refresh(tpl)

    logger.info(
        "rcsa.custom_template.uploaded tenant=%s template_id=%s rows_seeded=%d cols=%d",
        tenant_id, tpl.id, seeded, len(parsed.flat_columns),
    )

    return CustomTemplateDetail(
        id=tpl.id,
        name=tpl.name,
        description=tpl.description,
        function_area=tpl.function_area,
        original_filename=tpl.original_filename,
        sheet_name=tpl.sheet_name,
        is_active=tpl.is_active,
        column_schema=tpl.column_schema,
        row_count=seeded,
        file_sha256=tpl.file_sha256,
        created_at=tpl.created_at,
        updated_at=tpl.updated_at,
    )


@router.get("", response_model=List[CustomTemplateSummary])
def list_custom_templates(
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_view),
):
    tenant_id = _tenant_id_or_403(current_user, db)
    q = db.query(RCSACustomTemplate).filter(RCSACustomTemplate.tenant_id == tenant_id)
    if not include_inactive:
        q = q.filter(RCSACustomTemplate.is_active.is_(True))
    rows: List[CustomTemplateSummary] = []
    for t in q.order_by(RCSACustomTemplate.id.desc()).all():
        cols = (t.column_schema or {}).get("flat_columns") or []
        row_count = (
            db.query(RCSACustomRow)
            .filter(RCSACustomRow.template_id == t.id)
            .count()
        )
        rows.append(CustomTemplateSummary(
            id=t.id,
            name=t.name,
            description=t.description,
            function_area=t.function_area,
            original_filename=t.original_filename,
            sheet_name=t.sheet_name,
            is_active=t.is_active,
            column_count=len(cols),
            row_count=row_count,
            created_at=t.created_at,
            updated_at=t.updated_at,
        ))
    return rows


@router.get("/{template_id}", response_model=CustomTemplateDetail)
def get_custom_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_view),
):
    tenant_id = _tenant_id_or_403(current_user, db)
    t = _get_template_or_404(template_id, tenant_id, db)
    row_count = db.query(RCSACustomRow).filter(RCSACustomRow.template_id == t.id).count()
    return CustomTemplateDetail(
        id=t.id,
        name=t.name,
        description=t.description,
        function_area=t.function_area,
        original_filename=t.original_filename,
        sheet_name=t.sheet_name,
        is_active=t.is_active,
        column_schema=t.column_schema or {},
        row_count=row_count,
        file_sha256=t.file_sha256,
        created_at=t.created_at,
        updated_at=t.updated_at,
    )


@router.delete("/{template_id}")
def deactivate_custom_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_edit),
):
    """Soft-delete — flips ``is_active`` rather than dropping data + history.
    Use ``include_inactive=true`` on list to restore visibility."""
    tenant_id = _tenant_id_or_403(current_user, db)
    t = _get_template_or_404(template_id, tenant_id, db)
    t.is_active = False
    db.commit()
    return {"id": t.id, "is_active": t.is_active}


@router.get("/{template_id}/download")
def download_original_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_view),
):
    tenant_id = _tenant_id_or_403(current_user, db)
    t = _get_template_or_404(template_id, tenant_id, db)
    if not t.original_file:
        raise HTTPException(404, "Original file no longer available")
    return Response(
        content=t.original_file,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{t.original_filename}"'},
    )


@router.post("/{template_id}/export")
def export_current_rows(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_view),
):
    """Export the current rows back to Excel using the template's original
    layout, fonts, merged headers, and column widths. The output is
    visually identical to the uploaded template — only the data area is
    overwritten with our current state.
    """
    tenant_id = _tenant_id_or_403(current_user, db)
    t = _get_template_or_404(template_id, tenant_id, db)
    if not t.original_file:
        raise HTTPException(404, "Original template bytes unavailable for export")
    rows = (
        db.query(RCSACustomRow)
        .filter(RCSACustomRow.template_id == t.id)
        .order_by(RCSACustomRow.id.asc())
        .all()
    )
    rows_data = [r.data or {} for r in rows]
    try:
        out_bytes = export_rows_to_excel(
            template_bytes=t.original_file,
            schema=t.column_schema or {},
            rows_data=rows_data,
        )
    except ValueError as exc:
        raise HTTPException(500, f"Export failed: {exc}")
    fname = (t.original_filename or "rcsa_export.xlsx").replace(".xlsx", "_export.xlsx")
    return Response(
        content=out_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.post("/{template_id}/import-rows")
def reimport_rows_from_original(
    template_id: int,
    replace: bool = Query(False, description="When true, delete existing rows before importing."),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_edit),
):
    """Re-extract data rows from the stored original .xlsx and insert them.
    Use ``replace=true`` to wipe existing rows first. Useful when the
    operator updated the original file outside the platform and uploaded
    a new version, or when seeding was disabled on the original upload.
    """
    tenant_id = _tenant_id_or_403(current_user, db)
    t = _get_template_or_404(template_id, tenant_id, db)
    if not t.original_file:
        raise HTTPException(404, "Original template bytes unavailable for re-import")
    try:
        parsed = parse_rcsa_template(
            t.original_file,
            original_filename=t.original_filename,
            sheet_name=t.sheet_name,
        )
    except ValueError as exc:
        raise HTTPException(422, f"Could not re-parse stored template: {exc}")
    if replace:
        db.query(RCSACustomRow).filter(RCSACustomRow.template_id == t.id).delete()
        db.flush()
    inserted = 0
    for row_data in parsed.data_rows:
        denorm = _denorm_from_data(t, row_data)
        db.add(
            RCSACustomRow(
                tenant_id=tenant_id,
                template_id=t.id,
                data=row_data,
                field_origins={k: "imported" for k in row_data.keys()},
                created_by=current_user.id,
                **denorm,
            )
        )
        inserted += 1
    db.commit()
    return {"template_id": t.id, "imported": inserted, "replaced": replace}


# ─── Row endpoints ──────────────────────────────────────────────────────────


@router.get("/{template_id}/rows", response_model=List[CustomRowResponse])
def list_rows(
    template_id: int,
    limit: int = Query(500, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_view),
):
    tenant_id = _tenant_id_or_403(current_user, db)
    _get_template_or_404(template_id, tenant_id, db)
    rows = (
        db.query(RCSACustomRow)
        .filter(RCSACustomRow.template_id == template_id)
        .order_by(RCSACustomRow.id.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [_row_to_response(r) for r in rows]


@router.post("/{template_id}/rows", response_model=CustomRowResponse, status_code=201)
def create_row(
    template_id: int,
    body: CustomRowCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_edit),
):
    tenant_id = _tenant_id_or_403(current_user, db)
    t = _get_template_or_404(template_id, tenant_id, db)
    data = body.data or {}
    denorm = _denorm_from_data(t, data)
    # Caller's risk_id_text override wins when supplied.
    if body.risk_id_text:
        denorm["risk_id_text"] = body.risk_id_text[:60]
    r = RCSACustomRow(
        tenant_id=tenant_id,
        template_id=t.id,
        data=data,
        field_origins=body.field_origins or {k: "user" for k in data.keys()},
        created_by=current_user.id,
        updated_by=current_user.id,
        **denorm,
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return _row_to_response(r)


@router.get("/{template_id}/rows/{row_id}", response_model=CustomRowResponse)
def get_row(
    template_id: int,
    row_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_view),
):
    tenant_id = _tenant_id_or_403(current_user, db)
    _get_template_or_404(template_id, tenant_id, db)
    r = _get_row_or_404(row_id, tenant_id, template_id, db)
    return _row_to_response(r)


@router.put("/{template_id}/rows/{row_id}", response_model=CustomRowResponse)
def update_row(
    template_id: int,
    row_id: int,
    body: CustomRowUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_edit),
):
    tenant_id = _tenant_id_or_403(current_user, db)
    t = _get_template_or_404(template_id, tenant_id, db)
    r = _get_row_or_404(row_id, tenant_id, template_id, db)
    if body.data is not None:
        # Merge: preserve any field the caller didn't include. Lets the UI
        # PATCH-style without sending the full payload every time.
        merged = dict(r.data or {})
        merged.update(body.data)
        r.data = merged
        denorm = _denorm_from_data(t, merged)
        for k, v in denorm.items():
            setattr(r, k, v)
        # Mark every touched field as user-edited.
        origins = dict(r.field_origins or {})
        for k in body.data.keys():
            origins[k] = "user"
        r.field_origins = origins
    if body.risk_id_text is not None:
        r.risk_id_text = body.risk_id_text[:60] or None
    if body.field_origins is not None:
        r.field_origins = body.field_origins
    r.updated_by = current_user.id
    db.commit()
    db.refresh(r)
    return _row_to_response(r)


@router.delete("/{template_id}/rows/{row_id}")
def delete_row(
    template_id: int,
    row_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_edit),
):
    tenant_id = _tenant_id_or_403(current_user, db)
    _get_template_or_404(template_id, tenant_id, db)
    r = _get_row_or_404(row_id, tenant_id, template_id, db)
    db.delete(r)
    db.commit()
    return {"deleted": row_id}


@router.post("/{template_id}/rows/{row_id}/promote-to-risk")
def promote_row_to_risk(
    template_id: int,
    row_id: int,
    body: PromoteToRiskRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_edit),
):
    """Create (or link to) a first-class platform Risk so KRIs, mitigation
    actions, and dashboards can attach to this row. Idempotent — if the
    row already has ``linked_risk_id``, returns the existing link.
    """
    tenant_id = _tenant_id_or_403(current_user, db)
    _get_template_or_404(template_id, tenant_id, db)
    r = _get_row_or_404(row_id, tenant_id, template_id, db)

    if r.linked_risk_id:
        return {"row_id": r.id, "risk_id": r.linked_risk_id, "created": False}

    data = r.data or {}
    risk_title = (
        body.title_override
        or _find_value_by_hints(data, ("risk_description",))
        or _find_value_by_hints(data, ("process",))
        or r.risk_id_text
        or f"RCSA assessment item #{r.id}"
    )
    risk_description = body.description_override or _find_value_by_hints(data, ("risk_description",))

    new_risk = Risk(
        tenant_id=tenant_id,
        title=str(risk_title)[:500],
        description=str(risk_description)[:5000] if risk_description else None,
        category="operational",
        inherent_impact=r.inherent_overall_score,
        residual_impact=r.residual_overall_score,
        status="identified",
        created_by=current_user.id,
    )
    db.add(new_risk)
    db.flush()
    r.linked_risk_id = new_risk.id
    db.commit()
    db.refresh(r)
    return {"row_id": r.id, "risk_id": new_risk.id, "created": True}


# Tenant-users + my-assignments + evidence-library endpoints are declared
# near the top of this router (before `/{template_id}`) so FastAPI's
# literal-route match catches them before the parametric one.


# ─── Assignment ────────────────────────────────────────────────────────────

@router.patch("/{template_id}/rows/{row_id}/assign", response_model=CustomRowResponse)
def assign_row(
    template_id: int,
    row_id: int,
    body: AssignRowRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_edit),
):
    """Assign (or unassign with `null`) a tenant user to this row. Idempotent
    — re-assigning to the same user is a no-op.
    """
    tenant_id = _tenant_id_or_403(current_user, db)
    _get_template_or_404(template_id, tenant_id, db)
    r = _get_row_or_404(row_id, tenant_id, template_id, db)

    new_user_id = body.assigned_user_id
    if new_user_id is not None:
        # Per-tenant DB layout: any active user in the local `grc_users`
        # table is valid as an assignee. Inactive accounts are rejected
        # so the dropdown can't accidentally re-activate a stale ID.
        user = (
            db.query(GRCUser)
            .filter(GRCUser.id == new_user_id, GRCUser.is_active.is_(True))
            .first()
        )
        if not user:
            raise HTTPException(status_code=400, detail="Assignee not found or inactive")

    r.assigned_user_id = new_user_id
    r.updated_by = current_user.id
    db.commit()
    db.refresh(r)
    return _row_to_response(r)


# ─── AI Explain ────────────────────────────────────────────────────────────

@router.post("/{template_id}/rows/{row_id}/explain", response_model=RowExplanationResponse)
def explain_row(
    template_id: int,
    row_id: int,
    refresh: bool = Query(False, description="Bypass cache and re-generate."),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_view),
):
    """Produce a plain-language explanation of the row's risk content for an
    operator who isn't fluent in the framework jargon. Result is cached on
    the row; `?refresh=true` forces re-generation. If OpenAI isn't
    available the endpoint returns a deterministic structured fallback so
    the UI still shows something useful.
    """
    tenant_id = _tenant_id_or_403(current_user, db)
    t = _get_template_or_404(template_id, tenant_id, db)
    r = _get_row_or_404(row_id, tenant_id, template_id, db)

    # Cached?
    if (
        not refresh
        and r.ai_explanation
        and r.ai_explanation_at
    ):
        return RowExplanationResponse(
            row_id=r.id,
            explanation=r.ai_explanation,
            generated_at=r.ai_explanation_at,
            from_cache=True,
        )

    # Cool-down guard against accidental double-click token burns. We
    # bypass this only when the result is missing entirely.
    if r.ai_explanation_at and not refresh:
        elapsed = (datetime.utcnow() - r.ai_explanation_at).total_seconds()
        if 0 < elapsed < _EXPLAIN_REFRESH_COOLDOWN_SECONDS:
            return RowExplanationResponse(
                row_id=r.id,
                explanation=r.ai_explanation or "",
                generated_at=r.ai_explanation_at,
                from_cache=True,
            )

    # Build the prompt from the row content + schema labels so the LLM
    # knows which value belongs to which concept.
    schema_groups = (t.column_schema or {}).get("groups") or []
    flat_cols = (t.column_schema or {}).get("flat_columns") or []
    key_to_label = {c.get("key"): c.get("label") for c in flat_cols if c.get("key")}

    field_lines: List[str] = []
    for key, value in (r.data or {}).items():
        if value is None or str(value).strip() == "":
            continue
        label = key_to_label.get(key, key)
        field_lines.append(f"- {label}: {value}")

    if not field_lines:
        # Nothing to explain — return a deterministic empty-state message
        # and don't burn tokens.
        explanation = (
            "This assessment item doesn't have any populated fields yet. "
            "Fill in the risk description, inherent / residual scoring, and "
            "any controls before requesting an AI explanation."
        )
        r.ai_explanation = explanation
        r.ai_explanation_at = datetime.utcnow()
        db.commit()
        return RowExplanationResponse(
            row_id=r.id,
            explanation=explanation,
            generated_at=r.ai_explanation_at,
            from_cache=False,
        )

    prompt = (
        "You are a risk-and-control analyst explaining a single assessment "
        "item from an RCSA (risk and control self-assessment) template to a "
        "business stakeholder who is not a risk specialist. Keep the "
        "language plain and concrete. Avoid jargon. Use this structure, and "
        "always refer to the subject as 'this assessment item' (never as "
        "'this row' or by an id):\n\n"
        "1. **What this assessment item is about** — one or two sentences "
        "summarising the risk and the process it applies to.\n"
        "2. **Why it matters** — the business impact in everyday terms.\n"
        "3. **What's already in place** — describe the controls / "
        "mitigations recorded on this assessment item.\n"
        "4. **What's still on the table** — the residual exposure and what "
        "an owner should focus on next.\n\n"
        f"Template name: {t.name}\n"
        f"Function area: {t.function_area or '—'}\n\n"
        "Assessment-item fields:\n"
        + "\n".join(field_lines)
    )

    explanation: Optional[str] = None
    try:
        api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
        base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL") or os.environ.get("OPENAI_BASE_URL")
        if api_key:
            from openai import OpenAI
            kwargs: Dict[str, Any] = {"api_key": api_key}
            if base_url:
                kwargs["base_url"] = base_url
            llm = OpenAI(**kwargs)
            completion = llm.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You explain GRC content in plain language."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
                max_tokens=700,
            )
            text = (completion.choices[0].message.content or "").strip()
            if text:
                explanation = text
    except Exception:  # noqa: BLE001 — degrade to deterministic summary on any LLM failure
        logger.exception("AI explain failed for row_id=%s", row_id)
        explanation = None

    if not explanation:
        # Deterministic fallback so the UI always has something to render.
        bullets = "\n".join(field_lines)
        explanation = (
            "Plain-language summary unavailable (AI offline). Here are this "
            "assessment item's populated fields so an operator can read them "
            f"at a glance:\n\n{bullets}"
        )

    r.ai_explanation = explanation
    r.ai_explanation_at = datetime.utcnow()
    db.commit()
    db.refresh(r)
    return RowExplanationResponse(
        row_id=r.id,
        explanation=explanation,
        generated_at=r.ai_explanation_at,
        from_cache=False,
    )


# ─── Evidence CRUD ─────────────────────────────────────────────────────────

@router.get("/{template_id}/rows/{row_id}/evidence", response_model=List[RowEvidenceResponse])
def list_row_evidence(
    template_id: int,
    row_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_view),
):
    tenant_id = _tenant_id_or_403(current_user, db)
    _get_template_or_404(template_id, tenant_id, db)
    _get_row_or_404(row_id, tenant_id, template_id, db)
    items = (
        db.query(RCSACustomRowEvidence)
        .options(joinedload(RCSACustomRowEvidence.uploader))
        .filter(
            RCSACustomRowEvidence.tenant_id == tenant_id,
            RCSACustomRowEvidence.row_id == row_id,
        )
        .order_by(RCSACustomRowEvidence.uploaded_at.desc())
        .all()
    )
    return [_evidence_to_response(i) for i in items]


@router.post(
    "/{template_id}/rows/{row_id}/evidence",
    response_model=RowEvidenceResponse,
    status_code=201,
)
async def upload_row_evidence(
    template_id: int,
    row_id: int,
    file: UploadFile = File(...),
    description: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_edit),
):
    tenant_id = _tenant_id_or_403(current_user, db)
    _get_template_or_404(template_id, tenant_id, db)
    _get_row_or_404(row_id, tenant_id, template_id, db)

    content = await file.read()
    if len(content) > _MAX_EVIDENCE_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds 50 MB limit")
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    ext = os.path.splitext(file.filename or "")[1]
    unique_filename = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(_EVIDENCE_DIR, unique_filename)
    try:
        with open(file_path, "wb") as buf:
            buf.write(content)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to write RCSA row evidence")
        raise HTTPException(status_code=500, detail=f"Failed to save file: {exc}") from exc

    ev = RCSACustomRowEvidence(
        tenant_id=tenant_id,
        row_id=row_id,
        file_name=(file.filename or "uploaded_file")[:255],
        file_path=file_path,
        file_size=len(content),
        mime_type=(file.content_type or "")[:120] or None,
        description=description,
        uploaded_by=current_user.id,
    )
    db.add(ev)
    db.commit()
    # Refresh with the uploader relationship populated for the response.
    ev = (
        db.query(RCSACustomRowEvidence)
        .options(joinedload(RCSACustomRowEvidence.uploader))
        .filter(RCSACustomRowEvidence.id == ev.id)
        .first()
    )
    return _evidence_to_response(ev)


@router.post(
    "/{template_id}/rows/{row_id}/evidence/from-library",
    response_model=RowEvidenceResponse,
    status_code=201,
)
def link_evidence_from_library(
    template_id: int,
    row_id: int,
    body: LinkEvidenceFromLibraryRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_edit),
):
    """Attach an existing Evidence Library item to this assessment item
    instead of uploading a fresh file. Tenant-scoped; rejects evidence
    that isn't visible to the caller's tenant. Idempotent — picking the
    same library item twice creates two link rows (one per click), so
    the operator can intentionally re-attach the same evidence with a
    different description if useful."""
    from ....models import Evidence  # local import keeps top of file lean
    tenant_id = _tenant_id_or_403(current_user, db)
    _get_template_or_404(template_id, tenant_id, db)
    _get_row_or_404(row_id, tenant_id, template_id, db)
    src = (
        db.query(Evidence)
        .filter(Evidence.id == body.evidence_id, Evidence.tenant_id == tenant_id)
        .first()
    )
    if not src:
        raise HTTPException(status_code=404, detail="Evidence not found in this tenant")

    ev = RCSACustomRowEvidence(
        tenant_id=tenant_id,
        row_id=row_id,
        # Carry the library item's identity through so the download
        # endpoint can stream the existing file unchanged. file_path is
        # a reference to the library file, not a copy — deleting the
        # link does not delete the library file.
        file_name=(src.file_name or src.name or f"evidence-{src.id}")[:255],
        file_path=(src.file_path or ""),
        file_size=None,
        mime_type=(src.file_type or None),
        description=body.description,
        uploaded_by=current_user.id,
        linked_evidence_id=src.id,
    )
    db.add(ev)
    db.commit()
    ev = (
        db.query(RCSACustomRowEvidence)
        .options(joinedload(RCSACustomRowEvidence.uploader))
        .filter(RCSACustomRowEvidence.id == ev.id)
        .first()
    )
    return _evidence_to_response(ev)


@router.get(
    "/{template_id}/rows/{row_id}/evidence/{evidence_id}/download",
    response_class=FileResponse,
)
def download_row_evidence(
    template_id: int,
    row_id: int,
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_view),
):
    tenant_id = _tenant_id_or_403(current_user, db)
    _get_template_or_404(template_id, tenant_id, db)
    _get_row_or_404(row_id, tenant_id, template_id, db)
    ev = (
        db.query(RCSACustomRowEvidence)
        .filter(
            RCSACustomRowEvidence.id == evidence_id,
            RCSACustomRowEvidence.row_id == row_id,
            RCSACustomRowEvidence.tenant_id == tenant_id,
        )
        .first()
    )
    if not ev:
        raise HTTPException(status_code=404, detail="Evidence not found")
    if not os.path.exists(ev.file_path):
        raise HTTPException(status_code=410, detail="Evidence file missing on disk")
    return FileResponse(
        path=ev.file_path,
        filename=ev.file_name,
        media_type=ev.mime_type or "application/octet-stream",
    )


@router.delete("/{template_id}/rows/{row_id}/evidence/{evidence_id}")
def delete_row_evidence(
    template_id: int,
    row_id: int,
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_edit),
):
    tenant_id = _tenant_id_or_403(current_user, db)
    _get_template_or_404(template_id, tenant_id, db)
    _get_row_or_404(row_id, tenant_id, template_id, db)
    ev = (
        db.query(RCSACustomRowEvidence)
        .filter(
            RCSACustomRowEvidence.id == evidence_id,
            RCSACustomRowEvidence.row_id == row_id,
            RCSACustomRowEvidence.tenant_id == tenant_id,
        )
        .first()
    )
    if not ev:
        raise HTTPException(status_code=404, detail="Evidence not found")
    path = ev.file_path
    # Library-linked evidence shares its file with the Evidence Library
    # record — deleting the row evidence here must NOT remove the
    # underlying file or the library would silently break for everyone.
    file_is_owned = getattr(ev, "linked_evidence_id", None) is None
    db.delete(ev)
    db.commit()
    if file_is_owned and path and os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            logger.warning("Could not delete RCSA evidence file: %s", path)
    return {"deleted": evidence_id}
