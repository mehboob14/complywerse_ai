"""Reference Laws router.

Exposes a small catalogue of authoritative legal/regulatory reference texts
(e.g. the KSA Personal Data Protection Law) so users can:
  1. List the available reference laws
  2. Preview the full law text
  3. AI-draft a NEW governance document (policy, standard, procedure,
     guideline, charter, …) that is grounded in — and must comply with —
     the exact requirements of the chosen law.

Unlike the NCA templates (which are document *templates* and are returned
verbatim), a reference law is a *source of obligations*: the user picks a
doc_type and the AI generates a fresh, tenant-specific document that
implements the law's articles. This reuses the proven async drafting
pipeline by injecting the law text as the parent-document context — no
pipeline changes required.

The law texts are pre-extracted (from their source PDFs) and stored as JSON
under ``grc/seed_data/reference_laws/``. No runtime PDF parsing is needed;
the router only reads the on-disk JSON, so there is no new runtime
dependency. Drop a new ``*.json`` file in that folder and it appears as an
option automatically.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import get_openai_api_key
from ..models import GRCUser, get_db
from .auth_router import require_auth, get_user_primary_tenant

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/governance/reference-laws", tags=["Reference Laws"])

OPENAI_API_KEY = get_openai_api_key()

# Each reference law is re-injected into every section prompt by the
# drafting pipeline, so keep the injected slice bounded. 20 KB matches the
# established parent-document cap in tasks/ai_drafting.py and covers the
# operative articles of the laws we ship.
_MAX_REFERENCE_CHARS = 20000


# ─── Catalogue discovery ─────────────────────────────────────────────────────

def _laws_dir() -> Path:
    """Location of the pre-extracted reference-law JSON files.

    This file lives at ``grc/routers/reference_laws_router.py`` so the seed
    folder is ``grc/seed_data/reference_laws`` (two parents up, then down).
    """
    return Path(__file__).resolve().parent.parent / "seed_data" / "reference_laws"


def _build_catalog() -> List[Dict[str, Any]]:
    """Load every reference-law JSON into memory."""
    directory = _laws_dir()
    if not directory.is_dir():
        logger.warning("Reference laws directory not found at %s", directory)
        return []

    laws: List[Dict[str, Any]] = []
    for path in sorted(directory.glob("*.json")):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:  # noqa: BLE001 — a malformed file must not 500 the list
            logger.exception("Failed to load reference law %s", path.name)
            continue
        # Stable id: explicit `id` field, else the filename stem.
        law_id = str(data.get("id") or path.stem).strip()
        meta = data.get("metadata") or {}
        content = data.get("content") or ""
        if not law_id or not content.strip():
            continue
        laws.append({"id": law_id, "metadata": meta, "content": content})
    return laws


_CATALOG_CACHE: Optional[List[Dict[str, Any]]] = None


def _get_catalog() -> List[Dict[str, Any]]:
    global _CATALOG_CACHE
    if _CATALOG_CACHE is None:
        _CATALOG_CACHE = _build_catalog()
    return _CATALOG_CACHE


def _find_law(law_id: str) -> Optional[Dict[str, Any]]:
    for law in _get_catalog():
        if law["id"] == law_id:
            return law
    return None


def _summary(law: Dict[str, Any]) -> Dict[str, Any]:
    """Public, content-free metadata for the list endpoint."""
    meta = law.get("metadata") or {}
    content = law.get("content") or ""
    return {
        "id": law["id"],
        "name": meta.get("name") or law["id"],
        "short_name": meta.get("short_name"),
        "jurisdiction": meta.get("jurisdiction"),
        "authority": meta.get("authority"),
        "category": meta.get("category") or "Reference Law",
        "description": meta.get("description"),
        "version": meta.get("version"),
        "doc_type_hint": meta.get("doc_type_hint") or "policy",
        "tags": meta.get("tags") or [],
        "article_count": meta.get("article_count"),
        "word_count": meta.get("word_count") or len(content.split()),
    }


# ─── Schemas ─────────────────────────────────────────────────────────────────

# Doc types the governance pipeline understands. Mirrors the allow-list in
# modules/governance/routers/documents.py so an unknown type can't slip in.
_ALLOWED_DOC_TYPES = {"policy", "standard", "procedure", "guideline", "charter", "framework"}


class ReferenceLawDraftBody(BaseModel):
    title: str
    doc_type: Optional[str] = None
    additional_requirements: Optional[str] = None
    classification: Optional[str] = "internal"
    save_as_document: bool = False


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("")
def list_reference_laws(user: GRCUser = Depends(require_auth)):
    """Return metadata for every available reference law."""
    catalog = _get_catalog()
    laws = [_summary(law) for law in catalog]
    return {"total": len(laws), "laws": laws}


@router.get("/{law_id}/content")
def get_reference_law_content(law_id: str, user: GRCUser = Depends(require_auth)):
    """Return the full text of a reference law for preview."""
    law = _find_law(law_id)
    if not law:
        raise HTTPException(status_code=404, detail="Reference law not found")
    summary = _summary(law)
    return {**summary, "content": law["content"]}


@router.post("/{law_id}/ai-draft")
def ai_draft_from_reference_law(
    law_id: str,
    body: ReferenceLawDraftBody,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Generate a governance document grounded in the chosen reference law.

    Mirrors ``/governance/nca-templates/{id}/ai-draft`` (AI re-draft path):
    the law text is injected as the parent-document context so the existing
    async pipeline produces a tenant-specific document that implements the
    law's articles. Returns a job id the frontend polls on the shared
    ``/governance/documents/ai-draft-jobs/{job_id}`` endpoint.
    """
    law = _find_law(law_id)
    if not law:
        raise HTTPException(status_code=404, detail="Reference law not found")

    if not OPENAI_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="AI not configured. Set AI_INTEGRATIONS_OPENAI_API_KEY.",
        )

    tenant_id = get_user_primary_tenant(user, db)
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant context for drafting")

    meta = law.get("metadata") or {}
    doc_type = (body.doc_type or meta.get("doc_type_hint") or "policy").lower()
    if doc_type not in _ALLOWED_DOC_TYPES:
        doc_type = "policy"

    law_name = meta.get("name") or law_id
    law_text = (law.get("content") or "").strip()
    if len(law_text) > _MAX_REFERENCE_CHARS:
        law_text = law_text[:_MAX_REFERENCE_CHARS] + "\n...[law text truncated for prompt size]"

    # Authoritative-reference blob. The pipeline treats parent context as a
    # source it must not contradict; we frame the law as the governing
    # requirement the new document has to implement and cite by article.
    reference_blob = (
        "GOVERNING REFERENCE LAW — the document being drafted MUST fully comply with, "
        "and operationalise, the requirements of the following law. Treat every article "
        "as a binding obligation: reflect its definitions, data-subject rights, controller/"
        "processor duties, lawful-basis, transfer, breach-notification, retention, and "
        "penalty provisions wherever they bear on this document. Cite the relevant article "
        "numbers inline (e.g. \"in line with Article 4\") and do NOT contradict the law.\n"
        f"Law: {law_name}\n"
        f"Jurisdiction: {meta.get('jurisdiction') or 'N/A'}\n"
        f"Authority: {meta.get('authority') or 'N/A'}\n"
        "\n"
        "FULL LAW TEXT (authoritative source of obligations):\n"
        f"{law_text}"
    )
    if body.additional_requirements:
        reference_blob += f"\n\nAdditional requirements from the user: {body.additional_requirements}"

    # Resolve tenant slug for the TenantTask dispatch.
    from ..db import MasterSession
    from ..models import Tenant as MasterTenant

    master = MasterSession()
    try:
        row = master.query(MasterTenant.slug).filter(MasterTenant.id == tenant_id).first()
        tenant_slug = row[0] if row else None
    finally:
        master.close()
    if not tenant_slug:
        raise HTTPException(status_code=500, detail="Could not resolve tenant slug")

    from ..tasks.ai_drafting import create_job, dispatch_in_thread

    job_id = create_job(
        tenant_id=tenant_id,
        request_summary={
            "doc_type": doc_type,
            "title": body.title,
            "source_reference_law": law_name,
        },
    )
    request_payload: Dict[str, Any] = {
        "tenant_id": tenant_id,
        "doc_type": doc_type,
        "title": body.title,
        "description": body.additional_requirements,
        "framework_ids": [],
        # Inject the law via the parent-context channel the pipeline already
        # honours — no pipeline change needed.
        "parent_document_text": reference_blob,
        "source_template_id": law_id,
        "source_template_title": law_name,
        "save_as_document": body.save_as_document,
        "classification": body.classification or "internal",
        "user_id": getattr(user, "id", None),
        "user_name": getattr(user, "display_name", None) or getattr(user, "username", None),
    }
    dispatch_in_thread(tenant_slug, job_id, request_payload)

    return {
        "job_id": job_id,
        "status": "queued",
        "source_reference_law": {"id": law_id, "name": law_name},
        "poll_url": f"/governance/documents/ai-draft-jobs/{job_id}",
    }
