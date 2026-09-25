"""Reads a regulatory circular clause by clause: every obligation it places on
us, then what those obligations touch on the platform.

The circular is read a section at a time, so nothing past its first pages is
lost (the earlier analysis read only the first 12,000 characters). Each
obligation comes back with its reference and the exact words it rests on, and
those words are checked against the circular: one whose quote can't be found
there is kept but marked unverified, for a person to check. The impact on
policies, controls and tasks is then worked out from the complete list.

The model is the regulatory model (REGULATORY_AI_MODEL, else gpt-6-luna) at
the reasoning effort each question needs (EFFORT), through the Responses API
with a strict JSON schema; the questions are asked in parallel. Every prompt passes the SCF licence screen first. If this
deployment's key can't use the regulatory model, the platform's default model
runs instead and the analysis records which one answered.

The work runs off the request and reports progress on the change's `analysis`
field, which the page polls.
"""
from __future__ import annotations

import contextvars
import json
import logging
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from typing import Any, Callable, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from ...models import GRCUser, RegulatoryChange, RegulatoryObligation

logger = logging.getLogger(__name__)

REGULATORY_MODEL_DEFAULT = "gpt-6-luna"
SECTION_CHARS = 8000
SECTION_OVERLAP = 500
PARALLEL_CALLS = 10          # the circular's identity, its impact and its sections, asked at once
CALL_TIMEOUT = 180           # seconds a single answer may take
EFFORT = {"identity": "low", "obligations": "medium", "impact": "medium"}
VERIFIED_AT = 0.8
STALE_AFTER = timedelta(minutes=10)
OBLIGATION_TYPES = ("requirement", "prohibition", "reporting", "deadline", "governance", "disclosure",
                    "record_keeping")
PRIORITIES = ("critical", "high", "medium", "low")
# Fields people set on an obligation; a re-analysis carries them over.
_HUMAN_FIELDS = ("compliance_status", "owner_id", "owner_ids", "department", "notes")
_REASONING_MODELS = ("gpt-5", "gpt-6", "o1", "o3", "o4")


def regulatory_model() -> str:
    return os.environ.get("REGULATORY_AI_MODEL") or REGULATORY_MODEL_DEFAULT


# ── Reading the text ─────────────────────────────────────────────────────────

def _pieces(para: str, size: int) -> List[str]:
    out = []
    while len(para) > size:
        cut = para.rfind(" ", 0, size)
        cut = cut if cut > size // 2 else size
        out.append(para[:cut])
        para = para[cut:].lstrip()
    return out + [para]


def split_sections(text: str, size: int = SECTION_CHARS, overlap: int = SECTION_OVERLAP) -> List[str]:
    """Consecutive stretches of the circular, broken at paragraph ends. Each
    starts with the tail of the one before, so a clause cut in two is read whole."""
    paras = [p for block in re.split(r"\n\s*\n", text or "") if block.strip() for p in _pieces(block.strip(), size)]
    sections: List[str] = []
    current = ""
    for para in paras:
        if current and len(current) + len(para) + 2 > size:
            sections.append(current)
            current = current[-overlap:] + "\n\n" + para
        else:
            current = f"{current}\n\n{para}" if current else para
    if current:
        sections.append(current)
    return sections


def _words(text: str) -> List[str]:
    return re.findall(r"[a-z0-9]+", (text or "").lower())


