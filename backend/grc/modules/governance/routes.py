"""A governance document's approval route: the stages it goes through, who acts in each and how, and where it stands
(DECISIONS D33, the user's choice of 2026-10-20; plan: .agent-context/features/approval-routes-plan.md).

A document without stages of its own follows the default route, which is the sign-off flow as it always was: a Review stage
(its reviewers, all at once, everyone signs, a reviewer may reject) then an Approval stage (its approvers, likewise). Its
participants are the sign-off assignments by ``role_type`` and its stage is its status.

A document with stages (grc_document_route_stages, set in Send for review) follows them in order. Each stage has a name and a
kind (review, concurrence, recommendation, approval, or information: told, nobody waits), its people (the assignments with its
``stage_position``) asked one after another (``in_turn``, by ``position``) or all at once, a rule (everyone, any one, at least
N), its own due days, and whether people may reject or delegate there. The document's status stays pending_review until the
route reaches its first approval stage and pending_approval from there on (it never goes back, which would start a new round);
``route_stage`` is the stage it is at.

On either route the person whose turn it is may ask for changes instead of signing: the route is held (an open
grc_document_route_holds row of this round) and nobody signs until it is resubmitted. A minor change (or none) starts the stage it
was held at again for everyone in it (the user, 2026-10-21): the signatures given there before stay in the history but no longer
count (``restarts``, ``signatures_of``), everyone is asked again (in turn: from the first; any one or at least N: the count starts
again) and told what changed since they signed or asked (``again_for``); earlier stages' signatures stand. A major one starts the
route again. Nobody approves a document they wrote (four-eyes, Governance > Settings, on by default). A delegate signs for the
person who handed the step over (``on_behalf_of``)."""
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

KIND_LABEL = {"review": "Reviewed by", "concurrence": "Concurred by", "recommendation": "Recommended by", "approval": "Approved by",
              "information": "For information"}
KIND_NAME = {"review": "Review", "concurrence": "Concurrence", "recommendation": "Recommendation", "approval": "Approval",
             "information": "For information"}
VERB = {"review": "review", "concurrence": "concur with", "recommendation": "recommend", "approval": "approve"}
DID = {"review": "reviewed", "concurrence": "concurred with", "recommendation": "recommended", "approval": "approved"}
AGAIN = {"review": "Review again", "concurrence": "Concur again", "recommendation": "Recommend again", "approval": "Approve again"}
STAGE_KINDS = tuple(KIND_LABEL)
ORDERS = ("together", "in_turn")
RULES = ("all", "any", "at_least")
PENDING = ("pending_review", "pending_approval")
MAX_STAGES = 12


@dataclass(frozen=True)
class Stage:
    position: int
    name: str
    kind: str = "review"
    order: str = "together"
    rule: str = "all"
    min_count: Optional[int] = None
    due_days: Optional[int] = None
    signature: bool = True
    allow_reject: bool = False
    allow_delegate: bool = True
    custom: bool = False
    # started again this round after changes asked for at it were resubmitted (``restarts``): its signatures up to this signature
    # id no longer count (None: it did not)
    restarted_after: Optional[int] = None

    @property
    def role_type(self) -> str:
        return "approver" if self.kind == "approval" else "reviewer"

    @property
    def obligation_kind(self) -> str:
        return "approval" if self.kind == "approval" else "review"

    @property
    def label(self) -> str:
        return KIND_LABEL.get(self.kind, "Reviewed by")

    @property
    def informs(self) -> bool:
        return self.kind == "information"


# the route of a document without stages of its own: the sign-off flow as it always was
DEFAULT_ROUTE: Tuple[Stage, ...] = (Stage(1, "Review", "review", allow_reject=True), Stage(2, "Approval", "approval", allow_reject=True))


def stages(db, doc) -> List[Stage]:
    from ...models import DocumentRouteStage

    rows = (db.query(DocumentRouteStage).filter(DocumentRouteStage.document_id == doc.id)
            .order_by(DocumentRouteStage.position, DocumentRouteStage.id).all())
    again = restarts(db, doc)
    if not rows:
        return [replace(s, restarted_after=again.get(s.position)) for s in DEFAULT_ROUTE]
    return [Stage(r.position, r.name, r.kind, r.order_mode or "together", r.rule or "all", r.min_count, r.due_days,
                  bool(r.signature), bool(r.allow_reject), r.allow_delegate is not False, custom=True,
                  restarted_after=again.get(r.position)) for r in rows]


