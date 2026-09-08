"""Declarative deep-evidence engine for SaaS connectors.

Turns a per-connector declarative spec (resources to collect + checks to run) into
the same finding dicts the live_api collector already emits, so it flows through
`run_provider` -> `live_api_runner` -> `execute_plugin` with NO changes to the
runner, plugin model, or seeding. This is the "collect -> normalize -> check"
machinery: one engine, per-connector config, reusable check primitives.

Spec shape (see seed_data/evidence/connector_checks.json):

  {
    "resources": [
      {"name": "repository",
       "path": "/user/repos",              # relative to spec.base; {domain} already substituted
       "items": ["<dotted path to list>"], # [] = response is the list itself
       "paginate": {"style": "page", "param": "page", "size_param": "per_page", "size": 100, "limit": 300},
       "for_each": {"resource": "repository", "vars": {"full_name": "full_name"}},  # optional nested collection
       "fields": {"norm_field": "raw.dotted.path", "flag": "!raw.disabled", "n": "len:members"}},
    ],
    "checks": [
      {"id": "github.repo_private", "resource": "repository", "kind": "none_match",
       "field": "visibility", "op": "eq", "value": "public",
       "controls": ["CC6.1"], "title": "No public repositories", "item_name": "name"},
    ]
  }

Every step degrades gracefully: an unreachable resource or a check with no data
yields a skip/error finding, never an exception that breaks the connector.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from .live_api_catalog import _finding, _request  # reuse the exact request + finding helpers

MAX_ITEMS = 300          # hard cap on rows collected per resource
MAX_FINDINGS = 25        # per-check cap on per-item findings (summary is always emitted)
MAX_FOREACH = 25         # cap on nested for_each fan-out


# ── normalization ────────────────────────────────────────────────────────────
def _dotted(obj: Any, path: str) -> Any:
    cur = obj
    for part in path.split("."):
        if isinstance(cur, dict):
            cur = cur.get(part)
        elif isinstance(cur, list):
            try:
                cur = cur[int(part)]
            except (ValueError, IndexError):
                return None
        else:
            return None
    return cur


def _resolve_field(raw: Any, expr: str) -> Any:
    """A fields[] value: plain dotted path, or one of the prefixes !path / len:path / bool:path."""
    if not isinstance(expr, str):
        return expr
    if expr.startswith("!"):
        return not bool(_dotted(raw, expr[1:]))
    if expr.startswith("len:"):
        v = _dotted(raw, expr[4:])
        return len(v) if isinstance(v, (list, str, dict)) else 0
    if expr.startswith("bool:"):
        return bool(_dotted(raw, expr[5:]))
    return _dotted(raw, expr)


def _normalize(raw: Any, fields: Dict[str, str]) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        raw = {"value": raw}
    if not fields:
        return dict(raw)
    return {k: _resolve_field(raw, expr) for k, expr in fields.items()}


def _items_from(body: Any, items_path: Optional[List[str]]) -> List[Any]:
    if not items_path:
        return body if isinstance(body, list) else (body.get("data") if isinstance(body, dict) and isinstance(body.get("data"), list) else [])
    cur = body
    for p in items_path:
        cur = cur.get(p) if isinstance(cur, dict) else None
        if cur is None:
            return []
    return cur if isinstance(cur, list) else []


# ── collection ───────────────────────────────────────────────────────────────
_VAR = re.compile(r"\{([a-zA-Z0-9_]+)\}")


def _fill(path: str, vars_: Dict[str, Any]) -> Optional[str]:
    """Substitute {var} tokens; return None if any token is unresolved."""
    missing = [m for m in _VAR.findall(path) if vars_.get(m) in (None, "")]
    if missing:
        return None
    return _VAR.sub(lambda m: str(vars_.get(m.group(1), "")), path)


def _collect_one(spec: dict, creds: dict, base: str, res: dict, extra_vars: Dict[str, Any]) -> List[dict]:
    """Collect + normalize one resource for a single (optionally nested) var set."""
    raw_path = res.get("path", "")
    path = _fill(raw_path, extra_vars) if _VAR.search(raw_path) else raw_path
    if path is None:
        return []
    call = {**spec, "method": res.get("method", "GET"), "body": res.get("body")}
    fields = res.get("fields") or {}
    pag = res.get("paginate") or {"style": "none"}
    style = pag.get("style", "none")
    rows: List[dict] = []

    if style == "page":
        param, size_param = pag.get("param", "page"), pag.get("size_param")
        size, limit = int(pag.get("size", 100)), int(pag.get("limit", MAX_ITEMS))
        page = int(pag.get("start", 1))
        while len(rows) < min(limit, MAX_ITEMS):
            sep = "&" if "?" in path else "?"
            url = f"{base}{path}{sep}{param}={page}"
            if size_param:
                url += f"&{size_param}={size}"
            status, body = _request(call, creds, url)
            if status != 200:
                if page == int(pag.get("start", 1)):
                    raise _CollectError(status)
                break
            items = _items_from(body, res.get("items"))
            if not items:
                break
            rows.extend(_normalize(it, fields) for it in items)
            if len(items) < size:
                break
            page += 1
    else:
        status, body = _request(call, creds, base + path)
        if status != 200:
            raise _CollectError(status)
        items = _items_from(body, res.get("items"))
        rows.extend(_normalize(it, fields) for it in items[:MAX_ITEMS])

    return rows[:MAX_ITEMS]


class _CollectError(Exception):
    def __init__(self, status):
        self.status = status


def _collect_resource(spec: dict, creds: dict, base: str, res: dict, collected: Dict[str, List[dict]]) -> List[dict]:
    fe = res.get("for_each")
    if not fe:
        return _collect_one(spec, creds, base, res, {})
    parents = collected.get(fe.get("resource"), [])[:MAX_FOREACH]
    out: List[dict] = []
    for parent in parents:
        vars_ = {k: parent.get(v) for k, v in (fe.get("vars") or {}).items()}
        try:
            child = _collect_one(spec, creds, base, res, vars_)
        except _CollectError:
            continue
        for row in child:
            row.setdefault("_parent", parent.get(fe.get("label_field", "name")))
        out.extend(child)
    return out


# ── check primitives ─────────────────────────────────────────────────────────
def _op(a: Any, op: str, b: Any) -> bool:
    if op == "eq":
        return a == b
    if op == "ne":
        return a != b
    if op == "in":
        return a in b if isinstance(b, (list, tuple, set)) else False
    if op == "not_in":
        return a not in b if isinstance(b, (list, tuple, set)) else True
    if op == "contains":
        try:
            return b in a
        except TypeError:
            return False
    if op == "gt":
        try:
            return a is not None and a > b
        except TypeError:
            return False
    if op == "lt":
        try:
            return a is not None and a < b
        except TypeError:
            return False
    if op == "truthy":
        return bool(a)
    if op == "falsy":
        return not bool(a)
    return False


def _label(row: dict, item_name: Optional[str]) -> str:
    if item_name and row.get(item_name):
        return str(row[item_name])
    for k in ("name", "id", "email", "login", "slug", "title"):
        if row.get(k):
            return str(row[k])
    return "resource"


def _eval_check(check: dict, rows: List[dict], collect_failed: bool = False) -> List[dict]:
    """Evaluate one declarative check.

    An offender-list check (all_true/all_false/none_match/all_match/present) draws its
    conclusion from the rows it was given. On an EMPTY set it has examined nothing, so
    it reports not_run — never pass. Reporting pass there made coverage monotonically
    non-decreasing: it rose when a connector was added and never fell when a control
    broke, and a revoked read scope looked identical to a clean result.

    Count checks (min_count/max_count) are the exception: zero is a meaningful input to
    a count, so they keep their arithmetic.
    """
    codes = check.get("controls") or []
    cid = check.get("id", "check")
    title = check.get("title", cid)
    kind = check.get("kind", "present")
    field = check.get("field")
    item_name = check.get("item_name")
    skip_field = check.get("skip_if_field_true")
    considered = [r for r in rows if not (skip_field and r.get(skip_field))]
    findings: List[dict] = []

    if collect_failed:
        return [_finding(codes, cid, "directory", "error",
                         f"{title}: resource could not be collected — not assessed")]

    if kind == "min_count":
        n = len(rows)
        ok = n >= int(check.get("min", 1))
        return [_finding(codes, cid, "directory", "pass" if ok else "fail",
                         f"{title}: found {n} (min {check.get('min', 1)})")]
    if kind == "max_count":
        n = len(rows)
        ok = n <= int(check.get("max", 0))
        return [_finding(codes, cid, "directory", "pass" if ok else "fail",
                         f"{title}: found {n} (max {check.get('max', 0)})")]

    offenders: List[dict] = []
    if kind in ("all_true", "all_false"):
        want = kind == "all_true"
        for r in considered:
            if bool(r.get(field)) != want:
                offenders.append(r)
    elif kind in ("none_match", "all_match"):
        op, val = check.get("op", "eq"), check.get("value")
        for r in considered:
            matched = _op(r.get(field), op, val)
            if (kind == "none_match" and matched) or (kind == "all_match" and not matched):
                offenders.append(r)
    elif kind == "present":
        if not considered:
            return [_finding(codes, cid, "directory", "not_run",
                             f"{title}: nothing collected — not assessed")]
        # Enumerating what exists is evidence, not a test: the items are "info" and
        # only the directory line asserts the resource is non-empty.
        for r in considered[:MAX_FINDINGS]:
            findings.append(_finding(codes, cid, _label(r, item_name), "info", "present"))
        findings.append(_finding(codes, cid, "directory", "pass",
                                 f"{title}: {len(considered)} present"))
        return findings
    else:
        return [_finding(codes, cid, "directory", "error", f"{title}: unknown check kind '{kind}'")]

    if not considered:
        return [_finding(codes, cid, "directory", "not_run",
                         f"{title}: no records to assess — not assessed")]

    for r in offenders[:MAX_FINDINGS]:
        findings.append(_finding(codes, cid, _label(r, item_name), "fail",
                                 check.get("fail_msg", f"{title}: violation")))
    findings.append(_finding(codes, cid, "directory",
                             "pass" if not offenders else "fail",
                             f"{title}: {len(offenders)} of {len(considered)} failed"))
    return findings


# ── driver ───────────────────────────────────────────────────────────────────
def run_connector_checks(provider: str, spec: dict, creds: dict, base: str, cdef: dict) -> List[dict]:
    """Collect every declared resource (parents first), then run every check.
    Returns finding dicts; never raises."""
    resources = cdef.get("resources") or []
    checks = cdef.get("checks") or []
    # parents (no for_each) first so nested resources can reference them
    resources = sorted(resources, key=lambda r: 1 if r.get("for_each") else 0)
    collected: Dict[str, List[dict]] = {}
    failed: set = set()          # resources whose collection errored
    findings: List[dict] = []

    for res in resources:
        name = res.get("name")
        if not name:
            continue
        try:
            collected[name] = _collect_resource(spec, creds, base, res, collected)
        except _CollectError as e:
            collected[name] = []
            failed.add(name)
            findings.append(_finding(res.get("controls") or [], f"{provider}.{name}", name, "error",
                                     f"Could not collect '{name}' (HTTP {e.status}) — token may lack read scope"))
        except Exception:  # noqa: BLE001 — never break the connector on one resource
            collected[name] = []
            failed.add(name)

    for check in checks:
        rows = collected.get(check.get("resource"), [])
        if not rows and check.get("resource") not in collected:
            continue  # resource never declared
        try:
            findings.extend(_eval_check(check, rows, check.get("resource") in failed))
        except Exception:  # noqa: BLE001
            findings.append(_finding(check.get("controls") or [], check.get("id", "check"), "directory",
                                     "error", "check evaluation failed"))
    return findings


def connector_control_codes(cdef: dict) -> List[str]:
    codes = set()
    for check in (cdef.get("checks") or []):
        codes.update(check.get("controls") or [])
    return sorted(codes)


if __name__ == "__main__":
    # self-check on mock rows — no network
    rows = [
        {"name": "alice", "mfa": True, "bot": False, "vis": "private"},
        {"name": "bob", "mfa": False, "bot": False, "vis": "public"},
        {"name": "ci", "mfa": False, "bot": True, "vis": "private"},
    ]
    mfa = _eval_check({"id": "t.mfa", "kind": "all_true", "field": "mfa", "controls": ["CC6.1"],
                       "title": "MFA", "item_name": "name", "skip_if_field_true": "bot"}, rows)
    assert mfa[-1]["status"] == "fail", mfa
    assert sum(1 for f in mfa if f["status"] == "fail" and f["resource"] == "bob") == 1
    assert not any(f["resource"] == "ci" for f in mfa)  # bot skipped
    pub = _eval_check({"id": "t.pub", "kind": "none_match", "field": "vis", "op": "eq", "value": "public",
                       "controls": ["CC6.1"], "title": "No public", "item_name": "name"}, rows)
    assert pub[-1]["status"] == "fail" and any(f["resource"] == "bob" for f in pub)
    mc = _eval_check({"id": "t.count", "kind": "min_count", "min": 5, "controls": ["CC7.2"], "title": "Monitors"}, rows)
    assert mc[0]["status"] == "fail"
    assert _resolve_field({"a": {"b": [1, 2]}}, "len:a.b") == 2
    assert _resolve_field({"disabled": True}, "!disabled") is False
    print("evidence_engine self-check: PASS")
