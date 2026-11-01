"""CMDB admin CRUD (flow #5b) - grc/modules/helpdesk_native/cmdb_admin.py.

cmdb_admin.router is not registered on the app yet (a parallel agent owns
router.py), so these tests call the router FUNCTIONS directly with a plain
Session + a fake tenant id, bypassing FastAPI's Depends/HTTP layer entirely
(the `_` RBAC param is satisfied by passing True — the dependency callables
themselves are never invoked).

DB harness mirrors tests/test_itsm_import.py: in-memory SQLite, creating just
the tables under test with `<table>.create(engine)` / `Base.metadata`.
"""
import os

os.environ.setdefault("SESSION_SECRET", "localdev-cmdb")

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import (
    HDBusinessService,
    HDCIAttribute,
    HDCIRelationship,
    HDCIRelationshipType,
    HDCIType,
    HDConfigurationItem,
    Tenant,
)
from grc.modules.helpdesk_native import cmdb_admin as m

TENANT = 1
OTHER_TENANT = 2

TABLES = (
    Tenant, HDCIType, HDCIAttribute, HDConfigurationItem,
    HDCIRelationshipType, HDCIRelationship, HDBusinessService,
)


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    for t in TABLES:
        t.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=TENANT, name="Acme", slug="acme"))
    s.commit()
    yield s
    s.close()


def _ci_type(db, code="CIT-SRV", name="Server", tenant=TENANT, **kw):
    row = HDCIType(tenant_id=tenant, code=code, name=name, **kw)
    db.add(row)
    db.commit()
    return row


def _ci(db, code="CI-0001", name="HOST-01", tenant=TENANT, **kw):
    row = HDConfigurationItem(tenant_id=tenant, code=code, name=name, **kw)
    db.add(row)
    db.commit()
    return row


def _rel_type(db, code="REL-RUN", name="Runs on", tenant=TENANT, **kw):
    row = HDCIRelationshipType(tenant_id=tenant, code=code, name=name, **kw)
    db.add(row)
    db.commit()
    return row


# ═══════════════════════════════════════════════════════════════════════════
# CI types
# ═══════════════════════════════════════════════════════════════════════════
def test_ci_type_create_and_list(db):
    m.create_ci_type(m.CITypeCreate(code="CIT-SRV", name="Server"), db=db, _=True)
    out = m.list_ci_types(db=db, _=True)
    assert len(out["ci_types"]) == 1
    row = out["ci_types"][0]
    assert row["code"] == "CIT-SRV"
    assert row["name"] == "Server"
    assert row["parent"] is None


def test_ci_type_with_parent(db):
    parent = _ci_type(db, code="CIT-SRV", name="Server")
    m.create_ci_type(m.CITypeCreate(code="CIT-VM", name="Virtual Machine", parent_id=parent.id),
                      db=db, _=True)
    out = m.list_ci_types(db=db, _=True)
    child = next(t for t in out["ci_types"] if t["code"] == "CIT-VM")
    assert child["parent"]["code"] == "CIT-SRV"


def test_ci_type_duplicate_code_409(db):
    _ci_type(db, code="CIT-SRV", name="Server")
    with pytest.raises(HTTPException) as exc:
        m.create_ci_type(m.CITypeCreate(code="CIT-SRV", name="Server 2"), db=db, _=True)
    assert exc.value.status_code == 409


def test_ci_type_update(db):
    row = _ci_type(db)
    m.update_ci_type(row.id, m.CITypeUpdate(name="Server (renamed)"), db=db, _=True)
    out = m.list_ci_types(db=db, _=True)
    assert out["ci_types"][0]["name"] == "Server (renamed)"


def test_ci_type_update_bad_parent_fk_400(db):
    row = _ci_type(db)
    with pytest.raises(HTTPException) as exc:
        m.update_ci_type(row.id, m.CITypeUpdate(parent_id=9999), db=db, _=True)
    assert exc.value.status_code == 400