def is_custom(route: Sequence[Stage]) -> bool:
    return bool(route) and route[0].custom


def stage_at(route: Sequence[Stage], position: Optional[int]) -> Optional[Stage]:
    return next((s for s in route if s.position == position), None)


def assignments_of(stage: Stage, assignments: Iterable[Any]) -> List[Any]:
    """The stage's participants in their turn order (by ``position``, then as added)."""
    if stage.custom:
        picked = [a for a in assignments if a.stage_position == stage.position]
    else:
        picked = [a for a in assignments if a.role_type == stage.role_type and a.stage_position is None]
    return sorted(picked, key=lambda a: (a.position if a.position is not None else 10 ** 6, a.id or 0))


def _at(stage: Stage, signatures: Iterable[Any]) -> List[Any]:
    if stage.custom:
        return [s for s in signatures if s.stage_position == stage.position]
    return [s for s in signatures if s.role_type == stage.role_type]


def signatures_of(stage: Stage, signatures: Iterable[Any]) -> List[Any]:
    """The stage's signatures that count, of this round's (``signatures``): at a stage that started again after changes were asked
    for there, only those given since (``Stage.restarted_after``). Every check of a stage reads its signatures here."""
    if stage.restarted_after is None:
        return _at(stage, signatures)
    return [s for s in _at(stage, signatures) if (s.id or 0) > stage.restarted_after]


def earlier_of(stage: Stage, signatures: Iterable[Any]) -> List[Any]:
    """This round's signatures at a stage given before it started again: they stay in the history and no longer count."""
    if stage.restarted_after is None:
        return []
    return [s for s in _at(stage, signatures) if (s.id or 0) <= stage.restarted_after]


def signer_ids(signatures: Iterable[Any]) -> Set[int]:
    """Who signed: the people themselves, and those a delegate signed for."""
    out: Set[int] = set()
    for s in signatures:
        out.add(s.signer_user_id)
        if getattr(s, "on_behalf_of", None):
            out.add(s.on_behalf_of)
    return out


def _members(db, doc, a) -> Set[int]:
    from . import doc_lifecycle

    return set(doc_lifecycle._members(db, doc, a))


def four_eyes_excluded(db, doc, stage: Stage) -> Set[int]:
    """Who may not act at ``stage``: the document's author at an approval stage (four-eyes, D33), unless an administrator switched
    it off in Governance > Settings."""
    if stage.kind != "approval" or not doc.author_id:
        return set()
    from . import doc_lifecycle

    return {doc.author_id} if doc_lifecycle.settings(db, doc.tenant_id).get("four_eyes", True) else set()


def required(db, doc, stage: Stage, stage_assignments: Sequence[Any]) -> List[Tuple[Any, Set[int]]]:
    """Each participant of the stage with the people who may sign for it (four-eyes applied). One nobody can sign for (a role or
    team without people of this platform, an imported account, the author at approval) is left out while another can; when none
    can, every one is kept (the stage then waits: Send refuses such a route, ``nobody_can_sign``)."""
    excluded = four_eyes_excluded(db, doc, stage)
    out = [(a, _members(db, doc, a) - excluded) for a in stage_assignments]
    signable = [(a, m) for a, m in out if m]
    return signable or out


def _hits(req: Sequence[Tuple[Any, Set[int]]], signers: Set[int]) -> List[bool]:
    return [bool(members & signers) for _a, members in req]


def done(db, doc, stage: Stage, assignments: Sequence[Any], signatures: Sequence[Any]) -> bool:
    """The stage's rule is met by this round's signatures: everyone (each participant has a signature; a role or team by any one of
    its members), any one, or at least N people."""
    req = required(db, doc, stage, assignments_of(stage, assignments))
    if not req:
        return False
    signers = signer_ids(signatures_of(stage, signatures))
    if stage.rule == "any":
        return any(_hits(req, signers))
    if stage.rule == "at_least":
        people = set().union(*(m for _a, m in req))
        return len(signers & people) >= max(1, min(stage.min_count or 1, len(people) or 1))
    return all(_hits(req, signers))


