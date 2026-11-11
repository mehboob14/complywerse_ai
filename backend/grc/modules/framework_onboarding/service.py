"""Framework onboarding: one per tenant per library framework; the state machine and its readable view (plan sections 4, 6, 7).

draft -> ready (every required check passes, submitted) -> complete (approved, snapshot frozen). ``underway`` is the escape for a framework
that is already running: a recorded reason, the journey may start, the gaps stay listed. Nothing here is read by a GET with a side effect."""
from __future__ import annotations

import copy
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...models import CertificationJourney, FrameworkOnboarding, FrameworkOnboardingEvent, GRCUser, UploadedFramework
from ..scf.registry import slug_for_framework
from . import catalog, engine, files, profile

UNDERWAY_KINDS = [
    "Running before onboarding existed",
    "Certified or attested outside the platform",
    "Regulator-mandated start",
    "Other",
]
MIN_UNDERWAY_REASON = 20
MIN_REOPEN_REASON = 10
LEGACY_REASON = "A journey existed before framework onboarding."
STATES = ("draft", "ready", "complete", "underway")
AVAILABLE_STATUSES = ["published", "completed", "parsed", "classified"]
STATUS_PRIORITY = {"classified": 7, "published": 6, "completed": 5, "parsed": 4, "classifying": 3, "text_extracted": 2, "draft": 1}


class OnboardingError(Exception):
    """A refusal that carries its HTTP status and the body to show (a person-readable message, optionally the unmet checks)."""

    def __init__(self, status: int, message: str, **more: Any):
        super().__init__(message)
        self.status, self.body = status, {"message": message, **more}


def framework_slug(fw: UploadedFramework) -> Optional[str]:
    return slug_for_framework(fw.name, slug=fw.slug)


def get_framework(db: Session, tenant_id: int, framework_id: int) -> UploadedFramework:
    fw = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
    if fw is None or not (fw.tenant_id == tenant_id or fw.is_shared):
        raise OnboardingError(404, "Framework not found.")
    return fw


def find(db: Session, tenant_id: int, framework_id: int) -> Optional[FrameworkOnboarding]:
    return (db.query(FrameworkOnboarding).filter(FrameworkOnboarding.tenant_id == tenant_id,
                                                 FrameworkOnboarding.uploaded_framework_id == framework_id).first())


def get(db: Session, tenant_id: int, onboarding_id: int) -> FrameworkOnboarding:
    ob = db.query(FrameworkOnboarding).filter(FrameworkOnboarding.id == onboarding_id, FrameworkOnboarding.tenant_id == tenant_id).first()
    if ob is None:
        raise OnboardingError(404, "Onboarding not found.")
    return ob


def _event(db: Session, ob: FrameworkOnboarding, kind: str, actor: Optional[int], detail: Optional[Dict[str, Any]] = None) -> None:
    db.add(FrameworkOnboardingEvent(onboarding_id=ob.id, tenant_id=ob.tenant_id, kind=kind, actor_id=actor, detail=detail or {},
                                    created_at=datetime.utcnow()))


def _saved_event(db: Session, ob: FrameworkOnboarding, actor: int, step: str, keys: List[str], reverted: bool) -> None:
    """Autosave writes a row per key: one event per person per step per ten minutes is enough."""
    last = (db.query(FrameworkOnboardingEvent).filter(FrameworkOnboardingEvent.onboarding_id == ob.id)
            .order_by(FrameworkOnboardingEvent.id.desc()).first())
    now = datetime.utcnow()
    if last and last.kind == "saved" and last.actor_id == actor and (last.detail or {}).get("step") == step \
            and last.created_at and now - last.created_at < timedelta(minutes=10) and not reverted:
        d = dict(last.detail or {})
        d["fields"] = sorted(set(d.get("fields") or []) | set(keys))
        last.detail, last.created_at = d, now
        return
    _event(db, ob, "saved", actor, {"step": step, "fields": sorted(keys), **({"reopened_review": True} if reverted else {})})


