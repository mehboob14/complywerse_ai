"""Checks that need no AI: formatting rules, the structure a document type must have, placeholders that must be filled,
the entity name and the logo. The AI checks (spelling, grammar, wording, requirements) add to these in ``engine.py``.

Every issue is a dict: ``{id, kind, rule, severity, block, quote, message, suggestion, fix}``. ``block`` is the 0-based block
index (None for the whole document). ``fix`` is something ``apply_fix`` can do to the Markdown with no AI, or None.
``kind`` is one of format, structure, placeholder, entity, logo (here) and spelling, grammar, style, consistency, requirement (AI).
"""
from __future__ import annotations

import re
from collections import Counter
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Sequence

from . import blocks as B
from .templates import is_annex, key_of

SEVERITY_ORDER = {"error": 0, "warning": 1, "info": 2}

# ── placeholders ─────────────────────────────────────────────────────────────
_PLACEHOLDERS = [
    ("ai", True, re.compile(r"\[\[[^\[\]]{1,200}\]\]")),
    ("prompt", True, re.compile(r"\[(?:Insert|Enter|Add|Specify|Select|Provide|State|Describe|Name of|Date|Organi[sz]ation|Company|Entity|Title|Owner|Department|Version|TBD|TBC|Click|Your)[^\[\]]{0,150}\]", re.I)),
    ("angle", True, re.compile(r"<<[^<>]{1,150}>>")),
    ("curly", True, re.compile(r"\{\{[^{}]{1,150}\}\}")),
    ("tbd", True, re.compile(r"\b(?:TBD|TBC)\b|\bX{3,}\b|\bXX/XX/(?:XX)?XX\b|\b(?:DD/MM/YYYY|dd/mm/yyyy)\b|\blorem ipsum\b", re.I)),
    ("blank", False, re.compile(r"_{4,}")),
]


def find_placeholders(text: str) -> List[Dict[str, Any]]:
    """``[{text, kind, required, start, end}]`` for every placeholder in a text. A signature line (a run of underscores) is
    not required: it is filled when the document is signed."""
    found: List[Dict[str, Any]] = []
    taken: List[tuple] = []
    for kind, required, rx in _PLACEHOLDERS:
        for m in rx.finditer(text or ""):
            if any(m.start() < e and s < m.end() for s, e in taken):
                continue
            taken.append((m.start(), m.end()))
            found.append({"text": m.group(0), "kind": kind, "required": required, "start": m.start(), "end": m.end()})
    return sorted(found, key=lambda p: p["start"])


def placeholders(blocks: Sequence[B.Block]) -> List[Dict[str, Any]]:
    out = []
    for i, b in enumerate(blocks):
        for p in find_placeholders(b.text if b.kind != "table" else "\n".join(c.text for r in b.rows for c in r)):
            out.append({**p, "block": i})
    return out


# ── helpers ──────────────────────────────────────────────────────────────────
def _issue(kind: str, rule: str, severity: str, message: str, *, block: Optional[int] = None, quote: str = "",
           suggestion: Optional[str] = None, fix: Optional[Dict[str, Any]] = None, n: int = 0) -> Dict[str, Any]:
    return {"id": f"{rule}:{block if block is not None else 'doc'}:{n}", "kind": kind, "rule": rule, "severity": severity, "block": block,
            "quote": quote, "message": message, "suggestion": suggestion, "fix": fix}


def _prose(b: B.Block) -> bool:
    return b.kind in ("paragraph", "list_item", "quote")


def _replace_fix(block: int, find: str, replace: str, occurrence: int = 0) -> Dict[str, Any]:
    return {"type": "replace", "block": block, "find": find, "replace": replace, "occurrence": occurrence}