def test_delete_ci_type_with_cis_409(db):
    cit = _ci_type(db)
    _ci(db, ci_type_id=cit.id)
    with pytest.raises(HTTPException) as exc:
        m.delete_ci_type(cit.id, db=db, _=True)
    assert exc.value.status_code == 409


def test_delete_ci_type_without_cis_ok(db):
    cit = _ci_type(db)
    m.delete_ci_type(cit.id, db=db, _=True)
    assert m.list_ci_types(db=db, _=True)["ci_types"] == []


# ═══════════════════════════════════════════════════════════════════════════
# CI attributes
# ═══════════════════════════════════════════════════════════════════════════
def test_attribute_add_list_delete(db):
    cit = _ci_type(db)
    m.create_ci_attribute(cit.id, m.AttributeCreate(name="OS Version", datatype="string"),
                           db=db, _=True)
    out = m.list_ci_attributes(cit.id, db=db, _=True)
    assert len(out["attributes"]) == 1
    attr_id = out["attributes"][0]["id"]
    assert out["attributes"][0]["name"] == "OS Version"

    m.delete_ci_attribute(attr_id, db=db, _=True)
    assert m.list_ci_attributes(cit.id, db=db, _=True)["attributes"] == []


def test_attribute_duplicate_name_409(db):
    cit = _ci_type(db)
    m.create_ci_attribute(cit.id, m.AttributeCreate(name="OS Version"), db=db, _=True)
    with pytest.raises(HTTPException) as exc:
        m.create_ci_attribute(cit.id, m.AttributeCreate(name="OS Version"), db=db, _=True)
    assert exc.value.status_code == 409


def test_attribute_for_missing_type_404(db):
    with pytest.raises(HTTPException) as exc:
        m.list_ci_attributes(9999, db=db, _=True)
    assert exc.value.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════
# CIs
# ═══════════════════════════════════════════════════════════════════════════
def test_ci_create_list_filter(db):
    cit = _ci_type(db)
    svc = HDBusinessService(tenant_id=TENANT, code="SVC-0001", name="Email")
    db.add(svc)
    db.commit()

    m.create_ci(m.CICreate(code="CI-0001", name="HOST-01", ci_type_id=cit.id,
                            business_service_id=svc.id), db=db, _=True)
    m.create_ci(m.CICreate(code="CI-0002", name="HOST-02"), db=db, _=True)

    out = m.list_cis(ci_type_id=None, business_service_id=None, db=db, _=True)
    assert len(out["cis"]) == 2

    filtered = m.list_cis(ci_type_id=cit.id, business_service_id=None, db=db, _=True)
    assert [c["code"] for c in filtered["cis"]] == ["CI-0001"]
    assert filtered["cis"][0]["business_service"] == "Email"

    by_svc = m.list_cis(ci_type_id=None, business_service_id=svc.id, db=db, _=True)
    assert [c["code"] for c in by_svc["cis"]] == ["CI-0001"]


def test_ci_duplicate_code_409(db):
    _ci(db)
    with pytest.raises(HTTPException) as exc:
        m.create_ci(m.CICreate(code="CI-0001", name="dup"), db=db, _=True)
    assert exc.value.status_code == 409


def test_ci_create_bad_type_fk_400(db):
    with pytest.raises(HTTPException) as exc:
        m.create_ci(m.CICreate(code="CI-0001", name="HOST-01", ci_type_id=9999), db=db, _=True)
    assert exc.value.status_code == 400


def test_ci_retire_sets_status_row_present(db):
    ci = _ci(db, status="in_use")
    m.retire_ci(ci.id, db=db, _=True)
    out = m.list_cis(ci_type_id=None, business_service_id=None, db=db, _=True)
    assert len(out["cis"]) == 1
    assert out["cis"][0]["status"] == "retired"


