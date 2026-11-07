"""Knowledge base — native port of the Frappe KB CRUD + article feedback.

Grouped `/articles` list (`list_articles`) plus the full article / category
write surface converted 1:1 from the forked Frappe app:

  * helpdesk/api/knowledge_base.py — get_article, delete_articles, create_category,
    move_to_category, get_categories, get_category_articles, merge_category,
    get_general_category, get_category_title, increment_views
  * helpdesk/.../hd_article/hd_article.py — set_feedback, and the save-hooks
    (published_on stamp, archive-nulls-category, content-required-on-publish,
    ">=1 article per category" invariant) folded into create/update/delete.
  * helpdesk/.../hd_article_category/hd_article_category.py — "General" reserved
    name + on_trash reparent-orphans-to-General.
  * helpdesk/api/article.py get_article_stats — views + like/dislike tallies.
    (Its RediSearch `search()` half is N/A here — no native full-text index — SKIPPED.)

Tenant-scoped throughout; empty tenant → empty lists, never 4xx (§E). Mutations
return {"ok": true} (create_category also echoes the new ids the UI navigates to).

MODEL GAPS (can't edit _60_helpdesk_native_models.py — reported, not worked around):
  * HDArticle has no `idx` column, so Frappe's publish-time idx-append
    (hd_article.before_save) cannot be reproduced — SKIPPED; ordering stays by
    updated_at as the existing list already does.
  * No per-user/per-article view rate-limit store, so `increment_views` uses an
    in-process timestamp guard (see its ponytail note) instead of Frappe's
    @rate_limit.
  * HDArticle.author holds a bare email; Frappe returned a full avatar-info dict
    (get_user_info_for_avatar). Native serializes the raw string — the user→
    grc_users avatar join is deferred (same gap people.py notes).
"""
from __future__ import annotations

import time
from collections import Counter
from typing import Optional

from bs4 import BeautifulSoup
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...models import (GRCUser, HDAgent, HDArticle, HDArticleCategory,
                       HDArticleFeedback, get_db)
from ...routers.auth_router import require_auth
from .common import iso, require_kb_author, require_kb_view, require_requester, tenant_id

GENERAL = "General"


def list_articles(db: Session, tid: int, published_only: bool = True) -> dict:
    """§A10. Per-article helpful/not_helpful have no native store yet (the model
    map defers HD Article Feedback), so they serialize as 0 — exactly what the
    proxy returns for an article with no feedback rows. `categories` is the
    proxy's name→count breakdown (sorted), unread by the UI but part of the shape.

    SECURITY (audit M1 — KB draft leak): `published_only` defaults to True so a
    requester/portal caller never sees Draft/Archived titles, authors or metadata.
    The agent-console caller that manages drafts must pass published_only=False
    explicitly (it is tickets:view/kb:view gated, so only staff reach it)."""
    q = db.query(HDArticle).filter(HDArticle.tenant_id == tid)
    if published_only:
        q = q.filter(HDArticle.status == "Published")
    rows = q.order_by(HDArticle.updated_at.desc()).all()
    cats: Counter = Counter()
    articles = []
    for a in rows:
        cat = (a.category.category_name if a.category and a.category.category_name
               else "Uncategorised")
        cats[cat] += 1
        articles.append({
            "name": str(a.id),
            "title": a.title,
            "category": cat,
            "status": a.status,
            "author": a.author,
            "modified": iso(a.updated_at),
            "views": a.views or 0,
            "helpful": 0,
            "not_helpful": 0,
        })
    return {
        "articles": articles,
        "categories": [{"name": n, "count": c} for n, c in sorted(cats.items())],
    }


# ─── helpers ────────────────────────────────────────────────────────────────
def _is_agent(db: Session, tid: int, email: Optional[str]) -> bool:
    """Native `helpdesk.utils.is_agent()`: the caller has an HD Agent row."""
    if not email:
        return False
    return (
        db.query(HDAgent.id)
        .filter(HDAgent.tenant_id == tid, HDAgent.user == email)
        .first()
        is not None
    )


def _get_article(db: Session, tid: int, name: str) -> Optional[HDArticle]:
    """Tenant-scoped fetch by contract `name` (our integer PK). The tenant_id
    filter is the isolation guard: a crafted/cross-tenant id yields None."""
    try:
        pk = int(name)
    except (TypeError, ValueError):
        return None
    return (
        db.query(HDArticle)
        .filter(HDArticle.id == pk, HDArticle.tenant_id == tid)
        .first()
    )


