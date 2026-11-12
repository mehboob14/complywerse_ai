"""Wave 1-D: Incidents become Basel loss events (decision 4). In-memory SQLite, through the real /erm router.

- net loss is gross loss less recoveries, never below zero; financial_impact and gross_loss mirror each other
- the discovery date can be entered and edited
- a second person validates classification and amounts (maker-checker, no admin exception); an edit to either sends it back
- the dashboard sums net loss by quarter per currency; import takes the new columns by key or label, and old templates
"""
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import Base, GRCUser, Permission, RiskIncident, Role, RolePermission, Tenant, UserRole, get_db
from grc.modules.erm import schema_migrations
from grc.modules.erm.router import router as erm_router
from grc.modules.erm.routers import incident_import, incidents
from grc.routers.auth_router import create_access_token, require_auth

REPORTER, CHECKER, VIEWER = 7, 8, 9


@pytest.fixture()
def db(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add_all([Role(id=2, name="Risk officer"), Role(id=3, name="Risk viewer")])
    perms = ["erm:risks:view", "erm:risks:create", "erm:risks:edit"]
    s.add_all([Permission(id=i, name=n, resource="erm:risks", action=n.split(":")[-1]) for i, n in enumerate(perms, 1)])
    s.add_all([RolePermission(role_id=2, permission_id=i) for i in (1, 2, 3)] + [RolePermission(role_id=3, permission_id=1)])
    s.add_all([GRCUser(id=REPORTER, username="reporter", email="reporter@bank.test", is_active=True),
               GRCUser(id=CHECKER, username="checker", email="checker@bank.test", is_active=True),
               GRCUser(id=VIEWER, username="viewer", email="viewer@bank.test", is_active=True)])
    s.add_all([UserRole(user_id=REPORTER, role_id=2, tenant_id=1), UserRole(user_id=CHECKER, role_id=2, tenant_id=1),
               UserRole(user_id=VIEWER, role_id=3, tenant_id=1)])
    s.commit()
    # Postgres-only DDL healing; create_all already made every table here.
    monkeypatch.setattr(incidents, "ensure_incident_schema", lambda _db: None)
    monkeypatch.setattr(incident_import, "ensure_incident_schema", lambda _db: None)
    yield s
    s.close()


def client(db, username="reporter"):
    app = FastAPI()
    app.include_router(erm_router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(username=username).one()
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": username})
    return http


def report(http, **fields):
    body = {"title": "Card skimming at branch", "incident_date": "2026-11-02T00:00:00", **fields}
    res = http.post("/erm/incidents", json=body)
    assert res.status_code == 201, res.text
    return res.json()


def complete(**extra):
    return {"event_type": "external_fraud", "business_line": "retail_banking", "gross_loss": 1000, "currency": "USD", **extra}


# ── Amounts ──────────────────────────────────────────────────────────────────

def test_net_loss_is_gross_less_recoveries_and_never_negative(db):
    http = client(db)
    ev = report(http, gross_loss=1000, recoveries=300, currency="usd")
    assert (ev["gross_loss"], ev["recoveries"], ev["net_loss"], ev["currency"]) == (1000, 300, 700, "USD")
    ev = http.put(f"/erm/incidents/{ev['id']}", json={"recoveries": 1500}).json()
    assert ev["net_loss"] == 0
    assert http.post("/erm/incidents", json={"title": "x", "incident_date": "2026-11-02", "gross_loss": -5}).status_code == 422
    assert http.post("/erm/incidents", json={"title": "x", "incident_date": "2026-11-02", "currency": "DOLLARS"}).status_code == 422


def test_financial_impact_and_gross_loss_mirror_each_other(db):
    http = client(db)
    old_client = report(http, financial_impact=500)
    assert (old_client["gross_loss"], old_client["net_loss"]) == (500, 500)
    new_client = report(http, gross_loss=800)
    assert new_client["financial_impact"] == 800
    assert http.put(f"/erm/incidents/{new_client['id']}", json={"financial_impact": 900}).json()["gross_loss"] == 900
    assert http.put(f"/erm/incidents/{new_client['id']}", json={"gross_loss": 950}).json()["financial_impact"] == 950
    # a writer that only knows financial_impact (audit register, legacy routes) still gets a gross and net loss
    legacy = RiskIncident(tenant_id=1, title="Legacy", incident_date=datetime.utcnow(), financial_impact=40)
    db.add(legacy)
    db.commit()
    assert (legacy.gross_loss, legacy.net_loss) == (40, 40)


def test_the_discovery_date_is_entered_and_edited(db):
    http = client(db)
    ev = report(http, discovered_date="2026-11-05T00:00:00")
    assert ev["discovered_date"].startswith("2026-11-05")
    assert http.put(f"/erm/incidents/{ev['id']}", json={"discovered_date": "2026-11-06"}).json()["discovered_date"].startswith("2026-11-06")
    assert http.put(f"/erm/incidents/{ev['id']}", json={"discovered_date": None}).json()["discovered_date"].startswith("2026-11-06")
    omitted = report(http)
    assert datetime.fromisoformat(omitted["discovered_date"]) > datetime.utcnow() - timedelta(minutes=5)


# ── Validation (the template's gate) ─────────────────────────────────────────

def test_the_reporter_cannot_validate_their_own_event_and_someone_else_can(db):
    ev = report(client(db), **complete())
    assert ev["validation_status"] == "pending"
    own = client(db).post(f"/erm/incidents/{ev['id']}/validate", json={"note": "fine"})
    assert own.status_code == 409 and "validate this loss event" in own.text
    done = client(db, "checker").post(f"/erm/incidents/{ev['id']}/validate", json={"note": "Matches GL"})
    assert done.status_code == 200, done.text
    body = done.json()
    assert (body["validation_status"], body["validated_by"], body["validation_note"]) == ("validated", CHECKER, "Matches GL")
    assert body["validated_at"]
    assert client(db, "viewer").post(f"/erm/incidents/{ev['id']}/validate", json={}).status_code == 403


def test_validation_names_what_is_missing(db):
    ev = report(client(db))
    refused = client(db, "checker").post(f"/erm/incidents/{ev['id']}/validate", json={})
    assert refused.status_code == 400
    assert all(word in refused.json()["detail"] for word in ("event type", "gross loss", "currency"))
    near_miss = report(client(db), event_type="execution_delivery", is_near_miss=True)
    assert client(db, "checker").post(f"/erm/incidents/{near_miss['id']}/validate", json={}).status_code == 200


def test_returning_an_event_needs_a_note(db):
    ev = report(client(db), **complete())
    checker = client(db, "checker")
    assert checker.post(f"/erm/incidents/{ev['id']}/return", json={}).status_code == 400
    assert client(db).post(f"/erm/incidents/{ev['id']}/return", json={"note": "x"}).status_code == 409
    back = checker.post(f"/erm/incidents/{ev['id']}/return", json={"note": "Recoveries missing"}).json()
    assert (back["validation_status"], back["validation_note"]) == ("returned", "Recoveries missing")


def test_an_edit_to_classification_or_amounts_sends_it_back_to_pending(db):
    http = client(db)
    ev = report(http, **complete())
    client(db, "checker").post(f"/erm/incidents/{ev['id']}/validate", json={})
    # the form re-sends unchanged values with a new title: still validated
    same = http.put(f"/erm/incidents/{ev['id']}", json={**complete(), "title": "Card skimming, branch 12"}).json()
    assert same["validation_status"] == "validated"
    changed = http.put(f"/erm/incidents/{ev['id']}", json={"gross_loss": 1200}).json()
    assert (changed["validation_status"], changed["validated_by"], changed["validated_at"]) == ("pending", None, None)
    client(db, "checker").post(f"/erm/incidents/{ev['id']}/validate", json={})
    assert http.put(f"/erm/incidents/{ev['id']}", json={"event_type": "Internal fraud"}).json()["validation_status"] == "pending"


def test_an_unknown_event_type_is_refused_and_a_label_is_taken(db):
    http = client(db)
    assert http.post("/erm/incidents", json={"title": "x", "incident_date": "2026-11-02", "event_type": "alien"}).status_code == 400
    ev = report(http, event_type="Business disruption and system failures", business_line="Payment and settlement")
    assert (ev["event_type"], ev["business_line"]) == ("business_disruption", "payment_settlement")


# ── Dashboard and list ───────────────────────────────────────────────────────

def _row(db, **kw):
    row = RiskIncident(tenant_id=1, title=kw.pop("title", "Event"), incident_date=kw.pop("incident_date", datetime.utcnow()),
                       **kw)
    db.add(row)
    db.commit()
    return row


def test_the_dashboard_sums_quarters_per_currency_and_never_adds_them_up(db):
    now = datetime.utcnow()
    quarter_start = datetime(now.year, 3 * ((now.month - 1) // 3) + 1, 1)
    last_quarter = quarter_start - timedelta(days=10)
    _row(db, gross_loss=100, currency="USD", accounting_date=now, event_type="external_fraud")
    _row(db, gross_loss=50, currency="EUR", accounting_date=now, event_type="external_fraud")
    _row(db, gross_loss=20, currency="USD", event_type="execution_delivery")               # no accounting date: occurrence date
    _row(db, gross_loss=30, currency="USD", accounting_date=last_quarter)                  # booked last quarter
    _row(db, is_near_miss=True, event_type="execution_delivery", validation_status="validated")
    body = client(db).get("/erm/incidents/dashboard").json()
    assert body["net_loss_this_quarter"] == [{"currency": "EUR", "net_loss": 50}, {"currency": "USD", "net_loss": 120}]
    assert body["net_loss_last_quarter"] == [{"currency": "USD", "net_loss": 30}]
    assert {"event_type": "external_fraud", "currency": "USD", "net_loss": 100} in body["net_loss_by_event_type"]
    assert {"event_type": "external_fraud", "currency": "EUR", "net_loss": 50} in body["net_loss_by_event_type"]
    assert (body["near_misses"], body["awaiting_validation"]) == (1, 4)
    for kept in ("total_incidents", "open_incidents", "investigating", "resolved_this_month", "total_financial_impact"):
        assert kept in body


def test_the_list_filters_by_event_type_and_validation_status(db):
    _row(db, title="A", event_type="external_fraud")                                       # never validated: pending
    _row(db, title="B", event_type="external_fraud", validation_status="validated")
    _row(db, title="C", event_type="internal_fraud", validation_status="pending")
    http = client(db)
    titles = lambda **p: sorted(r["title"] for r in http.get("/erm/incidents", params=p).json())  # noqa: E731
    assert titles(event_type="external_fraud") == ["A", "B"]
    assert titles(validation_status="pending") == ["A", "C"]
    assert titles(event_type="external_fraud", validation_status="validated") == ["B"]


# ── Import ───────────────────────────────────────────────────────────────────

def _upload(http, csv):
    res = http.post("/erm/incidents/import/upload", files={"file": ("i.csv", csv.encode(), "text/csv")})
    assert res.status_code == 200, res.text
    return res.json()


def test_import_takes_the_new_columns_by_key_or_label_and_old_templates(db):
    http = client(db)
    template = http.get("/erm/incidents/template/download").text.splitlines()[0]
    for col in ("event_type", "business_line", "gross_loss", "recoveries", "currency", "accounting_date", "is_near_miss"):
        assert col in template
    new = ("title,incident_date,discovered_date,accounting_date,Event type,business_line,gross_loss,recoveries,currency,is_near_miss\n"
           'Skimming,2026-10-01,2026-10-03,2026-10-10,External fraud,retail_banking,"1,200.50",200,eur,no\n'
           "Bad,2026-10-01,,,Space weather,,,,,\n")
    result = _upload(http, new)
    assert result["imported"] == 1 and "event type" in result["errors"][0].lower()
    row = db.query(RiskIncident).filter_by(title="Skimming").one()
    assert (row.event_type, row.business_line, row.currency, row.is_near_miss) == ("external_fraud", "retail_banking", "EUR", False)
    assert (row.gross_loss, row.recoveries, row.net_loss, row.financial_impact) == (1200.5, 200, 1000.5, 1200.5)
    assert (row.discovered_date.day, row.accounting_date.day) == (3, 10)

    old = "title,incident_date,severity,financial_impact\nOutage,2026-11-01,high,25000\n"
    assert _upload(http, old)["imported"] == 1
    row = db.query(RiskIncident).filter_by(title="Outage").one()
    assert (row.gross_loss, row.net_loss, row.validation_status) == (25000, 25000, "pending")


# ── Taxonomy, AI and schema ──────────────────────────────────────────────────

def test_the_taxonomy_endpoint_returns_event_types_and_business_lines(db):
    body = client(db, "viewer").get("/erm/incidents/taxonomy").json()
    assert [e["key"] for e in body["event_types"]] == [
        "internal_fraud", "external_fraud", "employment_practices", "clients_products",
        "physical_assets", "business_disruption", "execution_delivery"]
    assert body["event_types"][2]["label"] == "Employment practices and workplace safety"
    assert len(body["business_lines"]) == 8 and body["business_lines"][0] == {"key": "corporate_finance", "label": "Corporate finance"}


def test_ai_suggestions_keep_only_taxonomy_keys(db, monkeypatch):
    content = '{"suggested_severity": "high", "event_type": "cyber_stuff", "business_line": "retail_banking"}'
    reply = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])
    fake = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=lambda **_: reply)))
    monkeypatch.setattr(incidents, "get_openai_client", lambda: fake)
    got = client(db).post("/erm/incidents/ai-suggest", json={"title": "Card fraud at ATM"}).json()["suggestion"]
    assert got["business_line"] == "retail_banking"
    assert got["event_type"] == "external_fraud"           # the made-up key is dropped; the keyword guess stays


def test_every_new_column_is_in_the_migration_list():
    listed = {col for table, col, _ in schema_migrations._LOSS_COLUMNS if table == "grc_risk_incidents"}
    new = {"event_type", "event_type_l2", "business_line", "gross_loss", "recoveries", "net_loss", "currency", "accounting_date",
           "is_near_miss", "boundary_type", "validation_status", "validated_by", "validated_at", "validation_note"}
    assert new <= set(RiskIncident.__table__.columns.keys())
    assert listed == new
