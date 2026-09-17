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
       "items": ["<dotted path to list>"], # [] = response is the list itself; ["$"] = one object is the row
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
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple

from .live_api_catalog import _finding, _request  # reuse the exact request + finding helpers
from .assertions import (
    SpecError,
    aggregate as _aggregate,
    join_rows as _join_rows,
    select as _select,
)

# ponytail: fixed caps keep one run bounded; a check over a capped collection says
# so in its result ("first 5,000 only") rather than passing on a partial population.
MAX_ITEMS = 5000         # hard cap on rows collected per resource
MAX_FINDINGS = 25        # per-check cap on per-item findings (summary is always emitted)
MAX_FOREACH = 100        # cap on nested for_each fan-out


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


def _item_path(path: str) -> str:
    """`raw.isActive` and `isActive` both name a field of the item itself.

    Seven connectors' specs wrote paths as `raw.<field>`. Looked up literally, that
    asked each item for a key called "raw", so every value was empty and those
    checks judged nothing.
    """
    return path[4:] if path.startswith("raw.") else path


def _resolve_field(raw: Any, expr: str) -> Any:
    """A fields[] value: plain dotted path, or one of the prefixes !path / len:path / bool:path."""
    if not isinstance(expr, str):
        return expr
    if expr.startswith("!"):
        return not bool(_dotted(raw, _item_path(expr[1:])))
    if expr.startswith("len:"):
        v = _dotted(raw, _item_path(expr[4:]))
        return len(v) if isinstance(v, (list, str, dict)) else 0
    if expr.startswith("bool:"):
        return bool(_dotted(raw, _item_path(expr[5:])))
    return _dotted(raw, _item_path(expr))


def _normalize(raw: Any, fields: Dict[str, str]) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        raw = {"value": raw}
    if not fields:
        return dict(raw)
    return {k: _resolve_field(raw, expr) for k, expr in fields.items()}


def _items_from(body: Any, items_path: Optional[List[str]]) -> List[Any]:
    # ["$"]: the whole response is one row. A detail endpoint (/orgs/{org},
    # /account) answers with one object; without this that object was read as an
    # empty list and the checks on it never evaluated. A list response (Okta's
    # /users/{id}/factors) becomes {"value": [...]}, so `len:value` counts it.
    if items_path == ["$"]:
        return [body] if isinstance(body, (dict, list)) else []
    if not items_path:
        return body if isinstance(body, list) else (body.get("data") if isinstance(body, dict) and isinstance(body.get("data"), list) else [])
    cur = body
    for p in items_path:
        cur = cur.get(p) if isinstance(cur, dict) else None
        if cur is None:
            return []
    # a single object at the path (Snyk's org SAST settings) is one row, not none
    return cur if isinstance(cur, list) else ([cur] if isinstance(cur, dict) else [])


# ── collection ───────────────────────────────────────────────────────────────
_VAR = re.compile(r"\{([a-zA-Z0-9_]+)\}")


def _fill(path: str, vars_: Dict[str, Any]) -> Optional[str]:
    """Substitute {var} tokens; return None if any token is unresolved."""
    missing = [m for m in _VAR.findall(path) if vars_.get(m) in (None, "")]
    if missing:
        return None
    return _VAR.sub(lambda m: str(vars_.get(m.group(1), "")), path)


def _with_query(url: str, params: Dict[str, Any]) -> str:
    """Set query parameters, leaving every other parameter byte-for-byte as written."""
    head, _, query = url.partition("?")
    keep = [p for p in query.split("&") if p and urllib.parse.unquote_plus(p.split("=", 1)[0]) not in params]
    keep += [f"{k}={urllib.parse.quote(str(v), safe='')}" for k, v in params.items()]
    return f"{head}?{'&'.join(keep)}"


def _next_value(body: Any, items: List[Any], expr: str) -> Any:
    """Where the next page is: a body path, a key holding dots ("@odata.nextLink"),
    or `last:<field>` of the final item (Render's per-item cursor)."""
    if expr.startswith("last:"):
        return _dotted(items[-1], expr[5:]) if items and isinstance(items[-1], dict) else None
    if isinstance(body, dict) and expr in body:
        return body[expr]
    return _dotted(body, expr)


