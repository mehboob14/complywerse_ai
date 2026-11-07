"""Advisory document extraction — the intelligent PDF parser.

Turns an advisory document (uploaded, or scraped from a CERT) into a *proposed*
advisory + CVEs for a human to confirm. One core, used by both the upload flow
and the scrape flow (``ingest.py``).

Why it generalises across regions and years (owner's key requirement — "each
year's document is different"): we do NOT hand-write a parser per format. The
spine is deterministic and the structure is model-driven:
  * **CVE ids** come from regex — the authoritative "which CVEs". Never invented;
    the model's output is filtered down to this set.
  * **Everything free-form** (title, summary, advisory severity, the CERT's own
    advisory id, publish date, and per-CVE product/version ranges) is extracted
    by an LLM given the raw text and a *region hint* so it applies the right
    format expectations. Best effort — empty/heuristic when no key is set.
  * A human reviews and confirms before anything is tracked, so a wrong
    extraction never silently enters the register.

The parser is a multi-stage pipeline because documents vary — even one CERT
publishes native-text PDFs one year and scanned images the next:

    Stage 1  layout-aware native text (PyMuPDF, incl. detected tables)
    Stage 2  if scanned/thin, an OCR chain — first available engine wins:
             PaddleOCR → EasyOCR → vision-LLM (gpt-4o reads the page images and
             structures in one call) → tesseract
    Stage 3  regex CVE spine (authoritative) + AI structure → master template
    Stage 4  validate — confidence score + warnings; a low-confidence document is
             flagged for review, never silently dropped

Each document escalates only as far as it needs. Pages are rasterised with
PyMuPDF (no poppler), so OCR needs no system libs; PaddleOCR/EasyOCR are optional
and used when installed (best on-prem accuracy). Everything degrades honestly —
stages report "unavailable" rather than failing.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# CVE-YYYY-NNNN+ (4+ digit sequence). Case-insensitive; normalised to upper.
_CVE_RE = re.compile(r"CVE-\d{4}-\d{4,}", re.IGNORECASE)

_AI_TEXT_BUDGET = 9000  # chars of advisory text handed to the model
_SUMMARY_CHARS = 600
_VALID_SEVERITY = {"critical", "high", "medium", "low"}


def find_cves(text: str) -> List[str]:
    """Distinct CVE ids in document order (the authoritative 'which CVEs')."""
    seen: List[str] = []
    for m in _CVE_RE.finditer(text or ""):
        cve = m.group(0).upper()
        if cve not in seen:
            seen.append(cve)
    return seen


def _parse_pub_date(value: Optional[str]) -> Optional[datetime]:
    for fmt in ("%Y-%m-%d", "%d %B %Y", "%d %b %Y", "%B %d, %Y"):
        try:
            return datetime.strptime((value or "").strip(), fmt)
        except (ValueError, TypeError):
            continue
    return None


# Total extracted text below this ⇒ the PDF is almost certainly scanned/image,
# so escalate to the vision stage. A real one-page advisory has well over this.
_MIN_TEXT_CHARS = 200
_VISION_MAX_PAGES = 4    # pages rasterised for the vision model (advisories are short)
_VISION_DPI = 170        # render resolution — legible to the model, bounded in size


def _pdfplumber_text(content: bytes) -> str:
    """Stage 1 — native (digital) text. Empty string on failure, never raises."""
    try:
        import io
        import pdfplumber
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            return "\n".join((page.extract_text() or "") for page in pdf.pages)
    except Exception:
        logger.exception("advisory extraction: pdfplumber failed")
        return ""


def _fitz_text(content: bytes) -> Dict[str, Any]:
    """Stage 1 — layout-aware native text via PyMuPDF, including detected tables
    (advisories put affected-version matrices in tables). Falls back to
    pdfplumber if PyMuPDF can't open the file. Never raises."""
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(stream=content, filetype="pdf")
        parts: List[str] = []
        tables: List[str] = []
        for page in doc:
            parts.append(page.get_text("text") or "")
            try:
                for tbl in page.find_tables().tables:
                    rows = tbl.extract()
                    tables.append("\n".join(
                        " | ".join((c or "").strip() for c in row) for row in rows))
            except Exception:
                pass  # table detection is best-effort
        text = "\n".join(parts)
        if tables:
            text += "\n\n[TABLES]\n" + "\n\n".join(tables)
        return {"text": text, "pages": doc.page_count, "engine": "pymupdf",
                "tables": len(tables), "ok": True}
    except Exception:
        logger.exception("advisory extraction: PyMuPDF failed; trying pdfplumber")
        text = _pdfplumber_text(content)
        return {"text": text, "pages": None, "engine": "pdfplumber", "tables": 0, "ok": bool(text)}


