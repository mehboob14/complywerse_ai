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
import threading
import time
from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from ....services.ai_gateway import claude_client
from ....services.ai_gateway.errors import AIBlocked
from ....services.licence_guard import LicenceRestrictedContent
from ..ai_drafting import scaffolds
from ..ai_drafting.tenant_context import build_tenant_context
from . import blocks as B
from . import checks, live, prompts, setup
from . import draft_prompts as P
from . import references as refs
from . import templates
from .engine import TurnProblem, _op_view, _stage, friendly, questions_of, sanitize_markdown

logger = logging.getLogger(__name__)

PARALLEL = max(1, int(os.environ.get("DOCUMENT_STUDIO_DRAFT_PARALLEL", "5") or 5))
SECTION_MAX_TOKENS = 16000
PLAN_MAX_TOKENS = 12000
RETRY_WAITS = (6, 20, 45)                 # seconds before another try of a call the provider said may work later
USE_CASE = "governance.studio_draft"
RESEARCH_USE_CASE = "governance.studio_research"
WEB_SEARCH = {"type": "web_search_20260209", "name": "web_search", "max_uses": 6}
RESEARCH_MAX_TOKENS = 6000
RESEARCH_CHARS = 12000                    # of the findings kept for the questions and the draft
SCOPE_MAX_TOKENS = 8000
PREVIEW_EVERY = 1.5                       # seconds between two saves of the document shown while it is written

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


def _call(blocks: List[Dict[str, Any]], task: str, system: str, schema: Dict[str, Any], *, max_tokens: int, effort: str = "high",
          on_progress: Optional[Callable[[claude_client.Progress], None]] = None, should_stop: Optional[Callable[[], bool]] = None) -> claude_client.Result:
    """One guarded call, tried again a few times when the provider says it may work later."""
    messages = [{"role": "user", "content": blocks + [{"type": "text", "text": task}]}]
    for attempt in range(len(RETRY_WAITS) + 1):
        try:
            return claude_client.complete(use_case=USE_CASE, system=system, messages=messages, schema=schema, max_tokens=max_tokens, effort=effort,
                                          on_progress=on_progress, should_stop=should_stop)
        except claude_client.ClaudeFailed as exc:
            if not exc.retryable or attempt == len(RETRY_WAITS) or _fatal(exc):
                raise
            _pause(RETRY_WAITS[attempt], should_stop)
    raise AssertionError("unreachable")


def _pause(seconds: float, should_stop: Optional[Callable[[], bool]]) -> None:
    """A wait before trying again, which a Stop cuts short."""
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if should_stop is not None and should_stop():
            raise claude_client.ClaudeStopped()
        time.sleep(min(0.5, max(0.0, end - time.monotonic())))


def _usage(total: Dict[str, int], result: claude_client.Result) -> None:
    u = result.usage or {}
    total["input_tokens"] += u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
    total["output_tokens"] += u.get("output_tokens", 0)
    total["cached_tokens"] += u.get("cache_read_input_tokens", 0)
    total["calls"] += 1


# ── what the screen shows while it is written (see ``live``) ─────────────────
_BASIS = {"tenant_config": "from the organisation's settings", "instruction": "from your instruction", "reference": "from a reference", "industry_default": "usual practice"}


def _plan_progress(db, msg):
    """Shows the plan as the AI makes it: how it will approach the document, the choices it makes and the areas it will cover."""
    def show(p: claude_client.Progress) -> None:
        if p.phase != "writing":                    # the plan call is quiet for half a minute while the AI thinks: say so
            live.note(db, msg, "Comply Agent is reading the brief" if p.phase == "reading" else "Comply Agent is thinking the structure through")
            return
        data = p.data if isinstance(p.data, dict) else {}
        choices = [f"{p.show(str(d['name'])).strip()}: {p.show(str(d.get('value') or '')).strip()}" + (f" ({_BASIS[d['basis']]})" if d.get("basis") in _BASIS else "")
                   for d in data.get("decisions") or [] if isinstance(d, dict) and d.get("name")]
        areas = [p.show(str(a["title"])).strip() for a in data.get("areas") or [] if isinstance(a, dict) and a.get("title")]
        groups = [{"label": label, "items": [i[:180] for i in items[:14]]} for label, items in (("Choices made", choices), ("Areas to cover", areas)) if items]
        live.stage(db, msg, "Planning the document", step=False, detail="Writing the plan", text=p.show(str(data.get("approach") or "")),
                   text_label="How it will approach the document", groups=groups or None)

    return show