def progress(db, doc, stage: Stage, assignments: Sequence[Any], signatures: Sequence[Any]) -> Dict[str, int]:
    """How many signed of how many the stage needs, counted as ``done`` counts them."""
    req = required(db, doc, stage, assignments_of(stage, assignments))
    if not req:
        return {"required": 0, "signed": 0}
    signers = signer_ids(signatures_of(stage, signatures))
    if stage.rule == "at_least":
        people = set().union(*(m for _a, m in req))
        need = max(1, min(stage.min_count or 1, len(people) or 1))
        return {"required": need, "signed": min(len(signers & people), need)}
    need = 1 if stage.rule == "any" else len(req)
    return {"required": need, "signed": min(sum(_hits(req, signers)), need)}


def askable(db, doc, stage: Stage, assignments: Sequence[Any], signatures: Sequence[Any]) -> List[Any]:
    """The participants to ask now: in turn, the first one not yet signed for; all at once, every one not yet signed for."""
    req = required(db, doc, stage, assignments_of(stage, assignments))
    signers = signer_ids(signatures_of(stage, signatures))
    open_ = [a for (a, members), hit in zip(req, _hits(req, signers)) if not hit and members]
    return open_[:1] if stage.order == "in_turn" else open_


def can_sign(db, doc, stage: Stage, assignments: Sequence[Any]) -> bool:
    excluded = four_eyes_excluded(db, doc, stage)
    return any(_members(db, doc, a) - excluded for a in assignments_of(stage, assignments))


def following(route: Sequence[Stage], assignments: Sequence[Any], after: int = 0) -> Tuple[Optional[Stage], List[Stage]]:
    """The next stage after position ``after`` that has participants, and the information stages passed on the way. A stage with
    nobody named is skipped (the default route without reviewers goes to its approvers)."""
    passed: List[Stage] = []
    for s in route:
        if s.position <= after or not assignments_of(s, assignments):
            continue
        if s.informs:
            passed.append(s)
            continue
        return s, passed
    return None, passed


def status_for(stage: Stage, current_status: Optional[str]) -> str:
    """pending_review until the first approval stage, pending_approval from there on (never back: that would start a round)."""
    return "pending_approval" if stage.kind == "approval" or current_status == "pending_approval" else "pending_review"


def current(db, doc, route: Optional[Sequence[Stage]] = None) -> Optional[Stage]:
    """The stage the document is at while it is in review or approval (None otherwise)."""
    if doc.status not in PENDING:
        return None
    route = list(route) if route is not None else stages(db, doc)
    if not is_custom(route):                       # the default route: its stage is its status
        return stage_at(route, 1 if doc.status == "pending_review" else 2)
    at = stage_at(route, doc.route_stage)
    if at is not None:
        return at
    from .routers.document_signoff import _assignments

    return following(route, _assignments(db, doc.id))[0]


def nobody_can_sign(db, doc, route: Sequence[Stage], assignments: Sequence[Any]) -> List[str]:
    """A sentence for each stage of a route of its own where nobody can sign (Send refuses the route then)."""
    from .routers.document_signoff import _target_display

    out = []
    for s in route:
        if s.informs or not assignments_of(s, assignments) or can_sign(db, doc, s, assignments):
            continue
        names = ", ".join(_target_display(db, a.target_type, a.target_id) for a in assignments_of(s, assignments))
        why = ": its author does not approve it" if four_eyes_excluded(db, doc, s) else ""
        out.append(f"Nobody in stage {s.position} ({s.name}: {names}) can sign it{why}. Choose others.")
    return out


# ── holds (changes asked for) ────────────────────────────────────────────────
def open_hold(db, doc):
    """The changes asked for in this round that are not resubmitted yet (a new round leaves an earlier one behind)."""
    from ...models import DocumentRouteHold as H

    if doc.status not in PENDING:
        return None
    db.flush()
    q = db.query(H).filter(H.document_id == doc.id, H.resolved_at.is_(None))
    q = q.filter(H.round_at == doc.signoff_round_at) if doc.signoff_round_at else q.filter(H.round_at.is_(None))
    return q.order_by(H.id.desc()).first()


