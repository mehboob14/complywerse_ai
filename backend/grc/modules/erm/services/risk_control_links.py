"""The one risk–control link (Risk Management waves 4 and 5): grc_risk_controls (RiskControl).

Every link, unlink and read of a risk's controls goes through this module, whatever the screen: the register, the risk
record, the internal-control register, the Control Library workbench, the framework library, the SCF control page, the
Risk Library, reports, dashboards and FAIR. link_control and unlink_control are the only writers.

Five older tables each linked risks to one kind of control. They are no longer written or read for live data: their rows
were copied in by copy_legacy_links once per database (at engine start, from erm.schema_migrations), so a link removed
afterwards does not come back. An old link id a page still holds keeps working through link_by_id.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import String, and_, literal, or_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ....models import (ControlWorkItem, ControlWorkRiskLink, CustomControlProfile, FrameworkControl, InternalControl,
                        InternalControlRiskLink, NormalizedControl, ParsedFrameworkControl, Risk, RiskControl,
                        RiskControlLegacyCopy, RiskControlLink, RiskFrameworkControlLink, RiskFrameworkRequirementLink,
                        RiskReview, UploadedFramework)
from ....services.licence_guard import is_restricted_control

logger = logging.getLogger(__name__)

# grc_risk_controls.control_source → what the screens call it
KIND = {"internal": "internal", "normalized": "library", "framework": "framework", "catalog": "framework"}
TESTED = ("effective", "partially_effective", "ineffective")
CW = ControlWorkItem
# the old table whose ids a page may still send for a link of this source
OLD_TABLE = {"internal": "grc_internal_control_risk_links", "normalized": "grc_risk_control_links",
             "catalog": "grc_risk_framework_control_links", "framework": "grc_risk_framework_requirement_links"}
# what an old row said about its link, carried onto the copy (FAIR's effect and the effectiveness ratings)
CARRIED = ("effectiveness_rating", "mitigation_effectiveness", "freq_reduction_min_pct", "freq_reduction_ml_pct",
           "freq_reduction_max_pct", "mag_reduction_min_pct", "mag_reduction_ml_pct", "mag_reduction_max_pct",
           "effect_rationale", "effect_updated_by", "effect_updated_at")


def _old_tables():
    """(old table, model, control source, control id) — in this order, so a link in two tables points at the first."""
    return [
        ("grc_internal_control_risk_links", InternalControlRiskLink, literal("internal", String),
         InternalControlRiskLink.control_id),
        ("grc_control_work_risk_links", ControlWorkRiskLink, CW.source_type, CW.source_id),
        ("grc_risk_control_links", RiskControlLink, literal("normalized", String), RiskControlLink.normalized_control_id),
        ("grc_risk_framework_control_links", RiskFrameworkControlLink, literal("catalog", String),
         RiskFrameworkControlLink.framework_control_id),
        ("grc_risk_framework_requirement_links", RiskFrameworkRequirementLink, literal("framework", String),
         RiskFrameworkRequirementLink.parsed_control_id),
    ]


def copy_legacy_links(db: Session) -> int:
    """Copy the old tables' links into grc_risk_controls, once per table per database (RiskControlLegacyCopy records
    each): reads never copy, and a link removed afterwards is never brought back. A row whose risk and control are
    already linked only fills what the link does not say yet. The old rows are left as they were. Returns how many links
    were made; commits."""
    try:
        done = {t for (t,) in db.query(RiskControlLegacyCopy.legacy_table)}
        todo = [t for t in _old_tables() if t[0] not in done]
        if not todo:
            return 0
        have = {(r.risk_id, r.control_source, r.control_id): r for r in db.query(RiskControl)}
        total, now = 0, datetime.utcnow()
        for table, model, source, control in todo:
            q = db.query(model, Risk.tenant_id, source, control).join(Risk, Risk.id == model.risk_id)
            if model is ControlWorkRiskLink:
                q = q.join(CW, CW.id == ControlWorkRiskLink.work_item_id).filter(CW.tenant_id == Risk.tenant_id)
            made = 0
            for row, tenant_id, src, control_id in q.filter(control.isnot(None)).order_by(model.id).all():
                link = have.get((row.risk_id, src, control_id))
                if link is None:
                    link = have[(row.risk_id, src, control_id)] = RiskControl(
                        tenant_id=tenant_id, risk_id=row.risk_id, control_source=src, control_id=control_id,
                        link_type=getattr(row, "link_type", None) or "mitigates", notes=getattr(row, "notes", None),
                        created_at=getattr(row, "created_at", None) or now, created_by=getattr(row, "created_by", None),
                        legacy_table=table, legacy_id=row.id)
                    db.add(link)
                    made += 1
                for field in CARRIED:
                    if getattr(link, field) is None and getattr(row, field, None) is not None:
                        setattr(link, field, getattr(row, field))
            db.add(RiskControlLegacyCopy(legacy_table=table, copied=made))
            total += made
        db.commit()
        return total
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Copying the old risk-control links into grc_risk_controls failed; tried again at the next start")
        return 0


def copy_legacy_links_for_engine(engine) -> int:
    """copy_legacy_links for one tenant database (the engine-start hook)."""
    with Session(engine) as db:
        return copy_legacy_links(db)


def link_control(db: Session, risk: Risk, source: str, control_id: int, user_id: Optional[int], *,
                 link_type: Optional[str] = None, notes: Optional[str] = None, effectiveness_rating: Optional[str] = None,
                 mitigation_effectiveness: Optional[str] = None) -> RiskControl:
    """The risk's link to this control, made if missing (an existing link is left as it is). The caller has checked the
    risk's tenant and commits. A Control Library control must be shared (no tenant) or the risk's own tenant's custom
    control: another tenant's custom control is refused as not found, whichever route asked."""
    if source == "normalized":
        owner = db.query(NormalizedControl.tenant_id).filter(NormalizedControl.id == control_id).first()
        if owner is not None and owner[0] is not None and owner[0] != risk.tenant_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Control not found")
    row = find_link(db, risk.id, source, control_id)
    if row is None:
        row = RiskControl(tenant_id=risk.tenant_id, risk_id=risk.id, control_source=source, control_id=control_id,
                          link_type=link_type or "mitigates", notes=notes, created_by=user_id,
                          effectiveness_rating=effectiveness_rating, mitigation_effectiveness=mitigation_effectiveness)
        db.add(row)
        db.flush()
    return row


