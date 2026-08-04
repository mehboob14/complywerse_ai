"""Document attestation campaigns — create, manage, public acknowledge.

Authenticated APIs under `/governance/document-attestations`.
Public (no login) APIs under `/governance/document-attestations/public/{token}`.

Progress % = unique acknowledgments / active tenant users on the creator's
email domain (capped at 100). No required invite list.
"""
from __future__ import annotations

import base64
import logging
import os
import re
import secrets
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from ....models import (
    DocumentAttestationAcknowledgment,
    DocumentAttestationCampaign,
    DocumentAttestationRecipient,
    GovernanceDocument,
    GRCUser,
    get_db,
)
from ....routers.auth_router import get_user_primary_tenant, get_user_tenants, require_auth
from ....rich_audit import write_rich_audit_log

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/document-attestations", tags=["Document Attestations"])

_SIG_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..",
    "..",
    "..",
    "..",
    "uploads",
    "document-attestations",
)
_ensured_engines: set[int] = set()
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

_COLUMN_ADDS = (
    ("grc_doc_attestation_campaigns", "allowed_email_domain", "VARCHAR(255)"),
    ("grc_doc_attestation_acknowledgments", "designation", "VARCHAR(255)"),
)


def _ensure_tables(db: Session) -> None:
    engine = db.get_bind()
    eid = id(engine)
    if eid in _ensured_engines:
        return
    try:
        from sqlalchemy import inspect as sa_inspect

        inspector = sa_inspect(engine)
        for model in (
            DocumentAttestationCampaign,
            DocumentAttestationRecipient,
            DocumentAttestationAcknowledgment,
        ):
            table = model.__table__
            if inspector.has_table(table.name):
                continue
            try:
                table.create(bind=engine, checkfirst=True)
            except Exception as te:
                if inspector.has_table(table.name):
                    continue
                logger.warning("doc attestation create %s failed: %s", table.name, te)

        # Additive columns for existing tables
        inspector = sa_inspect(engine)
        for table, col, ddl in _COLUMN_ADDS:
            if not inspector.has_table(table):
                continue
            existing = {c["name"] for c in inspector.get_columns(table)}
            if col in existing:
                continue
            try:
                db.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
                db.commit()
            except Exception as ce:
                db.rollback()
                logger.warning("doc attestation add column %s.%s failed: %s", table, col, ce)

        os.makedirs(_SIG_DIR, exist_ok=True)
        _ensured_engines.add(eid)
    except Exception as e:
        logger.warning("doc attestation table self-heal failed: %s", e)
        try:
            from sqlalchemy import inspect as sa_inspect

            if sa_inspect(engine).has_table(DocumentAttestationCampaign.__tablename__):
                _ensured_engines.add(eid)
        except Exception:
            pass


def _tenant_ids(user: GRCUser, db: Session) -> List[int]:
    ids = get_user_tenants(user, db)
    if not ids:
        raise HTTPException(status_code=403, detail="No tenant access")
    return ids


def _norm_email(email: str) -> str:
    return (email or "").strip().lower()


def _email_domain(email: str) -> Optional[str]:
    e = _norm_email(email)
    if "@" not in e:
        return None
    domain = e.split("@", 1)[1].strip()
    return domain or None


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _active_domain_user_count(db: Session, domain: Optional[str]) -> int:
    """Count active GRC users whose email is on the given domain (per-tenant DB)."""
    d = (domain or "").strip().lower()
    if not d:
        return 0
    return (
        db.query(func.count(GRCUser.id))
        .filter(
            GRCUser.is_active.is_(True),
            func.lower(GRCUser.email).like(f"%@{d}"),
        )
        .scalar()
        or 0
    )


def _ack_count(db: Session, campaign_id: int) -> int:
    return (
        db.query(func.count(DocumentAttestationAcknowledgment.id))
        .filter(DocumentAttestationAcknowledgment.campaign_id == campaign_id)
        .scalar()
        or 0
    )


