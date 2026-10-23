"""Production document Sign-off & Document Control flow.

A clean, self-contained approval system layered on the governance document:
  • per-document PARTICIPANTS: prepared_by / reviewer / approver, each targeting a
    user, a role, or a team (roles/teams expand to member users when routing);
  • SEND for review → reviewers sign → (auto) pending approval → approvers sign → approved;
    or, with a ROUTE of its own (modules/governance/routes.py, set in Submit for review), its stages in order;
  • each SIGN records a structured DocumentSignature AND stamps the signer's row in
    the document's Approval Signoff table (reusing the content patcher), versioned + audited;
  • the person whose turn it is may instead ask for CHANGES (the route waits until the author RESUBMITS), reject where the
    stage allows it, or DELEGATE the step; the author may WITHDRAW it from review;
  • a per-user PENDING queue that expands role/team membership so each assignee
    sees exactly the documents awaiting their signature.

Deliberately independent of the two legacy approval engines (DocumentApprovalStep
"approve-one-approves-all" and the template engine) which are over-broad / unwired.
"""
import hashlib
from typing import List, Optional, Dict, Set
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ....models import (
    GovernanceDocument, GovernanceDocumentVersion, GRCUser, get_db,
    DocumentObligation, DocumentRouteHold, DocumentRouteStage, DocumentSignoffAssignment, DocumentSignature,
)
from ....routers.auth_router import require_auth, get_user_tenants
from ....services import esign
from .documents import _patch_signoff_content, _snapshot_content_version, create_audit_log
from .. import doc_lifecycle, routes
from ..permissions import can_edit, ensure_not_archived, require_doc_changer, require_doc_editor, require_doc_reader

router = APIRouter(prefix="/documents", tags=["Governance - Sign-off"])

_ROLE_TYPES = ("prepared_by", "reviewer", "approver")
_ROLE_LABEL = {"prepared_by": "Prepared by", "reviewer": "Reviewed by", "approver": "Approved by"}
# Which document.status corresponds to each stage awaiting signatures.
_STAGE_STATUS = {"reviewer": "pending_review", "approver": "pending_approval"}
ON_HOLD = "Changes were asked for: it waits for the author to make them and resubmit it."
ON_HOLD_PROPOSAL = "A change was proposed: it waits for the owner to accept or reject it."
OWN_ROUTE = ("This document follows an approval route of its own. Change who reviews and approves it in Submit for review "
             "(withdraw it from review first if it is in review).")


# ── schemas ──────────────────────────────────────────────────────────────
class ParticipantIn(BaseModel):
    target_type: str   # user | role | team
    target_id: int


class ParticipantsUpdate(BaseModel):
    prepared_by: List[ParticipantIn] = []
    reviewers: List[ParticipantIn] = []
    approvers: List[ParticipantIn] = []


class StageIn(BaseModel):
    name: Optional[str] = None
    kind: str = "review"                   # review | concurrence | recommendation | approval | information
    order: str = "together"                # together | in_turn
    rule: str = "all"                      # all | any | at_least
    min_count: Optional[int] = None
    due_days: Optional[int] = None         # None: Governance > Settings
    allow_reject: Optional[bool] = None    # None: on approval stages only
    allow_delegate: Optional[bool] = None  # None: yes
    people: List[ParticipantIn] = []       # in their turn order


class RouteUpdate(BaseModel):
    stages: List[StageIn] = []             # none: back to the default route (reviewers, then approvers)


class SignRequest(BaseModel):
    version: Optional[str] = None          # the version the signer was shown; 409 when the document has moved on since
    round_at: Optional[str] = None         # the review round the signer was shown (GET /signoff round_at); 409 when a newer one began
    comment: Optional[str] = None
    signature_text: Optional[str] = None   # typed name of record (defaults to display name)
    signature_image: Optional[str] = None  # PNG data URL drawn on screen: a formal sign-off is signed electronically


class RejectRequest(BaseModel):
    comment: str
    version: Optional[str] = None
    round_at: Optional[str] = None


class ChangesRequest(BaseModel):
    comment: str
    version: Optional[str] = None
    round_at: Optional[str] = None


class ResubmitRequest(BaseModel):
    note: Optional[str] = None
    major: bool = False                    # the author says it is a major change: the route starts again (never the other way)


class WithdrawRequest(BaseModel):
    reason: Optional[str] = None


class DelegateRequest(BaseModel):
    user_id: int
    note: Optional[str] = None


def _round(doc: GovernanceDocument) -> Optional[str]:
    return doc.signoff_round_at.isoformat() if doc.signoff_round_at else None


def _signed_version_id(db: Session, doc: GovernanceDocument) -> Optional[int]:
    """The version row a signature or rejection is given on (``DocumentSignature.version_id``): the row of the document's current
    number - the one a sign-off stamp is written into - or None when the document has no version rows. It is what ties a signature
    to a version for good (the approval record, approval_record.py); the rows from before are tied through their e-signature."""
    db.flush()          # tenant sessions do not autoflush (PITFALLS 74): a version row the stamp just added must be found
    row = (db.query(GovernanceDocumentVersion.id)
           .filter(GovernanceDocumentVersion.document_id == doc.id, GovernanceDocumentVersion.version_number == (doc.current_version or "1.0"))
           .order_by(GovernanceDocumentVersion.id.desc()).first())
    return row[0] if row else None


def check_version(db: Session, doc: GovernanceDocument, shown: Optional[str], round_at: Optional[str] = None) -> None:
    """A decision is about the version the person was shown: refused when the document changed since (older callers send none).
    Versions that only stamped someone's sign-off into its table are not a change to what was read. A change also starts a new
    round (``signoff_round_at``): a page from an earlier round is refused too."""
    if round_at and _round(doc) and round_at != _round(doc):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="The document changed since you opened it. Reload it and read it again.")
    current = doc.current_version or "1.0"
    if not shown or shown == current:
        return
    rows = (db.query(GovernanceDocumentVersion.version_number, GovernanceDocumentVersion.change_type)
            .filter(GovernanceDocumentVersion.document_id == doc.id)
            .order_by(GovernanceDocumentVersion.created_at, GovernanceDocumentVersion.id).all())
    numbers = [r.version_number for r in rows]
    if shown in numbers:
        after = rows[len(numbers) - numbers[::-1].index(shown):]
        if after and all(r.change_type == "signoff" for r in after):
            return
    raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                        detail=f"The document changed since you opened it (now version {current}). Reload it and read it again.")


