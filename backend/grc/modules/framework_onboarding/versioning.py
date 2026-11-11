"""Framework version management for an onboarding (design: ``docs/framework-version-management.md``).

An approved (or underway) onboarding is settled against a BASELINE: the framework version the library held, the control texts, the shape of the questions and
the version in use. When any of those change, ``status`` says exactly what: which answers and applicability decisions are now stale and why, which questions are
new, which controls changed and which journeys, implementations and evidence sit on them. ``check`` notifies the program owner once per change. Nothing here
rewrites an answer, the approved snapshot, an assessment or evidence: a change flags and asks, and a person's review is recorded as an event.

``status`` only reads (a GET never writes). ``take_baseline``, ``check`` and ``review`` write and leave the commit to the caller or do it themselves, as noted.
"""
from __future__ import annotations

import copy
import hashlib
import json
import logging
from collections import Counter
from datetime import datetime
from typing import Any, Dict, List, Optional, Set, Tuple

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ...models import (CertificationJourney, ComplianceSnapshot, ControlImplementation, FrameworkOnboarding, FrameworkOnboardingEvent, FrameworkVersionBaseline,
                       GRCUser, ImplementationEvidence, ParsedFrameworkControl, UploadedFramework)
from ..scf.registry import slug_for_framework
from . import catalog, engine, profile
from .errors import OnboardingError

logger = logging.getLogger(__name__)

TRACKED = ("complete", "underway")            # states whose answers are settled: a change to the framework matters to them
OUTCOMES = ("confirmed", "changes_needed", "start_new_version")
MIN_NOTE = 10
SAMPLE = 15                                  # controls named per kind (added, removed, changed)
HISTORY = 20
AVAILABLE_STATUSES = ["published", "completed", "parsed", "classified"]

TYPE_WORDS = {
    "text": "text", "longtext": "text", "number": "a number", "date": "a date", "bool": "yes or no", "choice": "one choice", "multichoice": "several choices",
    "person": "a person", "country": "a country", "countries": "countries", "table": "a list of rows", "asset_refs": "systems", "vendor_ref": "a vendor",
    "org_pick": "a pick from the organisation", "departments_derived": "departments", "files": "files", "existing": "existing work",
}


def _now() -> datetime:
    return datetime.utcnow()


def _iso(d: Optional[datetime]) -> Optional[str]:
    return d.isoformat() if d else None


def _h(obj: Any) -> str:
    return hashlib.sha1(json.dumps(obj, sort_keys=True, default=str, ensure_ascii=False).encode("utf-8")).hexdigest()[:12]


def _empty(v: Any) -> bool:
    return v is None or v == "" or v == [] or v == {}


def event(db: Session, ob: FrameworkOnboarding, kind: str, actor: Optional[int], detail: Optional[Dict[str, Any]] = None) -> None:
    db.add(FrameworkOnboardingEvent(onboarding_id=ob.id, tenant_id=ob.tenant_id, kind=kind, actor_id=actor, detail=detail or {}, created_at=_now()))


# --------------------------------------------------------------------------- the shape of the questions
def signature(resolved: Dict[str, Any]) -> Dict[str, Any]:
    """The questions a framework asks, reduced to what an answer depends on: per ``step.field`` its label, type, level, options, ``when`` and list shape; per gate
    check its level, ``when`` and test; the versions the entry names."""
    fields: Dict[str, Any] = {}
    for st in resolved["steps"]:
        for f in st["fields"]:
            s: Dict[str, Any] = {"label": f["label"], "step": st["key"], "step_label": st["label"], "type": f["type"], "level": f["level"]}
            for k in ("options", "when", "min_rows", "min", "max", "of"):
                if k in f:
                    s[k] = copy.deepcopy(f[k])
            if f.get("columns"):
                s["columns"] = [{"key": c["key"], "type": c["type"], "required": bool(c.get("required")), **({"options": c["options"]} if c.get("options") else {})}
                                for c in f["columns"]]
            fields[f"{st['key']}.{f['key']}"] = s
    gate = {g["key"]: {"label": g["label"], "level": g["level"], "when": g.get("when"), "check": g["check"]} for g in resolved.get("gate") or []}
    vs = resolved.get("versions") or {}
    return {"fields": fields, "gate": gate, "versions": [{"key": i["key"], "label": i["label"]} for i in vs.get("list") or []], "version_answer": vs.get("answer")}


_SHAPE = ("columns", "min_rows", "min", "max", "of")


