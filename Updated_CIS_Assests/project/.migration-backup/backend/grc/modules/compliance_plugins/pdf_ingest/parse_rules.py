"""Split CIS PDF body text into individual rule blocks and extract fields.

CIS benchmarks all share the same skeleton:

    1.1.1 (L1) Ensure password minimum length is 14 characters (Automated)
    Profile Applicability:
      - Level 1 - Server
    Description:
      ...
    Rationale:
      ...
    Impact:
      ...
    Audit:
      ...
    Remediation:
      ...
    Default Value:
      ...
    References:
      1. https://...
    CIS Controls:
      Version 8 — 5.2 ...

We:
  1. Find every rule-heading line via regex on numeric prefix.
  2. Carve the body between two consecutive headings.
  3. Within each body, split on the section labels above using a single regex.
  4. Build a parent/child tree from the numeric prefix (1 → 1.1 → 1.1.1).

The output is a flat list of dicts; the parent linkage is `parent_rule_id`
plus depth (depth = count of dots in rule_id). The downstream pipeline maps
parent_rule_id → parent_plugin_id once rows are inserted.
"""
from __future__ import annotations

import re
from typing import Any

# Matches a rule heading like "1.2.3 (L1) Ensure ... (Automated)" or simply
# "1.2.3 Ensure ...". Multi-line so it can fire mid-document.
_HEADING_RE = re.compile(
    r"""
    (?m)^\s*
    (?P<rule_id>\d+(?:\.\d+){0,4})       # 1, 1.1, 1.1.1, 1.1.1.1, 1.1.1.1.1
    \s+
    (?:\((?P<level>L[12](?:\s*-\s*[A-Za-z]+)?)\)\s+)?     # optional (L1) / (L1 - Server)
    (?P<title>[^\n]{4,300}?)
    (?:\s+\((?P<status>Automated|Manual|Scored|Not\s+Scored)\))?
    \s*$
    """,
    re.VERBOSE,
)

# Section labels we know about. The order is the order we expect them in,
# but the splitter doesn't require a specific order — it splits on any.
_SECTION_LABELS = [
    "Profile Applicability",
    "Description",
    "Rationale",
    "Impact",
    "Audit",
    "Remediation",
    "Default Value",
    "References",
    "Additional Information",
    "CIS Controls",
    "MITRE ATT&CK Mappings",
]
# Section labels appear at the start of a line with a colon. CIS PDFs vary:
# sometimes the body content is on the next line ("Description:\n  Foo"),
# sometimes inline after the colon ("Description: Foo bar"). Accept both —
# the splitter consumes everything up to the next label as content. We
# require ``[ \t]`` (not ``\s``) so the trailing newline isn't eaten and
# inline content survives intact.
_SECTION_RE = re.compile(
    r"(?m)^[ \t]*(" + "|".join(re.escape(s) for s in _SECTION_LABELS) + r")[ \t]*:[ \t]*"
)


def _strip_page_artifacts(text: str) -> str:
    """Drop running headers/footers and "Page X of Y" lines that pollute body text."""
    lines = []
    for ln in text.splitlines():
        stripped = ln.strip()
        if not stripped:
            lines.append(ln)
            continue
        # Page X / Page X of Y
        if re.fullmatch(r"Page\s+\d+(\s+of\s+\d+)?", stripped, flags=re.IGNORECASE):
            continue
        # Lone digits = page numbers
        if re.fullmatch(r"\d{1,4}", stripped):
            continue
        # CIS running footer
        if "P a g e" in stripped:
            continue
        lines.append(ln)
    return "\n".join(lines)


# A line is a TOC entry when it has a long run of dot-leaders (".....") or
# whitespace-padded dots followed by a trailing page number.
_TOC_DOT_LEADER_RE = re.compile(r"\.{4,}\s*\d{1,4}\s*$")
# Also catch pdfplumber/fitz collapsing dot-leaders into spaces ("Foo    15").
_TOC_TRAILING_PAGENUM_RE = re.compile(r"\s{3,}\d{1,4}\s*$")
# A "title" that is just a single-quoted value, e.g. `1.1 'Disabled'`.
_QUOTED_VALUE_ONLY_RE = re.compile(r"^['\"][^'\"]{1,80}['\"]\s*$")
# CIS PDFs render two-column "Set Correctly: Yes / No" cells as runs of
# circle / lowercase-o glyphs (○ ○, ● ●, o o, • •) appended to the title
# line. The splitter sees those as part of the title, so the real verb
# fragment lands on the next visual row. Strip the glyph run.
_CHECKBOX_GLYPHS_RE = re.compile(r"\s*[\u25CB\u25CF\u2022\u26AC\u26AB\u00B0o\.\u2219]+(?:\s+[\u25CB\u25CF\u2022\u26AC\u26AB\u00B0o\.\u2219]+)+\s*$")
# Required-section labels — at least ONE must appear in a rule body for
# us to treat it as a real CIS Recommendation. Without these, the heading
# is almost certainly:
#   * a CIS Controls v7/v8 cross-reference embedded in the previous
#     rule's "CIS Controls" section (rule_ids like 12.5, 13.2, 14.4)
#   * a chapter / section divider ("1 Source Code", "4 Artifacts")
# The four canonical labels below are present in every CIS benchmark rule
# we've seen since at least v1.0; missing all of them is a strong signal.
_CANONICAL_SECTION_RE = re.compile(
    r"(?m)^[ \t]*(?:Description|Rationale|Audit|Remediation|Profile\s+Applicability)[ \t]*:",
    re.IGNORECASE,
)
# Real CIS rule titles almost always start with one of these verbs.
_RULE_VERBS = (
    "ensure",
    "configure",
    "set ",
    "disable",
    "enable",
    "restrict",
    "limit",
    "remove",
    "require",
    "verify",
    "audit",
    "block",
    "prevent",
    "deny",
    "allow ",
    "do not",
    "use ",
    "install",
    "uninstall",
    "rotate",
)


