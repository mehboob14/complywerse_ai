"""Statutory Audit / Audit Observations — Auditor Portal workspace.

CRUD + status workflow + evidence/linkages + AI document parse (draft) → confirm.
Mounted under `/auditor-portal/statutory-audit`.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session, joinedload

from ....config import get_openai_api_key, get_openai_base_url, get_openai_model
from ....models import (
    AuditObservation,
    AuditObservationActivity,
    AuditObservationControlLink,
    AuditObservationDocumentLink,
    AuditObservationEvidenceLink,
    AuditObservationIssueLink,
    AuditObservationRiskLink,
    Evidence,
    GovernanceDocument,
    GRCUser,
    InternalControl,
    Issue,
    Risk,
    get_db,
)
from ....routers.auth_router import get_user_primary_tenant, get_user_tenants, require_auth
from ....rich_audit import write_rich_audit_log

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/statutory-audit", tags=["Auditor Portal - Statutory Audit"])

STATUSES = {"open", "in_progress", "complied", "closed", "cancelled"}
PRIORITIES = {"critical", "high", "medium", "low"}
OBS_TYPES = {"requirement", "observation", "finding", "recommendation"}
STATUS_TRANSITIONS = {
    "open": {"in_progress", "complied", "closed", "cancelled"},
    "in_progress": {"open", "complied", "closed", "cancelled"},
    "complied": {"in_progress", "closed", "open"},
    "closed": {"open", "in_progress"},
    "cancelled": {"open"},
}

_UPLOAD_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "uploads", "statutory-audit-evidence"
)
_ensured_engines: set[int] = set()


def _get_openai_client():
    """Build OpenAI client from env; return (client, error_message)."""
    api_key = get_openai_api_key()
    if not api_key:
        return None, (
            "AI is not configured. Set OPENAI_API_KEY (or AI_INTEGRATIONS_OPENAI_API_KEY) "
            "on the server, then try again."
        )
    try:
        from openai import OpenAI

        kwargs: Dict[str, Any] = {"api_key": api_key}
        base_url = get_openai_base_url()
        if base_url:
            kwargs["base_url"] = base_url
        return OpenAI(**kwargs), None
    except Exception as e:
        return None, f"Could not initialize the AI client: {e}"


def _ensure_category_column(db: Session) -> None:
    """Additive column for existing deployments (create_all will not ALTER)."""
    try:
        db.execute(
            text(
                "ALTER TABLE grc_audit_observations "
                "ADD COLUMN IF NOT EXISTS category VARCHAR(120)"
            )
        )
        db.flush()
    except Exception as e:  # pragma: no cover
        try:
            db.rollback()
        except Exception:
            pass
        logger.warning("statutory audit category column ensure failed: %s", e)


def _ensure_tables(db: Session) -> None:
    """Create statutory-audit tables if missing. Tolerates orphaned PG types / races."""
    engine = db.get_bind()
    eid = id(engine)
    if eid in _ensured_engines:
        _ensure_category_column(db)
        return
    try:
        from sqlalchemy import inspect as sa_inspect

        inspector = sa_inspect(engine)
        for model in (
            AuditObservation,
            AuditObservationEvidenceLink,
            AuditObservationControlLink,
            AuditObservationRiskLink,
            AuditObservationIssueLink,
            AuditObservationDocumentLink,
            AuditObservationActivity,
        ):
            table = model.__table__
            if inspector.has_table(table.name):
                continue
            try:
                table.create(bind=engine, checkfirst=True)
            except Exception as te:
                # Concurrent create_all / leftover composite type — re-check.
                if inspector.has_table(table.name):
                    continue
                logger.warning("statutory audit create %s failed: %s", table.name, te)
        _ensured_engines.add(eid)
        _ensure_category_column(db)
    except Exception as e:  # pragma: no cover
        logger.warning("statutory audit table self-heal failed: %s", e)
        # Still mark ensured if tables already exist so we don't retry forever.
        try:
            from sqlalchemy import inspect as sa_inspect

            if sa_inspect(engine).has_table(AuditObservation.__tablename__):
                _ensured_engines.add(eid)
                _ensure_category_column(db)
        except Exception:
            pass


def _tenant_ids(current_user: GRCUser, db: Session) -> List[int]:
    ids = get_user_tenants(current_user, db)
    if not ids:
        raise HTTPException(status_code=403, detail="User is not associated with any tenant")
    return ids


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _user_name(db: Session, user_id: Optional[int]) -> Optional[str]:
    if not user_id:
        return None
    u = db.query(GRCUser).filter(GRCUser.id == user_id).first()
    return (u.display_name or u.email) if u else None


def _log_activity(
    db: Session,
    observation_id: int,
    user_id: Optional[int],
    activity_type: str,
    message: Optional[str] = None,
    payload: Optional[dict] = None,
) -> None:
    db.add(
        AuditObservationActivity(
            observation_id=observation_id,
            user_id=user_id,
            activity_type=activity_type,
            message=message,
            payload=payload,
        )
    )


def _next_code(db: Session, tenant_id: int, *, seq: Optional[int] = None) -> str:
    if seq is None:
        count = (
            db.query(func.count(AuditObservation.id))
            .filter(AuditObservation.tenant_id == tenant_id)
            .scalar()
            or 0
        )
        seq = count + 1
    return f"SAO-{seq:03d}"


def _get_obs(obs_id: int, tenant_ids: List[int], db: Session) -> AuditObservation:
    obs = (
        db.query(AuditObservation)
        .filter(AuditObservation.id == obs_id, AuditObservation.tenant_id.in_(tenant_ids))
        .first()
    )
    if not obs:
        raise HTTPException(status_code=404, detail="Observation not found")
    return obs


def serialize_observation(db: Session, obs: AuditObservation, *, with_links: bool = False) -> dict:
    data = {
        "id": obs.id,
        "code": obs.code,
        "title": obs.title,
        "description": obs.description,
        "observation_type": obs.observation_type,
        "regulator_source": obs.regulator_source,
        "regulation_reference": obs.regulation_reference,
        "priority": obs.priority,
        "status": obs.status,
        "audit_period": obs.audit_period,
        "due_date": _iso(obs.due_date),
        "management_response": obs.management_response,
        "notes": obs.notes,
        "area_domain": obs.area_domain,
        "category": getattr(obs, "category", None),
        "owner_id": obs.owner_id,
        "owner_name": _user_name(db, obs.owner_id),
        "created_by": obs.created_by,
        "created_by_name": _user_name(db, obs.created_by),
        "closed_at": _iso(obs.closed_at),
        "closed_by": obs.closed_by,
        "source_document_name": obs.source_document_name,
        "import_batch_id": obs.import_batch_id,
        "created_at": _iso(obs.created_at),
        "updated_at": _iso(obs.updated_at),
        "evidence_count": len(obs.evidence_links or []),
        "control_count": len(obs.control_links or []),
        "risk_count": len(obs.risk_links or []),
        "issue_count": len(obs.issue_links or []),
        "document_count": len(obs.document_links or []),
    }
    if with_links:
        data["evidence"] = [
            {
                "id": ln.id,
                "evidence_id": ln.evidence_id,
                "name": getattr(ln.evidence, "name", None),
                "file_name": getattr(ln.evidence, "file_name", None),
                "relationship_type": ln.relationship_type,
                "notes": ln.notes,
                "created_at": _iso(ln.created_at),
            }
            for ln in (obs.evidence_links or [])
        ]
        data["controls"] = [
            {
                "id": ln.id,
                "internal_control_id": ln.internal_control_id,
                "control_id": getattr(ln.control, "control_id", None),
                "name": getattr(ln.control, "name", None),
                "notes": ln.notes,
            }
            for ln in (obs.control_links or [])
        ]
        data["risks"] = [
            {
                "id": ln.id,
                "risk_id": ln.risk_id,
                "title": getattr(ln.risk, "title", None) or getattr(ln.risk, "name", None),
                "severity": getattr(ln.risk, "inherent_risk_level", None) or getattr(ln.risk, "severity", None),
                "notes": ln.notes,
            }
            for ln in (obs.risk_links or [])
        ]
        data["issues"] = [
            {
                "id": ln.id,
                "issue_id": ln.issue_id,
                "code": getattr(ln.issue, "code", None),
                "title": getattr(ln.issue, "title", None),
                "status": getattr(ln.issue, "workflow_state", None) or getattr(ln.issue, "status", None),
                "notes": ln.notes,
            }
            for ln in (obs.issue_links or [])
        ]
        data["documents"] = [
            {
                "id": ln.id,
                "document_id": ln.document_id,
                "title": getattr(ln.document, "title", None),
                "doc_type": getattr(ln.document, "doc_type", None),
                "status": getattr(ln.document, "status", None),
                "notes": ln.notes,
            }
            for ln in (obs.document_links or [])
        ]
        acts = (
            db.query(AuditObservationActivity)
            .filter(AuditObservationActivity.observation_id == obs.id)
            .order_by(AuditObservationActivity.created_at.desc())
            .limit(50)
            .all()
        )
        data["history"] = [
            {
                "id": a.id,
                "activity_type": a.activity_type,
                "message": a.message,
                "payload": a.payload,
                "user_id": a.user_id,
                "user_name": _user_name(db, a.user_id),
                "created_at": _iso(a.created_at),
            }
            for a in acts
        ]
    return data


# ── Schemas ──────────────────────────────────────────────────────────────────
class ObservationCreate(BaseModel):
    title: str
    description: Optional[str] = None
    observation_type: str = "observation"
    regulator_source: Optional[str] = None
    regulation_reference: Optional[str] = None
    priority: str = "medium"
    status: str = "open"
    audit_period: Optional[str] = None
    due_date: Optional[datetime] = None
    management_response: Optional[str] = None
    notes: Optional[str] = None
    area_domain: Optional[str] = None
    category: Optional[str] = None
    owner_id: Optional[int] = None


class ObservationUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    observation_type: Optional[str] = None
    regulator_source: Optional[str] = None
    regulation_reference: Optional[str] = None
    priority: Optional[str] = None
    audit_period: Optional[str] = None
    due_date: Optional[datetime] = None
    management_response: Optional[str] = None
    notes: Optional[str] = None
    area_domain: Optional[str] = None
    category: Optional[str] = None
    owner_id: Optional[int] = None


class StatusTransition(BaseModel):
    status: str
    notes: Optional[str] = None


class ConfirmImportItem(BaseModel):
    title: str
    description: Optional[str] = None
    observation_type: str = "requirement"
    regulator_source: Optional[str] = None
    regulation_reference: Optional[str] = None
    priority: str = "medium"
    audit_period: Optional[str] = None
    due_date: Optional[str] = None
    area_domain: Optional[str] = None
    category: Optional[str] = None
    selected: bool = True


class ConfirmImportRequest(BaseModel):
    observations: List[ConfirmImportItem]
    source_document_name: Optional[str] = None
    import_batch_id: Optional[str] = None
    default_category: Optional[str] = None


class LinkBody(BaseModel):
    notes: Optional[str] = None


class EvidenceLinkBody(BaseModel):
    evidence_id: int
    relationship_type: str = "proof"
    notes: Optional[str] = None


# ── List / CRUD ──────────────────────────────────────────────────────────────
@router.get("/observations")
def list_observations(
    search: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    regulator_source: Optional[str] = Query(None),
    audit_period: Optional[str] = Query(None),
    observation_type: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)
    q = db.query(AuditObservation).filter(AuditObservation.tenant_id.in_(tenant_ids))
    if status_filter and status_filter != "all":
        q = q.filter(AuditObservation.status == status_filter)
    if priority and priority != "all":
        q = q.filter(AuditObservation.priority == priority)
    if regulator_source and regulator_source != "all":
        q = q.filter(AuditObservation.regulator_source.ilike(f"%{regulator_source}%"))
    if audit_period and audit_period != "all":
        q = q.filter(AuditObservation.audit_period.ilike(f"%{audit_period}%"))
    if observation_type and observation_type != "all":
        q = q.filter(AuditObservation.observation_type == observation_type)
    if category and category != "all":
        q = q.filter(AuditObservation.category.ilike(category.strip()))
    if search:
        like = f"%{search.strip()}%"
        q = q.filter(
            or_(
                AuditObservation.title.ilike(like),
                AuditObservation.description.ilike(like),
                AuditObservation.code.ilike(like),
                AuditObservation.regulation_reference.ilike(like),
                AuditObservation.regulator_source.ilike(like),
                AuditObservation.category.ilike(like),
            )
        )
    total = q.count()
    items = (
        q.options(
            joinedload(AuditObservation.evidence_links),
            joinedload(AuditObservation.control_links),
            joinedload(AuditObservation.risk_links),
            joinedload(AuditObservation.issue_links),
            joinedload(AuditObservation.document_links),
        )
        .order_by(AuditObservation.updated_at.desc())
        .offset(skip)
        .limit(min(limit, 500))
        .all()
    )
    return {
        "items": [serialize_observation(db, o) for o in items],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.get("/observations/meta")
def observations_meta(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Distinct filter values for the list UI."""
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)
    sources = [
        r[0]
        for r in db.query(AuditObservation.regulator_source)
        .filter(
            AuditObservation.tenant_id.in_(tenant_ids),
            AuditObservation.regulator_source.isnot(None),
            AuditObservation.regulator_source != "",
        )
        .distinct()
        .all()
    ]
    periods = [
        r[0]
        for r in db.query(AuditObservation.audit_period)
        .filter(
            AuditObservation.tenant_id.in_(tenant_ids),
            AuditObservation.audit_period.isnot(None),
            AuditObservation.audit_period != "",
        )
        .distinct()
        .all()
    ]
    categories = [
        r[0]
        for r in db.query(AuditObservation.category)
        .filter(
            AuditObservation.tenant_id.in_(tenant_ids),
            AuditObservation.category.isnot(None),
            AuditObservation.category != "",
        )
        .distinct()
        .all()
    ]
    by_status = {
        row[0]: row[1]
        for row in db.query(AuditObservation.status, func.count(AuditObservation.id))
        .filter(AuditObservation.tenant_id.in_(tenant_ids))
        .group_by(AuditObservation.status)
        .all()
    }
    return {
        "statuses": sorted(STATUSES),
        "priorities": sorted(PRIORITIES),
        "observation_types": sorted(OBS_TYPES),
        "regulator_sources": sorted(sources),
        "audit_periods": sorted(periods),
        "categories": sorted(categories),
        "counts_by_status": by_status,
    }


