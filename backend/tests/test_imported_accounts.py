"""Accounts an access-review connector imported (DigitalOcean, Okta, the Entra directory sync...) stay in Access Reviews: they are
not listed or picked as people, cannot be made an owner, signer or assignee, and cannot sign in (password, or SSO by email), while a
local user and an SSO-made Entra user still can. One rule decides it (auth_router.platform_account). A one-off fix gives documents
such an account owned to their author and ends the requests waiting on it, once per organisation. In-memory SQLite."""
import importlib
import os

os.environ.setdefault("SESSION_SECRET", "unit-test-secret")

from datetime import datetime  # noqa: E402
from types import SimpleNamespace  # noqa: E402

import bcrypt  # noqa: E402
import pytest  # noqa: E402
from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import grc.models as m  # noqa: E402
from grc.modules.governance import doc_lifecycle as life  # noqa: E402
from grc.modules.governance import imported_owners  # noqa: E402
from grc.modules.governance.router import router as governance_routes  # noqa: E402
from grc.routers.auth_router import is_platform_account, platform_account, require_auth  # noqa: E402

auth = importlib.import_module("grc.routers.auth_router")
sso = importlib.import_module("grc.routers.sso_router")

LOCAL, AUTHOR, CONTACT, SSO_NEW, ARIF, DIRECTORY, ADOPTED, OUTSIDER = range(1, 9)
ADMIN_ROLE, DO_ROLE, APPROVERS = 20, 21, 22
ARIF_NAME = "Arif Malik (DigitalOcean)"


def _hash(pw):
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(4)).decode()


