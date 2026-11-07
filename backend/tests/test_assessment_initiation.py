"""Starting a Cyber Security assessment of one application or one function (the API).

The questionnaire of a type is the workbook the organisation uploaded; a new assessment is made from it for one subject, as a draft that is scoped first
and started when the scope is ready. Starting copies the questions without their answers, keeps the scope and the facts of its assets as they were, and
leaves the questionnaire and every other assessment as they are.
"""
import json
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.models import get_db
from grc.routers.auth_router import require_auth

BASE = "/compliance/assessments"


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    s = Session(engine)
    s.add(m.Tenant(id=1, name="Demo Bank", slug="demo"))
    s.add(m.Tenant(id=2, name="Other Bank", slug="other"))
    s.add_all([m.GRCUser(id=7, username="assessor", email="a@bank.example", display_name="Assessor Person"),
               m.GRCUser(id=8, username="amina", email="amina@bank.example", display_name="Amina Khan"),
               m.GRCUser(id=9, username="omar", email="omar@bank.example", display_name="Omar Sheikh"),
               m.GRCUser(id=10, username="gone", email="gone@bank.example", display_name="Gone Away", is_active=False)])
    s.add(m.Team(id=2, tenant_id=1, name="Security Operations"))
    s.add_all([
        m.ITAsset(id=5, tenant_id=1, name="Digital Banking Web", asset_type="application", primary_owner_id=8, environment="Staging", criticality="critical",
                  internet_facing=True, data_classification="confidential", owning_team_id=2, status="active", host_name="web.bank.example"),
        m.ITAsset(id=6, tenant_id=1, name="Payments API", asset_type="application", status="active"),
        m.ITAsset(id=7, tenant_id=1, name="Splunk SIEM", asset_type="infrastructure", status="active"),
        m.ITAsset(id=8, tenant_id=2, name="Elsewhere", asset_type="application", status="active"),
    ])
    s.add_all([m.AssetRelationship(tenant_id=1, source_asset_id=5, target_asset_id=6, relationship_type="depends_on"),
               m.AssetRelationship(tenant_id=1, source_asset_id=7, target_asset_id=5, relationship_type="connects_to")])
    # the questionnaires: the ASVS one is answered, as a real organisation's is
    s.add(m.ComplianceAssessmentDocument(id=3, tenant_id=1, name="OWASP ASVS", assessment_type="gap_assessment", assessment_format="asvs_checklist", source="Internal",
                                         total_items=3, complied_count=1, in_progress_count=2, overall_score=100.0, file_name="asvs.xlsx"))
    s.add_all([
        m.ComplianceAssessmentDocumentItem(id=30, assessment_id=3, tenant_id=1, item_number="V2.1.1", area_domain="Authentication", subdomain_name="Passwords",
                                           control_description="Passwords are at least 12 characters.", priority="high", remarks="ASVS Level: 2", evidence_reference="NIST 800-63B",
                                           compliance_status="complied", gaps_identified="none", proposed_solution="keep", assignees=[{"type": "user", "id": 9}],
                                           asset_status={"5": "complied"}, ai_evidence_recommendation='{"summary": "x"}', remediation_status="open",
                                           target_date=datetime(2026, 1, 1), closed_at=datetime(2026, 1, 2), maturity_score=3),
        m.ComplianceAssessmentDocumentItem(id=31, assessment_id=3, tenant_id=1, item_number="V2.1.2", area_domain="Authentication",
                                           control_description="Long passwords are allowed.", remarks="ASVS Level: 3"),
        m.ComplianceAssessmentDocumentItem(id=32, assessment_id=3, tenant_id=1, item_number="V3.1.1", area_domain="Session Management",
                                           control_description="Sessions end.", remarks="ASVS Level: 1")])
    s.add(m.ComplianceAssessmentDocument(id=4, tenant_id=1, name="Incident Management Maturity", assessment_type="cybersecurity", assessment_format="incident_maturity",
                                         total_items=3))
    s.add_all([m.ComplianceAssessmentDocumentItem(id=40 + i, assessment_id=4, tenant_id=1, item_number=f"IM-{i}", area_domain=d, control_description=f"Statement {i}", remarks="Weighting: 1")
               for i, d in enumerate(("Prepare", "Respond", "Follow up"))])
    s.add(m.ComplianceAssessmentDocument(id=9, tenant_id=2, name="Elsewhere ASVS", assessment_type="gap_assessment", assessment_format="asvs_checklist", total_items=1, scope_model="asset"))
    s.commit()
    yield s
    s.close()


