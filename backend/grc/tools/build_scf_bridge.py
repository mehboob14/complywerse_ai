"""Compile the authored regional crosswalk into SCF bridge rows.

The 12 framework libraries SCF does not map reach it in two hops:

    req(qcb, 1.1.1) --authored--> clause(iso_27002, 5.1) <--scf-- ctl(SCF, GOV-01)

Hop depth is capped at 2 by construction. `subset-of` is not usefully transitive,
so a third hop is never inferred — if a framework genuinely needs one, author a
direct row instead of raising the cap.

Input : the bridge workflow's JSON result (--source)
Output: seed_data/scf/crosswalks/<slug>_to_scf.json   (reviewable, our authorship)
        seed_data/scf/bridge.csv.gz                   (resolved rows for import)

Everything emitted carries provenance='ai' and confidence < 1.0. These rows are
OUR mapping of OUR framework text onto SCF identifiers — never SCF-derived prose.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[1]
SCF_DIR = ROOT / "seed_data" / "scf"
FW_DIR = ROOT / "seed_data" / "frameworks"
OUT_DIR = SCF_DIR / "crosswalks"

PIVOT_SLUG = "iso_27002_2022"
CONFIDENCE = {"high": 0.85, "medium": 0.60, "low": 0.35}

# Precision controls for the 2-hop pivot. An ISO 27002 clause maps to a median of
# 5 SCF controls (max 24), so a single authored edge fans out. An audit of 671
# links found authored mappings only 38% defensible vs 73% for SCF-published ones,
# with the damage concentrated in broad clauses and in pairs claiming dozens of
# requirements. Three rules, applied in order:
#   1. confidence is DISCOUNTED by how broadly the pivot clause fans out
#   2. anything below CONFIDENCE_FLOOR is dropped rather than shipped as noise
#   3. a (control, framework) pair keeps at most MAX_PER_PAIR, highest first
# These affect provenance='ai' rows only. SCF-published mappings are untouched.
BREADTH_FULL_CREDIT = 3      # clauses this narrow keep their full confidence
CONFIDENCE_FLOOR = 0.20
MAX_PER_PAIR = 8

# agent framework key -> (our framework slug, library filename)
FRAMEWORKS = {
    "hitrust_csf": ("hitrust_csf", "hitrust_csf.json"),
    "adhics": ("adhics", "adhics.json"),
    "doh_adhie_policy": ("doh_adhie_policy", "doh_adhie_policy.json"),
    "qcb_technology_risks": ("qcb_technology_risks", "qcb_technology_risks.json"),
    "sbp_etgrmf": ("sbp_etgrmf", "sbp_etgrmf.json"),
    "sbp_cloud": ("sbp_cloud", "sbp_cloud.json"),
    "sbp_internet_banking": ("sbp_internet_banking", "sbp_internet_banking.json"),
    "sl_csf": ("sl_csf", "sl_csf.json"),
    "pisf_2026": ("pisf_2026", "pisf_2026.json"),
    "ndmo": ("ndmo", "NDMO_Data_Management_Standardsv1.5.json"),
    "ksa_pdp_transfer": ("ksa_pdp_transfer", "Regulation on_Personal_Data_Transfer_Outside_KSA.json"),
}
# One agent covered two files whose control_ids collide (both use 1.1, 1.2 …);
# it was told to name the file in its rationale, which is how we split them back out.
SPLIT_BY_RATIONALE = {
    "aramco_sabic": [("aramco_ccc", "aramco_ccc.json"), ("sabic_cybertrust", "sabic_cybertrust.json")],
}


def framework_ids(filename: str) -> set:
    p = FW_DIR / filename
    if not p.exists():
        return set()
    data = json.loads(p.read_text(encoding="utf-8"))
    return {str(c.get("control_id", "")).strip() for c in (data.get("controls") or [])}


def load_pivot() -> Dict[str, set]:
    """ISO 27002 clause -> the SCF controls that discharge it."""
    out: Dict[str, set] = defaultdict(set)
    with gzip.open(SCF_DIR / "mappings.csv.gz", "rt", encoding="utf-8", newline="") as gz:
        for r in csv.DictReader(gz):
            if r["source_slug"] == PIVOT_SLUG:
                out[r["requirement_code"]].add(r["scf_id"])
    return out


def load_scf_ids() -> set:
    doc = json.loads((SCF_DIR / "controls.json").read_text(encoding="utf-8"))
    return {c["scf_id"] for c in doc["controls"]}


def main() -> int:
    ap = argparse.ArgumentParser(description="Compile the authored regional bridge.")
    ap.add_argument("--source", required=True, help="bridge workflow result JSON")
    args = ap.parse_args()

    raw = json.loads(Path(args.source).read_text(encoding="utf-8"))
    results = (raw.get("result") or raw).get("results") or []
    pivot = load_pivot()
    scf_ids = load_scf_ids()
    print(f"pivot: {len(pivot)} ISO 27002 clauses -> SCF; catalog has {len(scf_ids):,} controls\n")

    # merge chunked agents, splitting the combined one back into its two files
    by_fw: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for res in results:
        key = str(res.get("framework", "")).strip()
        maps = res.get("mappings") or []
        if key in SPLIT_BY_RATIONALE:
            for slug, filename in SPLIT_BY_RATIONALE[key]:
                stem = filename.replace(".json", "")
                by_fw[slug].extend([m for m in maps if stem in (m.get("rationale") or "")])
            continue
        if key not in FRAMEWORKS:
            print(f"  ! unknown framework key from agent: {key!r} — skipped")
            continue
        by_fw[FRAMEWORKS[key][0]].extend(maps)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rows: List[List[Any]] = []
    print(f"{'framework':<24}{'ctrls':>6}{'mapped':>7}{'empty':>6}{'bad':>5}{'scf reach':>10}  confidence")
    print("-" * 84)

    totals = Counter()
    for slug, maps in sorted(by_fw.items()):
        filename = dict(list(FRAMEWORKS.values()) + [t for v in SPLIT_BY_RATIONALE.values() for t in v]).get(slug)
        valid_ids = framework_ids(filename) if filename else set()
        seen, clean, bad, empty = set(), [], 0, 0
        conf = Counter()
        for m in maps:
            cid = str(m.get("control_id", "")).strip()
            if not cid or (valid_ids and cid not in valid_ids) or cid in seen:
                bad += 1
                continue
            seen.add(cid)
            clauses = [c for c in (m.get("iso_clauses") or []) if c in pivot]
            direct = [s for s in (m.get("scf_ids") or []) if s in scf_ids]
            if not clauses and not direct:
                empty += 1
            c = m.get("confidence", "low")
            conf[c] += 1
            score = CONFIDENCE.get(c, 0.35)
            clean.append({"control_id": cid, "iso_clauses": clauses, "scf_ids": direct,
                          "confidence": c, "rationale": m.get("rationale", "")})
            # hop 1: our code -> ISO clause; hop 2: ISO clause -> SCF control.
            # A clause that fans out to N controls gives each edge proportionally
            # less credit — riding a broad clause is weak evidence, not strong.
            for cl in clauses:
                breadth = len(pivot[cl]) or 1
                adj = round(score * min(1.0, BREADTH_FULL_CREDIT / breadth), 3)
                for sid in pivot[cl]:
                    rows.append([sid, slug, cid, "exact", "ai", adj, PIVOT_SLUG])
            for sid in direct:                      # authored straight onto SCF, one hop
                rows.append([sid, slug, cid, "exact", "ai", score, ""])

        payload = {"framework": slug, "library": filename, "pivot": PIVOT_SLUG,
                   "authored_by": "workflow:scf-regional-bridge",
                   "note": "Our mapping of our framework text onto SCF identifiers. "
                           "provenance=ai, confidence<1.0 — label it in the UI.",
                   "mappings": clean}
        with io.open(OUT_DIR / f"{slug}_to_scf.json", "w", encoding="utf-8", newline="\n") as f:
            json.dump(payload, f, ensure_ascii=False, indent=1)
            f.write("\n")

        reach = {r[0] for r in rows if r[1] == slug}
        totals["controls"] += len(valid_ids)
        totals["mapped"] += len(clean) - empty
        totals["bad"] += bad
        print(f"{slug:<24}{len(valid_ids):>6}{len(clean)-empty:>7}{empty:>6}{bad:>5}{len(reach):>10}  "
              f"h={conf['high']} m={conf['medium']} l={conf['low']}")

    # ── precision pass: floor, then cap each (control, framework) pair ─────────
    before = len(rows)
    rows = [r for r in rows if r[5] >= CONFIDENCE_FLOOR]
    after_floor = len(rows)
    by_pair: Dict[Any, List[List[Any]]] = defaultdict(list)
    for r in rows:
        by_pair[(r[0], r[1])].append(r)
    capped: List[List[Any]] = []
    over = 0
    for pair_rows in by_pair.values():
        if len(pair_rows) > MAX_PER_PAIR:
            over += 1
        pair_rows.sort(key=lambda r: (-r[5], r[2]))
        capped.extend(pair_rows[:MAX_PER_PAIR])
    rows = capped
    print("")
    print("precision pass (authored rows only):")
    print(f"  emitted            {before:,}")
    print(f"  after floor {CONFIDENCE_FLOOR}   {after_floor:,}  (-{before-after_floor:,} too weak to defend)")
    print(f"  after cap {MAX_PER_PAIR}/pair   {len(rows):,}  ({over:,} pairs truncated)")

    with gzip.open(SCF_DIR / "bridge.csv.gz", "wt", encoding="utf-8", newline="") as gz:
        w = csv.writer(gz)
        w.writerow(["scf_id", "source_slug", "requirement_code", "match_mode",
                    "provenance", "confidence", "pivot_via_slug"])
        w.writerows(sorted(set(map(tuple, rows))))

    uniq = len(set(map(tuple, rows)))
    print("-" * 84)
    print(f"{'TOTAL':<24}{totals['controls']:>6}{totals['mapped']:>7}{'':>6}{totals['bad']:>5}")
    print(f"\nbridge rows: {uniq:,} unique  ->  {SCF_DIR / 'bridge.csv.gz'}")
    print(f"per-framework review files: {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