# ═══════════════════════════════════════════════════════════════════════════
# inventory-sync surface: top_level tri-state + managed-CI guards
# ═══════════════════════════════════════════════════════════════════════════
def _managed(db, code, name, **kw):
    attrs = kw.pop("attributes", {"ava": {"kind": "host", "asset_id": 1}})
    return _ci(db, code=code, name=name, attributes=attrs, **kw)


def test_cis_top_level_tristate_and_parent_child(db):
    cit = _ci_type(db, code="CIT-WEBSVC", name="Web Service")
    domain = _ci(db, code="CV-DOM-ex.com", name="ex.com", ci_type_id=cit.id,
                 attributes={"ava": {"kind": "domain"}})
    endpoint = _ci(db, code="AVA-2", name="www.ex.com", ci_type_id=cit.id,
                   attributes={"ava": {"kind": "endpoint"}})
    rt = _rel_type(db, code="REL-CONTAINS", name="Contains")
    m.create_relationship(m.RelationshipCreate(source_ci_id=domain.id, target_ci_id=endpoint.id,
                                                rel_type_id=rt.id), db=db, _=True)

    roots = m.list_cis(ci_type_id=None, business_service_id=None, top_level=True, db=db, _=True)["cis"]
    assert {c["code"] for c in roots} == {"CV-DOM-ex.com"}
    assert roots[0]["child_count"] == 1
    assert roots[0]["parent_ci_id"] is None
    assert roots[0]["ci_kind"] == "domain"

    children = m.list_cis(ci_type_id=None, business_service_id=None, top_level=False, db=db, _=True)["cis"]
    assert {c["code"] for c in children} == {"AVA-2"}
    assert children[0]["parent_ci_id"] == domain.id
    assert children[0]["ci_kind"] == "endpoint"

    both = m.list_cis(ci_type_id=None, business_service_id=None, db=db, _=True)["cis"]
    assert len(both) == 2


def test_patch_managed_ci_blocks_owned_fields(db):
    cit = _ci_type(db, code="CIT-SERVER", name="Server")
    svc = HDBusinessService(tenant_id=TENANT, code="SVC-1", name="Email")
    db.add(svc)
    db.commit()
    ci = _managed(db, "AVA-1", "HOST-1", ci_type_id=cit.id, status="in_use",
                  attributes={"ava": {"kind": "host", "asset_id": 1}, "hostname": "h1"})

    # changing an inventory-owned field → 409
    with pytest.raises(HTTPException) as exc:
        m.update_ci(ci.id, m.CIUpdate(name="renamed"), db=db, _=True)
    assert exc.value.status_code == 409

    # identical value passes (no-op)
    m.update_ci(ci.id, m.CIUpdate(name="HOST-1"), db=db, _=True)

    # business_service_id stays editable
    m.update_ci(ci.id, m.CIUpdate(business_service_id=svc.id), db=db, _=True)
    db.refresh(ci)
    assert ci.business_service_id == svc.id

    # attributes patch preserves the stored ava mirror, ignoring client-sent ava
    m.update_ci(ci.id, m.CIUpdate(attributes={"note": "x", "ava": {"kind": "HIJACK"}}),
                db=db, _=True)
    db.refresh(ci)
    assert ci.attributes["ava"]["kind"] == "host"   # not overwritten
    assert ci.attributes["note"] == "x"


def test_patch_unmanaged_ci_unrestricted(db):
    ci = _ci(db, code="CI-M", name="manual", status="in_use")  # no ava
    m.update_ci(ci.id, m.CIUpdate(name="renamed", status="retired"), db=db, _=True)
    db.refresh(ci)
    assert ci.name == "renamed"
    assert ci.status == "retired"


def test_retire_managed_ci_blocked_manual_ok(db):
    managed = _managed(db, "AVA-9", "HOST-9")
    with pytest.raises(HTTPException) as exc:
        m.retire_ci(managed.id, db=db, _=True)
    assert exc.value.status_code == 409

    manual = _ci(db, code="CI-MAN", name="manual-ci")
    m.retire_ci(manual.id, db=db, _=True)
    db.refresh(manual)
    assert manual.status == "retired"