# --------------------------------------------------------------------------- create and read
def prefilled(slug: Optional[str], org_values: Dict[str, Any], kn: engine.Known) -> Dict[str, Dict[str, Any]]:
    """The answers a new onboarding starts with: each field that names ``prefill_from`` (an organisation-profile field of the same type, or the
    Tenant fact the profile reads) takes what the organisation already told us. Anything that does not fit the field is left empty."""
    out: Dict[str, Dict[str, Any]] = {}
    for st in catalog.resolve(slug)["steps"]:
        for f in st["fields"]:
            ref = f.get("prefill_from")
            if not ref:
                continue
            group, _, key = ref[4:].partition(".") if ref.startswith("org.") else ref.partition(".")
            v = (org_values.get(group) or {}).get(key)
            if v in (None, "", [], {}):
                continue
            try:
                v = engine.normalise(f, v, kn)
            except engine.FieldError:
                continue
            if v not in (None, [], {}):
                out.setdefault(st["key"], {})[f["key"]] = v
    return out


def create(db: Session, tenant_id: int, user: GRCUser, fw: UploadedFramework) -> FrameworkOnboarding:
    """The draft for a framework; asking again returns the same one."""
    ob = find(db, tenant_id, fw.id)
    if ob is not None:
        return ob
    slug = framework_slug(fw)
    now = datetime.utcnow()
    org_values = profile.merged_values(db, tenant_id)
    ob = FrameworkOnboarding(tenant_id=tenant_id, uploaded_framework_id=fw.id, framework_slug=slug, family=catalog.family_key_for_slug(slug),
                             catalog_version=catalog.catalog_version(), state="draft", answers=prefilled(slug, org_values, profile.known(db, tenant_id, org_values)),
                             created_by=user.id, created_at=now, updated_at=now)
    db.add(ob)
    db.flush()
    _event(db, ob, "created", user.id)
    db.commit()
    return ob


def _journey(db: Session, tenant_id: int, framework_id: int) -> Optional[Dict[str, Any]]:
    j = (db.query(CertificationJourney).filter(CertificationJourney.tenant_id == tenant_id,
                                               CertificationJourney.uploaded_framework_id == framework_id)
         .order_by(CertificationJourney.id.desc()).first())
    return {"id": j.id, "status": j.status, "name": j.name} if j else None


