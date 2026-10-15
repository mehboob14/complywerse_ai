"""Writing a whole document: planned first, then written section by section, then put together.

A new document used to open as a skeleton of ``[[placeholders]]`` and wait for the person to ask. This writes it: the sections the
platform's drafting has always required for each kind of document (``ai_drafting/scaffolds.py``), each written to the standard of
a bank's governance library (``draft_prompts.py``: the banking craft, concrete numbers where a value was not given, an
assumption recorded for each choice, placeholders only for what cannot be chosen). The pieces are written in parallel, each
checked (length, vague wording, placeholders, numbered clauses) and rewritten once if it falls short, and the document is
applied as the session's first draft: the person reviews and edits it, they do not have to author it.

``run_draft`` runs as a *message*, like every other turn: progress is written on it and so is the result. A part that cannot be
written becomes a visible note in the document and in the message; it never costs the whole document.
"""
from __future__ import annotations

import concurrent.futures
import contextvars
import logging
import os
import re
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from ....services.ai_gateway import claude_client
from ....services.ai_gateway.errors import AIBlocked
from ....services.licence_guard import LicenceRestrictedContent
from ..ai_drafting import scaffolds
from ..ai_drafting.tenant_context import build_tenant_context
from . import blocks as B
from . import checks, prompts
from . import draft_prompts as P
from . import references as refs
from . import templates
from .engine import TurnProblem, _op_view, _stage, friendly, sanitize_markdown

logger = logging.getLogger(__name__)

PARALLEL = max(1, int(os.environ.get("DOCUMENT_STUDIO_DRAFT_PARALLEL", "5") or 5))
SECTION_MAX_TOKENS = 16000
PLAN_MAX_TOKENS = 12000
RETRY_WAITS = (6, 20, 45)                 # seconds before another try of a call the provider said may work later
USE_CASE = "governance.studio_draft"

_FRONT_KEYS = {"document description", "approval signoff", "revision history"}
_DEPENDENT_WORDS = ("definition", "acronym", "related document", "raci", "responsibilities matrix")
_CORE_KEYS = ("policy statements", "mandatory requirements", "procedure steps", "guiding principles", "requirements", "statements")
_WHOLE_CUES = re.compile(r"\b(complete|full|fully|entire|whole|proper|detailed|from scratch|end to end|start to finish|ready (?:to|for) approv\w*|all sections|every section)\b", re.I)
_GENERATE = re.compile(r"\b(write|draft|create|generate|prepare|produce|build|develop)\b", re.I)
_PARTIAL = re.compile(r"\b(section|paragraph|clause|sentence|introduction|intro|summary|table|list|heading|title|appendix|annex|definition|glossary|bullet)\b", re.I)
_TYPE_NOUN = re.compile(r"\b(policy|standard|procedure|guideline|charter)\b", re.I)

# wording a real bank's reviewer would send back, and the phrases that give a generated text away
_VAGUE = [r"\bensure that\b", r"\bas (?:appropriate|needed|required|necessary|applicable)\b", r"\bwhere (?:possible|practicable|appropriate|feasible)\b",
          r"\bbest efforts?\b", r"\bregularly\b", r"\bperiodically\b", r"\badequate(?:ly)?\b", r"\bpromptly\b", r"\bin a timely manner\b", r"\bappropriate(?:ly)?\b"]
_GIVEAWAYS = ["[insert ", "[your ", "your organization", "your organisation", "your company", "your bank", "as an ai", "as a language model", "lorem ipsum",
              "tbd", "to be determined", "to be defined", "acme corp", "xxx"]
_CONTROL_ID = re.compile(r"\[([A-Za-z]{1,6}[.\-]?\d[\w.\-]*(?:\s*;\s*[A-Za-z]{1,6}[.\-]?\d[\w.\-]*)*)\]")


# ── the parts of a document ──────────────────────────────────────────────────
@dataclass
class Section:
    number: str                                   # "3", "Annex A"
    heading: str
    full_heading: str
    key: str
    kind: str                                     # front | narrative | core | dependent
    focus: str
    min_words: int
    target_words: int
    min_clauses: Optional[int] = None
    areas_min: int = 6
    areas_max: int = 12

    @property
    def focus_line(self) -> str:
        first = re.split(r"(?<=[.!?])\s+", " ".join(self.focus.split()))[0]
        return first[:240] if first else "Write this section."


@dataclass
class Piece:
    """What came back for one part: its Markdown (``failed`` when it could not be written), what it cited and what it assumed."""
    body: str = ""
    used: List[Dict[str, Any]] = field(default_factory=list)
    assumptions: List[str] = field(default_factory=list)
    usage: Dict[str, int] = field(default_factory=lambda: {"input_tokens": 0, "output_tokens": 0, "cached_tokens": 0, "calls": 0})
    failed: Optional[str] = None
    rewritten: bool = False


