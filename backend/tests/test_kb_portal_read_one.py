"""Requester-portal KB read-one gate — grc/modules/helpdesk_native/kb.py.

The route GET /helpdesk/portal/kb/{name} is a thin wrapper over
`get_article(email=requester)`; the behaviour it relies on is get_article's
non-agent gate: a requester reads a Published article WITH its body, a
Draft/Archived article is 403, an agent may read a Draft, and a cross-tenant id
is 404 (tenant isolation). In-memory SQLite, direct function calls — mirrors the
other helpdesk_native unit tests.
"""
import os

os.environ.setdefault("SESSION_SECRET", "test-kb-portal")

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import (GRCUser, HDAgent, HDArticle, HDArticleCategory,
                        HDArticleFeedback)
from grc.modules.helpdesk_native import kb

TENANT = 1
OTHER = 2
REQUESTER = "user@acme.test"
AGENT = "agent@acme.test"

TABLES = (HDArticleCategory, HDArticle, HDAgent, HDArticleFeedback, GRCUser)


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    for t in TABLES:
        t.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()


def _article(db, title="Reset your password", content="<p>Click <b>reset</b>.</p>",
             status="Published", tenant=TENANT):
    a = HDArticle(tenant_id=tenant, title=title, content=content, status=status)
    db.add(a)
    db.commit()
    return a


def test_requester_reads_published_with_body(db):
    a = _article(db)
    out = kb.get_article(db, TENANT, str(a.id), REQUESTER)
    assert out["name"] == str(a.id)
    assert out["title"] == "Reset your password"
    assert out["content"] == "<p>Click <b>reset</b>.</p>"
    assert out["status"] == "Published"
    assert out["feedback"] == 0


def test_requester_blocked_from_draft_403(db):
    a = _article(db, status="Draft")
    with pytest.raises(HTTPException) as exc:
        kb.get_article(db, TENANT, str(a.id), REQUESTER)
    assert exc.value.status_code == 403


def test_agent_may_read_draft(db):
    a = _article(db, status="Draft")
    db.add(HDAgent(tenant_id=TENANT, user=AGENT, agent_name=AGENT))
    db.commit()
    out = kb.get_article(db, TENANT, str(a.id), AGENT)
    assert out["status"] == "Draft"
    assert out["content"] == "<p>Click <b>reset</b>.</p>"


def test_cross_tenant_article_404(db):
    theirs = _article(db, tenant=OTHER)
    with pytest.raises(HTTPException) as exc:
        kb.get_article(db, TENANT, str(theirs.id), REQUESTER)
    assert exc.value.status_code == 404
