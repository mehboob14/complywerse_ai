"""Per-assessment-type scoring. First family implemented: ASVS (checklist +
L1/L2/L3 verification levels). Every metric returns numerator/denominator/weight/
formula so the value is traceable. SLA is scored as its OWN dimension (user
decision) using the tenant ComplianceSlaPolicy, never blended into content.

Design mirrors the ASVS dashboard tab so the board score and the tab never
disagree: validity = pass / (applicable, excluding N/A); "level achieved" = the
highest level where every requirement at that level passes.
"""
import re
import json
from datetime import timedelta

LEVEL_RE = re.compile(r"ASVS Level:\s*([0-9]+)", re.I)
TARGET = 85

# Default content-metric weights per assessment type. These are DEFAULTS ONLY —
# a tenant can override them (stored config, edited in the overview's tune panel
# alongside SLA tuning). score_asvs() merges any override over these.
DEFAULT_ASVS_WEIGHTS = {
    "assessed": 0.15,
    "l1_verified": 0.35,
    "l2_verified": 0.25,
    "l3_verified": 0.15,
    "evidence": 0.10,
}


def _merge_weights(defaults, override):
    w = dict(defaults)
    if override:
        for k, v in override.items():
            if k in w and v is not None:
                try:
                    w[k] = float(v)
                except (TypeError, ValueError):
                    pass
    return w

# ComplianceSlaPolicy defaults (used when a tenant has no row yet).
SLA_DEFAULTS = dict(
    critical_days=30, high_days=60, medium_days=90, low_days=180, due_soon_days=30,
    score_closed_ontime=100, score_closed_late=70, score_on_track=40,
    score_due_soon=20, score_overdue=0, score_no_date=30,
)


def _p(policy, key):
    val = getattr(policy, key, None) if policy is not None else None
    return val if val is not None else SLA_DEFAULTS[key]


def req_level(it):
    """ASVS verification level (1/2/3) parsed from the item's remarks blob."""
    m = LEVEL_RE.search(getattr(it, "remarks", "") or "")
    try:
        return int(m.group(1)) if m else 1
    except Exception:
        return 1


def _cm(key, label, weight, num, den, formula, empty=None):
    score = round(num / den * 100, 1) if den else empty
    return {"key": key, "label": label, "weight": weight, "score": score,
            "numerator": num, "denominator": den, "formula": formula, "target": TARGET}


def _weighted(metrics):
    avail = [m for m in metrics if m["score"] is not None]
    tw = sum(m["weight"] for m in avail)
    return round(sum(m["score"] * m["weight"] for m in avail) / tw, 1) if avail and tw else None


# ---------------------------------------------------------------- SLA (own dim)
def _target_date(it, policy, now):
    td = getattr(it, "target_date", None)
    if td:
        return td
    base = getattr(it, "created_at", None) or now
    days = {"critical": _p(policy, "critical_days"), "high": _p(policy, "high_days"),
            "medium": _p(policy, "medium_days"), "low": _p(policy, "low_days")}.get(
        (getattr(it, "priority", None) or "medium"), _p(policy, "medium_days"))
    return base + timedelta(days=days)


def _sla_point(it, policy, now):
    """The ComplianceSlaPolicy point score for one remediation item."""
    ca = getattr(it, "closed_at", None)
    target = _target_date(it, policy, now)
    if ca:
        return _p(policy, "score_closed_ontime") if (target and ca <= target) else _p(policy, "score_closed_late")
    if target is None:
        return _p(policy, "score_no_date")
    if target < now:
        return _p(policy, "score_overdue")
    if (target - now).days <= _p(policy, "due_soon_days"):
        return _p(policy, "score_due_soon")
    return _p(policy, "score_on_track")


def sla_dimension(gaps, policy, now):
    """Shared SLA (timeliness/closure) dimension over a list of 'gap' items — the
    same for every assessment family. Score = average ComplianceSlaPolicy point
    score. Returns None (n/a) when there are no gaps to remediate."""
    if not gaps:
        return {"score": None, "metrics": [],
                "counts": {"gaps": 0, "closed": 0, "open": 0, "overdue": 0}}
    closed = [it for it in gaps if getattr(it, "closed_at", None)]
    closed_ontime = sum(1 for it in closed
                        if _target_date(it, policy, now) and it.closed_at <= _target_date(it, policy, now))
    open_gaps = [it for it in gaps if not getattr(it, "closed_at", None)]
    overdue = sum(1 for it in open_gaps
                  if _target_date(it, policy, now) and _target_date(it, policy, now) < now)
    metrics = [
        _cm("on_time", "Closed on time", 0.40, closed_ontime, len(closed),
            "gaps closed on/before target / gaps closed", empty=100),
        _cm("not_overdue", "Not overdue", 0.35, len(open_gaps) - overdue, len(open_gaps),
            "open gaps still within target / open gaps", empty=100),
        _cm("closed_rate", "Gaps closed", 0.25, len(closed), len(gaps),
            "gaps closed / all gaps", empty=100),
    ]
    score = round(sum(_sla_point(it, policy, now) for it in gaps) / len(gaps), 1)
    return {"score": score, "metrics": metrics,
            "counts": {"gaps": len(gaps), "closed": len(closed),
                       "open": len(open_gaps), "overdue": overdue}}