# ── helpers ──────────────────────────────────────────────────────────────
def _doc_or_404(document_id: int, user_tenants: List[int], db: Session) -> GovernanceDocument:
    doc = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants),
    ).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return doc


def _resolve_target_users(db: Session, tenant_ids: List[int], target_type: str, target_id: int) -> Set[int]:
    """Expand a participant target to its distinct member user ids (of a role or a team, the platform accounts only: an account an
    access review imported is never asked to sign)."""
    from ....models import UserRole
    from ....routers.auth_router import platform_account

    def people(ids: Set[int]) -> Set[int]:
        return {uid for (uid,) in db.query(GRCUser.id).filter(GRCUser.id.in_(ids), platform_account())} if ids else set()

    if target_type == "user":
        return {int(target_id)}
    if target_type == "role":
        from ....routers.auth_router import PLATFORM_GRANT  # holders the platform gave the role, not connector-imported links

        rows = db.query(UserRole.user_id).filter(
            UserRole.role_id == target_id, UserRole.tenant_id.in_(tenant_ids), PLATFORM_GRANT
        ).all()
        return people({r[0] for r in rows})
    if target_type == "team":
        from ....models import Team
        from ....services import org_departments

        team = db.query(Team).filter(Team.id == target_id).first()
        return org_departments.team_member_ids(db, team) if team else set()      # a department's people, or a legacy team's
    return set()


def _target_display(db: Session, target_type: str, target_id: int) -> str:
    if target_type == "user":
        u = db.query(GRCUser).filter(GRCUser.id == target_id).first()
        return (u.display_name or u.username) if u else f"User #{target_id}"
    if target_type == "role":
        from ....models import Role
        r = db.query(Role).filter(Role.id == target_id).first()
        return f"Role: {r.name}" if r else f"Role #{target_id}"
    if target_type == "team":                      # a team is a department's picker record, and the people see departments
        from ....models import Team
        t = db.query(Team).filter(Team.id == target_id).first()
        return f"Department: {t.name}" if t else f"Department #{target_id}"
    return f"{target_type} #{target_id}"


def _assignments(db: Session, document_id: int) -> List[DocumentSignoffAssignment]:
    return db.query(DocumentSignoffAssignment).filter(
        DocumentSignoffAssignment.document_id == document_id
    ).order_by(DocumentSignoffAssignment.id).all()


def _signatures(db: Session, document_id: int) -> List[DocumentSignature]:
    """The signatures of the current round (``doc_lifecycle.start_round``): a document that changed is signed again."""
    q = db.query(DocumentSignature).filter(
        DocumentSignature.document_id == document_id,
        DocumentSignature.decision == "signed",
    )
    since = db.query(GovernanceDocument.signoff_round_at).filter(GovernanceDocument.id == document_id).scalar()
    return (q.filter(DocumentSignature.signed_at >= since) if since else q).all()


def advance_if_complete(db: Session, doc: GovernanceDocument, tenant_ids: List[int], by: Optional[int]) -> Optional[str]:
    """The stage in progress ends once its rule is met by this round's signatures (``routes.done``: on the default route every
    participant, a role or team by any one member). It goes on to the next stage with participants (review to approval; on a
    route of its own, the next stage, ``route_stage``), or is approved when there is none; it is a draft again when the next stage
    has participants but none of them can sign (it is never approved without them). Returns the status it has now when it moved
    on (None: unchanged); the caller runs the follow-ups (``doc_lifecycle.on_signed``, or ``recheck_stage`` when a signer was
    removed and the people left had all signed). ``approved_by`` is whoever signed the stage last."""
    route = routes.stages(db, doc)
    stage = routes.current(db, doc, route)
    if stage is None:
        return None
    db.flush()          # tenant sessions do not autoflush: the signature and the participants just written must count
    assignments = _assignments(db, doc.id)
    signatures = _signatures(db, doc.id)
    if not routes.done(db, doc, stage, assignments, signatures):
        return None
    nxt, _passed = routes.following(route, assignments, stage.position)
    if nxt is not None and routes.can_sign(db, doc, nxt, assignments):
        doc.status = routes.status_for(nxt, doc.status)
        if nxt.custom:
            doc.route_stage = nxt.position
    elif nxt is not None:                              # its next signers are named, none can sign: not approved without them
        doc.status, doc.route_stage = "draft", None
    else:
        last = max(routes.signatures_of(stage, signatures), key=lambda s: s.signed_at, default=None)
        doc.status, doc.approved_by, doc.approved_at = "approved", last.signer_user_id if last else by, datetime.utcnow()
        doc.route_stage = None
    return doc.status


def nobody_can_sign(db: Session, doc: GovernanceDocument) -> List[str]:
    """A sentence for each reviewer or approver of ``doc`` with nobody who can sign it: a role or team without users of this platform
    (one a connector made), an account that is not one, or an approver who is its author (four-eyes)."""
    out = []
    excluded = routes.four_eyes_excluded(db, doc, routes.DEFAULT_ROUTE[1])
    for a in _assignments(db, doc.id):
        if a.role_type not in _STAGE_STATUS:
            continue
        people = set(doc_lifecycle._members(db, doc, a))
        label = _target_display(db, a.target_type, a.target_id)           # "Role: <name>", "Department: <name>" or the person
        who = "reviewers" if a.role_type == "reviewer" else "approvers"
        if not people:
            out.append(f"{label} cannot sign it; choose other {who}." if a.target_type == "user"
                       else f"Nobody in {label.partition(': ')[2] or label} can sign it; choose other {who}.")
        elif a.role_type == "approver" and not people - excluded:
            out.append(f"{label} wrote this document and does not approve it; choose other approvers." if a.target_type == "user"
                       else f"Only its author is in {label.partition(': ')[2] or label}, and does not approve it; choose other approvers.")
    return out


def signoff_targets(db: Session, tenant_ids: List[int]) -> Dict[str, list]:
    """Who a document's reviewers and approvers (and Governance Settings' escalation) can be: the platform's people by name, the
    roles an access-review connector did not make (a role whose every link it imported, such as "DigitalOcean: team My Team", has
    nobody who can sign) and the active teams (the departments' picker records), each counting the people ``_resolve_target_users``
    would ask."""
    from sqlalchemy import func

    from ....models import Team
    from ....services import org_departments

    people = {u.id: u for u in db.query(GRCUser).filter(GRCUser.id.in_(doc_lifecycle._people(db)))}
    users = sorted(({"id": u.id, "name": u.display_name or u.username or u.email or f"User {u.id}", "email": u.email}
                    for u in people.values()), key=lambda u: (u["name"].casefold(), u["id"]))
    rows = db.query(Team).filter(Team.tenant_id.in_(tenant_ids), Team.is_active.is_(True)).order_by(func.lower(Team.name), Team.id).all()
    asked = org_departments.team_member_sets(db, rows)
    teams = [{"id": t.id, "name": t.name, "member_count": len(asked[t.id] & people.keys())} for t in rows]
    return {"users": users, "roles": signoff_roles(db, tenant_ids, set(people)), "teams": teams}


