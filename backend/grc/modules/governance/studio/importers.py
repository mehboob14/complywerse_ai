"""Turning an uploaded file into the studio's Markdown.

``import_file`` gives ``Imported(markdown, kind, notes)``. Markdown, text and HTML are converted here; Word and PDF files
are converted by ``docx_io`` and ``pdf_io`` (a Word file keeps a map from its blocks to the file so edits can be written back
into it). Whatever the format, a block of the result is something ``blocks.parse`` reads back as the same kind of block, and
text is escaped so nothing in it is taken for formatting by accident.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from bs4 import BeautifulSoup, NavigableString

from .blocks import escape_inline, table_markdown

ALLOWED_EXTENSIONS = (".docx", ".pdf", ".txt", ".md", ".markdown", ".html", ".htm")


@dataclass
class Imported:
    markdown: str
    kind: str                                      # docx | pdf | text | md | html
    notes: List[str] = field(default_factory=list)
    base_markdown: Optional[str] = None            # when the file carries tracked changes: the text before them
    native: Optional[Dict[str, Any]] = None        # for a Word file: what is needed to write edits back into it


class ImportProblem(ValueError):
    """The file cannot be used; the message is for the person."""


def decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-16", "cp1252", "latin-1"):
        try:
            return data.decode(enc)
        except (UnicodeDecodeError, UnicodeError):
            continue
    return data.decode("utf-8", errors="replace")


# ── plain text ───────────────────────────────────────────────────────────────
_LIST = re.compile(r"^\s*(?:[-*•–]|\d+[.)]|[a-z][.)])\s+(.*)$")


def text_to_markdown(text: str, *, unwrap: bool = False) -> str:
    """Plain text as Markdown: paragraphs split on blank lines, bullet and numbered lines kept as lists, everything else
    escaped. ``unwrap`` joins lines a page broke in the middle of a sentence (text taken from a PDF)."""
    blocks: List[str] = []
    for chunk in re.split(r"\n\s*\n", (text or "").replace("\r\n", "\n").replace("\r", "\n")):
        lines = [ln.rstrip() for ln in chunk.split("\n") if ln.strip()]
        if not lines:
            continue
        if all(_LIST.match(ln) for ln in lines):
            items = []
            for ln in lines:
                numbered = re.match(r"^\s*(\d+)[.)]\s+", ln)
                body = escape_inline(_LIST.match(ln).group(1).strip())
                items.append(f"{numbered.group(1)}. {body}" if numbered else f"- {body}")
            blocks.append("\n".join(items))
            continue
        if unwrap:
            paras: List[str] = []
            for ln in lines:
                s = ln.strip()
                if paras and not re.search(r"[.:;!?]$", paras[-1]) and not _LIST.match(s):      # the page broke the line mid-sentence
                    paras[-1] += " " + s
                else:
                    paras.append(s)
        else:
            paras = [" ".join(x.strip() for x in lines)]
        blocks += [escape_inline(p) for p in paras]
    return "\n\n".join(b for b in blocks if b.strip()) + ("\n" if blocks else "")


# ── html ─────────────────────────────────────────────────────────────────────
_BLOCKS = {"h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "table", "blockquote", "pre", "hr", "div", "section", "article", "body"}


def _inline(node) -> str:
    out: List[str] = []
    for child in node.children:
        if isinstance(child, NavigableString):
            out.append(escape_inline(re.sub(r"\s+", " ", str(child))))
            continue
        name = child.name
        inner = _inline(child)
        if name in ("strong", "b") and inner.strip():
            out.append(f"**{inner.strip()}**")
        elif name in ("em", "i") and inner.strip():
            out.append(f"*{inner.strip()}*")
        elif name == "u" and inner.strip():
            out.append(f"<u>{inner.strip()}</u>")
        elif name in ("s", "del", "strike") and inner.strip():
            out.append(f"~~{inner.strip()}~~")
        elif name == "code" and inner.strip():
            out.append(f"`{child.get_text()}`")
        elif name == "a" and child.get("href") and inner.strip():
            out.append(f"[{inner.strip()}]({child['href']})")
        elif name == "br":
            out.append("\\\n")
        elif name in ("script", "style", "head", "title"):
            continue
        else:
            out.append(inner)
    return "".join(out)


def _html_blocks(node, out: List[str], depth: int = 0) -> None:
    for child in node.children:
        if isinstance(child, NavigableString):
            if str(child).strip():
                out.append(escape_inline(re.sub(r"\s+", " ", str(child)).strip()))
            continue
        name = child.name
        if name in ("script", "style", "head", "title"):
            continue
        if re.fullmatch(r"h[1-6]", name or ""):
            out.append("#" * int(name[1]) + " " + re.sub(r"\s+", " ", _inline(child)).strip())
        elif name == "p":
            text = re.sub(r"[ \t]+", " ", _inline(child)).strip()
            if text:
                out.append(text)
        elif name in ("ul", "ol"):
            out.append("\n".join(_list(child, 0)))
        elif name == "table":
            rows = [[re.sub(r"\s+", " ", cell.get_text(" ")).strip() for cell in tr.find_all(["th", "td"])] for tr in child.find_all("tr")]
            rows = [r for r in rows if r]
            if rows:
                out.append(table_markdown(rows))
        elif name == "blockquote":
            out.append("> " + re.sub(r"\s+", " ", child.get_text(" ")).strip())
        elif name == "pre":
            out.append("```\n" + child.get_text().strip("\n") + "\n```")
        elif name == "hr":
            out.append("---")
        elif name in _BLOCKS or child.find(list(_BLOCKS)):
            _html_blocks(child, out, depth + 1)
        else:
            text = re.sub(r"\s+", " ", _inline(child)).strip()
            if text:
                out.append(text)


def _list(node, depth: int) -> List[str]:
    lines: List[str] = []
    ordered = node.name == "ol"
    for n, li in enumerate(node.find_all("li", recursive=False), start=1):
        parts = [c for c in li.children if getattr(c, "name", None) not in ("ul", "ol")]
        text = "".join(_inline(c) if not isinstance(c, NavigableString) else escape_inline(re.sub(r"\s+", " ", str(c))) for c in parts)
        lines.append("  " * depth + (f"{n}. " if ordered else "- ") + re.sub(r"\s+", " ", text).strip())
        for sub in li.find_all(["ul", "ol"], recursive=False):
            lines += _list(sub, depth + 1)
    return lines


def html_to_markdown(html: str) -> str:
    soup = BeautifulSoup(html or "", "lxml")
    out: List[str] = []
    _html_blocks(soup.body or soup, out)
    return "\n\n".join(b for b in out if b.strip()) + ("\n" if out else "")


# ── files ────────────────────────────────────────────────────────────────────
def import_file(path: str, filename: str, *, twin: bool = False) -> Imported:
    """The studio's Markdown for a file on disk. With ``twin`` a Word file also comes back with what is needed to write edits
    into it (``Imported.native``); a file used only to be read (a reference) does not need that."""
    ext = os.path.splitext(filename or path)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ImportProblem("This file type cannot be opened here. Use Word (.docx), PDF, text, Markdown or HTML.")
    if ext == ".docx":
        from .docx_io import import_docx

        return import_docx(path, twin=twin)
    if ext == ".pdf":
        from .pdf_io import import_pdf

        return import_pdf(path)
    with open(path, "rb") as f:
        raw = decode(f.read())
    if ext in (".md", ".markdown"):
        return Imported(raw if raw.endswith("\n") else raw + "\n", "md")
    if ext in (".html", ".htm"):
        return Imported(html_to_markdown(raw), "html", ["Formatting that Markdown cannot hold (colours, fonts, layout) was dropped."])
    return Imported(text_to_markdown(raw), "text")