class Fatal(TurnProblem):
    """A problem that would stop every part (credentials, the data-protection check, a licence): the whole draft ends."""


_FOCUS_FIXES = (("the actual committee resolved in Stage C", "the committee named in <organisation>, or the approving role"), ("tenant context", "<organisation>"),
                (" (do not invent numbers)", ""), ("use the configured numeric thresholds verbatim", "use the configured numeric thresholds verbatim and choose sensible ones where none are configured"))


def _modernise(focus: str) -> str:
    """The scaffold's guidance for a section, in the words the writer understands."""
    focus = " ".join((focus or "").split())
    for old, new in _FOCUS_FIXES:
        focus = focus.replace(old, new)
    return focus


def _round10(n: float) -> int:
    return int(round(n / 10.0)) * 10


def _kind_of(spec: Any, key: str, core_taken: bool) -> str:
    if key in _FRONT_KEYS:
        return "front"
    if spec.is_clause_engine and not core_taken:
        return "core"
    if any(w in key for w in _DEPENDENT_WORDS):
        return "dependent"
    return "narrative"


def sections_for(db, session) -> Tuple[List[Section], Any, Optional[Dict[str, Any]]]:
    """The parts of the session's document in order: from the platform's scaffold for its type, or from the headings of the
    organisation's own template. Returns ``(sections, scaffold, tenant_template)``."""
    scaffold = scaffolds.get_scaffold(session.doc_type)
    template = templates.resolve(db, session.template_id or "default", session.doc_type)
    custom = template if template and not template.get("builtin") else None
    out: List[Section] = []
    core_taken = False
    if custom is None:
        for spec in scaffold.mandatory_sections:
            key = templates.key_of(spec.heading)
            kind = _kind_of(spec, key, core_taken)
            core_taken = core_taken or kind == "core"
            target = max(_round10(spec.min_words * 1.8), 200) if kind != "front" else spec.min_words
            out.append(Section(number=spec.number, heading=re.sub(r"^\s*(?:\d+[.)]?\s+)", "", spec.full_heading), full_heading=spec.full_heading, key=key, kind=kind,
                               focus=_modernise(spec.expansion_focus), min_words=spec.min_words, target_words=target, min_clauses=spec.min_clauses,
                               areas_min=4 if session.doc_type in ("procedure", "guideline") else 6, areas_max=8 if session.doc_type in ("procedure", "guideline") else 12))
        return out, scaffold, None
    # the organisation's own template: its headings are the sections, its text under each heading is the brief for that section
    blocks = B.parse(custom.get("content") or "")
    heads = [(i, b) for i, b in enumerate(blocks) if b.kind == "heading" and b.level == 2]
    for n, (i, b) in enumerate(heads):
        end = heads[n + 1][0] if n + 1 < len(heads) else len(blocks)
        body = " ".join(x.text for x in blocks[i + 1:end] if x.text)[:600]
        key = templates.key_of(b.text)
        title = re.sub(r"^\s*(?:\d+(?:\.\d+)*[.)]?\s+)", "", b.text).strip()
        annex = templates.is_annex(b.text)
        kind = "front" if key in _FRONT_KEYS else "core" if (not core_taken and not annex and key in _CORE_KEYS) else \
            "dependent" if any(w in key for w in _DEPENDENT_WORDS) else "narrative"
        core_taken = core_taken or kind == "core"
        number = "" if annex else str(n + 1)
        full = b.text.strip() if annex else f"{n + 1}. {title}"
        out.append(Section(number=number or title.split("—")[0].strip(), heading=title, full_heading=full, key=key, kind=kind,
                           focus=("Follow the organisation's template for this section. " + (f"It says: {body}" if body else "")).strip(), min_words=200, target_words=420,
                           min_clauses=None))
    return out, scaffold, custom


# ── context ──────────────────────────────────────────────────────────────────
def _active_frameworks(db, tenant_id: int) -> List[str]:
    """The frameworks the organisation is working to (its certification journeys), by name: the regulatory perimeter."""
    try:
        from ....models import CertificationJourney
        from ..ai_drafting.framework_index import _resolve_framework_meta

        names: List[str] = []
        for j in db.query(CertificationJourney).filter(CertificationJourney.tenant_id == tenant_id).all():
            meta = _resolve_framework_meta(j, db)
            if meta and meta.get("name"):
                label = f"{meta['name']}{' ' + meta['version'] if meta.get('version') else ''}"
                if label not in names:
                    names.append(label)
        return names
    except Exception:       # noqa: BLE001 - context only: a draft is better without it than not at all
        logger.warning("could not list the organisation's frameworks for a draft", exc_info=True)
        return []


