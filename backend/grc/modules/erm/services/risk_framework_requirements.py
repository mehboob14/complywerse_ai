"""A tenant's installed frameworks (the framework library) as places a risk's controls can come from.

An installed framework is an `UploadedFramework` with its `ParsedFrameworkControl` rows (the UAE IA Standard, ISO 27001, ...). A risk is linked
to one of its controls with a `RiskFrameworkRequirementLink`; the register's Controls tab picks them here, and the Risk Library links every
control of a library risk's objective when the risk is added to the register.
"""
from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ....models import ParsedFrameworkControl, Risk, RiskFrameworkRequirementLink, UploadedFramework

EFFECTIVENESS = ("full", "partial", "minimal", "none")


def _shared_or_own(tenant_ids: Sequence[int]):
    return or_(UploadedFramework.tenant_id.is_(None), UploadedFramework.tenant_id.in_(list(tenant_ids) or [-1]))


def installed(db: Session, tenant_ids: Sequence[int]) -> List[dict]:
    """The frameworks this tenant has with controls in them, by name."""
    counts = dict(db.query(ParsedFrameworkControl.uploaded_framework_id, func.count(ParsedFrameworkControl.id))
                  .group_by(ParsedFrameworkControl.uploaded_framework_id).all())
    rows = (db.query(UploadedFramework).filter(_shared_or_own(tenant_ids))
            .order_by(UploadedFramework.name.asc(), UploadedFramework.id.asc()).all())
    return [{"id": f.id, "name": f.name, "slug": f.slug, "version": f.version, "controls": counts.get(f.id, 0)}
            for f in rows if counts.get(f.id)]


def find_framework(db: Session, tenant_ids: Sequence[int], key: Optional[str], name: Optional[str]) -> Optional[UploadedFramework]:
    """The installed framework a library belongs to: by its slug when the seed set one, else by its name (frameworks are seeded by name).
    When a name is installed twice, the one with the most controls."""
    q = db.query(UploadedFramework).filter(_shared_or_own(tenant_ids))
    rows = [f for f in q.order_by(UploadedFramework.id.asc()).all()
            if (key and (f.slug or "").lower() == key.lower()) or (name and (f.name or "").strip().lower() == name.strip().lower())]
    if not rows:
        return None
    counts = dict(db.query(ParsedFrameworkControl.uploaded_framework_id, func.count(ParsedFrameworkControl.id))
                  .filter(ParsedFrameworkControl.uploaded_framework_id.in_([f.id for f in rows]))
                  .group_by(ParsedFrameworkControl.uploaded_framework_id).all())
    return max(rows, key=lambda f: (counts.get(f.id, 0), -f.id))


def codes_installed(db: Session, framework_id: int) -> set:
    return {c for (c,) in db.query(ParsedFrameworkControl.control_id).filter(ParsedFrameworkControl.uploaded_framework_id == framework_id)}


def search_controls(db: Session, framework_id: int, text: Optional[str], skip: int = 0, limit: int = 100) -> Tuple[int, List[dict]]:
    q = db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.uploaded_framework_id == framework_id)
    for word in [w for w in (text or "").split() if w]:
        like = f"%{word.lower()}%"
        q = q.filter(or_(func.lower(ParsedFrameworkControl.control_id).like(like), func.lower(ParsedFrameworkControl.title).like(like),
                         func.lower(func.coalesce(ParsedFrameworkControl.domain, "")).like(like),
                         func.lower(func.coalesce(ParsedFrameworkControl.category, "")).like(like)))
    total = q.count()
    rows = q.order_by(ParsedFrameworkControl.id.asc()).offset(skip).limit(limit).all()
    return total, [{"id": c.id, "code": c.control_id, "title": c.title, "domain": c.domain, "category": c.category,
                    "priority_level": c.priority_level, "is_mandatory": bool(c.is_mandatory)} for c in rows]


def link_controls(db: Session, risk: Risk, framework: UploadedFramework, controls: Iterable[ParsedFrameworkControl],
                  effectiveness: str = "partial", notes: Optional[str] = None, user_id: Optional[int] = None) -> Dict[str, List[str]]:
    """Link the controls to the risk (those already linked are left as they are); the caller commits."""
    have = {pid for (pid,) in db.query(RiskFrameworkRequirementLink.parsed_control_id).filter(RiskFrameworkRequirementLink.risk_id == risk.id)}
    out = {"linked": [], "already": []}
    for c in controls:
        if c.id in have:
            out["already"].append(c.control_id)
            continue
        db.add(RiskFrameworkRequirementLink(risk_id=risk.id, uploaded_framework_id=framework.id, parsed_control_id=c.id,
                                            control_code=c.control_id, mitigation_effectiveness=effectiveness, notes=notes, created_by=user_id))
        have.add(c.id)
        out["linked"].append(c.control_id)
    return out


def serialize_links(risk: Risk) -> List[dict]:
    """The risk's framework-library links for its detail page: the framework, the control and what the link says."""
    rows = sorted(risk.framework_requirement_links or [], key=lambda l: l.id)
    return [{
        "id": l.id, "framework_id": l.uploaded_framework_id, "framework_name": l.framework.name if l.framework else None,
        "parsed_control_id": l.parsed_control_id, "code": l.control_code,
        "title": l.control.title if l.control else None, "domain": l.control.domain if l.control else None,
        "mitigation_effectiveness": l.mitigation_effectiveness, "notes": l.notes,
    } for l in rows]