def _parse_num(remarks, label, default=None):
    """Pull a 'Label: N' number out of the remarks blob (Weighting, Target, …)."""
    m = re.search(rf"{label}:\s*([0-9]+(?:\.[0-9]+)?)", remarks or "", re.I)
    try:
        return float(m.group(1)) if m else default
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------- ASVS
def score_asvs(doc, items, evidence_counts, policy, now, weights=None):
    """Score one ASVS assessment. Returns content (validity + level metrics +
    level-achieved) and a separate SLA dimension over its gaps.

    evidence_counts: {item_id: n_evidence}. weights: optional per-tenant override
    of DEFAULT_ASVS_WEIGHTS. Global compliance_status path (per-asset target-level
    scoping is layered in later)."""
    w = _merge_weights(DEFAULT_ASVS_WEIGHTS, weights)

    def st(it):
        return getattr(it, "compliance_status", "in_progress") or "in_progress"

    def has_ev(it):
        return evidence_counts.get(it.id, 0) > 0

    total = len(items)
    tested = sum(1 for it in items if st(it) != "in_progress")
    passed_all = sum(1 for it in items if st(it) == "complied")
    ev_backed = sum(1 for it in items if st(it) == "complied" and has_ev(it))

    # Per-level verification (the L1/L2/L3 the user asked to be counted).
    lv_counts, level_metrics = {}, []
    for L in (1, 2, 3):
        at_level = [it for it in items if req_level(it) == L]
        applicable = [it for it in at_level if st(it) != "na"]
        passed = sum(1 for it in applicable if st(it) == "complied")
        lv_counts[L] = {"total": len(at_level), "applicable": len(applicable), "passed": passed}
        level_metrics.append(_cm(f"l{L}_verified", f"L{L} verified", w[f"l{L}_verified"],
                                 passed, len(applicable),
                                 f"L{L} requirements passing / L{L} applicable (excl. N/A)"))

    content_metrics = [
        _cm("assessed", "Assessed", w["assessed"], tested, total, "requirements evaluated / all requirements"),
        level_metrics[0], level_metrics[1], level_metrics[2],
        _cm("evidence", "Evidence-backed", w["evidence"], ev_backed, passed_all,
            "passing requirements with evidence / passing requirements"),
    ]
    content_score = _weighted(content_metrics)
    if tested == 0:
        content_score = None  # nothing assessed yet → "not started", not a red 0

    # Level achieved: highest L where every requirement at that level passes
    # (strict — includes N/A + untested in the denominator, matching the tab).
    achieved = 0
    for L in (1, 2, 3):
        c = lv_counts[L]
        if c["total"] > 0 and c["passed"] == c["total"]:
            achieved = L
        else:
            break

    # SLA dimension (own score): gaps = failed requirements + remediation records.
    gaps = [it for it in items
            if getattr(it, "remediation_status", None) in ("open", "in_progress", "closed")
            or st(it) == "not_complied"]

    return {
        "content": {"score": content_score, "metrics": content_metrics, "level_achieved": achieved,
                    "weights": w,  # effective (defaults + tenant override) — editable in the UI
                    "counts": {"requirements": total, "tested": tested, "passed": passed_all,
                               "evidence_backed": ev_backed, "levels": lv_counts}},
        "sla": sla_dimension(gaps, policy, now),
    }


# ------------------------------------------------------------------- MATURITY
# One formula for the whole maturity family: CSIR, CTI, IT Security Operations,
# Incident Management, Digital Operations, generic xlsx maturity, and PDPL.
# Items carry a maturity_score (0-5), an optional per-item "Weighting: N" and an
# optional per-item "Target: N" in remarks. Score = coverage + weighted average
# maturity + % at/above target.
DEFAULT_MATURITY_WEIGHTS = {"scored": 0.20, "maturity": 0.50, "at_target": 0.30}
MATURITY_SCALE_MAX = 5
DEFAULT_MATURITY_TARGET = 3  # "Defined/Managed" — editable per tenant


def score_maturity(doc, items, policy, now, weights=None, target=None):
    """Score one maturity assessment. Returns content (coverage + weighted mean
    maturity + at-target) and a separate SLA dimension over below-target gaps."""
    w = _merge_weights(DEFAULT_MATURITY_WEIGHTS, weights)
    tgt_default = float(target) if target else DEFAULT_MATURITY_TARGET

    total = len(items)
    scored = [it for it in items if it.maturity_score is not None]

    sum_w = sum_mw = 0.0
    at_target = 0
    for it in scored:
        wt = _parse_num(it.remarks, "Weighting", 1.0) or 1.0
        ms = float(it.maturity_score)
        sum_w += wt
        sum_mw += ms * wt
        itgt = _parse_num(it.remarks, "Target", None) or tgt_default
        if ms >= itgt:
            at_target += 1
    avg = (sum_mw / sum_w) if sum_w else None
    maturity_pct = round(avg / MATURITY_SCALE_MAX * 100, 1) if avg is not None else None

    content_metrics = [
        _cm("scored", "Scored", w["scored"], len(scored), total,
            "capabilities scored / all capabilities"),
        {"key": "maturity", "label": "Maturity attained", "weight": w["maturity"],
         "score": maturity_pct, "numerator": round(avg, 2) if avg is not None else None,
         "denominator": MATURITY_SCALE_MAX, "target": TARGET,
         "formula": f"weighted average maturity (0-{MATURITY_SCALE_MAX}) as % of scale"},
        _cm("at_target", "At target level", w["at_target"], at_target, len(scored),
            f"capabilities at/above target ({int(tgt_default)}/{MATURITY_SCALE_MAX}) / scored capabilities"),
    ]
    content_score = _weighted(content_metrics)
    if not scored:
        content_score = None  # nothing scored yet → "not started", not a red 0

    # SLA dimension: improvement gaps = scored capabilities below their target,
    # plus anything with a remediation record.
    def _below_target(it):
        if it.maturity_score is None:
            return False
        itgt = _parse_num(it.remarks, "Target", None) or tgt_default
        return float(it.maturity_score) < itgt
    gaps = [it for it in items
            if _below_target(it)
            or getattr(it, "remediation_status", None) in ("open", "in_progress", "closed")]

    return {
        "content": {"score": content_score, "metrics": content_metrics,
                    "avg_maturity": round(avg, 1) if avg is not None else None,
                    "target": tgt_default, "weights": w,
                    "counts": {"capabilities": total, "scored": len(scored), "at_target": at_target,
                               "domains": len({it.area_domain for it in items if it.area_domain})}},
        "sla": sla_dimension(gaps, policy, now),
    }


