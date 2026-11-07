"""Governance + org-mapping admin CRUD (flow #5c): priority matrix, SLA targets,
change types, change risk matrix, CAB model, state transitions, incident
category tree, departments, role map, support-group map.

Harness mirrors tests/test_catalogue_admin.py: in-memory SQLite, creating just
the tables under test; router FUNCTIONS are called directly with a Session and a
fake tenant int (no HTTP/RBAC layer).
"""
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import (
    HDCABConfig,
    HDChangeRiskMatrix,
    HDChangeType,
    HDDepartment,
    HDIncidentCategory,
    HDKPI,
    HDPriorityMatrix,
    HDRoleMap,
    HDSLATarget,
    HDStateTransition,
    HDSupportGroupMap,
    HDTicketPriority,
    HDTicketStatus,
    Team,
)
from grc.modules.helpdesk_native import governance_admin as ga

TENANT = 1
OTHER = 2

ALL_TABLES = (
    Team,
    HDTicketPriority,
    HDTicketStatus,
    HDPriorityMatrix,
    HDSLATarget,
    HDChangeType,
    HDChangeRiskMatrix,
    HDCABConfig,
    HDStateTransition,
    HDIncidentCategory,
    HDDepartment,
    HDRoleMap,
    HDSupportGroupMap,
    HDKPI,
)


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    for m in ALL_TABLES:
        m.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()


def _priority(db, tid=TENANT, code="P1", name="Critical"):
    p = HDTicketPriority(tenant_id=tid, name=name, level="Urgent", code=code, rank=1)
    db.add(p)
    db.commit()
    return p


def _status(db, label, tid=TENANT):
    s = HDTicketStatus(tenant_id=tid, label_agent=label, category="Open")
    db.add(s)
    db.commit()
    return s


def _team(db, name="Network", tid=TENANT):
    t = Team(tenant_id=tid, name=name)
    db.add(t)
    db.commit()
    return t


def _raises(code, fn, *a, **kw):
    with pytest.raises(HTTPException) as ei:
        fn(*a, **kw)
    assert ei.value.status_code == code
    return ei.value


# ─── priority matrix ───────────────────────────────────────────────────────
def test_priority_matrix_put_list_round_trip(db):
    p = _priority(db)
    out = ga.put_priority_cell(db, TENANT, ga.PriorityMatrixPut(impact="high", urgency="high", priority_id=p.id))
    assert out["created"] is True and out["cell"]["priority_code"] == "P1"
    cells = ga.list_priority_matrix(db, TENANT)["cells"]
    assert len(cells) == 1 and cells[0]["impact"] == "high" and cells[0]["priority"] == "Critical"


def test_priority_matrix_reput_updates_in_place_no_duplicate(db):
    p1 = _priority(db)
    p2 = _priority(db, code="P2", name="High")
    first = ga.put_priority_cell(db, TENANT, ga.PriorityMatrixPut(impact="high", urgency="low", priority_id=p1.id))
    second = ga.put_priority_cell(db, TENANT, ga.PriorityMatrixPut(impact="high", urgency="low", priority_id=p2.id))
    assert second["created"] is False
    assert second["cell"]["id"] == first["cell"]["id"] and second["cell"]["priority_id"] == p2.id
    assert db.query(HDPriorityMatrix).count() == 1


def test_priority_matrix_bad_priority_400(db):
    _raises(400, ga.put_priority_cell, db, TENANT,
            ga.PriorityMatrixPut(impact="high", urgency="high", priority_id=999))


def test_priority_matrix_priority_from_other_tenant_400(db):
    foreign = _priority(db, tid=OTHER)
    _raises(400, ga.put_priority_cell, db, TENANT,
            ga.PriorityMatrixPut(impact="high", urgency="high", priority_id=foreign.id))


def test_priority_matrix_delete_and_404(db):
    p = _priority(db)
    cid = ga.put_priority_cell(db, TENANT, ga.PriorityMatrixPut(impact="a", urgency="b", priority_id=p.id))["cell"]["id"]
    ga.delete_priority_cell(db, TENANT, cid)
    assert db.query(HDPriorityMatrix).count() == 0
    _raises(404, ga.delete_priority_cell, db, TENANT, cid)


