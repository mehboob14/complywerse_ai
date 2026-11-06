"""Build the seeds a NIST SP 800-53A control assessment is made from, out of NIST's own OSCAL release.

``seed_data/nist/sp800_53a.json`` (build_nist_53a.py) keeps only the 800-53A objectives SCF cites, which is what the Assurance tab needed. An assessment that follows
NIST's method needs ALL of them, the control statement they are about, and the baseline each control belongs to. This writes:

* ``seed_data/nist/sp800_53_objectives.json`` - for every control and enhancement of SP 800-53 Rev. 5 that is not withdrawn and has an assessment procedure:
  its family, title, statement (the requirement, parameters rendered the way 800-53A writes an unassigned one: ``[organization-defined ...]``) and every
  assessment objective with its text, in NIST's order. The methods and objects (EXAMINE / INTERVIEW / TEST) stay in ``sp800_53a.json``.
* ``seed_data/nist/baselines_800_53r5.json`` - the Low, Moderate, High and Privacy baselines (SP 800-53B) as lists of control labels in the same ``AC-02(01)`` form.

Both are works of NIST, public domain in the United States (17 U.S.C. 105). Nothing is paraphrased. Inputs are NIST's files, downloaded first:

    https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json
    https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_{LOW,MODERATE,HIGH,PRIVACY}-baseline_profile.json

Usage (from backend/):
    python grc/tools/build_nist_assessment_seeds.py CATALOG.json BASELINES_DIR     # BASELINES_DIR holds LOW.json MODERATE.json HIGH.json PRIVACY.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

BACKEND = Path(__file__).resolve().parents[2]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from grc.tools.build_nist_53a import _controls, _label, _param_labels, _render  # noqa: E402  (the catalog readers the 800-53A seed was built with)

SEED = Path(__file__).resolve().parents[1] / "seed_data" / "nist"
BASE_URL = "https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-53/rev5/json/"
LICENCE = "Public domain in the United States (17 U.S.C. 105): a work of NIST, US Department of Commerce."


def _statement(control: Dict[str, Any], params: Dict[str, str]) -> str:
    """The control's requirement as lines: ``a. Define and document ...`` / ``a.1. ...`` (the labels NIST gives each part)."""
    lines: List[str] = []

    def walk(part: Dict[str, Any], depth: int) -> None:
        text = _render(part.get("prose"), params)
        label = _label(part)
        if text:
            lines.append(f"{'  ' * depth}{label + ' ' if label else ''}{text}")
        for sub in part.get("parts", []):
            if sub.get("name") in ("statement", "item"):
                walk(sub, depth + (1 if text else 0))

    for part in control.get("parts", []):
        if part.get("name") == "statement":
            walk(part, 0)
    return "\n".join(lines)


def _objectives(control: Dict[str, Any], params: Dict[str, str]) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []

    def walk(part: Dict[str, Any]) -> None:
        label = _label(part)
        if label and part.get("prose"):
            out.append({"id": label, "text": _render(part["prose"], params)})
        for sub in part.get("parts", []):
            if sub.get("name") == "assessment-objective":
                walk(sub)

    for part in control.get("parts", []):
        if part.get("name") == "assessment-objective":
            walk(part)
    return out


def build_objectives(catalog: Dict[str, Any]) -> Dict[str, Any]:
    params = _param_labels(catalog)
    family_of = {g["id"]: g.get("title", "") for g in catalog.get("groups", [])}
    controls: Dict[str, Dict[str, Any]] = {}
    for group in catalog.get("groups", []):
        stack = list(group.get("controls", []))
        while stack:
            c = stack.pop(0)
            stack = c.get("controls", []) + stack            # an enhancement follows its control, in NIST's order
            label = _label(c)
            if not label or any(p.get("name") == "status" and p.get("value") == "withdrawn" for p in c.get("props", [])):
                continue
            objectives = _objectives(c, params)
            if not objectives:
                continue
            controls[label] = {"family": group["id"].upper(), "title": c.get("title", ""), "statement": _statement(c, params), "objectives": objectives}
    meta = catalog.get("metadata", {})
    return {
        "source": {"title": meta.get("title", ""), "version": meta.get("version", ""), "url": BASE_URL + "NIST_SP-800-53_rev5_catalog.json", "licence": LICENCE},
        "families": {g["id"].upper(): family_of[g["id"]] for g in catalog.get("groups", [])},
        "controls": controls,
    }


def build_baselines(catalog: Dict[str, Any], folder: Path) -> Dict[str, Any]:
    label_of = {c["id"]: _label(c) for c in _controls(catalog) if _label(c)}
    out: Dict[str, List[str]] = {}
    version = ""
    for name in ("LOW", "MODERATE", "HIGH", "PRIVACY"):
        profile = json.loads((folder / f"{name}.json").read_text(encoding="utf-8"))["profile"]
        version = profile["metadata"].get("version", version)
        ids = [i for imp in profile["imports"] for inc in imp.get("include-controls", []) for i in inc.get("with-ids", [])]
        unknown = [i for i in ids if i not in label_of]
        if unknown:
            raise SystemExit(f"{name}: control ids not in the catalog: {unknown[:5]}")
        out[name.lower()] = [label_of[i] for i in ids]
    return {
        "source": {"title": "SP 800-53B baselines as OSCAL profiles", "version": version, "url": BASE_URL + "NIST_SP-800-53_rev5_{LOW,MODERATE,HIGH,PRIVACY}-baseline_profile.json", "licence": LICENCE},
        "baselines": out,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("catalog", type=Path)
    ap.add_argument("baselines", type=Path)
    args = ap.parse_args()
    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))["catalog"]
    objectives = build_objectives(catalog)
    baselines = build_baselines(catalog, args.baselines)
    SEED.mkdir(parents=True, exist_ok=True)
    (SEED / "sp800_53_objectives.json").write_text(json.dumps(objectives, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (SEED / "baselines_800_53r5.json").write_text(json.dumps(baselines, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n_obj = sum(len(c["objectives"]) for c in objectives["controls"].values())
    print(f"{len(objectives['controls'])} controls, {n_obj} objectives; baselines " + ", ".join(f"{k} {len(v)}" for k, v in baselines["baselines"].items()))


if __name__ == "__main__":
    main()
