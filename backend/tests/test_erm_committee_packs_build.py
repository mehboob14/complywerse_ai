"""Risk Management wave 3-J: committee packs.

A pack is built from live data at the moment of building and keeps that snapshot. Commentary is edited per section while
the pack is not frozen; a second person (never the preparer, admins included) approves and freezes it; a frozen pack is
read-only, never recomputed, exports as PDF and Excel, and is attached to its committee meeting as a paper.
Runs through the real /erm router as two non-admin risk managers. In-memory SQLite.
"""
import io
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.models import get_db
from grc.modules.erm.router import router as erm_router
from grc.modules.erm.routers.incidents import _quarter_start
from grc.modules.governance.routers import committees
from grc.modules.issue_management.services.risk_actions import add_risk_action
from grc.routers.auth_router import create_access_token, require_auth

PREPARER, CHECKER, VIEWER = 7, 8, 9
NOW = datetime.utcnow()
THIS_Q = _quarter_start(NOW)
LAST_Q = THIS_Q - timedelta(days=10)


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add_all([m.Tenant(id=1, name="Bank", slug="bank"), m.Tenant(id=2, name="Other", slug="other")])
    s.add_all([m.Role(id=1, name="Risk manager"), m.Role(id=2, name="Risk viewer")])
    perms = ["erm:risks:view", "erm:risks:create", "erm:risks:edit"]
    s.add_all([m.Permission(id=i + 1, name=p, resource="erm:risks", action=p.split(":")[-1]) for i, p in enumerate(perms)])
    s.add_all([m.RolePermission(role_id=1, permission_id=i + 1) for i in range(3)] + [m.RolePermission(role_id=2, permission_id=1)])
    for uid, name in ((PREPARER, "preparer"), (CHECKER, "checker"), (VIEWER, "viewer")):
        s.add(m.GRCUser(id=uid, username=name, display_name=name.title(), email=f"{name}@bank.test", is_active=True))
    s.add_all([m.UserRole(user_id=PREPARER, role_id=1, tenant_id=1), m.UserRole(user_id=CHECKER, role_id=1, tenant_id=1),
               m.UserRole(user_id=VIEWER, role_id=2, tenant_id=1)])
    s.add(m.GovernanceCommittee(id=1, tenant_id=1, name="Board Risk Committee", committee_type="risk_committee"))
    s.add(m.CommitteeMeeting(id=1, tenant_id=1, committee_id=1, title="BRC Q4", scheduled_date=NOW + timedelta(days=14)))
    s.add(m.GovernanceCommittee(id=2, tenant_id=2, name="Elsewhere", committee_type="board"))
    s.add(m.CommitteeMeeting(id=2, tenant_id=2, committee_id=2, title="Not ours", scheduled_date=NOW))
    s.commit()
    yield s
    s.close()


@pytest.fixture(autouse=True)
def papers(tmp_path, monkeypatch):
    monkeypatch.setattr(committees, "MEETING_ATTACHMENT_DIR", str(tmp_path))
    return tmp_path