def signoff_roles(db: Session, tenant_ids: List[int], people: Optional[Set[int]] = None) -> List[dict]:
    """The roles of ``signoff_targets``, by name: not one an access-review connector made (every link to it imported), each with
    how many of ``people`` (the platform's active people) hold it as the platform gave it (auth_router.PLATFORM_GRANT)."""
    from collections import defaultdict
    from sqlalchemy import func

    from ....models import Role, UserRole
    from ....routers.auth_router import SOURCE_SSO

    people = set(doc_lifecycle._people(db)) if people is None else people
    granted, by_connector = defaultdict(set), set()
    for role_id, user_id, source in db.query(UserRole.role_id, UserRole.user_id, UserRole.source).filter(UserRole.tenant_id.in_(tenant_ids)):
        if source is None or source == SOURCE_SSO:
            granted[role_id].add(user_id)
        else:
            by_connector.add(role_id)
    return [{"id": r.id, "name": r.name, "user_count": len(granted.get(r.id, set()) & people)}
            for r in db.query(Role).filter(Role.tenant_id.in_(tenant_ids)).order_by(func.lower(Role.name), Role.id)
            if r.id in granted or r.id not in by_connector]


def _step(db: Session, doc: GovernanceDocument, user_id: int) -> Optional[routes.Step]:
    return routes.step_for(db, doc, user_id, _assignments(db, doc.id), _signatures(db, doc.id))


def _user_actionable_role(db: Session, tenant_ids: List[int], doc: GovernanceDocument,
                          user_id: int, assignments: List[DocumentSignature]) -> Optional[str]:
    """The role_type the given user may sign RIGHT NOW for this doc, or None (``routes.step_for``)."""
    step = _step(db, doc, user_id)
    return step.stage.role_type if step else None


def _my_step_or_403(db: Session, doc: GovernanceDocument, user_id: int, refused: str) -> routes.Step:
    step = _step(db, doc, user_id)
    if step is None:
        hold = routes.open_hold(db, doc)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail=refused if hold is None else ON_HOLD_PROPOSAL if routes.is_proposal(hold) else ON_HOLD)
    return step


AS_IS_ONLY = "The change you proposed holds it: sign it as it is, or propose another change."


def _signing_only(step: routes.Step) -> routes.Step:
    """While a proposed change holds the route its proposer may only sign it as it is (or propose again): no rejecting, delegating
    or asking for changes then."""
    if step.as_is:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=AS_IS_ONLY)
    return step


def _name(db: Session, user_id: Optional[int]) -> Optional[str]:
    return doc_lifecycle._names(db, [user_id]).get(user_id) if user_id else None


def _round_summary(db: Session, doc: GovernanceDocument) -> str:
    """The route in one line, as the history says it ("Review: Khalid then Sara; Approval: Board")."""
    assignments = _assignments(db, doc.id)
    parts = []
    for s in routes.stages(db, doc):
        names = [_target_display(db, a.target_type, a.target_id) for a in routes.assignments_of(s, assignments)]
        if names:
            parts.append(f"{s.name}: " + (" then " if s.order == "in_turn" else ", ").join(names))
    return "; ".join(parts)