def _readiness(db: Session, ob: FrameworkOnboarding, org_values: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    org_values = org_values if org_values is not None else profile.merged_values(db, ob.tenant_id)
    return engine.evaluate(catalog.resolve(ob.framework_slug), ob.answers or {}, org_values)


def _person(db: Session, uid: Optional[int]) -> Optional[str]:
    if not uid:
        return None
    row = db.query(GRCUser.display_name, GRCUser.username).filter(GRCUser.id == uid).first()
    return (row[0] or row[1]) if row else None


def _iso(d: Optional[datetime]) -> Optional[str]:
    return d.isoformat() if d else None


def _events(db: Session, ob: FrameworkOnboarding, limit: int = 40) -> List[Dict[str, Any]]:
    rows = (db.query(FrameworkOnboardingEvent).filter(FrameworkOnboardingEvent.onboarding_id == ob.id)
            .order_by(FrameworkOnboardingEvent.id.desc()).limit(limit).all())
    names = {r.actor_id: _person(db, r.actor_id) for r in rows if r.actor_id}
    return [{"kind": r.kind, "by": names.get(r.actor_id), "at": _iso(r.created_at), "detail": r.detail or {}} for r in rows]


def summary(ob: FrameworkOnboarding) -> Dict[str, Any]:
    return {
        "state": ob.state, "underway": ({"kind": ob.underway_kind, "reason": ob.underway_reason, "at": _iso(ob.underway_at), "source": ob.underway_source}
                                        if ob.state == "underway" else None),
        "submitted_at": _iso(ob.submitted_at), "approved_at": _iso(ob.approved_at), "reopened_count": ob.reopened_count or 0,
        "updated_at": _iso(ob.updated_at),
    }


def view(db: Session, ob: FrameworkOnboarding) -> Dict[str, Any]:
    """GET /framework-onboarding/{id}: the steps of this framework with their answers, the readiness, the history. Never writes."""
    fw = db.query(UploadedFramework).filter(UploadedFramework.id == ob.uploaded_framework_id).first()
    res = catalog.resolve(ob.framework_slug)
    org_values = profile.merged_values(db, ob.tenant_id)
    readiness = engine.evaluate(res, ob.answers or {}, org_values)
    refs = profile.refs_for(db, ob.tenant_id, org_values)
    for k, v in profile._names(db, ob.tenant_id, *_answer_refs(res, ob.answers or {})).items():
        refs.setdefault(k, {}).update(v)
    return {
        "id": ob.id, "uploaded_framework_id": ob.uploaded_framework_id,
        "framework": {"name": fw.name if fw else None, "slug": res["slug"], "label": res["label"], "family": res["family"],
                      "family_label": res.get("family_label"), "summary": res.get("summary"), "flow_id": res.get("flow_id"),
                      "not_in_library": res.get("not_in_library", False)},
        "state": ob.state, "locked": ob.state == "complete", **summary(ob),
        "approved_by": _person(db, ob.approved_by), "submitted_by": _person(db, ob.submitted_by), "approval_note": ob.approval_note,
        "underway_by": _person(db, ob.underway_by),
        "steps": res["steps"], "requires_org": res.get("requires_org") or [], "answers": ob.answers or {},
        "readiness": readiness,
        "refs": refs, "org_rows": _org_rows(org_values), "journey": _journey(db, ob.tenant_id, ob.uploaded_framework_id),
        "events": _events(db, ob), "catalog_version": ob.catalog_version, "current_catalog_version": catalog.catalog_version(),
    }


def _answer_refs(res: Dict[str, Any], answers: Dict[str, Any]):
    users, assets, vendors, depts = set(), set(), set(), set()
    for st in res["steps"]:
        for f in st["fields"]:
            v = (answers.get(st["key"]) or {}).get(f["key"])
            t = f["type"]
            if t == "person" and isinstance(v, dict) and v.get("user_id"):
                users.add(int(v["user_id"]))
            elif t == "asset_refs" or (t == "org_pick" and f.get("of") == "systems"):
                assets.update(int(i) for i in v or [])
            elif t == "org_pick" and f.get("of") == "departments":
                depts.update(int(i) for i in v or [])
            elif t == "table":
                for r in v or []:
                    for c in f.get("columns") or []:
                        x = r.get(c["key"])
                        if c["type"] == "person" and isinstance(x, dict) and x.get("user_id"):
                            users.add(int(x["user_id"]))
                        elif c["type"] == "asset_refs":
                            assets.update(int(i) for i in x or [])
                        elif c["type"] == "vendor_ref" and x:
                            vendors.add(int(x))
    return users, assets, vendors, depts


def _org_rows(org_values: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    """The profile's rows a scope can pick (entities, sites, third parties, data types), by their ``of`` name, with the id of each."""
    out: Dict[str, List[Dict[str, Any]]] = {}
    for of, ref in catalog.ORG_PICK_SOURCE.items():
        if of in ("systems", "departments"):
            continue
        g, f = ref.split(".")
        out[of] = [r for r in (org_values.get(g) or {}).get(f) or [] if isinstance(r, dict)]
    return out


# --------------------------------------------------------------------------- the register
def register(db: Session, tenant_id: int) -> Dict[str, Any]:
    """GET /framework-onboarding: every library framework of the tenant with its onboarding state. Never writes."""
    from sqlalchemy import or_
    fws = (db.query(UploadedFramework).filter(UploadedFramework.upload_status.in_(AVAILABLE_STATUSES), UploadedFramework.is_active.is_(True),
                                              or_(UploadedFramework.tenant_id == tenant_id, UploadedFramework.is_shared.is_(True)))
           .order_by(UploadedFramework.created_at.desc(), UploadedFramework.id.desc()).all())
    seen: Dict[Any, UploadedFramework] = {}
    for fw in fws:                                   # the Frameworks page dedupes by name and version: so does this
        key = ((fw.name or "").lower().strip(), (fw.version or "").lower().strip())
        cur = seen.get(key)
        if cur is None or STATUS_PRIORITY.get(fw.upload_status or "", 0) > STATUS_PRIORITY.get(cur.upload_status or "", 0):
            seen[key] = fw
    obs = {o.uploaded_framework_id: o for o in db.query(FrameworkOnboarding).filter(FrameworkOnboarding.tenant_id == tenant_id)}
    journeys: Dict[int, Dict[str, Any]] = {}
    for j in db.query(CertificationJourney).filter(CertificationJourney.tenant_id == tenant_id).order_by(CertificationJourney.id):
        if j.uploaded_framework_id:
            journeys[j.uploaded_framework_id] = {"id": j.id, "status": j.status}
    org_values = profile.merged_values(db, tenant_id)
    rows: List[Dict[str, Any]] = []
    for fw in seen.values():
        slug = framework_slug(fw)
        entry = catalog.framework_entry(slug)
        ob = obs.get(fw.id)
        fam = catalog.families().get(entry["family"]) or {}
        row: Dict[str, Any] = {
            "uploaded_framework_id": fw.id, "name": fw.name, "version": fw.version, "slug": slug, "family": entry["family"],
            "family_label": fam.get("label"), "label": entry.get("label") or fw.name, "onboarding_id": ob.id if ob else None,
            "state": ob.state if ob else "not_started", "journey": journeys.get(fw.id),
            "progress": None, "updated_at": _iso(ob.updated_at) if ob else None, "underway": None,
        }
        if ob is not None:
            counts = engine.evaluate(catalog.resolve(ob.framework_slug), ob.answers or {}, org_values)["counts"]
            row["progress"] = {"done": counts["required_ok"], "total": counts["required_total"]}
            if ob.state == "underway":
                row["underway"] = {"kind": ob.underway_kind, "at": _iso(ob.underway_at), "legacy": ob.underway_source == "legacy"}
        rows.append(row)
    rows.sort(key=lambda r: (r["family"] == "general", r["label"] or ""))
    tally = {s: 0 for s in ("not_started",) + STATES}
    for r in rows:
        tally[r["state"]] = tally.get(r["state"], 0) + 1
    return {"frameworks": rows, "counts": tally,
            "meta": {"underway_kinds": UNDERWAY_KINDS, "min_underway_reason": MIN_UNDERWAY_REASON, "min_reopen_reason": MIN_REOPEN_REASON}}


# --------------------------------------------------------------------------- answers
def save_answers(db: Session, ob: FrameworkOnboarding, user: GRCUser, step_key: str, values: Dict[str, Any]) -> Dict[str, Any]:
    res = catalog.resolve(ob.framework_slug)
    step = next((s for s in res["steps"] if s["key"] == step_key), None)
    if step is None:
        raise OnboardingError(422, "This step does not exist for the framework.", errors=[{"field": step_key, "message": "Unknown step."}])
    fields = {f["key"]: f for f in step["fields"]}
    if ob.state == "complete":
        raise OnboardingError(409, "Approved and locked. Reopen it to change it.", locked=[f"{step_key}.{k}" for k in values])
    org_values = profile.merged_values(db, ob.tenant_id)
    kn = profile.known(db, ob.tenant_id, org_values)
    kn.files = files.known(db, ob.tenant_id)
    errors: List[Dict[str, str]] = []
    clean: Dict[str, Any] = {}
    for key, raw in (values or {}).items():
        f = fields.get(key)
        if f is None:
            errors.append({"field": f"{step_key}.{key}", "message": "Unknown field."})
            continue
        try:
            clean[key] = engine.normalise(f, raw, kn)
        except engine.FieldError as e:
            errors.append({"field": f"{step_key}.{key}", "message": str(e)})
    if errors:
        raise OnboardingError(422, "Some answers could not be saved.", errors=errors)
    answers = copy.deepcopy(ob.answers or {})
    bucket = answers.setdefault(step_key, {})
    for k, v in clean.items():
        if v is None or v == []:
            bucket.pop(k, None)
        else:
            bucket[k] = v
    if not bucket:
        answers.pop(step_key, None)
    reverted = ob.state == "ready"
    if reverted:
        ob.state = "draft"
    ob.answers, ob.updated_at = answers, datetime.utcnow()
    _saved_event(db, ob, user.id, step_key, list(clean), reverted)
    db.commit()
    return view(db, ob)


# --------------------------------------------------------------------------- transitions
def submit(db: Session, ob: FrameworkOnboarding, user: GRCUser) -> Dict[str, Any]:
    if ob.state != "draft":
        raise OnboardingError(409, {"ready": "Already submitted. It waits for approval.", "complete": "Already approved.",
                                    "underway": "Marked underway. Approve it when it is ready."}.get(ob.state, "Cannot be submitted now."))
    r = _readiness(db, ob)
    if not r["ready"]:
        raise OnboardingError(422, "Some required answers are open.", checks=engine.unmet(r))
    now = datetime.utcnow()
    ob.state, ob.submitted_by, ob.submitted_at, ob.updated_at = "ready", user.id, now, now
    _event(db, ob, "submitted", user.id)
    db.commit()
    return view(db, ob)


def _snapshot(db: Session, ob: FrameworkOnboarding, org_values: Dict[str, Any]) -> Dict[str, Any]:
    res = catalog.resolve(ob.framework_slug)
    org_rows = _org_rows(org_values)
    picked: Dict[str, List[Dict[str, Any]]] = {}
    for st in res["steps"]:
        for f in st["fields"]:
            if f["type"] == "org_pick" and f.get("of") in org_rows:
                ids = set((ob.answers or {}).get(st["key"], {}).get(f["key"]) or [])
                picked.setdefault(f["of"], [])
                picked[f["of"]].extend(r for r in org_rows[f["of"]] if r.get("id") in ids and r not in picked[f["of"]])
    return {"catalog_version": catalog.catalog_version(), "family": ob.family, "slug": ob.framework_slug,
            "answers": copy.deepcopy(ob.answers or {}), "org_rows": picked, "approved_at": datetime.utcnow().isoformat()}


def approve(db: Session, ob: FrameworkOnboarding, user: GRCUser, note: Optional[str]) -> Dict[str, Any]:
    if ob.state not in ("ready", "underway"):
        raise OnboardingError(409, {"complete": "Already approved."}.get(ob.state, "Submit it for approval first."))
    org_values = profile.merged_values(db, ob.tenant_id)
    r = _readiness(db, ob, org_values)
    if not r["ready"]:
        raise OnboardingError(422, "Some required answers are open.", checks=engine.unmet(r))
    now = datetime.utcnow()
    ob.snapshot = _snapshot(db, ob, org_values)
    ob.state, ob.approved_by, ob.approved_at, ob.approval_note, ob.updated_at = "complete", user.id, now, (note or "").strip()[:1000] or None, now
    ob.catalog_version = catalog.catalog_version()
    _event(db, ob, "approved", user.id, {"note": ob.approval_note} if ob.approval_note else {})
    db.commit()
    return view(db, ob)


def reopen(db: Session, ob: FrameworkOnboarding, user: GRCUser, reason: str) -> Dict[str, Any]:
    reason = (reason or "").strip()
    if ob.state not in ("complete", "ready"):
        raise OnboardingError(409, "Only an approved or submitted onboarding can be reopened.")
    if len(reason) < MIN_REOPEN_REASON:
        raise OnboardingError(422, f"Say why in at least {MIN_REOPEN_REASON} characters.", errors=[{"field": "reason", "message": "Too short."}])
    was = ob.state
    ob.state, ob.approved_by, ob.approved_at, ob.updated_at = "draft", None, None, datetime.utcnow()
    ob.reopened_count = (ob.reopened_count or 0) + 1
    _event(db, ob, "reopened", user.id, {"reason": reason[:1000], "from": was})
    db.commit()
    return view(db, ob)


def mark_underway(db: Session, ob: FrameworkOnboarding, user: GRCUser, kind: str, reason: str) -> Dict[str, Any]:
    reason = (reason or "").strip()
    if ob.state not in ("draft", "ready"):
        raise OnboardingError(409, {"complete": "Already approved.", "underway": "Already marked underway."}.get(ob.state, "Cannot be marked underway now."))
    errors = []
    if kind not in UNDERWAY_KINDS:
        errors.append({"field": "kind", "message": "Choose one of the listed reasons."})
    if len(reason) < MIN_UNDERWAY_REASON:
        errors.append({"field": "reason", "message": f"Say why in at least {MIN_UNDERWAY_REASON} characters."})
    if errors:
        raise OnboardingError(422, "Mark underway needs a reason.", errors=errors)
    now = datetime.utcnow()
    ob.state, ob.underway_kind, ob.underway_reason, ob.underway_by, ob.underway_at, ob.underway_source, ob.updated_at = \
        "underway", kind, reason[:2000], user.id, now, "manual", now
    _event(db, ob, "marked_underway", user.id, {"kind": kind, "reason": ob.underway_reason})
    db.commit()
    return view(db, ob)


# --------------------------------------------------------------------------- legacy
def backfill_legacy(db: Session) -> int:
    """Every journey that exists without an onboarding gets one marked underway (source legacy): nothing running is ever blocked.
    Additive and idempotent; two processes racing both succeed (the loser's rows violate the unique key and are dropped)."""
    have = {(t, f) for t, f in db.query(FrameworkOnboarding.tenant_id, FrameworkOnboarding.uploaded_framework_id)}
    made = 0
    now = datetime.utcnow()
    fws = {f.id: f for f in db.query(UploadedFramework).filter(UploadedFramework.id.in_(
        [j.uploaded_framework_id for j in db.query(CertificationJourney.uploaded_framework_id).filter(CertificationJourney.uploaded_framework_id.isnot(None))] or [0]))}
    for j in db.query(CertificationJourney).filter(CertificationJourney.uploaded_framework_id.isnot(None)).order_by(CertificationJourney.id):
        key = (j.tenant_id, j.uploaded_framework_id)
        fw = fws.get(j.uploaded_framework_id)
        if key in have or fw is None:
            continue
        have.add(key)
        slug = framework_slug(fw)
        ob = FrameworkOnboarding(tenant_id=j.tenant_id, uploaded_framework_id=j.uploaded_framework_id, framework_slug=slug,
                                 family=catalog.family_key_for_slug(slug), catalog_version=catalog.catalog_version(), state="underway", answers={},
                                 underway_kind=UNDERWAY_KINDS[0], underway_reason=LEGACY_REASON, underway_at=now, underway_source="legacy",
                                 created_at=now, updated_at=now)
        db.add(ob)
        db.flush()
        _event(db, ob, "marked_underway", None, {"kind": ob.underway_kind, "reason": LEGACY_REASON, "source": "legacy"})
        made += 1
    if made:
        try:
            db.commit()
        except IntegrityError:
            db.rollback()                       # another process did it first
            return 0
    return made