class QuoteChecker:
    """Whether a quoted passage is really in the circular, allowing for what text
    extraction and OCR do to it: small differences (the share of the quote's
    four-word runs found in the circular), and a table cell whose words come out
    split across lines with other cells between them (the share of the quote's
    words found in order within a short stretch of the circular)."""

    def __init__(self, text: str, n: int = 4):
        self.tokens = _words(text)
        self.n = n
        self.joined = " ".join(self.tokens)
        self.grams = {tuple(self.tokens[i:i + n]) for i in range(len(self.tokens) - n + 1)}
        self.at: Dict[str, List[int]] = {}
        for i, w in enumerate(self.tokens):
            self.at.setdefault(w, []).append(i)

    def _in_order(self, words: List[str]) -> float:
        """The share of the quote's words found in order around its rarest word."""
        from difflib import SequenceMatcher
        seen = [w for w in words if w in self.at]
        if not seen:
            return 0.0
        anchor = min(seen, key=lambda w: len(self.at[w]))
        span = 2 * len(words) + 10
        best = 0
        for i in self.at[anchor][:50]:
            window = self.tokens[max(0, i - span):i + span]
            best = max(best, sum(b.size for b in SequenceMatcher(None, words, window, autojunk=False).get_matching_blocks()))
        return best / len(words)

    def score(self, quote: str) -> float:
        words = _words(quote)
        if not words:
            return 0.0
        if " ".join(words) in self.joined:
            return 1.0
        runs = 0.0
        if len(words) >= self.n:
            grams = [tuple(words[i:i + self.n]) for i in range(len(words) - self.n + 1)]
            runs = sum(g in self.grams for g in grams) / len(grams)
        return round(max(runs, self._in_order(words)), 3)


# ── Asking the model ─────────────────────────────────────────────────────────

def _record(response, error, model: str, started: float) -> None:
    try:
        from ...services.ai_usage import record_provider_attempt
        record_provider_attempt(response=response, error=error, requested_model=model, provider="openai",
                                api_family="responses", started_at=started)
    except Exception:  # noqa: BLE001 — accounting never fails the analysis
        pass


def llm_json(system: str, prompt: str, schema: dict, name: str, *, effort: str = "high",
             max_output_tokens: int = 32000) -> Tuple[dict, str]:
    """One structured answer, and the model that gave it."""
    from openai import NotFoundError, OpenAI, PermissionDeniedError

    from ...config import get_openai_api_key, get_openai_base_url, get_openai_model
    from ...services.licence_guard import assert_llm_safe

    assert_llm_safe([{"role": "system", "content": system}, {"role": "user", "content": prompt}])
    client = OpenAI(api_key=get_openai_api_key(), base_url=get_openai_base_url(), timeout=CALL_TIMEOUT, max_retries=1)
    models = list(dict.fromkeys([regulatory_model(), get_openai_model()]))
    last: Optional[Exception] = None
    for model in models:
        kwargs: Dict[str, Any] = {
            "model": model, "instructions": system, "input": prompt, "max_output_tokens": max_output_tokens,
            "text": {"format": {"type": "json_schema", "name": name, "schema": schema, "strict": True}},
        }
        if model.lower().startswith(_REASONING_MODELS):
            kwargs["reasoning"] = {"effort": effort}
        started = time.time()
        try:
            response = client.responses.create(**kwargs)
        except (NotFoundError, PermissionDeniedError) as exc:     # this key can't use the model
            _record(None, exc, model, started)
            last = exc
            continue
        _record(response, None, model, started)
        if getattr(response, "status", "completed") == "incomplete":
            why = getattr(getattr(response, "incomplete_details", None), "reason", None) or "unknown"
            raise RuntimeError(f"The model stopped before finishing ({why}).")
        return json.loads(response.output_text), model
    raise last or RuntimeError("No model is configured.")


def _nullable(kind: str) -> dict:
    return {"type": [kind, "null"]}


_OBLIGATIONS_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["obligations"],
    "properties": {"obligations": {"type": "array", "items": {
        "type": "object", "additionalProperties": False,
        "required": ["ref", "quote", "summary", "obligation_type", "applies_to", "deadline", "deadline_text",
                     "priority"],
        "properties": {
            "ref": _nullable("string"),
            "quote": {"type": "string"},
            "summary": {"type": "string"},
            "obligation_type": {"type": "string", "enum": list(OBLIGATION_TYPES)},
            "applies_to": {"type": "array", "items": {"type": "string"}},
            "deadline": _nullable("string"),
            "deadline_text": _nullable("string"),
            "priority": {"type": "string", "enum": list(PRIORITIES)},
        },
    }}},
}
_ABOUT_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["title", "issuer", "reference", "issue_date", "effective_date", "applicability", "summary",
                 "supersedes"],
    "properties": {
        "title": {"type": "string"}, "issuer": _nullable("string"), "reference": _nullable("string"),
        "issue_date": _nullable("string"), "effective_date": _nullable("string"),
        "applicability": _nullable("string"), "summary": {"type": "string"},
        "supersedes": {"type": "array", "items": {"type": "string"}},
    },
}
_PRIORITY = {"type": "string", "enum": list(PRIORITIES)}
_BASIS = {"regulatory_basis": {"type": "string"}, "current_state": {"type": "string"}, "gap_detail": {"type": "string"},
          "affected_departments": {"type": "array", "items": {"type": "string"}},
          "related_audit_observation": _nullable("string")}


