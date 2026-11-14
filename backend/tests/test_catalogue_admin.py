"""Service Catalogue admin CRUD (flow #5a) - create+list round-trip, duplicate
code -> 409, partial update, retire (reversible), dependency link add/remove
(+idempotent re-add), FK to a missing category -> 400, tenant isolation.

DB harness mirrors tests/test_itsm_import.py: in-memory SQLite, creating just
the tables under test with `<table>.create(engine)`. Router FUNCTIONS are
called directly with a Session and a fake tenant int (no HTTP/RBAC layer),
same as test_itsm_import.py calls `import_bundle(db, tid, ...)` directly.
"""
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import (
    HDBusinessService,
    HDRequestItem,
    HDServiceCategory,
    HDServiceDependency,
    HDTechnicalService,
    Team,
)
from grc.modules.helpdesk_native import catalogue_admin as ca

TENANT = 1
OTHER_TENANT = 2

ALL_TABLES = (
    Team,
    HDServiceCategory,
    HDBusinessService,
    HDTechnicalService,
    HDServiceDependency,
    HDRequestItem,
)


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    for m in ALL_TABLES:
        m.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()


# ─── service categories ────────────────────────────────────────────────────
def test_category_create_and_list_round_trip(db):
    out = ca.create_category(db, TENANT, ca.CategoryCreate(code="CAT-NET", name="Networking"))
    assert out["ok"] is True
    assert out["category"]["code"] == "CAT-NET"
    listed = ca.list_categories(db, TENANT)["categories"]
    assert len(listed) == 1
    assert listed[0]["name"] == "Networking" and listed[0]["enabled"] is True


def test_category_duplicate_code_409(db):
    ca.create_category(db, TENANT, ca.CategoryCreate(code="CAT-NET", name="Networking"))
    with pytest.raises(HTTPException) as ei:
        ca.create_category(db, TENANT, ca.CategoryCreate(code="CAT-NET", name="Networking 2"))
    assert ei.value.status_code == 409


def test_category_partial_update(db):
    out = ca.create_category(db, TENANT, ca.CategoryCreate(code="CAT-NET", name="Networking"))
    cid = out["category"]["id"]
    ca.update_category(db, TENANT, cid, ca.CategoryUpdate(description="LAN/WAN"))
    row = ca._get_category(db, TENANT, cid)
    assert row.description == "LAN/WAN" and row.name == "Networking"  # untouched field unchanged


def test_category_retire_sets_enabled_false_row_still_present(db):
    out = ca.create_category(db, TENANT, ca.CategoryCreate(code="CAT-NET", name="Networking"))
    cid = out["category"]["id"]
    ca.retire_category(db, TENANT, cid)
    row = ca._get_category(db, TENANT, cid)
    assert row.enabled is False
    assert db.query(HDServiceCategory).filter_by(id=cid).count() == 1


def test_category_fk_missing_parent_400(db):
    with pytest.raises(HTTPException) as ei:
        ca.create_category(db, TENANT, ca.CategoryCreate(code="CAT-SUB", name="Sub", parent_id=999))
    assert ei.value.status_code == 400


# ─── business services ─────────────────────────────────────────────────────
def test_business_service_create_and_list_round_trip(db):
    out = ca.create_business_service(
        db, TENANT, ca.BusinessServiceCreate(code="SVC-0001", name="Corporate Email"))
    assert out["ok"] is True
    listed = ca.list_business_services(db, TENANT)["services"]
    assert len(listed) == 1 and listed[0]["code"] == "SVC-0001"


def test_business_service_duplicate_code_409(db):
    ca.create_business_service(db, TENANT, ca.BusinessServiceCreate(code="SVC-0001", name="Email"))
    with pytest.raises(HTTPException) as ei:
        ca.create_business_service(db, TENANT, ca.BusinessServiceCreate(code="SVC-0001", name="Email 2"))
    assert ei.value.status_code == 409