@router.post("/observations", status_code=status.HTTP_201_CREATED)
def create_observation(
    payload: ObservationCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)
    tenant_id = get_user_primary_tenant(current_user, db) or tenant_ids[0]

    obs_type = (payload.observation_type or "observation").lower()
    if obs_type not in OBS_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid observation_type. One of {sorted(OBS_TYPES)}")
    priority = (payload.priority or "medium").lower()
    if priority not in PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority. One of {sorted(PRIORITIES)}")
    st = (payload.status or "open").lower()
    if st not in STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. One of {sorted(STATUSES)}")

    obs = AuditObservation(
        tenant_id=tenant_id,
        code=_next_code(db, tenant_id),
        title=payload.title.strip(),
        description=payload.description,
        observation_type=obs_type,
        regulator_source=payload.regulator_source,
        regulation_reference=payload.regulation_reference,
        priority=priority,
        status=st,
        audit_period=payload.audit_period,
        due_date=payload.due_date,
        management_response=payload.management_response,
        notes=payload.notes,
        area_domain=payload.area_domain,
        category=(payload.category or "").strip() or None,
        owner_id=payload.owner_id,
        created_by=current_user.id,
    )
    db.add(obs)
    db.flush()
    _log_activity(db, obs.id, current_user.id, "created", f'Registered "{obs.title}"')
    write_rich_audit_log(
        db=db,
        tenant_id=tenant_id,
        user_id=current_user.id,
        action="create",
        resource_type="audit_observation",
        resource_id=obs.id,
        resource_name=obs.title,
        summary=f'Created audit observation {obs.code}',
    )
    db.commit()
    db.refresh(obs)
    return serialize_observation(db, obs, with_links=True)


_MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB
_MIN_EXTRACTED_CHARS = 40


# AI import routes MUST be declared before /observations/{obs_id}
@router.post("/observations/upload-parse")
async def upload_parse_observations(
    file: UploadFile = File(...),
    regulator_hint: Optional[str] = Form(None),
    audit_period_hint: Optional[str] = Form(None),
    category_hint: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Extract draft observations from PDF/Word/Excel/CSV/text. Does NOT write to DB."""
    try:
        _ensure_tables(db)
        _tenant_ids(current_user, db)

        filename = file.filename or "audit_document"
        ext = (filename.rsplit(".", 1)[-1] if "." in filename else "").lower()
        _AI_IMPORT_EXTS = {
            "pdf", "doc", "docx",
            "xls", "xlsx",
            "csv", "tsv",
            "txt", "md", "rtf", "json", "log",
        }
        if ext not in _AI_IMPORT_EXTS:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Unsupported file type. "
                    "Use PDF, Word (.doc/.docx), Excel (.xls/.xlsx), CSV, or plain text."
                ),
            )
        if ext == "pdf":
            file_type = "pdf"
        elif ext in {"docx", "doc"}:
            file_type = ext
        elif ext in {"xlsx", "xls"}:
            file_type = ext
        else:
            # csv/tsv/txt/md/rtf/json/log — decode as text
            file_type = "txt"

        try:
            from ...governance.routers.policy_parser import extract_text_from_bytes
        except Exception as e:
            logger.exception("statutory upload-parse: text extraction import failed")
            raise HTTPException(
                status_code=503,
                detail=f"Text extraction is unavailable on the server: {e}",
            )

        contents = await file.read()
        if not contents:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")
        if len(contents) > _MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"File is too large ({len(contents) // (1024 * 1024)} MB). "
                    f"Maximum size is {_MAX_UPLOAD_BYTES // (1024 * 1024)} MB. "
                    "Split the document or upload a text-based excerpt."
                ),
            )

        try:
            # Cap pages for interactive AI import so multi-page scanned OCR
            # cannot run unbounded (that previously caused Next proxy hang-ups).
            extracted = extract_text_from_bytes(
                contents,
                file_type,
                filename,
                max_pages=20 if file_type == "pdf" else None,
                allow_ocr=True,
            )
        except Exception as e:
            logger.exception("statutory upload-parse: extract failed for %s", filename)
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Could not read document '{filename}': {e}. "
                    "Try PDF, Word, Excel (.xlsx), CSV, or a plain-text file."
                ),
            )

        text = (extracted or "").strip()
        if len(text) < _MIN_EXTRACTED_CHARS:
            raise HTTPException(
                status_code=422,
                detail=(
                    "Could not extract enough text from the uploaded file. "
                    "If this is a scanned PDF, install Tesseract OCR on the server, "
                    "or upload a text-based PDF, Word, Excel, CSV, or .txt file instead."
                ),
            )
        if len(text) > 14000:
            text = text[:14000] + "\n\n...[truncated]"

        client, client_err = _get_openai_client()
        if not client:
            raise HTTPException(status_code=503, detail=client_err or "AI client not configured.")

        hint_bits = []
        if regulator_hint:
            hint_bits.append(f"Regulator/source hint: {regulator_hint}")
        if audit_period_hint:
            hint_bits.append(f"Audit period hint: {audit_period_hint}")
        if category_hint:
            hint_bits.append(
                f"Category / grouping hint (apply to all rows unless a clearer per-item category is obvious): {category_hint}"
            )
        hints = "\n".join(hint_bits)

        prompt = f"""You are a Senior External / Statutory Audit specialist.
Extract discrete audit observations, findings, and regulatory requirements from the document.
Each item should be something an auditor can track to closure (one requirement or observation per row).

{hints}

Return ONLY valid JSON:
{{
  "regulator_source": "string or null",
  "audit_period": "string or null",
  "category": "grouping label or null (e.g. Inspection, IFPD Circular, Licensing)",
  "observations": [
    {{
      "title": "short title",
      "description": "what was found / what is required",
      "observation_type": "requirement|observation|finding|recommendation",
      "regulator_source": "string or null",
      "regulation_reference": "circular/clause/ref or null",
      "priority": "critical|high|medium|low",
      "due_date": "YYYY-MM-DD or null",
      "area_domain": "business area or null",
      "category": "grouping label or null",
      "confidence": 0.0
    }}
  ]
}}

DOCUMENT TEXT:
{text}
"""

        model_name = get_openai_model()
        try:
            response = client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": "You extract audit observations as JSON only."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.2,
                max_tokens=4500,
                response_format={"type": "json_object"},
            )
            choice = response.choices[0] if response.choices else None
            msg = choice.message if choice else None
            raw = ((msg.content if msg else None) or "").strip()
            if not raw and msg is not None:
                refusal = getattr(msg, "refusal", None)
                if refusal:
                    raise HTTPException(
                        status_code=502,
                        detail=f"AI declined to process this document: {refusal}",
                    )
            if not raw:
                raise HTTPException(
                    status_code=502,
                    detail=(
                        "AI returned an empty response. Try again with a clearer document, "
                        "or register observations manually."
                    ),
                )
            analysis = json.loads(raw)
        except HTTPException:
            raise
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=502,
                detail="AI returned invalid JSON. Try again with a clearer document, or register manually.",
            )
        except Exception as e:
            msg = str(e)
            lower = msg.lower()
            if "api_key" in lower or "authentication" in lower or "401" in lower:
                detail = "AI provider authentication failed. Check the OpenAI API key on the server."
                code = 503
            elif "rate" in lower or "429" in lower:
                detail = "AI provider rate limit reached. Wait a moment and try again."
                code = 503
            elif "model" in lower and ("not found" in lower or "does not exist" in lower or "404" in lower):
                detail = (
                    f"Configured AI model '{model_name}' is not available. "
                    "Update OPENAI_MODEL / AI_INTEGRATIONS_OPENAI_MODEL on the server."
                )
                code = 503
            else:
                detail = f"AI extraction failed: {msg}"
                code = 502
            logger.warning("statutory upload-parse AI failed: %s", msg)
            raise HTTPException(status_code=code, detail=detail)

        if not isinstance(analysis, dict):
            raise HTTPException(
                status_code=502,
                detail="AI returned an unexpected payload. Try again, or register observations manually.",
            )

        drafts = []
        for row in analysis.get("observations") or []:
            if not isinstance(row, dict):
                continue
            title = (row.get("title") or "").strip()
            if not title:
                continue
            prio = (row.get("priority") or "medium").lower()
            if prio not in PRIORITIES:
                prio = "medium"
            otype = (row.get("observation_type") or "observation").lower()
            if otype not in OBS_TYPES:
                otype = "observation"
            drafts.append(
                {
                    "title": title,
                    "description": row.get("description"),
                    "observation_type": otype,
                    "regulator_source": row.get("regulator_source")
                    or analysis.get("regulator_source")
                    or regulator_hint,
                    "regulation_reference": row.get("regulation_reference"),
                    "priority": prio,
                    "audit_period": analysis.get("audit_period") or audit_period_hint,
                    "due_date": row.get("due_date"),
                    "area_domain": row.get("area_domain"),
                    "category": (
                        (row.get("category") or analysis.get("category") or category_hint or "")
                        .strip()
                        or None
                    ),
                    "confidence": row.get("confidence"),
                    "selected": True,
                }
            )

        if not drafts:
            raise HTTPException(
                status_code=422,
                detail=(
                    "AI did not find any discrete observations in this document. "
                    "Try a clearer circular/letter, or register observations manually."
                ),
            )

        return {
            "draft_observations": drafts,
            "source_file": filename,
            "regulator_source": analysis.get("regulator_source") or regulator_hint,
            "audit_period": analysis.get("audit_period") or audit_period_hint,
            "category": analysis.get("category") or category_hint,
            "import_batch_id": str(uuid.uuid4()),
            "count": len(drafts),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("statutory upload-parse unexpected failure")
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error while importing with AI: {e}",
        )


@router.post("/observations/confirm", status_code=status.HTTP_201_CREATED)
def confirm_import(
    payload: ConfirmImportRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Bulk-create observations from user-confirmed AI drafts."""
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)
    tenant_id = get_user_primary_tenant(current_user, db) or tenant_ids[0]
    batch_id = payload.import_batch_id or str(uuid.uuid4())

    created = []
    base_count = (
        db.query(func.count(AuditObservation.id))
        .filter(AuditObservation.tenant_id == tenant_id)
        .scalar()
        or 0
    )
    for item in payload.observations:
        if not item.selected:
            continue
        title = (item.title or "").strip()
        if not title:
            continue
        prio = (item.priority or "medium").lower()
        if prio not in PRIORITIES:
            prio = "medium"
        otype = (item.observation_type or "observation").lower()
        if otype not in OBS_TYPES:
            otype = "observation"
        due = None
        if item.due_date:
            try:
                due = datetime.strptime(item.due_date.strip()[:10], "%Y-%m-%d")
            except Exception:
                due = None
        obs = AuditObservation(
            tenant_id=tenant_id,
            code=_next_code(db, tenant_id, seq=base_count + len(created) + 1),
            title=title,
            description=item.description,
            observation_type=otype,
            regulator_source=item.regulator_source,
            regulation_reference=item.regulation_reference,
            priority=prio,
            status="open",
            audit_period=item.audit_period,
            due_date=due,
            area_domain=item.area_domain,
            category=(item.category or payload.default_category or "").strip() or None,
            source_document_name=payload.source_document_name,
            import_batch_id=batch_id,
            created_by=current_user.id,
        )
        db.add(obs)
        db.flush()
        _log_activity(
            db,
            obs.id,
            current_user.id,
            "created",
            f'Imported from "{payload.source_document_name or "document"}"',
            {"import_batch_id": batch_id},
        )
        created.append(obs)

    if not created:
        raise HTTPException(status_code=400, detail="No observations selected to create.")

    write_rich_audit_log(
        db=db,
        tenant_id=tenant_id,
        user_id=current_user.id,
        action="create",
        resource_type="audit_observation_import",
        resource_id=None,
        resource_name=payload.source_document_name,
        summary=f"Imported {len(created)} audit observations from document",
    )
    db.commit()
    for o in created:
        db.refresh(o)
    return {
        "created": [serialize_observation(db, o) for o in created],
        "count": len(created),
        "import_batch_id": batch_id,
    }


