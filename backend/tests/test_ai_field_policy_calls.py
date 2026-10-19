"""The call sites that read a record into a prompt go through the field policies.

The data-protection guard is switched off in these tests (the operator's emergency setting), so the request body is
exactly what the module itself put in the prompt: a column the policy suppresses must not be in it, with no help from
the guard.
"""
import importlib
import json
import re
from datetime import datetime, timedelta

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openai import OpenAI
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import grc.config  # noqa: F401  (installs the shim)
import grc.models as m
from grc.models import Base, get_db
from grc.routers.auth_router import require_auth
from grc.services import ai_usage

critical_tasks_router = importlib.import_module("grc.routers.critical_tasks_router")


@pytest.fixture
def wire(monkeypatch):
    """A client over a recording mock transport; ``wire.reply(body) -> text`` is what the model answers."""
    monkeypatch.setenv("AI_GATEWAY_MODE", "off")
    state = type("Wire", (), {})()
    state.bodies, state.reply = [], (lambda body: "{}")

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        state.bodies.append(body)
        return httpx.Response(200, json={
            "id": "c1", "object": "chat.completion", "created": 0, "model": "gpt-test",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": state.reply(body)}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}})

    state.client = OpenAI(api_key="test", base_url="http://mock.invalid/v1", http_client=httpx.Client(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(ai_usage, "record_provider_attempt", lambda **kw: None)
    state.sent = lambda: json.dumps(state.bodies[-1]["messages"])
    return state


def _prompt(body):
    return body["messages"][-1]["content"]


def _json_after(prompt, marker):
    """The JSON value that follows ``marker`` in a prompt."""
    return json.JSONDecoder().raw_decode(prompt[prompt.index(marker) + len(marker):].lstrip())[0]


# ── tasks ───────────────────────────────────────────────────────────────────────────────────────────────────────
@pytest.fixture
def tasks_http(wire, monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    tables = [m.Tenant, m.GRCUser, m.CriticalTask, m.CriticalTaskSubTask, m.CriticalTaskComment, m.CriticalTaskHistory,
              m.CriticalTaskApproval, m.NotificationPreference,
              m.Role, m.UserRole, m.Permission, m.RolePermission]          # the workload counts the tasks the person's board shows
    Base.metadata.create_all(engine, tables=[t.__table__ for t in tables])
    db = sessionmaker(bind=engine)()
    db.add(m.Tenant(id=1, name="Bank", slug="bank"))
    for uid, username, display in ((7, "officer", "Quentin Marlowe"), (8, "ayesha", "Ayesha Qureshi"), (9, "bilal", "Bilal Siddiqui")):
        db.add(m.GRCUser(id=uid, username=username, display_name=display, email=f"{username}@bank.test", is_active=True))
    soon = datetime.utcnow() + timedelta(days=2)
    rows = [
        (1, "Patch the ledger", "High", 8, "Critical", "CANARY_approval_comment_1"),
        (2, "Review vendor access", "Critical", 8, "Open", "CANARY_approval_comment_2"),
        (3, "Rotate keys", "Medium", 9, "In Progress", "CANARY_approval_comment_3"),
        (4, "Unowned item", "Low", None, "Open", "CANARY_approval_comment_4"),
    ]
    for tid, title, priority, owner, status, canary in rows:
        db.add(m.CriticalTask(
            id=tid, tenant_id=1, title=title, description="Details of the work", priority=priority, status=status,
            category="Compliance", source="Manual", assigned_owner_id=owner, assigned_user_ids=[owner] if owner else [],
            reviewer_id=7, created_by_id=7, due_date=soon, sla_days=5, escalation_level=1, approval_comment=canary,
            custom_values={"secret_field": f"CANARY_custom_{tid}"}, evidence_notes="Notes on the work", linked_risk_id=910001))
    db.add(m.CriticalTaskComment(id=1, task_id=1, user_id=7, content="Ledger fix is blocked on a change window"))
    db.commit()
    monkeypatch.setattr(critical_tasks_router, "_get_openai_client", lambda: wire.client)
    monkeypatch.setattr(critical_tasks_router, "_get_openai_model", lambda: "gpt-test")
    app = FastAPI()
    app.include_router(critical_tasks_router.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(m.GRCUser, 7)
    app.dependency_overrides[critical_tasks_router.router.dependencies[0].dependency] = lambda: True
    yield TestClient(app)
    db.close()


NAMES = ("Quentin Marlowe", "Ayesha Qureshi", "Bilal Siddiqui", "officer@bank.test", "ayesha@bank.test")


def _no_leak(wire):
    sent = wire.sent()
    leaked = [n for n in NAMES + tuple(f"CANARY_custom_{i}" for i in range(1, 5)) + tuple(f"CANARY_approval_comment_{i}" for i in range(1, 5))
              + ("910001",) if n in sent]
    assert not leaked, f"reached the prompt: {leaked}"


def test_prioritising_tasks_sends_what_ranking_needs_and_nothing_else(tasks_http, wire):
    wire.reply = lambda body: json.dumps({"suggestions": [{"task_id": 2, "current_priority": "Critical", "suggested_priority": "Critical", "justification": "j"}]})
    out = tasks_http.post("/critical-tasks/ai/prioritize-tasks")
    assert out.status_code == 200 and out.json()["suggestions"][0]["task_id"] == 2
    _no_leak(wire)
    rows = _json_after(_prompt(wire.bodies[-1]), "suggest priority changes:\n")
    assert {r["id"] for r in rows} == {1, 2, 3, 4} and set(rows[0]) == {
        "id", "title", "current_priority", "status", "category", "source", "due_date", "sla_status", "escalation_level"}


def test_root_cause_analysis_reads_the_task_and_its_comments_only(tasks_http, wire):
    wire.reply = lambda body: json.dumps({"analysis": {"root_causes": [], "remediation_actions": [], "summary": "s"}})
    assert tasks_http.post("/critical-tasks/1/ai/analyze-root-cause").status_code == 200
    _no_leak(wire)
    context = _json_after(_prompt(wire.bodies[-1]), "root causes:\n")
    assert context["comments"] == ["Ledger fix is blocked on a change window"]
    assert set(context) == {"title", "description", "source", "source_module", "category", "priority", "severity", "status",
                            "evidence_notes", "comments"}


def test_escalation_prediction_names_owners_by_alias_and_the_answer_names_them_again(tasks_http, wire):
    def reply(body):
        rows = _json_after(_prompt(body), "breach SLA:\n")
        owner = next(r["owner"] for r in rows if r["id"] == 1)
        return json.dumps({"predictions": [{"task_id": 1, "title": "Patch the ledger", "risk_score": 0.9,
                                            "risk_factors": [f"{owner} already holds two tasks"], "recommended_actions": []}]})
    wire.reply = reply
    out = tasks_http.post("/critical-tasks/ai/predict-escalations")
    assert out.status_code == 200, out.text
    _no_leak(wire)
    rows = _json_after(_prompt(wire.bodies[-1]), "breach SLA:\n")
    assert sorted({r["owner"] for r in rows}) == ["P1", "P2", "Unassigned"]
    assert out.json()["predictions"][0]["risk_factors"] == ["Ayesha Qureshi already holds two tasks"]


def test_workload_balancing_maps_the_suggested_owner_by_alias_and_restores_names(tasks_http, wire):
    def reply(body):
        rows = _json_after(_prompt(body), "Tasks:\n")
        owner_of = {r["title"]: r["owner"] for r in rows}
        busy, free = owner_of["Patch the ledger"], owner_of["Rotate keys"]
        return json.dumps({"current_workload": {busy: {"task_count": 2, "load_level": "high"}, free: {"task_count": 1, "load_level": "low"}},
                           "suggestions": [{"task_id": 2, "task_title": "Review vendor access", "current_owner": busy,
                                            "suggested_owner": free, "reason": f"{free} has room"}], "summary": f"Move work from {busy} to {free}"})
    wire.reply = reply
    out = tasks_http.post("/critical-tasks/ai/balance-workload")
    assert out.status_code == 200, out.text
    _no_leak(wire)
    prompt = _prompt(wire.bodies[-1])
    assert "user_id" not in prompt and "owner_id" not in prompt
    body = out.json()
    suggestion = body["suggestions"][0]
    assert suggestion["suggested_owner"] == "Bilal Siddiqui" and suggestion["current_owner"] == "Ayesha Qureshi"
    assert suggestion["suggested_owner_id"] == 9                                   # found by alias, not by display name
    assert suggestion["reason"] == "Bilal Siddiqui has room" and body["summary"] == "Move work from Ayesha Qureshi to Bilal Siddiqui"
    assert set(body["current_workload"]) == {"Ayesha Qureshi", "Bilal Siddiqui"}


# ── vulnerabilities (and the assets they sit on) ────────────────────────────────────────────────────────────────
ai_analysis = importlib.import_module("grc.modules.vuln_management.routers.ai_analysis")
VULN_CANARIES = ("CANARY-HOST-77", "canary-url.example", "CANARY_evidence", "CANARY_repro", "CANARY_resolution", "CANARY_custom",
                 "CANARY-ASSET-NAME", "CANARY_owner", "CANARY_serial", "canary.host.example", "10.9.9.9", "CANARY_exception")


@pytest.fixture
def vulns_http(wire, monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    tables = [m.Tenant, m.GRCUser, m.Vulnerability, m.VulnerabilityReport, m.VulnerabilityAssetLink, m.ITAsset, m.VulnerabilityAIJob]
    Base.metadata.create_all(engine, tables=[t.__table__ for t in tables])
    db = sessionmaker(bind=engine)()
    db.add(m.Tenant(id=1, name="Bank", slug="bank"))
    db.add(m.GRCUser(id=7, username="officer", display_name="Officer", email="officer@bank.test", is_active=True))
    db.add(m.VulnerabilityReport(id=1, tenant_id=1, name="Q3 external scan", report_type="scan", scan_tool="Nessus", total_vulnerabilities=1,
                                 critical_count=0, high_count=1, medium_count=0, low_count=0))
    db.add(m.Vulnerability(
        id=1, tenant_id=1, report_id=1, vuln_id="plugin-1", title="OpenSSL buffer over-read", description="Scanner: the service reads past a buffer",
        severity="High", cvss_score=7.5, cve_id="CVE-2024-0001", cwe_id="CWE-125", affected_component="OpenSSL 1.0.2",
        affected_host="CANARY-HOST-77", affected_url="https://canary-url.example/x", evidence="CANARY_evidence output",
        reproduction_steps="CANARY_repro steps", resolution_notes="CANARY_resolution", custom_values={"k": "CANARY_custom"},
        exception_justification="CANARY_exception", assigned_to=7, kev_flag=True, kev_date_added=datetime(2024, 3, 2),
        epss_score=0.5, epss_percentile=0.97, composite_priority=8.1, status="open",
        patch_references=[{"id": "KB5001", "url": "https://vendor.example/kb5001", "source": "vendor"}],
        vendor_advisory_ids=["ADV-1"], remediation_guidance="Install the vendor update", recommendation="Upgrade OpenSSL"))
    db.add(m.ITAsset(id=1, tenant_id=1, name="CANARY-ASSET-NAME", asset_type="server", criticality="High", internet_facing=True,
                     data_classification="Restricted", owner_name="CANARY_owner", serial_number="CANARY_serial",
                     fqdn="canary.host.example", ip_address="10.9.9.9", host_name="CANARY-HOST-77"))
    db.add(m.VulnerabilityAssetLink(vulnerability_id=1, asset_id=1))
    db.commit()
    monkeypatch.setattr(ai_analysis, "get_openai_client", lambda: wire.client)
    app = FastAPI()
    app.include_router(ai_analysis.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(m.GRCUser, 7)
    yield TestClient(app)
    db.close()


def _assert_none_of(sent, needles):
    leaked = [n for n in needles if n in sent]
    assert not leaked, f"reached the prompt: {leaked}"


def test_a_scan_report_summary_carries_titles_severity_and_cve_only(vulns_http, wire):
    wire.reply = lambda body: "A short analysis."
    out = vulns_http.post("/ai/analyze-report/1")
    assert out.status_code == 200 and out.json()["status"] == "completed", out.text
    sent = wire.sent()
    assert "OpenSSL buffer over-read (Severity: High, CVE: CVE-2024-0001)" in sent
    _assert_none_of(sent, VULN_CANARIES)


def test_the_fix_suggestion_describes_the_asset_by_what_it_is_and_leaves_the_rest_out(vulns_http, wire):
    wire.reply = lambda body: json.dumps({"summary": "Segment it.", "suggestions": [
        {"title": "Restrict access", "description": "Allow only the app tier.", "priority": "high", "effort": "low", "category": "isolation"}]})
    out = vulns_http.post("/ai/suggest-fix/1")
    assert out.status_code == 200 and out.json()["status"] == "completed", out.text
    prompt = _prompt(wire.bodies[-1])
    _assert_none_of(wire.sent(), VULN_CANARIES)
    assert "Title: OpenSSL buffer over-read" in prompt and "CVE: CVE-2024-0001" in prompt and "Affected Component: OpenSSL 1.0.2" in prompt
    assert "- Asset 1, type=server, criticality=High, internet_facing=YES, data=Restricted" in prompt
    assert "CISA KEV: YES" in prompt and "added 2024-03-02" in prompt and "KB5001 (vendor)" in prompt and "ADV-1" in prompt
    assert "Affected Host" not in prompt and "Install the vendor update" in prompt and "Upgrade OpenSSL" in prompt


def test_control_mapping_sends_the_finding_not_its_host_or_scanner_output():
    from grc.services import ai_control_mapping

    vuln = m.Vulnerability(id=1, title="TLS 1.0 enabled", cve_id=None, cwe_id="CWE-327", cvss_vector="AV:N", severity="Medium",
                           description="Scanner: weak protocol " + "x" * 2000, affected_host="CANARY-HOST-77",
                           evidence="CANARY_evidence output", reproduction_steps="CANARY_repro steps", assigned_to=7,
                           epss_score=None, kev_flag=False)
    context = ai_control_mapping._vuln_context(vuln, cwe_name="Weak crypto", nvd_description=None)
    _assert_none_of(context, VULN_CANARIES)
    assert "title: TLS 1.0 enabled" in context and "cwe: CWE-327 — Weak crypto" in context and "epss: n/a   in_kev: False" in context
    assert len(context) < 1500                                                   # the scanner text is capped at 1,200


def test_the_attack_story_names_the_kind_of_asset_not_the_asset():
    from grc.modules.vuln_management.attack import narrative
    from grc.modules.vuln_management.attack.view import build_view

    vuln = m.Vulnerability(id=1, title="OpenSSL", cve_id="CVE-2024-0001", cwe_id="CWE-125", severity="High", cvss_vector="AV:N/AC:L",
                           epss_score=0.5, kev_flag=True, status="open")
    asset = m.ITAsset(id=1, name="CANARY-ASSET-NAME", asset_type="server", internet_facing=True, criticality="High",
                      fqdn="canary.host.example", ip_address="10.9.9.9")
    facts = narrative._assessment_facts(build_view(vuln, asset))
    _assert_none_of(facts, VULN_CANARIES)
    assert "Asset: server (internet_facing=True, criticality=High)" in facts


# ── risks and incidents ─────────────────────────────────────────────────────────────────────────────────────────
risks_router = importlib.import_module("grc.modules.erm.routers.risks")
mitigation_actions = importlib.import_module("grc.modules.erm.routers.mitigation_actions")
advanced_analytics = importlib.import_module("grc.modules.erm.routers.advanced_analytics")
incidents_router = importlib.import_module("grc.modules.erm.routers.incidents")
risk_assessments = importlib.import_module("grc.modules.erm.routers.risk_assessments")
RISK_CANARIES = ("CANARY_root_cause", "CANARY_consequences", "CANARY_plan", "CANARY_custom", "CANARY_closure", "CANARY_srcref",
                 "CANARY_ubl", "CANARY_scenario", "CANARY_inc_description", "CANARY_inc_root", "CANARY_lessons", "CANARY_inc_actions",
                 "Quentin Marlowe", "quentin@bank.test", "2500000")


@pytest.fixture
def erm(wire, monkeypatch):
    import openai

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add(m.Tenant(id=1, name="Bank", slug="bank"))
    db.add(m.GRCUser(id=7, username="qmarlowe", display_name="Quentin Marlowe", email="quentin@bank.test", is_active=True))
    db.add(m.Risk(
        id=1, tenant_id=1, title="Core banking outage", description="The ledger may be unavailable for hours", category="operational",
        risk_category="technology", risk_sub_category="availability", inherent_likelihood=4, inherent_impact=5, inherent_score=20,
        residual_likelihood=3, residual_impact=4, residual_score=12, status="open", owner_id=7, business_owner_id=7,
        root_cause="CANARY_root_cause", consequences="CANARY_consequences", treatment_plan="CANARY_plan",
        custom_values={"k": "CANARY_custom"}, closure_notes="CANARY_closure", source_reference="CANARY_srcref",
        ubl_fields={"x": "CANARY_ubl"}, scenario_statement="CANARY_scenario"))
    db.add(m.RiskIncident(
        id=1, tenant_id=1, risk_id=1, title="Ledger outage on payday", description="CANARY_inc_description", severity="High",
        incident_date=datetime.utcnow() - timedelta(days=140), financial_impact=2500000, root_cause="CANARY_inc_root",
        lessons_learned="CANARY_lessons", corrective_actions="CANARY_inc_actions", reported_by=7, assigned_to=7))
    db.commit()
    for module, name in ((risks_router, "get_openai_client"), (mitigation_actions, "_get_openai_client"),
                         (incidents_router, "get_openai_client"), (risk_assessments, "_get_openai_client")):
        monkeypatch.setattr(module, name, lambda: wire.client)
    monkeypatch.setattr(openai, "OpenAI", lambda **kw: wire.client)        # the bow-tie builds its own client
    monkeypatch.setattr(advanced_analytics, "get_openai_model", lambda: "gpt-test")
    app = FastAPI()
    for module in (risks_router, mitigation_actions, advanced_analytics, incidents_router):
        app.include_router(module.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(m.GRCUser, 7)
    client = TestClient(app)
    client.db = db
    yield client
    db.close()


def test_a_treatment_plan_carries_the_risk_scores_and_wording_only(erm, wire):
    wire.reply = lambda body: "1. Treatment strategy: mitigate."
    out = erm.post("/risks/1/ai-treatment-plan")
    assert out.status_code == 200 and out.json()["treatment_plan"].startswith("1. Treatment strategy"), out.text
    prompt = _prompt(wire.bodies[-1])
    _assert_none_of(wire.sent(), RISK_CANARIES)
    assert "Risk Title: Core banking outage" in prompt and "Category: technology" in prompt
    assert "Residual Likelihood: 3/5" in prompt and "Current Status: open" in prompt


def test_mitigation_suggestions_read_the_risk_and_nothing_about_who_owns_it(erm, wire):
    wire.reply = lambda body: json.dumps({"suggestions": [{"title": "Fail over", "description": "d", "action_type": "mitigate",
                                                           "priority": "high", "expected_residual_reduction": 20}]})
    out = erm.post("/mitigation-actions/ai-suggest", json={"risk_id": 1})
    assert out.status_code == 200 and out.json()["suggestions"][0]["title"] == "Fail over", out.text
    prompt = _prompt(wire.bodies[-1])
    _assert_none_of(wire.sent(), RISK_CANARIES)
    assert "Risk Title: Core banking outage" in prompt and "Risk Sub-Category: availability" in prompt and "Inherent Impact: 5" in prompt


def test_the_bow_tie_narrative_names_incidents_by_title_and_severity_only(erm, wire):
    wire.reply = lambda body: "A narrative."
    out = erm.post("/analytics/bowtie/1/ai-narrative")
    assert out.status_code == 200 and out.json()["narrative"] == "A narrative.", out.text
    prompt = _prompt(wire.bodies[-1])
    _assert_none_of(wire.sent(), RISK_CANARIES)
    assert '"title": "Ledger outage on payday"' in prompt and '"severity": "High"' in prompt and "Risk Event:" in prompt


def test_incident_analysis_sees_other_risks_and_incidents_as_titles_and_relative_dates(erm, wire):
    wire.reply = lambda body: json.dumps({"root_cause_analysis": {}, "related_risks": [], "related_controls": [], "recommended_actions": []})
    out = erm.post("/incidents/ai-analyze", json={"title": "Payments slow", "description": "Customers report delays"})
    assert out.status_code == 200, out.text
    prompt = _prompt(wire.bodies[-1])
    _assert_none_of(wire.sent(), RISK_CANARIES)
    assert "- Risk ID 1: Core banking outage (Category: operational, Status: open)" in prompt
    assert "- Incident ID 1: Ledger outage on payday (Severity: High, Date: 140 days ago)" in prompt


def test_an_incident_suggestion_gets_the_linked_risk_as_title_category_and_status(erm, wire):
    wire.reply = lambda body: json.dumps({"suggested_severity": "high", "root_cause": "r", "corrective_actions": "c",
                                          "operational_impact": "o", "rationale": "x"})
    out = erm.post("/incidents/ai-suggest", json={"title": "Payments slow", "description": "Delays", "risk_id": 1})
    assert out.status_code == 200, out.text
    prompt = _prompt(wire.bodies[-1])
    _assert_none_of(wire.sent(), RISK_CANARIES)
    assert "Risk Context: Core banking outage | category=operational | status=open" in prompt


def test_an_assessed_risk_suggestion_reads_the_risk_and_its_linked_incidents_lightly(erm, wire):
    db = erm.db
    db.add(m.RiskAssessment(id=1, tenant_id=1, name="Q3", status="in_progress"))
    db.add(m.RiskAssessmentRisk(id=1, assessment_id=1, risk_id=1, inherent_likelihood=4, inherent_impact=5, inherent_score=20,
                                residual_likelihood=3, residual_impact=4, residual_score=12))
    db.add(m.RiskAssessmentIncident(assessment_risk_id=1, incident_id=1, impact_on_rating="raised"))
    db.commit()
    wire.reply = lambda body: json.dumps({"treatment_decision": "mitigate", "control_effectiveness": "partially_effective",
                                          "rationale": "r", "notes": "n"})
    result = risk_assessments.ai_suggest_assessment_risk(assessment_id=1, assessment_risk_id=1, db=db,
                                                         current_user=db.get(m.GRCUser, 7))
    assert result["treatment_decision"] == "mitigate"
    prompt = _prompt(wire.bodies[-1])
    _assert_none_of(wire.sent(), RISK_CANARIES)
    assert "- Title: Core banking outage" in prompt and '"title": "Ledger outage on payday"' in prompt


# ── assessment records ──────────────────────────────────────────────────────────────────────────────────────────
assessments_router = importlib.import_module("grc.routers.compliance_assessments_router")
ASSESSMENT_CANARIES = ("CANARY_party", "CANARY_solution", "CANARY_evidence_ref", "CANARY_timeline", "CANARY_prev", "CANARY_assignee",
                       "CANARY_asset_status", "CANARY_assessor", "CANARY_source", "CANARY_notes", "CANARY_xlsx", "CANARY_file")


@pytest.fixture
def assessed(wire, monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add(m.Tenant(id=1, name="Bank", slug="bank"))
    db.add(m.GRCUser(id=7, username="officer", display_name="Officer", email="officer@bank.test", is_active=True))
    db.add(m.ComplianceAssessmentDocument(
        id=1, tenant_id=1, name="PDPL readiness 2026", assessment_type="pdpl", source="CANARY_source", file_name="CANARY_file.xlsx",
        file_path="/x/CANARY_file.xlsx", assessor="CANARY_assessor", notes="CANARY_notes", xlsx_data={"x": "CANARY_xlsx"},
        assessment_format="maturity", created_by=7))
    db.add(m.ComplianceAssessmentDocumentItem(
        id=1, assessment_id=1, tenant_id=1, item_number="A.1", area_domain="Governance", subdomain_name="Roles",
        control_description="Define and document data protection roles", compliance_status="Partially Complied", maturity_score=2,
        remarks="PDPL Ref: Art. 31 | Q: Is there a named owner? | CANARY_remarks_tail", gaps_identified="Roles are not documented",
        responsible_party="CANARY_party", proposed_solution="CANARY_solution", evidence_reference="CANARY_evidence_ref",
        timeline="CANARY_timeline", ai_evidence_recommendation='{"summary": "CANARY_prev"}',
        assignees=[{"name": "CANARY_assignee"}], asset_status={"k": "CANARY_asset_status"}))
    db.commit()
    monkeypatch.setattr(assessments_router, "get_openai_client", lambda: wire.client)
    yield db
    db.close()


def test_the_evidence_advisor_prompt_carries_the_item_and_not_who_owns_it_or_what_was_proposed(assessed):
    from grc.services import assessment_evidence_ai as advisor

    item = assessed.get(m.ComplianceAssessmentDocumentItem, 1)
    for prompt in (advisor.build_plain_prompt(item), advisor.build_prompt(item, []),
                   advisor.build_draft_prompt(item, {"document": "policy", "evidence_type": "Roles policy", "description": "d",
                                                     "how_to_collect": "h"}, [], "Bank")):
        _assert_none_of(prompt, ASSESSMENT_CANARIES)
        assert "Define and document data protection roles" in prompt and "PDPL readiness 2026" in prompt
    plain = advisor.build_plain_prompt(item)
    assert "ITEM: A.1" in plain and "DOMAIN: Governance / Roles" in plain and "CURRENT STATUS: Partially Complied; current maturity L2" in plain
    assert "GAPS NOTED: Roles are not documented" in plain and "CANARY_remarks_tail" in plain       # the item's own details are advice input


def test_a_drafted_assessment_reads_the_control_and_two_remark_fields_only(assessed, wire):
    wire.reply = lambda body: json.dumps({"how_to_assess": "Ask who owns it", "evidence_examples": ["org chart"], "remediation": "Name an owner",
                                          "findings": "No owner", "risk_rating": "High", "priority": "high", "suggested_maturity": 1})
    out = assessments_router.ai_assess_item(assessment_id=1, item_id=1, gap="", db=assessed, current_user=assessed.get(m.GRCUser, 7))
    assert out["draft"]["remediation"] == "Name an owner"
    prompt = _prompt(wire.bodies[-1])
    _assert_none_of(wire.sent(), ASSESSMENT_CANARIES + ("CANARY_remarks_tail",))
    assert "Domain: Governance" in prompt and "PDPL Reference: Art. 31" in prompt and "Assessment question: Is there a named owner?" in prompt


# ── rows a tenant defined itself: uploaded control registers and RCSA templates ─────────────────────────────────
internal_controls = importlib.import_module("grc.modules.erm.routers.internal_controls")
rcsa_custom = importlib.import_module("grc.modules.erm.routers.rcsa_custom")


def test_an_uploaded_control_register_sends_only_the_columns_that_are_enriched(wire, monkeypatch):
    monkeypatch.setattr(internal_controls, "_get_openai_client", lambda: wire.client)
    monkeypatch.setattr(internal_controls, "get_openai_model", lambda: "gpt-test")
    items = [{"control_id": "C-1", "name": "Quarterly access review", "description": "Managers review access" + " x" * 400,
              "owner": "CANARY_owner", "email": "canary.owner@bank.test", "status": "CANARY_status", "department": "CANARY_dept",
              "testing_method": "CANARY_method", "frequency": "quarterly"}]
    wire.reply = lambda body: json.dumps([{"control_id": "C-1", "name": "Quarterly access review", "description": "d",
                                           "category": "access_control", "sub_category": "reviews", "control_type": "detective",
                                           "frequency": "quarterly", "regulatory_source": None, "priority": "high", "is_key_control": True}])
    out = internal_controls._ai_enrich_controls(items)
    assert out[0]["category"] == "access_control" and out[0]["control_type"] == "detective"
    _assert_none_of(wire.sent(), ("CANARY", "canary.owner"))
    asked = _json_after(_prompt(wire.bodies[-1]), "Input items:\n")
    assert set(asked[0]) == {"control_id", "name", "description", "frequency"} and len(asked[0]["description"]) <= 503


def test_an_rcsa_explanation_leaves_person_and_contact_cells_out_of_the_prompt(wire, monkeypatch):
    import openai

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add(m.Tenant(id=1, name="Bank", slug="bank"))
    db.add(m.GRCUser(id=7, username="officer", display_name="Officer", email="officer@bank.test", is_active=True))
    db.add(m.RCSACustomTemplate(
        id=1, tenant_id=1, name="Treasury RCSA", function_area="Treasury", original_filename="t.xlsx", original_file=b"x",
        column_schema={"flat_columns": [{"key": "risk", "label": "Risk description"}, {"key": "owner", "label": "Risk Owner"},
                                        {"key": "mail", "label": "Contact e-mail"}, {"key": "control", "label": "Key control"}]}))
    db.add(m.RCSACustomRow(id=1, tenant_id=1, template_id=1, data={
        "risk": "Settlement delays", "owner": "CANARY_rcsa_owner", "mail": "canary@bank.test", "control": "Daily reconciliation"}))
    db.commit()
    monkeypatch.setattr(rcsa_custom, "get_openai_api_key", lambda: "sk-test-key")
    monkeypatch.setattr(openai, "OpenAI", lambda **kw: wire.client)
    wire.reply = lambda body: "Plain explanation."
    monkeypatch.setattr(rcsa_custom, "_tenant_id_or_403", lambda user, db: 1)
    out = rcsa_custom.explain_row(template_id=1, row_id=1, refresh=True, db=db, current_user=db.get(m.GRCUser, 7), _perm=True)
    assert out.explanation == "Plain explanation."
    prompt = _prompt(wire.bodies[-1])
    _assert_none_of(wire.sent(), ("CANARY", "canary@bank.test"))
    assert "- Risk description: Settlement delays" in prompt and "- Key control: Daily reconciliation" in prompt
    db.close()
