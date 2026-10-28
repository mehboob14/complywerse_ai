"""Third-party risk platform fixes (TPRM upgrade, piece A2, 2026-10-29).

Demo suppliers reach only the tenants named in TPRM_DEMO_TENANTS. Deleting a supplier archives it: nothing recorded
about it goes, it can be restored, and it leaves the register, the dashboards and the reminders. The register pages
through every supplier and leaves out requests nobody has picked up. Every right the code checks can be granted to a
role. The workflow engine's supplier steps do what their buttons do, as the workflow's owner, or fail the run and say
why. The auditor portal's supplier tab reads the real fields and opens the supplier. In-memory SQLite.
"""
import pathlib
import re
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.models import get_db
from grc.modules.workflow_engine.services.action_handlers import ActionRefused, WorkflowActionHandlers as H
from grc.routers.auth_router import require_auth

ROOT = pathlib.Path(__file__).resolve().parents[1]
FRONTEND = ROOT.parent / "grc-frontend" / "src" / "app" / "(dashboard)"


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    # Ada is the organisation's primary contact, so she holds every right; Vic holds none.
    s.add(m.Tenant(id=1, name="Acme", slug="acme", is_active=True, primary_contact_email="ada@acme.test"))
    s.add_all([m.GRCUser(id=7, username="ada", email="ada@acme.test", display_name="Ada Admin", is_active=True),
               m.GRCUser(id=8, username="vic", email="vic@acme.test", display_name="Vic Viewer", is_active=True)])
    s.commit()
    yield s
    s.close()


def vendor(db, name, **kw):
    v = m.Vendor(tenant_id=1, name=name, tier=kw.pop("tier", "high"), status=kw.pop("status", "active"), **kw)
    db.add(v)
    db.flush()
    return v


def assessment(db, v, **kw):
    a = m.VendorAssessment(tenant_id=1, vendor_id=v.id, status=kw.pop("status", "in_progress"), **kw)
    db.add(a)
    db.flush()
    return a


def finding(db, v, a, **kw):
    f = m.TPRAFinding(tenant_id=1, vendor_id=v.id, assessment_id=a.id, domain="cybersecurity",
                      severity=kw.pop("severity", "critical"), title=kw.pop("title", "No MFA"), status="open", **kw)
    db.add(f)
    db.flush()
    return f


@pytest.fixture()
def api(db):
    from grc.modules.vendor_risk.routers import vendors as routes
    app = FastAPI()
    app.include_router(routes.router, prefix="/vendor-risk")
    who = {"id": 7}
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(m.GRCUser, who["id"])
    client = TestClient(app)
    client.who = who
    return client


# ── 1. demo suppliers only where asked for ───────────────────────────────────

def _start_up(db, monkeypatch):
    """The production start-up pass (backend/main.py) over the one tenant, every seed step but TPRM's stubbed out."""
    from grc import startup_seed as s
    factory = sessionmaker(bind=db.get_bind())
    monkeypatch.setattr(s, "MasterSession", factory)
    monkeypatch.setattr(s, "get_tenant_engine", lambda slug: db.get_bind())
    monkeypatch.setattr(s, "open_tenant_session", lambda slug: factory())
    for step in ("ensure_local_framework_catalog", "ensure_static_control_library_baseline",
                 "ensure_compliance_assessment_seed_data", "ensure_governance_dashboard_seed",
                 "ensure_operational_dashboard_seed", "ensure_kpi_trend_history_seed"):
        monkeypatch.setattr(s, step, lambda *a, **k: {})
    summary = s.ensure_startup_seed_data()
    db.expire_all()
    return summary


@pytest.mark.parametrize("named, demo", [(frozenset(), False), (frozenset({"cfsb"}), False),
                                         (frozenset({"acme"}), True), (frozenset({"*"}), True)])
