"""Rules that test a connector's own estate, not only the people it lists.

A review of DigitalOcean that tests one sampled account says nothing about the
droplets, firewalls, keys and databases behind it. A connector rule reads those
resources live (read-only, with the credential the tenant already stored), judges
them with the shared assertion engine the evidence collectors use
(compliance_plugins.runners.assertions) and reports ONE verdict per rule:

    pass            looked at it, it holds
    fail            looked at it, it does not (with the resources that fail)
    not_applicable  nothing was in scope, so there was nothing to judge
    not_run         could not look (not connected, token without the scope)

"Not applicable" and "not run" are never reported as a pass: a rule over zero
firewalls has not shown that firewalls are configured well.

A rule is data (a resource, a scope predicate, an assertion and the SCF controls
it evidences), so a connector's pack is a list, and the tenant's own crosswalk
turns the SCF ids into whichever frameworks they hold.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from sqlalchemy.orm import Session

from ..compliance_plugins.runners.assertions import SpecError, aggregate, select

MAX_FAILURES = 25            # resources listed per failing rule; the count is always complete

PASS, FAIL, NOT_APPLICABLE, NOT_RUN, ERROR = "pass", "fail", "not_applicable", "not_run", "error"


@dataclass(frozen=True)
class ConnectorRule:
    id: str
    connector: str                      # the provider key, which is also the source tag ("digitalocean")
    domain: str                         # the category the library groups it under
    name: str
    severity: str
    resource: str                       # which collected resource it judges
    assertion: Dict[str, Any]           # {"all": pred} | {"none": pred} | {"count": [...]}  (assertions.aggregate)
    scope: Any = None                   # predicate choosing what is judged (assertions.select)
    empty: str = NOT_APPLICABLE         # what an empty scope means: not_applicable | pass | fail
    reads: str = ""                     # what it reads, one line
    trips: str = ""                     # when it fails, one line
    fail_msg: str = ""                  # one failing resource's sentence; {field} reads the resource's own fields
    na_msg: str = ""                    # why nothing was in scope
    item_name: str = "name"             # the field that names a failing resource
    scf: Tuple[str, ...] = ()           # SCF controls it evidences
    fix: str = ""                       # how to put it right


@dataclass
class Resource:
    """One collected resource: its rows, and what could not be read of it."""
    rows: List[Dict[str, Any]] = field(default_factory=list)
    note: Optional[str] = None          # only part of it was read, and why
    error: Optional[str] = None         # none of it was read, and why


Snapshot = Dict[str, Resource]


@dataclass(frozen=True)
class Pack:
    connector: str
    label: str
    collect: Callable[[str], Tuple[Snapshot, Dict[str, Any]]]     # token → (snapshot, what was read)
    rules: Tuple[ConnectorRule, ...]
    token_for: Callable[[Session, int], Optional[str]]
    limits: str = ""                                              # what this connector cannot show, in words


PACKS: Dict[str, Pack] = {}
RULES_BY_ID: Dict[str, ConnectorRule] = {}


def register(pack: Pack) -> Pack:
    PACKS[pack.connector] = pack
    for rule in pack.rules:
        RULES_BY_ID[rule.id] = rule
    return pack


def _load_packs() -> None:
    """Import the packs; each registers itself. Kept lazy so importing this module is free."""
    if PACKS:
        return
    from . import digitalocean_rules  # noqa: F401


def packs() -> Dict[str, Pack]:
    _load_packs()
    return PACKS


def rule(rule_id: str) -> Optional[ConnectorRule]:
    _load_packs()
    return RULES_BY_ID.get(rule_id)


def all_rules() -> List[ConnectorRule]:
    _load_packs()
    return [r for p in PACKS.values() for r in p.rules]


# --------------------------------------------------------------------------- #
# Evaluation — pure: a rule and a snapshot in, a verdict out                    #
# --------------------------------------------------------------------------- #
class _Safe(dict):
    def __missing__(self, key: str) -> str:
        return "?"


def _label(row: Dict[str, Any], key: str) -> str:
    for k in (key, "name", "id", "email"):
        if row.get(k):
            return str(row[k])
    return "resource"


def _sentence(template: str, row: Dict[str, Any]) -> str:
    try:
        return template.format_map(_Safe(row))
    except (ValueError, IndexError):
        return template


def result_base(r: ConnectorRule) -> Dict[str, Any]:
    return {
        "id": r.id, "kind": "connector", "connector": r.connector, "name": r.name, "domain": r.domain,
        "severity": r.severity, "reads": r.reads, "trips": r.trips, "scf": list(r.scf), "fix": r.fix,
        "resource": r.resource,
    }


def unrun(r: ConnectorRule, reason: str, status: str = NOT_RUN) -> Dict[str, Any]:
    return {**result_base(r), "status": status, "reason": reason, "detail": reason,
            "population": 0, "tested": 0, "failed": 0, "passed": 0, "failures": []}


def evaluate(r: ConnectorRule, snapshot: Snapshot, now: Optional[datetime] = None) -> Dict[str, Any]:
    """One rule's verdict over what the snapshot holds."""
    data = snapshot.get(r.resource)
    if data is None:
        return unrun(r, f"{r.resource.replace('_', ' ')} were not collected")
    if data.error:
        return unrun(r, data.error)
    try:
        scoped = select(data.rows, r.scope, now)
        verdict = aggregate(scoped, r.assertion, population=len(data.rows), now=now, empty=r.empty)
    except SpecError as exc:
        return unrun(r, f"The rule is malformed: {exc}", ERROR)

    failures = [{"resource": _label(row, r.item_name),
                 "detail": _sentence(r.fail_msg, row) if r.fail_msg else r.name}
                for row in verdict.offenders[:MAX_FAILURES]]
    status = verdict.status
    if status == NOT_APPLICABLE:
        detail = r.na_msg or "Nothing was in scope, so there was nothing to judge."
    elif status == NOT_RUN:
        detail = "No assertion was declared."
    else:
        detail = verdict.detail
    if data.note:
        detail = f"{detail} ({data.note})"
    failed = len(verdict.offenders) if status == FAIL else 0
    return {**result_base(r), "status": status, "reason": detail if status in (NOT_APPLICABLE, NOT_RUN) else None,
            "detail": detail, "population": verdict.population, "tested": verdict.tested,
            "failed": failed, "passed": max(verdict.tested - failed, 0) if status in (PASS, FAIL) else 0,
            "failures": failures, "truncated": failed > len(failures)}