def _render_pages_png(content: bytes, max_pages: int, dpi: int) -> List[bytes]:
    """Rasterise the first pages to PNG via PyMuPDF (no poppler dependency)."""
    import fitz
    doc = fitz.open(stream=content, filetype="pdf")
    out: List[bytes] = []
    for i, page in enumerate(doc):
        if i >= max_pages:
            break
        out.append(page.get_pixmap(dpi=dpi).tobytes("png"))
    return out


def _png_to_ndarray(png: bytes):
    import io
    import numpy as np
    from PIL import Image
    return np.array(Image.open(io.BytesIO(png)).convert("RGB"))


def _openai_client():
    """Shared OpenAI client (text + vision). None when no key is configured."""
    import os
    from ...config import get_openai_api_key
    api_key = get_openai_api_key()
    if not api_key:
        return None
    from openai import OpenAI
    kwargs: Dict[str, Any] = {"api_key": api_key}
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    if base_url:
        kwargs["base_url"] = base_url
    return OpenAI(**kwargs)


# ── Stage 2: pluggable OCR chain for scanned/image PDFs ──────────────────────
# First AVAILABLE engine wins, ordered best-first. PaddleOCR/EasyOCR are the
# strongest local engines (layout-aware, no API cost) and take precedence once
# installed; the vision model needs no install and also structures the doc;
# tesseract is the light last resort. Each runs on PyMuPDF-rendered page images.

def _ocr_paddle(pngs: List[bytes], source_hint: str = "") -> Dict[str, Any]:
    try:
        from paddleocr import PaddleOCR
        ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
        parts: List[str] = []
        for p in pngs:
            for block in (ocr.ocr(_png_to_ndarray(p), cls=True) or []):
                for line in (block or []):
                    try:
                        parts.append(line[1][0])
                    except Exception:
                        pass
        text = "\n".join(parts)
        return {"ok": bool(text.strip()), "engine": "paddleocr", "text": text,
                "structured": None, "reason": None}
    except Exception as exc:
        return {"ok": False, "engine": "paddleocr", "text": "", "structured": None,
                "reason": exc.__class__.__name__}


def _ocr_easy(pngs: List[bytes], source_hint: str = "") -> Dict[str, Any]:
    try:
        import easyocr
        reader = easyocr.Reader(["en"], gpu=False)
        parts = ["\n".join(reader.readtext(_png_to_ndarray(p), detail=0, paragraph=True))
                 for p in pngs]
        text = "\n".join(parts)
        return {"ok": bool(text.strip()), "engine": "easyocr", "text": text,
                "structured": None, "reason": None}
    except Exception as exc:
        return {"ok": False, "engine": "easyocr", "text": "", "structured": None,
                "reason": exc.__class__.__name__}