def on_hold(db, doc) -> bool:
    return open_hold(db, doc) is not None


def is_proposal(hold) -> bool:
    """A hold that waits for the owner to accept or reject a change someone proposed (proposals.py), not for changes asked for."""
    return hold is not None and (getattr(hold, "kind", None) or "changes") == "proposal"


def changed_since(db, doc, hold) -> bool:
    """A new version of the document was made since the hold began (a sign-off stamp is not one)."""
    from ...models import GovernanceDocumentVersion as V

    return db.query(V.id).filter(V.document_id == doc.id, V.id > (hold.version_id or 0),
                                 V.change_type != "signoff").first() is not None


def may_sign_as_is(db, doc, hold, user_id: int) -> bool:
    """The owner did not accept the change that holds the route: its proposer may sign the document as it is (nothing changed, so the
    others' signatures stand) - when nothing else changed it since and no other proposed change waits."""
    if not is_proposal(hold) or not hold.proposal_id:
        return False
    from ...models import DocumentChangeProposal as P

    p = db.get(P, hold.proposal_id)
    if p is None or p.status != "rejected" or p.proposed_by != user_id:
        return False
    waiting = db.query(P.id).filter(P.document_id == doc.id, P.kind == "document", P.status == "pending").first()
    return waiting is None and not changed_since(db, doc, hold)


def resumed(db, doc, position: Optional[int] = None) -> List[Any]:
    """This round's changes asked for that were resubmitted with a minor change (or none), oldest first (at ``position`` only, when
    given): each started its stage again. Holds resolved before marks existed (``signature_mark``) restarted nothing."""
    from ...models import DocumentRouteHold as H

    q = db.query(H).filter(H.document_id == doc.id, H.outcome == "resumed", H.signature_mark.isnot(None))
    q = q.filter(H.round_at == doc.signoff_round_at) if doc.signoff_round_at else q.filter(H.round_at.is_(None))
    if position is not None:
        q = q.filter(H.stage_position == position)
    return q.order_by(H.id).all()


def restarts(db, doc) -> Dict[int, int]:
    """The stages that started again this round, {position: the newest signature id when its changes were asked for}: everyone there
    signs again, so the stage's signatures up to that one no longer count (``signatures_of``); earlier stages' still do. Read from
    the holds, never by changing a signature (they are append-only, the e-signatures sealed)."""
    out: Dict[int, int] = {}
    for h in resumed(db, doc):
        if h.stage_position is not None:
            out[h.stage_position] = max(h.signature_mark, out.get(h.stage_position, 0))
    return out


def holders(db, doc, stage: Stage, a) -> List[Tuple[int, Optional[int]]]:
    """Who is asked for participant ``a`` at ``stage``, as (person, for whom): its people (four-eyes applied), except anyone who
    handed their step over this round, whose delegate (the newest hand-over) is asked for them instead."""
    from ...models import DocumentObligation as O

    q = db.query(O).filter(O.document_id == doc.id, O.assignment_id == a.id, O.kind == stage.obligation_kind)
    if doc.signoff_round_at:
        q = q.filter(O.requested_at >= doc.signoff_round_at)
    rows = [o for o in q.order_by(O.id).all() if o.stage_position == stage.position or (o.stage_position is None and not stage.custom)]
    handed = [o for o in rows if o.status == "delegated"]
    out = [(u, None) for u in sorted(_members(db, doc, a) - four_eyes_excluded(db, doc, stage) - {o.user_id for o in handed})]
    for principal in dict.fromkeys(o.on_behalf_of or o.user_id for o in handed):
        last = next((o for o in reversed(rows) if o.on_behalf_of == principal and o.status != "delegated"), None)
        if last is not None:
            out.append((last.user_id, principal))
    return out