@pytest.fixture
def http(db):
    from grc.main import app

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(m.GRCUser, 7)
    # the IT asset API asks the whole router for assets:asset_inventory:view (a QA fix of the cyber line); this file tests the assessment hub's own read of the library
    from grc.routers.assets_router import router as assets_router
    for gate in assets_router.dependencies:
        app.dependency_overrides[gate.dependency] = lambda: True
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def initiate(http, fmt="asvs_checklist", **body):
    return http.post(f"{BASE}/initiate", json={"assessment_format": fmt, **({"asset_id": 5} if fmt in ("asvs_checklist", "owasp_v4_testing_checklist", "mobile_app_security") and "asset_id" not in body else {}), **body})


def ready_asvs(http, aid, **more):
    scope = {"environment": "staging", "version": "6.2", "level": 2,
             "participants": [{"kind": "user", "user_id": 8, "role": "owner"}, {"kind": "user", "user_id": 9, "role": "assessor", "independent": True, "domains": ["Authentication"]}], **more}
    return http.put(f"{BASE}/{aid}/scope", json={"scope": scope})


def test_the_templates_list_each_type_with_its_questionnaire_its_domains_and_how_many_are_open(http):
    out = http.get(f"{BASE}/templates").json()["templates"]
    assert [t["assessment_format"] for t in out] == ["asvs_checklist", "owasp_v4_testing_checklist", "mobile_app_security", "csir_maturity", "cti_maturity", "incident_maturity", "itsecops_maturity",
                                                     "nist_800_53a", "nist_csf2"]      # the seven the hub has always had, then the NIST ones made from the library (tests/test_nist_assessments.py)
    asvs, owasp, incident = out[0], out[1], out[5]
    assert (asvs["label"], asvs["scope_model"], asvs["family"]) == ("OWASP ASVS", "asset", "technical") and incident["family"] == "process"
    assert asvs["questionnaire"]["items"] == 3 and asvs["questionnaire"]["domains"] == [{"name": "Authentication", "count": 2}, {"name": "Session Management", "count": 1}]
    assert owasp["questionnaire"] is None and (asvs["scoping"], asvs["in_progress"]) == (0, 0)
    assert initiate(http).status_code == 201
    assert http.get(f"{BASE}/templates").json()["templates"][0]["scoping"] == 1