def test_demo_suppliers_reach_only_the_tenants_named_in_TPRM_DEMO_TENANTS(db, monkeypatch, named, demo):
    from grc import config
    monkeypatch.delenv("DISABLE_TENANT_STARTUP_SEED", raising=False)
    monkeypatch.setattr(config, "TPRM_DEMO_TENANTS", named)
    assert not _start_up(db, monkeypatch).get("errors")
    assert db.query(m.Vendor).count() == (13 if demo else 0)
    assert db.query(m.Risk).count() == (13 if demo else 0)                 # each demo supplier is a Risk Register row
    assert (db.query(m.TPRARiskSnapshot).count() > 0) is demo              # a made-up year of history
    assert db.query(m.VendorQuestionnaireTemplate).count() == 8            # the built-in templates are not demo data


def test_demo_suppliers_already_there_stay_and_the_off_switch_still_works(db, monkeypatch):
    from grc import config
    monkeypatch.delenv("DISABLE_TENANT_STARTUP_SEED", raising=False)
    monkeypatch.setattr(config, "TPRM_DEMO_TENANTS", frozenset({"acme"}))
    _start_up(db, monkeypatch)
    monkeypatch.setattr(config, "TPRM_DEMO_TENANTS", frozenset())
    _start_up(db, monkeypatch)
    assert db.query(m.Vendor).count() == 13                                # switching it off removes nothing
    monkeypatch.setenv("DISABLE_TENANT_STARTUP_SEED", "1")
    assert _start_up(db, monkeypatch) == {"disabled": True, "tenants": 0}


# ── 2. archive, not delete ───────────────────────────────────────────────────

def test_delete_archives_the_supplier_and_keeps_everything_recorded_about_it(db, api):
    v = vendor(db, "Payroll Co")
    a = assessment(db, v)
    finding(db, v, a)
    db.add_all([m.VendorQuestionnaireResponse(tenant_id=1, vendor_id=v.id, assessment_id=a.id, token="t-1"),
                m.VendorSLARecord(tenant_id=1, vendor_id=v.id, sla_metric="Uptime"),
                m.VendorIncident(tenant_id=1, vendor_id=v.id, title="Outage")])
    db.commit()

    r = api.delete(f"/vendor-risk/vendors/{v.id}")
    assert r.status_code == 200 and r.json()["archived_at"]
    db.expire_all()
    kept = db.get(m.Vendor, v.id)
    assert kept.deleted_at is not None and kept.status == "active"         # its status is what it was
    for model in (m.VendorAssessment, m.TPRAFinding, m.VendorQuestionnaireResponse, m.VendorSLARecord, m.VendorIncident):
        assert db.query(model).filter_by(vendor_id=v.id).count() == 1, model.__name__
    assert db.query(m.TPRAAuditLog).filter_by(vendor_id=v.id, action="archive", actor_id=7).count() == 1
    assert api.get(f"/vendor-risk/vendors/{v.id}").json()["archived_at"] == r.json()["archived_at"]   # still readable
    assert api.delete(f"/vendor-risk/vendors/{v.id}").json()["archived_at"] == r.json()["archived_at"]  # once is enough


def test_restore_brings_an_archived_supplier_back_and_both_need_the_right(db, api):
    v = vendor(db, "Payroll Co")
    db.commit()
    api.who["id"] = 8
    assert api.delete(f"/vendor-risk/vendors/{v.id}").status_code == 403
    api.who["id"] = 7
    api.delete(f"/vendor-risk/vendors/{v.id}")
    assert api.get("/vendor-risk/vendors").json()["total"] == 0
    api.who["id"] = 8
    assert api.post(f"/vendor-risk/vendors/{v.id}/restore").status_code == 403
    api.who["id"] = 7
    r = api.post(f"/vendor-risk/vendors/{v.id}/restore")
    assert r.status_code == 200 and r.json()["archived_at"] is None
    assert [x["id"] for x in api.get("/vendor-risk/vendors").json()["items"]] == [v.id]
    assert [row.action for row in db.query(m.TPRAAuditLog).order_by(m.TPRAAuditLog.id)] == ["archive", "restore"]


