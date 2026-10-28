"""Rules for the vendor questionnaire portal, apart from the routes so each can be
tested on its own.

A questionnaire moves pending → in_progress → submitted → under_review, and from
there either to accepted or back to the vendor as returned, where only the
questions the reviewer asked about can change. Submitting takes a named person
who attests to the answers. Which questions apply is worked out again on the
server at submit, so an answer to a question the vendor could not see neither
counts nor blocks.

A questionnaire sent since personal links exist is reached only through its
supplier's portal (tpra/supplier_portal.py): its own token is sealed, never sent
and never matched.

Question rules, checked at submit over the questions that apply: a required
question needs an answer (a `file` question's answer is its upload); evidence is
none, optional or required, required on any answer or on the ones `evidence_on`
names, and it must be linked to that question; an answer picked from an option
marked not applicable needs a reason, and one marked `comment_required` a note
(both are the question's comment). A question from before the rules, with only
`evidence_required`, owes evidence on Yes or Partial, as it always did.
"""
from __future__ import annotations

import hashlib
import os
import secrets
import threading
import time
from collections import deque
from datetime import datetime
from typing import Dict, Iterable, List, Optional, Set, Tuple

from ....models import TPRAEvidenceLink, VendorQuestionnaireEvidence
from .engine_scoring import normalize_answer

WAITING_ON_VENDOR = ("pending", "in_progress", "returned")
ANSWERED = ("submitted", "under_review", "returned", "accepted")
REVIEWABLE = ("submitted", "under_review")
SEALED = "sealed:"


def base_url() -> str:
    """Where the web app lives, for links in emails; empty when not configured."""
    return (os.environ.get("FRONTEND_URL") or os.environ.get("NEXT_PUBLIC_APP_URL") or "").rstrip("/")


def link(token: str) -> Optional[str]:
    root = base_url()
    return f"{root}/vendor-risk/questionnaires/{token}" if root else None


def sealed_token() -> str:
    return SEALED + secrets.token_hex(24)


def is_sealed(token: Optional[str]) -> bool:
    return (token or "").startswith(SEALED)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def supplier_link(raw: str, questionnaire_id: Optional[int] = None) -> str:
    """A contact's personal link, opening one questionnaire when given. Relative
    when the app's address is not configured (the analyst's copy completes it)."""
    return f"{base_url()}/supplier/{raw}" + (f"?q={questionnaire_id}" if questionnaire_id else "")


def client_ip(request) -> Optional[str]:
    """The address failed lookups are counted against. ponytail: a loopback address
    means a proxy that did not pass the client on, and counting it would lock every
    supplier out at once, so there is no failure count then."""
    host = request.client.host if request is not None and request.client else None
    return None if host in (None, "127.0.0.1", "::1", "localhost") else host


def _value(answer) -> str:
    if isinstance(answer, dict):
        answer = answer.get("value") or answer.get("answer") or answer.get("response")
    return "" if answer is None else str(answer).strip()


def visible_questions(questions: List[dict], answers: dict) -> List[dict]:
    """The questions that apply given the answers so far. A question with
    `show_if: {"question": <key>, "in": [values]}` applies only when that earlier
    question applies and was answered with one of the values."""
    shown: List[dict] = []
    keys = set()
    for q in questions or []:
        rule = q.get("show_if")
        if isinstance(rule, dict) and rule.get("question"):
            ctrl = str(rule["question"])
            allowed = {str(v).strip().lower() for v in rule.get("in") or []}
            if ctrl not in keys or _value(answers.get(ctrl)).lower() not in allowed:
                continue
        shown.append(q)
        keys.add(str(q.get("id")))
    return shown


def _type(q: dict) -> str:
    return q.get("type") or q.get("qtype") or "yes_no"


def answered(q: dict, answer, evidence: Iterable[str] = ()) -> bool:
    """A file question is answered by a file linked to it; any other by a value."""
    return str(q.get("id")) in evidence if _type(q) == "file" else bool(_value(answer))


def missing_required(questions: List[dict], answers: dict, evidence: Iterable[str] = ()) -> List[str]:
    evidence = set(evidence)
    return [str(q.get("id")) for q in visible_questions(questions, answers)
            if q.get("required") and not answered(q, answers.get(str(q.get("id"))), evidence)]


def _option(q: dict, value: str) -> Optional[dict]:
    value = value.lower()
    return next((o for o in q.get("options") or []
                 if isinstance(o, dict) and str(o.get("value", "")).strip().lower() == value), None)


def not_applicable(option: Optional[dict]) -> bool:
    return bool(option and (option.get("na") or option.get("not_applicable")))


def evidence_rule(q: dict) -> Tuple[str, Set[str]]:
    """How a question asks for evidence (none, optional or required) and the answers
    that owe it (empty: any answer)."""
    mode = q.get("evidence")
    if mode in ("none", "optional", "required"):
        return mode, {str(v).strip().lower() for v in q.get("evidence_on") or []}
    return ("required", {"yes", "partial"}) if q.get("evidence_required") else ("optional", set())


def owes_evidence(q: dict, answer) -> bool:
    """Whether this answer owes evidence. A file question's file is its answer, and a
    not-applicable answer owes a reason instead."""
    mode, on = evidence_rule(q)
    value = _value(answer)
    if mode != "required" or not value or _type(q) == "file" or not_applicable(_option(q, value)):
        return False
    return not on or value.lower() in on or normalize_answer(value) in on


def note_needed(q: dict, answer) -> Optional[str]:
    """'reason' for a not-applicable answer, 'note' for one whose option asks for a
    note, else None."""
    option = _option(q, _value(answer))
    if not_applicable(option):
        return "reason"
    return "note" if option and option.get("comment_required") else None