def test_an_asset_assessment_starts_as_a_draft_with_what_the_library_knows_of_the_application(http, db):
    made = initiate(http)
    assert made.status_code == 201, made.text
    a = made.json()
    assert (a["name"], a["phase"], a["status"], a["total_items"], a["locked"]) == ("OWASP ASVS - Digital Banking Web", "scoping", "draft", 0, False)
    assert (a["scope_model"], a["family"], a["assessment_format"], a["format_label"]) == ("asset", "technical", "asvs_checklist", "OWASP ASVS")
    assert a["owner"] == {"id": 7, "name": "Assessor Person"} and a["template"] == {"id": 3, "name": "OWASP ASVS", "items": 3}
    assert a["primary_asset"]["name"] == "Digital Banking Web" and a["primary_asset"]["owner"] == "Amina Khan" and a["primary_asset"]["department"] == "Security Operations"
    assert a["scope"]["environment"] == "staging" and a["scope"]["assets"] == [{"asset_id": 5, "role": "primary", "reason": ""}]
    assert [(p["user_id"], p["role"]) for p in a["scope"]["participants"]] == [(8, "owner")]                      # the application's owner, from the library
    assert {r["name"]: (r["relationship"], r["direction"]) for r in a["related_assets"]} == {"Payments API": ("depends_on", "outgoing"), "Splunk SIEM": ("connects_to", "incoming")}
    assert a["domains"] == [{"name": "Authentication", "count": 2}, {"name": "Session Management", "count": 1}]       # the questionnaire's, before it is copied
    assert a["readiness"]["ready"] is False and {c["key"] for c in a["readiness"]["checks"] if c["required"] and not c["ok"]} == {"version", "level", "assessor"}
    row = db.get(m.ComplianceAssessmentDocument, a["id"])
    assert (row.primary_asset_id, row.linked_asset_ids, row.owner_id, row.created_by) == (5, [5], 7, 7) and db.query(m.ComplianceAssessmentDocumentItem).filter_by(assessment_id=a["id"]).count() == 0


def test_a_function_assessment_starts_from_its_name_and_owns_nothing_of_an_asset(http):
    a = initiate(http, "incident_maturity", subject="Security Operations Centre").json()
    assert (a["scope_model"], a["family"], a["name"]) == ("process", "process", "Incident Management - Security Operations Centre")
    assert a["scope"]["function"] == "Security Operations Centre" and a["primary_asset"] is None and a["related_assets"] == []
    assert a["domains"] == [{"name": "Follow up", "count": 1}, {"name": "Prepare", "count": 1}, {"name": "Respond", "count": 1}]
    assert {c["key"] for c in a["readiness"]["checks"] if c["required"] and not c["ok"]} == {"organisation", "period", "process_owner"}


def test_initiating_needs_a_cyber_security_type_a_questionnaire_and_a_subject_of_this_organisation(http):
    assert initiate(http, "pdpl_assessment_toolkit").status_code == 400
    owasp = initiate(http, "owasp_v4_testing_checklist")
    assert owasp.status_code == 409 and "no questionnaire" in owasp.json()["detail"]
    assert http.post(f"{BASE}/initiate", json={"assessment_format": "asvs_checklist"}).status_code == 404            # no application chosen
    assert http.post(f"{BASE}/initiate", json={"assessment_format": "asvs_checklist", "asset_id": 8}).status_code == 404   # another organisation's
    assert http.post(f"{BASE}/initiate", json={"assessment_format": "incident_maturity", "subject": "  "}).status_code == 400


def test_the_scope_is_saved_as_it_goes_and_says_where_it_is_wrong(http):
    aid = initiate(http).json()["id"]
    saved = http.put(f"{BASE}/{aid}/scope", json={"name": "ASVS of the web app", "due_date": "2026-12-01", "scope": {"version": "6.2", "level": 2}})
    assert saved.status_code == 200 and saved.json()["name"] == "ASVS of the web app" and saved.json()["due_date"].startswith("2026-12-01")
    assert saved.json()["scope"]["version"] == "6.2" and saved.json()["scope"]["environment"] == "staging"                # what was not sent stayed
    again = http.put(f"{BASE}/{aid}/scope", json={"scope": {"exclusions": [{"what": "Core banking backend", "reason": "not reachable"}]}}).json()
    assert again["scope"]["version"] == "6.2" and again["scope"]["exclusions"][0]["what"] == "Core banking backend"
    assert http.put(f"{BASE}/{aid}/scope", json={"due_date": None}).json()["due_date"] is None                         # an explicit null clears it
    bad = http.put(f"{BASE}/{aid}/scope", json={"scope": {"environment": "moon", "colour": "red"}})
    assert bad.status_code == 422 and {e["field"] for e in bad.json()["detail"]["errors"]} == {"environment", "colour"}
    assert http.get(f"{BASE}/{aid}/scope").json()["scope"]["version"] == "6.2"                                           # nothing half-saved