def test_adding_a_supplier_that_is_archived_says_so(db, api):
    vendor(db, "Payroll Co", deleted_at=datetime.utcnow())
    db.commit()
    r = api.post("/vendor-risk/vendors", json={"name": "payroll co"})
    assert r.status_code == 409 and "is archived" in r.json()["detail"]


# ── 3. the register: everything, page by page, without requests or archived ──

def test_the_register_leaves_out_archived_suppliers_and_requests_nobody_has_picked_up(db, api):
    vendor(db, "In use")
    vendor(db, "Archived", deleted_at=datetime.utcnow())
    vendor(db, "Draft request", status="requested", intake_status="draft")
    vendor(db, "Submitted request", status="requested", intake_status="submitted")
    vendor(db, "Turned down", status="rejected", intake_status="rejected")
    vendor(db, "In review", status="onboarding", intake_status="in_review")      # being onboarded: a supplier
    vendor(db, "Approved request", intake_status="approved")
    db.commit()

    def names(**params):
        return {x["name"] for x in api.get("/vendor-risk/vendors", params=params).json()["items"]}
    live = {"In use", "In review", "Approved request"}
    assert names() == live
    assert names(include_archived=True) == live | {"Archived"}
    assert names(include_requests=True) == live | {"Draft request", "Submitted request", "Turned down"}
    body = api.get("/vendor-risk/vendors", params={"include_archived": True}).json()
    assert body["total"] == 4 and {x["name"] for x in body["items"] if x["archived_at"]} == {"Archived"}


def test_the_register_pages_through_every_supplier_in_a_stable_order(db, api):
    for i in range(7):
        vendor(db, f"Imported {i}", created_at=datetime(2026, 10, 1))             # an import: one timestamp for all
    db.commit()
    sql = []
    event.listen(db.get_bind(), "before_cursor_execute", lambda conn, cur, statement, *a: sql.append(statement))
    seen = []
    for skip in (0, 3, 6):
        page = api.get("/vendor-risk/vendors", params={"skip": skip, "limit": 3}).json()
        assert page["total"] == 7 and page["skip"] == skip
        seen += [x["id"] for x in page["items"]]
    assert len(seen) == len(set(seen)) == 7
    assert any(re.search(r"ORDER BY \S*created_at DESC, \S*id DESC", s) for s in sql)   # the id breaks the tie
    assert api.get("/vendor-risk/vendors", params={"limit": 0}).status_code == 422
    assert api.get("/vendor-risk/vendors", params={"skip": -1}).status_code == 422


# ── 4. archived suppliers leave the dashboards and the reminders ─────────────

def test_an_archived_supplier_is_not_counted_on_the_dashboards(db):
    from grc.modules.vendor_risk.routers import vendors as routes
    from grc.modules.vendor_risk.tpra import dashboard, engine_snapshots
    live = vendor(db, "In use", inherent_risk_score=60, residual_risk_score=40)
    gone = vendor(db, "Archived", tier="critical", inherent_risk_score=90, residual_risk_score=80,
                  deleted_at=datetime.utcnow())
    for v in (live, gone):
        finding(db, v, assessment(db, v))
        db.add(m.TPRAMonitoringSignal(tenant_id=1, vendor_id=v.id, signal_type="breach", severity="high",
                                      title="Breach", occurred_at=datetime.utcnow()))
        db.add(m.VendorIncident(tenant_id=1, vendor_id=v.id, title="Outage"))
    db.commit()
    ada = db.get(m.GRCUser, 7)

    home = routes.vendor_dashboard(db=db, current_user=ada)                  # the home page's module card
    assert (home["total_vendors"], home["by_tier"], home["open_incidents"]) == (1, {"high": 1}, 1)
    assert home["avg_residual_risk_score"] == 40 and [x["vendor_id"] for x in home["recent_assessments"]] == [live.id]
    tprm = dashboard.program_dashboard(scope="portfolio", db=db, user=ada)
    assert (tprm["kpis"]["active_vendors"], tprm["kpis"]["open_critical_findings"]) == (1, 1)
    assert [s["vendor_id"] for s in tprm["monitoring_feed"]] == [live.id]
    snap = engine_snapshots.write_portfolio_snapshot(db, 1)                  # the risk-over-time trend
    assert (snap.vendor_count, snap.open_findings, snap.critical_findings, snap.residual_score) == (1, 1, 1, 40)


