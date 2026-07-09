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
        CompliancePluginRun,
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
    # ("Asset type set" folds in the old By-Asset-Type card as a scored coverage
    # metric — a typed inventory is the basis of good hygiene.)
    hygiene = [
        _cm("owner", "Owner assigned", 0.20, sum(1 for a in assets if has_owner(a)), N,
            "assets with an owner / all assets"),
        _cm("type_set", "Asset type set", 0.10, sum(1 for a in assets if getattr(a, "asset_type", None)), N,
            "assets with an asset type set / all"),
        _cm("criticality_set", "Criticality set", 0.15, sum(1 for a in assets if getattr(a, "criticality", None)), N,
            "assets with a criticality / all"),
        _cm("classification", "Data classification set", 0.20, sum(1 for a in assets if getattr(a, "data_classification", None)), N,
            "assets with a data classification / all"),
        _cm("cia", "C/I/A rated", 0.20, sum(1 for a in assets if cia(a)), N,
            "assets with all three C/I/A ratings / all"),
        _cm("business_function", "Business function set", 0.15, sum(1 for a in assets if getattr(a, "business_function", None)), N,
            "assets mapped to a business function / all"),
    ]

    # ---------- 2) Criticality coverage ----------
    assessed_ids = set()
    approved_assessments = []  # approved criticality-assessment rows linked to a real asset
    for Mdl in (InfoSystemCriticalityItem, InfraAssetCriticalityItem):
        for it in db.query(Mdl).filter(Mdl.tenant_id.in_(tids)).all():
            if getattr(it, "linked_asset_id", None) and (getattr(it, "approval_status", None) in (None, "approved") and getattr(it, "linked_asset_id") in asset_ids):
                if getattr(it, "approval_status", None) == "approved":
                    assessed_ids.add(it.linked_asset_id)
                    approved_assessments.append(it)
    high_assets = [a for a in assets if (getattr(a, "criticality", "") or "").lower() in severe_crit]
    # Quality/freshness of the approved assessments themselves: a rubber-stamped
    # row with no computed score/band, or a years-old one, should not count the
    # same as a real, current assessment.
    n_approved = len(approved_assessments)
    quality_scored = sum(1 for it in approved_assessments
                         if getattr(it, "total_score", None) is not None and getattr(it, "criticality_level", None))
    fresh_cutoff = (now - timedelta(days=365)).date()
    fresh_scored = sum(1 for it in approved_assessments
                       if getattr(it, "date_of_assessment", None) and it.date_of_assessment >= fresh_cutoff)
    # ("Criticality tiered" folds in the old By-Criticality card as a scored
    # coverage metric — you can't cover what hasn't been placed in a tier.)
    crit = [
        _cm("tiered", "Criticality tiered", 0.12, sum(1 for a in assets if getattr(a, "criticality", None)), N,
            "assets placed in a criticality tier (critical/high/medium/low) / all"),
        _cm("assessed", "Formally assessed", 0.30, len(assessed_ids & asset_ids), N,
            "assets with an approved criticality assessment / all"),
        _cm("score_derived", "Criticality score derived", 0.18, sum(1 for a in assets if getattr(a, "criticality_score", None) is not None), N,
            "assets with a derived criticality score / all"),
        _cm("high_assessed", "High/critical assessed", 0.15, sum(1 for a in high_assets if a.id in assessed_ids), len(high_assets),
            "high/critical assets formally assessed / all high-critical assets", empty=100),
        _cm("assessment_quality", "Assessments scored", 0.15, quality_scored, n_approved,
            "approved assessments with a computed total score + criticality band / all approved assessments", empty=None),
        _cm("assessment_freshness", "Assessments current", 0.10, fresh_scored, n_approved,
            "approved assessments dated within the last 365 days / all approved assessments", empty=None),
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
    # Actively-dangerous open vulns: known-exploited (KEV), a public PoC exists,
    # or EPSS puts real-world exploitation at >=50%. Still open = unresolved
    # weaponised risk, which the plain critical/high count alone understates.
    dangerous_open = sum(1 for v in open_vulns
                         if getattr(v, "kev_flag", None)
                         or (getattr(v, "public_exploit_count", 0) or 0) > 0
                         or (getattr(v, "epss_score", 0) or 0) >= 0.5)
    vuln = [
        _cm("clean", "Clean of critical/high", 0.30, N - len(assets_with_severe), N,
            "assets with no open critical/high vulnerability / all"),
        _cm("not_overdue", "Remediation on time", 0.25, overdue_open, len(open_vulns),
            "1 - (overdue open vulnerabilities / open vulnerabilities)", inverse=True, empty=100),
        _cm("kev_handled", "Known-exploited handled", 0.20, kev_resolved, len(kev),
            "CISA known-exploited vulnerabilities resolved / all known-exploited", empty=100),
        _cm("exploit_exposure", "Actively-exploited resolved", 0.25, dangerous_open, len(open_vulns),
            "1 - (open KEV / public-exploit / EPSS>=0.5 vulnerabilities / all open vulnerabilities)", inverse=True, empty=100),
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

    # ---------- 6) Vulnerability remediation health (register performance) ----------
    # The "Vulnerability Exposure" section above asks "are assets clean?". This
    # asks "how well is the vuln register actually being worked?" — remediation
    # throughput, SLA adherence and severe-backlog burn-down, which the crude
    # asset-level flags miss entirely.
    _VULN_DEAD = ("false_positive",)
    _VULN_DONE = ("resolved", "accepted")
    actionable = [v for v in vulns if (getattr(v, "status", None) or "open") not in _VULN_DEAD]
    remediated = [v for v in actionable if (getattr(v, "status", None) or "") in _VULN_DONE]
    severe_actionable = [v for v in actionable if str(getattr(v, "severity", "") or "").lower() in severe_crit]
    severe_remediated = [v for v in severe_actionable if (getattr(v, "status", None) or "") in _VULN_DONE]
    sla_dated = [v for v in remediated if getattr(v, "resolved_at", None) and getattr(v, "due_date", None)]
    sla_met = sum(1 for v in sla_dated if v.resolved_at <= v.due_date)
    open_dated = [v for v in open_vulns if getattr(v, "due_date", None)]
    open_overdue = sum(1 for v in open_dated if v.due_date < now)
    # Exception governance: an exception is only legitimate while it is granted
    # (approved), on-record (has an approval timestamp) and unexpired. A granted
    # exception past its expiry, or one with no approval on file, is risk being
    # carried without cover.
    def _has_exception(v):
        return (getattr(v, "exception_status", None) or "none") not in ("none",)

    def _bad_exception(v):
        st = getattr(v, "exception_status", None)
        if st == "expired":
            return True
        if st == "approved":
            exp = getattr(v, "exception_expires_at", None)
            if exp and exp < now:
                return True
            if getattr(v, "exception_approved_at", None) is None:
                return True
        return False
    excepted = [v for v in vulns if _has_exception(v)]
    bad_exceptions = sum(1 for v in excepted if _bad_exception(v))
    vuln_health = [
        _cm("remediation_rate", "Vulnerabilities remediated", 0.22, len(remediated), len(actionable),
            "resolved or accepted vulnerabilities / all actionable vulnerabilities", empty=100),
        _cm("severe_remediation", "Critical/high remediated", 0.26, len(severe_remediated), len(severe_actionable),
            "critical/high vulnerabilities remediated / all critical/high vulnerabilities", empty=100),
        _cm("sla_adherence", "Remediated within SLA", 0.22, sla_met, len(sla_dated),
            "vulnerabilities remediated on/before their SLA due date / remediated vulns with an SLA date", empty=100),
        _cm("backlog_currency", "Open backlog on time", 0.15, open_overdue, len(open_dated),
            "1 - (overdue open vulnerabilities / open vulnerabilities with a due date)", inverse=True, empty=100),
        _cm("exception_hygiene", "Exceptions in good standing", 0.15, bad_exceptions, len(excepted),
            "1 - (expired / unapproved granted exceptions / all vulnerabilities with an exception)", inverse=True, empty=100),
    ]

    # ---------- 7) CIS benchmark compliance ----------
    # Technical configuration compliance from the CIS-benchmark scanner
    # (CompliancePluginRun). If nothing has been scanned the section is n/a and
    # drops out — we do not claim a compliance level we never measured.
    try:
        cis_runs = db.query(
            CompliancePluginRun.id, CompliancePluginRun.asset_id,
            CompliancePluginRun.plugin_id, CompliancePluginRun.status,
        ).filter(CompliancePluginRun.tenant_id.in_(tids),
                 CompliancePluginRun.is_leaked.is_(False)).order_by(
                     CompliancePluginRun.started_at.desc().nullslast(),
                     CompliancePluginRun.id.desc()).all()
    except Exception:
        cis_runs = []
    # Fold to the latest status per (asset, plugin) so each rule counts once.
    per_asset_latest = {}
    for r in cis_runs:
        if r.asset_id is None:
            continue
        bucket = per_asset_latest.setdefault(r.asset_id, {})
        if r.plugin_id not in bucket:
            bucket[r.plugin_id] = r.status
    cis_passed = cis_failed = cis_error = 0
    for _pm in per_asset_latest.values():
        for _st in _pm.values():
            if _st == "passed":
                cis_passed += 1
            elif _st == "failed":
                cis_failed += 1
            elif _st == "error":
                cis_error += 1
    cis_scanned_assets = len(per_asset_latest)
    cis_definitive = cis_passed + cis_failed
    cis_total_checks = cis_passed + cis_failed + cis_error
    has_cis = len(cis_runs) > 0
    cis = [
        _cm("benchmark_pass_rate", "Benchmark checks passing", 0.55, cis_passed, cis_definitive,
            "CIS benchmark checks passed / checks with a definitive pass or fail"),
        _cm("scan_coverage", "Assets scanned", 0.30, cis_scanned_assets, (N if has_cis else 0),
            "assets with a CIS benchmark scan / all assets"),
        _cm("scan_reliability", "Scans without errors", 0.15, cis_error, cis_total_checks,
            "1 - (errored checks / all checks run)", inverse=True),
    ]

    sections = {
        "hygiene": {"key": "hygiene", "label": "Inventory Hygiene", "weight": 0.18, "score": _sec(hygiene), "metrics": hygiene},
        "criticality": {"key": "criticality", "label": "Criticality Coverage", "weight": 0.15, "score": _sec(crit), "metrics": crit},
        "vulnerability": {"key": "vulnerability", "label": "Vulnerability Exposure", "weight": 0.18, "score": _sec(vuln), "metrics": vuln},
        "vuln_health": {"key": "vuln_health", "label": "Remediation Health", "weight": 0.16, "score": _sec(vuln_health), "metrics": vuln_health},
        "cis": {"key": "cis", "label": "CIS Benchmark", "weight": 0.13, "score": _sec(cis), "metrics": cis,
                "counts": {"scanned_assets": cis_scanned_assets, "passed": cis_passed,
                           "failed": cis_failed, "errored": cis_error}},
        "scan": {"key": "scan", "label": "Scan & Monitoring", "weight": 0.10, "score": _sec(scan), "metrics": scan},
        "lifecycle": {"key": "lifecycle", "label": "Lifecycle & Exposure", "weight": 0.10, "score": _sec(lifecycle), "metrics": lifecycle},
    }
    # Per-tenant fine-tuning: apply saved section + metric weight (and target)
    # overrides, recomputing section scores + the inventory score.
    from ...services import scorecard_config as sc_cfg
    _cfg = sc_cfg.get_config(db, tids[0], "assets") if tids else {}
    _target = _cfg.get("target", TARGET)
    sc_cfg.apply_overrides(list(sections.values()), _cfg)
    comps = [{"key": s["key"], "label": s["label"], "score": s["score"], "weight": s["weight"], "target": _target}
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