def last_act(holds: Sequence[Any], earlier: Sequence[Any], people: Set[int]) -> Optional[Tuple[str, Any]]:
    """What ``people`` did last at a stage before it started again: ("changes", the changes they asked for) or ("signed", their
    signature, which no longer counts). Signature ids order the two (a hold keeps the newest signature id when it was asked)."""
    sig = max((s for s in earlier if s.signer_user_id in people or (s.on_behalf_of and s.on_behalf_of in people)), key=lambda s: s.id, default=None)
    ask = next((h for h in reversed(holds) if h.requested_by in people or (h.on_behalf_of and h.on_behalf_of in people)), None)
    if ask is not None and (sig is None or sig.id <= (ask.signature_mark or 0)):
        return "changes", ask
    return ("signed", sig) if sig is not None else None


def again_for(db, doc, stage: Stage, user_id: int) -> Optional[Dict[str, Any]]:
    """Why ``user_id`` is asked again at ``stage``: it started again after changes asked for there were resubmitted, and they had
    signed it (that signature no longer counts) or asked for the changes. What their step, My Approvals, their task and the message
    say: when, the version they signed and its row (to show what changed since: the change chain's redline from it), what they asked,
    the version now, who resubmitted it and what they wrote. None when the stage did not start again or they had done neither."""
    if stage is None or stage.restarted_after is None:
        return None
    from ...models import ElectronicSignature as E, GovernanceDocumentVersion as V
    from .routers.document_signoff import _signatures

    holds = resumed(db, doc, stage.position)
    act = last_act(holds, earlier_of(stage, _signatures(db, doc.id)), {user_id}) if holds else None
    if act is None:
        return None
    kind, row = act
    last = holds[-1]
    if kind == "changes":
        base, version, vid = row, None, None
    else:
        base = next((h for h in holds if (h.signature_mark or 0) >= row.id), last)       # the first changes asked for after it
        version = db.query(E.document_version).filter(E.record_type == "document_signoff", E.record_id == row.id).limit(1).scalar()
        found = db.query(V.id).filter(V.document_id == doc.id, V.version_number == version).order_by(V.id.desc()).first() if version else None
        vid = found[0] if found else None
    if vid is None:
        first = db.query(V.id).filter(V.document_id == doc.id).order_by(V.id).first()   # none when asked: the text then is the first one kept
        vid = base.version_id or (first[0] if first else None)
    if version is None and vid is not None:
        version = db.query(V.version_number).filter(V.id == vid).limit(1).scalar()
    return {"kind": kind, "stage": stage.name, "stage_kind": stage.kind, "at": _iso(row.requested_at if kind == "changes" else row.signed_at),
            "version": version, "version_id": vid, "comment": row.comment if kind == "changes" else None, "now": doc.current_version,
            "changed": any(h.change == "minor" for h in holds[holds.index(base):]),
            "by": _names(db, [last.resolved_by]).get(last.resolved_by), "note": last.resubmit_note,
            "proposed": kind == "changes" and is_proposal(row)}      # they proposed the change the owner accepted (proposals.py)


def again_text(again: Dict[str, Any], ask: bool = True) -> str:
    """What someone asked again reads in a message: "You reviewed this on 21 Oct 2026 (v1.0). Olivia made changes since (v1.0 → v1.2).
    Please review it again." / "You asked for changes on 21 Oct 2026: "...". Olivia resubmitted it (v1.2) — see what changed."
    Without ``ask``, only why (a task's description goes on with its own request). The screens say it with the reader's dates."""
    at = datetime.fromisoformat(again["at"]) if again.get("at") else None
    on = f" on {at.day} {at:%b %Y}" if at else ""
    by = again.get("by") or "The author"
    now = f" (v{again['now']})" if again.get("now") else ""
    if again.get("proposed"):
        return f'You proposed a change{on}: "{again.get("comment") or ""}". {by} accepted it{now}' + (" — see what changed." if ask else ".")
    if again["kind"] == "changes":
        asked = f'You asked for changes{on}: "{again.get("comment") or ""}". '
        if not again.get("changed"):
            return f"{asked}{by} resubmitted it without changing the text{now}."
        return f"{asked}{by} resubmitted it{now}" + (" — see what changed." if ask else ".")
    kind = again.get("stage_kind") or "review"
    signed = f" (v{again['version']})" if again.get("version") else ""
    if not again.get("changed"):
        since = f"{by} resubmitted it without changing the text{now}."
    elif again.get("version") and again.get("now"):
        since = f"{by} made changes since (v{again['version']} → v{again['now']})."
    else:
        since = f"{by} made changes since."
    return f"You {DID.get(kind, 'reviewed')} this{on}{signed}. {since}" + (f" Please {VERB.get(kind, 'review')} it again." if ask else "")


