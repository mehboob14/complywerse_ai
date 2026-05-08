"""NCA Cybersecurity Document Templates router.

Exposes the NCA Saudi reference document catalogue (~80 .docx templates) so
users can:
  1. List the available templates by category
  2. Preview their contents (extracted text)
  3. Create a new GovernanceDocument seeded from a template (as-is or modified)
  4. Generate an AI-drafted document using a template as the reference
  5. Run a side-by-side comparison between an existing document and a template

Templates are stored on disk under `NCA_Documents/` at the repo root and are
auto-discovered at module import time. No user state is mutated by listing
or preview endpoints — template files themselves are read-only.
"""
import json
import logging
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..models import GovernanceDocument, GRCUser, get_db
from .auth_router import require_auth, get_user_primary_tenant

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/governance/nca-templates", tags=["NCA Document Templates"])

OPENAI_API_KEY = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
OPENAI_BASE_URL = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL") or os.environ.get("OPENAI_BASE_URL")


# ─── Catalogue discovery ─────────────────────────────────────────────────────

def _resolve_templates_dir() -> Optional[Path]:
    """Locate the NCA templates folder.

    Walks up from this file looking for a sibling directory named
    ``NCA_Templates`` (current name) or ``NCA_Documents`` (legacy name).
    Falls back to the ``NCA_TEMPLATES_DIR`` env override. The folder lives
    at the repo root, above ``backend/``.
    """
    here = Path(__file__).resolve()
    candidate_names = ("NCA_Templates", "NCA_Documents")
    for parent in [here, *here.parents]:
        for name in candidate_names:
            candidate = parent.parent / name
            if candidate.is_dir():
                return candidate
    # Fallback: env override
    override = os.environ.get("NCA_TEMPLATES_DIR")
    if override and Path(override).is_dir():
        return Path(override)
    return None


TEMPLATES_DIR = _resolve_templates_dir()


def _detect_category(filename: str) -> str:
    """Map filename prefix to a friendly category label."""
    name_lower = filename.lower()
    if name_lower.startswith("policy"):
        return "Policy"
    if name_lower.startswith("standard"):
        return "Standard"
    if name_lower.startswith("procedure"):
        return "Procedure"
    if name_lower.startswith("program"):
        return "Program"
    if name_lower.startswith("checklist"):
        return "Checklist"
    if name_lower.startswith("form"):
        return "Form"
    if name_lower.startswith("report"):
        return "Report"
    if name_lower.startswith("cybersecurity"):
        return "Cybersecurity Foundation"
    return "Other"


def _humanize_title(filename: str) -> str:
    """Convert filename to a human-readable title."""
    stem = Path(filename).stem
    # Drop trailing template/version markers
    stem = re.sub(r"[_\- ]?template[_\- ]?en[_\- ]?v?[0-9.]*[_\-]?$", "", stem, flags=re.I)
    stem = re.sub(r"[_\- ]?template[_\- ]?$", "", stem, flags=re.I)
    stem = re.sub(r"[_\- ]?\([0-9]+\)$", "", stem)
    # Drop leading category prefix (we already extract it separately)
    stem = re.sub(r"^(POLICY|STANDARD|Standard|PROCEDURE|Procedure|PROGRAM|Checklist|Form|Report|FORM)[_\- ]+", "", stem)
    # Underscore/dash → space
    stem = re.sub(r"[_\-]+", " ", stem).strip()
    return stem


def _build_catalog() -> List[Dict[str, Any]]:
    """Scan TEMPLATES_DIR and return ordered metadata for every .docx/.xlsx."""
    if not TEMPLATES_DIR or not TEMPLATES_DIR.is_dir():
        logger.warning("NCA templates directory not found")
        return []

    items: List[Dict[str, Any]] = []
    seen_keys: set = set()

    for path in sorted(TEMPLATES_DIR.iterdir()):
        if not path.is_file():
            continue
        if path.suffix.lower() not in {".docx", ".xlsx"}:
            continue

        title = _humanize_title(path.name)
        category = _detect_category(path.name)
        # Stable id: hash-free, slugified filename
        template_id = re.sub(r"[^a-z0-9]+", "-", path.stem.lower()).strip("-")

        # De-duplicate near-identical filenames (e.g. " (1).docx" copies)
        dedupe_key = re.sub(r"\s*\(\d+\)$", "", path.stem.lower()).rstrip("-_ ")
        if dedupe_key in seen_keys:
            continue
        seen_keys.add(dedupe_key)

        items.append({
            "id": template_id,
            "filename": path.name,
            "title": title,
            "category": category,
            "size_bytes": path.stat().st_size,
            "format": path.suffix.lower().lstrip("."),
        })
    return items


