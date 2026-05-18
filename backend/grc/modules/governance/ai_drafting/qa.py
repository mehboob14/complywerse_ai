"""Stage D — QA validator for generated sections.

Rejects sections that exhibit common AI-tells:
  * placeholder language (`[Insert X]`, `your organization`, `as an AI`),
  * fabricated framework citations (codes not in the tenant's active set),
  * missing minimum word count or minimum clause count.

The pipeline uses these results to selectively regenerate failing
sections rather than re-running the whole document.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional, Set

from .scaffolds import SectionSpec


# ─── Banned phrases (case-insensitive) ───────────────────────────────
# Each entry is something a human bank-policy author would never write
# but GPT loves to insert when it doesn't have enough concrete context.
_BANNED_SUBSTRINGS: List[str] = [
    "[insert ",
    "[your ",
    "[company name]",
    "[organisation name]",
    "[organization name]",
    "your organization",
    "your company",
    "acme corp",
    "acme inc",
    "example corp",
    "your bank",
    "as an ai",
    "as a language model",
    "i cannot",
    "i'm sorry",
    "lorem ipsum",
    "tbd",
    "to be determined",
    "to be defined",
    "placeholder",
    "xxx",
]


# Citations look like `[<CODE> <maybe version>, clause <ref>]` or
# `[<CODE>, clause <ref>]`. We extract <CODE> for validation.
_CITATION_RE = re.compile(
    r"\[([A-Za-z][A-Za-z0-9\-\._/]*?)(?:\s+[^\],]+)?,\s*(?:clause|section|art\.?)\s+[^\]]+\]",
    re.IGNORECASE,
)


@dataclass
class SectionQAResult:
    section_number: str
    section_heading: str
    ok: bool
    word_count: int
    clause_count: int
    banned_phrase_hits: List[str]
    unknown_framework_codes: List[str]
    notes: List[str]

    def failure_summary(self) -> Optional[str]:
        """One-line summary of why the section failed, or None when ok."""
        if self.ok:
            return None
        bits: List[str] = []
        if self.banned_phrase_hits:
            bits.append(f"banned phrases: {', '.join(sorted(set(self.banned_phrase_hits)))}")
        if self.unknown_framework_codes:
            bits.append(
                f"fabricated framework codes: {', '.join(sorted(set(self.unknown_framework_codes)))}"
            )
        if self.notes:
            bits.extend(self.notes)
        return "; ".join(bits) if bits else "validation failed"


def _normalise_code(code: str) -> str:
    return re.sub(r"[\s_/.]", "-", code.strip().lower())


def _count_numbered_clauses(text: str, section_number: str) -> int:
    """Count numbered clauses like `<section_number>.1`, `<section_number>.1.1`.

    Falls back to counting markdown-list bullets when no numbered clauses
    are present (some sections render as numbered lists rather than
    sub-clauses).
    """
    if section_number:
        pattern = re.compile(
            rf"(?:^|\n)\s*{re.escape(section_number)}\.\d+(?:\.\d+)*\b",
            re.MULTILINE,
        )
        hits = pattern.findall(text)
        if hits:
            return len(hits)
    # Markdown numbered/bulleted fallback.
    bullets = re.findall(r"(?:^|\n)\s*(?:\d+\.|[-*])\s+", text)
    return len(bullets)


def validate_section(
    section: SectionSpec,
    text: str,
    active_framework_codes: List[str],
) -> SectionQAResult:
    """Validate a single section's generated content."""
    text = text or ""
    lower_text = text.lower()

    # Banned phrases
    hits: List[str] = []
    for needle in _BANNED_SUBSTRINGS:
        if needle in lower_text:
            hits.append(needle)

    # Citation validation
    active = {_normalise_code(c) for c in active_framework_codes if c}
    unknown: List[str] = []
    if active:
        for match in _CITATION_RE.finditer(text):
            code = match.group(1)
            if _normalise_code(code) not in active:
                unknown.append(code)

    # Word / clause counts
    word_count = len(text.split())
    clause_count = _count_numbered_clauses(text, section.number)

    notes: List[str] = []
    if word_count < section.min_words:
        notes.append(f"under min words ({word_count} < {section.min_words})")
    if section.min_clauses is not None and clause_count < section.min_clauses:
        notes.append(
            f"under min clauses ({clause_count} < {section.min_clauses})"
        )

    ok = not hits and not unknown and not notes
    return SectionQAResult(
        section_number=section.number,
        section_heading=section.heading,
        ok=ok,
        word_count=word_count,
        clause_count=clause_count,
        banned_phrase_hits=hits,
        unknown_framework_codes=unknown,
        notes=notes,
    )


def regeneration_hint(result: SectionQAResult) -> str:
    """Build a short hint the pipeline appends to the regeneration prompt.

    Tells the LLM exactly what the previous attempt got wrong so it can
    correct on the second pass rather than producing the same output.
    """
    parts: List[str] = []
    if result.banned_phrase_hits:
        parts.append(
            "Your previous draft used placeholder/AI-tell phrases: "
            + ", ".join(sorted(set(result.banned_phrase_hits)))
            + ". Never use these. Use the organisation's actual name and the "
            "concrete role/committee names supplied."
        )
    if result.unknown_framework_codes:
        parts.append(
            "You cited frameworks that are NOT in the supplied active set: "
            + ", ".join(sorted(set(result.unknown_framework_codes)))
            + ". You may only cite frameworks from the provided active list."
        )
    if any("under min words" in n for n in result.notes):
        parts.append(
            "Your previous draft was too short. Produce significantly more "
            "depth — multiple paragraphs and concrete clauses, not a summary."
        )
    if any("under min clauses" in n for n in result.notes):
        parts.append(
            "Your previous draft had too few numbered clauses. Produce more "
            "atomic, numbered obligations."
        )
    return " ".join(parts)
