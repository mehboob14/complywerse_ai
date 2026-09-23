"""Every write endpoint in every module can start a workflow.

The request's audit row records the endpoint that handled it; the dispatcher
raises ``api.<file>.<function>`` for it plus the named platform events that
endpoint stands for; each Platform Function node in the builder carries the
same name, including the route files outside modules/*/routers (Controls
Automation, Reports, IT assets, Administration, …).
"""
import time
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from starlette.requests import Request
from starlette.responses import Response

import grc.models as m
from grc.modules.workflow_engine.services import route_events
from grc.modules.workflow_engine.services.trigger_dispatcher import TriggerDispatcher


def test_an_endpoint_is_named_by_its_file_and_function():
    assert route_events.endpoint_id("grc.modules.erm.routers.risks", "create_risk") == "erm.risks.create_risk"
    assert route_events.event_name("grc.routers.reporting_router", "upsert_report") == "api.reporting_router.upsert_report"
    assert route_events.endpoint_id("grc.modules.automation.assurance", "conclude_test") == \
        "automation.assurance.conclude_test"
    changes = {"method": "POST", "endpoint": "grc.routers.reporting_router:upsert_report", "status_code": 200}
    assert route_events.event_for_audit(changes, "create") == "api.reporting_router.upsert_report"
    assert route_events.event_for_audit({**changes, "status_code": 422}, "create_failed") is None
    assert route_events.event_for_audit({**changes, "method": "GET"}, "read") is None
    assert route_events.event_for_audit({"method": "POST"}, "create") is None


def _row(endpoint, body=None, action="create", method="POST"):
    return SimpleNamespace(id=1, action=action, resource_type="automation", resource_id=None, tenant_id=1,
                           changes={"method": method, "endpoint": endpoint, "status_code": 200,
                                    "path": "/grc/x", "request": body or {}})


def test_a_row_raises_its_endpoint_and_the_named_events_it_stands_for():
    names = TriggerDispatcher._derive_event_names(_row("grc.modules.automation.assurance:conclude_test"))
    assert "api.automation.assurance.conclude_test" in names and "control_test_concluded" in names

    done = TriggerDispatcher._derive_event_names(
        _row("grc.routers.critical_tasks_router:transition_status", {"new_status": "Completed"}))
    moving = TriggerDispatcher._derive_event_names(
        _row("grc.routers.critical_tasks_router:transition_status", {"new_status": "in_progress"}))
    assert {"critical_task_status_changed", "critical_task_completed"} <= set(done)
    assert "critical_task_status_changed" in moving and "critical_task_completed" not in moving

    created = TriggerDispatcher._derive_event_names(_row("grc.modules.governance.routers.documents:create_document"))
    assert "governance_document_created" in created                     # was never raised before
    failed = _row("grc.routers.reporting_router:upsert_report", action="create_failed")
    failed.changes["status_code"] = 500
    assert not [n for n in TriggerDispatcher._derive_event_names(failed) if n.startswith("api.") or n == "report_saved"]


def test_the_audit_row_records_the_endpoint_and_the_dispatcher_turns_it_into_the_event(monkeypatch):
    from grc import audit_logger, db as grc_db
    from grc.modules.automation.assurance import conclude_test

    engine = create_engine("sqlite://")
    m.Base.metadata.create_all(engine, tables=[m.AuditLog.__table__, m.GRCUser.__table__])
    sessions = []

    def open_session(slug):
        session = Session(engine)
        sessions.append(session)
        return session

    monkeypatch.setattr(grc_db, "open_tenant_session", open_session)
    monkeypatch.setattr(audit_logger, "_resolve_tenant_slug", lambda request, tenant_id: "demo")
    scope = {"type": "http", "method": "POST", "path": "/grc/automation/common/controls/IAC-01/assurance/tests/4/conclude",
             "headers": [], "query_string": b"", "endpoint": conclude_test, "state": {"tenant_id": 1}}
    request = Request(scope)
    audit_logger.write_audit_log(request, Response(status_code=200), time.time(), {"result": "effective"})

    with Session(engine) as check:
        row = check.query(m.AuditLog).one()
    assert row.changes["endpoint"] == "grc.modules.automation.assurance:conclude_test"
    assert "control_test_concluded" in TriggerDispatcher._derive_event_names(row)


def test_a_workflow_starts_once_per_audit_row_however_many_of_its_triggers_it_raises():
    dispatcher = TriggerDispatcher(SimpleNamespace(_use_redis=False))
    assert dispatcher._first_start(5, "audit:1:77") is True
    assert dispatcher._first_start(5, "audit:1:77") is False          # the named event after the endpoint's
    assert dispatcher._first_start(6, "audit:1:77") is True           # another workflow
    # a record reaching a date starts it once, however many workers raise it
    assert dispatcher._first_start(5, "sla_breach:issue:3:2026-09-01") is True
    assert dispatcher._first_start(5, "sla_breach:issue:3:2026-09-01") is False
    assert dispatcher._first_start(5, "subworkflow:9:4") is True       # everything else keeps its own rules
    assert dispatcher._first_start(5, "subworkflow:9:4") is True