def _ocr_vision(pngs: List[bytes], source_hint: str = "") -> Dict[str, Any]:
    """Multimodal LLM: reads the page images directly (OCR + understanding) and
    returns both a transcription and the structured template in one call."""
    out: Dict[str, Any] = {"ok": False, "engine": "vision", "text": "",
                           "structured": None, "reason": None}
    try:
        import base64
        import json
        from ...config import get_openai_model
        client = _openai_client()
        if client is None:
            out["reason"] = "no AI key"
            return out
        origin = f" published by {source_hint}" if source_hint else ""
        prompt = (
            f"These are page images of a security advisory{origin} (possibly scanned). "
            "Read them carefully, including any tables. Transcribe all visible text into "
            "full_text, and extract the advisory. Only include CVE ids actually visible "
            "(format CVE-YYYY-NNNNN). Return strict JSON with keys: full_text, title, "
            "summary (1-2 sentences), severity (critical/high/medium/low), advisory_id "
            "(issuer reference or null), published (YYYY-MM-DD or null), cves "
            "(array of {cve_id, product, versions})."
        )
        blocks: List[Dict[str, Any]] = [{"type": "text", "text": prompt}]
        for png in pngs:
            b64 = base64.b64encode(png).decode()
            blocks.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}})
        completion = client.chat.completions.create(
            model=get_openai_model(),
            messages=[{"role": "user", "content": blocks}],
            response_format={"type": "json_object"}, temperature=0.1,
        )
        data = json.loads(completion.choices[0].message.content or "{}")
        sev = str(data.get("severity") or "").strip().lower()
        out["text"] = str(data.get("full_text") or "")
        out["structured"] = {
            "title": str(data.get("title") or "").strip() or None,
            "summary": str(data.get("summary") or "").strip() or None,
            "severity": sev if sev in _VALID_SEVERITY else None,
            "external_id": str(data.get("advisory_id") or "").strip() or None,
            "published": str(data.get("published") or "").strip() or None,
            "cves_raw": data.get("cves") or [],
            "ai_used": True,
        }
        out["ok"] = True
    except Exception as exc:
        logger.exception("advisory extraction: vision OCR failed")
        out["reason"] = exc.__class__.__name__
    return out


def _ocr_tesseract(pngs: List[bytes], source_hint: str = "") -> Dict[str, Any]:
    try:
        import io
        import pytesseract
        from PIL import Image
        text = "\n".join(pytesseract.image_to_string(Image.open(io.BytesIO(p))) for p in pngs)
        return {"ok": bool(text.strip()), "engine": "tesseract", "text": text,
                "structured": None, "reason": None}
    except Exception as exc:
        return {"ok": False, "engine": "tesseract", "text": "", "structured": None,
                "reason": exc.__class__.__name__}


# Local OCR engines (best-first) for scanned docs when no AI key is available.
# The vision model is driven separately because it also structures the document.
_LOCAL_OCR_CHAIN = [_ocr_paddle, _ocr_easy, _ocr_tesseract]


def filter_ai_cves(ai_cves: Any, found: List[str]) -> Dict[str, Dict[str, Any]]:
    """Keep only model-annotated CVEs that regex actually found (anti-hallucination).
    Pure — unit-testable without a network/model."""
    valid = {c.upper() for c in found}
    out: Dict[str, Dict[str, Any]] = {}
    for item in ai_cves or []:
        if not isinstance(item, dict):
            continue
        cid = str(item.get("cve_id", "")).upper()
        if cid in valid and cid not in out:
            out[cid] = {
                "product": (str(item.get("product") or "").strip() or None),
                "versions": (str(item.get("versions") or "").strip() or None),
            }
    return out


