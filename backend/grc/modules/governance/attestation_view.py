"""How a document is shown on the public attestation page (document_attestations.py, ``/public/{token}``): to someone who is not signed in,
who must be able to read it before acknowledging it. One answer per kind of document:

  markdown  a document the platform holds the text of (AI Studio, the editor) or a .md file - the page draws it with the same renderer as
            the document viewer (``GovernanceDocumentMarkdown``); images in it are only the ones carried inside it (data:)
  html      content that is HTML, cleaned here with an allow-list (``sanitize_html``): no script, no event handler, no style that can
            reach out, no javascript: link, no remote image or embed
  text      plain text (a .txt file, content without markup)
  word      a .docx - the page draws the file itself as Word draws it (``WordView``); the file is served by ``/public/{token}/file``;
            its text, reflowed, by ``/public/{token}/text`` (for a phone, and when the drawing fails)
  pdf       a PDF - its pages are drawn on the server and served one by one (``/public/{token}/pages/{n}``), so a phone reads them too
  none      nothing that can be shown (an Excel file, a damaged file): the page says so

Whatever is shown is the version IN FORCE (the caller passes ``in_force_row``), and only what the version itself holds: no control pages,
approvers, newer rounds or internal ids.
"""
from __future__ import annotations

import functools
import logging
import os
import re
import unicodedata
import zipfile
from typing import Any, Dict, Optional, Tuple

from bs4 import BeautifulSoup, Comment, Doctype, NavigableString, ProcessingInstruction, Declaration, CData

logger = logging.getLogger(__name__)

MAX_PAGES = 150                 # pages of a PDF drawn for the page; the rest are in "Open the PDF"
PAGE_WIDTH_PX = 1240            # a drawn page is this wide: sharp at 880 px on a screen of 1.5x, readable when zoomed on a phone
DOCX_MEDIA = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


# ── what a file is ───────────────────────────────────────────────────────────
def file_kind(src: Any) -> str:
    """"pdf", "docx", "md", "txt" or "" for the stored file of a document or a version row (by its type, else its name)."""
    for guess in ((src.file_type or ""), os.path.splitext(src.file_name or "")[1], os.path.splitext(src.file_path or "")[1]):
        g = guess.lower().lstrip(".")
        if g in ("pdf", "docx", "md", "txt"):
            return g
        if g == "markdown":
            return "md"
    return ""


def _has_file(src: Any) -> bool:
    return bool(src.file_path and os.path.isfile(src.file_path))


def _is_docx(path: str) -> bool:
    """A real Word package (an old .doc saved under a .docx name, or a damaged file, cannot be drawn)."""
    try:
        with zipfile.ZipFile(path) as z:
            return "word/document.xml" in z.namelist()
    except Exception:       # noqa: BLE001 - not a zip, truncated, unreadable
        return False


def pdf_info(path: str) -> Optional[Dict[str, Any]]:
    """{"total": pages, "ratio": height/width of the first page} of a PDF that can be drawn, else None (damaged, password-protected)."""
    try:
        import fitz

        with fitz.open(path) as d:
            if d.needs_pass or d.page_count < 1:
                return None
            r = d.load_page(0).rect
            return {"total": d.page_count, "ratio": round(r.height / r.width, 4) if r.width else 1.414}
    except Exception as exc:        # noqa: BLE001
        logger.warning("attestation view: a PDF could not be opened: %s", exc)
        return None


@functools.lru_cache(maxsize=24)
def _draw(path: str, mtime: float, number: int) -> bytes:
    import fitz

    with fitz.open(path) as d:
        page = d.load_page(number - 1)
        zoom = max(0.5, min(3.0, PAGE_WIDTH_PX / max(page.rect.width, 1.0)))
        return page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False).tobytes("png")


@functools.lru_cache(maxsize=8)
def _word_text(path: str, mtime: float) -> Optional[str]:
    try:
        from .studio import docx_io          # the AI Studio's reader of Word files: headings, numbered lists, tables and emphasis as Markdown

        return safe_markdown(docx_io.import_docx(path).markdown) or None
    except Exception as exc:        # noqa: BLE001 - a Word file it cannot read (only pictures, damaged): the page keeps the drawn view
        logger.warning("attestation view: a Word file could not be read as text: %s", exc)
        return None


def word_text(path: str) -> Optional[str]:
    """The text of a Word file as Markdown that reflows (a phone cannot read an A4 page shrunk to its width), None when there is none."""
    return _word_text(path, os.path.getmtime(path))


def draw_page(path: str, number: int) -> Optional[bytes]:
    """PNG of page ``number`` (1-based) of a PDF, None when there is no such page or it cannot be drawn. Kept for a while: a page is asked for again."""
    info = pdf_info(path)
    if info is None or not 1 <= number <= min(info["total"], MAX_PAGES):
        return None
    try:
        return _draw(path, os.path.getmtime(path), number)
    except Exception as exc:        # noqa: BLE001
        logger.warning("attestation view: page %s of a PDF could not be drawn: %s", number, exc)
        return None


