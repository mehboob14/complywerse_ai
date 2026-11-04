"""NIST assessments: the questions of an assessment that follows NIST's own method, built from the NIST library instead of an uploaded workbook.

Two are offered (``features/nist-assessments.md``):

* ``nist_800_53a`` - a security and privacy control assessment of a system (SP 800-53 Rev. 5, assessed as SP 800-53A Rev. 5 says). The questions are the controls
  of the chosen baseline (SP 800-53B: Low, Moderate or High, optionally with the privacy baseline). Each control carries what 800-53A gives an assessor: the control
  statement, the assessment OBJECTIVES (each is determined Satisfied, Other than satisfied or Not applicable) and the assessment METHODS with their OBJECTS: what to
  EXAMINE (documents, records, mechanisms), whom to INTERVIEW, what to TEST. A control is Satisfied when every objective is, Other than satisfied when any is not.
* ``nist_csf2`` - a Cybersecurity Framework 2.0 profile of an organisation or unit: each subcategory (outcome) is rated NI / PI / LI / FI (not, partially, largely, fully
  implemented) with a target, and carries NIST's implementation examples.

Everything here is a work of NIST (public domain, 17 U.S.C. 105) copied from the seeds in ``seed_data`` (``tools/build_nist_assessment_seeds.py`` made the objectives and
baselines); nothing is paraphrased. No database here: ``scope_router`` reads and writes.
"""
from __future__ import annotations

import copy
import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

SEED = Path(__file__).resolve().parents[2] / "seed_data"

NIST_FORMATS: Dict[str, Dict[str, Any]] = {
    "nist_800_53a": {
        "label": "NIST SP 800-53A", "title": "Security and privacy control assessment", "publication": "SP800-53A", "version": "Rev. 5",
        "url": "https://csrc.nist.gov/pubs/sp/800/53/a/r5/final", "subject": "system",
    },
    "nist_csf2": {
        "label": "NIST CSF 2.0", "title": "Cybersecurity Framework profile", "publication": "CSF2", "version": "2.0",
        "url": "https://www.nist.gov/cyberframework", "subject": "organisation or unit",
    },
}
SCOPE_MODEL = "system"

BASELINES = ("low", "moderate", "high")
BASELINE_LABEL = {"low": "Low", "moderate": "Moderate", "high": "High"}
CSF_FUNCTIONS = {"GV": "GOVERN", "ID": "IDENTIFY", "PR": "PROTECT", "DE": "DETECT", "RS": "RESPOND", "RC": "RECOVER"}
# what a person records for a subcategory (NIST/ISO 33020 style: not, partially, largely, fully implemented) and the status it makes
IMPLEMENTATION = {"NI": "not_complied", "PI": "partially_complied", "LI": "partially_complied", "FI": "complied", "NA": "na"}
IMPLEMENTATION_LABEL = {"NI": "Not implemented", "PI": "Partially implemented", "LI": "Largely implemented", "FI": "Fully implemented", "NA": "Not applicable"}
DETERMINATIONS = ("satisfied", "other_than_satisfied", "not_applicable")
DETERMINATION_LABEL = {"satisfied": "Satisfied", "other_than_satisfied": "Other than satisfied", "not_applicable": "Not applicable"}
_CONTROL = re.compile(r"^\s*([A-Z]{2}-\d{2}(?:\(\d{2}\))?)")


def is_nist(fmt: Optional[str]) -> bool:
    return fmt in NIST_FORMATS