def _ai_extract(text: str, cve_ids: List[str], *, source_hint: str = "") -> Dict[str, Any]:
    """Model-driven structured extraction of the full normalised template.

    Region/source is passed as a hint so the model applies the right format
    expectations. Best effort: ai_used=False (and empty fields) with no key or on
    failure. The model only annotates the CVEs we already found — never adds any.
    """
    out: Dict[str, Any] = {
        "title": None, "summary": None, "severity": None,
        "external_id": None, "published": None, "cves_raw": [], "ai_used": False,
    }
    if not cve_ids:
        return out
    try:
        import json
        from ...config import get_openai_model

        client = _openai_client()
        if client is None:
            return out

        origin = f" published by {source_hint}" if source_hint else ""
        prompt = (
            f"You are a vulnerability analyst reading a security advisory{origin}. "
            "Advisory formats differ by issuer and year, so read carefully and map "
            "to this fixed schema. For EACH listed CVE id, give the affected product "
            "(short name, e.g. 'php', 'node.js') and the affected version range as "
            "free text (e.g. '< 8.2.35', '22.x, 24.x, 26.x before 24.22.1'). Do NOT "
            "invent CVEs — only annotate the ids given.\n\n"
            f"CVE ids: {', '.join(cve_ids)}\n\n"
            f"Advisory text:\n{text[:_AI_TEXT_BUDGET]}\n\n"
            "Return strict JSON with keys: "
            '"title" (concise headline), '
            '"summary" (1-2 sentences), '
            '"severity" (one of critical/high/medium/low — the highest in the doc), '
            '"advisory_id" (the issuer\'s own reference if present, e.g. "NCA-24.261026", else null), '
            '"published" (ISO date YYYY-MM-DD if stated, else null), '
            '"cves" (array of {"cve_id","product","versions"}).'
        )
        completion = client.chat.completions.create(
            model=get_openai_model(),
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.1,
        )
        data = json.loads(completion.choices[0].message.content or "{}")
        out["cves_raw"] = data.get("cves") or []
        out["title"] = (str(data.get("title") or "").strip() or None)
        out["summary"] = (str(data.get("summary") or "").strip() or None)
        sev = str(data.get("severity") or "").strip().lower()
        out["severity"] = sev if sev in _VALID_SEVERITY else None
        out["external_id"] = (str(data.get("advisory_id") or "").strip() or None)
        out["published"] = (str(data.get("published") or "").strip() or None)
        out["ai_used"] = True
    except Exception:
        logger.exception("advisory extraction: AI structured extract failed")
    return out


def _template_from(text: str, ai: Dict[str, Any], filename: str = "") -> Dict[str, Any]:
    """Assemble the normalised template from text + a model result (text or
    vision). The regex CVE spine is the authority; model CVEs are filtered to it."""
    cve_ids = find_cves(text)
    products = filter_ai_cves(ai.get("cves_raw"), cve_ids)
    cves = [
        {
            "cve_id": cid,
            "affected_product": (products.get(cid) or {}).get("product"),
            "affected_versions": (products.get(cid) or {}).get("versions"),
        }
        for cid in cve_ids
    ]
    title = ai.get("title") or (filename.rsplit(".", 1)[0] if filename else "") or "Uploaded advisory"
    summary = ai.get("summary") or (" ".join((text or "").split())[:_SUMMARY_CHARS] or None)
    return {
        "title": title,
        "summary": summary,
        "severity": ai.get("severity"),
        "external_id": ai.get("external_id"),
        "published_at": _parse_pub_date(ai.get("published")),
        "cves": cves,
        "ai_used": bool(ai.get("ai_used")),
    }


def extract_from_text(text: str, *, filename: str = "", source_hint: str = "") -> Dict[str, Any]:
    """Core text extraction (no PDF/IO) — unit-testable. Produces the proposed,
    normalised advisory template a human then confirms."""
    cve_ids = find_cves(text)
    ai = _ai_extract(text, cve_ids, source_hint=source_hint)
    return _template_from(text, ai, filename)


