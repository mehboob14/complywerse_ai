"""Layer 2 — technique selection. ``f(CWE, CVSS vector) -> techniques``.

The layer that makes two vulnerabilities' chains genuinely different. Given one
vuln's CWE(s) and CVSS vector, it selects a subset of the Layer 1 catalogue,
each technique carrying provenance (how it was chosen) and confidence.

Three tiers, unioned — measured coverage, not the reference's framing:

  1. **cvss_derived** — deterministic rules over the parsed vector. This is the
     BACKBONE: it produces the entry-tactic techniques (T1190 / T1210 / T1203 /
     T1204 / T1068) that Layer 4's verdict depends on. Always available when a
     vector is present; the CAPEC chain never yields these.
  2. **capec_chain** — the authoritative CWE->CAPEC->ATT&CK crosswalk
     (``capec_map``). High confidence, but reaches only ~25% of techniques and
     none of the common web-app weaknesses — breadth enrichment, not backbone.
  3. **analyst** — the curated gap-filler (``curated_cwe_map``) that restores
     well-known pairs CAPEC drops (CWE-89 -> T1190).

Pure and DB-free, in the house style of ``enrichment/priority.py``. Same inputs
give the same output (deterministic). Missing vector -> a generic, explicitly
``assumed`` entry chain, so the degenerate case (VULN-37) still produces
something honest for Layer 3 to prune rather than an empty screen.
"""
from __future__ import annotations

import logging
import re
from typing import Dict, List, Optional

from . import capec_map, catalog, cwe_hierarchy
from .curated_cwe_map import CURATED_CWE_TECHNIQUES

logger = logging.getLogger(__name__)

# Source authority, high -> low. When a technique is selected by several tiers,
# the record's headline source is the most authoritative one present.
# capec_via_parent = an ancestor CWE's CAPEC mapping (real standards data, but
# borrowed from a parent, so ranked below an exact CAPEC/analyst hit and above the
# CVSS heuristic).
_SOURCE_RANK = {"capec_chain": 4, "analyst": 3, "capec_via_parent": 2, "cvss_derived": 1}
_CONFIDENCE_RANK = {"high": 3, "medium": 2, "low": 1}

# Recon step attached to every vuln; Layer 3 gates it on network_reachable.
_RECON_TECHNIQUE = "T1595"

# Generic entry chain for a vuln with no CVSS vector to derive from. Marked
# assumed=True so the UI and the roll-up can treat it as low-trust. Mirrors the
# _DEFAULT_VECTOR / attack_vector_assumed convention in enrichment/priority.py.
_ASSUMED_ENTRY = ["T1595", "T1190", "T1203"]


# ──────────────────────────────────────────────────────────────────────────
# CVSS vector parsing (v3.0 / v3.1 / v4.0, and prefix-less stored vectors)
# ──────────────────────────────────────────────────────────────────────────
_METRIC_RE = re.compile(r"\b([A-Z]{1,2}):([A-Z])\b")


def parse_cvss_vector(vector: Optional[str]) -> dict:
    """Parse a CVSS vector string into the metrics the rules read.

    Returns a dict with normalised keys; absent metrics are omitted. Handles:
      * ``CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N``
      * ``CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N``
      * a bare ``AV:N/AC:L/...`` with no ``CVSS:`` prefix

    ``scope_changed`` unifies the two spec generations: v3's ``S:C`` and v4's
    "subsequent system" impact (any of SC/SI/SA != N) both mean the exploit
    crosses a privilege/authorization boundary.
    """
    if not vector or not isinstance(vector, str):
        return {}
    metrics = {k: v for k, v in _METRIC_RE.findall(vector.upper())}
    if not metrics:
        return {}

    version = "4.0" if ("VC" in metrics or "VI" in metrics or "VA" in metrics) else None
    if version is None:
        m = re.search(r"CVSS:(\d+\.\d+)", vector.upper())
        version = m.group(1) if m else ("3.x" if "S" in metrics else "unknown")

    out: dict = {"version": version}
    if "AV" in metrics:
        out["av"] = metrics["AV"]          # N | A | L | P
    if "AC" in metrics:
        out["ac"] = metrics["AC"]          # L | H
    if "PR" in metrics:
        out["pr"] = metrics["PR"]          # N | L | H
    if "UI" in metrics:
        out["ui"] = metrics["UI"]          # N | R  (v4 also A; treated as R)

    # scope / subsequent-impact
    if "S" in metrics:                      # v3
        out["scope_changed"] = metrics["S"] == "C"
    elif version == "4.0":                   # v4 — subsequent-system impact
        out["scope_changed"] = any(metrics.get(k, "N") != "N" for k in ("SC", "SI", "SA"))

    return out


