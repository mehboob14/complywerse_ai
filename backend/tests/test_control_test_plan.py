"""The test plan of a control: each objective, its exact test, and whether it applies.

An owner reads this page as "what will be tested for me", so the cases that matter
are the ones where a plausible rule would mislead: calling a test applicable when
the scope has ruled it out, counting a check from an unconnected system as a test
that ran, or leaving a control with an objective that has no written test.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.models import get_db
from grc.modules.automation import test_plan as tp
from grc.routers.auth_router import require_auth

OBJECTIVES = [
    {"ao_id": "ZZZ-01_A01", "seq": 1, "pptdf": "Technology", "rigor": "1",
     "objective": "multi-factor authentication for access to privileged accounts is implemented."},
    {"ao_id": "ZZZ-01_A02", "seq": 2, "pptdf": "Process", "rigor": "1",
     "objective": "activities associated with configuration-controlled changes are reviewed."},
    {"ao_id": "ZZZ-01_A03", "seq": 3, "pptdf": "Facility", "rigor": "2",
     "objective": "the physical facility where systems reside is protected."},
    {"ao_id": "ZZZ-01_A04", "seq": 4, "pptdf": "Data", "rigor": "2",
     "objective": "personal data is handled as classified."},
]
NIST = {"ZZZ-01_A01": [{
    "ref": "IA-02(01)", "control": "IA-02(01)", "title": "Multi-factor Authentication to Privileged Accounts",
    "match": "objective", "objective": "multi-factor authentication is implemented for privileged accounts.",
    "methods": {"EXAMINE": ["Identification and authentication policy", "system security plan"],
                "INTERVIEW": ["System developers"], "TEST": ["Automated mechanisms for authentication"]}}]}
OKTA = {"provider": "okta", "label": "Okta", "category": "identity", "id": "okta.users_mfa_enrolled",
        "title": "Users enrolled in MFA", "explain": {"checks": "Passes when every user has MFA."}}
GITHUB = {"provider": "github", "label": "GitHub", "category": "scm", "id": "github.org_2fa_required",
          "title": "2FA required", "explain": None}
APPLIES = {"state": "applies", "reason": "Your in-scope frameworks require it.", "source": "derived"}


def _plan(scope=None, applicability=APPLIES, connected=(), results=None, ao_checks=None, control_checks=()):
    return tp.build_test_plan(
        "ZZZ-01", OBJECTIVES, NIST, ao_checks if ao_checks is not None else {"ZZZ-01_A01": [OKTA]}, control_checks,
        applicability, scope or {"has_facilities": True, "processes_personal_data": True}, set(connected), results or {})


def test_every_objective_has_a_written_test():
    plan = _plan()
    by_ao = {t["ao_id"]: t for t in plan["tests"]}
    a1, a2 = by_ao["ZZZ-01_A01"], by_ao["ZZZ-01_A02"]
    assert [x["type"] for x in a1["nist"][0]["methods"]] == ["examine", "interview", "test"]
    assert a1["nist"][0]["control"] == "IA-02(01)" and a1["nist"][0]["refs"][0]["ref"] == "IA-02(01)"
    assert a1["nist"][0]["methods"][0]["items"] == ["Identification and authentication policy", "system security plan"]
    assert a1["standard"] is None                                    # NIST wrote this one
    # no NIST procedure: a fixed step for the objective's type, quoting the objective verbatim
    assert a2["nist"] == [] and a2["standard"]["type"] == "inspection"
    assert "configuration-controlled changes are reviewed" in a2["standard"]["description"]
    assert by_ao["ZZZ-01_A03"]["standard"]["type"] == "observation"
    assert all(t["nist"] or t["standard"] for t in plan["tests"])
    assert plan["summary"] == {"total": 4, "applies": 4, "not_applicable": 0, "automated": 1, "nist": 1, "standard": 3}


def test_a_check_from_an_unconnected_system_is_listed_but_never_shown_as_run():
    off = _plan()["tests"][0]["automated"][0]
    assert off["connected"] is False and off["state"] is None and off["title"] == "Users enrolled in MFA"
    on = _plan(connected=["okta"], results={"okta.users_mfa_enrolled": [{"status": "pass", "expired": False}]})
    assert on["tests"][0]["automated"][0]["state"] == "passing"
    failing = _plan(connected=["okta"], results={"okta.users_mfa_enrolled": [
        {"status": "pass", "expired": False}, {"status": "fail", "expired": False}]})
    assert failing["tests"][0]["automated"][0]["state"] == "failing"
    expired = _plan(connected=["okta"], results={"okta.users_mfa_enrolled": [{"status": "pass", "expired": True}]})
    assert expired["tests"][0]["automated"][0]["state"] == "expired"
    never_ran = _plan(connected=["okta"])
    assert never_ran["tests"][0]["automated"][0]["state"] is None


def test_several_parts_of_one_nist_control_are_one_block_not_repeated_lists():
    cited = {"ZZZ-01_A01": [
        {"ref": "CM-06(01)_ODP[01]", "control": "CM-06(01)", "title": "Automated Management", "match": "odp",
         "objective": None, "methods": {"EXAMINE": ["Configuration management policy"], "TEST": ["Mechanisms"]}},
        {"ref": "CM-06(01)_ODP[03]", "control": "CM-06(01)", "title": "Automated Management", "match": "odp",
         "objective": None, "methods": {"EXAMINE": ["Configuration management policy"], "TEST": ["Mechanisms"]}},
        {"ref": "CM-02(02)[01]", "control": "CM-02(02)", "title": "Automation Support", "match": "objective",
         "objective": "the accuracy of the baseline is maintained", "methods": {"INTERVIEW": ["Administrators"]}}]}
    plan = tp.build_test_plan("ZZZ-01", OBJECTIVES[:1], cited, {}, [], APPLIES, None, set(), {})
    blocks = plan["tests"][0]["nist"]
    assert [b["control"] for b in blocks] == ["CM-06(01)", "CM-02(02)"]
    assert [r["ref"] for r in blocks[0]["refs"]] == ["CM-06(01)_ODP[01]", "CM-06(01)_ODP[03]"]
    assert [m["type"] for m in blocks[0]["methods"]] == ["examine", "test"]          # once, not per part
    assert blocks[1]["refs"][0]["objective"] == "the accuracy of the baseline is maintained"


def test_checks_that_cover_the_whole_control_are_kept_apart_from_objective_checks():
    plan = _plan(control_checks=[GITHUB], connected=["github"])
    assert [c["id"] for c in plan["automated"]] == ["github.org_2fa_required"]
    assert plan["automated"][0]["connected"] is True
    assert all(c["id"] != "github.org_2fa_required" for t in plan["tests"] for c in t["automated"])


def test_the_scope_gates_rule_out_facility_and_data_objectives_only():
    plan = _plan(scope={"has_facilities": False, "processes_personal_data": False})
    by_ao = {t["ao_id"]: t for t in plan["tests"]}
    assert by_ao["ZZZ-01_A03"]["applies"] is False
    assert by_ao["ZZZ-01_A03"]["not_applicable_reason"] == "No owned or leased facilities in scope"
    assert by_ao["ZZZ-01_A04"]["not_applicable_reason"] == "Personal data processing is out of scope"
    assert by_ao["ZZZ-01_A01"]["applies"] and by_ao["ZZZ-01_A02"]["applies"]
    assert plan["summary"]["applies"] == 2 and plan["summary"]["not_applicable"] == 2
    assert objective_gate_none("Technology")


def objective_gate_none(kind):
    return tp.objective_gate(kind, {"has_facilities": False, "processes_personal_data": False}) is None


def test_a_control_that_does_not_apply_makes_every_test_not_applicable_with_the_reason():
    na = tp.control_applicability({"is_applicable": False, "applicability_source": "derived"})
    assert na["state"] == "not_applicable" and na["reason"] == "None of your in-scope frameworks require it."
    plan = _plan(applicability=na)
    assert all(not t["applies"] and t["not_applicable_reason"] == na["reason"] for t in plan["tests"])
    assert plan["summary"]["applies"] == 0
    explained = tp.control_applicability({"is_applicable": False, "applicability_source": "override",
                                          "applicability_reason": "We have no on-premises estate"})
    assert explained["reason"] == "We have no on-premises estate"


def test_shared_responsibility_a_compensating_control_and_an_exception_are_told_apart():
    full = tp.control_applicability({"is_applicable": True, "inheritance_type": "full", "applicability_source": "derived"})
    assert full["state"] == "inherited" and "assurance report" in full["reason"]
    assert not _plan(applicability=full)["tests"][0]["applies"]
    shared = tp.control_applicability({"is_applicable": True, "inheritance_type": "shared", "applicability_source": "derived"})
    assert shared["state"] == "applies" and "part you operate" in shared["reason"]
    alt = tp.control_applicability({"is_applicable": True, "alternative_scf_id": "ZZZ-09"}, "Backup alternative")
    assert alt["state"] == "alternative" and "ZZZ-09 (Backup alternative)" in alt["reason"]
    accepted = tp.control_applicability({"is_applicable": True, "exception_id": 4, "applicability_source": "derived"})
    assert accepted["state"] == "applies" and accepted["exception"] is True      # an exception does not remove the tests
    mandatory = tp.control_applicability({"is_applicable": True, "obligation": "MCR", "applicability_source": "derived"})
    assert mandatory["obligation_label"] == "a minimum compliance requirement"


def test_a_scope_that_was_never_calculated_says_so_instead_of_guessing():
    unscoped = tp.control_applicability(None)
    assert unscoped["state"] == "unscoped" and "not been calculated" in unscoped["reason"]
    assert all(t["applies"] for t in _plan(applicability=unscoped)["tests"])         # the tests are still shown


def test_the_catalog_lists_what_connector_checks_cover_without_any_seeded_plugin():
    cov = tp.catalog_coverage()
    assert cov["ao"] and all("_A" in ao for ao in cov["ao"])
    for entries in list(cov["ao"].values()) + list(cov["control"].values()):
        for e in entries:
            assert e["provider"] and e["label"] and e["id"] and e["title"]
    sid = next(iter(cov["control"]), None) or next(iter(cov["ao"])).split("_A")[0]
    inputs = tp.plan_inputs_for([sid])
    assert set(inputs) == {"nist_by_ao", "ao_checks", "control_checks"}
    assert all(ao.startswith(sid + "_") for ao in inputs["ao_checks"])


# ── the endpoint, end to end ────────────────────────────────────────────────
@pytest.fixture
def api():
    from grc.modules.automation import assurance

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    db = Session(engine)
    db.add(m.Tenant(id=1, name="Demo Bank", slug="demo"))
    user = m.GRCUser(id=7, username="owner", email="owner@bank.example", display_name="Owner")
    db.add(user)
    rel = m.SCFRelease(version="2026.2", is_current=True, import_status="ready")
    db.add(rel)
    db.flush()
    db.add_all([m.SCFControl(release_id=rel.id, scf_id="ZZZ-01", name="Test control", pptdf="Technology"),
                m.SCFControl(release_id=rel.id, scf_id="ZZZ-09", name="Backup alternative")])
    for o in OBJECTIVES:
        db.add(m.SCFObjective(release_id=rel.id, scf_id="ZZZ-01", ao_id=o["ao_id"], seq=o["seq"],
                              objective=o["objective"], pptdf=o["pptdf"], rigor=o["rigor"]))
    db.add(m.NormalizedControl(scf_id="ZZZ-01", code="ZZZ-01", name="Test control"))
    scope = m.SCFScope(tenant_id=1, name="Default", release_id=rel.id, framework_slugs=["soc2"], is_default=True,
                       has_facilities=False)
    db.add(scope)
    db.flush()
    db.add(m.SCFControlState(tenant_id=1, scope_id=scope.id, scf_id="ZZZ-01", is_applicable=True,
                             applicability_source="derived", obligation="MCR"))
    db.add(m.IntegrationConnection(tenant_id=1, integration_type="okta", is_active=True,
                                  connection_name="Okta", console_url="https://demo.okta.com"))
    db.commit()
    app = TestClient(__import__("grc.main", fromlist=["app"]).app)
    app.app.dependency_overrides[get_db] = lambda: db
    app.app.dependency_overrides[require_auth] = lambda: user
    yield app, db, scope
    app.app.dependency_overrides.clear()
    db.close()


def test_the_endpoint_returns_the_plan_for_the_controls_own_scope(api):
    http, db, scope = api
    got = http.get("/automation/common/controls/ZZZ-01/test-plan")
    assert got.status_code == 200, got.text
    plan = got.json()
    assert plan["applicability"]["state"] == "applies" and plan["applicability"]["obligation_label"].startswith("a minimum")
    assert [t["ao_id"] for t in plan["tests"]] == ["ZZZ-01_A01", "ZZZ-01_A02", "ZZZ-01_A03", "ZZZ-01_A04"]
    by_ao = {t["ao_id"]: t for t in plan["tests"]}
    assert by_ao["ZZZ-01_A03"]["not_applicable_reason"] == "No owned or leased facilities in scope"   # scope has no facilities
    assert by_ao["ZZZ-01_A02"]["standard"]["type"] == "inspection"
    assert plan["scope"] == {"has_facilities": False, "processes_personal_data": True}

    # a compensating control takes every test off the plate, naming the control that covers it
    state = db.query(m.SCFControlState).filter_by(scf_id="ZZZ-01").one()
    state.alternative_scf_id = "ZZZ-09"
    db.commit()
    alt = http.get("/automation/common/controls/ZZZ-01/test-plan").json()
    assert alt["applicability"]["state"] == "alternative" and "Backup alternative" in alt["applicability"]["reason"]
    assert alt["summary"]["applies"] == 0


def test_the_endpoint_404s_for_a_control_that_is_not_in_the_catalog(api):
    http, _db, _scope = api
    assert http.get("/automation/common/controls/NOPE-99/test-plan").status_code == 404