def _get_category(db: Session, tid: int, name: str) -> Optional[HDArticleCategory]:
    try:
        pk = int(name)
    except (TypeError, ValueError):
        return None
    return (
        db.query(HDArticleCategory)
        .filter(HDArticleCategory.id == pk, HDArticleCategory.tenant_id == tid)
        .first()
    )


def _category_article_count(db: Session, tid: int, cat_id: Optional[int]) -> int:
    """All articles in a category (every status) — Frappe's check_category_length /
    move_to_category count the same way."""
    if cat_id is None:
        return 0
    return (
        db.query(HDArticle)
        .filter(HDArticle.tenant_id == tid, HDArticle.category_id == cat_id)
        .count()
    )


def _general_category(db: Session, tid: int) -> Optional[HDArticleCategory]:
    return (
        db.query(HDArticleCategory)
        .filter(HDArticleCategory.tenant_id == tid,
                HDArticleCategory.category_name == GENERAL)
        .first()
    )


def _apply_save_hooks(article: HDArticle) -> None:
    """hd_article.before_save + validate_published_content, minus idx-append
    (no idx column). Mutates the article in place; call before commit."""
    from datetime import datetime

    if article.status == "Published" and not article.content:
        raise HTTPException(status_code=400, detail="Published articles must have content.")
    if article.status == "Published" and not article.published_on:
        article.published_on = datetime.utcnow()
    elif article.status == "Draft" and article.published_on:
        article.published_on = None
    if article.status == "Archived" and article.category_id is not None:
        article.category_id = None  # ponytail: matches Frappe — archive drops the category


# ─── reads ────────────────────────────────────────────────────────────────
def get_article(db: Session, tid: int, name: str, email: Optional[str]) -> dict:
    """knowledge_base.get_article: non-agents can only read Published articles;
    returns author + THIS user's feedback (0 none / 1 like / 2 dislike)."""
    a = _get_article(db, tid, name)
    if not a:
        raise HTTPException(status_code=404, detail="not found")
    if not _is_agent(db, tid, email) and a.status != "Published":
        raise HTTPException(status_code=403, detail="Access denied")
    feedback = (
        db.query(HDArticleFeedback.feedback)
        .filter(HDArticleFeedback.article_id == a.id, HDArticleFeedback.user == email)
        .scalar()
    ) or 0
    return {
        "name": str(a.id),
        "title": a.title,
        "content": a.content,
        "author": a.author,  # GAP: Frappe returned an avatar-info dict (see header)
        "creation": iso(a.created_at),
        "status": a.status,
        "published_on": iso(a.published_on),
        "modified": iso(a.updated_at),
        "category_name": a.category.category_name if a.category else None,
        "category_id": str(a.category_id) if a.category_id else None,
        "feedback": int(feedback),
    }


def get_categories(db: Session, tid: int) -> dict:
    """knowledge_base.get_categories: published counts, drop empties, sort desc."""
    rows = (
        db.query(HDArticleCategory)
        .filter(HDArticleCategory.tenant_id == tid)
        .all()
    )
    out = []
    for c in rows:
        count = (
            db.query(HDArticle)
            .filter(HDArticle.tenant_id == tid,
                    HDArticle.category_id == c.id,
                    HDArticle.status == "Published")
            .count()
        )
        if count > 0:
            out.append({
                "name": str(c.id),
                "category_name": c.category_name,
                "modified": iso(c.updated_at),
                "article_count": count,
            })
    out.sort(key=lambda c: c["article_count"], reverse=True)
    return {"categories": out}


def get_category_articles(db: Session, tid: int, category: str) -> dict:
    """knowledge_base.get_category_articles: published articles, 100-char text preview."""
    cat = _get_category(db, tid, category)
    if not cat:
        return {"articles": []}
    rows = (
        db.query(HDArticle)
        .filter(HDArticle.tenant_id == tid,
                HDArticle.category_id == cat.id,
                HDArticle.status == "Published")
        .all()
    )
    return {"articles": [{
        "name": str(a.id),
        "title": a.title,
        "published_on": iso(a.published_on),
        "modified": iso(a.updated_at),
        "author": a.author,  # GAP: raw string, not Frappe avatar-info dict
        "content": str(BeautifulSoup(a.content or "", "html.parser").text)[:100],
    } for a in rows]}


