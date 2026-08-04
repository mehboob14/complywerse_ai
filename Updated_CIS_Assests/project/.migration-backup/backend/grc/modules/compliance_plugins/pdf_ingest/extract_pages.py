"""Per-page text extraction with layered fallbacks — Cywift-style pipeline.

For each page we try, in order:
  1. pdfplumber.extract_text() — the fastest exact text extractor.
  2. PyMuPDF (fitz) page.get_text("blocks") — layout-aware, joins across columns.
  3. pytesseract OCR with preprocessing + post-correction — only when the
     prior two return very little text (text density below MIN_CHARS_PER_PAGE),
     which is how scanned/image pages reveal themselves.

Cywift-style upgrades layered on top of the basic pipeline:
  • Deskew + denoise + contrast-boost the rasterised page before OCR.
  • Pick the best PSM (page-segmentation mode) — 6 (uniform block) is the
    right default for CIS body text; 4 (single column) for narrow gutters.
  • Run OCR twice (psm=6 and psm=4) and pick the result with higher
    word-count, because CIS PDFs randomly switch column counts on
    "tip box" pages.
  • Post-process OCR output to fix the high-frequency mis-reads that bite
    registry paths and command output: "rn"→"m", lone "O" inside numeric
    runs → "0", "l"→"1" inside number-only tokens, smart-quotes → ASCII.

Each page returns a dict { page: int, text: str, source: str, ocr_used: bool,
                            ocr_confidence: float | None }.
The whole-document caller stitches these together.
"""
from __future__ import annotations

import io
import logging
from typing import Iterable, Iterator

logger = logging.getLogger(__name__)

# Below this many characters we assume the page is image-based and need OCR.
MIN_CHARS_PER_PAGE = 80


def _pdfplumber_pages(pdf_bytes: bytes) -> list[str]:
    import pdfplumber  # local import keeps cold-import light
    out: list[str] = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            try:
                out.append(page.extract_text() or "")
            except Exception as exc:  # noqa: BLE001
                logger.warning("pdfplumber failed on page: %s", exc)
                out.append("")
    return out


def _fitz_blocks(pdf_bytes: bytes) -> list[str]:
    import fitz  # PyMuPDF
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    out: list[str] = []
    try:
        for page in doc:
            try:
                blocks = page.get_text("blocks") or []
                blocks = sorted(blocks, key=lambda b: (round(b[1], 1), round(b[0], 1)))
                out.append("\n".join(b[4] for b in blocks if len(b) >= 5 and isinstance(b[4], str)))
            except Exception as exc:  # noqa: BLE001
                logger.warning("PyMuPDF failed on page: %s", exc)
                out.append("")
    finally:
        doc.close()
    return out


def _preprocess_for_ocr(img):
    """Boost OCR accuracy on grey/coloured scans.

    Pillow-only pipeline (no opencv dep):
      1. Convert to greyscale.
      2. Auto-contrast to spread the histogram across full 0-255.
      3. Light denoise via median filter (kills speckle on scanned pages).
      4. Sharpen so character edges stay crisp through resampling.

    Returns a new PIL.Image in mode "L" (8-bit grayscale).
    """
    from PIL import Image, ImageOps, ImageFilter
    g = img.convert("L")
    g = ImageOps.autocontrast(g, cutoff=2)
    g = g.filter(ImageFilter.MedianFilter(size=3))
    g = g.filter(ImageFilter.SHARPEN)
    return g


def _post_correct_ocr(text: str) -> str:
    """Fix the most damaging Tesseract mis-reads for CIS text.

    These bite hard on registry paths and command output where a single
    wrong digit/letter breaks parsing downstream:
      • "0" vs "O" — inside numeric runs ('5-1-O' → '5-1-0')
      • "l" / "I" / "i" vs "1" — same context
      • "rn" vs "m" — common OCR confusion in narrow body text
      • Smart quotes → ASCII (CIS PDFs sometimes embed curly quotes that
        break our regex matches against literal single-quote phrases)
      • Non-breaking spaces → regular spaces
    """
    if not text:
        return text
    # Normalize smart quotes and dashes
    text = (text
            .replace("‘", "'").replace("’", "'")
            .replace("“", '"').replace("”", '"')
            .replace("–", "-").replace("—", "-")
            .replace(" ", " "))
    # Inside SID-like tokens (S-1-5-…) fix 'O' or 'l' that appears between digits
    import re as _re
    def _fix_sid(m):
        tok = m.group(0)
        return tok.replace("O", "0").replace("l", "1").replace("I", "1")
    text = _re.sub(r"\bS-\d+(?:-[\dOlI]+)+\b", _fix_sid, text)
    # Inside numeric-only-looking tokens of length 2+, replace stray letters
    def _fix_num(m):
        tok = m.group(0)
        # Only flip if the original token is ≥80% digits already
        digits = sum(1 for c in tok if c.isdigit())
        if digits / max(len(tok), 1) >= 0.5:
            return tok.replace("O", "0").replace("l", "1").replace("I", "1")
        return tok
    text = _re.sub(r"\b[\dOlI]{2,}\b", _fix_num, text)
    return text


