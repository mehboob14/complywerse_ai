"""Ticket <-> KB article linkage (Batch 4 linkage C).

Attach a resolution / suggested knowledge-base article to a ticket, and a
"suggest KB" read that ranks the tenant's PUBLISHED articles against the ticket
subject (reusing kb.list_articles — there is no native full-text index, so the
ranking is a simple title-token overlap, deterministic and dependency-free). The
ticket detail carries the attached articles.

Tenant-scoped throughout: the bridge carries tenant_id, article existence is
checked with kb._get_article (which filters on tenant), and a cross-tenant
article id looks exactly like a missing one (400). Attaching is a ticket action,
so it is gated by the ticket edit gate (require_edit), not the KB-author gate.
"""
from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...models import GRCUser, HDArticle, HDTicketKBLink, get_db
from ...routers.auth_router import require_auth
from . import tickets, kb
from .audit import hd_audit
from .common import require_edit, require_view, tenant_id

router = APIRouter(prefix="/helpdesk", tags=["Help Desk (native)"])

# KB is a single page in the UI; linked articles deep-link there.
_KB_URL = "/helpdesk/kb"

_WORD = re.compile(r"[a-z0-9]+")
# tiny stop-list so generic words don't inflate the overlap score.
_STOP = {
    "the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "is", "are",
    "with", "not", "no", "cannot", "cant", "wont", "when", "how", "why", "issue",
    "error", "problem", "please", "help", "need", "unable",
}


def _tokens(text: Optional[str]) -> set:
    return {w for w in _WORD.findall((text or "").lower()) if len(w) > 2 and w not in _STOP}


def _article_ref(a: HDArticle) -> dict:
    """Compact article object a ticket carries / a suggestion returns."""
    return {
        "name": str(a.id),
        "title": a.title,
        "category": a.category.category_name if a.category else None,
        "status": a.status,
        "url": _KB_URL,
    }


def _linked_ids(db: Session, tid: int, ticket_id: int) -> set:
    return {
        aid for (aid,) in (db.query(HDTicketKBLink.article_id)
                           .filter(HDTicketKBLink.tenant_id == tid,
                                   HDTicketKBLink.ticket_id == ticket_id)
                           .all())
    }


def list_links(db: Session, tid: int, ticket) -> list:
    """The KB articles attached to a ticket, oldest link first."""
    rows = (db.query(HDTicketKBLink)
            .filter(HDTicketKBLink.tenant_id == tid, HDTicketKBLink.ticket_id == ticket.id)
            .order_by(HDTicketKBLink.id.asc())
            .all())
    return [_article_ref(r.article) for r in rows if r.article is not None]


def suggest(db: Session, tid: int, ticket, limit: int = 5) -> list:
    """Published articles ranked by title-token overlap with the ticket subject,
    excluding already-linked ones. Empty when the subject has no usable tokens or
    nothing overlaps — never a random dump."""
    wanted = _tokens(ticket.subject)
    if not wanted:
        return []
    already = _linked_ids(db, tid, ticket.id)
    scored = []
    for a in kb.list_articles(db, tid, published_only=True)["articles"]:
        try:
            if int(a["name"]) in already:
                continue
        except (TypeError, ValueError):
            pass
        overlap = len(wanted & _tokens(a.get("title")))
        if overlap > 0:
            scored.append((overlap, a))
    scored.sort(key=lambda x: (-x[0], (x[1].get("title") or "").lower()))
    return [a for _, a in scored[:limit]]


def add_link(db: Session, tid: int, name: str, article_id: int,
             actor_email: Optional[str] = None) -> dict:
    """Attach a KB article (idempotent). The article must exist in this tenant
    (kb._get_article → None → 400)."""
    ticket = tickets._get_ticket(db, tid, name)
    if not ticket:
        return {"ok": False, "error": "not found"}
    article = kb._get_article(db, tid, str(article_id))
    if article is None:
        raise HTTPException(status_code=400, detail="article does not exist in this tenant")
    existing = (db.query(HDTicketKBLink)
                .filter(HDTicketKBLink.tenant_id == tid, HDTicketKBLink.ticket_id == ticket.id,
                        HDTicketKBLink.article_id == article.id)
                .first())
    if existing is None:
        db.add(HDTicketKBLink(tenant_id=tid, ticket_id=ticket.id, article_id=article.id))
        db.commit()
        hd_audit(db, tenant_id=tid, actor_email=actor_email, action="ticket.kb_link.add",
                 entity="ticket", entity_id=ticket.id, after={"article_id": article.id})
    return {"ok": True}


def remove_link(db: Session, tid: int, name: str, article_id: int,
                actor_email: Optional[str] = None) -> dict:
    """Detach a KB article (idempotent — a missing link is a no-op)."""
    ticket = tickets._get_ticket(db, tid, name)
    if not ticket:
        return {"ok": False, "error": "not found"}
    row = (db.query(HDTicketKBLink)
           .filter(HDTicketKBLink.tenant_id == tid, HDTicketKBLink.ticket_id == ticket.id,
                   HDTicketKBLink.article_id == article_id)
           .first())
    if row is not None:
        db.delete(row)
        db.commit()
        hd_audit(db, tenant_id=tid, actor_email=actor_email, action="ticket.kb_link.remove",
                 entity="ticket", entity_id=ticket.id, after={"article_id": article_id})
    return {"ok": True}


# ─── routes ────────────────────────────────────────────────────────────────
class KBLink(BaseModel):
    article_id: int


@router.get("/tickets/{name}/kb-links")
def get_kb_links(name: str, db: Session = Depends(get_db),
                 _: bool = Depends(require_view)):
    tid = tenant_id(db)
    ticket = tickets._get_ticket(db, tid, name)
    if not ticket:
        return {"kb_links": []}
    return {"kb_links": list_links(db, tid, ticket)}


@router.get("/tickets/{name}/kb-suggestions")
def get_kb_suggestions(name: str, db: Session = Depends(get_db),
                       _: bool = Depends(require_view)):
    tid = tenant_id(db)
    ticket = tickets._get_ticket(db, tid, name)
    if not ticket:
        return {"suggestions": []}
    return {"suggestions": suggest(db, tid, ticket)}


@router.post("/tickets/{name}/kb-links")
def post_kb_link(name: str, body: KBLink, db: Session = Depends(get_db),
                 current_user: GRCUser = Depends(require_auth),
                 _: bool = Depends(require_edit)):
    return add_link(db, tenant_id(db), name, body.article_id, current_user.email)


@router.delete("/tickets/{name}/kb-links/{article_id}")
def delete_kb_link(name: str, article_id: int, db: Session = Depends(get_db),
                   current_user: GRCUser = Depends(require_auth),
                   _: bool = Depends(require_edit)):
    return remove_link(db, tenant_id(db), name, article_id, current_user.email)