# --------------------------------------------------- IT SECURITY OPERATIONS
# Distinctive features: each capability is scored against ITS OWN target (not an
# absolute scale), and capabilities span 4 dimensions (People/Process/Technology/
# Policy) across domains — so the score is target-relative and we surface where
# the gap is (which dimension / domain lags).
DEFAULT_ITSECOPS_WEIGHTS = {"assessed": 0.20, "target_attainment": 0.50, "at_target": 0.30}
_DIM_RE = re.compile(r"Dimension:\s*([A-Za-z/ ]+)", re.I)


def _dimension(it):
    m = _DIM_RE.search(getattr(it, "remarks", "") or "")
    return (m.group(1).strip() if m else (getattr(it, "subdomain_name", None) or "Other")).title()


def score_itsecops(doc, items, policy, now, weights=None, target=None):
    w = _merge_weights(DEFAULT_ITSECOPS_WEIGHTS, weights)
    tgt_default = float(target) if target else DEFAULT_MATURITY_TARGET

    def itgt(it):
        return _parse_num(it.remarks, "Target", None) or tgt_default

    total = len(items)
    scored = [it for it in items if it.maturity_score is not None]
    sum_cur = sum(float(it.maturity_score) for it in scored)
    sum_tgt = sum(itgt(it) for it in scored)
    at_target = sum(1 for it in scored if float(it.maturity_score) >= itgt(it))
    attainment = round(min(100.0, sum_cur / sum_tgt * 100), 1) if sum_tgt else None
    avg_cur = round(sum_cur / len(scored), 1) if scored else None
    avg_tgt = round(sum_tgt / len(scored), 1) if scored else None

    content_metrics = [
        _cm("assessed", "Assessed", w["assessed"], len(scored), total,
            "capabilities scored / all capabilities"),
        {"key": "target_attainment", "label": "Target attainment", "weight": w["target_attainment"],
         "score": attainment, "numerator": avg_cur, "denominator": avg_tgt, "target": TARGET,
         "formula": "average current maturity / average target maturity (capped at 100%)"},
        _cm("at_target", "At target", w["at_target"], at_target, len(scored),
            "capabilities meeting their own target / scored capabilities"),
    ]
    content_score = _weighted(content_metrics)
    if not scored:
        content_score = None

    # Breakdowns for the detail popup — where the maturity gap sits.
    def _avg_by(keyfn):
        agg = {}
        for it in scored:
            agg.setdefault(keyfn(it), []).append(float(it.maturity_score))
        return {k: round(sum(v) / len(v), 1) for k, v in sorted(agg.items())}
    by_dimension = _avg_by(_dimension)
    by_domain = _avg_by(lambda it: it.area_domain or "Other")

    gaps = [it for it in items if it.maturity_score is not None and float(it.maturity_score) < itgt(it)]
    return {
        "content": {"score": content_score, "metrics": content_metrics,
                    "avg_current": avg_cur, "avg_target": avg_tgt, "weights": w,
                    "by_dimension": by_dimension, "by_domain": by_domain,
                    "counts": {"capabilities": total, "scored": len(scored), "at_target": at_target,
                               "domains": len({it.area_domain for it in items if it.area_domain}),
                               "dimensions": len(by_dimension)}},
        "sla": sla_dimension(gaps, policy, now),
    }


# ----------------------------------------------------------------- SAUDI PDPL
# Distinctive features: 14 privacy domains, maturity 0-5 where "compliant" = >= 3
# (PDPL rule), and a remediation-plan workflow for the gaps (controls < 3). Leads
# with the compliance verdict + per-domain breakdown; gaps feed remediation/SLA.
DEFAULT_PDPL_WEIGHTS = {"assessed": 0.15, "compliant": 0.55, "maturity": 0.30}
PDPL_COMPLIANT_THRESHOLD = 3  # editable per tenant