def test_business_service_fk_missing_category_400(db):
    with pytest.raises(HTTPException) as ei:
        ca.create_business_service(
            db, TENANT, ca.BusinessServiceCreate(code="SVC-0001", name="Email", category_id=999))
    assert ei.value.status_code == 400


def test_business_service_partial_update(db):
    out = ca.create_business_service(db, TENANT, ca.BusinessServiceCreate(code="SVC-0001", name="Email"))
    sid = out["service"]["id"]
    ca.update_business_service(db, TENANT, sid, ca.BusinessServiceUpdate(criticality="Critical"))
    row = ca._get_business_service(db, TENANT, sid)
    assert row.criticality == "Critical" and row.name == "Email"


def test_business_service_retire_reversible(db):
    out = ca.create_business_service(db, TENANT, ca.BusinessServiceCreate(code="SVC-0001", name="Email"))
    sid = out["service"]["id"]
    ca.retire_business_service(db, TENANT, sid)
    row = ca._get_business_service(db, TENANT, sid)
    assert row.enabled is False
    assert db.query(HDBusinessService).filter_by(id=sid).count() == 1


# ─── technical services ─────────────────────────────────────────────────────
def test_technical_service_create_and_list_round_trip(db):
    out = ca.create_technical_service(
        db, TENANT, ca.TechnicalServiceCreate(code="SVC-T001", name="Mail Transport"))
    assert out["ok"] is True
    listed = ca.list_technical_services(db, TENANT)["technical"]
    assert len(listed) == 1 and listed[0]["code"] == "SVC-T001"


def test_technical_service_duplicate_code_409(db):
    ca.create_technical_service(db, TENANT, ca.TechnicalServiceCreate(code="SVC-T001", name="Mail"))
    with pytest.raises(HTTPException) as ei:
        ca.create_technical_service(db, TENANT, ca.TechnicalServiceCreate(code="SVC-T001", name="Mail 2"))
    assert ei.value.status_code == 409


def test_technical_service_retire_reversible(db):
    out = ca.create_technical_service(db, TENANT, ca.TechnicalServiceCreate(code="SVC-T001", name="Mail"))
    tyid = out["technical"]["id"]
    ca.retire_technical_service(db, TENANT, tyid)
    row = ca._get_technical_service(db, TENANT, tyid)
    assert row.enabled is False
    assert db.query(HDTechnicalService).filter_by(id=tyid).count() == 1


# ─── dependencies (M:N) ─────────────────────────────────────────────────────
def test_dependency_add_list_remove_and_idempotent_readd(db):
    svc = ca.create_business_service(db, TENANT, ca.BusinessServiceCreate(code="SVC-0001", name="Email"))["service"]
    tech = ca.create_technical_service(db, TENANT, ca.TechnicalServiceCreate(code="SVC-T001", name="Mail"))["technical"]

    ca.add_dependency(db, TENANT, svc["id"], ca.DependencyCreate(technical_service_id=tech["id"], criticality="High"))
    deps = ca.list_dependencies(db, TENANT, svc["id"])["dependencies"]
    assert len(deps) == 1 and deps[0]["technical_service_id"] == tech["id"]
    assert db.query(HDServiceDependency).count() == 1

    # idempotent re-add: no duplicate bridge row, criticality update applies
    ca.add_dependency(db, TENANT, svc["id"], ca.DependencyCreate(technical_service_id=tech["id"], criticality="Medium"))
    assert db.query(HDServiceDependency).count() == 1
    deps = ca.list_dependencies(db, TENANT, svc["id"])["dependencies"]
    assert deps[0]["criticality"] == "Medium"

    ca.remove_dependency(db, TENANT, svc["id"], tech["id"])
    assert db.query(HDServiceDependency).count() == 0
    # removing again (already gone) is a no-op, not an error
    ca.remove_dependency(db, TENANT, svc["id"], tech["id"])


