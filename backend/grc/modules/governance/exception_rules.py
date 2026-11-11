"""Who reviews and approves a policy exception: the rules, as pure functions (DECISIONS D58; no database, so tests need none).

A **rule** applies to the whole organisation or to one department at any level (and to everything under it), optionally only to
some priorities, some kinds of policy or some exception types (the organisation's own list, Governance > Settings), and has
**steps**: each a Review or an Approval, asking named people, roles, "the owner of
the unit" or "the owner of its parent", all at once or one after another, everyone / any one / at least N, with days to act and
whether the step may reject or ask for changes. The last step is an approval: somebody decides. Who carries the exception out once it is approved (the
**implementer**, D62) is not the rule's to say: the person raising the exception chooses it for that exception (D67); ``validate_implementer`` and
``implementer_problems`` below are the checks of what they chose.

The vocabulary is the document route engine's (``routes.py``: orders together / in_turn, rules all / any / at_least); the tables
are not (that engine is welded to documents, signatures and holds).

**Which rule applies:** of the active rules that fit (unit is the exception's unit or above it; priority, policy kind and
exception type fit when the rule names any), the most specific wins: the deepest unit, then the rule that names more conditions, then the oldest
rule. A rule for a department therefore covers its sub-departments until one of them has its own.

A step's **slots** are what it asks, one per named person / role / owner, each with the people who may answer for it (resolved when
the step opens, with the requester taken out: nobody decides their own exception). **Done:** ``all`` every slot has an approval from
one of its people; ``any`` one slot does; ``at_least`` N different people approved. One-after-another steps ask the first open slot only.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from .routes import ORDERS, RULES

PRIORITIES = ("low", "medium", "high", "critical")
KINDS = ("review", "approval")
KIND_NAME = {"review": "Review", "approval": "Approval"}
PEOPLE_TYPES = ("user", "role", "unit_owner", "parent_owner")
MAX_STEPS = 8
NAME_MAX = 120
IMPLEMENTER_NAME = "Implementation"
DECISIONS = ("approve", "reject", "changes")
RUN_STATUSES = ("open", "approved", "rejected", "changes_requested", "withdrawn")


# ── writing a rule ───────────────────────────────────────────────────────────
def _person(i: int, name: str, raw: Any, where: Optional[str] = None) -> Tuple[str, Optional[int]]:
    where = where or f"Step {i} ({name})"
    kind = (raw or {}).get("type")
    if kind not in PEOPLE_TYPES:
        raise ValueError(f"{where}: choose a person, a role or an owner to ask.")
    if kind in ("unit_owner", "parent_owner"):
        return kind, None
    try:
        ref = int(raw.get("id"))
    except (TypeError, ValueError):
        ref = 0
    if ref < 1:
        raise ValueError(f"{where}: choose who is asked.")
    return kind, ref


def validate_steps(steps_in: Optional[Sequence[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """The steps of a rule as saved: kinds, orders and rules checked, defaults filled. Raises ValueError with a sentence."""
    steps_in = list(steps_in or [])
    if not steps_in:
        raise ValueError("A rule needs at least one step.")
    if len(steps_in) > MAX_STEPS:
        raise ValueError(f"A rule has at most {MAX_STEPS} steps.")
    out: List[Dict[str, Any]] = []
    for i, s in enumerate(steps_in, start=1):
        s = s or {}
        kind = s.get("kind") or "review"
        if kind not in KINDS:
            raise ValueError(f"Step {i}: choose whether it is a review or an approval.")
        name = (s.get("name") or "").strip()[:NAME_MAX] or KIND_NAME[kind]
        order = s.get("order") or "together"
        if order not in ORDERS:
            raise ValueError(f"Step {i} ({name}): choose whether its people are asked together or one after another.")
        rule = "all" if order == "in_turn" else (s.get("rule") or "all")
        if rule not in RULES:
            raise ValueError(f"Step {i} ({name}): choose who has to decide.")
        people = list(dict.fromkeys(_person(i, name, p) for p in (s.get("people") or [])))
        if not people:
            raise ValueError(f"Step {i} ({name}): choose who is asked.")
        min_count = None
        if rule == "at_least":
            try:
                min_count = int(s.get("min_count") or 0)
            except (TypeError, ValueError):
                min_count = 0
            if min_count < 1 or min_count > len(people):
                raise ValueError(f"Step {i} ({name}): at least how many have to decide? A number from 1 to {len(people)}.")
        due = s.get("due_days")
        if due in (None, ""):
            due = None
        else:
            try:
                due = int(due)
            except (TypeError, ValueError):
                raise ValueError(f"Step {i} ({name}): the days to act must be a number.") from None
            if not 1 <= due <= 365:
                raise ValueError(f"Step {i} ({name}): the days to act must be from 1 to 365.")
        out.append({
            "position": i, "name": name, "kind": kind, "order": order, "rule": rule, "min_count": min_count, "due_days": due,
            "allow_changes": s.get("allow_changes") is not False,
            "allow_reject": (kind == "approval") if s.get("allow_reject") is None else bool(s.get("allow_reject")),
            "people": [{"type": t, **({"id": ref} if ref is not None else {})} for t, ref in people],
        })
    if out[-1]["kind"] != "approval":
        raise ValueError("The last step has to be an approval: somebody decides.")
    return out


def validate_implementer(raw: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The implementer of an exception as saved, or None when it has none (nothing given, or an empty block). Who carries the exception out
    after the last approval: people, roles, the owner of the unit or of its parent, any one of whom can; days to implement. Raises ValueError."""
    raw = raw or {}
    given = raw.get("people") or []
    if not given and raw.get("due_days") in (None, "") and not str(raw.get("name") or "").strip():
        return None
    name = str(raw.get("name") or "").strip()[:NAME_MAX] or IMPLEMENTER_NAME
    where = f"Implementer ({name})"
    people = list(dict.fromkeys(_person(0, name, p, where) for p in given))
    if not people:
        raise ValueError(f"{where}: choose who carries it out.")
    due = raw.get("due_days")
    if due in (None, ""):
        due = None
    else:
        try:
            due = int(due)
        except (TypeError, ValueError):
            raise ValueError(f"{where}: the days to implement must be a number.") from None
        if not 1 <= due <= 365:
            raise ValueError(f"{where}: the days to implement must be from 1 to 365.")
    return {"name": name, "due_days": due, "people": [{"type": t, **({"id": ref} if ref is not None else {})} for t, ref in people]}