def test_the_people_and_assets_a_scope_names_must_exist_and_a_function_has_no_primary_asset(http):
    aid = initiate(http).json()["id"]
    def put(scope=None, **more):
        return http.put(f"{BASE}/{aid}/scope", json={"scope": scope or {}, **more})
    gone = put({"participants": [{"kind": "user", "user_id": 10, "role": "assessor"}]})
    assert gone.status_code == 422 and gone.json()["detail"]["errors"][0]["field"] == "participants"                 # deactivated
    assert put({"participants": [{"kind": "team", "team_id": 99}]}).status_code == 422
    assert put({"assets": [{"asset_id": 5, "role": "primary"}, {"asset_id": 8, "role": "component"}]}).status_code == 422          # another organisation's
    assert put({"assets": [{"asset_id": 5, "role": "primary"}, {"asset_id": 6, "role": "primary"}]}).status_code == 422
    assert put({"assets": [{"asset_id": 5, "role": "primary"}, {"asset_id": 5, "role": "component"}]}).status_code == 422
    assert put(owner_id=10).status_code == 422
    ok = put({"assets": [{"asset_id": 5, "role": "primary"}, {"asset_id": 6, "role": "component", "reason": "its API"}, {"asset_id": 7, "role": "excluded"}]})
    assert ok.status_code == 200
    row = http.get(f"{BASE}/{aid}").json()
    assert row["linked_asset_ids"] == [5, 6] and row["primary_asset_id"] == 5                                              # an excluded asset is not linked
    only_others = put({"assets": [{"asset_id": 6, "role": "supporting"}]})                                                 # a list that leaves the application out does not remove it
    assert only_others.status_code == 200 and [(r["asset_id"], r["role"]) for r in only_others.json()["scope"]["assets"]] == [(5, "primary"), (6, "supporting")]
    assert http.get(f"{BASE}/{aid}").json()["primary_asset_id"] == 5 and put({"assets": []}).json()["scope"]["assets"] == [{"asset_id": 5, "role": "primary", "reason": ""}]
    fid = initiate(http, "incident_maturity", subject="SOC").json()["id"]
    assert http.put(f"{BASE}/{fid}/scope", json={"scope": {"assets": [{"asset_id": 7, "role": "primary"}]}}).status_code == 422
    assert http.put(f"{BASE}/{fid}/scope", json={"scope": {"assets": [{"asset_id": 7, "role": "supporting"}, {"asset_id": 6, "role": "excluded"}]}}).status_code == 200


def test_start_is_refused_until_the_required_parts_are_filled_and_says_which(http, db):
    aid = initiate(http).json()["id"]
    refused = http.post(f"{BASE}/{aid}/start")
    assert refused.status_code == 422
    assert {c["key"] for c in refused.json()["detail"]["checks"]} == {"version", "level", "assessor"}
    assert all(not c["ok"] and c["required"] for c in refused.json()["detail"]["checks"])
    assert db.query(m.ComplianceAssessmentDocumentItem).filter_by(assessment_id=aid).count() == 0
    ready_asvs(http, aid, environment="production")
    needs_roe = http.post(f"{BASE}/{aid}/start")
    assert needs_roe.status_code == 422 and [c["key"] for c in needs_roe.json()["detail"]["checks"]] == ["rules_of_engagement"]


