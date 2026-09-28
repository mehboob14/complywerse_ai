"""A tenant's own onboarding questions, tiering factors and evidence types.

The built-in questions, factors and evidence types stay, because the tiering
rules, the reports and the exposure model read them. Around them a tenant can:

* reword, re-help, make optional or hide a built-in question, retitle a built-in
  section, add options to the built-in choice ("What are we buying?"), and have a
  built-in yes ask the supplier for a piece of evidence;
* add its own questions of any answer type, to any section or to sections of its
  own, each asked only when another answer is yes if it wants;
* say what an answer adds to a tiering factor: a yes, or each option of a choice,
  raises that factor to at least so many points out of 4, and a level answer
  raises it to its level;
* name evidence a yes asks the supplier for, on top of what its tier asks;
* add its own tiering factors, which join the weights, and its own evidence
  types, which join the list each tier picks from.

Keys are made from the names when things are added and never change, so answers
and evidence stay attached when something is renamed. Taking something out
archives it rather than dropping it: answers and evidence recorded against it
are records. Everything is checked when saved, so a question cannot point at a
factor, a section or evidence that is not there.
"""
from __future__ import annotations

import copy
import re
from typing import Dict, List, Optional

from . import intake

BUILTIN_FACTORS: Dict[str, str] = {
    "data_sensitivity": "Data sensitivity",
    "business_criticality": "Business criticality",
    "system_access": "System access",
    "regulatory_scope": "Regulatory & geographic scope",
    "fourth_party": "Fourth-party reliance",
}
BUILTIN_EVIDENCE: Dict[str, str] = {
    "assurance_report": "Independent assurance: a SOC 2 report or ISO 27001 certificate",
    "pen_test": "Penetration test summary from the last 12 months",
    "bcp_test": "Business continuity or disaster recovery test results",
    "insurance": "Cyber insurance certificate",
    "security_policy": "Information security policy",
    "dpa": "Signed data processing agreement",
    "financials": "Audited financial statements",
}
PARTS = ("factors", "evidence", "evidence_builtin", "sections", "builtin_sections", "builtin", "questions")
KEY = re.compile(r"^c_[a-z0-9_]{1,36}$")
_VALUE = re.compile(r"^[a-z0-9_]{1,40}$")
_MAX = {"factors": 15, "evidence": 60, "sections": 10, "questions": 150, "options": 30}
_SCORED = ("yes_no", "choice", "multi_choice", "level")


def merged(stored: Optional[dict]) -> dict:
    stored = stored if isinstance(stored, dict) else {}
    out = {}
    for part in PARTS:
        want_list = part in ("factors", "evidence", "sections", "questions")
        value = stored.get(part)
        out[part] = copy.deepcopy(value) if isinstance(value, list if want_list else dict) else ([] if want_list else {})
    return out


# ── what a tenant's settings add up to ───────────────────────────────────────

def factors(custom: Optional[dict]) -> List[dict]:
    """The factors in use, built-in first."""
    return ([{"key": k, "label": v, "builtin": True} for k, v in BUILTIN_FACTORS.items()]
            + [{"key": f["key"], "label": f["label"], "builtin": False}
               for f in merged(custom)["factors"] if not f.get("archived")])


def factor_labels(custom: Optional[dict]) -> Dict[str, str]:
    """Every factor's name, removed ones too, for tiers computed before."""
    return {**BUILTIN_FACTORS, **{f["key"]: f["label"] for f in merged(custom)["factors"]}}


def evidence_kinds(custom: Optional[dict]) -> Dict[str, str]:
    """The evidence types in use, by key, in the tenant's words."""
    c = merged(custom)
    over = c["evidence_builtin"]
    out = {k: (over.get(k) or {}).get("label") or v for k, v in BUILTIN_EVIDENCE.items()
           if not (over.get(k) or {}).get("hidden")}
    out.update({e["key"]: e["label"] for e in c["evidence"] if not e.get("archived")})
    return out


def evidence_labels(custom: Optional[dict]) -> Dict[str, str]:
    """Every evidence type's name, hidden and removed ones too, for evidence tagged before."""
    c = merged(custom)
    over = c["evidence_builtin"]
    out = {k: (over.get(k) or {}).get("label") or v for k, v in BUILTIN_EVIDENCE.items()}
    out.update({e["key"]: e["label"] for e in c["evidence"]})
    return out


# ── checking a change ────────────────────────────────────────────────────────

def _text(value, name: str, limit: int, required: bool = True) -> str:
    cleaned = " ".join(str(value or "").split())[:limit]
    if required and not cleaned:
        raise ValueError(f"{name} is required")
    return cleaned


def _points(value, name: str) -> int:
    try:
        number = int(value or 0)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be a whole number from 0 to 4")
    if not 0 <= number <= 4:
        raise ValueError(f"{name} must be from 0 to 4")
    return number