# ── formatting rules ─────────────────────────────────────────────────────────
_NUM = re.compile(r"^\s*(\d+(?:\.\d+)*)[.)]?\s+\S")
_SIMPLE_US_UK = [("organization", "organisation"), ("organize", "organise"), ("authorize", "authorise"), ("authorization", "authorisation"),
                 ("behavior", "behaviour"), ("center", "centre"), ("color", "colour"), ("defense", "defence"), ("analyze", "analyse"),
                 ("catalog", "catalogue"), ("fulfill", "fulfil"), ("judgment", "judgement"), ("favor", "favour"),
                 ("honor", "honour"), ("labor", "labour"), ("neighbor", "neighbour"), ("recognize", "recognise"), ("minimize", "minimise"),
                 ("maximize", "maximise"), ("prioritize", "prioritise"), ("utilize", "utilise"), ("summarize", "summarise"),
                 ("standardize", "standardise"), ("customize", "customise"), ("categorize", "categorise"), ("synchronize", "synchronise"),
                 ("emphasize", "emphasise"), ("optimize", "optimise"), ("centralize", "centralise"), ("artifact", "artefact")]
_MONTHS = r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
_DATES = {"dd/mm/yyyy": re.compile(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b"), "yyyy-mm-dd": re.compile(r"\b\d{4}-\d{2}-\d{2}\b"),
          "d Month yyyy": re.compile(rf"\b\d{{1,2}}(?:st|nd|rd|th)?\s+{_MONTHS}\.?,?\s+\d{{4}}\b"),
          "Month d, yyyy": re.compile(rf"\b{_MONTHS}\.?\s+\d{{1,2}}(?:st|nd|rd|th)?,?\s+\d{{4}}\b")}
_NORMATIVE = re.compile(r"\b(shall|must|should|may|will|required|prohibited|is responsible|are responsible)\b", re.I)
_REQUIREMENT_SECTIONS = {"policy statements", "mandatory requirements", "procedure steps", "guiding principles"}


def _headings(blocks: Sequence[B.Block]):
    return [(i, b) for i, b in enumerate(blocks) if b.kind == "heading"]


def heading_issues(blocks: Sequence[B.Block]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    heads = _headings(blocks)
    h1 = [i for i, b in heads if b.level == 1]
    for n, i in enumerate(h1[1:], start=1):
        out.append(_issue("format", "multiple_titles", "warning", "A document has one title (a level 1 heading); this should be a section.",
                          block=i, quote=blocks[i].text, fix={"type": "set_level", "block": i, "level": 2}, n=n))
    prev = 0
    seen: Dict[tuple, int] = {}
    for i, b in heads:
        if prev and b.level > prev + 1:
            out.append(_issue("format", "heading_skip", "warning", f"The heading jumps from level {prev} to level {b.level}.",
                              block=i, quote=b.text, suggestion=f"Use level {prev + 1}.", fix={"type": "set_level", "block": i, "level": prev + 1}))
        prev = b.level
        if not b.text.strip():
            out.append(_issue("format", "heading_empty", "error", "This heading has no text.", block=i))
        elif re.search(r"[:.;,]\s*$", b.text) and not re.fullmatch(r"\s*\d+(?:\.\d+)*\.?\s*", b.text):
            out.append(_issue("format", "heading_punctuation", "info", "A heading does not end with punctuation.", block=i, quote=b.text,
                              suggestion=re.sub(r"[:.;,]\s*$", "", b.text), fix={"type": "strip_trailing_punct", "block": i}))
        key = (b.level, key_of(b.text))
        if key[1] and key in seen:
            out.append(_issue("format", "heading_duplicate", "warning", f"There is another heading called \"{b.text}\" at this level.", block=i, quote=b.text))
        seen.setdefault(key, i)
    out += numbering_issues(blocks)
    return out


def numbering_issues(blocks: Sequence[B.Block]) -> List[Dict[str, Any]]:
    """Numbered headings (1., 1.1, 2.) that skip, repeat or run backwards. Each problem is reported once: the numbering
    after it is read from the heading that broke it."""
    counters: List[int] = []
    out: List[Dict[str, Any]] = []
    for i, b in _headings(blocks):
        m = _NUM.match(b.text)
        if not m:
            continue
        parts = [int(x) for x in m.group(1).split(".")]
        depth = len(parts)
        if len(counters) >= depth - 1:
            expected = counters[:depth - 1] + [counters[depth - 1] + 1 if len(counters) >= depth else 1]
            if parts != expected:
                out.append(_issue("format", "heading_numbering", "warning",
                                  f"The numbering goes {'.'.join(map(str, parts))} where {'.'.join(map(str, expected))} would follow.",
                                  block=i, quote=b.text, suggestion="Renumber the headings.", fix={"type": "renumber"}))
        counters = parts
    return out


def renumber_headings(markdown: str) -> str:
    """Number every numbered heading in order (1., 1.1, 1.2, 2.) and leave the rest as written."""
    blocks = B.parse(markdown)
    counters: List[int] = []
    for b in blocks:
        if b.kind != "heading":
            continue
        m = re.match(r"^(\s*#{1,6}\s+)(\d+(?:\.\d+)*)([.)]?)(\s+)(.*)$", b.source)
        if not m:
            continue
        depth = len(m.group(2).split("."))
        counters = (counters + [0] * depth)[:depth]
        counters[depth - 1] += 1
        counters = counters[:depth]
        b.source = f"{m.group(1)}{'.'.join(map(str, counters))}{m.group(3)}{m.group(4)}{m.group(5)}"
    return B.render(blocks)


def text_issues(blocks: Sequence[B.Block]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for i, b in enumerate(blocks):
        if b.kind in ("code", "hr", "raw", "table"):
            continue
        t = b.text
        if re.search(r"(?<=\S)[ \t]{2,}(?=\S)", t) or "\t" in t:
            out.append(_issue("format", "extra_spaces", "info", "Extra spaces or tabs between words.", block=i, quote=re.search(r"\S+[ \t]{2,}\S+", t).group(0) if re.search(r"\S+[ \t]{2,}\S+", t) else "",
                              fix={"type": "normalize_space", "block": i}))
        m = re.search(r"\b([A-Za-z]{2,})\s+\1\b", t, re.I)
        if m and m.group(1).lower() not in ("had", "that"):
            out.append(_issue("format", "repeated_word", "warning", f"The word \"{m.group(1)}\" is repeated.", block=i, quote=m.group(0),
                              suggestion=m.group(1), fix=_replace_fix(i, m.group(0), m.group(1))))
        m = re.search(r"\w\s+[,.;:](?=\s|$)", t)
        if m:
            out.append(_issue("format", "space_before_punctuation", "info", "A space before punctuation.", block=i, quote=m.group(0),
                              suggestion=re.sub(r"\s+", "", m.group(0)), fix=_replace_fix(i, m.group(0), re.sub(r"\s+", "", m.group(0)))))
        m = re.search(r"[a-z][,;](?=[A-Za-z])", t)
        if m:
            out.append(_issue("format", "missing_space_after_punctuation", "info", "No space after punctuation.", block=i, quote=m.group(0),
                              suggestion=m.group(0)[0] + m.group(0)[1] + " ", fix=_replace_fix(i, m.group(0), m.group(0) + " ")))
        words = re.findall(r"\w+", t)
        if len(words) > 220 and _prose(b):
            out.append(_issue("format", "long_paragraph", "info", f"This block has {len(words)} words; consider splitting it.", block=i, quote=t[:60]))
        for s in re.split(r"(?<=[.!?])\s+", t):
            if len(re.findall(r"\w+", s)) > 45:
                out.append(_issue("style", "long_sentence", "info", "A very long sentence; consider splitting it.", block=i, quote=s[:80]))
                break
        letters = re.sub(r"[^A-Za-z]", "", t)
        if _prose(b) and len(words) >= 6 and letters and sum(c.isupper() for c in letters) / len(letters) > 0.85:
            out.append(_issue("format", "all_caps", "info", "A whole sentence in capitals is hard to read.", block=i, quote=t[:60]))
    return out


def list_issues(blocks: Sequence[B.Block]) -> List[Dict[str, Any]]:
    """Items of one list that end differently (some with a full stop, some without)."""
    out: List[Dict[str, Any]] = []
    i = 0
    while i < len(blocks):
        if blocks[i].kind != "list_item":
            i += 1
            continue
        j = i
        while j < len(blocks) and blocks[j].kind == "list_item":
            j += 1
        for depth in {b.level for b in blocks[i:j]}:
            items = [(k, blocks[k]) for k in range(i, j) if blocks[k].level == depth and len(blocks[k].text) > 3 and not blocks[k].text.rstrip().endswith(":")]
            ends = [b.text.rstrip().endswith(".") for _k, b in items]
            if len(items) >= 3 and 0 < sum(ends) < len(ends):
                minority = sum(ends) <= len(ends) / 2
                for k, b in items:
                    if b.text.rstrip().endswith(".") == minority:
                        out.append(_issue("format", "list_punctuation", "info", "The items of this list end differently: some with a full stop, some without.",
                                          block=k, quote=b.text[-30:]))
        i = j
    return out


def _variant(word: str, other: str) -> "re.Pattern":
    """A word's spelling and what is built on it, but not when it is really the other spelling (catalog / catalogue)."""
    guard = ""
    if other.startswith(word):
        guard = f"(?!{re.escape(other[len(word):])})"
    elif word.startswith(other):
        return re.compile(rf"\b{re.escape(word)}\w*", re.I)
    return re.compile(rf"\b{re.escape(word)}{guard}\w*", re.I)


def consistency_issues(blocks: Sequence[B.Block], language: Optional[str] = None) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    full = "\n".join(b.text for b in blocks if b.kind not in ("code", "raw"))
    formats = {name: rx.findall(full) for name, rx in _DATES.items() if rx.search(full)}
    if len(formats) > 1:
        out.append(_issue("consistency", "date_formats", "info", "Dates are written in more than one format: " + ", ".join(sorted(formats)) + "."))
    prefer = {"en-gb": "uk", "en-us": "us"}.get((language or "").lower())
    for us, uk in _SIMPLE_US_UK:
        rx_us, rx_uk = _variant(us, uk), _variant(uk, us)
        n_us, n_uk = len(rx_us.findall(full)), len(rx_uk.findall(full))
        if prefer == "uk":
            bad, good, rx_bad, flag = "us", uk, rx_us, n_us > 0
        elif prefer == "us":
            bad, good, rx_bad, flag = "uk", us, rx_uk, n_uk > 0
        else:
            flag = bool(n_us and n_uk)
            bad, good, rx_bad = ("us", uk, rx_us) if n_uk >= n_us else ("uk", us, rx_uk)
        if not flag:
            continue
        for i, b in enumerate(blocks):
            m = rx_bad.search(b.text) if b.kind not in ("code", "raw") else None
            if m:
                word = m.group(0)
                stem = us if bad == "us" else uk
                out.append(_issue("consistency", "spelling_variant", "info",
                                  f"\"{word}\" is written the {'US' if bad == 'us' else 'UK'} way; the document uses the {'UK' if bad == 'us' else 'US'} one.",
                                  block=i, quote=word, suggestion=re.sub(f"^{stem}", good, word, flags=re.I), fix=_replace_fix(i, word, re.sub(f"^{stem}", good, word, flags=re.I))))
                break
    return out


def table_issues(blocks: Sequence[B.Block]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for i, b in enumerate(blocks):
        if b.kind != "table" or not b.rows:
            continue
        if any(not c.text.strip() for c in b.rows[0]):
            out.append(_issue("format", "table_header", "warning", "A table's header row has an empty cell.", block=i))
        empties = sum(1 for r in b.rows[1:] for c in r if not c.text.strip())
        if empties:
            out.append(_issue("format", "table_empty_cells", "info", f"{empties} empty cell(s) in this table.", block=i))
    return out


def section_issues(blocks: Sequence[B.Block]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    heads = _headings(blocks)
    for n, (i, h) in enumerate(heads):
        nxt = heads[n + 1][0] if n + 1 < len(heads) else len(blocks)
        body = [b for b in blocks[i + 1:nxt] if b.kind != "hr"]
        if not body and (n + 1 >= len(heads) or heads[n + 1][1].level <= h.level):
            out.append(_issue("format", "section_empty", "warning", f"The section \"{h.text}\" has no content.", block=i, quote=h.text))
        elif key_of(h.text) in _REQUIREMENT_SECTIONS:
            for k in range(i + 1, nxt):
                b = blocks[k]
                if b.kind in ("list_item", "paragraph") and len(b.text.split()) >= 6 and not _NORMATIVE.search(b.text):
                    out.append(_issue("style", "normative_verb", "info", "A requirement should say who must do what (shall, must, should).", block=k, quote=b.text[:60]))
    return out


# ── structure ────────────────────────────────────────────────────────────────
def _match_section(title: str, spec: Dict[str, Any]) -> bool:
    """A heading is a spec section when it is that section's title or one of its aliases (an annex only matches an annex)."""
    if bool(spec.get("annex")) != is_annex(title):
        return False
    k = key_of(title)
    candidates = [spec["key"], key_of(spec["title"])] + [key_of(a) for a in spec.get("aliases", [])]
    return any(k == c or (len(c) > 6 and SequenceMatcher(None, k, c).ratio() >= 0.93) for c in candidates if c)


def structure_issues(blocks: Sequence[B.Block], structure: Optional[Dict[str, Any]], title: str = "") -> List[Dict[str, Any]]:
    if not structure:
        return []
    out: List[Dict[str, Any]] = []
    heads = [(i, b) for i, b in _headings(blocks) if b.level <= 3]
    if structure.get("title_required", True) and not any(b.level == 1 for _i, b in heads):
        out.append(_issue("structure", "title_missing", "warning", "The document has no title (a level 1 heading).",
                          fix={"type": "insert_after", "after_block": -1, "markdown": f"# {title or '[[Document title]]'}"}))
    sections = structure.get("sections", [])
    found: Dict[int, List[int]] = {}
    for n, spec in enumerate(sections):
        for i, b in heads:
            if b.level >= 2 and _match_section(b.text, spec):
                found.setdefault(n, []).append(i)
    last_end = -1
    for n, spec in enumerate(sections):
        at = found.get(n)
        if not at:
            if spec.get("required", True):
                anchor = max((idx[-1] for m, idx in found.items() if m < n), default=-1)
                end = anchor
                if anchor >= 0:                                 # after the whole section it follows, not just its heading
                    nxt = [i for i, b in _headings(blocks) if i > anchor and b.level <= blocks[anchor].level]
                    end = (nxt[0] - 1) if nxt else len(blocks) - 1
                out.append(_issue("structure", "section_missing", "error", f"The required section \"{spec['title']}\" is missing.", n=n,
                                  suggestion=f"Add \"{spec['title']}\".",
                                  fix={"type": "insert_after", "after_block": end, "markdown": f"## {spec['title']}\n\n[[Write the {spec['title'].lower()} section.]]"}))
            continue
        if len(at) > 1:
            out.append(_issue("structure", "section_duplicate", "warning", f"The section \"{spec['title']}\" appears {len(at)} times.", block=at[1], quote=blocks[at[1]].text, n=n))
        if at[0] < last_end:
            out.append(_issue("structure", "section_order", "warning", f"\"{blocks[at[0]].text}\" comes earlier than it should: the usual order has \"{spec['title']}\" after the section before it.",
                              block=at[0], quote=blocks[at[0]].text, n=n))
        last_end = max(last_end, at[0])
        nxt = [i for i, b in _headings(blocks) if i > at[0] and b.level <= blocks[at[0]].level]
        body = blocks[at[0] + 1:(nxt[0] if nxt else len(blocks))]
        words = sum(b.words for b in body if b.kind != "table")
        has_table = any(b.kind == "table" for b in body)
        if spec.get("min_words") and words < spec["min_words"] and not has_table:
            out.append(_issue("structure", "section_short", "info", f"The section \"{blocks[at[0]].text}\" has {words} words; about {spec['min_words']} or more is expected.",
                              block=at[0], quote=blocks[at[0]].text, n=n))
    return out


# ── entity name and logo ─────────────────────────────────────────────────────
def _title_block(blocks: Sequence[B.Block]) -> str:
    """The text a reader sees first: the title and what follows before the first section, and the document control table."""
    end = next((i for i, b in enumerate(blocks) if b.kind == "heading" and b.level >= 2), min(len(blocks), 4))
    text = [b.text for b in blocks[:min(end, 4)]]
    table = next((b for b in blocks[:8] if b.kind == "table"), None)
    return " ".join(text + ([b.text for b in [table]] if table else []))


def entity_issues(blocks: Sequence[B.Block], entity_name: str) -> List[Dict[str, Any]]:
    entity = (entity_name or "").strip()
    if not entity:
        return []
    low = entity.lower()
    head = _title_block(blocks).lower()
    anywhere = " ".join(b.text for b in blocks).lower()
    out: List[Dict[str, Any]] = []
    if low not in anywhere:
        out.append(_issue("entity", "entity_missing", "error", f"The entity name \"{entity}\" does not appear anywhere in the document.",
                          fix={"type": "insert_after", "after_block": 0 if blocks and blocks[0].kind == "heading" else -1, "markdown": f"*Owned by {entity}*"}))
    elif low not in head:
        out.append(_issue("entity", "entity_title", "warning", f"The entity name \"{entity}\" is not in the title block.",
                          fix={"type": "insert_after", "after_block": 0 if blocks and blocks[0].kind == "heading" else -1, "markdown": f"*Owned by {entity}*"}))
    placeholder = [i for i, b in enumerate(blocks) if re.search(r"\[(?:Bank|Organi[sz]ation|Company|Entity)(?: Name)?\]|\[\[(?:Bank|Organi[sz]ation|Company|Entity)[^\]]*\]\]", b.text, re.I)]
    for n, i in enumerate(placeholder):
        out.append(_issue("entity", "entity_placeholder", "warning", f"A placeholder stands where the entity name \"{entity}\" belongs.", block=i, quote=blocks[i].text[:60], n=n))
    return out


def logo_issues(instructions: Dict[str, Any], logo_ok: bool) -> List[Dict[str, Any]]:
    if instructions.get("logo_required") and not logo_ok:
        return [_issue("logo", "logo_missing", "warning", "A logo is required for this document but none is selected.")]
    return []


# ── all of it ────────────────────────────────────────────────────────────────
def placeholder_issues(blocks: Sequence[B.Block]) -> List[Dict[str, Any]]:
    out = []
    for n, p in enumerate(placeholders(blocks)):
        if p["required"]:
            out.append(_issue("placeholder", "placeholder", "warning", "This must be filled in before the document is used.", block=p["block"], quote=p["text"], n=n))
        else:
            out.append(_issue("placeholder", "placeholder_signature", "info", "A signature line: filled in when the document is signed.", block=p["block"], quote=p["text"], n=n))
    return out


def run_deterministic(markdown: str, *, structure: Optional[Dict[str, Any]] = None, instructions: Optional[Dict[str, Any]] = None,
                      title: str = "", logo_ok: bool = False) -> List[Dict[str, Any]]:
    """Every check that needs no AI, in order of importance."""
    instructions = instructions or {}
    blocks = B.parse(markdown)
    issues = (heading_issues(blocks) + text_issues(blocks) + list_issues(blocks) + consistency_issues(blocks, instructions.get("language"))
              + table_issues(blocks) + section_issues(blocks) + structure_issues(blocks, structure, title)
              + entity_issues(blocks, instructions.get("entity_name", "")) + logo_issues(instructions, logo_ok) + placeholder_issues(blocks))
    seen: Counter = Counter()
    for issue in issues:                                           # ids must be unique so a fix can name its issue
        seen[issue["id"]] += 1
        if seen[issue["id"]] > 1:
            issue["id"] += f"#{seen[issue['id']]}"
    return sorted(issues, key=lambda x: (SEVERITY_ORDER.get(x["severity"], 3), x["block"] if x["block"] is not None else -1))


def summary(issues: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    by_kind = Counter(i["kind"] for i in issues)
    by_sev = Counter(i["severity"] for i in issues)
    return {"total": len(issues), "by_kind": dict(by_kind), "by_severity": dict(by_sev),
            "must_fill": sum(1 for i in issues if i["rule"] == "placeholder")}


# ── fixes ────────────────────────────────────────────────────────────────────
def _fix_place(fix: Dict[str, Any]) -> float:
    """Where a fix acts, for ordering: its block, between two blocks for an insertion, before everything for a renumbering."""
    if fix.get("type") == "renumber":
        return float("-inf")
    if fix.get("type") == "insert_after":
        return float(fix.get("after_block", -1)) + 0.5
    return float(fix.get("block", -1))


def apply_fixes(markdown: str, fixes: Sequence[Dict[str, Any]]) -> tuple:
    """Every fix at once, all found on the same text: from the end of the document to its start, so a fix never moves a block
    another fix points at (an insertion only moves the blocks after it, which are done by then; two insertions at the same place
    keep the order they were listed in); renumbering last. A fix that no longer fits (the same words were already changed by
    another fix) is skipped. Returns ``(markdown, applied, skipped)``."""
    order = sorted(range(len(fixes)), key=lambda k: (_fix_place(fixes[k]), k), reverse=True)
    applied = skipped = 0
    for k in order:
        new = apply_fix(markdown, fixes[k])
        if new is None or new == markdown:
            skipped += 1
            continue
        markdown, applied = new, applied + 1
    return markdown, applied, skipped


def apply_fix(markdown: str, fix: Dict[str, Any]) -> Optional[str]:
    """The Markdown after a fix, or None when the fix does not fit (the text moved or changed). Fixes touch one block."""
    blocks = B.parse(markdown)
    kind = fix.get("type")
    if kind == "renumber":
        return renumber_headings(markdown)
    i = fix.get("block")
    if kind == "insert_after":
        after = fix.get("after_block", -1)
        if after is None or after < -1 or after >= len(blocks):
            return None
        new = B.parse(fix.get("markdown", ""))
        return B.render(blocks[:after + 1] + new + blocks[after + 1:])
    if i is None or not 0 <= i < len(blocks):
        return None
    b = blocks[i]
    if kind == "replace":
        find, replace, occurrence = fix.get("find", ""), fix.get("replace", ""), fix.get("occurrence", 0)
        if not find or find not in b.source:
            return None
        parts = b.source.split(find)
        if occurrence >= len(parts) - 1:
            return None
        b.source = find.join(parts[:occurrence + 1]) + replace + find.join(parts[occurrence + 1:])
    elif kind == "set_level" and b.kind == "heading":
        b.source = re.sub(r"^(\s*)#{1,6}", lambda m: m.group(1) + "#" * int(fix["level"]), b.source, count=1)
    elif kind == "strip_trailing_punct":
        b.source = re.sub(r"[:.;,]\s*$", "", b.source)
    elif kind == "normalize_space":
        b.source = re.sub(r"(?<=\S)[ \t]{2,}(?=\S)", " ", b.source)
    elif kind == "delete_block":
        blocks.pop(i)
    else:
        return None
    return B.render(blocks)