def test_start_copies_the_questions_without_their_answers_and_keeps_the_scope_as_it_was(http, db):
    aid = initiate(http).json()["id"]
    assert ready_asvs(http, aid).status_code == 200
    started = http.post(f"{BASE}/{aid}/start")
    assert started.status_code == 200, started.text
    a = started.json()
    assert (a["phase"], a["status"], a["locked"], a["total_items"]) == ("in_progress", "in_progress", True, 3) and a["started_at"]
    detail = http.get(f"{BASE}/{aid}").json()
    assert (detail["scope_model"], detail["phase"], detail["owner_id"], detail["primary_asset_id"], detail["template_id"]) == ("asset", "in_progress", 7, 5, 3)
    items = {i["item_number"]: i for i in detail["items"]}
    assert sorted(items) == ["V2.1.1", "V2.1.2", "V3.1.1"]
    q = items["V2.1.1"]                                                      # the question is the same ...
    assert (q["area_domain"], q["control_description"], q["priority"], q["remarks"], q["evidence_reference"]) == (
        "Authentication", "Passwords are at least 12 characters.", "high", "ASVS Level: 2", "NIST 800-63B")
    assert db.query(m.ComplianceAssessmentDocumentItem).filter_by(id=q["id"]).one().subdomain_name == "Passwords"
    assert (q["compliance_status"], q["gaps_identified"], q["proposed_solution"], q["maturity_score"], q["remediation_status"], q["asset_status"],
            q["ai_evidence_recommendation"], q["target_date"], q["closed_at"]) == ("in_progress", None, None, None, None, {}, None, None, None)   # ... its answers are not
    assert [i["compliance_status"] for i in detail["items"]] == ["in_progress", "na", "in_progress"] and detail["overall_score"] == 0.0     # level 3 does not apply at level 2
    assert (detail["complied_count"], detail["in_progress_count"], detail["na_count"]) == (0, 2, 1) and items["V2.1.2"]["remarks"] == "ASVS Level: 3 | Not applicable: Outside the selected ASVS level 2."
    assert db.get(m.ComplianceAssessmentDocument, aid).asset_levels == {"5": 2}                                          # what the ASVS tab reads to filter by level
    assert q["assignees"] == [{"type": "user", "id": 9, "name": "Omar Sheikh"}] and items["V2.1.2"]["assignees"] == [{"type": "user", "id": 9, "name": "Omar Sheikh"}] \
        and items["V3.1.1"]["assignees"] == []                              # the assessor listed a domain; the owner, who listed none, got no questions
    base = db.get(m.ComplianceAssessmentDocument, 3)
    assert base.complied_count == 1 and db.get(m.ComplianceAssessmentDocumentItem, 30).compliance_status == "complied"             # the questionnaire is as it was
    assert db.get(m.ComplianceAssessmentDocumentItem, 30).assignees == [{"type": "user", "id": 9}]
    snap = db.get(m.ComplianceAssessmentDocument, aid).scope_snapshot
    assert snap["template"]["id"] == 3 and snap["template"]["items"] == 3 and snap["taken_by"]["name"] == "Assessor Person" and snap["owner"]["name"] == "Assessor Person"
    asset = snap["assets"][0]
    assert (asset["name"], asset["owner"], asset["department"], asset["criticality"], asset["internet_facing"], asset["role"]) == (
        "Digital Banking Web", "Amina Khan", "Security Operations", "critical", True, "primary")
    assert {p["display"] for p in snap["participants"]} == {"Amina Khan", "Omar Sheikh"} and snap["scope"]["version"] == "6.2"
    row = db.get(m.ComplianceAssessmentDocument, aid)
    assert "Digital Banking Web" in row.subject_summary and "ASVS level: 2" in row.subject_summary and "Amina" not in row.subject_summary and "Omar" not in row.subject_summary
    asset_row = db.get(m.ITAsset, 5)                                          # the library moves on; the assessment keeps what it was done on
    asset_row.name, asset_row.criticality, asset_row.primary_owner_id = "Digital Banking Web v2", "low", 9
    db.commit()
    assert db.get(m.ComplianceAssessmentDocument, aid).scope_snapshot["assets"][0]["name"] == "Digital Banking Web"
    assert http.get(f"{BASE}/{aid}/scope").json()["snapshot"]["assets"][0]["owner"] == "Amina Khan"