_CATALOG_CACHE: Optional[List[Dict[str, Any]]] = None


def _get_catalog() -> List[Dict[str, Any]]:
    global _CATALOG_CACHE
    if _CATALOG_CACHE is None:
        _CATALOG_CACHE = _build_catalog()
    return _CATALOG_CACHE


def _find_template(template_id: str) -> Optional[Dict[str, Any]]:
    for item in _get_catalog():
        if item["id"] == template_id:
            return item
    return None


def _template_path(template_id: str) -> Path:
    item = _find_template(template_id)
    if not item:
        raise HTTPException(status_code=404, detail="Template not found")
    if not TEMPLATES_DIR:
        raise HTTPException(status_code=500, detail="Templates directory not configured")
    return TEMPLATES_DIR / item["filename"]


# ─── Content extraction ─────────────────────────────────────────────────────

def _extract_docx_text(path: Path) -> str:
    """Extract paragraphs + table cells from a .docx file as plain text."""
    try:
        from docx import Document  # python-docx
    except ImportError:
        raise HTTPException(status_code=500, detail="python-docx not installed")

    doc = Document(str(path))
    chunks: List[str] = []

    for para in doc.paragraphs:
        text = (para.text or "").strip()
        if text:
            chunks.append(text)

    for table in doc.tables:
        for row in table.rows:
            cells = [(cell.text or "").strip() for cell in row.cells]
            line = " | ".join(c for c in cells if c)
            if line:
                chunks.append(line)

    return "\n\n".join(chunks)


def _extract_xlsx_text(path: Path) -> str:
    """Flatten an .xlsx into newline-separated rows."""
    try:
        from openpyxl import load_workbook
    except ImportError:
        raise HTTPException(status_code=500, detail="openpyxl not installed")

    wb = load_workbook(str(path), read_only=True, data_only=True)
    chunks: List[str] = []
    for ws in wb.worksheets:
        chunks.append(f"## Sheet: {ws.title}")
        for row in ws.iter_rows(values_only=True):
            cells = [str(c).strip() for c in row if c is not None and str(c).strip()]
            if cells:
                chunks.append(" | ".join(cells))
    return "\n".join(chunks)


def _extract_template_text(template_id: str) -> str:
    path = _template_path(template_id)
    if path.suffix.lower() == ".docx":
        return _extract_docx_text(path)
    if path.suffix.lower() == ".xlsx":
        return _extract_xlsx_text(path)
    raise HTTPException(status_code=415, detail=f"Unsupported template format: {path.suffix}")


# ─── Schemas ────────────────────────────────────────────────────────────────

class CreateFromTemplateBody(BaseModel):
    title: Optional[str] = None
    classification: Optional[str] = "internal"
    doc_type: Optional[str] = None
    description: Optional[str] = None
    customizations: Optional[str] = None  # If set, AI rewrites the template with these tweaks


class AIDraftFromTemplateBody(BaseModel):
    title: str
    organization_context: Optional[str] = None
    additional_requirements: Optional[str] = None
    classification: Optional[str] = "internal"
    doc_type: Optional[str] = None
    save_as_document: bool = False  # If True, persists the result as a GovernanceDocument


class CompareBody(BaseModel):
    document_id: int


# ─── Helpers ────────────────────────────────────────────────────────────────

CATEGORY_TO_DOC_TYPE = {
    "Policy": "policy",
    "Standard": "standard",
    "Procedure": "procedure",
    "Program": "program",
    "Checklist": "checklist",
    "Form": "form",
    "Report": "report",
    "Cybersecurity Foundation": "policy",
    "Other": "policy",
}


def _next_document_code(tenant_id: int, doc_type: str, db: Session) -> str:
    prefix = (doc_type or "doc").upper()[:4]
    count = db.query(GovernanceDocument).filter(
        GovernanceDocument.tenant_id == tenant_id,
        GovernanceDocument.doc_type == doc_type,
    ).count()
    return f"{prefix}-{(count + 1):04d}"


# ─── Endpoints ──────────────────────────────────────────────────────────────

