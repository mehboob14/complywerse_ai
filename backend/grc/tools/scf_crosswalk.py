"""Resolve our framework libraries onto the SCF crosswalk.

For each framework in seed_data/frameworks/, the registry names the SCF source(s)
its requirement codes live under and the normalizers needed to make the two code
formats agree. This resolves ONCE at seed time into grc_scf_mapping rows; nothing
normalizes at query time.

    python -m grc.tools.scf_crosswalk              # coverage report
    python -m grc.tools.scf_crosswalk --emit       # + write resolved.csv.gz

Exact and parent matches are ALWAYS reported separately. A parent match (our
`APO01` matching SCF's `APO01.01`) is fine for navigation and indefensible in
assurance without review, so `match_mode` is carried through to
`grc_scf_mapping` and the importer grades it: exact rows land at confidence
1.00, parent and child rows at 0.60. They are NOT excluded from conformance —
they are labelled, and the control detail view badges them.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

ROOT = Path(__file__).resolve().parents[1]
SCF_DIR = ROOT / "seed_data" / "scf"
FW_DIR = ROOT / "seed_data" / "frameworks"
REGISTRY = SCF_DIR / "crosswalk_registry.json"

# ── the eight normalizer primitives, applied left to right ───────────────────────
# Deliberately small. If a framework needs a ninth, prefer an alias table over a
# new primitive — this is a lookup problem, not a parsing problem.


def _zero_pad_family(code: str) -> str:
    """AC-1 -> AC-01 (NIST 800-53 family numbering only)."""
    return re.sub(r"^([A-Z]{2,3})-(\d)(?![\d])", lambda m: f"{m.group(1)}-0{m.group(2)}", code)


def _paren_num_to_dot(code: str) -> str:
    """Article 5(1)(a) -> Article 5.1.a"""
    out = code
    while True:
        nxt = re.sub(r"\((\w+)\)", r".\1", out, count=1)
        if nxt == out:
            return out
        out = nxt


def _paren_first_to_dot(code: str) -> str:
    """Article 5(1)(a) -> Article 5.1(a). SCF writes GDPR/NIS2 that way: the
    numeric sub-article becomes a dot, the lettered point stays parenthesised."""
    return re.sub(r"\((\w+)\)", r".\1", code, count=1)


def _enhancement_to_base(code: str) -> str:
    """AC-02(01) -> AC-02. NIST 800-53 control enhancements are separate codes in
    SCF (518 of its 810) but our library carries base controls only, so without this
    the base control matches nothing and the enhancement rows are all discarded."""
    return re.sub(r"\(\d+\)\s*$", "", code).strip()


def _article_root(code: str) -> str:
    m = re.match(r"^(Article\s+\d+)", code)
    return m.group(1) if m else code


def apply_normalizers(code: str, steps: List[str], aliases: Dict[str, str]) -> str:
    out = code.strip()
    for step in steps:
        if step == "squeeze_ws":
            out = re.sub(r"\s+", " ", out).strip()
        elif step == "upper":
            out = out.upper()
        elif step == "enhancement_to_base":
            out = _enhancement_to_base(out)
        elif step == "zero_pad_family":
            out = _zero_pad_family(out)
        elif step == "paren_num_to_dot":
            out = _paren_num_to_dot(out)
        elif step == "paren_first_to_dot":
            out = _paren_first_to_dot(out)
        elif step == "article_root":
            out = _article_root(out)
        elif step.startswith("strip_prefix:"):
            p = step.split(":", 1)[1]
            if out.startswith(p):
                out = out[len(p):]
        elif step.startswith("strip_regex:"):
            out = re.sub(step.split(":", 1)[1], "", out)
        else:
            raise ValueError(f"unknown normalizer: {step}")
        out = out.strip()
    return aliases.get(out, out)


# ── loading ─────────────────────────────────────────────────────────────────────

def load_scf_codes() -> Tuple[Dict[str, Set[str]], Dict[Tuple[str, str], Set[str]]]:
    """(codes per source_slug, scf_ids per (source_slug, requirement_code))."""
    path = SCF_DIR / "mappings.csv.gz"
    if not path.exists():
        sys.exit(f"missing {path} — run: python -m grc.tools.build_scf_seed --source <scf-full.json>")
    codes: Dict[str, Set[str]] = defaultdict(set)
    index: Dict[Tuple[str, str], Set[str]] = defaultdict(set)
    with gzip.open(path, "rt", encoding="utf-8", newline="") as gz:
        for row in csv.DictReader(gz):
            slug, code = row["source_slug"], row["requirement_code"]
            codes[slug].add(code)
            index[(slug, code)].add(row["scf_id"])
    return codes, index


def framework_codes(entry: Dict[str, Any]) -> List[str]:
    path = FW_DIR / entry["file"]
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    field = entry.get("join_field", "control_id")
    out, seen = [], set()
    for c in data.get("controls") or []:
        raw = c.get(field) or c.get("control_id")
        if not raw:
            continue
        raw = str(raw).strip()
        if raw and raw.upper() != "N/A" and raw not in seen:
            seen.add(raw)
            out.append(raw)
    return out


# ── matching ────────────────────────────────────────────────────────────────────

def resolve(entry: Dict[str, Any], scf_codes: Dict[str, Set[str]],
            index: Dict[Tuple[str, str], Set[str]]) -> Dict[str, Any]:
    steps = entry.get("normalize") or []
    aliases = entry.get("aliases") or {}
    allow_parent = entry.get("match_mode") == "parent"
    allow_child = entry.get("match_mode") == "child"
    ours = framework_codes(entry)
    keys = entry.get("scf_keys") or []

    # Normalize BOTH sides with the same steps, so a difference that is purely
    # formatting (HIPAA's "§ 164.306" vs our "§164.306") cancels out. The map keeps
    # the ORIGINAL SCF codes, which are what the crosswalk index is keyed on.
    norm_pool: Dict[str, Set[Tuple[str, str]]] = defaultdict(set)
    for slug in keys:
        for code in scf_codes.get(slug, set()):
            norm_pool[apply_normalizers(code, steps, aliases)].add((slug, code))

    exact, parent, misses = [], [], []
    rows: List[List[str]] = []
    for raw in ours:
        norm = apply_normalizers(raw, steps, aliases)
        hit_mode: str | None = None
        hits: Set[Tuple[str, str]] = set()
        if norm in norm_pool:
            hit_mode, hits = "exact", norm_pool[norm]
        elif allow_parent:
            for cand, pairs in norm_pool.items():
                if cand.startswith(norm + ".") or cand.startswith(norm + "("):
                    hits |= pairs
            if hits:
                hit_mode = "parent"
        elif allow_child:
            # Our code is MORE granular than the source's: SAMA's re-extracted
            # 3.1.4.7 rolls up to SCF's 3.1.4. Take the longest source code that is
            # a proper prefix, so a sub-requirement inherits its parent's mapping
            # rather than being dropped.
            best = None
            for cand in norm_pool:
                if norm.startswith(cand + ".") and (best is None or len(cand) > len(best)):
                    best = cand
            if best:
                hit_mode, hits = "child", norm_pool[best]
        if hit_mode is None:
            misses.append(raw)
            continue
        (exact if hit_mode == "exact" else parent).append(raw)
        for slug, code in hits:
            for scf_id in index.get((slug, code), ()):
                rows.append([scf_id, entry["slug"], raw, hit_mode, "resolver"])

    return {
        "slug": entry["slug"], "file": entry["file"], "total": len(ours),
        "exact": len(exact), "parent": len(parent), "missed": len(misses),
        "matched": len(exact) + len(parent), "miss_examples": misses[:4],
        "scf_keys": entry.get("scf_keys") or [], "rows": rows,
        "note": entry.get("note", ""), "expected": entry.get("expected"),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Resolve framework libraries onto the SCF crosswalk.")
    ap.add_argument("--emit", action="store_true", help="write resolved.csv.gz")
    ap.add_argument("--only", help="resolve a single framework slug")
    args = ap.parse_args()

    registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
    scf_codes, index = load_scf_codes()

    entries = [e for e in registry["frameworks"] if not args.only or e["slug"] == args.only]
    mapped = [e for e in entries if e.get("scf_keys")]
    bridged = [e for e in entries if not e.get("scf_keys")]

    print(f"SCF crosswalk resolution — {len(entries)} framework libraries\n")
    print(f"{'framework':<26}{'codes':>6}{'exact':>7}{'parent':>7}{'miss':>6}  {'cover':>6}  drift")
    print("-" * 86)

    results, all_rows, drift = [], [], []
    for e in sorted(mapped, key=lambda x: x["slug"]):
        r = resolve(e, scf_codes, index)
        results.append(r)
        all_rows.extend(r["rows"])
        pct = (r["matched"] / r["total"] * 100) if r["total"] else 0.0
        flag = ""
        if r["expected"] is not None:
            if r["matched"] != r["expected"]:
                flag = f"! expected {r['expected']}"
                drift.append(f"{r['slug']}: {r['matched']} vs expected {r['expected']}")
            else:
                flag = "ok"
        print(f"{r['slug']:<26}{r['total']:>6}{r['exact']:>7}{r['parent']:>7}{r['missed']:>6}  {pct:>5.0f}%  {flag}")

    tot = sum(r["total"] for r in results)
    mat = sum(r["matched"] for r in results)
    ex = sum(r["exact"] for r in results)
    pa = sum(r["parent"] for r in results)
    print("-" * 86)
    print(f"{'TOTAL (mapped)':<26}{tot:>6}{ex:>7}{pa:>7}{tot-mat:>6}  {mat/tot*100:>5.0f}%")
    print(f"\nresolved crosswalk rows: {len(all_rows):,}")
    print(f"parent/child-matched codes ship at confidence 0.60, badged in the UI: {pa} codes")

    if bridged:
        print(f"\nNo SCF source — need a transitive bridge ({len(bridged)}):")
        for e in sorted(bridged, key=lambda x: x["slug"]):
            n = len(framework_codes(e))
            print(f"  {e['slug']:<26} {n:>5} codes   via {e.get('bridge_via') or 'TBD'}   {e.get('note','')}")

    for r in results:
        if r["missed"] and r["miss_examples"]:
            print(f"\n  {r['slug']} misses ({r['missed']}): {r['miss_examples']}")

    if drift:
        print("\nDRIFT vs recorded baselines:")
        for d in drift:
            print(f"  ! {d}")

    if args.emit:
        out = SCF_DIR / "resolved.csv.gz"
        with gzip.open(out, "wt", encoding="utf-8", newline="") as gz:
            w = csv.writer(gz)
            w.writerow(["scf_id", "source_slug", "requirement_code", "match_mode", "provenance"])
            w.writerows(sorted(set(map(tuple, all_rows))))
        print(f"\nwrote {out} ({out.stat().st_size:,} bytes, {len(set(map(tuple, all_rows))):,} unique rows)")

    return 1 if drift else 0


if __name__ == "__main__":
    raise SystemExit(main())
