"""The Governance Overview's posture by framework or by department (GET /governance/dashboard/posture): true totals over every document
the caller may read, so a library past the browser's 1,000-row cut is still counted right.

The rules are the Documents library's, not new ones, so that a row's number is the number of the list its link opens:

* review health = ``reviewable`` / ``reviewState`` of grc-frontend/.../documents/_workspace/libraryModel.ts (D40): a review is owed on a
  document with a version in force (``permissions.in_force_number``: published, or a newer version is on its way over a published one)
  or approved; it is overdue when its date has passed (an instant), due when the date lies within 30 UTC calendar days, else current;
  no date = no_review_date. tests/test_governance_posture.py pins this with a table recorded from the TypeScript itself.
* a document's frameworks = ``shownFrameworkIds`` of library.ts: its applicable frameworks, else its own framework_ids; a document on
  several frameworks is counted under each.
* the open states of an exception are the exceptions module's own (services/exception_posture._OPEN_STATES).

One lean SELECT of the documents (never their text), one of the open exceptions, one for the names; the grouping is done here because
the framework ids are a JSON column. The number of statements does not depend on the number of documents.
"""
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ...models import GovernanceDocument, GRCDepartment, GRCUser, PolicyException, UploadedFramework
from ...services.exception_posture import _OPEN_STATES as OPEN_EXCEPTION_STATES
from .permissions import in_force_number, visible_filter

DUE_SOON_DAYS = 30
AWAITING = ("pending_review", "pending_approval")        # a document waiting for its reviewers or approvers (the Overview's counter)
NOT_MAPPED, NO_DEPARTMENT, UNASSIGNED = "Not mapped to a framework", "No department", "Unassigned"

NOTES = {
    "framework": ("A document is counted under each framework it is mapped to (the ones the Documents library shows for it), so a document on "
                  "three frameworks is in three rows and the rows add up to more than documents_total; one mapped to none is under "
                  f"'{NOT_MAPPED}'. Archived documents and documents you may not read are left out."),
    "department": ("A document is counted under the department it is filed under; one with none is under "
                   f"'{NO_DEPARTMENT}', one filed under a department that no longer exists under '{UNASSIGNED}'. The rows add up to "
                   "documents_total. Archived documents and documents you may not read are left out."),
    "review_health": ("Counted on the documents a review is owed on (published, approved, or being revised with a version in force), as the "
                      "Documents library counts them: current = review date more than 30 days ahead, due = within 30 days, overdue = "
                      "date passed, no_review_date = none set. on_time_pct = (current + due) out of those with a date; empty when none has one."),
    "needs_attention": ("Overdue reviews + documents waiting for review or approval + documents expiring within 30 days + exceptions waiting "
                        "for a decision or approved and expiring within 30 days: the document-bound items of the Overview's Needs attention "
                        "band, split by group. An item that is several things is counted once for each."),
    "open_exceptions": ("Policy exceptions that are draft, waiting for approval or approved, under the group of their document. An exception "
                        "with no document, or whose document is not counted here, is in no row."),
}


def review_bucket(doc, now: datetime) -> Optional[str]:
    """'current' | 'due' | 'overdue' | 'no_review_date', or None when no review is owed on the document (libraryModel.ts reviewState().bucket).
    ``doc`` needs status, current_version, published_version and next_review_date (an ORM row or a column projection)."""
    if doc.status in ("archived", "expired") or not (doc.status in ("published", "approved") or in_force_number(doc)):
        return None
    due = doc.next_review_date
    if due is None:
        return "no_review_date"
    if due < now:                                                       # an instant, as the Overview's "overdue"
        return "overdue"
    # whole UTC calendar days to the date, as the library counts them (the server's own due_30d compares instants and differs for a
    # date on the last calendar day of the window)
    return "due" if due.toordinal() - now.toordinal() <= DUE_SOON_DAYS else "current"


def framework_keys(doc) -> List[Optional[int]]:
    """The framework ids a document is counted under (library.ts shownFrameworkIds, de-duplicated, integers only); [None] when it has none."""
    ids = doc.applicable_framework_ids or doc.framework_ids or []
    if not isinstance(ids, list):
        ids = []
    return list(dict.fromkeys(i for i in ids if isinstance(i, int) and not isinstance(i, bool))) or [None]


def _names(db: Session, scoped: List[int], by: str) -> Dict[int, str]:
    if by == "framework":                          # the tenant's own or shared frameworks: the rule of the framework list endpoint
        q = db.query(UploadedFramework.id, UploadedFramework.name).filter(
            or_(UploadedFramework.tenant_id.in_(scoped), UploadedFramework.is_shared.is_(True)))
        return {i: n for i, n in q}
    q = db.query(GRCDepartment.id, GRCDepartment.name, GRCDepartment.is_active).filter(GRCDepartment.tenant_id.in_(scoped))
    return {i: f"{n} (inactive)" if active is False else n for i, n, active in q}      # the Library filter's wording for a switched-off one