def _ensure_campaign_domain(db: Session, campaign: DocumentAttestationCampaign) -> Optional[str]:
    """Return allowed domain, backfilling from creator email when missing."""
    domain = (campaign.allowed_email_domain or "").strip().lower() or None
    if domain:
        return domain
    if campaign.created_by:
        creator = db.query(GRCUser).filter(GRCUser.id == campaign.created_by).first()
        domain = _email_domain(getattr(creator, "email", None) or "") if creator else None
        if domain:
            campaign.allowed_email_domain = domain
            try:
                db.add(campaign)
                db.commit()
            except Exception:
                db.rollback()
    return domain


def _progress(db: Session, campaign: DocumentAttestationCampaign) -> Dict[str, Any]:
    """attestation_percent = round(unique_acks / same-domain active users * 100), capped 100."""
    domain = _ensure_campaign_domain(db, campaign)
    acks = _ack_count(db, campaign.id)
    denom = _active_domain_user_count(db, domain) if domain else 0
    if denom <= 0:
        pct = None
    else:
        pct = min(100, round(acks / denom * 100))
    return {
        "acknowledgment_count": acks,
        "active_domain_users": denom,
        "allowed_email_domain": domain,
        "attestation_percent": pct,
        "progress_label": (
            f"{acks} people acknowledged"
            if acks != 1
            else "1 person acknowledged"
        ),
    }


def _public_link(request: Request, token: str, tenant_slug: Optional[str] = None) -> str:
    """Build a browser URL for the public attestation page."""
    frontend = (os.environ.get("FRONTEND_URL") or os.environ.get("NEXT_PUBLIC_APP_URL") or "").rstrip("/")
    if frontend:
        base = frontend
    else:
        proto = request.headers.get("x-forwarded-proto") or request.url.scheme or "http"
        host = request.headers.get("x-forwarded-host") or request.headers.get("host") or "localhost:3000"
        if host.endswith(":4000"):
            host = host[:-5] + ":3000"
        base = f"{proto}://{host}"
    slug = tenant_slug or getattr(request.state, "tenant_slug", None)
    qs = f"?tenant_slug={slug}" if slug else ""
    return f"{base}/attest/{token}{qs}"


def _signature_data_url(a: DocumentAttestationAcknowledgment) -> Optional[str]:
    """Load stored signature as a data URL for authenticated campaign detail UI."""
    if a.signature_path and os.path.exists(a.signature_path):
        try:
            with open(a.signature_path, "rb") as f:
                blob = f.read()
            if blob:
                return "data:image/png;base64," + base64.b64encode(blob).decode("ascii")
        except Exception as e:
            logger.warning("could not read signature %s: %s", a.signature_path, e)
    raw = (a.signature_data or "").strip()
    if raw.startswith("data:image/"):
        return raw
    return None


def _serialize_ack(a: DocumentAttestationAcknowledgment, campaign_id: int) -> dict:
    preview = _signature_data_url(a)
    return {
        "id": a.id,
        "name": a.name,
        "email": a.email,
        "designation": a.designation,
        "acknowledged_at": _iso(a.acknowledged_at),
        "has_signature": bool(preview or a.signature_data or a.signature_path),
        "signature_data_url": preview,
        "signature_url": (
            f"/api/governance/document-attestations/campaigns/{campaign_id}"
            f"/acknowledgments/{a.id}/signature"
            if (a.signature_path or a.signature_data)
            else None
        ),
    }


