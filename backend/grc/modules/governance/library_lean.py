"""The Documents library's complete load: ``GET /governance/documents?lean=1`` (design note G4_library_api_design.md, step 2).

The library draws its rows, live facet counts, drawer summary and exports from the whole list, so it needs every document of the
organisation in ONE request and none of the weight a list of full documents carries (the text, two queries per row). A lean row is
the 32 keys of ``serialize_document`` that the library reads, the same names and values, plus ``attestation``; ``content``,
``tenant_id``, ``doc_sub_type``, ``last_reviewed_by``, ``approved_by``, ``published_by``, ``policy_statement_count`` and
``workflow_instance`` are left out. Who sees which document is the full list's rule, not a second one: the query is the full list's
query (``routers/documents.py``) with its columns swapped for these, and the file fields of a document on its way are served from
the version in force exactly as ``_serve_in_force`` does.

Also here, because both lists use them: ``in_force_rows`` (``permissions.in_force_row`` for a whole page) and ``chunks``.

This module must not import ``routers/documents.py`` (it imports this one).
"""
import json
from typing import Any, Dict, Iterable, Iterator, List, Optional, Sequence

from fastapi.responses import JSONResponse
from sqlalchemy import Text, cast, func, or_
from sqlalchemy.orm import Session, aliased

from ...models import (DocumentAttestationAcknowledgment, DocumentAttestationCampaign, DocumentSignoffAssignment, GovernanceDocument,
                       GovernanceDocumentVersion, GRCDepartment, GRCUser, UploadedFramework)
from . import permissions

# the most rows one lean request returns (``limit`` above it is clamped and the envelope echoes the clamped value)
LEAN_LIMIT = 10_000


def chunks(seq: Sequence, size: int = 5000) -> Iterator[Sequence]:
    """Slices of ``seq`` short enough for one ``IN (...)`` list."""
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def in_force_rows(db: Session, user: GRCUser, sees_every_draft: bool, docs: Iterable[Any], entity: bool = True) -> Dict[int, Any]:
    """For a page of documents: ``{document id: the version row this person reads instead of the document}``, the documents that
    have none left out. ``routers/documents._in_force_for(...)(doc)`` for each document, in two queries: the tests are the same and
    in the same order (everything is read once by the caller: ``sees_every_draft`` is ``visible_filter`` giving None), and a row is
    ``permissions.in_force_row``'s - the earliest of the number published last, never one a take-back marked reverted, one holding
    text or a file. ``entity=False`` reads only the id, number and file columns (a lean list never needs the text)."""
    if sees_every_draft:
        return {}
    want: Dict[int, str] = {}
    for doc in docs:
        number = permissions.published_last(doc)
        if not (doc.status == "published" or not number or number == doc.current_version or user.id in (doc.owner_id, doc.author_id)):
            want[doc.id] = number
    if not want:
        return {}
    ids = list(want)
    taking_part = permissions._assigned(db, user)
    asked = set()
    for chunk in chunks(ids):
        asked.update(i for (i,) in db.execute(taking_part.where(DocumentSignoffAssignment.document_id.in_(chunk))))
    ids = [i for i in ids if i not in asked]            # whoever takes part in the sign-off reads the newest
    if not ids:
        return {}
    V = GovernanceDocumentVersion
    base = db.query(V) if entity else db.query(V.id, V.document_id, V.version_number, V.file_name, V.file_size, V.file_type, V.file_path)
    numbers = {want[i] for i in ids}
    found: Dict[int, Any] = {}
    for chunk in chunks(ids):
        rows = (base.filter(V.document_id.in_(chunk), V.version_number.in_(numbers), func.coalesce(V.status, "") != "reverted",
                            or_(V.content != "", V.file_path != "")).order_by(V.id))
        for row in rows:
            if row.version_number == want[row.document_id]:
                found.setdefault(row.document_id, row)
    return found