# ── endpoints ────────────────────────────────────────────────────────────
@router.get("/{document_id}/signoff", dependencies=[Depends(require_doc_reader)])
def get_signoff(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    doc = _doc_or_404(document_id, user_tenants, db)
    assignments = _assignments(db, document_id)
    signatures = _signatures(db, document_id)
    all_sigs = db.query(DocumentSignature).filter(
        DocumentSignature.document_id == document_id
    ).order_by(DocumentSignature.signed_at.asc()).all()
    esigns = esign.summaries(db, "document_signoff", [s.id for s in all_sigs])

    def _part_out(a):
        return {
            "id": a.id, "role_type": a.role_type, "target_type": a.target_type,
            "target_id": a.target_id, "display": _target_display(db, a.target_type, a.target_id),
            "stage_position": a.stage_position, "position": a.position,
        }

    signer_names = doc_lifecycle._names(db, {s.signer_user_id for s in all_sigs} | {s.on_behalf_of for s in all_sigs if s.on_behalf_of})
    for s in all_sigs:
        signer_names.setdefault(s.signer_user_id, f"User #{s.signer_user_id}")

    route = routes.stages(db, doc)
    voided = {x.id for s in route for x in routes.earlier_of(s, signatures)}       # given before their stage started again
    progress = {}
    for rt in ("reviewer", "approver"):
        counts = [routes.progress(db, doc, s, assignments, signatures) for s in route if s.role_type == rt and not s.informs]
        progress[rt] = {"required": sum(c["required"] for c in counts), "signed": sum(c["signed"] for c in counts)}

    step = routes.step_for(db, doc, current_user.id, assignments, signatures)
    route_view = routes.view(db, doc, assignments, signatures, dict(signer_names), lambda a: _target_display(db, a.target_type, a.target_id))
    editor = can_edit(db, current_user, doc)
    from .. import proposals

    decide = proposals.decide_summary(db, current_user, doc)       # the owner (or author): changes proposed that wait for them

    return {
        "document_id": document_id,
        "status": doc.status,
        "round_at": _round(doc),           # sent back with a decision: a newer round means the document changed
        "participants": {
            rt: [_part_out(a) for a in assignments if a.role_type == rt] for rt in _ROLE_TYPES
        },
        "signatures": [
            {
                "id": s.id, "role_type": s.role_type, "role_label": s.role_label,
                "signer_user_id": s.signer_user_id, "signer_name": signer_names.get(s.signer_user_id),
                "decision": s.decision, "comment": s.comment,
                "signed_at": s.signed_at.isoformat() if s.signed_at else None,
                "esign": esigns.get(s.id),   # the drawn signature kept with this one: id and fingerprints
                "this_round": not doc.signoff_round_at or (s.signed_at is not None and s.signed_at >= doc.signoff_round_at),
                "stage_position": s.stage_position,
                "on_behalf_of": s.on_behalf_of, "on_behalf_of_name": signer_names.get(s.on_behalf_of) if s.on_behalf_of else None,
                "asked_again": s.id in voided,      # its stage started again after changes: kept, it no longer counts
            } for s in all_sigs
        ],
        "round_started_at": doc.signoff_round_at.isoformat() if doc.signoff_round_at else None,
        "version": doc.current_version or "1.0",
        "progress": progress,
        # 'reviewer' | 'approver' | null — can sign now (null while a proposed change holds it: its proposer's my_step says may_sign_as_is)
        "my_actionable_role": step.stage.role_type if step and not step.as_is else None,
        # the route: its stages and each person's state, and the changes asked for while they wait (routes.view)
        "route": route_view,
        "my_step": None if step is None else {
            "stage_position": step.stage.position, "stage_name": step.stage.name, "kind": step.stage.kind,
            "kind_label": step.stage.label, "role_type": step.stage.role_type, "in_turn": step.stage.order == "in_turn",
            # signing it as it is is the one step while it is held (no rejecting, delegating or asking for changes then)
            "can_reject": step.stage.allow_reject and not step.as_is, "can_delegate": step.stage.allow_delegate and not step.as_is,
            "on_behalf_of": _name(db, step.on_behalf_of),
            # asked again after changes: when they signed (the version, and its row to show what changed since) or what they asked
            "again": routes.again_for(db, doc, step.stage, current_user.id),
            # the owner did not accept the change they proposed: they may sign it as it is (nothing changed: the others' signatures stand)
            "may_sign_as_is": step.as_is,
            "decide": decide,
        },
        # changes asked for are resubmitted; a proposed change that holds it is accepted or rejected by the owner instead
        "can_resubmit": editor and route_view["hold"] is not None and route_view["hold"]["kind"] != "proposal" and doc.status != "archived",
        "can_withdraw": editor and doc.status in routes.PENDING,
        "decide": decide,                  # {count, first_id} for the owner (or author) while proposed changes wait for them, else null
    }


@router.put("/{document_id}/signoff/participants", dependencies=[Depends(require_doc_changer)])
def set_participants(
    document_id: int,
    body: ParticipantsUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Replace the document's sign-off participants. Prepared-by defaults to the
    document owner/author (the creator) when none supplied. A document with a route of its own keeps its stages: only
    prepared-by changes here (its reviewers and approvers sent back as they are), anything else is refused (``OWN_ROUTE``)."""
    user_tenants = get_user_tenants(current_user, db)
    doc = _doc_or_404(document_id, user_tenants, db)
    if doc.status not in ("draft", "pending_review", "pending_approval"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Participants can only be edited before the document is approved.")
    from ....routers.auth_router import refuse_imported_accounts

    custom = routes.is_custom(routes.stages(db, doc))
    if custom:
        kept = {(a.role_type, a.target_type, a.target_id) for a in _assignments(db, document_id) if a.role_type != "prepared_by"}
        sent = {(rt, it.target_type, int(it.target_id)) for rt, items in (("reviewer", body.reviewers), ("approver", body.approvers))
                for it in (items or [])}
        if sent != kept:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=OWN_ROUTE)

    # a person newly named must use the platform; one already named is sent back as it is (prepared-by is, by the details dialog)
    had = {(a.role_type, a.target_id) for a in _assignments(db, document_id) if a.target_type == "user"}
    named = [int(it.target_id) for role_type, items in (("prepared_by", body.prepared_by), ("reviewer", body.reviewers),
                                                        ("approver", body.approvers))
             for it in (items or []) if it.target_type == "user" and (role_type, it.target_id) not in had]
    unknown = set(named) - {uid for (uid,) in db.query(GRCUser.id).filter(GRCUser.id.in_(named))} if named else set()
    if unknown:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Nobody with user id {min(unknown)} uses this platform. Choose another person.")
    refuse_imported_accounts(db, named)

    q = db.query(DocumentSignoffAssignment).filter(DocumentSignoffAssignment.document_id == document_id)
    (q.filter(DocumentSignoffAssignment.role_type == "prepared_by") if custom else q).delete()

    def _add(role_type, items):
        for it in items:
            if it.target_type not in ("user", "role", "team"):
                continue
            db.add(DocumentSignoffAssignment(
                tenant_id=doc.tenant_id, document_id=document_id, role_type=role_type,
                target_type=it.target_type, target_id=int(it.target_id),
                added_by=current_user.id, added_at=datetime.utcnow(),
            ))

    prepared = body.prepared_by or []
    if not prepared:
        default_uid = doc.owner_id or doc.author_id or current_user.id
        prepared = [ParticipantIn(target_type="user", target_id=default_uid)]
    _add("prepared_by", prepared)
    if not custom:
        _add("reviewer", body.reviewers or [])
        _add("approver", body.approvers or [])
    db.flush()
    if not custom:
        doc_lifecycle.on_participants_changed(db, doc, current_user.id)
        doc_lifecycle.recheck_stage(db, doc, current_user.id)     # a signer removed: the people left may all have signed, or be nobody
    db.commit()
    return get_signoff(document_id, db, current_user)


@router.put("/{document_id}/signoff/route", dependencies=[Depends(require_doc_changer)])
def set_route(
    document_id: int,
    body: RouteUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """The document's approval route (routes.py): its stages in order, each with its people, the order they are asked in, who has
    to sign and the days they have. It replaces the reviewers and approvers (prepared-by stays); no stages is the default route
    again, with nobody chosen. Not while it is in review: withdraw it first."""
    user_tenants = get_user_tenants(current_user, db)
    doc = _doc_or_404(document_id, user_tenants, db)
    if doc.status in routes.PENDING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="It is in review now. Withdraw it from review to change its route.")
    try:
        stages = routes.validate([s.model_dump() for s in body.stages])
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    from ....routers.auth_router import refuse_imported_accounts

    named = sorted({tid for s in stages for t, tid in s["people"] if t == "user"})
    unknown = set(named) - {uid for (uid,) in db.query(GRCUser.id).filter(GRCUser.id.in_(named))} if named else set()
    if unknown:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Nobody with user id {min(unknown)} uses this platform. Choose another person.")
    refuse_imported_accounts(db, named)

    before = _round_summary(db, doc) if routes.is_custom(routes.stages(db, doc)) else None
    db.query(DocumentRouteStage).filter(DocumentRouteStage.document_id == document_id).delete()
    db.query(DocumentSignoffAssignment).filter(DocumentSignoffAssignment.document_id == document_id,
                                               DocumentSignoffAssignment.role_type != "prepared_by").delete()
    now = datetime.utcnow()
    for s in stages:
        db.add(DocumentRouteStage(tenant_id=doc.tenant_id, document_id=document_id, position=s["position"], name=s["name"], kind=s["kind"],
                                  order_mode=s["order"], rule=s["rule"], min_count=s["min_count"], due_days=s["due_days"],
                                  signature=s["signature"], allow_reject=s["allow_reject"], allow_delegate=s["allow_delegate"],
                                  created_by=current_user.id, created_at=now))
        for i, (target_type, target_id) in enumerate(s["people"], start=1):
            db.add(DocumentSignoffAssignment(tenant_id=doc.tenant_id, document_id=document_id,
                                             role_type="approver" if s["kind"] == "approval" else "reviewer",
                                             target_type=target_type, target_id=target_id, stage_position=s["position"], position=i,
                                             added_by=current_user.id, added_at=now))
    if not any(a.role_type == "prepared_by" for a in _assignments(db, document_id)):
        db.add(DocumentSignoffAssignment(tenant_id=doc.tenant_id, document_id=document_id, role_type="prepared_by", target_type="user",
                                         target_id=doc.owner_id or doc.author_id or current_user.id, added_by=current_user.id, added_at=now))
    db.flush()
    after = _round_summary(db, doc) if stages else None
    if before != after:
        create_audit_log(db=db, document_id=document_id, tenant_id=doc.tenant_id, user_id=current_user.id, action="route_set",
                         field_changed="route", old_value=before, new_value=after,
                         action_details=f"Approval route: {after}" if after else "Back to the usual route: reviewers, then approvers")
    db.commit()
    return get_signoff(document_id, db, current_user)


@router.post("/{document_id}/signoff/send-for-review", dependencies=[Depends(require_doc_editor)])
def send_for_review(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Send the document to its reviewers (or straight to approvers if no reviewers
    are assigned). Routes it to each assignee's Pending Approvals queue. A stage nobody
    can sign goes on as ``doc_lifecycle.start_round`` says (the other stage, or back to
    draft), and ``notice`` says which reviewers or approvers cannot sign. A route of its own starts at its first stage; it is
    refused when a stage has nobody who can sign."""
    user_tenants = get_user_tenants(current_user, db)
    doc = _doc_or_404(document_id, user_tenants, db)
    ensure_not_archived(doc)                           # out of the archive only by Restore, then sent as a draft
    if routes.on_hold(db, doc):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Changes were asked for: resubmit it when they are made.")
    from .. import proposals

    waiting = proposals.waiting_before_send(db, doc)          # a proposed change is decided first (it would hold the review)
    if waiting:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=waiting)
    assignments = _assignments(db, document_id)
    route = routes.stages(db, doc)
    if routes.is_custom(route):
        if doc.status in routes.PENDING:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="It is in review already.")
        refused = routes.nobody_can_sign(db, doc, route, assignments)
        first, _passed = routes.following(route, assignments)
        if refused or first is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=" ".join(refused) or "Add a stage where someone reviews or approves.")
        old = doc.status
        doc.status = routes.status_for(first, None)      # from a draft: a new round (models: _new_signoff_round)
        doc.route_stage = first.position
        doc.updated_at = datetime.utcnow()
        create_audit_log(db=db, document_id=document_id, tenant_id=doc.tenant_id, user_id=current_user.id,
                         action="sent_for_review" if first.kind != "approval" else "sent_for_approval",
                         action_details=f"Document sent for {first.name.lower()}: {_round_summary(db, doc)}",
                         field_changed="status", old_value=old, new_value=doc.status)
        db.flush()
        doc_lifecycle.on_sent(db, doc, current_user.id)
        db.commit()
        return {**get_signoff(document_id, db, current_user), "notice": None}
    has_reviewers = any(a.role_type == "reviewer" for a in assignments)
    has_approvers = any(a.role_type == "approver" for a in assignments)
    if not (has_reviewers or has_approvers):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Assign at least one reviewer or approver before sending.")
    new_status = "pending_review" if has_reviewers else "pending_approval"
    doc.status = new_status                            # from a draft: a new round (models: _new_signoff_round)
    doc.updated_at = datetime.utcnow()
    create_audit_log(
        db=db, document_id=document_id, tenant_id=doc.tenant_id, user_id=current_user.id,
        action="sent_for_review" if has_reviewers else "sent_for_approval",
        action_details=f"Document sent for {'review' if has_reviewers else 'approval'}",
        field_changed="status", old_value="draft", new_value=new_status,
    )
    db.flush()
    notice = nobody_can_sign(db, doc)
    moved = doc_lifecycle.start_round(db, doc, current_user.id)
    if moved:
        notice.append(f"{moved}.")
    if doc.status in _STAGE_STATUS.values():
        doc_lifecycle.on_sent(db, doc, current_user.id)
    db.commit()
    return {**get_signoff(document_id, db, current_user), "notice": " ".join(notice) or None}