# ═══════════════════════════════════════════════════════════════════════════
# relationships (+ relationship types) + graph
# ═══════════════════════════════════════════════════════════════════════════
def test_relationship_add_idempotent_unlink(db):
    a = _ci(db, code="CI-A", name="A")
    b = _ci(db, code="CI-B", name="B")
    rt = _rel_type(db)

    r1 = m.create_relationship(m.RelationshipCreate(source_ci_id=a.id, target_ci_id=b.id,
                                                      rel_type_id=rt.id), db=db, _=True)
    r2 = m.create_relationship(m.RelationshipCreate(source_ci_id=a.id, target_ci_id=b.id,
                                                      rel_type_id=rt.id), db=db, _=True)
    assert r1["id"] == r2["id"]
    assert len(m.list_relationships(db=db, _=True)["relationships"]) == 1

    m.delete_relationship(r1["id"], db=db, _=True)
    assert m.list_relationships(db=db, _=True)["relationships"] == []


def test_relationship_bad_ci_fk_400(db):
    rt = _rel_type(db)
    b = _ci(db, code="CI-B", name="B")
    with pytest.raises(HTTPException) as exc:
        m.create_relationship(m.RelationshipCreate(source_ci_id=9999, target_ci_id=b.id,
                                                     rel_type_id=rt.id), db=db, _=True)
    assert exc.value.status_code == 400


def test_relationship_type_create_list_duplicate(db):
    m.create_relationship_type(m.RelTypeCreate(code="REL-RUN", name="Runs on"), db=db, _=True)
    out = m.list_relationship_types(db=db, _=True)
    assert len(out["relationship_types"]) == 1
    with pytest.raises(HTTPException) as exc:
        m.create_relationship_type(m.RelTypeCreate(code="REL-RUN", name="dup"), db=db, _=True)
    assert exc.value.status_code == 409


def test_graph_nodes_and_edges(db):
    a = _ci(db, code="CI-A", name="A")
    b = _ci(db, code="CI-B", name="B")
    rt = _rel_type(db)
    m.create_relationship(m.RelationshipCreate(source_ci_id=a.id, target_ci_id=b.id,
                                                rel_type_id=rt.id), db=db, _=True)

    graph = m.get_graph(db=db, _=True)
    assert {n["code"] for n in graph["nodes"]} == {"CI-A", "CI-B"}
    assert len(graph["edges"]) == 1
    edge = graph["edges"][0]
    assert edge["source"] == a.id
    assert edge["target"] == b.id
    assert edge["rel_name"] == "Runs on"


# ═══════════════════════════════════════════════════════════════════════════
# tenant isolation
# ═══════════════════════════════════════════════════════════════════════════
def test_tenant_isolation(db):
    mine = _ci_type(db, code="CIT-MINE", name="Mine", tenant=TENANT)
    _ci_type(db, code="CIT-THEIRS", name="Theirs", tenant=OTHER_TENANT)

    out = m.list_ci_types(db=db, _=True)
    assert [t["code"] for t in out["ci_types"]] == ["CIT-MINE"]

    # the other tenant's row is invisible even by direct id lookup.
    other = db.query(HDCIType).filter(HDCIType.tenant_id == OTHER_TENANT).first()
    with pytest.raises(HTTPException) as exc:
        m.update_ci_type(other.id, m.CITypeUpdate(name="hijacked"), db=db, _=True)
    assert exc.value.status_code == 404

    other_ci = _ci(db, code="CI-THEIRS", name="theirs", tenant=OTHER_TENANT)
    assert mine  # sanity: fixture created
    out_cis = m.list_cis(ci_type_id=None, business_service_id=None, db=db, _=True)
    assert all(c["code"] != "CI-THEIRS" for c in out_cis["cis"])
    with pytest.raises(HTTPException) as exc:
        m.retire_ci(other_ci.id, db=db, _=True)
    assert exc.value.status_code == 404