# ── attestation: the coverage map's arithmetic, read-only ────────────────────
def attestation_by_document(db: Session, tenant_ids: Sequence[int], doc_ids: Iterable[int]) -> Dict[int, Dict[str, int]]:
    """``{document id: {"pct", "done", "total"}}`` as ``GET /governance/document-attestations/coverage-map`` says it: the document's
    active campaign, else its latest; done = acknowledgements, total = active users on the campaign's email domain (the creator's
    when none is stored), pct = done / total, capped at 100; no entry without users. The route backfills a missing domain and
    commits; this does not write."""
    from .routers.document_attestations import _email_domain

    wanted = set(doc_ids)
    C, A = DocumentAttestationCampaign, DocumentAttestationAcknowledgment
    chosen: Dict[int, Any] = {}
    for c in db.query(C.id, C.document_id, C.status, C.allowed_email_domain, C.created_by).filter(C.tenant_id.in_(tenant_ids)).order_by(C.created_at.desc(), C.id.desc()):
        if c.document_id not in wanted:
            continue
        existing = chosen.get(c.document_id)
        if existing is None or (existing.status != "active" and c.status == "active"):
            chosen[c.document_id] = c
    if not chosen:
        return {}
    acks = dict(db.query(A.campaign_id, func.count(A.id)).filter(A.campaign_id.in_([c.id for c in chosen.values()])).group_by(A.campaign_id).all())
    creators = {c.created_by for c in chosen.values() if not (c.allowed_email_domain or "").strip() and c.created_by}
    emails = dict(db.query(GRCUser.id, GRCUser.email).filter(GRCUser.id.in_(creators)).all()) if creators else {}
    domain_of: Dict[int, Optional[str]] = {}
    for c in chosen.values():
        domain = (c.allowed_email_domain or "").strip().lower() or None
        domain_of[c.id] = domain or (_email_domain(emails.get(c.created_by) or "") if c.created_by else None)
    users = {d: (db.query(func.count(GRCUser.id)).filter(GRCUser.is_active.is_(True), func.lower(GRCUser.email).like(f"%@{d}")).scalar() or 0)
             for d in {d for d in domain_of.values() if d}}
    out: Dict[int, Dict[str, int]] = {}
    for doc_id, c in chosen.items():
        total = users.get(domain_of[c.id], 0) if domain_of[c.id] else 0
        if total > 0:
            done = acks.get(c.id, 0)
            out[doc_id] = {"pct": min(100, round(done / total * 100)), "done": done, "total": total}
    return out


# ── the list ─────────────────────────────────────────────────────────────────
def _iso(value) -> Optional[str]:
    return value.isoformat() if value else None


def _json_list(text: Optional[str]) -> list:
    """A JSON column read as text: its value, [] when it is empty, null or absent. Decoded only when there is something in it (most
    documents have no regulatory scope or no applicable frameworks: the driver would decode four values per row for nothing)."""
    return (json.loads(text) or []) if text and text not in ("[]", "null") else []


def empty(skip: int, limit: int) -> Dict[str, Any]:
    return {"items": [], "total": 0, "skip": skip, "limit": limit, "truncated": False, "lean": True, "frameworks": {}, "departments": {}}