# ─── SLA targets ───────────────────────────────────────────────────────────
def test_sla_target_create_list_round_trip(db):
    out = ga.create_sla_target(db, TENANT, ga.SLATargetCreate(
        process="incident", priority_label="P1 - Critical", priority_code="P1",
        service_window="24x7", response_minutes=15, resolution_minutes=240, notes="n"))
    assert out["target"]["response_minutes"] == 15
    listed = ga.list_sla_targets(db, TENANT)["targets"]
    assert len(listed) == 1 and listed[0]["priority_code"] == "P1"
    assert ga.list_sla_targets(db, TENANT, "change")["targets"] == []


def test_sla_target_duplicate_409_including_null_window(db):
    body = ga.SLATargetCreate(process="change", priority_label="Standard")
    ga.create_sla_target(db, TENANT, body)
    _raises(409, ga.create_sla_target, db, TENANT, body)


def test_sla_target_validation_400(db):
    _raises(400, ga.create_sla_target, db, TENANT,
            ga.SLATargetCreate(process="bogus", priority_label="P1"))
    _raises(400, ga.create_sla_target, db, TENANT,
            ga.SLATargetCreate(process="incident", priority_label="P1", response_minutes=-5))


def test_sla_target_patch_and_delete(db):
    sid = ga.create_sla_target(db, TENANT, ga.SLATargetCreate(
        process="incident", priority_label="P2", service_window="24x7",
        response_minutes=30, resolution_minutes=480))["target"]["id"]
    out = ga.update_sla_target(db, TENANT, sid, ga.SLATargetUpdate(resolution_minutes=600))
    assert out["target"]["resolution_minutes"] == 600 and out["target"]["response_minutes"] == 30
    # patching into another existing key collides -> 409
    ga.create_sla_target(db, TENANT, ga.SLATargetCreate(process="incident", priority_label="P3", service_window="24x7"))
    _raises(409, ga.update_sla_target, db, TENANT, sid, ga.SLATargetUpdate(priority_label="P3"))
    ga.delete_sla_target(db, TENANT, sid)
    _raises(404, ga.update_sla_target, db, TENANT, sid, ga.SLATargetUpdate(notes="x"))


# ─── change types ──────────────────────────────────────────────────────────
def test_change_type_create_list_patch(db):
    out = ga.create_change_type(db, TENANT, ga.ChangeTypeCreate(code="standard", name="Standard"))
    ct = out["change_type"]
    assert ct["requires_cab"] is True and ct["auto_approve"] is False  # defaults
    ga.update_change_type(db, TENANT, ct["id"], ga.ChangeTypeUpdate(requires_cab=False, auto_approve=True))
    row = ga.list_change_types(db, TENANT)["change_types"][0]
    assert row["requires_cab"] is False and row["auto_approve"] is True and row["name"] == "Standard"


def test_change_type_duplicate_code_409(db):
    ga.create_change_type(db, TENANT, ga.ChangeTypeCreate(code="normal", name="Normal"))
    _raises(409, ga.create_change_type, db, TENANT, ga.ChangeTypeCreate(code="normal", name="Normal 2"))


# ─── change risk matrix ────────────────────────────────────────────────────
def test_risk_matrix_put_list_and_reput_in_place(db):
    a = ga.put_risk_cell(db, TENANT, ga.RiskMatrixPut(impact="high", likelihood="high", risk_level="high"))
    assert a["created"] is True and a["cell"]["cab_required"] is True
    b = ga.put_risk_cell(db, TENANT, ga.RiskMatrixPut(
        impact="high", likelihood="high", risk_level="very_high", cab_required=False))
    assert b["created"] is False and b["cell"]["id"] == a["cell"]["id"]
    assert b["cell"]["risk_level"] == "very_high" and b["cell"]["cab_required"] is False
    assert db.query(HDChangeRiskMatrix).count() == 1
    assert len(ga.list_risk_matrix(db, TENANT)["cells"]) == 1


def test_risk_matrix_requires_fields_and_delete(db):
    _raises(400, ga.put_risk_cell, db, TENANT, ga.RiskMatrixPut(impact=" ", likelihood="low", risk_level="low"))
    cid = ga.put_risk_cell(db, TENANT, ga.RiskMatrixPut(impact="low", likelihood="low", risk_level="low"))["cell"]["id"]
    ga.delete_risk_cell(db, TENANT, cid)
    _raises(404, ga.delete_risk_cell, db, TENANT, cid)