def _record_schema(fields: dict) -> dict:
    return {"type": "object", "additionalProperties": False, "required": list(fields), "properties": fields}


IMPACT_SCHEMA = _record_schema({
    "title": {"type": "string"}, "summary": {"type": "string"}, "priority": _PRIORITY,
    "effective_date_estimate": _nullable("string"), "impact_overview": {"type": "string"},
    "impacted_policies": {"type": "array", "items": _record_schema({
        "title": {"type": "string"},
        "action_needed": {"type": "string", "enum": ["review", "update", "create_new"]}, **_BASIS})},
    "impacted_controls": {"type": "array", "items": _record_schema({
        "id": {"type": "string"}, "name": {"type": "string"},
        "gap_type": {"type": "string", "enum": ["new_requirement", "modification", "obsolete"]}, **_BASIS})},
    "implementation_tasks": {"type": "array", "items": _record_schema({
        "title": {"type": "string"}, "description": {"type": "string"}, "priority": _PRIORITY,
        "suggested_deadline_days": {"type": "integer"},
        "task_tags": {"type": "array", "items": {"type": "string"}}})},
    "compliance_gaps": {"type": "array", "items": {"type": "string"}},
    "recommendations": {"type": "array", "items": {"type": "string"}},
})


def obligations_brief(obligations: List[dict], limit: int = 120000) -> str:
    """The obligations as the impact prompt lists them, each with its reference and words."""
    lines, used = [], 0
    for i, ob in enumerate(obligations, start=1):
        line = (f"O{i} [{ob.get('ref') or 'no ref'}] ({ob.get('obligation_type')}, {ob.get('priority')}"
                + (f", due {ob.get('deadline_text') or ob.get('deadline')}" if ob.get('deadline_text') or ob.get('deadline') else "")
                + f") {ob.get('summary')}\n    Text: \"{(ob.get('quote') or '')[:700]}\"")
        if used + len(line) > limit:
            lines.append(f"... {len(obligations) - i + 1} more obligations not shown")
            break
        lines.append(line)
        used += len(line)
    return "\n".join(lines)


_SYSTEM = ("You are a senior regulatory compliance analyst at a financial institution. You read regulatory "
           "circulars precisely and never invent text: every quote you give is copied word for word from the "
           "document in front of you.")


def _about(first_section: str, source: str, title_hint: Optional[str]) -> Tuple[dict, str]:
    prompt = f"""Identify this regulatory document from its opening.
Regulator named by the user: {source}. Title hint from the user: {title_hint or 'none'}.
Dates must be YYYY-MM-DD or null. "supersedes" lists earlier circulars or regulations it replaces or amends.
The summary is 3 to 5 sentences: what changes, for whom, and by when.

DOCUMENT OPENING:
{first_section[:9000]}"""
    return llm_json(_SYSTEM, prompt, _ABOUT_SCHEMA, "circular_identity", effort=EFFORT["identity"],
                    max_output_tokens=8000)


