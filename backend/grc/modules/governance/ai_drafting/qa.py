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
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set

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
# Same shape but also captures the clause <ref> (group 2) for ref-existence checks.
_CITATION_FULL_RE = re.compile(
    r"\[([A-Za-z][A-Za-z0-9\-\._/]*?)(?:\s+[^\],]+)?,\s*(?:clause|section|art\.?)\s+([^\]]+)\]",
    re.IGNORECASE,
)


def _norm_ref(ref: str) -> str:
    return re.sub(r"\s+", "", str(ref or "")).lower()


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
    # Warn-level only — surfaced to the caller but does NOT flip `ok` or trigger
    # a hard regeneration. Citations to clause refs that don't exist in the
    # active framework index land here.
    unknown_clause_refs: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    def warning_summary(self) -> Optional[str]:
        """One-line summary of warn-level issues, or None when there are none."""
        if not self.warnings:
            return None
        return "; ".join(self.warnings)

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
    known_clause_refs: Optional[Dict[str, set]] = None,
) -> SectionQAResult:
    """Validate a single section's generated content.

    `known_clause_refs` (framework_code → set of valid control_refs) is optional
    and additive: when supplied, any cited clause ref that does not exist in the
    index for a KNOWN framework code is flagged as a WARNING (surfaced, never a
    hard failure — the model may legitimately cite a clause the index truncated).
    """
    text = text or ""
    lower_text = text.lower()

    # Banned phrases
    hits: List[str] = []
    for needle in _BANNED_SUBSTRINGS:
        if needle in lower_text:
            hits.append(needle)

    # Citation code validation (hard — fabricated framework codes fail)
    active = {_normalise_code(c) for c in active_framework_codes if c}
    unknown: List[str] = []
    if active:
        for match in _CITATION_RE.finditer(text):
            code = match.group(1)
            if _normalise_code(code) not in active:
                unknown.append(code)

    # Clause-ref validation (warn-level) — does the cited ref exist in the index?
    unknown_clause_refs: List[str] = []
    warnings: List[str] = []
    if known_clause_refs:
        known_norm = {
            _normalise_code(code): {_norm_ref(r) for r in refs}
            for code, refs in known_clause_refs.items()
        }
        for match in _CITATION_FULL_RE.finditer(text):
            code = match.group(1)
            ref = (match.group(2) or "").strip()
            ncode = _normalise_code(code)
            # Only check refs for codes we actually know (skip fabricated codes,
            # already caught above, and codes with no indexed refs).
            if ncode in known_norm and known_norm[ncode] and _norm_ref(ref) not in known_norm[ncode]:
                unknown_clause_refs.append(f"{code} clause {ref}")
        if unknown_clause_refs:
            warnings.append(
                "cited clause refs not found in the framework index: "
                + ", ".join(sorted(set(unknown_clause_refs)))
            )

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

    # Warn-level findings deliberately DO NOT flip `ok`.
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
        unknown_clause_refs=unknown_clause_refs,
        warnings=warnings,
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