def test_reminders_leave_an_archived_suppliers_remediation_and_acceptance_alone(db):
    from grc.modules.vendor_risk.tpra import reminders
    soon = datetime.utcnow() + timedelta(days=3)
    for name, archived in (("In use", None), ("Archived", datetime.utcnow())):
        v = vendor(db, name, owner_id=7, deleted_at=archived)
        f = finding(db, v, assessment(db, v), title=f"Gap at {name}")
        db.add(m.TPRARemediation(tenant_id=1, finding_id=f.id, title=f"Fix {name}", status="open", due_date=soon, owner_id=7))
        db.add(m.TPRARiskAcceptance(tenant_id=1, finding_id=f.id, status="active", expiry=soon, accepted_by=7,
                                    rationale="Compensating control in place"))
    db.commit()
    notices = reminders.due_notices(db, 1, datetime.utcnow().date(), {"remind_before_days": 14, "repeat_every_days": 7})
    chased = [n for n in notices if n.kind in ("remediation_due", "acceptance_expiring")]
    assert len(chased) == 2 and all("In use" in n.title for n in chased), [n.title for n in chased]


# ── 5. every right the code checks can be granted ────────────────────────────

def test_every_vendor_risk_right_the_code_checks_can_be_granted_to_a_role():
    from grc.permissions import get_all_permissions
    grantable = {p["name"] for p in get_all_permissions()}
    checked = set()
    backend = ROOT / "grc"
    for path in [*(backend / "modules" / "vendor_risk").rglob("*.py"),
                 backend / "services" / "module_settings.py", backend / "modules" / "scf" / "record_links.py"]:
        text = path.read_text(encoding="utf-8")
        checked |= {f"vendor_risk:{res}:{act or 'edit'}"
                    for res, act in re.findall(r'(?:require_write|_can)\(\s*\w+,\s*\w+,\s*"(\w+)"(?:,\s*"(\w+)")?', text)}
        checked |= set(re.findall(r'"(vendor_risk:\w+:\w+)"', text))
    for path in (FRONTEND / "vendor-risk").rglob("*.ts*"):                  # what the pages check before offering a button
        checked |= set(re.findall(r"'(vendor_risk:\w+:\w+)'", path.read_text(encoding="utf-8")))
    assert {"vendor_risk:config:edit", "vendor_risk:approvals:edit", "vendor_risk:templates:create"} <= checked
    assert sorted(checked - grantable) == []


# ── 6. the workflow engine's supplier steps ──────────────────────────────────

FLOW = SimpleNamespace(id=1, name="Supplier upkeep", created_by_id=7)       # Ada built it: steps act with her rights


def step(db, action, trigger=None, flow=FLOW, **settings):
    """Run one supplier step the way the runtime does (WorkflowActionHandlers.execute)."""
    run = SimpleNamespace(id=1, tenant_id=1, trigger_payload=trigger or {}, context={})
    out = H.execute(db, run, flow, None, {"action_name": f"platform_action.{action}", **settings})
    db.commit()
    return out, run


def test_a_workflow_edits_a_supplier_as_its_owner_would(db):
    v = vendor(db, "Payroll Co")
    db.commit()
    out, run = step(db, "update.risk_management.vendor_risk.vendor", vendor_id=v.id, status="suspended")
    assert out == {"action": "vendor_risk.vendor.update", "result": "done", "vendor_id": v.id, "record_id": v.id}
    assert db.get(m.Vendor, v.id).status == "suspended" and run.context["vendor_id"] == v.id
    computed = vendor(db, "Cloud Co", inherent_risk_score=70)
    assessment(db, computed, lifecycle_status="active", inherent_tier="high")
    db.commit()
    with pytest.raises(ActionRefused, match="tier was computed. Explain why it should change"):
        step(db, "update.risk_management.vendor_risk.vendor", vendor_id=computed.id, tier="low")
    with pytest.raises(ActionRefused, match="changes nothing"):
        step(db, "update.risk_management.vendor_risk.vendor", vendor_id=v.id)