def test_a_function_assessment_assigns_each_domain_to_the_teams_that_answer_it(http):
    aid = initiate(http, "incident_maturity", subject="Security Operations Centre").json()["id"]
    scope = {"organisation": "Demo Bank", "period_start": "2026-01-01", "period_end": "2026-10-31",
             "participants": [{"kind": "user", "user_id": 8, "role": "owner"},
                              {"kind": "team", "team_id": 2, "role": "contributor", "domains": ["Prepare", "Respond"]},
                              {"kind": "external", "name": "Sana", "organisation": "Managed SOC Ltd", "role": "contributor", "domains": ["Respond"]},
                              {"kind": "user", "user_id": 9, "role": "reviewer", "independent": True}],
             "assets": [{"asset_id": 7, "role": "supporting", "reason": "monitoring"}]}
    assert http.put(f"{BASE}/{aid}/scope", json={"scope": scope}).status_code == 200
    started = http.post(f"{BASE}/{aid}/start")
    assert started.status_code == 200, started.text
    by_domain = {i["area_domain"]: i["assignees"] for i in http.get(f"{BASE}/{aid}").json()["items"]}
    assert by_domain == {"Prepare": [{"type": "team", "id": 2, "name": "Security Operations"}], "Respond": [{"type": "team", "id": 2, "name": "Security Operations"}], "Follow up": []}
    summary = started.json()["subject_summary"]
    assert 'Subject: the function or process "Security Operations Centre" of Demo Bank.' in summary and "Supporting assets (context for the evidence, not scored): Splunk SIEM." in summary
    assert "from outside providers" in summary and "Sana" not in summary and "Managed SOC" not in summary and "Amina" not in summary


def test_once_started_the_subject_and_level_are_fixed_but_who_takes_part_and_the_notes_can_change(http):
    aid = initiate(http).json()["id"]
    ready_asvs(http, aid)
    http.post(f"{BASE}/{aid}/start")
    full = http.get(f"{BASE}/{aid}/scope").json()["scope"]
    assert http.put(f"{BASE}/{aid}/scope", json={"scope": full}).status_code == 200                                      # sent back unchanged: fine
    locked = http.put(f"{BASE}/{aid}/scope", json={"scope": {"environment": "production", "level": 3}})
    assert locked.status_code == 409 and sorted(locked.json()["detail"]["fields"]) == ["environment", "level"]
    assert http.get(f"{BASE}/{aid}/scope").json()["scope"]["level"] == 2
    more = {"participants": full["participants"] + [{"kind": "user", "user_id": 7, "role": "reviewer"}], "notes": "Retest after the fix."}
    assert http.put(f"{BASE}/{aid}/scope", json={"scope": more, "owner_id": 9}).status_code == 200
    after = http.get(f"{BASE}/{aid}/scope").json()
    assert after["scope"]["notes"] == "Retest after the fix." and after["owner"]["id"] == 9 and len(after["scope"]["participants"]) == 3
    assert http.post(f"{BASE}/{aid}/start").status_code == 409                                                           # not twice
    assert http.put(f"{BASE}/3/scope", json={"scope": {}}).status_code == 409                                             # a questionnaire has no scope
    assert http.post(f"{BASE}/3/start").status_code == 409


def test_a_scope_of_another_organisation_is_not_there(http):
    assert http.get(f"{BASE}/9/scope").status_code == 404
    assert http.put(f"{BASE}/9/scope", json={"scope": {}}).status_code == 404 and http.post(f"{BASE}/9/start").status_code == 404