def find_link(db: Session, risk_id: int, source: str, control_id: int) -> Optional[RiskControl]:
    return db.query(RiskControl).filter_by(risk_id=risk_id, control_source=source, control_id=control_id).first()


def link_by_id(db: Session, link_id: int, source: str, *where) -> Optional[RiskControl]:
    """A link of this source by its grc_risk_controls id, else by the id of the old row it was copied from (a page loaded
    before the switch). `where` narrows it (the risk, the tenant, the control)."""
    q = db.query(RiskControl).filter(RiskControl.control_source == source, *where)
    return (q.filter(RiskControl.id == link_id).first()
            or q.filter(RiskControl.legacy_table == OLD_TABLE[source], RiskControl.legacy_id == link_id).first())


def unlink_control(db: Session, link: RiskControl) -> None:
    """Remove the link. The old tables are not touched: nothing reads them, and their rows were copied only once. The
    caller commits."""
    db.delete(link)


def detail_lists(db: Session, risk: Risk) -> Dict[str, List[dict]]:
    """The risk detail's four control lists in the shapes the old tables gave them; a list's "id" (an internal control's
    "link_id") is the grc_risk_controls id, which the unlink routes and FAIR take."""
    from ...scf.risk_links import control_status_indicator
    links = db.query(RiskControl).filter(RiskControl.risk_id == risk.id).order_by(RiskControl.id).all()
    ids = defaultdict(set)
    for link in links:
        ids[link.control_source].add(link.control_id)
    defs = {"internal": _by_id(db, InternalControl, ids["internal"]),
            "normalized": _by_id(db, NormalizedControl, ids["normalized"]),
            "framework": _by_id(db, ParsedFrameworkControl, ids["framework"]),
            "catalog": _by_id(db, FrameworkControl, ids["catalog"])}
    frameworks = _by_id(db, UploadedFramework, {c.uploaded_framework_id for c in defs["framework"].values()})
    out = {"linked_controls": [], "linked_internal_controls": [], "linked_framework_controls": [],
           "linked_framework_requirements": []}
    for link in links:
        c = defs.get(link.control_source, {}).get(link.control_id)
        if c is None or getattr(c, "tenant_id", None) not in (None, risk.tenant_id):
            continue                                                  # the control is gone, or not this tenant's
        if link.control_source == "normalized":
            out["linked_controls"].append({
                "id": link.id, "control_id": c.id, "code": c.code, "name": c.name, "scf_id": c.scf_id, "source": c.source,
                "custom": c.source == "custom", "control_status": control_status_indicator(db, c, tenant_id=risk.tenant_id),
                "control_status_indicator": True})            # Decision 4: an indicator only, the residual is never updated
        elif link.control_source == "internal":
            out["linked_internal_controls"].append({"id": c.id, "name": c.name, "title": c.name, "status": c.status,
                                                    "link_id": link.id, "control_id": c.control_id})
        elif link.control_source == "catalog":
            out["linked_framework_controls"].append({
                "id": link.id, "framework_control_id": c.id, "code": c.code, "name": c.name,
                "mitigation_effectiveness": link.mitigation_effectiveness, "notes": link.notes})
        else:
            fw = frameworks.get(c.uploaded_framework_id)
            out["linked_framework_requirements"].append({
                "id": link.id, "framework_id": c.uploaded_framework_id, "framework_name": fw.name if fw else None,
                "parsed_control_id": c.id, "code": c.control_id, "title": c.title, "domain": c.domain,
                "mitigation_effectiveness": link.mitigation_effectiveness, "notes": link.notes})
    return out