def score_pdpl(doc, items, policy, now, weights=None, threshold=None):
    w = _merge_weights(DEFAULT_PDPL_WEIGHTS, weights)
    thr = float(threshold) if threshold else PDPL_COMPLIANT_THRESHOLD
    total = len(items)
    scored = [it for it in items if it.maturity_score is not None]
    compliant = sum(1 for it in scored if float(it.maturity_score) >= thr)
    avg = round(sum(float(it.maturity_score) for it in scored) / len(scored), 2) if scored else None
    maturity_pct = round(avg / 5 * 100, 1) if avg is not None else None

    content_metrics = [
        _cm("assessed", "Assessed", w["assessed"], len(scored), total, "controls assessed / all controls"),
        _cm("compliant", "Compliant", w["compliant"], compliant, len(scored),
            f"controls at/above the compliant bar ({int(thr)}/5) / assessed controls"),
        {"key": "maturity", "label": "Maturity depth", "weight": w["maturity"], "score": maturity_pct,
         "numerator": avg, "denominator": 5, "target": TARGET, "formula": "average maturity (0-5) as % of scale"},
    ]
    content_score = _weighted(content_metrics)
    if not scored:
        content_score = None

    # per-domain compliance (aligns with the PDPL dashboard's "compliance by domain")
    dom_agg = {}
    for it in scored:
        a = dom_agg.setdefault(it.area_domain or "Other", [0, 0])
        a[0] += 1
        if float(it.maturity_score) >= thr:
            a[1] += 1
    by_domain = {d: {"scored": a[0], "compliant": a[1],
                     "pct": round(a[1] / a[0] * 100, 1) if a[0] else None}
                 for d, a in sorted(dom_agg.items())}
    risk_spread = {}
    for it in items:
        rr = (it.risk_rating or "").strip()
        if rr:
            risk_spread[rr] = risk_spread.get(rr, 0) + 1

    # gaps = controls below the compliant bar → the remediation plan
    gaps = [it for it in items
            if (it.maturity_score is not None and float(it.maturity_score) < thr)
            or getattr(it, "remediation_status", None) in ("open", "in_progress", "closed")]
    return {
        "content": {"score": content_score, "metrics": content_metrics,
                    "avg_maturity": round(avg, 1) if avg is not None else None,
                    "threshold": thr, "weights": w, "by_domain": by_domain, "risk_spread": risk_spread,
                    "counts": {"controls": total, "scored": len(scored), "compliant": compliant,
                               "domains": len(dom_agg), "gaps": len(gaps)}},
        "sla": sla_dimension(gaps, policy, now),
    }


# ------------------------------------------------------------------ CHECKLIST
# Generic pass/fail verification checklists: Mobile (MASVS), OWASP Testing, NCA
# DCC. (ASVS has its own richer scorer with L1/L2/L3 above.)
DEFAULT_CHECKLIST_WEIGHTS = {"assessed": 0.30, "passed": 0.50, "evidence": 0.20}


def score_checklist(doc, items, evidence_counts, policy, now, weights=None):
    w = _merge_weights(DEFAULT_CHECKLIST_WEIGHTS, weights)

    def st(it):
        return getattr(it, "compliance_status", "in_progress") or "in_progress"
    total = len(items)
    tested = sum(1 for it in items if st(it) != "in_progress")
    applicable = [it for it in items if st(it) != "na"]
    passed = sum(1 for it in applicable if st(it) == "complied")
    ev_backed = sum(1 for it in items if st(it) == "complied" and evidence_counts.get(it.id, 0) > 0)

    metrics = [
        _cm("assessed", "Assessed", w["assessed"], tested, total, "items evaluated / all items"),
        _cm("passed", "Passed", w["passed"], passed, len(applicable),
            "items passing / applicable items (excl. N/A)"),
        _cm("evidence", "Evidence-backed", w["evidence"], ev_backed, passed,
            "passing items with evidence / passing items"),
    ]
    content_score = _weighted(metrics)
    if tested == 0:
        content_score = None
    gaps = [it for it in items
            if getattr(it, "remediation_status", None) in ("open", "in_progress", "closed")
            or st(it) == "not_complied"]
    return {"content": {"score": content_score, "metrics": metrics, "weights": w,
                        "counts": {"items": total, "tested": tested, "passed": passed,
                                   "domains": len({it.area_domain for it in items if it.area_domain})}},
            "sla": sla_dimension(gaps, policy, now)}


# --------------------------------------------------------------- NCA DCC
# Saudi NCA Data Cybersecurity Controls: Essential (core, mandatory) vs Sub
# controls. Essential implementation weighs more than sub-controls.
DEFAULT_DCC_WEIGHTS = {"assessed": 0.15, "essential": 0.55, "sub": 0.30}


def _dcc_essential(it):
    ct = (getattr(it, "control_type", "") or "").lower()
    if ct:
        return ct in ("basic", "essential")
    return (getattr(it, "priority", "") or "").lower() == "high"


def score_dcc(doc, items, evidence_counts, policy, now, weights=None):
    w = _merge_weights(DEFAULT_DCC_WEIGHTS, weights)

    def st(it):
        return getattr(it, "compliance_status", "in_progress") or "in_progress"
    total = len(items)
    tested = sum(1 for it in items if st(it) != "in_progress")

    def grp(pred):
        appl = [it for it in items if pred(it) and st(it) != "na"]
        return sum(1 for it in appl if st(it) == "complied"), len(appl)
    ep, ea = grp(_dcc_essential)
    sp, sa = grp(lambda it: not _dcc_essential(it))

    metrics = [
        _cm("assessed", "Assessed", w["assessed"], tested, total, "controls evaluated / all controls"),
        _cm("essential", "Essential implemented", w["essential"], ep, ea,
            "essential controls implemented / essential applicable"),
        _cm("sub", "Sub-controls implemented", w["sub"], sp, sa,
            "sub-controls implemented / sub applicable"),
    ]
    content_score = _weighted(metrics)
    if tested == 0:
        content_score = None
    gaps = [it for it in items if st(it) == "not_complied"
            or getattr(it, "remediation_status", None) in ("open", "in_progress", "closed")]
    return {"content": {"score": content_score, "metrics": metrics, "weights": w,
                        "counts": {"controls": total, "tested": tested, "essential": ea, "sub": sa,
                                   "domains": len({it.area_domain for it in items if it.area_domain})}},
            "sla": sla_dimension(gaps, policy, now)}