def clean_conditions(priorities: Optional[Iterable[Any]], doc_types: Optional[Iterable[Any]]) -> Tuple[List[str], List[str]]:
    """The priorities and policy kinds a rule is limited to ([] = any). Raises ValueError with a sentence."""
    pri = list(dict.fromkeys(str(p).strip().lower() for p in (priorities or []) if str(p).strip()))
    bad = [p for p in pri if p not in PRIORITIES]
    if bad:
        raise ValueError(f"'{bad[0]}' is not a priority: choose from {', '.join(PRIORITIES)}.")
    types = list(dict.fromkeys(str(t).strip().lower()[:50] for t in (doc_types or []) if str(t).strip()))
    return pri, types


def clean_types(values: Optional[Iterable[Any]]) -> List[str]:
    """The exception types a rule is limited to ([] = any): values of the organisation's list (module_settings, ``governance_exceptions``)."""
    return list(dict.fromkeys(str(v).strip()[:80] for v in (values or []) if str(v).strip()))


def clean_name(name: Any) -> str:
    name = str(name or "").strip()
    if not name:
        raise ValueError("A rule needs a name.")
    if len(name) > NAME_MAX:
        raise ValueError(f"A rule's name is at most {NAME_MAX} characters.")
    return name


# ── which rule applies ───────────────────────────────────────────────────────
def applies(rule: Dict[str, Any], unit_path: Sequence[int], priority: Optional[str], doc_type: Optional[str],
            exception_type: Optional[str] = None) -> bool:
    """Whether the rule fits an exception raised for a unit whose chain (the unit and the departments above it) is ``unit_path``."""
    if not rule.get("is_active", True):
        return False
    where = rule.get("department_id")
    if where is not None and where not in unit_path:
        return False
    priorities = rule.get("priorities") or []
    if priorities and (priority or "").strip().lower() not in priorities:
        return False
    types = rule.get("doc_types") or []
    if types and (doc_type or "").strip().lower() not in types:
        return False
    kinds = rule.get("exception_types") or []
    if kinds and (exception_type or "").strip() not in kinds:
        return False
    return True