def _serialize_campaign(
    db: Session,
    campaign: DocumentAttestationCampaign,
    request: Optional[Request] = None,
    *,
    with_acks: bool = False,
    tenant_slug: Optional[str] = None,
) -> dict:
    prog = _progress(db, campaign)
    data = {
        "id": campaign.id,
        "document_id": campaign.document_id,
        "document_title": getattr(campaign.document, "title", None),
        "document_version": getattr(campaign.document, "current_version", None),
        "document_status": getattr(campaign.document, "status", None),
        "name": campaign.name,
        "message": campaign.message,
        "due_date": _iso(campaign.due_date),
        "status": campaign.status,
        "public_token": campaign.public_token,
        "public_url": _public_link(request, campaign.public_token, tenant_slug) if request else None,
        "created_by": campaign.created_by,
        "created_at": _iso(campaign.created_at),
        "updated_at": _iso(campaign.updated_at),
        "closed_at": _iso(campaign.closed_at),
        **prog,
    }
    if with_acks:
        acks = sorted(
            list(campaign.acknowledgments or []),
            key=lambda a: a.acknowledged_at or datetime.min,
            reverse=True,
        )
        data["acknowledgments"] = [_serialize_ack(a, campaign.id) for a in acks]
    return data


def _doc_content_preview(doc: GovernanceDocument) -> Dict[str, Any]:
    """Return content safe for the public viewer."""
    html = None
    text_content = doc.content
    if doc.file_path and os.path.exists(doc.file_path):
        file_type = (doc.file_type or "").lower()
        try:
            if file_type == "pdf" or (doc.file_name or "").lower().endswith(".pdf"):
                from PyPDF2 import PdfReader

                reader = PdfReader(doc.file_path)
                parts = []
                for i, page in enumerate(reader.pages[:40]):
                    t = page.extract_text() or ""
                    if t.strip():
                        parts.append(f"<h3>Page {i + 1}</h3><pre style='white-space:pre-wrap'>{_escape(t)}</pre>")
                html = "\n".join(parts) if parts else None
            elif file_type in {"docx", "doc"} or (doc.file_name or "").lower().endswith((".docx", ".doc")):
                from docx import Document as DocxDocument

                d = DocxDocument(doc.file_path)
                parts = [f"<p>{_escape(p.text)}</p>" for p in d.paragraphs if p.text.strip()]
                html = "\n".join(parts) if parts else None
            elif file_type in {"txt", "md"} or (doc.file_name or "").lower().endswith((".txt", ".md")):
                with open(doc.file_path, "r", encoding="utf-8", errors="replace") as f:
                    text_content = f.read()
        except Exception as e:
            logger.warning("public doc preview extract failed: %s", e)

    if not html and text_content:
        html = f"<div style='white-space:pre-wrap'>{_escape(text_content)}</div>"

    return {
        "title": doc.title,
        "description": doc.description,
        "version": doc.current_version,
        "doc_type": doc.doc_type,
        "has_file": bool(doc.file_path),
        "file_name": doc.file_name,
        "html": html,
        "content": text_content if not html else None,
    }


