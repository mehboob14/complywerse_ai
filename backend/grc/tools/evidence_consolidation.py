"""Consolidate a control's framework evidence asks into one requestable set.

Every framework states its own evidence ask in its own words, so a control that
discharges 40 requirements inherits 40 near-identical asks. GOV-02 carried 539.
The duplication is semantic, not lexical: "Policy review records", "Policy
Review & Distribution Records" and "Policy review and approval records" are one
artifact worded three ways, and normalizing case and punctuation merges almost
none of them (GOV-03: 264 asks -> 225 distinct normalized, a 1.17x reduction).
So the merge has to be authored, and this module is the harness around that:

    python -m grc.tools.evidence_consolidation status
    python -m grc.tools.evidence_consolidation bundle --min-asks 31 --limit 20 --out DIR
    python -m grc.tools.evidence_consolidation merge --in DIR
    python -m grc.tools.evidence_consolidation selftest

`bundle` writes one JSON file per control holding its raw asks with the
framework and requirement each came from. `merge` validates authored output and
folds it into evidence_consolidated.json — so the job is resumable, and every
merged set is checked rather than trusted.

LICENCE: the asks come from OUR framework libraries, not from SCF. Nothing here
reads or derives from SCF prose; the SCF control id is only a grouping key.
"""
from __future__ import annotations

import argparse
import collections
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[1]
SCF_DIR = ROOT / "seed_data" / "scf"
CONSOLIDATED = SCF_DIR / "evidence_consolidated.json"

METHODS = ("automated", "manual", "hybrid")
# Below this, a raw list is already readable and merging it buys nothing but risk.
DEFAULT_MIN_ASKS = 31


def _load_consolidated() -> Dict[str, Any]:
    if CONSOLIDATED.exists():
        return json.loads(CONSOLIDATED.read_text(encoding="utf-8"))
    return {"note": "Consolidated evidence sets. Each artifact merges the asks of every "
                    "framework requirement the control discharges; required_by cites them.",
            "controls": {}}


def raw_asks(tenant: str = "1link") -> Dict[str, List[Dict[str, str]]]:
    """scf_id -> [{framework, label, code, name, description, filetype}].

    Reads the live crosswalk so a control's asks follow its current mappings.
    """
    from dotenv import load_dotenv
    load_dotenv(ROOT.parent / ".env")
    from sqlalchemy import text
    from grc.db import get_tenant_engine
    from grc.modules.automation.router import _framework_evidence_index, _FW_LABELS

    ev = _framework_evidence_index()
    with get_tenant_engine(tenant).connect() as c:
        pairs = c.execute(text(
            "SELECT scf_id, source_slug, requirement_code FROM grc_scf_mapping "
            "WHERE provenance IN ('resolver','ai')"
        )).fetchall()

    out: Dict[str, List[Dict[str, str]]] = collections.defaultdict(list)
    for scf_id, slug, code in pairs:
        for it in (ev.get(slug) or {}).get(code) or []:
            name = (it.get("name") or "").strip()
            if not name:
                continue
            out[scf_id].append({
                "framework": slug,
                "label": _FW_LABELS.get(slug, slug.replace("_", " ").title()),
                "code": code,
                "name": name,
                "description": (it.get("description") or "").strip() or None,
                "filetype": it.get("filetype"),
            })
    return out


def control_titles(tenant: str = "1link") -> Dict[str, str]:
    from sqlalchemy import text
    from grc.db import get_tenant_engine
    with get_tenant_engine(tenant).connect() as c:
        return {r[0]: r[1] for r in c.execute(text(
            "SELECT scf_id, name FROM grc_scf_control"))}


def cmd_status(args) -> int:
    doc = _load_consolidated()
    done = doc["controls"]
    asks = raw_asks(args.tenant)
    todo = {k: v for k, v in asks.items() if k not in done}

    done_artifacts = sum(len(v["artifacts"]) for v in done.values())
    done_inputs = sum(v.get("input_count", 0) for v in done.values())
    print(f"consolidated : {len(done):>5} controls  {done_inputs:>7,} asks -> {done_artifacts:,} artifacts"
          + (f"  ({done_inputs / done_artifacts:.1f}x)" if done_artifacts else ""))
    print(f"remaining    : {len(todo):>5} controls  {sum(len(v) for v in todo.values()):>7,} asks")

    bands = [("1-5", 1, 5), ("6-15", 6, 15), ("16-30", 16, 30), ("31-75", 31, 75), ("76+", 76, 10**9)]
    print(f"\n{'band':<8}{'controls':>9}{'asks':>9}   worth consolidating")
    for label, lo, hi in bands:
        sel = {k: v for k, v in todo.items() if lo <= len(v) <= hi}
        worth = "yes" if lo >= DEFAULT_MIN_ASKS else "no - already readable"
        print(f"{label:<8}{len(sel):>9}{sum(len(v) for v in sel.values()):>9}   {worth}")

    heavy = {k: v for k, v in todo.items() if len(v) >= args.min_asks}
    print(f"\nat --min-asks {args.min_asks}: {len(heavy)} controls, {sum(len(v) for v in heavy.values()):,} asks")
    return 0


