"""Shared helpers for the framework onboarding tests: a value that the engine accepts for any field of the catalog, so a test can fill
every required answer of any framework without hard-coding the catalog's wording."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List

from grc.modules.framework_onboarding import catalog

USERS = [7, 8, 9]


class Sampler:
    def __init__(self, org_rows: Dict[str, List[Any]] | None = None, systems: List[int] | None = None, depts: List[int] | None = None):
        self.n = 0
        self.d = 0
        self.org_rows = org_rows or {}
        self.systems = systems or [5]
        self.depts = depts or []

    def value(self, f: Dict[str, Any]) -> Any:
        t = f["type"]
        self.n += 1
        if t == "text":
            return f"Sample {f['key']}"
        if t == "longtext":
            return f"Sample long answer for {f['key']}."
        if t == "number":
            return max(int(f.get("min") or 0), 10)
        if t == "date":
            self.d += 1
            return (date(2026, 3, 1) + timedelta(days=self.d)).isoformat()
        if t == "bool":
            return True
        if t == "choice":
            return f["options"][0]
        if t == "multichoice":
            return [f["options"][-1]]
        if t == "person":
            return {"user_id": USERS[self.n % len(USERS)]}
        if t == "country":
            return "Pakistan"
        if t == "countries":
            return ["Pakistan"]
        if t == "asset_refs":
            return list(self.systems)
        if t == "vendor_ref":
            return None
        if t == "table":
            return [{c["key"]: self.value(c) for c in f["columns"] if c.get("required") and c["type"] != "vendor_ref"} for _ in range(max(int(f.get("min_rows") or 1), 1))]
        if t == "org_pick":
            of = f["of"]
            return list(self.depts if of == "departments" else self.systems if of == "systems" else self.org_rows.get(of, [])[:1])
        raise AssertionError(f"no sample for {t}")


def profile_values(sampler: Sampler | None = None) -> Dict[str, Any]:
    """{"group.field": value} for every required field of the organisation profile (and the ticks that need none)."""
    sampler = sampler or Sampler()
    out: Dict[str, Any] = {}
    for g in catalog.profile()["groups"]:
        for f in g["fields"]:
            if f["level"] == "required" and f["type"] != "departments_derived":
                out[f"{g['key']}.{f['key']}"] = sampler.value(f)
    return out


def answers_for(slug: str, sampler: Sampler, *, levels=("required",)) -> Dict[str, Dict[str, Any]]:
    """{step: {field: value}} for every field of the framework at the given levels (hidden ones too: they are ignored)."""
    res = catalog.resolve(slug)
    out: Dict[str, Dict[str, Any]] = {}
    for st in res["steps"]:
        for f in st["fields"]:
            if f["level"] in levels:
                v = sampler.value(f)
                if v is not None:
                    out.setdefault(st["key"], {})[f["key"]] = v
    return out
