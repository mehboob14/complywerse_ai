"""The pure rules of framework onboarding: normalise a saved value, say whether a field is filled, evaluate readiness.

No database here (the caller passes what must exist as ``Known``). A field is *answered* (a yes/no question has an answer, even "no")
or has a *value* (a tick that says "none" counts only when ticked). Readiness: (a) every required field of every applicable step is filled, (b) the family's gate checks hold, (c) a recorded approval (the
service adds this one). Advised items advise and never block. The organisation profile (Administration) is general and gates nothing.
"""
from __future__ import annotations

import math
import uuid
from dataclasses import dataclass, field as dc_field
from datetime import date
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from . import catalog

LONG = 8000
SHORT = 500
MAX_FILES = 3          # documents on one answer


class FieldError(ValueError):
    """A value that cannot be saved: the message is shown to the person."""


@dataclass
class Known:
    """What exists in the tenant, for checking references. ``None`` skips that check (pure tests)."""
    users: Optional[Set[int]] = None
    assets: Optional[Set[int]] = None
    vendors: Optional[Set[int]] = None
    departments: Optional[Set[int]] = None
    row_ids: Dict[str, Set[str]] = dc_field(default_factory=dict)   # org_pick of -> ids of the profile rows
    files: Optional[Dict[int, str]] = None                          # documents uploaded here: id -> file name


def new_row_id() -> str:
    return "r" + uuid.uuid4().hex[:10]


def _empty(v: Any) -> bool:
    return v is None or (isinstance(v, str) and not v.strip()) or (isinstance(v, (list, dict)) and not v and not isinstance(v, bool))


# --------------------------------------------------------------------------- normalise
def _num(v: Any) -> float:
    if isinstance(v, bool):
        raise FieldError("Enter a number.")
    try:
        n = float(v)
    except (TypeError, ValueError):
        raise FieldError("Enter a number.")
    if math.isnan(n) or math.isinf(n):
        raise FieldError("Enter a number.")
    return int(n) if n == int(n) else n


def _ids(v: Any, what: str) -> List[int]:
    if not isinstance(v, list):
        raise FieldError(f"Choose from the {what}.")
    out: List[int] = []
    for x in v:
        try:
            i = int(x)
        except (TypeError, ValueError):
            raise FieldError(f"Choose from the {what}.")
        if i not in out:
            out.append(i)
    return out


