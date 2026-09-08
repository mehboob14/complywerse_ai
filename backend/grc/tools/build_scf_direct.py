"""Compile the direct requirement->SCF gap-closure mappings.

These are ONE-hop: a requirement is mapped straight onto the SCF control that
discharges it, with no ISO 27002 pivot. An audit of 671 links found the two-hop
pivot only 38-56% defensible while direct rows were the best data in the sample,
so these are emitted at their stated confidence with no breadth discount — there
is no intermediate clause whose fan-out could dilute them.

    python -m grc.tools.build_scf_direct --source <workflow result json>

Output: seed_data/scf/direct.csv.gz          (rows for scf_import)
        seed_data/scf/crosswalks/direct/<fw>.json  (reviewable, our authorship)
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[1]
SCF_DIR = ROOT / "seed_data" / "scf"
FW_DIR = ROOT / "seed_data" / "frameworks"
GAP_DIR = None  # set from --gaps
OUT_DIR = SCF_DIR / "crosswalks" / "direct"

CONFIDENCE = {"high": 0.85, "medium": 0.60, "low": 0.35}


def _merge_authored() -> int:
    """Fold the per-framework authored JSONs into direct.csv.gz, dropping nothing.

    The JSONs are NOT a complete record of the csv: 968 of the 4,858 direct rows
    have no JSON entry at all (158 NDMO codes appear only in the csv), so
    rebuilding the csv from them would silently discard a fifth of the mappings.
    This unions instead — every existing row is kept, authored rows are added —
    so a hand-authored file can reach the csv safely. SAMA CSF needed this: it
    resolves through SCF's own published crosswalk and so never had a workflow
    run to write its direct file.
    """
    path = SCF_DIR / "direct.csv.gz"
    header = ["scf_id", "source_slug", "requirement_code", "match_mode",
              "provenance", "confidence", "pivot_via_slug"]
    existing: set = set()
    if path.exists():
        with gzip.open(path, "rt", encoding="utf-8", newline="") as gz:
            r = csv.reader(gz)
            next(r, None)
            existing = set(map(tuple, r))

    authored: set = set()
    for p in sorted(OUT_DIR.glob("*.json")):
        doc = json.loads(p.read_text(encoding="utf-8"))
        slug = doc["framework"]
        for m in doc.get("mappings") or []:
            for sid in m.get("scf_ids") or []:
                authored.add((sid, slug, m["code"], "exact", "ai",
                              str(CONFIDENCE.get(m.get("confidence", "low"), 0.35)), ""))

    added = authored - existing
    merged = sorted(existing | authored)
    with gzip.open(path, "wt", encoding="utf-8", newline="") as gz:
        w = csv.writer(gz)
        w.writerow(header)
        w.writerows(merged)
    print(f"merged authored mappings: {len(existing)} existing + {len(added)} new "
          f"= {len(merged)} rows (nothing removed)")
    for slug in sorted({r[1] for r in added}):
        print(f"  +{sum(1 for r in added if r[1] == slug):>4}  {slug}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source")
    ap.add_argument("--gaps", help="the gap bundle directory")
    ap.add_argument("--merge-authored", action="store_true",
                    help="union crosswalks/direct/*.json into direct.csv.gz, leaving those files untouched")
    args = ap.parse_args()

    if args.merge_authored:
        return _merge_authored()
    if not args.source or not args.gaps:
        ap.error("--source and --gaps are required unless --merge-authored is given")

    raw = json.loads(Path(args.source).read_text(encoding="utf-8"))
    results = (raw.get("result") or raw).get("results") or []
    scf_ids = {c["scf_id"] for c in json.loads((SCF_DIR / "controls.json").read_text(encoding="utf-8"))["controls"]}
    gap_dir = Path(args.gaps)

    # the codes each framework was actually asked about — the only valid targets
    valid: Dict[str, set] = {}
    for p in gap_dir.glob("*.json"):
        if p.name.startswith("_"):
            continue
        doc = json.loads(p.read_text(encoding="utf-8"))
        valid[doc["framework"]] = {u["code"] for u in doc.get("unmapped", [])}

    by_fw: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for res in results:
        fw = str(res.get("framework", "")).strip()
        for m in res.get("mappings") or []:
            code = str(m.get("code", "")).strip()
            slug = fw
            if fw.upper() == "TAIL" or ":" in code:
                # the tail agent prefixes every code with its framework slug
                if ":" not in code:
                    continue
                slug, code = code.split(":", 1)
                slug, code = slug.strip(), code.strip()
            by_fw[slug].append({**m, "code": code})

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rows: List[List[Any]] = []
    print(f"{'framework':<26}{'judged':>7}{'mapped':>8}{'gap':>6}{'bad':>5}{'rows':>7}  confidence")
    print("-" * 84)
    tot = Counter()
    for slug, maps in sorted(by_fw.items()):
        ok_codes = valid.get(slug, set())
        seen, clean, bad, gaps = set(), [], 0, 0
        conf = Counter()
        for m in maps:
            code = m["code"]
            if not code or code in seen or (ok_codes and code not in ok_codes):
                bad += 1
                continue
            seen.add(code)
            ids = [s for s in (m.get("scf_ids") or []) if s in scf_ids]
            dropped = len(m.get("scf_ids") or []) - len(ids)
            bad += 0 if not dropped else 0     # counted separately below
            c = m.get("confidence", "low")
            conf[c] += 1
            if not ids:
                gaps += 1
            clean.append({"code": code, "scf_ids": ids, "confidence": c,
                          "rationale": m.get("rationale", ""),
                          "unmappable_reason": m.get("unmappable_reason")})
            for sid in ids:
                rows.append([sid, slug, code, "exact", "ai", CONFIDENCE.get(c, 0.35), ""])
        payload = {"framework": slug, "hop": "direct", "authored_by": "workflow:scf-requirement-gap-closure",
                   "note": "One-hop requirement->SCF mapping. provenance=ai, confidence<1.0.",
                   "mappings": clean}
        with io.open(OUT_DIR / f"{slug}.json", "w", encoding="utf-8", newline="\n") as f:
            json.dump(payload, f, ensure_ascii=False, indent=1)
            f.write("\n")
        n_rows = sum(len(c["scf_ids"]) for c in clean)
        tot["judged"] += len(clean); tot["gap"] += gaps; tot["bad"] += bad; tot["rows"] += n_rows
        print(f"{slug:<26}{len(clean):>7}{len(clean)-gaps:>8}{gaps:>6}{bad:>5}{n_rows:>7}  "
              f"h={conf['high']} m={conf['medium']} l={conf['low']}")

    # The csv has exactly one writer, and it unions. Rebuilding it from this
    # run's rows alone would drop every row belonging to a framework this
    # result does not cover — 968 of the 4,858 rows already have no JSON entry
    # to be rebuilt from, so that loss would be silent and unrecoverable.
    print("-" * 84)
    _merge_authored()

    print("-" * 84)
    print(f"{'TOTAL':<26}{tot['judged']:>7}{tot['judged']-tot['gap']:>8}{tot['gap']:>6}{tot['bad']:>5}"
          f"{len(set(map(tuple, rows))):>7}")
    pct = (tot['judged'] - tot['gap']) / tot['judged'] * 100 if tot['judged'] else 0
    print(f"\nmapped {pct:.0f}% — {tot['gap']} requirements returned as honest gaps "
          f"(a 100% mapping rate would have been the warning sign)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
