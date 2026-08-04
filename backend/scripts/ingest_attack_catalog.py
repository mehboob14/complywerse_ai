"""Distil the MITRE ATT&CK Enterprise STIX bundle into a compact local catalogue.

Layer 1 of the exploitability pipeline. Run this offline (manually, or from a
release-bump chore) — never at request time.

Why a build step rather than a runtime fetch:

* ``enterprise-attack.json`` is ~51 MB. Too big to commit, too big to pull on
  process start, and it only changes when MITRE cuts a release (roughly twice
  a year). The distilled catalogue is a fraction of that and holds only the
  fields Layers 2-4 actually read.
* The distillation is where the STIX weirdness gets normalised once —
  T-numbers out of ``external_references``, tactic ordering off the matrix
  object, sub-technique parentage, revoked→replacement redirects. Downstream
  code then reads a plain dict and never learns what STIX is.

Usage::

    # fetch the current release from MITRE and distil it
    python scripts/ingest_attack_catalog.py --download

    # distil a bundle you already have on disk
    python scripts/ingest_attack_catalog.py --source /path/to/enterprise-attack.json

    # check what release is current without writing anything
    python scripts/ingest_attack_catalog.py --check

Output lands at ``grc/seed_data/attack/enterprise_attack_catalog.json`` and is
read by ``grc.modules.vuln_management.attack.catalog``.

ATT&CK is licensed for commercial use with attribution:

    (c) 2026 The MITRE Corporation. This work is reproduced and distributed
    with the permission of The MITRE Corporation.

That notice must survive into anything that renders or exports the chain.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ATTACK_STIX_URL = (
    "https://raw.githubusercontent.com/mitre-attack/attack-stix-data"
    "/master/enterprise-attack/enterprise-attack.json"
)
ATTACK_INDEX_URL = (
    "https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/index.json"
)
DOWNLOAD_TIMEOUT_SECONDS = 180

MITRE_ATTRIBUTION = (
    "(c) 2026 The MITRE Corporation. This work is reproduced and distributed "
    "with the permission of The MITRE Corporation."
)

# scripts/ -> backend/ -> grc/seed_data/attack/
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = _BACKEND_ROOT / "grc" / "seed_data" / "attack" / "enterprise_attack_catalog.json"

# STIX source_name that carries the human-facing ATT&CK ID (T####, TA####, M####).
_ATTACK_SOURCE = "mitre-attack"
_ATTACK_KILL_CHAIN = "mitre-attack"


# ──────────────────────────────────────────────────────────────────────────
# STIX field plucking
# ──────────────────────────────────────────────────────────────────────────
def _attack_id(obj: dict) -> Optional[str]:
    """The T####/TA####/M#### id, which STIX hides in external_references."""
    for ref in obj.get("external_references") or []:
        if (ref or {}).get("source_name") == _ATTACK_SOURCE:
            ext = ref.get("external_id")
            if isinstance(ext, str) and ext.strip():
                return ext.strip()
    return None


def _attack_url(obj: dict) -> Optional[str]:
    for ref in obj.get("external_references") or []:
        if (ref or {}).get("source_name") == _ATTACK_SOURCE:
            url = ref.get("url")
            if isinstance(url, str) and url.strip():
                return url.strip()
    return None


def _tactic_shortnames(obj: dict) -> List[str]:
    """Tactics a technique belongs to, as shortnames ('initial-access').

    ``kill_chain_phases[].phase_name`` is the join key to an x-mitre-tactic's
    ``x_mitre_shortname``. A technique can sit under several tactics.
    """
    out: List[str] = []
    for phase in obj.get("kill_chain_phases") or []:
        if (phase or {}).get("kill_chain_name") != _ATTACK_KILL_CHAIN:
            continue
        name = phase.get("phase_name")
        if isinstance(name, str) and name and name not in out:
            out.append(name)
    return out


