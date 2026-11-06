"""A document suggested for a framework, made in one step and written in full.

The "From a framework" tab of the New document popup lists the documents an organisation needs for a framework (``POST
/governance/documents/ai-suggest-policies``: gap-aware, what the organisation already has or is drafting is left out). Choosing one fills
its title, type and description from the suggestion and asks the person only what Comply Agent cannot know: the owner, the department, the
reviewers and approvers, the review cycle. This module makes the studio session from that: the suggestion as the document's brief (its
title, type, what it covers and the framework controls it answers), the frameworks as references, the organisation's own profile as the
setup (country, type, regulators, as "Fill from organisation" does), the length "Standard" (about 4 to 8 pages, ``setup.LENGTHS``), and the
person's details kept in the session's instructions (``details``, ``signoff``) so that Move to library starts with them. Starting the
whole-document draft is the caller's (``router.create_from_suggestion``), as for ``/sessions/{id}/draft``.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from . import references as refs
from . import service, setup, templates

LENGTH = "standard"                 # about 4 to 8 pages
MAX_FRAMEWORKS = 10
MAX_CONTROLS = 12
DETAIL_KEYS = ("owner_id", "department_id", "classification", "review_cycle_months", "effective_date", "next_review_date", "description")
_MONTHS_TO_CYCLE = {months: name for name, months in setup.REVIEW_CYCLES.items()}


def clean_details(details: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """What the person typed about the document, as the library document will take it: ids as numbers, the rest as short text."""
    out: Dict[str, Any] = {}
    for key in DETAIL_KEYS:
        value = (details or {}).get(key)
        if value in (None, ""):
            continue
        if key in ("owner_id", "department_id", "review_cycle_months"):
            try:
                out[key] = int(value)
            except (TypeError, ValueError):
                continue
        else:
            out[key] = str(value).strip()[:2000]
    return out


def clean_signoff(signoff: Optional[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """The reviewers and approvers chosen: who (a person or a team), nothing else; they are asked when the document is submitted."""
    out: Dict[str, List[Dict[str, Any]]] = {}
    for role in ("reviewers", "approvers"):
        people = []
        for p in (signoff or {}).get(role) or []:
            if not isinstance(p, dict) or not isinstance(p.get("target_id"), int) or not str(p.get("target_type") or "").strip():
                continue
            row = {"target_type": str(p["target_type"])[:20], "target_id": p["target_id"]}
            if str(p.get("display") or "").strip():
                row["display"] = str(p["display"]).strip()[:120]
            people.append(row)
        if people:
            out[role] = people[:20]
    return out


def brief_instructions(description: str, controls: List[str], details: Dict[str, Any], signoff: Dict[str, Any]) -> Dict[str, Any]:
    """The instructions the document starts with: what to cover, the length, and what the person set for the library document."""
    focus = " ".join((description or "").split())
    ids = [c.strip() for c in controls if str(c).strip()][:MAX_CONTROLS]
    if ids:
        focus = (focus + " " if focus else "") + "Answer these requirements of the framework: " + "; ".join(ids) + "."
    out: Dict[str, Any] = {"length": LENGTH}
    if focus:
        out["focus_areas"] = focus[:3000]
    classification = str(details.get("classification") or "").strip().title()
    if classification in setup.CLASSIFICATIONS:
        out["classification"] = classification
    cycle = _MONTHS_TO_CYCLE.get(details.get("review_cycle_months"))
    if cycle:
        out["review_cycle"] = cycle
    if details:
        out["details"] = details
    if signoff:
        out["signoff"] = signoff
    return out


def create(db, user, *, title: str, doc_type: str, description: str = "", framework_ids: Optional[List[int]] = None, controls: Optional[List[str]] = None,
           details: Optional[Dict[str, Any]] = None, signoff: Optional[Dict[str, Any]] = None, parent_document_id: Optional[int] = None) -> Tuple[Any, List[str]]:
    """The studio session for a suggested document, and what could not be attached (a framework that is gone, a licence refusal): the
    document is made either way. Raises ``StudioError`` for a type that cannot be written in full or a missing title."""
    if doc_type not in templates.DOC_TYPES:
        raise service.StudioError("Only a policy, standard, procedure, guideline or charter can be written in full.")
    title = " ".join((title or "").split())[:500]
    if not title:
        raise service.StudioError("Give the document a title.")
    details = clean_details(details)
    note = " ".join((description or "").split())
    if note and "description" not in details:          # what the suggestion says it is for: the library document's description too (Move to library starts with it)
        details["description"] = note[:2000]
    instructions = brief_instructions(description, controls or [], details, clean_signoff(signoff))
    s = service.create_session(db, user, kind="new", title=title, doc_type=doc_type, instructions=instructions)
    # the organisation's own profile as the setup (what "Fill from organisation" sets): the country, its type, the regulators it follows
    defaults = setup.options(db, s).get("defaults") or {}
    fill = {k: defaults[k] for k in ("country", "entity_type", "regulators") if defaults.get(k) and not (s.instructions or {}).get(k)}
    if fill:
        service.update_session(db, s, {"instructions": fill})
    warnings: List[str] = []
    for framework_id in list(dict.fromkeys(int(i) for i in (framework_ids or [])))[:MAX_FRAMEWORKS]:
        try:
            refs.attach(db, s, "framework", source_id=framework_id, scope={"mode": "all"})
        except (refs.ReferenceProblem, service.StudioError) as exc:
            db.rollback()
            warnings.append(str(exc))
    if parent_document_id:           # the document it sits under: read as context while writing, and kept as its parent by Move to library
        try:
            refs.attach(db, s, "parent_document", source_id=int(parent_document_id))
        except (refs.ReferenceProblem, service.StudioError) as exc:
            db.rollback()
            warnings.append(str(exc))
    db.commit()
    return s, warnings