def get_general_category(db: Session, tid: int) -> Optional[str]:
    """knowledge_base.get_general_category: the General category's id, or None."""
    c = _general_category(db, tid)
    return str(c.id) if c else None


def get_category_title(db: Session, tid: int, category: str) -> Optional[str]:
    """knowledge_base.get_category_title."""
    c = _get_category(db, tid, category)
    return c.category_name if c else None


def get_article_stats(db: Session, tid: int, name: str, email: Optional[str]) -> dict:
    """article.get_article_stats: views + like/dislike counts (same non-agent gate
    as get_article). The RediSearch search() half is N/A natively — SKIPPED."""
    a = _get_article(db, tid, name)
    if not a:
        raise HTTPException(status_code=404, detail="not found")
    if not _is_agent(db, tid, email) and a.status != "Published":
        raise HTTPException(status_code=403, detail="Access denied")
    likes = (
        db.query(HDArticleFeedback)
        .filter(HDArticleFeedback.article_id == a.id, HDArticleFeedback.feedback == 1)
        .count()
    )
    dislikes = (
        db.query(HDArticleFeedback)
        .filter(HDArticleFeedback.article_id == a.id, HDArticleFeedback.feedback == 2)
        .count()
    )
    return {"views": a.views or 0, "likes": likes, "dislikes": dislikes}


# ponytail: in-process view guard (tid, article_id) -> last-counted epoch. Replaces
# Frappe's @rate_limit. CEILING — per worker process, lost on restart, and NOT
# per-user (Frappe's was per session). Upgrade: a last_viewed_at column or shared
# cache if view counts need to be exact across workers.
_VIEW_GUARD: dict[tuple, float] = {}
_VIEW_WINDOW = 60 * 60


def increment_views(db: Session, tid: int, name: str) -> dict:
    """knowledge_base.increment_views, rate-limited ~1/hr per article."""
    a = _get_article(db, tid, name)
    if not a:
        raise HTTPException(status_code=404, detail="not found")
    now = time.time()
    key = (tid, a.id)
    if now - _VIEW_GUARD.get(key, 0.0) < _VIEW_WINDOW:
        return {"ok": True}
    _VIEW_GUARD[key] = now
    a.views = (a.views or 0) + 1
    db.commit()
    return {"ok": True}


# ─── writes ───────────────────────────────────────────────────────────────
def create_article(db: Session, tid: int, email: Optional[str], payload: dict) -> dict:
    """ADD (Frappe created articles via create_category's seed or the generic form).
    before_insert sets author = current user; save-hooks applied."""
    a = HDArticle(
        tenant_id=tid,
        title=payload.get("title") or "New Article",
        category_id=payload.get("category_id"),
        status=payload.get("status") or "Draft",
        content=payload.get("content"),
        author=email,
    )
    _apply_save_hooks(a)
    db.add(a)
    db.commit()
    return {"ok": True, "article": str(a.id)}


def update_article(db: Session, tid: int, name: str, email: Optional[str],
                   payload: dict) -> dict:
    """hd_article.validate + before_save on edit. validate_article_category: moving
    an article out of a category that holds only it is blocked (keep >=1 per
    category). Archive-nulls-category happens in the hooks WITHOUT that guard, same
    as Frappe (the null is set after validate)."""
    a = _get_article(db, tid, name)
    if not a:
        raise HTTPException(status_code=404, detail="not found")

    if "category_id" in payload and payload["category_id"] != a.category_id:
        if a.category_id is not None and _category_article_count(db, tid, a.category_id) == 1:
            raise HTTPException(status_code=400, detail="Category must have atleast one article")
        a.category_id = payload["category_id"]
    if payload.get("title") is not None:
        a.title = payload["title"]
    if "content" in payload:
        a.content = payload["content"]
    if payload.get("status") is not None:
        a.status = payload["status"]

    _apply_save_hooks(a)
    db.commit()
    return {"ok": True}


def delete_articles(db: Session, tid: int, names: list[str]) -> dict:
    """knowledge_base.delete_articles → each triggers hd_article.on_trash
    (check_category_length): can't delete the only article in a category."""
    targets = []
    for name in names:
        a = _get_article(db, tid, name)
        if not a:
            continue
        if a.category_id is not None and _category_article_count(db, tid, a.category_id) == 1:
            raise HTTPException(status_code=400, detail="Category must have atleast one article")
        targets.append(a)
    for a in targets:
        db.delete(a)
    db.commit()
    return {"ok": True}