@router.get("/signoff/targets")
def get_signoff_targets(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Who can be chosen to review or approve a document (``signoff_targets``). Anyone signed in, as the people and team lists are:
    anyone may create a document and choose who signs it."""
    return signoff_targets(db, get_user_tenants(current_user, db))


@router.post("/{document_id}/signoff/sign", dependencies=[Depends(require_doc_reader)])
def sign_document(
    document_id: int,
    body: SignRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Sign the document in the current user's actionable role. Records a
    DocumentSignature with the signer's drawn electronic signature (sealed, see
    services/esign.py), stamps the signer's row in the Approval Signoff table, and
    advances the document status when the stage completes. A delegate signs for the person who handed the step over."""
    user_tenants = get_user_tenants(current_user, db)
    doc = _doc_or_404(document_id, user_tenants, db)
    check_version(db, doc, body.version, body.round_at)
    step = _my_step_or_403(db, doc, current_user.id,
                           "You are not an assigned signer for this document at its current stage, or you have already signed.")
    stage = step.stage
    role_type, role_label = stage.role_type, stage.label
    signer_name = body.signature_text or current_user.display_name or current_user.username
    principal = _name(db, step.on_behalf_of)
    stamped = f"{signer_name} for {principal}" if principal else signer_name

    # A formal sign-off is signed electronically. The drawing is checked before anything changes, and the
    # document is fingerprinted as the signer saw it, before this sign-off is stamped into it.
    if not body.signature_image:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Draw your signature to sign this document.")
    image_sha = hashlib.sha256(esign.image_from_data_url(body.signature_image)).hexdigest()
    seen_sha = esign.document_fingerprint(doc)

    # Stamp the signer's row in the Approval Signoff table (content patch).
    old_content = doc.content
    old_title = doc.title
    old_version = doc.current_version or "1.0"
    today = datetime.utcnow().strftime("%Y-%m-%d")
    new_content = _patch_signoff_content(
        old_content,
        [{"role": role_label, "name": stamped, "designation": None, "date": f"{today} · E-signed {image_sha[:8]}"}],
        {},
    )
    content_changed = new_content != (old_content or "")
    if content_changed:
        doc.content = new_content
        _snapshot_content_version(
            db, doc, old_content=old_content, old_title=old_title, old_version=old_version,
            change_type="signoff", change_reason=f"{role_label}: {stamped}", user_id=current_user.id,
        )

    signature = DocumentSignature(
        tenant_id=doc.tenant_id, document_id=document_id, signer_user_id=current_user.id,
        role_type=role_type, role_label=role_label, decision="signed",
        signature_text=signer_name, comment=body.comment, signed_at=datetime.utcnow(),
        stage_position=stage.position if stage.custom else None, on_behalf_of=step.on_behalf_of,
        version_id=_signed_version_id(db, doc),
    )
    db.add(signature)
    db.flush()
    esig = esign.record(
        db, tenant_id=doc.tenant_id, record_type="document_signoff", record_id=signature.id,
        signature_image=body.signature_image, meaning=f"{role_label}{f' for {principal}' if principal else ''}: {doc.title}",
        signer_name=signer_name, signer_user_id=current_user.id, signer_email=current_user.email,
        signer_title=getattr(current_user, "designation", None), document=doc, document_version=old_version,
        content_sha256=seen_sha, request=request,
    )
    doc.updated_at = datetime.utcnow()
    if step.as_is:          # the proposer signs it as it is after the owner did not accept their change: the hold ends, nothing restarts
        from .. import proposals

        proposals.signed_as_is(db, doc, current_user.id)

    advanced_to = advance_if_complete(db, doc, user_tenants, current_user.id)      # this signature included
    moved = ""
    if advanced_to and stage.custom and advanced_to in routes.PENDING:
        nxt = routes.current(db, doc)
        moved = f" → {nxt.name}" if nxt else ""

    create_audit_log(
        db=db, document_id=document_id, tenant_id=doc.tenant_id, user_id=current_user.id,
        action="signed", field_changed="signoff",
        old_value=None, new_value=f"{role_label}: {stamped}",
        action_details=(body.comment or f"Signed as {role_label}{f' for {principal}' if principal else ''}")
        + (" · as it is: the change they proposed was not accepted" if step.as_is else "")
        + f" · e-signature {esig.image_sha256[:12]}, seal {esig.seal[:12]}"
        + (moved or (f" → {advanced_to}" if advanced_to else "")),
    )
    if advanced_to == "draft":
        create_audit_log(db=db, document_id=document_id, tenant_id=doc.tenant_id, user_id=current_user.id, action="status_changed",
                         field_changed="status", old_value="pending_review", new_value="draft",
                         action_details="Reviewed, but none of its approvers can sign it, so it is a draft again: choose other approvers and send it for review")
    db.flush()
    doc_lifecycle.on_signed(db, doc, current_user.id, role_type, signature.id, esig.id, advanced_to, stage=stage)
    if step.as_is:          # the requests that waited are asked again (the signer's done): the review goes on where it was
        doc_lifecycle.on_released(db, doc, current_user.id, signer=current_user.id, signature_id=signature.id)
    db.commit()
    return get_signoff(document_id, db, current_user)


@router.post("/{document_id}/signoff/reject", dependencies=[Depends(require_doc_reader)])
def reject_document(
    document_id: int,
    body: RejectRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Reject at the current stage — returns the document to draft and records the
    rejection. Only an assigned reviewer/approver at the current stage may reject, where the stage allows it (on a route of its
    own, approval stages by default; elsewhere they ask for changes)."""
    if not (body.comment or "").strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A reason is required to reject.")
    user_tenants = get_user_tenants(current_user, db)
    doc = _doc_or_404(document_id, user_tenants, db)
    check_version(db, doc, body.version, body.round_at)
    step = _signing_only(_my_step_or_403(db, doc, current_user.id, "You are not an assigned signer at this stage."))
    if not step.stage.allow_reject:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail=f"At {step.stage.name} you can sign or ask for changes; rejecting is not part of this stage.")
    role_type = step.stage.role_type
    role_label = step.stage.label
    db.add(DocumentSignature(
        tenant_id=doc.tenant_id, document_id=document_id, signer_user_id=current_user.id,
        role_type=role_type, role_label=role_label, decision="rejected",
        signature_text=current_user.display_name or current_user.username,
        comment=body.comment, signed_at=datetime.utcnow(),
        stage_position=step.stage.position if step.stage.custom else None, on_behalf_of=step.on_behalf_of,
        version_id=_signed_version_id(db, doc),
    ))
    doc.status, doc.route_stage = "draft", None
    doc.updated_at = datetime.utcnow()
    create_audit_log(
        db=db, document_id=document_id, tenant_id=doc.tenant_id, user_id=current_user.id,
        action="rejected", field_changed="status", old_value=None, new_value="draft",
        action_details=f"Rejected at {step.stage.name.lower() if step.stage.custom else 'review' if role_type == 'reviewer' else 'approval'}: {body.comment}",
    )
    db.flush()
    doc_lifecycle.on_rejected(db, doc, current_user.id, role_type, body.comment)
    db.commit()
    return get_signoff(document_id, db, current_user)


def _hold_marks(db: Session, doc: GovernanceDocument, asked_at: Optional[datetime] = None):
    """What a hold keeps when changes are asked for (routes.restarts): the version shown then and the document's newest signature.
    ``asked_at``: a hold asked for before holds kept them gets them when it is resubmitted (nobody signs while it is held, so the
    newest signature is the same; the version is the newest made by then)."""
    from sqlalchemy import func

    q = db.query(GovernanceDocumentVersion.id).filter(GovernanceDocumentVersion.document_id == doc.id)
    if asked_at is not None:
        q = q.filter(GovernanceDocumentVersion.created_at <= asked_at)
    shown = q.order_by(GovernanceDocumentVersion.id.desc()).first()
    newest = db.query(func.max(DocumentSignature.id)).filter(DocumentSignature.document_id == doc.id).scalar() or 0
    return (shown[0] if shown else None), newest


@router.post("/{document_id}/signoff/request-changes", dependencies=[Depends(require_doc_reader)])
def request_changes(
    document_id: int,
    body: ChangesRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Instead of signing, the person whose turn it is asks for changes: the route waits (nobody else signs) until the author makes
    them and resubmits, and its stage is then signed again by everyone in it, the person who asked among them (D33). The hold keeps
    the version it was asked on and the newest signature then (``routes.restarts``)."""
    comment = (body.comment or "").strip()
    if not comment:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Say what should change: the author reads it.")
    user_tenants = get_user_tenants(current_user, db)
    doc = _doc_or_404(document_id, user_tenants, db)
    check_version(db, doc, body.version, body.round_at)
    step = _signing_only(_my_step_or_403(db, doc, current_user.id, "It is not your turn to review or approve this document."))
    shown, newest = _hold_marks(db, doc)
    hold = DocumentRouteHold(tenant_id=doc.tenant_id, document_id=doc.id, round_at=doc.signoff_round_at, stage_position=step.stage.position,
                             requested_by=current_user.id, on_behalf_of=step.on_behalf_of, requested_at=datetime.utcnow(),
                             comment=comment, assignment_id=step.assignment_id, content_before=doc.content,
                             version_id=shown, signature_mark=newest)
    db.add(hold)
    doc.updated_at = datetime.utcnow()
    create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=current_user.id, action="changes_requested",
                     field_changed="signoff", old_value=None, new_value=comment[:500],
                     action_details=f"Changes asked for at {step.stage.name.lower()}: {comment}")
    db.flush()
    doc_lifecycle.on_changes_requested(db, doc, current_user.id, step.stage, hold)
    db.commit()
    return get_signoff(document_id, db, current_user)


@router.post("/{document_id}/signoff/resubmit", dependencies=[Depends(require_doc_changer)])
def resubmit(
    document_id: int,
    body: ResubmitRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """The changes asked for are made: the route goes on. A minor change (or none, by doc_version.by_rule on the document's text, or
    its file's text) starts the stage it waited at again for everyone in it (the user, 2026-10-21): the signatures given there before
    no longer count (``routes.restarts``) and everyone is asked again, told what changed since (in turn: from the first); earlier
    stages' signatures stand. A major one, or one the author calls major, starts the route again from its first stage (D33). A
    proposed change that holds it is accepted or rejected by its owner instead (proposals.py)."""
    user_tenants = get_user_tenants(current_user, db)
    doc = _doc_or_404(document_id, user_tenants, db)
    hold = routes.open_hold(db, doc)
    if hold is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No changes are waiting to be resubmitted.")
    if routes.is_proposal(hold):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="A proposed change holds it: its owner accepts or rejects it in Proposed changes.")
    size = "major" if body.major else change_since(db, doc, hold)
    resume(db, doc, hold, current_user.id, size, body.note)
    db.commit()
    return {**get_signoff(document_id, db, current_user), "outcome": hold.outcome, "change": size}


def change_since(db: Session, doc: GovernanceDocument, hold: DocumentRouteHold) -> str:
    """none | minor | major: how much the document changed since the hold began (doc_version.by_rule, no AI): its text, or - for a
    document that is its Word or PDF file, whose own text is empty - its file's text then (the version it was asked on) and now.
    (Sizing a file document by its empty text called every change "none".)"""
    from ..doc_version import by_rule

    if not (doc.file_path and not (doc.content or "").strip()):
        return "none" if (hold.content_before or "") == (doc.content or "") else by_rule(hold.content_before, doc.content)
    from .. import change_chain as C

    row = db.get(GovernanceDocumentVersion, hold.version_id) if hold.version_id else None
    before = C.version_text(row) if row is not None else None
    after = C.document_text(doc)
    if before is None or after is None:             # a file that cannot be read: a new version since is a minor change
        return "minor" if routes.changed_since(db, doc, hold) else "none"
    return "none" if before == after else by_rule(before, after)


def resume(db: Session, doc: GovernanceDocument, hold: DocumentRouteHold, by: int, size: str, note: Optional[str] = None, *,
           done: Optional[str] = None, log: bool = True) -> str:
    """The hold ends as a resubmission does (``size``: none | minor | major): a minor change (or none) starts the stage it waited at
    again for everyone in it, a major one the whole route. ``done``: what ended it, when it is not a resubmission (a proposed change
    accepted: proposals.py), whose own Change log row then says so (``log`` False: no "Resubmitted" row). Returns what happens, as
    the history says it. Does not commit."""
    now = datetime.utcnow()
    note = (note or "").strip() or None
    hold.resolved_at, hold.resolved_by, hold.resubmit_note, hold.change = now, by, note, size
    who = _name(db, hold.requested_by) or "the person who asked"
    held_at = routes.stage_at(routes.stages(db, doc), hold.stage_position)
    if size == "major":
        hold.outcome = "restarted"
        why = (f"{done} (a major change), so it is signed again from the start" if done else
               f"Resubmitted with a major change after {who} asked for changes, so it is signed again from the start")
    else:
        hold.outcome = "resumed"
        if hold.signature_mark is None:                 # asked for before holds kept their marks: the stage starts again all the same
            shown, hold.signature_mark = _hold_marks(db, doc, hold.requested_at)
            hold.version_id = hold.version_id or shown
        why = (f"{done or f'Resubmitted after {who} asked for changes'} ({'no change to the text' if size == 'none' else 'a minor change'}): "
               f"everyone at {held_at.name if held_at else 'its stage'} signs it again; the stages before stand")
    doc.updated_at = now
    if log:
        create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=by, action="resubmitted",
                         field_changed="signoff", old_value=hold.comment[:500], new_value=size,
                         action_details=why + (f". {note}" if note else ""))
    db.flush()
    if size == "major":
        doc_lifecycle.restart_round(db, doc, by)
    doc_lifecycle.on_resubmitted(db, doc, by, hold)
    if size != "major":
        _log_asked_again(db, doc, hold, by)
        doc_lifecycle.recheck_stage(db, doc, by)      # meanwhile the people left may be nobody
    return why