def client(db, username="preparer"):
    app = FastAPI()
    app.include_router(erm_router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(m.GRCUser).filter_by(username=username).one()
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": username})
    return http


def live_data(db):
    """One of everything a pack reports on."""
    db.add(m.RiskAppetiteConfig(tenant_id=1, category="operational", appetite_level="cautious", max_acceptable_score=15,
                                tolerance_threshold=12))
    db.add(m.RiskAppetiteConfig(tenant_id=1, category="compliance", appetite_level="averse", max_acceptable_score=8))
    over = m.Risk(id=1, tenant_id=1, title="Ledger outage", category="operational", risk_category="operational",
                  inherent_score=20, residual_score=16, status="open")
    inside = m.Risk(id=2, tenant_id=1, title="Late filing", category="compliance", risk_category="compliance",
                    inherent_score=9, residual_score=6, status="open")
    accepted = m.Risk(id=3, tenant_id=1, title="Legacy core", category="operational", risk_category="operational",
                      inherent_score=8, residual_score=8, status="accepted", acceptance_status="approved",
                      acceptance_expires_at=NOW + timedelta(days=30))
    db.add_all([over, inside, accepted])
    db.flush()
    db.add(m.RiskReview(risk_id=1, status="approved", due_date=NOW - timedelta(days=40), completed_at=NOW - timedelta(days=40),
                        previous_residual_score=12, new_residual_score=12))
    db.add(m.RiskReview(risk_id=2, status="pending", due_date=NOW - timedelta(days=3)))
    db.add(m.RiskKRI(id=42, tenant_id=1, risk_id=1, name="Failed payments", current_value=9, green_threshold=3,
                     amber_threshold=6, threshold_direction="lower_is_better", is_active=True))
    # net loss is set on save from gross − recoveries
    db.add_all([
        m.RiskIncident(tenant_id=1, title="Card fraud", incident_date=THIS_Q, gross_loss=1200, recoveries=200, currency="PKR"),
        m.RiskIncident(tenant_id=1, title="Wire error", incident_date=LAST_Q, accounting_date=THIS_Q, gross_loss=500, currency="PKR"),
        m.RiskIncident(tenant_id=1, title="FX slip", incident_date=THIS_Q, gross_loss=200, currency="USD"),
        m.RiskIncident(tenant_id=1, title="ATM", incident_date=LAST_Q, gross_loss=300, currency="PKR"),
    ])
    add_risk_action(db, over, PREPARER, title="Patch the ledger", due_date=NOW - timedelta(days=45))
    db.add_all([
        m.RiskScenario(tenant_id=1, title="Core banking outage", currency="PKR", status="approved", approved_by=CHECKER,
                       approved_at=NOW, result={"mean": 1000.0, "one_in_20": 5000.0, "one_in_100": 9000.0}),
        m.RiskScenario(tenant_id=1, title="Still a draft", currency="PKR", status="draft"),
    ])
    db.commit()


def build(http, **body):
    got = http.post("/erm/reports/generate", json={"report_type": "committee_pack", "title": "BRC Q4 pack", **body})
    assert got.status_code == 201, got.text
    return got.json()["id"]


def sections(pack):
    return {s["key"]: s for s in pack["sections"]}


def test_a_pack_is_built_from_live_data_and_keeps_its_snapshot(db):
    live_data(db)
    http = client(db)
    pack_id = build(http, meeting_id=1)
    pack = http.get(f"/erm/reports/packs/{pack_id}").json()
    assert pack["status"] == "draft" and pack["committee_name"] == "Board Risk Committee" and pack["meeting_title"] == "BRC Q4"
    assert [s["key"] for s in pack["sections"]] == ["appetite", "top_risks", "red_kris", "losses", "overdue_actions",
                                                   "acceptances", "reviews", "scenarios"]
    got = sections(pack)
    assert got["scenarios"]["rows"] == [["Core banking outage", "PKR", 5000.0, 9000.0, NOW.date().isoformat()]]
    appetite = {r[0]: r for r in got["appetite"]["rows"]}
    assert appetite["Operational"][-1] == "Outside appetite" and appetite["Compliance"][-1] == "Within appetite"
    top = got["top_risks"]["rows"][0]
    assert top[0] == "Ledger outage" and top[3] == 16 and top[4] == "Up from 12"
    assert [r[0] for r in got["red_kris"]["rows"]] == ["Failed payments"]
    assert [r[0] for r in got["overdue_actions"]["rows"]] == ["Patch the ledger"]
    assert got["overdue_actions"]["rows"][0][3] == 45
    assert [r[0] for r in got["acceptances"]["rows"]] == ["Legacy core"]
    assert [r[0] for r in got["reviews"]["rows"]] == ["Late filing"]
    # every section starts with a plain draft commentary from its numbers
    assert all(pack["commentary"][key] for key in got)
    assert "1 of 2" in pack["commentary"]["appetite"]
    stored = db.get(m.RiskReport, pack_id)
    assert stored.report_type == "committee_pack" and stored.committee_id == 1 and stored.report_data["sections"]
    listed = http.get("/erm/reports/packs").json()
    assert [(p["id"], p["status"], p["committee_name"]) for p in listed] == [(pack_id, "draft", "Board Risk Committee")]


def test_a_meeting_of_another_tenant_is_refused_and_a_viewer_cannot_build(db):
    http = client(db)
    got = http.post("/erm/reports/generate", json={"report_type": "committee_pack", "title": "x", "meeting_id": 2})
    assert got.status_code == 404
    assert client(db, "viewer").post("/erm/reports/generate", json={"report_type": "committee_pack", "title": "x"}).status_code == 403


def test_net_loss_is_grouped_per_currency_this_quarter_against_last(db):
    live_data(db)
    http = client(db)
    losses = sections(http.get(f"/erm/reports/packs/{build(http)}").json())["losses"]
    assert losses["rows"] == [["PKR", 1500.0, 300.0], ["USD", 200.0, 0.0]]
    assert "PKR 1,500.00" in http.get(f"/erm/reports/packs/{build(http)}").json()["commentary"]["losses"]
    # the board summary reports the same figures per currency, never a sum of the old free-text financial impact
    incidents = http.get("/erm/reports/board-summary").json()["incidents_summary"]
    assert "total_financial_impact" not in incidents
    assert incidents["net_loss_this_quarter"] == [{"currency": "PKR", "net_loss": 1500.0}, {"currency": "USD", "net_loss": 200.0}]
    assert incidents["net_loss_last_quarter"] == [{"currency": "PKR", "net_loss": 300.0}]


def test_commentary_is_edited_per_section_while_the_pack_is_not_frozen(db):
    live_data(db)
    http = client(db)
    pack_id = build(http)
    drafted = http.get(f"/erm/reports/packs/{pack_id}").json()["commentary"]
    got = http.put(f"/erm/reports/packs/{pack_id}", json={"commentary": {"losses": "Card fraud drove the quarter."}})
    assert got.status_code == 200, got.text
    assert got.json()["commentary"] == {**drafted, "losses": "Card fraud drove the quarter."}
    assert http.put(f"/erm/reports/packs/{pack_id}", json={"commentary": {"nonsense": "x"}}).status_code == 422
    assert http.post(f"/erm/reports/packs/{pack_id}/ready").json()["status"] == "ready"
    # still editable when ready
    assert http.put(f"/erm/reports/packs/{pack_id}", json={"commentary": {"reviews": "One late."}}).status_code == 200


def test_the_preparer_cannot_freeze_and_a_second_person_can(db):
    live_data(db)
    http, checker = client(db), client(db, "checker")
    pack_id = build(http)
    assert checker.post(f"/erm/reports/packs/{pack_id}/freeze").status_code == 409        # a draft is not ready yet
    http.post(f"/erm/reports/packs/{pack_id}/ready")
    assert http.get(f"/erm/reports/packs/{pack_id}").json()["can_freeze"] is False
    refused = http.post(f"/erm/reports/packs/{pack_id}/freeze")
    assert refused.status_code == 409 and "someone else" in refused.json()["detail"]
    assert checker.get(f"/erm/reports/packs/{pack_id}").json()["can_freeze"] is True
    frozen = checker.post(f"/erm/reports/packs/{pack_id}/freeze")
    assert frozen.status_code == 200, frozen.text
    body = frozen.json()
    assert body["status"] == "frozen" and body["approved_by"] == CHECKER and body["approved_by_name"] == "Checker"
    assert body["approved_at"] and body["can_freeze"] is False


def frozen_pack(db, **body):
    live_data(db)
    http = client(db)
    pack_id = build(http, **body)
    http.post(f"/erm/reports/packs/{pack_id}/ready")
    assert client(db, "checker").post(f"/erm/reports/packs/{pack_id}/freeze").status_code == 200
    return http, pack_id


def test_a_frozen_pack_refuses_edits_and_does_not_change_when_the_data_does(db):
    http, pack_id = frozen_pack(db)
    before = http.get(f"/erm/reports/packs/{pack_id}").json()
    db.get(m.Risk, 1).residual_score = 4
    db.add(m.RiskIncident(tenant_id=1, title="New loss", incident_date=THIS_Q, gross_loss=7777, currency="EUR"))
    db.commit()
    after = http.get(f"/erm/reports/packs/{pack_id}").json()
    assert after["sections"] == before["sections"] and after["commentary"] == before["commentary"]
    assert http.put(f"/erm/reports/packs/{pack_id}", json={"commentary": {"losses": "x"}}).status_code == 409
    assert http.put(f"/erm/reports/packs/{pack_id}", json={"meeting_id": 1}).status_code == 409
    assert http.post(f"/erm/reports/packs/{pack_id}/ready").status_code == 409
    assert client(db, "checker").post(f"/erm/reports/packs/{pack_id}/freeze").status_code == 409


def test_a_frozen_pack_exports_as_pdf_and_excel_and_a_draft_does_not(db):
    http, pack_id = frozen_pack(db)
    pdf = http.get(f"/erm/reports/packs/{pack_id}/export", params={"format": "pdf"})
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf" and pdf.content.startswith(b"%PDF")
    assert "attachment" in pdf.headers["content-disposition"]
    xlsx = http.get(f"/erm/reports/packs/{pack_id}/export", params={"format": "xlsx"})
    assert xlsx.status_code == 200
    book = load_workbook(io.BytesIO(xlsx.content))
    assert book.sheetnames[0] == "Pack" and "Net loss" in book.sheetnames
    assert [c.value for c in book["Net loss"][4]] == ["Currency", "This quarter", "Last quarter"]
    assert http.get(f"/erm/reports/packs/{pack_id}/export", params={"format": "docx"}).status_code == 422
    draft = build(http)
    assert http.get(f"/erm/reports/packs/{draft}/export", params={"format": "pdf"}).status_code == 409


def test_freezing_attaches_the_pack_to_its_committee_meeting(db, papers):
    http, pack_id = frozen_pack(db, meeting_id=1)
    [paper] = db.query(m.MeetingAttachment).filter_by(meeting_id=1).all()
    assert paper.tenant_id == 1 and paper.file_type == "pdf" and paper.file_name == "BRC Q4 pack.pdf"
    assert paper.uploaded_by == CHECKER and f"#{pack_id}" in paper.description
    with open(paper.file_path, "rb") as f:
        assert f.read(4) == b"%PDF"
    assert str(papers) in paper.file_path
    # a pack with no meeting is frozen without a paper
    _, other = frozen_pack_without_meeting(db)
    assert db.query(m.MeetingAttachment).count() == 1 and db.get(m.RiskReport, other).status == "frozen"


def frozen_pack_without_meeting(db):
    http = client(db)
    pack_id = build(http)
    http.post(f"/erm/reports/packs/{pack_id}/ready")
    client(db, "checker").post(f"/erm/reports/packs/{pack_id}/freeze")
    return http, pack_id


def test_the_old_report_types_still_generate(db):
    live_data(db)
    got = client(db).post("/erm/reports/generate", json={"report_type": "board_summary", "title": "Board"})
    assert got.status_code == 201 and got.json()["status"] == "generated" and got.json()["report_data"]["total_risks"] == 3