# ----------------------------------------------------------- MOBILE (MASVS)
# Distinctive features: MASVS levels are MULTI-valued per requirement (L1, L2,
# Resilience) and everything is verified per PLATFORM (iOS / Android). Score =
# coverage + per-level verified, with a per-platform breakdown.
DEFAULT_MOBILE_WEIGHTS = {"assessed": 0.15, "l1": 0.35, "l2": 0.30, "resilience": 0.20}
_PLAT_RE = re.compile(r"Platform:\s*([A-Za-z ]+)", re.I)
_MASVS_RE = re.compile(r"MASVS:\s*([LR0-9,\s]+)", re.I)


def _mobile_levels(it):
    m = _MASVS_RE.search(getattr(it, "remarks", "") or "")
    out = set()
    if m:
        for p in re.split(r"[,\s]+", m.group(1).strip()):
            p = p.upper()
            if p in ("L1", "1"):
                out.add("L1")
            elif p in ("L2", "2"):
                out.add("L2")
            elif p in ("R", "RESILIENCE", "L3"):
                out.add("R")
    return out


def _platform(it):
    m = _PLAT_RE.search(getattr(it, "remarks", "") or "")
    return (m.group(1).strip().title() if m else (getattr(it, "subdomain_name", None) or "General"))


def score_mobile(doc, items, evidence_counts, policy, now, weights=None):
    w = _merge_weights(DEFAULT_MOBILE_WEIGHTS, weights)

    def st(it):
        return getattr(it, "compliance_status", "in_progress") or "in_progress"
    total = len(items)
    tested = sum(1 for it in items if st(it) != "in_progress")

    lv_counts, level_metrics = {}, []
    for key, label, lv, wt in (("l1", "L1 verified", "L1", w["l1"]),
                               ("l2", "L2 verified", "L2", w["l2"]),
                               ("resilience", "Resilience verified", "R", w["resilience"])):
        appl = [it for it in items if lv in _mobile_levels(it) and st(it) != "na"]
        passed = sum(1 for it in appl if st(it) == "complied")
        lv_counts[lv] = {"applicable": len(appl), "passed": passed}
        level_metrics.append(_cm(key, label, wt, passed, len(appl),
                                 f"{lv} requirements passing / {lv} applicable (excl. N/A)"))
    content_metrics = [_cm("assessed", "Assessed", w["assessed"], tested, total,
                           "requirements evaluated / all requirements")] + level_metrics
    content_score = _weighted(content_metrics)
    if tested == 0:
        content_score = None

    plat_agg = {}
    for it in items:
        if st(it) == "na":
            continue
        a = plat_agg.setdefault(_platform(it), [0, 0])
        a[0] += 1
        if st(it) == "complied":
            a[1] += 1
    by_platform = {p: {"applicable": a[0], "passed": a[1],
                       "pct": round(a[1] / a[0] * 100, 1) if a[0] else None}
                   for p, a in sorted(plat_agg.items())}

    gaps = [it for it in items if st(it) == "not_complied"
            or getattr(it, "remediation_status", None) in ("open", "in_progress", "closed")]
    return {"content": {"score": content_score, "metrics": content_metrics, "weights": w,
                        "by_platform": by_platform,
                        "counts": {"requirements": total, "tested": tested, "platforms": len(plat_agg),
                                   "levels": lv_counts,
                                   "domains": len({it.area_domain for it in items if it.area_domain})}},
            "sla": sla_dimension(gaps, policy, now)}


# -------------------------------------------------------------- RISK REGISTER
# DPIA/PIA, NCA Risk, NCA Vuln — items carry a risk_rating; "treated" = resolved.
DEFAULT_RISK_WEIGHTS = {"rated": 0.20, "treated": 0.40, "severe_treated": 0.40}
_SEVERE = {"high", "critical", "very high"}


def _resolved(it):
    s = (getattr(it, "compliance_status", "") or "").lower()
    return s in ("complied", "na") or getattr(it, "remediation_status", None) == "closed"


def score_risk_register(doc, items, policy, now, weights=None):
    w = _merge_weights(DEFAULT_RISK_WEIGHTS, weights)
    total = len(items)
    rated = [it for it in items if (it.risk_rating or "").strip()]
    severe = [it for it in items if (it.risk_rating or "").strip().lower() in _SEVERE]
    treated = sum(1 for it in items if _resolved(it))
    severe_treated = sum(1 for it in severe if _resolved(it))

    metrics = [
        _cm("rated", "Risk-rated", w["rated"], len(rated), total, "risks with a severity rating / all risks"),
        _cm("treated", "Treated", w["treated"], treated, total, "risks resolved / all risks"),
        _cm("severe_treated", "Severe risks treated", w["severe_treated"], severe_treated, len(severe),
            "high/critical risks resolved / all high/critical risks", empty=None),
    ]
    content_score = _weighted(metrics)
    if total == 0:
        content_score = None
    # SLA universe = risks with a remediation record (open OR closed) so closure
    # rate is meaningful; plus any still-unresolved risk.
    gaps = [it for it in items
            if getattr(it, "remediation_status", None) in ("open", "in_progress", "closed")
            or not _resolved(it)]
    return {"content": {"score": content_score, "metrics": metrics, "weights": w,
                        "counts": {"risks": total, "rated": len(rated), "severe": len(severe),
                                   "treated": treated, "severe_treated": severe_treated}},
            "sla": sla_dimension(gaps, policy, now)}


