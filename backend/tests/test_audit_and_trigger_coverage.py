"""Audit logs and workflow triggers across every module.

Each audit row names the sidebar module and sub-module it belongs to and what
the request changed (old → new); Audit Logs filters on the module, finding
older rows by their URL; background jobs that change records write their own
row. Date events (overdue, expiring, review due) fire when the date arrives,
once per record and date, only for workflows that listen; a refused sign-in
and CAPA actions raise their events.
"""
import time
from datetime import date, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import Boolean, Date, DateTime, Integer, JSON, create_engine
from sqlalchemy.orm import Session
from starlette.requests import Request
from starlette.responses import Response

import grc.models as m
from grc import audit_changes, feature_map
from grc.modules.workflow_engine.services.trigger_dispatcher import TriggerDispatcher


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    m.Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(m.Tenant(id=1, name="Demo Bank", slug="demo"))
        session.commit()
        yield session


def _make(model, **values):
    """A row with every required column filled."""
    for col in model.__table__.columns:
        if col.primary_key or col.nullable or col.default is not None or col.server_default is not None \
                or col.name in values:
            continue
        values[col.name] = (1 if isinstance(col.type, Integer) else False if isinstance(col.type, Boolean)
                            else datetime.utcnow() if isinstance(col.type, DateTime)
                            else date.today() if isinstance(col.type, Date)
                            else {} if isinstance(col.type, JSON) else "x")
    return model(**values)


# ── Where a request belongs ──────────────────────────────────────────────────

def test_a_request_is_placed_under_its_sidebar_module_and_page(db):
    assert feature_map.place("grc.modules.erm.routers.kris:create_kri", "/grc/erm/kris") == ("Governance", "KRIs")
    assert feature_map.place(None, "/grc/erm/risks/5") == ("Risk Management", "Risk Register")
    assert feature_map.place(None, "/grc/erm/incidents/2") == ("Issue & Incident Management", "Incidents")
    assert feature_map.place(None, "/grc/discovery/campaigns/4/run") == ("Cybersecurity Assurance", "IT Asset Discovery")
    # its file wins where the URL misleads
    assert feature_map.place("grc.routers.audit_plan_router:create_entry", "/grc/compliance/assessments/audit-plan") \
        == ("Auditor Portal", "Internal Audit")
    # every assessment shares one URL: the format says which page
    db.add(m.ComplianceAssessmentDocument(id=3, tenant_id=1, name="OWASP ASVS", assessment_type="checklist",
                                          assessment_format="asvs_checklist"))
    db.add(m.ComplianceAssessmentDocumentItem(id=30, assessment_id=3, tenant_id=1, item_number="V1.1"))
    db.commit()
    assert feature_map.place(None, "/grc/compliance/assessments/3/items/30/ai-recommendation", db=db, slug="demo") \
        == ("Assessments", "Cyber Security")
    assert feature_map.place(None, "/grc/compliance/assessments/items/30", db=db, slug="demo") \
        == ("Assessments", "Cyber Security")
    assert feature_map.place(None, "/grc/compliance/assessments", payload={"assessment_format": "pdpl_assessment_toolkit"}) \
        == ("Assessments", "Saudi PDPL")
    assert feature_map.place(None, "/grc/compliance/assessments") == ("Assessments", "Overview")

    modules = {p["module"]: p["submodules"] for p in feature_map.modules()}
    assert list(modules)[:3] == ["Performance Overview", "My Work", "Governance"]
    assert {"Cyber Security", "NCA", "Saudi PDPL", "DPIA / PIA"} <= set(modules["Assessments"])
    include, exclude = feature_map.legacy_prefixes("Risk Management")
    assert "/erm" in include and "/erm/kris" in exclude and "/erm/incidents" in exclude


def test_audit_logs_filter_a_module_and_find_older_rows_by_their_url(db):
    from grc.routers.admin_router import _module_filter

    rows = {
        "new_kri": {"module": "Governance", "submodule": "KRIs", "path": "/grc/erm/kris/5"},
        "old_kri": {"path": "/grc/erm/kris/9/measure"},
        "old_risk": {"path": "/grc/erm/risks/3"},
        "new_risk": {"module": "Risk Management", "submodule": "Risk Register"},
        "old_vendor": {"path": "/grc/vendor-risk/vendors/2"},
    }
    for name, changes in rows.items():
        db.add(m.AuditLog(tenant_id=1, action="update", resource_type=name, changes=changes))
    db.commit()

    def found(module, submodule=None):
        return {r.resource_type for r in db.query(m.AuditLog).filter(_module_filter(module, submodule))}

    assert found("Governance", "KRIs") == {"new_kri", "old_kri"}
    assert found("Risk Management") == {"old_risk", "new_risk"}        # /erm/kris belongs to Governance
    assert found("Risk Management", "Risk Register") == {"old_risk", "new_risk"}
    assert found("Third-Party Vendor Risk") == {"old_vendor"}


# ── What a request changed ───────────────────────────────────────────────────