def normalise(f: Dict[str, Any], value: Any, known: Optional[Known] = None, *, keep_ids: Optional[Set[str]] = None) -> Any:
    """The value to store for field definition ``f`` (None = cleared). Raises FieldError with a message a person can act on."""
    known = known or Known()
    t = f.get("type")
    if t == "bool":
        if value is None:
            return None
        if not isinstance(value, bool):
            raise FieldError("Answer yes or no.")
        return value
    if t == "table":
        if value in (None, ""):
            return []
        if not isinstance(value, list):
            raise FieldError("Rows must be a list.")
        rows: List[Dict[str, Any]] = []
        for raw in value:
            if not isinstance(raw, dict):
                raise FieldError("Each row must be a set of values.")
            row: Dict[str, Any] = {}
            for col in f.get("columns") or []:
                try:
                    v = normalise(col, raw.get(col["key"]), known)
                except FieldError as e:
                    raise FieldError(f"{col.get('label') or col['key']}: {e}")
                if v is not None:
                    row[col["key"]] = v
            if not row:
                continue
            rid = raw.get("id")
            row["id"] = rid if isinstance(rid, str) and rid and len(rid) <= 24 else new_row_id()
            rows.append(row)
        seen: Set[str] = set()
        for r in rows:                      # a pasted duplicate id gets a new one
            if r["id"] in seen:
                r["id"] = new_row_id()
            seen.add(r["id"])
        return rows
    if _empty(value):
        return None
    if t in ("text", "country"):
        if not isinstance(value, str):
            raise FieldError("Enter text.")
        return value.strip()[:SHORT]
    if t == "longtext":
        if not isinstance(value, str):
            raise FieldError("Enter text.")
        return value.strip()[:LONG]
    if t == "number":
        n = _num(value)
        if "min" in f and n < f["min"]:
            raise FieldError(f"Enter {f['min']} or more.")
        if "max" in f and n > f["max"]:
            raise FieldError(f"Enter {f['max']} or less.")
        return n
    if t == "date":
        s = str(value)[:10]
        try:
            return date.fromisoformat(s).isoformat()
        except ValueError:
            raise FieldError("Enter a date as year-month-day.")
    if t == "choice":
        if value not in (f.get("options") or []):
            raise FieldError("Choose one of the listed answers.")
        return value
    if t == "multichoice":
        if not isinstance(value, list):
            raise FieldError("Choose from the list.")
        bad = [x for x in value if x not in (f.get("options") or [])]
        if bad:
            raise FieldError("Choose from the listed answers.")
        return [o for o in f["options"] if o in value]
    if t == "countries":
        if not isinstance(value, list) or not all(isinstance(x, str) for x in value):
            raise FieldError("Choose countries from the list.")
        out: List[str] = []
        for x in value:
            x = x.strip()[:80]
            if x and x not in out:
                out.append(x)
        return out
    if t == "person":
        if not isinstance(value, dict):
            raise FieldError("Choose a person.")
        if value.get("user_id") is not None:
            try:
                uid = int(value["user_id"])
            except (TypeError, ValueError):
                raise FieldError("Choose a person.")
            if known.users is not None and uid not in known.users:
                raise FieldError("That person is not in this organisation.")
            return {"user_id": uid}
        name = str(value.get("name") or "").strip()
        if not name:
            raise FieldError("Enter the person's name.")
        out2 = {"name": name[:200]}
        for k in ("email", "organisation"):
            if str(value.get(k) or "").strip():
                out2[k] = str(value[k]).strip()[:200]
        return out2
    if t == "asset_refs":
        ids = _ids(value, "assets")
        if known.assets is not None and not set(ids) <= known.assets:
            raise FieldError("Choose from the assets of this organisation.")
        return ids
    if t == "vendor_ref":
        try:
            vid = int(value)
        except (TypeError, ValueError):
            raise FieldError("Choose a vendor.")
        if known.vendors is not None and vid not in known.vendors:
            raise FieldError("Choose a vendor of this organisation.")
        return vid
    if t == "org_pick":
        of = f.get("of")
        if of in ("systems", "departments"):
            ids = _ids(value, "list")
            valid = known.assets if of == "systems" else known.departments
            if valid is not None and not set(ids) <= valid:
                raise FieldError("Choose from the organisation profile.")
            return ids
        if not isinstance(value, list) or not all(isinstance(x, str) for x in value):
            raise FieldError("Choose from the organisation profile.")
        picked = list(dict.fromkeys(value))
        valid_rows = known.row_ids.get(of)
        if valid_rows is not None and not set(picked) <= valid_rows:
            raise FieldError("Choose from the organisation profile.")
        return picked
    if t == "existing":
        raise FieldError("What already exists is added with Add existing work.")
    if t == "files":
        if not isinstance(value, list):
            raise FieldError("Attach a file with Upload.")
        docs: List[Dict[str, Any]] = []
        for x in value:
            try:
                i = int(x["id"] if isinstance(x, dict) else x)
            except (TypeError, ValueError, KeyError):
                raise FieldError("Attach a file with Upload.")
            if any(d["id"] == i for d in docs):
                continue
            if known.files is not None and i not in known.files:
                raise FieldError("Attach a file with Upload.")
            name = (known.files or {}).get(i) or (str(x.get("name") or "") if isinstance(x, dict) else "") or "File"
            docs.append({"id": i, "name": name[:200]})
        if len(docs) > MAX_FILES:
            raise FieldError(f"Attach at most {MAX_FILES} files here.")
        return docs
    if t == "departments_derived":
        raise FieldError("Departments come from Governance settings.")
    raise FieldError("Unsupported field.")


