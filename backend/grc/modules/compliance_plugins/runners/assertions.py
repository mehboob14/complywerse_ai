"""Scope, predicates and aggregation for declarative checks.

The engine could express one thing: "apply a single field comparison to every row
of one resource". That covers configuration questions and nothing else. The
shapes a real control library needs are, in rough order of how often they appear
across SCF's 1,381 Technology objectives:

    RESOURCE     is this one thing configured correctly
    POPULATION   does every member of a set satisfy it
    TEMPORAL     is it recent enough, did it happen in the right order
    EVENT        did the required thing happen before the other thing
    CORRELATION  join two systems and compare

This module adds the three layers those need, each independently useful:

    scope       a predicate that selects the population before anything is judged
    predicate   a tree, so a population can be "active AND NOT a service account"
    aggregate   ALL / ANY / NONE / COUNT / RATIO over the selected rows

Nothing here knows about HTTP, connectors or controls. It takes rows of dicts and
returns a verdict, which is what makes it testable without a network or a tenant.

The verdict vocabulary is deliberately four values, not two:

    pass / fail        we looked and we know
    not_applicable     the scope selected nobody, so there was nothing to judge
    not_run            we could not look

`not_applicable` is the one the old engine could not say, and its absence is why
an empty population read as a satisfied control.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

class SpecError(ValueError):
    """A malformed check spec. Raised rather than evaluated to False, because a
    predicate that silently fails every row reports the whole population as
    offending and is indistinguishable from a real, total failure."""


# ── durations ────────────────────────────────────────────────────────────────
# "15d", "90d", "12mo", "1y", "36h". Written the way a control writes them, so a
# spec author transcribes the standard rather than converting to seconds.
_DUR = re.compile(r"^\s*(\d+)\s*(h|d|w|mo|y)\s*$", re.I)
_DUR_DAYS = {"h": 1 / 24, "d": 1, "w": 7, "mo": 30, "y": 365}


def parse_duration(v: Any) -> Optional[timedelta]:
    if isinstance(v, timedelta):
        return v
    if isinstance(v, (int, float)):
        return timedelta(days=float(v))
    m = _DUR.match(str(v or ""))
    if not m:
        return None
    return timedelta(days=int(m.group(1)) * _DUR_DAYS[m.group(2).lower()])


# ── timestamps ───────────────────────────────────────────────────────────────
# Providers return ISO 8601 in a dozen dialects. A timestamp that cannot be
# parsed must not silently become "very old" and manufacture a finding, so
# parsing failure returns None and every temporal op treats None as unknown.
_ISO_Z = re.compile(r"Z$", re.I)


def parse_time(v: Any) -> Optional[datetime]:
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, (int, float)):          # epoch seconds
        try:
            return datetime.fromtimestamp(float(v), tz=timezone.utc)
        except (OSError, ValueError, OverflowError):
            return None
    s = str(v or "").strip()
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(_ISO_Z.sub("+00:00", s))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


# ── field access ─────────────────────────────────────────────────────────────
def _field(row: Dict[str, Any], expr: str, ctx: Optional[Dict[str, Any]] = None) -> Any:
    """A field reference.

    Prefixes, matching the `!` / `len:` / `bool:` style the collector already uses:
        date:x      parse x as a timestamp
        joined:x    read x from the row this one was joined to
    `{{row.x}}` reads an explicitly supplied context, which is how a nested
    `exists` predicate refers back to its outer row.
    """
    if not isinstance(expr, str):
        return expr
    if expr.startswith("{{row.") and expr.endswith("}}"):
        return (ctx or {}).get(expr[6:-2])
    if expr.startswith("joined:"):
        # After a join the counterpart lives on the row. Without this a
        # correlation could only ask "did it match", never "does the matched
        # record agree", which is half of what correlation is for.
        j = row.get("_joined") or {}
        name = expr[7:]
        if name.startswith("date:"):
            return parse_time(j.get(name[5:]))
        return j.get(name)
    if expr.startswith("date:"):
        return parse_time(row.get(expr[5:]))
    return row.get(expr)


def _value(v: Any, row: Dict[str, Any], ctx: Optional[Dict[str, Any]]) -> Any:
    """A value position may reference the row or the joined row."""
    if isinstance(v, str) and v.startswith("{{row.") and v.endswith("}}"):
        return (ctx or {}).get(v[6:-2])
    if isinstance(v, str) and v.startswith("{{self.") and v.endswith("}}"):
        return row.get(v[7:-2])
    return v


# ── operators ────────────────────────────────────────────────────────────────
def _cmp(a: Any, b: Any, fn) -> bool:
    try:
        return a is not None and fn(a, b)
    except TypeError:
        return False


def evaluate_op(a: Any, op: str, b: Any = None, now: Optional[datetime] = None) -> bool:
    """One comparison. Unknown operator is False, never an exception."""
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
        return _cmp(a, b, lambda x, y: x > y)
    if op == "lt":
        return _cmp(a, b, lambda x, y: x < y)
    if op == "gte":
        return _cmp(a, b, lambda x, y: x >= y)
    if op == "lte":
        return _cmp(a, b, lambda x, y: x <= y)
    if op == "matches":
        try:
            return bool(re.search(str(b), str(a))) if a is not None else False
        except re.error:
            return False
    if op == "truthy":
        return bool(a)
    if op == "falsy":
        return not bool(a)

    # temporal. `a` is a timestamp; an unparseable one is unknown, and unknown
    # must not read as a violation — that would invent findings from bad data.
    if op in ("within", "older_than", "before", "after"):
        t = parse_time(a)
        if t is None:
            return False
        ref = now or datetime.now(timezone.utc)
        if op in ("within", "older_than"):
            d = parse_duration(b)
            if d is None:
                return False
            age = ref - t
            return age <= d if op == "within" else age > d
        other = parse_time(b)
        if other is None:
            return False
        return t < other if op == "before" else t > other
    return False


# ── predicates ───────────────────────────────────────────────────────────────
def evaluate_predicate(node: Any, row: Dict[str, Any],
                       ctx: Optional[Dict[str, Any]] = None,
                       now: Optional[datetime] = None) -> bool:
    """A predicate tree over one row.

    Leaf:   ["field", "op"]  or  ["field", "op", value]
    Nodes:  {"and": [...]} {"or": [...]} {"not": node}
            {"exists": {"in": "<list field>", "where": node}}
    """
    if node is None:
        return True
    if isinstance(node, list):
        if len(node) == 2:
            return evaluate_op(_field(row, node[0], ctx), node[1], None, now)
        if len(node) == 3:
            return evaluate_op(_field(row, node[0], ctx), node[1],
                               _value(node[2], row, ctx), now)
        # A malformed leaf must not evaluate to False. False for every row means
        # every row is an offender, so a typo in a spec would manufacture a
        # finding against the entire population and look like a real failure.
        raise SpecError(f"predicate leaf must be [field, op] or [field, op, value], got {node!r}")
    if isinstance(node, dict):
        if not node:
            raise SpecError("empty predicate node")
        if "and" in node:
            return all(evaluate_predicate(n, row, ctx, now) for n in node["and"])
        if "or" in node:
            return any(evaluate_predicate(n, row, ctx, now) for n in node["or"])
        if "not" in node:
            return not evaluate_predicate(node["not"], row, ctx, now)
        if "exists" in node:
            spec = node["exists"] or {}
            items = row.get(spec.get("in")) or []
            if not isinstance(items, list):
                return False
            inner = spec.get("where")
            return any(evaluate_predicate(inner, i if isinstance(i, dict) else {"value": i},
                                          row, now) for i in items)
        raise SpecError(f"unknown predicate node: {sorted(node)!r}")
    raise SpecError(f"predicate must be a list or dict, got {type(node).__name__}")


def select(rows: List[Dict[str, Any]], scope: Any = None,
           now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    """The population a check judges. This is the step that was missing.

    Nearly every wrong answer in compliance automation is a scope error: the
    right assertion applied to the wrong set. "All laptops are encrypted" is a
    different claim from "all devices are encrypted" when the fleet includes
    phones and servers.
    """
    if scope is None:
        return list(rows)
    return [r for r in rows if evaluate_predicate(scope, r, None, now)]


# ── joins ────────────────────────────────────────────────────────────────────
def join_rows(left: List[Dict[str, Any]], right: List[Dict[str, Any]],
              on: Tuple[str, str], *, normalize: bool = True) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Left-join two populations on a key. Returns (matched, unmatched_left).

    Correlation is the shape behind offboarding, EDR coverage and change
    approval: one system defines who should be there, another says what is
    actually true of them. `unmatched_left` is the interesting half — the
    terminated employee with no matching disabled account, the device in the
    inventory with no agent.

    Keys are normalized by default because they cross systems that disagree
    about case and domain. A fuzzy key that half-matches manufactures findings,
    so callers should check the match rate before trusting `unmatched_left`.
    """
    lk, rk = on

    def key(v: Any) -> str:
        s = str(v or "").strip()
        return s.lower() if normalize else s

    index: Dict[str, Dict[str, Any]] = {}
    for r in right:
        k = key(r.get(rk))
        if k:
            index.setdefault(k, r)
    matched, unmatched = [], []
    for l in left:
        k = key(l.get(lk))
        hit = index.get(k) if k else None
        if hit is None:
            unmatched.append(l)
        else:
            matched.append({**l, "_joined": hit})
    return matched, unmatched


