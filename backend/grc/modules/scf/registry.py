"""Crosswalk registry helpers — product framework slugs ↔ SCF source keys."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

_REGISTRY_PATH = (
    Path(__file__).resolve().parents[2] / "seed_data" / "scf" / "crosswalk_registry.json"
)

# Display labels for product slugs (same vocabulary as automation/router._FW_LABELS).
_FW_LABELS = {
    "soc2": "SOC 2", "iso_27001": "ISO 27001", "iso_42001": "ISO 42001",
    "iso_45001": "ISO 45001",
    "iso_22301": "ISO 22301", "pci_dss": "PCI DSS", "gdpr": "GDPR",
    "hipaa": "HIPAA", "nist_800_53": "NIST 800-53", "nist_800_171": "NIST 800-171",
    "nist_csf": "NIST CSF", "nist_airmf": "NIST AI RMF", "cis_controls": "CIS CSC",
    "csa_ccm_v4": "CSA CCM", "cobit": "COBIT", "dora": "DORA", "nis2": "NIS2",
    "mas_trm": "MAS TRM", "sama_csf": "SAMA CSF", "swift_cscf": "SWIFT CSCF",
    "hitrust_csf": "HITRUST", "adhics": "ADHICS", "doh_adhie_policy": "DoH ADHIE",
    "qcb_technology_risks": "QCB", "sbp_cloud": "SBP Cloud", "sbp_etgrmf": "SBP ETGRMF",
    "sbp_internet_banking": "SBP Internet Banking", "sl_csf": "SL CSF",
    "pisf_2026": "PISF 2026", "ndmo": "NDMO", "ksa_pdp_transfer": "KSA PDP Transfer",
    "aramco_ccc": "Aramco CCC", "sabic_cybertrust": "SABIC CyberTrust", "sox": "SOX",
}


@lru_cache(maxsize=1)
def _load_registry() -> Dict[str, Any]:
    if not _REGISTRY_PATH.is_file():
        return {"frameworks": []}
    with _REGISTRY_PATH.open(encoding="utf-8") as fh:
        return json.load(fh)


def _entries() -> List[Dict[str, Any]]:
    return list((_load_registry().get("frameworks") or []))


def framework_catalog() -> List[Dict[str, Any]]:
    """UI-ready list of product frameworks from the crosswalk registry."""
    out: List[Dict[str, Any]] = []
    for fw in _entries():
        if fw.get("emit") is False:
            continue
        slug = fw.get("slug") or ""
        if not slug:
            continue
        out.append({
            "slug": slug,
            "label": label_for_slug(slug),
            "file": fw.get("file"),
            "scf_keys": list(fw.get("scf_keys") or []),
            "expected": fw.get("expected"),
        })
    return out


def expand_source_slugs(framework_slugs: List[str]) -> Set[str]:
    """Each product slug plus its SCF source keys (for mapping joins)."""
    by_slug = {fw.get("slug"): fw for fw in _entries() if fw.get("slug")}
    expanded: Set[str] = set()
    for slug in framework_slugs or []:
        if not slug:
            continue
        expanded.add(slug)
        fw = by_slug.get(slug) or {}
        for key in fw.get("scf_keys") or []:
            if key:
                expanded.add(key)
    return expanded


def label_for_slug(slug: str) -> str:
    if not slug:
        return ""
    return _FW_LABELS.get(slug, slug.replace("_", " ").title())


def scf_keys_for_slug(slug: str) -> List[str]:
    for fw in _entries():
        if fw.get("slug") == slug:
            return list(fw.get("scf_keys") or [])
    return []