def _link_header_next(headers: Dict[str, str]) -> Optional[str]:
    """rel="next" from an RFC 8288 Link header (Okta, Sentry)."""
    value = next((v for k, v in (headers or {}).items() if k.lower() == "link"), "")
    for part in value.split(","):
        m = re.match(r'\s*<([^>]+)>\s*;(.*)', part)
        if m and re.search(r'rel="?next"?', m.group(2)) and 'results="false"' not in m.group(2):
            return m.group(1)
    return None


def _same_site_link(base: str, link: Any) -> Optional[str]:
    """A next-page link from the response, only if it stays on the provider's host.

    The link is response content and the request carries the customer's
    credential, so a link to any other host is never followed.
    """
    if not isinstance(link, str) or not link:
        return None
    b = urllib.parse.urlsplit(base)
    if link.startswith("/") and not link.startswith("//"):
        link = f"{b.scheme}://{b.netloc}{link}"
    n = urllib.parse.urlsplit(link)
    return link if (n.scheme, n.netloc) == (b.scheme, b.netloc) else None


def _collect_one(spec: dict, creds: dict, base: str, res: dict,
                 extra_vars: Dict[str, Any]) -> Tuple[List[dict], Optional[str]]:
    """Collect + normalize one resource for a single (optionally nested) var set.

    Returns the rows and, when they are not the whole population, why not.

    paginate styles:
      page     {"param": "page", "size_param": "per_page", "size": 100, "start": 1}
      offset   {"param": "offset", "size_param": "limit", "size": 500}
      cursor   {"param": "after_id", "next": "last_id", "more": "has_more"}
      next_url {"next": "links.next"}   (absolute, or a path on the same host)
      link_header {}                    (rel="next" in the Link response header)
    """
    raw_path = res.get("path", "")
    path = _fill(raw_path, extra_vars) if _VAR.search(raw_path) else raw_path
    if path is None:
        return [], None
    call = {**spec, "method": res.get("method", "GET"), "body": res.get("body")}
    fields = res.get("fields") or {}
    pag = res.get("paginate") or {}
    style = pag.get("style", "none")
    size = int(pag.get("size", 100))
    cap = min(int(pag.get("limit", MAX_ITEMS)), MAX_ITEMS)
    first_url = base + path
    if style in ("page", "offset"):
        position = int(pag.get("start", 0 if style == "offset" else 1))
        sized = {pag["size_param"]: size} if pag.get("size_param") else {}
        first_url = _with_query(first_url, {pag.get("param", style): position, **sized})
    elif style == "cursor" and pag.get("size_param"):
        first_url = _with_query(first_url, {pag["size_param"]: size})

    rows: List[dict] = []
    url: Optional[str] = first_url
    seen: set = set()
    while url and url not in seen:
        seen.add(url)
        status, body, headers = _request(call, creds, url, with_headers=True)
        if status != 200:
            if url == first_url:
                raise _CollectError(status)
            return rows, f"a later page could not be read (HTTP {status}), so only the first {len(rows):,} were checked"
        items = _items_from(body, res.get("items"))
        rows.extend(_normalize(it, fields) for it in items)

        url = None
        if items and style in ("page", "offset") and len(items) >= size:
            position += 1 if style == "page" else len(items)
            url = _with_query(base + path, {pag.get("param", style): position, **sized})
        elif items and style == "cursor":
            more = pag.get("more")
            token = _next_value(body, items, pag.get("next", ""))
            if token not in (None, "", False) and (not more or _dotted(body, more)):
                url = _with_query(first_url, {pag["param"]: token})
        elif items and style in ("next_url", "link_header"):
            link = _link_header_next(headers) if style == "link_header" else _next_value(body, items, pag.get("next", ""))
            url = _same_site_link(base, link)
            if link and not url:
                return rows[:cap], "the next page was on another host and was not followed"
        if url and len(rows) >= cap:
            return rows[:cap], f"only the first {cap:,} were checked"
    return rows[:cap], (f"only the first {cap:,} were checked" if len(rows) > cap else None)


class _CollectError(Exception):
    def __init__(self, status):
        self.status = status


class _NoParents(Exception):
    """A nested resource whose parent resource came back empty: nothing to look up."""