@router.get("/observations/{obs_id}")
def get_observation(
    obs_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)
    obs = (
        db.query(AuditObservation)
        .options(
            joinedload(AuditObservation.evidence_links).joinedload(AuditObservationEvidenceLink.evidence),
            joinedload(AuditObservation.control_links).joinedload(AuditObservationControlLink.control),
            joinedload(AuditObservation.risk_links).joinedload(AuditObservationRiskLink.risk),
            joinedload(AuditObservation.issue_links).joinedload(AuditObservationIssueLink.issue),
            joinedload(AuditObservation.document_links).joinedload(AuditObservationDocumentLink.document),
        )
        .filter(AuditObservation.id == obs_id, AuditObservation.tenant_id.in_(tenant_ids))
        .first()
    )
    if not obs:
        raise HTTPException(status_code=404, detail="Observation not found")
    return serialize_observation(db, obs, with_links=True)


@router.put("/observations/{obs_id}")
def update_observation(
    obs_id: int,
    payload: ObservationUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)
    obs = _get_obs(obs_id, tenant_ids, db)
    data = payload.model_dump(exclude_unset=True)
    if "observation_type" in data and data["observation_type"] not in OBS_TYPES:
        raise HTTPException(status_code=400, detail="Invalid observation_type")
    if "priority" in data and data["priority"] not in PRIORITIES:
        raise HTTPException(status_code=400, detail="Invalid priority")
    if "category" in data:
        cat = (data["category"] or "").strip()
        data["category"] = cat or None
    for k, v in data.items():
        setattr(obs, k, v)
    obs.updated_at = datetime.utcnow()
    _log_activity(db, obs.id, current_user.id, "update", "Updated observation fields", {"fields": list(data.keys())})
    db.commit()
    db.refresh(obs)
    return serialize_observation(db, obs, with_links=True)