class Track:
    """One part's line on the board of a draft. A part with no board (the default) reports nothing."""

    def __init__(self, board: Optional[live.Board] = None, key: str = ""):
        self.board, self.key = board, key

    def _set(self, **fields: Any) -> None:
        if self.board is not None:
            self.board.set(self.key, **fields)

    def note(self, text: str) -> None:
        self._set(note=text)

    def begin(self, attempt: int, why: str = "") -> None:
        self._set(state="rewriting" if why else "writing", words=0, phase=None, note=f"Rewriting: {why}" if why else "Trying again" if attempt else None)

    def progress(self, p: claude_client.Progress) -> None:
        if self.board is None:
            return
        md = p.data.get("markdown") if isinstance(p.data, dict) else None
        if isinstance(md, str):                     # the words speak for themselves once there are some
            self.board.text(self.key, p.show(md))
            self.board.set(self.key, words=live.words(md), phase=None)
            self.board.tail(self.key, live.tail(md, p.show))
        else:                                       # before the first words: the AI is reading the brief, or thinking it through
            self.board.set(self.key, phase=p.phase)

    def settle(self, piece: "Piece") -> "Piece":
        if self.board is not None:
            self.board.text(self.key, piece.body)
        if piece.failed:
            self._set(state="failed", note=piece.failed)
        else:
            self._set(state="done", words=_words(piece.body), note="Rewritten once" if piece.rewritten else None)
        return piece


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