# ── whose turn it is ─────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Step:
    stage: Stage
    assignment_id: Optional[int]
    on_behalf_of: Optional[int] = None
    as_is: bool = False             # the proposer signs it as it is after their change was not accepted (``may_sign_as_is``)


def round_requests(db, doc, user_id: int, stage: Stage):
    """The person's requests of this round at ``stage``."""
    from ...models import DocumentObligation as O

    q = db.query(O).filter(O.document_id == doc.id, O.user_id == user_id, O.kind == stage.obligation_kind)
    if doc.signoff_round_at:
        q = q.filter(O.requested_at >= doc.signoff_round_at)
    rows = q.order_by(O.id).all()
    return [o for o in rows if o.stage_position == stage.position or (o.stage_position is None and not stage.custom)]


def step_for(db, doc, user_id: int, assignments: Sequence[Any], signatures: Sequence[Any]) -> Optional[Step]:
    """What ``user_id`` may do now: sign (or ask for changes, reject where allowed, delegate) at the current stage, or nothing.
    Nobody acts while the route is held - except the proposer of a change the owner did not accept, who may sign it as it is
    (``may_sign_as_is``); nobody signs a stage twice; the author never approves (four-eyes); in turn, only the person whose turn it
    is; a delegate acts for whoever handed it over, who then no longer does."""
    route = stages(db, doc)
    stage = current(db, doc, route)
    if stage is None:
        return None
    hold = open_hold(db, doc)
    as_is = hold is not None and may_sign_as_is(db, doc, hold, user_id)
    if hold is not None and not as_is:
        return None
    stage_sigs = signatures_of(stage, signatures)
    if user_id in {s.signer_user_id for s in stage_sigs}:
        return None
    requests = round_requests(db, doc, user_id, stage)
    waiting = ("pending", "held") if as_is else ("pending",)          # (held: the requests that wait while it is held)
    handed = next((o for o in reversed(requests) if o.status in waiting and o.on_behalf_of), None)
    if handed is not None:
        return None if handed.on_behalf_of in signer_ids(stage_sigs) else Step(stage, handed.assignment_id, handed.on_behalf_of, as_is)
    if any(o.status == "delegated" for o in requests):
        return None                                  # handed over to someone else this round
    if user_id in four_eyes_excluded(db, doc, stage) or user_id in signer_ids(stage_sigs) or done(db, doc, stage, assignments, signatures):
        return None
    candidates = askable(db, doc, stage, assignments, signatures) if stage.order == "in_turn" else assignments_of(stage, assignments)
    for a in candidates:
        if user_id in _members(db, doc, a):
            return Step(stage, a.id, as_is=as_is)
    return None


# ── what the screens show ────────────────────────────────────────────────────
def _iso(dt) -> Optional[str]:
    return dt.isoformat() if dt else None


