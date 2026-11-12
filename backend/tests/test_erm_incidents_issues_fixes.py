"""Incidents, Issues & CAPA and Risk Posture defects (2026-11-11). In-memory SQLite.

- the incident dashboard returns the Investigating and Resolved (Month) counts its tiles read
- closing an incident outright stamps resolved_at; incident writes check a permission; import maps "contained"
- a plain transition to "closed" goes through the formal close (notes, closer, closed_at, status)
- /issues/from-source routes each source to its own record, refuses event-only sources, keeps the form's links
- the open-issue count includes closure_review; a KRI breach issue can carry its risk
- saving risk weights works for an administrator; posture reads check the view right
"""
import importlib
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (Base, GovernanceDocument, GRCUser, InternalControl, Issue, IssueControlLink,
                        IssueGovernanceLink, IssueRiskLink, ITAsset, Risk, RiskIncident, Role, Tenant,
                        TenantRiskWeights, UserRole, get_db)
from grc.modules.erm.routers import incident_import, incident_links, incidents
from grc.modules.issue_management.routers import auto_create as from_source_routes
from grc.modules.issue_management.routers import issues as issue_routes
from grc.modules.issue_management.services import auto_create as auto_create_service
from grc.modules.risk_posture import router as posture_routes
from grc.routers.auth_router import create_access_token, require_auth

ADMIN, PLAIN = 7, 8