def diff(old: Dict[str, Any], new: Dict[str, Any]) -> Dict[str, List[Any]]:
    """What changed between two signatures. An option list is changed only when its SET changed (a reordering is not a change)."""
    out: Dict[str, List[Any]] = {"removed": [], "added": [], "type": [], "options": [], "when": [], "level": [], "shape": [], "gate": []}
    of, nf = old.get("fields") or {}, new.get("fields") or {}
    for ref, o in of.items():
        n = nf.get(ref)
        if n is None:
            out["removed"].append(ref)
            continue
        if o["type"] != n["type"]:
            out["type"].append({"ref": ref, "from": o["type"], "to": n["type"]})
        oo, no = o.get("options") or [], n.get("options") or []
        if set(oo) != set(no):
            out["options"].append({"ref": ref, "removed": [x for x in oo if x not in no], "added": [x for x in no if x not in oo]})
        if (o.get("when") or None) != (n.get("when") or None):
            out["when"].append({"ref": ref, "from": o.get("when"), "to": n.get("when")})
        if o["level"] != n["level"]:
            out["level"].append({"ref": ref, "from": o["level"], "to": n["level"]})
        if any(o.get(k) != n.get(k) for k in _SHAPE):
            out["shape"].append({"ref": ref})
    out["added"] = [r for r in nf if r not in of]
    og, ng = old.get("gate") or {}, new.get("gate") or {}
    for k in sorted(set(og) | set(ng)):
        if k not in og:
            out["gate"].append({"key": k, "label": ng[k]["label"], "change": "added"})
        elif k not in ng:
            out["gate"].append({"key": k, "label": og[k]["label"], "change": "removed"})
        elif og[k] != ng[k]:
            out["gate"].append({"key": k, "label": ng[k]["label"], "change": "changed"})
    return out


# --------------------------------------------------------------------------- words (rule U1: names and plain sentences, never ids or codes)
def _say(v: Any) -> str:
    """An answer as a short phrase."""
    if isinstance(v, bool):
        return "Yes" if v else "No"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, str):
        return v if len(v) <= 80 else v[:77] + "..."
    if isinstance(v, list):
        if v and all(isinstance(x, str) for x in v):
            return ", ".join(v[:3]) + (f" and {len(v) - 3} more" if len(v) > 3 else "")
        return f"{len(v)} item{'s' if len(v) != 1 else ''}"
    return "Answered"


def _vlabel(sig: Dict[str, Any], key: Optional[str]) -> Optional[str]:
    return next((v["label"] for v in sig.get("versions") or [] if v["key"] == key), None)


def _when_words(when: Optional[Dict[str, Any]], sig: Dict[str, Any]) -> str:
    """A ``when`` as a sentence, for the answer it now hides."""
    if not when:
        return "always asked"
    ref = when["field"]
    if ref == catalog.FW_VERSION:
        subject, fmt = "the framework version", (lambda x: _vlabel(sig, x) or str(x))
    else:
        subject, fmt = (sig["fields"].get(ref) or {}).get("label") or ref, _say
    if "eq" in when:
        return f"asked only when {subject} is {fmt(when['eq'])}"
    if "ne" in when:
        return f"asked only when {subject} is not {fmt(when['ne'])}"
    if "in" in when:
        return f"asked only when {subject} is {' or '.join(str(fmt(x)) for x in when['in'])}"
    if "includes" in when:
        return f"asked only when {subject} includes {fmt(when['includes'])}"
    if "truthy" in when:
        return f"asked only when {subject} is {'answered' if when['truthy'] else 'not answered'}"
    return "asked under a condition"


# --------------------------------------------------------------------------- what is stale
def _visibility(sig: Dict[str, Any], answers: Dict[str, Any], org_values: Dict[str, Any], key: Optional[str]) -> Dict[str, bool]:
    """Which questions are asked under a signature, with the answers as they stand, the organisation profile as it stands and the version in use ``key``."""
    fields = sig["fields"]
    look = engine.make_lookup(fields, answers, catalog.profile_fields(), org_values, fw_version=key)
    visible = engine.make_visible(fields, look)
    return {ref: visible(ref) for ref in fields}


def _drivers(old: Dict[str, Any], new: Dict[str, Any]) -> Set[str]:
    """The questions other questions depend on (a ``when`` reads them), plus everything in the common Applicability step: the applicability decisions."""
    out: Set[str] = set()
    for sig in (old, new):
        for f in sig["fields"].values():
            w = f.get("when")
            if w and w["field"] != catalog.FW_VERSION and not w["field"].startswith("org."):
                out.add(w["field"])
        for g in sig["gate"].values():
            w = g.get("when")
            if w and w["field"] != catalog.FW_VERSION and not w["field"].startswith("org."):
                out.add(w["field"])
        out.update(ref for ref, f in sig["fields"].items() if f.get("step") == "applicability")
    return out