@router.get("")
def list_templates(
    user: GRCUser = Depends(require_auth),
):
    """Return all NCA template metadata grouped by category."""
    catalog = _get_catalog()
    by_category: Dict[str, List[Dict[str, Any]]] = {}
    for item in catalog:
        by_category.setdefault(item["category"], []).append(item)
    return {
        "total": len(catalog),
        "templates": catalog,
        "categories": [{"name": c, "count": len(items)} for c, items in sorted(by_category.items())],
    }


@router.get("/{template_id}/content")
def get_template_content(
    template_id: str,
    user: GRCUser = Depends(require_auth),
):
    """Return the extracted text content of a template for preview / editing."""
    item = _find_template(template_id)
    if not item:
        raise HTTPException(status_code=404, detail="Template not found")
    text = _extract_template_text(template_id)
    return {
        "id": template_id,
        "title": item["title"],
        "category": item["category"],
        "filename": item["filename"],
        "content": text,
        "word_count": len(text.split()),
    }


@router.get("/{template_id}/download")
def download_template(
    template_id: str,
    user: GRCUser = Depends(require_auth),
):
    """Stream the original .docx/.xlsx file for the user to download."""
    item = _find_template(template_id)
    if not item:
        raise HTTPException(status_code=404, detail="Template not found")
    return FileResponse(
        path=str(_template_path(template_id)),
        filename=item["filename"],
        media_type="application/octet-stream",
    )