def list_lean(db: Session, user: GRCUser, query, user_tenants: Sequence[int], total: int, skip: int, limit: int, sees_every_draft: bool) -> JSONResponse:
    """The lean envelope for ``query`` (the full list's filtered and sorted query on ``GovernanceDocument``), ``total`` its true count.
    Returned as a ``JSONResponse`` built here: FastAPI's encoder would take about 0.75 s of the event loop for 10,000 rows, the
    encoder of the standard library 0.1 s in this worker thread."""
    G, Owner, Author = GovernanceDocument, aliased(GRCUser), aliased(GRCUser)
    library = permissions.can_read_library(db, user)
    if library:                                         # as the coverage map does, before any row is read (it may commit once on an old tenant)
        from .routers.document_attestations import _ensure_tables
        _ensure_tables(db)
    columns = (G.id, G.document_code, G.title, G.description, G.file_name, G.file_size, G.file_type, G.file_path.isnot(None).label("has_file"),
               G.doc_type, G.classification, G.parent_document_id, G.current_version, G.status, G.published_version, G.last_published_version,
               G.owner_id, Owner.display_name.label("owner_name"), G.author_id, Author.display_name.label("author_name"), G.department_id,
               G.effective_date, G.expiry_date, G.review_cycle_months, G.next_review_date, G.last_reviewed_at,
               cast(G.regulatory_scope, Text).label("regulatory_scope"), cast(G.framework_ids, Text).label("framework_ids"),
               cast(G.applicable_framework_ids, Text).label("applicable_framework_ids"), cast(G.tags, Text).label("tags"),
               G.approved_at, G.published_at, G.created_at, G.updated_at)
    rows = (query.with_entities(*columns).outerjoin(Owner, Owner.id == G.owner_id).outerjoin(Author, Author.id == G.author_id)
            .offset(skip).limit(limit).all())
    served = in_force_rows(db, user, sees_every_draft, rows, entity=False)
    attestation = attestation_by_document(db, user_tenants, [r[0] for r in rows]) if library and rows else {}
    items: List[Dict[str, Any]] = []
    fw_ids, dept_ids = set(), set()
    for r in rows:
        # the columns above, in their order (an attribute of a Row costs 1.5 microseconds: 45 per row were 0.4 s of 5,000 rows)
        (id_, code, title, description, file_name, file_size, file_type, has_file, doc_type, classification, parent_id, current_version, status,
         _published_version, _last_published_version, owner_id, owner_name, author_id, author_name, department_id, effective, expiry, cycle,
         next_review, last_reviewed, scope, frameworks_, applicable, tags, approved_at, published_at, created_at, updated_at) = r
        v = served.get(id_)
        if v is not None:                               # on its way: the version in force is what this person reads
            file_name, file_size, file_type, has_file = v.file_name, v.file_size, v.file_type, v.file_path
        frameworks_, applicable = _json_list(frameworks_), _json_list(applicable)
        for ids in (frameworks_, applicable):
            if isinstance(ids, list):
                fw_ids.update(i for i in ids if isinstance(i, int))
        if department_id is not None:
            dept_ids.add(department_id)
        items.append({
            "id": id_, "document_code": code, "title": title, "description": description, "file_name": file_name, "file_size": file_size,
            "file_type": file_type, "has_file": bool(has_file), "doc_type": doc_type, "classification": classification, "parent_document_id": parent_id,
            "current_version": current_version, "version_in_force": permissions.in_force_number(r), "status": status, "owner_id": owner_id,
            "owner_name": owner_name, "author_id": author_id, "author_name": author_name, "department_id": department_id,
            "effective_date": _iso(effective), "expiry_date": _iso(expiry), "review_cycle_months": cycle, "next_review_date": _iso(next_review),
            "last_reviewed_at": _iso(last_reviewed), "regulatory_scope": _json_list(scope), "framework_ids": frameworks_,
            "applicable_framework_ids": applicable, "tags": _json_list(tags), "approved_at": _iso(approved_at), "published_at": _iso(published_at),
            "created_at": _iso(created_at), "updated_at": _iso(updated_at), "attestation": attestation.get(id_),
        })
    fw_ids, dept_ids = sorted(fw_ids), sorted(dept_ids)
    frameworks = {str(i): {"name": name} for chunk in chunks(fw_ids)
                  for i, name in db.query(UploadedFramework.id, UploadedFramework.name)
                  .filter(UploadedFramework.id.in_(chunk), or_(UploadedFramework.tenant_id.in_(user_tenants), UploadedFramework.is_shared.is_(True)))}
    departments = {str(i): {"name": name, "is_active": active is not False} for chunk in chunks(dept_ids)
                   for i, name, active in db.query(GRCDepartment.id, GRCDepartment.name, GRCDepartment.is_active)
                   .filter(GRCDepartment.id.in_(chunk), GRCDepartment.tenant_id.in_(user_tenants))}
    return JSONResponse({"items": items, "total": total, "skip": skip, "limit": limit, "truncated": skip + len(items) < total, "lean": True,
                         "frameworks": frameworks, "departments": departments})