def _obligations_in(section: str, index: int, total: int, source: str, title_hint: Optional[str]) -> Tuple[List[dict], str]:
    prompt = f"""This is section {index} of {total} of a regulatory document{f' ("{title_hint}")' if title_hint else ''}
issued by {source or 'a regulator'}.

List EVERY obligation this section places on the regulated institution — each requirement,
prohibition, reporting or submission duty, deadline, governance or board duty, disclosure, and
record-keeping duty. One obligation per distinct duty; do not merge unrelated duties.

For each:
- ref: the section, paragraph or clause number exactly as the document numbers it, or null;
- quote: the sentence(s) the duty rests on, copied VERBATIM from the section (no paraphrase, no ellipsis
  inside a sentence);
- summary: the duty in one or two plain sentences, including any threshold, frequency or format;
- obligation_type, applies_to (the kinds of institution or function it applies to), priority
  (critical for board/deadline/penalty-backed duties, else by consequence);
- deadline: YYYY-MM-DD when the document fixes a date, else null; deadline_text: the deadline as written
  ("within 30 days of ...", "by 31 December 2026"), else null.

Definitions, background and recitals are not obligations. If the section has none, return an empty list.
Text repeated from the previous section's end may appear at the start; include its obligations anyway.

SECTION:
{section}"""
    data, model = llm_json(_SYSTEM, prompt, _OBLIGATIONS_SCHEMA, "circular_obligations", effort=EFFORT["obligations"])
    return data.get("obligations") or [], model


def _date(value: Optional[str]) -> Optional[date]:
    try:
        return datetime.strptime((value or "").strip(), "%Y-%m-%d").date()
    except ValueError:
        return None


def _key(ob: dict) -> Tuple[str, str]:
    """The same duty found twice (sections overlap) shares its words and its gist,
    whatever reference each reading gave it; two duties in one sentence differ in gist."""
    return " ".join(_words(ob.get("quote") or "")[:40]), " ".join(_words(ob.get("summary") or "")[:8])


def _better(new: dict, old: dict) -> bool:
    return (bool(new.get("ref")), len(new.get("quote") or "")) > (bool(old.get("ref")), len(old.get("quote") or ""))


# ── The job ──────────────────────────────────────────────────────────────────

def analysis_state(change: RegulatoryChange) -> Optional[dict]:
    """The analysis as the page shows it; a run the server lost is reported as stopped.
    Which model read it stays on the server (the AI usage ledger has it): the page says "AI"."""
    state = dict(change.analysis or {}) or None
    if state:
        state.pop("model", None)
        if isinstance(state.get("counts"), dict):
            state["counts"] = {k: v for k, v in state["counts"].items() if k != "model"}
    if state and state.get("status") in ("queued", "running"):
        beat = state.get("updated_at") or state.get("started_at")
        try:
            stale = datetime.utcnow() - datetime.fromisoformat(beat) > STALE_AFTER
        except (TypeError, ValueError):
            stale = True
        if stale:
            state.update(status="failed", error="The analysis stopped before finishing. Run it again.")
    return state


def is_running(change: RegulatoryChange) -> bool:
    return (analysis_state(change) or {}).get("status") in ("queued", "running")


def _progress(db: Session, change: RegulatoryChange, **fields) -> None:
    change.analysis = {**(change.analysis or {}), **fields, "updated_at": datetime.utcnow().isoformat()}
    db.commit()