def test_two_applications_are_two_assessments_with_their_own_answers_and_the_lists_find_them(http, db):
    first = initiate(http).json()["id"]
    second = initiate(http, asset_id=6).json()["id"]
    for aid in (first, second):
        assert ready_asvs(http, aid).status_code == 200 and http.post(f"{BASE}/{aid}/start").status_code == 200
    item = http.get(f"{BASE}/{first}").json()["items"][0]["id"]
    assert http.put(f"{BASE}/items/{item}", params={"compliance_status": "complied"}).status_code == 200
    one, two = http.get(f"{BASE}/{first}").json(), http.get(f"{BASE}/{second}").json()
    assert [i["compliance_status"] for i in one["items"]].count("complied") == 1 and [i["compliance_status"] for i in two["items"]].count("complied") == 0
    listed = http.get(f"{BASE}", params={"assessment_format": "asvs_checklist"}).json()["assessments"]
    assert {a["id"] for a in listed} == {3, first, second}
    row = {a["id"]: a for a in listed}[first]
    assert (row["scope_model"], row["phase"], row["owner_id"], row["owner_name"], row["primary_asset_id"], row["primary_asset_name"], row["template_id"]) == (
        "asset", "in_progress", 7, "Assessor Person", 5, "Digital Banking Web", 3)
    assert {a["id"] for a in http.get(f"{BASE}", params={"assessment_format": "asvs_checklist", "scope_model": "asset"}).json()["assessments"]} == {first, second}
    # a tab with no assessment chosen opens the questionnaire, never the newest assessment made from it
    assert [a["id"] for a in http.get(f"{BASE}", params={"assessment_format": "asvs_checklist", "scope_model": "none"}).json()["assessments"]] == [3]
    assert [a["id"] for a in http.get(f"{BASE}", params={"asset_id": 6}).json()["assessments"]] == [second]
    assert {a["id"] for a in http.get(f"{BASE}", params={"assessment_format": "asvs_checklist", "owner_id": 7}).json()["assessments"]} == {first, second}
    third = initiate(http, asset_id=7).json()["id"]
    assert [a["id"] for a in http.get(f"{BASE}", params={"phase": "scoping"}).json()["assessments"]] == [third]
    baseline = {a["id"]: a for a in listed}[3]
    assert (baseline["scope_model"], baseline["phase"], baseline["owner_id"]) == (None, None, None)                       # the questionnaire reads as before


def test_the_questionnaire_is_still_the_one_a_tab_shows_and_a_second_upload_replaces_it_as_the_source(http, db):
    made = initiate(http).json()["id"]
    http.put(f"{BASE}/{made}/scope", json={"scope": {"version": "1", "level": 1}})
    from grc.modules.assessments.scope_router import find_template

    assert find_template(db, 1, "asvs_checklist").id == 3                                                                 # an assessment made from it is never the source
    db.add(m.ComplianceAssessmentDocument(id=20, tenant_id=1, name="OWASP ASVS (new workbook)", assessment_type="gap_assessment", assessment_format="asvs_checklist", total_items=1,
                                          created_at=datetime(2030, 1, 1)))
    db.commit()
    assert find_template(db, 1, "asvs_checklist").id == 20


def test_a_draft_being_scoped_is_not_on_the_board_and_a_started_assessment_is(http):
    draft = initiate(http).json()["id"]
    started = initiate(http, asset_id=6).json()["id"]
    ready_asvs(http, started)
    http.post(f"{BASE}/{started}/start")
    out = http.get(f"{BASE}/overview")
    assert out.status_code == 200, out.text
    ids = {a["id"] for c in out.json()["categories"] for a in c["assessments"]}
    assert started in ids and draft not in ids and 3 in ids


def test_an_unanswered_questionnaire_leaves_the_board_when_an_assessment_made_from_it_starts_and_an_answered_one_stays(http):
    def board():
        return {a["id"] for c in http.get(f"{BASE}/overview").json()["categories"] for a in c["assessments"]}

    assert 4 in board()                                                                                       # as it has always been: the uploaded questionnaire is the assessment
    aid = initiate(http, "incident_maturity", subject="Security Operations Centre").json()["id"]
    assert http.put(f"{BASE}/{aid}/scope", json={"scope": {"organisation": "Demo Bank", "period_start": "2026-01-01", "period_end": "2026-10-31",
                                                           "participants": [{"kind": "user", "user_id": 8, "role": "owner"}, {"kind": "user", "user_id": 9, "role": "reviewer", "independent": True}]}}).status_code == 200
    assert 4 in board() and aid not in board()                                                                # a draft changes nothing
    assert http.post(f"{BASE}/{aid}/start").status_code == 200
    assert 4 not in board() and aid in board()                                                                # started: the template is no longer a row, the assessment is
    other = initiate(http).json()["id"]
    ready_asvs(http, other)
    http.post(f"{BASE}/{other}/start")
    assert 3 in board()                                                                                       # the ASVS questionnaire was answered: it stays an assessment of its own