# ──────────────────────────────────────────────────────────────────────────
# The deterministic CVSS-vector rules (the backbone)
# ──────────────────────────────────────────────────────────────────────────
def _cvss_rule_techniques(cvss: dict) -> List[dict]:
    """Fire the vector rules. Each hit -> {technique_id, confidence, metric, why}.

    The rules encode how a CVSS metric implies an attacker technique:
      AV:N  -> reachable code execution over a network  -> T1190, T1210
      AV:A  -> adjacent-network exploitation             -> T1210
      AV:L  -> local vuln, escalation vector             -> T1068
      UI:R  -> victim must act (open/click)              -> T1203, T1204
      scope-change / priv boundary crossed               -> T1068
      network-reachable                                  -> T1595 (recon)
    """
    av = cvss.get("av")
    ui = cvss.get("ui")
    hits: List[dict] = []

    def add(tid: str, confidence: str, metric: str, why: str):
        hits.append({"technique_id": tid, "confidence": confidence, "metric": metric, "why": why})

    if av == "N":
        add("T1190", "high", "AV:N", "network attack vector — exploit of a public-facing application")
        add("T1210", "medium", "AV:N", "network attack vector — exploitation of a remote service")
        add(_RECON_TECHNIQUE, "high", "AV:N", "network-reachable target is scannable")
    elif av == "A":
        add("T1210", "high", "AV:A", "adjacent-network attack vector — exploitation of a remote service")
        add(_RECON_TECHNIQUE, "medium", "AV:A", "adjacent-network target is scannable")
    elif av == "L":
        add("T1068", "high", "AV:L", "local attack vector — exploitation for privilege escalation")
    elif av == "P":
        # Physical access is assumed; no clean network/exec entry technique.
        pass

    if ui == "R" or ui == "A":
        add("T1203", "high", "UI:R", "user interaction required — exploitation for client execution")
        add("T1204", "high", "UI:R", "user interaction required — user execution of attacker content")

    if cvss.get("scope_changed"):
        add("T1068", "medium", "S:C", "scope change crosses a privilege boundary — privilege escalation")

    return hits


# ──────────────────────────────────────────────────────────────────────────
# Merge helper — one technique may be selected by several tiers
# ──────────────────────────────────────────────────────────────────────────
def _stronger(a: Optional[str], b: str, rank: Dict[str, int]) -> str:
    if a is None:
        return b
    return a if rank.get(a, 0) >= rank.get(b, 0) else b