# --------------------------------------------------------------------------- filled
def row_complete(f: Dict[str, Any], row: Dict[str, Any]) -> bool:
    return all(not _empty(row.get(c["key"])) for c in f.get("columns") or [] if c.get("required"))


def answered(f: Dict[str, Any], v: Any) -> bool:
    """A required question has an answer: a yes/no counts when it is yes OR no; a list needs ``min_rows`` (default 1) complete rows."""
    t = f.get("type")
    if t == "bool":
        return v is not None
    need = int(f.get("min_rows", 1))               # 0 = no minimum
    if t == "table":
        return sum(1 for r in v or [] if row_complete(f, r)) >= need
    if t in ("asset_refs", "org_pick", "countries", "multichoice", "departments_derived", "files"):
        return len(v or []) >= need
    if t == "person":
        return isinstance(v, dict) and bool(v.get("user_id") or v.get("name"))
    return not _empty(v) and v is not False


def has_value(f: Dict[str, Any], v: Any) -> bool:
    """A statement holds: a tick is ticked, a list has something, text is there."""
    t = f.get("type")
    if t == "bool":
        return v is True
    if t == "table":
        return any(row_complete(f, r) for r in v or [])
    if t in ("asset_refs", "org_pick", "countries", "multichoice", "departments_derived", "files"):
        return bool(v)
    if t == "person":
        return answered(f, v)
    return not _empty(v)


def same_person(a: Any, b: Any) -> bool:
    if not (isinstance(a, dict) and isinstance(b, dict)):
        return False
    if a.get("user_id") or b.get("user_id"):
        return a.get("user_id") == b.get("user_id")
    ea, eb = str(a.get("email") or "").lower(), str(b.get("email") or "").lower()
    if ea and eb:
        return ea == eb
    return str(a.get("name") or "").strip().lower() == str(b.get("name") or "").strip().lower()


# --------------------------------------------------------------------------- evaluation
Lookup = Callable[[str], Tuple[Optional[Dict[str, Any]], Any]]


def make_lookup(fam_fields: Dict[str, Dict[str, Any]], answers: Dict[str, Any],
                org_fields: Dict[str, Dict[str, Any]], org_values: Dict[str, Any], *, bare_is_org: bool = False,
                fw_version: Optional[str] = None) -> Lookup:
    def look(ref: str) -> Tuple[Optional[Dict[str, Any]], Any]:
        if ref == catalog.FW_VERSION:                   # the version in use, as a key of the framework's ``versions`` (None: not known)
            return {"key": "version", "type": "choice"}, fw_version
        if ref.startswith("org.") or bare_is_org:
            key = ref[4:] if ref.startswith("org.") else ref
            g, _, k = key.partition(".")
            return org_fields.get(key), (org_values.get(g) or {}).get(k)
        step, _, k = ref.partition(".")
        return fam_fields.get(ref), (answers.get(step) or {}).get(k)
    return look


def condition(when: Optional[Dict[str, Any]], look: Lookup, visible: Callable[[str], bool]) -> bool:
    if not when:
        return True
    ref = when["field"]
    fdef, v = look(ref)
    if not visible(ref):
        return False
    if "eq" in when:
        return v == when["eq"]
    if "ne" in when:
        return v != when["ne"]
    if "in" in when:
        return v in when["in"]
    if "includes" in when:
        return isinstance(v, list) and when["includes"] in v
    if "truthy" in when:
        return bool(fdef and has_value(fdef, v)) == bool(when["truthy"])
    return True


def make_visible(fields: Dict[str, Dict[str, Any]], look: Lookup, prefix: str = "") -> Callable[[str], bool]:
    """Is a field shown: its own ``when`` holds and the field the ``when`` points at is itself shown (a stale answer to a hidden question is ignored)."""
    memo: Dict[str, bool] = {}

    def visible(ref: str) -> bool:
        if ref in memo:
            return memo[ref]
        memo[ref] = True  # guards a cycle
        f = fields.get(ref)
        if f is None or not f.get("when"):
            return True
        ok = condition(f["when"], look, visible)
        memo[ref] = ok
        return ok

    return visible