def stale(answers: Dict[str, Any], old: Dict[str, Any], new: Dict[str, Any], org_values: Dict[str, Any], old_key: Optional[str], new_key: Optional[str],
          declared: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """The answers and decisions a change to the questions makes stale, and the questions it adds. Exact, from the two signatures and the answers as they stand:

    * an answer is stale when its question was removed, its kind of answer changed, a chosen option is no longer offered, or the question is no longer asked
      because its ``when`` no longer holds (the new condition is given in words);
    * a decision (an answer other questions or the Applicability step depend on) is stale when it is itself stale in that sense, or when the same answer now asks
      different questions (the ones that appear or disappear are listed); the framework version in use is a decision too, and so is a declared version the library
      no longer matches (``declared``);
    * a new question is asked now, was not before and has no answer."""
    fo, fn = old["fields"], new["fields"]
    vo, vn = _visibility(old, answers, org_values, old_key), _visibility(new, answers, org_values, new_key)
    answered: Dict[str, Any] = {}
    for step, vals in (answers or {}).items():
        for k, v in (vals or {}).items():
            if not _empty(v):
                answered[f"{step}.{k}"] = v
    rows: List[Dict[str, Any]] = []
    by_ref: Dict[str, Dict[str, Any]] = {}
    for ref, v in answered.items():
        o, n = fo.get(ref), fn.get(ref)
        if o is None and n is None:
            continue                                      # kept from an older catalog than the baseline: never asked under this approval
        src = n or o
        reasons: List[Dict[str, str]] = []
        if n is None:
            reasons.append({"code": "removed", "text": "This question is not asked any more."})
        else:
            if o is not None and o["type"] != n["type"]:
                reasons.append({"code": "type", "text": f"The answer is now {TYPE_WORDS.get(n['type'], n['type'])}, it was {TYPE_WORDS.get(o['type'], o['type'])}."})
            if n["type"] in ("choice", "multichoice") and n.get("options"):
                gone = [x for x in (v if isinstance(v, list) else [v]) if isinstance(x, str) and x not in n["options"]]
                if gone:
                    reasons.append({"code": "option", "text": f"{', '.join(gone)} is no longer one of the choices." if len(gone) == 1
                                    else f"{', '.join(gone)} are no longer among the choices."})
            if o is not None and vo.get(ref) and not vn.get(ref):
                reasons.append({"code": "not_asked", "text": f"No longer asked: {_when_words(n.get('when'), new)}."})
        if reasons:
            row = {"ref": ref, "step": src["step"], "step_label": src["step_label"], "label": src["label"], "answer": _say(v), "reasons": reasons}
            rows.append(row)
            by_ref[ref] = row
    decisions: List[Dict[str, Any]] = []
    flips: Dict[str, List[Dict[str, Any]]] = {}
    for ref in set(fo) & set(fn):
        if vo.get(ref) == vn.get(ref):
            continue
        w = fn[ref].get("when") or fo[ref].get("when")
        if not w:
            continue
        flips.setdefault(w["field"], []).append({"ref": ref, "label": fn[ref]["label"], "now": "asked" if vn.get(ref) else "not asked", "answered": ref in answered})
    for ref in sorted(_drivers(old, new)):
        if ref not in answered:
            continue
        got = by_ref.get(ref)
        aff = flips.get(ref, [])
        src = fn.get(ref) or fo.get(ref)
        if src is not None and (got or aff):
            decisions.append({"ref": ref, "step": src["step"], "step_label": src["step_label"], "label": src["label"], "answer": _say(answered[ref]),
                              "reasons": list(got["reasons"]) if got else [{"code": "asks_differently", "text": "The same answer now asks different questions."}],
                              "affects": aff})
    if old_key != new_key:
        decisions.append({"ref": catalog.FW_VERSION, "step": None, "step_label": None, "label": "Framework version", "answer": _vlabel(new, new_key) or "Not known",
                          "reasons": [{"code": "version", "text": f"The version in use changed from {_vlabel(old, old_key) or 'not known'} to {_vlabel(new, new_key) or 'not known'}."}],
                          "affects": flips.get(catalog.FW_VERSION, [])})
    if declared:
        decisions.append({"ref": declared["ref"], "step": None, "step_label": None, "label": declared["label"], "answer": declared["answer"],
                          "reasons": [{"code": "declared_differs", "text": declared["text"]}], "affects": []})
    new_q: List[Dict[str, Any]] = []
    for ref, n in fn.items():
        if n["level"] not in ("required", "advised") or n["type"] == "existing" or not vn.get(ref) or ref in answered:
            continue
        if ref in fo and vo.get(ref):
            continue
        new_q.append({"ref": ref, "step": n["step"], "step_label": n["step_label"], "label": n["label"], "level": n["level"],
                      "why": "New question." if ref not in fo else f"Now asked: {_when_words(n.get('when'), new).replace('asked only when', 'it applies when', 1)}."})
    new_q.sort(key=lambda q: (q["level"] != "required", q["step_label"] or "", q["label"]))
    return {"answers": rows, "decisions": decisions, "new_questions": new_q}


# --------------------------------------------------------------------------- the library side
def _same_framework(a: UploadedFramework, b: UploadedFramework) -> bool:
    sa, sb = slug_for_framework(a.name, slug=a.slug), slug_for_framework(b.name, slug=b.slug)
    if sa and sb:
        return sa == sb
    return (a.name or "").strip().lower() == (b.name or "").strip().lower()


def successor_of(db: Session, tenant_id: int, fw: UploadedFramework) -> Optional[UploadedFramework]:
    """The newest ACTIVE library row of the same framework that took over from ``fw``: a row created after it, or any when ``fw`` itself was deactivated
    (the library re-seeds a framework by deactivating the old row and adding a new one). The journeys and the onboarding stay on the old row."""
    rows = (db.query(UploadedFramework).filter(UploadedFramework.id != fw.id, UploadedFramework.is_active.is_(True),
                                               UploadedFramework.upload_status.in_(AVAILABLE_STATUSES),
                                               or_(UploadedFramework.tenant_id == tenant_id, UploadedFramework.is_shared.is_(True)))
            .order_by(UploadedFramework.created_at.desc(), UploadedFramework.id.desc()).all())
    for r in rows:
        if _same_framework(fw, r) and (not fw.is_active or (r.created_at and fw.created_at and r.created_at > fw.created_at)):
            return r
    return None


def controls_of(db: Session, framework_id: Optional[int]) -> Dict[str, str]:
    """{control id: short hash of its title and text} of a library row. Controls keep the library's own ids; a repeated id is numbered."""
    if not framework_id:
        return {}
    out: Dict[str, str] = {}
    for cid, title, full, desc in (db.query(ParsedFrameworkControl.control_id, ParsedFrameworkControl.title, ParsedFrameworkControl.full_text,
                                            ParsedFrameworkControl.description).filter(ParsedFrameworkControl.uploaded_framework_id == framework_id)
                                   .order_by(ParsedFrameworkControl.id)):
        k, i = str(cid), 1
        while k in out:
            i += 1
            k = f"{cid}#{i}"
        out[k] = _h([title or "", full or desc or ""])
    return out


def controls_diff(old: Dict[str, str], new: Dict[str, str]) -> Dict[str, List[str]]:
    return {"added": sorted(k for k in new if k not in old), "removed": sorted(k for k in old if k not in new),
            "changed": sorted(k for k in new if k in old and new[k] != old[k])}


def _control_names(db: Session, framework_id: Optional[int], ids: List[str]) -> List[Dict[str, str]]:
    """The people-facing name of controls: the library's clause reference and title."""
    if not framework_id or not ids:
        return []
    raw = {i.split("#")[0] for i in ids}
    rows = {r[0]: r for r in db.query(ParsedFrameworkControl.control_id, ParsedFrameworkControl.original_reference, ParsedFrameworkControl.title)
            .filter(ParsedFrameworkControl.uploaded_framework_id == framework_id, ParsedFrameworkControl.control_id.in_(raw))}
    out = []
    for i in ids[:SAMPLE]:
        r = rows.get(i.split("#")[0])
        out.append({"reference": (r[1] or r[0]) if r else i, "title": (r[2] if r else "") or ""})
    return out


def _fw(db: Session, framework_id: Optional[int]) -> Optional[UploadedFramework]:
    return db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first() if framework_id else None


def library_version(db: Session, ob: FrameworkOnboarding) -> Optional[str]:
    """The version text the library row of this onboarding holds (what ``fw.version`` is matched against)."""
    fw = _fw(db, ob.uploaded_framework_id)
    return fw.version if fw else None


# --------------------------------------------------------------------------- the baseline
def baseline_of(db: Session, ob: FrameworkOnboarding) -> Optional[FrameworkVersionBaseline]:
    return db.query(FrameworkVersionBaseline).filter(FrameworkVersionBaseline.onboarding_id == ob.id, FrameworkVersionBaseline.tenant_id == ob.tenant_id).first()


def tracked(ob: FrameworkOnboarding, base: Optional[FrameworkVersionBaseline]) -> bool:
    """A settled onboarding is tracked; so is one reopened to change after a version review, until it is approved again."""
    return ob.state in TRACKED or (base is not None and base.review_state == "changes_needed")


def _declared(res: Dict[str, Any], answers: Dict[str, Any]) -> Optional[str]:
    vs = res.get("versions") or {}
    step, _, key = (vs.get("answer") or "").partition(".")
    v = (answers.get(step) or {}).get(key) if step else None
    return v if isinstance(v, str) and v else None


def take_baseline(db: Session, ob: FrameworkOnboarding, source: str, actor: Optional[int] = None, fw: Optional[UploadedFramework] = None) -> FrameworkVersionBaseline:
    """Measure the onboarding as it stands against the library row ``fw`` (its own row by default). The earlier baseline, if any, goes to ``history``. The caller commits."""
    fw = fw or _fw(db, ob.uploaded_framework_id)
    res = catalog.resolve(ob.framework_slug)
    lib = fw.version if fw else None
    answers = ob.answers or {}
    cm = controls_of(db, fw.id if fw else None)
    row = baseline_of(db, ob)
    hist: List[Dict[str, Any]] = []
    if row is None:
        row = FrameworkVersionBaseline(tenant_id=ob.tenant_id, onboarding_id=ob.id)
        db.add(row)
    else:
        hist = list(row.history or [])
        hist.append({"taken_at": _iso(row.taken_at), "source": row.source, "library_version": row.library_version, "version_key": row.version_key, "framework_id": row.framework_id})
    row.framework_id, row.framework_name = (fw.id if fw else None), (fw.name if fw else None)
    row.library_version = (lib or "")[:60] or None
    row.library_key = engine.version_key_of(res, {}, lib)
    row.version_key = engine.version_key_of(res, answers, lib)
    row.declared_answer = (_declared(res, answers) or "")[:120] or None
    row.catalog_version = catalog.catalog_version()
    row.signature, row.controls, row.controls_count = signature(res), cm, len(cm)
    row.source, row.taken_by, row.taken_at = source, actor, _now()
    row.history = hist[-HISTORY:]
    row.notified_change_id = row.notified_at = None
    row.last_check, row.review_state, row.successor_onboarding_id = {"at": _iso(_now()), "state": "current", "reasons": [], "counts": {}}, None, None
    return row


# --------------------------------------------------------------------------- status (reads only)
def _impact(db: Session, ob: FrameworkOnboarding, base: FrameworkVersionBaseline, delta: Dict[str, List[str]]) -> Dict[str, Any]:
    """The compliance programs on the framework and how much of their work sits on controls that were removed or reworded. Reads; nothing is changed by a version change."""
    hit_ids = {i.split("#")[0] for i in delta["removed"] + delta["changed"]}
    ids = {i for i in (ob.uploaded_framework_id, base.framework_id) if i}
    journeys = (db.query(CertificationJourney).filter(CertificationJourney.tenant_id == ob.tenant_id, CertificationJourney.uploaded_framework_id.in_(ids))
                .order_by(CertificationJourney.id).all()) if ids else []
    out: List[Dict[str, Any]] = []
    kept_snapshots = kept_evidence = 0
    for j in journeys:
        impls = (db.query(ControlImplementation, ParsedFrameworkControl.control_id).join(ParsedFrameworkControl, ControlImplementation.parsed_control_id == ParsedFrameworkControl.id)
                 .filter(ControlImplementation.journey_id == j.id).all())
        hit = [i for i, cid in impls if str(cid) in hit_ids]
        evidence = (db.query(func.count(ImplementationEvidence.id)).filter(ImplementationEvidence.implementation_id.in_([i.id for i in hit])).scalar() or 0) if hit else 0
        all_ev = (db.query(func.count(ImplementationEvidence.id)).filter(ImplementationEvidence.implementation_id.in_([i.id for i, _ in impls])).scalar() or 0) if impls else 0
        snaps = db.query(func.count(ComplianceSnapshot.id)).filter(ComplianceSnapshot.journey_id == j.id).scalar() or 0
        kept_snapshots += snaps
        kept_evidence += all_ev
        out.append({"id": j.id, "name": j.name, "status": j.status, "controls": len(impls), "affected": len(hit), "by_status": dict(Counter((i.status or "not_started") for i in hit)),
                    "evidence_files": evidence})
    return {"journeys": out, "kept": {"snapshots": kept_snapshots, "evidence_files": kept_evidence}, "changed": False}


def _library_words(version: Optional[str]) -> str:
    return version if version else "not stated"


def status(db: Session, ob: FrameworkOnboarding, deep: bool = True, org_values: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Where the onboarding stands against what it was settled on. ``state``: not_tracked (a draft or ready one), current, needs_review, superseded.
    Reads only. ``deep`` adds the controls by name and the impact; the answer is the same either way."""
    base = baseline_of(db, ob)
    out: Dict[str, Any] = {"state": "not_tracked", "tracking": None, "now": None, "successor": None, "reasons": [], "stale": {"answers": [], "decisions": [], "new_questions": [], "gate": []},
                           "controls": {"added": 0, "removed": 0, "changed": 0, "sample": {"added": [], "removed": [], "changed": []}}, "impact": None, "counts": {},
                           "minor": [], "change_id": None, "checked_at": None, "review_state": base.review_state if base else None}
    if not tracked(ob, base):
        return out
    own = _fw(db, ob.uploaded_framework_id)
    succ = successor_of(db, ob.tenant_id, own) if own else None
    cur = succ or own
    res = catalog.resolve(ob.framework_slug)
    sig_now = signature(res)
    lib_now = cur.version if cur else None
    out["now"] = {"library_version": lib_now, "version": _vlabel(sig_now, engine.version_key_of(res, {}, lib_now)) or lib_now, "framework": cur.name if cur else None,
                  "retired": bool(own and not own.is_active and succ is None)}
    if succ is not None:
        out["successor"] = {"framework_id": succ.id, "name": succ.name, "version": succ.version,
                            "onboarding_id": base.successor_onboarding_id if base else None}
    if base is None:                                       # settled before tracking began: the first check takes the starting point
        out["state"] = "current"
        out["tracking"] = {"since": None, "source": None, "version": out["now"]["version"], "pending": True}
        return out
    out["checked_at"] = (base.last_check or {}).get("at")
    sig_old = base.signature or {"fields": {}, "gate": {}, "versions": []}
    out["tracking"] = {"since": _iso(base.taken_at), "source": base.source, "version": _vlabel(sig_old, base.version_key) or base.library_version, "pending": False}
    if base.review_state == "migrated":
        out["state"] = "superseded"
        out["successor"] = out["successor"] or {"framework_id": None, "name": None, "version": None, "onboarding_id": base.successor_onboarding_id}
        out["successor"]["onboarding_id"] = base.successor_onboarding_id
        return out
    org_values = org_values if org_values is not None else profile.merged_values(db, ob.tenant_id)
    answers = ob.answers or {}
    key_now, lkey_now = engine.version_key_of(res, answers, lib_now), engine.version_key_of(res, {}, lib_now)
    reasons: List[Dict[str, str]] = []
    # 1. the library
    if succ is not None and succ.id != base.framework_id:
        reasons.append({"code": "replaced", "text": (f"The library replaced this entry with a newer one (version {_library_words(succ.version)})." if own is not None and not own.is_active
                                                     else f"The library has a later entry for this framework (version {_library_words(succ.version)}).")})
    elif own is not None and not own.is_active and succ is None:
        reasons.append({"code": "retired", "text": "This framework is no longer active in the library."})
    if catalog._vnorm(lib_now) != catalog._vnorm(base.library_version):
        reasons.append({"code": "library_version", "text": f"The library version changed from {_library_words(base.library_version)} to {_library_words(lib_now)}."})
    # 2. the controls
    cm = controls_of(db, cur.id if cur else None)
    delta = controls_diff(base.controls or {}, cm)
    n_add, n_rem, n_chg = len(delta["added"]), len(delta["removed"]), len(delta["changed"])
    out["controls"].update(added=n_add, removed=n_rem, changed=n_chg)
    if n_add or n_rem or n_chg:
        parts = [f"{n} {w}" for n, w in ((n_add, "added"), (n_rem, "removed"), (n_chg, "reworded")) if n]
        reasons.append({"code": "controls", "text": f"Controls changed: {', '.join(parts)}."})
        if deep:
            out["controls"]["sample"] = {"added": _control_names(db, cur.id if cur else None, delta["added"]),
                                         "removed": _control_names(db, base.framework_id, delta["removed"]),
                                         "changed": _control_names(db, cur.id if cur else None, delta["changed"])}
    # 3. the questions, and what they make stale
    dq = diff(sig_old, sig_now)
    declared = None
    ver = res.get("versions") or {}
    answered_key = catalog.version_key(ver, _declared(res, answers), None) if ver else None
    if ver and answered_key and base.library_key != lkey_now and catalog._vnorm(lib_now) != catalog._vnorm(base.library_version) and answered_key != lkey_now:
        label = (sig_now["fields"].get(ver.get("answer") or "") or {}).get("label") or "Version"
        declared = {"ref": ver.get("answer"), "label": label, "answer": _declared(res, answers) or "",
                    "text": f"The answer says {_declared(res, answers)}; the library now holds {_vlabel(sig_now, lkey_now) or lib_now or 'a version this onboarding does not list'}."}
    st = stale(answers, sig_old, sig_now, org_values, base.version_key, key_now, declared)
    st["gate"] = [{"label": g["label"], "text": {"added": "A check was added.", "removed": "A check was removed.", "changed": "A check changed."}[g["change"]]} for g in dq["gate"]]
    out["stale"] = st
    new_required = [q for q in st["new_questions"] if q["level"] == "required"]
    material = bool(st["answers"] or st["decisions"] or new_required or st["gate"])
    n_chg_q = sum(len(dq[k]) for k in ("removed", "added", "type", "options", "when", "level", "shape", "gate"))
    if material and n_chg_q:
        reasons.append({"code": "questions", "text": f"The questions this framework asks changed ({n_chg_q} change{'s' if n_chg_q != 1 else ''})."})
    elif n_chg_q:                                          # only what never makes an answer stale: new advised questions, options added, wording
        out["minor"] = [f"{len(st['new_questions'])} new advised question{'s' if len(st['new_questions']) != 1 else ''}."] if st["new_questions"] else ["Small wording or option changes."]
    if base.version_key != key_now:
        reasons.append({"code": "version_in_use", "text": f"The version in use changed from {_vlabel(sig_old, base.version_key) or 'not known'} to {_vlabel(sig_now, key_now) or 'not known'}."})
    out["reasons"] = reasons
    out["counts"] = {"answers": len(st["answers"]), "decisions": len(st["decisions"]), "new_questions": len(st["new_questions"]), "new_required": len(new_required),
                     "gate": len(st["gate"]), "controls_added": n_add, "controls_removed": n_rem, "controls_changed": n_chg}
    if reasons:
        out["state"] = "needs_review"
        out["change_id"] = _h({"lib": catalog._vnorm(lib_now), "cur": cur.id if cur else None, "retired": out["now"]["retired"], "ctl": delta,
                               "q": {k: v for k, v in dq.items()}, "key": key_now})
        if deep:
            out["impact"] = _impact(db, ob, base, delta)
    else:
        out["state"] = "current"
    return out


# --------------------------------------------------------------------------- who is told, and the check
def program_owners(db: Session, ob: FrameworkOnboarding) -> List[int]:
    """The platform users who own this onboarding's program: the owner, the coordinator and the approver it names; when none of them is a platform user, the people
    who started and approved it. External people cannot be notified in the platform."""
    a = (ob.answers or {}).get("ownership") or {}
    ids: List[int] = []
    for k in ("owner", "coordinator", "approver"):
        p = a.get(k)
        if isinstance(p, dict) and p.get("user_id"):
            ids.append(int(p["user_id"]))
    if not ids:
        ids = [int(x) for x in (ob.approved_by, ob.submitted_by, ob.created_by) if x]
    return list(dict.fromkeys(ids))


def _names(db: Session, ids: List[int]) -> List[str]:
    rows = db.query(GRCUser.id, GRCUser.display_name, GRCUser.username).filter(GRCUser.id.in_(ids)).all() if ids else []
    return [d or u for _i, d, u in rows]


def notify_owner(db: Session, ob: FrameworkOnboarding, st: Dict[str, Any]) -> List[str]:
    """One in-app notification (and an email when the organisation's email is set up) to each program owner. Returns who was told, by name. Never raises."""
    ids = program_owners(db, ob)
    if not ids:
        return []
    label = catalog.framework_entry(ob.framework_slug).get("label") or (st.get("now") or {}).get("framework") or "A framework"
    reasons = " ".join(r["text"] for r in st["reasons"][:3])
    try:
        from ..workflow_engine.services.notification_service import send_workflow_notification

        out = send_workflow_notification(db, tenant_id=ob.tenant_id, subject=f"{label}: its onboarding needs a review"[:500],
                                         message=f"{reasons} The approved answers were not changed. Open the onboarding to see what is affected and decide what to do.",
                                         workflow_instance_id=None, user_ids=ids, notification_type="warning", link=f"/frameworks/onboarding/{ob.id}")
        told = [r["user_id"] for r in (out or {}).get("results") or []]
        return _names(db, told)
    except Exception:       # noqa: BLE001 - a failed alert must not stop the check
        logger.exception("framework version: could not notify the owners of onboarding %s", ob.id)
        return []


def check(db: Session, tenant_id: int, actor: Optional[int] = None) -> Dict[str, int]:
    """Measure every settled onboarding of the tenant. Idempotent: one without a baseline gets one (tracking starts now, no change can be reported for what happened
    before); one that needs review is recorded, and its program owner told ONCE per distinct change. Commits."""
    out = {"checked": 0, "started": 0, "needs_review": 0, "notified": 0}
    org_values = profile.merged_values(db, tenant_id)
    obs = db.query(FrameworkOnboarding).filter(FrameworkOnboarding.tenant_id == tenant_id).order_by(FrameworkOnboarding.id).all()
    for ob in obs:
        base = baseline_of(db, ob)
        if not tracked(ob, base):
            continue
        out["checked"] += 1
        if base is None:                                  # how things stand now is the starting point: what was already so is not reported as a change
            own = _fw(db, ob.uploaded_framework_id)
            row = take_baseline(db, ob, "first_check", actor, (successor_of(db, tenant_id, own) if own else None) or own)
            event(db, ob, "tracking_started", actor, {"version": row.library_version})
            out["started"] += 1
            continue
        st = status(db, ob, deep=False, org_values=org_values)
        base.last_check = {"at": _iso(_now()), "state": st["state"], "reasons": [r["text"] for r in st["reasons"]], "counts": st["counts"]}
        if st["state"] != "needs_review":
            continue
        out["needs_review"] += 1
        if st["change_id"] != base.notified_change_id:
            # claim this change first, in one statement: two processes checking at once (every worker checks at start) tell the owner once
            won = (db.query(FrameworkVersionBaseline).filter(FrameworkVersionBaseline.id == base.id,
                                                              or_(FrameworkVersionBaseline.notified_change_id.is_(None), FrameworkVersionBaseline.notified_change_id != st["change_id"]))
                   .update({"notified_change_id": st["change_id"], "notified_at": _now()}, synchronize_session=False))
            db.commit()
            if won:
                told = notify_owner(db, ob, st)
                event(db, ob, "version_change", actor, {"reasons": [r["text"] for r in st["reasons"]], "counts": st["counts"], "told": told, "nobody_told": not told})
                out["notified"] += 1
    db.commit()
    return out


def check_all(db: Session) -> Dict[str, int]:
    """``check`` for every organisation that has an onboarding in this database (what the start-up check runs)."""
    total = {"checked": 0, "started": 0, "needs_review": 0, "notified": 0}
    for (tid,) in db.query(FrameworkOnboarding.tenant_id).distinct().all():
        for k, v in check(db, tid).items():
            total[k] += v
    return total


# --------------------------------------------------------------------------- review
def review_note(note: Optional[str]) -> str:
    note = (note or "").strip()
    if len(note) < MIN_NOTE:
        raise OnboardingError(422, f"Say why in at least {MIN_NOTE} characters.", errors=[{"field": "note", "message": "Too short."}])
    return note[:1000]


def require_needs_review(db: Session, ob: FrameworkOnboarding) -> Dict[str, Any]:
    st = status(db, ob, deep=True)
    if st["state"] != "needs_review":
        raise OnboardingError(409, {"superseded": "A newer onboarding has taken over from this one.", "not_tracked": "Only an approved onboarding is reviewed for version changes."}
                              .get(st["state"], "Nothing to review: nothing changed since it was approved."))
    return st


def confirm(db: Session, ob: FrameworkOnboarding, user: GRCUser, note: Optional[str]) -> None:
    """Outcome "still correct": the baseline moves to now (the old one goes to history) and the flag clears. Answers and the approved snapshot are untouched. Commits."""
    why = review_note(note)
    st = require_needs_review(db, ob)
    own = _fw(db, ob.uploaded_framework_id)
    cur = (successor_of(db, ob.tenant_id, own) if own else None) or own
    before = baseline_of(db, ob)
    was = {"version": before.library_version if before else None}
    take_baseline(db, ob, "review", user.id, cur)
    event(db, ob, "version_reviewed", user.id, {"outcome": "confirmed", "note": why, "reasons": [r["text"] for r in st["reasons"]], "counts": st["counts"],
                                                "from": was, "to": {"version": cur.version if cur else None}})
    db.commit()


def mark_changes_needed(db: Session, ob: FrameworkOnboarding, user: GRCUser, note: Optional[str], reopened: bool) -> None:
    """Outcome "reopen to change": recorded here; the reopen itself (a complete onboarding goes back to draft) is the service's. The flag stays until it is approved
    again, and the list of stale answers keeps shrinking as they are changed. Caller commits."""
    why = review_note(note)
    st = require_needs_review(db, ob)
    base = baseline_of(db, ob)
    base.review_state = "changes_needed"
    event(db, ob, "version_reviewed", user.id, {"outcome": "changes_needed", "note": why, "reasons": [r["text"] for r in st["reasons"]], "counts": st["counts"], "reopened": reopened})


# --------------------------------------------------------------------------- carrying answers to a new version's onboarding
def carry_forward(answers: Dict[str, Any], old_resolved: Dict[str, Any], new_resolved: Dict[str, Any], kn: engine.Known) -> Tuple[Dict[str, Dict[str, Any]], List[Dict[str, str]]]:
    """The answers of an earlier onboarding that still fit the questions of the new one (same question, same kind of answer, still a valid answer), and the
    ones that do not, with the reason. Nothing is guessed: an answer that does not fit as it is, is left for the person."""
    new_f = {f"{st['key']}.{f['key']}": f for st in new_resolved["steps"] for f in st["fields"]}
    old_l = {f"{st['key']}.{f['key']}": f["label"] for st in old_resolved["steps"] for f in st["fields"]}
    carried: Dict[str, Dict[str, Any]] = {}
    dropped: List[Dict[str, str]] = []
    for step, vals in (answers or {}).items():
        for key, v in (vals or {}).items():
            if _empty(v):
                continue
            ref = f"{step}.{key}"
            f = new_f.get(ref)
            label = old_l.get(ref) or (f or {}).get("label")
            if label is None:
                continue                                  # a leftover of an older catalog: it was never shown
            if f is None:
                dropped.append({"label": label, "why": "This question is not asked for the new version."})
                continue
            if f["type"] == "existing":
                continue
            try:
                nv = engine.normalise(f, v, kn)
            except engine.FieldError as e:
                dropped.append({"label": label, "why": str(e)})
                continue
            if not _empty(nv):
                carried.setdefault(step, {})[key] = nv
    return carried, dropped