def create_category(db: Session, tid: int, email: Optional[str], title: str) -> dict:
    """knowledge_base.create_category: 'General' is reserved; seed a 'New Article'
    so the new category is never empty. Echoes the new ids (UI navigates to them)."""
    if (title or "").strip().lower() == GENERAL.lower():
        raise HTTPException(
            status_code=400,
            detail="General is a reserved category name. Please use a different name to proceed.",
        )
    cat = HDArticleCategory(tenant_id=tid, category_name=title)
    db.add(cat)
    db.flush()  # need cat.id for the seed article
    art = HDArticle(tenant_id=tid, title="New Article", category_id=cat.id,
                    status="Draft", author=email)
    db.add(art)
    db.commit()
    return {"ok": True, "article": str(art.id), "category": str(cat.id)}


def move_to_category(db: Session, tid: int, category: str, articles: list[str]) -> dict:
    """knowledge_base.move_to_category: reparent each article to `category`, but
    never empty a source category (>=1 article invariant)."""
    target = _get_category(db, tid, category)
    if not target:
        raise HTTPException(status_code=404, detail="category not found")
    for name in articles:
        a = _get_article(db, tid, name)
        if not a:
            continue
        if _category_article_count(db, tid, a.category_id) == 1:
            raise HTTPException(status_code=400, detail="Category must have atleast one article")
        a.category_id = target.id
    db.commit()
    return {"ok": True}


def merge_category(db: Session, tid: int, source: str, target: str) -> dict:
    """knowledge_base.merge_category: reparent source's articles to target, delete
    source. Source==target blocked; General can't be merged away."""
    src = _get_category(db, tid, source)
    tgt = _get_category(db, tid, target)
    if not src or not tgt:
        raise HTTPException(status_code=404, detail="category not found")
    if src.id == tgt.id:
        raise HTTPException(status_code=400, detail="Source and target category cannot be same")
    if src.category_name == GENERAL:
        raise HTTPException(status_code=400, detail="Cannot merge General category")
    (db.query(HDArticle)
       .filter(HDArticle.tenant_id == tid, HDArticle.category_id == src.id)
       .update({HDArticle.category_id: tgt.id}, synchronize_session=False))
    db.delete(src)
    db.commit()
    return {"ok": True}


def delete_category(db: Session, tid: int, name: str) -> dict:
    """hd_article_category.on_trash: General can't be deleted; orphaned articles
    reparent to General. If no General exists, null their category (FK-safe) rather
    than orphan them against a deleted row — Frappe relies on a seeded General."""
    cat = _get_category(db, tid, name)
    if not cat:
        raise HTTPException(status_code=404, detail="not found")
    if cat.category_name == GENERAL:
        raise HTTPException(status_code=400, detail="General category can't be deleted")
    general = _general_category(db, tid)
    new_cat_id = general.id if general else None
    (db.query(HDArticle)
       .filter(HDArticle.tenant_id == tid, HDArticle.category_id == cat.id)
       .update({HDArticle.category_id: new_cat_id}, synchronize_session=False))
    db.delete(cat)
    db.commit()
    return {"ok": True}


def set_feedback(db: Session, tid: int, name: str, email: Optional[str], value: int) -> dict:
    """hd_article.set_feedback: upsert HDArticleFeedback for (user, article).
    value 0 none / 1 like / 2 dislike."""
    if value not in (0, 1, 2):
        raise HTTPException(status_code=400, detail="feedback must be 0, 1 or 2")
    a = _get_article(db, tid, name)
    if not a:
        raise HTTPException(status_code=404, detail="not found")
    row = (
        db.query(HDArticleFeedback)
        .filter(HDArticleFeedback.article_id == a.id, HDArticleFeedback.user == email)
        .first()
    )
    if row:
        if row.feedback == value:
            return {"ok": True}
        row.feedback = value
    else:
        db.add(HDArticleFeedback(tenant_id=tid, article_id=a.id, user=email, feedback=value))
    db.commit()
    return {"ok": True}


# ─── write router ────────────────────────────────────────────────────────
# Defined here (task) but NOT mounted — router.py is owned elsewhere and must not
# be touched. Wiring step: `from .kb import kb_write_router` + app.include_router.
kb_write_router = APIRouter(prefix="/helpdesk", tags=["Help Desk KB (native)"])


