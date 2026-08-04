"""Control Testing & Assurance scorecard — a first-class section-scorecard over
the CT&A workbench (ControlWorkItem / ControlWorkTest). Same numerator/denominator
+ weighted-section shape as the other module overviews, so it powers a dedicated
overview page AND the main-dashboard "Control Testing & Assurance" card, and is
per-tenant weight-tunable via scorecard_config (module key "assurance").
"""
from typing import Optional
from datetime import datetime

from fastapi import APIRouter, Depends, Body
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError

from ....models import get_db, GRCUser, ControlWorkItem, ControlWorkTest
from ....routers.auth_router import require_auth, get_user_tenants
from .workbench import ensure_tables, sync_internal_control_work_items

router = APIRouter(prefix="/assurance", tags=["Control Library - Assurance"])


def _m(key, label, weight, num, den, formula, inverse=False, empty_score=None):
    if den:
        pct = (num / den) * 100
        score = round(100 - pct, 1) if inverse else round(pct, 1)
    else:
        score = empty_score
    return {"key": key, "label": label, "weight": weight, "score": score,
            "numerator": num, "denominator": den, "formula": formula,
            "inverse": inverse, "target": 85}


def _sec(metrics):
    av = [m for m in metrics if m["score"] is not None]
    tw = sum(m["weight"] for m in av)
    return round(sum(m["score"] * m["weight"] for m in av) / tw, 1) if av and tw else None


