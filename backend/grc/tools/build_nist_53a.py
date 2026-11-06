"""Build seed_data/nist/sp800_53a.json from NIST's OSCAL catalog.

SCF publishes no test procedure for any of its 5,956 assessment objectives, but
3,468 of them cite the NIST SP 800-53A objective they were derived from in their
`origin` field (``53A_R5_AC-02a.[01]``). NIST SP 800-53A carries a real
assessment procedure for every control: what to EXAMINE, whom to INTERVIEW and
what to TEST. It is a work of the US Government and so public domain (17 U.S.C.
§105), which means — unlike SCF's text — it can be shown, stored and built on
freely.

Input is NIST's own OSCAL release, which ships SP 800-53 Rev 5 controls and the
SP 800-53A assessment procedures in one file:

    https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json

The output keeps only what the Assurance tab reads, so the 10 MB catalog is not
shipped:

* ``controls`` — every control and enhancement that has assessment methods:
  its title and the objects for EXAMINE / INTERVIEW / TEST.
* ``objectives`` — the 800-53A objective statements SCF cites, with
  organization-defined parameters rendered as ``[organization-defined …]``.
* ``by_ao`` — SCF assessment objective id -> the 800-53A references it cites,
  each resolved to a control whose methods apply.

Usage:
    python -m grc.tools.build_nist_53a PATH/TO/NIST_SP-800-53_rev5_catalog.json
"""
from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

SEED = Path(__file__).resolve().parents[1] / "seed_data"
OUT = SEED / "nist" / "sp800_53a.json"
SOURCE_URL = ("https://raw.githubusercontent.com/usnistgov/oscal-content/main/"
              "nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json")

_PARAM = re.compile(r"\{\{\s*insert:\s*param,\s*([^\s}]+)\s*\}\}")
_ODP = re.compile(r"^(?P<ctl>[A-Z]{2}-\d{2}(?:\(\d{2}\))?)_ODP(?:\[\d+\])?$")
_CONTROL_PREFIX = re.compile(r"^[A-Z]{2}-\d{2}(?:\(\d{2}\))?")
METHODS = ("EXAMINE", "INTERVIEW", "TEST")


def _label(node: Dict[str, Any]) -> Optional[str]:
    return next((p["value"] for p in node.get("props", []) if p.get("name") == "label"), None)


def _controls(catalog: Dict[str, Any]) -> Iterator[Dict[str, Any]]:
    stack = [c for g in catalog.get("groups", []) for c in g.get("controls", [])]
    while stack:
        c = stack.pop()
        yield c
        stack.extend(c.get("controls", []))


def _param_labels(catalog: Dict[str, Any]) -> Dict[str, str]:
    """Parameter id -> how an unassigned parameter is written, NIST's way:
    ``[organization-defined personnel or roles]`` for a value to supply,
    ``[Selection (one or more): a; b]`` for a choice."""
    out = {}
    for c in _controls(catalog):
        for p in c.get("params", []):
            select = p.get("select")
            if select and select.get("choice"):
                how = (select.get("how-many") or "").replace("-", " ")
                choices = "; ".join(" ".join(str(x).split()) for x in select["choice"])
                out[p["id"]] = f"[Selection{f' ({how})' if how else ''}: {choices}]"
                continue
            text = p.get("label") or next((g.get("prose") for g in p.get("guidelines", []) if g.get("prose")), None)
            if text:
                text = " ".join(text.split())
                out[p["id"]] = f"[{text}]" if text.lower().startswith("organization-defined") else f"[organization-defined {text}]"
    return out


def _render(prose: Optional[str], params: Dict[str, str]) -> str:
    def sub(m: re.Match) -> str:
        return params.get(m.group(1), "[organization-defined value]")
    text = prose or ""
    for _ in range(5):  # a selection's choices can insert parameters of their own
        text, n = _PARAM.subn(sub, text)
        if not n:
            break
    return " ".join(text.split())


def _objects(prose: Optional[str], params: Dict[str, str]) -> List[str]:
    items = []
    for line in (prose or "").split("\n"):
        text = _render(line, params).strip().rstrip(";").strip()
        if text and text not in items:
            items.append(text)
    return items