def view(db, doc, assignments: Sequence[Any], signatures: Sequence[Any], names: Dict[int, str], display) -> Dict[str, Any]:
    """The route as the Approvals view draws it: each stage with its rule and each participant's state this round (signed,
    waiting, not yet asked, changes asked for, delegated, not needed), what they did before their stage started again after
    changes (``earlier``: signed, with the version, or asked for the changes), and the changes asked for, while they are."""
    from ...models import DocumentObligation as O, ElectronicSignature as E, GovernanceDocumentVersion as V

    route = stages(db, doc)
    cur = current(db, doc, route)
    hold = open_hold(db, doc)
    q = db.query(O).filter(O.document_id == doc.id, O.kind.in_(("review", "approval")))
    if doc.signoff_round_at:
        q = q.filter(O.requested_at >= doc.signoff_round_at)
    obligations = q.order_by(O.id).all()
    names.update({k: v for k, v in _names(db, {o.user_id for o in obligations} - set(names)).items()})
    again = {s.position: resumed(db, doc, s.position) for s in route if s.restarted_after is not None}
    voided = [x for s in route for x in earlier_of(s, signatures)]
    signed_on = dict(db.query(E.record_id, E.document_version).filter(E.record_type == "document_signoff",
                                                                     E.record_id.in_([x.id for x in voided]))) if voided else {}
    asked_on = [h.version_id for hs in again.values() for h in hs if h.version_id]
    numbers = dict(db.query(V.id, V.version_number).filter(V.id.in_(asked_on))) if asked_on else {}
    names.update(_names(db, {h.requested_by for hs in again.values() for h in hs} - set(names)))
    finished = doc.status in ("approved", "published")
    out = []
    for s in route:
        assigns = assignments_of(s, assignments)
        sigs = signatures_of(s, signatures)
        before = earlier_of(s, signatures)
        req = {a.id: m for a, m in required(db, doc, s, assigns)} if assigns else {}
        at_it = cur is not None and s.position == cur.position
        turn = askable(db, doc, s, assignments, signatures)[:1] if at_it and s.order == "in_turn" else []
        if not assigns:
            status = "skipped"
        elif finished or (cur is not None and s.position < cur.position):
            status = "informed" if s.informs else "done"
        elif cur is None:
            status = "not_started"
        elif at_it:
            status = "on_hold" if hold else "current"
        else:
            status = "waiting"
        people = []
        for a in assigns:
            members = req.get(a.id) or _members(db, doc, a)
            sig = next((x for x in sigs if x.signer_user_id in members or (x.on_behalf_of and x.on_behalf_of in members)), None)
            mine = [o for o in obligations if o.assignment_id == a.id and (o.stage_position == s.position or (o.stage_position is None and not s.custom))]
            handed = next((o for o in reversed(mine) if o.on_behalf_of and o.status in ("pending", "done")), None)
            if sig is not None:
                state = "signed"
            elif hold is not None and hold.assignment_id == a.id and hold.stage_position == s.position:
                state = "changes_requested"
            elif s.informs:
                state = "informed" if status in ("done", "informed") else "not_yet"
            elif handed is not None and status in ("current", "on_hold"):
                state = "delegated"
            elif status in ("current", "on_hold") and (s.order != "in_turn" or any(t.id == a.id for t in turn)):
                state = "waiting"
            elif status in ("done", "informed"):
                state = "not_needed"
            else:
                state = "not_yet"
            pending = next((o for o in reversed(mine) if o.status == "pending"), None)
            act = last_act(again[s.position], before, members) if again.get(s.position) else None
            earlier = None
            if act is not None and act[0] == "signed":
                earlier = {"kind": "signed", "at": _iso(act[1].signed_at), "by": names.get(act[1].signer_user_id),
                           "on_behalf_of": names.get(act[1].on_behalf_of) if act[1].on_behalf_of else None,
                           "version": signed_on.get(act[1].id), "comment": None}
            elif act is not None:
                earlier = {"kind": "changes", "at": _iso(act[1].requested_at), "by": names.get(act[1].requested_by),
                           "on_behalf_of": None, "version": numbers.get(act[1].version_id), "comment": act[1].comment}
            people.append({
                "assignment_id": a.id, "target_type": a.target_type, "target_id": a.target_id, "display": display(a), "state": state,
                "signer": names.get(sig.signer_user_id) if sig is not None else None,
                "on_behalf_of": names.get(sig.on_behalf_of) if sig is not None and sig.on_behalf_of else None,
                "at": _iso(sig.signed_at) if sig is not None else None,
                "comment": sig.comment if sig is not None else hold.comment if state == "changes_requested" else None,
                "due_date": _iso(pending.due_date) if pending is not None else None,
                "delegated_to": names.get(handed.user_id) if handed is not None else None,
                "earlier": earlier,                  # before the stage started again after changes ("Signed v1.0 · asked again")
            })
        out.append({
            "position": s.position, "name": s.name, "kind": s.kind, "kind_label": s.label, "order": s.order, "rule": s.rule,
            "min_count": s.min_count, "due_days": s.due_days, "signature": s.signature, "allow_reject": s.allow_reject,
            "allow_delegate": s.allow_delegate, "status": status, "people": people, "restarted": s.restarted_after is not None,
            "progress": progress(db, doc, s, assignments, signatures) if assigns and not s.informs else None,
        })
    return {
        "custom": is_custom(route), "current": cur.position if cur else None, "stages": out,
        "hold": None if hold is None else {
            "id": hold.id, "stage_position": hold.stage_position, "requested_by": names.get(hold.requested_by) or _names(db, [hold.requested_by]).get(hold.requested_by),
            "requested_by_id": hold.requested_by, "requested_at": _iso(hold.requested_at), "comment": hold.comment,
            # changes asked for, or a change someone proposed that waits for the owner (requested_by proposed it; comment says why)
            "kind": hold.kind or "changes", "proposal_id": hold.proposal_id, "proposal_status": _proposal_status(db, hold),
        },
    }