def _check(c: Dict[str, Any], look: Lookup) -> Tuple[bool, Optional[str]]:
    """(ok, None). A date-order or distinct-people check passes when an input is missing: the field's own rule says it is needed."""
    t = c["type"]
    if t in ("filled", "true", "equals", "not_equals", "in", "includes", "count_at_least"):
        f, v = look(c["field"])
        f = f or {"type": "text"}
        if t == "filled":
            return has_value(f, v), None
        if t == "true":
            return v is True, None
        if t == "equals":
            return answered(f, v) and v == c["value"], None
        if t == "not_equals":
            return answered(f, v) and v != c["value"], None
        if t == "in":
            return v in c["values"], None
        if t == "includes":
            return isinstance(v, list) and c["value"] in v, None
        n = len([r for r in v or [] if row_complete(f, r)]) if f.get("type") == "table" else len(v or [])
        return n >= int(c["n"]), None
    if t in ("before", "span_at_least_days"):
        a, b = look(c["first"])[1], look(c["second"])[1]
        if not a or not b:
            return True, None
        da, db_ = date.fromisoformat(a), date.fromisoformat(b)
        if t == "before":
            return da < db_, None
        return (db_ - da).days >= int(c["days"]), None
    if t == "distinct":
        people = [look(r)[1] for r in c["fields"]]
        people = [p for p in people if isinstance(p, dict) and (p.get("user_id") or p.get("name"))]
        if len(people) < 2:
            return True, None
        return not any(same_person(people[i], people[j]) for i in range(len(people)) for j in range(i + 1, len(people))), None
    if t == "any_filled":
        found = [look(r) for r in c["fields"]]
        return any(fdef is not None and has_value(fdef, v) for fdef, v in found), None
    if t == "table_rule":
        f, rows = look(c["field"])
        for row in (rows or []):
            if row.get(c["when_column"]) != c["equals"]:
                continue
            got = row.get(c["then_column"])
            if "not_equals" in c and (_empty(got) or got == c["not_equals"]):
                return False, None
            if "then_equals" in c and got != c["then_equals"]:
                return False, None
        return True, None
    return True, None


def _gate_entry(g: Dict[str, Any], ok: bool, step: Optional[str] = None) -> Dict[str, Any]:
    out = {"key": g["key"], "label": g["label"], "ok": ok, "required": g.get("level") == "required", "hint": g.get("hint"), "kind": "gate"}
    if step:
        out["step"] = step                  # the step the first answer it reads is on: where the screen sends the person
    return out


def _gate_step(check: Dict[str, Any], steps: Set[str]) -> Optional[str]:
    refs = list(check.get("fields") or []) + [check[k] for k in ("field", "first", "second") if k in check]
    for r in refs:
        if not r.startswith("org.") and r.split(".")[0] in steps:
            return r.split(".")[0]
    return None