def extract_from_pdf(content: bytes, *, filename: str = "", source_hint: str = "") -> Dict[str, Any]:
    """Full multi-stage pipeline: PDF bytes → master template + a stage report.

    Stage 1  layout-aware native text (PyMuPDF + tables).
    Stage 2  vision-LLM pass (whenever a key exists, not only for scanned docs) —
             it reads the page images, so it recovers CVEs the text layer garbles
             in tables/columns, and structures the doc. No key + scanned ⇒ the
             local OCR chain (PaddleOCR → EasyOCR → tesseract) supplies the text.
    Stage 3  union every source's CVEs (regex is authoritative) and annotate from
             the richest structured result.
    Stage 4  validate — confidence + warnings (incl. CVEs vision recovered that
             the text layer missed). Never raises. Returns the normalised template
             plus ``extraction`` = {method, confidence, warnings, stages}."""
    stages: List[Dict[str, Any]] = []

    # Stage 1 — native text + tables.
    s1 = _fitz_text(content)
    native_text = s1["text"]
    native_chars = len(native_text.strip())
    native_cves = find_cves(native_text)
    stages.append({"stage": "native_text", "engine": s1["engine"], "chars": native_chars,
                   "tables": s1.get("tables", 0), "cves": len(native_cves),
                   "status": "done" if native_chars >= _MIN_TEXT_CHARS else "weak"})

    has_ai = _openai_client() is not None
    vision_text, vision_struct = "", None
    ocr_text, ocr_engine = "", None

    # Stage 2 — vision pass (authoritative; also structures).
    if has_ai:
        try:
            pngs = _render_pages_png(content, _VISION_MAX_PAGES, _VISION_DPI)
        except Exception:
            logger.exception("advisory extraction: rasterisation failed")
            pngs = []
        if pngs:
            v = _ocr_vision(pngs, source_hint)
            if v["ok"]:
                vision_text, vision_struct = v["text"], v["structured"]
                stages.append({"stage": "vision", "engine": "gpt-4o vision",
                               "chars": len(vision_text.strip()),
                               "cves": len(find_cves(vision_text)), "status": "done"})
            else:
                stages.append({"stage": "vision", "engine": "gpt-4o vision",
                               "status": "unavailable", "detail": v["reason"]})

    # Stage 2b — scanned doc with no AI key ⇒ local OCR chain for the text.
    if native_chars < _MIN_TEXT_CHARS and not vision_struct:
        try:
            pngs = _render_pages_png(content, _VISION_MAX_PAGES, _VISION_DPI)
        except Exception:
            pngs = []
        for backend in _LOCAL_OCR_CHAIN:
            r = backend(pngs, source_hint) if pngs else {
                "ok": False, "engine": backend.__name__, "text": "", "reason": "no pages rendered"}
            stages.append({"stage": "ocr", "engine": r["engine"],
                           **({"chars": len(r["text"].strip())} if r["ok"] else {"detail": r.get("reason")}),
                           "status": "done" if r["ok"] else "unavailable"})
            if r["ok"]:
                ocr_text, ocr_engine = r["text"], r["engine"]
                break

    # Stage 3 — union CVEs across every source; annotate from the richest result.
    combined = "\n".join(t for t in (native_text, vision_text, ocr_text) if t)
    cve_ids = find_cves(combined)
    if vision_struct:
        ai = vision_struct
    elif has_ai and cve_ids:
        ai = _ai_extract(native_text or ocr_text, cve_ids, source_hint=source_hint)
    else:
        ai = {}
    result = _template_from(combined, ai, filename)

    if vision_struct and native_chars >= _MIN_TEXT_CHARS:
        method = "native+vision"
    elif vision_struct:
        method = "vision"
    elif ocr_engine:
        method = ocr_engine
    else:
        method = "native_text"
    ocr_used = method != "native_text"

    # Stage 4 — validate.
    cve_count = len(result["cves"])
    warnings: List[str] = []
    gain = (len(find_cves(vision_text)) - len(native_cves)) if vision_struct else 0
    if vision_struct and native_chars >= _MIN_TEXT_CHARS and gain > 0:
        warnings.append(f"Vision recovered {gain} CVE(s) the text layer missed "
                        "(table/column layout) — text-only extraction would under-count")
    if cve_count == 0:
        warnings.append("No CVE identifiers found — confirm this is a CVE advisory")
    if not result["ai_used"]:
        warnings.append("AI structuring unavailable — product/version/severity left blank")

    if cve_count and (vision_struct or result["ai_used"]):
        confidence = "high"
    elif cve_count:
        confidence = "medium"
    else:
        confidence = "low"

    stages.append({"stage": "structure", "engine": "regex+ai", "cves": cve_count,
                   "ai_used": result["ai_used"], "status": "done" if cve_count else "empty"})
    stages.append({"stage": "validate", "confidence": confidence,
                   "status": "done" if cve_count else "review"})

    result["ocr_used"] = ocr_used
    result["text_chars"] = len(combined.strip())
    result["text_sample"] = combined[:3000]  # for region classification (not persisted)
    result["extraction"] = {"method": method, "confidence": confidence,
                            "warnings": warnings, "stages": stages}
    return result