def wants_whole_document(session, blocks: Sequence[B.Block], request: str) -> bool:
    """Whether a chat request, on a document the person has not started, asks for the whole document to be written."""
    if session.kind != "new" or session.doc_type not in templates.DOC_TYPES:
        return False
    if not (B.is_blank(blocks) or session.revision_no <= 1):
        return False
    text = request or ""
    if not _GENERATE.search(text):
        return False
    return bool(_WHOLE_CUES.search(text) or (_TYPE_NOUN.search(text) and not _PARTIAL.search(text)))


# ── calling the model ────────────────────────────────────────────────────────
def _fatal(exc: BaseException) -> bool:
    if isinstance(exc, (AIBlocked, LicenceRestrictedContent, claude_client.ClaudeNotConfigured)):
        return True
    return isinstance(exc, claude_client.ClaudeFailed) and not exc.retryable and any(w in str(exc) for w in ("credentials", "not set up", "not available"))


def _call(blocks: List[Dict[str, Any]], task: str, system: str, schema: Dict[str, Any], *, max_tokens: int, effort: str = "high") -> claude_client.Result:
    """One guarded call, tried again a few times when the provider says it may work later."""
    messages = [{"role": "user", "content": blocks + [{"type": "text", "text": task}]}]
    for attempt in range(len(RETRY_WAITS) + 1):
        try:
            return claude_client.complete(use_case=USE_CASE, system=system, messages=messages, schema=schema, max_tokens=max_tokens, effort=effort)
        except claude_client.ClaudeFailed as exc:
            if not exc.retryable or attempt == len(RETRY_WAITS) or _fatal(exc):
                raise
            time.sleep(RETRY_WAITS[attempt])
    raise AssertionError("unreachable")


def _usage(total: Dict[str, int], result: claude_client.Result) -> None:
    u = result.usage or {}
    total["input_tokens"] += u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
    total["output_tokens"] += u.get("output_tokens", 0)
    total["cached_tokens"] += u.get("cache_read_input_tokens", 0)
    total["calls"] += 1


# ── checking what came back ──────────────────────────────────────────────────
def _words(text: str) -> int:
    return len(re.findall(r"\w+", text or ""))


def _clean(body: str, section: Section, area_heading: str = "") -> str:
    """The body as the document keeps it: sanitised, no repeat of its own heading, no heading above level 3."""
    body = sanitize_markdown(body)
    lines = body.split("\n")
    while lines and not lines[0].strip():
        lines.pop(0)
    if lines and lines[0].lstrip().startswith("#"):
        first = re.sub(r"^[#\s]+(?:\d+(?:\.\d+)*[.)]?\s+)?", "", lines[0]).strip().lower()
        if first in {section.heading.lower(), area_heading.lower()} or not first:
            lines.pop(0)
    return re.sub(r"(?m)^#{1,2}(?=\s)", "###", "\n".join(lines)).strip()