@pytest.fixture
def tenant_db():
    engine = create_engine("sqlite://")
    m.Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(m.Tenant(id=1, name="Demo Bank", slug="demo"))
        session.commit()
        yield session


def test_a_document_nearing_expiry_or_review_raises_its_event_once_per_date(tenant_db, monkeypatch):
    dispatcher = TriggerDispatcher(SimpleNamespace(_use_redis=False))
    fired = []
    monkeypatch.setattr(dispatcher, "_iter_tenant_sessions", lambda: iter([(1, "demo", tenant_db)]))
    monkeypatch.setattr(dispatcher, "publish_event", lambda **kw: fired.append(kw))
    doc = m.GovernanceDocument(tenant_id=1, title="Access Policy", doc_type="policy", status="published",
                               next_review_date=datetime.utcnow() + timedelta(days=10))
    far = m.GovernanceDocument(tenant_id=1, title="Far Policy", doc_type="policy", status="published",
                               expiry_date=datetime.utcnow() + timedelta(days=200))
    tenant_db.add_all([doc, far])
    tenant_db.commit()

    assert dispatcher._check_governance_document_expiry() == 1
    assert fired[0]["event_name"] == "governance_document_expires" and fired[0]["payload"]["title"] == "Access Policy"
    assert dispatcher._check_governance_document_expiry() == 0          # once per date
    doc.next_review_date = datetime.utcnow() + timedelta(days=5)
    tenant_db.commit()
    assert dispatcher._check_governance_document_expiry() == 1          # a new date re-arms it


def test_a_certification_target_date_nearing_raises_framework_deadline_approaching(tenant_db, monkeypatch):
    dispatcher = TriggerDispatcher(SimpleNamespace(_use_redis=False))
    fired = []
    monkeypatch.setattr(dispatcher, "_iter_tenant_sessions", lambda: iter([(1, "demo", tenant_db)]))
    monkeypatch.setattr(dispatcher, "publish_event", lambda **kw: fired.append(kw))
    required = {c.name for c in m.CertificationJourney.__table__.columns
                if not c.nullable and not c.primary_key and c.default is None and c.server_default is None}
    values = {"tenant_id": 1, "status": "in_progress", "target_date": datetime.utcnow() + timedelta(days=12)}
    values.update({c: "x" for c in required - set(values) if c != "tenant_id"})
    tenant_db.add(m.CertificationJourney(**values))
    tenant_db.commit()
    assert dispatcher._check_framework_deadlines() == 1
    assert fired[0]["event_name"] == "framework_deadline_approaching"
    assert dispatcher._check_framework_deadlines() == 0


def test_every_module_s_writes_are_in_the_builder_and_named_events_point_at_real_endpoints():
    from fastapi.routing import APIRoute

    from grc.main import app
    from grc.modules.workflow_engine.services import catalog as C

    live = {route_events.endpoint_id(r.endpoint.__module__, r.endpoint.__name__)
            for r in app.routes if isinstance(r, APIRoute)}
    missing = sorted({e for _k, _l, _mod, eps, _w in C.ENDPOINT_EVENT_TYPES for e in eps if e not in live})
    assert missing == []                                               # no typo'd endpoint anywhere

    nodes = C.PLATFORM_FUNCTION_NODE_TYPES
    modules = {n.get("module") for n in nodes if n.get("trigger_event")}
    assert {"Controls Automation", "Reports", "Administration", "Critical Tasks",
            "Cybersecurity Assurance", "Third-Party Vendor Risk"} <= modules
    assert all(n["trigger_event"][4:] in live for n in nodes if n.get("trigger_event"))
    common = next(n for n in nodes if n.get("fn_name") == "conclude_test" and n.get("module") == "Controls Automation")
    assert common["trigger_event"] == "api.automation.assurance.conclude_test"

    triggers = {t["key"]: t for t in C.TRIGGER_NODE_TYPES}
    assert triggers["control_test_concluded"]["module"] == "Controls Automation"
    assert triggers["report_saved"]["module"] == "Reports"


def test_a_function_used_as_the_trigger_saves_its_exact_endpoint_event():
    from grc.modules.workflow_engine.routers.definitions import _infer_trigger_event
    from grc.modules.workflow_engine.services import catalog as C

    node = next(n for n in C.PLATFORM_FUNCTION_NODE_TYPES if n.get("trigger_event"))
    nodes = [{"node_key": "start", "is_start": True, "node_type": "start", "config": {}},
             {"node_key": "n1", "node_type": "action", "config": {"action_name": node["key"]}}]
    edges = [{"source_node_key": "start", "target_node_key": "n1"}]
    assert _infer_trigger_event(nodes, edges) == node["trigger_event"]