def _tested(row) -> Optional[str]:
    """Latest tested effectiveness: the operating result, else the design result; never "not tested"."""
    if row is None:
        return None
    for value in (row.operating_effectiveness, row.design_effectiveness):
        if value in TESTED:
            return value
    return None


def _iso(value) -> Optional[str]:
    return value.isoformat() if value else None


def _by_id(db: Session, model, ids) -> dict:
    return {r.id: r for r in db.query(model).filter(model.id.in_(ids))} if ids else {}


def risk_control_links(db: Session, risk_ids: Iterable[int]) -> Dict[int, List[dict]]:
    """{risk id: its controls}, each with kind (internal / library / framework), control type (preventive / detective /
    corrective, or None when not set), latest tested effectiveness (None = not assessed), last test and next test due.
    The caller has checked the risks' tenant."""
    risk_ids = sorted({r for r in risk_ids if r is not None})
    if not risk_ids:
        return {}
    tenants = [t for (t,) in db.query(Risk.tenant_id).filter(Risk.id.in_(risk_ids)).distinct()]
    links = db.query(RiskControl).filter(RiskControl.risk_id.in_(risk_ids)).order_by(RiskControl.id).all()
    ids = defaultdict(set)
    for link in links:
        ids[link.control_source].add(link.control_id)
    defs = {"internal": _by_id(db, InternalControl, ids["internal"]),
            "normalized": _by_id(db, NormalizedControl, ids["normalized"]),
            "framework": _by_id(db, ParsedFrameworkControl, ids["framework"]),
            "catalog": _by_id(db, FrameworkControl, ids["catalog"])}
    # The Control Library work item holds the test record (it mirrors an internal control's tests).
    wanted = [and_(CW.source_type == s, CW.source_id.in_(ids[s])) for s in ("internal", "normalized", "framework") if ids[s]]
    work = {(w.tenant_id, w.source_type, w.source_id): w
            for w in db.query(CW).filter(CW.tenant_id.in_(tenants), or_(*wanted))} if wanted else {}
    types = {(p.tenant_id, p.normalized_control_id): p.control_type for p in db.query(CustomControlProfile).filter(
        CustomControlProfile.tenant_id.in_(tenants), CustomControlProfile.normalized_control_id.in_(ids["normalized"]))} \
        if ids["normalized"] else {}

    out: Dict[int, List[dict]] = {rid: [] for rid in risk_ids}
    for link in links:
        src, cid, tid = link.control_source, link.control_id, link.tenant_id
        c = defs.get(src, {}).get(cid)
        if c is None or getattr(c, "tenant_id", None) not in (None, tid):
            continue                                                  # the control is gone, or not this tenant's
        wi = work.get((tid, src, cid))
        own = c if src == "internal" else None                        # an internal control carries its own test dates
        if src == "internal":
            name, code, ctype = c.name, c.control_id, c.control_type
        elif src == "normalized":
            name, code, ctype = c.name, c.scf_id or c.code, types.get((tid, cid))
        elif src == "framework":
            name, code, ctype = c.title, c.original_reference or c.control_id, None
        else:
            name, code, ctype = c.name, c.code, None
        out[link.risk_id].append({
            "link_id": link.id, "risk_id": link.risk_id, "kind": KIND[src], "source": src, "control_id": cid,
            "code": code, "name": name, "link_type": link.link_type,
            "control_type": (ctype or "").lower() or None,
            "effectiveness": _tested(wi) or _tested(own),
            "last_tested_at": _iso((wi and wi.last_tested_at) or (own and own.last_tested_at)),
            "next_test_due": _iso((wi and wi.next_test_date) or (own and own.next_test_date)),
            "scf_id": getattr(c, "scf_id", None) if src == "normalized" else None,
            "restricted": src == "normalized" and is_restricted_control(c),
        })
    return out


