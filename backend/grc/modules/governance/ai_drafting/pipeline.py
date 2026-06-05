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

import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional


# A progress callback receives `(stage, detail_dict)` whenever the pipeline
# crosses a stage boundary OR completes one section in Stage B. The caller
# (Celery task) persists these to Redis so the frontend can poll real
# state instead of guessing from elapsed time.
ProgressCallback = Optional[Callable[[str, Dict[str, Any]], None]]

from fastapi import HTTPException, status
from openai import OpenAI

from .enterprise_craft import (
    SME_SYSTEM_ADDENDUM,
    enterprise_drafting_block,
)
from .exemplars import get_exemplar
from .framework_index import FrameworkCitation, FrameworkIndex
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
_OPENAI_FALLBACK_MODEL = os.environ.get("OPENAI_DRAFT_FALLBACK_MODEL", "gpt-4o")

_STAGE_B_PARALLELISM = int(os.environ.get("AI_DRAFT_PARALLELISM", "4"))


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


# ─── Stage A: outline ────────────────────────────────────────────────

def _stage_outline(
    *,
    user_title: str,
    user_description: Optional[str],
    scaffold: DocScaffold,
    ctx: TenantContextBundle,
    idx: FrameworkIndex,
    parent_document_context: Optional[str],
) -> Dict[str, str]:
    """Ask the LLM which topic each open-topic section should focus on.

    Returns a `{section_number: topic_key}` map. Sections with a fixed
    topic in the scaffold ignore the suggestion.
    """
    open_sections = [s for s in scaffold.mandatory_sections if s.topic is None and s.min_clauses]
    if not open_sections:
        return {}

    available_topics = idx.all_topics_with_hits() or scaffold.default_topic_hints
    if not available_topics:
        return {}

    open_section_block = "\n".join(
        f"- {s.number} {s.heading}" for s in open_sections
    )

    # When a parent document is supplied, the outline MUST be driven by what
    # the parent actually requires — otherwise Stage A picks generic topics
    # and the child document drifts from its parent's intent. We surface the
    # parent block to the outliner and tell it to weight parent statements
    # over generic framework hits when both could fit.
    parent_block = ""
    if parent_document_context:
        parent_block = (
            "\n"
            + parent_document_context
            + "\n\n"
            + "OUTLINE RULE — when a parent document is supplied:\n"
            + "- Every open-topic section's assigned topic must collectively cover "
            + "every parent policy statement. Pick the topic that BEST surfaces the "
            + "statements that aren't already covered by a fixed-topic section.\n"
            + "- Two sections can share a topic only if no single topic is enough "
            + "to cover all the parent's statements in that area.\n"
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
  "<section_number>": "<topic_key>",
  ...
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
) -> str:
    """Build the per-section user prompt for Stage B."""
    topic = section.topic or resolved_topic
    citations = idx.slice(topic, limit=8) if topic else []
    exemplar = get_exemplar(topic)

    parts: List[str] = []
    parts.append(
        f"Write section {section.full_heading} of a {scaffold.label} titled "
        f"\"{user_title}\" for {ctx.organisation_display}."
    )
    if user_description:
        parts.append(f"Document brief: {user_description}")
    if parent_document_context:
        # The parent context block already self-describes ("PARENT DOCUMENT
        # — the document being drafted is SUBORDINATE to this …") and
        # enumerates policy statements one per line. Emit it verbatim, then
        # add a hard rule that this section must explicitly map its content
        # back to the parent's requirements. Without this rule the LLM
        # treats the parent block as background colour and drifts.
        parts.append(parent_document_context)
        parts.append("")
        parts.append(
            "PARENT COVERAGE RULE — non-negotiable for this section:\n"
            "- This section must explicitly operationalise every parent policy "
            "statement that falls within its scope. Do not silently skip any "
            "applicable statement, even if it overlaps with another section.\n"
            "- When a parent statement is addressed, reference it inline using "
            "its code in brackets, e.g. `[PS-003]`. Multiple statements per "
            "clause are fine; missing-coverage clauses are not.\n"
            f"- Because this document is a {scaffold.label}, every parent "
            f"statement that is in scope for this section must be translated "
            f"into the appropriate artefact type "
            f"(procedural step / mandatory requirement / implementation "
            f"guidance / atomic policy clause). End-to-end means: trigger, "
            f"prerequisites, roles, sequence, evidence, exception handling — "
            f"for procedures specifically.\n"
            "- Use the parent's terminology, role names, defined terms, and "
            "control objectives verbatim. Do not redefine or contradict them."
        )

    parts.append("")
    parts.append("SECTION INSTRUCTIONS:")
    parts.append(section.expansion_focus)
    parts.append(f"Target depth: at least {section.min_words} words for this section.")
    if section.min_clauses:
        parts.append(
            f"Produce at least {section.min_clauses} numbered sub-clauses "
            f"({section.number}.1, {section.number}.2 … and where useful "
            f"{section.number}.1.1)."
        )
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

    if exemplar:
        parts.append("")
        parts.append(
            "TONE / DEPTH EXEMPLAR — match this voice and density (do NOT copy "
            "the exemplar verbatim; use it as a reference for clause style only):"
        )
        parts.append(exemplar)

    # Enterprise SME craft block — banking-reality grounding + doc-type
    # characteristics. This is the difference between "generic LLM
    # governance copy" and "what a senior bank SME actually writes".
    # Goes near the end so it stays close to the model's attention when
    # generating the final tokens.
    parts.append("")
    parts.append(enterprise_drafting_block(scaffold.doc_type))

    if correction_hint:
        parts.append("")
        parts.append("CORRECTION HINT (your previous attempt failed validation): " + correction_hint)

    parts.append("")
    parts.append(
        "Return a JSON object with a single key `content` whose value is the "
        "full section in markdown. Begin the markdown with the heading line "
        f"`## {section.full_heading}`. Never use placeholder text like "
        "`[Insert ...]` or `Your Organization`. Never reference yourself as "
        "an AI. Never use the generic verbs `ensure`, `make sure`, `consider`, "
        "`where possible`, or `as appropriate` — replace each with a "
        "prescriptive verb and a named owner."
    )
    return "\n".join(parts)


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
) -> str:
    """Run a single section call. Returns the section's markdown body."""
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
    )
    # Larger sections (statements, procedure steps) deserve more token budget.
    max_tokens = 4000 if (section.min_clauses or 0) >= 10 else 2200
    # System prompt = the scaffold's per-doc-type voice (e.g. "senior security
    # architect authoring a mandatory technical standard") + the universal
    # banking-SME addendum so the model anchors to a real bank reviewer's tone
    # before it ever reads the user prompt.
    raw = _chat_json(
        prompt,
        system=scaffold.prompt_voice + SME_SYSTEM_ADDENDUM,
        temperature=0.5,
        max_tokens=max_tokens,
    )
    content = raw.get("content") if isinstance(raw, dict) else None
    if not content or not isinstance(content, str):
        # Stub on failure so the document still renders coherently.
        return (
            f"## {section.full_heading}\n\n"
            f"*This section could not be generated automatically and requires manual completion.*\n"
        )
    return content.strip()


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
    today = datetime.utcnow().strftime("%Y-%m-%d")
    one_year = datetime.utcnow().replace(year=datetime.utcnow().year + 1).strftime("%Y-%m-%d")

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
) -> Dict[str, SectionQAResult]:
    results: Dict[str, SectionQAResult] = {}
    active_codes = idx.active_framework_codes()
    for section in scaffold.mandatory_sections:
        body = sections.get(section.number, {}).get("content", "")
        results[section.number] = validate_section(section, body, active_codes)
    return results


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
) -> DraftResult:
    """Execute the multi-stage drafting pipeline.

    The caller (router) is responsible for building `tenant_context` and
    `framework_index`. Everything else — Stage A through D — happens here.

    `progress_callback` is called on every stage transition + after each
    Stage B section completes. Signature: `cb(stage, detail_dict)`. Used
    by the Celery async job to write polling state to Redis.
    """
    scaffold = get_scaffold(doc_type)
    telemetry: Dict[str, Any] = {"stages": []}

    def _emit(stage: str, **extras: Any) -> None:
        if progress_callback is None:
            return
        try:
            progress_callback(stage, extras)
        except Exception:
            logger.exception("progress_callback failed (non-fatal)")

    # ── Stage A ──────────────────────────────────────────────────────
    _emit("outline", status="in_progress")
    telemetry["stages"].append({"stage": "outline", "status": "in_progress"})
    topic_map = _stage_outline(
        user_title=title,
        user_description=description,
        scaffold=scaffold,
        ctx=tenant_context,
        idx=framework_index,
        parent_document_context=parent_document_context,
    )
    telemetry["stages"][-1]["status"] = "done"
    telemetry["stages"][-1]["topic_map"] = topic_map
    _emit("outline", status="done", topic_map_size=len(topic_map))

    # ── Stage C (structural front-matter — done early so Stage B has nothing to override) ──
    structural = _stage_metadata_and_annexures(
        scaffold=scaffold,
        ctx=tenant_context,
        idx=framework_index,
        user_title=title,
        document_owner_name=document_owner_name,
    )

    # ── Stage B (parallel section expansion) ─────────────────────────
    sections_payload: Dict[str, dict] = {}
    expandable = [s for s in scaffold.mandatory_sections if s.number not in structural]
    sections_total = len(expandable)
    sections_done = 0
    _emit(
        "expand_sections",
        status="in_progress",
        sections_total=sections_total,
        sections_completed=0,
    )
    telemetry["stages"].append({
        "stage": "expand_sections", "status": "in_progress",
        "sections_total": sections_total,
    })

    with ThreadPoolExecutor(max_workers=_STAGE_B_PARALLELISM) as pool:
        future_map = {
            pool.submit(
                _stage_expand_section,
                section=s,
                scaffold=scaffold,
                ctx=tenant_context,
                idx=framework_index,
                resolved_topic=topic_map.get(s.number),
                user_title=title,
                user_description=description,
                parent_document_context=parent_document_context,
            ): s
            for s in expandable
        }
        for future in as_completed(future_map):
            s = future_map[future]
            content = future.result()
            sections_payload[s.number] = {
                "heading": s.full_heading,
                "content": content,
            }
            sections_done += 1
            _emit(
                "expand_sections",
                status="in_progress",
                sections_total=sections_total,
                sections_completed=sections_done,
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
    _emit(
        "expand_sections",
        status="done",
        sections_total=sections_total,
        sections_completed=sections_done,
    )

    # ── Stage D — QA + one targeted regeneration pass ────────────────
    _emit("qa", status="in_progress")
    telemetry["stages"].append({"stage": "qa", "status": "in_progress"})
    qa_results = _stage_qa(sections_payload, scaffold=scaffold, idx=framework_index)
    failed_sections = [
        s for s in scaffold.mandatory_sections
        if s.number not in structural and not qa_results[s.number].ok
    ]
    if failed_sections:
        telemetry["stages"][-1]["regenerating"] = [s.number for s in failed_sections]
        _emit("qa", status="regenerating", failing_sections=len(failed_sections))
        for s in failed_sections:
            hint = regeneration_hint(qa_results[s.number])
            new_content = _stage_expand_section(
                section=s,
                scaffold=scaffold,
                ctx=tenant_context,
                idx=framework_index,
                resolved_topic=topic_map.get(s.number),
                user_title=title,
                user_description=description,
                parent_document_context=parent_document_context,
                correction_hint=hint,
            )
            sections_payload[s.number] = {
                "heading": s.full_heading,
                "content": new_content,
            }
        # Re-validate only the regenerated ones.
        for s in failed_sections:
            qa_results[s.number] = validate_section(
                s,
                sections_payload[s.number]["content"],
                framework_index.active_framework_codes(),
            )
    telemetry["stages"][-1]["status"] = "done"
    _emit("qa", status="done", regenerated=len(failed_sections))

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
            },
        })
        body_parts.append(sec["content"])

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
        if not qa_results[s.number].ok and s.number not in structural
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
    )