# ─── CAB model ─────────────────────────────────────────────────────────────
def test_cab_put_list_and_reput_in_place(db):
    a = ga.put_cab(db, TENANT, ga.CABPut(item="Quorum", detail="3"))
    b = ga.put_cab(db, TENANT, ga.CABPut(item="Quorum", detail="5"))
    assert a["created"] is True and b["created"] is False
    assert b["item"]["id"] == a["item"]["id"] and b["item"]["detail"] == "5"
    assert db.query(HDCABConfig).count() == 1
    assert ga.list_cab(db, TENANT)["items"][0]["detail"] == "5"


def test_cab_delete_and_missing_item_400(db):
    _raises(400, ga.put_cab, db, TENANT, ga.CABPut(item="  "))
    cid = ga.put_cab(db, TENANT, ga.CABPut(item="Chair", detail="CM"))["item"]["id"]
    ga.delete_cab(db, TENANT, cid)
    assert db.query(HDCABConfig).count() == 0
    _raises(404, ga.delete_cab, db, TENANT, cid)


def test_kpi_upsert_list_delete(db):
    r1 = ga.put_kpi(db, TENANT, ga.KPIPut(process="Incident", kpi="MTTR",
                                          target="P1 < 4h", frequency="Monthly"))
    assert r1["created"] is True
    # upsert by (process, kpi), process case-normalised → updates in place, no dup
    r2 = ga.put_kpi(db, TENANT, ga.KPIPut(process="incident", kpi="MTTR", target="P1 < 2h"))
    assert r2["created"] is False
    assert db.query(HDKPI).count() == 1
    kpis = ga.list_kpis(db, TENANT)["kpis"]
    assert kpis[0]["target"] == "P1 < 2h" and kpis[0]["process"] == "incident"
    ga.delete_kpi(db, TENANT, kpis[0]["id"])
    assert db.query(HDKPI).count() == 0
    _raises(404, ga.delete_kpi, db, TENANT, kpis[0]["id"])


# ─── state transitions ─────────────────────────────────────────────────────
def test_transition_create_list_filter_delete(db):
    a, b = _status(db, "New"), _status(db, "Assigned")
    out = ga.create_transition(db, TENANT, ga.TransitionCreate(
        process="incident", from_status_id=a.id, to_status_id=b.id, guard="approved", required_role="ROLE-X"))
    t = out["transition"]
    assert t["from_status"] == "New" and t["to_status"] == "Assigned" and t["guard"] == "approved"
    assert len(ga.list_transitions(db, TENANT, "incident")["transitions"]) == 1
    assert ga.list_transitions(db, TENANT, "change")["transitions"] == []
    ga.delete_transition(db, TENANT, t["id"])
    assert db.query(HDStateTransition).count() == 0
    _raises(404, ga.delete_transition, db, TENANT, t["id"])


def test_transition_bad_status_400_and_dup_409(db):
    a, b = _status(db, "New"), _status(db, "Assigned")
    _raises(400, ga.create_transition, db, TENANT,
            ga.TransitionCreate(process="incident", from_status_id=a.id, to_status_id=999))
    _raises(400, ga.create_transition, db, TENANT,
            ga.TransitionCreate(process="incident", from_status_id=999, to_status_id=b.id))
    foreign = _status(db, "Elsewhere", tid=OTHER)
    _raises(400, ga.create_transition, db, TENANT,
            ga.TransitionCreate(process="incident", from_status_id=a.id, to_status_id=foreign.id))
    _raises(400, ga.create_transition, db, TENANT,
            ga.TransitionCreate(process="nope", from_status_id=a.id, to_status_id=b.id))
    body = ga.TransitionCreate(process="incident", from_status_id=a.id, to_status_id=b.id)
    ga.create_transition(db, TENANT, body)
    _raises(409, ga.create_transition, db, TENANT, body)
    # same pair under a different process is a different rule
    ga.create_transition(db, TENANT, ga.TransitionCreate(process="problem", from_status_id=a.id, to_status_id=b.id))