def cmd_bundle(args) -> int:
    doc = _load_consolidated()
    done = set(doc["controls"])
    asks = raw_asks(args.tenant)
    titles = control_titles(args.tenant)

    todo = sorted(((k, v) for k, v in asks.items() if k not in done and len(v) >= args.min_asks),
                  key=lambda kv: -len(kv[1]))[:args.limit]
    if not todo:
        print("nothing to bundle at this threshold")
        return 0

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    for scf_id, items in todo:
        # Collapse identical asks and cite every framework that made each one, so
        # the authoring input is one line per distinct ask rather than the same
        # wording repeated once per requirement. `required_by` is then read
        # straight off `from`, which is what stops a merge inventing a source.
        grouped: Dict[str, Dict[str, Any]] = {}
        for it in items:
            g = grouped.setdefault(it["name"], {"name": it["name"], "description": None, "from": []})
            g["from"].append(f'{it["label"]} {it["code"]}')
            desc = it["description"]
            # Most libraries set description to the name plus boilerplate; keep it
            # only where it actually says something the name does not.
            if desc and not g["description"] and not desc.lower().startswith(it["name"].lower()[:40]):
                g["description"] = desc
        asks = sorted(grouped.values(), key=lambda a: (-len(a["from"]), a["name"]))
        for a in asks:
            a["from"] = sorted(set(a["from"]))
        payload = {
            "scf_id": scf_id,
            "title": titles.get(scf_id),
            "input_count": len(items),
            "distinct_asks": len(asks),
            "frameworks": sorted({it["label"] for it in items}),
            "asks": asks,
        }
        (out_dir / f"{scf_id}.json").write_text(
            json.dumps(payload, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {len(todo)} bundles to {out_dir}")
    print(f"  {todo[0][0]} ({len(todo[0][1])} asks) … {todo[-1][0]} ({len(todo[-1][1])} asks)")
    return 0


def validate(scf_id: str, artifacts: List[Dict[str, Any]], items: List[Dict[str, str]]) -> List[str]:
    """Everything that must hold before an authored set replaces a raw list."""
    errs: List[str] = []
    if not artifacts:
        return [f"{scf_id}: no artifacts"]
    if len(artifacts) > len(items):
        errs.append(f"{scf_id}: {len(artifacts)} artifacts from {len(items)} asks — not a consolidation")
    labels = {it["label"] for it in items}
    seen: set = set()
    for i, a in enumerate(artifacts):
        where = f"{scf_id}[{i}]"
        for field in ("name", "description", "collection_method", "required_by"):
            if not a.get(field):
                errs.append(f"{where}: missing {field}")
        name = (a.get("name") or "").strip().lower()
        if name in seen:
            errs.append(f"{where}: duplicate artifact name {a.get('name')!r}")
        seen.add(name)
        if a.get("collection_method") not in METHODS:
            errs.append(f"{where}: collection_method {a.get('collection_method')!r} not in {METHODS}")
        req = a.get("required_by") or []
        if not isinstance(req, list):
            errs.append(f"{where}: required_by must be a list")
            continue
        # A citation to a framework this control does not map to means the merge
        # invented a source, which is the failure mode that matters most here.
        for label in req:
            if label not in labels:
                errs.append(f"{where}: cites {label!r}, which this control does not map to")
        if len(str(a.get("description") or "")) < 40:
            errs.append(f"{where}: description too thin to replace {len(items)} asks")
    covered = {l for a in artifacts for l in (a.get("required_by") or [])}
    missing = labels - covered
    if missing:
        errs.append(f"{scf_id}: no artifact cites {sorted(missing)} — those asks would be dropped")
    return errs


def _authored_sets(path: Path) -> List[Dict[str, Any]]:
    """Accept a directory of one-control files, or a single file holding a list of
    them — authoring a batch as one document is far cheaper than one file each."""
    if path.is_dir():
        out = []
        for p in sorted(q for q in path.glob("*.json") if not q.name.startswith("_")):
            doc = json.loads(p.read_text(encoding="utf-8"))
            doc.setdefault("scf_id", p.stem)
            out.append(doc)
        return out
    doc = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(doc, list):
        return doc
    if isinstance(doc.get("controls"), list):
        return doc["controls"]
    return [doc]


def cmd_merge(args) -> int:
    doc = _load_consolidated()
    asks = raw_asks(args.tenant)
    src = Path(args.in_dir)
    try:
        sets = _authored_sets(src)
    except Exception as e:  # noqa: BLE001
        sys.exit(f"could not read authored sets from {src}: {e}")
    if not sets:
        sys.exit(f"no authored sets in {src}")

    merged, errors = 0, []
    for authored in sets:
        scf_id = authored.get("scf_id")
        if not scf_id:
            errors.append("an authored set has no scf_id")
            continue
        artifacts = authored.get("artifacts") or []
        items = asks.get(scf_id) or []
        if not items:
            errors.append(f"{scf_id}: no raw asks — is the crosswalk stale?")
            continue
        errs = validate(scf_id, artifacts, items)
        if errs:
            errors.extend(errs)
            continue
        doc["controls"][scf_id] = {
            "artifacts": artifacts,
            "input_count": len(items),
            "notes": authored.get("notes") or "",
        }
        merged += 1

    if errors:
        print(f"REJECTED {len(errors)} problem(s); nothing written:")
        for e in errors[:30]:
            print("  -", e)
        return 1

    ordered = dict(sorted(doc["controls"].items()))
    doc["controls"] = ordered
    CONSOLIDATED.write_text(json.dumps(doc, indent=1, ensure_ascii=False), encoding="utf-8")
    total_in = sum(v.get("input_count", 0) for v in ordered.values())
    total_out = sum(len(v["artifacts"]) for v in ordered.values())
    print(f"merged {merged} control(s); {len(ordered)} consolidated overall — "
          f"{total_in:,} asks -> {total_out:,} artifacts ({total_in / total_out:.1f}x)")
    return 0


def cmd_selftest(args) -> int:
    """The validator is the only thing standing between an authored merge and the
    UI, so it gets a check that fails loudly if a guard is dropped."""
    items = [{"label": "ISO 27001", "code": "A.5.1", "name": "Policy"},
             {"label": "PCI DSS", "code": "12.1", "name": "Policy doc"}]
    good = [{"name": "Information Security Policy",
             "description": "The approved top-level policy, current version, with evidence of approval.",
             "collection_method": "manual", "required_by": ["ISO 27001", "PCI DSS"]}]
    cases = [
        ("clean set passes", good, items, 0),
        ("invented citation", [{**good[0], "required_by": ["ISO 27001", "PCI DSS", "SOC 2"]}], items, 1),
        ("dropped framework", [{**good[0], "required_by": ["ISO 27001"]}], items, 1),
        ("bad method", [{**good[0], "collection_method": "magic"}], items, 1),
        ("thin description", [{**good[0], "description": "A policy."}], items, 1),
        ("no artifacts", [], items, 1),
        ("not a reduction", [good[0], {**good[0], "name": "B"}, {**good[0], "name": "C"}], items, 1),
        ("duplicate names", [good[0], {**good[0]}], items, 1),
    ]
    bad = []
    for label, arts, its, want_err in cases:
        errs = validate("TEST-01", arts, its)
        got = 1 if errs else 0
        if got != want_err:
            bad.append(f"  {label}: expected {'errors' if want_err else 'no errors'}, got {errs or 'none'}")
    if bad:
        print("selftest FAILED:\n" + "\n".join(bad))
        return 1
    print(f"selftest ok — {len(cases)} validator cases")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tenant", default="1link")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("status"); s.add_argument("--min-asks", type=int, default=DEFAULT_MIN_ASKS)
    s.set_defaults(func=cmd_status)

    b = sub.add_parser("bundle")
    b.add_argument("--min-asks", type=int, default=DEFAULT_MIN_ASKS)
    b.add_argument("--limit", type=int, default=20)
    b.add_argument("--out", required=True)
    b.set_defaults(func=cmd_bundle)

    m = sub.add_parser("merge"); m.add_argument("--in", dest="in_dir", required=True)
    m.set_defaults(func=cmd_merge)

    t = sub.add_parser("selftest"); t.set_defaults(func=cmd_selftest)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