def _merge(selected: Dict[str, dict], technique_id: str, source: str,
           confidence: str, provenance: dict, assumed: bool) -> None:
    """Fold one (technique, source) hit into the accumulator, resolving the
    technique through the Layer 1 catalogue (redirecting revoked, dropping
    deprecated/unknown). A technique from multiple tiers keeps the strongest
    source + confidence and the union of provenance rows.
    """
    tech = catalog.get_technique(technique_id)
    if tech is None:
        logger.debug("selection dropped unknown/deprecated technique %s (source=%s)", technique_id, source)
        return
    tid = tech["technique_id"]
    row = selected.get(tid)
    prov_row = {"source": source, **provenance}
    if row is None:
        selected[tid] = {
            "technique_id": tid,
            "name": tech.get("name"),
            "tactics": tech.get("tactics") or [],
            "order": tech.get("order"),
            "url": tech.get("url"),
            "is_subtechnique": tech.get("is_subtechnique", False),
            "parent": tech.get("parent"),
            "mapping_source": source,
            "mapping_confidence": confidence,
            "assumed": assumed,
            "provenance": [prov_row],
        }
    else:
        row["mapping_source"] = _stronger(row["mapping_source"], source, _SOURCE_RANK)
        row["mapping_confidence"] = _stronger(row["mapping_confidence"], confidence, _CONFIDENCE_RANK)
        # Only stays "assumed" if every contributing source was assumed.
        row["assumed"] = row["assumed"] and assumed
        row["provenance"].append(prov_row)


# ──────────────────────────────────────────────────────────────────────────
# The Layer 2 entry point
# ──────────────────────────────────────────────────────────────────────────
def select_techniques(cwe_ids=None, cvss_vector: Optional[str] = None) -> List[dict]:
    """Select the ATT&CK techniques that apply to one vulnerability.

    Args:
        cwe_ids: a CWE string or an iterable of them ('CWE-89', '89', ...).
                 Accepts the scalar ``Vulnerability.cwe_id`` directly.
        cvss_vector: the full CVSS vector string, or None.

    Returns: a list of technique records, one per distinct technique, sorted in
    kill-chain order (tactic order, then id). Each record carries
    ``mapping_source`` / ``mapping_confidence`` / ``assumed`` and a ``provenance``
    list detailing every tier that selected it. Empty only if the catalogue
    failed to load.
    """
    if cwe_ids is None:
        cwes: List[str] = []
    elif isinstance(cwe_ids, str):
        cwes = [cwe_ids]
    else:
        cwes = [c for c in cwe_ids if c]

    cvss = parse_cvss_vector(cvss_vector)
    selected: Dict[str, dict] = {}

    # Tier 2 — CAPEC standards chain (authoritative breadth)
    for link in capec_map.techniques_for_cwes(cwes):
        _merge(
            selected, link["technique_id"], "capec_chain", "high",
            {"via_capec": link.get("via_capec"), "capec_name": link.get("capec_name"),
             "mapping_fit": link.get("mapping_fit")},
            assumed=False,
        )

    # Tier 2b — ancestor walk. For a CWE with NO direct CAPEC mapping, climb the
    # CWE ChildOf hierarchy to the nearest ancestor that DOES map and borrow its
    # techniques, labelled 'capec_via_parent' with the climb depth and a lower
    # confidence. A child weakness is a specific case of its parent, so this is
    # real MITRE standards data — approximate (the parent is broader), never
    # fabricated. Fires ONLY on a direct miss, so it never overrides an exact hit.
    def _mapped(a: str) -> bool:
        return bool(capec_map.techniques_for_cwe(a))
    for cwe in cwes:
        if capec_map.techniques_for_cwe(cwe):
            continue  # direct CAPEC hit — Tier 2 already covered this CWE
        anc, depth = cwe_hierarchy.walk_to_mapped(cwe, _mapped)
        if not anc:
            continue
        for link in capec_map.techniques_for_cwe(anc):
            _merge(
                selected, link["technique_id"], "capec_via_parent",
                "medium" if depth == 1 else "low",
                {"from_cwe": f"CWE-{capec_map.normalise_cwe(cwe)}",
                 "via_parent_cwe": f"CWE-{anc}", "parent_name": cwe_hierarchy.name(anc),
                 "depth": depth, "via_capec": link.get("via_capec"),
                 "capec_name": link.get("capec_name")},
                assumed=False,
            )

    # Tier 3 — curated gap-filler (deliberate analyst crosswalk)
    for cwe in cwes:
        key = capec_map.normalise_cwe(cwe)
        for tid, confidence, reason in CURATED_CWE_TECHNIQUES.get(key or "", []):
            _merge(selected, tid, "analyst", confidence, {"reason": reason}, assumed=False)

    # Tier 1 — CVSS-vector rules (the backbone: entry-tactic techniques)
    if cvss:
        for hit in _cvss_rule_techniques(cvss):
            _merge(
                selected, hit["technique_id"], "cvss_derived", hit["confidence"],
                {"metric": hit["metric"], "why": hit["why"]},
                assumed=False,
            )
    else:
        # No vector: emit the generic entry chain, explicitly assumed, so the
        # verdict layer has entry-tactic techniques to reason about (Layer 3
        # will most likely BLOCK them for lack of exposure -> honest "unlikely").
        for tid in _ASSUMED_ENTRY:
            _merge(
                selected, tid, "cvss_derived", "low",
                {"metric": None, "why": "no CVSS vector stored — generic entry chain assumed"},
                assumed=True,
            )

    return sorted(
        selected.values(),
        key=lambda r: (r["order"] if r["order"] is not None else 99, r["technique_id"]),
    )


