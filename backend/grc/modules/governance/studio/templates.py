"""The templates of the studio and the structure each kind of document must have.

The built-in templates are generated from the drafting scaffolds (``ai_drafting/scaffolds.py``: the sections each document
type needs, in order), so the structure the studio enforces is the structure the platform already drafts. A tenant can
save any document as its own template, and mark it the default for a document type; that one is then used instead of the
built-in one. A template holds the Markdown skeleton and the ``structure`` (the required sections) checks use.

``structure`` = ``{"sections": [{"key", "title", "aliases", "required", "min_words"}], "title_required": True}``.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from ..ai_drafting import scaffolds

DOC_TYPES = ("policy", "standard", "procedure", "guideline", "charter")

_ALIASES = {
    "document description": ["document control", "document information", "document details", "document summary"],
    "approval signoff": ["approval", "approvals", "sign-off", "sign off", "signoff", "approval sign-off"],
    "purpose": ["objective", "objectives", "aim", "introduction", "purpose and intended audience", "purpose and authority"],
    "scope and applicability": ["scope", "applicability", "scope and triggers", "scope and mandate"],
    "scope": ["scope and applicability", "applicability"],
    "roles and responsibilities": ["responsibilities", "roles", "raci", "roles & responsibilities"],
    "policy statements": ["policy requirements", "requirements", "statements", "policy"],
    "mandatory requirements": ["requirements", "standard requirements"],
    "compliance and enforcement": ["compliance", "enforcement", "non-compliance", "compliance monitoring"],
    "exception handling": ["exceptions", "exception management", "exceptions and escalation"],
    "exceptions": ["exception handling", "exception management"],
    "review and maintenance": ["review", "maintenance", "review and revision", "document review", "review and amendment"],
    "related documents and references": ["references", "related documents", "related policies", "normative references"],
    "revision history": ["version history", "change history", "document history", "document revision history"],
    "definitions and acronyms": ["definitions", "glossary", "terms and definitions", "abbreviations", "acronyms"],
    "governance and oversight": ["governance", "oversight"],
    "procedure steps": ["procedure", "steps", "process steps", "process"],
}

_DESCRIPTION_ROWS = [("Document Title", "[[Document title]]"), ("Document Owner", "[[Owner name and role]]"),
                     ("Document Classification", "[[Classification, for example Internal]]"), ("Version", "1.0"),
                     ("Effective Date", "[[Effective date]]"), ("Next Review Date", "[[Next review date]]"),
                     ("Approval Authority", "[[Approving body or role]]"), ("Distribution Scope", "[[Who receives this document]]")]


def is_annex(title: str) -> bool:
    return bool(re.match(r"^\s*(?:\d+(?:\.\d+)*[.)]?\s+)?annex\b", title or "", re.I))


def key_of(title: str) -> str:
    """``"7. Policy Statements"`` and ``"Annex A — Revision History"`` -> ``policy statements`` / ``revision history``."""
    t = re.sub(r"^\s*(annex\s+[a-z0-9]+\s*[-–—:]?\s*|\d+(?:\.\d+)*[.)]?\s+|[a-z][.)]\s+)", "", (title or "").strip(), flags=re.I)
    return re.sub(r"\s+", " ", t.replace("&", "and")).strip(" .:-–—").lower()


def _guidance(spec) -> str:
    first = re.split(r"(?<=[.!?])\s+", " ".join(spec.expansion_focus.split()))[0].strip()
    return first[:220] if first else "Describe this section."


def _section_body(spec, scaffold) -> str:
    key = key_of(spec.heading)
    if key == "document description":
        rows = [["Field", "Value"]] + [[k, v] for k, v in _DESCRIPTION_ROWS]
        return _table(rows)
    if key == "approval signoff":
        rows = [["Role", "Name", "Designation", "Signature / Date"]] + [
            [t.label, "[[Name]]", t.role_hint, "___________________"] for t in scaffold.approval_matrix]
        return _table(rows)
    if key == "revision history":
        return _table([["Version", "Date", "Author", "Summary of change"], ["1.0", "[[Date]]", "[[Author]]", "Initial version"]])
    if key == "definitions and acronyms":
        return _table([["Term", "Definition"], ["[[Term]]", "[[Definition]]"]])
    if "raci" in key or "matrix" in key:
        return _table([["Activity", "Responsible", "Accountable", "Consulted", "Informed"], ["[[Activity]]", "[[Role]]", "[[Role]]", "[[Role]]", "[[Role]]"]])
    if "roster" in key:
        return _table([["Member", "Role on the committee", "Title"], ["[[Name]]", "[[Role]]", "[[Title]]"]])
    if spec.min_clauses:
        return "\n".join(f"{n}. [[Clause {n}: one obligation, using \"shall\" or \"must\".]]" for n in (1, 2, 3))
    return f"[[{_guidance(spec)}]]"


def _table(rows: List[List[str]]) -> str:
    from .blocks import table_markdown

    return table_markdown(rows)


def structure_of(scaffold) -> Dict[str, Any]:
    sections = []
    for spec in scaffold.mandatory_sections:
        key = key_of(spec.heading)
        annex = spec.full_heading.strip().lower().startswith("annex")
        sections.append({"key": key, "title": re.sub(r"^\s*(\d+(?:\.\d+)*[.)]?\s+)", "", spec.full_heading), "aliases": _ALIASES.get(key, []),
                         "required": not annex, "annex": annex, "min_words": max(15, spec.min_words // 6)})
    return {"sections": sections, "title_required": True}


def skeleton(scaffold, title: str = "[[Document title]]") -> str:
    parts = [f"# {title}"]
    for spec in scaffold.mandatory_sections:
        parts.append(f"## {spec.full_heading}")
        parts.append(_section_body(spec, scaffold))
    return "\n\n".join(parts) + "\n"


def builtin(doc_type: str) -> Dict[str, Any]:
    scaffold = scaffolds.get_scaffold(doc_type)
    return {"id": f"builtin:{scaffold.doc_type}", "name": f"{scaffold.label} (standard structure)", "doc_type": scaffold.doc_type,
            "description": f"The standard sections of a {scaffold.label.lower()}: document description, approval sign-off, "
                           f"{', '.join(key_of(s.heading) for s in scaffold.mandatory_sections[2:6])} and more.",
            "content": skeleton(scaffold), "structure": structure_of(scaffold), "builtin": True, "is_default": True}


def builtins() -> List[Dict[str, Any]]:
    return [builtin(t) for t in DOC_TYPES]


def blank(title: str = "") -> Dict[str, Any]:
    return {"id": "builtin:blank", "name": "Blank document", "doc_type": "other", "description": "An empty document: no structure is enforced.",
            "content": f"# {title}\n" if title else "", "structure": None, "builtin": True, "is_default": False}


def serialize(row) -> Dict[str, Any]:
    return {"id": f"tenant:{row.id}", "name": row.name, "doc_type": row.doc_type, "description": row.description or "", "content": row.content or "",
            "structure": row.structure, "builtin": False, "is_default": bool(row.is_default),
            "updated_at": row.updated_at.isoformat() if row.updated_at else None}


def listing(db) -> List[Dict[str, Any]]:
    """Built-in templates (each replaced by the tenant's own default for its type, if one is set) and the tenant's templates."""
    from ....models import StudioTemplate

    rows = db.query(StudioTemplate).filter(StudioTemplate.archived.is_(False)).order_by(StudioTemplate.name).all()
    overridden = {r.doc_type for r in rows if r.is_default}
    out = [dict(t, replaced_by_default=t["doc_type"] in overridden) for t in builtins()] + [blank()]
    return out + [serialize(r) for r in rows]


def resolve(db, template_id: Optional[str], doc_type: str = "policy") -> Optional[Dict[str, Any]]:
    """The template to start a document from. ``None``/``"default"`` = the tenant's default for the type, else the built-in."""
    from ....models import StudioTemplate

    if template_id and template_id.startswith("tenant:"):
        row = db.get(StudioTemplate, int(template_id.split(":", 1)[1]))
        return serialize(row) if row and not row.archived else None
    if template_id == "builtin:blank":
        return blank()
    if template_id and template_id.startswith("builtin:"):
        return builtin(template_id.split(":", 1)[1])
    row = (db.query(StudioTemplate).filter(StudioTemplate.doc_type == doc_type, StudioTemplate.is_default.is_(True),
                                           StudioTemplate.archived.is_(False)).order_by(StudioTemplate.id.desc()).first())
    if row:
        return serialize(row)
    return builtin(doc_type) if doc_type in DOC_TYPES else None


def structure_for(db, doc_type: str, template_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """The required sections for a document: those of its template when it has one with a structure, else its type's."""
    template = resolve(db, template_id, doc_type)
    return (template or {}).get("structure") or (builtin(doc_type)["structure"] if doc_type in DOC_TYPES else None)


def derive_structure(markdown: str) -> Dict[str, Any]:
    """The structure of a document being saved as a template: its headings (level 2), each required."""
    from . import blocks as B

    sections = []
    for b in B.parse(markdown):
        if b.kind == "heading" and b.level == 2:
            key = key_of(b.text)
            sections.append({"key": key, "title": re.sub(r"^\s*(\d+(?:\.\d+)*[.)]?\s+)", "", b.text), "aliases": _ALIASES.get(key, []),
                             "required": True, "annex": is_annex(b.text), "min_words": 10})
    return {"sections": sections, "title_required": True}
