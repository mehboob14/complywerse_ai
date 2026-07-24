"""Layer 5 (presentation) — the reasoning trace the flow view walks.

This module adds NO engine logic. It re-runs the existing pipeline and records the
actual result of each step — including the empties (a CAPEC *miss* is a recorded
`{"hit": False}`, not an omission). Its ``result`` is asserted equal to
``build_view``'s chain + verdict by ``test_attack_trace``, so the animation renders
the trace the engine actually produced and can never drift into a scripted path the
engine did not take.

If a future step needs something the pipeline doesn't already compute, it does NOT
belong here — that would be inventing reasoning. Instrument, never author.
"""
from __future__ import annotations

from typing import List, Optional

from . import capec_map
from .curated_cwe_map import CURATED_CWE_TECHNIQUES
from .selection import (
    parse_cvss_vector,
    _cvss_rule_techniques,
    select_techniques,
    _ASSUMED_ENTRY,
)
from .reachability import build_signals, assess_chain, _is_entry_technique
from .verdict import roll_up


def _cwe_list(cwe_ids) -> List[str]:
    if cwe_ids is None:
        return []
    if isinstance(cwe_ids, str):
        return [cwe_ids]
    return [c for c in cwe_ids if c]


def explain(vuln, asset, *, control_coverage: Optional[float] = None) -> dict:
    """A stage-by-stage trace of how the engine reached its verdict for one
    vuln × asset. Every stage is the ACTUAL output of an existing pipeline call.

    Returns ``{"stages": [...], "result": {"chain": ..., "verdict": ...}}`` where
    ``result`` mirrors ``build_view`` (test-locked). The animation walks ``stages``.
    """
    raw_cwes = getattr(vuln, "cwe_ids", None) or getattr(vuln, "cwe_id", None)
    cwes = _cwe_list(raw_cwes)
    vector = getattr(vuln, "cvss_vector", None)
    cvss = parse_cvss_vector(vector)

    stages: List[dict] = []

    # 1 — classify: CVE -> CWE(s)
    stages.append({
        "stage": "classify",
        "cve": getattr(vuln, "cve_id", None),
        "cwes": cwes,
        "resolved": bool(cwes),
    })

    # 2 — map: per CWE, each mechanism's hit/miss (existing calls, recorded verbatim)
    for cwe in cwes:
        capec_links = capec_map.techniques_for_cwes([cwe])
        key = capec_map.normalise_cwe(cwe)
        curated = CURATED_CWE_TECHNIQUES.get(key or "", [])
        stages.append({
            "stage": "map",
            "cwe": cwe,
            "capec": {"hit": bool(capec_links),
                      "techniques": [l["technique_id"] for l in capec_links]},
            "analyst": {"hit": bool(curated),
                        "techniques": [t[0] for t in curated]},
        })

    # 3 — cvss rules, or the assumed fallback when there is no vector to derive from
    if cvss:
        stages.append({
            "stage": "cvss_rules",
            "vector": vector,
            "parsed": cvss,
            "fired": [{"technique_id": h["technique_id"], "metric": h["metric"], "why": h["why"]}
                      for h in _cvss_rule_techniques(cvss)],
        })
    else:
        stages.append({
            "stage": "assumed",
            "techniques": list(_ASSUMED_ENTRY),
            "note": "no CVSS vector stored — a generic entry chain is assumed (low trust)",
        })

    # 4 — select: the authoritative merged selection, with per-source winner
    selected = select_techniques(raw_cwes, vector)
    stages.append({
        "stage": "select",
        "techniques": [{
            "technique_id": t["technique_id"],
            "name": t.get("name"),
            "tactics": t.get("tactics") or [],
            "order": t.get("order"),
            "sources": [p.get("source") for p in (t.get("provenance") or [])],
            "winner": t.get("mapping_source"),
            "confidence": t.get("mapping_confidence"),
            "assumed": t.get("assumed"),
        } for t in selected],
    })

    # 5 — reachability: badge each technique against the asset's signals
    signals = build_signals(vuln, asset, control_coverage=control_coverage)
    chain = assess_chain(selected, signals)
    stages.append({
        "stage": "reach",
        "signals": {
            "internet_exposed": signals.internet_exposed,
            "network_reachable": signals.network_reachable,
            "cvss_av": signals.cvss_av,
            "cvss_ui": signals.cvss_ui,
            "has_public_exploit": signals.has_public_exploit,
            "exploit_verified": signals.exploit_verified,
            "in_kev": signals.in_kev,
            "patch_applied": signals.patch_applied,
        },
        "badges": [{
            "technique_id": c["technique_id"],
            "status": c["status"],
            "why": c["why"],
            "is_entry": _is_entry_technique(c["technique_id"]),
        } for c in chain],
    })

    # 6 — verdict
    rollup = roll_up(chain, signals)
    stages.append({
        "stage": "verdict",
        "entry_set": [c["technique_id"] for c in chain if _is_entry_technique(c["technique_id"])],
        "verdict": rollup["verdict"],
        "reason": rollup["verdict_reason"],
        "entry_state": rollup["entry_state"],
    })

    # result mirrors build_view's chain + verdict — the equality guarantee (test-locked)
    return {"stages": stages, "result": {"chain": chain, "verdict": rollup}}
