"""Rules for the vendor questionnaire portal, apart from the routes so each can be
tested on its own.

A questionnaire moves pending → in_progress → submitted → under_review, and from
there either to accepted or back to the vendor as returned, where only the
questions the reviewer asked about can change. Submitting takes a named person
who attests to the answers. Which questions apply is worked out again on the
server at submit, so an answer to a question the vendor could not see neither
counts nor blocks.
"""
from __future__ import annotations

import os
import threading
import time
from collections import deque
from datetime import datetime
from typing import Dict, List, Optional

WAITING_ON_VENDOR = ("pending", "in_progress", "returned")
ANSWERED = ("submitted", "under_review", "returned", "accepted")
REVIEWABLE = ("submitted", "under_review")


def base_url() -> str:
    """Where the web app lives, for links in emails; empty when not configured."""
    return (os.environ.get("FRONTEND_URL") or os.environ.get("NEXT_PUBLIC_APP_URL") or "").rstrip("/")


def link(token: str) -> Optional[str]:
    root = base_url()
    return f"{root}/vendor-risk/questionnaires/{token}" if root else None


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


def missing_required(questions: List[dict], answers: dict) -> List[str]:
    return [str(q.get("id")) for q in visible_questions(questions, answers)
            if q.get("required") and not _value(answers.get(str(q.get("id"))))]


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
    """At most `limit` requests per `window` seconds for one questionnaire link.

    ponytail: per process, so each web worker allows its own quota; move the
    counts to Redis if links are ever hammered from many addresses at once."""

    def __init__(self, limit: int = 120, window: float = 300.0):
        self.limit, self.window = limit, window
        self._hits: Dict[str, deque] = {}
        self._lock = threading.Lock()

    def allow(self, key: str, now: Optional[float] = None) -> bool:
        now = time.monotonic() if now is None else now
        with self._lock:
            hits = self._hits.setdefault(key, deque())
            while hits and now - hits[0] > self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            if len(self._hits) > 5000:          # forget links nobody has used lately
                for k in [k for k, h in self._hits.items() if not h or now - h[-1] > self.window]:
                    del self._hits[k]
            return True


throttle = Throttle()
