"""Live Cyber Security KPI actuals, computed from real in-platform modules.

Only KPIs the platform genuinely owns data for are computed here — each with a real
numerator/denominator/formula. Everything else the caller flags as 'external'. The
values are snapshotted daily into grc_metric_snapshot (metric = kpi_<key>) so the
dashboard can draw a real trend line over time.
"""
from __future__ import annotations

from datetime import datetime, timedelta


def _pct(n, d):
    return round(100.0 * n / d, 1) if d else None


def compute_kpi_metrics(db, now=None, tenant_ids=None):
    """Return {key: {label, actual, numerator, denominator, formula, target,
    direction, source, href, on_target}} for every KPI the platform can measure."""
    now = now or datetime.utcnow()
    metrics = {}
    tids = tenant_ids or None

    def _scoped(query, model):
        if tids and hasattr(model, "tenant_id"):
            return query.filter(model.tenant_id.in_(tids))
        return query

    # 1) Policy / document reviews on time — Governance
    try:
        from grc.models._13_governance_document_management_enhanced import GovernanceDocument
        docs = _scoped(db.query(GovernanceDocument), GovernanceDocument).all()
        with_date = [d for d in docs if getattr(d, "next_review_date", None)]
        on_time = [d for d in with_date if d.next_review_date and d.next_review_date >= now]
        if with_date:
            metrics["policy_review"] = {
                "label": "Policy & document reviews on time",
                "actual": _pct(len(on_time), len(with_date)), "numerator": len(on_time), "denominator": len(with_date),
                "formula": "documents reviewed on time / documents with a review date",
                "target": 95, "direction": "higher",
                "source": "Governance - document reviews", "href": "/governance",
            }
    except Exception:
        pass

    # 2) Vulnerabilities within remediation SLA — Vulnerability management
    try:
        try:
            from grc.models._22_vulnerability_management import Vulnerability
        except Exception:
            from grc.models import Vulnerability
        vulns = _scoped(db.query(Vulnerability), Vulnerability).all()
        if vulns:
            overdue = [v for v in vulns if getattr(v, "due_date", None) and v.due_date < now
                       and str(getattr(v, "status", "") or "").lower() not in ("resolved", "closed")]
            n = len(vulns) - len(overdue)
            metrics["vuln_sla"] = {
                "label": "Vulnerabilities within remediation SLA",
                "actual": _pct(n, len(vulns)), "numerator": n, "denominator": len(vulns),
                "formula": "vulnerabilities not past their due date / total vulnerabilities",
                "target": 90, "direction": "higher",
                "source": "Vulnerability management", "href": "/vulnerabilities",
            }
    except Exception:
        pass

    # 3) Access certification completed — Access review
    try:
        from grc.models._40_access_review_models import AccessReviewItem
        items = _scoped(db.query(AccessReviewItem), AccessReviewItem).all()
        if items:
            decided = [i for i in items if str(getattr(i, "decision", "pending") or "pending").lower() != "pending"]
            metrics["access_cert"] = {
                "label": "Access certification completed",
                "actual": _pct(len(decided), len(items)), "numerator": len(decided), "denominator": len(items),
                "formula": "access items certified / sampled access items",
                "target": 100, "direction": "higher",
                "source": "Access review certification", "href": "/access-reviews",
            }
    except Exception:
        pass

    # 4) Assets monitored recently — IT Assets inventory
    try:
        from grc.models._14_it_asset_inventory import ITAsset
        assets = _scoped(db.query(ITAsset), ITAsset).all()
        if assets:
            seen = [a for a in assets if getattr(a, "last_seen_at", None) and a.last_seen_at >= now - timedelta(days=30)]
            metrics["asset_monitoring"] = {
                "label": "Assets seen in the last 30 days",
                "actual": _pct(len(seen), len(assets)), "numerator": len(seen), "denominator": len(assets),
                "formula": "assets with a check-in in the last 30 days / total assets",
                "target": 90, "direction": "higher",
                "source": "IT Assets - inventory monitoring", "href": "/assets",
            }
    except Exception:
        pass

    # 5) Assets free of open critical/high vulnerabilities — IT Assets + Vulnerability
    try:
        from grc.models._14_it_asset_inventory import ITAsset
        from grc.models._23_track_a_phase_7_cloud_connector_framework_foundation import VulnerabilityAssetLink
        try:
            from grc.models._22_vulnerability_management import Vulnerability
        except Exception:
            from grc.models import Vulnerability
        assets = _scoped(db.query(ITAsset), ITAsset).all()
        if assets:
            bad = {v.id for v in _scoped(db.query(Vulnerability), Vulnerability).all()
                   if str(getattr(v, "severity", "") or "").lower() in ("critical", "high")
                   and str(getattr(v, "status", "") or "").lower() not in ("resolved", "closed")}
            bad_assets = {l.asset_id for l in db.query(VulnerabilityAssetLink).all() if l.vulnerability_id in bad}
            free = len(assets) - len([a for a in assets if a.id in bad_assets])
            metrics["asset_vuln_free"] = {
                "label": "Assets free of open critical/high vulnerabilities",
                "actual": _pct(free, len(assets)), "numerator": free, "denominator": len(assets),
                "formula": "assets with no open critical/high vulnerability / total assets",
                "target": 90, "direction": "higher",
                "source": "IT Assets - vulnerability exposure", "href": "/assets",
            }
    except Exception:
        pass

    # 6) Risks with a treatment plan — Risk management register
    try:
        from grc.models._11_enterprise_risk_management import Risk
        risks = _scoped(db.query(Risk), Risk).all()
        if risks:
            treated = [r for r in risks if (getattr(r, "treatment_plan", None) or "").strip()]
            metrics["risk_treatment"] = {
                "label": "Risks with a treatment plan",
                "actual": _pct(len(treated), len(risks)), "numerator": len(treated), "denominator": len(risks),
                "formula": "risks with a documented treatment plan / total risks",
                "target": 90, "direction": "higher",
                "source": "Risk management - register", "href": "/erm",
            }
    except Exception:
        pass

    # 7) Incidents resolved or contained — Risk management incidents (business continuity)
    try:
        from grc.models._11_enterprise_risk_management import RiskIncident
        incs = _scoped(db.query(RiskIncident), RiskIncident).all()
        if incs:
            resolved = [i for i in incs if str(getattr(i, "status", "") or "").lower() in ("resolved", "closed", "contained")]
            metrics["incident_resolution"] = {
                "label": "Incidents resolved or contained",
                "actual": _pct(len(resolved), len(incs)), "numerator": len(resolved), "denominator": len(incs),
                "formula": "incidents resolved, closed or contained / total incidents",
                "target": 90, "direction": "higher",
                "source": "Risk management - incidents", "href": "/erm",
            }
    except Exception:
        pass

    for m in metrics.values():
        a, t, d = m["actual"], m["target"], m["direction"]
        m["on_target"] = None if (a is None or t is None) else (a <= t if d == "lower" else a >= t)

    return metrics