def test_dependency_add_fk_missing_technical_service_400(db):
    svc = ca.create_business_service(db, TENANT, ca.BusinessServiceCreate(code="SVC-0001", name="Email"))["service"]
    with pytest.raises(HTTPException) as ei:
        ca.add_dependency(db, TENANT, svc["id"], ca.DependencyCreate(technical_service_id=999))
    assert ei.value.status_code == 400


# ─── request items ──────────────────────────────────────────────────────────
def test_request_item_create_and_list_round_trip(db):
    out = ca.create_request_item(db, TENANT, ca.RequestItemCreate(code="REQ-001", name="New Mailbox"))
    assert out["ok"] is True
    listed = ca.list_request_items(db, TENANT)["requests"]
    assert len(listed) == 1 and listed[0]["code"] == "REQ-001"


def test_request_item_duplicate_code_409(db):
    ca.create_request_item(db, TENANT, ca.RequestItemCreate(code="REQ-001", name="New Mailbox"))
    with pytest.raises(HTTPException) as ei:
        ca.create_request_item(db, TENANT, ca.RequestItemCreate(code="REQ-001", name="Dup"))
    assert ei.value.status_code == 409


def test_request_item_fk_missing_business_service_400(db):
    with pytest.raises(HTTPException) as ei:
        ca.create_request_item(
            db, TENANT, ca.RequestItemCreate(code="REQ-001", name="New Mailbox", business_service_id=999))
    assert ei.value.status_code == 400


def test_request_item_partial_update_and_retire(db):
    out = ca.create_request_item(db, TENANT, ca.RequestItemCreate(code="REQ-001", name="New Mailbox"))
    rid = out["request"]["id"]
    ca.update_request_item(db, TENANT, rid, ca.RequestItemUpdate(sla_hours=8))
    row = ca._get_request_item(db, TENANT, rid)
    assert row.sla_hours == 8 and row.name == "New Mailbox"

    ca.retire_request_item(db, TENANT, rid)
    row = ca._get_request_item(db, TENANT, rid)
    assert row.enabled is False
    assert db.query(HDRequestItem).filter_by(id=rid).count() == 1


# ─── tenant isolation ───────────────────────────────────────────────────────
def test_tenant_isolation_across_all_entities(db):
    cat1 = ca.create_category(db, TENANT, ca.CategoryCreate(code="CAT-NET", name="Networking"))["category"]
    svc1 = ca.create_business_service(db, TENANT, ca.BusinessServiceCreate(code="SVC-0001", name="Email"))["service"]
    tech1 = ca.create_technical_service(db, TENANT, ca.TechnicalServiceCreate(code="SVC-T001", name="Mail"))["technical"]
    req1 = ca.create_request_item(db, TENANT, ca.RequestItemCreate(code="REQ-001", name="New Mailbox"))["request"]

    # tenant 2 sees nothing of tenant 1's rows
    assert ca.list_categories(db, OTHER_TENANT)["categories"] == []
    assert ca.list_business_services(db, OTHER_TENANT)["services"] == []
    assert ca.list_technical_services(db, OTHER_TENANT)["technical"] == []
    assert ca.list_request_items(db, OTHER_TENANT)["requests"] == []

    # tenant 2 cannot fetch/update/retire tenant 1's rows by id -> 404
    for fn, args in (
        (ca._get_category, (OTHER_TENANT, cat1["id"])),
        (ca._get_business_service, (OTHER_TENANT, svc1["id"])),
        (ca._get_technical_service, (OTHER_TENANT, tech1["id"])),
        (ca._get_request_item, (OTHER_TENANT, req1["id"])),
    ):
        with pytest.raises(HTTPException) as ei:
            fn(db, *args)
        assert ei.value.status_code == 404

    # tenant 2 can reuse the same codes (unique is per-tenant, not global)
    out = ca.create_category(db, OTHER_TENANT, ca.CategoryCreate(code="CAT-NET", name="Networking (t2)"))
    assert out["ok"] is True
    assert len(ca.list_categories(db, TENANT)["categories"]) == 1
    assert len(ca.list_categories(db, OTHER_TENANT)["categories"]) == 1