def _parent_technique_id(technique_id: str) -> Optional[str]:
    """'T1059.001' -> 'T1059'. ATT&CK guarantees this encoding for
    sub-techniques, so we don't need to walk the subtechnique-of relationships.
    """
    if "." in technique_id:
        return technique_id.split(".", 1)[0]
    return None


# ──────────────────────────────────────────────────────────────────────────
# Distillation
# ──────────────────────────────────────────────────────────────────────────
def _pick_matrix(matrices: List[dict]) -> Optional[dict]:
    """The Enterprise bundle normally carries exactly one x-mitre-matrix.
    Prefer one that names itself Enterprise; otherwise take the richest.
    """
    if not matrices:
        return None
    for m in matrices:
        if "enterprise" in (m.get("name") or "").lower():
            return m
    return max(matrices, key=lambda m: len(m.get("tactic_refs") or []))


def _build_tactic_order(matrix: Optional[dict], tactics_by_stix_id: Dict[str, dict]) -> Dict[str, int]:
    """Map tactic shortname -> left-to-right kill-chain position.

    ATT&CK *does* ship this: ``x-mitre-matrix.tactic_refs`` is an ordered list
    of tactic STIX ids matching the matrix column order. Deriving it here means
    the ordering stays correct across version bumps instead of drifting from a
    hand-maintained constant.
    """
    order: Dict[str, int] = {}
    if not matrix:
        return order
    for idx, stix_id in enumerate(matrix.get("tactic_refs") or []):
        tactic = tactics_by_stix_id.get(stix_id)
        if not tactic:
            continue
        shortname = tactic.get("x_mitre_shortname")
        if isinstance(shortname, str) and shortname:
            order[shortname] = idx
    return order