def test_a_workflow_adds_a_supplier_and_the_next_step_acts_on_it(db, monkeypatch):
    out, run = step(db, "create.risk_management.vendor_risk.vendor", name="Cloud Co", tier="low")
    made = db.query(m.Vendor).filter_by(name="Cloud Co").one()
    assert (out["vendor_id"], run.context["vendor_id"], made.tier) == (made.id, made.id, "low")
    with pytest.raises(ActionRefused, match="already exists"):
        step(db, "create.risk_management.vendor_risk.vendor", name="cloud co")


def test_a_workflow_archives_and_restores_a_supplier(db):
    v = vendor(db, "Payroll Co")
    assessment(db, v)
    db.commit()
    step(db, "delete.risk_management.vendor_risk.vendor", vendor_id=v.id)
    assert db.get(m.Vendor, v.id).deleted_at is not None and db.query(m.VendorAssessment).count() == 1
    with pytest.raises(ActionRefused, match="Payroll Co is archived; restore it"):
        step(db, "update.risk_management.vendor_risk.vendor", vendor_id=v.id, status="active")
    step(db, "create.risk_management.vendor_risk.restore_vendor", vendor_id=v.id)
    assert db.get(m.Vendor, v.id).deleted_at is None


def test_a_workflow_sends_a_questionnaire_to_the_supplier_its_event_is_about(db, monkeypatch):
    from grc.modules.vendor_risk.routers import questionnaires
    emailed = []
    monkeypatch.setattr(questionnaires, "_email_link", lambda _db, qr, is_reminder=False, issued=None: emailed.append(qr.id))
    v = vendor(db, "Payroll Co", primary_contact_email="security@payroll.test")
    t = m.VendorQuestionnaireTemplate(tenant_id=1, name="Security", questions=[])
    db.add(t)
    db.commit()
    out, _ = step(db, "create.risk_management.vendor_risk.send_questionnaire",
                  trigger={"resource_type": "grc_vendors", "resource_id": v.id}, template_id=t.id, due_in_days=10)
    qr = db.query(m.VendorQuestionnaireResponse).one()
    assert (qr.vendor_id, qr.template_id, qr.respondent_email, qr.status) == (v.id, t.id, "security@payroll.test", "pending")
    assert emailed == [qr.id] and out["record_id"] == qr.id and "token" not in out   # the link stays out of the run's log


def test_a_workflow_records_a_supplier_incident_and_updates_it(db):
    v = vendor(db, "Payroll Co")
    db.commit()
    out, _ = step(db, "create.risk_management.vendor_risk.incident", vendor_id=v.id, title="Payroll outage", severity="high")
    inc = db.query(m.VendorIncident).one()
    assert (inc.tenant_id, inc.title, inc.severity, inc.reported_by, out["record_id"]) == (1, "Payroll outage", "high", 7, inc.id)
    step(db, "update.risk_management.vendor_risk.incident", vendor_id=v.id, incident_id=inc.id, status="resolved")
    assert db.get(m.VendorIncident, inc.id).status == "resolved"
    with pytest.raises(ActionRefused, match="names no incident"):
        step(db, "update.risk_management.vendor_risk.incident", vendor_id=v.id, status="closed")


