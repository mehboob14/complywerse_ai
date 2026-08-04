"""MITRE ATT&CK exploitability pipeline.

Four layers, each consuming the last:

  1. **catalogue** (`catalog`) — static, shared by every vuln. The ATT&CK
     universe: tactics in kill-chain order, techniques, sub-techniques,
     mitigations. Built offline by `scripts/ingest_attack_catalog.py` from
     MITRE's STIX bundle. *This layer is implemented.*
  2. **selection** — per vuln. `f(CWE, CVSS vector)` picks a subset of the
     catalogue. This is the layer that makes two vulns' chains differ.
  3. **reachability** — per vuln × asset. Badges each selected technique
     POSSIBLE / BLOCKED / LIKELY against the asset's signals.
  4. **roll-up** — per vuln. Collapses the badges into a verdict plus a
     signal percentage, and feeds an adjustment back into the risk score.

Public surface — the Layer 1 read API. Nothing here writes, and nothing here
is tenant-aware; the catalogue is identical everywhere.

Internals (`catalog._install`, the module-level caches) are deliberately not
exported — go through the accessors so the backing store can change without
breaking callers.
"""
from .catalog import (
    CATALOG_PATH,
    MITRE_ATTRIBUTION,
    all_techniques,
    catalog_status,
    get_mitigation,
    get_tactic,
    get_technique,
    get_techniques,
    kill_chain_tactics,
    mitigations_for,
    normalise_technique_id,
    parent_of,
    reload_catalog,
    subtechniques_of,
    tactic_order,
    technique_order,
    techniques_for_tactic,
)
from .capec_map import (
    MAP_PATH,
    get_capec,
    has_cwe,
    map_status,
    normalise_cwe,
    reload_map,
    techniques_for_cwe,
    techniques_for_cwes,
)
from .selection import (
    parse_cvss_vector,
    select_techniques,
    selection_summary,
)
from .reachability import (
    STATUS_BLOCKED,
    STATUS_LIKELY,
    STATUS_POSSIBLE,
    Signals,
    assess_chain,
    assess_technique,
    build_signals,
    evaluate,
)
from .verdict import (
    VERDICT_LIKELY,
    VERDICT_POSSIBLE,
    VERDICT_UNLIKELY,
    roll_up,
)
from .view import build_view

__all__ = [
    # Layer 1 — ATT&CK catalogue
    "CATALOG_PATH",
    "MITRE_ATTRIBUTION",
    "all_techniques",
    "catalog_status",
    "get_mitigation",
    "get_tactic",
    "get_technique",
    "get_techniques",
    "kill_chain_tactics",
    "mitigations_for",
    "normalise_technique_id",
    "parent_of",
    "reload_catalog",
    "subtechniques_of",
    "tactic_order",
    "technique_order",
    "techniques_for_tactic",
    # Layer 2 — CWE -> CAPEC -> ATT&CK (standards half)
    "MAP_PATH",
    "get_capec",
    "has_cwe",
    "map_status",
    "normalise_cwe",
    "reload_map",
    "techniques_for_cwe",
    "techniques_for_cwes",
    # Layer 2 — selection (f(CWE, CVSS) -> techniques, all three tiers)
    "parse_cvss_vector",
    "select_techniques",
    "selection_summary",
    # Layer 3 — reachability (badge each technique against a vuln x asset)
    "STATUS_BLOCKED",
    "STATUS_LIKELY",
    "STATUS_POSSIBLE",
    "Signals",
    "assess_chain",
    "assess_technique",
    "build_signals",
    "evaluate",
    # Layer 4 — roll-up & verdict
    "VERDICT_LIKELY",
    "VERDICT_POSSIBLE",
    "VERDICT_UNLIKELY",
    "roll_up",
    # API contract — the per-(vuln x asset) payload for the tab + narrator
    "build_view",
]
