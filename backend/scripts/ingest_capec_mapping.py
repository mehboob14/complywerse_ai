"""Distil the CWE -> CAPEC -> ATT&CK chain from CAPEC XML into a compact lookup.

Layer 2's *static* half — the standards-based technique selector. Run offline,
like the ATT&CK ingest. Pairs with `scripts/ingest_attack_catalog.py`; run that
one FIRST, because this script validates every technique it emits against the
Layer 1 catalogue (redirecting revoked ids, dropping ones that no longer exist).

What this is and isn't, measured against CAPEC 3.9 (verified July 2026):

  * The chain is AUTHORITATIVE but SPARSE. Only 177/615 attack patterns carry
    an ATT&CK mapping, so only ~149 CWEs reach any technique and the chain
    touches ~175 of the catalogue's 697 active techniques (25%).
  * It MISSES the most common web-app weaknesses entirely. CWE-89 (SQLi),
    CWE-79 (XSS), CWE-78 (command injection), CWE-22 (path traversal),
    CWE-787 (OOB write) resolve to NOTHING here. ATT&CK doesn't model those as
    techniques; the nearest, T1190 Exploit Public-Facing Application, appears
    in ZERO CAPEC patterns.
  * Therefore this file is NOT the backbone of technique selection — the
    deterministic CVSS-vector rules are. This is a breadth ENRICHMENT: high
    provenance (`capec_chain`) where it has data, silent where it doesn't. The
    selection layer unions it with the CVSS rules and a small curated
    CWE->technique gap-filler.

The reference doc's worked examples (CWE-89->T1190, CWE-269->T1068,
CWE-434->T1203) do NOT reproduce from this data — they were hand-picked. The
gap-filler, not this file, is where those get restored, and only with an
explicit provenance tag so they're distinguishable from the standards chain.

Output: ``grc/seed_data/attack/cwe_technique_map.json``
Consumed by: ``grc.modules.vuln_management.attack.capec_map``

Usage::

    python scripts/ingest_capec_mapping.py --download
    python scripts/ingest_capec_mapping.py --source /path/to/capec_latest.xml

CAPEC and ATT&CK are MITRE works, free for commercial use with attribution:

    (c) 2026 The MITRE Corporation. This work is reproduced and distributed
    with the permission of The MITRE Corporation.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

CAPEC_XML_URL = "https://capec.mitre.org/data/xml/capec_latest.xml"
DOWNLOAD_TIMEOUT_SECONDS = 120
CAPEC_NS = "http://capec.mitre.org/capec-3"

MITRE_ATTRIBUTION = (
    "(c) 2026 The MITRE Corporation. This work is reproduced and distributed "
    "with the permission of The MITRE Corporation."
)

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_SEED_ATTACK_DIR = _BACKEND_ROOT / "grc" / "seed_data" / "attack"
DEFAULT_OUT = _SEED_ATTACK_DIR / "cwe_technique_map.json"
ATTACK_CATALOG_PATH = _SEED_ATTACK_DIR / "enterprise_attack_catalog.json"

# CAPEC statuses we refuse to build mappings from.
_DEAD_STATUSES = {"Deprecated", "Obsolete"}


# ──────────────────────────────────────────────────────────────────────────
# Layer 1 cross-validation — every technique we emit must exist in the catalogue
# ──────────────────────────────────────────────────────────────────────────
def _load_attack_index() -> Tuple[Dict[str, dict], Optional[str]]:
    """Return ({technique_id: record}, attack_version). Empty if the catalogue
    isn't built yet — then we can't validate and refuse to run.
    """
    if not ATTACK_CATALOG_PATH.is_file():
        raise SystemExit(
            f"ATT&CK catalogue not found at {ATTACK_CATALOG_PATH}.\n"
            "Run scripts/ingest_attack_catalog.py --download first — this script "
            "validates every technique against it."
        )
    with ATTACK_CATALOG_PATH.open("r", encoding="utf-8") as fh:
        cat = json.load(fh)
    return cat.get("techniques") or {}, cat.get("attack_version")


def _resolve_technique(tid: str, techniques: Dict[str, dict], hops: int = 0) -> Optional[str]:
    """Canonical live technique id for a CAPEC-supplied one: follow revoked-by,
    drop if unknown or deprecated. Returns None if it can't be salvaged.
    """
    rec = techniques.get(tid)
    if rec is None:
        return None
    if rec.get("is_revoked") and rec.get("revoked_by") and hops < 5:
        return _resolve_technique(rec["revoked_by"], techniques, hops + 1)
    if rec.get("is_deprecated"):
        return None
    return rec["technique_id"]


# ──────────────────────────────────────────────────────────────────────────
# CAPEC parsing
# ──────────────────────────────────────────────────────────────────────────
def _q(tag: str) -> str:
    return f"{{{CAPEC_NS}}}{tag}"


def _attack_entry_ids(ap) -> List[Tuple[str, Optional[str]]]:
    """(technique_id, mapping_fit) for each ATTACK taxonomy mapping on a pattern.

    CAPEC stores the ATT&CK id as a bare number ('1548', '1574.010') — we prefix
    'T'. Mapping_Fit is often absent on ATTACK rows; kept when present.
    """
    out: List[Tuple[str, Optional[str]]] = []
    tms = ap.find(_q("Taxonomy_Mappings"))
    if tms is None:
        return out
    for tm in tms.findall(_q("Taxonomy_Mapping")):
        if tm.get("Taxonomy_Name") != "ATTACK":
            continue
        eid = tm.find(_q("Entry_ID"))
        if eid is None or not (eid.text and eid.text.strip()):
            continue
        fit_el = tm.find(_q("Mapping_Fit"))
        fit = fit_el.text.strip() if fit_el is not None and fit_el.text else None
        out.append(("T" + eid.text.strip(), fit))
    return out


def _related_cwes(ap) -> List[str]:
    rws = ap.find(_q("Related_Weaknesses"))
    if rws is None:
        return []
    out = []
    for rw in rws.findall(_q("Related_Weakness")):
        cwe = rw.get("CWE_ID")
        if cwe and cwe.strip():
            out.append(cwe.strip())
    return out


def distil(root, techniques: Dict[str, dict], attack_version: Optional[str], source: str):
    warnings: List[str] = []
    catalog = root.find(f".//{_q('Attack_Patterns')}")
    if catalog is None:
        raise ValueError("no <Attack_Patterns> — is this the CAPEC XML catalogue?")
    patterns = catalog.findall(_q("Attack_Pattern"))
    if not patterns:
        raise ValueError("CAPEC catalogue holds no attack patterns")

    capec_version = root.get("Version")
    capec_date = root.get("Date")

    # cwe (bare number) -> { technique_id -> link record }, de-duped keeping the
    # tightest provenance. Multiple CAPECs can bridge the same CWE->technique;
    # we record the first CAPEC and note the count.
    cwe_techniques: Dict[str, Dict[str, dict]] = {}
    dropped: List[dict] = []
    capec_meta: Dict[str, dict] = {}

    raw_pairs = 0
    for ap in patterns:
        if ap.get("Status") in _DEAD_STATUSES:
            continue
        capec_id = ap.get("ID")
        capec_name = ap.get("Name")
        abstraction = ap.get("Abstraction")
        attack_maps = _attack_entry_ids(ap)
        cwes = _related_cwes(ap)
        if attack_maps:
            capec_meta[capec_id] = {
                "capec_id": capec_id,
                "name": capec_name,
                "abstraction": abstraction,
                "techniques": [],
            }
        for raw_tid, fit in attack_maps:
            resolved = _resolve_technique(raw_tid, techniques)
            if resolved is None:
                dropped.append({"capec_id": capec_id, "raw_technique": raw_tid,
                                "reason": "not in ATT&CK v" + str(attack_version) + " (deprecated/unknown)"})
                continue
            if resolved != raw_tid:
                dropped.append({"capec_id": capec_id, "raw_technique": raw_tid,
                                "reason": f"revoked -> redirected to {resolved}"})
            if resolved not in capec_meta[capec_id]["techniques"]:
                capec_meta[capec_id]["techniques"].append(resolved)
            for cwe in cwes:
                raw_pairs += 1
                bucket = cwe_techniques.setdefault(cwe, {})
                link = bucket.get(resolved)
                if link is None:
                    bucket[resolved] = {
                        "technique_id": resolved,
                        "name": techniques[resolved].get("name"),
                        "tactics": techniques[resolved].get("tactics") or [],
                        "order": techniques[resolved].get("order"),
                        "via_capec": [capec_id],
                        "capec_name": capec_name,
                        "capec_abstraction": abstraction,
                        "mapping_fit": fit,
                    }
                else:
                    if capec_id not in link["via_capec"]:
                        link["via_capec"].append(capec_id)

    # Flatten inner dicts to sorted lists for a stable, small file.
    cwe_out = {
        cwe: sorted(links.values(), key=lambda l: l["technique_id"])
        for cwe, links in sorted(cwe_techniques.items(), key=lambda kv: int(kv[0]) if kv[0].isdigit() else 0)
    }

    all_tech = {t["technique_id"] for links in cwe_out.values() for t in links}
    catalogue = {
        "schema_version": 1,
        "capec_version": capec_version,
        "capec_date": capec_date,
        "validated_against_attack_version": attack_version,
        "source_url": source,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "attribution": MITRE_ATTRIBUTION,
        "counts": {
            "attack_patterns_total": len(patterns),
            "attack_patterns_with_attack_mapping": len(capec_meta),
            "cwes_with_techniques": len(cwe_out),
            "distinct_techniques_reached": len(all_tech),
            "raw_cwe_technique_pairs": raw_pairs,
            "dropped_or_redirected": len(dropped),
        },
        "cwe_techniques": cwe_out,
        "capec": dict(sorted(capec_meta.items(), key=lambda kv: int(kv[0]) if kv[0].isdigit() else 0)),
        "dropped": dropped,
    }

    if not cwe_out:
        raise ValueError("distilled 0 CWE->technique links — parse or namespace failure")
    if len(cwe_out) < 50:
        warnings.append(f"only {len(cwe_out)} CWEs reached a technique — unexpectedly low, check the source")

    return catalogue, warnings


# ──────────────────────────────────────────────────────────────────────────
# I/O
# ──────────────────────────────────────────────────────────────────────────
def _load_xml(source: Optional[str], download: bool):
    from lxml import etree

    if source:
        path = Path(source)
        if not path.is_file():
            raise SystemExit(f"source not found: {path}")
        print(f"reading {path} ({path.stat().st_size / 1024 / 1024:.1f} MB)")
        # Record the CANONICAL source URL for provenance, not the local path — a
        # --source file is just a cached copy of that download, and a temp path
        # in the committed seed answers "which source produced this?" with a lie.
        return etree.parse(str(path)).getroot(), CAPEC_XML_URL
    if not download:
        raise SystemExit("pass --source <path> or --download")

    import requests

    print(f"downloading {CAPEC_XML_URL} ...")
    resp = requests.get(CAPEC_XML_URL, timeout=DOWNLOAD_TIMEOUT_SECONDS,
                        headers={"User-Agent": "complywerse-capec-ingest/1.0"})
    resp.raise_for_status()
    print(f"downloaded {len(resp.content) / 1024 / 1024:.1f} MB")
    return etree.fromstring(resp.content), CAPEC_XML_URL


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Distil CWE->CAPEC->ATT&CK from CAPEC XML.")
    parser.add_argument("--source", help="path to a local capec_latest.xml")
    parser.add_argument("--download", action="store_true", help="fetch the current CAPEC release")
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument("--indent", type=int, default=0, help="JSON indent; 0 = compact")
    args = parser.parse_args(argv)

    techniques, attack_version = _load_attack_index()
    print(f"validating against ATT&CK v{attack_version} ({len(techniques)} techniques)")

    root, source_url = _load_xml(args.source, args.download)
    catalogue, warnings = distil(root, techniques, attack_version, source_url)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as fh:
        json.dump(catalogue, fh, ensure_ascii=False,
                  indent=args.indent or None,
                  separators=None if args.indent else (",", ":"))

    print(f"\nwrote {out_path} ({out_path.stat().st_size / 1024:.0f} KB)")
    print(f"  CAPEC version       {catalogue['capec_version']} ({catalogue['capec_date']})")
    for k, v in catalogue["counts"].items():
        print(f"  {k:<38} {v}")
    if warnings:
        print("\nwarnings:")
        for w in warnings:
            print(f"  ! {w}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
