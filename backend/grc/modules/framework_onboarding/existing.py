"""What an organisation already has for a framework: a lightweight discovery step, not another assessment.

The answers (``existing.status``: Yes / No / In progress / Not sure) live with the other onboarding answers. When the answer is Yes the person lists what exists, one
row per item: a type taken from THAT framework's own list (``existing_types`` in the catalog: ISO has certificates and a Statement of Applicability, PCI DSS has
a Report on Compliance, an Attestation of Compliance, a questionnaire and an ASV scan attestation, SOC 2 has Type I and Type II reports), the dates, who issued
it, the version assessed, whether it covers the scope being set up, and the documents (kept in Evidence).

Three things stay apart: the CLAIM (a row here), the EVIDENCE (the documents) and the platform's own COMPLIANCE STATUS, which this module never writes. A row says only how
far anyone has checked it: declared, evidence_received (a document is attached), reviewed or verified (set by a person who may approve).
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from ...models import FrameworkExistingCompliance, FrameworkOnboarding, GRCUser
from . import catalog, files
from .errors import OnboardingError

COVERAGE = ["Yes, completely", "Partially", "No", "Not sure"]
VERIFICATION = ["declared", "evidence_received", "reviewed", "verified"]
VERIFICATION_WORDS = {"declared": "Declared", "evidence_received": "Document attached", "reviewed": "Reviewed", "verified": "Verified"}
MAX_RECORDS = 20
MAX_FILES = 5
_DATES = ("assessment_date", "valid_until", "period_start", "period_end")
_TEXT = {"framework_version": 60, "assessor_or_issuer": 200, "scope_note": 2000, "note": 2000}


def _iso(d: Any) -> Optional[str]:
    return d.isoformat() if d else None


def _name(db: Session, uid: Optional[int]) -> Optional[str]:
    if not uid:
        return None
    row = db.query(GRCUser.display_name, GRCUser.username).filter(GRCUser.id == uid).first()
    return (row[0] or row[1]) if row else None


def serialise(db: Session, rec: FrameworkExistingCompliance, names: Dict[int, str]) -> Dict[str, Any]:
    ids = [int(i) for i in rec.evidence_ids or []]
    return {
        "id": rec.id, "assessment_type": rec.assessment_type, "framework_version": rec.framework_version,
        "assessment_date": _iso(rec.assessment_date), "valid_until": _iso(rec.valid_until),
        "period_start": _iso(rec.period_start), "period_end": _iso(rec.period_end),
        "assessor_or_issuer": rec.assessor_or_issuer, "scope_coverage": rec.scope_coverage, "scope_note": rec.scope_note,
        "files": [{"id": i, "name": names.get(i, "File")} for i in ids],
        "verification_status": rec.verification_status, "verified_by": _name(db, rec.verified_by), "verified_at": _iso(rec.verified_at),
        "note": rec.note, "expired": bool(rec.valid_until and rec.valid_until < date.today()),
        "created_by": _name(db, rec.created_by), "updated_at": _iso(rec.updated_at),
    }


def records(db: Session, ob: FrameworkOnboarding) -> List[FrameworkExistingCompliance]:
    return (db.query(FrameworkExistingCompliance).filter(FrameworkExistingCompliance.onboarding_id == ob.id, FrameworkExistingCompliance.tenant_id == ob.tenant_id)
            .order_by(FrameworkExistingCompliance.id).all())


def view_of(db: Session, ob: FrameworkOnboarding) -> Dict[str, Any]:
    """The framework's own types, the choices, and the rows. Part of the onboarding view; a GET never writes."""
    res = catalog.resolve(ob.framework_slug)
    names = files.known(db, ob.tenant_id)
    return {"types": res["existing_types"], "confidence": res["existing_confidence"], "coverage": COVERAGE, "verification": VERIFICATION_WORDS,
            "limits": {"records": MAX_RECORDS, "files": MAX_FILES},
            "records": [serialise(db, r, names) for r in records(db, ob)]}


def snapshot_of(db: Session, ob: FrameworkOnboarding) -> List[Dict[str, Any]]:
    """The rows as they stand when the onboarding is approved (frozen with the answers)."""
    names = files.known(db, ob.tenant_id)
    return [serialise(db, r, names) for r in records(db, ob)]


def _date(v: Any) -> Optional[date]:
    if v in (None, ""):
        return None
    return date.fromisoformat(str(v)[:10])