def problems(body: str, *, minimum_words: int, minimum_clauses: Optional[int] = None, number: str = "") -> List[str]:
    """What a reviewer would send this text back for: too short, too few clauses, vague wording, tell-tale phrases, too many placeholders."""
    out: List[str] = []
    words = _words(body)
    if words < minimum_words:
        out.append(f"It is too short ({words} words; at least {minimum_words}). Add real substance: more obligations, thresholds, roles, evidence and steps, not longer sentences.")
    if minimum_clauses:
        found = len(re.findall(rf"(?m)^\s*{re.escape(number)}\.\d+", body)) if number else len(re.findall(r"(?m)^\s*(?:\d+\.|[-*])\s+", body))
        if found < minimum_clauses:
            out.append(f"It has {found} numbered items; it needs at least {minimum_clauses}, each starting its own line with its number.")
    low = body.lower()
    gave = sorted({g for g in _GIVEAWAYS if g in low})
    if gave:
        out.append("It contains phrases a finished document never has: " + ", ".join(gave) + ".")
    vague = []
    for pattern in _VAGUE:
        for m in re.finditer(pattern, body, re.I):
            start = max(body.rfind(".", 0, m.start()), body.rfind("\n", 0, m.start())) + 1
            end = body.find(".", m.end())
            vague.append(body[start:end + 1 if end >= 0 else None].strip()[:160])
    if len(vague) > max(3, words // 200):
        out.append("It uses vague wording where a number, a deadline or a named role belongs. Rewrite each of these with something specific and testable: " + " | ".join(vague[:5]))
    holes = len(re.findall(r"\[\[[^\]]+\]\]", body))
    if holes > 4:
        out.append(f"It has {holes} placeholders. Choose the values a well-run institution would adopt, state them, and record them in `assumptions`; keep a placeholder only for a person's name, a signature, a date or a system name you were not given.")
    return out


# ── rendering the parts that are not written by the model ────────────────────
def _committee_or_role(ctx: Any, tier: Any) -> str:
    c = ctx.find_committee(*tier.committee_types) if ctx is not None and tier.committee_types else None
    return c["name"] if c and c.get("name") else tier.role_hint


def render_front(section: Section, *, title: str, label: str, scaffold: Any, ctx: Any, plan: Dict[str, Any], sections: Sequence[Section], classification: str) -> str:
    if section.key == "document description":
        scope = next((s for s in sections if s.key.startswith("scope")), None)
        tiers = scaffold.approval_matrix
        rows = [["Field", "Value"], ["Document Title", title], ["Document Type", label],
                ["Document Owner", tiers[0].role_hint if tiers else "[[Owner role]]"], ["Document Classification", classification or "Internal"],
                ["Version", "1.0 (draft for approval)"], ["Effective Date", "[[Effective date]]"],
                ["Next Review Date", "Within 12 months of the effective date, or earlier on a material change"],
                ["Approval Authority", _committee_or_role(ctx, tiers[-1]) if tiers else "[[Approving body]]"],
                ["Distribution", "All employees, contractors and third parties within the scope of this document"
                                 + (f" (Section {scope.number})" if scope else "")]]
        sources = [s for s in (plan.get("external_sources") or []) if str(s).strip()][:6]
        if sources:
            rows.append(["Regulatory Alignment", "; ".join(sources)])
        return B.table_markdown(rows)
    if section.key == "approval signoff":
        rows = [["Role", "Name", "Designation", "Signature and date"]] + [[t.label, "[[Name]]", _committee_or_role(ctx, t), "____________________"] for t in scaffold.approval_matrix]
        return B.table_markdown(rows)
    tiers = scaffold.approval_matrix
    return B.table_markdown([["Version", "Date", "Author", "Summary of changes", "Approved by"],
                             ["1.0", "[[Date of approval]]", tiers[0].role_hint if tiers else "[[Author]]", "Initial issue", _committee_or_role(ctx, tiers[-1]) if tiers else "[[Approver]]"]])


# ── the pipeline ─────────────────────────────────────────────────────────────
def _blocks(*texts: str, cache_last: bool = False) -> List[Dict[str, Any]]:
    out = [{"type": "text", "text": t} for t in texts if t and t.strip()]
    if cache_last and out:
        out[-1] = dict(out[-1], cache_control={"type": "ephemeral"})
    return out


def _fallback_areas(session, scaffold: Any, core: Optional[Section]) -> List[Dict[str, Any]]:
    focus = str((session.instructions or {}).get("focus_areas") or "")
    items = [x.strip(" -•*\t") for x in re.split(r"[\n;]+", focus) if x.strip(" -•*\t")]
    if not items:
        items = [t.replace("_", " ").capitalize() for t in getattr(scaffold, "default_topic_hints", [])] or [core.heading if core else "Requirements"]
    return [{"title": t[:80], "focus": f"Set out what the institution requires for {t.lower()}.", "must_cover": [], "refs": [], "words": 450} for t in items[:8]]


def _plan(shared: List[Dict[str, Any]], system: str, *, label: str, session, sections: Sequence[Section], core: Optional[Section], requirements: Sequence[str], parent: bool,
          total: Dict[str, int]) -> Dict[str, Any]:
    task = P.plan_task(label=label, title=session.title, sections=sections, core=core, doc_type=session.doc_type, requirements=requirements, parent=parent)
    result = _call(shared, task, system, P.PLAN_SCHEMA, max_tokens=PLAN_MAX_TOKENS)
    _usage(total, result)
    plan = dict(result.data or {})
    areas = [a for a in plan.get("areas") or [] if str(a.get("title") or "").strip()]
    if core is not None:
        areas = areas[:core.areas_max]
    # the number is added when the heading is written: a title the model numbered itself would read "7.1 7.1 ..."
    plan["areas"] = [dict(a, index=i, title=re.sub(r"^\s*\d+(?:\.\d+)*[.):]?\s+", "", str(a["title"])).strip() or str(a["title"]).strip(),
                          words=min(max(int(a.get("words") or 450), 300), 650)) for i, a in enumerate(areas, start=1)]
    return plan


def _write_part(shared: List[Dict[str, Any]], system: str, make_task: Callable[[str], str], *, section: Section, area_heading: str, minimum_words: int,
                minimum_clauses: Optional[int], number: str) -> Piece:
    """Write one part, check it, and write it again once with the problems named if it falls short."""
    piece = Piece()
    fix = ""
    for attempt in (0, 1):
        try:
            result = _call(shared, make_task(fix), system, P.SECTION_SCHEMA, max_tokens=SECTION_MAX_TOKENS)
        except Exception as exc:        # noqa: BLE001
            if _fatal(exc):
                raise Fatal(friendly(exc)) from exc
            logger.warning("a part of a draft could not be written (attempt %s): %s", attempt + 1, exc)
            if attempt == 0 and not piece.body:         # once more: a call that failed once usually does not fail twice
                time.sleep(RETRY_WAITS[0])
                continue
            if not piece.body:
                piece.failed = friendly(exc)
            return piece
        _usage(piece.usage, result)
        data = result.data or {}
        body = _clean(str(data.get("markdown") or ""), section, area_heading)
        found = problems(body, minimum_words=minimum_words, minimum_clauses=minimum_clauses, number=number)
        if attempt == 0 or not piece.body or _words(body) > _words(piece.body) or not found:
            piece.body, piece.failed = body, None
            piece.used = [u for u in data.get("references_used") or []]
            piece.assumptions = [str(a).strip() for a in data.get("assumptions") or [] if str(a).strip()]
        if not found or attempt == 1:
            break
        fix = "\n".join(f"- {p}" for p in found)
        piece.rewritten = True
    return piece


def _run_pool(jobs: List[Callable[[], Piece]], progress: Callable[[int], None]) -> List[Piece]:
    """The parts in the order they were given, written ``PARALLEL`` at a time. A fatal problem in one ends them all."""
    results: List[Optional[Piece]] = [None] * len(jobs)
    done = 0
    if PARALLEL <= 1 or len(jobs) <= 1:
        for i, job in enumerate(jobs):
            results[i] = job()
            progress(i + 1)
        return [r for r in results if r is not None]
    with concurrent.futures.ThreadPoolExecutor(max_workers=PARALLEL, thread_name_prefix="studio-draft") as pool:
        futures = {pool.submit(contextvars.copy_context().run, job): i for i, job in enumerate(jobs)}
        try:
            for future in concurrent.futures.as_completed(futures):
                results[futures[future]] = future.result()
                done += 1
                progress(done)
        except BaseException:
            for f in futures:
                f.cancel()
            raise
    return [r for r in results if r is not None]


def _shared_text(session, ins: Dict[str, Any], org: str, custom: Optional[Dict[str, Any]], brief: str) -> str:
    parts = [f"<session>\nkind: new\ndocument type: {session.doc_type}\ntitle: {session.title}\n</session>", org]
    text = prompts.instructions_text(ins)
    if brief.strip():
        text = (text + "\n" if text else "") + f"The person's request: {brief.strip()[:2000]}"
    if text:
        parts.append(f"<instructions>\n{text}\n</instructions>")
    if custom:
        parts.append("<template>\nThe organisation's own template for this kind of document. Follow its sections, their order and its house style:\n" + (custom.get("content") or "")[:20000] + "\n</template>")
    return "\n\n".join(parts)


def _known_ids(references: Sequence[Any]) -> set:
    ids = set()
    for r in references:
        if r.include and r.kind == "framework":
            ids |= {str(x).strip().lower() for x in (r.scope or {}).get("refs") or []}
    return ids


def run_draft(db, session_id: int, message_id: int) -> None:
    """Write the whole document into the assistant message ``message_id`` and apply it. Never raises: a failure is written on the message."""
    from ....models import StudioMessage, StudioReference, StudioSession
    from . import service

    session, msg = db.get(StudioSession, session_id), db.get(StudioMessage, message_id)
    try:
        if session.doc_type not in templates.DOC_TYPES or session.kind != "new":
            raise TurnProblem("Only a new policy, standard, procedure, guideline or charter can be written from scratch.")
        request = (db.query(StudioMessage).filter(StudioMessage.session_id == session_id, StudioMessage.role == "user", StudioMessage.id < message_id)
                   .order_by(StudioMessage.id.desc()).first())
        brief = request.content if request is not None else ""
        _stage(db, msg, "Reading the references and the organisation")
        references = db.query(StudioReference).filter(StudioReference.session_id == session_id).order_by(StudioReference.id).all()
        if refs.total_chars(references) > refs.MAX_TOTAL_CHARS:
            raise TurnProblem("The references are too large together. Remove one, or narrow a framework to the parts you need.")
        sections, scaffold, custom = sections_for(db, session)
        if not sections:
            raise TurnProblem("This template has no sections to write.")
        label = scaffold.label
        doc_type = session.doc_type                 # plain values from here on: the parts are written on other threads, which must never read the session
        ins = dict(session.instructions or {})
        ctx = build_tenant_context(session.tenant_id, db)
        entity = str(ins.get("entity_name") or "").strip()
        org = P.organisation_block(ctx, entity, _active_frameworks(db, session.tenant_id))
        system = P.system_for(doc_type, ctx.industry, ctx.regulatory_scope)
        requirements = [str(r).strip() for r in ins.get("requirements") or [] if str(r).strip()]
        core = next((s for s in sections if s.kind == "core"), None)
        parent = any(r.kind == "parent_document" and r.include for r in references)
        total = {"input_tokens": 0, "output_tokens": 0, "cached_tokens": 0, "calls": 0}
        notes: List[str] = []
        base_revision = session.revision_no

        # the part every call shares comes first, so the provider can reuse it between the plan and the sections
        shared = _blocks(_shared_text(session, ins, org, custom, brief), refs.render(references) and f"<references>\n{refs.render(references)}\n</references>", cache_last=True)

        _stage(db, msg, "Planning the document")
        try:
            plan = _plan(shared, system, label=label, session=session, sections=sections, core=core, requirements=requirements, parent=parent, total=total)
        except Exception as exc:        # noqa: BLE001
            if _fatal(exc):
                raise Fatal(friendly(exc)) from exc
            logger.warning("the plan of a draft failed: %s", exc)
            plan = {"approach": "", "decisions": [], "core_intro": "", "areas": [], "terms": [], "related_documents": [], "external_sources": [], "questions": []}
            notes.append("The plan could not be made, so the document was written without it: check that its parts agree with each other.")
        if core is not None and not plan["areas"]:
            plan["areas"] = [dict(a, index=i) for i, a in enumerate(_fallback_areas(session, scaffold, core), start=1)]
        areas = plan["areas"]
        plan_blocks = _blocks(P.decisions_block(plan.get("decisions") or []), P.outline_block(sections, areas, core.number if core else None))
        shared_plus = shared + plan_blocks

        # parts that are written from the plan alone
        titles = [a["title"] for a in areas]
        todo: List[Tuple[str, Section, Optional[Dict[str, Any]], Callable[[], Piece]]] = []
        for s in sections:
            if s.kind in ("narrative",):
                todo.append(("section", s, None, lambda s=s: _write_part(
                    shared_plus, system, lambda fix, s=s: P.section_task(label=label, section=s, area=None, core=core, doc_type=doc_type, requirements=requirements,
                                                                      sibling_areas=titles, target_words=s.target_words, minimum_words=s.min_words, minimum_clauses=s.min_clauses, fix=fix),
                    section=s, area_heading="", minimum_words=s.min_words, minimum_clauses=None, number="")))
            elif s.kind == "core":
                for a in areas:
                    target = a["words"]
                    minimum = int(target * 0.7)
                    clauses = 4 if doc_type in ("policy", "standard") else 3
                    num = f"{s.number}.{a['index']}"
                    todo.append(("area", s, a, lambda s=s, a=a, target=target, minimum=minimum, clauses=clauses, num=num: _write_part(
                        shared_plus, system, lambda fix, s=s, a=a, target=target, minimum=minimum, clauses=clauses: P.section_task(
                            label=label, section=s, area=a, core=s, doc_type=doc_type, requirements=requirements, sibling_areas=titles, target_words=target,
                            minimum_words=minimum, minimum_clauses=clauses, fix=fix),
                        section=s, area_heading=a["title"], minimum_words=minimum, minimum_clauses=clauses, number=num)))
        count = len(todo)
        _stage(db, msg, f"Writing the document: 0 of {count} parts")
        pieces = _run_pool([t[3] for t in todo], lambda n: _stage(db, msg, f"Writing the document: {n} of {count} parts"))
        written: Dict[Tuple[str, str], Piece] = {}
        for (kind, s, a, _), piece in zip(todo, pieces):
            written[(s.number, str(a["index"]) if a else "")] = piece

        # parts that need the rest of the document: the glossary, the related documents and the responsibility matrix
        classification = str(ins.get("classification") or "Internal")
        so_far: List[str] = [f"# {session.title}"]
        deps: List[Section] = []
        for s in sections:
            if s.kind == "front":
                continue
            if s.kind == "dependent":
                deps.append(s)
                continue
            body = _assemble_part(s, areas, written, plan)
            so_far.append(f"## {s.full_heading}\n\n{body}")
        dep_pieces: Dict[str, Piece] = {}
        if deps:
            _stage(db, msg, "Writing the glossary, the related documents and the responsibility matrix")
            document = "<document_so_far>\n" + "\n\n".join(so_far)[:240_000] + "\n</document_so_far>"
            dep_shared = shared + plan_blocks + _blocks(document)
            jobs = [(lambda s=s: _write_part(dep_shared, system, lambda fix, s=s: P.dependent_task(label=label, section=s, target_words=s.target_words,
                                                                                                    minimum_words=s.min_words, plan=plan, fix=fix),
                                             section=s, area_heading="", minimum_words=s.min_words, minimum_clauses=None, number="")) for s in deps]
            for s, piece in zip(deps, _run_pool(jobs, lambda n: None)):
                dep_pieces[s.number] = piece

        _stage(db, msg, "Putting the document together")
        out: List[str] = [f"# {session.title}"]
        failures: List[str] = []
        for s in sections:
            out.append(f"## {s.full_heading}")
            if s.kind == "front":
                out.append(render_front(s, title=session.title, label=label, scaffold=scaffold, ctx=ctx, plan=plan, sections=sections, classification=classification))
            elif s.kind == "dependent":
                piece = dep_pieces.get(s.number) or Piece(failed="not written")
                out.append(piece.body or _missing(s, piece.failed))
                if piece.failed:
                    failures.append(s.heading)
            else:
                out.append(_assemble_part(s, areas, written, plan, failures))
        markdown = "\n\n".join(out).strip() + "\n"
        all_pieces = list(written.values()) + list(dep_pieces.values())
        for p in all_pieces:
            for k in ("input_tokens", "output_tokens", "cached_tokens", "calls"):
                total[k] += p.usage[k]

        used = _verified(all_pieces, references)
        assumptions = _assumptions(plan, all_pieces)
        blocks_after = B.parse(markdown)
        holes = [h for h in checks.placeholders(blocks_after) if h.get("required")]        # signature lines and blank form fields are meant to stay blank
        words = sum(b.words for b in blocks_after)
        unknown = _unknown_citations(markdown, references)
        if failures:
            notes.append("These parts could not be written and are marked in the document: " + ", ".join(failures) + ". Ask the AI to write them.")
        if unknown:
            notes.append(f"{unknown} control identifier(s) in square brackets are not in the attached framework: check them.")
        dangling = dangling_references(markdown)
        if dangling:
            notes.append("These clause numbers are mentioned but are not in the document: " + ", ".join(dangling[:12]) + (" and more" if len(dangling) > 12 else "") + ". Check the cross-references.")
        rewritten = sum(1 for p in all_pieces if p.rewritten)
        if assumptions:
            notes.append("Where nothing was specified I chose the values a well-run regulated institution would adopt. Confirm or change them: " + "; ".join(assumptions[:12])
                         + (f"; and {len(assumptions) - 12} more." if len(assumptions) > 12 else "."))
        profile = [f"{k} {v}" for k, v in (("sector", getattr(ctx, "industry", None)), ("region", getattr(ctx, "geography", None)),
                                           ("regulatory scope", getattr(ctx, "regulatory_scope", None))) if v and str(v).strip()]
        written_for = (f"Written for {entity or getattr(ctx, 'organisation_display', '') or 'the organisation'}"
                       + (f" ({'; '.join(profile)}), as set in the organisation's profile; your instructions override it. " if profile else ". "))
        text = (written_for + f"I wrote the complete {label.lower()}: about {words:,} words in {len(sections)} sections"
                + (f", with {len(areas)} areas in {core.heading.lower()}" if core and areas else "")
                + f". {len(holes)} placeholder(s) remain" + (", all of them facts I could not know (names, dates, signatures)." if holes else ".")
                + (" The values I chose where nothing was specified are listed below for you to confirm." if assumptions else ""))
        questions = [str(q).strip() for q in plan.get("questions") or [] if str(q).strip()][:3]

        # apply it as the first draft (what the person typed meanwhile stays in the document's history)
        current = db.get(StudioSession, session_id)
        op = B.Op("c1", "replace_all", markdown=markdown, reason="The complete first draft")
        msg.proposal = {"ops": [_op_view(op, B.parse(current.content))], "base_revision": base_revision, "stats": B.stats(B.parse(current.content), blocks_after),
                        "placeholders": len(holes), "requirements": []}
        msg.content, msg.references_used, msg.questions, msg.notes = text, used, questions, notes
        msg.base_revision = current.revision_no
        msg.usage = {k: total[k] for k in ("input_tokens", "output_tokens", "cached_tokens")}
        msg.status, msg.stage, msg.error, msg.updated_at = "done", None, None, datetime.utcnow()
        db.commit()
        if current.revision_no != base_revision:
            notes.append("You changed the document while it was being written. The draft replaced it; your version is in the document's history.")
            msg.notes = notes
        service.accept_ops(db, current, msg, ["c1"], request.created_by if request is not None else msg.created_by, auto=True, summary="The AI wrote the first draft")
        logger.info("studio draft %s: %s words, %s calls, %s rewritten, %s failed", message_id, words, total["calls"], rewritten, len(failures))
    except Exception as exc:        # noqa: BLE001 - the person sees a sentence, the log sees the cause
        db.rollback()
        msg = db.get(StudioMessage, message_id)
        msg.status, msg.stage, msg.error, msg.updated_at = "error", None, friendly(exc), datetime.utcnow()
        db.commit()


# ── putting the parts together ───────────────────────────────────────────────
def _missing(section: Section, reason: Optional[str]) -> str:
    return f"[[This part could not be written: {(reason or 'the AI did not answer').rstrip('. ')}. Ask the AI to write the {section.heading.lower()} section.]]"


def _assemble_part(section: Section, areas: Sequence[Dict[str, Any]], written: Dict[Tuple[str, str], Piece], plan: Dict[str, Any], failures: Optional[List[str]] = None) -> str:
    if section.kind != "core":
        piece = written.get((section.number, "")) or Piece(failed="not written")
        if piece.failed and failures is not None:
            failures.append(section.heading)
        return piece.body or _missing(section, piece.failed)
    parts = [str(plan.get("core_intro") or "").strip()] if str(plan.get("core_intro") or "").strip() else []
    for a in areas:
        piece = written.get((section.number, str(a["index"]))) or Piece(failed="not written")
        if piece.failed and failures is not None:
            failures.append(f"{section.number}.{a['index']} {a['title']}")
        parts.append(f"### {section.number}.{a['index']} {a['title']}\n\n{piece.body or _missing(section, piece.failed)}")
    return "\n\n".join(parts)


def _verified(pieces: Sequence[Piece], references: Sequence[Any]) -> List[Dict[str, Any]]:
    """What the parts say they relied on, with each quoted passage looked for in the reference it names."""
    keys = {r.ref_key: r for r in references}
    seen, out = set(), []
    for p in pieces:
        for u in p.used:
            key, quote, basis = str(u.get("ref") or "").strip(), str(u.get("quote") or "").strip(), u.get("basis") or "reference"
            ident = (key, str(u.get("locator") or "").strip().lower(), quote[:60].lower())
            if ident in seen:
                continue
            seen.add(ident)
            ref = keys.get(key)
            row = {"ref": key, "title": ref.title if ref else "", "kind": ref.kind if ref else "", "locator": str(u.get("locator") or "").strip(), "quote": quote,
                   "how": str(u.get("how") or "").strip(), "basis": basis, "verified": None, "locator_ok": None}
            if basis == "reference":
                row["verified"] = bool(ref and quote and refs.verify_quote(ref.text, quote))
                row["locator_ok"] = refs.verify_locator(ref, row["locator"]) if ref else None
            out.append(row)
    # what rests on the attached references comes first; general knowledge is a handful of lines, not a list of everything
    cited = [r for r in out if r["basis"] == "reference"][:40]
    general = [r for r in out if r["basis"] != "reference"][:10]
    return cited + general


def _assumptions(plan: Dict[str, Any], pieces: Sequence[Piece]) -> List[str]:
    out: List[str] = []
    for d in plan.get("decisions") or []:
        if d.get("basis") == "industry_default" and str(d.get("name") or "").strip():
            out.append(f"{d['name']}: {d['value']}")
    for p in pieces:
        for a in p.assumptions:
            if a not in out:
                out.append(a)
    return out


def dangling_references(markdown: str) -> List[str]:
    """Clause numbers the text refers to ("clause 7.3.12", "areas 7.1 to 7.5", "Section 9") that are not in the document."""
    exist, sections = set(), set()
    for line in markdown.split("\n"):
        m = re.match(r"^\s*(?:#+\s+)?(\d+(?:\.\d+)+)\b", line)
        if m:
            exist.add(m.group(1))
        h = re.match(r"^\s*#+\s+(\d+)\.\s", line)
        if h:
            sections.add(h.group(1))
    bad = set()
    for m in re.finditer(r"\b(?:clauses?|areas?|sections?|paragraphs?)\s+(\d+(?:\.\d+)*(?:\s*(?:,|and|to|or)\s*\d+(?:\.\d+)*)*)", markdown, re.I):
        for num in re.findall(r"\d+(?:\.\d+)*", m.group(1)):
            if "." in num and num not in exist or "." not in num and num not in sections:
                bad.add(num)
    return sorted(bad, key=lambda x: [int(p) for p in x.split(".")])


def _unknown_citations(markdown: str, references: Sequence[Any]) -> int:
    """Bracketed control identifiers in the text that are in none of the attached frameworks."""
    known = _known_ids(references)
    if not known:
        return 0
    bad = set()
    for m in _CONTROL_ID.finditer(markdown):
        for ident in re.split(r"\s*;\s*", m.group(1)):
            if ident.strip().lower() not in known:
                bad.add(ident.strip().lower())
    return len(bad)