@pytest.fixture
def w(monkeypatch):
    monkeypatch.setattr("grc.modules.governance.routers.documents._resolve_tenant_slug_for_autoparse", lambda tenant_id: None)  # never the real master database
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    db = factory()
    now = datetime.utcnow()
    db.add(m.Tenant(id=1, name="CFSB", slug="cfsb", primary_contact_email="Admin@CFSB.test"))
    for uid, name, extra in [
        (LOCAL, "Lena Local", {}),
        (AUTHOR, "Anna Author", {}),
        (CONTACT, "Cfsb Admin", {"email": "admin@cfsb.test"}),
        (SSO_NEW, "Sia Sso", {"external_provider": "entra_id", "external_id": "oid-sso"}),          # made by SSO provisioning
        (ARIF, ARIF_NAME, {"external_provider": "digitalocean", "external_id": "do:account:1", "access_synced_at": now}),
        (DIRECTORY, "Meeting Room", {"external_provider": "entra_id", "external_id": "oid-room", "access_synced_at": now}),
        (ADOPTED, "Ada Adopted", {"external_provider": "okta", "external_id": "okta:9", "access_synced_at": now}),   # added here first
        (OUTSIDER, "Otto Okta", {"external_provider": "okta", "external_id": "okta:7", "access_synced_at": now}),
    ]:
        first = name.split()[0].lower()
        db.add(m.GRCUser(id=uid, username=first, password_hash=_hash(f"pw-{first}"),
                         display_name=name, **{"email": f"{first}@cfsb.test", **extra}))
    for rid, role in [(ADMIN_ROLE, "Administrator"), (DO_ROLE, "DigitalOcean: team My Team"), (APPROVERS, "Approvers")]:
        db.add(m.Role(id=rid, tenant_id=1, name=role))
    db.add(m.UserRole(user_id=CONTACT, role_id=ADMIN_ROLE, tenant_id=1))
    db.add(m.UserRole(user_id=ARIF, role_id=DO_ROLE, tenant_id=1, source="digitalocean"))
    db.add(m.UserRole(user_id=ADOPTED, role_id=APPROVERS, tenant_id=1, assigned_by=CONTACT))      # an administrator gave it by hand
    for uid in (LOCAL, ARIF):
        db.add(m.UserRole(user_id=uid, role_id=APPROVERS, tenant_id=1))                          # a legacy link, by nobody
    db.add(m.Team(id=30, tenant_id=1, name="Security", lead_user_id=ARIF))
    db.add(m.TeamMember(team_id=30, user_id=LOCAL))
    db.add(m.TeamMember(team_id=30, user_id=ARIF))
    db.add(m.GovernanceDocument(id=3, tenant_id=1, title="Acceptable Use Policy", doc_type="policy", status="published",
                                current_version="1.2", content="# AUP\n", owner_id=ARIF, author_id=AUTHOR))
    db.add(m.GovernanceDocument(id=4, tenant_id=1, title="Cloud policy", doc_type="policy", status="draft",
                                current_version="1.0", content="# Cloud\n", owner_id=ARIF, author_id=OUTSIDER))
    db.add(m.GovernanceDocument(id=5, tenant_id=1, title="Access policy", doc_type="policy", status="draft",
                                current_version="1.0", content="# Access\n", owner_id=LOCAL, author_id=LOCAL))
    db.commit()

    app = FastAPI()
    app.include_router(governance_routes)
    me = {"id": CONTACT}
    app.dependency_overrides[m.get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(m.GRCUser, me["id"])
    yield SimpleNamespace(db=db, engine=engine, factory=factory, me=me, http=TestClient(app), user=lambda uid: db.get(m.GRCUser, uid))
    db.close()


PLATFORM = {LOCAL, AUTHOR, CONTACT, SSO_NEW, ADOPTED}


def test_one_rule_says_who_uses_the_platform(w):
    assert {uid for (uid,) in w.db.query(m.GRCUser.id).filter(platform_account())} == PLATFORM
    assert {uid for uid in range(1, 9) if is_platform_account(w.db, w.user(uid))} == PLATFORM
    assert set(life._people(w.db)) == PLATFORM                    # the document life cycle asks the same people
    w.user(OUTSIDER).last_login = datetime.utcnow()               # someone who signed in is a person, whatever imported them
    w.db.commit()
    assert is_platform_account(w.db, w.user(OUTSIDER))


def test_people_lists_and_pickers_leave_out_imported_accounts(w):
    db, me = w.db, w.user(CONTACT)
    tenants = importlib.import_module("grc.routers.tenants_router")
    assets = importlib.import_module("grc.routers.assets_router")
    tasks = importlib.import_module("grc.routers.critical_tasks_router")
    admin = importlib.import_module("grc.routers.admin_router")
    certs = importlib.import_module("grc.routers.certification_router")
    criticality = importlib.import_module("grc.routers.criticality_assessments_router")
    statements = importlib.import_module("grc.modules.compliance.routers.statements")
    rcsa = importlib.import_module("grc.modules.erm.routers.rcsa_custom")
    workbench = importlib.import_module("grc.modules.control_library.routers.workbench")
    onboarding = importlib.import_module("grc.modules.vendor_risk.tpra.onboarding")
    catalog = importlib.import_module("grc.modules.workflow_engine.routers.catalog")
    bcm = importlib.import_module("grc.modules.bcm.routers.dashboard")
    tpra = importlib.import_module("grc.modules.vendor_risk.tpra.api")
    editing = importlib.import_module("grc.modules.issue_management.audit_register.editing")

    def ids(rows):
        rows = [r.model_dump() if hasattr(r, "model_dump") else r for r in rows]
        return {r.get("user_id") or r.get("id") or r.get("value") for r in rows}

    active = PLATFORM                                                              # everyone in the fixture is active
    assert ids(tenants.list_tenant_users(tenant_id=1, db=db, current_user=me)) == active
    assert ids(assets.get_tenant_users(http_request=None, token=None, db=db, current_user=me)) == active
    assert ids(tasks.get_tenant_users(db=db, current_user=me)) == active
    assert ids(admin.list_users(user=me, tenant_db=db)) == active                  # the admin Users page
    assert ids(certs.list_certification_tenant_users(db=db, current_user=me)) == active
    assert ids(criticality.list_users_for_assignment(db=db, current_user=me)) == active
    assert ids(statements.list_tenant_users_for_assignment(db=db, current_user=me)) == active
    assert ids(rcsa.list_tenant_users_for_assignment(db=db, current_user=me, _perm=True)) == active
    assert ids(workbench.tenant_users(db=db, current_user=me)) == active
    assert ids(onboarding.people(db=db, user=me)) == active
    assert ids(catalog.list_actor_users(search=None, db=db, current_user=me, _=True)["users"]) == active
    assert ids(bcm.user_options(search=None, limit=100, db=db, current_user=me, _p=True)["items"]) == active
    assert ids(tpra.config_directory(db=db, user=me)["people"]) == active
    assert ids(editing.options(db, 1)["users"]) == active


def test_writes_refuse_an_imported_account_with_a_plain_message(w):
    http, db = w.http, w.db
    r = http.post("/governance/documents", json={"title": "New", "doc_type": "policy", "owner_id": ARIF})
    assert r.status_code == 400 and r.json()["detail"].startswith(f"{ARIF_NAME} is an account an access review imported")
    r = http.put("/governance/documents/5", json={"owner_id": ARIF})
    assert r.status_code == 400 and ARIF_NAME in r.json()["detail"]
    assert http.put("/governance/documents/5", json={"owner_id": AUTHOR}).status_code == 200
    r = http.post("/governance/documents/bulk-assign-owner", json={"document_ids": [5], "owner_id": ARIF})
    assert r.status_code == 400
    db.expire_all()
    assert db.get(m.GovernanceDocument, 5).owner_id == AUTHOR
    r = http.put("/governance/documents/5/signoff/participants", json={"reviewers": [{"target_type": "user", "target_id": ARIF}]})
    assert r.status_code == 400 and ARIF_NAME in r.json()["detail"]
    from grc.modules.governance.doc_details import check_details

    with pytest.raises(ValueError, match="access review imported"):
        check_details(db, owner_id=ARIF)                           # uploads and the AI Studio's moves to the library

    tasks = importlib.import_module("grc.routers.critical_tasks_router")
    for call in (lambda: tasks._validate_tenant_user(db, ARIF, [1]), lambda: tasks._normalize_assignee_list(db, [LOCAL, ARIF])):
        with pytest.raises(HTTPException) as e:
            call()
        assert e.value.status_code == 400 and ARIF_NAME in e.value.detail
    assert tasks._normalize_assignee_list(db, [LOCAL, ADOPTED]) == [LOCAL, ADOPTED]
    teams = importlib.import_module("grc.routers.teams_router")
    with pytest.raises(HTTPException) as e:
        teams.add_member(team_id=30, payload=teams.TeamMemberCreate(user_id=ARIF), db=db, current_user=w.user(CONTACT))
    assert e.value.status_code == 400


def test_an_imported_account_already_named_may_be_sent_back_but_roles_and_teams_never_ask_it(w):
    from grc.modules.governance.routers.document_signoff import _resolve_target_users

    db = w.db
    db.add(m.DocumentSignoffAssignment(tenant_id=1, document_id=5, role_type="prepared_by", target_type="user", target_id=ARIF))
    db.commit()
    body = {"prepared_by": [{"target_type": "user", "target_id": ARIF}],          # as the details dialog sends it back
            "reviewers": [{"target_type": "team", "target_id": 30}], "approvers": [{"target_type": "role", "target_id": APPROVERS}]}
    assert w.http.put("/governance/documents/5/signoff/participants", json=body).status_code == 200
    assert _resolve_target_users(db, [1], "team", 30) == {LOCAL}                  # not its imported member, nor its imported lead
    assert _resolve_target_users(db, [1], "role", APPROVERS) == {LOCAL, ADOPTED}


def _login(w, monkeypatch, username, password):
    monkeypatch.setattr(auth, "open_tenant_session", lambda slug: w.factory())
    app = FastAPI()
    app.include_router(auth.router)
    app.dependency_overrides[m.get_master_db] = lambda: w.db
    return TestClient(app).post("/auth/login", json={"username": username, "password": password}, headers={"X-Tenant-Slug": "cfsb"})


def test_an_imported_account_cannot_sign_in_with_a_password_and_a_local_user_still_can(w, monkeypatch):
    assert _login(w, monkeypatch, "lena@cfsb.test", "pw-lena").status_code == 200
    r = _login(w, monkeypatch, "arif@cfsb.test", "pw-arif")                       # even with a password somebody set
    assert r.status_code == 403 and "imported by an access review" in r.json()["detail"]
    w.db.expire_all()
    assert w.user(ARIF).last_login is None
    assert _login(w, monkeypatch, "ada@cfsb.test", "pw-ada").status_code == 200   # the person an administrator added first


def test_sso_never_adopts_an_imported_account_by_email_and_real_sso_users_still_sign_in(w):
    db = w.db
    cfg = SimpleNamespace(auto_provision_on_signin=True, allowed_email_domains=[])
    assert sso._upsert_user_from_claims(tenant_db=db, claims={"oid": "oid-x", "email": "arif@cfsb.test"}, config=cfg) is None
    db.expire_all()
    arif = w.user(ARIF)
    assert (arif.external_provider, arif.external_id, arif.last_login) == ("digitalocean", "do:account:1", None)
    assert sso._upsert_user_from_claims(tenant_db=db, claims={"oid": "oid-sso", "email": "sia@cfsb.test"}, config=cfg).id == SSO_NEW
    local = sso._upsert_user_from_claims(tenant_db=db, claims={"oid": "oid-lena", "email": "lena@cfsb.test"}, config=cfg)
    assert local.id == LOCAL and local.external_provider == "entra_id"           # a local user still links to SSO by email
    new = sso._upsert_user_from_claims(tenant_db=db, claims={"oid": "oid-new", "email": "nia@cfsb.test", "name": "Nia New"}, config=cfg)
    assert new is not None and new.external_provider == "entra_id" and is_platform_account(db, new)


def test_the_one_off_fix_gives_the_documents_to_their_authors_and_ends_the_requests_once(w):
    db = w.db
    doc3 = db.get(m.GovernanceDocument, 3)
    life._request(db, doc3, "acknowledgement", [ARIF, LOCAL], CONTACT, 14)       # asked before the people rule
    db.add(m.DocumentSignoffAssignment(tenant_id=1, document_id=3, role_type="prepared_by", target_type="user", target_id=ARIF))
    db.commit()
    arif_ob = db.query(m.DocumentObligation).filter_by(user_id=ARIF).one()
    task_id = arif_ob.critical_task_id
    assert task_id and db.get(m.CriticalTask, task_id) is not None

    out = imported_owners.run(db)
    db.commit()
    db.expire_all()
    assert out == {"owners": 2, "prepared_by": 1, "requests": 1}
    assert db.get(m.GovernanceDocument, 3).owner_id == AUTHOR                   # the author owns it
    assert db.get(m.GovernanceDocument, 4).owner_id == CONTACT                  # its author was imported too: the primary contact
    assert db.get(m.GovernanceDocument, 5).owner_id == LOCAL
    why = db.query(m.DocumentAuditLog).filter_by(document_id=3, field_changed="owner_id").one()
    assert why.action_details == "The owner was an account imported by an access-review connector; the author is the owner now"
    assert (why.old_value, why.new_value) == (str(ARIF), str(AUTHOR))
    assert db.query(m.DocumentSignoffAssignment).filter_by(document_id=3, role_type="prepared_by").one().target_id == AUTHOR
    assert db.query(m.DocumentObligation).filter_by(user_id=ARIF).one().status == "cancelled"
    assert db.get(m.CriticalTask, task_id) is None                              # its Task Management task went with it
    assert db.query(m.DocumentObligation).filter_by(user_id=LOCAL).one().status == "pending"
    assert db.query(m.DocumentAuditLog).filter_by(document_id=3, action="request_cancelled").count() == 1

    db.get(m.GovernanceDocument, 5).owner_id = DIRECTORY                        # whatever happens later is not moved again
    db.commit()
    assert imported_owners.run(db) == {"owners": 0, "prepared_by": 0, "requests": 0}
    db.commit()
    assert db.get(m.GovernanceDocument, 5).owner_id == DIRECTORY
    assert db.query(m.DocumentAuditLog).filter_by(field_changed="owner_id").count() == 2


def test_the_fix_runs_from_the_tenant_schema_self_heal(w):
    from grc.modules.compliance.schema_migrations import _backfill_imported_account_owners

    _backfill_imported_account_owners(w.engine)
    w.db.expire_all()
    assert w.db.get(m.GovernanceDocument, 3).owner_id == AUTHOR
    assert (w.db.query(m.Tenant).first().settings or {}).get(imported_owners.MARK)
