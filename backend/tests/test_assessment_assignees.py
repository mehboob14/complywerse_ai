"""Assigning an assessment item to people and/or teams.

Any item on any assessment can be assigned to any number of the workspace's
people and teams; the names come back with every item list (the assessment
page, the DCC list, the remediation plan, the Excel export), a deactivated
person stays on an item until someone removes them, and nobody outside the
workspace's lists can be picked.
"""
import io

import openpyxl
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.models import get_db
from grc.routers.auth_router import require_auth


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    session = Session(engine)
    session.add(m.Tenant(id=1, name="Demo Bank", slug="demo"))
    session.add_all([
        m.GRCUser(id=7, username="assessor", email="assessor@bank.example", display_name="Assessor"),
        m.GRCUser(id=8, username="amina", email="amina@bank.example", display_name="Amina Khan"),
        m.GRCUser(id=9, username="gone", email="gone@bank.example", display_name="Gone Away"),
    ])
    session.add(m.Team(id=2, tenant_id=1, name="Security Operations"))
    session.add(m.ComplianceAssessmentDocument(id=3, tenant_id=1, name="OWASP ASVS 4.0.3", assessment_type="checklist",
                                               assessment_format="asvs_checklist"))
    session.add(m.ComplianceAssessmentDocumentItem(
        id=30, assessment_id=3, tenant_id=1, item_number="V2.1.1", area_domain="Authentication",
        control_description="Passwords are at least 12 characters.", compliance_status="not_complied",
        control_source="dcc"))
    session.add(m.ComplianceAssessmentDocumentItem(id=31, assessment_id=3, tenant_id=1, item_number="V2.1.2",
                                                   area_domain="Authentication", control_description="Long passwords."))
    session.add(m.ComplianceAssessmentDocumentItem(id=40, assessment_id=3, tenant_id=2, item_number="X", control_description="Elsewhere"))
    session.commit()
    yield session
    session.close()


@pytest.fixture
def http(db):
    from grc.main import app

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(m.GRCUser, 7)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


URL = "/compliance/assessments/items/30/assignees"
AMINA, TEAM = {"type": "user", "id": 8}, {"type": "team", "id": 2}


def _named(*who):
    return [{**a, "name": n} for a, n in who]


def test_an_item_is_assigned_to_people_and_teams_and_every_list_names_them(http):
    done = http.put(URL, json={"assignees": [AMINA, TEAM, AMINA]})            # a repeat counts once
    assert done.status_code == 200, done.text
    assert done.json()["assignees"] == _named((AMINA, "Amina Khan"), (TEAM, "Security Operations"))

    page = http.get("/compliance/assessments/3").json()
    by_id = {i["id"]: i for i in page["items"]}
    assert by_id[30]["assignees"] == done.json()["assignees"] and by_id[31]["assignees"] == []
    assert page["items_by_domain"]["Authentication"][0]["assignees"] == done.json()["assignees"]

    dcc = http.get("/compliance/assessments/3/dcc").json()
    assert dcc["domains"][0]["items"][0]["assignees"] == done.json()["assignees"]

    gaps = http.get("/compliance/assessments/remediation-plan", params={"assessment_id": 3}).json()["items"]
    assert gaps[0]["assignees"] == done.json()["assignees"]

    sheet = openpyxl.load_workbook(io.BytesIO(http.get("/compliance/assessments/3/export").content))["Assessment Items"]
    assert [c.value for c in sheet[1]][-1] == "Assigned To"
    assert sheet[2][-1].value == "Amina Khan, Security Operations" and not sheet[3][-1].value


def test_assigning_again_replaces_and_an_empty_list_unassigns(http):
    http.put(URL, json={"assignees": [AMINA, TEAM]})
    assert http.put(URL, json={"assignees": [TEAM]}).json()["assignees"] == _named((TEAM, "Security Operations"))
    assert http.put(URL, json={"assignees": []}).json()["assignees"] == []
    assert http.get("/compliance/assessments/3").json()["items"][0]["assignees"] == []


def test_only_people_and_teams_of_the_workspace_can_be_picked(http):
    http.put(URL, json={"assignees": [AMINA]})
    for bad in ({"type": "user", "id": 999}, {"type": "team", "id": 999}):
        refused = http.put(URL, json={"assignees": [AMINA, bad]})
        assert refused.status_code == 400, refused.text
    assert http.put(URL, json={"assignees": [{"type": "role", "id": 1}]}).status_code == 422
    assert http.put("/compliance/assessments/items/999/assignees", json={"assignees": []}).status_code == 404
    assert http.put("/compliance/assessments/items/40/assignees", json={"assignees": []}).status_code == 404   # another tenant's
    kept = http.get("/compliance/assessments/3").json()["items"][0]["assignees"]
    assert kept == _named((AMINA, "Amina Khan"))                                # a refused pick changes nothing


def test_a_deactivated_person_cannot_be_added_but_stays_until_removed(http, db):
    gone = {"type": "user", "id": 9}
    assert http.put(URL, json={"assignees": [gone]}).status_code == 200          # active when added
    db.get(m.GRCUser, 9).is_active = False
    db.commit()
    assert http.put(URL, json={"assignees": [gone, AMINA]}).status_code == 200   # still there while someone else is added
    assert http.put(URL, json={"assignees": [AMINA]}).status_code == 200         # removed on purpose
    assert http.put(URL, json={"assignees": [gone]}).status_code == 400          # no longer pickable


def test_an_assignment_is_filed_in_the_audit_log_under_its_assessments_page(db):
    from grc import feature_map

    assert feature_map.place(None, "/grc/compliance/assessments/items/30/assignees", db=db, slug="demo") \
        == ("Assessments", "Cyber Security")


def test_a_saved_item_keeps_its_place_in_the_list(db):
    """Postgres hands rows back in physical order and saving one rewrites it, so an item that was just
    assigned (or marked Pass) jumped to the end of the list under the user's cursor. SQLite keeps insertion
    order whatever happens, so the guard is that the query itself says how to sort."""
    from sqlalchemy.dialects import postgresql
    from sqlalchemy.orm import joinedload

    query = db.query(m.ComplianceAssessmentDocument).options(joinedload(m.ComplianceAssessmentDocument.items))
    sql = str(query.filter(m.ComplianceAssessmentDocument.id == 3).statement.compile(dialect=postgresql.dialect()))
    assert sql.rstrip().endswith("ORDER BY grc_compliance_assessment_document_items_1.id")


def test_a_deleted_team_drops_off_the_item(http, db):
    http.put(URL, json={"assignees": [AMINA, TEAM]})
    db.delete(db.get(m.Team, 2))
    db.commit()
    assert http.get("/compliance/assessments/3").json()["items"][0]["assignees"] == _named((AMINA, "Amina Khan"))