@router.post("/observations/{obs_id}/transition")
def transition_status(
    obs_id: int,
    payload: StatusTransition,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)
    obs = _get_obs(obs_id, tenant_ids, db)
    new_status = (payload.status or "").lower()
    if new_status not in STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. One of {sorted(STATUSES)}")
    allowed = STATUS_TRANSITIONS.get(obs.status, set())
    if new_status not in allowed and new_status != obs.status:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot move from '{obs.status}' to '{new_status}'. Allowed: {sorted(allowed)}",
        )
    old = obs.status
    obs.status = new_status
    obs.updated_at = datetime.utcnow()
    if new_status in {"closed", "complied"}:
        obs.closed_at = datetime.utcnow()
        obs.closed_by = current_user.id
    elif old in {"closed", "complied"} and new_status in {"open", "in_progress"}:
        obs.closed_at = None
        obs.closed_by = None
    if payload.notes:
        obs.notes = ((obs.notes or "") + f"\n[{new_status}] {payload.notes}").strip()
    _log_activity(
        db,
        obs.id,
        current_user.id,
        "status_change",
        f"Status {old} → {new_status}",
        {"from": old, "to": new_status, "notes": payload.notes},
    )
    db.commit()
    db.refresh(obs)
    return serialize_observation(db, obs, with_links=True)


