"""Distil ATT&CK Groups (G-codes) + Software (S-codes) and their technique `uses`
relationships into a compact committed seed.

This backs the ONLY threat-intel claim MITRE authoritatively supports: which actors
and malware/tools are known to USE a technique. It is technique-level and nothing
more — there is no CVE→actor link in this data and none is manufactured. The tab
derives, at runtime, "the techniques in this finding's chain are used by <actors>",
never "this actor exploited this CVE".

Ingest-to-seed, same pattern as the catalogue: download the ~53 MB STIX once, distil
to a technique-keyed map, commit it, read lazily at runtime with no network call. The
distilled catalogue dropped intrusion-set / malware / tool objects (only techniques,
tactics, mitigations were kept), so this re-reads the raw bundle to recover them.

Usage (from backend/):
    python scripts/ingest_attack_threat_intel.py --download
    python scripts/ingest_attack_threat_intel.py --source /path/to/enterprise-attack.json
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

ATTACK_STIX_URL = (
    "https://raw.githubusercontent.com/mitre-attack/attack-stix-data"
    "/master/enterprise-attack/enterprise-attack.json"
)
DOWNLOAD_TIMEOUT_SECONDS = 180
MITRE_ATTRIBUTION = (
    "(c) 2026 The MITRE Corporation. This work is reproduced and distributed "
    "with the permission of The MITRE Corporation."
)
_ATTACK_SOURCE = "mitre-attack"
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = _BACKEND_ROOT / "grc" / "seed_data" / "attack" / "threat_intel_map.json"


def _attack_id(obj: dict) -> Optional[str]:
    """The G####/S####/T#### id STIX hides in external_references."""
    for ref in obj.get("external_references") or []:
        if (ref or {}).get("source_name") == _ATTACK_SOURCE:
            ext = ref.get("external_id")
            if isinstance(ext, str) and ext.strip():
                return ext.strip()
    return None


def _load_bundle(source: Optional[str], download: bool) -> dict:
    if source:
        path = Path(source)
        if not path.is_file():
            raise SystemExit(f"source not found: {path}")
        print(f"reading {path} ({path.stat().st_size / 1024 / 1024:.1f} MB)")
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    if not download:
        raise SystemExit("pass --source <path> or --download")
    import requests  # local import so --source works without the dep
    print(f"downloading {ATTACK_STIX_URL} ...")
    resp = requests.get(ATTACK_STIX_URL, timeout=DOWNLOAD_TIMEOUT_SECONDS,
                        headers={"User-Agent": "complywerse-attack-ti-ingest/1.0"})
    resp.raise_for_status()
    print(f"downloaded {len(resp.content) / 1024 / 1024:.1f} MB")
    return resp.json()


def distil(bundle: dict) -> dict:
    by_type: dict = defaultdict(list)
    for obj in bundle.get("objects") or []:
        by_type[obj.get("type")].append(obj)

    version = None
    for coll in by_type.get("x-mitre-collection", []):
        version = coll.get("x_mitre_version") or version

    # STIX id → technique id (active attack-patterns only; drop revoked/deprecated so
    # a stale technique can never carry actors on screen).
    tech_by_stix: dict = {}
    for ap in by_type.get("attack-pattern", []):
        if ap.get("revoked") or ap.get("x_mitre_deprecated"):
            continue
        tid = _attack_id(ap)
        if tid:
            tech_by_stix[ap["id"]] = tid

    actor_by_stix: dict = {}
    for g in by_type.get("intrusion-set", []):
        if g.get("revoked") or g.get("x_mitre_deprecated"):
            continue
        aid = _attack_id(g)
        if aid:
            actor_by_stix[g["id"]] = {"id": aid, "name": g.get("name")}

    software_by_stix: dict = {}
    for kind in ("malware", "tool"):
        for s in by_type.get(kind, []):
            if s.get("revoked") or s.get("x_mitre_deprecated"):
                continue
            sid = _attack_id(s)
            if sid:
                software_by_stix[s["id"]] = {"id": sid, "name": s.get("name"), "type": kind}

    # actor/software --uses--> technique
    technique_actors: dict = defaultdict(list)
    technique_software: dict = defaultdict(list)
    seen_a: set = set()
    seen_s: set = set()
    for rel in by_type.get("relationship", []):
        if rel.get("relationship_type") != "uses":
            continue
        tid = tech_by_stix.get(rel.get("target_ref"))
        if not tid:
            continue
        src = rel.get("source_ref")
        if src in actor_by_stix and (tid, src) not in seen_a:
            seen_a.add((tid, src))
            technique_actors[tid].append(actor_by_stix[src])
        elif src in software_by_stix and (tid, src) not in seen_s:
            seen_s.add((tid, src))
            technique_software[tid].append(software_by_stix[src])

    for mapping in (technique_actors, technique_software):
        for tid in mapping:
            mapping[tid].sort(key=lambda x: x["id"])

    return {
        "schema_version": 1,
        "attack_version": version,
        "source_url": ATTACK_STIX_URL,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "attribution": MITRE_ATTRIBUTION,
        "counts": {
            "actors": len(actor_by_stix),
            "software": len(software_by_stix),
            "techniques_with_actors": len(technique_actors),
            "techniques_with_software": len(technique_software),
        },
        "technique_actors": dict(sorted(technique_actors.items())),
        "technique_software": dict(sorted(technique_software.items())),
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Distil ATT&CK Groups + Software → technique map.")
    parser.add_argument("--source", help="path to a local enterprise-attack.json")
    parser.add_argument("--download", action="store_true", help="fetch the current release from MITRE")
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    args = parser.parse_args(argv)

    seed = distil(_load_bundle(args.source, args.download))
    Path(args.out).write_text(json.dumps(seed, separators=(",", ":")), encoding="utf-8")
    print("ATT&CK v" + str(seed["attack_version"]), "| counts:", seed["counts"])
    print("wrote", args.out, f"({Path(args.out).stat().st_size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