def distil(bundle: dict, source_url: str) -> Tuple[dict, List[str]]:
    """STIX bundle -> the catalogue Layers 2-4 consume. Returns (catalogue, warnings)."""
    warnings: List[str] = []
    objects = bundle.get("objects") or []
    if not objects:
        raise ValueError("bundle has no 'objects' array — is this an ATT&CK STIX bundle?")

    by_type: Dict[str, List[dict]] = {}
    for obj in objects:
        by_type.setdefault((obj or {}).get("type") or "", []).append(obj)

    # ── version stamp, off the collection object
    attack_version = None
    collection_name = None
    for coll in by_type.get("x-mitre-collection", []):
        attack_version = coll.get("x_mitre_version") or attack_version
        collection_name = coll.get("name") or collection_name
    if not attack_version:
        warnings.append("no x-mitre-collection version found; catalogue version left null")

    # ── tactics + their matrix ordering
    tactic_objs = by_type.get("x-mitre-tactic", [])
    tactics_by_stix_id = {t.get("id"): t for t in tactic_objs if t.get("id")}
    matrix = _pick_matrix(by_type.get("x-mitre-matrix", []))
    if not matrix:
        warnings.append("no x-mitre-matrix object; tactic ordering will be empty")
    tactic_order = _build_tactic_order(matrix, tactics_by_stix_id)

    tactics: Dict[str, dict] = {}
    for t in tactic_objs:
        shortname = t.get("x_mitre_shortname")
        tactic_id = _attack_id(t)
        if not shortname or not tactic_id:
            continue
        if shortname not in tactic_order:
            warnings.append(f"tactic {tactic_id} ({shortname}) is not in the matrix ordering")
        tactics[shortname] = {
            "tactic_id": tactic_id,
            "shortname": shortname,
            "name": t.get("name"),
            "order": tactic_order.get(shortname),
            "description": t.get("description"),
            "url": _attack_url(t),
        }

    # ── revoked-by redirects, so stale T-numbers in stored data still resolve
    revoked_by: Dict[str, str] = {}
    stix_to_attack: Dict[str, str] = {}
    for ap in by_type.get("attack-pattern", []):
        aid = _attack_id(ap)
        if aid and ap.get("id"):
            stix_to_attack[ap["id"]] = aid
    for rel in by_type.get("relationship", []):
        if (rel or {}).get("relationship_type") != "revoked-by":
            continue
        src = stix_to_attack.get(rel.get("source_ref") or "")
        dst = stix_to_attack.get(rel.get("target_ref") or "")
        if src and dst:
            revoked_by[src] = dst

    # ── techniques and sub-techniques
    techniques: Dict[str, dict] = {}
    for ap in by_type.get("attack-pattern", []):
        tid = _attack_id(ap)
        if not tid:
            continue
        tactic_names = _tactic_shortnames(ap)
        # Column placement: earliest tactic the technique appears under. A
        # technique spanning several tactics renders at its first opportunity.
        orders = [tactic_order[s] for s in tactic_names if s in tactic_order]
        techniques[tid] = {
            "technique_id": tid,
            "name": ap.get("name"),
            "description": ap.get("description"),
            "tactics": tactic_names,
            "order": min(orders) if orders else None,
            "is_subtechnique": bool(ap.get("x_mitre_is_subtechnique")),
            "parent": _parent_technique_id(tid),
            "platforms": ap.get("x_mitre_platforms") or [],
            # Deliberately absent: data_sources and detection. Both used to hang
            # off the attack-pattern as x_mitre_data_sources / x_mitre_detection;
            # modern ATT&CK moved them out into their own object types linked by
            # `detects` relationships, so those two fields are empty on every
            # technique in v19 (verified: 0/858). Carrying them would ship two
            # always-null columns. If detection coverage is ever needed, pull the
            # x-mitre-data-component / x-mitre-detection-strategy objects
            # properly rather than reviving these.
            "is_deprecated": bool(ap.get("x_mitre_deprecated")),
            "is_revoked": bool(ap.get("revoked")),
            "revoked_by": revoked_by.get(tid),
            "version": ap.get("x_mitre_version"),
            "url": _attack_url(ap),
        }

    # ── mitigations + which techniques they mitigate
    mitigations: Dict[str, dict] = {}
    stix_to_mitigation: Dict[str, str] = {}
    for coa in by_type.get("course-of-action", []):
        mid = _attack_id(coa)
        if not mid:
            continue
        if coa.get("id"):
            stix_to_mitigation[coa["id"]] = mid
        mitigations[mid] = {
            "mitigation_id": mid,
            "name": coa.get("name"),
            "description": coa.get("description"),
            "is_deprecated": bool(coa.get("x_mitre_deprecated")),
            "url": _attack_url(coa),
        }

    technique_mitigations: Dict[str, List[str]] = {}
    for rel in by_type.get("relationship", []):
        if (rel or {}).get("relationship_type") != "mitigates":
            continue
        mid = stix_to_mitigation.get(rel.get("source_ref") or "")
        tid = stix_to_attack.get(rel.get("target_ref") or "")
        if not mid or not tid:
            continue
        bucket = technique_mitigations.setdefault(tid, [])
        if mid not in bucket:
            bucket.append(mid)
    for bucket in technique_mitigations.values():
        bucket.sort()

    active = [t for t in techniques.values() if not t["is_deprecated"] and not t["is_revoked"]]
    catalogue = {
        "schema_version": 1,
        "attack_version": attack_version,
        "collection_name": collection_name,
        "domain": "enterprise-attack",
        "source_url": source_url,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "attribution": MITRE_ATTRIBUTION,
        "counts": {
            "tactics": len(tactics),
            "techniques_total": len(techniques),
            "techniques_active": len(active),
            "techniques_parent": len([t for t in active if not t["is_subtechnique"]]),
            "techniques_sub": len([t for t in active if t["is_subtechnique"]]),
            "techniques_deprecated": len([t for t in techniques.values() if t["is_deprecated"]]),
            "techniques_revoked": len([t for t in techniques.values() if t["is_revoked"]]),
            "mitigations": len(mitigations),
            "technique_mitigation_links": sum(len(v) for v in technique_mitigations.values()),
        },
        "tactics": dict(sorted(tactics.items(), key=lambda kv: (kv[1]["order"] is None, kv[1]["order"]))),
        "techniques": dict(sorted(techniques.items())),
        "mitigations": dict(sorted(mitigations.items())),
        "technique_mitigations": dict(sorted(technique_mitigations.items())),
    }

    # ── invariants worth failing loudly on rather than shipping a broken catalogue
    if not catalogue["tactics"]:
        raise ValueError("distilled 0 tactics — bundle is not usable")
    if len(active) < 100:
        raise ValueError(f"distilled only {len(active)} active techniques — bundle looks truncated")
    orphan_subs = [
        t["technique_id"] for t in techniques.values()
        if t["is_subtechnique"] and t["parent"] and t["parent"] not in techniques
    ]
    if orphan_subs:
        warnings.append(f"{len(orphan_subs)} sub-techniques have no parent in the bundle: {orphan_subs[:5]}")
    unplaced = [t["technique_id"] for t in active if t["order"] is None]
    if unplaced:
        warnings.append(f"{len(unplaced)} active techniques have no tactic ordering: {unplaced[:5]}")

    return catalogue, warnings