def problems(questions: List[dict], answers: dict, comments: dict, evidence: Iterable[str],
             only: Optional[Set[str]] = None) -> Dict[str, List[str]]:
    """What stops a submission, by kind, over the questions that apply (or only those
    in `only`): an answer, a document, a reason or a note still missing."""
    evidence, found = set(evidence), {"answer": [], "document": [], "reason": [], "note": []}
    for q in visible_questions(questions, answers):
        key = str(q.get("id"))
        if only is not None and key not in only:
            continue
        answer = answers.get(key)
        if not answered(q, answer, evidence):
            if q.get("required"):
                found["answer"].append(key)
            continue
        if owes_evidence(q, answer) and key not in evidence:
            found["document"].append(key)
        need = note_needed(q, answer)
        if need and not str((comments or {}).get(key) or "").strip():
            found[need].append(key)
    return found


_SAYS = {"answer": ("question needs an answer", "questions need an answer"),
         "document": ("question needs a document", "questions need a document"),
         "reason": ("not-applicable answer needs a reason", "not-applicable answers need a reason"),
         "note": ("answer needs a note", "answers need a note")}


def problem_sentence(found: Dict[str, List[str]]) -> Optional[str]:
    """The problems as one sentence of counts, or None when there are none."""
    parts = [f"{len(keys)} {_SAYS[kind][len(keys) != 1]}" for kind, keys in found.items() if keys]
    if not parts:
        return None
    return "Before you submit: " + (", ".join(parts[:-1]) + " and " + parts[-1] if len(parts) > 1 else parts[0]) + "."


def evidence_keys(db, qr) -> Set[str]:
    """The questions of a questionnaire that have evidence linked to them: a file the
    supplier sent for it, or library evidence attached to it."""
    keys = {k for (k,) in db.query(TPRAEvidenceLink.question_key).filter(
        TPRAEvidenceLink.questionnaire_id == qr.id, TPRAEvidenceLink.deleted_at.is_(None))}
    keys.update(k for (k,) in db.query(VendorQuestionnaireEvidence.question_id).filter(
        VendorQuestionnaireEvidence.response_id == qr.id))
    return {str(k) for k in keys if k}


def clarifications(review: Optional[dict]) -> Dict[str, Optional[str]]:
    """Questions the reviewer sent back, with what they asked."""
    return {k: (v or {}).get("note") for k, v in (review or {}).items()
            if isinstance(v, dict) and v.get("status") == "clarify"}


def merge(status: str, questions: List[dict], existing: dict, incoming: dict,
          review: Optional[dict]) -> dict:
    """The answers after a save. While returned, only the questions sent back can
    change; otherwise everything can. Answers to questions that no longer apply,
    or that are not in the questionnaire at all, are dropped."""
    keys = {str(q.get("id")) for q in questions or []}
    if status == "returned":
        editable = set(clarifications(review))
        merged = dict(existing or {})
        merged.update({k: v for k, v in (incoming or {}).items() if k in editable})
    else:
        merged = {k: v for k, v in (incoming or {}).items() if k in keys}
    applies = {str(q.get("id")) for q in visible_questions(questions, merged)}
    return {k: v for k, v in merged.items() if k in applies and _value(v) != ""}


def clean_attestation(raw: Optional[dict]) -> dict:
    """The named person standing behind a submission."""
    raw = raw or {}
    name = " ".join(str(raw.get("name") or "").split())[:255]
    email = str(raw.get("email") or "").strip()[:255]
    title = " ".join(str(raw.get("title") or "").split())[:255]
    if not name:
        raise ValueError("Give the name of the person attesting to these answers")
    if "@" not in email or "." not in email.split("@")[-1]:
        raise ValueError("Give the attesting person's email address")
    if raw.get("confirm") is not True:
        raise ValueError("Confirm that the answers are accurate and complete")
    return {"name": name, "email": email, "title": title or None, "at": datetime.utcnow()}


class Throttle:
    """At most `limit` requests per `window` seconds for one questionnaire link,
    and at most `failures` failed link lookups per window from one address.

    ponytail: per process, so each web worker allows its own quota; move the
    counts to Redis if links are ever hammered from many addresses at once."""

    def __init__(self, limit: int = 120, window: float = 300.0, failures: int = 10):
        self.limit, self.window, self.failures = limit, window, failures
        self._hits: Dict[str, deque] = {}
        self._lock = threading.Lock()

    def _recent(self, key: str, now: float) -> deque:
        hits = self._hits.setdefault(key, deque())
        while hits and now - hits[0] > self.window:
            hits.popleft()
        return hits

    def failing(self, address: Optional[str], now: Optional[float] = None) -> bool:
        """Whether this address has used up its failed lookups for now."""
        if not address:
            return False
        with self._lock:
            return len(self._recent(f"fail:{address}", time.monotonic() if now is None else now)) >= self.failures

    def failed(self, address: Optional[str], now: Optional[float] = None) -> None:
        if address:
            now = time.monotonic() if now is None else now
            with self._lock:
                self._recent(f"fail:{address}", now).append(now)

    def allow(self, key: str, now: Optional[float] = None) -> bool:
        now = time.monotonic() if now is None else now
        with self._lock:
            hits = self._recent(key, now)
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            if len(self._hits) > 5000:          # forget links nobody has used lately
                for k in [k for k, h in self._hits.items() if not h or now - h[-1] > self.window]:
                    del self._hits[k]
            return True


throttle = Throttle()
