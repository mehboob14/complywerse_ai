"""The endpoints behind Cybersecurity Assurance > Performance, AI Pentest and Reports answer only people who hold the matching
right; an administrator holds every one. A role with only Governance > Policies & Documents > view and Task Management > view
(cfsb's "Demo staff") is refused everywhere here. Over HTTP with real tokens and the real permission check, on in-memory SQLite."""
import os

os.environ.setdefault("SESSION_SECRET", "unit-test-secret")

import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import grc.models as m  # noqa: E402
from grc.modules.asset_discovery.router import router as discovery  # noqa: E402
from grc.modules.exec_dashboard.router import router as exec_dashboard  # noqa: E402
from grc.modules.pentest.router import router as pentest  # noqa: E402
from grc.modules.risk_posture.router import router as risk_posture  # noqa: E402
from grc.routers.auth_router import create_access_token  # noqa: E402
from grc.routers.reporting_router import router as reporting  # noqa: E402

STAFF, ADMIN, VULNS, ASSETS, RISKS, REPORTS, DASHBOARDS, ANALYTICS = range(1, 9)
RIGHTS = {
    STAFF: ["governance:policies:view", "critical_tasks:tasks:view"],
    VULNS: ["vulnerabilities:vulnerability_register:view"],
    ASSETS: ["assets:asset_inventory:view"],
    RISKS: ["erm:risks:view"],
    REPORTS: ["reports:reports:view"],
    DASHBOARDS: ["reports:dashboards:view"],
    ANALYTICS: ["reports:analytics:view"],
}
HOLDERS = set(RIGHTS) - {STAFF}

# every guarded read the pages make, and whose right (besides an administrator's) opens it
READS = [
    ("/exec-dashboard/summary", {VULNS}),
    ("/pentest/fleet", {VULNS}),
    ("/pentest/assessments", {VULNS}),
    ("/pentest/attack-paths", {VULNS}),
    ("/risk-posture/dashboard", {RISKS, ASSETS, VULNS}),
    ("/discovery/easm-scorecard", {ASSETS}),
    ("/discovery/discovered-devices", {ASSETS}),
    ("/reporting/reports", {REPORTS, DASHBOARDS}),
    ("/reporting/reports?kind=dashboard", {REPORTS, DASHBOARDS}),
    ("/reporting/metabase/status", {ANALYTICS}),
]
# writes are refused before anything runs: nothing is scanned, exploited, stored or saved
WRITES = [
    ("post", "/pentest/exploit/1", {"json": {"finding": {"id": 1}, "approved": True}}),
    ("post", "/pentest/scan/1", {}),
    ("post", "/pentest/credential/1", {"json": {"kind": "ssh", "username": "u", "secret": "s"}}),
    ("post", "/pentest/adhoc-target", {"json": {"target": "example.test", "authorized": True}}),
    ("post", "/reporting/reports", {"json": {"slug": "mine", "name": "Mine"}}),
    ("delete", "/reporting/reports/mine", {}),
    ("post", "/reporting/metabase/sso", {"json": {}}),
    ("post", "/reporting/metabase/ensure-views", {}),
    ("post", "/reporting/trends/snapshot", {}),
]


@pytest.fixture
def w(tmp_path, monkeypatch):
    monkeypatch.setenv("PENTEST_REPORTS_DIR", str(tmp_path))          # no engine reports: the reads answer empty
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add(m.Tenant(id=1, name="Acme", slug="acme", primary_contact_email="boss@acme.test"))
    db.add(m.Role(id=ADMIN, tenant_id=1, name="Administrator"))
    names = sorted({n for ns in RIGHTS.values() for n in ns})
    for pid, name in enumerate(names, start=1):
        db.add(m.Permission(id=pid, name=name, resource=name.rsplit(":", 1)[0], action="view"))
    for uid in [ADMIN, *RIGHTS]:
        db.add(m.GRCUser(id=uid, username=f"u{uid}", email=f"u{uid}@acme.test", display_name=f"User {uid}"))
        if uid != ADMIN:
            db.add(m.Role(id=uid, tenant_id=1, name=f"Role {uid}"))
            for name in RIGHTS[uid]:
                db.add(m.RolePermission(role_id=uid, permission_id=names.index(name) + 1))
        db.add(m.UserRole(user_id=uid, role_id=uid, tenant_id=1))
    db.commit()
    app = FastAPI()
    for router in (exec_dashboard, pentest, risk_posture, discovery, reporting):
        app.include_router(router)
    app.dependency_overrides[m.get_db] = lambda: db
    http = TestClient(app)

    def as_(uid):
        token = create_access_token({"sub": f"u{uid}", "tenant_slug": "acme", "tenant_id": 1})
        http.headers["Authorization"] = f"Bearer {token}"
        return http

    yield db, as_
    db.close()


@pytest.mark.parametrize("path,opened_by", READS)
def test_each_read_answers_its_own_right_and_an_administrator_only(w, path, opened_by):
    db, as_ = w
    r = as_(STAFF).get(path)
    assert (r.status_code, r.json()["detail"]) == (403, "Permission denied"), r.text
    assert as_(ADMIN).get(path).status_code == 200
    for uid in HOLDERS:
        assert as_(uid).get(path).status_code == (200 if uid in opened_by else 403), (uid, RIGHTS[uid])


@pytest.mark.parametrize("method,path,kw", WRITES)
def test_the_writes_refuse_someone_without_the_right(w, method, path, kw):
    db, as_ = w
    for uid in (STAFF, ASSETS, RISKS):
        r = getattr(as_(uid), method)(path, **kw)
        assert (r.status_code, r.json()["detail"]) == (403, "Permission denied"), (uid, r.text)
    assert db.query(m.ReportDefinition).count() == 0


def test_saved_reports_stay_the_reports_and_dashboards_rights(w):
    db, as_ = w
    for uid in (REPORTS, DASHBOARDS, ADMIN):
        http = as_(uid)
        saved = http.post("/reporting/reports", json={"slug": f"s{uid}", "name": "Open risks", "dataset": "risks"})
        assert saved.status_code == 200, saved.text
        assert http.get(f"/reporting/reports/s{uid}").json()["name"] == "Open risks"
        assert http.delete(f"/reporting/reports/s{uid}").json() == {"deleted": f"s{uid}"}
    assert as_(ANALYTICS).get("/reporting/reports").status_code == 403         # Analytics alone is Metabase only
