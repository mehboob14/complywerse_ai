"""The Vendors register's complete load (UX revamp, vendor-register, 2026-11-10): GET /vendor-risk/vendors?lean=1.

The register reads the whole filtered list once (facet counts, the Board by lifecycle stage and the details drawer all come from it), so a row is
the fields a table shows plus `lifecycle`: General's active assessment (stage, residual, open findings), or null when none was started. Without
`lean` nothing changes. In-memory SQLite.
"""
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import Base, GRCUser, Role, TPRAFinding, Tenant, UserRole, Vendor, VendorAssessment, get_db
from grc.modules.vendor_risk.routers import vendors as vendor_routes
from grc.routers.auth_router import require_auth

NOW = datetime.utcnow()


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme Bank", slug="acme"))
    s.add(Role(id=1, name="Administrator"))
    s.add(GRCUser(id=1, username="admin", display_name="Admin", email="a@acme.test", is_active=True))
    s.add(UserRole(user_id=1, role_id=1, tenant_id=1))
    s.commit()
    yield s
    s.close()


def client(db):
    app = FastAPI()
    app.include_router(vendor_routes.router, prefix="/vendor-risk")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 1)
    return TestClient(app)


def _vendor(db, name, **kw):
    v = Vendor(**{"tenant_id": 1, "name": name, "tier": "medium", "status": "active", **kw})
    db.add(v)
    db.commit()
    return v


def _assessment(db, v, stage="questionnaire", version=1, engagement_id=None, status="active", **kw):
    a = VendorAssessment(tenant_id=1, vendor_id=v.id, status="in_progress", lifecycle_status=status, current_stage=stage,
                         version_no=version, engagement_id=engagement_id, **kw)
    db.add(a)
    db.commit()
    return a


def _finding(db, v, a, severity, status="open", deleted=False):
    db.add(TPRAFinding(tenant_id=1, vendor_id=v.id, assessment_id=a.id, severity=severity, status=status,
                       deleted_at=NOW if deleted else None))
    db.commit()


@pytest.fixture()
def register(db):
    started = _vendor(db, "Alpha", description="long text " * 50, notes="more", tags=["a"], systems_in_scope=["x"],
                      primary_contact_email="c@alpha.test", inherent_risk_score=60.0, tier="high")
    plain = _vendor(db, "Bravo")
    other = _vendor(db, "Charlie", inherent_risk_score=20.0, tier="low")
    _vendor(db, "Archived", deleted_at=NOW)
    _vendor(db, "Draft", intake_status="draft", status="requested")
    old = _assessment(db, started, stage="tiering", version=1)
    new = _assessment(db, started, stage="findings", version=2, residual_rating="high", residual_score=62.5)
    _assessment(db, started, stage="approval", version=3, engagement_id=99)            # an engagement's own lifecycle: not General's
    _assessment(db, started, stage="monitoring", version=4, status="superseded")      # no longer active
    _finding(db, started, new, "critical")
    _finding(db, started, new, "high", status="in_remediation")
    _finding(db, started, new, "critical", status="closed")                             # closed: not counted
    _finding(db, started, new, "critical", deleted=True)                                # removed: not counted
    _finding(db, started, old, "critical")                                              # another version's finding: not counted
    return {"started": started, "plain": plain, "other": other}


def by_name(response):
    assert response.status_code == 200, response.text
    return {r["name"]: r for r in response.json()["items"]}


def test_a_lean_row_has_what_a_table_shows_and_leaves_the_long_text_and_lists_out(db, register):
    row = by_name(client(db).get("/vendor-risk/vendors?lean=1&limit=5000"))["Alpha"]
    for gone in ("description", "notes", "tags", "systems_in_scope", "primary_contact_email", "lifecycle_history", "custom_values", "services_provided"):
        assert gone not in row, gone
    for kept in ("id", "name", "tier", "status", "vendor_type", "website", "inherent_risk_score", "owner_id", "business_unit",
                 "data_classification", "holds_personal_data", "next_reassessment_date", "contract_end_date", "contract_value",
                 "archived_at", "next_action", "grade", "open_engagements", "lifecycle"):
        assert kept in row, kept


def test_a_lean_list_has_the_same_vendors_order_and_total_as_the_full_one(db, register):
    full = client(db).get("/vendor-risk/vendors?sort=risk&limit=5000").json()
    lean = client(db).get("/vendor-risk/vendors?sort=risk&limit=5000&lean=1").json()
    assert [r["id"] for r in lean["items"]] == [r["id"] for r in full["items"]]
    assert (lean["total"], lean["skip"], lean["limit"]) == (full["total"], full["skip"], full["limit"]) == (3, 0, 5000)
    assert "lifecycle" not in full["items"][0]                                          # the full list is as it was
    assert full["items"][0]["description"] is not None or "description" in full["items"][0]


def test_lifecycle_is_generals_highest_active_version_with_its_open_findings(db, register):
    rows = by_name(client(db).get("/vendor-risk/vendors?lean=1"))
    assert rows["Alpha"]["lifecycle"] == {
        "assessment_id": rows["Alpha"]["lifecycle"]["assessment_id"], "stage": "findings", "version_no": 2,
        "residual_rating": "high", "residual_score": 62.5, "open_findings": 2, "open_critical": 1,
    }
    assert rows["Bravo"]["lifecycle"] is None and rows["Charlie"]["lifecycle"] is None   # not started: null, never a made-up stage


def test_the_lean_list_is_the_board_the_old_page_drew(db, register):
    """The same stage, residual and open findings per vendor as GET /tpra/board gave."""
    from grc.modules.vendor_risk.tpra import api as tpra_api
    board = {r["vendor_id"]: r for r in tpra_api.lifecycle_board(db, db.get(GRCUser, 1))["items"]}
    for row in client(db).get("/vendor-risk/vendors?lean=1").json()["items"]:
        b, life = board[row["id"]], row["lifecycle"]
        assert (b["has_assessment"], b["current_stage"], b["residual_rating"], b["open_findings"], b["open_critical"]) == (
            (True, life["stage"], life["residual_rating"], life["open_findings"], life["open_critical"]) if life else (False, None, None, 0, 0))


def test_lean_keeps_the_filters_the_archived_view_and_the_request_rules(db, register):
    assert sorted(by_name(client(db).get("/vendor-risk/vendors?lean=1&archived_only=true"))) == ["Archived"]
    assert sorted(by_name(client(db).get("/vendor-risk/vendors?lean=1&include_requests=true&include_archived=true"))) == ["Alpha", "Archived", "Bravo", "Charlie", "Draft"]
    assert sorted(by_name(client(db).get("/vendor-risk/vendors?lean=1&tier=high"))) == ["Alpha"]
    assert sorted(by_name(client(db).get("/vendor-risk/vendors?lean=1&attention=not_tiered"))) == ["Bravo"]


def test_an_empty_register_is_an_empty_lean_list(db):
    assert client(db).get("/vendor-risk/vendors?lean=1&limit=5000").json() == {"items": [], "total": 0, "skip": 0, "limit": 5000}