def _collect_resource(spec: dict, creds: dict, base: str, res: dict,
                      collected: Dict[str, List[dict]]) -> Tuple[List[dict], Optional[str]]:
    fe = res.get("for_each")
    if not fe:
        return _collect_one(spec, creds, base, res, {})
    all_parents = collected.get(fe.get("resource"), [])
    if not all_parents:
        raise _NoParents()
    parents = all_parents[:MAX_FOREACH]
    out: List[dict] = []
    notes: List[str] = []
    reached, last_status = 0, 0
    for parent in parents:
        vars_ = {k: parent.get(v) for k, v in (fe.get("vars") or {}).items()}
        try:
            child, note = _collect_one(spec, creds, base, res, vars_)
        except _CollectError as e:
            last_status = e.status
            continue
        reached += 1
        if note:
            notes.append(note)
        for row in child:
            row.setdefault("_parent", parent.get(fe.get("label_field", "name")))
        out.extend(child)
    parent_noun = str(fe.get("resource", "parents")).replace("_", " ")
    # Every lookup refused is a collection failure, not an empty result: an
    # owner-only endpoint read with a member's token must not look like "none found".
    if reached == 0:
        raise _CollectError(last_status)
    if reached < len(parents):
        notes.append(f"{len(parents) - reached} of {len(parents)} {parent_noun} could not be read")
    if len(all_parents) > len(parents):
        notes.append(f"only the first {len(parents)} of {len(all_parents)} {parent_noun} were looked up")
    return out, "; ".join(dict.fromkeys(notes)) or None


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
    if op == "has_word":
        # one scope in a space-separated list: "global" in "global purge_all",
        # but not in "global:read"
        return isinstance(a, str) and str(b) in a.split()
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


def _eval_spec_check(check: dict, rows: List[dict], collected: Dict[str, List[dict]],
                     collect_failed: bool) -> List[dict]:
    """Evaluate a check written in the scope/join/assert form.

    A check opts in by declaring `assert`. Everything without it keeps running
    through the original `kind` path untouched, so 251 shipped checks need no
    edit and there is no flag day.

        {"id": "...", "resource": "devices", "controls": ["CC6.7"],
         "scope":  {"and": [["type","eq","laptop"], ["ownership","eq","corporate"]]},
         "join":   {"resource": "agents", "on": ["serial","device_serial"],
                    "unmatched": "fail"},
         "assert": {"all": ["encrypted","truthy"]},
         "empty":  "not_applicable"}
    """
    codes = check.get("controls") or []
    cid = check.get("id", "check")
    title = check.get("title", cid)
    item_name = check.get("item_name")

    if collect_failed:
        return [_finding(codes, cid, "directory", "error",
                         f"{title}: resource could not be collected — not assessed")]

    try:
        scoped = _select(rows, check.get("scope"))
    except SpecError as e:
        return [_finding(codes, cid, "directory", "error", f"{title}: bad scope — {e}")]
    findings: List[dict] = []
    unmatched: List[dict] = []

    join = check.get("join")
    if join:
        other = collected.get(join.get("resource"))
        if other is None:
            return [_finding(codes, cid, "directory", "error",
                             f"{title}: join resource '{join.get('resource')}' was not collected")]
        on = join.get("on") or []
        if len(on) != 2:
            return [_finding(codes, cid, "directory", "error",
                             f"{title}: join needs on:[left_key, right_key]")]
        scoped, unmatched = _join_rows(scoped, other, (on[0], on[1]))
        # A row on the left with no counterpart is the finding in every
        # correlation control: the terminated employee still holding an account,
        # the inventoried device with no agent. Whether that is a failure is the
        # author's call, because a fuzzy key that half-matches would otherwise
        # manufacture findings across the whole population.
        if unmatched and join.get("unmatched") == "fail":
            for r in unmatched[:MAX_FINDINGS]:
                findings.append(_finding(codes, cid, _label(r, item_name), "fail",
                                         join.get("unmatched_msg",
                                                  f"{title}: no matching record in "
                                                  f"'{join.get('resource')}'")))

    try:
        v = _aggregate(scoped, check.get("assert") or {},
                       population=len(rows),
                       empty=check.get("empty", "not_applicable"))
    except SpecError as e:
        return [_finding(codes, cid, "directory", "error", f"{title}: bad assertion — {e}")]

    for r in v.offenders[:MAX_FINDINGS]:
        findings.append(_finding(codes, cid, _label(r, item_name), "fail",
                                 check.get("fail_msg", f"{title}: violation")))

    status = v.status
    if status == "pass" and unmatched and join and join.get("unmatched") == "fail":
        status = "fail"                     # unmatched rows are their own failure
    findings.append(_finding(
        codes, cid, "directory", status,
        f"{title}: {v.detail}" + (f"; {len(unmatched)} unmatched" if unmatched else ""),
        population=v.population, tested=v.tested,
        truncated=len(v.offenders) > MAX_FINDINGS))
    return findings