# ------------------------------------------------------------ NCA RISK (depth)
# NCA Risk Register carries inherent AND residual ratings (residual = the
# "Updated ... Rating" in the row JSON stored in remarks). Distinctive metric:
# how much risk treatment has REDUCED exposure (inherent -> residual).
RATING_NUM = {"very low": 1, "low": 2, "medium": 3, "high": 4, "very high": 5, "critical": 5}
DEFAULT_NCA_RISK_WEIGHTS = {"rated": 0.15, "treated": 0.30, "severe_controlled": 0.30, "residual_reduction": 0.25}


def _rating_num(s):
    return RATING_NUM.get((s or "").strip().lower())


def _row_json(it):
    r = (getattr(it, "remarks", "") or "").strip()
    if r.startswith("{"):
        try:
            return json.loads(r)
        except Exception:
            return {}
    return {}


def _residual_num(it):
    d = _row_json(it)
    for k, v in d.items():
        kl = k.lower()
        if ("residual" in kl or "updated" in kl) and "rating" in kl:
            return _rating_num(v)
    return None


def score_nca_risk(doc, items, policy, now, weights=None):
    w = _merge_weights(DEFAULT_NCA_RISK_WEIGHTS, weights)
    total = len(items)
    rated = [it for it in items if (it.risk_rating or "").strip()]

    def inh(it):
        return _rating_num(it.risk_rating)
    severe = [it for it in items if (inh(it) or 0) >= 4]  # High/Critical inherent
    treated = sum(1 for it in items if _resolved(it))
    severe_ctrl = sum(1 for it in severe if _resolved(it) or ((_residual_num(it) or 5) < 4))
    both = [(inh(it), _residual_num(it)) for it in items if inh(it) and _residual_num(it) is not None]
    si = sum(i for i, _ in both)
    sr = sum(r for _, r in both)
    reduction = round((si - sr) / si * 100, 1) if si else None

    metrics = [
        _cm("rated", "Risk-rated", w["rated"], len(rated), total, "risks with a severity rating / all risks"),
        _cm("treated", "Treated", w["treated"], treated, total, "risks resolved / all risks"),
        _cm("severe_controlled", "Severe risks controlled", w["severe_controlled"], severe_ctrl, len(severe),
            "high/critical risks resolved or reduced below severe / all high/critical", empty=None),
        {"key": "residual_reduction", "label": "Residual reduction", "weight": w["residual_reduction"],
         "score": reduction, "numerator": (si - sr) if both else None, "denominator": si if both else None,
         "target": TARGET, "formula": "(total inherent - total residual) / total inherent, over treated risks"},
    ]
    content_score = _weighted(metrics)
    if total == 0:
        content_score = None
    gaps = [it for it in items
            if getattr(it, "remediation_status", None) in ("open", "in_progress", "closed")
            or not _resolved(it)]
    return {"content": {"score": content_score, "metrics": metrics, "weights": w,
                        "counts": {"risks": total, "rated": len(rated), "severe": len(severe),
                                   "treated": treated, "with_residual": len(both)}},
            "sla": sla_dimension(gaps, policy, now)}


# ------------------------------------------------------------- NCA VULN (depth)
# Vulnerability register carries real CVE + CVSS (0-10) + Status + Due/Resolution
# in the row JSON. Distinctive depth: severity is CVSS-driven and the priority is
# getting the HIGH-severity (CVSS >= 7) vulns remediated.
DEFAULT_VULN_WEIGHTS = {"triaged": 0.15, "remediated": 0.35, "severe_remediated": 0.50}


def _cvss(it):
    d = _row_json(it)
    for k, v in d.items():
        if "cvss" in k.lower() or "cve score" in k.lower():
            m = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*$", str(v).strip())
            if m:
                try:
                    return float(m.group(1))
                except ValueError:
                    return None
    return None


def _vuln_resolved(it):
    s = (_row_json(it).get("Status", "") or "").upper()
    return (s == "RESOLVED" or getattr(it, "compliance_status", "") == "complied"
            or getattr(it, "remediation_status", None) == "closed")


def _vuln_severe(it):
    c = _cvss(it)
    if c is not None:
        return c >= 7.0
    return (it.risk_rating or "").strip().lower() in ("high", "critical", "very high")


def score_nca_vuln(doc, items, policy, now, weights=None):
    w = _merge_weights(DEFAULT_VULN_WEIGHTS, weights)
    total = len(items)
    triaged = [it for it in items if _cvss(it) is not None or (it.risk_rating or "").strip()]
    resolved = sum(1 for it in items if _vuln_resolved(it))
    severe = [it for it in items if _vuln_severe(it)]
    severe_res = sum(1 for it in severe if _vuln_resolved(it))
    open_cvss = [_cvss(it) for it in items if not _vuln_resolved(it) and _cvss(it) is not None]

    metrics = [
        _cm("triaged", "Triaged", w["triaged"], len(triaged), total,
            "vulnerabilities with a severity/CVSS / all"),
        _cm("remediated", "Remediated", w["remediated"], resolved, total,
            "vulnerabilities resolved / all"),
        _cm("severe_remediated", "Critical/High remediated", w["severe_remediated"], severe_res, len(severe),
            "high-severity (CVSS >= 7) vulnerabilities resolved / all high-severity", empty=None),
    ]
    content_score = _weighted(metrics)
    if total == 0:
        content_score = None
    gaps = [it for it in items if not _vuln_resolved(it)
            or getattr(it, "remediation_status", None) in ("open", "in_progress", "closed")]
    return {"content": {"score": content_score, "metrics": metrics, "weights": w,
                        "counts": {"vulnerabilities": total, "resolved": resolved, "severe": len(severe),
                                   "severe_resolved": severe_res,
                                   "avg_open_cvss": round(sum(open_cvss) / len(open_cvss), 1) if open_cvss else None}},
            "sla": sla_dimension(gaps, policy, now)}