def served_file(src: Any) -> Optional[Tuple[str, str, str, str]]:
    """(kind, path, name, media type) of the file the page may fetch - a PDF or a Word file - else None."""
    kind = file_kind(src)
    if not _has_file(src):
        return None
    if kind == "pdf" and pdf_info(src.file_path):
        return kind, src.file_path, src.file_name or "document.pdf", "application/pdf"
    if kind == "docx" and _is_docx(src.file_path):
        return kind, src.file_path, src.file_name or "document.docx", DOCX_MEDIA
    return None


# ── markdown ─────────────────────────────────────────────────────────────────
_DATA_IMAGE = re.compile(r"^data:image/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$", re.I)
_MD_IMAGE = re.compile(r"!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+(?:\"[^\"]*\"|'[^']*'))?\s*\)")
_MD_IMAGE_REF = re.compile(r"!\[([^\]]*)\]\[[^\]]*\]")
_MD_LINK = re.compile(r"(?<!!)\[([^\]]*)\]\(\s*<?((?:[^()<>\s]|\([^)]*\))*)>?(?:\s+(?:\"[^\"]*\"|'[^']*'))?\s*\)")      # an address may hold one level of ( )
_HTML_IMG = re.compile(r"<img\b[^>]*>", re.I)
_HTML_ACTIVE = re.compile(r"<(script|style|iframe|object|embed|svg|math|form|link|meta|base)\b.*?(?:</\1\s*>|$)", re.I | re.S)


def safe_markdown(md: str) -> str:
    """Markdown for a reader who is not signed in: a picture that is not carried inside the text (a remote address, which would tell
    its owner who read the document and when) is replaced by its description; so is any raw image or active element."""
    md = md.replace("\r\n", "\n")
    md = _HTML_ACTIVE.sub("", md)
    md = _HTML_IMG.sub("", md)
    md = _MD_IMAGE_REF.sub(lambda m: m.group(1), md)
    md = _MD_IMAGE.sub(lambda m: m.group(0) if _DATA_IMAGE.match(m.group(2)) else m.group(1), md)
    return _MD_LINK.sub(lambda m: m.group(0) if _SAFE_LINK.match(_squash(m.group(2))) else m.group(1), md)       # a link to anything but the web, e-mail or phone is its words


_MARKDOWN_SHAPE = re.compile(r"^#{1,6}\s|^\*\*|^-\s|^\d+\.\s", re.M)     # the document viewer's own test (_DocumentViewer.tsx)
_HTML_SHAPE = re.compile(r"^\s*<(?:!doctype|html|body|h[1-6]|p|div|table|ul|ol|section|article|blockquote)\b", re.I)


# ── html ─────────────────────────────────────────────────────────────────────
_DROP_WITH_CONTENT = {
    "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "svg", "math", "form", "input", "button", "select",
    "option", "textarea", "link", "meta", "base", "template", "noscript", "audio", "video", "source", "track", "canvas", "head",
    "title", "xmp", "plaintext", "dialog", "portal", "marquee",
}
_ALLOWED_TAGS = {
    "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "div", "span", "section", "article", "blockquote", "pre", "code",
    "ul", "ol", "li", "dl", "dt", "dd", "strong", "b", "em", "i", "u", "s", "strike", "del", "ins", "sub", "sup", "small", "mark",
    "table", "caption", "colgroup", "col", "thead", "tbody", "tfoot", "tr", "th", "td", "a", "img", "figure", "figcaption",
}
_ALLOWED_ATTRS = {
    "a": {"href", "title"}, "img": {"src", "alt", "title", "width", "height"}, "td": {"colspan", "rowspan"},
    "th": {"colspan", "rowspan", "scope"}, "ol": {"start"}, "col": {"span"},
}
_SAFE_LINK = re.compile(r"^(?:https?:|mailto:|tel:)", re.I)
def _squash(value: str) -> str:
    """``value`` without control characters, spaces and invisible format characters: a browser ignores them inside a scheme
    ("java<tab>script:"), so they are taken out before the scheme is looked at."""
    return "".join(ch for ch in value if unicodedata.category(ch)[0] not in "CZ")
_STYLE_OK = {          # the little of a style that is layout; no colour, no position, no url(), no size that could cover the page
    "text-align": re.compile(r"^(?:left|right|center|justify)$"),
    "font-weight": re.compile(r"^(?:normal|bold|[1-9]00)$"),
    "font-style": re.compile(r"^(?:normal|italic)$"),
    "text-decoration": re.compile(r"^(?:none|underline|line-through)$"),
    "margin-left": re.compile(r"^\d{1,3}(?:\.\d+)?(?:px|pt|em|rem|%)$"),
    "padding-left": re.compile(r"^\d{1,3}(?:\.\d+)?(?:px|pt|em|rem|%)$"),
}
_INT = re.compile(r"^\d{1,4}$")


