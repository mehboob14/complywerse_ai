"""Ticket <-> KB article linkage (Batch 4 linkage C) —
grc/modules/helpdesk_native/ticket_kb.py.

Covers: attach/list/detach (idempotent), cross-tenant article rejection (400),
tenant isolation of the attached list, and the subject-ranked "suggest" read
(title-token overlap, published-only, excludes already-linked, empty subject →
no suggestions). In-memory SQLite, direct function calls (mirrors the other
helpdesk_native unit tests).
"""
import os

os.environ.setdefault("SESSION_SECRET", "test-ticket-kb")

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import AuditLog, GRCUser, HDArticle, HDTicket, HDTicketKBLink
from grc.modules.helpdesk_native import ticket_kb

TENANT = 1
OTHER = 2

TABLES = (HDTicket, HDArticle, HDTicketKBLink, AuditLog, GRCUser)


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    for t in TABLES:
        t.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()


def _ticket(db, subject="VPN connection drops on laptop", tenant=TENANT):
    t = HDTicket(tenant_id=tenant, subject=subject, process="incident")
    db.add(t)
    db.commit()
    return t


def _article(db, title, status="Published", tenant=TENANT):
    a = HDArticle(tenant_id=tenant, title=title, status=status)
    db.add(a)
    db.commit()
    return a


# ═══════════════════════════════════════════════════════════════════════════
# attach / list / detach / validate
# ═══════════════════════════════════════════════════════════════════════════
def test_attach_list_detach(db):
    t = _ticket(db)
    a = _article(db, "VPN connection troubleshooting")
    assert ticket_kb.add_link(db, TENANT, str(t.id), a.id)["ok"] is True

    links = ticket_kb.list_links(db, TENANT, t)
    assert [x["name"] for x in links] == [str(a.id)]
    assert links[0]["url"] == "/helpdesk/kb"

    # idempotent attach
    ticket_kb.add_link(db, TENANT, str(t.id), a.id)
    assert db.query(HDTicketKBLink).count() == 1

    ticket_kb.remove_link(db, TENANT, str(t.id), a.id)
    assert ticket_kb.list_links(db, TENANT, t) == []
    # idempotent detach
    assert ticket_kb.remove_link(db, TENANT, str(t.id), a.id)["ok"] is True


def test_attach_cross_tenant_article_400(db):
    t = _ticket(db)
    theirs = _article(db, "Their article", tenant=OTHER)
    with pytest.raises(HTTPException) as exc:
        ticket_kb.add_link(db, TENANT, str(t.id), theirs.id)
    assert exc.value.status_code == 400


def test_list_links_tenant_isolated(db):
    t = _ticket(db)
    a = _article(db, "Article")
    db.add(HDTicketKBLink(tenant_id=OTHER, ticket_id=t.id, article_id=a.id))
    db.commit()
    assert ticket_kb.list_links(db, TENANT, t) == []


# ═══════════════════════════════════════════════════════════════════════════
# suggest
# ═══════════════════════════════════════════════════════════════════════════
def test_suggest_ranks_by_title_overlap_published_only(db):
    t = _ticket(db, "VPN connection drops on laptop")
    best = _article(db, "VPN connection troubleshooting")          # overlap 2
    ok = _article(db, "Laptop battery care")                        # overlap 1
    _article(db, "Email signature setup")                           # overlap 0 → excluded
    _article(db, "VPN connection full guide", status="Draft")       # not published → excluded

    out = ticket_kb.suggest(db, TENANT, t)
    names = [a["name"] for a in out]
    assert names[0] == str(best.id)        # highest overlap first
    assert str(ok.id) in names
    assert len(out) == 2                    # email + draft excluded


def test_suggest_excludes_already_linked(db):
    t = _ticket(db, "VPN connection drops on laptop")
    best = _article(db, "VPN connection troubleshooting")
    _article(db, "Laptop battery care")
    ticket_kb.add_link(db, TENANT, str(t.id), best.id)

    out = ticket_kb.suggest(db, TENANT, t)
    assert str(best.id) not in [a["name"] for a in out]


def test_suggest_empty_when_subject_has_no_tokens(db):
    t = _ticket(db, "the a an")          # all stop-words / too short
    _article(db, "VPN connection troubleshooting")
    assert ticket_kb.suggest(db, TENANT, t) == []
