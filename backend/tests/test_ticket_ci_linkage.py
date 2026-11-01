"""Ticket ↔ CMDB CI linkage (phase 2) — grc/modules/helpdesk_native/tickets.py
+ cmdb_admin.ci_tickets.

Covers spec §5: create/update with ci_id (valid, cross-tenant 400, retired 400),
business-service inheritance, list + detail payload (ci / business_service
objects), and the CI→tickets impact view incl. descendants (REL-CONTAINS /
REL-INSTALLED). Harness mirrors tests/test_cmdb_admin.py: in-memory SQLite, tables
created directly, service called with a plain Session (RBAC/HTTP layer bypassed).
"""
import os

os.environ.setdefault("SESSION_SECRET", "localdev-ci-link")

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import (
    AuditLog,
    GRCUser,
    HDBusinessService,
    HDCIRelationship,
    HDCIRelationshipType,
    HDCIType,
    HDCommunication,
    HDConfigurationItem,
    HDTicket,
    HDTicketActivity,
    HDTicketComment,
    HDTicketStatus,
    Tenant,
)
from grc.modules.helpdesk_native import cmdb_admin, tickets

TENANT = 1
OTHER = 2

TABLES = (
    Tenant, GRCUser, AuditLog, HDTicket, HDTicketStatus,
    HDCommunication, HDTicketComment, HDTicketActivity,
    HDConfigurationItem, HDBusinessService,
    HDCIType, HDCIRelationshipType, HDCIRelationship,
)


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


def _ci(db, code, name, tenant=TENANT, **kw):
    row = HDConfigurationItem(tenant_id=tenant, code=code, name=name, **kw)
    db.add(row)
    db.commit()
    return row


def _rel_type(db, code, name="rel"):
    row = HDCIRelationshipType(tenant_id=TENANT, code=code, name=name)
    db.add(row)
    db.commit()
    return row


def _edge(db, src, tgt, rt):
    db.add(HDCIRelationship(source_ci_id=src.id, target_ci_id=tgt.id, rel_type_id=rt.id))
    db.commit()


# ═══════════════════════════════════════════════════════════════════════════
# create: validation + business-service inheritance (§1)
# ═══════════════════════════════════════════════════════════════════════════
def test_create_links_valid_ci_and_inherits_business_service(db):
    svc = HDBusinessService(tenant_id=TENANT, code="SVC-1", name="Email")
    db.add(svc)
    db.commit()
    ci = _ci(db, "CI-1", "HOST-1", business_service_id=svc.id)

    res = tickets.create_ticket(db, TENANT, {"subject": "boom", "ci_id": ci.id})
    t = db.query(HDTicket).filter_by(id=int(res["name"])).one()
    assert t.ci_id == ci.id
    assert t.business_service_id == svc.id          # inherited from the CI


def test_create_explicit_business_service_wins_over_inheritance(db):
    svc_ci = HDBusinessService(tenant_id=TENANT, code="SVC-A", name="A")
    svc_pick = HDBusinessService(tenant_id=TENANT, code="SVC-B", name="B")
    db.add_all([svc_ci, svc_pick])
    db.commit()
    ci = _ci(db, "CI-2", "HOST-2", business_service_id=svc_ci.id)

    res = tickets.create_ticket(db, TENANT, {"subject": "x", "ci_id": ci.id,
                                             "business_service_id": svc_pick.id})
    t = db.query(HDTicket).filter_by(id=int(res["name"])).one()
    assert t.business_service_id == svc_pick.id     # explicit beats inheritance


def test_create_cross_tenant_ci_400(db):
    other_ci = _ci(db, "CI-X", "theirs", tenant=OTHER)
    with pytest.raises(HTTPException) as exc:
        tickets.create_ticket(db, TENANT, {"subject": "x", "ci_id": other_ci.id})
    assert exc.value.status_code == 400


def test_create_retired_ci_400(db):
    ci = _ci(db, "CI-R", "dead", status="retired")
    with pytest.raises(HTTPException) as exc:
        tickets.create_ticket(db, TENANT, {"subject": "x", "ci_id": ci.id})
    assert exc.value.status_code == 400


def test_create_cross_tenant_business_service_400(db):
    other_svc = HDBusinessService(tenant_id=OTHER, code="SVC-O", name="theirs")
    db.add(other_svc)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        tickets.create_ticket(db, TENANT, {"subject": "x", "business_service_id": other_svc.id})
    assert exc.value.status_code == 400


# ═══════════════════════════════════════════════════════════════════════════
# update: set / clear / validate (§1)
# ═══════════════════════════════════════════════════════════════════════════
def test_update_sets_and_clears_ci(db):
    ci = _ci(db, "CI-U", "HOST-U")
    res = tickets.create_ticket(db, TENANT, {"subject": "u"})
    name = res["name"]

    tickets.update(db, TENANT, name, {"ci_id": ci.id})
    t = db.query(HDTicket).filter_by(id=int(name)).one()
    assert t.ci_id == ci.id

    # explicit null clears (the /update route passes exclude_unset so null survives)
    tickets.update(db, TENANT, name, {"ci_id": None})
    db.refresh(t)
    assert t.ci_id is None