def _looks_like_rule(rule_id: str, title: str, body: str) -> tuple[bool, str | None]:
    """Heuristic gate: return (keep?, reject_reason).

    Drops false-positives that the bare numeric-prefix regex picks up:
      * TOC entries with dot-leaders + trailing page numbers
      * Bare section/category headings ("Camera", "Telemetry", "Update")
      * Lines that are just a quoted value ("'Disabled'")
      * Titles too short to be meaningful
      * Rule IDs starting with "0" (no CIS rule 0; usually a cross-ref glitch)
      * Titles starting with paren/quote (body content captured as heading)

    Truly-leaf rule headings (4-segment IDs like 18.10.42.4.1) MUST start
    with a verb like "Ensure ..." — bare nouns at that depth are TOC bleed.
    """
    # No CIS benchmark uses rule_id "0" or "0.X". When we see one it's
    # almost always a "v7 → v8 control mapping" table cell ("0" appearing
    # before "Explicitly Not Mapped") that the numeric regex caught.
    if rule_id.startswith("0"):
        return False, "rule_id_zero_prefix"
    # Single-segment rule_ids (no dot) are never leaf CIS rules. They are
    # either chapter dividers (which have no audit/remediation body and
    # would be rejected later), OR — more commonly — body fragments like
    # "Windows Server 2003 domain, ...", MSKB article numbers (2871997),
    # "Windows 7", "Server 2008", "Microsoft 365 Defender …", where the
    # numeric regex caught a paragraph mid-sentence. Real CIS rules ALWAYS
    # have at least one dot (1.1, 18.10.5.2.1, …).
    if "." not in rule_id:
        return False, "rule_id_no_dot"
    t = title.strip()
    if len(t) < 5:
        return False, "title_too_short"
    # Rule titles never start with paren or quote — those are body
    # fragments ("(SMBv1) protocol. ...", "'Disabled' (recommended)")
    # where the splitter cut mid-paragraph instead of at a real heading.
    if t[0] in "(['\"":
        return False, "title_starts_with_punct"
    # Rule titles always start with an uppercase letter — they're proper
    # English sentences. A lowercase first letter ("and Windows Server …",
    # "domain, these computers authenticate by default …") is always a
    # paragraph fragment caught when a number lands at line-start.
    if t[0].islower():
        return False, "title_starts_with_lowercase"
    tl = t.lower()
    if tl.startswith(("page ", "table of contents", "appendix")):
        return False, "toc_keyword"
    if _TOC_DOT_LEADER_RE.search(t) or _TOC_TRAILING_PAGENUM_RE.search(t):
        return False, "toc_dot_leader"
    if _QUOTED_VALUE_ONLY_RE.match(t):
        return False, "quoted_value_only"
    # Section headings are short noun phrases (no verb, < 4 words). Allow them
    # only at the top of the tree (depth 0/1) where category headers like
    # "Account Policies" might legitimately be the parent grouping.
    depth = rule_id.count(".")
    word_count = len(t.split())
    starts_with_verb = any(tl.startswith(v) for v in _RULE_VERBS)
    if not starts_with_verb and word_count < 4 and depth >= 2:
        return False, "section_header_no_verb"
    # Real CIS rules always have substantive body content (Description,
    # Rationale, Audit, Remediation). A heading with effectively no body
    # is either:
    #   * a chapter/section header in the body of the document
    #     ("1 Application Settings", "2 Telemetry") — the next "rule" is
    #     literally the next line, leaving no content in between, or
    #   * a CIS Controls cross-reference like "4.8 Uninstall …" embedded
    #     inside the previous rule's References block.
    # Either way it isn't a rule we should surface to reviewers.
    if len(body.strip()) < 30:
        return False, "no_body"
    # The single biggest source of false positives we see in the wild is
    # CIS Controls cross-references — the "CIS Controls" section at the
    # end of every rule lists v7/v8 control IDs (e.g. "12.5 Centralize
    # Network Authentication, Authorization, and Auditing"), and our
    # heading regex picks them up as if they were standalone rules.
    # Same for chapter dividers ("1 Source Code"). Real rules ALWAYS have
    # at least one of: Description / Rationale / Audit / Remediation /
    # Profile Applicability. If none of those appear in the body, drop it.
    if not _CANONICAL_SECTION_RE.search(body):
        return False, "no_canonical_sections"
    return True, None


