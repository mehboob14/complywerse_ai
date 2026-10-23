"""A governance document's approval record: who reviewed and approved this version, in which stages and order, when and with which
drawn signature, and the workflow that ran behind it from draft to publication (the user, 2026-10-23: regulated documents end with a
section where everybody who signed is placed with signs and dates, however many the stages are, maintained by the platform, not by
people; the Change log has the detail on demand; the record goes with the document when compliance gives it to an auditor).

It is derived, never stored, so it cannot drift from the facts and needs no hook: it is read, on demand, from what the platform
already keeps append-only - the sign-off signatures (``DocumentSignature``) and the drawn e-signatures sealed with them, the changes
asked for (``DocumentRouteHold``), the document's audit trail, its versions - and, while the document is in review or approval, from
the route's live state (``routes.view``) for the people who have not signed yet. A document that goes through the life cycle again
gets a new round and the record follows; the rounds of earlier versions are summarised in ``history``.

Which signatures belong to a record. The newest version's is the document's current round (``signoff_round_at`` on, what the screens
call this round); an earlier version's is its last round, the span between two round starts of the audit trail (sent for review, back
to review after a change, a major change resubmitted) that holds signatures given on it - on it by ``DocumentSignature.version_id``
(by its e-signature's version for the rows from before that was kept). A signature of a stage that started again after changes were
asked for no longer counts (``routes.signatures_of`` / ``earlier_of``): ``notes`` says how many, they are not listed. Names and
designations are the e-signature's snapshot when there is one, else the person's current ones - a designation is never made up.

Reading only: nothing here writes or commits. Who may read a document is the caller's (``permissions.require_doc_reader``); someone who
reads the version in force instead of the newest (``permissions.version_for``) gets that version's record and nothing about a newer
round or any version after it.
"""
from __future__ import annotations

import hashlib
import json
from bisect import bisect_right
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Sequence, Tuple

from fastapi import HTTPException, status
from sqlalchemy import func

from ...models import (DocumentAuditLog, DocumentRouteHold, DocumentRouteStage, DocumentSignature, ElectronicSignature,
                       GovernanceDocumentVersion, GRCDepartment, GRCUser)
from . import permissions, routes

STATES = {"published": "published", "expired": "published", "exception_applied": "published", "review_required": "published",
          "approved": "approved", "pending_approval": "in_approval", "pending_review": "in_review", "archived": "archived"}
APPROVED_LIKE = ("approved", "published", "expired", "exception_applied", "review_required")      # approved at some point, not withdrawn from approval
DEFAULT_LABEL = {1: "Reviewed by", 2: "Approved by"}          # the usual route: its reviewers, then its approvers
MAX_MILESTONES = 100
MAX_TEXT = 700                                                  # a comment is cut here; the Change log has it whole
_STARTS = ("sent_for_review", "sent_for_approval")
_ACTIONS = _STARTS + ("signed", "rejected", "changes_requested", "resubmitted", "published", "archived", "approved")
_ORDER = {"Prepared": 0, "Sent for review": 1, "Changes requested": 2, "Resubmitted": 3, "Rejected": 4,
          "Stage complete": 5, "Approved": 6, "Published": 7, "Archived": 8}          # the order of events that share a moment
UNKNOWN = "unknown"                                             # the version of approvals that were not tied to one when they were given
_STAGE_STATUS = {"on_hold": "changes_requested", "done": "complete", "informed": "complete"}      # a stage of the live route; anything else is pending
_DECISION = {"waiting": "pending", "not_yet": "pending", "changes_requested": "changes_requested", "delegated": "delegated"}
_FAR = 1 << 60                                                  # the rank of a version that has no row


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _cut(text: Optional[str], n: int = MAX_TEXT) -> Optional[str]:
    text = (text or "").strip()
    if not text:
        return None
    return text if len(text) <= n else text[:n].rstrip() + " …"


def _when(s) -> Tuple[datetime, int]:
    """A signature's place in time; ties (the clock ticks in steps on Windows) go by id."""
    return s.signed_at or datetime.min, s.id