def _log_asked_again(db: Session, doc: GovernanceDocument, hold: DocumentRouteHold, by: int) -> None:
    """The Change log's "Asked again after changes": the stage the changes were asked at starts again, naming everyone in it and
    who had signed it (that signature no longer counts) or asked for the changes."""
    st = routes.stage_at(routes.stages(db, doc), hold.stage_position)
    if st is None:
        return
    holds = routes.resumed(db, doc, st.position)
    earlier = routes.earlier_of(st, _signatures(db, doc.id))
    names, tagged = [], []
    for a in routes.assignments_of(st, _assignments(db, doc.id)):
        act = routes.last_act(holds, earlier, set(doc_lifecycle._members(db, doc, a)))
        names.append(_target_display(db, a.target_type, a.target_id))
        tagged.append(names[-1] + ("" if act is None else " (asked for the changes)" if act[0] == "changes" else " (had signed)"))
    if not names:
        return
    first = st.order == "in_turn" and len(names) > 1
    create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=by, action="review_again_requested", field_changed="signoff",
                     old_value=None, new_value=", ".join(names)[:500],
                     action_details=f"{st.name} starts again{' from its first person' if first else ''} after the changes: "
                                    f"{(', then ' if first else ', ').join(tagged)} {'is' if len(names) == 1 else 'are'} asked again")


