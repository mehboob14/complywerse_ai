"""Wave 5 leftovers: the older /advanced-erm KRI routes follow the same rules as /erm/kris.

A threshold change on an active KRI is only proposed, a value waits for a checker, a new KRI starts as a draft, and a viewer
cannot write. In-memory SQLite; email is blocked by conftest.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import Base, GRCUser, Permission, Risk, RiskKRI, RiskKRIMeasurement, Role, RolePermission, Tenant, UserRole, get_db
from grc.routers.advanced_erm_router import router as advanced_router
from grc.routers.auth_router import create_access_token, require_auth

MAKER, CHECKER, VIEWER = 7, 8, 9


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add_all([Role(id=1, name="Administrator"), Role(id=2, name="Risk viewer")])
    s.add(Permission(id=1, name="erm:risks:view", resource="erm:risks", action="view"))
    s.add(RolePermission(role_id=2, permission_id=1))
    s.add_all([GRCUser(id=uid, username=n, display_name=n.title(), email=f"{n}@bank.test", is_active=True)
               for uid, n in ((MAKER, "maker"), (CHECKER, "checker"), (VIEWER, "viewer"))])
    s.add_all([UserRole(user_id=MAKER, role_id=1, tenant_id=1), UserRole(user_id=CHECKER, role_id=1, tenant_id=1),
               UserRole(user_id=VIEWER, role_id=2, tenant_id=1)])
    s.add(Risk(id=1, tenant_id=1, title="Patch backlog", category="technology", risk_category="technology"))
    s.commit()
    yield s
    s.close()


def client(db, username):
    app = FastAPI()
    app.include_router(advanced_router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(username=username).one()
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": username})
    return http


def active_kri(db):
    row = RiskKRI(tenant_id=1, risk_id=1, name="Overdue patches", green_threshold=1, amber_threshold=3,
                  threshold_direction="lower_is_better", frequency="monthly", is_active=True, status="active",
                  kind="kri", created_by=MAKER, current_value=2)
    db.add(row)
    db.commit()
    return row


def test_a_threshold_change_through_the_old_route_is_only_proposed(db):
    k = active_kri(db)
    res = client(db, "maker").put(f"/advanced-erm/kris/{k.id}", json={"green_threshold": 5, "amber_threshold": 9})
    assert res.status_code == 200, res.text
    db.expire_all()
    assert (k.green_threshold, k.amber_threshold) == (1, 3), "the approved thresholds stay in force"
    assert k.threshold_change and k.threshold_change["status"] == "pending"


def test_a_value_through_the_old_route_waits_for_a_checker(db):
    k = active_kri(db)
    res = client(db, "maker").post(f"/advanced-erm/kris/{k.id}/measure", json={"value": 40})
    assert res.status_code == 200, res.text
    db.expire_all()
    assert k.current_value == 2, "not published before someone else approves it"
    assert db.query(RiskKRIMeasurement).filter_by(kri_id=k.id).count() == 1


def test_a_kri_created_through_the_old_route_starts_as_a_draft(db):
    res = client(db, "maker").post("/advanced-erm/kris", json={
        "risk_id": 1, "name": "Failed logins", "green_threshold": 10, "amber_threshold": 50, "frequency": "monthly"})
    assert res.status_code == 201, res.text
    assert db.get(RiskKRI, res.json()["id"]).status == "draft"


def test_a_viewer_cannot_write_through_the_old_routes(db):
    k = active_kri(db)
    viewer = client(db, "viewer")
    assert viewer.put(f"/advanced-erm/kris/{k.id}", json={"name": "x"}).status_code == 403
    assert viewer.delete(f"/advanced-erm/kris/{k.id}").status_code == 403
    assert viewer.post("/advanced-erm/kris", json={"risk_id": 1, "name": "x"}).status_code == 403


# ── a limit added after an approved statement waits for a second person ──────
from grc.models import RiskAppetiteBreach, RiskAppetiteConfig  # noqa: E402
from grc.modules.erm.router import router as erm_router  # noqa: E402


def erm(db, username):
    app = FastAPI()
    app.include_router(erm_router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(username=username).one()
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": username})
    return http


def approved_statement(db):
    made = erm(db, "maker").post("/erm/appetite/statements", json={"statement": "We accept low technology risk."}).json()
    erm(db, "maker").post(f"/erm/appetite/statements/{made['id']}/submit")
    assert erm(db, "checker").post(f"/erm/appetite/statements/{made['id']}/approve", json={"note": "Board"}).status_code == 200


def test_a_new_limit_after_approval_is_not_in_force_until_someone_else_approves_it(db):
    db.query(Risk).filter_by(id=1).update({"residual_score": 16, "inherent_score": 20})
    db.commit()
    approved_statement(db)
    made = erm(db, "maker").post("/erm/appetite", json={"category": "technology", "tolerance_threshold": 10,
                                                        "max_acceptable_score": 12, "alert_enabled": True})
    assert made.status_code == 200, made.text
    config = db.get(RiskAppetiteConfig, made.json()["id"])
    assert config.limit_change["status"] == "pending" and config.limit_change["changes"].get("add")
    erm(db, "maker").post("/erm/appetite/check")
    assert db.query(RiskAppetiteBreach).count() == 0, "a proposed limit opens no breach"
    stats = erm(db, "maker").get("/erm/appetite/with-stats").json()
    row = next(r for r in (stats if isinstance(stats, list) else stats.get("configs", stats.get("items", []))) if r["category"] == "technology")
    assert row["limits_source"]["state"] == "proposed"

    assert erm(db, "maker").post(f"/erm/appetite/{config.id}/limit-change/approve", json={}).status_code == 409
    ok = erm(db, "checker").post(f"/erm/appetite/{config.id}/limit-change/approve", json={})
    assert ok.status_code == 200, ok.text
    db.expire_all()
    assert db.query(RiskAppetiteBreach).filter_by(category="technology").count() == 1, "in force once approved"


def test_a_refused_new_limit_is_removed_and_seeded_defaults_wait_too(db):
    approved_statement(db)
    made = erm(db, "maker").post("/erm/appetite", json={"category": "technology", "tolerance_threshold": 10,
                                                        "max_acceptable_score": 12}).json()
    sent_back = erm(db, "checker").post(f"/erm/appetite/{made['id']}/limit-change/reject", json={"note": "Not agreed by the board"})
    assert sent_back.status_code == 200, sent_back.text
    db.expire_all()
    assert db.get(RiskAppetiteConfig, made["id"]) is None, "a refused new limit is not kept"

    seeded = erm(db, "maker").post("/erm/appetite/seed-defaults")
    assert seeded.status_code == 200, seeded.text
    rows = db.query(RiskAppetiteConfig).all()
    assert rows and all((r.limit_change or {}).get("status") == "pending" for r in rows)


def test_the_workflow_step_resolve_kri_breach_writes_no_unchecked_reading(db):
    from types import SimpleNamespace
    from grc.modules.workflow_engine.services.action_handlers import WorkflowActionHandlers
    k = active_kri(db)
    out = WorkflowActionHandlers._resolve_kri_breach(db, SimpleNamespace(id=1, tenant_id=1), SimpleNamespace(id=1),
                                                     {"kri_id": k.id})
    db.commit()
    assert out["result"] == "noted"
    assert db.query(RiskKRIMeasurement).filter_by(kri_id=k.id).count() == 0, "no reading without a checker"


def test_a_risk_cannot_link_another_tenants_custom_control(db):
    from grc.models import NormalizedControl, RiskControl
    from grc.routers.risks_router import router as legacy_risks
    db.add(Tenant(id=2, name="Other bank", slug="other"))
    db.add_all([NormalizedControl(id=50, code="CUS-OTHER-1", name="Other bank's control", source="custom", tenant_id=2),
                NormalizedControl(id=51, code="SCF-GOV-01", name="Shared catalogue control", source="scf", tenant_id=None),
                NormalizedControl(id=52, code="CUS-OWN-1", name="Own control", source="custom", tenant_id=1)])
    db.commit()
    for router in (erm_router, legacy_risks):
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(username="maker").one()
        http = TestClient(app)
        http.headers["Authorization"] = "Bearer " + create_access_token({"sub": "maker"})
        prefix = "/erm/risks" if router is erm_router else "/risks"
        refused = http.post(f"{prefix}/1/controls", json={"normalized_control_id": 50})
        assert refused.status_code == 404, refused.text
        for ok_id in (51, 52):
            res = http.post(f"{prefix}/1/controls", json={"normalized_control_id": ok_id})
            assert res.status_code in (201, 400), res.text      # 400: already linked through the other router
    assert {r.control_id for r in db.query(RiskControl).filter_by(risk_id=1)} == {51, 52}
