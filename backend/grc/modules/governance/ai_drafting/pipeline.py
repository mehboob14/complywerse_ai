"""Multi-stage AI drafting orchestrator.

Stage flow:
  A. `_stage_outline()` — single short LLM call that returns a per-section
     topic plan for clause-bearing sections. Lets the LLM pick the right
     topic from the tenant's active set rather than us hard-coding it.
  B. `_stage_expand_section()` — one focused LLM call per section, run
     concurrently via a thread pool. Each call receives only its slice
     of framework citations + the tenant fields it needs.
  C. `_stage_metadata_and_annexures()` — Document Description table,
     Approval Signoff page, and Revision History are assembled from
     `TenantContextBundle` (no LLM call). Other annex sections (Roles
     Matrix, Glossary) are produced in Stage B like normal sections.
  D. `_stage_qa()` — validates each section via `qa.validate_section()`.
     Sections that fail get one regeneration attempt with a corrective
     hint appended. Hard failures are logged and returned with a flag.

A single network failure / API error in Stage B never kills the whole
draft — the offending section is replaced with a clearly-marked stub
and the rest of the document is still returned.
"""
from __future__ import annotations

from ....config import get_openai_model
import json
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple


# A progress callback receives `(stage, detail_dict)` whenever the pipeline
# crosses a stage boundary OR completes one section in Stage B. The caller
# (Celery task) persists these to Redis so the frontend can poll real
# state instead of guessing from elapsed time.
ProgressCallback = Optional[Callable[[str, Dict[str, Any]], None]]

from fastapi import HTTPException, status
from openai import OpenAI

from .enterprise_craft import (
    SME_SYSTEM_ADDENDUM,
    apply_industry,
    enterprise_drafting_block,
    industry_profile,
)
from .exemplars import get_exemplar
from .framework_index import (
    FrameworkCitation,
    FrameworkIndex,
    classify_topics,
    resolve_area_to_topic,
)
from .qa import SectionQAResult, regeneration_hint, validate_section
from .scaffolds import DocScaffold, SectionSpec, get_scaffold
from .tenant_context import TenantContextBundle


logger = logging.getLogger(__name__)


_OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY") or os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
_OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
# GPT-5 is the current flagship for governance drafting. Override via
# `OPENAI_DRAFT_MODEL` in .env if you need to pin a specific revision
# (e.g. `gpt-5-2026-01-15`) for change-control reasons.
_OPENAI_MODEL = os.environ.get("OPENAI_DRAFT_MODEL", "gpt-5")
# Auto-fallback model when the primary model produces empty content (most
# common GPT-5 failure mode: reasoning eats the entire token budget, leaving
# zero output tokens). Without a fallback we'd render the whole document as
# the "could not be generated automatically" stub. Set
# OPENAI_DRAFT_FALLBACK_MODEL to override or to "" to disable.
_OPENAI_FALLBACK_MODEL = os.environ.get("OPENAI_DRAFT_FALLBACK_MODEL", get_openai_model())

_STAGE_B_PARALLELISM = int(os.environ.get("AI_DRAFT_PARALLELISM", "4"))

# Breadth / parent-slicing caps. A broad policy fans the clause engine across at
# most this many areas; each section injects at most this many parent clauses
# (and this many characters of parent text) so a 200-statement parent never
# blows the prompt budget.
_MAX_CLAUSE_AREAS = int(os.environ.get("AI_DRAFT_MAX_AREAS", "6"))
_MAX_PARENT_CLAUSES_PER_SECTION = int(os.environ.get("AI_DRAFT_MAX_PARENT_CLAUSES", "12"))
_PARENT_CLAUSE_CHAR_CAP = int(os.environ.get("AI_DRAFT_PARENT_CHAR_CAP", "4000"))
# A parent with more in-scope-able clauses than this, drafted into a single
# focused doc (procedure) with no scope, is treated as "ambiguous scope".
_BROAD_PARENT_THRESHOLD = int(os.environ.get("AI_DRAFT_BROAD_PARENT", "12"))


@dataclass
class DraftResult:
    """Result returned to the caller / serialised in the API response."""
    title: str
    doc_type: str
    generated_content: str
    sections: List[dict]              # [{heading, content, qa: {...}}]
    framework_alignment: List[dict]   # [{framework, controls, version}]
    word_count: int
    qa_failures: List[dict]           # surfaces sections that failed QA even after retry
    stage_telemetry: Dict[str, Any]   # for UI progress display
    # Non-fatal advisories surfaced to the caller (ambiguous parent scope,
    # cross-section duplicate clauses, warn-level QA citation issues, …).
    warnings: List[str] = field(default_factory=list)


# ─── OpenAI client ───────────────────────────────────────────────────

def _client() -> OpenAI:
    if not _OPENAI_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OpenAI integration not configured",
        )
    return OpenAI(api_key=_OPENAI_API_KEY, base_url=_OPENAI_BASE_URL)


def _is_reasoning_model(model: str) -> bool:
    """Models whose `max_completion_tokens` budget is split between hidden
    reasoning tokens and visible output. They need a much larger budget than
    older chat models for the same output size — otherwise reasoning eats the
    entire allowance and we get an empty `content` back."""
    m = (model or "").lower()
    return m.startswith("gpt-5") or m.startswith("o1") or m.startswith("o3") or m.startswith("o4")