def propose_residual_reviews(db: Session, source: str, control_id: int, tenant_id: int, user) -> int:
    """A signed-off control test never writes the residual. For each risk the control is linked to, a submitted Risk
    Review proposes the residual likelihood the risk's weakest tested control implies (the RCSA rule), for someone else
    to approve under Reviews. Returns how many were proposed; the caller commits."""
    from ..routers.rcsa import _CONTROL_STEP, _PROPOSAL_DUE_DAYS
    risk_ids = [r for (r,) in db.query(RiskControl.risk_id).filter(
        RiskControl.tenant_id == tenant_id, RiskControl.control_source == source, RiskControl.control_id == control_id)]
    controls = risk_control_links(db, risk_ids)
    now, made = datetime.utcnow(), 0
    for risk in db.query(Risk).filter(Risk.id.in_(risk_ids), Risk.tenant_id == tenant_id).all() if risk_ids else []:
        rated = [c["effectiveness"] for c in controls.get(risk.id, []) if c["effectiveness"] in _CONTROL_STEP]
        impact = risk.residual_impact or risk.inherent_impact
        if not (rated and risk.inherent_likelihood and impact):
            continue
        weakest = min(rated, key=_CONTROL_STEP.get)
        likelihood = max(1, risk.inherent_likelihood - _CONTROL_STEP[weakest])
        if (likelihood, impact) == (risk.residual_likelihood, risk.residual_impact) or db.query(RiskReview.id).filter(
                RiskReview.risk_id == risk.id, RiskReview.status == "submitted",
                RiskReview.proposed_residual_likelihood == likelihood,
                RiskReview.proposed_residual_impact == impact).first():
            continue                                  # nothing would change, or the same change already waits
        db.add(RiskReview(
            risk_id=risk.id, review_cycle="adhoc", review_type="triggered", status="submitted",
            due_date=now + timedelta(days=_PROPOSAL_DUE_DAYS), started_at=now, reviewer_id=user.id, submitted_by=user.id,
            previous_inherent_score=risk.inherent_score, previous_residual_score=risk.residual_score,
            proposed_residual_likelihood=likelihood, proposed_residual_impact=impact,
            findings=f"A control test was signed off: the weakest tested control on this risk is "
                     f"{weakest.replace('_', ' ')}, so the residual likelihood would be {likelihood}."))
        made += 1
    return made
