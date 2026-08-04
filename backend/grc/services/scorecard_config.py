"""Per-tenant scorecard tuning — section weights, metric weights, and the target.

Every module dashboard scores the same way: sections (each a weighted mean of its
metrics) blended by section weight into the module score. A tenant can override
the section weights, the per-section metric weights, and the target. Only
overrides are stored (grc_scorecard_config, one row per tenant+module); the rest
falls back to the built-in defaults. Weights always renormalize to 100%.

config JSON:
  {"weights": {section_key: frac},                      # section weights
   "metric_weights": {section_key: {metric_key: frac}}, # metric weights per section
   "target": 85}
"""
from __future__ import annotations

from typing import Optional
from sqlalchemy.orm import Session

# Default section weights + labels, per module (for the section-weight editor UI).
DEFAULTS = {
    "erm": {
        "target": 85,
        "sections": [
            ("register", "Risk Register", 0.18),
            ("assessments", "Risk Assessments", 0.14),
            ("mitigation", "Mitigation Actions", 0.10),
            ("rcsa", "RCSA", 0.09),
            ("controls", "Internal Controls", 0.09),
            ("kris", "Key Risk Indicators", 0.09),
            ("appetite", "Risk Appetite", 0.09),
            ("reviews", "Risk Reviews", 0.09),
            ("vendor_risk", "Vendor Risk", 0.08),
            ("incidents", "Incidents", 0.05),
        ],
    },
    "governance": {
        "target": 85,
        "sections": [
            ("documents", "Documents", 0.18),
            ("mappings", "Mappings", 0.18),
            ("approvals", "Approvals & Sign-off", 0.14),
            ("reviews", "Reviews", 0.14),
            ("exceptions", "Exceptions", 0.09),
            ("attestations", "Attestations", 0.09),
            ("committees", "Committees", 0.09),
            ("kris", "Key Risk Indicators", 0.09),
            ("kpi", "KPI Report", 0.06),
            ("projects", "IS Projects", 0.06),
        ],
    },
    "compliance": {
        "target": 85,
        "sections": [
            ("frameworks", "Frameworks", 0.20),
            ("controls", "Controls", 0.18),
            ("effectiveness", "Control Effectiveness", 0.18),
            ("evidence", "Evidence", 0.18),
            ("control_library", "Control Library", 0.14),
            ("regulatory", "Regulatory", 0.12),
        ],
    },
    "assets": {
        "target": 85,
        "sections": [
            ("hygiene", "Inventory Hygiene", 0.18),
            ("criticality", "Criticality Coverage", 0.15),
            ("vulnerability", "Vulnerability Exposure", 0.18),
            ("vuln_health", "Remediation Health", 0.16),
            ("cis", "CIS Benchmark", 0.13),
            ("scan", "Scan & Monitoring", 0.10),
            ("lifecycle", "Lifecycle & Exposure", 0.10),
        ],
    },
    "issue_incident": {
        "target": 85,
        "sections": [
            ("issues", "Issues", 0.40),
            ("incidents", "Incidents", 0.35),
            ("corrective_actions", "Corrective Actions", 0.25),
        ],
    },
    "assurance": {
        "target": 85,
        "sections": [
            ("coverage", "Test Coverage", 0.35),
            ("effectiveness", "Effectiveness", 0.40),
            ("quality", "Testing Quality", 0.25),
        ],
    },
}

_ENSURED: set = set()


def _renorm(d: dict) -> dict:
    clean = {k: max(0.0, float(v)) for k, v in (d or {}).items()}
    s = sum(clean.values())
    return {k: round(v / s, 4) for k, v in clean.items()} if s > 0 else clean


def ensure_table(db: Session) -> None:
    try:
        bind = db.get_bind()
        key = str(getattr(bind, "url", bind))
    except Exception:  # noqa: BLE001
        key = "default"
    if key in _ENSURED:
        return
    try:
        from ..models import ScorecardConfig
        ScorecardConfig.__table__.create(bind=db.get_bind(), checkfirst=True)
        _ENSURED.add(key)
    except Exception:  # noqa: BLE001
        pass


def get_config(db: Session, tenant_id: int, module: str) -> dict:
    ensure_table(db)
    try:
        from ..models import ScorecardConfig
        row = (db.query(ScorecardConfig)
               .filter(ScorecardConfig.tenant_id == tenant_id, ScorecardConfig.module == module)
               .first())
        return dict(row.config or {}) if row else {}
    except Exception:  # noqa: BLE001
        return {}