def is_undeterminable(cwe_ids=None, cvss_vector: Optional[str] = None) -> bool:
    """True iff a finding has NO derivation basis — its entire selected chain is
    the assumed no-data fallback: no CWE that maps to a technique AND no CVSS
    vector to derive entry steps from.

    This is the finding-level twin of the verdict engine's `assumed_insufficient`
    entry_state (verdict.derive_viability → 'undeterminable'). It is asset-
    independent by construction (CWE + vector are properties of the vuln, not the
    host), so it is the right predicate for a per-finding coverage split. Defined
    HERE, beside the `assumed` flag it reads, so the engine and choke coverage()
    can never drift on what 'undeterminable' means.

    Applied to UNVIABLE findings it isolates exactly the assumed_insufficient
    case: a fully-assumed chain that were corroborated (KEV / public exploit)
    would have rolled up viable, so among the unviable it is always the honest
    data-gap default — the only state where enrichment is even a coherent lever.
    """
    techs = select_techniques(cwe_ids, cvss_vector)
    return bool(techs) and all(t.get("assumed") for t in techs)


def selection_summary(cwe_ids=None, cvss_vector: Optional[str] = None) -> dict:
    """Convenience wrapper: the technique list plus a compact provenance tally,
    for an endpoint or a debug view.
    """
    techniques = select_techniques(cwe_ids, cvss_vector)
    by_source: Dict[str, int] = {}
    for t in techniques:
        by_source[t["mapping_source"]] = by_source.get(t["mapping_source"], 0) + 1
    return {
        "count": len(techniques),
        "by_source": by_source,
        "any_assumed": any(t["assumed"] for t in techniques),
        "cvss_parsed": parse_cvss_vector(cvss_vector),
        "techniques": techniques,
    }


# Threshold for the register's "High tactics" filter / dashboard tile.
# Empirically: richest-with-exploit findings in this product sit at ≥7 distinct
# ATT&CK tactics; below that the chain is a short entry/backbone mapping.
HIGH_TACTICS_MIN = 7


def tactic_count(cwe_ids=None, cvss_vector: Optional[str] = None) -> int:
    """How many distinct ATT&CK tactics the selection maps to for one finding.

    Pure and DB-free — same mapping the Exploit Test tab uses (minus reachability
    badges). Used by the register filter and dashboard aggregates.
    """
    tactics = set()
    for t in select_techniques(cwe_ids, cvss_vector):
        for tac in (t.get("tactics") or []):
            if tac:
                tactics.add(tac)
    return len(tactics)


def is_high_tactics(cwe_ids=None, cvss_vector: Optional[str] = None,
                    *, min_tactics: int = HIGH_TACTICS_MIN) -> bool:
    return tactic_count(cwe_ids, cvss_vector) >= min_tactics