def _clean(db: Session, ob: FrameworkOnboarding, body: Dict[str, Any], *, creating: bool) -> Dict[str, Any]:
    """The columns to store for what was sent (only the keys sent when updating). Raises OnboardingError(422) naming each field."""
    errors: List[Dict[str, str]] = []
    out: Dict[str, Any] = {}
    types = catalog.resolve(ob.framework_slug)["existing_types"]
    if creating or "assessment_type" in body:
        v = body.get("assessment_type")
        if v not in types:
            errors.append({"field": "assessment_type", "message": "Choose one of the listed kinds."})
        else:
            out["assessment_type"] = v
    for k in _DATES:
        if k in body:
            try:
                out[k] = _date(body[k])
            except ValueError:
                errors.append({"field": k, "message": "Enter a date as year-month-day."})
    for k, n in _TEXT.items():
        if k in body:
            out[k] = (str(body[k] or "").strip()[:n]) or None
    if "scope_coverage" in body:
        v = body["scope_coverage"] or None
        if v is not None and v not in COVERAGE:
            errors.append({"field": "scope_coverage", "message": "Choose one of the listed answers."})
        else:
            out["scope_coverage"] = v
    if "evidence_ids" in body:
        raw = body["evidence_ids"] or []
        known = files.known(db, ob.tenant_id)
        try:
            ids = list(dict.fromkeys(int(x["id"] if isinstance(x, dict) else x) for x in raw))
        except (TypeError, ValueError, KeyError):
            ids = []
            errors.append({"field": "evidence_ids", "message": "Attach a file with Upload."})
        if any(i not in known for i in ids):
            errors.append({"field": "evidence_ids", "message": "Attach a file with Upload."})
        elif len(ids) > MAX_FILES:
            errors.append({"field": "evidence_ids", "message": f"Attach at most {MAX_FILES} files to one item."})
        else:
            out["evidence_ids"] = ids
    if not errors:
        a, b = out.get("assessment_date"), out.get("valid_until")
        if a and b and b < a:
            errors.append({"field": "valid_until", "message": "The expiry cannot be before the assessment date."})
        s, e = out.get("period_start"), out.get("period_end")
        if s and e and e < s:
            errors.append({"field": "period_end", "message": "The period cannot end before it starts."})
    if errors:
        raise OnboardingError(422, "Some details could not be saved.", errors=errors)
    return out


def _settle(rec: FrameworkExistingCompliance, evidence_changed: bool) -> None:
    """The status follows the documents: attaching one moves a declared item to 'document attached'; taking the last one away, or changing them, drops a review."""
    has = bool(rec.evidence_ids)
    if evidence_changed and rec.verification_status in ("reviewed", "verified"):
        rec.verification_status, rec.verified_by, rec.verified_at = ("evidence_received" if has else "declared"), None, None
    elif rec.verification_status == "declared" and has:
        rec.verification_status = "evidence_received"
    elif rec.verification_status == "evidence_received" and not has:
        rec.verification_status = "declared"


def _locked(ob: FrameworkOnboarding) -> None:
    if ob.state == "complete":
        raise OnboardingError(409, "Approved and locked. Reopen it to change it.")


def get(db: Session, ob: FrameworkOnboarding, rid: int) -> FrameworkExistingCompliance:
    rec = db.query(FrameworkExistingCompliance).filter(FrameworkExistingCompliance.id == rid, FrameworkExistingCompliance.onboarding_id == ob.id,
                                                       FrameworkExistingCompliance.tenant_id == ob.tenant_id).first()
    if rec is None:
        raise OnboardingError(404, "That item is not in this onboarding.")
    return rec


def create(db: Session, ob: FrameworkOnboarding, user: GRCUser, body: Dict[str, Any], event) -> FrameworkExistingCompliance:
    _locked(ob)
    if len(records(db, ob)) >= MAX_RECORDS:
        raise OnboardingError(422, f"At most {MAX_RECORDS} items; combine the rest.")
    values = _clean(db, ob, body, creating=True)
    now = datetime.utcnow()
    rec = FrameworkExistingCompliance(**{"evidence_ids": [], "verification_status": "declared", **values}, tenant_id=ob.tenant_id, onboarding_id=ob.id,
                                      created_by=user.id, created_at=now, updated_at=now)
    _settle(rec, evidence_changed=False)
    db.add(rec)
    db.flush()
    ob.updated_at = now
    event(db, ob, "existing_saved", user.id, {"type": rec.assessment_type, "added": True})
    db.commit()
    return rec


def update(db: Session, ob: FrameworkOnboarding, user: GRCUser, rec: FrameworkExistingCompliance, body: Dict[str, Any], event) -> FrameworkExistingCompliance:
    _locked(ob)
    values = _clean(db, ob, body, creating=False)
    before = list(rec.evidence_ids or [])
    for k, v in values.items():
        setattr(rec, k, v)
    now = datetime.utcnow()
    rec.updated_at = ob.updated_at = now
    _settle(rec, evidence_changed=sorted(rec.evidence_ids or []) != sorted(before))
    event(db, ob, "existing_saved", user.id, {"type": rec.assessment_type, "fields": sorted(values)})
    db.commit()
    return rec


def delete(db: Session, ob: FrameworkOnboarding, user: GRCUser, rec: FrameworkExistingCompliance, event) -> None:
    _locked(ob)
    event(db, ob, "existing_removed", user.id, {"type": rec.assessment_type})
    db.delete(rec)
    ob.updated_at = datetime.utcnow()
    db.commit()


def verify(db: Session, ob: FrameworkOnboarding, user: GRCUser, rec: FrameworkExistingCompliance, status: str, event) -> FrameworkExistingCompliance:
    """A person who may approve marks an item reviewed or verified. Never without a document: a claim alone is not evidence."""
    if status not in ("reviewed", "verified"):
        raise OnboardingError(422, "Choose reviewed or verified.", errors=[{"field": "status", "message": "Choose reviewed or verified."}])
    if not rec.evidence_ids:
        raise OnboardingError(422, "Attach the document first: a claim alone cannot be reviewed.", errors=[{"field": "status", "message": "No document attached."}])
    rec.verification_status, rec.verified_by, rec.verified_at, rec.updated_at = status, user.id, datetime.utcnow(), datetime.utcnow()
    event(db, ob, "existing_verified", user.id, {"type": rec.assessment_type, "status": status})
    db.commit()
    return rec
