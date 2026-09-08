"""Resolve artifact catalogue items onto SCF controls.

    python -m grc.tools.artifact_resolver            # report
    python -m grc.tools.artifact_resolver --emit     # + write artifact_resolution.json

The catalogue (seed_data/artifact_catalog.json) was authored against framework
documents, not against our libraries, so two vocabularies have to be bridged
before an artifact can be attached to a control:

  * the catalogue's framework keys are its own (`iso_27001_2022`, `qatar_cb`);
    KEY_ALIAS maps them onto crosswalk_registry slugs.
  * `control_ref` is prose a human wrote while reading the standard --
    "Cl. 5.1", "Art. 24 / 5", "A.5.24-28", "Req 12.10", "CIS Methodology".
    _candidates() turns that into zero or more library codes.

Nothing is dropped silently: every one of the 922 items lands in exactly one
status, and the unresolved ones carry the reason. That is the point of the
report -- the misses are a worklist, not an error.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / "seed_data"
SCF_DIR = SEED / "scf"
CATALOG = SEED / "artifact_catalog.json"
OUT = SEED / "artifact_resolution.json"

# -- catalogue key -> crosswalk_registry slug ----------------------------------
# 13 keys already agree with the registry and are absent here. A `None` means the
# framework has no library of ours: its artifacts are real, they simply have
# nothing to hang off unless SCF_SOURCE gives them an SCF crosswalk source.
KEY_ALIAS: Dict[str, str | None] = {
    "adhie": "doh_adhie_policy",
    "aramco_csc": "aramco_ccc",
    "cis_v8": "cis_controls",
    "cobit_2019": "cobit",
    "iso_22301_2019": "iso_22301",
    "iso_27001_2022": "iso_27001",
    "iso_41001_2018": None,        # facility management; not a framework we carry
    "iso_42001_2023": "iso_42001",
    "ksa_data_transfer": "ksa_pdp_transfer",
    "ksa_ndmo": "ndmo",
    "nist_ai_rmf": "nist_airmf",
    "nist_csf_2": "nist_csf",
    "nist_sp_800_53_r5": "nist_800_53",
    "pci_dss_v4": "pci_dss",
    "pdpl_ksa": None,              # no library; resolved against SCF's source below
    "qatar_cb": "qcb_technology_risks",
    "sbp_cloud_outsourcing": "sbp_cloud",
    "sox_itgc": "sox",
    "sri_lanka_bss": "sl_csf",
}

# Keys with no library of ours but a crosswalk source inside SCF: match the ref
# against SCF's own requirement codes instead.
SCF_SOURCE: Dict[str, str] = {"pdpl_ksa": "emea_saudi_arabia_pdpl"}

# -- control_ref -> library code -----------------------------------------------
GLOBAL_REWRITES: List[Tuple[str, str]] = [
    (r"^(?:Cl\.|Clause)\s*", ""),
    (r"^(?:Art\.|Article)\s*", "Article "),
    (r"^(?:Req\.?|Requirement)\s+", ""),
    (r"^Control\s+", ""),
    (r"^Sec\.\s*", ""),
    (r"\.x$", ""),                 # "A.7.x" -> "A.7", then parent-matched
]
KEY_REWRITES: Dict[str, List[Tuple[str, str]]] = {
    "aramco_csc": [(r"^CC-", "")],
    "sri_lanka_bss": [(r"^BSS-", "")],
    "hipaa": [(r"^45 CFR\s+", ""), (r"^(?=1\d\d\.)", "§")],
    "hitrust_csf": [(r"^0\.", "00.")],
    "pdpl_ksa": [(r"^PDPL\s+", "")],
}
SEPARATORS = re.compile(r"\s+/\s+|\s*,\s*|\s+\+\s+")
RANGE = re.compile(r"^(.*?)(\d+)\s*[-–]\s*(.*?)(\d+)(\D*)$")
# "CC3 Risk Assessment" -- a code followed by the words that name it.
TRAILING_WORDS = re.compile(r"^([A-Za-z.§-]*\d[\w.()§-]*)\s+[A-Za-z][A-Za-z ]*$")


def _strip_gloss(ref: str) -> str:
    """Drop an explanatory trailing parenthetical -- "A1.1 (Avail)" -- while keeping
    a structural one -- "164.308(a)(2)". Long or spaced content is prose."""
    m = re.search(r"\s*\(([^()]*)\)\s*$", ref)
    if m and (" " in m.group(1) or len(m.group(1)) > 4):
        ref = ref[: m.start()].strip()
    m = TRAILING_WORDS.match(ref)
    return m.group(1) if m else ref


def _expand_range(code: str) -> List[str]:
    """A.5.24-28, DG.4.3-DG.4.11, GOVERN 2.2-2.3 -> the codes they stand for."""
    m = RANGE.match(code)
    if not m:
        return [code]
    head, lo, mid, hi, tail = m.group(1), m.group(2), m.group(3), int(m.group(4)), m.group(5)
    if not (mid == "" or mid == head or head.endswith(mid)):
        return [code]
    if not 0 < hi - int(lo) < 40:
        return [code]
    # keep the written width (COBIT EDM01-05 -> EDM01..EDM05, not EDM1..EDM5)
    # and whatever closed after the range (DORA "Art. 8(4-6)" -> "Article 8(4)").
    return [f"{head}{n:0{len(lo)}d}{tail}" for n in range(int(lo), hi + 1)]


def _candidates(ref: str, key: str) -> List[str]:
    ref = _strip_gloss(ref).strip()
    if not ref:
        return []
    parts = [p.strip() for p in SEPARATORS.split(ref) if p.strip()]
    rules = GLOBAL_REWRITES + KEY_REWRITES.get(key, [])
    out: List[str] = []
    lead = ""
    for i, part in enumerate(parts):
        # "Art. 24 / 5": the second fragment inherits the first fragment's prefix.
        if i and lead and re.match(r"^[\d.]+$", part):
            part = lead + part
        for pat, rep in rules:
            part = re.sub(pat, rep, part).strip()
        if i == 0:
            m = re.match(r"^([A-Za-z.§ ]*?)(?=\d)", part)
            lead = m.group(1) if m else ""
        out.extend(_expand_range(part))
    return out


# -- lookups -------------------------------------------------------------------
SEPS = (".", "-", "(", " ")


def _match(cand: str, codes: Set[str]) -> Tuple[List[str], str]:
    if cand in codes:
        return [cand], "exact"
    kids = [c for c in codes if any(c.startswith(cand + s) for s in SEPS)]
    if kids:
        return sorted(kids), "parent"
    # the ref is finer than the library (COBIT APO01.04 -> APO01): inherit the
    # longest library code that is a proper prefix of it.
    best = max((c for c in codes if any(cand.startswith(c + s) for s in SEPS)),
               key=len, default=None)
    return ([best], "child") if best else ([], "")


def _load() -> Tuple[Dict[str, Set[str]], Dict[Tuple[str, str], Set[str]], Dict[str, Set[str]]]:
    """(library codes per slug, scf_ids per (slug, code), SCF's own codes per source)."""
    reg = json.loads((SCF_DIR / "crosswalk_registry.json").read_text(encoding="utf-8"))
    lib: Dict[str, Set[str]] = {}
    for e in reg["frameworks"]:
        p = SEED / "frameworks" / e["file"]
        if not p.exists():
            continue
        field = e.get("join_field", "control_id")
        data = json.loads(p.read_text(encoding="utf-8"))
        lib[e["slug"]] = {str(c.get(field) or c.get("control_id") or "").strip()
                          for c in (data.get("controls") or [])} - {""}
    scf: Dict[Tuple[str, str], Set[str]] = defaultdict(set)
    for name in ("resolved.csv.gz", "direct.csv.gz"):
        with gzip.open(SCF_DIR / name, "rt", encoding="utf-8", newline="") as gz:
            for row in csv.DictReader(gz):
                scf[(row["source_slug"], row["requirement_code"])].add(row["scf_id"])
    native: Dict[str, Set[str]] = defaultdict(set)
    wanted = set(SCF_SOURCE.values())
    with gzip.open(SCF_DIR / "mappings.csv.gz", "rt", encoding="utf-8", newline="") as gz:
        for row in csv.DictReader(gz):
            if row["source_slug"] in wanted:
                native[row["source_slug"]].add(row["requirement_code"])
                scf[(row["source_slug"], row["requirement_code"])].add(row["scf_id"])
    return lib, scf, native


def resolve() -> Dict[str, Any]:
    lib, scf, native = _load()
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    items: List[Dict[str, Any]] = []
    for key in sorted(catalog):
        slug = KEY_ALIAS.get(key, key)
        src = SCF_SOURCE.get(key)
        codes = lib.get(slug) if slug else (native.get(src) if src else None)
        lookup_slug = slug or src
        for art in catalog[key]["artifacts"]:
            rec: Dict[str, Any] = {
                "framework_key": key, "slug": lookup_slug,
                "artifact_id": art.get("artifact_id"), "name": art.get("name"),
                "control_ref": art.get("control_ref"), "codes": [], "scf_ids": [],
                "match_mode": "", "status": "",
            }
            ref = (art.get("control_ref") or "").strip()
            if not codes:
                rec["status"] = "no_framework"
            else:
                hits: Set[str] = set()
                modes: Set[str] = set()
                # Match before judging the shape of the ref: NIST CSF codes carry
                # no digits at all ("GV.OC"), so "looks like prose" is only a
                # verdict you can reach once matching has failed.
                for cand in _candidates(ref, key):
                    got, mode = _match(cand, codes)
                    hits |= set(got)
                    if mode:
                        modes.add(mode)
                if hits:
                    rec["codes"] = sorted(hits)
                    rec["match_mode"] = ("exact" if modes == {"exact"}
                                         else "parent" if "parent" in modes else "child")
                    rec["scf_ids"] = sorted({s for c in hits
                                             for s in scf.get((lookup_slug, c), ())})
                    rec["status"] = "resolved" if rec["scf_ids"] else "no_scf_mapping"
                elif any(ch.isdigit() for ch in ref):
                    rec["status"] = "unmatched_ref"
                else:
                    rec["status"] = "prose_ref"
            items.append(rec)
    manifest = json.loads((SCF_DIR / "manifest.json").read_text(encoding="utf-8"))
    return {"scf_version": manifest.get("version"), "items": items}


def merge_into_evidence(dry_run: bool = False) -> Dict[str, int]:
    """Fold the resolved catalogue artifacts into the per-control evidence sets.

    A catalogue artifact is a deliverable someone owes ("ISMS Project Charter",
    DOCX, Top Management); a consolidated evidence artifact is a document an
    auditor asks for. Where both name the same thing, they are the same thing:
    the framework joins the existing entry's `required_by` instead of adding a
    near-duplicate row -- which the control page needs anyway, since it keys its
    list on the artifact name.

    A `parent` match got here from a section-level reference ("A.8.x" for the
    whole of Annex A.8), so it lands on every control in that section. That is
    labelled, not excluded, the same way the crosswalk labels parent mappings.
    """
    # The label has to be the one the consolidated sets already use: the catalogue
    # writes "ISO/IEC 27001:2022" where they write "ISO 27001", and the control page
    # counts distinct required_by entries, so two spellings read as two frameworks.
    from dotenv import load_dotenv          # the router imports the app, which wants .env
    load_dotenv(ROOT.parent / ".env")
    from grc.modules.automation.router import _FW_LABELS

    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    meta = {(k, a.get("artifact_id")): a
            for k, v in catalog.items() for a in v["artifacts"]}

    path = SCF_DIR / "evidence_consolidated.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    controls: Dict[str, Any] = doc["controls"]

    stat: Dict[str, int] = defaultdict(int)
    stat["controls_before"] = len(controls)
    for item in resolve()["items"]:
        if item["status"] != "resolved":
            continue
        art = meta.get((item["framework_key"], item["artifact_id"])) or {}
        slug = item["slug"]
        fw = _FW_LABELS.get(slug) or slug.replace("_", " ").title()
        for scf_id in item["scf_ids"]:
            entry = controls.setdefault(scf_id, {"artifacts": [], "input_count": 0})
            existing = next((a for a in entry["artifacts"]
                             if a["name"].lower() == item["name"].lower()), None)
            if existing:
                if fw not in existing["required_by"]:
                    existing["required_by"].append(fw)
                    stat["frameworks_added"] += 1
                else:
                    stat["already_present"] += 1
                continue
            entry["artifacts"].append({
                "name": item["name"],
                "description": art.get("description") or "",
                "collection_method": "manual",
                "required_by": [fw],
                "filetype": art.get("format"),
                "source": "catalog",
                "artifact_id": item["artifact_id"],
                "artifact_type": art.get("type"),
                "owner": art.get("owner"),
                "mandatory": art.get("mandatory"),
                "stage": art.get("stage"),
                "match_mode": item["match_mode"],
            })
            stat["artifacts_added"] += 1
    stat["controls_after"] = len(controls)
    doc["note"] = (doc["note"].split(" Catalogue")[0] +
                   " Catalogue deliverables carry source=catalog and the match_mode"
                   " that attached them.")
    if not dry_run:
        path.write_text(json.dumps(doc, indent=1, ensure_ascii=False), encoding="utf-8")
    return dict(stat)


def selftest() -> None:
    """The cases that cost a debugging round each. Run before trusting a rule change."""
    cases = [
        # (ref, key, expected candidates)
        ("Cl. 5.1", "iso_27001_2022", ["5.1"]),
        ("Art. 24 / 5", "gdpr", ["Article 24", "Article 5"]),   # prefix inheritance
        ("Art. 8(4-6)", "dora", ["Article 8(4)", "Article 8(5)", "Article 8(6)"]),
        ("EDM01-05", "cobit_2019", ["EDM01", "EDM02", "EDM03", "EDM04", "EDM05"]),
        ("A.5.24-28", "iso_27001_2022", [f"A.5.{n}" for n in range(24, 29)]),
        ("A1.1 (Avail)", "soc2", ["A1.1"]),                     # gloss dropped
        ("CC3 Risk Assessment", "soc2", ["CC3"]),               # trailing words dropped
        ("164.308(a)(2)", "hipaa", ["§164.308(a)(2)"]),         # structural parens kept
        ("Control 0.a", "hitrust_csf", ["00.a"]),
        ("AC 1.1", "adhics", ["AC 1.1"]),                       # dash-free code untouched
        ("A.7.x", "iso_27001_2022", ["A.7"]),
        ("CIS Methodology", "cis_v8", ["CIS Methodology"]),     # prose survives intact
    ]
    for ref, key, want in cases:
        got = _candidates(ref, key)
        assert got == want, f"{ref!r} ({key}) -> {got}, wanted {want}"

    codes = {"1.1", "1.2", "APO01", "GV.OC-01"}
    assert _match("1.1", codes) == (["1.1"], "exact")
    assert _match("1", codes) == (["1.1", "1.2"], "parent")
    assert _match("GV.OC", codes) == (["GV.OC-01"], "parent")
    assert _match("APO01.04", codes) == (["APO01"], "child")
    assert _match("nope", codes) == ([], "")

    items = resolve()["items"]
    assert all(i["status"] for i in items), "an item left the resolver with no status"
    assert all(i["scf_ids"] for i in items if i["status"] == "resolved")
    print(f"selftest ok — {len(cases) + 5} rules, {len(items)} items all dispositioned")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--emit", action="store_true", help=f"write {OUT.name}")
    ap.add_argument("--misses", action="store_true", help="list every unresolved ref")
    ap.add_argument("--selftest", action="store_true", help="check the normalizer rules")
    ap.add_argument("--merge", action="store_true",
                    help="fold resolved artifacts into evidence_consolidated.json")
    ap.add_argument("--dry-run", action="store_true", help="with --merge: report, write nothing")
    args = ap.parse_args()

    if args.selftest:
        selftest()
        return 0
    if args.merge:
        for k, v in merge_into_evidence(dry_run=args.dry_run).items():
            print(f"{k:<20}{v:>7}")
        if args.dry_run:
            print("(dry run — nothing written)")
        return 0

    doc = resolve()
    items = doc["items"]
    by_key: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for i in items:
        by_key[i["framework_key"]][i["status"]] += 1

    head = (f"{'framework':<24}{'items':>6}{'resolved':>10}{'no_scf':>8}"
            f"{'unmatched':>11}{'prose':>7}{'no_fw':>7}")
    print(head)
    for key in sorted(by_key):
        c = by_key[key]
        print(f"{key:<24}{sum(c.values()):>6}{c['resolved']:>10}{c['no_scf_mapping']:>8}"
              f"{c['unmatched_ref']:>11}{c['prose_ref']:>7}{c['no_framework']:>7}")
    tot: Dict[str, int] = defaultdict(int)
    for i in items:
        tot[i["status"]] += 1
    print("-" * len(head))
    print(f"{'TOTAL':<24}{len(items):>6}{tot['resolved']:>10}{tot['no_scf_mapping']:>8}"
          f"{tot['unmatched_ref']:>11}{tot['prose_ref']:>7}{tot['no_framework']:>7}")
    assert sum(tot.values()) == len(items), "an item fell out of the status buckets"

    if args.misses:
        print("\nunresolved refs:")
        seen = set()
        for i in items:
            if i["status"] in ("unmatched_ref", "prose_ref", "no_scf_mapping"):
                k = (i["framework_key"], i["control_ref"])
                if k not in seen:
                    seen.add(k)
                    print(f"  {i['status']:<15}{i['framework_key']:<22}{i['control_ref']}")
    if args.emit:
        OUT.write_text(json.dumps(doc, indent=1, ensure_ascii=False), encoding="utf-8")
        print(f"\nwrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