def split_into_rules(full_text: str) -> list[dict[str, Any]]:
    """Walk the document and return one block per rule heading found.

    Also returns side-channel parse-quality counts via the ``rejection_log``
    attribute on the returned list (set by :func:`split_into_rules_with_log`).
    Callers that don't care can ignore it.
    """
    rules, _rejected = split_into_rules_with_log(full_text)
    return rules


def split_into_rules_with_log(
    full_text: str,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Like ``split_into_rules`` but also returns a per-reason rejection count."""
    text = _strip_page_artifacts(full_text)
    matches = list(_HEADING_RE.finditer(text))
    rules: list[dict[str, Any]] = []
    rejected: dict[str, int] = {}
    for i, m in enumerate(matches):
        rule_id = m.group("rule_id")
        title = (m.group("title") or "").strip()
        body_start = m.end()
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[body_start:body_end].strip()
        # Recover titles truncated by CIS table-cell layout. The PDF
        # renders "Set Correctly: Yes / No" as ○ ○ glyphs trailing the
        # title, with the rest of the verb wrapped onto the next visual
        # row. Strip the glyphs and, if the title ends mid-clause, glue
        # the first body line back on (when it's not a section label).
        cleaned_title, body = _recover_truncated_title(title, body)
        title = cleaned_title
        keep, reason = _looks_like_rule(rule_id, title, body)
        if not keep:
            rejected[reason or "unknown"] = rejected.get(reason or "unknown", 0) + 1
            continue
        sections = _split_sections(body)
        rules.append(
            {
                "rule_id": rule_id,
                "title": title,
                "level": m.group("level"),
                "assessment_status": m.group("status"),
                "sections": sections,
                "raw_body": body,
            }
        )
    return rules, rejected


def _recover_truncated_title(title: str, body: str) -> tuple[str, str]:
    """Strip trailing checkbox glyphs and glue back wrapped title fragments.

    Two-column CIS rule tables wrap titles across visual rows. There are
    two flavours we need to handle:

    1. pdfplumber returns the "Set Correctly: Yes / No" cells as a run
       of ○ ○ / o o glyphs trailing the title — we strip them.
    2. Newer pdfplumber + fitz extractions drop the glyphs entirely but
       still split the title across two rows ("Ensure pushing or
       merging of new code is restricted to" / "trusted users") — there
       is no glyph signal at all.

    A real CIS rule title ALWAYS terminates with one of:
    ``(Automated)``, ``(Manual)``, ``(Scored)``, ``(Not Scored)``. So
    we use the absence of that marker as our trigger to glue the first
    body line back onto the title. We also keep gluing for up to 3 rows
    until the marker shows up or we hit a section label.
    """
    new_title = _CHECKBOX_GLYPHS_RE.sub("", title).rstrip()
    terminal_re = re.compile(r"\((?:Automated|Manual|Scored|Not\s+Scored)\)\s*$", re.IGNORECASE)
    # Already complete? Nothing to do.
    if terminal_re.search(new_title):
        return new_title, body
    body_lines = body.split("\n")
    consumed = 0
    for line in body_lines[:3]:  # at most 3 wrap rows — anything more is a parse error
        candidate = _CHECKBOX_GLYPHS_RE.sub("", line).strip()
        if not candidate:
            consumed += 1
            continue
        # Stop at section labels and at numeric rule headings.
        if _SECTION_RE.match(candidate) or re.match(r"^\d+(?:\.\d+){1,4}\s+", candidate):
            break
        # Glue the row onto the title.
        new_title = f"{new_title} {candidate}".strip()
        consumed += 1
        if terminal_re.search(new_title):
            break
    if consumed:
        body = "\n".join(body_lines[consumed:])
    return new_title, body


def _split_sections(body: str) -> dict[str, str]:
    """Split a rule body into labelled sections."""
    out: dict[str, str] = {}
    parts = _SECTION_RE.split(body)
    if len(parts) <= 1:
        # No labelled sections — store everything as the description.
        return {"Description": body.strip()}
    # parts is [pre-text, label1, content1, label2, content2, ...]
    pre = parts[0].strip()
    if pre:
        out["_preamble"] = pre
    for i in range(1, len(parts), 2):
        label = parts[i].strip()
        content = (parts[i + 1] if i + 1 < len(parts) else "").strip()
        out[label] = content
    return out


def parent_of(rule_id: str) -> str | None:
    """1.2.3 → 1.2; 1.2 → 1; 1 → None."""
    if "." not in rule_id:
        return None
    return rule_id.rsplit(".", 1)[0]


def depth_of(rule_id: str) -> int:
    return rule_id.count(".")