def state_of(doc_status: Optional[str]) -> str:
    return STATES.get(doc_status or "", "draft")


def _pos(s) -> Optional[int]:
    """The stage a signature was given at: its route stage, or on the usual route 1 (review) / 2 (approval) by its role."""
    if s.stage_position is not None:
        return s.stage_position
    return {"reviewer": 1, "approver": 2}.get(s.role_type)


@dataclass
class _RoundOf:
    """What ``routes.restarts`` reads of a document: its id and when the round it is asked about began (an earlier round's, here)."""
    id: int
    signoff_round_at: Optional[datetime]


@dataclass
class _Round:
    """The signatures of one sign-off round (signed and rejected, by id), the span of time it covers and the stage restarts in it."""
    number: Optional[str]
    start: Optional[datetime]
    end: Optional[datetime]
    sigs: List[Any]
    marks: Dict[int, int]

    def contains(self, when: Optional[datetime], early: timedelta = timedelta(0)) -> bool:
        return when is not None and (self.start is None or when >= self.start - early) and (self.end is None or when < self.end)


class _Facts:
    """Everything a record is read from, loaded once (columns only for the rows that carry a document's text)."""

    def __init__(self, db, doc):
        self.db, self.doc = db, doc
        V, S, E, A, H, R = (GovernanceDocumentVersion, DocumentSignature, ElectronicSignature, DocumentAuditLog, DocumentRouteHold,
                            DocumentRouteStage)
        self.versions = (db.query(V.id, V.version_number, V.change_type, V.change_summary, V.created_at, V.created_by, V.title)
                         .filter(V.document_id == doc.id).order_by(V.id).all())
        self.row = {v.id: v for v in self.versions}
        self.rank: Dict[str, int] = {}
        for v in self.versions:
            self.rank.setdefault(v.version_number, v.id)
        self.sigs = db.query(S).filter(S.document_id == doc.id, S.decision.in_(("signed", "rejected"))).order_by(S.id).all()
        self.esig: Dict[int, Any] = {}
        if self.sigs:
            self.esig = {r.record_id: r for r in db.query(E.id, E.record_id, E.signer_name, E.signer_title, E.document_version, E.seal,
                                                          func.length(E.image_png).label("ink"))
                         .filter(E.record_type == "document_signoff", E.record_id.in_([s.id for s in self.sigs])).order_by(E.id)}
        self.audit = (db.query(A.id, A.action, A.action_details, A.field_changed, A.old_value, A.new_value, A.performed_by, A.performed_at)
                      .filter(A.document_id == doc.id, A.action.in_(_ACTIONS) | (A.field_changed == "status"))
                      .order_by(A.performed_at, A.id).all())
        self.holds = (db.query(H.id, H.round_at, H.stage_position, H.requested_by, H.requested_at)
                      .filter(H.document_id == doc.id).order_by(H.id).all())
        self.route = {r.position: r for r in db.query(R.position, R.name, R.kind, R.rule, R.min_count, R.created_at)
                      .filter(R.document_id == doc.id).order_by(R.position)}
        ids = ({s.signer_user_id for s in self.sigs} | {s.on_behalf_of for s in self.sigs} | {v.created_by for v in self.versions}
               | {doc.owner_id, doc.author_id, doc.published_by, doc.approved_by} | {a.performed_by for a in self.audit}
               | {h.requested_by for h in self.holds})
        self.people: Dict[int, Tuple[str, Optional[str]]] = {}
        self._load(ids)
        dated = [a for a in self.audit if a.performed_at is not None]
        self.starts = sorted(a.performed_at for a in dated if self.starts_a_round(a))
        self.approvals = [a for a in dated if self.approves(a)]
        self.publications = [a for a in dated if self.publishes(a)]
        self.archivals = [a for a in dated if a.action == "archived" or (a.field_changed == "status" and a.new_value == "archived")]
        self._past: Optional[List[_Round]] = None

    # ── reading the audit trail ──────────────────────────────────────────────
    @staticmethod
    def starts_a_round(a) -> bool:
        """The document went to review (Send, back to review after a change, a major change resubmitted): a new sign-off round. A stage
        advancing within the round (pending_review -> pending_approval) is not one."""
        if a.action in _STARTS or (a.action == "resubmitted" and a.new_value == "major"):
            return True
        return (a.field_changed == "status" and a.new_value in routes.PENDING
                and not (a.old_value == "pending_review" and a.new_value == "pending_approval"))

    @staticmethod
    def approves(a) -> bool:
        """The row that says the document was approved: the signature that completed its last stage (sign_document ends its text with
        ``→ approved``), a status change to approved (a stage ended when a signer was removed, or set by hand) or the older engines' row."""
        return ((a.action == "signed" and (a.action_details or "").rstrip().endswith("→ approved"))
                or (a.field_changed == "status" and a.new_value == "approved") or a.action == "approved")

    @staticmethod
    def publishes(a) -> bool:
        return a.action == "published" or (a.field_changed == "status" and a.new_value == "published")

    # ── people ───────────────────────────────────────────────────────────────
    def _load(self, ids) -> None:
        ids = {i for i in ids if i and i not in self.people}
        if ids:
            self.people.update({r.id: (r.display_name or r.username or f"User #{r.id}", r.designation or None) for r in
                                self.db.query(GRCUser.id, GRCUser.display_name, GRCUser.username, GRCUser.designation).filter(GRCUser.id.in_(ids))})

    def name(self, uid: Optional[int]) -> Optional[str]:
        self._load([uid])
        return self.people.get(uid, (f"User #{uid}", None))[0] if uid else None

    def designation(self, uid: Optional[int]) -> Optional[str]:
        """The person's current designation (a signature's own snapshot is read first, ``_person``); None when there is none."""
        self._load([uid])
        return self.people.get(uid, (None, None))[1] if uid else None

    # ── versions ─────────────────────────────────────────────────────────────
    def version_of(self, s) -> Optional[str]:
        """The version a signature was given on: its ``version_id``, else its e-signature's version, else unknown."""
        v = self.row.get(s.version_id) if s.version_id else None
        if v is not None:
            return v.version_number
        e = self.esig.get(s.id)
        return (e.document_version or None) if e is not None else None

    def prepared(self, number: str) -> Dict[str, Any]:
        """Who prepared the version and when it was made: its row's creator and time (a baseline row records the first edit, not the
        version: then the document's own author and creation). The preparer never signs in the platform, so there is no signature."""
        rows = [v for v in self.versions if v.version_number == number]
        row = next((v for v in rows if v.change_type != "baseline"), rows[0] if rows else None)
        real = row is not None and row.change_type != "baseline"
        who = (row.created_by if real else None) or self.doc.author_id or self.doc.owner_id or (row.created_by if row is not None else None)
        return {"name": self.name(who), "designation": self.designation(who), "at": _iso(row.created_at if real else self.doc.created_at),
                "summary": _cut(row.change_summary, 300) if row is not None else None}

    def target(self, version: Optional[str], current: str, forced) -> str:
        """The version a record is about: the one asked for, else the version in force for someone who reads that one, else the
        newest. A version that does not exist - or is newer than the one in force for them - is not found."""
        number = str(version or "").strip()
        if not number:
            return forced.version_number if forced is not None else current
        if number[:1] in "vV" and number[1:2].isdigit():
            number = number[1:]
        if (number not in self.rank and number != current) or (forced is not None and self.rank.get(number, _FAR) > forced.id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That version of the document was not found.")
        return number

    # ── rounds ───────────────────────────────────────────────────────────────
    def current_round(self, number: str) -> _Round:
        """The document's own round, from ``signoff_round_at`` on. A draft, or an archived document, holds only what was signed on this
        version: the signatures of a round that ended are not carried over to a version made since."""
        start = self.doc.signoff_round_at
        sigs = [s for s in self.sigs if start is None or (s.signed_at is not None and s.signed_at >= start)]
        if self.doc.status in ("draft", "archived"):
            sigs = [s for s in sigs if self.version_of(s) in (None, number)]
        return _Round(number, start, None, sigs, routes.restarts(self.db, self.doc))

    def past_rounds(self) -> List[_Round]:
        """Every round of the audit trail with signatures, oldest first, each about the version its last signature was given on. A
        round runs from one round start to the next; the stage restarts in it are the changes asked for in that span."""
        if self._past is None:
            buckets: Dict[int, List[Any]] = {}
            for s in self.sigs:
                if s.signed_at is not None:
                    buckets.setdefault(bisect_right(self.starts, s.signed_at), []).append(s)
            self._past = []
            for i in sorted(buckets):
                sigs = buckets[i]
                start = self.starts[i - 1] if i > 0 else None
                end = self.starts[i] if i < len(self.starts) else None
                number = next((v for v in (self.version_of(s) for s in sorted(sigs, key=_when, reverse=True)) if v), None)   # None: not tied to a version
                # the stages that started again after changes were asked for in this span: ``routes.restarts`` for the round(s) the changes
                # asked for in it belong to (a hold keeps the start of its round: ``round_at``)
                marks: Dict[int, int] = {}
                for at in {h.round_at for h in self.holds if h.requested_at is not None
                           and (start is None or h.requested_at >= start) and (end is None or h.requested_at < end)}:
                    for p, mark in routes.restarts(self.db, _RoundOf(self.doc.id, at)).items():
                        marks[p] = max(mark, marks.get(p, 0))
                self._past.append(_Round(number, start, end, sigs, marks))
        return self._past

    def route_was(self, row, rnd: _Round) -> bool:
        """A route row describes a round only if it existed when the round began: a route is set again (its rows made anew) whenever the
        document is not in review, so a row made since says nothing of an earlier round's stage names and rules."""
        began = rnd.start or min((s.signed_at for s in rnd.sigs if s.signed_at is not None), default=None)
        return row.created_at is None or began is None or row.created_at <= began

    def span(self, rnd: _Round) -> Tuple[Any, Any, Any]:
        """(the last approval row, the last publication after it, the last archiving) within the round's span of time."""
        approved = next((a for a in reversed(self.approvals) if rnd.contains(a.performed_at)), None)
        published = next((a for a in reversed(self.publications) if rnd.contains(a.performed_at)
                          and (approved is None or a.performed_at >= approved.performed_at)), None)
        archived = next((a for a in reversed(self.archivals) if rnd.contains(a.performed_at)), None)
        return approved, published, archived


# ── a round's stages ────────────────────────────────────────────────────────────
def _split(rnd: _Round, custom: bool):
    """({stage position: (counted, rejected)}, the signatures that no longer count). A stage is built from its signatures and read
    through ``routes.signatures_of`` / ``earlier_of``, so a stage that started again after changes were asked for reads here as it
    does on every screen."""
    by: Dict[int, List[Any]] = {}
    for s in rnd.sigs:
        p = _pos(s)
        if p is not None and (s.stage_position is not None) == custom:
            by.setdefault(p, []).append(s)
    out, voided = {}, []
    for p, group in by.items():
        base = routes.Stage(p, "", "review", custom=True) if custom else routes.DEFAULT_ROUTE[p - 1]      # the usual route is its two stages
        st = replace(base, restarted_after=rnd.marks.get(p))
        signed = [s for s in group if s.decision == "signed"]
        out[p] = (sorted(routes.signatures_of(st, signed), key=_when),
                  sorted(routes.signatures_of(replace(st, restarted_after=None), [s for s in group if s.decision == "rejected"]), key=_when))
        voided += routes.earlier_of(st, signed)
    return out, voided


def _label(group: Sequence[Any], row, p: int) -> str:
    """A stage's label (Reviewed by, Approved by...): what its signatures were given as, else by their role, else its route row's kind."""
    standard = set(routes.KIND_LABEL.values())
    label = next((s.role_label for s in group if s.role_label in standard), None)
    if label is None:
        role = next((s.role_type for s in group if s.role_type in ("reviewer", "approver")), None)
        label = {"reviewer": "Reviewed by", "approver": "Approved by"}.get(role) if role else None
    if label is None and row is not None:
        label = routes.KIND_LABEL.get(row.kind)
    return label or DEFAULT_LABEL.get(p, "Reviewed by")


def _person(f: _Facts, s, label: str) -> Dict[str, Any]:
    e = f.esig.get(s.id)
    return {"name": (e.signer_name if e is not None else None) or f.name(s.signer_user_id),
            "designation": (e.signer_title if e is not None else None) or f.designation(s.signer_user_id),
            "decision": "rejected" if s.decision == "rejected" else "signed", "meaning": s.role_label or label,
            "signed_at": _iso(s.signed_at), "comment": _cut(s.comment), "on_behalf_of": f.name(s.on_behalf_of),
            "signature": None if e is None else {"id": e.id, "drawn": bool(e.ink), "seal_short": (e.seal or "")[:8].upper()}}


def _stages(f: _Facts, rnd: _Round, live: Optional[Dict[str, Any]]):
    """The record's stages in order, with the signatures that no longer count and, by stage position, the counted signatures, their
    labels and the order of the positions. ``live`` is ``routes.view`` while the document is in review or approval: it adds the
    people who have not signed yet, and says which stage waits for changes."""
    custom = any(s.stage_position is not None for s in rnd.sigs) or (live is not None and live["custom"])
    split, voided = _split(rnd, custom)
    on_route = {s["position"]: s for s in (live["stages"] if live else []) if s["kind"] != "information" and s["status"] != "skipped"}
    hold = (live or {}).get("hold")
    order = sorted(set(split) | set(on_route))
    stages, counted_by, labels = [], {}, {}
    for p in order:
        counted, rejected = split.get(p, ([], []))
        row = f.route.get(p) if custom else None
        vs = on_route.get(p)
        label = routes.KIND_LABEL.get(vs["kind"]) if vs is not None and custom else None
        label = label or _label(counted + rejected, row, p)
        counted_by[p], labels[p] = counted, label
        cfg = None                                      # the stage's name and rule: the live route's, else the route's row while it is still that stage
        if vs is not None and custom:
            cfg = vs
        elif vs is None and row is not None and routes.KIND_LABEL.get(row.kind) == label and f.route_was(row, rnd):
            cfg = {"name": row.name, "rule": row.rule, "min_count": row.min_count}
        rule = cfg["rule"] if cfg and cfg["rule"] in routes.RULES else "all"
        stage = {"position": len(stages) + 1, "label": label, "name": cfg["name"] if cfg else None, "rule": rule,
                 "min_count": cfg["min_count"] if cfg and rule == "at_least" else None}
        people = [_person(f, s, label) for s in sorted(counted + rejected, key=_when)]
        for q in (vs["people"] if vs is not None else []):
            if q["state"] in _DECISION:                              # who has not signed: waiting, not yet asked, asked for changes, handed over
                held = q["state"] == "changes_requested"
                note = (_cut(q["comment"]) if held else f"Handed over to {q['delegated_to']}" if q["state"] == "delegated" and q["delegated_to"] else None)
                people.append({"name": q["display"], "designation": f.designation(q["target_id"]) if q["target_type"] == "user" else None,
                               "decision": _DECISION[q["state"]], "meaning": label, "signed_at": hold["requested_at"] if held and hold else None,
                               "comment": note, "on_behalf_of": None, "signature": None})
        state = "rejected" if rejected else _STAGE_STATUS.get(vs["status"], "pending") if vs is not None else "complete" if counted else "pending"
        stages.append({**stage, "status": state, "people": people})
    return stages, voided, counted_by, labels, order


def _approvers(f: _Facts, counted_by: Dict[int, List[Any]], labels: Dict[int, str]) -> List[Dict[str, Any]]:
    """Who signed the last stage: a version's approvers, in ``history``."""
    last = max((p for p, group in counted_by.items() if group), default=None)
    out = []
    for s in counted_by.get(last, []):
        person = _person(f, s, labels.get(last, ""))
        out.append({k: person[k] for k in ("name", "designation", "meaning", "signed_at")})
    return out


def _met(stage: Dict[str, Any], counted: Sequence[Any]):
    """The signature that completed a stage: its last, or - for any one / at least N - the one that met the rule."""
    if not counted:
        return None
    need = len(counted)
    if stage["rule"] == "any":
        need = 1
    elif stage["rule"] == "at_least":
        need = min(stage["min_count"] or 1, len(counted))
    return counted[max(0, need - 1)]


# ── milestones ─────────────────────────────────────────────────────────────────
def _milestones(f: _Facts, rnd: _Round, number: str, stages: Sequence[Dict[str, Any]], order: Sequence[int], counted_by: Dict[int, List[Any]],
                approved_at: Optional[datetime], approved_by: Optional[int]) -> Tuple[List[Dict[str, Any]], bool]:
    """What happened, oldest first: the version prepared, the round's events from the audit trail (sent, changes asked for,
    resubmitted, rejected, published, archived) and, from the signatures, each stage that was completed and the approval.
    At most MAX_MILESTONES; when there are more, the oldest after the first go (the second value says so)."""
    made = f.prepared(number)
    out: List[Tuple[Any, ...]] = []

    def add(at, event, actor, detail, seq=0):
        if at is not None:
            out.append((at, _ORDER[event], seq, {"at": _iso(at), "event": event, "actor": actor, "detail": _cut(detail, 400) or ""}))

    add(datetime.fromisoformat(made["at"]) if made["at"] else None, "Prepared", made["name"], made["summary"] or f"Version {number} prepared")
    for a in f.audit:
        # a major change resubmitted is written a moment before the round it starts is stamped
        if not rnd.contains(a.performed_at, timedelta(seconds=5) if a.action == "resubmitted" else timedelta(0)):
            continue
        who = f.name(a.performed_by)
        if a.action == "changes_requested":
            add(a.performed_at, "Changes requested", who, a.action_details, a.id)
        elif a.action == "resubmitted":
            add(a.performed_at, "Resubmitted", who, a.action_details, a.id)
        elif a.action == "rejected":
            add(a.performed_at, "Rejected", who, a.action_details, a.id)
        elif f.starts_a_round(a):
            add(a.performed_at, "Sent for review", who, a.action_details, a.id)
        elif f.publishes(a):
            add(a.performed_at, "Published", who, a.action_details or "Published", a.id)
        elif a.action == "archived" or (a.field_changed == "status" and a.new_value == "archived"):
            add(a.performed_at, "Archived", who, a.action_details or "Archived", a.id)
    for p, stage in zip(order, stages):
        counted = counted_by.get(p) or []
        last = _met(stage, counted) if stage["status"] == "complete" else None
        if last is not None:
            names = ", ".join(x["name"] for x in stage["people"] if x["decision"] == "signed" and x["name"])
            add(last.signed_at, "Stage complete", _person(f, last, "")["name"], f"{stage['name'] or stage['label']}: {names}" if names else stage["name"] or stage["label"], p)
    add(approved_at, "Approved", f.name(approved_by), "Approved by everyone it was sent to")
    out.sort(key=lambda x: x[:3])
    items = [x[3] for x in out]
    cut = len(items) > MAX_MILESTONES
    return (items[:1] + items[-(MAX_MILESTONES - 1):] if cut else items), cut


# ── the record ────────────────────────────────────────────────────────────────────
def _summary(f: _Facts, number: str, counted_by, labels, approved_at, published_at) -> Dict[str, Any]:
    made = f.prepared(number)
    return {"version": number, "approved_at": _iso(approved_at), "published_at": _iso(published_at), "summary": made["summary"],
            "prepared_by": made["name"], "approvers": _approvers(f, counted_by, labels)}


def _reference(doc_id: int, number: str, body: Dict[str, Any]) -> str:
    canon = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return f"DAR-{doc_id}-{number}-{hashlib.sha256(canon.encode('utf-8')).hexdigest()[:8].upper()}"


def _live_view(f: _Facts, rnd: _Round) -> Dict[str, Any]:
    """The route as the Approvals tab draws it (``routes.view``): who has signed, who is waiting, who asked for changes."""
    from .routers.document_signoff import _assignments, _target_display

    names = {uid: name for uid, (name, _d) in f.people.items()}
    return routes.view(f.db, f.doc, _assignments(f.db, f.doc.id), [s for s in rnd.sigs if s.decision == "signed"], names,
                       lambda a: _target_display(f.db, a.target_type, a.target_id))


def _history(f: _Facts, number: str, own: Dict[str, Dict[str, Any]], skip: set, bound: Optional[datetime]) -> List[Dict[str, Any]]:
    """One row per version whose approval was completed, up to the one the record is about, newest first. Its approvers are those who
    signed its last stage. The record's own version comes from the record itself (``own``; its round, ``skip``, is not read again);
    earlier ones from their last round. Approvals given before signatures were tied to a version are one row, "unknown" (up to
    ``bound``: when the record's own approval, or round, was)."""
    limit = f.rank.get(number, _FAR)
    done: Dict[str, Dict[str, Any]] = {}
    loose: List[Dict[str, Any]] = []
    for rnd in f.past_rounds():                                  # oldest first: the last round of a version wins
        if any(s.id in skip for s in rnd.sigs) or (rnd.number is not None and f.rank.get(rnd.number, _FAR) > limit):
            continue
        approved, published, _archived = f.span(rnd)
        if approved is None or (rnd.number is None and bound is not None and approved.performed_at > bound):
            continue
        custom = any(s.stage_position is not None for s in rnd.sigs)
        split, _voided = _split(rnd, custom)
        counted_by = {p: c for p, (c, _r) in split.items()}
        if not any(counted_by.values()):
            continue
        labels = {p: _label(c, f.route.get(p) if custom else None, p) for p, c in counted_by.items()}
        row = _summary(f, rnd.number or UNKNOWN, counted_by, labels, approved.performed_at, published.performed_at if published is not None else None)
        if rnd.number is None:
            loose.append(row)
        else:
            done[rnd.number] = row
    if loose:
        done[UNKNOWN] = {"version": UNKNOWN, "approved_at": max(r["approved_at"] for r in loose),
                         "published_at": max((r["published_at"] for r in loose if r["published_at"]), default=None), "summary": None,
                         "prepared_by": None, "approvers": sorted((a for r in loose for a in r["approvers"]), key=lambda a: a["signed_at"] or "")}
    done.update(own)
    return sorted(done.values(), key=lambda r: (r["approved_at"] or "", f.rank.get(r["version"], _FAR)), reverse=True)


def build(db, doc, *, version: Optional[str] = None, viewer=None) -> Dict[str, Any]:
    """The approval record of ``doc``'s version ``version`` (its newest, or - for ``viewer``, when they read that one instead - the
    version in force). A pure read. HTTPException 404 for a version the document does not have, or one newer than the one in force
    for ``viewer``."""
    f = _Facts(db, doc)
    current = doc.current_version or "1.0"
    forced = permissions.version_for(db, viewer, doc) if viewer is not None else None      # the row that someone who may not see drafts reads
    number = f.target(version, current, forced)
    newest = forced is None and number == current

    live = None
    if newest:
        rnd = f.current_round(number)
        live = _live_view(f, rnd) if doc.status in routes.PENDING else None
    else:
        rnd = next((r for r in reversed(f.past_rounds()) if r.number == number), _Round(number, None, None, [], {}))
    stages, voided, counted_by, labels, order = _stages(f, rnd, live)
    approved, published, _archived = f.span(rnd)
    counted = [s for group in counted_by.values() for s in group]
    complete = bool(counted) and all(st["status"] == "complete" for st in stages)          # every stage of the round is complete

    if newest:
        approved_like = doc.status in APPROVED_LIKE
        approved_at = None
        if approved_like:
            approved_at = (approved.performed_at if approved is not None else
                           doc.approved_at if doc.approved_at and (rnd.start is None or doc.approved_at >= rnd.start) else
                           max((s.signed_at for s in counted if s.signed_at), default=None))
        approved_by = (approved.performed_by if approved is not None else doc.approved_by) if approved_at else None
        finished = approved_like and complete
        published_at = published.performed_at if published is not None else doc.published_at if doc.status == "published" else None
        published_by = published.performed_by if published is not None else doc.published_by if published_at else None
        state, doc_status, title = state_of(doc.status), doc.status, doc.title
    else:
        finished = approved is not None and complete
        approved_at, approved_by = (approved.performed_at, approved.performed_by) if approved is not None else (None, None)
        published_at, published_by = (published.performed_at, published.performed_by) if published is not None else (None, None)
        if published_at is None and number == permissions.published_last(doc):        # published before audit rows said so
            published_at, published_by = doc.published_at, doc.published_by
        in_force = forced is not None and forced.version_number == number
        state = "published" if (in_force or published_at) else "approved" if finished else "draft"
        doc_status = state
        row = next((v for v in f.versions if v.version_number == number), None)
        title = row.title if row is not None and row.title else doc.title

    own = {number: _summary(f, number, counted_by, labels, approved_at, published_at)} if finished else {}
    history = _history(f, number, own, {s.id for s in rnd.sigs}, None if newest else approved_at if finished else rnd.start)

    # what the record cannot tie down, said plainly
    notes = []
    loose = sum(1 for s in rnd.sigs if f.version_of(s) is None) if newest else 0
    if loose:
        notes.append(f"{loose} signature{' carries' if loose == 1 else 's carry'} no version (given before signatures were tied to one); "
                     f"{'it is' if loose == 1 else 'they are'} placed here because {'it was' if loose == 1 else 'they were'} given in this round.")
    if any(r["version"] == UNKNOWN for r in history):
        notes.append('Earlier approvals whose version was not recorded are listed under version "unknown".')
    if voided:
        notes.append(f"{len(voided)} earlier signature{' was' if len(voided) == 1 else 's were'} given before a stage was asked again after "
                     f"changes; {'it is' if len(voided) == 1 else 'they are'} kept in the Change log and not counted here.")
    if state in ("approved", "published") and not counted:
        notes.append("No sign-off is recorded for this version: it was approved or published without one, or before sign-offs were recorded.")
    if live is not None and any(s["kind"] == "information" and s["status"] != "skipped" for s in live["stages"]):
        notes.append("People told for information only are not listed: they do not sign.")

    milestones, cut = _milestones(f, rnd, number, stages, order, counted_by, approved_at if finished else None, approved_by)
    if cut:
        notes.append(f"Only the first and the latest {MAX_MILESTONES - 1} milestones are listed; the Change log has them all.")

    made = f.prepared(number)
    department = db.query(GRCDepartment.name).filter(GRCDepartment.id == doc.department_id).scalar() if doc.department_id else None
    body = {
        "document": {
            "id": doc.id, "code": doc.document_code, "title": title, "type": doc.doc_type, "classification": doc.classification,
            "version": number, "status": doc_status, "department": department, "owner": f.name(doc.owner_id), "author": f.name(doc.author_id),
            "effective_date": _iso(doc.effective_date), "next_review_date": _iso(doc.next_review_date),
            "approved_at": _iso(approved_at), "published_at": _iso(published_at), "published_by": f.name(published_by),
        },
        "state": state,
        "round": {"version": number, "started_at": _iso(rnd.start), "completed_at": _iso(approved_at) if finished else None, "complete": finished},
        "prepared_by": {"name": made["name"], "designation": made["designation"], "at": made["at"]},
        "stages": stages,
        "milestones": milestones,
        "history": history,
        "notes": notes,
    }
    return {"reference": _reference(doc.id, number, body), "generated_at": datetime.utcnow().replace(microsecond=0).isoformat(), **body}
