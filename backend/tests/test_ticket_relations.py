"""ITIL cross-process relationships (Batch 4 linkage A) —
grc/modules/helpdesk_native/relations.py + change.set_origin.

Covers: a change linked to its originating incident/problem (origin columns),
reverse surfacing (incident -> parent problem(s); problem -> incidents + its
changes; change -> origin), validation (self / non-incident-problem / cross-
tenant origin all 400), and tenant isolation of the reverse resolver. Harness
mirrors tests/test_change_cab_exposure.py: in-memory SQLite, tables created
directly, functions called with a plain Session (RBAC/HTTP layer bypassed).
"""
import json
import os

os.environ.setdefault("SESSION_SECRET", "test-ticket-relations")

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import AuditLog, GRCUser, HDTicket, HDTicketStatus, Tenant
from grc.modules.helpdesk_native import change as change_mod, relations

TENANT = 1
OTHER = 2

TABLES = (Tenant, GRCUser, AuditLog, HDTicket, HDTicketStatus)


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    for t in TABLES:
        t.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=TENANT, name="Acme", slug="acme"))
    s.add(Tenant(id=OTHER, name="Other", slug="other"))
    s.commit()
    yield s
    s.close()


def _ticket(db, process, subject, tenant=TENANT, **kw):
    t = HDTicket(tenant_id=tenant, subject=subject, process=process, **kw)
    db.add(t)
    db.commit()
    return t


# ═══════════════════════════════════════════════════════════════════════════
# change -> origin (set / infer / unlink)
# ═══════════════════════════════════════════════════════════════════════════
def test_link_origin_sets_columns_and_infers_process(db):
    inc = _ticket(db, "incident", "disk full")
    chg = _ticket(db, "change", "add disk", approval_state="draft")
    r = change_mod.set_origin(db, TENANT, chg.id, inc.id, "agent@x.com")
    assert r["ok"] is True
    db.refresh(chg)
    assert chg.origin_ticket_id == inc.id
    assert chg.origin_process == "incident"          # inferred from the target


def test_link_origin_problem(db):
    prob = _ticket(db, "problem", "root cause")
    chg = _ticket(db, "change", "fix", approval_state="draft")
    change_mod.set_origin(db, TENANT, chg.id, prob.id, "agent@x.com")
    db.refresh(chg)
    assert chg.origin_process == "problem"


def test_unlink_origin_clears(db):
    inc = _ticket(db, "incident", "x")
    chg = _ticket(db, "change", "c", origin_ticket_id=inc.id, origin_process="incident")
    change_mod.set_origin(db, TENANT, chg.id, None, "agent@x.com")
    db.refresh(chg)
    assert chg.origin_ticket_id is None and chg.origin_process is None


def test_link_origin_rejects_self(db):
    chg = _ticket(db, "change", "c")
    with pytest.raises(HTTPException) as exc:
        change_mod.set_origin(db, TENANT, chg.id, chg.id, "a@x.com")
    assert exc.value.status_code == 400


def test_link_origin_rejects_non_incident_problem(db):
    other_change = _ticket(db, "change", "other")
    chg = _ticket(db, "change", "c")
    with pytest.raises(HTTPException) as exc:
        change_mod.set_origin(db, TENANT, chg.id, other_change.id, "a@x.com")
    assert exc.value.status_code == 400


def test_link_origin_rejects_cross_tenant(db):
    their_inc = _ticket(db, "incident", "theirs", tenant=OTHER)
    chg = _ticket(db, "change", "c")
    with pytest.raises(HTTPException) as exc:
        change_mod.set_origin(db, TENANT, chg.id, their_inc.id, "a@x.com")
    assert exc.value.status_code == 400


def test_set_origin_on_non_change_rejected(db):
    inc = _ticket(db, "incident", "i")
    target = _ticket(db, "problem", "p")
    with pytest.raises(HTTPException) as exc:
        change_mod.set_origin(db, TENANT, inc.id, target.id, "a@x.com")
    assert exc.value.status_code == 400


# ═══════════════════════════════════════════════════════════════════════════
# reverse resolution (related_block)
# ═══════════════════════════════════════════════════════════════════════════
def test_change_related_shows_origin(db):
    inc = _ticket(db, "incident", "disk full")
    chg = _ticket(db, "change", "add disk")
    change_mod.set_origin(db, TENANT, chg.id, inc.id, "a@x.com")
    db.refresh(chg)
    rel = relations.related_block(db, TENANT, chg)["related"]
    assert rel["origin"]["name"] == str(inc.id)
    assert rel["origin"]["process"] == "incident"


def test_incident_related_shows_parent_problem_and_changes(db):
    inc = _ticket(db, "incident", "disk full")
    prob = _ticket(db, "problem", "root cause",
                   linked_incident_ids=json.dumps([inc.id]))
    chg = _ticket(db, "change", "fix")
    change_mod.set_origin(db, TENANT, chg.id, inc.id, "a@x.com")

    rel = relations.related_block(db, TENANT, inc)["related"]
    assert [p["name"] for p in rel["problems"]] == [str(prob.id)]
    assert [c["name"] for c in rel["changes"]] == [str(chg.id)]


def test_problem_related_shows_incidents_and_changes(db):
    inc = _ticket(db, "incident", "disk full")
    prob = _ticket(db, "problem", "root cause",
                   linked_incident_ids=json.dumps([inc.id]))
    chg = _ticket(db, "change", "fix")
    change_mod.set_origin(db, TENANT, chg.id, prob.id, "a@x.com")

    rel = relations.related_block(db, TENANT, prob)["related"]
    assert [i["name"] for i in rel["incidents"]] == [str(inc.id)]
    assert [c["name"] for c in rel["changes"]] == [str(chg.id)]


def test_related_block_is_tenant_isolated(db):
    # a problem in OTHER referencing an id that collides with THIS tenant's
    # incident id must not surface across the tenant boundary.
    inc = _ticket(db, "incident", "ours")
    _ticket(db, "problem", "theirs", tenant=OTHER,
            linked_incident_ids=json.dumps([inc.id]))
    rel = relations.related_block(db, TENANT, inc)["related"]
    assert rel["problems"] == []


def test_related_block_tolerates_corrupt_linked_ids(db):
    inc = _ticket(db, "incident", "i")
    _ticket(db, "problem", "p", linked_incident_ids="not json")
    rel = relations.related_block(db, TENANT, inc)["related"]
    assert rel["problems"] == []
