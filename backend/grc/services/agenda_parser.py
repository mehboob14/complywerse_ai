"""Meeting agenda document → structured agenda items.

Takes plain text extracted from an uploaded agenda doc and breaks it
into MeetingAgendaItem-shaped dicts:

    [{
        "title": str,
        "description": str,
        "item_type": "approval" | "discussion" | "information" | "action_review",
        "time_allocated_minutes": int | None,
    }, ...]

Extraction strategy (ordered by which produces the result):

1. **Heuristic** — fast, deterministic. Looks for numbered agenda lines,
   bullet headers, and duration markers like "(15 min)". Works for
   cleanly-templated agendas. Cheap to run, never raises.

2. **Chunked AI extraction** — when the heuristic doesn't produce enough
   items (or the doc is large/unstructured), we send overlapping windows
   of the text to GPT with a strict "extract only what's literally
   present, no inventions" prompt. Results from each window are merged
   and deduplicated by normalized title.

Design rules:
- Never invent agenda items the document didn't mention.
- For large documents, chunk with overlap so items straddling a chunk
  boundary aren't lost.
- Dedupe across chunks so overlapping windows don't produce duplicates.
- Never raise — bad input/network just produces an empty list.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger(__name__)

# Match a duration marker like "(15 min)", "(15 minutes)", "[30m]".
_DURATION_RE = re.compile(
    r"\(\s*(\d+)\s*(?:min(?:utes?)?|m)\s*\)|\[\s*(\d+)\s*m(?:in)?\s*\]",
    re.IGNORECASE,
)

# Lines starting with a number/letter agenda marker.
_AGENDA_LINE_RE = re.compile(
    r"^\s*(?:\(?\d+(?:\.\d+)*[.)]?|[a-z][.)]\s)\s*(.+)",
    re.IGNORECASE,
)

# item_type hints — keyword presence in title or description.
_TYPE_KEYWORDS = {
    "approval": ["approve", "approval", "approving", "ratify", "ratification"],
    "action_review": ["action review", "follow-up", "follow up", "action items", "open actions"],
    "information": ["information", "briefing", "update", "report from"],
    "discussion": ["discuss", "discussion", "review", "evaluate", "consider"],
}

_VALID_TYPES = {"approval", "discussion", "information", "action_review"}

# Chunk sizing for the AI path. GPT-4o-mini has a large context window,
# but smaller chunks (a) give the model less to confuse, (b) cost less,
# and (c) keep latency predictable. Overlap covers items straddling a
# chunk boundary.
_AI_CHUNK_CHARS = 6000
_AI_CHUNK_OVERLAP = 600
_AI_MAX_CHUNKS = 12  # safety cap — at 6k chars/chunk this is ~72k chars total


def _detect_item_type(text: str) -> str:
    if not text:
        return "discussion"
    low = text.lower()
    for itype, kws in _TYPE_KEYWORDS.items():
        if any(k in low for k in kws):
            return itype
    return "discussion"


def _detect_duration(text: str) -> Optional[int]:
    m = _DURATION_RE.search(text)
    if not m:
        return None
    val = m.group(1) or m.group(2)
    try:
        return max(1, min(480, int(val)))
    except Exception:
        return None


def _heuristic_parse(text: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    current_title: Optional[str] = None
    current_body: List[str] = []

    def _flush():
        nonlocal current_title, current_body
        if current_title is None:
            return
        title = current_title.strip()
        body = "\n".join(current_body).strip()
        if not title:
            current_title = None
            current_body = []
            return
        combined = f"{title}\n{body}"
        items.append({
            "title": title[:500],
            "description": body[:2000] or None,
            "item_type": _detect_item_type(combined),
            "time_allocated_minutes": _detect_duration(combined),
        })
        current_title = None
        current_body = []

    for raw in text.replace("\r\n", "\n").split("\n"):
        stripped = raw.strip()
        if not stripped:
            current_body.append("")
            continue
        m = _AGENDA_LINE_RE.match(stripped)
        if m:
            _flush()
            current_title = m.group(1).strip()
        elif current_title is not None:
            current_body.append(stripped)
    _flush()
    return items


def _chunk_text(text: str, chunk_size: int, overlap: int) -> List[str]:
    """Split text into overlapping windows. Prefers splitting at newlines
    so we don't slice mid-sentence — but falls back to a hard slice if no
    newline is reachable within the chunk."""
    if len(text) <= chunk_size:
        return [text]

    chunks: List[str] = []
    pos = 0
    n = len(text)
    while pos < n:
        end = min(pos + chunk_size, n)
        if end < n:
            # Try to back off to the nearest newline within the last 20%
            # of the chunk, so we don't cut mid-line.
            search_from = max(end - chunk_size // 5, pos + 1)
            nl = text.rfind("\n", search_from, end)
            if nl > 0:
                end = nl
        chunks.append(text[pos:end])
        if end >= n:
            break
        pos = max(end - overlap, pos + 1)
        if len(chunks) >= _AI_MAX_CHUNKS:
            logger.warning(
                "agenda_parser: hit max chunk cap (%d) at pos %d/%d — remaining text skipped",
                _AI_MAX_CHUNKS, pos, n,
            )
            break
    return chunks


def _normalize_title_for_dedup(title: str) -> str:
    """Collapse whitespace, strip leading numbering, lowercase. Used as a
    dedup key when merging items from overlapping AI chunks."""
    t = title.lower().strip()
    t = re.sub(r"^\s*\(?\d+(?:\.\d+)*[.)]?\s*", "", t)
    t = re.sub(r"^\s*[a-z][.)]\s*", "", t)
    t = re.sub(r"\s+", " ", t)
    return t[:120]


def _coerce_ai_item(entry: Any) -> Optional[Dict[str, Any]]:
    """Validate one AI-returned record. Returns None if unusable."""
    if not isinstance(entry, dict):
        return None
    title = (entry.get("title") or "").strip()
    if not title:
        return None
    item_type = (entry.get("item_type") or "").strip().lower()
    if item_type not in _VALID_TYPES:
        item_type = _detect_item_type(title + " " + str(entry.get("description") or ""))
    duration = entry.get("time_allocated_minutes")
    if not isinstance(duration, int) or duration <= 0 or duration > 480:
        duration = None
    description = entry.get("description")
    if description is not None and not isinstance(description, str):
        description = None
    if description:
        description = description.strip()[:2000] or None
    return {
        "title": title[:500],
        "description": description,
        "item_type": item_type,
        "time_allocated_minutes": duration,
    }


def _ai_extract_chunk(text: str, chunk_index: int, total_chunks: int) -> List[Dict[str, Any]]:
    """Run one AI extraction pass against a single chunk. Returns []
    on any failure — never raises."""
    api_key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if not api_key:
        return []

    try:
        from openai import OpenAI  # type: ignore
    except Exception:
        logger.info("agenda_parser: openai SDK not available")
        return []

    multi_chunk_note = ""
    if total_chunks > 1:
        multi_chunk_note = (
            f" This is part {chunk_index + 1} of {total_chunks} from a larger "
            "document; extract only items present in this part. Items may "
            "be partially cut off at the boundaries — if a title is "
            "clearly truncated mid-word, skip it (the adjacent chunk will "
            "catch it)."
        )

    prompt = (
        "Extract the agenda items from this meeting document text. "
        "Return ONLY a JSON array (no prose, no code fences). Each item "
        "must have: title (string, ≤120 chars, verbatim from the "
        "document — do not paraphrase or invent), description (string "
        "with sub-bullets/notes about the item, or null), item_type "
        "(one of: approval, discussion, information, action_review), "
        "time_allocated_minutes (integer or null — only if the document "
        "explicitly states a duration).\n\n"
        "Rules:\n"
        "- Extract every agenda item the document mentions, in document "
        "order.\n"
        "- Do NOT invent items. Do NOT include filler text like "
        "'welcome', 'introductions', 'closing remarks' UNLESS they appear "
        "as numbered/bulleted agenda items.\n"
        "- Do NOT include meeting metadata (date, attendees, venue, "
        "title page) as agenda items.\n"
        "- A heading like 'New Business' is a section, not an item; only "
        "include items listed underneath it.\n"
        "- If the document has no agenda items at all, return [].\n"
        f"{multi_chunk_note}\n\n"
        "Document text:\n\n" + text
    )

    try:
        client = OpenAI(api_key=api_key)
        resp = client.chat.completions.create(
            model=os.environ.get("OPENAI_AGENDA_MODEL", "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": "Return ONLY valid JSON. No commentary, no code fences."},
                {"role": "user", "content": prompt},
            ],
            temperature=0,
            response_format={"type": "json_object"},
        )
        raw = (resp.choices[0].message.content or "").strip()
    except Exception:
        # response_format=json_object forces the model to return an
        # object — if our prompt asked for a bare array it'll wrap as
        # {"items": [...]} (or similar). We unwrap below. Fall back to
        # the no-format call on any 400.
        try:
            client = OpenAI(api_key=api_key)
            resp = client.chat.completions.create(
                model=os.environ.get("OPENAI_AGENDA_MODEL", "gpt-4o-mini"),
                messages=[
                    {"role": "system", "content": "Return ONLY valid JSON. No commentary, no code fences."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0,
            )
            raw = (resp.choices[0].message.content or "").strip()
        except Exception:
            logger.exception("agenda_parser: AI call failed for chunk %d", chunk_index)
            return []

    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.IGNORECASE).strip()

    try:
        parsed = json.loads(raw)
    except Exception:
        logger.info("agenda_parser: AI returned non-JSON for chunk %d", chunk_index)
        return []

    # Accept either a bare array or the common {"items": [...]} wrapper
    # that response_format=json_object forces.
    if isinstance(parsed, dict):
        for key in ("items", "agenda_items", "agenda", "data"):
            v = parsed.get(key)
            if isinstance(v, list):
                parsed = v
                break
        else:
            parsed = []
    if not isinstance(parsed, list):
        return []

    out: List[Dict[str, Any]] = []
    for entry in parsed:
        coerced = _coerce_ai_item(entry)
        if coerced is not None:
            out.append(coerced)
    return out


def _ai_parse_chunked(text: str) -> List[Dict[str, Any]]:
    """AI extraction that chunks long documents and dedupes results."""
    chunks = _chunk_text(text, _AI_CHUNK_CHARS, _AI_CHUNK_OVERLAP)
    if not chunks:
        return []

    seen: Set[str] = set()
    merged: List[Dict[str, Any]] = []
    for i, chunk in enumerate(chunks):
        items = _ai_extract_chunk(chunk, i, len(chunks))
        for it in items:
            key = _normalize_title_for_dedup(it["title"])
            if not key or key in seen:
                continue
            seen.add(key)
            merged.append(it)
    return merged


def parse_agenda_items(text: str, *, use_ai_fallback: bool = True) -> List[Dict[str, Any]]:
    """Top-level parser.

    Path selection:
    - Empty/blank → []
    - Otherwise run the heuristic first (fast, free).
    - If the heuristic produced ≥3 items AND the doc is short, use those.
      Structured short docs almost never benefit from AI re-parsing.
    - Otherwise run chunked AI extraction. If AI returns items, prefer
      AI output (it handles unstructured prose the heuristic misses).
    - If AI is unavailable / returns nothing, fall back to whatever the
      heuristic found (which may be []).
    """
    if not text or not text.strip():
        return []

    heuristic_items = _heuristic_parse(text)

    # Trust the heuristic for short, cleanly-numbered agendas.
    short_doc = len(text) <= _AI_CHUNK_CHARS
    if short_doc and len(heuristic_items) >= 3:
        return heuristic_items

    if not use_ai_fallback:
        return heuristic_items

    ai_items = _ai_parse_chunked(text)
    if ai_items:
        return ai_items

    return heuristic_items