@router.post("/{template_id}/create-document")
def create_document_from_template(
    template_id: str,
    body: CreateFromTemplateBody,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Create a new GovernanceDocument seeded from a template.

    If `customizations` is provided, AI rewrites the template content with
    those tweaks; otherwise the document is created with the raw template
    text and the user can edit it via the regular document editor.
    """
    item = _find_template(template_id)
    if not item:
        raise HTTPException(status_code=404, detail="Template not found")

    tenant_id = get_user_primary_tenant(user, db)
    base_content = _extract_template_text(template_id)
    final_content = base_content
    ai_used = False

    if body.customizations and OPENAI_API_KEY:
        try:
            from openai import OpenAI
            kwargs: Dict[str, Any] = {"api_key": OPENAI_API_KEY}
            if OPENAI_BASE_URL:
                kwargs["base_url"] = OPENAI_BASE_URL
            client = OpenAI(**kwargs)

            prompt = f"""You are a GRC documentation specialist. Take the following NCA Saudi cybersecurity template and adapt it per the customization instructions, preserving structure (headings, sections, numbered controls). Return only the revised document body in markdown.

TEMPLATE ({item['category']} — {item['title']}):
{base_content[:18000]}

CUSTOMIZATION INSTRUCTIONS:
{body.customizations}
"""

            completion = client.chat.completions.create(
                model="gpt-4o",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.4,
            )
            final_content = (completion.choices[0].message.content or base_content).strip()
            ai_used = True
        except Exception:
            logger.exception("AI customization of NCA template failed; using raw template")

    doc_type = body.doc_type or CATEGORY_TO_DOC_TYPE.get(item["category"], "policy")
    title = body.title or item["title"]

    doc = GovernanceDocument(
        tenant_id=tenant_id,
        document_code=_next_document_code(tenant_id, doc_type, db),
        title=title,
        description=body.description or f"Created from NCA template: {item['title']}",
        content=final_content,
        doc_type=doc_type,
        classification=body.classification or "internal",
        current_version="1.0",
        status="draft",
        author_id=getattr(user, "id", None),
        owner_id=getattr(user, "id", None),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    return {
        "document_id": doc.id,
        "title": doc.title,
        "doc_type": doc.doc_type,
        "ai_customization_applied": ai_used,
        "source_template": {"id": template_id, "title": item["title"]},
    }


@router.post("/{template_id}/ai-draft")
def ai_draft_from_template(
    template_id: str,
    body: AIDraftFromTemplateBody,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Use a template as a reference and let AI generate a tailored draft.

    Unlike create-document (which copies/modifies the template directly),
    this rewrites the document from scratch using the template purely as
    structural and content guidance, blended with the user's own context.
    """
    item = _find_template(template_id)
    if not item:
        raise HTTPException(status_code=404, detail="Template not found")

    if not OPENAI_API_KEY:
        raise HTTPException(status_code=503, detail="AI not configured. Set AI_INTEGRATIONS_OPENAI_API_KEY.")

    reference = _extract_template_text(template_id)

    try:
        from openai import OpenAI
        kwargs: Dict[str, Any] = {"api_key": OPENAI_API_KEY}
        if OPENAI_BASE_URL:
            kwargs["base_url"] = OPENAI_BASE_URL
        client = OpenAI(**kwargs)

        prompt = f"""You are a senior GRC documentation specialist drafting a cybersecurity {item['category'].lower()} for a Saudi-regulated organization. Use the NCA reference template below as the structural and policy backbone, but produce an original document tailored to the organization context provided.

REFERENCE TEMPLATE ({item['title']}):
{reference[:16000]}

NEW DOCUMENT TITLE: {body.title}

ORGANIZATION CONTEXT:
{body.organization_context or '(generic — no specific context)'}

ADDITIONAL REQUIREMENTS:
{body.additional_requirements or '(none)'}

Return a complete document in markdown with sections: Purpose, Scope, Definitions, Roles & Responsibilities, Policy/Standard Statements, Compliance & Enforcement, Review, References. Preserve any NCA control numbering format from the reference where applicable.
"""

        completion = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.55,
        )
        generated = (completion.choices[0].message.content or "").strip()
    except Exception as exc:
        logger.exception("AI draft from NCA template failed")
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")

    response: Dict[str, Any] = {
        "generated_content": generated,
        "title": body.title,
        "source_template": {"id": template_id, "title": item["title"], "category": item["category"]},
        "word_count": len(generated.split()),
    }

    if body.save_as_document:
        tenant_id = get_user_primary_tenant(user, db)
        doc_type = body.doc_type or CATEGORY_TO_DOC_TYPE.get(item["category"], "policy")
        doc = GovernanceDocument(
            tenant_id=tenant_id,
            document_code=_next_document_code(tenant_id, doc_type, db),
            title=body.title,
            description=f"AI-drafted using NCA template: {item['title']}",
            content=generated,
            doc_type=doc_type,
            classification=body.classification or "internal",
            current_version="1.0",
            status="draft",
            author_id=getattr(user, "id", None),
            author_name=getattr(user, "display_name", None) or getattr(user, "username", None),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(doc)
        db.commit()
        db.refresh(doc)
        response["document_id"] = doc.id

    return response


@router.post("/{template_id}/compare")
def compare_with_document(
    template_id: str,
    body: CompareBody,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Return the template content + the user's document content for
    side-by-side rendering on the frontend, plus an optional AI gap
    analysis if the OpenAI key is configured.
    """
    item = _find_template(template_id)
    if not item:
        raise HTTPException(status_code=404, detail="Template not found")

    tenant_id = get_user_primary_tenant(user, db)
    doc = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == body.document_id,
        GovernanceDocument.tenant_id == tenant_id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    template_content = _extract_template_text(template_id)
    document_content = (doc.content or "").strip() or "(empty document)"

    gap_analysis: Optional[Dict[str, Any]] = None

    if OPENAI_API_KEY:
        try:
            from openai import OpenAI
            kwargs: Dict[str, Any] = {"api_key": OPENAI_API_KEY}
            if OPENAI_BASE_URL:
                kwargs["base_url"] = OPENAI_BASE_URL
            client = OpenAI(**kwargs)

            prompt = f"""Compare the user's document against the NCA reference template. Identify gaps, missing sections, and areas where the user document is weaker or stronger than the template. Be concise and specific.

NCA REFERENCE ({item['title']}):
{template_content[:8000]}

USER DOCUMENT ({doc.title}):
{document_content[:8000]}

Return strict JSON with keys:
- summary (2-3 sentences)
- missing_from_user_document (array of specific items present in template but absent in user doc)
- present_in_user_only (array of items in user doc not in template)
- alignment_score (0-100 integer, how well the user doc aligns with the template)
- recommended_additions (array of 3-7 specific clauses/sections to add)
"""

            completion = client.chat.completions.create(
                model="gpt-4o",
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                temperature=0.3,
            )
            gap_analysis = json.loads(completion.choices[0].message.content or "{}")
        except Exception:
            logger.exception("AI gap analysis failed; returning side-by-side without it")

    return {
        "template": {
            "id": template_id,
            "title": item["title"],
            "category": item["category"],
            "content": template_content,
        },
        "document": {
            "id": doc.id,
            "title": doc.title,
            "doc_type": doc.doc_type,
            "content": document_content,
        },
        "gap_analysis": gap_analysis,
    }