def _clean_style(value: str) -> str:
    out = []
    for decl in (value or "").split(";"):
        name, _, val = decl.partition(":")
        name, val = name.strip().lower(), val.strip().lower()
        rule = _STYLE_OK.get(name)
        if rule is not None and rule.match(val):
            out.append(f"{name}: {val}")
    return "; ".join(out)


def _clean_attrs(tag) -> bool:
    """Keep only the attributes an allowed tag may carry, with values that are safe. False: the tag cannot stay (an image with no safe source)."""
    allowed = _ALLOWED_ATTRS.get(tag.name, set())
    kept: Dict[str, Any] = {}
    for key, raw in list(tag.attrs.items()):
        key = key.lower()
        value = " ".join(raw) if isinstance(raw, list) else str(raw)
        if key == "style":
            style = _clean_style(value)
            if style:
                kept["style"] = style
        elif key not in allowed:
            continue
        elif key == "href":
            link = _squash(value)
            if _SAFE_LINK.match(link):
                kept["href"] = link
        elif key == "src":
            src = _squash(value)
            if _DATA_IMAGE.match(src):
                kept["src"] = src
        elif key in ("colspan", "rowspan", "span", "start", "width", "height"):
            if _INT.match(value.strip()):
                kept[key] = value.strip()
        elif key == "scope":
            if value.strip().lower() in ("row", "col", "rowgroup", "colgroup"):
                kept[key] = value.strip().lower()
        else:                                                                   # title, alt
            kept[key] = value[:500]
    tag.attrs = kept
    if tag.name == "img" and "src" not in kept:
        return False
    if tag.name == "a" and "href" in kept:
        tag.attrs.update({"rel": "noopener noreferrer nofollow", "target": "_blank"})
    return True


def sanitize_html(raw: Optional[str]) -> str:
    """HTML for a reader who is not signed in: only the tags of a document (headings, paragraphs, lists, tables, emphasis, links, pictures
    carried inside the text), only the attributes they need, and nothing that runs, loads or reaches out. Anything else is removed - an
    unknown tag keeps its text - never escaped into view."""
    soup = BeautifulSoup(raw or "", "html.parser")
    for node in soup.find_all(string=True):
        if isinstance(node, (Comment, Doctype, ProcessingInstruction, Declaration, CData)):
            node.extract()
    for tag in list(soup.find_all(True)):
        if getattr(tag, "decomposed", False):
            continue
        name = (tag.name or "").lower()
        if name in _DROP_WITH_CONTENT:
            tag.decompose()
        elif name not in _ALLOWED_TAGS:
            tag.unwrap()
        elif not _clean_attrs(tag):
            tag.decompose()
    return str(soup)


# ── the answer ───────────────────────────────────────────────────────────────
def describe(doc: Any, row: Any = None, *, base: str = "") -> Dict[str, Any]:
    """What the public page gets about the document: the title block and how to draw it. ``row`` is the version in force when it is not
    the document itself (a row has no description or type, those stay the document's); ``base`` is the path of the token's routes."""
    src = row or doc
    version = row.version_number if row is not None else doc.current_version
    out: Dict[str, Any] = {
        "title": doc.title, "description": doc.description, "version": version, "doc_type": doc.doc_type,
        "has_file": bool(src.file_path), "file_name": src.file_name,
        "kind": "none", "markdown": None, "html": None, "content": None, "file": None, "pages": None, "text_url": None,
    }
    tag = f"?v={version}" if version else ""
    served = served_file(src)
    if served is not None:
        kind, path, _name, _media = served
        out["kind"] = "pdf" if kind == "pdf" else "word"
        out["file"] = {"kind": kind, "url": f"{base}/file{tag}"}
        if kind == "docx":
            out["text_url"] = f"{base}/text{tag}"
        if kind == "pdf":
            info = pdf_info(path) or {"total": 1, "ratio": 1.414}
            shown = min(info["total"], MAX_PAGES)
            out["pages"] = {"count": shown, "total": info["total"], "ratio": info["ratio"], "url": f"{base}/pages/{{page}}{tag}"}
        return out

    ftype = file_kind(src) if _has_file(src) else ""
    text = src.content or ""
    if ftype in ("md", "txt"):
        try:
            with open(src.file_path, "r", encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except Exception as exc:        # noqa: BLE001 - unreadable: the stored text, if any, is shown
            logger.warning("attestation view: a text file could not be read: %s", exc)
    if not text.strip():
        return out
    text = text.replace("\r\n", "\n")
    if ftype == "txt" or not (ftype == "md" or _HTML_SHAPE.match(text) or _MARKDOWN_SHAPE.search(text)):
        out["kind"], out["content"] = "text", text
    elif ftype != "md" and _HTML_SHAPE.match(text):
        out["kind"], out["html"] = "html", sanitize_html(text)
    else:
        out["kind"], out["markdown"] = "markdown", safe_markdown(text)
    return out