def build(db: Session, user: GRCUser, scoped: List[int], by: str, limit: int, offset: int, now: Optional[datetime] = None) -> dict:
    now = now or datetime.utcnow()
    soon = now + timedelta(days=DUE_SOON_DAYS)
    out = {"by": by, "as_of": now.isoformat(), "rows": [], "total": 0, "documents_total": 0, "open_exceptions_total": 0,
           "limit": limit, "offset": offset,
           "notes": {"counting": NOTES[by], **{k: NOTES[k] for k in ("review_health", "needs_attention", "open_exceptions")}}}
    if not scoped:
        return out

    G = GovernanceDocument
    # ponytail: every readable document is read once and grouped here; at ~100k documents the department view could be a SQL GROUP BY
    q = db.query(G.id, G.status, G.department_id, G.next_review_date, G.expiry_date, G.current_version, G.published_version,
                 G.framework_ids, G.applicable_framework_ids).filter(G.tenant_id.in_(scoped), or_(G.status.is_(None), G.status != "archived"))
    visible = visible_filter(db, user)                               # what the Library list shows this person
    docs = (q if visible is None else q.filter(visible)).all()

    counts = defaultdict(lambda: dict.fromkeys(("documents", "current", "due", "overdue", "no_review_date", "awaiting_approval",
                                                "expiring_30d", "exceptions", "open_exceptions"), 0))
    placed: Dict[int, list] = {}
    for d in docs:
        keys = framework_keys(d) if by == "framework" else [d.department_id]
        placed[d.id] = keys
        bucket = review_bucket(d, now)
        awaiting = d.status in AWAITING
        # the Overview's expiring_documents_30d: approved or in force, the expiry between now and +30 days
        expiring = bool(d.expiry_date and (d.status == "approved" or in_force_number(d)) and now <= d.expiry_date <= soon)
        for k in keys:
            c = counts[k]
            c["documents"] += 1
            if bucket:
                c[bucket] += 1
            c["awaiting_approval"] += awaiting
            c["expiring_30d"] += expiring

    placed_exceptions = 0
    for document_id, status, expiry in db.query(PolicyException.document_id, PolicyException.status, PolicyException.expiry_date).filter(
            PolicyException.tenant_id.in_(scoped), PolicyException.document_id.isnot(None), PolicyException.status.in_(OPEN_EXCEPTION_STATES)):
        keys = placed.get(document_id)
        if keys is None:                                              # its document is archived or not the caller's to read
            continue
        placed_exceptions += 1
        # the Overview's exceptions_attention: waiting for a decision, or approved and about to lapse
        needs = status == "pending_approval" or (status == "approved" and expiry is not None and now <= expiry <= soon)
        for k in keys:
            counts[k]["open_exceptions"] += 1
            counts[k]["exceptions"] += needs

    names = _names(db, scoped, by)
    none_name = NOT_MAPPED if by == "framework" else NO_DEPARTMENT
    unknown = (lambda k: f"Framework #{k}") if by == "framework" else (lambda k: UNASSIGNED)
    rows = []
    for key, c in counts.items():
        scheduled = c["current"] + c["due"] + c["overdue"]
        parts = {"overdue_reviews": c["overdue"], "awaiting_approval": c["awaiting_approval"],
                 "expiring_30d": c["expiring_30d"], "exceptions": c["exceptions"]}
        rows.append({
            "id": key, "name": none_name if key is None else names.get(key) or unknown(key),
            "documents": c["documents"], "current": c["current"], "due": c["due"], "overdue": c["overdue"],
            "no_review_date": c["no_review_date"],
            "on_time_pct": round(100 * (c["current"] + c["due"]) / scheduled, 1) if scheduled else None,
            "due_30d": c["due"],                                      # the Overview's counter name for the same documents
            "needs_attention": sum(parts.values()), "attention": parts, "open_exceptions": c["open_exceptions"],
        })
    # weakest first; a group with no review date to be late on sorts last; ties by name, then id
    rows.sort(key=lambda r: (r["on_time_pct"] is None, r["on_time_pct"] or 0, r["name"].casefold(), r["id"] is None, r["id"] or 0))
    out.update(rows=rows[offset:offset + limit], total=len(rows), documents_total=len(docs), open_exceptions_total=placed_exceptions)
    return out
