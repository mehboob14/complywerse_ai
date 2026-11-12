"""The Risk Library: the risks a standard itself lists, ready to be moved into a tenant's risk register.

Each framework is one shipped file in `grc/seed_data/risk_library/<key>.json` (built from the standard by
`.agent-context/tools/build_risk_library_uae_ia.py`): families, control objectives (each with the controls under it) and
the risks listed for an objective, verbatim from the standard. The library itself is read-only and the same for every
tenant; what a tenant did with it (a library risk added to its register) is on the register's own rows
(`Risk.source_type == "risk_library"`, `Risk.source_reference` == the library risk's id).
"""
from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional

LIBRARY_DIR = Path(__file__).resolve().parents[3] / "seed_data" / "risk_library"
SOURCE_TYPE = "risk_library"
logger = logging.getLogger(__name__)


SHORT_NAMES = {"uae_ia": "UAE IA"}          # what a file that gives no `framework.short_name` is called in the register and reasons


def _read(path: Path) -> dict:
    raw = json.loads(path.read_text(encoding="utf-8"))
    key = raw["framework"]["key"]
    families = {f["id"]: f for f in raw["families"]}
    objectives = {o["id"]: o for o in raw["objectives"]}
    risks = []
    for r in raw["risks"]:
        objective = objectives[r["objective_id"]]
        family = families[objective["family_id"]]
        risks.append({
            "id": r["id"], "framework_key": key, "title": r["title"], "description": r["description"],
            "family_id": family["id"], "family_name": family["name"], "family_kind": family["kind"],
            "objective_id": objective["id"], "objective_title": objective["title"], "objective": objective["objective"],
            "suggested_category": family["suggested_category"],
            "controls": [{"control_id": c["control_id"], "title": c["title"], "priority": c.get("priority"),
                          "applicability": c.get("applicability")} for c in objective["controls"]],
        })
    return {"framework": raw["framework"], "families": raw["families"], "objectives": raw["objectives"], "risks": risks,
            "by_id": {r["id"]: r for r in risks}}


@lru_cache(maxsize=1)
def _load() -> Dict[str, dict]:
    """Every library file in the folder (another standard is another file); a file that does not hold a library is left out
    and logged, so one bad file does not take the others down."""
    libraries: Dict[str, dict] = {}
    for path in sorted(LIBRARY_DIR.glob("*.json")):
        try:
            lib = _read(path)
        except (KeyError, TypeError, ValueError) as exc:
            logger.error("Risk library file %s left out: %r", path.name, exc)
            continue
        libraries[lib["framework"]["key"]] = lib
    return libraries


def short_name(key: str) -> str:
    """The standard's short name ("UAE IA"): the file's own, else the known one, else its full name."""
    lib = library(key)
    framework = lib["framework"] if lib else {}
    return framework.get("short_name") or SHORT_NAMES.get(key) or framework.get("name") or key


def frameworks() -> List[dict]:
    """The frameworks that have a library, with what each holds."""
    return [{**lib["framework"], "families": len(lib["families"]), "objectives": len(lib["objectives"]), "risks": len(lib["risks"])}
            for lib in _load().values()]


def library(key: str) -> Optional[dict]:
    return _load().get(key)


def find(item_id: str) -> Optional[dict]:
    """One library risk by its id (`uae_ia:M2.3:03`), whichever framework it belongs to."""
    for lib in _load().values():
        if item_id in lib["by_id"]:
            return lib["by_id"][item_id]
    return None


def search(framework_key: str, family: Optional[str] = None, objective: Optional[str] = None, text: Optional[str] = None) -> List[dict]:
    """The risks of one framework, narrowed by family id (M2), control objective id (M2.3) and/or words in the risk, the objective or a control."""
    lib = library(framework_key)
    if lib is None:
        return []
    words = [w for w in (text or "").lower().split() if w]
    out = []
    for r in lib["risks"]:
        if family and r["family_id"] != family:
            continue
        if objective and r["objective_id"] != objective:
            continue
        if words:
            haystack = " ".join([r["title"], r["objective_id"], r["objective_title"], r["family_name"], *(c["control_id"] for c in r["controls"])]).lower()
            if not all(w in haystack for w in words):
                continue
        out.append(r)
    return out


def facets(framework_key: str) -> dict:
    """The families and control objectives with how many risks each holds, for the filters."""
    lib = library(framework_key)
    if lib is None:
        return {"families": [], "objectives": []}
    per_objective: Dict[str, int] = {}
    per_family: Dict[str, int] = {}
    for r in lib["risks"]:
        per_objective[r["objective_id"]] = per_objective.get(r["objective_id"], 0) + 1
        per_family[r["family_id"]] = per_family.get(r["family_id"], 0) + 1
    return {
        "families": [{"id": f["id"], "name": f["name"], "kind": f["kind"], "count": per_family.get(f["id"], 0)} for f in lib["families"]],
        "objectives": [{"id": o["id"], "family_id": o["family_id"], "title": o["title"], "count": per_objective.get(o["id"], 0)}
                       for o in lib["objectives"]],
    }