def _eval_check(check: dict, rows: List[dict], collect_failed: bool = False,
                collected: Optional[Dict[str, List[dict]]] = None,
                note: Optional[str] = None) -> List[dict]:
    """Evaluate one check; `note` says why the rows are not the whole population."""
    findings = _eval_rows(check, rows, collect_failed, collected)
    if note and findings and findings[-1]["resource"] == "directory" and findings[-1]["status"] != "error":
        findings[-1]["detail"] += f" ({note})"
        findings[-1]["truncated"] = True
    return findings


def _eval_rows(check: dict, rows: List[dict], collect_failed: bool,
               collected: Optional[Dict[str, List[dict]]]) -> List[dict]:
    """Evaluate one declarative check.

    An offender-list check (all_true/all_false/none_match/all_match/present) draws its
    conclusion from the rows it was given. On an EMPTY set it has examined nothing, so
    it reports not_run — never pass. Reporting pass there made coverage monotonically
    non-decreasing: it rose when a connector was added and never fell when a control
    broke, and a revoked read scope looked identical to a clean result.

    Count checks were treated as a blanket exception on the grounds that zero is a
    meaningful input to a count. That holds for min_count and not for max_count:

      min_count  "at least one firewall exists", zero rows => the thing that should
                 exist does not. A real fail, kept.
      max_count  "no more than N admins", zero rows => nothing was found to assess,
                 and `0 <= N` is vacuously true. That is the same false green the
                 offender kinds were fixed for: an empty population reported as a
                 satisfied control. It now reports not_run.

    `collect_failed` already separates "could not look" from "looked and saw nothing",
    so this only ever fires on a successful, genuinely empty collection. A resource
    that is itself the offender list (GitHub's members *without* 2FA) declares
    `"empty": "pass"`: there, a successful empty answer is the clean result.

    A count check with a `field` counts only the rows where field/op/value holds
    ("admins", not every user), after `skip_if_field_true`.
    """
    # A check declaring `assert` is in the scope/join/aggregate form; everything
    # else takes the original path unchanged.
    if check.get("assert"):
        return _eval_spec_check(check, rows, collected or {}, collect_failed)

    codes = check.get("controls") or []
    cid = check.get("id", "check")
    title = check.get("title", cid)
    kind = check.get("kind", "present")
    field = check.get("field")
    item_name = check.get("item_name")
    skip_field = check.get("skip_if_field_true")
    skips = [skip_field] if isinstance(skip_field, str) else list(skip_field or [])
    considered = [r for r in rows if not any(r.get(s) for s in skips)]
    # A field the provider leaves out for this caller (GitHub returns an org's 2FA
    # requirement only to owners) cannot be judged; reading it as false would fail
    # every row for a missing permission rather than a missing control.
    unreadable = 0
    if check.get("skip_missing") and field:
        unreadable = sum(1 for r in considered if r.get(field) is None)
        considered = [r for r in considered if r.get(field) is not None]
    findings: List[dict] = []

    if collect_failed:
        return [_finding(codes, cid, "directory", "error",
                         f"{title}: resource could not be collected — not assessed")]

    if kind in ("min_count", "max_count"):
        counted = ([r for r in considered if _op(r.get(field), check.get("op", "truthy"), check.get("value"))]
                   if field else considered)
        n = len(counted)
        what = f"found {n}" + (f" of {len(considered)}" if field else "")
        if kind == "min_count":
            ok = n >= int(check.get("min", 1))
            return [_finding(codes, cid, "directory", "pass" if ok else "fail",
                             f"{title}: {what} (min {check.get('min', 1)})",
                             population=len(rows), tested=len(considered))]
        if not considered and check.get("empty") != "pass":
            return [_finding(codes, cid, "directory", "not_run",
                             f"{title}: no records to assess — not assessed",
                             population=len(rows), tested=0)]
        ok = n <= int(check.get("max", 0))
        for r in (counted if not ok and int(check.get("max", 0)) == 0 else [])[:MAX_FINDINGS]:
            findings.append(_finding(codes, cid, _label(r, item_name), "fail",
                                     check.get("fail_msg", f"{title}: violation")))
        findings.append(_finding(codes, cid, "directory", "pass" if ok else "fail",
                                 f"{title}: {what} (max {check.get('max', 0)})",
                                 population=len(rows), tested=len(considered),
                                 truncated=len(counted) > MAX_FINDINGS if findings else None))
        return findings

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
                                 f"{title}: {len(considered)} present",
                                 population=len(considered), tested=len(considered),
                                 truncated=len(considered) > MAX_FINDINGS))
        return findings
    else:
        return [_finding(codes, cid, "directory", "error", f"{title}: unknown check kind '{kind}'")]

    if not considered:
        return [_finding(codes, cid, "directory", "not_run",
                         f"{title}: no records to assess — not assessed",
                         population=len(rows), tested=0)]

    for r in offenders[:MAX_FINDINGS]:
        findings.append(_finding(codes, cid, _label(r, item_name), "fail",
                                 check.get("fail_msg", f"{title}: violation")))
    # population is every row collected; tested is what survived skip_if_field_true.
    # They differ whenever a check scopes itself, and an assessor asking "of how
    # many?" needs both numbers, not the one that flatters the result.
    findings.append(_finding(codes, cid, "directory",
                             "pass" if not offenders else "fail",
                             f"{title}: {len(offenders)} of {len(considered)} failed",
                             population=len(rows), tested=len(considered),
                             truncated=len(offenders) > MAX_FINDINGS))
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
    notes: Dict[str, str] = {}   # resources collected only in part, and why
    failed: set = set()          # resources whose collection errored
    orphaned: Dict[str, str] = {}  # nested resources whose parent list was empty
    findings: List[dict] = []

    for res in resources:
        name = res.get("name")
        if not name:
            continue
        try:
            collected[name], note = _collect_resource(spec, creds, base, res, collected)
            if note:
                notes[name] = note
        except _NoParents:
            collected[name] = []
            parent = (res.get("for_each") or {}).get("resource", "")
            orphaned[name] = ("could not be collected" if parent in failed
                              else f"no {parent.replace('_', ' ')} were found to look up")
        except _CollectError as e:
            collected[name] = []
            failed.add(name)
            findings.append(_finding(res.get("controls") or [], f"{provider}.{name}", name, "error",
                                     f"Could not collect '{name}' (HTTP {e.status}) — token may lack read scope"))
        except Exception:  # noqa: BLE001 — never break the connector on one resource
            collected[name] = []
            failed.add(name)

    for check in checks:
        resource = check.get("resource")
        rows = collected.get(resource, [])
        if not rows and resource not in collected:
            continue  # resource never declared
        if resource in orphaned:
            findings.append(_finding(check.get("controls") or [], check.get("id", "check"), "directory",
                                     "error" if orphaned[resource] == "could not be collected" else "not_run",
                                     f"{check.get('title', check.get('id'))}: {orphaned[resource]} — not assessed",
                                     population=0, tested=0))
            continue
        try:
            findings.extend(_eval_check(check, rows, resource in failed, collected, notes.get(resource)))
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
    admins = _eval_check({"id": "t.admins", "kind": "max_count", "field": "bot", "op": "truthy", "max": 1,
                          "controls": ["CC6.3"], "title": "Bots"}, rows)
    assert admins[-1]["status"] == "pass" and "found 1 of 3" in admins[-1]["detail"], admins
    assert _with_query("/u?limit=10&x=a%2Cb", {"limit": 100, "cursor": "a+b="}) == "/u?x=a%2Cb&limit=100&cursor=a%2Bb%3D"
    assert _same_site_link("https://api.x.com/v1", "https://evil.com/steal") is None
    assert _same_site_link("https://api.x.com/v1", "/v1/users?page=2") == "https://api.x.com/v1/users?page=2"
    print("evidence_engine self-check: PASS")