# ── aggregation ──────────────────────────────────────────────────────────────
class Verdict:
    """A judged population: the status plus the arithmetic behind it."""

    __slots__ = ("status", "population", "tested", "offenders", "detail")

    def __init__(self, status: str, population: int, tested: int,
                 offenders: List[Dict[str, Any]], detail: str):
        self.status = status
        self.population = population
        self.tested = tested
        self.offenders = offenders
        self.detail = detail

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Verdict {self.status} {self.tested}/{self.population} {self.detail}>"


def aggregate(rows: List[Dict[str, Any]], spec: Dict[str, Any], *,
              population: Optional[int] = None,
              ctx: Optional[Dict[str, Any]] = None,
              now: Optional[datetime] = None,
              empty: str = "not_applicable") -> Verdict:
    """Judge a selected population.

        {"all":  <pred>}                every row satisfies it
        {"any":  <pred>}                at least one does          (EXISTS)
        {"none": <pred>}                no row does
        {"count": ["gte", 1, <pred?>]}  how many satisfy it        (THRESHOLD)
        {"ratio": ["gte", 0.95, <pred>]} what share satisfy it

    `empty` decides what an empty population means, and it is the caller's
    decision rather than the engine's guess. "No public buckets" over zero
    buckets is not_applicable; "at least one backup exists" over zero backups is
    a fail. Only the author of the check knows which.
    """
    pop = population if population is not None else len(rows)
    n = len(rows)
    if not rows:
        return Verdict(empty, pop, 0, [], "no records in scope — nothing assessed")

    if "all" in spec or "none" in spec:
        want = "all" in spec
        pred = spec.get("all") if want else spec.get("none")
        bad = [r for r in rows
               if evaluate_predicate(pred, r, ctx, now) is not want]
        return Verdict("pass" if not bad else "fail", pop, n, bad,
                       f"{len(bad)} of {n} failed")
    if "any" in spec:
        hits = [r for r in rows if evaluate_predicate(spec["any"], r, ctx, now)]
        return Verdict("pass" if hits else "fail", pop, n, [] if hits else rows,
                       f"{len(hits)} of {n} matched")
    if "count" in spec:
        op, val, *rest = spec["count"]
        pred = rest[0] if rest else None
        hits = [r for r in rows if evaluate_predicate(pred, r, ctx, now)] if pred else rows
        ok = evaluate_op(len(hits), op, val)
        return Verdict("pass" if ok else "fail", pop, n, [] if ok else hits,
                       f"count {len(hits)} {op} {val}")
    if "ratio" in spec:
        op, val, pred = spec["ratio"]
        hits = [r for r in rows if evaluate_predicate(pred, r, ctx, now)]
        share = len(hits) / n
        ok = evaluate_op(share, op, val)
        return Verdict("pass" if ok else "fail", pop, n,
                       [r for r in rows if r not in hits] if not ok else [],
                       f"{len(hits)}/{n} = {share:.0%} {op} {val:.0%}")
    return Verdict("not_run", pop, n, [], "no aggregation declared")