@router.get("/sections-overview")
def get_assurance_sections_overview(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Control Testing & Assurance board — Coverage · Effectiveness · Testing
    Quality, computed from the CT&A workbench and blended into a module score."""
    user_tenants = get_user_tenants(current_user, db)
    scoped = [tenant_id] if (tenant_id and tenant_id in user_tenants) else user_tenants
    now = datetime.utcnow()
    if not scoped:
        return {"as_of": now.isoformat(), "sections": {}, "attention_queue": {},
                "performance": {"score": None, "grade": None, "components": []}}

    # Assurance reads the workbench layer — mirror internal controls into work items
    # so tenants with a populated register get a real score without manual promotion.
    try:
        ensure_tables(db)
        uid = getattr(current_user, "id", None)
        for tid in scoped:
            sync_internal_control_work_items(db, tid, created_by=uid)
        db.flush()
    except SQLAlchemyError:
        db.rollback()

    try:
        wis = db.query(
            ControlWorkItem.id, ControlWorkItem.status,
            ControlWorkItem.design_effectiveness, ControlWorkItem.operating_effectiveness,
            ControlWorkItem.last_tested_at, ControlWorkItem.next_test_date,
            ControlWorkItem.is_key_control,
        ).filter(ControlWorkItem.tenant_id.in_(scoped)).all()
    except SQLAlchemyError:
        db.rollback(); wis = []
    try:
        tests = db.query(
            ControlWorkTest.work_item_id, ControlWorkTest.exceptions_found,
            ControlWorkTest.tester_id, ControlWorkTest.reviewer_id, ControlWorkTest.status,
        ).filter(ControlWorkTest.tenant_id.in_(scoped)).all()
    except SQLAlchemyError:
        db.rollback(); tests = []

    _RATED = ("effective", "partially_effective", "ineffective")
    active = [w for w in wis if (w.status or "") == "active"]
    n = len(active)
    tested_wi_ids = {t.work_item_id for t in tests}
    tested = [w for w in active
              if w.last_tested_at is not None or w.id in tested_wi_ids
              or w.design_effectiveness in _RATED or w.operating_effectiveness in _RATED]
    scheduled = [w for w in active if w.next_test_date is not None]
    overdue = sum(1 for w in scheduled if w.next_test_date < now)
    # Effectiveness is measured over ALL active controls (not just the ones already
    # rated): an untested control gives you NO assurance, so it counts against the
    # score rather than being excluded. That's the difference vs a "pass rate".
    ops_eff = sum(1 for w in active if w.operating_effectiveness == "effective")
    dsn_eff = sum(1 for w in active if w.design_effectiveness == "effective")
    key = [w for w in active if w.is_key_control]
    key_tested = sum(1 for w in key if w.last_tested_at is not None or w.id in tested_wi_ids)
    key_eff = sum(1 for w in key if w.operating_effectiveness == "effective")
    tests_clean = sum(1 for t in tests if (t.exceptions_found or 0) == 0)
    completed_tests = [t for t in tests if (t.status or "") in ("completed", "reviewed")]
    independent = sum(1 for t in completed_tests
                      if t.reviewer_id is not None and t.reviewer_id != t.tester_id)

    coverage_metrics = [
        _m("test_coverage", "Controls tested", 0.45, len(tested), n,
           "active controls tested for effectiveness / all active controls"),
        _m("scheduled", "Testing scheduled", 0.30, len(scheduled), n,
           "active controls with a next-test date / all active controls"),
        _m("key_covered", "Key controls tested", 0.25, key_tested, len(key),
           "key controls tested / all key controls"),
    ]
    effectiveness_metrics = [
        _m("operating_effectiveness", "Operating effectively", 0.40, ops_eff, n,
           "controls operating effectively / all active controls (untested count against)"),
        _m("design_effectiveness", "Designed effectively", 0.30, dsn_eff, n,
           "controls designed effectively / all active controls (untested count against)"),
        _m("key_control_effectiveness", "Key controls effective", 0.30, key_eff, len(key),
           "key controls operating effectively / all key controls"),
    ]
    quality_metrics = [
        _m("test_currency", "Tests on schedule", 0.35, overdue, len(scheduled),
           "1 - (overdue control tests / scheduled control tests)", inverse=True),
        _m("exceptions_clean", "Tests without exceptions", 0.35, tests_clean, len(tests),
           "control tests with no exceptions / all control tests"),
        _m("independent_review", "Independently reviewed", 0.30, independent, len(completed_tests),
           "tests reviewed by someone other than the tester / completed tests"),
    ]

    sections = {
        "coverage": {"key": "coverage", "label": "Test Coverage", "weight": 0.35,
                     "score": _sec(coverage_metrics), "metrics": coverage_metrics,
                     "counts": {"active": n, "tested": len(tested), "scheduled": len(scheduled),
                                "key_controls": len(key)}},
        "effectiveness": {"key": "effectiveness", "label": "Effectiveness", "weight": 0.40,
                          "score": _sec(effectiveness_metrics), "metrics": effectiveness_metrics,
                          "counts": {"active": n, "operating_effective": ops_eff,
                                     "design_effective": dsn_eff, "key_effective": key_eff}},
        "quality": {"key": "quality", "label": "Testing Quality", "weight": 0.25,
                    "score": _sec(quality_metrics), "metrics": quality_metrics,
                    "counts": {"overdue_tests": overdue, "tests": len(tests), "tests_clean": tests_clean,
                               "independently_reviewed": independent, "completed_tests": len(completed_tests)}},
    }

    try:
        from grc.services import scorecard_config as sc_cfg
        _cfg = sc_cfg.get_config(db, scoped[0], "assurance")
        _target = _cfg.get("target", 85)
        sc_cfg.apply_overrides(list(sections.values()), _cfg)
    except Exception:
        _target = 85
    components = [{"key": s["key"], "label": s["label"], "score": s["score"],
                   "weight": s["weight"], "target": _target} for s in sections.values()]
    scored = [c for c in components if c["score"] is not None]
    wsum = sum(c["weight"] for c in scored)
    perf = round(sum(c["score"] * c["weight"] for c in scored) / wsum, 1) if scored and wsum else None
    grade = (None if perf is None else "excellent" if perf >= 85 else "good" if perf >= 70
             else "fair" if perf >= 50 else "poor")

    return {
        "as_of": now.isoformat(),
        "sections": sections,
        "attention_queue": {
            "controls_untested": (n - len(tested)) if n else 0,
            "overdue_control_tests": overdue,
            "ineffective_key_controls": len(key) - key_eff if key else 0,
            "total": ((n - len(tested)) if n else 0) + overdue,
        },
        "performance": {"score": perf, "grade": grade,
                        "formula": "weighted mean of section scores: coverage 35% + effectiveness 40% + testing quality 25%",
                        "components": components},
    }


@router.get("/scorecard-config")
def get_assurance_scorecard_config(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    from grc.services import scorecard_config as sc_cfg
    tenants = get_user_tenants(current_user, db)
    if not tenants:
        return {"module": "assurance", "sections": [], "target": 85, "default_target": 85, "customized": False}
    return sc_cfg.merged(db, tenants[0], "assurance")


@router.put("/scorecard-config")
def put_assurance_scorecard_config(
    body: dict = Body(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    from grc.services import scorecard_config as sc_cfg
    tenants = get_user_tenants(current_user, db)
    if not tenants:
        return {"ok": False}
    cfg = sc_cfg.save_config(
        db, tenants[0], "assurance",
        section_weights=body.get("weights"),
        metric_weights=body.get("metric_weights"),
        target=body.get("target"),
        updated_by=getattr(current_user, "id", None),
    )
    return {"ok": True, "config": cfg}


@router.delete("/scorecard-config")
def reset_assurance_scorecard_config(
    section: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    from grc.services import scorecard_config as sc_cfg
    tenants = get_user_tenants(current_user, db)
    if tenants:
        sc_cfg.reset_config(db, tenants[0], "assurance", section=section)
    return {"ok": True}