class _ObligationStore:
    """Obligations written as each section is read. The first answer replaces the
    previous reading's obligations — what people set on the ones that recur is
    carried over — and a duty found in two overlapping sections is kept once."""

    def __init__(self, db: Session, change: RegulatoryChange, user_id: int, checker: QuoteChecker):
        self.db, self.change, self.user_id, self.checker = db, change, user_id, checker
        self.prior: Optional[Dict[Tuple[str, str], RegulatoryObligation]] = None
        self.rows: Dict[Tuple[str, str], RegulatoryObligation] = {}
        self.moved: Dict[int, RegulatoryObligation] = {}

    def _replace_previous(self) -> None:
        old = self.db.query(RegulatoryObligation).filter(
            RegulatoryObligation.regulatory_change_id == self.change.id, RegulatoryObligation.source == "ai",
            RegulatoryObligation.deleted_at.is_(None)).all()
        self.prior = {_key({"quote": o.quote, "summary": o.summary}): o for o in old}
        now = datetime.utcnow()
        for o in old:
            o.deleted_at = now

    def add(self, items: List[dict], section: int) -> None:
        if self.prior is None:
            self._replace_previous()
        for n, ob in enumerate(items):
            if not (ob.get("summary") or "").strip():
                continue
            key = _key(ob)
            score = self.checker.score(ob.get("quote") or "")
            row = self.rows.get(key)
            if row is not None:
                if _better(ob, {"ref": row.ref, "quote": row.quote}):
                    row.ref, row.quote = ob.get("ref") or row.ref, ob.get("quote")
                    row.match_score, row.verified = score, score >= VERIFIED_AT
                continue
            prior = self.prior.get(key)
            row = RegulatoryObligation(
                tenant_id=self.change.tenant_id, regulatory_change_id=self.change.id, position=section * 1000 + n,
                ref=(ob.get("ref") or None), quote=ob.get("quote"), summary=ob["summary"].strip(),
                obligation_type=ob.get("obligation_type") if ob.get("obligation_type") in OBLIGATION_TYPES else "requirement",
                applies_to=[str(a)[:80] for a in (ob.get("applies_to") or [])][:12],
                deadline=_date(ob.get("deadline")), deadline_text=(ob.get("deadline_text") or None),
                priority=ob.get("priority") if ob.get("priority") in PRIORITIES else "medium",
                verified=score >= VERIFIED_AT, match_score=score, source="ai", created_by=self.user_id,
                **({f: getattr(prior, f) for f in _HUMAN_FIELDS} if prior else {}),
            )
            self.db.add(row)
            self.rows[key] = row
            if prior is not None:
                self.moved[prior.id] = row
        self.db.flush()

    def finish(self) -> None:
        from .regulatory_links import carry_decisions
        carry_decisions(self.db, {pid: row.id for pid, row in self.moved.items()})

    def counts(self) -> Tuple[int, int]:
        return len(self.rows), sum(1 for r in self.rows.values() if r.verified)


def _apply_about(change: RegulatoryChange, about: dict, keep_title: bool) -> None:
    """The circular's own title, reference and dates onto the change."""
    title, ref = (about.get("title") or "").strip(), (about.get("reference") or "").strip()
    if title and not keep_title:
        change.title = (f"{title} ({ref})" if ref and ref.lower() not in title.lower() else title)[:500]
    change.regulation_reference = change.regulation_reference or (ref or None)
    issued, effective = _date(about.get("issue_date")), _date(about.get("effective_date"))
    if issued and not change.published_date:
        change.published_date = datetime.combine(issued, datetime.min.time())
    if effective and not change.effective_date:
        change.effective_date = datetime.combine(effective, datetime.min.time())