@router.delete("/observations/{obs_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_observation(
    obs_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)
    obs = _get_obs(obs_id, tenant_ids, db)
    write_rich_audit_log(
        db=db,
        tenant_id=obs.tenant_id,
        user_id=current_user.id,
        action="delete",
        resource_type="audit_observation",
        resource_id=obs.id,
        resource_name=obs.title,
        summary=f'Deleted audit observation {obs.code}',
    )
    db.delete(obs)
    db.commit()
    return None


# ── Evidence ─────────────────────────────────────────────────────────────────
@router.post("/observations/{obs_id}/evidence/link", status_code=status.HTTP_201_CREATED)
def link_evidence(
    obs_id: int,
    body: EvidenceLinkBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)
    obs = _get_obs(obs_id, tenant_ids, db)
    ev = (
        db.query(Evidence)
        .filter(Evidence.id == body.evidence_id, Evidence.tenant_id.in_(tenant_ids))
        .first()
    )
    if not ev:
        raise HTTPException(status_code=404, detail="Evidence not found")
    existing = (
        db.query(AuditObservationEvidenceLink)
        .filter_by(observation_id=obs.id, evidence_id=ev.id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Evidence already linked")
    ln = AuditObservationEvidenceLink(
        observation_id=obs.id,
        evidence_id=ev.id,
        relationship_type=body.relationship_type or "proof",
        notes=body.notes,
        created_by=current_user.id,
    )
    db.add(ln)
    _log_activity(db, obs.id, current_user.id, "link", f"Linked evidence #{ev.id}", {"evidence_id": ev.id})
    obs.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(ln)
    return {
        "id": ln.id,
        "evidence_id": ln.evidence_id,
        "name": ev.name,
        "file_name": ev.file_name,
        "relationship_type": ln.relationship_type,
    }


@router.post("/observations/{obs_id}/evidence/upload", status_code=status.HTTP_201_CREATED)
async def upload_evidence(
    obs_id: int,
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    relationship_type: Optional[str] = Form("proof"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Upload a file into the evidence library and link it to this observation."""
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)
    obs = _get_obs(obs_id, tenant_ids, db)
    tenant_id = obs.tenant_id

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty file")

    tenant_dir = os.path.join(_UPLOAD_DIR, str(tenant_id))
    os.makedirs(tenant_dir, exist_ok=True)
    ext = os.path.splitext(file.filename or "")[1].lower()
    file_id = str(uuid.uuid4())
    file_path = os.path.join(tenant_dir, f"{file_id}{ext}")
    with open(file_path, "wb") as fh:
        fh.write(contents)

    ev = Evidence(
        tenant_id=tenant_id,
        name=name or file.filename or f"Evidence for {obs.code}",
        description=notes or f"Attached to audit observation {obs.code}",
        file_path=file_path,
        file_name=file.filename,
        file_type=file.content_type,
        evidence_type="audit_observation",
        uploaded_by=current_user.id,
        status="draft",
        source_system="statutory_audit",
    )
    db.add(ev)
    db.flush()
    ln = AuditObservationEvidenceLink(
        observation_id=obs.id,
        evidence_id=ev.id,
        relationship_type=relationship_type or "proof",
        notes=notes,
        created_by=current_user.id,
    )
    db.add(ln)
    _log_activity(db, obs.id, current_user.id, "link", f"Uploaded evidence '{ev.name}'", {"evidence_id": ev.id})
    obs.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(ln)
    return {
        "id": ln.id,
        "evidence_id": ev.id,
        "name": ev.name,
        "file_name": ev.file_name,
        "relationship_type": ln.relationship_type,
    }


@router.delete("/observations/{obs_id}/evidence/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def unlink_evidence(
    obs_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)
    obs = _get_obs(obs_id, tenant_ids, db)
    ln = (
        db.query(AuditObservationEvidenceLink)
        .filter_by(id=link_id, observation_id=obs.id)
        .first()
    )
    if not ln:
        raise HTTPException(status_code=404, detail="Evidence link not found")
    _log_activity(db, obs.id, current_user.id, "unlink", f"Unlinked evidence #{ln.evidence_id}")
    db.delete(ln)
    obs.updated_at = datetime.utcnow()
    db.commit()
    return None


# ── Cross-module links ───────────────────────────────────────────────────────
def _add_simple_link(
    *,
    db: Session,
    obs: AuditObservation,
    current_user: GRCUser,
    model,
    filter_kwargs: dict,
    create_kwargs: dict,
    label: str,
    target_id: int,
):
    existing = db.query(model).filter_by(**filter_kwargs).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"{label} already linked")
    ln = model(**create_kwargs, created_by=current_user.id)
    db.add(ln)
    _log_activity(db, obs.id, current_user.id, "link", f"Linked {label} #{target_id}", {label: target_id})
    obs.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(ln)
    return ln


@router.post("/observations/{obs_id}/links/controls", status_code=status.HTTP_201_CREATED)
def link_control(
    obs_id: int,
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)
    obs = _get_obs(obs_id, tenant_ids, db)
    control_id = body.get("internal_control_id")
    if not control_id:
        raise HTTPException(status_code=400, detail="internal_control_id required")
    ctrl = (
        db.query(InternalControl)
        .filter(InternalControl.id == control_id, InternalControl.tenant_id.in_(tenant_ids))
        .first()
    )
    if not ctrl:
        raise HTTPException(status_code=404, detail="Control not found")
    ln = _add_simple_link(
        db=db,
        obs=obs,
        current_user=current_user,
        model=AuditObservationControlLink,
        filter_kwargs={"observation_id": obs.id, "internal_control_id": control_id},
        create_kwargs={
            "observation_id": obs.id,
            "internal_control_id": control_id,
            "notes": body.get("notes"),
        },
        label="control",
        target_id=control_id,
    )
    return {
        "id": ln.id,
        "internal_control_id": ln.internal_control_id,
        "control_id": ctrl.control_id,
        "name": ctrl.name,
    }


@router.delete("/observations/{obs_id}/links/controls/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def unlink_control(
    obs_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)
    obs = _get_obs(obs_id, tenant_ids, db)
    ln = db.query(AuditObservationControlLink).filter_by(id=link_id, observation_id=obs.id).first()
    if not ln:
        raise HTTPException(status_code=404, detail="Link not found")
    _log_activity(db, obs.id, current_user.id, "unlink", f"Unlinked control #{ln.internal_control_id}")
    db.delete(ln)
    obs.updated_at = datetime.utcnow()
    db.commit()
    return None


@router.post("/observations/{obs_id}/links/risks", status_code=status.HTTP_201_CREATED)
def link_risk(
    obs_id: int,
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)
    obs = _get_obs(obs_id, tenant_ids, db)
    risk_id = body.get("risk_id")
    if not risk_id:
        raise HTTPException(status_code=400, detail="risk_id required")
    risk = db.query(Risk).filter(Risk.id == risk_id, Risk.tenant_id.in_(tenant_ids)).first()
    if not risk:
        raise HTTPException(status_code=404, detail="Risk not found")
    ln = _add_simple_link(
        db=db,
        obs=obs,
        current_user=current_user,
        model=AuditObservationRiskLink,
        filter_kwargs={"observation_id": obs.id, "risk_id": risk_id},
        create_kwargs={"observation_id": obs.id, "risk_id": risk_id, "notes": body.get("notes")},
        label="risk",
        target_id=risk_id,
    )
    return {"id": ln.id, "risk_id": ln.risk_id, "title": getattr(risk, "title", None) or getattr(risk, "name", None)}


@router.delete("/observations/{obs_id}/links/risks/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def unlink_risk(
    obs_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)
    obs = _get_obs(obs_id, tenant_ids, db)
    ln = db.query(AuditObservationRiskLink).filter_by(id=link_id, observation_id=obs.id).first()
    if not ln:
        raise HTTPException(status_code=404, detail="Link not found")
    _log_activity(db, obs.id, current_user.id, "unlink", f"Unlinked risk #{ln.risk_id}")
    db.delete(ln)
    obs.updated_at = datetime.utcnow()
    db.commit()
    return None


@router.post("/observations/{obs_id}/links/issues", status_code=status.HTTP_201_CREATED)
def link_issue(
    obs_id: int,
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)
    obs = _get_obs(obs_id, tenant_ids, db)
    issue_id = body.get("issue_id")
    if not issue_id:
        raise HTTPException(status_code=400, detail="issue_id required")
    issue = db.query(Issue).filter(Issue.id == issue_id, Issue.tenant_id.in_(tenant_ids)).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    ln = _add_simple_link(
        db=db,
        obs=obs,
        current_user=current_user,
        model=AuditObservationIssueLink,
        filter_kwargs={"observation_id": obs.id, "issue_id": issue_id},
        create_kwargs={"observation_id": obs.id, "issue_id": issue_id, "notes": body.get("notes")},
        label="issue",
        target_id=issue_id,
    )
    return {"id": ln.id, "issue_id": ln.issue_id, "code": issue.code, "title": issue.title}


@router.delete("/observations/{obs_id}/links/issues/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def unlink_issue(
    obs_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)
    obs = _get_obs(obs_id, tenant_ids, db)
    ln = db.query(AuditObservationIssueLink).filter_by(id=link_id, observation_id=obs.id).first()
    if not ln:
        raise HTTPException(status_code=404, detail="Link not found")
    _log_activity(db, obs.id, current_user.id, "unlink", f"Unlinked issue #{ln.issue_id}")
    db.delete(ln)
    obs.updated_at = datetime.utcnow()
    db.commit()
    return None


@router.post("/observations/{obs_id}/links/documents", status_code=status.HTTP_201_CREATED)
def link_document(
    obs_id: int,
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)
    obs = _get_obs(obs_id, tenant_ids, db)
    document_id = body.get("document_id")
    if not document_id:
        raise HTTPException(status_code=400, detail="document_id required")
    doc = (
        db.query(GovernanceDocument)
        .filter(GovernanceDocument.id == document_id, GovernanceDocument.tenant_id.in_(tenant_ids))
        .first()
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    ln = _add_simple_link(
        db=db,
        obs=obs,
        current_user=current_user,
        model=AuditObservationDocumentLink,
        filter_kwargs={"observation_id": obs.id, "document_id": document_id},
        create_kwargs={"observation_id": obs.id, "document_id": document_id, "notes": body.get("notes")},
        label="document",
        target_id=document_id,
    )
    return {"id": ln.id, "document_id": ln.document_id, "title": doc.title}


@router.delete("/observations/{obs_id}/links/documents/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def unlink_document(
    obs_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)
    obs = _get_obs(obs_id, tenant_ids, db)
    ln = db.query(AuditObservationDocumentLink).filter_by(id=link_id, observation_id=obs.id).first()
    if not ln:
        raise HTTPException(status_code=404, detail="Link not found")
    _log_activity(db, obs.id, current_user.id, "unlink", f"Unlinked document #{ln.document_id}")
    db.delete(ln)
    obs.updated_at = datetime.utcnow()
    db.commit()
    return None


# ── Link target search (for pickers) ─────────────────────────────────────────
@router.get("/link-options")
def link_options(
    kind: str = Query(..., description="controls|risks|issues|documents|evidence"),
    search: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = _tenant_ids(current_user, db)
    like = f"%{search.strip()}%" if search and search.strip() else None
    if kind == "controls":
        q = db.query(InternalControl).filter(
            InternalControl.tenant_id.in_(tenant_ids),
            InternalControl.status != "deprecated",
        )
        if like:
            q = q.filter(or_(InternalControl.name.ilike(like), InternalControl.control_id.ilike(like)))
        rows = q.order_by(InternalControl.name).limit(limit).all()
        return [
            {"id": r.id, "label": f"{r.control_id or ''} — {r.name}".strip(" —"), "subtitle": r.category}
            for r in rows
        ]
    if kind == "risks":
        q = db.query(Risk).filter(Risk.tenant_id.in_(tenant_ids))
        if like:
            q = q.filter(Risk.title.ilike(like))
        rows = q.order_by(Risk.id.desc()).limit(limit).all()
        return [
            {
                "id": r.id,
                "label": r.title or f"Risk #{r.id}",
                "subtitle": getattr(r, "category", None),
            }
            for r in rows
        ]
    if kind == "issues":
        q = db.query(Issue).filter(Issue.tenant_id.in_(tenant_ids))
        if like:
            q = q.filter(or_(Issue.title.ilike(like), Issue.code.ilike(like)))
        rows = q.order_by(Issue.id.desc()).limit(limit).all()
        return [
            {"id": r.id, "label": f"{r.code or ''} — {r.title}".strip(" —"), "subtitle": r.workflow_state or r.status}
            for r in rows
        ]
    if kind == "documents":
        q = db.query(GovernanceDocument).filter(GovernanceDocument.tenant_id.in_(tenant_ids))
        if like:
            q = q.filter(GovernanceDocument.title.ilike(like))
        rows = q.order_by(GovernanceDocument.title).limit(limit).all()
        return [{"id": r.id, "label": r.title, "subtitle": r.doc_type} for r in rows]
    if kind == "evidence":
        q = db.query(Evidence).filter(Evidence.tenant_id.in_(tenant_ids))
        if like:
            q = q.filter(or_(Evidence.name.ilike(like), Evidence.file_name.ilike(like)))
        rows = q.order_by(Evidence.id.desc()).limit(limit).all()
        return [{"id": r.id, "label": r.name, "subtitle": r.file_name} for r in rows]
    raise HTTPException(status_code=400, detail="kind must be controls|risks|issues|documents|evidence")