def _items(raw, existing: List[dict], noun: str, limit: int, most: int, reserved, label_key: str = "label") -> List[dict]:
    """A list of named things with generated keys. Left out means archived."""
    if not isinstance(raw, list):
        raise ValueError(f"The {noun}s must be a list")
    if sum(1 for i in raw if isinstance(i, dict) and not i.get("archived")) > most:
        raise ValueError(f"At most {most} {noun}s of your own")
    out, seen = [], set()
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError(f"Each {noun} must be an object")
        key = str(item.get("key") or "").strip()
        if not KEY.match(key):
            raise ValueError(f"The {noun} key '{key}' must start with c_ and use lower case letters, digits and _")
        if key in seen or key in reserved:
            raise ValueError(f"The {noun} key '{key}' is used twice")
        seen.add(key)
        out.append({"key": key, label_key: _text(item.get(label_key), f"The {noun}'s name", limit),
                    "archived": bool(item.get("archived"))})
    for old in existing:
        if old.get("key") not in seen:
            out.append({**old, "archived": True})
    return out


def _options(raw, existing: List[dict], name: str, *, scored: bool, fixed: List[dict] = ()) -> List[dict]:
    """Choice options. `fixed` are built-in options: they can be relabelled and
    archived but never dropped, since the tiering rules read their values."""
    if not isinstance(raw, list):
        raise ValueError(f"The options of '{name}' must be a list")
    if sum(1 for o in raw if isinstance(o, dict) and not o.get("archived")) > _MAX["options"]:
        raise ValueError(f"'{name}' can have at most {_MAX['options']} options")
    out, seen = [], set()
    for option in raw:
        if not isinstance(option, dict):
            raise ValueError(f"Each option of '{name}' must be an object")
        label = _text(option.get("label"), f"An option of '{name}'", 120)
        value = str(option.get("value") or re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")[:40])
        if not _VALUE.match(value):
            raise ValueError(f"The option '{label}' needs a value of lower case letters, digits and _")
        if value in seen:
            raise ValueError(f"'{label}' is listed twice in '{name}'")
        seen.add(value)
        item = {"value": value, "label": label, "archived": bool(option.get("archived"))}
        if scored:
            item["points"] = _points(option.get("points"), f"The points for '{label}'")
        out.append(item)
    for old in list(fixed) + list(existing):
        if old["value"] not in seen:
            seen.add(old["value"])
            out.append({**old, "archived": True})
    if not any(not o["archived"] for o in out):
        raise ValueError(f"'{name}' needs at least one option in use")
    return out


def _builtin_questions(raw, current: dict) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("Changes to built-in questions must be given per question")
    out = {}
    for key, change in raw.items():
        q = intake.QUESTIONS.get(key)
        if q is None:
            raise ValueError(f"'{key}' is not a built-in question")
        if not isinstance(change, dict):
            raise ValueError(f"The change to '{q['label']}' must be an object")
        allowed = {"label", "help", "required", "hidden"}
        if q["type"] == "choice":
            allowed.add("options")
        if q["type"] == "yes_no":
            allowed.add("evidence")
        unknown = set(change) - allowed
        if unknown:
            raise ValueError(f"'{q['label']}' cannot change {', '.join(sorted(unknown))}")
        kept = {}
        if change.get("label"):
            kept["label"] = _text(change["label"], "The question", 300)
        if change.get("help"):
            kept["help"] = _text(change["help"], "The help text", 500)
        for flag in ("required", "hidden"):
            if flag in change and change[flag] is not None and bool(change[flag]) != bool(q.get(flag)):
                kept[flag] = bool(change[flag])
        if change.get("evidence"):
            kept["evidence"] = str(change["evidence"])
        if change.get("options"):
            before = ((current.get("builtin") or {}).get(key) or {}).get("options") or []
            kept["options"] = _options(change["options"], before, q["label"], scored=False,
                                       fixed=[{**o, "archived": False} for o in q["options"]])
        if kept:
            out[key] = kept
    return out


def _questions(raw, current: dict) -> List[dict]:
    if not isinstance(raw, list):
        raise ValueError("Your questions must be a list")
    if sum(1 for q in raw if isinstance(q, dict) and not q.get("archived")) > _MAX["questions"]:
        raise ValueError(f"At most {_MAX['questions']} questions of your own")
    before = {q["key"]: q for q in current.get("questions") or []}
    out, seen = [], set()
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError("Each question must be an object")
        key = str(item.get("key") or "").strip()
        if not KEY.match(key) or key in intake.QUESTIONS:
            raise ValueError(f"The question key '{key}' must start with c_ and use lower case letters, digits and _")
        if key in seen:
            raise ValueError(f"The question key '{key}' is used twice")
        seen.add(key)
        kind = str(item.get("type") or "")
        if kind not in intake.TYPES:
            raise ValueError(f"The answer type must be one of: {', '.join(intake.TYPES)}")
        label = _text(item.get("label"), "The question", 300)
        was = before.get(key)
        if was is not None and was.get("type") != kind:
            raise ValueError(f"'{label}' already has answers of its type; add a new question for a different type")
        question = {
            "key": key, "section": str(item.get("section") or ""), "type": kind, "label": label,
            "help": _text(item.get("help"), "The help text", 500, required=False),
            "required": bool(item.get("required")),
            "justify": bool(item.get("justify")) and kind == "yes_no",
            "show_if": str(item["show_if"]) if item.get("show_if") else None,
            "options": (_options(item.get("options") or [], (was or {}).get("options") or [], label, scored=True)
                        if kind in ("choice", "multi_choice") else []),
            "factor": str(item["factor"]) if item.get("factor") and kind in _SCORED else None,
            "points": _points(item.get("points"), f"The points for a yes to '{label}'") if kind == "yes_no" else 0,
            "evidence": str(item["evidence"]) if item.get("evidence") and kind == "yes_no" else None,
            "order": int(item.get("order") or index + 1),
            "archived": bool(item.get("archived")),
        }
        out.append(question)
    for old in before.values():
        if old["key"] not in seen:
            out.append({**old, "archived": True})
    return sorted(out, key=lambda q: (q["order"], q["key"]))


def _check(c: dict) -> None:
    """What a question points at must be there and in use."""
    sections = {s["key"] for s in intake.SECTIONS} | {s["key"] for s in c["sections"] if not s.get("archived")}
    factor_keys = {f["key"] for f in factors(c)}
    evidence = evidence_kinds(c)
    over = c["builtin"]
    yes_no = ({k for k, q in intake.QUESTIONS.items() if q["type"] == "yes_no" and not (over.get(k) or {}).get("hidden")}
              | {q["key"] for q in c["questions"] if q["type"] == "yes_no" and not q.get("archived")})
    for key, change in over.items():
        if change.get("evidence") and change["evidence"] not in evidence:
            raise ValueError(f"'{intake.QUESTIONS[key]['label']}' asks for evidence that is not in use")
    titles = {s["key"]: s["title"] for s in c["sections"]}
    for q in c["questions"]:
        if q.get("archived"):
            continue
        if q["section"] not in sections:
            if q["section"] in titles:
                raise ValueError(f"Move or remove the questions in the section '{titles[q['section']]}' first")
            raise ValueError(f"'{q['label']}' is in a section that does not exist")
        if q["factor"] and q["factor"] not in factor_keys:
            name = factor_labels(c).get(q["factor"], q["factor"])
            raise ValueError(f"The factor '{name}' is still used by '{q['label']}'; change that question first")
        if q["evidence"] and q["evidence"] not in evidence:
            raise ValueError(f"'{q['label']}' asks for evidence that is not in use")
        if q["show_if"] and (q["show_if"] == q["key"] or q["show_if"] not in yes_no):
            raise ValueError(f"'{q['label']}' can only depend on another yes-or-no question that is in use")


def clean(raw, current: Optional[dict]) -> dict:
    """The tenant's customisation after a change. Parts left out stay as they
    are; unknown parts are refused, so a typo cannot look like a saved setting."""
    if not isinstance(raw, dict):
        raise ValueError("Customisation must be an object")
    unknown = set(raw) - set(PARTS)
    if unknown:
        raise ValueError(f"Unknown customisation: {', '.join(sorted(unknown))}")
    out = merged(current)
    if "factors" in raw:
        out["factors"] = _items(raw["factors"], out["factors"], "factor", 60, _MAX["factors"], BUILTIN_FACTORS)
    if "evidence" in raw:
        out["evidence"] = _items(raw["evidence"], out["evidence"], "evidence type", 120, _MAX["evidence"], BUILTIN_EVIDENCE)
    if "sections" in raw:
        out["sections"] = _items(raw["sections"], out["sections"], "section", 60, _MAX["sections"],
                                 {s["key"] for s in intake.SECTIONS}, label_key="title")
    if "evidence_builtin" in raw:
        if not isinstance(raw["evidence_builtin"], dict) or set(raw["evidence_builtin"]) - set(BUILTIN_EVIDENCE):
            raise ValueError("Changes to built-in evidence types must be keyed by a built-in type")
        out["evidence_builtin"] = {
            k: {**({"label": _text(v["label"], "The evidence type's name", 120)} if v.get("label") else {}),
                **({"hidden": True} if v.get("hidden") else {})}
            for k, v in raw["evidence_builtin"].items() if isinstance(v, dict) and (v.get("label") or v.get("hidden"))}
    if "builtin_sections" in raw:
        builtin = {s["key"] for s in intake.SECTIONS}
        if not isinstance(raw["builtin_sections"], dict) or set(raw["builtin_sections"]) - builtin:
            raise ValueError("Changes to built-in sections must be keyed by a built-in section")
        out["builtin_sections"] = {k: {"title": _text(v.get("title"), "The section's title", 60)}
                                   for k, v in raw["builtin_sections"].items() if isinstance(v, dict) and v.get("title")}
    if "builtin" in raw:
        out["builtin"] = _builtin_questions(raw["builtin"], out)
    if "questions" in raw:
        out["questions"] = _questions(raw["questions"], out)
    _check(out)
    return out