def _names(db, ids) -> Dict[int, str]:
    from . import doc_lifecycle

    return doc_lifecycle._names(db, ids)


def _proposal_status(db, hold) -> Optional[str]:
    if not is_proposal(hold) or not hold.proposal_id:
        return None
    from ...models import DocumentChangeProposal as P

    return db.query(P.status).filter(P.id == hold.proposal_id).scalar()


def validate(stages_in: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The stages of a route as saved: kinds, orders and rules checked, defaults filled. Raises ValueError with a sentence."""
    if len(stages_in) > MAX_STAGES:
        raise ValueError(f"A route has at most {MAX_STAGES} stages.")
    out = []
    for i, s in enumerate(stages_in, start=1):
        kind = s.get("kind") or "review"
        if kind not in STAGE_KINDS:
            raise ValueError(f"Stage {i}: choose what kind of stage it is.")
        name = (s.get("name") or "").strip()[:120] or KIND_NAME[kind]
        order = s.get("order") or "together"
        if order not in ORDERS:
            raise ValueError(f"Stage {i} ({name}): choose whether its people are asked together or one after another.")
        rule = "all" if order == "in_turn" else (s.get("rule") or "all")
        if rule not in RULES:
            raise ValueError(f"Stage {i} ({name}): choose who has to sign.")
        people = list(dict.fromkeys((p.get("target_type"), int(p["target_id"])) for p in (s.get("people") or [])
                                    if p.get("target_type") in ("user", "role", "team") and str(p.get("target_id") or "").isdigit()
                                    and int(p["target_id"]) > 0))
        if not people:
            raise ValueError(f"Stage {i} ({name}): choose who is asked.")
        min_count = None
        if rule == "at_least":
            try:
                min_count = int(s.get("min_count") or 0)
            except (TypeError, ValueError):
                min_count = 0
            cap = len(people) if all(t == "user" for t, _id in people) else None
            if min_count < 1 or (cap is not None and min_count > cap):
                raise ValueError(f"Stage {i} ({name}): at least how many have to sign? A number from 1" + (f" to {cap}." if cap else "."))
        due = s.get("due_days")
        if due in (None, ""):
            due = None
        else:
            try:
                due = int(due)
            except (TypeError, ValueError):
                raise ValueError(f"Stage {i} ({name}): the days to act must be a number.") from None
            if not 1 <= due <= 365:
                raise ValueError(f"Stage {i} ({name}): the days to act must be from 1 to 365.")
        allow_reject = s.get("allow_reject")
        out.append({"position": i, "name": name, "kind": kind, "order": order, "rule": rule, "min_count": min_count, "due_days": due,
                    "signature": kind != "information" and s.get("signature") is not False,
                    "allow_reject": kind == "approval" if allow_reject is None else bool(allow_reject) and kind != "information",
                    "allow_delegate": s.get("allow_delegate") is not False, "people": people})
    if out and not any(s["kind"] != "information" for s in out):
        raise ValueError("A route needs at least one stage where someone reviews or approves.")
    return out