def test_evidence_linked_to_a_requirement_reaches_the_questionnaire_but_not_a_scoped_assessment(http, db):
    from grc.main import app

    aid = initiate(http).json()["id"]
    ready_asvs(http, aid)
    http.post(f"{BASE}/{aid}/start")
    scoped_item = next(i for i in http.get(f"{BASE}/{aid}").json()["items"] if i["item_number"] == "V2.1.1")["id"]
    db.add(m.UploadedFramework(id=1, tenant_id=None, name="OWASP ASVS", version="4", source_organization="OWASP", is_shared=True, is_active=True,
                               upload_status="parsed", file_name="x.pdf", file_path="x.pdf", file_type="pdf", uploaded_by=7))
    db.add(m.ParsedFrameworkControl(id=1, uploaded_framework_id=1, control_id="V2.1.1", original_reference="V2.1.1", title="Password length",
                                    description="Passwords are at least 12 characters.", domain="Authentication"))
    db.add(m.Evidence(id=201, tenant_id=1, name="Password policy"))
    db.commit()
    path = next(r.path for r in app.routes if getattr(r, "path", "").endswith("/{evidence_id}/link-from-ai"))
    done = http.post(path.replace("{evidence_id}", "201"), json={"framework_name": "OWASP ASVS", "control_id": "V2.1.1"})
    assert done.status_code == 201, done.text
    linked = {(row.assessment_item_id) for row in db.query(m.AssessmentItemEvidence).filter_by(evidence_id=201)}
    assert linked == {30}                                                                                                  # the questionnaire's item, not the scoped one
    assert http.get(f"{BASE}/{aid}/items/{scoped_item}/evidence").json()["evidence"] == []
    assert len(http.get(f"{BASE}/3/items/30/evidence").json()["evidence"]) == 1


def test_the_asset_library_list_can_be_searched_by_name_or_host_name(http):
    names = lambda q: sorted(a["name"] for a in http.get("/assets", params={"search": q}).json())                          # noqa: E731
    assert names("banking") == ["Digital Banking Web"] and names("PAYMENTS") == ["Payments API"] and names("web.bank") == ["Digital Banking Web"]
    assert names("nothing like this") == [] and len(http.get("/assets").json()) == 3


def test_the_ai_advice_reads_what_a_scoped_assessment_is_of_and_nothing_for_the_questionnaire(http, db):
    from grc.services import assessment_evidence_ai as ai

    aid = initiate(http).json()["id"]
    ready_asvs(http, aid)
    http.post(f"{BASE}/{aid}/start")
    scoped = db.query(m.ComplianceAssessmentDocumentItem).filter_by(assessment_id=aid, item_number="V2.1.1").one()
    lines = ai._item_lines(scoped)
    scope_line = next(line for line in lines if line.startswith("SCOPE:"))
    assert "Digital Banking Web" in scope_line and "ASVS level: 2" in scope_line and lines.index(scope_line) == 1
    assert "Amina" not in "\n".join(lines) and "Omar" not in "\n".join(lines)
    assert not any(line.startswith("SCOPE:") for line in ai._item_lines(db.get(m.ComplianceAssessmentDocumentItem, 30)))
    draft = ai.build_draft_prompt(scoped, {"evidence_type": "Password policy", "document": "policy"}, [], "Demo Bank")
    assert "SCOPE OF THE ASSESSMENT: Subject: Digital Banking Web" in draft