def evaluate_org(org_values: Dict[str, Any], reviewed: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Completeness of the organisation profile: per group (required items filled) and the profile's own cross-field checks."""
    prof = catalog.profile()
    org_fields = catalog.profile_fields()
    look = make_lookup({}, {}, org_fields, org_values, bare_is_org=True)
    visible = make_visible(org_fields, look)
    groups: Dict[str, Any] = {}
    missing: List[Dict[str, Any]] = []
    for g in prof["groups"]:
        req = ok = adv_open = 0
        for f in g["fields"]:
            ref = f"{g['key']}.{f['key']}"
            if not visible(ref):
                continue
            v = (org_values.get(g["key"]) or {}).get(f["key"])
            if f["level"] == "required":
                req += 1
                if answered(f, v):
                    ok += 1
                else:
                    missing.append({"group": g["key"], "field": f["key"], "label": f["label"]})
            elif f["level"] == "advised" and not answered(f, v):
                adv_open += 1
        groups[g["key"]] = {"label": g["label"], "required_total": req, "required_ok": ok, "advised_open": adv_open,
                            "complete": ok == req, "reviewed": bool((reviewed or {}).get(g["key"]))}
    checks = []
    for c in prof.get("checks") or []:
        ok, _ = _check(c["check"], look)
        checks.append(_gate_entry(c, ok))
    complete = all(v["complete"] for v in groups.values()) and all(c["ok"] for c in checks if c["required"])
    return {"complete": complete, "groups": groups, "checks": checks, "missing": missing}


def version_key_of(resolved: Dict[str, Any], answers: Dict[str, Any], library_version: Optional[str]) -> Optional[str]:
    """The version of the framework this onboarding is about (``catalog.version_key``): the answered one, else the one the library row holds."""
    vs = resolved.get("versions")
    if not vs:
        return None
    step, _, key = (vs.get("answer") or "").partition(".")
    return catalog.version_key(vs, (answers.get(step) or {}).get(key) if step else None, library_version)


def evaluate(resolved: Dict[str, Any], answers: Dict[str, Any], org_values: Dict[str, Any], library_version: Optional[str] = None) -> Dict[str, Any]:
    """Readiness of ONE framework's onboarding: ``{ready, checks, org_checks, steps, hidden, counts, version_key}``.

    Only this framework's own required answers and its gate checks decide ``ready``. The organisation profile gates nothing: a person who
    needs one of its lists (sites, systems, third parties) in a pick is sent to it; ``org_values`` only feeds the ``when`` of a question and the
    prefill. ``org_checks`` stays in the answer, empty, so nothing that read it breaks."""
    org_fields = catalog.profile_fields()
    fam_fields: Dict[str, Dict[str, Any]] = {}
    for st in resolved["steps"]:
        for f in st["fields"]:
            fam_fields[f"{st['key']}.{f['key']}"] = f
    vkey = version_key_of(resolved, answers, library_version)
    look = make_lookup(fam_fields, answers, org_fields, org_values, fw_version=vkey)
    visible = make_visible({**fam_fields}, look)

    checks: List[Dict[str, Any]] = []
    steps: List[Dict[str, Any]] = []
    hidden: List[str] = []
    for st in resolved["steps"]:
        req = ok_n = 0
        for f in st["fields"]:
            ref = f"{st['key']}.{f['key']}"
            if not visible(ref):
                hidden.append(ref)
                continue
            if f["type"] == "existing":                  # rows kept apart (existing.py), not an answer: never an open item
                continue
            v = (answers.get(st["key"]) or {}).get(f["key"])
            good = answered(f, v)
            if f["level"] == "required":
                req += 1
                ok_n += 1 if good else 0
                checks.append({"key": ref, "label": f["label"], "ok": good, "required": True, "hint": f.get("note"), "step": st["key"], "kind": "field"})
            elif f["level"] == "advised" and not good:
                checks.append({"key": ref, "label": f["label"], "ok": False, "required": False, "hint": f.get("note"), "step": st["key"], "kind": "field"})
        steps.append({"key": st["key"], "label": st["label"], "required_total": req, "required_ok": ok_n, "complete": ok_n == req})
    step_keys = {s["key"] for s in resolved["steps"]}
    for g in resolved["gate"]:
        if g.get("when") and not condition(g["when"], look, visible):
            continue
        ok, _ = _check(g["check"], look)
        checks.append(_gate_entry(g, ok, _gate_step(g["check"], step_keys)))

    required = [c for c in checks if c["required"]]
    return {
        "ready": all(c["ok"] for c in required), "checks": checks, "org_checks": [], "steps": steps, "hidden": hidden, "version_key": vkey,
        "counts": {"required_total": len(required), "required_ok": sum(1 for c in required if c["ok"]),
                   "advised_open": sum(1 for c in checks if not c["required"] and not c["ok"])},
    }


def unmet(readiness: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The required checks that fail, for a refusal."""
    return [{"key": c["key"], "label": c["label"], "hint": c.get("hint")} for c in readiness["checks"] + readiness["org_checks"] if c["required"] and not c["ok"]]
