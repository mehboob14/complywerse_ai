"""Administrators and permissions come only from roles the platform gave - by hand (source NULL) or by an SSO group mapping - and
the organisation's primary contact. An access-review connector imports a connected app's groups by reusing the platform's role row
of the same name ("Administrator"), with its provider as the source: such a link makes nobody an admin and carries none of that
role's permissions. A deactivated user has neither. Every check routes through auth_router (is_tenant_admin, has_tenant_permission).
In-memory SQLite."""
import importlib
import os

os.environ.setdefault("SESSION_SECRET", "unit-test-secret")

from types import SimpleNamespace  # noqa: E402

import pytest  # noqa: E402
from fastapi import Depends, FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import grc.models as m  # noqa: E402
from grc.modules.governance import permissions  # noqa: E402
from grc.modules.vendor_risk.tpra import rbac, tier_policy  # noqa: E402
from grc.routers.admin_router import check_permission, get_tenant_db, router as admin_routes  # noqa: E402
from grc.routers.auth_router import create_access_token, is_tenant_admin, require_tenant_permission, router as auth_routes  # noqa: E402

# `from grc.routers import x` gives the APIRouter, not the module (PITFALLS 46)
reporting = importlib.import_module("grc.routers.reporting_router")
exceptions = importlib.import_module("grc.routers.policy_exception_router")
statements = importlib.import_module("grc.modules.compliance.routers.statements")
workbench = importlib.import_module("grc.modules.control_library.routers.workbench")
regulatory = importlib.import_module("grc.modules.governance.routers.regulatory_changes")
doc_workflow = importlib.import_module("grc.modules.governance.routers.document_workflow")
onboarding = importlib.import_module("grc.modules.vendor_risk.tpra.onboarding")
posture = importlib.import_module("grc.modules.risk_posture.router")
handlers = importlib.import_module("grc.modules.workflow_engine.services.action_handlers")

MANUAL, SSO, CONTACT, CONN_ADMIN, CONN_PERM, HOLDER, GONE, MIXED = range(1, 9)
ADMIN, APPROVERS, AUDITORS = 10, 11, 12
PUBLISH, VENDORS = "governance:policies:publish", "vendor_risk:vendors:edit"


@pytest.fixture
def w():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add(m.Tenant(id=1, name="Acme", slug="acme", primary_contact_email="Boss@Acme.test"))
    for uid, name in [(MANUAL, "manual"), (SSO, "sso"), (CONTACT, "boss"), (CONN_ADMIN, "sfadmin"), (CONN_PERM, "iga"),
                      (HOLDER, "holder"), (GONE, "gone"), (MIXED, "mixed")]:
        db.add(m.GRCUser(id=uid, username=name, email=f"{name}@acme.test", display_name=name.title(), is_active=uid != GONE))
    for rid, name in [(ADMIN, "Administrator"), (APPROVERS, "Approvers"), (AUDITORS, "Auditors")]:
        db.add(m.Role(id=rid, tenant_id=1, name=name))
    for pid, name in [(1, PUBLISH), (2, VENDORS)]:
        db.add(m.Permission(id=pid, name=name, resource=name.rsplit(":", 1)[0], action=name.rsplit(":", 1)[1]))
        db.add(m.RolePermission(role_id=APPROVERS, permission_id=pid))
    for uid, rid, source in [(MANUAL, ADMIN, None), (SSO, ADMIN, "sso"), (CONN_ADMIN, ADMIN, "app:salesforce"),
                             (CONN_PERM, APPROVERS, "iga:sailpoint"), (HOLDER, APPROVERS, None), (GONE, ADMIN, None),
                             (MIXED, APPROVERS, None), (MIXED, AUDITORS, "sso"), (MIXED, ADMIN, "app:salesforce")]:
        db.add(m.UserRole(user_id=uid, role_id=rid, tenant_id=1, source=source))
    db.commit()

    app = FastAPI()

    @app.get("/guarded", dependencies=[Depends(require_tenant_permission(PUBLISH))])
    def guarded():
        return {"ok": True}

    app.include_router(auth_routes)
    app.include_router(admin_routes)
    app.dependency_overrides[m.get_db] = lambda: db
    app.dependency_overrides[get_tenant_db] = lambda: db
    http = TestClient(app)

    def as_(uid):
        token = create_access_token({"sub": db.get(m.GRCUser, uid).username, "tenant_slug": "acme", "tenant_id": 1})
        http.headers["Authorization"] = f"Bearer {token}"
        return http

    yield SimpleNamespace(db=db, as_=as_, user=lambda uid: db.get(m.GRCUser, uid))
    db.close()


