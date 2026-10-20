"""The control-exception model is called "Exception": a module that imported it under that name lost Python's, and every
`except Exception:` there raised TypeError instead of catching the error (committees, the models' get_db). It is imported under
its own name now. And a pending control exception put on a committee's agenda no longer stores its id as the item's risk (an
exception's id names no risk: the agenda showed an unrelated risk's title). In-memory SQLite."""
import builtins
import importlib
from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.modules.governance.routers import committees
from grc.routers.auth_router import require_auth


def test_except_exception_catches_errors_again_where_the_exception_model_is_used(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "unit-test-secret")
    # an upload that is not the PDF it says it is: read as nothing (it raised TypeError, a 500)
    assert committees.extract_text_from_uploaded_action_file(SimpleNamespace(filename="minutes.pdf"), b"not a pdf") == ""
    for module in (committees, importlib.import_module("grc.routers.governance_router")):
        assert getattr(module, "Exception", builtins.Exception) is builtins.Exception, module.__name__     # not shadowed

    m38 = importlib.import_module("grc.models._38_database_initialization_functions")
    session = SimpleNamespace(close=lambda: None)

    def fails(*a, **k):
        raise RuntimeError("self-heal failed")

    monkeypatch.setattr(m38, "open_tenant_session", lambda slug: session)              # never a real tenant database
    monkeypatch.setattr("grc.services.ai_usage.bind_tenant", fails)
    monkeypatch.setattr("grc.modules.compliance.schema_migrations.ensure_assigned_column", fails)
    db = m38.get_db(SimpleNamespace(state=SimpleNamespace(tenant_slug="acme")))
    assert next(db) is session                                       # a failed self-heal never blocks the request


@pytest.fixture()
def http():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add(m.Tenant(id=1, name="Bank", slug="bank"))
    db.add(m.GRCUser(id=7, username="officer", display_name="Officer", email="officer@bank.test", is_active=True))
    db.add(m.GovernanceCommittee(id=1, tenant_id=1, name="Risk Committee", committee_type="risk_committee"))
    db.add(m.CommitteeMeeting(id=1, tenant_id=1, committee_id=1, title="Q3 meeting", scheduled_date=datetime(2026, 11, 1)))
    db.add(m.Risk(id=1, tenant_id=1, title="Unrelated vendor risk", category="third_party"))        # shares the exception's id
    db.add(m.Exception(id=1, tenant_id=1, title="Firewall rule waiver", justification="Legacy system", status="pending"))
    db.commit()
    app = FastAPI()
    app.include_router(committees.router)
    app.dependency_overrides[m.get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(m.GRCUser, 7)
    yield TestClient(app)
    db.close()


def test_a_pending_control_exception_goes_on_the_agenda_without_a_risk_link(http):
    suggested = http.get("/committees/meetings/1/suggested-agenda-items").json()["suggested_items"]
    item = next(s for s in suggested if s["source_type"] == "exception")
    assert (item["source_id"], item["linked_risk_id"]) == (1, None)

    made = http.post("/committees/meetings/1/auto-populate-agenda",
                     json={"include_documents": False, "include_exceptions": True, "include_regulatory_changes": False}).json()
    assert made["by_type"]["exceptions"] == 1
    created = made["created_items"][0]
    assert created["title"] == "Risk Exception Review: Firewall rule waiver"
    assert (created["linked_risk_id"], created["linked_risk_title"]) == (None, None)        # not "Unrelated vendor risk"