# ─── incident categories ───────────────────────────────────────────────────
def test_incident_category_tree_round_trip(db):
    c = ga.create_incident_category(db, TENANT, ga.IncidentCategoryCreate(name="Email", level="category"))["category"]
    s = ga.create_incident_category(
        db, TENANT, ga.IncidentCategoryCreate(name="Mailbox", level="subcategory", parent_id=c["id"]))["category"]
    i = ga.create_incident_category(
        db, TENANT, ga.IncidentCategoryCreate(name="Mailbox Full", level="item", parent_id=s["id"]))["category"]
    assert c["key"] == "email" and s["key"] == "email/mailbox" and i["key"] == "email/mailbox/mailbox_full"
    out = ga.list_incident_categories(db, TENANT)
    assert len(out["categories"]) == 3
    assert {n["parent_id"] for n in out["categories"]} == {None, c["id"], s["id"]}
    root = out["tree"][0]
    assert root["name"] == "Email" and root["children"][0]["children"][0]["name"] == "Mailbox Full"


def test_incident_category_validation(db):
    c = ga.create_incident_category(db, TENANT, ga.IncidentCategoryCreate(name="Email", level="category"))["category"]
    _raises(400, ga.create_incident_category, db, TENANT, ga.IncidentCategoryCreate(name="X", level="bogus"))
    _raises(400, ga.create_incident_category, db, TENANT,
            ga.IncidentCategoryCreate(name="X", level="category", parent_id=c["id"]))
    _raises(400, ga.create_incident_category, db, TENANT, ga.IncidentCategoryCreate(name="X", level="subcategory"))
    _raises(400, ga.create_incident_category, db, TENANT,
            ga.IncidentCategoryCreate(name="X", level="subcategory", parent_id=999))
    # an item may not hang directly off a category (must be under a subcategory)
    _raises(400, ga.create_incident_category, db, TENANT,
            ga.IncidentCategoryCreate(name="X", level="item", parent_id=c["id"]))
    _raises(409, ga.create_incident_category, db, TENANT, ga.IncidentCategoryCreate(name="email", level="category"))


def test_incident_category_patch_and_retire_row_stays(db):
    c = ga.create_incident_category(db, TENANT, ga.IncidentCategoryCreate(name="Email", level="category"))["category"]
    out = ga.update_incident_category(db, TENANT, c["id"], ga.IncidentCategoryUpdate(name="E-mail", sort_order=3))
    assert out["category"]["name"] == "E-mail" and out["category"]["key"] == "email"  # key is stable
    ga.retire_incident_category(db, TENANT, c["id"])
    row = db.query(HDIncidentCategory).filter_by(id=c["id"]).one()
    assert row.enabled is False
    assert ga.list_incident_categories(db, TENANT)["categories"][0]["enabled"] is False
    _raises(404, ga.retire_incident_category, db, TENANT, 999)


# ─── departments ───────────────────────────────────────────────────────────
def test_department_create_list_patch_retire(db):
    t = _team(db)
    d = ga.create_department(db, TENANT, ga.DepartmentCreate(name="IT", code="IT", default_team_id=t.id))["department"]
    assert d["default_team"] == "Network" and d["enabled"] is True
    ga.update_department(db, TENANT, d["id"], ga.DepartmentUpdate(description="Tech"))
    row = ga.list_departments(db, TENANT)["departments"][0]
    assert row["description"] == "Tech" and row["name"] == "IT"
    ga.retire_department(db, TENANT, d["id"])
    assert db.query(HDDepartment).filter_by(id=d["id"]).one().enabled is False


def test_department_validation(db):
    t = _team(db)
    _raises(400, ga.create_department, db, TENANT, ga.DepartmentCreate(name="IT", default_team_id=999))
    foreign = _team(db, name="Theirs", tid=OTHER)
    _raises(400, ga.create_department, db, TENANT, ga.DepartmentCreate(name="IT", default_team_id=foreign.id))
    d = ga.create_department(db, TENANT, ga.DepartmentCreate(name="IT", code="IT", default_team_id=t.id))["department"]
    _raises(409, ga.create_department, db, TENANT, ga.DepartmentCreate(name="IT"))
    _raises(409, ga.create_department, db, TENANT, ga.DepartmentCreate(name="IT2", code="IT"))
    other = ga.create_department(db, TENANT, ga.DepartmentCreate(name="HR", code="HR"))["department"]
    _raises(409, ga.update_department, db, TENANT, other["id"], ga.DepartmentUpdate(name="IT"))
    _raises(400, ga.update_department, db, TENANT, d["id"], ga.DepartmentUpdate(default_team_id=999))


