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

from .exemplars import get_exemplar
from .framework_index import FrameworkCitation, FrameworkIndex
from .qa import SectionQAResult, regeneration_hint, validate_section
from .scaffolds import DocScaffold, SectionSpec, get_scaffold
from .tenant_context import TenantContextBundle


logger = logging.getLogger(__name__)


_OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
_OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
_OPENAI_MODEL = os.environ.get("OPENAI_DRAFT_MODEL", "gpt-4o")

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


def _chat_json(prompt: str, *, system: str, temperature: float = 0.45, max_tokens: int = 3200) -> dict:
    """Helper: chat completion with json_object response format."""
    try:
        resp = _client().chat.completions.create(
            model=_OPENAI_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            temperature=temperature,
            max_tokens=max_tokens,
        )
        content = resp.choices[0].message.content or "{}"
        return json.loads(content)
    except json.JSONDecodeError:
        logger.exception("Stage call returned malformed JSON; falling back to empty dict")
        return {}
    except Exception:
        logger.exception("OpenAI call failed in drafting pipeline")
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

    prompt = f"""Decide which governance topic each open-topic section of a {scaffold.label} should focus on.

Document title: {user_title}
Document description: {user_description or "(none supplied — infer from the title)"}

{_tenant_context_block(ctx, scaffold)}

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
        parts.append("Parent document context (the new document is subordinate to this):\n" + parent_document_context)

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

    if correction_hint:
        parts.append("")
        parts.append("CORRECTION HINT (your previous attempt failed validation): " + correction_hint)

    parts.append("")
    parts.append(
        "Return a JSON object with a single key `content` whose value is the "
        "full section in markdown. Begin the markdown with the heading line "
        f"`## {section.full_heading}`. Never use placeholder text like "
        "`[Insert ...]` or `Your Organization`. Never reference yourself as "
        "an AI."
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
    raw = _chat_json(
        prompt,
        system=scaffold.prompt_voice,
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