def _call_chat_json_once(
    model: str,
    *,
    prompt: str,
    system: str,
    temperature: float,
    max_tokens: int,
) -> dict:
    """One shot at the OpenAI chat-completions API.

    Returns the parsed JSON dict on success. Raises on:
      - the SDK raising any exception (auth, 4xx, network, etc.)
      - the response having `content` empty/None (typical of reasoning models
        that exhaust their budget on hidden reasoning); the caller decides
        whether to retry on a fallback model.
    Returns ``{}`` only on malformed-JSON (treated as soft failure — we still
    have content, it just wasn't a JSON object the model promised).
    """
    kwargs: Dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "response_format": {"type": "json_object"},
    }
    # GPT-5 / reasoning models need (a) `max_completion_tokens`, (b) a budget
    # that has room for the hidden reasoning trace + the actual output. We
    # bump the floor 2.5x for reasoning models so a typical 2200-token section
    # call still leaves ≥ 1000 output tokens after the model finishes thinking.
    if _is_reasoning_model(model):
        kwargs["max_completion_tokens"] = max(max_tokens * 5 // 2, 4000)
    else:
        kwargs["max_completion_tokens"] = max_tokens
    # GPT-5 / o-series currently only support temperature=1. Sending anything
    # else raises a 400 `unsupported_value`. Older GPT-4o-family models still
    # respect a custom temperature.
    if not _is_reasoning_model(model):
        kwargs["temperature"] = temperature

    resp = _client().chat.completions.create(**kwargs)
    content = resp.choices[0].message.content
    finish_reason = getattr(resp.choices[0], "finish_reason", None)
    if not content:
        # Build a diagnostic so the operator sees WHY the call returned empty
        # rather than silently rendering a stub document.
        usage = getattr(resp, "usage", None)
        detail = f"model={model} finish_reason={finish_reason}"
        if usage is not None:
            detail += (
                f" usage(prompt={getattr(usage, 'prompt_tokens', '?')},"
                f" completion={getattr(usage, 'completion_tokens', '?')},"
                f" total={getattr(usage, 'total_tokens', '?')})"
            )
            # OpenAI exposes completion_tokens_details.reasoning_tokens for
            # reasoning models — log it so we can tell exactly how many of the
            # tokens went to hidden thinking vs the visible output.
            details = getattr(usage, "completion_tokens_details", None)
            if details is not None:
                detail += f" reasoning_tokens={getattr(details, 'reasoning_tokens', '?')}"
        raise RuntimeError(f"OpenAI returned empty content. {detail}")
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        logger.warning("Stage call returned malformed JSON; falling back to empty dict")
        return {}


def _chat_json(prompt: str, *, system: str, temperature: float = 0.45, max_tokens: int = 3200) -> dict:
    """Helper: chat completion with json_object response format.

    Tries the primary model first; if it raises (most commonly because a
    reasoning model returned empty content after spending its entire budget
    on hidden reasoning), retries once on the fallback model. Returns ``{}``
    only after BOTH have failed — at which point Stage B's caller renders
    the "could not be generated automatically" stub.
    """
    try:
        return _call_chat_json_once(
            _OPENAI_MODEL,
            prompt=prompt,
            system=system,
            temperature=temperature,
            max_tokens=max_tokens,
        )
    except Exception as primary_exc:  # noqa: BLE001
        # Don't log the full traceback for an empty-content RuntimeError — it
        # is expected when GPT-5 exhausts its budget. Log a single concise
        # warning + fall back. For everything else, log the traceback.
        primary_msg = str(primary_exc)
        if isinstance(primary_exc, RuntimeError) and primary_msg.startswith("OpenAI returned empty content"):
            logger.warning("Primary model empty content; will try fallback. %s", primary_msg)
        else:
            logger.exception("Primary model %r failed: %s", _OPENAI_MODEL, primary_msg)

        fallback = _OPENAI_FALLBACK_MODEL
        if not fallback or fallback == _OPENAI_MODEL:
            return {}
        try:
            result = _call_chat_json_once(
                fallback,
                prompt=prompt,
                system=system,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            logger.info("Drafting fallback %r succeeded after primary %r failed.", fallback, _OPENAI_MODEL)
            return result
        except Exception as fallback_exc:  # noqa: BLE001
            logger.exception("Fallback model %r also failed: %s", fallback, fallback_exc)
            return {}


# ─── Tenant context block (shared by every Stage B call) ─────────────

def _tenant_context_block(ctx: TenantContextBundle, scaffold: DocScaffold) -> str:
    """A compact block the LLM uses to personalise every section."""
    parts: List[str] = ["TENANT CONTEXT — use these values verbatim, never fabricate substitutes:"]
    parts.append(f"- Organisation name: {ctx.organisation_display}")
    if ctx.legal_entity and ctx.legal_entity != ctx.organization_name:
        parts.append(f"- Legal entity: {ctx.legal_entity}")
    if ctx.industry:
        parts.append(f"- Industry: {ctx.industry}")
    if ctx.regulatory_scope:
        parts.append(f"- Regulatory scope: {ctx.regulatory_scope}")
    if ctx.geography:
        parts.append(f"- Geography / jurisdiction: {ctx.geography}")
    if ctx.business_units:
        parts.append(
            "- In-scope business units: " + ", ".join(ctx.business_units[:20])
        )
    if ctx.committees:
        committee_lines = []
        for c in ctx.committees[:8]:
            line = f"  • {c['name']} (type: {c.get('type', 'custom')}, frequency: {c.get('frequency', 'unspecified')})"
            if c.get("chair_name"):
                line += f" — chaired by {c['chair_name']}"
            committee_lines.append(line)
        parts.append("- Governance committees configured for this tenant:")
        parts.extend(committee_lines)
    if ctx.roles:
        parts.append("- RBAC roles configured: " + ", ".join(ctx.roles[:15]))
    parts.append("")
    parts.append(
        "Wherever you reference the organisation, use its actual name. "
        "Wherever a section asks for committee or role names, use only the "
        "ones listed above; if no committee of the requested type exists, "
        "use the generic role label provided in the section instructions "
        "rather than fabricating a committee name."
    )
    return "\n".join(parts)


def _password_policy_block(ctx: TenantContextBundle) -> str:
    """Concrete numeric thresholds — emitted only when the section requests them."""
    p = ctx.password_policy
    if not p:
        return ""
    lines = ["CONFIGURED PASSWORD / SESSION POLICY THRESHOLDS — cite these numbers verbatim:"]
    lines.append(f"- Minimum password length: {p['min_length']}")
    classes = []
    if p["require_uppercase"]: classes.append("upper-case")
    if p["require_lowercase"]: classes.append("lower-case")
    if p["require_digit"]: classes.append("numeric")
    if p["require_special"]: classes.append("special")
    lines.append("- Required character classes: " + ", ".join(classes))
    lines.append(f"- Failed-login lockout threshold: {p['lockout_threshold']} attempts")
    lines.append(f"- Account lockout duration: {p['lockout_minutes']} minutes")
    lines.append(f"- Password history retention: last {p['password_history_count']} passwords")
    lines.append(f"- Maximum password age: {p['max_password_age_days']} days")
    lines.append(f"- Inactive session timeout: {p['session_idle_timeout_minutes']} minutes")
    return "\n".join(lines)


def _citations_block(citations: List[FrameworkCitation]) -> str:
    if not citations:
        return "FRAMEWORK CITATIONS — no specific clauses supplied for this topic; cite only frameworks in the active list and only where you are certain of the clause."
    lines = ["FRAMEWORK CITATIONS — cite these clauses inline when relevant. Use the bracketed format `[<Code> <Version>, clause <Ref>]`:"]
    for c in citations:
        lines.append(f"- {c.as_prompt_line()}")
    return "\n".join(lines)


def _active_codes_block(idx: FrameworkIndex) -> str:
    codes = idx.active_framework_codes()
    if not codes:
        return "ACTIVE FRAMEWORK SET — none. Avoid citing any framework codes."
    return (
        "ACTIVE FRAMEWORK SET — you may cite only these codes (never fabricate "
        "others): " + ", ".join(codes)
    )


# ─── Stage A: area plan ──────────────────────────────────────────────

def _clause_engine_sections(scaffold: DocScaffold) -> List[SectionSpec]:
    """Sections that drive the document's substantive clauses. Prefers the
    explicit `is_clause_engine` flag; falls back to the legacy heuristic so any
    scaffold that hasn't been migrated still behaves."""
    flagged = [s for s in scaffold.mandatory_sections if s.is_clause_engine]
    if flagged:
        return flagged
    return [s for s in scaffold.mandatory_sections if s.topic is None and s.min_clauses]


def _area(label: str, topic: Optional[str] = None, clause_refs: Optional[List[str]] = None) -> dict:
    return {"label": label, "topic": topic, "clause_refs": clause_refs}


def _humanize_topic(topic: Optional[str]) -> str:
    return (topic or "general").replace("_", " ").title()


def _resolve_focus_areas(focus_areas: List[str], target_clauses: Optional[List[str]] = None) -> List[dict]:
    """User-supplied focus areas → ordered, deduplicated area plan (explicit wins)."""
    out: List[dict] = []
    seen: set = set()
    for a in focus_areas:
        if not a or not str(a).strip():
            continue
        label = str(a).strip()
        topic = resolve_area_to_topic(label)
        key = (label.lower(), topic)
        if key in seen:
            continue
        seen.add(key)
        out.append(_area(label, topic, target_clauses))
    return out


def _areas_from_parent(parent_index: Optional[Dict[str, str]], parent_scope: Optional[List[str]]) -> List[dict]:
    """Derive the area plan from the parent's in-scope clauses (classified to topics)."""
    if parent_scope:
        refs = list(parent_scope)
    elif parent_index:
        refs = list(parent_index.keys())
    else:
        return []
    seen: set = set()
    out: List[dict] = []
    for ref in refs:
        text = (parent_index or {}).get(ref, "")
        topics = classify_topics(text) or ["governance_oversight"]
        topic = topics[0]
        if topic in seen:
            continue
        seen.add(topic)
        out.append(_area(_humanize_topic(topic), topic))
    return out


def _breadth_areas(scaffold: DocScaffold, idx: FrameworkIndex) -> List[dict]:
    """All cited areas, ordered by citation density — the broad-policy fan-out."""
    topics = idx.all_topics_with_hits() or list(scaffold.default_topic_hints)
    topics = sorted(topics, key=lambda t: len(idx.topics.get(t, [])), reverse=True)
    return [_area(_humanize_topic(t), t) for t in topics]


def _stage_outline(
    *,
    user_title: str,
    user_description: Optional[str],
    scaffold: DocScaffold,
    ctx: TenantContextBundle,
    idx: FrameworkIndex,
    parent_document_context: Optional[str],
    focus_areas: Optional[List[str]] = None,
    target_clauses: Optional[List[str]] = None,
    parent_scope: Optional[List[str]] = None,
    parent_index: Optional[Dict[str, str]] = None,
) -> Dict[str, List[dict]]:
    """Plan the clause-engine area(s) per section.

    Returns `{section_number: [area, ...]}` where area = {label, topic, clause_refs}.
    Precedence (explicit user/parent choice ALWAYS wins; the LLM only fills a gap):
      1. explicit `focus_areas` / `target_clauses`,
      2. the parent's in-scope areas (when a parent_index/scope is supplied),
      3. all cited areas (breadth scaffolds: Policy / Standard) — the multi-area fix,
      4. a single LLM-picked topic (focused scaffolds with no focus and no parent)
         — identical to today's behaviour, so single-area docs are unchanged.
    """
    clause_sections = _clause_engine_sections(scaffold)
    if not clause_sections:
        return {}

    resolved_focus = _resolve_focus_areas(focus_areas, target_clauses) if focus_areas else []
    parent_areas = _areas_from_parent(parent_index, parent_scope) if (parent_index or parent_scope) else []

    plan: Dict[str, List[dict]] = {}
    llm_pick: List[SectionSpec] = []
    for s in clause_sections:
        if resolved_focus:
            plan[s.number] = resolved_focus[:_MAX_CLAUSE_AREAS]
        elif parent_areas:
            plan[s.number] = parent_areas[:_MAX_CLAUSE_AREAS]
        elif scaffold.clause_engine_breadth:
            plan[s.number] = _breadth_areas(scaffold, idx)[:_MAX_CLAUSE_AREAS]
        else:
            llm_pick.append(s)

    if llm_pick:
        picks = _llm_single_topic_pick(
            sections=llm_pick, scaffold=scaffold, ctx=ctx, idx=idx,
            user_title=user_title, user_description=user_description,
            parent_document_context=parent_document_context,
        )
        for s in llm_pick:
            t = picks.get(s.number)
            plan[s.number] = [_area(_humanize_topic(t), t)] if t else []
    return plan


def _llm_single_topic_pick(
    *,
    sections: List[SectionSpec],
    scaffold: DocScaffold,
    ctx: TenantContextBundle,
    idx: FrameworkIndex,
    user_title: str,
    user_description: Optional[str],
    parent_document_context: Optional[str],
) -> Dict[str, str]:
    """Legacy Stage-A pick — one best topic per section. The gap-filler for a
    focused scaffold with no explicit focus and no parent scope (today's path)."""
    available_topics = idx.all_topics_with_hits() or scaffold.default_topic_hints
    if not available_topics:
        return {}
    open_section_block = "\n".join(f"- {s.number} {s.heading}" for s in sections)
    parent_block = ""
    if parent_document_context:
        parent_block = (
            "\n" + parent_document_context + "\n\n"
            + "OUTLINE RULE — when a parent document is supplied:\n"
            + "- Pick the topic that BEST surfaces the parent statements relevant "
            + "to each section.\n"
        )
    prompt = f"""Decide which governance topic each open-topic section of a {scaffold.label} should focus on.

Document title: {user_title}
Document description: {user_description or "(none supplied — infer from the title)"}

{_tenant_context_block(ctx, scaffold)}
{parent_block}
{_active_codes_block(idx)}

Available citation topics (chosen from the tenant's active frameworks):
{', '.join(available_topics)}

Open-topic sections to assign:
{open_section_block}

For each section, pick the single best topic from the list above. Return a JSON object of the form:
{{
  "<section_number>": "<topic_key>"
}}
Use exactly the topic keys from the available list. Do not invent new keys.
"""
    raw = _chat_json(
        prompt,
        system=(
            "You are an enterprise governance consultant planning a regulatory "
            "document. Return only valid JSON mapping section numbers to topic keys."
        ),
        temperature=0.2,
        max_tokens=600,
    )
    mapping: Dict[str, str] = {}
    if isinstance(raw, dict):
        for k, v in raw.items():
            if isinstance(v, str) and v in available_topics:
                mapping[str(k)] = v
    return mapping


# ─── Stage B: per-section expansion ──────────────────────────────────

def _parent_block(
    *,
    parent_clauses: Optional[List[Tuple[str, str]]],
    parent_document_context: Optional[str],
    scaffold: DocScaffold,
    enforce_full_coverage: bool,
) -> Optional[str]:
    """Build the parent-scope block for one section.

    Precedence: a per-section `parent_clauses` slice (only the relevant clauses,
    capped) is preferred; otherwise the legacy whole-document blob is injected
    unchanged (so existing callers are byte-for-byte identical).
    """
    if parent_clauses:
        lines = ["PARENT SCOPE — this document is SUBORDINATE to its parent. The "
                 "parent clauses IN SCOPE for this section are:"]
        used = 0
        budget = _PARENT_CLAUSE_CHAR_CAP
        for ref, text in parent_clauses[:_MAX_PARENT_CLAUSES_PER_SECTION]:
            snippet = (text or "").strip()
            if len(snippet) > 300:
                snippet = snippet[:300].rsplit(" ", 1)[0] + "…"
            entry = f"- [{ref}] {snippet}"
            if used + len(entry) > budget:
                break
            lines.append(entry)
            used += len(entry)
        body = "\n".join(lines)
    elif parent_document_context:
        body = parent_document_context
    else:
        return None

    coverage_verb = (
        "must explicitly operationalise every parent clause listed above that "
        "falls within its scope"
        if enforce_full_coverage
        else "should operationalise the parent clauses listed above that are "
        "relevant to this section (scope is intentionally narrowed — do not "
        "reach for parent statements outside the list)"
    )
    rule = (
        "PARENT COVERAGE RULE for this section:\n"
        f"- This section {coverage_verb}. "
        "When a parent statement is addressed, reference it inline using its code "
        "in brackets, e.g. `[PS-003]`.\n"
        f"- Because this document is a {scaffold.label}, translate each in-scope "
        "parent statement into the appropriate artefact (procedural step / "
        "mandatory requirement / implementation guidance / atomic clause). For a "
        "Procedure that means: trigger, prerequisites, roles, sequence, evidence, "
        "and exception handling.\n"
        "- Use the parent's terminology, role names, defined terms, and control "
        "objectives verbatim. Do not redefine or contradict them."
    )
    return body + "\n\n" + rule


# The two citation conventions, stated once and explicitly so the model never
# conflates a framework clause with a parent statement.
_CITATION_CONVENTIONS = (
    "CITATION CONVENTIONS — use EXACTLY these two formats, never mix them:\n"
    "- Framework clauses: `[<Code> <Version>, clause <Ref>]` "
    "(e.g. `[ISO/IEC 27001:2022, clause A.5.15]`). Cite ONLY codes in the active "
    "framework set and ONLY clause refs you were given.\n"
    "- Parent statements: `[PS-<n>]` (e.g. `[PS-003]`) — only for the parent "
    "clauses supplied above. Never invent a parent code."
)


def _build_section_prompt(
    *,
    section: SectionSpec,
    scaffold: DocScaffold,
    ctx: TenantContextBundle,
    idx: FrameworkIndex,
    resolved_topic: Optional[str],
    user_title: str,
    user_description: Optional[str],
    parent_document_context: Optional[str],
    correction_hint: Optional[str] = None,
    # ── additive: area / parent-slice / industry options ──
    citations: Optional[List[FrameworkCitation]] = None,
    parent_clauses: Optional[List[Tuple[str, str]]] = None,
    enforce_full_parent_coverage: bool = True,
    sub_number: Optional[str] = None,
    sub_label: Optional[str] = None,
    min_clauses_override: Optional[int] = None,
    min_words_override: Optional[int] = None,
    profile: Optional[Any] = None,
) -> str:
    """Build the per-section user prompt for Stage B.

    Backward-compatible: with none of the additive args supplied, this produces
    the same prompt as before — except that tenant context / configured numbers /
    citations now sit AFTER the craft block (closest to the output instruction)
    so configured/cited values win the model's attention over industry defaults.
    """
    topic = section.topic or resolved_topic
    if citations is None:
        citations = idx.slice(topic, limit=8) if topic else []
    exemplar = get_exemplar(topic)

    is_sub = bool(sub_number)
    heading_number = sub_number or section.number
    heading_text = f"{heading_number} {sub_label}" if is_sub else section.full_heading
    md_heading = f"### {heading_number} {sub_label}" if is_sub else f"## {section.full_heading}"
    min_clauses = min_clauses_override if min_clauses_override is not None else section.min_clauses
    min_words = min_words_override if min_words_override is not None else section.min_words

    parts: List[str] = []
    if is_sub:
        parts.append(
            f"Write the sub-section \"{sub_label}\" (numbered {heading_number}) of "
            f"section {section.full_heading} of a {scaffold.label} titled "
            f"\"{user_title}\" for {ctx.organisation_display}."
        )
    else:
        parts.append(
            f"Write section {section.full_heading} of a {scaffold.label} titled "
            f"\"{user_title}\" for {ctx.organisation_display}."
        )
    if user_description:
        parts.append(f"Document brief: {user_description}")

    parent_block = _parent_block(
        parent_clauses=parent_clauses,
        parent_document_context=parent_document_context,
        scaffold=scaffold,
        enforce_full_coverage=enforce_full_parent_coverage,
    )
    if parent_block:
        parts.append("")
        parts.append(parent_block)

    parts.append("")
    parts.append("SECTION INSTRUCTIONS:")
    parts.append(section.expansion_focus)
    parts.append(f"Target depth: at least {min_words} words for this {'sub-section' if is_sub else 'section'}.")
    if min_clauses:
        parts.append(
            f"Produce at least {min_clauses} numbered sub-clauses "
            f"({heading_number}.1, {heading_number}.2 … and where useful "
            f"{heading_number}.1.1)."
        )

    if exemplar:
        parts.append("")
        parts.append(
            "TONE / DEPTH EXEMPLAR — match this voice and density (do NOT copy "
            "the exemplar verbatim; use it as a reference for clause style only):"
        )
        parts.append(exemplar)

    # Enterprise SME craft block — banking-reality grounding + doc-type
    # characteristics, re-skinned to the tenant's industry (no-op for banks).
    parts.append("")
    parts.append(apply_industry(enterprise_drafting_block(scaffold.doc_type), profile))

    # ── Tenant context / configured numbers / citations come AFTER the craft
    # block so configured + cited values sit closest to the output instruction
    # and win the model's attention over the generic industry defaults above.
    parts.append("")
    parts.append(_tenant_context_block(ctx, scaffold))

    if section.inject_password_policy:
        pp_block = _password_policy_block(ctx)
        if pp_block:
            parts.append("")
            parts.append(pp_block)

    parts.append("")
    parts.append(_active_codes_block(idx))
    parts.append("")
    parts.append(_citations_block(citations))
    parts.append("")
    parts.append(_CITATION_CONVENTIONS)

    if correction_hint:
        parts.append("")
        parts.append("CORRECTION HINT (your previous attempt failed validation): " + correction_hint)

    parts.append("")
    parts.append(
        "Return a JSON object with a single key `content` whose value is the "
        f"full {'sub-section' if is_sub else 'section'} in markdown. Begin the "
        f"markdown with the heading line `{md_heading}`. Never use placeholder "
        "text like `[Insert ...]` or `Your Organization`. Never reference "
        "yourself as an AI. Never use the generic verbs `ensure`, `make sure`, "
        "`consider`, `where possible`, or `as appropriate` — replace each with a "
        "prescriptive verb and a named owner."
    )
    _ = heading_text  # (kept for readability/debugging)
    return "\n".join(parts)


def _citations_for_area(
    area: dict, idx: FrameworkIndex, target_clauses: Optional[List[str]] = None
) -> List[FrameworkCitation]:
    """Citations for one area: pinned clause refs win, else the area's topic slice."""
    refs = area.get("clause_refs") or target_clauses
    if refs:
        pinned = idx.slice_by_refs(refs, limit=12)
        if pinned:
            return pinned
    topic = area.get("topic")
    return idx.slice(topic, limit=8) if topic else []


def _parent_clauses_for_topic(
    topic: Optional[str],
    parent_index: Optional[Dict[str, str]],
    in_scope_refs: Optional[List[str]],
) -> Optional[List[Tuple[str, str]]]:
    """The in-scope parent clauses relevant to `topic` (None topic → all in scope)."""
    if not parent_index or not in_scope_refs:
        return None
    out: List[Tuple[str, str]] = []
    for ref in in_scope_refs:
        text = parent_index.get(ref, "")
        if topic is None or topic in (classify_topics(text)[:3] or []):
            out.append((ref, text))
    return out or None


def _stage_expand_section(
    *,
    section: SectionSpec,
    scaffold: DocScaffold,
    ctx: TenantContextBundle,
    idx: FrameworkIndex,
    resolved_topic: Optional[str],
    user_title: str,
    user_description: Optional[str],
    parent_document_context: Optional[str],
    correction_hint: Optional[str] = None,
    citations: Optional[List[FrameworkCitation]] = None,
    parent_clauses: Optional[List[Tuple[str, str]]] = None,
    enforce_full_parent_coverage: bool = True,
    sub_number: Optional[str] = None,
    sub_label: Optional[str] = None,
    min_clauses_override: Optional[int] = None,
    min_words_override: Optional[int] = None,
    profile: Optional[Any] = None,
) -> str:
    """Run a single section (or sub-area) call. Returns the markdown body."""
    prompt = _build_section_prompt(
        section=section,
        scaffold=scaffold,
        ctx=ctx,
        idx=idx,
        resolved_topic=resolved_topic,
        user_title=user_title,
        user_description=user_description,
        parent_document_context=parent_document_context,
        correction_hint=correction_hint,
        citations=citations,
        parent_clauses=parent_clauses,
        enforce_full_parent_coverage=enforce_full_parent_coverage,
        sub_number=sub_number,
        sub_label=sub_label,
        min_clauses_override=min_clauses_override,
        min_words_override=min_words_override,
        profile=profile,
    )
    eff_min_clauses = min_clauses_override if min_clauses_override is not None else (section.min_clauses or 0)
    # Larger sections (statements, procedure steps) deserve more token budget.
    max_tokens = 4000 if eff_min_clauses >= 10 else 2200
    # System prompt = the scaffold's per-doc-type voice + the universal SME
    # addendum, re-skinned to the tenant's industry (no-op for banks).
    raw = _chat_json(
        prompt,
        system=apply_industry(scaffold.prompt_voice + SME_SYSTEM_ADDENDUM, profile),
        temperature=0.5,
        max_tokens=max_tokens,
    )
    content = raw.get("content") if isinstance(raw, dict) else None
    if not content or not isinstance(content, str):
        # Stub on failure so the document still renders coherently.
        heading = f"### {sub_number} {sub_label}" if sub_number else f"## {section.full_heading}"
        return (
            f"{heading}\n\n"
            f"*This section could not be generated automatically and requires manual completion.*\n"
        )
    return content.strip()


def _stage_expand_clause_engine(
    *,
    section: SectionSpec,
    areas: List[dict],
    scaffold: DocScaffold,
    ctx: TenantContextBundle,
    idx: FrameworkIndex,
    user_title: str,
    user_description: Optional[str],
    parent_document_context: Optional[str],
    parent_index: Optional[Dict[str, str]],
    in_scope_refs: Optional[List[str]],
    target_clauses: Optional[List[str]],
    enforce_full_parent_coverage: bool,
    profile: Optional[Any],
    correction_hint: Optional[str] = None,
) -> str:
    """Expand the clause engine. One area → today's single call (no sub-headings);
    multiple areas → one sub-section per area, assembled under one section heading."""
    if len(areas) <= 1:
        area = areas[0] if areas else _area(_humanize_topic(section.topic), section.topic)
        return _stage_expand_section(
            section=section, scaffold=scaffold, ctx=ctx, idx=idx,
            resolved_topic=area.get("topic"), user_title=user_title,
            user_description=user_description,
            parent_document_context=parent_document_context,
            correction_hint=correction_hint,
            citations=_citations_for_area(area, idx, target_clauses),
            parent_clauses=_parent_clauses_for_topic(area.get("topic"), parent_index, in_scope_refs),
            enforce_full_parent_coverage=enforce_full_parent_coverage,
            profile=profile,
        )
    per_area_clauses = max((section.min_clauses or 0) // len(areas), 4)
    per_area_words = max((section.min_words or 0) // len(areas), 150)
    blocks: List[str] = [f"## {section.full_heading}\n"]
    for i, area in enumerate(areas, start=1):
        body = _stage_expand_section(
            section=section, scaffold=scaffold, ctx=ctx, idx=idx,
            resolved_topic=area.get("topic"), user_title=user_title,
            user_description=user_description,
            parent_document_context=parent_document_context,
            correction_hint=correction_hint,
            citations=_citations_for_area(area, idx, target_clauses),
            parent_clauses=_parent_clauses_for_topic(area.get("topic"), parent_index, in_scope_refs),
            enforce_full_parent_coverage=enforce_full_parent_coverage,
            sub_number=f"{section.number}.{i}",
            sub_label=area.get("label"),
            min_clauses_override=per_area_clauses,
            min_words_override=per_area_words,
            profile=profile,
        )
        blocks.append(body)
    return "\n\n".join(blocks)


# ─── Stage C: deterministic metadata + annexures ─────────────────────

def _stage_metadata_and_annexures(
    *,
    scaffold: DocScaffold,
    ctx: TenantContextBundle,
    idx: FrameworkIndex,
    user_title: str,
    document_owner_name: Optional[str],
) -> Dict[str, str]:
    """Assemble structural front-matter and revision history with no LLM call."""
    # Timezone-aware + leap-day safe: `.replace(year=year+1)` raises on Feb 29
    # (no Feb 29 next year). timedelta(days=365) never does.
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    one_year = (now + timedelta(days=365)).strftime("%Y-%m-%d")

    org = ctx.organisation_display
    owner = document_owner_name or ctx.primary_contact_name or "Information Security Function"

    # ── Document Description table ───────────────────────────────────
    doc_desc = (
        f"## 1. Document Description\n\n"
        f"| Field | Value |\n"
        f"|---|---|\n"
        f"| Document Title | {user_title} |\n"
        f"| Owning Organisation | {org} |\n"
        f"| Document Owner | {owner} |\n"
        f"| Document Classification | Internal |\n"
        f"| Version | 1.0 |\n"
        f"| Effective Date | {today} |\n"
        f"| Next Review Date | {one_year} |\n"
        f"| Approval Authority | {_format_approval_authority(scaffold, ctx)} |\n"
        f"| Distribution Scope | All personnel of {org}, contractors, and applicable third parties |\n"
    )

    # ── Approval Signoff page ────────────────────────────────────────
    rows = ["| Role | Name | Designation | Signature / Date |", "|---|---|---|---|"]
    for tier in scaffold.approval_matrix:
        committee = ctx.find_committee(*tier.committee_types) if tier.committee_types else None
        role_label = committee["name"] if committee else tier.role_hint
        name_cell = committee.get("chair_name") if committee else ""
        if not name_cell and tier.label == "Prepared by":
            name_cell = ctx.primary_contact_name or ""
        rows.append(f"| {tier.label} | {name_cell or '___________________'} | {role_label} | ___________________ |")
    approval = "## 2. Approval Signoff\n\n" + "\n".join(rows) + "\n"

    return {
        "1": doc_desc,
        "2": approval,
    }


def _format_approval_authority(scaffold: DocScaffold, ctx: TenantContextBundle) -> str:
    """Pick the strongest available authority tier for the metadata header."""
    for tier in reversed(scaffold.approval_matrix):
        if tier.committee_types:
            c = ctx.find_committee(*tier.committee_types)
            if c:
                return c["name"]
        if tier.role_hint:
            return tier.role_hint
    return "Information Security Steering Committee"


# ─── Stage D: QA + targeted regeneration ─────────────────────────────

def _stage_qa(
    sections: Dict[str, dict],
    *,
    scaffold: DocScaffold,
    idx: FrameworkIndex,
    structural_numbers: frozenset = frozenset(),
) -> Dict[str, SectionQAResult]:
    """Validate every non-structural section.

    Structural front-matter (Document Description, Approval Signoff) is rendered
    deterministically from tenant context, so it is skipped — running prose QA
    over a markdown table only produces noise.
    """
    results: Dict[str, SectionQAResult] = {}
    active_codes = idx.active_framework_codes()
    known_refs = idx.known_clause_refs()
    for section in scaffold.mandatory_sections:
        if section.number in structural_numbers:
            continue
        body = sections.get(section.number, {}).get("content", "")
        results[section.number] = validate_section(
            section, body, active_codes, known_clause_refs=known_refs
        )
    return results


# ─── Parent coverage matrix + cross-section consistency (items 4 & 7) ─────────

_PS_REF_RE = re.compile(r"\[([A-Za-z]+-[A-Za-z0-9.\-]+)\]")


def _count_parent_statements(parent_document_context: Optional[str]) -> int:
    """Count distinct `[PS-…]` style parent statement codes in the legacy blob."""
    if not parent_document_context:
        return 0
    return len({m.lower() for m in _PS_REF_RE.findall(parent_document_context)})


def _build_coverage_matrix(
    *,
    in_scope_refs: List[str],
    parent_index: Optional[Dict[str, str]],
    sections_payload: Dict[str, dict],
    scaffold_label: str,
) -> Tuple[Optional[str], List[str]]:
    """Traceability annex: parent clause → section(s) that operationalise it →
    coverage status. Returns (markdown, list_of_uncovered_refs)."""
    if not in_scope_refs:
        return None, []
    coverage: Dict[str, List[str]] = {r: [] for r in in_scope_refs}
    for num, sec in sections_payload.items():
        found = {m.lower() for m in _PS_REF_RE.findall(sec.get("content", "") or "")}
        for r in in_scope_refs:
            if r.lower() in found:
                coverage[r].append(num)
    rows = [
        "## Annex — Parent Coverage Matrix",
        "",
        f"Traceability of every in-scope parent clause to the {scaffold_label} "
        "content that operationalises it, and the evidence each produces.",
        "",
        "| Parent Clause | Parent Statement | Operationalised In | Coverage |",
        "|---|---|---|---|",
    ]
    uncovered: List[str] = []
    for r in in_scope_refs:
        stmt = (parent_index or {}).get(r, "") or ""
        if len(stmt) > 120:
            stmt = stmt[:120].rsplit(" ", 1)[0] + "…"
        secs = coverage[r]
        if secs:
            where = ", ".join(f"§{s}" for s in secs)
            status = "Covered"
        else:
            where = "—"
            status = "**Not covered**"
            uncovered.append(r)
        rows.append(f"| {r} | {stmt or '—'} | {where} | {status} |")
    covered = len(in_scope_refs) - len(uncovered)
    rows.append("")
    rows.append(f"Coverage: {covered}/{len(in_scope_refs)} in-scope parent clauses operationalised.")
    return "\n".join(rows), uncovered


def _cross_section_findings(sections_payload: Dict[str, dict]) -> List[str]:
    """Light, non-mutating consistency pass — flags (does not edit) duplicate
    clauses across sections and contradictory numeric thresholds."""
    findings: List[str] = []

    # 1. Duplicate clause lines across different sections.
    seen: Dict[str, str] = {}
    dups: List[Tuple[str, str]] = []
    for num, sec in sections_payload.items():
        for line in (sec.get("content", "") or "").splitlines():
            stripped = re.sub(r"^[\s>*\-]*\d+(?:\.\d+)*\.?\s*", "", line.strip()).strip()
            if len(stripped) < 40:
                continue
            norm = re.sub(r"\s+", " ", stripped.lower())[:160]
            if norm in seen and seen[norm] != num:
                dups.append((seen[norm], num))
            else:
                seen.setdefault(norm, num)
    if dups:
        pairs = sorted({f"sections {a} & {b}" for a, b in dups})[:6]
        findings.append("possible duplicate clauses across sections: " + ", ".join(pairs))

    # 2. Contradictory numeric thresholds (heuristic — password min length).
    nums: Dict[str, set] = {}
    for sec in sections_payload.values():
        body = sec.get("content", "") or ""
        for m in re.finditer(r"minimum (?:password )?length[^.\n]*?(\d{1,3})", body, re.I):
            nums.setdefault("minimum password length", set()).add(m.group(1))
    contradictions = [k for k, v in nums.items() if len(v) > 1]
    if contradictions:
        findings.append(
            "contradictory numeric thresholds: "
            + "; ".join(f"{k} = {sorted(nums[k])}" for k in contradictions)
        )
    return findings


# ─── Public entry point ──────────────────────────────────────────────

def run_drafting_pipeline(
    *,
    doc_type: str,
    title: str,
    description: Optional[str],
    tenant_context: TenantContextBundle,
    framework_index: FrameworkIndex,
    parent_document_context: Optional[str] = None,
    document_owner_name: Optional[str] = None,
    progress_callback: ProgressCallback = None,
    # ── additive scoping params (all default None → current behaviour) ──
    focus_areas: Optional[List[str]] = None,
    target_clauses: Optional[List[str]] = None,
    parent_scope: Optional[List[str]] = None,
    parent_index: Optional[Dict[str, str]] = None,
) -> DraftResult:
    """Execute the multi-stage drafting pipeline.

    The caller builds `tenant_context` and `framework_index`. Everything else —
    Stage A through D — happens here.

    Additive scoping (all optional; None preserves today's behaviour):
      * `focus_areas`     — user-selected areas/clauses that DRIVE the clause
        engine's area plan (explicit choice always wins over the LLM).
      * `target_clauses`  — specific framework clause refs to pin the citation
        slice to.
      * `parent_index`    — {parent_clause_ref: statement_text}; enables
        per-section parent slicing and a coverage matrix instead of a blob.
      * `parent_scope`    — the subset of parent clause refs this child targets;
        restricts the area plan, slices, and coverage rule to that subset.
    """
    scaffold = get_scaffold(doc_type)
    profile = tenant_context.industry_profile()
    telemetry: Dict[str, Any] = {"stages": []}
    warnings: List[str] = []

    in_scope_refs: List[str] = (
        list(parent_scope) if parent_scope
        else (list(parent_index.keys()) if parent_index else [])
    )
    has_parent = bool(parent_index or parent_document_context)
    is_scoped = bool(parent_scope or focus_areas or target_clauses)
    parent_clause_count = len(parent_index) if parent_index else _count_parent_statements(parent_document_context)
    # A focused doc (Procedure/Guideline/Charter) built against a BROAD parent
    # with no scope is ambiguous — don't force "operationalise EVERY statement";
    # surface a warning recommending the caller scope it.
    broad_unscoped = (
        has_parent and not is_scoped and not scaffold.clause_engine_breadth
        and parent_clause_count > _BROAD_PARENT_THRESHOLD
    )
    enforce_full_parent = not broad_unscoped
    if broad_unscoped:
        warnings.append(
            f"Parent scope is ambiguous: the parent has {parent_clause_count} statements "
            f"and no scope was supplied for this {scaffold.label}. A {scaffold.label} should "
            "operationalise ONE process — pass `parent_scope` (or `focus_areas`/`target_clauses`) "
            "to scope it to the relevant parent clauses."
        )

    def _emit(stage: str, **extras: Any) -> None:
        if progress_callback is None:
            return
        try:
            progress_callback(stage, extras)
        except Exception:
            logger.exception("progress_callback failed (non-fatal)")

    # ── Stage A — area plan ──────────────────────────────────────────
    _emit("outline", status="in_progress")
    telemetry["stages"].append({"stage": "outline", "status": "in_progress"})
    area_plan = _stage_outline(
        user_title=title,
        user_description=description,
        scaffold=scaffold,
        ctx=tenant_context,
        idx=framework_index,
        parent_document_context=parent_document_context,
        focus_areas=focus_areas,
        target_clauses=target_clauses,
        parent_scope=parent_scope,
        parent_index=parent_index,
    )
    telemetry["stages"][-1]["status"] = "done"
    telemetry["stages"][-1]["area_plan"] = {
        num: [a.get("label") for a in areas] for num, areas in area_plan.items()
    }
    _emit("outline", status="done", area_plan_size=len(area_plan))

    # ── Stage C (structural front-matter — early so Stage B can't override) ──
    structural = _stage_metadata_and_annexures(
        scaffold=scaffold,
        ctx=tenant_context,
        idx=framework_index,
        user_title=title,
        document_owner_name=document_owner_name,
    )
    structural_numbers = frozenset(structural.keys())

    # One callable per section so the pool can branch clause-engine vs normal.
    def _expand_one(s: SectionSpec) -> str:
        if s.is_clause_engine:
            return _stage_expand_clause_engine(
                section=s, areas=area_plan.get(s.number, []),
                scaffold=scaffold, ctx=tenant_context, idx=framework_index,
                user_title=title, user_description=description,
                parent_document_context=parent_document_context,
                parent_index=parent_index, in_scope_refs=in_scope_refs,
                target_clauses=target_clauses,
                enforce_full_parent_coverage=enforce_full_parent, profile=profile,
            )
        return _stage_expand_section(
            section=s, scaffold=scaffold, ctx=tenant_context, idx=framework_index,
            resolved_topic=None, user_title=title, user_description=description,
            parent_document_context=parent_document_context,
            parent_clauses=_parent_clauses_for_topic(s.topic, parent_index, in_scope_refs),
            enforce_full_parent_coverage=enforce_full_parent, profile=profile,
        )

    # ── Stage B (parallel section expansion) ─────────────────────────
    sections_payload: Dict[str, dict] = {}
    expandable = [s for s in scaffold.mandatory_sections if s.number not in structural]
    sections_total = len(expandable)
    sections_done = 0
    _emit("expand_sections", status="in_progress", sections_total=sections_total, sections_completed=0)
    telemetry["stages"].append({
        "stage": "expand_sections", "status": "in_progress", "sections_total": sections_total,
    })

    with ThreadPoolExecutor(max_workers=_STAGE_B_PARALLELISM) as pool:
        future_map = {pool.submit(_expand_one, s): s for s in expandable}
        for future in as_completed(future_map):
            s = future_map[future]
            sections_payload[s.number] = {"heading": s.full_heading, "content": future.result()}
            sections_done += 1
            _emit(
                "expand_sections", status="in_progress",
                sections_total=sections_total, sections_completed=sections_done,
                last_section=s.full_heading,
            )

    # Merge in the structural sections (1, 2).
    for num, body in structural.items():
        spec = next((s for s in scaffold.mandatory_sections if s.number == num), None)
        sections_payload[num] = {
            "heading": spec.full_heading if spec else f"{num}.",
            "content": body,
        }

    telemetry["stages"][-1]["status"] = "done"
    telemetry["stages"][-1]["sections"] = len(sections_payload)
    _emit("expand_sections", status="done", sections_total=sections_total, sections_completed=sections_done)

    # ── Stage D — QA + one targeted regeneration pass ────────────────
    _emit("qa", status="in_progress")
    telemetry["stages"].append({"stage": "qa", "status": "in_progress"})
    qa_results = _stage_qa(
        sections_payload, scaffold=scaffold, idx=framework_index,
        structural_numbers=structural_numbers,
    )
    failed_sections = [
        s for s in scaffold.mandatory_sections
        if s.number not in structural_numbers and not qa_results[s.number].ok
    ]
    if failed_sections:
        telemetry["stages"][-1]["regenerating"] = [s.number for s in failed_sections]
        _emit("qa", status="regenerating", failing_sections=len(failed_sections))
        known_refs = framework_index.known_clause_refs()
        for s in failed_sections:
            hint = regeneration_hint(qa_results[s.number])
            new_content = _expand_one(s) if not hint else _regenerate_section(
                section=s, hint=hint, scaffold=scaffold, ctx=tenant_context,
                idx=framework_index, area_plan=area_plan, title=title,
                description=description, parent_document_context=parent_document_context,
                parent_index=parent_index, in_scope_refs=in_scope_refs,
                target_clauses=target_clauses, enforce_full_parent=enforce_full_parent,
                profile=profile,
            )
            sections_payload[s.number] = {"heading": s.full_heading, "content": new_content}
        for s in failed_sections:
            qa_results[s.number] = validate_section(
                s, sections_payload[s.number]["content"],
                framework_index.active_framework_codes(), known_clause_refs=known_refs,
            )
    telemetry["stages"][-1]["status"] = "done"
    _emit("qa", status="done", regenerated=len(failed_sections))

    # ── Cross-section consistency (item 7) — flag only, never edit ────
    cross = _cross_section_findings(sections_payload)
    if cross:
        telemetry["cross_section"] = cross
        warnings.extend(cross)

    # ── Warn-level QA citation issues surface as warnings ────────────
    for s in scaffold.mandatory_sections:
        res = qa_results.get(s.number)
        if res and res.warnings:
            warnings.append(f"Section {s.number}: " + "; ".join(res.warnings))

    # ── Assemble final markdown ──────────────────────────────────────
    ordered_sections = []
    body_parts: List[str] = []
    for s in scaffold.mandatory_sections:
        sec = sections_payload.get(s.number)
        if not sec:
            continue
        qa = qa_results.get(s.number)
        ordered_sections.append({
            "number": s.number,
            "heading": sec["heading"],
            "content": sec["content"],
            "qa": {
                "ok": qa.ok if qa else True,
                "word_count": qa.word_count if qa else 0,
                "issues": qa.failure_summary() if qa else None,
                "warnings": qa.warning_summary() if qa else None,
            },
        })
        body_parts.append(sec["content"])

    # ── Parent coverage matrix annex (item 4) — procedure/standard w/ a parent index ──
    if scaffold.doc_type in ("procedure", "standard") and in_scope_refs and parent_index:
        matrix_md, uncovered = _build_coverage_matrix(
            in_scope_refs=in_scope_refs, parent_index=parent_index,
            sections_payload=sections_payload, scaffold_label=scaffold.label,
        )
        if matrix_md:
            body_parts.append(matrix_md)
            ordered_sections.append({
                "number": "PCM", "heading": "Annex — Parent Coverage Matrix",
                "content": matrix_md, "qa": {"ok": True, "word_count": 0, "issues": None, "warnings": None},
            })
            telemetry["parent_coverage"] = {"in_scope": len(in_scope_refs), "uncovered": uncovered}
            if uncovered:
                warnings.append(
                    f"{len(uncovered)} in-scope parent clause(s) not operationalised: "
                    + ", ".join(uncovered[:10])
                )

    title_line = f"# {title}\n\n*Owned by {tenant_context.organisation_display}*\n"
    full_markdown = title_line + "\n\n" + "\n\n".join(body_parts)

    framework_alignment = [
        {
            "framework": fw["name"],
            "code": fw["code"],
            "version": fw["version"],
            "regulator": fw["regulator"],
            "controls": [
                c.control_ref for citations in framework_index.topics.values() for c in citations
                if c.framework_code == fw["code"]
            ][:30],
        }
        for fw in framework_index.framework_summaries
    ]

    qa_failures = [
        {
            "section": s.number,
            "heading": s.heading,
            "issue": qa_results[s.number].failure_summary(),
        }
        for s in scaffold.mandatory_sections
        if s.number not in structural_numbers and not qa_results[s.number].ok
    ]

    word_count = len(full_markdown.split())

    return DraftResult(
        title=title,
        doc_type=scaffold.doc_type,
        generated_content=full_markdown,
        sections=ordered_sections,
        framework_alignment=framework_alignment,
        word_count=word_count,
        qa_failures=qa_failures,
        stage_telemetry=telemetry,
        warnings=warnings,
    )


def _regenerate_section(
    *,
    section: SectionSpec,
    hint: str,
    scaffold: DocScaffold,
    ctx: TenantContextBundle,
    idx: FrameworkIndex,
    area_plan: Dict[str, List[dict]],
    title: str,
    description: Optional[str],
    parent_document_context: Optional[str],
    parent_index: Optional[Dict[str, str]],
    in_scope_refs: List[str],
    target_clauses: Optional[List[str]],
    enforce_full_parent: bool,
    profile: Optional[Any],
) -> str:
    """Regenerate one failing section with the QA correction hint, preserving its
    area plan / parent slice. For a multi-area clause engine the hint is applied
    to every area sub-call."""
    if section.is_clause_engine:
        return _stage_expand_clause_engine(
            section=section, areas=area_plan.get(section.number, []),
            scaffold=scaffold, ctx=ctx, idx=idx, user_title=title,
            user_description=description, parent_document_context=parent_document_context,
            parent_index=parent_index, in_scope_refs=in_scope_refs,
            target_clauses=target_clauses, enforce_full_parent_coverage=enforce_full_parent,
            profile=profile, correction_hint=hint,
        )
    return _stage_expand_section(
        section=section, scaffold=scaffold, ctx=ctx, idx=idx, resolved_topic=None,
        user_title=title, user_description=description,
        parent_document_context=parent_document_context,
        parent_clauses=_parent_clauses_for_topic(section.topic, parent_index, in_scope_refs),
        enforce_full_parent_coverage=enforce_full_parent, profile=profile, correction_hint=hint,
    )
