"""Build the compact SCF seed artifacts from the official SCF release JSON.

Runs on a developer machine, NEVER in the app. The 22 MB source file never enters
the repo and never enters a request path; this emits the small artifacts that
`grc.tools.scf_import` loads into each tenant DB.

    python -m grc.tools.build_scf_seed --source "C:/.../JSON/scf-full-2026.2.json"

Every one of the eight ingest assertions below aborts the build on failure. They
exist because the source has real, load-bearing quirks (a column shift in the
compensating-controls block, a rigor field that is sometimes a string, sparse
mapping dicts) that would otherwise corrupt the catalog silently.

Outputs into backend/grc/seed_data/scf/:
    controls.json     1,534 controls, mappings + cmm prose stripped out
    cmm_levels.json   the CMM prose, loaded lazily and never in a list query
    mappings.csv.gz   the crosswalk, one row per (control, source, requirement)
    objectives.json   assessment objectives
    erl.json          evidence request list + its control links
    sources.json      the crosswalk source registry
    domains.json      the 34 domains with principles + intent
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List

# Mapping keys that are NOT framework crosswalks: SCF's own risk/threat catalogue
# and two summary columns. They are 100% redundant with control.risks/threats and
# would add tens of thousands of dead rows to the hot join.
SKIP_KEY_RE = re.compile(r"^(Risk |Threat )")
SKIP_KEY_LITERAL = {"Control Threat Summary", "Risk Threat Summary"}
SKIP_KEY_PREFIX = ("Errata",)

SCF_ID_RE = re.compile(r"^[A-Z]{3}-\d{2}(\.\d{1,2})?$")

# The five firm-size solution columns, folded into control.solutions.
SOLUTION_KEYS = {
    "Possible Solutions & Considerations Micro-Small Business (<10 staff) BLS Firm Size Classes 1-2": "micro",
    "Possible Solutions & Considerations Small Business (10-49 staff) BLS Firm Size Classes 3-4": "small",
    "Possible Solutions & Considerations Medium Business (50-249 staff) BLS Firm Size Classes 5-6": "medium",
    "Possible Solutions & Considerations Large Business (250-999 staff) BLS Firm Size Classes 7-8": "large",
    "Possible Solutions & Considerations Enterprise (> 1,000 staff) BLS Firm Size Class 9": "enterprise",
}

# Baseline / overlay membership is signalled by KEY PRESENCE in `extra`, not by the
# value. Note the double spaces in the three SCRM Focus keys — they are in the source.
BASELINE_KEYS = {
    "SCF CORE Fundamentals": "core_fundamentals",
    "SCF CORE ESP Level 1 Foundational": "esp_1",
    "SCF CORE ESP Level 2 Critical Infrastructure": "esp_2",
    "SCF CORE ESP Level 3 Advanced Threats": "esp_3",
    "SCF CORE AI Model Deployment": "ai_model_deployment",
    "SCF CORE AI-Enabled Operations": "ai_enabled_ops",
    "SCF CORE Mergers, Acquisitions & Divestitures (MA&D)": "mad",
    "SCF SCRMS": "scrms",
    "SCRM Focus  TIER 1 STRATEGIC": "scrm_tier1",
    "SCRM Focus  TIER 2 OPERATIONAL": "scrm_tier2",
    "SCRM Focus  TIER 3 TACTICAL": "scrm_tier3",
}

# Curated slugs for the sources we actually surface. Everything else is auto-slugged;
# a slug only has to be stable and unique, but these are the ones humans read.
SOURCE_SLUG_OVERRIDES = {
    "AICPA TSC 2017:2022 (used for SOC 2)": "aicpa_tsc_soc2",
    "ISO 27001 2022": "iso_27001_2022",
    "ISO 27002 2022": "iso_27002_2022",
    "ISO 27018 2025": "iso_27018_2025",
    "ISO 42001 2023": "iso_42001_2023",
    "ISO 22301 2019": "iso_22301_2019",
    "EMEA EU GDPR 2016": "eu_gdpr_2016",
    "EMEA EU DORA 2023": "eu_dora_2023",
    "EMEA EU NIS2 2022": "eu_nis2_2022",
    "PCI DSS 4.0.1": "pci_dss_401",
    "NIST CSF 2.0": "nist_csf_20",
    "NIST 800-53 R5": "nist_800_53_r5",
    "NIST 800-171 R2": "nist_800_171_r2",
    "NIST 800-171 R3": "nist_800_171_r3",
    "CIS CSC 8.1": "cis_csc_81",
    "CSA CCM 4.1.0": "csa_ccm_410",
    "COBIT 2019": "cobit_2019",
    "APAC Singapore MAS TRM 2021": "mas_trm_2021",
    "EMEA Saudi Arabia SAMA CSF 1.0 2017": "sama_csf_2017",
    "US HIPAA Administrative Simplification 2013": "hipaa_admin_simplification",
    "NIST AI 100-1 1.0": "nist_ai_100_1",
    "SWIFT CSF 2025": "swift_cscf_2025",
}


def slugify(key: str) -> str:
    # '+' carries meaning in SCF source names and must survive: 'GovRAMP Low' and
    # 'GovRAMP Low+' are different baselines that would otherwise collide.
    s = key.lower().replace("+", " plus ")
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return re.sub(r"_+", "_", s)[:64]


def sort_key_for(scf_id: str) -> str:
    """Zero-padded so GOV-01.2 sorts before GOV-01.10."""
    m = re.match(r"^([A-Z]{3})-(\d{2})(?:\.(\d{1,2}))?$", scf_id)
    if not m:
        return scf_id
    fam, num, sub = m.group(1), int(m.group(2)), m.group(3)
    return f"{fam}-{num:03d}-{int(sub):03d}" if sub else f"{fam}-{num:03d}-000"


def base_id_for(scf_id: str) -> str:
    return scf_id.split(".", 1)[0]


def is_real_source(key: str) -> bool:
    if SKIP_KEY_RE.match(key) or key in SKIP_KEY_LITERAL:
        return False
    return not key.startswith(SKIP_KEY_PREFIX)


def split_codes(value: Any) -> List[str]:
    """Assertion 8: split on newlines ONLY. Commas appear inside real codes."""
    if not isinstance(value, str):
        return []
    return [c.strip() for c in value.split("\n") if c and c.strip()]


class BuildError(RuntimeError):
    pass


def check(cond: bool, label: str, detail: str = "") -> None:
    if not cond:
        raise BuildError(f"ASSERTION FAILED — {label}" + (f"\n  {detail}" if detail else ""))
    print(f"  [ok] {label}")


def build(source: Path, dest: Path) -> Dict[str, Any]:
    print(f"Reading {source} ({source.stat().st_size:,} bytes)…")
    data = json.loads(source.read_text(encoding="utf-8"))

    meta = data["metadata"]
    controls = data["controls"]
    domains = data["domains"]
    compensating = data["compensating_controls"]
    objectives = data["assessment_objectives"]
    erl = data["evidence_request_list"]
    version = meta["version"]

    print(f"\nSCF {version} — running ingest assertions:")

    # 1 ── control count matches the manifest
    check(
        len(controls) == meta["control_count"],
        f"control count == metadata.control_count ({len(controls):,})",
        f"{len(controls)} != {meta['control_count']}",
    )

    # 2 ── ids well-formed, unique, and every family is a real domain
    ids = [c["scf_id"] for c in controls]
    bad = [i for i in ids if not SCF_ID_RE.match(i)]
    dom_ids = {d["identifier"] for d in domains}
    orphan_fams = {i.split("-")[0] for i in ids} - dom_ids
    check(
        not bad and len(set(ids)) == len(ids) and not orphan_fams,
        f"scf_ids well-formed, unique, families ⊆ {len(dom_ids)} domains",
        f"malformed={bad[:5]} dupes={len(ids)-len(set(ids))} orphan_families={orphan_fams}",
    )

    # 3 ── THE COLUMN SHIFT. compensating_controls is shifted by one at both levels:
    #      top-level scf_id holds the control NAME. Join by array index, never by id.
    #      If SCF ever fixes the export, this assertion is the only thing that catches it.
    shift_ok = all(
        compensating[i].get("scf_id") == controls[i].get("scf_control_name")
        for i in range(len(controls))
    )
    check(
        len(compensating) == len(controls) and shift_ok,
        "compensating_controls column shift still present (join by index)",
        "the shift changed — re-derive the mapping before trusting alternatives",
    )

    # 4 ── material controls (weight 10) are exactly the set with no real alternative
    def has_real_alt(block: Dict[str, Any]) -> bool:
        return any(
            (a.get("trigger") or "N/A") != "N/A"
            for a in (block.get("alternatives") or [])
        )

    weight10 = {i for i, c in enumerate(controls) if str(c.get("weight")).strip() == "10"}
    no_alt = {i for i in range(len(controls)) if not has_real_alt(compensating[i])}
    check(
        weight10 == no_alt,
        f"material controls == controls with no alternative ({len(weight10)})",
        f"weight10={len(weight10)} no_alt={len(no_alt)} diff={len(weight10 ^ no_alt)}",
    )

    # 5 ── AO + ERL references resolve
    id_set = set(ids)
    ao_orphans = {o["scf_id"] for o in objectives} - id_set
    erl_pairs = set()
    erl_bad: List[str] = []
    for e in erl:
        for tok in split_codes(e.get("scf_mappings")):
            (erl_pairs.add((e["erl_id"], tok)) if tok in id_set else erl_bad.append(f"{e['erl_id']}→{tok}"))
    for c in controls:
        for tok in split_codes(c.get("erl_reference")):
            if tok.startswith("E-"):
                erl_pairs.add((tok, c["scf_id"]))
            else:
                erl_bad.append(f"{c['scf_id']}→{tok}")
    check(
        not ao_orphans and len(erl_bad) <= 1,
        f"AO/ERL references resolve — {len(erl_pairs)} erl links, {len(erl_bad)} bad token(s)",
        f"ao_orphans={list(ao_orphans)[:5]} erl_bad={erl_bad[:5]}",
    )

    # 6+7 ── explode the crosswalk. mappings is SPARSE, so iterate the union of keys.
    all_keys: Counter = Counter()
    for c in controls:
        all_keys.update((c.get("mappings") or {}).keys())
    real_keys = sorted(k for k in all_keys if is_real_source(k))
    key_counts = [len(c.get("mappings") or {}) for c in controls]
    check(
        min(key_counts) < max(key_counts),
        f"mappings is sparse ({min(key_counts)}–{max(key_counts)} keys/control) — union iterated",
    )

    slug_for = {k: SOURCE_SLUG_OVERRIDES.get(k, slugify(k)) for k in real_keys}
    dupes = [s for s, n in Counter(slug_for.values()).items() if n > 1]
    if dupes:
        raise BuildError(f"source slug collision: {dupes[:5]}")

    rows: List[List[str]] = []
    per_source_controls: Dict[str, set] = defaultdict(set)
    per_source_reqs: Dict[str, set] = defaultdict(set)
    for c in controls:
        scf_id = c["scf_id"]
        for key, value in (c.get("mappings") or {}).items():
            if not is_real_source(key):
                continue
            slug = slug_for[key]
            for code in split_codes(value):
                rows.append([version, scf_id, slug, code, "intersects-with", "scf"])
                per_source_controls[slug].add(scf_id)
                per_source_reqs[slug].add(code)

    check(
        len(real_keys) > 200 and len(rows) > 60000,
        f"crosswalk exploded — {len(rows):,} rows across {len(real_keys)} real sources",
        f"keys={len(real_keys)} rows={len(rows)}",
    )

    # ── emit ────────────────────────────────────────────────────────────────────
    dest.mkdir(parents=True, exist_ok=True)

    out_controls, out_cmm = [], {}
    for c in controls:
        scf_id = c["scf_id"]
        extra = c.get("extra") or {}
        out_controls.append({
            "scf_id": scf_id,
            "base_scf_id": base_id_for(scf_id),
            "sort_key": sort_key_for(scf_id),
            "domain_identifier": scf_id.split("-")[0],
            "domain_name": c.get("scf_domain"),
            "name": c.get("scf_control_name"),
            "description": c.get("description"),
            "control_question": c.get("control_question"),
            "weight": int(c["weight"]) if str(c.get("weight", "")).strip().isdigit() else None,
            "pptdf": c.get("pptdf_applicability"),
            "conformity_cadence": c.get("conformity_cadence"),
            "csf_function": c.get("nist_csf_function_grouping"),
            "erl_reference": split_codes(c.get("erl_reference")),
            "baselines": sorted(v for k, v in BASELINE_KEYS.items() if k in extra),
            "solutions": {v: extra[k] for k, v in SOLUTION_KEYS.items() if extra.get(k)},
            "risks": split_codes((c.get("mappings") or {}).get("Risk Threat Summary")),
            "threats": split_codes((c.get("mappings") or {}).get("Control Threat Summary")),
        })
        if c.get("cmm_levels"):
            out_cmm[scf_id] = c["cmm_levels"]

    # compensating: join strictly BY INDEX (assertion 3 is what licenses this)
    for i, c in enumerate(controls):
        block = compensating[i]
        alts = [
            {"scf_id": a.get("trigger"), "name": a.get("name"), "description": a.get("id"),
             "justification": a.get("justification")}
            for a in (block.get("alternatives") or [])
            if (a.get("trigger") or "N/A") != "N/A"
        ]
        out_controls[i]["compensating"] = alts
        out_controls[i]["risk_if_not_implemented"] = block.get("risk_if_not_implemented")
        out_controls[i]["is_material"] = out_controls[i]["weight"] == 10

    ao_by_control: Counter = Counter(o["scf_id"] for o in objectives)
    for row in out_controls:
        row["ao_count"] = ao_by_control.get(row["scf_id"], 0)
        row["mapped_source_count"] = sum(
            1 for s in per_source_controls if row["scf_id"] in per_source_controls[s]
        )

    out_objectives = [{
        "ao_id": o["ao_id"],
        "scf_id": o["scf_id"],
        "seq": int(m.group(1)) if (m := re.search(r"_A(\d+)$", o["ao_id"])) else 0,
        "objective": o.get("objective"),
        "pptdf": o.get("pptdf_applicability"),
        # rigor MUST stay a string: 191 rows carry 'NIST 800-171' where an int belongs
        "rigor": str(o.get("rigor")) if o.get("rigor") is not None else None,
        "origin": o.get("origin"),
        "defined_parameters": (o.get("extra") or {}).get("SCF Defined Parameters (SDP)"),
    } for o in objectives]

    out_erl = {
        "artifacts": [{
            "erl_id": e["erl_id"], "number": e.get("number"),
            "area_of_focus": e.get("area_of_focus"), "artifact": e.get("artifact"),
            "description": e.get("description"),
        } for e in erl],
        "links": sorted([list(p) for p in erl_pairs]),
    }

    out_sources = [{
        "source_key": k,
        "source_slug": slug_for[k],
        "display_name": k,
        "mapped_control_count": len(per_source_controls[slug_for[k]]),
        "mapped_requirement_count": len(per_source_reqs[slug_for[k]]),
    } for k in real_keys]
    out_sources.sort(key=lambda s: -s["mapped_control_count"])

    out_domains = [{
        "identifier": d["identifier"], "number": d.get("number"), "name": d.get("name"),
        "principles": d.get("principles"), "intent": d.get("intent"),
    } for d in domains]

    def dump(name: str, payload: Any) -> None:
        p = dest / name
        with io.open(p, "w", encoding="utf-8", newline="\n") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
            f.write("\n")
        print(f"  {name:<20} {p.stat().st_size:>10,} bytes")

    print("\nEmitting artifacts:")
    dump("controls.json", {"version": version, "controls": out_controls})
    dump("cmm_levels.json", {"version": version, "cmm_levels": out_cmm})
    dump("objectives.json", {"version": version, "objectives": out_objectives})
    dump("erl.json", {"version": version, **out_erl})
    dump("sources.json", {"version": version, "sources": out_sources})
    dump("domains.json", {"version": version, "domains": out_domains})

    mpath = dest / "mappings.csv.gz"
    with gzip.open(mpath, "wt", encoding="utf-8", newline="") as gz:
        w = csv.writer(gz)
        w.writerow(["release_version", "scf_id", "source_slug", "requirement_code", "relationship", "provenance"])
        w.writerows(rows)
    print(f"  {'mappings.csv.gz':<20} {mpath.stat().st_size:>10,} bytes  ({len(rows):,} rows)")

    manifest = {
        "version": version,
        "generated": meta.get("generated"),
        "source_url": meta.get("source_url"),
        "counts": {
            "controls": len(out_controls), "domains": len(out_domains),
            "objectives": len(out_objectives), "erl_artifacts": len(erl),
            "erl_links": len(erl_pairs), "sources": len(real_keys), "mappings": len(rows),
            "material_controls": sum(1 for c in out_controls if c["is_material"]),
            "orphan_controls": sum(1 for c in out_controls if c["mapped_source_count"] == 0),
        },
    }
    dump("manifest.json", manifest)
    return manifest


def main() -> int:
    ap = argparse.ArgumentParser(description="Build SCF seed artifacts from the release JSON.")
    ap.add_argument("--source", required=True, help="path to scf-full-<version>.json")
    ap.add_argument("--dest", default=str(Path(__file__).resolve().parents[1] / "seed_data" / "scf"))
    args = ap.parse_args()
    try:
        m = build(Path(args.source), Path(args.dest))
    except BuildError as e:
        print(f"\n{e}\n\nBuild aborted — artifacts NOT written.", file=sys.stderr)
        return 1
    print("\nManifest:")
    for k, v in m["counts"].items():
        print(f"  {k:<20} {v:>8,}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