def test_update_inherits_business_service_from_ci(db):
    svc = HDBusinessService(tenant_id=TENANT, code="SVC-U", name="Email")
    db.add(svc)
    db.commit()
    ci = _ci(db, "CI-UB", "HOST-UB", business_service_id=svc.id)
    name = tickets.create_ticket(db, TENANT, {"subject": "u"})["name"]

    tickets.update(db, TENANT, name, {"ci_id": ci.id})
    t = db.query(HDTicket).filter_by(id=int(name)).one()
    assert t.business_service_id == svc.id


def test_update_cross_tenant_ci_400(db):
    other_ci = _ci(db, "CI-XU", "theirs", tenant=OTHER)
    name = tickets.create_ticket(db, TENANT, {"subject": "u"})["name"]
    with pytest.raises(HTTPException) as exc:
        tickets.update(db, TENANT, name, {"ci_id": other_ci.id})
    assert exc.value.status_code == 400


# ═══════════════════════════════════════════════════════════════════════════
# list + detail payload (§2)
# ═══════════════════════════════════════════════════════════════════════════
def test_list_and_detail_carry_ci_and_business_service(db):
    cit = HDCIType(tenant_id=TENANT, code="CIT-WEBSVC", name="Web Service")
    db.add(cit)
    db.commit()
    svc = HDBusinessService(tenant_id=TENANT, code="SVC-L", name="Payments")
    db.add(svc)
    db.commit()
    ci = _ci(db, "CV-DOM-ex.com", "ex.com", ci_type_id=cit.id, business_service_id=svc.id,
             attributes={"ava": {"kind": "domain", "network": {"internet_facing": True},
                                 "compliance": {"pci": True}, "source": {"category": "easm"}}})
    name = tickets.create_ticket(db, TENANT, {"subject": "L", "ci_id": ci.id})["name"]

    row = next(r for r in tickets.list_tickets(db, TENANT)["tickets"] if r["name"] == name)
    assert row["ci"]["code"] == "CV-DOM-ex.com"
    assert row["ci"]["ci_kind"] == "domain"
    assert row["ci"]["exposure"] == "external"
    assert row["ci"]["pci"] is True and row["ci"]["internet_facing"] is True
    assert row["ci"]["managed_by_inventory"] is True
    assert row["business_service"] == {"id": svc.id, "name": "Payments"}

    detail = tickets.get_detail(db, TENANT, name)["ticket"]
    assert detail["ci"]["id"] == ci.id and detail["ci"]["ci_type"] == "Web Service"
    assert detail["business_service"]["name"] == "Payments"


def test_list_ci_null_when_unset(db):
    name = tickets.create_ticket(db, TENANT, {"subject": "none"})["name"]
    row = next(r for r in tickets.list_tickets(db, TENANT)["tickets"] if r["name"] == name)
    assert row["ci"] is None and row["business_service"] is None


# ═══════════════════════════════════════════════════════════════════════════
# CI → tickets impact view incl. descendants (§3)
# ═══════════════════════════════════════════════════════════════════════════
def _ticket_on(db, subject, ci):
    t = HDTicket(tenant_id=TENANT, subject=subject, process="incident", ci_id=ci.id)
    db.add(t)
    db.commit()
    return t


def test_ci_tickets_includes_contains_and_installed_descendants(db):
    contains = _rel_type(db, "REL-CONTAINS", "Contains")
    installed = _rel_type(db, "REL-INSTALLED", "Installed on")
    domain = _ci(db, "CV-DOM-ex.com", "ex.com")
    endpoint = _ci(db, "AVA-2", "www.ex.com")
    host = _ci(db, "AVA-9", "HOST-9")
    software = _ci(db, "CV-SW-9-chrome", "Chrome")
    _edge(db, domain, endpoint, contains)      # domain contains endpoint
    _edge(db, software, host, installed)       # software installed on host

    _ticket_on(db, "on-domain", domain)
    _ticket_on(db, "on-endpoint", endpoint)
    _ticket_on(db, "on-host", host)
    _ticket_on(db, "on-software", software)

    dom = cmdb_admin.ci_tickets(domain.id, db=db, _=True)["tickets"]
    assert {t["subject"] for t in dom} == {"on-domain", "on-endpoint"}

    hst = cmdb_admin.ci_tickets(host.id, db=db, _=True)["tickets"]
    assert {t["subject"] for t in hst} == {"on-host", "on-software"}

    # a leaf endpoint sees only its own ticket
    ep = cmdb_admin.ci_tickets(endpoint.id, db=db, _=True)["tickets"]
    assert {t["subject"] for t in ep} == {"on-endpoint"}
    assert ep[0]["process"] == "incident"


def test_ci_tickets_cycle_safe(db):
    # a corrupt A→B→A containment cycle must not hang the traversal
    contains = _rel_type(db, "REL-CONTAINS", "Contains")
    a = _ci(db, "CI-CA", "A")
    b = _ci(db, "CI-CB", "B")
    _edge(db, a, b, contains)
    _edge(db, b, a, contains)
    _ticket_on(db, "ta", a)
    _ticket_on(db, "tb", b)
    out = cmdb_admin.ci_tickets(a.id, db=db, _=True)["tickets"]
    assert {t["subject"] for t in out} == {"ta", "tb"}


def test_ci_tickets_missing_ci_404(db):
    with pytest.raises(HTTPException) as exc:
        cmdb_admin.ci_tickets(9999, db=db, _=True)
    assert exc.value.status_code == 404