class ArticleBody(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    status: Optional[str] = None
    category_id: Optional[int] = None


class CategoryCreate(BaseModel):
    title: str


class MoveBody(BaseModel):
    category: str
    articles: list[str]


class MergeBody(BaseModel):
    source: str
    target: str


class DeleteBody(BaseModel):
    articles: list[str]


class FeedbackBody(BaseModel):
    feedback: int


@kb_write_router.get("/articles/{name}")
def r_get_article(name: str, db: Session = Depends(get_db),
                  user: GRCUser = Depends(require_auth), _: bool = Depends(require_kb_view)):
    return get_article(db, tenant_id(db), name, user.email)


@kb_write_router.get("/portal/kb/{name}")
def r_portal_get_article(name: str, db: Session = Depends(get_db),
                         user: GRCUser = Depends(require_auth), _: bool = Depends(require_requester)):
    """Requester-portal read-one (gated on requests:view_own, like the portal /kb
    list). Reuses get_article: its non-agent gate means a requester only ever reads
    a Published article's body — Draft/Archived → 403, cross-tenant id → 404."""
    return get_article(db, tenant_id(db), name, user.email)


@kb_write_router.get("/articles/{name}/stats")
def r_article_stats(name: str, db: Session = Depends(get_db),
                    user: GRCUser = Depends(require_auth), _: bool = Depends(require_kb_view)):
    return get_article_stats(db, tenant_id(db), name, user.email)


@kb_write_router.post("/articles")
def r_create_article(body: ArticleBody, db: Session = Depends(get_db),
                     user: GRCUser = Depends(require_auth), _: bool = Depends(require_kb_author)):
    return create_article(db, tenant_id(db), user.email, body.model_dump(exclude_none=True))


@kb_write_router.put("/articles/{name}")
def r_update_article(name: str, body: ArticleBody, db: Session = Depends(get_db),
                     user: GRCUser = Depends(require_auth), _: bool = Depends(require_kb_author)):
    return update_article(db, tenant_id(db), name, user.email, body.model_dump(exclude_unset=True))


@kb_write_router.post("/articles/delete")
def r_delete_articles(body: DeleteBody, db: Session = Depends(get_db),
                      _: bool = Depends(require_kb_author)):
    return delete_articles(db, tenant_id(db), body.articles)


@kb_write_router.post("/articles/{name}/feedback")
def r_set_feedback(name: str, body: FeedbackBody, db: Session = Depends(get_db),
                   user: GRCUser = Depends(require_auth), _: bool = Depends(require_kb_view)):
    return set_feedback(db, tenant_id(db), name, user.email, body.feedback)


@kb_write_router.post("/articles/{name}/views")
def r_increment_views(name: str, db: Session = Depends(get_db), _: bool = Depends(require_kb_view)):
    return increment_views(db, tenant_id(db), name)


@kb_write_router.get("/kb/categories")
def r_get_categories(db: Session = Depends(get_db), _: bool = Depends(require_kb_view)):
    return get_categories(db, tenant_id(db))


@kb_write_router.get("/kb/general-category")
def r_general_category(db: Session = Depends(get_db), _: bool = Depends(require_kb_view)):
    return {"category": get_general_category(db, tenant_id(db))}


@kb_write_router.get("/kb/categories/{category}/title")
def r_category_title(category: str, db: Session = Depends(get_db), _: bool = Depends(require_kb_view)):
    return {"category_name": get_category_title(db, tenant_id(db), category)}


@kb_write_router.get("/kb/categories/{category}/articles")
def r_category_articles(category: str, db: Session = Depends(get_db), _: bool = Depends(require_kb_view)):
    return get_category_articles(db, tenant_id(db), category)


@kb_write_router.post("/kb/categories")
def r_create_category(body: CategoryCreate, db: Session = Depends(get_db),
                      user: GRCUser = Depends(require_auth), _: bool = Depends(require_kb_author)):
    return create_category(db, tenant_id(db), user.email, body.title)


@kb_write_router.post("/kb/categories/move")
def r_move_to_category(body: MoveBody, db: Session = Depends(get_db), _: bool = Depends(require_kb_author)):
    return move_to_category(db, tenant_id(db), body.category, body.articles)


@kb_write_router.post("/kb/categories/merge")
def r_merge_category(body: MergeBody, db: Session = Depends(get_db), _: bool = Depends(require_kb_author)):
    return merge_category(db, tenant_id(db), body.source, body.target)


@kb_write_router.delete("/kb/categories/{name}")
def r_delete_category(name: str, db: Session = Depends(get_db), _: bool = Depends(require_kb_author)):
    return delete_category(db, tenant_id(db), name)