def save_config(db: Session, tenant_id: int, module: str, *,
                section_weights: Optional[dict] = None,
                metric_weights: Optional[dict] = None,
                target=None, updated_by: Optional[int] = None) -> dict:
    """Merge the provided overrides into the stored config (so editing section
    weights doesn't wipe metric weights, and vice versa). Weights renormalize."""
    ensure_table(db)
    from ..models import ScorecardConfig
    default_target = DEFAULTS.get(module, {}).get("target", 85)
    cur = get_config(db, tenant_id, module)
    cfg = {
        "weights": dict(cur.get("weights", {})),
        "metric_weights": dict(cur.get("metric_weights", {})),
        "target": cur.get("target", default_target),
    }
    if section_weights is not None:
        cfg["weights"] = _renorm(section_weights)
    if metric_weights is not None:
        for sk, mws in metric_weights.items():
            cfg["metric_weights"][sk] = _renorm(mws)
    if target is not None:
        try:
            cfg["target"] = max(0.0, min(100.0, float(target)))
        except (TypeError, ValueError):
            pass
    row = (db.query(ScorecardConfig)
           .filter(ScorecardConfig.tenant_id == tenant_id, ScorecardConfig.module == module)
           .first())
    if row:
        row.config = cfg
        row.updated_by = updated_by
    else:
        db.add(ScorecardConfig(tenant_id=tenant_id, module=module, config=cfg, updated_by=updated_by))
    db.commit()
    return cfg


def reset_config(db: Session, tenant_id: int, module: str, section: Optional[str] = None) -> None:
    """Reset the whole module, or just one section's metric weights."""
    ensure_table(db)
    try:
        from ..models import ScorecardConfig
        if section is None:
            (db.query(ScorecardConfig)
             .filter(ScorecardConfig.tenant_id == tenant_id, ScorecardConfig.module == module)
             .delete(synchronize_session=False))
            db.commit()
            return
        cfg = get_config(db, tenant_id, module)
        mw = dict(cfg.get("metric_weights", {}))
        mw.pop(section, None)
        cfg["metric_weights"] = mw
        row = (db.query(ScorecardConfig)
               .filter(ScorecardConfig.tenant_id == tenant_id, ScorecardConfig.module == module)
               .first())
        if row:
            row.config = cfg
            db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()


def apply_overrides(sections: list, cfg: dict):
    """Apply a tenant's overrides to a normalized sections list, in place, and
    return the recomputed module score.

    sections: [{key, weight, score, metrics: [{key, weight, score}]}, ...]
    cfg:      {weights:{sk:frac}, metric_weights:{sk:{mk:frac}}, target}
    """
    sw = cfg.get("weights", {})
    mw = cfg.get("metric_weights", {})
    for sec in sections:
        movr = mw.get(sec.get("key"))
        if movr and sec.get("metrics"):
            for m in sec["metrics"]:
                if m.get("key") in movr:
                    m["weight"] = movr[m["key"]]
            avail = [m for m in sec["metrics"] if m.get("score") is not None]
            tw = sum(m["weight"] for m in avail)
            if avail and tw:
                sec["score"] = round(sum(m["score"] * m["weight"] for m in avail) / tw, 1)
        if sec.get("key") in sw:
            sec["weight"] = sw[sec["key"]]
    scored = [s for s in sections if s.get("score") is not None]
    tw = sum(s["weight"] for s in scored)
    return round(sum(s["score"] * s["weight"] for s in scored) / tw, 1) if (scored and tw) else None


def merged(db: Session, tenant_id: int, module: str) -> dict:
    """Section weights + target (defaults merged with overrides) — for the card editor."""
    d = DEFAULTS.get(module, {})
    default_target = d.get("target", 85)
    cfg = get_config(db, tenant_id, module)
    w = cfg.get("weights", {})
    target = cfg.get("target", default_target)
    sections = [
        {"key": k, "label": lbl, "default_weight": dw, "weight": w.get(k, dw)}
        for (k, lbl, dw) in d.get("sections", [])
    ]
    return {
        "module": module,
        "sections": sections,
        "target": target,
        "default_target": default_target,
        "customized": bool(w) or bool(cfg.get("metric_weights")) or target != default_target,
    }