# --------------------------------------------------------------- DPIA / PIA
# A DPIA workbook mixes 3 sections: screening (S-), narrative assessment (A-),
# and the actual risk register (R-). Only the RISK rows should be scored — on
# likelihood×impact inherent -> residual reduction. (Scoring all rows was the bug
# that produced the misleading ~1.)
DEFAULT_DPIA_WEIGHTS = {"rated": 0.15, "residual_reduction": 0.45, "high_controlled": 0.40}


def _dpia_kv(rem, key):
    m = re.search(rf"(?:^|\|)\s*{key}:\s*([^|]+)", rem or "", re.I)
    return m.group(1).strip() if m else None


def _dpia_num(rem, key):
    v = _dpia_kv(rem, key)
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _is_dpia_risk(it):
    return (it.item_number or "").upper().startswith("R-") or "section: risk" in (it.remarks or "").lower()


def score_dpia(doc, items, policy, now, weights=None):
    w = _merge_weights(DEFAULT_DPIA_WEIGHTS, weights)
    risks = [it for it in items if _is_dpia_risk(it)]
    screening = [it for it in items if (it.item_number or "").upper().startswith("S-")]
    total_r = len(risks)
    rated = [it for it in risks if (it.risk_rating or "").strip() or _dpia_kv(it.remarks, "InherentRating")]
    both = [(_dpia_num(it.remarks, "Inherent"), _dpia_num(it.remarks, "Residual")) for it in risks]
    both = [(a, b) for a, b in both if a is not None and b is not None]
    si = sum(a for a, _ in both)
    sr = sum(b for _, b in both)
    reduction = round((si - sr) / si * 100, 1) if si else None
    severe = [it for it in risks if (_dpia_num(it.remarks, "Inherent") or 0) >= 12]

    def _ctrl(it):
        res = _dpia_num(it.remarks, "Residual")
        return _resolved(it) or (res is not None and res < 12)
    high_ctrl = sum(1 for it in severe if _ctrl(it))

    metrics = [
        _cm("rated", "Risks rated", w["rated"], len(rated), total_r,
            "risks with an inherent rating / all identified risks"),
        {"key": "residual_reduction", "label": "Residual risk reduction", "weight": w["residual_reduction"],
         "score": reduction, "numerator": round(si - sr, 1) if both else None,
         "denominator": round(si, 1) if both else None, "target": TARGET,
         "formula": "(total inherent L×I - total residual L×I) / total inherent"},
        _cm("high_controlled", "High risks controlled", w["high_controlled"], high_ctrl, len(severe),
            "inherent high/critical risks reduced below high or resolved / all inherent high/critical", empty=None),
    ]
    content_score = _weighted(metrics)
    if total_r == 0:
        content_score = None
    gaps = [it for it in risks if not _resolved(it)
            or getattr(it, "remediation_status", None) in ("open", "in_progress", "closed")]
    return {"content": {"score": content_score, "metrics": metrics, "weights": w,
                        "counts": {"risks": total_r, "rated": len(rated), "severe": len(severe),
                                   "screening": len(screening),
                                   "screening_done": sum(1 for it in screening if it.compliance_status != "in_progress")}},
            "sla": sla_dimension(gaps, policy, now)}


# ------------------------------------------------------------------- TRACKING
# NCA Audit Plan (completion) + KPI Report (reporting). Lightweight — enriched
# with target-vs-actual parsing later.
DEFAULT_TRACKING_WEIGHTS = {"underway": 0.40, "completed": 0.60}


def score_tracking(doc, items, policy, now, weights=None):
    w = _merge_weights(DEFAULT_TRACKING_WEIGHTS, weights)

    def st(it):
        return getattr(it, "compliance_status", "in_progress") or "in_progress"
    total = len(items)
    underway = sum(1 for it in items if st(it) != "in_progress")
    completed = sum(1 for it in items if st(it) in ("complied", "na"))
    metrics = [
        _cm("underway", "Underway", w["underway"], underway, total, "items started / all items"),
        _cm("completed", "Completed", w["completed"], completed, total, "items completed / all items"),
    ]
    content_score = _weighted(metrics)
    if underway == 0:
        content_score = None
    gaps = [it for it in items if st(it) not in ("complied", "na")]
    return {"content": {"score": content_score, "metrics": metrics, "weights": w,
                        "counts": {"items": total, "underway": underway, "completed": completed}},
            "sla": sla_dimension(gaps, policy, now)}


# ------------------------------------------------------------ AUDIT PLAN (depth)
# Distinctive features: planned audits with a Status (planned/in progress/
# completed) and a schedule (end date). Score = execution progress + schedule
# adherence.
DEFAULT_AUDIT_WEIGHTS = {"underway": 0.25, "completed": 0.45, "on_schedule": 0.30}


def _audit_status(it):
    s = (_row_json(it).get("Status", "") or "").strip().lower()
    if s:
        return s
    cs = (getattr(it, "compliance_status", "") or "").lower()
    return {"complied": "completed", "in_progress": "planned"}.get(cs, cs)