def build(catalog_path: Path) -> Dict[str, Any]:
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))["catalog"]
    meta = catalog.get("metadata", {})
    params = _param_labels(catalog)

    controls: Dict[str, Dict[str, Any]] = {}
    objective_text: Dict[str, Dict[str, str]] = {}
    for c in _controls(catalog):
        clabel = _label(c)
        if not clabel:
            continue
        methods: Dict[str, List[str]] = {}
        for part in c.get("parts", []):
            if part.get("name") == "assessment-method":
                method = next((p["value"] for p in part.get("props", []) if p.get("name") == "method"), None)
                objs = next((q for q in part.get("parts", []) if q.get("name") == "assessment-objects"), None)
                if method in METHODS and objs:
                    methods[method] = _objects(objs.get("prose"), params)
            elif part.get("name") == "assessment-objective":
                stack = [part]
                while stack:
                    o = stack.pop()
                    olabel = _label(o)
                    if olabel and o.get("prose"):
                        objective_text[olabel] = {"control": clabel, "text": _render(o["prose"], params)}
                    stack.extend(q for q in o.get("parts", []) if q.get("name") == "assessment-objective")
        if methods:
            controls[clabel] = {"title": c.get("title", ""), "methods": methods}

    scf = json.loads((SEED / "scf" / "objectives.json").read_text(encoding="utf-8"))
    scf = scf if isinstance(scf, list) else scf["objectives"]

    by_ao: Dict[str, List[Dict[str, str]]] = defaultdict(list)
    cited: Dict[str, Dict[str, str]] = {}
    refs = resolved = 0
    for o in scf:
        for raw in (o.get("origin") or "").split("\n"):
            raw = raw.strip()
            if not raw.startswith("53A_R5_"):
                continue
            refs += 1
            lab = raw[len("53A_R5_"):]
            entry = None
            for candidate in (lab, lab + "."):
                if candidate in objective_text and objective_text[candidate]["control"] in controls:
                    entry = {"ref": candidate, "control": objective_text[candidate]["control"], "match": "objective"}
                    cited[candidate] = objective_text[candidate]
                    break
            if entry is None:
                m = _ODP.match(lab)
                ctl = m.group("ctl") if m else (_CONTROL_PREFIX.match(lab).group(0) if _CONTROL_PREFIX.match(lab) else None)
                if ctl in controls:
                    # An organization-defined parameter, or a label NIST no longer
                    # carries (SCF cites AC-02a.[03]; 5.2.0 stops at [02]): the
                    # control's own procedure is what assesses it.
                    entry = {"ref": lab, "control": ctl, "match": "odp" if m else "control"}
            if entry and entry not in by_ao[o["ao_id"]]:
                by_ao[o["ao_id"]].append(entry)
                resolved += 1

    used = {e["control"] for entries in by_ao.values() for e in entries}
    out = {
        "source": {
            "title": meta.get("title"),
            "version": meta.get("version"),
            "url": SOURCE_URL,
            "licence": "Public domain in the United States (17 U.S.C. 105): a work of NIST, US Department of Commerce.",
        },
        "controls": {k: controls[k] for k in sorted(used)},
        "objectives": dict(sorted(cited.items())),
        "by_ao": dict(sorted(by_ao.items())),
        "stats": {"scf_refs": refs, "resolved": resolved, "scf_objectives_with_procedure": len(by_ao)},
    }

    # Refuse to write a file the Assurance tab would render wrongly.
    assert out["source"]["version"], "catalog has no version"
    assert refs and resolved / refs >= 0.99, f"only {resolved}/{refs} SCF references resolved"
    for ao, entries in out["by_ao"].items():
        for e in entries:
            assert e["control"] in out["controls"], (ao, e)
            assert out["controls"][e["control"]]["methods"], (ao, e)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("catalog", type=Path, help="NIST_SP-800-53_rev5_catalog.json (OSCAL)")
    args = ap.parse_args()
    data = build(args.catalog)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    s = data["stats"]
    print(f"NIST SP 800-53A {data['source']['version']}: {s['resolved']}/{s['scf_refs']} SCF references resolved; "
          f"{s['scf_objectives_with_procedure']} SCF objectives now carry a procedure; "
          f"{len(data['controls'])} controls, {len(data['objectives'])} objective statements -> {OUT}")


if __name__ == "__main__":
    main()