def test_admins_are_the_primary_contact_and_platform_given_administrators_only(w):
    expected = {MANUAL: True, SSO: True, CONTACT: True, CONN_ADMIN: False, CONN_PERM: False, HOLDER: False, GONE: False, MIXED: False}
    for uid, admin in expected.items():
        u = w.user(uid)
        assert is_tenant_admin(w.db, u) is admin, uid
        assert permissions.is_admin(w.db, u) is admin, uid
        assert rbac._is_admin_or_primary(w.db, u) is admin, uid
        assert statements._is_admin(w.db, u) is admin, uid
        assert workbench._is_admin(w.db, u) is admin, uid
        assert exceptions._is_tenant_administrator(u, w.db) is admin, uid
    assert permissions.admin_user_ids(w.db) == {MANUAL, SSO, CONTACT}
    assert not regulatory.check_user_has_admin_access(w.user(CONN_ADMIN), 1, w.db)       # its own name list, imported links ignored
    assert regulatory.check_user_has_admin_access(w.user(MANUAL), 1, w.db)


def test_a_connector_link_to_a_role_carries_none_of_its_permissions(w):
    for uid, allowed in [(HOLDER, True), (MANUAL, True), (SSO, True), (CONTACT, True), (CONN_PERM, False), (CONN_ADMIN, False)]:
        u = w.user(uid)
        assert (w.as_(uid).get("/guarded").status_code == 200) is allowed, uid
        assert check_permission(u, w.db, PUBLISH) is allowed, uid
        assert permissions.can_publish(w.db, u) is allowed, uid
        assert rbac.user_has_any_permission(w.db, u, [VENDORS]) is allowed, uid
    assert reporting._user_perm_names(w.user(HOLDER), w.db) == {PUBLISH, VENDORS}
    assert reporting._user_perm_names(w.user(CONN_PERM), w.db) == set()
    assert reporting._user_perm_names(w.user(CONN_ADMIN), w.db) == set()
    assert reporting._user_perm_names(w.user(SSO), w.db) == {"*:*:*"}


def test_role_memberships_ignore_connector_links(w):
    conn, holder = w.user(CONN_PERM), w.user(HOLDER)
    assert doc_workflow.get_user_role_ids(conn, w.db) == [] and doc_workflow.get_user_role_ids(holder, w.db) == [APPROVERS]
    assert onboarding._roles(w.db, conn) == [] and onboarding._roles(w.db, holder) == ["Approvers"]
    policy = tier_policy.merged({"critical": {"approver_role": "Approvers"}})
    assert "Approvers role" in tier_policy.approver_problem(w.db, conn, "critical", policy)
    assert tier_policy.approver_problem(w.db, holder, "critical", policy) is None
    assert posture._is_owner_scoped(w.user(CONN_ADMIN), 1, w.db) and not posture._is_owner_scoped(w.user(MANUAL), 1, w.db)
    assert sorted(handlers._emails_for_role_ids(w.db, 1, [APPROVERS])) == ["holder@acme.test", "mixed@acme.test"]


def test_the_people_a_role_asks_to_sign_attest_or_act_are_the_platform_given_holders(w):
    from grc.modules.governance.routers.document_signoff import _resolve_target_users
    from grc.modules.workflow_engine.services.notification_service import resolve_user_ids_from_roles
    from grc.modules.workflow_engine.services.step_executor import StepExecutor

    holders = {HOLDER, MIXED}                                         # CONN_PERM's link to Approvers was imported by a connector
    assert _resolve_target_users(w.db, [1], "role", APPROVERS) == holders
    assert set(resolve_user_ids_from_roles(w.db, 1, [APPROVERS])) == holders
    assert set(StepExecutor._resolve_role_user_ids(w.db, 1, [APPROVERS])) == holders