@pytest.fixture()
def db(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add(Role(id=1, name="Administrator"))
    s.add_all([GRCUser(id=ADMIN, username="admin", email="admin@bank.test", is_active=True),
               GRCUser(id=PLAIN, username="plain", email="plain@bank.test", is_active=True)])
    s.add(UserRole(user_id=ADMIN, role_id=1, tenant_id=1))
    s.commit()
    # Postgres-only DDL healing; create_all already made every table here.
    monkeypatch.setattr(incidents, "ensure_incident_schema", lambda _db: None)
    monkeypatch.setattr(incident_import, "ensure_incident_schema", lambda _db: None)
    yield s
    s.close()


def client(db, username="admin"):
    app = FastAPI()
    for r in (incident_import.router, incidents.router, incident_links.router, from_source_routes.router, issue_routes.router,
              posture_routes.router):
        app.include_router(r)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(username=username).one()
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": username})
    return http


def _incident(db, **kw):
    row = RiskIncident(tenant_id=1, title=kw.pop("title", "Outage"), incident_date=datetime.utcnow(),
                       severity="high", **kw)
    db.add(row)
    db.commit()
    return row


# ── Incidents ───────────────────────────────────────────────────────────────

def test_the_dashboard_returns_the_investigating_and_resolved_this_month_counts(db):
    now = datetime.utcnow()
    _incident(db, status="investigating")
    _incident(db, status="mitigating")
    _incident(db, status="resolved", resolved_at=now)
    _incident(db, status="closed", resolved_at=now - timedelta(days=40))    # an earlier month
    body = client(db).get("/incidents/dashboard").json()
    assert body["investigating"] == 1
    assert body["resolved_this_month"] == 1
    assert body["open_incidents"] == 2            # mitigating is still open


def test_closing_an_incident_outright_stamps_resolved_at(db):
    inc = _incident(db, status="investigating")
    res = client(db).put(f"/incidents/{inc.id}", json={"status": "closed"})
    assert res.status_code == 200, res.text
    db.refresh(inc)
    assert inc.status == "closed" and inc.resolved_at is not None


def test_incident_writes_need_a_permission(db):
    inc = _incident(db, status="open")
    http = client(db, "plain")
    assert http.post("/incidents", json={"title": "x", "incident_date": "2026-11-01T00:00:00"}).status_code == 403
    assert http.put(f"/incidents/{inc.id}", json={"status": "closed"}).status_code == 403
    assert http.delete(f"/incidents/{inc.id}").status_code == 403
    assert http.post(f"/incidents/{inc.id}/links/risks", json={"risk_id": 1}).status_code == 403
    assert http.get("/incidents/dashboard").status_code == 200      # reads stay open to the router's view gate


def test_import_maps_contained_to_mitigating(db):
    csv = "title,incident_date,severity,status\nLeak,2026-11-01,high,contained\n"
    res = client(db).post("/incidents/import/upload", files={"file": ("i.csv", csv.encode(), "text/csv")})
    assert res.status_code == 200 and res.json()["imported"] == 1, res.text
    assert db.query(RiskIncident).one().status == "mitigating"


# ── Issues & CAPA ───────────────────────────────────────────────────────────

def _issue(db, state="closure_review"):
    row = Issue(tenant_id=1, title="Gap", workflow_state=state, status="open")
    db.add(row)
    db.commit()
    return row


def test_a_transition_to_closed_is_the_formal_close(db):
    issue = _issue(db)
    http = client(db)
    refused = http.post(f"/issues/{issue.id}/transition", json={"to_state": "closed"})
    assert refused.status_code == 400 and "closure_notes" in refused.text
    db.refresh(issue)
    assert issue.workflow_state == "closure_review"

    done = http.post(f"/issues/{issue.id}/transition", json={"to_state": "closed", "notes": "Fixed and tested"})
    assert done.status_code == 200, done.text
    db.refresh(issue)
    assert (issue.workflow_state, issue.status, issue.closure_notes) == ("closed", "closed", "Fixed and tested")
    assert issue.closed_at is not None and issue.approved_by_id == ADMIN


def test_an_event_only_source_is_refused_not_linked_to_a_control_by_its_id(db):
    db.add(InternalControl(id=5, tenant_id=1, control_id="IC-005", name="Unrelated control"))
    db.commit()
    for source in ("kri_breach", "mitigation_overdue", "control_test_failed"):
        res = client(db).post("/issues/from-source", json={"source_type": source, "source_id": 5})
        assert res.status_code == 400, (source, res.text)
    assert db.query(Issue).count() == 0 and db.query(IssueControlLink).count() == 0


def test_a_governance_source_links_its_document_and_keeps_the_forms_links(db):
    db.add(GovernanceDocument(id=3, tenant_id=1, title="Access policy", doc_type="policy"))
    db.add(InternalControl(id=3, tenant_id=1, control_id="IC-003", name="Same id, other record"))
    db.add(Risk(id=4, tenant_id=1, title="Access abuse", category="operational"))
    db.commit()
    res = client(db).post("/issues/from-source", json={
        "source_type": "governance_document", "source_id": 3,
        "linked_risk_ids": [4], "linked_internal_control_ids": [3],
    })
    assert res.status_code == 201, res.text
    issue = db.get(Issue, res.json()["id"])
    assert issue.title == "Document gap: Access policy" and issue.source_type == "governance_document"
    assert [g.governance_document_id for g in db.query(IssueGovernanceLink).all()] == [3]
    assert [r.risk_id for r in db.query(IssueRiskLink).all()] == [4]
    # the picked control is the only control link: the document id was not read as a control
    assert [(c.internal_control_id, c.framework_control_id) for c in db.query(IssueControlLink).all()] == [(3, None)]


def test_a_risk_source_with_the_same_risk_picked_links_it_once(db):
    db.add(Risk(id=4, tenant_id=1, title="Access abuse", category="operational"))
    db.commit()
    res = client(db).post("/issues/from-source", json={"source_type": "risk", "source_id": 4, "linked_risk_ids": [4]})
    assert res.status_code == 201, res.text
    assert db.query(IssueRiskLink).count() == 1


def test_an_auto_created_issue_keeps_the_risk_it_is_given(db):
    db.add(Risk(id=4, tenant_id=1, title="Liquidity", category="financial"))
    db.commit()
    issue = auto_create_service.from_event(db=db, tenant_id=1, source_type="kri_breach", source_id=9,
                                           title="KRI breach (RED)", risk_id=4)
    db.commit()
    assert [r.risk_id for r in db.query(IssueRiskLink).filter_by(issue_id=issue.id)] == [4]


def test_the_open_states_agree_and_closure_review_is_open():
    import ast, pathlib
    src = pathlib.Path(issue_routes.__file__).with_name("dashboard.py").read_text(encoding="utf-8")
    sets = [ast.literal_eval(n.value) for n in ast.walk(ast.parse(src))
            if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", None) == "open_states"]
    assert sets == [auto_create_service.OPEN_STATES]


# ── Risk posture ────────────────────────────────────────────────────────────

WEIGHTS = {"weight_cis": 20, "weight_vuln": 30, "weight_cia": 20, "weight_ctrl": 15, "weight_risk": 15}


def test_an_administrator_can_save_weights(db):
    res = client(db).put("/risk-posture/weights", json=WEIGHTS)
    assert res.status_code == 200, res.text
    row = db.query(TenantRiskWeights).one()
    assert (float(row.weight_cis), float(row.weight_cia), row.updated_by) == (20.0, 20.0, ADMIN)


def test_posture_reads_and_weight_saves_check_a_permission(db):
    db.add(ITAsset(id=1, tenant_id=1, name="srv", asset_type="infrastructure"))
    db.commit()
    http = client(db, "plain")
    assert http.put("/risk-posture/weights", json=WEIGHTS).status_code == 403
    assert http.get("/risk-posture/weights").status_code == 403
    assert http.get("/risk-posture/asset/1").status_code == 403
    assert http.post("/risk-posture/asset/1/preview", json={}).status_code == 403