def test_a_workflow_records_an_sla_measurement_with_the_steps_own_figures(db):
    v = vendor(db, "Payroll Co")
    db.commit()
    with pytest.raises(ActionRefused, match="higher or a lower value is better"):   # both figures need their direction
        step(db, "create.risk_management.vendor_risk.sla_record", vendor_id=v.id, sla_metric="Uptime",
             target_value=99.9, actual_value=99.5)
    step(db, "create.risk_management.vendor_risk.sla_record", vendor_id=v.id, sla_metric="Uptime",
         target_value=99.9, actual_value=99.5, direction="higher_is_better")
    rec = db.query(m.VendorSLARecord).one()
    assert (rec.tenant_id, rec.sla_metric, rec.target_value, rec.actual_value, rec.is_compliant) == (1, "Uptime", 99.9, 99.5, False)
    with pytest.raises(ActionRefused, match="wrong sla metric"):
        step(db, "create.risk_management.vendor_risk.sla_record", vendor_id=v.id)


def test_a_workflow_opens_an_assessment_and_edits_it(db):
    v = vendor(db, "Payroll Co")
    db.commit()
    out, _ = step(db, "create.risk_management.vendor_risk.assessment", vendor_id=v.id, assessment_type="periodic")
    a = db.query(m.VendorAssessment).one()
    assert (a.vendor_id, a.assessment_type, a.assessed_by, out["record_id"]) == (v.id, "periodic", 7, a.id)
    step(db, "update.risk_management.vendor_risk.assessment", assessment_id=a.id, status="in_review")
    assert db.get(m.VendorAssessment, a.id).status == "in_review"


def test_a_workflow_scores_an_assessment_from_its_submitted_questionnaire(db):
    v = vendor(db, "Payroll Co")
    a = assessment(db, v)
    db.commit()
    with pytest.raises(ActionRefused, match="No submitted questionnaire response"):
        step(db, "trigger.risk_management.vendor_risk.score_assessment", assessment_id=a.id)
    db.add(m.VendorQuestionnaireResponse(tenant_id=1, vendor_id=v.id, assessment_id=a.id, token="t-1", status="submitted"))
    db.commit()
    step(db, "trigger.risk_management.vendor_risk.score_assessment", assessment_id=a.id)
    scored = db.get(m.VendorAssessment, a.id)
    assert scored.status == "reviewed" and scored.residual_score is not None


@pytest.mark.parametrize("action, reason", [
    ("approve.risk_management.vendor_risk.assessment", "approved by a person on its Approval stage"),
    ("delete.risk_management.vendor_risk.assessment", "kept as its history"),
    ("create.risk_management.vendor_risk.external_submit_questionnaire", "Only the supplier answers"),
    ("create.risk_management.vendor_risk.external_upload_evidence", "Only the supplier answers"),
    ("create.risk_management.vendor_risk.ai_vendor_risk_summary", "when someone asks for it"),
    ("trigger.risk_management.vendor_risk.ai_score_assessment", "when someone asks for it"),
    ("create.risk_management.vendor_risk.accept_questionnaire", "cannot do “accept questionnaire”"),
])
def test_a_step_a_workflow_cannot_do_properly_is_refused_and_writes_nothing(db, action, reason):
    v = vendor(db, "Payroll Co")
    a = assessment(db, v, status="reviewed")
    db.commit()
    with pytest.raises(ActionRefused, match=reason):
        step(db, action, vendor_id=v.id, assessment_id=a.id)
    assert db.get(m.VendorAssessment, a.id).status == "reviewed" and db.query(m.WorkflowAuditLog).count() == 0


def test_a_step_acts_only_on_a_supplier_it_names_with_its_owners_rights(db):
    v = vendor(db, "Payroll Co")
    db.commit()
    # A risk's event is not about a supplier: its id is not taken for one.
    with pytest.raises(ActionRefused, match="names no supplier"):
        step(db, "update.risk_management.vendor_risk.vendor", trigger={"resource_type": "risks", "resource_id": v.id},
             status="suspended")
    with pytest.raises(ActionRefused, match="requires vendor_risk:vendors:edit"):
        step(db, "update.risk_management.vendor_risk.vendor", flow=SimpleNamespace(id=1, name="Vic's", created_by_id=8),
             vendor_id=v.id, status="suspended")
    with pytest.raises(ActionRefused, match="no active owner"):
        step(db, "update.risk_management.vendor_risk.vendor", flow=SimpleNamespace(id=1, name="Nobody's", created_by_id=None),
             vendor_id=v.id, status="suspended")
    assert db.get(m.Vendor, v.id).status == "active"


