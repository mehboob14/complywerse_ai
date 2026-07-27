"""Charter text → structured sections.

Turns the plain text extracted from an uploaded charter document (PDF /
DOCX / TXT) into the same shape the AI-generate flow produces:

    [{"title": str, "content": str, "framework_references": [str, ...]}]

Strategy: heuristic-only, no LLM call. Charters follow predictable
heading conventions (numbered sections, ALL CAPS, Markdown `#`, etc.),
and a deterministic parser is faster, cheaper, and keeps the upload path
working in environments without an OpenAI key. The AI-generate flow is
still available for "draft me a charter from scratch" — this parser is
only for "I already have one, just chunk it".

Heading detection — a line counts as a heading if any of:
  * starts with `#` / `##` / `###` (markdown)
  * starts with a number-prefix like "1.", "1.1.", "2)" or "(1)"
  * is short (<=80 chars) AND in TITLE CASE OR ALL CAPS AND followed by
    a non-empty line
  * matches a known section keyword: "Purpose", "Scope", "Authority",
    "Responsibilities", "Membership", "Meetings", "Quorum", "Decisions",
    "Reporting", "Conflicts of Interest", "Confidentiality",
    "Review", "Amendments", etc.

Failure mode: text with no detectable headings becomes a single section
named "Charter" with the whole content. That's still useful — the UI
renders it in the AI-style panel.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Canonical section names — when the parser detects a heading line that
# loosely matches one of these (case-insensitive, allowing punctuation /
# numeric prefix), we normalize the section's title. Keeps the rendered
# panel consistent regardless of how the source document worded things.
_CANONICAL_SECTIONS = [
    "Purpose",
    "Mission",
    "Scope",
    "Authority",
    "Responsibilities",
    "Duties",
    "Membership",
    "Composition",
    "Meetings",
    "Frequency",
    "Quorum",
    "Decisions",
    "Voting",
    "Reporting",
    "Conflicts of Interest",
    "Confidentiality",
    "Records",
    "Performance",
    "Review",
    "Amendments",
    "Approval",
]

_MARKDOWN_HEADING_RE = re.compile(r"^(#{1,4})\s+(.+?)\s*$")
_NUMBERED_HEADING_RE = re.compile(
    r"^\s*(?:\(?\d+(?:\.\d+)*[.)]?\s+)(.+?)\s*$"
)
# Match a line that's 3-80 chars AND made of TITLE CASE words OR ALL CAPS.
_SHORT_LINE_RE = re.compile(r"^.{3,80}$")


def _looks_like_heading(line: str, next_line: Optional[str]) -> Optional[str]:
    """Return the heading text if `line` looks like one, else None."""
    if not line:
        return None
    stripped = line.strip()
    if not stripped:
        return None

    # 1. Markdown `# Heading`.
    m = _MARKDOWN_HEADING_RE.match(stripped)
    if m:
        return m.group(2).strip()

    # 2. Numbered prefix like "1.", "1.1.", "2)" — but only when the rest
    #    is plausibly title-ish (not a sentence ending in a period).
    m = _NUMBERED_HEADING_RE.match(stripped)
    if m and len(stripped) < 100 and not stripped.endswith("."):
        return m.group(1).strip()

    # 3. Canonical section keyword match (e.g. "Purpose" or "1. Purpose").
    cleaned = re.sub(r"^[\s\d.)(\-]+", "", stripped).rstrip(":")
    for canon in _CANONICAL_SECTIONS:
        if cleaned.lower() == canon.lower():
            return canon

    # 4. Short ALL CAPS line followed by content → likely a heading.
    if (
        stripped == stripped.upper()
        and stripped != stripped.lower()
        and _SHORT_LINE_RE.match(stripped)
        and next_line is not None
        and next_line.strip()
        and not next_line.strip().isupper()
    ):
        return stripped.title()

    return None


def parse_charter_sections(text: str) -> List[Dict[str, Any]]:
    """Split `text` into sections by detected headings.

    Returns `[{title, content, framework_references}]`. Empty sections
    (heading with no body before the next heading) are dropped. If no
    headings are found, the whole text becomes one section titled
    "Charter".
    """
    if not text or not text.strip():
        return []

    lines = text.replace("\r\n", "\n").split("\n")
    sections: List[Dict[str, Any]] = []
    current_title: Optional[str] = None
    current_body: List[str] = []

    def _flush() -> None:
        nonlocal current_title, current_body
        body = "\n".join(current_body).strip()
        if current_title is None and not body:
            current_title = None
            current_body = []
            return
        sections.append({
            "title": (current_title or "Preamble").strip(),
            "content": body,
            "framework_references": [],
        })
        current_title = None
        current_body = []

    for i, raw in enumerate(lines):
        next_line = lines[i + 1] if i + 1 < len(lines) else None
        heading = _looks_like_heading(raw, next_line)
        if heading is not None and (current_title is not None or "".join(current_body).strip()):
            # Hit a new heading — close out the in-progress section.
            _flush()
            current_title = heading
            continue
        if heading is not None:
            # First heading in the document — promote it.
            current_title = heading
            continue
        current_body.append(raw)

    _flush()

    # Filter degenerate sections (no body).
    sections = [s for s in sections if s["content"].strip()]

    # Fallback: nothing detected → one big section.
    if not sections:
        sections = [{
            "title": "Charter",
            "content": text.strip(),
            "framework_references": [],
        }]

    return sections


def parser_result_envelope(
    *,
    committee_id: int,
    committee_name: str,
    committee_type: Optional[str],
    title: str,
    sections: List[Dict[str, Any]],
    summary: Optional[str] = None,
) -> Dict[str, Any]:
    """Wrap a parsed charter in the same envelope the AI-generate
    endpoint returns. The frontend's AICharterResult-aware panel reads
    `charter.charter_title` + `charter.sections`, so this lets the
    uploaded charter render through the same component."""
    return {
        "committee_id": committee_id,
        "committee_name": committee_name,
        "committee_type": committee_type or "committee",
        "frameworks_analyzed": [],
        "controls_analyzed": 0,
        "charter": {
            "charter_title": title,
            "sections": sections,
            "summary": summary or "",
        },
    }