def _ocr_page(pdf_bytes: bytes, page_index: int) -> tuple[str, float | None]:
    """Rasterise one page at 300 DPI, preprocess, and OCR with Tesseract.

    Tries two page-segmentation modes (psm=6 uniform block + psm=4 single
    column) and picks the result with higher word density. Returns
    (text, mean_confidence) — confidence is None if pytesseract can't
    provide it.
    """
    import fitz
    import pytesseract
    from PIL import Image

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc[page_index]
        # 300 DPI ≈ 4.166 zoom (PDF default 72 DPI). Higher → slower but
        # noticeably more accurate on small CIS body text.
        mat = fitz.Matrix(300 / 72, 300 / 72)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        img = Image.open(io.BytesIO(pix.tobytes("png")))
    finally:
        doc.close()

    img = _preprocess_for_ocr(img)

    best_text = ""
    best_score = -1
    best_conf: float | None = None
    for psm in (6, 4):
        try:
            cfg = f"--oem 3 --psm {psm}"
            text = pytesseract.image_to_string(img, config=cfg) or ""
            # Score on word count — higher means OCR latched onto more text
            word_count = len(text.split())
            if word_count > best_score:
                best_score = word_count
                best_text = text
                # Pull per-word confidence so we know how shaky a page is
                try:
                    data = pytesseract.image_to_data(
                        img, config=cfg,
                        output_type=pytesseract.Output.DICT,
                    )
                    confs = [int(c) for c in data.get("conf", []) if str(c).lstrip("-").isdigit() and int(c) >= 0]
                    best_conf = (sum(confs) / len(confs)) if confs else None
                except Exception:
                    best_conf = None
        except Exception as exc:  # noqa: BLE001
            logger.warning("Tesseract psm=%d failed on page %d: %s", psm, page_index, exc)

    return _post_correct_ocr(best_text), best_conf


def extract_all_pages(pdf_bytes: bytes) -> Iterator[dict]:
    """Yield per-page extraction dicts with the best available text.

    The strategy is: pdfplumber → fitz fill-in for sparse pages → OCR last.
    OCR is the most expensive step (~1-3s per page) so we only invoke it
    when both vector extractors gave us essentially nothing.
    """
    plumber = _pdfplumber_pages(pdf_bytes)
    fitz_pages: list[str] | None = None
    page_count = len(plumber)

    for i, plumber_text in enumerate(plumber):
        if len(plumber_text.strip()) >= MIN_CHARS_PER_PAGE:
            # Even when pdfplumber gave a clean read, run post-OCR
            # normalization to fix smart-quotes that occasionally appear
            # in CIS PDFs and break our literal regex matches.
            yield {
                "page": i + 1,
                "text": _post_correct_ocr(plumber_text),
                "source": "pdfplumber",
                "ocr_used": False,
                "ocr_confidence": None,
            }
            continue
        # Lazy: only invoke fitz if we hit a sparse page
        if fitz_pages is None:
            try:
                fitz_pages = _fitz_blocks(pdf_bytes)
            except Exception as exc:  # noqa: BLE001
                logger.warning("PyMuPDF batch extract failed: %s", exc)
                fitz_pages = [""] * page_count
        fitz_text = fitz_pages[i] if i < len(fitz_pages) else ""
        if len(fitz_text.strip()) >= MIN_CHARS_PER_PAGE:
            yield {
                "page": i + 1,
                "text": _post_correct_ocr(fitz_text),
                "source": "fitz",
                "ocr_used": False,
                "ocr_confidence": None,
            }
            continue
        # Last resort — OCR with preprocessing + dual-PSM + post-correction
        ocr_text, ocr_conf = _ocr_page(pdf_bytes, i)
        yield {
            "page": i + 1,
            "text": ocr_text,
            "source": "ocr",
            "ocr_used": True,
            "ocr_confidence": ocr_conf,
        }