@router.post("/{document_id}/signoff/withdraw", dependencies=[Depends(require_doc_changer)])
def withdraw(
    document_id: int,
    body: WithdrawRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """The author takes the document back from review: a draft again, what was asked of people ends and they are told. Sending it
    again starts a new round."""
    user_tenants = get_user_tenants(current_user, db)
    doc = _doc_or_404(document_id, user_tenants, db)
    if doc.status not in routes.PENDING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="It is not in review.")
    reason = (body.reason or "").strip() or None
    hold = routes.open_hold(db, doc)
    if hold is not None:
        hold.resolved_at, hold.resolved_by, hold.outcome = datetime.utcnow(), current_user.id, "withdrawn"
    old = doc.status
    doc_lifecycle.on_withdrawn(db, doc, current_user.id, reason)          # tells the people still asked, before their requests end
    doc.status, doc.route_stage, doc.updated_at = "draft", None, datetime.utcnow()
    create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=current_user.id, action="withdrawn",
                     field_changed="status", old_value=old, new_value="draft",
                     action_details="Withdrawn from review" + (f": {reason}" if reason else ""))
    db.flush()
    doc_lifecycle.on_status_changed(db, doc, old, "draft", current_user.id)
    db.commit()
    return get_signoff(document_id, db, current_user)