def analyse(db: Session, change: RegulatoryChange, user: GRCUser, *, update_change_fields: bool,
            title_hint: Optional[str] = None, filename: Optional[str] = None, keep_title: bool = False,
            report: Optional[Callable[..., None]] = None) -> dict:
    """Read the circular, record what it requires and what it touches. Returns counts.

    The circular's identity, its impact on policies and controls, and every one of
    its sections are asked for at the same time, and each answer is written as it
    arrives, so the page fills in while the rest is still being read. A part that
    fails is reported; the rest still counts."""
    from .regulatory_links import suggest_controls
    from .routers.regulatory_changes import IMPACT_SYSTEM, _impact_context, _persist_impact

    report = report or (lambda **_: None)
    text = (change.source_text or change.description or "").strip()
    if not text:
        raise ValueError("This change has no circular text or description to analyse.")
    sections = split_sections(text, SECTION_CHARS, SECTION_OVERLAP)
    store = _ObligationStore(db, change, user.id, QuoteChecker(text))
    prompt, state = _impact_context(db, change, text)          # database reads stay on this thread
    total, done, model = len(sections) + 2, 0, regulatory_model()
    failed: List[str] = []
    reasons: List[str] = []
    result: dict = {}
    report(step="Reading the circular", done_steps=0, total_steps=total, found=0)

    def ask(fn, *args, **kwargs):          # each worker books its AI usage to the tenant
        return pool.submit(contextvars.copy_context().run, fn, *args, **kwargs)

    with ThreadPoolExecutor(max_workers=max(1, min(PARALLEL_CALLS, total))) as pool:
        futures = {ask(llm_json, IMPACT_SYSTEM, prompt, IMPACT_SCHEMA, "regulatory_impact", effort=EFFORT["impact"],
                       max_output_tokens=48000): ("impact", 0),
                   ask(_about, sections[0], change.source, title_hint): ("about", 0)}
        for i, section in enumerate(sections, start=1):
            futures[ask(_obligations_in, section, i, len(sections), change.source, title_hint)] = ("section", i)
        for future in as_completed(futures):
            kind, i = futures[future]
            done += 1
            try:
                answer, model = future.result()
                if kind == "section":
                    store.add(answer, i)
                elif kind == "about":
                    if update_change_fields:
                        _apply_about(change, answer, keep_title)
                else:
                    result = _persist_impact(db, change, answer, user, state, update_change_fields=update_change_fields,
                                             title_hint=title_hint, filename=filename, set_title=False)
                db.commit()
            except Exception as exc:  # noqa: BLE001 — one part failing doesn't sink the rest
                db.rollback()
                logger.warning("Regulatory analysis of change %s: %s failed: %s", change.id, kind, exc)
                failed.append({"about": "the circular's details", "impact": "the impact on policies and controls"}
                              .get(kind, f"section {i}"))
                reasons.append(str(getattr(exc, "detail", None) or exc)[:200])
            found, _ = store.counts()
            report(step=f"{done} of {total} parts read", done_steps=done, total_steps=total, found=found, model=model)
    if len(failed) == total:
        raise RuntimeError(f"The AI could not read the circular ({reasons[0]}). Try again in a moment.")
    store.finish()
    report(step="Suggesting the controls that meet each obligation", done_steps=total, total_steps=total,
           found=store.counts()[0], model=model)
    linked = suggest_controls(db, change, user.id)
    found, verified = store.counts()
    return {**result, **linked, "obligations": found, "verified": verified, "unverified": found - verified,
            "sections": len(sections), "model": model, "failed": failed}


def run_job(tenant_slug: str, change_id: int, user_id: int, options: dict) -> None:
    """The background run: its own tenant session, progress on the change, never raises."""
    from ...db import open_tenant_session
    from ...services.ai_usage import usage_scope

    db = open_tenant_session(tenant_slug)
    try:
        change = db.get(RegulatoryChange, change_id)
        user = db.get(GRCUser, user_id)
        if change is None or user is None:
            return
        _progress(db, change, status="running", started_at=datetime.utcnow().isoformat(), error=None)
        started = time.time()
        with usage_scope(tenant_slug=tenant_slug, actor_user_id=user_id,
                         background_job_id=f"regulatory-analysis-{change_id}", module_key="governance",
                         feature_key="regulatory_circular_analysis"):
            counts = analyse(db, change, user, report=lambda **f: _progress(db, change, **f), **options)
        change.analysis = {**(change.analysis or {}), "status": "done", "step": "Finished", "counts": counts,
                           "model": counts["model"], "seconds": round(time.time() - started),
                           "finished_at": datetime.utcnow().isoformat(), "updated_at": datetime.utcnow().isoformat()}
        db.commit()
    except Exception as exc:  # noqa: BLE001 — the page shows what went wrong
        logger.exception("Regulatory analysis failed for change %s", change_id)
        db.rollback()
        try:
            change = db.get(RegulatoryChange, change_id)
            if change is not None:
                _progress(db, change, status="failed", error=str(getattr(exc, "detail", None) or exc)[:500])
        except Exception:  # noqa: BLE001
            db.rollback()
    finally:
        db.close()


def start(db: Session, change: RegulatoryChange, user: GRCUser, tenant_slug: str, **options) -> None:
    """Queue an analysis of the change and run it in the background.

    ponytail: a thread in the web process — nothing to deploy, and a run a restart
    interrupts shows as stopped so it can be run again. Move it to a Celery task
    if analyses must survive restarts.
    """
    change.analysis = {"status": "queued", "step": "Waiting to start", "queued_at": datetime.utcnow().isoformat(),
                       "updated_at": datetime.utcnow().isoformat(), "model": regulatory_model()}
    db.commit()
    threading.Thread(target=run_job, args=(tenant_slug, change.id, user.id, options), daemon=True,
                     name=f"regulatory-analysis-{change.id}").start()