# ─── role map ──────────────────────────────────────────────────────────────
def test_role_map_patch_and_list(db):
    r = HDRoleMap(tenant_id=TENANT, code="ROLE-CHGMGR", name="Change Manager")
    db.add(r)
    db.commit()
    out = ga.update_role(db, TENANT, r.id, ga.RoleMapUpdate(rbac_preset="Change Approver", description="d"))
    assert out["role"]["rbac_preset"] == "Change Approver"
    listed = ga.list_roles(db, TENANT)["roles"]
    assert listed[0]["code"] == "ROLE-CHGMGR" and listed[0]["description"] == "d"
    # partial: omitted description is left alone, blank preset clears the mapping
    ga.update_role(db, TENANT, r.id, ga.RoleMapUpdate(rbac_preset=""))
    row = ga.list_roles(db, TENANT)["roles"][0]
    assert row["rbac_preset"] is None and row["description"] == "d"
    _raises(404, ga.update_role, db, TENANT, 999, ga.RoleMapUpdate(description="x"))


# ─── support group map ─────────────────────────────────────────────────────
def test_support_group_map_team_and_validation(db):
    t = _team(db)
    g = HDSupportGroupMap(tenant_id=TENANT, code="GRP-NET", name="Network Ops")
    db.add(g)
    db.commit()
    out = ga.update_support_group(db, TENANT, g.id, ga.SupportGroupUpdate(team_id=t.id))
    assert out["support_group"]["team"] == "Network"
    assert ga.list_support_groups(db, TENANT)["support_groups"][0]["team_id"] == t.id
    _raises(400, ga.update_support_group, db, TENANT, g.id, ga.SupportGroupUpdate(team_id=999))
    foreign = _team(db, name="Theirs", tid=OTHER)
    _raises(400, ga.update_support_group, db, TENANT, g.id, ga.SupportGroupUpdate(team_id=foreign.id))
    ga.update_support_group(db, TENANT, g.id, ga.SupportGroupUpdate(team_id=None))
    assert ga.list_support_groups(db, TENANT)["support_groups"][0]["team_id"] is None


# ─── tenant isolation ──────────────────────────────────────────────────────
def test_tenant_isolation_across_areas(db):
    p = _priority(db)
    cid = ga.put_priority_cell(db, TENANT, ga.PriorityMatrixPut(impact="h", urgency="h", priority_id=p.id))["cell"]["id"]
    dep = ga.create_department(db, TENANT, ga.DepartmentCreate(name="IT"))["department"]["id"]
    cat = ga.create_incident_category(db, TENANT, ga.IncidentCategoryCreate(name="Email", level="category"))["category"]["id"]
    sla = ga.create_sla_target(db, TENANT, ga.SLATargetCreate(process="incident", priority_label="P1"))["target"]["id"]

    # the other tenant sees nothing and cannot touch tenant 1's rows
    assert ga.list_priority_matrix(db, OTHER)["cells"] == []
    assert ga.list_departments(db, OTHER)["departments"] == []
    assert ga.list_incident_categories(db, OTHER) == {"categories": [], "tree": []}
    assert ga.list_sla_targets(db, OTHER)["targets"] == []
    _raises(404, ga.delete_priority_cell, db, OTHER, cid)
    _raises(404, ga.update_department, db, OTHER, dep, ga.DepartmentUpdate(description="x"))
    _raises(404, ga.retire_incident_category, db, OTHER, cat)
    _raises(404, ga.delete_sla_target, db, OTHER, sla)

    # the same natural key is independent per tenant (no cross-tenant 409)
    p2 = _priority(db, tid=OTHER)
    ga.put_priority_cell(db, OTHER, ga.PriorityMatrixPut(impact="h", urgency="h", priority_id=p2.id))
    ga.create_department(db, OTHER, ga.DepartmentCreate(name="IT"))
    assert db.query(HDPriorityMatrix).count() == 2