def _escape(s: str) -> str:
    return (
        (s or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _save_signature(data_url: str, campaign_id: int) -> tuple[str, Optional[str]]:
    """Persist signature PNG; return (data_url_or_stored, path)."""
    raw = (data_url or "").strip()
    if not raw.startswith("data:image/"):
        raise HTTPException(status_code=400, detail="Signature must be a PNG data URL from the signature pad.")
    try:
        header, b64 = raw.split(",", 1)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid signature data.")
    if "png" not in header.lower() and "jpeg" not in header.lower() and "jpg" not in header.lower():
        raise HTTPException(status_code=400, detail="Signature image type not supported. Use PNG.")
    try:
        blob = base64.b64decode(b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Could not decode signature image.")
    if len(blob) < 64:
        raise HTTPException(status_code=400, detail="Signature looks empty. Please draw your signature.")
    if len(blob) > 1_500_000:
        raise HTTPException(status_code=400, detail="Signature image is too large.")

    os.makedirs(_SIG_DIR, exist_ok=True)
    fname = f"camp_{campaign_id}_{uuid.uuid4().hex[:12]}.png"
    path = os.path.join(_SIG_DIR, fname)
    with open(path, "wb") as f:
        f.write(blob)
    return raw[:200] + ("…" if len(raw) > 200 else ""), path


# ── Schemas ──────────────────────────────────────────────────────────────────

class CampaignCreate(BaseModel):
    document_id: int
    name: Optional[str] = None
    message: Optional[str] = None
    due_date: Optional[datetime] = None
    activate: bool = True


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    message: Optional[str] = None
    due_date: Optional[datetime] = None
    status: Optional[str] = None


class PublicAckSubmit(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    email: str = Field(..., min_length=3, max_length=255)
    designation: str = Field(..., min_length=1, max_length=255)
    signature_data: str = Field(..., min_length=32)


# ── Authenticated routes ─────────────────────────────────────────────────────

@router.get("/coverage-map")
def coverage_map(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Per-document attestation % for the library column.

    Uses the document's active campaign, else the latest campaign.
    percent = round(unique_acks / same-domain active users * 100), capped 100.
    Documents with no campaign or zero domain users are omitted (UI shows —).
    """
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)

    campaigns = (
        db.query(DocumentAttestationCampaign)
        .filter(DocumentAttestationCampaign.tenant_id.in_(tenant_ids))
        .order_by(DocumentAttestationCampaign.created_at.desc())
        .all()
    )
    chosen: Dict[int, DocumentAttestationCampaign] = {}
    for c in campaigns:
        existing = chosen.get(c.document_id)
        if existing is None:
            chosen[c.document_id] = c
        elif existing.status != "active" and c.status == "active":
            chosen[c.document_id] = c

    coverage: Dict[str, Any] = {}
    for doc_id, camp in chosen.items():
        prog = _progress(db, camp)
        if prog["attestation_percent"] is None:
            continue
        coverage[str(doc_id)] = prog["attestation_percent"]

    return {"coverage": coverage}


@router.get("/campaigns")
def list_campaigns(
    request: Request,
    document_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)
    q = db.query(DocumentAttestationCampaign).filter(
        DocumentAttestationCampaign.tenant_id.in_(tenant_ids)
    )
    if document_id:
        q = q.filter(DocumentAttestationCampaign.document_id == document_id)
    if status_filter and status_filter != "all":
        q = q.filter(DocumentAttestationCampaign.status == status_filter)
    rows = q.order_by(DocumentAttestationCampaign.created_at.desc()).limit(200).all()
    slug = getattr(request.state, "tenant_slug", None)
    return {
        "items": [_serialize_campaign(db, c, request, tenant_slug=slug) for c in rows],
        "count": len(rows),
    }


@router.post("/campaigns", status_code=status.HTTP_201_CREATED)
def create_campaign(
    body: CampaignCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)
    tenant_id = get_user_primary_tenant(current_user, db) or tenant_ids[0]

    doc = (
        db.query(GovernanceDocument)
        .filter(GovernanceDocument.id == body.document_id, GovernanceDocument.tenant_id.in_(tenant_ids))
        .first()
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if (doc.status or "").lower() != "published":
        raise HTTPException(
            status_code=400,
            detail="Attestations can only be created for published documents.",
        )

    domain = _email_domain(current_user.email or "")
    if not domain:
        raise HTTPException(
            status_code=400,
            detail="Your account email is missing a domain. Update your profile email before creating an attestation.",
        )

    if body.activate:
        for other in (
            db.query(DocumentAttestationCampaign)
            .filter(
                DocumentAttestationCampaign.document_id == doc.id,
                DocumentAttestationCampaign.status == "active",
            )
            .all()
        ):
            other.status = "closed"
            other.closed_at = datetime.utcnow()

    token = secrets.token_urlsafe(24)
    camp = DocumentAttestationCampaign(
        tenant_id=tenant_id,
        document_id=doc.id,
        name=(body.name or f"Attestation — {doc.title}")[:255],
        message=body.message,
        due_date=body.due_date,
        status="active" if body.activate else "draft",
        public_token=token,
        allowed_email_domain=domain,
        created_by=current_user.id,
    )
    db.add(camp)
    db.flush()

    write_rich_audit_log(
        db=db,
        tenant_id=tenant_id,
        user_id=current_user.id,
        action="create",
        resource_type="document_attestation_campaign",
        resource_id=camp.id,
        resource_name=camp.name,
        summary=f"Created attestation campaign for document {doc.id}",
    )
    db.commit()
    db.refresh(camp)
    slug = getattr(request.state, "tenant_slug", None)
    return _serialize_campaign(db, camp, request, with_acks=True, tenant_slug=slug)


@router.get("/campaigns/{campaign_id}")
def get_campaign(
    campaign_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)
    camp = (
        db.query(DocumentAttestationCampaign)
        .filter(
            DocumentAttestationCampaign.id == campaign_id,
            DocumentAttestationCampaign.tenant_id.in_(tenant_ids),
        )
        .first()
    )
    if not camp:
        raise HTTPException(status_code=404, detail="Campaign not found")
    slug = getattr(request.state, "tenant_slug", None)
    return _serialize_campaign(db, camp, request, with_acks=True, tenant_slug=slug)


@router.patch("/campaigns/{campaign_id}")
def update_campaign(
    campaign_id: int,
    body: CampaignUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)
    camp = (
        db.query(DocumentAttestationCampaign)
        .filter(
            DocumentAttestationCampaign.id == campaign_id,
            DocumentAttestationCampaign.tenant_id.in_(tenant_ids),
        )
        .first()
    )
    if not camp:
        raise HTTPException(status_code=404, detail="Campaign not found")

    if body.name is not None:
        camp.name = body.name[:255]
    if body.message is not None:
        camp.message = body.message
    if body.due_date is not None:
        camp.due_date = body.due_date
    if body.status is not None:
        st = body.status.lower()
        if st not in {"draft", "active", "closed"}:
            raise HTTPException(status_code=400, detail="Invalid status")
        if st == "active" and camp.status != "active":
            for other in (
                db.query(DocumentAttestationCampaign)
                .filter(
                    DocumentAttestationCampaign.document_id == camp.document_id,
                    DocumentAttestationCampaign.status == "active",
                    DocumentAttestationCampaign.id != camp.id,
                )
                .all()
            ):
                other.status = "closed"
                other.closed_at = datetime.utcnow()
            camp.closed_at = None
        if st == "closed":
            camp.closed_at = datetime.utcnow()
        camp.status = st

    db.commit()
    db.refresh(camp)
    slug = getattr(request.state, "tenant_slug", None)
    return _serialize_campaign(db, camp, request, with_acks=True, tenant_slug=slug)


@router.get("/campaigns/{campaign_id}/acknowledgments/{ack_id}/signature")
def get_acknowledgment_signature(
    campaign_id: int,
    ack_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Serve the stored signature image for campaign detail preview."""
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)
    camp = (
        db.query(DocumentAttestationCampaign)
        .filter(
            DocumentAttestationCampaign.id == campaign_id,
            DocumentAttestationCampaign.tenant_id.in_(tenant_ids),
        )
        .first()
    )
    if not camp:
        raise HTTPException(status_code=404, detail="Campaign not found")
    ack = (
        db.query(DocumentAttestationAcknowledgment)
        .filter(
            DocumentAttestationAcknowledgment.id == ack_id,
            DocumentAttestationAcknowledgment.campaign_id == camp.id,
        )
        .first()
    )
    if not ack:
        raise HTTPException(status_code=404, detail="Acknowledgment not found")
    if ack.signature_path and os.path.exists(ack.signature_path):
        return FileResponse(ack.signature_path, media_type="image/png")
    raise HTTPException(status_code=404, detail="Signature file not found")


@router.delete("/campaigns/{campaign_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _ensure_tables(db)
    tenant_ids = _tenant_ids(current_user, db)
    camp = (
        db.query(DocumentAttestationCampaign)
        .filter(
            DocumentAttestationCampaign.id == campaign_id,
            DocumentAttestationCampaign.tenant_id.in_(tenant_ids),
        )
        .first()
    )
    if not camp:
        raise HTTPException(status_code=404, detail="Campaign not found")
    db.delete(camp)
    db.commit()
    return None


# ── Public routes (no require_auth) ──────────────────────────────────────────

@router.get("/public/{token}")
def public_get_by_token(
    token: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Load campaign + document for the external acknowledgment page."""
    _ensure_tables(db)
    camp = (
        db.query(DocumentAttestationCampaign)
        .filter(DocumentAttestationCampaign.public_token == token)
        .first()
    )
    if not camp:
        raise HTTPException(status_code=404, detail="This attestation link is invalid or has expired.")
    if camp.status == "closed":
        raise HTTPException(status_code=410, detail="This attestation campaign is closed.")

    doc = db.query(GovernanceDocument).filter(GovernanceDocument.id == camp.document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found for this attestation.")

    prog = _progress(db, camp)
    domain = prog["allowed_email_domain"]
    return {
        "campaign": {
            "id": camp.id,
            "name": camp.name,
            "message": camp.message,
            "due_date": _iso(camp.due_date),
            "status": camp.status,
            "allowed_email_domain": domain,
            "acknowledgment_count": prog["acknowledgment_count"],
            "attestation_percent": prog["attestation_percent"],
        },
        "document": _doc_content_preview(doc),
        "tenant_slug": getattr(request.state, "tenant_slug", None),
    }


@router.post("/public/{token}/acknowledge")
def public_acknowledge(
    token: str,
    body: PublicAckSubmit,
    request: Request,
    db: Session = Depends(get_db),
):
    """Submit acknowledgment (name, email, designation, signature). Idempotent per email."""
    _ensure_tables(db)
    camp = (
        db.query(DocumentAttestationCampaign)
        .filter(DocumentAttestationCampaign.public_token == token)
        .first()
    )
    if not camp:
        raise HTTPException(status_code=404, detail="This attestation link is invalid or has expired.")
    if camp.status != "active":
        raise HTTPException(status_code=410, detail="This attestation campaign is not accepting acknowledgments.")

    email = _norm_email(body.email)
    name = (body.name or "").strip()
    designation = (body.designation or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required.")
    if not designation:
        raise HTTPException(status_code=400, detail="Designation (job title / role) is required.")
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")

    allowed = (camp.allowed_email_domain or "").strip().lower()
    submit_domain = _email_domain(email)
    if not allowed:
        raise HTTPException(
            status_code=400,
            detail="This attestation is not configured with an organization email domain. Contact the sender.",
        )
    if submit_domain != allowed:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Please use your organization email ending in @{allowed}. "
                f"Addresses from other domains are not accepted."
            ),
        )

    stored_ref, sig_path = _save_signature(body.signature_data, camp.id)
    ip = request.client.host if request.client else None
    ua = (request.headers.get("user-agent") or "")[:500]

    existing = (
        db.query(DocumentAttestationAcknowledgment)
        .filter(
            DocumentAttestationAcknowledgment.campaign_id == camp.id,
            DocumentAttestationAcknowledgment.email == email,
        )
        .first()
    )
    if existing:
        existing.name = name[:255]
        existing.designation = designation[:255]
        existing.signature_data = stored_ref
        existing.signature_path = sig_path
        existing.ip_address = ip
        existing.user_agent = ua
        existing.acknowledged_at = datetime.utcnow()
        ack = existing
    else:
        ack = DocumentAttestationAcknowledgment(
            campaign_id=camp.id,
            name=name[:255],
            email=email,
            designation=designation[:255],
            signature_data=stored_ref,
            signature_path=sig_path,
            matched_invite=False,
            ip_address=ip,
            user_agent=ua,
        )
        db.add(ack)
        db.flush()

    db.commit()
    db.refresh(camp)
    prog = _progress(db, camp)
    return {
        "ok": True,
        "message": "Thank you — your acknowledgment has been recorded.",
        "progress": prog,
        "acknowledgment_id": ack.id,
    }