def render_front(section: Section, *, title: str, label: str, scaffold: Any, ctx: Any, plan: Dict[str, Any], sections: Sequence[Section], classification: str,
                 review_months: int = 12) -> str:
    if section.key == "document description":
        scope = next((s for s in sections if s.key.startswith("scope")), None)
        tiers = scaffold.approval_matrix
        rows = [["Field", "Value"], ["Document Title", title], ["Document Type", label],
                ["Document Owner", tiers[0].role_hint if tiers else "[[Owner role]]"], ["Document Classification", classification or "Internal"],
                ["Version", "1.0 (draft for approval)"], ["Effective Date", "[[Effective date]]"],
                ["Next Review Date", f"Within {review_months} months of the effective date, or earlier on a material change"],
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


def _plan(shared: List[Dict[str, Any]], system: str, *, label: str, session, sections: Sequence[Section], core: Optional[Section], parent: bool,
          total: Dict[str, int], on_progress: Optional[Callable[[claude_client.Progress], None]] = None, may_ask: bool = True,
          should_stop: Optional[Callable[[], bool]] = None, length: float = 1.0) -> Dict[str, Any]:
    lo, hi = round(300 * length), round(650 * length)                 # the words of one area, as long as the person wants the document
    task = P.plan_task(label=label, title=session.title, sections=sections, core=core, doc_type=session.doc_type, parent=parent, may_ask=may_ask,
                       area_words=(lo, hi))
    result = _call(shared, task, system, P.PLAN_SCHEMA, max_tokens=PLAN_MAX_TOKENS, on_progress=on_progress, should_stop=should_stop)
    _usage(total, result)
    plan = dict(result.data or {})
    areas = [a for a in plan.get("areas") or [] if str(a.get("title") or "").strip()]
    if core is not None:
        areas = areas[:core.areas_max]
    # the number is added when the heading is written: a title the model numbered itself would read "7.1 7.1 ..."
    plan["areas"] = [dict(a, index=i, title=re.sub(r"^\s*\d+(?:\.\d+)*[.):]?\s+", "", str(a["title"])).strip() or str(a["title"]).strip(),
                          words=min(max(int(a.get("words") or round(450 * length)), lo), hi)) for i, a in enumerate(areas, start=1)]
    return plan


def _scaled(sections: Sequence[Section], length: float) -> List[Section]:
    """The sections for a document as long as the person asked for (``setup.LENGTH_FACTOR``): fewer words and fewer areas."""
    if length >= 1.0:
        return list(sections)
    out = []
    for s in sections:
        areas_max = max(2, round(s.areas_max * length))
        out.append(replace(s, target_words=max(60, round(s.target_words * length)), min_words=max(40, round(s.min_words * length)),
                                       min_clauses=max(2, round(s.min_clauses * length)) if s.min_clauses else s.min_clauses,
                                       areas_min=min(max(2, round(s.areas_min * length)), areas_max), areas_max=areas_max))
    return out


def _sector(ins: Dict[str, Any], ctx: Any) -> Optional[str]:
    """The sector the craft is written for: the type of organisation the person set up, else the profile's."""
    return str(ins.get("entity_type") or "").strip() or getattr(ctx, "industry", None)


def _write_part(shared: List[Dict[str, Any]], system: str, make_task: Callable[[str], str], *, section: Section, area_heading: str, minimum_words: int,
                minimum_clauses: Optional[int], number: str, track: Optional[Track] = None, should_stop: Optional[Callable[[], bool]] = None) -> Piece:
    """Write one part, check it, and write it again once with the problems named if it falls short."""
    piece, track = Piece(), track or Track()
    fix = why = ""
    for attempt in (0, 1):
        track.begin(attempt, why)
        try:
            result = _call(shared, make_task(fix), system, P.SECTION_SCHEMA, max_tokens=SECTION_MAX_TOKENS, on_progress=track.progress, should_stop=should_stop)
        except claude_client.ClaudeStopped:
            raise
        except Exception as exc:        # noqa: BLE001
            if _fatal(exc):
                raise Fatal(friendly(exc)) from exc
            logger.warning("a part of a draft could not be written (attempt %s): %s", attempt + 1, exc)
            if attempt == 0 and not piece.body:         # once more: a call that failed once usually does not fail twice
                _pause(RETRY_WAITS[0], should_stop)
                continue
            if not piece.body:
                piece.failed = friendly(exc)
            return track.settle(piece)
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
        why = found[0].split(". ")[0][:100]
        piece.rewritten = True
    return track.settle(piece)


def _run_pool(jobs: List[Callable[[], Piece]], progress: Callable[[int], None], tick: Optional[Callable[[], None]] = None) -> List[Piece]:
    """The parts in the order they were given, written ``PARALLEL`` at a time. A fatal problem in one ends them all. ``tick`` is called
    on this thread about twice a second while the parts are written (the parts themselves never touch the database)."""
    results: List[Optional[Piece]] = [None] * len(jobs)
    done = 0
    if PARALLEL <= 1 or len(jobs) <= 1:
        for i, job in enumerate(jobs):
            results[i] = job()
            progress(i + 1)
        return [r for r in results if r is not None]
    with concurrent.futures.ThreadPoolExecutor(max_workers=PARALLEL, thread_name_prefix="studio-draft") as pool:
        futures = {pool.submit(contextvars.copy_context().run, job): i for i, job in enumerate(jobs)}
        pending = set(futures)
        try:
            while pending:
                finished, pending = concurrent.futures.wait(pending, timeout=0.5, return_when=concurrent.futures.FIRST_COMPLETED)
                for future in finished:
                    results[futures[future]] = future.result()
                    done += 1
                    progress(done)
                if tick is not None:
                    tick()
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


def _asking(db, session_id: int, before_id: int) -> Any:
    """The latest message that asked the questions a new document is written with, or None: it asks once in a document's life."""
    from ....models import StudioMessage

    rows = (db.query(StudioMessage).filter(StudioMessage.session_id == session_id, StudioMessage.role == "assistant", StudioMessage.id < before_id)
            .order_by(StudioMessage.id.desc()).all())
    return next((m for m in rows if (m.proposal or {}).get("ask_first") == "draft"), None)


def asked_before(db, session_id: int, before_id: int) -> bool:
    return _asking(db, session_id, before_id) is not None


def _research_block(text: str) -> str:
    return ("<internet_research>\nWhat Comply Agent found on the internet about the laws, regulations and standards that apply (official titles, issuers, "
            "editions). Use it for their names and editions; what the person chose decides which of them apply.\n" + text[:RESEARCH_CHARS]
            + "\n</internet_research>") if text.strip() else ""


def _research_of(db, session_id: int, before_id: int) -> str:
    """What was found on the internet when the questions were asked, kept on the message that asked them."""
    asked = _asking(db, session_id, before_id)
    return str(((asked.proposal or {}).get("research") or {}).get("text") or "") if asked is not None else ""


def _platform_block(db) -> str:
    names = [f.name if not f.version or f.version in f.name else f"{f.name} ({f.version})" for f, _count in refs.available_frameworks(db)]
    return ("<platform_frameworks>\nThe frameworks this platform holds. One the person chooses is attached to the document as a reference.\n"
            + "\n".join(f"- {n}" for n in names[:80]) + "\n</platform_frameworks>") if names else ""


def _sources_text(sources: Sequence[Dict[str, str]]) -> str:
    links = [f"[{s['title'].replace('[', '(').replace(']', ')')[:120]}](<{s['url']}>)" for s in sources if str(s.get("url", "")).startswith(("https://", "http://"))]
    return "**Found on the internet:** " + " · ".join(links[:8]) if links else ""


def _research_progress(db, msg):
    """Shows the web search as it happens: what is searched for, then what was found as it is written down."""
    def show(p: claude_client.Progress) -> None:
        writing = p.phase == "writing" and bool(p.text.strip())
        live.stage(db, msg, "Searching the internet for the rules that apply", step=False,
                   detail={"reading": "Comply Agent is reading your request", "thinking": "Comply Agent is deciding what to look up",
                           "searching": "Searching", "writing": "Writing down what it found"}.get(p.phase),
                   groups=[{"label": "Searched the internet for", "items": [q[:160] for q in p.searches[-10:]]}] if p.searches else None,
                   tail=live.tail(p.text) if writing else None, tail_label="What it found" if writing else None)
    return show


def run_scoping(db, session_id: int, message_id: int) -> None:
    """Before a new document is written, the person settles what it covers and which rules it follows: Comply Agent looks up on the
    internet what applies, adds the frameworks the platform holds, and asks. Nothing is assumed and nothing in the document changes;
    the answers start the draft (``answers_a_draft``). Never raises: a failure is written on the message."""
    from ....models import StudioMessage, StudioReference, StudioSession
    from . import service
    from .engine import counting

    session, msg = db.get(StudioSession, session_id), db.get(StudioMessage, message_id)
    stopped = live.stopper(db, message_id)
    try:
        request = (db.query(StudioMessage).filter(StudioMessage.session_id == session_id, StudioMessage.role == "user", StudioMessage.id < message_id)
                   .order_by(StudioMessage.id.desc()).first())
        brief = request.content if request is not None else ""
        sections, scaffold, custom = sections_for(db, session)
        label, ins = scaffold.label, dict(session.instructions or {})
        ctx = build_tenant_context(session.tenant_id, db)
        references = db.query(StudioReference).filter(StudioReference.session_id == session_id).order_by(StudioReference.id).all()
        total = {"input_tokens": 0, "output_tokens": 0, "cached_tokens": 0, "calls": 0}
        notes: List[str] = []

        _stage(db, msg, "Searching the internet for the rules that apply")
        research, sources = "", []
        try:
            found = claude_client.complete(use_case=RESEARCH_USE_CASE, system=P.RESEARCH_SYSTEM, tools=[WEB_SEARCH], max_tokens=RESEARCH_MAX_TOKENS, effort="medium",
                                           messages=[{"role": "user", "content": P.research_task(label=label, title=session.title, instructions=ins,
                                                                                                  request=brief.split(service.ATTACHED)[0], ctx=ctx)}],
                                           on_progress=_research_progress(db, msg), should_stop=stopped)
            _usage(total, found)
            research, sources = found.text.strip()[:RESEARCH_CHARS], found.sources[:12]
            live.note(db, msg, f"{len(found.searches)} search{'' if len(found.searches) == 1 else 'es'} · {len(sources)} source{'' if len(sources) == 1 else 's'}")
        except claude_client.ClaudeStopped:
            raise
        except Exception as exc:        # noqa: BLE001 - the questions still come, from what Comply Agent knows
            if _fatal(exc):
                raise Fatal(friendly(exc)) from exc
            logger.warning("the web research before a draft failed: %s", exc)
            notes.append("Comply Agent could not search the internet just now, so the laws and standards below come from what it already knows. "
                         "Check their editions before you rely on them.")

        _stage(db, msg, "Preparing the questions")
        org = P.organisation_block(ctx, str(ins.get("entity_name") or "").strip(), _active_frameworks(db, session.tenant_id))
        shared = _blocks(_shared_text(session, ins, org, custom, brief), refs.render(references) and f"<references>\n{refs.render(references)}\n</references>",
                         _research_block(research), _platform_block(db))
        result = _call(shared, P.scope_task(label=label, title=session.title, sections=sections), P.system_for(session.doc_type, _sector(ins, ctx), ctx.regulatory_scope),
                       P.SCOPE_SCHEMA, max_tokens=SCOPE_MAX_TOKENS, effort="medium", should_stop=stopped,
                       on_progress=counting(db, msg, "Preparing the questions", "questions", "questions"))
        _usage(total, result)
        data = result.data or {}
        questions = questions_of(data.get("questions"), limit=6) or questions_of([{                     # it never writes without asking
            "id": "q1", "question": f"What should this {label.lower()} cover, for which country or region, and which laws, regulations, standards and frameworks must it follow?",
            "why": "The document is written to exactly that: nothing in it is assumed.", "kind": "text", "options": [], "other": True}])
        text = "\n\n".join(t for t in (str(data.get("understood") or "").strip(),
                                       f"Before I write the {label.lower()}, settle what it covers and which rules it follows. Pick an answer below or write "
                                       "your own; I write the document as soon as you send them.", _sources_text(sources)) if t)
        if not live.still_working(db, msg):
            raise claude_client.ClaudeStopped()
        msg.content, msg.questions, msg.references_used, msg.notes = text, questions, [], notes
        msg.proposal = {"ops": [], "ask_first": "draft", "base_revision": session.revision_no, "stats": None, "placeholders": 0, "requirements": [],
                        "research": {"text": research, "sources": sources}}
        msg.usage = {k: total[k] for k in ("input_tokens", "output_tokens", "cached_tokens")}
        msg.status, msg.stage, msg.error, msg.updated_at = "done", None, None, datetime.utcnow()
        db.commit()
    except claude_client.ClaudeStopped:
        live.forget(db, message_id)
    except Exception as exc:        # noqa: BLE001 - the person sees a sentence, the log sees the cause
        live.fail(db, message_id, friendly(exc))


def _asked_message(db, request) -> Any:
    """The assistant message whose questions ``request`` (a person's message) answers, or None."""
    from ....models import StudioMessage

    reply_to = (getattr(request, "answers", None) or {}).get("reply_to") if request is not None else None
    return db.get(StudioMessage, reply_to) if reply_to else None


def answers_a_draft(db, request) -> bool:
    """Whether a person's message answers the questions a whole-document draft asked before it was written."""
    asked = _asked_message(db, request)
    return bool(asked is not None and (asked.proposal or {}).get("ask_first") == "draft")


def _brief_of(db, session_id: int, request) -> str:
    """What the person asked for: their message, and when the document asked its questions before, first the request those questions
    were about and the answers given (also when the person asks again after stopping the draft)."""
    from ....models import StudioMessage

    if request is None:
        return ""
    asked = _asked_message(db, request) if answers_a_draft(db, request) else _asking(db, session_id, request.id)
    if asked is None:
        return request.content
    earlier = (db.query(StudioMessage).filter(StudioMessage.session_id == session_id, StudioMessage.role == "user", StudioMessage.id < request.id)
               .order_by(StudioMessage.id.desc()).all())
    original = next((m for m in earlier if m.id < asked.id), None)
    answered = next((m for m in earlier if m.id > asked.id and (m.answers or {}).get("reply_to") == asked.id), None)
    texts = [m.content for m in (original, answered) if m is not None] + [request.content]
    return "\n\n".join(dict.fromkeys(t for t in texts if t.strip()))


def run_draft(db, session_id: int, message_id: int) -> None:
    """Write the whole document into the assistant message ``message_id`` and apply it. Never raises: a failure is written on the message.
    While the parts are written the document as far as it goes is kept on the message (``preview``) for the person to read; a Stop
    (the message no longer "working") ends it, and nothing is applied."""
    from ....models import StudioMessage, StudioReference, StudioSession
    from . import service

    session, msg = db.get(StudioSession, session_id), db.get(StudioMessage, message_id)
    owner, halt, check = threading.get_ident(), threading.Event(), live.stopper(db, message_id)

    def stopped() -> bool:
        """Whether the person stopped the draft. The parts ask from their own threads, which see only the flag: this thread reads the database."""
        if not halt.is_set() and threading.get_ident() == owner and check():
            halt.set()
        return halt.is_set()

    try:
        if session.doc_type not in templates.DOC_TYPES or session.kind != "new":
            raise TurnProblem("Only a new policy, standard, procedure, guideline or charter can be written from scratch.")
        request = (db.query(StudioMessage).filter(StudioMessage.session_id == session_id, StudioMessage.role == "user", StudioMessage.id < message_id)
                   .order_by(StudioMessage.id.desc()).first())
        brief = _brief_of(db, session_id, request)
        # the draft asks before it is written at most once in a document's life: after that it follows the answers and decides the rest
        may_ask = not asked_before(db, session_id, message_id)
        research = _research_of(db, session_id, message_id)
        _stage(db, msg, "Reading the references and the organisation")
        references = db.query(StudioReference).filter(StudioReference.session_id == session_id).order_by(StudioReference.id).all()
        if refs.total_chars(references) > refs.MAX_TOTAL_CHARS:
            raise TurnProblem("The references are too large together. Remove one, or narrow a framework to the parts you need.")
        sections, scaffold, custom = sections_for(db, session)
        if not sections:
            raise TurnProblem("This template has no sections to write.")
        live.note(db, msg, f"{len(references)} reference{'' if len(references) == 1 else 's'} · {len(sections)} sections" + (" from your template" if custom else ""))
        label = scaffold.label
        doc_type = session.doc_type                 # plain values from here on: the parts are written on other threads, which must never read the session
        ins = dict(session.instructions or {})
        length = setup.length_factor(ins)           # as long as the person set it up to be
        sections = _scaled(sections, length)
        ctx = build_tenant_context(session.tenant_id, db)
        entity = str(ins.get("entity_name") or "").strip()
        org = P.organisation_block(ctx, entity, _active_frameworks(db, session.tenant_id))
        system = P.system_for(doc_type, _sector(ins, ctx), ctx.regulatory_scope)
        core = next((s for s in sections if s.kind == "core"), None)
        parent = any(r.kind == "parent_document" and r.include for r in references)
        total = {"input_tokens": 0, "output_tokens": 0, "cached_tokens": 0, "calls": 0}
        notes: List[str] = []
        base_revision = session.revision_no

        # the part every call shares comes first, so the provider can reuse it between the plan and the sections
        shared = _blocks(_shared_text(session, ins, org, custom, brief), refs.render(references) and f"<references>\n{refs.render(references)}\n</references>",
                         _research_block(research), cache_last=True)

        _stage(db, msg, "Planning the document")
        try:
            plan = _plan(shared, system, label=label, session=session, sections=sections, core=core, parent=parent, total=total,
                         on_progress=_plan_progress(db, msg), may_ask=may_ask, should_stop=stopped, length=length)
        except claude_client.ClaudeStopped:
            raise
        except Exception as exc:        # noqa: BLE001
            if _fatal(exc):
                raise Fatal(friendly(exc)) from exc
            logger.warning("the plan of a draft failed: %s", exc)
            plan = {"approach": "", "decisions": [], "core_intro": "", "areas": [], "terms": [], "related_documents": [], "external_sources": [], "questions": []}
            notes.append("The plan could not be made, so the document was written without it: check that its parts agree with each other.")
        asking = questions_of(plan.get("questions")) if may_ask and plan.get("ask_first") else []
        if asking:                              # choices the whole document depends on: the person answers before it is written
            if not live.still_working(db, msg):
                raise claude_client.ClaudeStopped()
            msg.content = (f"Before I write the {label.lower()}, a few choices decide what it covers and which rules it follows. Pick an answer "
                           "below, or write your own; I write the document as soon as you send them. If you would rather I decide, say so.")
            msg.questions = asking
            msg.proposal = {"ops": [], "ask_first": "draft", "base_revision": base_revision, "stats": None, "placeholders": 0, "requirements": []}
            msg.references_used, msg.notes = [], notes
            msg.usage = {k: total[k] for k in ("input_tokens", "output_tokens", "cached_tokens")}
            msg.status, msg.stage, msg.error, msg.updated_at = "done", None, None, datetime.utcnow()
            db.commit()
            return
        if core is not None and not plan["areas"]:
            plan["areas"] = [dict(a, index=i) for i, a in enumerate(_fallback_areas(session, scaffold, core), start=1)]
        areas = plan["areas"]
        live.note(db, msg, f"{len(areas)} areas to cover · {len(plan.get('decisions') or [])} choices made" if areas else "the sections of the template")
        plan_blocks = _blocks(P.decisions_block(plan.get("decisions") or []), P.outline_block(sections, areas, core.number if core else None))
        shared_plus = shared + plan_blocks

        # parts that are written from the plan alone; the board is what the screen shows of them while they are written
        board = live.Board()
        titles = [a["title"] for a in areas]
        todo: List[Tuple[str, Section, Optional[Dict[str, Any]], Callable[[], Piece]]] = []
        places: Dict[Tuple[str, str], str] = {}                 # (section number, area index or "") -> the part's key on the board

        def track_for(label_: str, place: Tuple[str, str]) -> Track:
            places[place] = board.add(label_)
            return Track(board, places[place])

        for s in sections:
            if s.kind in ("narrative",):
                todo.append(("section", s, None, lambda s=s, track=track_for(s.full_heading, (s.number, "")): _write_part(
                    shared_plus, system, lambda fix, s=s: P.section_task(label=label, section=s, area=None, core=core, doc_type=doc_type,
                                                                      sibling_areas=titles, target_words=s.target_words, minimum_words=s.min_words, minimum_clauses=s.min_clauses, fix=fix),
                    section=s, area_heading="", minimum_words=s.min_words, minimum_clauses=None, number="", track=track, should_stop=stopped)))
            elif s.kind == "core":
                for a in areas:
                    target = a["words"]
                    minimum = int(target * 0.7)
                    clauses = 4 if doc_type in ("policy", "standard") else 3
                    num = f"{s.number}.{a['index']}"
                    todo.append(("area", s, a, lambda s=s, a=a, target=target, minimum=minimum, clauses=clauses, num=num,
                                 track=track_for(f"{num} {a['title']}", (s.number, str(a["index"]))): _write_part(
                        shared_plus, system, lambda fix, s=s, a=a, target=target, minimum=minimum, clauses=clauses: P.section_task(
                            label=label, section=s, area=a, core=s, doc_type=doc_type, sibling_areas=titles, target_words=target,
                            minimum_words=minimum, minimum_clauses=clauses, fix=fix),
                        section=s, area_heading=a["title"], minimum_words=minimum, minimum_clauses=clauses, number=num, track=track, should_stop=stopped)))
        dependents = [s for s in sections if s.kind == "dependent"]
        dep_tracks = {s.number: track_for(s.full_heading, (s.number, "")) for s in dependents}
        for t in dep_tracks.values():
            t.note("Written last, from the rest of the document")
        count = len(todo) + len(dependents)                      # what the screen counts: the parts written now and the ones written last

        # the document as far as it is written, for the person to read meanwhile (the parts that are done, the text of the ones being written)
        title, classification = session.title, str(ins.get("classification") or "Internal")
        front = {s.number: render_front(s, title=title, label=label, scaffold=scaffold, ctx=ctx, plan=plan, sections=sections, classification=classification,
                                        review_months=setup.review_months(ins))
                 for s in sections if s.kind == "front"}
        shown: Dict[str, Any] = {"text": None, "at": 0.0, "seq": 0}

        def show_document(now: bool = False) -> None:
            if not now and time.monotonic() - shown["at"] < PREVIEW_EVERY:
                return
            text = _preview(title, sections, areas, plan, front, places, board.written())
            if text != shown["text"]:
                shown.update(text=text, at=time.monotonic(), seq=shown["seq"] + 1)
                msg.preview = text
                live.update(db, msg, preview_seq=shown["seq"])

        def tick() -> None:
            if stopped():
                raise claude_client.ClaudeStopped()
            board.save(db, msg)
            show_document()

        board.saver = lambda: (board.save(db, msg), show_document())      # from here the parts may be written on this thread, and then they save as they report
        _stage(db, msg, f"Writing the document: 0 of {count} parts", text=None, text_label=None, groups=None, **board.view())
        show_document(now=True)
        pieces = _run_pool([t[3] for t in todo], lambda n: _stage(db, msg, f"Writing the document: {n} of {count} parts", step=False, **board.view()), tick)
        written: Dict[Tuple[str, str], Piece] = {}
        for (kind, s, a, _), piece in zip(todo, pieces):
            written[(s.number, str(a["index"]) if a else "")] = piece

        # parts that need the rest of the document: the glossary, the related documents and the responsibility matrix
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
            _stage(db, msg, "Writing the glossary, the related documents and the responsibility matrix", **board.view())
            document = "<document_so_far>\n" + "\n\n".join(so_far)[:240_000] + "\n</document_so_far>"
            dep_shared = shared + plan_blocks + _blocks(document)
            jobs = [(lambda s=s: _write_part(dep_shared, system, lambda fix, s=s: P.dependent_task(label=label, section=s, target_words=s.target_words,
                                                                                                    minimum_words=s.min_words, plan=plan, fix=fix),
                                             section=s, area_heading="", minimum_words=s.min_words, minimum_clauses=None, number="", track=dep_tracks.get(s.number),
                                             should_stop=stopped)) for s in deps]
            for s, piece in zip(deps, _run_pool(jobs, lambda n: None, tick)):
                dep_pieces[s.number] = piece

        _stage(db, msg, "Putting the document together", **board.view())
        out: List[str] = [f"# {session.title}"]
        failures: List[str] = []
        for s in sections:
            out.append(f"## {s.full_heading}")
            if s.kind == "front":
                out.append(front[s.number])
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
            notes.append("These parts could not be written and are marked in the document: " + ", ".join(failures) + ". Ask Comply Agent to write them.")
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
        questions = questions_of(plan.get("questions"), limit=3)

        # apply it as the first draft (what the person typed meanwhile stays in the document's history), unless the person stopped it
        if not live.still_working(db, msg):
            raise claude_client.ClaudeStopped()
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
        service.accept_ops(db, current, msg, ["c1"], request.created_by if request is not None else msg.created_by, auto=True, summary="Comply Agent wrote the first draft")
        logger.info("studio draft %s: %s words, %s calls, %s rewritten, %s failed", message_id, words, total["calls"], rewritten, len(failures))
    except claude_client.ClaudeStopped:
        live.forget(db, message_id)
    except Exception as exc:        # noqa: BLE001 - the person sees a sentence, the log sees the cause
        live.fail(db, message_id, friendly(exc))


# ── putting the parts together ───────────────────────────────────────────────
_WAITING = {"todo": "*Waiting to be written.*", "writing": "*Comply Agent is writing this part…*", "rewriting": "*Comply Agent is rewriting this part…*",
            "failed": "*This part could not be written; the finished document says so.*"}


def _preview(title: str, sections: Sequence[Section], areas: Sequence[Dict[str, Any]], plan: Dict[str, Any], front: Dict[str, str],
             places: Dict[Tuple[str, str], str], written: Dict[str, Tuple[str, str]]) -> str:
    """The document as far as it is written: the parts that are done, the text of those being written, a line for each of the rest."""
    def part(section: Section, place: Tuple[str, str], heading: str = "") -> str:
        state, text = written.get(places.get(place, ""), ("todo", ""))
        if text.strip():
            return _clean(text, section, heading)
        return "*Written last, from the rest of the document.*" if section.kind == "dependent" and state == "todo" else _WAITING.get(state, _WAITING["todo"])

    out = [f"# {title}"]
    for s in sections:
        out.append(f"## {s.full_heading}")
        if s.kind == "front":
            out.append(front.get(s.number, ""))
        elif s.kind == "core":
            out.append(str(plan.get("core_intro") or "").strip())
            for a in areas:
                out += [f"### {s.number}.{a['index']} {a['title']}", part(s, (s.number, str(a["index"])), a["title"])]
        else:
            out.append(part(s, (s.number, "")))
    return "\n\n".join(x for x in out if x).strip() + "\n"


def _missing(section: Section, reason: Optional[str]) -> str:
    return f"[[This part could not be written: {(reason or 'Comply Agent did not answer').rstrip('. ')}. Ask Comply Agent to write the {section.heading.lower()} section.]]"


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
