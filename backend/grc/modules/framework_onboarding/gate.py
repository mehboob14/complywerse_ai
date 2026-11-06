"""The gate: nothing in a framework's journey starts until its onboarding is complete (or marked underway).

One function decides; both places a journey is made call it (``POST /certifications`` and the Controls Automation scope sync), so one cannot
be forgotten. A framework that already has a journey is never blocked, whatever the catalog later asks for (plan section 6, D4)."""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ...models import CertificationJourney, UploadedFramework
from . import catalog, engine, profile, service

MESSAGE = "Finish this framework's onboarding before starting its journey."


def decide(db: Session, tenant_id: int, fw: UploadedFramework) -> Dict[str, Any]:
    """Read-only. ``allowed`` is true when a journey already exists, or the onboarding is complete or underway."""
    ob = service.find(db, tenant_id, fw.id)
    slug = service.framework_slug(fw)
    out: Dict[str, Any] = {
        "allowed": False, "state": ob.state if ob else "not_started", "onboarding_id": ob.id if ob else None,
        "uploaded_framework_id": fw.id, "framework": catalog.framework_entry(slug).get("label") or fw.name,
        "family": catalog.family_key_for_slug(slug), "reason": MESSAGE, "unmet": [],
    }
    has_journey = db.query(CertificationJourney.id).filter(CertificationJourney.tenant_id == tenant_id,
                                                           CertificationJourney.uploaded_framework_id == fw.id).first() is not None
    if has_journey:
        out.update(allowed=True, reason="A journey already exists for this framework.")
    elif ob is not None and ob.state in ("complete", "underway"):
        out.update(allowed=True, reason="Onboarding is complete." if ob.state == "complete" else "Marked underway.")
    elif ob is None:
        out["unmet"] = [{"key": "onboarding", "label": "Onboarding has not started", "hint": "Start it from Frameworks > Onboarding."}]
    else:
        org_values = profile.merged_values(db, tenant_id)
        out["unmet"] = engine.unmet(engine.evaluate(catalog.resolve(ob.framework_slug), ob.answers or {}, org_values))
    return out


def assert_can_start(db: Session, tenant_id: int, fw: UploadedFramework) -> None:
    """Raise the 409 a journey creator returns when the gate says no (and note it on the onboarding's history)."""
    d = decide(db, tenant_id, fw)
    if d["allowed"]:
        return
    ob = service.find(db, tenant_id, fw.id)
    if ob is not None:
        service._event(db, ob, "journey_blocked", None, {"unmet": len(d["unmet"])})
        db.commit()
    raise HTTPException(status_code=409, detail={"code": "onboarding_required", "message": d["reason"], "onboarding_id": d["onboarding_id"],
                                                 "uploaded_framework_id": fw.id, "state": d["state"], "unmet": d["unmet"]})


def record_started(db: Session, tenant_id: int, fw: UploadedFramework, actor_id: Optional[int]) -> None:
    """The journey was made: say so on the onboarding's history (no commit; the caller commits)."""
    ob = service.find(db, tenant_id, fw.id)
    if ob is not None:
        service._event(db, ob, "journey_started", actor_id, {"state": ob.state})
