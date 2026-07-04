"""Inventory dashboard scoring — five sections blended into one board score, each
metric traceable to a numerator/denominator over real asset / vulnerability /
criticality-assessment records. Same shape as the ERM / Compliance / Assessments
section-overview endpoints.
"""
from datetime import datetime, timedelta

TARGET = 85


def _cm(key, label, weight, num, den, formula, inverse=False, empty=None):
    """One metric. inverse=True → score is 1-(n/d) (health). empty → score when
    the universe is empty (e.g. 100 for 'nothing bad')."""
    if den:
        pct = num / den * 100
        score = round(100 - pct, 1) if inverse else round(pct, 1)
    else:
        score = empty
    return {"key": key, "label": label, "weight": weight, "score": score,
            "numerator": round(num, 1) if isinstance(num, float) else num,
            "denominator": round(den, 1) if isinstance(den, float) else den,
            "formula": formula, "inverse": inverse, "target": TARGET}


def _sec(metrics):
    avail = [m for m in metrics if m["score"] is not None]
    tw = sum(m["weight"] for m in avail)
    return round(sum(m["score"] * m["weight"] for m in avail) / tw, 1) if avail and tw else None


def score_inventory(db, tids, now=None):
    """Compute the scored inventory overview for the given tenant ids."""
    from ...models import (
        ITAsset, Vulnerability, VulnerabilityAssetLink,
        InfoSystemCriticalityItem, InfraAssetCriticalityItem,
    )
    now = now or datetime.utcnow()
    assets = db.query(ITAsset).filter(ITAsset.tenant_id.in_(tids)).all()
    N = len(assets)
    asset_ids = {a.id for a in assets}

    def has_owner(a):
        return bool(getattr(a, "owner_id", None) or getattr(a, "primary_owner_id", None))

    def cia(a):
        return bool(getattr(a, "confidentiality_rating", None) and getattr(a, "integrity_rating", None)
                    and getattr(a, "availability_rating", None))

    def stale(a):
        ls = getattr(a, "last_seen_at", None)
        return (ls is None) or (ls < now - timedelta(days=30))
    severe_crit = {"high", "critical"}

    # ---------- 1) Inventory hygiene ----------
    hygiene = [
        _cm("owner", "Owner assigned", 0.25, sum(1 for a in assets if has_owner(a)), N,
            "assets with an owner / all assets"),
        _cm("criticality_set", "Criticality set", 0.15, sum(1 for a in assets if getattr(a, "criticality", None)), N,
            "assets with a criticality / all"),
        _cm("classification", "Data classification set", 0.20, sum(1 for a in assets if getattr(a, "data_classification", None)), N,
            "assets with a data classification / all"),
        _cm("cia", "C/I/A rated", 0.25, sum(1 for a in assets if cia(a)), N,
            "assets with all three C/I/A ratings / all"),
        _cm("business_function", "Business function set", 0.15, sum(1 for a in assets if getattr(a, "business_function", None)), N,
            "assets mapped to a business function / all"),
    ]

    # ---------- 2) Criticality coverage ----------
    assessed_ids = set()
    for Mdl in (InfoSystemCriticalityItem, InfraAssetCriticalityItem):
        for it in db.query(Mdl).filter(Mdl.tenant_id.in_(tids)).all():
            if getattr(it, "linked_asset_id", None) and (getattr(it, "approval_status", None) in (None, "approved") and getattr(it, "linked_asset_id") in asset_ids):
                if getattr(it, "approval_status", None) == "approved":
                    assessed_ids.add(it.linked_asset_id)
    high_assets = [a for a in assets if (getattr(a, "criticality", "") or "").lower() in severe_crit]
    crit = [
        _cm("assessed", "Formally assessed", 0.50, len(assessed_ids & asset_ids), N,
            "assets with an approved criticality assessment / all"),
        _cm("score_derived", "Criticality score derived", 0.30, sum(1 for a in assets if getattr(a, "criticality_score", None) is not None), N,
            "assets with a derived criticality score / all"),
        _cm("high_assessed", "High/critical assessed", 0.20, sum(1 for a in high_assets if a.id in assessed_ids), len(high_assets),
            "high/critical assets formally assessed / all high-critical assets", empty=100),
    ]

    # ---------- 3) Vulnerability exposure ----------
    vulns = db.query(Vulnerability).filter(Vulnerability.tenant_id.in_(tids)).all()
    open_states = {None, "open", "in_progress"}
    open_vulns = [v for v in vulns if getattr(v, "status", None) in open_states]
    severe_open = [v for v in open_vulns if str(getattr(v, "severity", "") or "").lower() in severe_crit]
    links = db.query(VulnerabilityAssetLink).all()
    vuln_to_assets = {}
    for l in links:
        vuln_to_assets.setdefault(l.vulnerability_id, set()).add(l.asset_id)
    severe_ids = {v.id for v in severe_open}
    assets_with_severe = {aid for vid in severe_ids for aid in vuln_to_assets.get(vid, set()) if aid in asset_ids}
    overdue_open = sum(1 for v in open_vulns if getattr(v, "due_date", None) and v.due_date < now)
    kev = [v for v in vulns if getattr(v, "kev_flag", None)]
    kev_resolved = sum(1 for v in kev if getattr(v, "status", None) in ("resolved", "closed", "verified", "accepted"))
    vuln = [
        _cm("clean", "Clean of critical/high", 0.40, N - len(assets_with_severe), N,
            "assets with no open critical/high vulnerability / all"),
        _cm("not_overdue", "Remediation on time", 0.35, overdue_open, len(open_vulns),
            "1 - (overdue open vulnerabilities / open vulnerabilities)", inverse=True, empty=100),
        _cm("kev_handled", "Known-exploited handled", 0.25, kev_resolved, len(kev),
            "CISA known-exploited vulnerabilities resolved / all known-exploited", empty=100),
    ]

    # ---------- 4) Scan & monitoring coverage ----------
    scan = [
        _cm("scanned_recent", "Scanned recently", 0.50, sum(1 for a in assets if not stale(a)), N,
            "assets seen by a scan in the last 30 days / all"),
        _cm("os_profiled", "OS profiled", 0.25, sum(1 for a in assets if getattr(a, "os_family", None) or getattr(a, "os_normalized", None)), N,
            "assets with an OS profile (for benchmark matching) / all"),
        _cm("monitored", "Monitoring source", 0.25, sum(1 for a in assets if getattr(a, "last_seen_source", None)), N,
            "assets reporting from a scanner/agent source / all"),
    ]

    # ---------- 5) Lifecycle & exposure ----------
    inet = [a for a in assets if getattr(a, "internet_facing", None)]
    inet_governed = sum(1 for a in inet if has_owner(a) and (getattr(a, "criticality", None)) and a.id in assessed_ids)
    cde = [a for a in assets if getattr(a, "cde_environment", None)]
    cde_governed = sum(1 for a in cde if cia(a) and a.id in assessed_ids)
    lifecycle = [
        _cm("managed", "Actively managed", 0.40, sum(1 for a in assets if (getattr(a, "status", None) == "active" or getattr(a, "lifecycle_state", None) in ("active", "maintenance"))), N,
            "assets active / in maintenance (not inactive limbo) / all"),
        _cm("exposure_governed", "Internet-facing governed", 0.40, inet_governed, len(inet),
            "internet-facing assets with owner + criticality + assessment / all internet-facing", empty=100),
        _cm("cde_controlled", "CDE assets controlled", 0.20, cde_governed, len(cde),
            "PCI CDE assets rated + assessed / all CDE assets", empty=100),
    ]

    sections = {
        "hygiene": {"key": "hygiene", "label": "Inventory Hygiene", "weight": 0.25, "score": _sec(hygiene), "metrics": hygiene},
        "criticality": {"key": "criticality", "label": "Criticality Coverage", "weight": 0.20, "score": _sec(crit), "metrics": crit},
        "vulnerability": {"key": "vulnerability", "label": "Vulnerability Exposure", "weight": 0.25, "score": _sec(vuln), "metrics": vuln},
        "scan": {"key": "scan", "label": "Scan & Monitoring", "weight": 0.15, "score": _sec(scan), "metrics": scan},
        "lifecycle": {"key": "lifecycle", "label": "Lifecycle & Exposure", "weight": 0.15, "score": _sec(lifecycle), "metrics": lifecycle},
    }
    comps = [{"key": s["key"], "label": s["label"], "score": s["score"], "weight": s["weight"], "target": TARGET}
             for s in sections.values()]
    scored = [c for c in comps if c["score"] is not None]
    wsum = sum(c["weight"] for c in scored)
    perf = round(sum(c["score"] * c["weight"] for c in scored) / wsum, 1) if scored and wsum else None
    grade = (None if perf is None else "excellent" if perf >= 85 else "good" if perf >= 70
             else "fair" if perf >= 50 else "poor")

    return {
        "as_of": now.isoformat(),
        "counts": {"assets": N, "vulnerabilities": len(vulns), "open_vulnerabilities": len(open_vulns)},
        "performance": {"score": perf, "grade": grade, "components": comps},
        "sections": sections,
        "attention_queue": {
            "assets_without_owner": sum(1 for a in assets if not has_owner(a)),
            "assets_unassessed": sum(1 for a in assets if a.id not in assessed_ids),
            "open_critical_high_vulns": len(severe_open),
            "stale_assets": sum(1 for a in assets if stale(a)),
            "internet_facing_unassessed": sum(1 for a in inet if a.id not in assessed_ids),
            "total": (sum(1 for a in assets if not has_owner(a)) + len(severe_open)
                      + sum(1 for a in assets if stale(a))),
        },
    }