def test_a_refused_supplier_step_fails_the_run_and_says_why(db, monkeypatch):
    monkeypatch.setenv("WORKFLOW_QUEUE_BACKEND", "memory")
    from grc.modules.workflow_engine.services.runtime import WorkflowRuntime
    a = assessment(db, vendor(db, "Payroll Co"))
    db.add(m.WorkflowDefinition(id=1, tenant_id=1, name=FLOW.name, trigger_event="manual", created_by_id=7))
    db.add(m.WorkflowNode(workflow_definition_id=1, node_key="approve", node_type="action", name="Approve",
                          config={"action_name": "platform_action.approve.risk_management.vendor_risk.assessment",
                                  "assessment_id": a.id}))
    db.add(m.WorkflowInstance(id=1, tenant_id=1, workflow_definition_id=1, status="running", current_node_key="approve"))
    db.commit()
    runtime = WorkflowRuntime()
    monkeypatch.setattr(runtime, "_notify_webhooks", lambda *args, **kw: None)   # it would open the real tenant database
    runtime._run_instance(db, 1)
    db.commit()
    run = db.get(m.WorkflowInstance, 1)
    assert run.status == "failed" and "approved by a person" in run.error_message      # not "queued", not "ok"
    assert db.get(m.VendorAssessment, a.id).status == "in_progress"


# ── 7. the auditor portal's supplier tab ─────────────────────────────────────

def test_the_auditor_sees_each_suppliers_real_fields_and_an_archived_one_marked(db):
    from grc.modules.auditor_portal.routers import artifacts
    db.add(m.UploadedFramework(id=3, tenant_id=1, name="ISO 27001", file_name="iso.pdf", file_path="iso.pdf", file_type="pdf",
                               uploaded_by=7))
    live = vendor(db, "Payroll Co", tier="critical", risk_rating="high", residual_risk_score=41.5, vendor_type="SaaS",
                  data_access_level="restricted", owner_id=7, next_reassessment_date=datetime(2027, 1, 31))
    vendor(db, "Old Courier", deleted_at=datetime(2026, 9, 1))
    vendor(db, "Ended", status="offboarded")
    a = assessment(db, live, status="approved", completed_at=datetime(2026, 3, 1))
    db.add(m.TPRAApproval(tenant_id=1, vendor_id=live.id, assessment_id=a.id, decision="approve", created_at=datetime(2026, 6, 1)))
    db.commit()
    rows = {r["name"]: r for r in artifacts.list_vendors(3, db=db, current_user=db.get(m.GRCUser, 7))["vendors"]}
    assert set(rows) == {"Payroll Co", "Old Courier"}
    p = rows["Payroll Co"]
    assert (p["risk_tier"], p["risk_rating"], p["residual_risk_score"], p["data_classification_access"], p["vendor_type"]) \
        == ("critical", "high", 41.5, "restricted", "SaaS")
    assert (p["next_reassessment_date"], p["last_assessed_at"]) == (datetime(2027, 1, 31), datetime(2026, 6, 1))
    assert p["owner"] == {"id": 7, "name": "Ada Admin"} and p["archived_at"] is None
    assert rows["Old Courier"]["archived_at"] == datetime(2026, 9, 1)


def test_the_auditors_open_link_goes_to_the_suppliers_page():
    tab = (FRONTEND / "auditor-portal" / "[frameworkId]" / "_tabs" / "VendorsTab.tsx").read_text(encoding="utf-8")
    assert "href={`/vendor-risk/vendors/${v.id}`}" in tab and "href={`/vendor-risk/${v.id}`}" not in tab
    assert (FRONTEND / "vendor-risk" / "vendors" / "[id]" / "page.tsx").exists()