def test_committed_changes_are_recorded_old_to_new_and_secrets_masked(db):
    token = audit_changes.start()
    user = m.GRCUser(id=7, username="assessor", email="a@bank.example", display_name="Assessor", password_hash="hash")
    db.add(user)
    db.commit()
    user.display_name = "Lead Assessor"
    db.commit()
    doomed = m.GRCUser(id=8, username="temp", email="t@bank.example")
    db.add(doomed)
    db.flush()
    db.rollback()                                                      # never committed: not a change
    result = audit_changes.finish(token)

    created, updated = result["records"]
    assert created["op"] == "created" and created["table"] == "grc_users" and created["id"] == 7
    assert created["name"] == "Assessor" and created["fields"]["password_hash"] == "***"
    assert updated["op"] == "updated" and updated["fields"]["display_name"] == ["Assessor", "Lead Assessor"]
    assert all(r.get("id") != 8 for r in result["records"])

    # outside a request nothing is collected
    db.add(m.GRCUser(id=9, username="bg", email="bg@bank.example"))
    db.commit()
    assert audit_changes._bucket.get() is None


def test_a_rolled_back_savepoint_drops_only_its_own_records():
    outer, savepoint = SimpleNamespace(nested=False), SimpleNamespace(nested=True)
    session = SimpleNamespace(info={audit_changes._PENDING: [(outer, {"id": 1}), (savepoint, {"id": 2})]})
    audit_changes._rolled_back(session, savepoint)
    assert session.info[audit_changes._PENDING] == [(outer, {"id": 1})]
    audit_changes._rolled_back(session, outer)
    assert audit_changes._PENDING not in session.info


def test_a_bulk_import_is_capped_and_counted(db):
    token = audit_changes.start()
    db.add_all(m.GRCUser(id=100 + i, username=f"u{i}", email=f"u{i}@bank.example") for i in range(45))
    db.commit()
    result = audit_changes.finish(token)
    assert len(result["records"]) == audit_changes.MAX_RECORDS and result["more"] == 45 - audit_changes.MAX_RECORDS


def test_the_request_row_names_its_page_function_and_changes(db, monkeypatch):
    from grc import audit_logger, db as grc_db
    from grc.main import app  # noqa: F401 — builds the endpoint labels
    from grc.routers.compliance_assessments_router import generate_ai_recommendation

    db.add(m.ComplianceAssessmentDocument(id=3, tenant_id=1, name="OWASP ASVS", assessment_type="checklist",
                                          assessment_format="asvs_checklist"))
    db.commit()
    bind = db.get_bind()
    monkeypatch.setattr(grc_db, "open_tenant_session", lambda slug: Session(bind))
    monkeypatch.setattr(audit_logger, "_resolve_tenant_slug", lambda request, tenant_id: "demo")
    scope = {"type": "http", "method": "POST", "path": "/grc/compliance/assessments/3/items/30/ai-recommendation",
             "headers": [], "query_string": b"", "endpoint": generate_ai_recommendation, "state": {"tenant_id": 1}}
    changes = {"records": [{"op": "updated", "table": "grc_compliance_assessment_document_items", "id": 30,
                            "fields": {"ai_evidence_recommendation": [None, "{...}"]}}], "more": 0}
    audit_logger.write_audit_log(Request(scope), Response(status_code=200), time.time(), None, None, changes)
    audit_logger.write_audit_log(Request(scope), Response(status_code=502), time.time(), None, None, changes)

    ok, failed = db.query(m.AuditLog).order_by(m.AuditLog.id).all()
    assert (ok.changes["module"], ok.changes["submodule"]) == ("Assessments", "Cyber Security")
    assert ok.changes["feature"] and ok.changes["db_changes"] == changes
    assert "db_changes" not in failed.changes                          # a failed request's writes rolled back


def test_a_background_job_that_changed_records_writes_one_row(db, monkeypatch):
    from grc import audit_logger, db as grc_db

    bind = db.get_bind()
    monkeypatch.setattr(grc_db, "open_tenant_session", lambda slug: Session(bind))

    def auto_map_document_controls():
        pass
    auto_map_document_controls.__module__ = "grc.tasks.governance"

    with audit_logger.background_job("demo", auto_map_document_controls):
        with Session(bind) as work:
            work.add(m.GRCUser(id=11, username="mapped", email="m@bank.example"))
            work.commit()
    with audit_logger.background_job("demo", auto_map_document_controls):
        pass                                                           # changed nothing: no row

    row = db.query(m.AuditLog).one()
    assert row.action == "background_job" and row.changes["actor_display"] == "Background job"
    assert (row.changes["module"], row.changes["submodule"]) == ("Governance", "Documents")
    assert row.changes["summary"] == "Background job: Auto Map Document Controls (1 record changed)"
    assert row.changes["db_changes"]["records"][0]["id"] == 11


# ── Triggers ─────────────────────────────────────────────────────────────────