# ── the seeds ───────────────────────────────────────────────────────────────────────────────────────────────────────
def _load(*parts: str) -> Any:
    return json.loads(SEED.joinpath(*parts).read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _objectives() -> Dict[str, Any]:
    return _load("nist", "sp800_53_objectives.json")


@lru_cache(maxsize=1)
def _methods() -> Dict[str, Any]:
    return _load("nist", "sp800_53a.json")["controls"]


@lru_cache(maxsize=1)
def _baselines() -> Dict[str, List[str]]:
    return _load("nist", "baselines_800_53r5.json")["baselines"]


@lru_cache(maxsize=1)
def _csf() -> List[Dict[str, Any]]:
    return _load("frameworks", "nist_csf.json")["controls"]


def source(fmt: str) -> Dict[str, Any]:
    """Where the questions come from, for the snapshot taken when the assessment starts."""
    info = NIST_FORMATS[fmt]
    if fmt == "nist_800_53a":
        s = _objectives()["source"]
        return {"publication": f"NIST SP 800-53 {info['version']} and SP 800-53A {info['version']}", "version": s.get("version"), "url": info["url"], "licence": s.get("licence")}
    return {"publication": "NIST Cybersecurity Framework 2.0", "version": info["version"], "url": info["url"],
            "licence": "Public domain in the United States (17 U.S.C. 105): a work of NIST, US Department of Commerce."}


# ── which controls a baseline holds ─────────────────────────────────────────────────────────────────────────────────
def controls_of(baseline: str, privacy: bool = False) -> List[str]:
    """The control labels of a baseline in NIST's order (a control, then its enhancements): ``AC-02``, ``AC-02(01)``."""
    wanted = set(_baselines().get(baseline, []))
    if privacy:
        wanted |= set(_baselines().get("privacy", []))
    return [label for label in _objectives()["controls"] if label in wanted]


def _family_name(code: str) -> str:
    return _objectives()["families"].get(code, code)


def catalog_info(fmt: str) -> Dict[str, Any]:
    """What the type page shows before anything is started: how big each choice is."""
    if fmt == "nist_800_53a":
        by = {}
        for b in BASELINES:
            labels = controls_of(b)
            by[b] = {"controls": len(labels), "objectives": sum(len(_objectives()["controls"][c]["objectives"]) for c in labels)}
        families = [{"name": f"{code} - {name}", "count": len([1 for c in _objectives()["controls"].values() if c["family"] == code])} for code, name in _objectives()["families"].items()]
        return {"baselines": by, "items": by["moderate"]["controls"], "domains": families}
    functions = [{"name": f"{code} - {name.title()}", "count": len([1 for c in _csf() if c["domain"] == name])} for code, name in CSF_FUNCTIONS.items()]
    return {"items": len(_csf()), "domains": functions}


def domains_of_scope(fmt: str, scope: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The domains (families or functions) the questions of this scope fall in, for the participants who take some of them."""
    counts: Dict[str, int] = {}
    for item in build_items(fmt, scope):
        counts[item["area_domain"]] = counts.get(item["area_domain"], 0) + 1
    return [{"name": name, "count": n} for name, n in sorted(counts.items())]


# ── the questions ───────────────────────────────────────────────────────────────────────────────────────────────────
def _short(text: str, n: int) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def _tailored_out(scope: Dict[str, Any]) -> Dict[str, str]:
    """Controls the scope rules out (800-53 tailoring: scoping considerations), by the label an exclusion starts with: control -> the reason."""
    out: Dict[str, str] = {}
    for e in scope.get("exclusions") or []:
        found = _CONTROL.match(str(e.get("what") or "").upper())
        if found:
            out[found.group(1)] = (e.get("reason") or "Ruled out by the scope.").strip()
    return out


def _items_53a(scope: Dict[str, Any]) -> List[Dict[str, Any]]:
    out_of_scope = _tailored_out(scope)
    items: List[Dict[str, Any]] = []
    for label in controls_of(scope.get("baseline") or "moderate", bool(scope.get("privacy_overlay"))):
        c = _objectives()["controls"][label]
        m = (_methods().get(label) or {}).get("methods") or {}
        data = {
            "kind": "800-53A", "control": label, "family": c["family"], "title": c["title"], "statement": c["statement"],
            "objectives": [{"id": o["id"], "text": o["text"], "determination": None, "note": ""} for o in c["objectives"]],
            "methods": {k: list(v) for k, v in m.items()},
        }
        objects = "; ".join(f"{k.title()}: {_short('; '.join(v), 400)}" for k, v in m.items())
        baseline = f"{BASELINE_LABEL.get(scope.get('baseline') or 'moderate')} baseline" + (" + privacy" if scope.get("privacy_overlay") else "")
        item = {
            "item_number": label, "area_domain": f"{c['family']} - {_family_name(c['family'])}", "subdomain_name": f"{label} {c['title']}",
            # what the AI evidence advice reads (it sees description <= 2,000 and remarks <= 500 characters): the control and what 800-53A has the assessor look at
            "control_description": _short(f"{label} {c['title']}: {c['statement']}", 1900),
            "evidence_reference": _short(f"NIST SP 800-53A assessment objects. {objects}", 1800) if objects else None,
            "remarks": _short(f"NIST SP 800-53A Rev. 5, {baseline}. Assessment objects. {objects}", 480),
            "assessment_data": data,
        }
        if label in out_of_scope:
            item["compliance_status"] = "na"
            item["remarks"] += f" | Not applicable: {out_of_scope[label]}"
            for o in data["objectives"]:
                o["determination"] = "not_applicable"
        items.append(item)
    return items


def _items_csf(scope: Dict[str, Any]) -> List[Dict[str, Any]]:
    wanted = set(scope.get("functions") or CSF_FUNCTIONS)
    by_name = {name: code for code, name in CSF_FUNCTIONS.items()}
    items: List[Dict[str, Any]] = []
    for c in _csf():
        fn = by_name.get(c.get("domain"))
        if fn not in wanted:
            continue
        raw = c.get("assessment_criteria") or []
        if isinstance(raw, str):                                           # the library file keeps it as a list; an older export as JSON text
            try:
                raw = json.loads(raw)
            except ValueError:
                raw = []
        examples = []
        for line in raw:
            found = re.match(r"^(Ex\d+):\s*(.*)$", str(line), re.S)
            examples.append({"id": found.group(1) if found else "", "text": (found.group(2) if found else str(line)).strip()})
        data = {"kind": "CSF2", "function": fn, "function_name": c["domain"], "category": c.get("parent_section"), "category_title": c.get("category"),
                "outcome": c["title"], "examples": examples, "current": None, "target": None}
        items.append({
            "item_number": c["control_id"], "area_domain": f"{fn} - {c['domain'].title()}", "subdomain_name": f"{c.get('parent_section')} {c.get('category')}",
            "control_description": _short(c["title"] + (". Implementation examples: " + " ".join(f"{e['id']}: {e['text']}" for e in examples) if examples else ""), 1900),
            "evidence_reference": _short("NIST CSF 2.0 implementation examples. " + " ".join(f"{e['id']}: {e['text']}" for e in examples), 1800) if examples else None,
            "remarks": "NIST CSF 2.0 profile: current implementation and target.", "assessment_data": data,
        })
    return items


def build_items(fmt: str, scope: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The questions of an assessment of this format and scope, as the fields of an item (``assessment_data`` holds what NIST's method adds)."""
    return _items_53a(scope or {}) if fmt == "nist_800_53a" else _items_csf(scope or {})


# ── what a person decides ───────────────────────────────────────────────────────────────────────────────────────────
def status_of(data: Dict[str, Any]) -> str:
    """The status an item has from what was decided on it. 800-53A: Satisfied only when every objective is (not applicable ones aside), Other than satisfied as
    soon as one is not; nothing decided yet, or some still open, is in progress. CSF: the implementation level."""
    if (data or {}).get("kind") == "CSF2":
        return IMPLEMENTATION.get(data.get("current") or "", "in_progress")
    dets = [o.get("determination") for o in (data or {}).get("objectives") or []]
    if any(d == "other_than_satisfied" for d in dets):
        return "not_complied"
    if dets and all(d == "not_applicable" for d in dets):
        return "na"
    if dets and all(d in ("satisfied", "not_applicable") for d in dets):
        return "complied"
    return "in_progress"


class DeterminationError(ValueError):
    pass


def decide(data: Dict[str, Any], change: Dict[str, Any]) -> Dict[str, Any]:
    """The item's ``assessment_data`` with one decision applied (a copy). 800-53A: ``{objective: id, determination: satisfied|other_than_satisfied|not_applicable|null,
    note?}`` or ``{all: determination}`` for every objective at once. CSF: ``{current?: NI|PI|LI|FI|NA|null, target?: ...}``. Raises DeterminationError."""
    out = copy.deepcopy(data or {})
    if out.get("kind") == "CSF2":
        for key in ("current", "target"):
            if key in change:
                value = change[key]
                if value not in (None, "") and value not in IMPLEMENTATION:
                    raise DeterminationError(f"{key} must be one of {', '.join(IMPLEMENTATION)}.")
                out[key] = value or None
        if "note" in change:
            out["note"] = str(change["note"] or "")[:1000]
        return out
    objectives = out.get("objectives") or []
    if "all" in change:
        value = change["all"]
        if value not in DETERMINATIONS:
            raise DeterminationError("Choose Satisfied, Other than satisfied or Not applicable.")
        for o in objectives:
            o["determination"] = value
        return out
    target = next((o for o in objectives if o.get("id") == change.get("objective")), None)
    if target is None:
        raise DeterminationError("That objective is not part of this control.")
    if "determination" in change:
        value = change["determination"]
        if value not in (None, "") and value not in DETERMINATIONS:
            raise DeterminationError("Choose Satisfied, Other than satisfied or Not applicable.")
        target["determination"] = value or None
    if "note" in change:
        target["note"] = str(change["note"] or "")[:1000]
    return out
