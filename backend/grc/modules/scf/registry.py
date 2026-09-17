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


def join_field_for_slug(slug: str) -> str:
    """The library field the crosswalk resolver joined this framework on.

    iso_42001's ``control_id`` is a local 1..n counter while the citable clause
    lives in ``original_reference``; keying on the wrong one renders a different
    requirement's text under the right code.
    """
    for fw in _entries():
        if fw.get("slug") == slug:
            return fw.get("join_field") or "control_id"
    return "control_id"


def _norm_name(value: Optional[str]) -> str:
    return "".join(ch for ch in (value or "").lower() if ch.isalnum())


@lru_cache(maxsize=1)
def _name_index() -> Dict[str, str]:
    """Framework library display name (normalised) -> product slug.

    Seeded ``grc_uploaded_frameworks`` rows carry the library's own
    ``metadata.name`` but no slug, so this is how an uploaded framework is
    recognised as one of the crosswalked ones.
    """
    fw_dir = _REGISTRY_PATH.parents[1] / "frameworks"
    out: Dict[str, str] = {}
    for entry in _entries():
        slug = entry.get("slug")
        if not slug:
            continue
        out.setdefault(_norm_name(slug), slug)
        out.setdefault(_norm_name(label_for_slug(slug)), slug)
        path = fw_dir / (entry.get("file") or "")
        if not path.is_file():
            continue
        try:
            with path.open(encoding="utf-8") as fh:
                meta = (json.load(fh).get("metadata") or {})
        except Exception:  # noqa: BLE001 — a broken library must not break lookup
            continue
        for key in ("name", "framework_name"):
            if meta.get(key):
                out.setdefault(_norm_name(meta[key]), slug)
    return out


def slug_for_framework(
    name: Optional[str] = None,
    *,
    slug: Optional[str] = None,
) -> Optional[str]:
    """Resolve an uploaded framework to its crosswalk slug, or None."""
    idx = _name_index()
    for candidate in (slug, name):
        hit = idx.get(_norm_name(candidate))
        if hit:
            return hit
    return None