@router.post("/{document_id}/signoff/delegate", dependencies=[Depends(require_doc_reader)])
def delegate(
    document_id: int,
    body: DelegateRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Hand one's step at the current stage to someone else, who then signs (or asks for changes) for them; the person who handed
    it over no longer does. Where the stage allows it (on by default)."""
    user_tenants = get_user_tenants(current_user, db)
    doc = _doc_or_404(document_id, user_tenants, db)
    step = _signing_only(_my_step_or_403(db, doc, current_user.id, "It is not your turn to review or approve this document."))
    stage = step.stage
    if not stage.allow_delegate:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"{stage.name} cannot be delegated.")
    to = int(body.user_id)
    to_name = _name(db, to) or f"User #{to}"
    if to == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose someone else.")
    if not doc_lifecycle._people(db, [to]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{to_name} cannot sign: choose someone who uses this platform.")
    if to in routes.four_eyes_excluded(db, doc, stage):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{to_name} wrote this document, so they do not approve it.")
    assignments = _assignments(db, doc.id)
    asked_here = set().union(set(), *(routes._members(db, doc, a) for a in routes.assignments_of(stage, assignments)))
    if to in asked_here | routes.signer_ids(routes.signatures_of(stage, _signatures(db, doc.id))):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{to_name} is already asked at {stage.name}: choose someone else.")
    now = datetime.utcnow()
    note = (body.note or "").strip() or None
    mine = [o for o in routes.round_requests(db, doc, current_user.id, stage) if o.status == "pending"]
    for ob in mine:
        ob.status, ob.done_at, ob.comment = "delegated", now, note
        doc_lifecycle._close(db, ob, completed=False)
    if not mine:            # asked through a role or team, or without the life cycle: the hand-over is still recorded
        db.add(DocumentObligation(tenant_id=doc.tenant_id, document_id=doc.id, kind=stage.obligation_kind, user_id=current_user.id,
                                  assignment_id=step.assignment_id, stage_position=stage.position if stage.custom else None,
                                  on_behalf_of=step.on_behalf_of, document_version=doc.current_version, status="delegated",
                                  requested_by=current_user.id, requested_at=now, done_at=now, comment=note))
    days = stage.due_days or doc_lifecycle.due_days(doc_lifecycle.settings(db, doc.tenant_id), stage.obligation_kind)
    due = min((o.due_date for o in mine if o.due_date), default=None) or now + timedelta(days=days)
    handed = DocumentObligation(tenant_id=doc.tenant_id, document_id=doc.id, kind=stage.obligation_kind, user_id=to,
                                assignment_id=step.assignment_id, stage_position=stage.position if stage.custom else None,
                                on_behalf_of=step.on_behalf_of or current_user.id, document_version=doc.current_version,
                                status="pending", requested_by=current_user.id, requested_at=now, due_date=due, comment=note)
    db.add(handed)
    db.flush()
    me = current_user.display_name or current_user.username
    create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=current_user.id, action="delegated",
                     field_changed="signoff", old_value=me, new_value=to_name,
                     action_details=f"{stage.name}: {me} delegated their step to {to_name}" + (f": {note}" if note else ""))
    doc_lifecycle.on_delegated(db, doc, current_user.id, handed, stage)
    db.commit()
    return get_signoff(document_id, db, current_user)


@router.get("/signoff/my-pending")
def my_pending_signoffs(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Documents awaiting the current user's signature — expands role/team
    membership so a user assigned via a role or team still sees the document; on a route whose stage asks people in turn, only
    when it is their turn."""
    user_tenants = get_user_tenants(current_user, db)
    # Candidate docs: in a pending stage, in the user's tenant(s).
    docs = db.query(GovernanceDocument).filter(
        GovernanceDocument.tenant_id.in_(user_tenants),
        GovernanceDocument.status.in_(("pending_review", "pending_approval")),
    ).order_by(GovernanceDocument.updated_at.desc(), GovernanceDocument.id).all()
    out = []
    for doc in docs:
        step = _step(db, doc, current_user.id)
        if not step:
            continue
        out.append({
            "document_id": doc.id,
            "title": doc.title,
            "doc_type": doc.doc_type,
            "status": doc.status,
            "stage_role": step.stage.role_type,                # reviewer | approver
            "stage_label": step.stage.label if step.stage.custom else _ROLE_LABEL[step.stage.role_type],
            "stage_name": step.stage.name,
            "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
        })
    return {"total": len(out), "items": out}