# --------------------------------------------------------------------------- #
# Running a connector                                                          #
# --------------------------------------------------------------------------- #
def run_connector(tenant_db: Session, tenant_id: int, connector: str,
                  rule_ids: Optional[Iterable[str]] = None) -> Dict[str, Any]:
    """Collect the connector once, then judge every wanted rule against it.

    Never raises: a connector that cannot be read makes its rules not_run with
    the reason, so a review reports the gap instead of failing to run."""
    _load_packs()
    pack = PACKS[connector]
    wanted = set(rule_ids) if rule_ids is not None else None
    rules = [r for r in pack.rules if wanted is None or r.id in wanted]
    out: Dict[str, Any] = {"connector": connector, "label": pack.label, "limits": pack.limits,
                           "ran_at": datetime.utcnow().isoformat(), "connected": False, "read": {}}
    token = None
    try:
        token = pack.token_for(tenant_db, tenant_id)
    except Exception:  # noqa: BLE001 — a broken credential row must not stop the review
        token = None
    if not token:
        out["results"] = [unrun(r, f"{pack.label} is not connected, so this rule could not be tested") for r in rules]
        return out
    out["connected"] = True
    try:
        snapshot, read = pack.collect(token)
    except Exception as exc:  # noqa: BLE001
        out["results"] = [unrun(r, f"{pack.label} could not be read ({type(exc).__name__})") for r in rules]
        return out
    out["read"] = read
    out["results"] = [evaluate(r, snapshot) for r in rules]
    return out


def run_rules(tenant_db: Session, tenant_id: int, rule_ids: Iterable[str]) -> List[Dict[str, Any]]:
    """Run the connector rules among `rule_ids`, one collection per connector. Returns their results."""
    _load_packs()
    by_connector: Dict[str, List[str]] = {}
    for rid in rule_ids:
        r = RULES_BY_ID.get(rid)
        if r is not None:
            by_connector.setdefault(r.connector, []).append(rid)
    results: List[Dict[str, Any]] = []
    for connector, ids in by_connector.items():
        results.extend(run_connector(tenant_db, tenant_id, connector, ids)["results"])
    return results


def connected(tenant_db: Session, tenant_id: int, connector: str) -> bool:
    """Whether a credential for this connector is on file (no network call)."""
    _load_packs()
    pack = PACKS.get(connector)
    if pack is None:
        return False
    try:
        return bool(pack.token_for(tenant_db, tenant_id))
    except Exception:  # noqa: BLE001
        return False
