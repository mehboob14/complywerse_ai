"""Ingest MITRE's CWE parent-child (ChildOf) hierarchy.

Downloads the official CWE catalogue (cwec_latest.xml) and extracts, per weakness,
its ChildOf parent CWE(s) into ``grc/seed_data/attack/cwe_hierarchy.json``.

Used by the ancestor-walk fallback in ``attack/selection.py``: when a CWE has no
direct CAPEC->ATT&CK mapping, the engine climbs this hierarchy to the nearest
ancestor that *does* map (e.g. CWE-289 -> CWE-1390 -> CWE-287) and borrows its
techniques, labelled as an approximate "via parent" mapping. Same failure posture
as the other ingesters: a network/parse failure just leaves the file untouched.
"""
from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime
from pathlib import Path

import requests

CWE_ZIP_URL = "https://cwe.mitre.org/data/xml/cwec_latest.xml.zip"
OUT = Path(__file__).resolve().parents[1] / "grc" / "seed_data" / "attack" / "cwe_hierarchy.json"


def _local(tag: str) -> str:
    """Strip the XML namespace: '{http://cwe.mitre.org/cwe-7}Weakness' -> 'Weakness'."""
    return tag.rsplit("}", 1)[-1]


def main() -> None:
    import xml.etree.ElementTree as ET

    print(f"downloading {CWE_ZIP_URL} ...")
    r = requests.get(CWE_ZIP_URL, timeout=180)
    r.raise_for_status()
    z = zipfile.ZipFile(io.BytesIO(r.content))
    xml_name = next(n for n in z.namelist() if n.endswith(".xml"))
    root = ET.fromstring(z.read(xml_name))

    version = root.get("Version")
    date = root.get("Date")
    child_of: dict[str, list[str]] = {}
    names: dict[str, str] = {}

    for w in root.iter():
        if _local(w.tag) != "Weakness":
            continue
        cid = w.get("ID")
        if not cid:
            continue
        names[cid] = w.get("Name") or ""
        parents: list[str] = []
        for rw in w.iter():
            if _local(rw.tag) == "Related_Weakness" and rw.get("Nature") == "ChildOf":
                pid = rw.get("CWE_ID")
                if pid and pid not in parents:
                    parents.append(pid)
        if parents:
            child_of[cid] = parents

    payload = {
        "source": CWE_ZIP_URL,
        "cwe_version": version,
        "cwe_date": date,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "counts": {"weaknesses_total": len(names), "weaknesses_with_parents": len(child_of)},
        "child_of": child_of,
        "names": names,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    print(f"wrote {OUT}")
    print(f"  CWE v{version} ({date}) — {len(child_of)} weaknesses carry a ChildOf parent")
    for c in ("289", "1390", "287", "347", "345", "918", "22"):
        print(f"  CWE-{c} ChildOf -> {child_of.get(c)}  ({names.get(c, '?')[:40]})")


if __name__ == "__main__":
    main()