def test_auth_me_shows_only_what_the_platform_gave(w):
    me = w.as_(CONN_ADMIN).get("/auth/me").json()["user"]
    assert me["is_admin"] is False and me["permissions"] == [] and me["roles"] == []
    me = w.as_(CONN_PERM).get("/auth/me").json()["user"]
    assert me["is_admin"] is False and me["permissions"] == [] and me["roles"] == []
    me = w.as_(HOLDER).get("/auth/me").json()["user"]
    assert me["permissions"] == sorted([PUBLISH, VENDORS]) and me["roles"] == [{"id": APPROVERS, "name": "Approvers"}]
    me = w.as_(SSO).get("/auth/me").json()["user"]
    assert me["is_admin"] is True and me["permissions"] == ["*:*:*"]


def test_a_deactivated_administrator_has_no_rights_with_a_live_token(w):
    gone = w.user(GONE)
    http = w.as_(GONE)
    r = http.get("/guarded")
    assert r.status_code == 403 and r.json()["detail"] == "User account is deactivated"
    me = http.get("/auth/me").json()["user"]
    assert me["is_admin"] is False and me["permissions"] == []
    assert http.get("/admin/users").status_code == 403
    assert not check_permission(gone, w.db, PUBLISH) and not permissions.can_publish(w.db, gone)
    w.user(CONTACT).is_active = False                                                   # the primary contact too
    w.db.commit()
    assert not is_tenant_admin(w.db, w.user(CONTACT)) and permissions.admin_user_ids(w.db) == {MANUAL, SSO}


def test_saving_a_user_with_the_roles_the_users_page_shows_keeps_sso_and_connector_links(w):
    http = w.as_(MANUAL)
    listed = next(u for u in http.get("/admin/users").json() if u["id"] == MIXED)
    assert {r["name"] for r in listed["roles"]} == {"Approvers", "Auditors"}             # not the imported "Administrator"
    assert http.get(f"/admin/users/{MIXED}").json()["roles"] == listed["roles"]
    r = http.put(f"/admin/users/{MIXED}", json={"display_name": "Mixed Person", "role_ids": [r["id"] for r in listed["roles"]]})
    assert r.status_code == 200
    w.db.expire_all()
    rows = {(ur.role_id, ur.source) for ur in w.db.query(m.UserRole).filter(m.UserRole.user_id == MIXED)}
    assert rows == {(APPROVERS, None), (AUDITORS, "sso"), (ADMIN, "app:salesforce")}
    assert not is_tenant_admin(w.db, w.user(MIXED))
    roles = {r["name"]: r["user_count"] for r in http.get("/admin/roles").json()}
    assert roles["Administrator"] == 3                                                   # manual, sso and the deactivated one


def test_a_role_held_by_hand_and_through_sso_stays_a_manual_grant_and_unticking_a_role_takes_it_away(w):
    db, http = w.db, w.as_(MANUAL)
    db.add(m.UserRole(user_id=HOLDER, role_id=APPROVERS, tenant_id=1, source="sso"))     # the same role by hand and by SSO
    db.commit()
    assert http.put(f"/admin/users/{HOLDER}", json={"display_name": "Holder", "role_ids": [APPROVERS]}).status_code == 200
    db.expire_all()
    rows = sorted((ur.role_id, ur.source or "") for ur in db.query(m.UserRole).filter(m.UserRole.user_id == HOLDER))
    assert rows == [(APPROVERS, ""), (APPROVERS, "sso")]                       # the manual link survives an edit of the name
    assert http.put(f"/admin/users/{SSO}", json={"role_ids": []}).status_code == 200      # untick the SSO-given Administrator
    db.expire_all()
    assert not is_tenant_admin(db, w.user(SSO))                                # gone until the next SSO sign-in maps it again
    assert http.put(f"/admin/users/{MIXED}", json={"role_ids": []}).status_code == 200
    db.expire_all()
    assert {(ur.role_id, ur.source) for ur in db.query(m.UserRole).filter(m.UserRole.user_id == MIXED)} == {(ADMIN, "app:salesforce")}


def test_a_role_only_a_connector_gave_cannot_be_deleted_from_the_roles_page_and_says_why(w):
    db, http = w.db, w.as_(MANUAL)
    db.add(m.Role(id=50, tenant_id=1, name="Salesforce: Approver"))
    db.add(m.UserRole(user_id=HOLDER, role_id=50, tenant_id=1, source="app:salesforce"))
    db.commit()
    assert {r["name"]: r["user_count"] for r in http.get("/admin/roles").json()}["Salesforce: Approver"] == 0
    r = http.delete("/admin/roles/50")
    assert r.status_code == 400 and "Access Reviews" in r.json()["detail"] and db.get(m.Role, 50) is not None