# ──────────────────────────────────────────────────────────────────────────
# I/O
# ──────────────────────────────────────────────────────────────────────────
def _load_bundle(source: Optional[str], download: bool) -> Tuple[dict, str]:
    if source:
        path = Path(source)
        if not path.is_file():
            raise SystemExit(f"source not found: {path}")
        print(f"reading {path} ({path.stat().st_size / 1024 / 1024:.1f} MB)")
        with path.open("r", encoding="utf-8") as fh:
            # Canonical source URL for provenance, not the local cache path.
            return json.load(fh), ATTACK_STIX_URL
    if not download:
        raise SystemExit("pass --source <path> or --download")

    import requests  # local import so --source works without the dep

    print(f"downloading {ATTACK_STIX_URL} ...")
    resp = requests.get(
        ATTACK_STIX_URL,
        timeout=DOWNLOAD_TIMEOUT_SECONDS,
        headers={"User-Agent": "complywerse-attack-ingest/1.0"},
    )
    resp.raise_for_status()
    print(f"downloaded {len(resp.content) / 1024 / 1024:.1f} MB")
    return resp.json(), ATTACK_STIX_URL


def _check_current_release() -> int:
    import requests

    resp = requests.get(ATTACK_INDEX_URL, timeout=30)
    resp.raise_for_status()
    index = resp.json()
    for coll in index.get("collections") or []:
        if "enterprise" not in (coll.get("name") or "").lower():
            continue
        versions = coll.get("versions") or []
        if not versions:
            continue
        latest = max(versions, key=lambda v: v.get("release_date") or "")
        print(f"{coll.get('name')}: latest = v{latest.get('version')} ({latest.get('release_date')})")
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Distil the ATT&CK Enterprise STIX bundle.")
    parser.add_argument("--source", help="path to a local enterprise-attack.json")
    parser.add_argument("--download", action="store_true", help="fetch the current release from MITRE")
    parser.add_argument("--check", action="store_true", help="report the latest published release and exit")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help=f"output path (default: {DEFAULT_OUT})")
    parser.add_argument("--indent", type=int, default=0, help="JSON indent; 0 = compact (default)")
    args = parser.parse_args(argv)

    if args.check:
        return _check_current_release()

    bundle, source_url = _load_bundle(args.source, args.download)
    catalogue, warnings = distil(bundle, source_url)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as fh:
        json.dump(
            catalogue,
            fh,
            ensure_ascii=False,
            indent=args.indent or None,
            separators=None if args.indent else (",", ":"),
        )

    size_mb = out_path.stat().st_size / 1024 / 1024
    print(f"\nwrote {out_path} ({size_mb:.1f} MB)")
    print(f"  ATT&CK version      {catalogue['attack_version']}")
    for key, value in catalogue["counts"].items():
        print(f"  {key:<28} {value}")
    if warnings:
        print("\nwarnings:")
        for w in warnings:
            print(f"  ! {w}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
