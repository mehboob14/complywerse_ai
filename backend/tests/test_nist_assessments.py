"""NIST assessments (SP 800-53A control assessment, CSF 2.0 profile): made from the NIST library, scoped, started, and decided (the API and the rules).

The questions are not an uploaded workbook: the baseline (or the functions) the scope chooses decides them, the way NIST's own method does.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.models import get_db
from grc.modules.assessments import nist, scoping
from grc.routers.auth_router import require_auth

BASE = "/compliance/assessments"


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    s = Session(engine)
    s.add(m.Tenant(id=1, name="Demo Bank", slug="demo"))
    s.add_all([m.GRCUser(id=7, username="assessor", email="a@bank.example", display_name="Assessor Person"),
               m.GRCUser(id=8, username="amina", email="amina@bank.example", display_name="Amina Khan"),
               m.GRCUser(id=9, username="omar", email="omar@bank.example", display_name="Omar Sheikh")])
    s.commit()
    yield s
    s.close()


@pytest.fixture
def http(db):
    from grc.main import app

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(m.GRCUser, 7)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


PEOPLE = [{"kind": "user", "user_id": 8, "role": "owner"}, {"kind": "user", "user_id": 9, "role": "assessor", "independent": True}]


def draft(http, fmt="nist_800_53a", subject="Core Banking"):
    r = http.post(f"{BASE}/initiate", json={"assessment_format": fmt, "subject": subject})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def started(http, fmt="nist_800_53a", **scope):
    aid = draft(http, fmt)
    base = {"organisation": "Demo Bank", "participants": PEOPLE, **({"baseline": "moderate"} if fmt == "nist_800_53a" else {"functions": ["GV"]})}
    assert http.put(f"{BASE}/{aid}/scope", json={"scope": {**base, **scope}}).status_code == 200
    out = http.post(f"{BASE}/{aid}/start")
    assert out.status_code == 200, out.text
    return aid


def items(http, aid):
    return http.get(f"{BASE}/{aid}").json()["items"]


# ── the seeds are NIST's numbers ─────────────────────────────────────────────────────────────────────────────────────
def test_the_baselines_are_the_published_ones_and_every_control_has_its_objectives_and_methods():
    assert [len(nist.controls_of(b)) for b in nist.BASELINES] == [149, 287, 370]                 # SP 800-53B Rev. 5
    assert len(set(nist.controls_of("moderate", privacy=True)) - set(nist.controls_of("moderate"))) > 0       # the privacy baseline adds controls
    for baseline in nist.BASELINES:
        for label in nist.controls_of(baseline):
            assert nist._objectives()["controls"][label]["objectives"], label
            assert (nist._methods().get(label) or {}).get("methods"), label
    assert nist.controls_of("moderate")[:2] == ["AC-01", "AC-02"]                                  # NIST's order: a control, then its enhancements


# ── the types a person can start ─────────────────────────────────────────────────────────────────────────────────────
def test_the_templates_list_the_nist_assessments_with_their_size_and_no_workbook_to_upload(http):
    rows = {t["assessment_format"]: t for t in http.get(f"{BASE}/templates").json()["templates"]}
    a, c = rows["nist_800_53a"], rows["nist_csf2"]
    assert (a["label"], a["scope_model"], a["questionnaire"]["assessment_id"], a["library"]["version"]) == ("NIST SP 800-53A", "system", None, "Rev. 5")
    assert a["library"]["baselines"]["moderate"] == {"controls": 287, "objectives": 1306}
    assert len(a["questionnaire"]["domains"]) == 20 and c["questionnaire"]["items"] == 106 and len(c["questionnaire"]["domains"]) == 6
    assert a["library"]["source"]["licence"].startswith("Public domain")


# ── a new assessment ─────────────────────────────────────────────────────────────────────────────────────────────────
def test_a_control_assessment_starts_as_a_draft_of_a_named_system_and_says_what_is_missing(http):
    out = http.post(f"{BASE}/initiate", json={"assessment_format": "nist_800_53a", "subject": "Core Banking"})
    assert out.status_code == 201
    view = out.json()
    assert (view["name"], view["scope_model"], view["family"], view["phase"], view["template"], view["total_items"]) == ("NIST SP 800-53A - Core Banking", "system", "nist", "scoping", None, 0)
    assert view["scope"]["system"] == "Core Banking" and view["scope"]["baseline"] is None and view["library"]["publication"] == "SP800-53A"
    missing = {c["key"] for c in view["readiness"]["checks"] if c["required"] and not c["ok"]}
    assert missing == {"organisation", "baseline", "system_owner", "assessor"} and view["readiness"]["ready"] is False        # the owner is the person who made it
    assert len(view["domains"]) == 18 and "PM - Program Management" not in {d["name"] for d in view["domains"]}      # the families of the Moderate baseline (program management is no one's baseline)
    assert http.post(f"{BASE}/initiate", json={"assessment_format": "nist_800_53a"}).status_code == 400       # the system must be named
    assert http.post(f"{BASE}/initiate", json={"assessment_format": "nist_nonsense", "subject": "x"}).status_code == 400
    csf = http.post(f"{BASE}/initiate", json={"assessment_format": "nist_csf2", "subject": "Demo Bank"}).json()
    assert csf["scope"]["functions"] == ["GV", "ID", "PR", "DE", "RS", "RC"]                         # all six to begin with
    assert {c["key"] for c in csf["readiness"]["checks"] if c["required"] and not c["ok"]} == {"organisation", "system_owner"}     # the CSF has no baseline and needs no assessor


def test_the_scope_of_a_nist_assessment_is_checked_and_the_baseline_decides_the_domains(http):
    aid = draft(http)
    assert http.put(f"{BASE}/{aid}/scope", json={"scope": {"baseline": "extreme"}}).status_code == 422
    assert http.put(f"{BASE}/{aid}/scope", json={"scope": {"unknown_key": 1}}).status_code == 422
    ok = http.put(f"{BASE}/{aid}/scope", json={"scope": {"baseline": "low", "privacy_overlay": True}})
    assert ok.status_code == 200 and ok.json()["scope"]["baseline"] == "low"
    assert 15 <= len(ok.json()["domains"]) <= 20 and all(d["count"] > 0 for d in ok.json()["domains"])
    csf = draft(http, "nist_csf2")
    sent = http.put(f"{BASE}/{csf}/scope", json={"scope": {"functions": ["PR", "GV", "PR"]}}).json()
    assert sent["scope"]["functions"] == ["GV", "PR"] and {d["name"] for d in sent["domains"]} == {"GV - Govern", "PR - Protect"}      # once each, in NIST's order


def test_start_is_refused_until_the_required_parts_are_filled(http):
    aid = draft(http)
    out = http.post(f"{BASE}/{aid}/start")
    assert out.status_code == 422 and {c["key"] for c in out.json()["detail"]["checks"]} >= {"baseline", "assessor", "system_owner"}


# ── start: the questions come from the baseline ──────────────────────────────────────────────────────────────────────
def test_start_makes_a_question_of_every_control_of_the_baseline_with_its_objectives_methods_and_objects(http, db):
    aid = started(http)
    view = http.get(f"{BASE}/{aid}/scope").json()
    rows = items(http, aid)
    assert (view["phase"], view["total_items"], len(rows)) == ("in_progress", 287, 287)
    assert view["snapshot"]["template"]["library"]["publication"].startswith("NIST SP 800-53 Rev. 5") and view["subject_summary"].startswith('Subject: the system "Core Banking" of Demo Bank.')
    first = rows[0]
    assert (first["item_number"], first["compliance_status"], first["area_domain"]) == ("AC-01", "in_progress", "AC - Access Control")
    data = first["assessment_data"]
    assert data["kind"] == "800-53A" and data["statement"].startswith("a. Develop, document, and disseminate") and len(data["objectives"]) >= 10
    assert all(o["determination"] is None for o in data["objectives"]) and {"EXAMINE", "INTERVIEW"} <= set(data["methods"])
    assert "Access control policy" in "; ".join(data["methods"]["EXAMINE"]) and "NIST SP 800-53A" in first["remarks"]            # what the AI advice reads
    assert sum(len(r["assessment_data"]["objectives"]) for r in rows) == 1306
    assert [i.compliance_status for i in db.query(m.ComplianceAssessmentDocumentItem).filter_by(assessment_id=aid)].count("in_progress") == 287


def test_the_baseline_and_the_privacy_overlay_and_tailoring_decide_which_controls_are_assessed(http):
    high = started(http, baseline="high", privacy_overlay=True)
    labels = {r["item_number"] for r in items(http, high)}
    assert labels == set(nist.controls_of("high", privacy=True)) and len(labels) > 370
    tailored = started(http, baseline="low", exclusions=[{"what": "PE-03 Physical access control", "reason": "A cloud service: the provider's facility is out of boundary."}])
    rows = {r["item_number"]: r for r in items(http, tailored)}
    assert rows["PE-03"]["compliance_status"] == "na" and "out of boundary" in rows["PE-03"]["remarks"]
    assert all(o["determination"] == "not_applicable" for o in rows["PE-03"]["assessment_data"]["objectives"])
    assert rows["AC-01"]["compliance_status"] == "in_progress"


def test_each_domain_is_assigned_to_the_people_who_listed_it(http):
    people = PEOPLE[:1] + [{"kind": "user", "user_id": 9, "role": "assessor", "independent": True, "domains": ["AC - Access Control"]}]
    aid = started(http, participants=people)
    by_domain = {}
    for r in items(http, aid):
        by_domain.setdefault(r["area_domain"], []).append([a["id"] for a in r["assignees"]])
    assert all(a == [9] for a in by_domain["AC - Access Control"]) and all(a == [] for a in by_domain["AU - Audit and Accountability"])


# ── what the assessor decides ────────────────────────────────────────────────────────────────────────────────────────
def test_a_control_is_satisfied_only_when_every_objective_is_and_the_assessments_counts_follow(http):
    aid = started(http, baseline="low")
    first = items(http, aid)[0]
    url = f"{BASE}/items/{first['id']}/determination"
    objectives = first["assessment_data"]["objectives"]
    one = http.put(url, json={"objective": objectives[0]["id"], "determination": "satisfied"})
    assert one.status_code == 200 and one.json()["compliance_status"] == "in_progress"                # one objective of many: not yet
    everything = http.put(url, json={"all": "satisfied"})
    assert everything.json()["compliance_status"] == "complied" and everything.json()["counts"]["complied"] == 1
    failing = http.put(url, json={"objective": objectives[1]["id"], "determination": "other_than_satisfied", "note": "Accounts are not reviewed."}).json()
    assert failing["compliance_status"] == "not_complied" and failing["assessment_data"]["objectives"][1]["note"] == "Accounts are not reviewed."
    assert failing["counts"] == {"complied": 0, "partially_complied": 0, "not_complied": 1, "in_progress": 148, "na": 0}
    cleared = http.put(url, json={"objective": objectives[1]["id"], "determination": None}).json()
    assert cleared["compliance_status"] == "in_progress"                                             # one objective is undecided again: not satisfied yet
    assert http.put(url, json={"objective": objectives[1]["id"], "determination": "satisfied"}).json()["compliance_status"] == "complied"
    allna = http.put(url, json={"all": "not_applicable"}).json()
    assert allna["compliance_status"] == "na"
    row = http.get(f"{BASE}/{aid}").json()
    assert (row["complied_count"], row["na_count"], row["in_progress_count"]) == (0, 1, 148)


def test_a_decision_is_refused_before_start_on_another_kind_of_item_or_with_a_wrong_word(http, db):
    aid = draft(http)
    assert http.put(f"{BASE}/items/1/determination", json={"all": "satisfied"}).status_code == 404
    done = started(http)
    item = items(http, done)[0]
    url = f"{BASE}/items/{item['id']}/determination"
    assert http.put(url, json={"all": "fine"}).status_code == 400
    assert http.put(url, json={"objective": "ZZ-99", "determination": "satisfied"}).status_code == 400
    plain = m.ComplianceAssessmentDocument(id=900, tenant_id=1, name="Plain", assessment_type="gap_assessment", assessment_format="asvs_checklist", total_items=1)
    db.add(plain)
    db.add(m.ComplianceAssessmentDocumentItem(id=9001, assessment_id=900, tenant_id=1, item_number="V1", control_description="x"))
    db.commit()
    assert http.put(f"{BASE}/items/9001/determination", json={"all": "satisfied"}).status_code == 409        # nothing to determine on an ordinary item
    assert aid and http.get(f"{BASE}/{aid}/scope").json()["phase"] == "scoping"


def test_a_csf_profile_has_the_subcategories_of_the_functions_in_scope_and_rates_them_with_a_target(http):
    aid = started(http, "nist_csf2", functions=["GV"])
    rows = items(http, aid)
    assert len(rows) == 31 and {r["area_domain"] for r in rows} == {"GV - Govern"} and rows[0]["item_number"] == "GV.OC-01"
    assert rows[0]["assessment_data"]["kind"] == "CSF2" and rows[0]["assessment_data"]["examples"] and "Implementation examples" in rows[0]["control_description"]
    url = f"{BASE}/items/{rows[0]['id']}/determination"
    assert http.put(url, json={"current": "FI", "target": "FI"}).json()["compliance_status"] == "complied"
    assert http.put(url, json={"current": "LI"}).json()["compliance_status"] == "partially_complied"
    assert http.put(url, json={"current": "NI"}).json()["assessment_data"]["target"] == "FI"             # only what is sent changes
    assert http.put(url, json={"current": "XX"}).status_code == 400
    assert http.put(url, json={"current": None}).json()["compliance_status"] == "in_progress"
    assert http.put(url, json={"current": "NA"}).json()["compliance_status"] == "na"


def test_once_started_the_baseline_is_fixed_but_who_takes_part_can_change(http):
    aid = started(http)
    assert http.put(f"{BASE}/{aid}/scope", json={"scope": {"baseline": "high"}}).status_code == 409
    assert http.put(f"{BASE}/{aid}/scope", json={"scope": {"notes": "Reviewed with the system owner."}}).status_code == 200


# ── around the engine ────────────────────────────────────────────────────────────────────────────────────────────────
def test_a_nist_assessment_is_on_the_board_scored_as_a_checklist_and_in_the_audit_trail_with_the_cyber_security_hub(http):
    from grc.feature_map import assessment_place

    aid = started(http, baseline="low")
    first = items(http, aid)[0]
    http.put(f"{BASE}/items/{first['id']}/determination", json={"all": "satisfied"})
    board = http.get(f"{BASE}/overview").json()
    rows = [a for c in board["categories"] for a in c["assessments"] if a["id"] == aid]
    assert rows and rows[0]["family"] == "checklist" and rows[0]["format"] == "nist_800_53a" and rows[0]["n_items"] == 149
    assert assessment_place("nist_800_53a") == ("Assessments", "Cyber Security") == assessment_place("nist_csf2")
    assert scoping.model_of("nist_csf2") == "system" and scoping.label_of("nist_800_53a") == "NIST SP 800-53A"
