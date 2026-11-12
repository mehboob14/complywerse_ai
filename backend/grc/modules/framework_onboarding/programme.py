"""From an approved onboarding to a compliance programme: the hand-off (plan section 7, phase 4; design ``docs/framework-onboarding-programme-handoff.md``).

Onboarding configures a framework; compliance execution does the work. This module only STARTS and PROPOSES, and it never writes a requirement, a control
status or a compliance result from an answer or from an item of "What exists":

* STARTED: the journey (linked when one exists, made through the Controls Automation scope's own creator when none does), which loads the framework's controls as
  ``not_started``; the scope the onboarding chose, written out on a ``FrameworkProgramme`` row.
* PROPOSED: the people named under Ownership, with the programme owner as the owner of controls nobody owns (applied only when a person asks).
* OFFERED: the items of "What exists" as evidence candidates, read live from ``grc_fw_existing_compliance`` (a claim, its source, date and how far anyone has checked it).

Running it again with nothing new changes nothing and records nothing; what changed is named on the onboarding's history.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...models import CertificationJourney, ControlImplementation, FrameworkOnboarding, FrameworkProgramme, GRCUser, UploadedFramework
from . import catalog, existing, files, gate, profile, service
from .errors import OnboardingError

STARTABLE = ("complete", "underway")
NOT_YET = "Approve the onboarding first. One marked underway can start too."
SOURCE = "Declared in onboarding"
ROLES = (("owner", "Programme owner"), ("coordinator", "Coordinator"), ("approver", "Approver"))


def find(db: Session, ob: FrameworkOnboarding) -> Optional[FrameworkProgramme]:
    return db.query(FrameworkProgramme).filter(FrameworkProgramme.onboarding_id == ob.id, FrameworkProgramme.tenant_id == ob.tenant_id).first()


def _latest_journey(db: Session, ob: FrameworkOnboarding) -> Optional[CertificationJourney]:
    """Any journey of this tenant for the framework, whatever its status: the one that is linked (a second journey is never made beside it)."""
    return (db.query(CertificationJourney).filter(CertificationJourney.tenant_id == ob.tenant_id,
                                                  CertificationJourney.uploaded_framework_id == ob.uploaded_framework_id)
            .order_by(CertificationJourney.id.desc()).first())


# --------------------------------------------------------------------------- what the onboarding says, written out
def _source(db: Session, ob: FrameworkOnboarding) -> Tuple[Dict[str, Any], Dict[str, List[Dict[str, Any]]]]:
    """The answers and profile rows the hand-off reads: the frozen snapshot of an approved onboarding, the current answers of one marked underway."""
    snap = ob.snapshot if ob.state == "complete" and isinstance(ob.snapshot, dict) else None
    if snap:
        return snap.get("answers") or {}, snap.get("org_rows") or {}
    return ob.answers or {}, service._org_rows(profile.merged_values(db, ob.tenant_id))


def _person(v: Any, users: Dict[int, str]) -> Optional[Dict[str, Any]]:
    """A named person: ``user_id`` when they have an account here, else the name (and email) as typed."""
    if not isinstance(v, dict):
        return None
    if v.get("user_id"):
        uid = int(v["user_id"])
        return {"user_id": uid, "name": users.get(uid) or "Unknown user", "account": True}
    name = str(v.get("name") or "").strip()
    return {"user_id": None, "name": name, "account": False, **({"email": v["email"]} if v.get("email") else {})} if name else None


def _user_ids(answers: Dict[str, Any]) -> set:
    ids = set()
    for key, _ in ROLES:
        v = (answers.get("ownership") or {}).get(key)
        if isinstance(v, dict) and v.get("user_id"):
            ids.add(int(v["user_id"]))
    for r in (answers.get("scope") or {}).get("processes") or []:
        o = r.get("owner") if isinstance(r, dict) else None
        if isinstance(o, dict) and o.get("user_id"):
            ids.add(int(o["user_id"]))
    return ids


def _scope(db: Session, ob: FrameworkOnboarding, answers: Dict[str, Any], rows: Dict[str, List[Dict[str, Any]]]) -> Dict[str, Any]:
    """The boundary the onboarding chose, names written out. Only what was answered: nothing is invented, and no control is put in or out by it."""
    a = lambda step, key: (answers.get(step) or {}).get(key)           # noqa: E731
    dept_ids = [int(i) for i in a("scope", "departments") or []]
    sys_ids = [int(i) for i in a("scope", "systems") or []]
    names = profile._names(db, ob.tenant_id, _user_ids(answers), set(sys_ids), set(), set(dept_ids))

    def picked(of: str, ids: List[str]) -> List[Dict[str, Any]]:
        by_id = {r.get("id"): r for r in rows.get(of) or []}
        return [{"id": i, "name": str(by_id[i].get("name") or "").strip()} for i in ids or [] if i in by_id and str(by_id[i].get("name") or "").strip()]

    reach = a("applicability", "reach")
    return {
        "reach": reach, "whole_organisation": reach == "Whole organisation", "entity": a("applicability", "entity"),
        "countries": a("applicability", "jurisdictions") or [], "services": a("applicability", "products"),
        "defined": a("scope", "defined"), "documents": a("scope", "defined_file") or [], "statement": a("scope", "statement"),
        "departments": [{"id": i, "name": names["departments"][i]} for i in dept_ids if i in names["departments"]],
        "systems": [{"id": i, "name": names["assets"][i]["name"], "type": names["assets"][i].get("asset_type")} for i in sys_ids if i in names["assets"]],
        "locations": picked("sites", a("scope", "locations")), "third_parties": picked("third_parties", a("scope", "vendors")),
        "processes": [{"process": r.get("process"), "owner": (_person(r.get("owner"), names["users"]) or {}).get("name")}
                      for r in a("scope", "processes") or [] if isinstance(r, dict) and r.get("process")],
        "hosting": a("scope", "hosting") or [],
        "exclusions": [{"item": r.get("item"), "reason": r.get("reason")} for r in a("scope", "exclusions") or [] if isinstance(r, dict) and r.get("item")],
        "target_date": a("objective", "target_date"),
    }


def _proposals(db: Session, ob: FrameworkOnboarding, answers: Dict[str, Any]) -> Dict[str, Any]:
    """The people named under Ownership. ``control_owner`` is the programme owner when they have an account here: the one person the apply step can use."""
    own = answers.get("ownership") or {}
    dept_ids = [int(i) for i in own.get("teams") or []]
    names = profile._names(db, ob.tenant_id, _user_ids(answers), set(), set(), set(dept_ids))
    people = []
    for key, label in ROLES:
        p = _person(own.get(key), names["users"])
        if p:
            people.append({"role": label, **p})
    owner = next((p for p in people if p["role"] == ROLES[0][1]), None)
    return {"people": people, "teams": [{"id": i, "name": names["departments"][i]} for i in dept_ids if i in names["departments"]],
            "assessor": own.get("assessor"), "control_owner": owner["user_id"] if owner and owner["account"] else None}


def candidates(db: Session, ob: FrameworkOnboarding) -> List[Dict[str, Any]]:
    """The items of "What exists" offered as evidence candidates. Read live, so a later review shows. A candidate is a CLAIM: it says what was declared, by whom,
    when, and how far anyone has checked it; it is attached to no control and counts for nothing until a person uses it in the journey."""
    names = files.known(db, ob.tenant_id)
    out = []
    for r in existing.records(db, ob):
        row = existing.serialise(db, r, names)
        out.append({**row, "source": SOURCE, "has_document": bool(row["files"])})
    return out


def _offered(cands: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """What a change in the offered items means: the fields a person reads, not the incidental ones (the time of the last edit)."""
    keys = ("id", "assessment_type", "assessment_date", "valid_until", "expired", "verification_status", "scope_coverage", "assessor_or_issuer", "framework_version")
    return [{**{k: c.get(k) for k in keys}, "files": [f["id"] for f in c["files"]]} for c in cands]


# --------------------------------------------------------------------------- what the journey holds now
def controls_of(db: Session, journey_id: int) -> Dict[str, int]:
    rows = (db.query(ControlImplementation.status, ControlImplementation.is_applicable, ControlImplementation.assigned_user_ids,
                     ControlImplementation.assigned_to_user_id).filter(ControlImplementation.journey_id == journey_id).all())
    not_started = sum(1 for s, *_ in rows if (s or "not_started") == "not_started")
    unowned = sum(1 for _, ok, ids, one in rows if ok is not False and not (ids or one))
    return {"total": len(rows), "not_started": not_started, "begun": len(rows) - not_started, "without_owner": unowned}


def _journey_view(j: CertificationJourney, prog: FrameworkProgramme) -> Dict[str, Any]:
    return {"id": j.id, "name": j.name, "status": j.status, "target_date": j.target_date.date().isoformat() if j.target_date else None,
            "made_here": bool(prog.journey_created)}


def view(db: Session, ob: FrameworkOnboarding) -> Dict[str, Any]:
    """GET .../programme: what was started, proposed and offered. Never writes."""
    prog = find(db, ob)
    can = ob.state in STARTABLE
    out: Dict[str, Any] = {"started": prog is not None, "can_start": can, "why_not": None if can else NOT_YET, "state": ob.state,
                           "journey": None, "controls": None, "scope": None, "proposals": None, "owner": None, "candidates": [], "note": None}
    if prog is None:
        return out
    j = db.query(CertificationJourney).filter(CertificationJourney.id == prog.journey_id, CertificationJourney.tenant_id == ob.tenant_id).first() if prog.journey_id else None
    controls = controls_of(db, j.id) if j else None
    p = prog.proposals or {}
    owner = next((x for x in p.get("people") or [] if x.get("role") == ROLES[0][1]), None)
    ok = bool(p.get("control_owner")) and p["control_owner"] in profile.known(db, ob.tenant_id).users
    out.update(
        journey=_journey_view(j, prog) if j else None, controls=controls, scope=prog.scope or {}, proposals=p, candidates=candidates(db, ob),
        owner={"name": owner["name"] if owner else None, "can_apply": bool(ok and controls and controls["without_owner"]),
               "without_owner": controls["without_owner"] if controls else 0,
               "why_not": None if ok else ("The programme owner has no account on this platform." if owner else "No programme owner was named.")},
        started_at=prog.created_at.isoformat() if prog.created_at else None)
    if j is None:
        out["note"] = "The journey was deleted. Start the programme again to make a new one."
    return out


# --------------------------------------------------------------------------- start (idempotent)
def _create_journey(db: Session, ob: FrameworkOnboarding, fw: UploadedFramework, user: GRCUser) -> CertificationJourney:
    from ..scf.scope_service import _create_journey_for_framework      # the creator the Controls Automation scope uses: one control row per control, nothing assessed

    j = _create_journey_for_framework(db, ob.tenant_id, user, fw)
    gate.record_started(db, ob.tenant_id, fw, user.id)
    return j


def start(db: Session, ob: FrameworkOnboarding, user: GRCUser) -> Dict[str, Any]:
    """Link or make the journey, write the scope and the proposals down, offer the existing items. Twice in a row: the second changes nothing and says so."""
    if ob.state not in STARTABLE:
        raise OnboardingError(409, NOT_YET)
    fw = db.query(UploadedFramework).filter(UploadedFramework.id == ob.uploaded_framework_id).first()
    if fw is None:
        raise OnboardingError(404, "Framework not found.")
    answers, rows = _source(db, ob)
    scope, proposals, cands = _scope(db, ob, answers, rows), _proposals(db, ob, answers), candidates(db, ob)
    offered = _offered(cands)
    prog = find(db, ob)
    journey = _latest_journey(db, ob)
    created = journey is None
    if created:
        journey = _create_journey(db, ob, fw, user)
        if scope.get("target_date") and journey.target_date is None:           # only on a journey made here: an existing one is never edited
            journey.target_date = datetime.fromisoformat(f"{scope['target_date']}T00:00:00")

    changed: List[str] = []
    now = datetime.utcnow()
    if prog is None:
        prog = FrameworkProgramme(tenant_id=ob.tenant_id, onboarding_id=ob.id, journey_id=journey.id, journey_created=created, scope=scope, proposals=proposals,
                                  offered=offered, created_by=user.id, created_at=now, updated_at=now)
        db.add(prog)
        try:
            db.flush()
        except IntegrityError:                                                 # another request started it first
            db.rollback()
            return {**view(db, ob), "changed": False}
        controls = controls_of(db, journey.id)
        service._event(db, ob, "programme_started", user.id, {"journey_made": created, "controls": controls["total"], "people": len(proposals["people"]),
                                                              "offered": len(offered), "scope": bool(scope.get("reach"))})
        changed = ["all"]
    else:
        if created or prog.journey_id != journey.id:                           # made again (a database may hand the new journey the old number)
            changed.append("journey")
            prog.journey_id, prog.journey_created = journey.id, created
        for name, old, new, attr in (("scope", prog.scope, scope, "scope"), ("people", prog.proposals, proposals, "proposals"), ("evidence", prog.offered, offered, "offered")):
            if old != new:
                changed.append(name)
                setattr(prog, attr, new)
        if changed:
            prog.updated_at = now
            service._event(db, ob, "programme_updated", user.id, {"changed": changed})
    db.commit()
    return {**view(db, ob), "changed": bool(changed)}


# --------------------------------------------------------------------------- apply the proposed owner
def apply_owner(db: Session, ob: FrameworkOnboarding, user: GRCUser) -> Dict[str, Any]:
    """The programme owner becomes the owner of every control of the journey that nobody owns. Never replaces an owner, never touches a control that is out of scope."""
    prog = find(db, ob)
    if prog is None or not prog.journey_id:
        raise OnboardingError(409, "Start the programme first.")
    owner = (prog.proposals or {}).get("control_owner")
    if not owner:
        raise OnboardingError(422, "The programme owner has no account on this platform. Assign owners in the journey.")
    if owner not in profile.known(db, ob.tenant_id).users:
        raise OnboardingError(422, "The programme owner is not an active user of this platform any more. Assign owners in the journey.")
    n = 0
    for c in db.query(ControlImplementation).filter(ControlImplementation.journey_id == prog.journey_id).all():
        if c.is_applicable is not False and not (c.assigned_user_ids or c.assigned_to_user_id):
            c.assigned_user_ids, c.assigned_to_user_id = [owner], owner
            n += 1
    if n:
        who = next((p["name"] for p in prog.proposals.get("people") or [] if p.get("user_id") == owner), None)
        service._event(db, ob, "owners_applied", user.id, {"controls": n, "owner": who})
    db.commit()
    return {**view(db, ob), "changed": n}