def specificity(rule: Dict[str, Any], level_of: Callable[[int], int]) -> Tuple[int, int]:
    """(how deep its unit is - 0 for the whole organisation -, how many conditions it names)."""
    where = rule.get("department_id")
    return (level_of(where) if where is not None else 0,
            (1 if rule.get("priorities") else 0) + (1 if rule.get("doc_types") else 0) + (1 if rule.get("exception_types") else 0))


def pick(rules: Iterable[Dict[str, Any]], unit_path: Sequence[int], priority: Optional[str], doc_type: Optional[str],
         level_of: Callable[[int], int], exception_type: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """The rule that applies, or None (then the exception follows the older flow)."""
    fits = [r for r in rules if applies(r, unit_path, priority, doc_type, exception_type)]
    return max(fits, key=lambda r: (*specificity(r, level_of), -int(r.get("id") or 0)), default=None)


# ── a step while an exception is in it ───────────────────────────────────────
def required_slots(step: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The slots somebody can answer for; when none can, all of them (the step then waits, and a submission is refused first)."""
    slots = step.get("slots") or []
    return [s for s in slots if s.get("members")] or list(slots)


def _answered(slot: Dict[str, Any], approvers: Set[int]) -> bool:
    return bool(set(slot.get("members") or []) & approvers)


def step_done(step: Dict[str, Any], approvers: Set[int]) -> bool:
    req = required_slots(step)
    if not req:
        return False
    if step.get("rule") == "any":
        return any(_answered(s, approvers) for s in req)
    if step.get("rule") == "at_least":
        people = set().union(*(set(s.get("members") or []) for s in req))
        return len(approvers & people) >= max(1, min(step.get("min_count") or 1, len(people) or 1))
    return all(_answered(s, approvers) for s in req)


def asked_now(step: Dict[str, Any], approvers: Set[int]) -> List[int]:
    """Who may decide at this step now: one after another, the people of the first slot not yet answered; all at once, everyone of
    every slot not yet answered; people who already approved here are not asked again."""
    req = [s for s in required_slots(step) if s.get("members")]
    if step.get("rule") == "at_least":
        return sorted(set().union(*(set(s["members"]) for s in req)) - approvers) if req else []
    open_ = [s for s in req if not _answered(s, approvers)]
    if step.get("order") == "in_turn":
        open_ = open_[:1]
    return sorted(set().union(*(set(s["members"]) for s in open_)) - approvers) if open_ else []


def progress(step: Dict[str, Any], approvers: Set[int]) -> Dict[str, int]:
    """How many have answered of how many the step needs."""
    req = required_slots(step)
    if step.get("rule") == "at_least":
        people = set().union(*(set(s.get("members") or []) for s in req)) if req else set()
        need = max(1, min(step.get("min_count") or 1, len(people) or 1))
        return {"required": need, "answered": min(len(approvers & people), need)}
    need = 1 if step.get("rule") == "any" else len(req)
    return {"required": need, "answered": min(sum(1 for s in req if _answered(s, approvers)), need)}


def implementer_problems(implementer: Optional[Dict[str, Any]], unit_name: Optional[str] = None) -> List[str]:
    """What stops an exception's implementer from working for its unit: nobody who can act (``implementer`` carries its resolved ``slots``)."""
    if not implementer:
        return []
    slots = implementer.get("slots") or []
    if any(s.get("members") for s in slots):
        return []
    what = ", ".join(s.get("label") or "someone" for s in slots) or "nobody"
    return [f"The implementer ({implementer.get('name') or IMPLEMENTER_NAME}) has nobody who can act: {what}" + (f" for {unit_name}" if unit_name else "") + "."]


def problems(steps: Sequence[Dict[str, Any]], unit_name: Optional[str] = None) -> List[str]:
    """What stops a rule from working for a unit: a step with nobody who can decide (the steps carry their resolved ``slots``)."""
    out = []
    for step in steps:
        slots = step.get("slots") or []
        if any(s.get("members") for s in slots):
            continue
        what = ", ".join(s.get("label") or "someone" for s in slots) or "nobody"
        out.append(f"Step {step['position']} ({step['name']}) has nobody who can decide: {what}"
                   + (f" for {unit_name}" if unit_name else "") + ".")
    return out