def score_audit(doc, items, policy, now, weights=None):
    w = _merge_weights(DEFAULT_AUDIT_WEIGHTS, weights)
    total = len(items)

    def done(it):
        return _audit_status(it) in ("completed", "complete", "done", "closed")

    def started(it):
        return done(it) or _audit_status(it) in ("in progress", "in_progress", "ongoing", "underway")
    completed = sum(1 for it in items if done(it))
    underway = sum(1 for it in items if started(it))

    on_sched = sched_universe = 0
    for it in items:
        ed = getattr(it, "target_date", None)
        if ed is None:
            continue
        sched_universe += 1
        if done(it):
            ca = getattr(it, "closed_at", None)
            if ca is None or ca <= ed:
                on_sched += 1
        elif ed >= now:
            on_sched += 1

    metrics = [
        _cm("underway", "Underway", w["underway"], underway, total, "audits started or completed / all planned"),
        _cm("completed", "Completed", w["completed"], completed, total, "audits completed / all planned"),
        _cm("on_schedule", "On schedule", w["on_schedule"], on_sched, sched_universe,
            "audits on/before their planned end / audits with a schedule", empty=100),
    ]
    content_score = _weighted(metrics)
    if total == 0 or underway == 0:
        content_score = None
    gaps = [it for it in items if not done(it)
            or getattr(it, "remediation_status", None) in ("open", "in_progress", "closed")]
    return {"content": {"score": content_score, "metrics": metrics, "weights": w,
                        "counts": {"audits": total, "completed": completed, "underway": underway}},
            "sla": sla_dimension(gaps, policy, now)}


# --------------------------------------------------------------- DISPATCH/MAP
# Which family scores each format, and which category it belongs to on the
# overview. ubl_audit_master_tracking is intentionally EXCLUDED (user decision).
FAMILY = {
    "asvs_checklist": "asvs",
    "mobile_app_security": "checklist", "owasp_v4_testing_checklist": "checklist", "nca_dcc_tool": "checklist",
    "csir_maturity": "maturity", "cti_maturity": "maturity", "itsecops_maturity": "maturity",
    "incident_maturity": "maturity", "digital_ops_maturity": "maturity", "xlsx_maturity": "maturity",
    "pdpl_assessment_toolkit": "maturity",
    "dpia_pia": "risk", "nca_risk_register": "risk", "nca_vuln_register": "risk",
    "nca_audit_register": "tracking",
    # PDF-uploaded control checklists — previously unmapped, so they hit the
    # `fam is None` path and were silently dropped from the board. Scored as
    # checklists (pass/fail control items) so they're represented, not invisible.
    "cis_windows_server_2012_r2_pdf": "checklist",
    "nca_cloud_cybersecurity_controls_pdf": "checklist",
    "nca_data_cybersecurity_controls_pdf": "checklist",
}
# KPI Report is a reporting tool, not a scored assessment (user decision);
# Internal Audit + container + generic are also not part of this module.
EXCLUDED_FORMATS = {"ubl_audit_master_tracking", "nca_container", "standard", "kpi_report"}
CATEGORY = {
    "asvs_checklist": "Cyber Security", "mobile_app_security": "Cyber Security",
    "owasp_v4_testing_checklist": "Cyber Security", "csir_maturity": "Cyber Security",
    "cti_maturity": "Cyber Security", "incident_maturity": "Cyber Security",
    "itsecops_maturity": "Cyber Security",
    "nca_dcc_tool": "NCA", "nca_vuln_register": "NCA", "nca_audit_register": "NCA", "nca_risk_register": "NCA",
    "nca_cloud_cybersecurity_controls_pdf": "NCA", "nca_data_cybersecurity_controls_pdf": "NCA",
    "cis_windows_server_2012_r2_pdf": "Cyber Security",
    "digital_ops_maturity": "Digital Operations", "xlsx_maturity": "Digital Operations",
    "dpia_pia": "Privacy & Data", "pdpl_assessment_toolkit": "Privacy & Data",
}
# What each family calls its items (terminology cleanup — user request).
ITEM_NOUN = {"asvs": "requirements", "checklist": "items", "maturity": "capabilities",
             "risk": "risks", "tracking": "items"}


def score_assessment(doc, items, evidence_counts, policy, now, weights=None):
    """Route one assessment to its family scorer. Returns None for excluded
    formats. `weights` is an optional per-format override dict."""
    fmt = doc.assessment_format
    fam = FAMILY.get(fmt)
    if fmt in EXCLUDED_FORMATS or fam is None:
        return None
    if fam == "asvs":
        res = score_asvs(doc, items, evidence_counts, policy, now, weights)
    elif fam == "checklist":
        if fmt == "mobile_app_security":
            res = score_mobile(doc, items, evidence_counts, policy, now, weights)
        elif fmt == "nca_dcc_tool":
            res = score_dcc(doc, items, evidence_counts, policy, now, weights)
        else:
            res = score_checklist(doc, items, evidence_counts, policy, now, weights)
    elif fam == "maturity":
        if fmt == "itsecops_maturity":
            res = score_itsecops(doc, items, policy, now, weights)
        elif fmt == "pdpl_assessment_toolkit":
            res = score_pdpl(doc, items, policy, now, weights)
        else:
            res = score_maturity(doc, items, policy, now, weights)
    elif fam == "risk":
        if fmt == "nca_risk_register":
            res = score_nca_risk(doc, items, policy, now, weights)
        elif fmt == "nca_vuln_register":
            res = score_nca_vuln(doc, items, policy, now, weights)
        elif fmt == "dpia_pia":
            res = score_dpia(doc, items, policy, now, weights)
        else:
            res = score_risk_register(doc, items, policy, now, weights)
    elif fam == "tracking":
        if fmt == "nca_audit_register":
            res = score_audit(doc, items, policy, now, weights)
        else:
            res = score_tracking(doc, items, policy, now, weights)
    else:
        return None
    res["family"] = fam
    res["category"] = CATEGORY.get(fmt, "Other")
    res["item_noun"] = ITEM_NOUN.get(fam, "items")
    return res