def _row(endpoint, status=200, action="create", body=None, resource_type="auth"):
    return SimpleNamespace(id=1, action=action, resource_type=resource_type, resource_id=None, tenant_id=1,
                           changes={"method": "POST", "endpoint": endpoint, "status_code": status,
                                    "path": "/grc/x", "request": body or {}})


def test_sign_in_and_capa_actions_raise_their_events():
    names = TriggerDispatcher._derive_event_names
    ok = names(_row("grc.routers.auth_router:login"))
    refused = names(_row("grc.routers.auth_router:login", status=401, action="create_failed"))
    assert "user_signed_in" in ok and "sign_in_failed" not in ok
    assert "sign_in_failed" in refused and not [n for n in refused if n.startswith("api.")]
    verified = names(_row("grc.modules.issue_management.routers.actions:verify_action", action="verify"))
    assert "capa_action_completed" in verified
    # an edit is not an expiry
    edit = SimpleNamespace(id=2, action="update", resource_type="evidence", resource_id=4, tenant_id=1,
                           changes={"method": "PUT", "path": "/grc/evidence/4", "status_code": 200, "request": {}})
    assert "evidence_expires" not in names(edit)


def test_the_builder_has_capa_and_sign_in_and_every_date_event_points_at_a_real_column():
    from grc.modules.workflow_engine.services import catalog as C

    capa = {n["label"]: n for n in C.PLATFORM_FUNCTION_NODE_TYPES
            if n.get("endpoint_module") == "grc.modules.issue_management.routers.actions"}
    assert {"Add CAPA Action To Issue", "Edit CAPA Action", "Verify CAPA Action", "Delete CAPA Action"} <= set(capa)
    assert capa["Verify CAPA Action"]["trigger_event"] == "api.issue_management.actions.verify_action"
    keys = {t["key"] for t in C.TRIGGER_NODE_TYPES}
    assert {"user_signed_in", "sign_in_failed", "capa_action_overdue", "vendor_contract_expiring"} <= keys
    for key, _label, _module, model_name, field, when, _days, done in C.DUE_DATE_EVENTS:
        column = getattr(getattr(m, model_name), field)
        assert isinstance(column.type, (Date, DateTime)), (key, model_name, field)
        assert when in {"overdue", "soon", "upcoming"} and all(s == s.lower() for s in done)


def _dispatcher(db, monkeypatch):
    dispatcher = TriggerDispatcher(SimpleNamespace(_use_redis=False))
    fired = []
    monkeypatch.setattr(dispatcher, "_iter_tenant_sessions", lambda: iter([(1, "demo", db)]))
    monkeypatch.setattr(dispatcher, "publish_event", lambda **kw: fired.append(kw))
    return dispatcher, fired


def _listen(db, event):
    db.add(_make(m.WorkflowDefinition, tenant_id=1, name=f"On {event}", trigger_event=event, is_active=True))
    db.commit()


def test_an_overdue_date_fires_once_only_for_a_listening_workflow_and_recent_dates(db, monkeypatch):
    now = datetime.utcnow()
    db.add_all([
        _make(m.RiskMitigationAction, title="Patch the firewall", status="open", due_date=now - timedelta(days=2)),
        _make(m.RiskMitigationAction, title="Done already", status="completed", due_date=now - timedelta(days=2)),
        _make(m.RiskMitigationAction, title="Overdue for months", status="open", due_date=now - timedelta(days=60)),
        _make(m.RiskMitigationAction, title="Due tomorrow", status="open", due_date=now + timedelta(days=1)),
    ])
    db.commit()
    dispatcher, fired = _dispatcher(db, monkeypatch)
    assert dispatcher._check_due_dates() == 0                          # no workflow listens: nothing queried
    _listen(db, "mitigation_action_overdue")
    assert dispatcher._check_due_dates() == 1
    assert fired[0]["event_name"] == "mitigation_action_overdue"
    assert fired[0]["payload"]["title"] == "Patch the firewall" and fired[0]["payload"]["overdue"] is True
    assert fired[0]["correlation_id"].startswith("due:mitigation_action_overdue:RiskMitigationAction:")
    assert dispatcher._check_due_dates() == 0                          # once per record and date


def test_an_approaching_sla_raises_its_older_name_too_and_starts_a_workflow_once(db, monkeypatch):
    db.add(_make(m.Vulnerability, title="OpenSSL", status="open", due_date=datetime.utcnow() + timedelta(days=3)))
    db.commit()
    _listen(db, "vulnerabilities.sla_warning")
    dispatcher, fired = _dispatcher(db, monkeypatch)
    assert dispatcher._check_due_dates() == 2
    assert {f["event_name"] for f in fired} == {"vulnerability_sla_warning", "vulnerabilities.sla_warning"}
    token = fired[0]["correlation_id"]
    assert dispatcher._first_start(5, token) is True
    assert dispatcher._first_start(5, token) is False                  # second worker, or after a restart
    assert dispatcher._first_start(5, "webhook:3:1700000000") is True
    assert dispatcher._first_start(5, "webhook:3:1700000000") is True  # webhooks and schedules are never merged
