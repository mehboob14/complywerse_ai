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
    monkeypatch.setattr(life, "_task_viewers", lambda db: set(range(1, 9)))      # everyone may open Task Management (not tested here)
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
    assert out == {"owners": 2, "prepared_by": 1, "requests": 1, "signers": 0, "stages": 0}
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
    assert imported_owners.run(db) == {"owners": 0, "prepared_by": 0, "requests": 0, "signers": 0, "stages": 0}
    db.commit()
    assert db.get(m.GovernanceDocument, 5).owner_id == DIRECTORY
    assert db.query(m.DocumentAuditLog).filter_by(field_changed="owner_id").count() == 2


def test_the_fix_runs_from_the_tenant_schema_self_heal(w):
    from grc.modules.compliance.schema_migrations import _backfill_imported_account_owners

    _backfill_imported_account_owners(w.engine)
    w.db.expire_all()
    assert w.db.get(m.GovernanceDocument, 3).owner_id == AUTHOR
    assert (w.db.query(m.Tenant).first().settings or {}).get(imported_owners.MARK)


def test_an_imported_account_is_never_alerted_emailed_asked_or_matched_by_name_or_email(w, monkeypatch):
    from grc.modules.issue_management.audit_register.service import build_owner_index, match_owner
    from grc.modules.workflow_engine.services import action_handlers
    from grc.modules.workflow_engine.services import notification_service as ns

    db, mails = w.db, []
    monkeypatch.setattr(ns, "send_email", lambda db, **kw: mails.append(kw["to"]) or {"success": True})
    ns.send_workflow_notification(db, tenant_id=1, subject="Hello", message="A note.", workflow_instance_id=None,
                                  user_ids=[ARIF, LOCAL], channels=["in_app", "email"])
    db.flush()
    assert {n.user_id for n in db.query(m.WorkflowNotification)} == {LOCAL} and "arif@cfsb.test" not in str(mails)
    assert "arif@cfsb.test" not in action_handlers._get_manager_emails(db, 1)        # a workflow e-mail with nobody named
    assert match_owner("Lena Local", build_owner_index(db)) == LOCAL                 # the audit register's owner names
    assert match_owner("Otto Okta", build_owner_index(db)) is None
    for uid in (ARIF, LOCAL):                                                         # named before the pickers left it out
        db.add(m.DocumentSignoffAssignment(tenant_id=1, document_id=5, role_type="reviewer", target_type="user", target_id=uid))
    db.commit()
    life._open_stage(db, db.get(m.GovernanceDocument, 5), "reviewer", CONTACT)
    db.commit()
    assert {o.user_id for o in db.query(m.DocumentObligation).filter_by(document_id=5)} == {LOCAL}


def _refused(call):
    """The plain 400 of the item 2 change, naming the imported account."""
    with pytest.raises(HTTPException) as e:
        call()
    assert e.value.status_code == 400 and e.value.detail.startswith(f"{ARIF_NAME} is an account an access review imported")


def test_a_team_lead_must_use_the_platform_and_one_already_lead_may_stay(w):
    teams = importlib.import_module("grc.routers.teams_router")
    db, me = w.db, w.user(CONTACT)
    _refused(lambda: teams.create_team(payload=teams.TeamCreate(name="Ops", lead_user_id=ARIF), db=db, current_user=me))
    assert teams.create_team(payload=teams.TeamCreate(name="Ops", lead_user_id=LOCAL), db=db, current_user=me).lead_user_id == LOCAL
    ops = db.query(m.Team).filter_by(name="Ops").one().id
    _refused(lambda: teams.update_team(team_id=ops, payload=teams.TeamUpdate(lead_user_id=ARIF), db=db, current_user=me))
    # team 30 was led by the imported account before the rule: renaming it sends that lead back as it is
    assert teams.update_team(team_id=30, payload=teams.TeamUpdate(name="Security team", lead_user_id=ARIF), db=db,
                             current_user=me).name == "Security team"


def test_a_regulatory_task_assignee_must_use_the_platform(w):
    from grc.modules.governance import regulatory_tasks
    from grc.modules.governance.routers import regulatory_changes

    db = w.db
    with pytest.raises(ValueError, match="access review imported"):
        regulatory_tasks.check_users(db, [LOCAL, ARIF])
    _refused(lambda: regulatory_changes._task_assignees(db, [ARIF]))
    assert regulatory_changes._task_assignees(db, [LOCAL, ADOPTED]) == [LOCAL, ADOPTED]
    assert regulatory_changes._task_assignees(db, [LOCAL, ARIF], kept=[ARIF]) == [LOCAL, ARIF]   # already on the task


def test_a_statement_is_assigned_to_a_platform_user_only(w):
    statements = importlib.import_module("grc.modules.compliance.routers.statements")
    db, me = w.db, w.user(CONTACT)
    db.add(m.PolicyStatement(id=40, tenant_id=1, document_id=5, statement_text="Passwords are 12 characters or more."))
    db.commit()

    def assign(uid):
        return statements.assign_statement(statement_id=40, payload=statements.AssignmentRequest(assigned_to_user_id=uid),
                                           db=db, current_user=me)

    _refused(lambda: assign(ARIF))
    assert assign(LOCAL)["assigned_to_user_id"] == LOCAL


def test_an_approval_is_delegated_and_escalated_to_platform_users_only(w):
    db = w.db
    db.add(m.DocumentApprovalStep(id=50, document_id=5, step_sequence=1, step_name="Approval", approver_id=CONTACT, status="pending"))
    db.commit()
    for path, key in (("delegate", "delegate_to_user_id"), ("escalate", "escalate_to_user_id")):
        r = w.http.post(f"/governance/workflows/steps/50/{path}", json={key: ARIF})
        assert r.status_code == 400 and r.json()["detail"].startswith(f"{ARIF_NAME} is an account an access review imported")
    assert w.http.post("/governance/workflows/steps/50/delegate", json={"delegate_to_user_id": LOCAL}).status_code == 200
    db.expire_all()
    assert db.get(m.DocumentApprovalStep, 50).delegated_to == LOCAL


def test_a_workflow_definition_names_platform_users_only(w):
    from grc.modules.workflow_engine.routers.definitions import _apply_nodes

    db = w.db
    approval = {"node_key": "approve", "node_type": "approval",
                "config": {"approver_user_ids": [str(LOCAL)], "escalation_levels": [{"escalate_to_user_ids": [ARIF]}]}}
    _refused(lambda: _apply_nodes(db, 70, [approval]))
    approval["config"]["escalation_levels"][0]["escalate_to_user_ids"] = [AUTHOR]
    _apply_nodes(db, 70, [approval])
    db.flush()
    assert db.query(m.WorkflowNode).filter_by(workflow_definition_id=70).count() == 1
    db.add(m.WorkflowNode(workflow_definition_id=71, node_key="old", node_type="action", name="Old", config={"owner_id": ARIF}))
    db.flush()
    _apply_nodes(db, 71, [{"node_key": "old", "config": {"owner_id": ARIF}}])      # named before the rule: may stay


def test_a_role_expanded_to_approvers_skips_imported_members(w):
    from grc.modules.governance.routers.workflows import get_approvers_for_step
    from grc.modules.workflow_engine.services.notification_service import resolve_user_ids_from_roles
    from grc.modules.workflow_engine.services.step_executor import StepExecutor

    db = w.db                     # ARIF holds "Approvers" through a legacy link nobody gave: a platform grant, not a person
    step = SimpleNamespace(approvers=[SimpleNamespace(approver_type="role", role_id=APPROVERS, user_id=None)])
    assert set(get_approvers_for_step(step, SimpleNamespace(tenant_id=1, owner_id=None), db)) == {LOCAL, ADOPTED}
    assert set(StepExecutor._resolve_role_user_ids(db, 1, [APPROVERS])) == {LOCAL, ADOPTED}
    assert set(resolve_user_ids_from_roles(db, 1, [APPROVERS])) == {LOCAL, ADOPTED}


def _signers(db, doc_id, status, reviewers=(), approvers=()):
    db.add(m.GovernanceDocument(id=doc_id, tenant_id=1, title=f"Policy {doc_id}", doc_type="policy", status=status,
                                current_version="1.0", content="# P\n", owner_id=LOCAL, author_id=LOCAL))
    for role, ids in (("reviewer", reviewers), ("approver", approvers)):
        for uid in ids:
            db.add(m.DocumentSignoffAssignment(tenant_id=1, document_id=doc_id, role_type=role, target_type="user", target_id=uid))


def test_the_one_off_fix_removes_imported_reviewers_and_approvers_and_the_stage_moves_on(w):
    from grc.modules.governance.routers.document_signoff import _assignments, _user_actionable_role

    db = w.db
    _signers(db, 6, "pending_review", reviewers=[ARIF], approvers=[AUTHOR])        # only the imported reviewer: on to approval
    _signers(db, 7, "pending_approval", approvers=[ARIF])                          # nobody left at all: a draft again
    _signers(db, 8, "pending_review", reviewers=[ARIF, LOCAL])                     # someone left: the stage stays
    _signers(db, 9, "draft", reviewers=[ARIF], approvers=[AUTHOR])                 # not in a stage: only the reviewer goes
    db.commit()

    fixing = sessionmaker(bind=w.engine, autoflush=False)()                         # as tenant sessions are (PITFALLS 74)
    out = imported_owners.run(fixing)
    fixing.commit()
    fixing.close()
    db.expire_all()
    assert (out["signers"], out["stages"]) == (4, 2)
    assert not db.query(m.DocumentSignoffAssignment).filter_by(target_type="user", target_id=ARIF).filter(
        m.DocumentSignoffAssignment.role_type.in_(["reviewer", "approver"])).count()
    why = db.query(m.DocumentAuditLog).filter_by(action="participant_removed").order_by(m.DocumentAuditLog.document_id).all()
    assert [(r.document_id, r.field_changed, r.old_value) for r in why] == [(6, "reviewer", str(ARIF)), (7, "approver", str(ARIF)),
                                                                            (8, "reviewer", str(ARIF)), (9, "reviewer", str(ARIF))]
    assert why[0].action_details == ("The reviewer was an account imported by an access-review connector, which can never sign: "
                                     "it was removed")
    doc6, doc7, doc8, doc9 = (db.get(m.GovernanceDocument, i) for i in (6, 7, 8, 9))
    assert (doc6.status, doc7.status, doc8.status, doc9.status) == ("pending_approval", "draft", "pending_review", "draft")
    moved = {r.document_id: r.action_details for r in db.query(m.DocumentAuditLog).filter_by(action="status_changed")}
    assert moved == {6: "No reviewers are set, so it goes to its approvers",
                     7: "Nobody is set to review or approve it, so it is a draft again: choose reviewers and send it for review"}
    asked = db.query(m.DocumentObligation).filter_by(document_id=6, kind="approval", status="pending").one()
    assert asked.user_id == AUTHOR and asked.critical_task_id                      # the approver is asked, with a task
    assert _user_actionable_role(db, [1], doc6, AUTHOR, []) == "approver"          # and can sign: the stage can end
    assert _user_actionable_role(db, [1], doc8, LOCAL, []) == "reviewer"
    assert {(a.role_type, a.target_id) for a in _assignments(db, 9)} == {("approver", AUTHOR)}

    assert imported_owners.run(db) == {"owners": 0, "prepared_by": 0, "requests": 0, "signers": 0, "stages": 0}   # once


def test_the_signers_part_runs_where_the_owners_part_ran_before_it_existed(w):
    db = w.db
    _signers(db, 6, "pending_approval", approvers=[ARIF])
    db.get(m.Tenant, 1).settings = {imported_owners.MARK: "2026-10-19T00:00:00"}
    db.commit()
    out = imported_owners.run(db)
    db.commit()
    assert (out["owners"], out["signers"], out["stages"]) == (0, 1, 1)
    assert db.get(m.GovernanceDocument, 3).owner_id == ARIF                       # the owners part does not run again
    assert db.get(m.GovernanceDocument, 6).status == "draft"
    assert {imported_owners.MARK, imported_owners.SIGNERS_MARK} <= set(db.get(m.Tenant, 1).settings)


def test_evidence_approval_tiers_and_workflows_from_a_template_name_platform_users_only(w):
    assessments = importlib.import_module("grc.routers.compliance_assessments_router")
    templates = importlib.import_module("grc.modules.workflow_engine.routers.templates")
    db, me = w.db, w.user(CONTACT)

    def tiers(uid):
        return [{"tier_order": 1, "tier_name": "Reviewer", "approver_type": "user", "approver_user_id": uid}]

    _refused(lambda: assessments.create_workflow(request=assessments.WorkflowCreate(name="Evidence", tiers=tiers(ARIF)),
                                                 db=db, current_user=me))
    made = assessments.create_workflow(request=assessments.WorkflowCreate(name="Evidence", tiers=tiers(LOCAL)), db=db, current_user=me)
    _refused(lambda: assessments.update_workflow(workflow_id=made["id"], request=assessments.WorkflowUpdate(tiers=tiers(ARIF)),
                                                 db=db, current_user=me))
    assessments.update_workflow(workflow_id=made["id"], request=assessments.WorkflowUpdate(tiers=tiers(AUTHOR)), db=db, current_user=me)

    db.add(m.WorkflowEngineTemplate(id=80, tenant_id=1, name="Approve", trigger_event="manual",
                                    nodes_json=[{"node_key": "a", "node_type": "approval", "config": {"approver_user_ids": [ARIF]}}]))
    db.commit()
    _refused(lambda: templates.instantiate_template(template_id=80, db=db, current_user=me, _=True))


def test_an_id_that_is_not_a_number_is_not_an_id():
    assert auth.imported_account_problem(None, ["", "Lena", "²", None, 0]) is None     # a label in a free-form body: nothing to ask


# -- follow-ups found in testing (2026-10-19) -------------------------------------------------------------------------------------
def _png():
    from test_esignature import _png as png

    return png()


def _signed(db, doc_id, uid, role_type="reviewer"):
    """``uid`` signed ``doc_id`` this round (after its round began)."""
    db.add(m.DocumentSignature(tenant_id=1, document_id=doc_id, signer_user_id=uid, role_type=role_type, role_label="Reviewed by",
                               decision="signed", signature_text="x", signed_at=datetime.utcnow()))


def _status_rows(db, doc_id):
    return [(r.old_value, r.new_value, r.action_details)
            for r in db.query(m.DocumentAuditLog).filter_by(document_id=doc_id, action="status_changed").order_by(m.DocumentAuditLog.id)]


def test_the_one_off_fix_ends_a_review_everyone_left_has_signed_and_asks_the_approver(w):
    db = w.db
    _signers(db, 10, "pending_review", reviewers=[ARIF, LOCAL], approvers=[AUTHOR])
    db.flush()
    _signed(db, 10, LOCAL)                                                          # the only one who can sign has signed
    db.commit()

    fixing = sessionmaker(bind=w.engine, autoflush=False)()                         # as tenant sessions are (PITFALLS 74)
    out = imported_owners.run(fixing)
    fixing.commit()
    fixing.close()
    db.expire_all()
    assert (out["signers"], out["stages"]) == (1, 1)
    doc = db.get(m.GovernanceDocument, 10)
    assert doc.status == "pending_approval"
    assert _status_rows(db, 10) == [("pending_review", "pending_approval",
                                     "Everyone left to review it has signed, so it goes to its approvers")]
    asked = db.query(m.DocumentObligation).filter_by(document_id=10, status="pending").all()
    assert [(o.kind, o.user_id) for o in asked] == [("approval", AUTHOR)] and asked[0].critical_task_id
    from grc.modules.governance.routers.document_signoff import _user_actionable_role

    assert _user_actionable_role(db, [1], doc, AUTHOR, []) == "approver"


def test_removing_a_reviewer_who_had_not_signed_ends_the_review_when_the_others_signed(w):
    http, db, me = w.http, w.db, w.me
    _signers(db, 11, "draft", reviewers=[LOCAL, AUTHOR], approvers=[CONTACT])
    db.commit()
    assert http.post("/governance/documents/11/signoff/send-for-review").json()["status"] == "pending_review"
    me["id"] = LOCAL
    assert http.post("/governance/documents/11/signoff/sign", json={"signature_image": _png()}).json()["status"] == "pending_review"
    me["id"] = CONTACT

    def participants(reviewers):
        return http.put("/governance/documents/11/signoff/participants", json={
            "reviewers": [{"target_type": "user", "target_id": u} for u in reviewers],
            "approvers": [{"target_type": "user", "target_id": CONTACT}]})

    def waiting():
        db.expire_all()
        return sorted((o.kind, o.user_id) for o in db.query(m.DocumentObligation).filter_by(document_id=11, status="pending"))

    r = participants([LOCAL, AUTHOR, ADOPTED])                                     # someone added: the one who signed is not asked again
    assert r.status_code == 200 and r.json()["status"] == "pending_review"
    assert waiting() == [("review", AUTHOR), ("review", ADOPTED)]
    r = participants([LOCAL])                                                       # only the one who signed is left
    assert r.status_code == 200 and r.json()["status"] == "pending_approval"
    assert r.json()["my_actionable_role"] == "approver"                            # the approver (CONTACT) can sign now
    assert waiting() == [("approval", CONTACT)]
    assert _status_rows(db, 11)[-1] == ("pending_review", "pending_approval",
                                        "Everyone left to review it has signed, so it goes to its approvers")


def test_an_entra_account_the_directory_sync_stamped_keeps_its_documents_and_requests(w):
    db = w.db
    db.get(m.GovernanceDocument, 5).owner_id = DIRECTORY                           # staff of the organisation's own directory
    _signers(db, 12, "pending_review", reviewers=[DIRECTORY])
    db.flush()
    life._request(db, db.get(m.GovernanceDocument, 12), "review", [DIRECTORY], CONTACT, 7)
    db.commit()
    out = imported_owners.run(db)
    db.commit()
    db.expire_all()
    assert db.get(m.GovernanceDocument, 5).owner_id == DIRECTORY                  # kept
    assert db.get(m.GovernanceDocument, 3).owner_id == AUTHOR                     # the DigitalOcean account's is replaced
    assert db.query(m.DocumentObligation).filter_by(document_id=12, user_id=DIRECTORY).one().status == "pending"
    assert db.query(m.DocumentSignoffAssignment).filter_by(document_id=12, target_id=DIRECTORY).count() == 1
    assert db.get(m.GovernanceDocument, 12).status == "pending_review"
    assert out["owners"] == 2


def test_a_second_process_running_the_fix_at_the_same_moment_does_nothing(w):
    db = w.db
    second = w.factory()
    stale = second.query(m.Tenant).first()                                          # it read the organisation before the marks
    assert not (stale.settings or {}).get(imported_owners.MARK)
    assert imported_owners.run(db)["owners"] == 2
    db.commit()
    marks = dict(db.get(m.Tenant, 1).settings)
    rows = db.query(m.DocumentAuditLog).count()
    assert imported_owners.run(second) == {"owners": 0, "prepared_by": 0, "requests": 0, "signers": 0, "stages": 0}
    second.commit()
    second.close()
    db.expire_all()
    assert db.get(m.Tenant, 1).settings == marks                                   # the marks the first one wrote stand
    assert db.query(m.DocumentAuditLog).count() == rows


def test_a_task_already_assigned_to_an_imported_account_can_still_be_edited(w):
    from fastapi import BackgroundTasks

    tasks = importlib.import_module("grc.routers.critical_tasks_router")
    db, me = w.db, w.user(CONTACT)
    db.add(m.CriticalTask(id=60, tenant_id=1, title="Rotate keys", status="Open", priority="High", assigned_owner_id=ARIF,
                          assigned_user_ids=[ARIF], reviewer_id=ARIF, created_by_id=CONTACT))
    db.add(m.CriticalTaskSubTask(id=61, task_id=60, title="Rotate the DO key", assigned_owner_id=ARIF))
    db.commit()
    form = {"title": "Rotate the keys", "assigned_owner_id": ARIF, "assigned_user_ids": [ARIF], "reviewer_id": ARIF}   # as the form sends it
    assert tasks.update_task(task_id=60, payload=tasks.TaskUpdate(**form), background_tasks=BackgroundTasks(), db=db,
                             current_user=me)["title"] == "Rotate the keys"
    assert tasks.update_sub_task(task_id=60, sub_task_id=61, payload=tasks.SubTaskUpdate(title="Rotate it", assigned_owner_id=ARIF),
                                 db=db, current_user=me)["title"] == "Rotate it"
    _refused_named(lambda: tasks.update_task(task_id=60, payload=tasks.TaskUpdate(assigned_user_ids=[ARIF, OUTSIDER]),
                                             background_tasks=BackgroundTasks(), db=db, current_user=me), "Otto Okta")
    _refused_named(lambda: tasks.update_sub_task(task_id=60, sub_task_id=61, payload=tasks.SubTaskUpdate(assigned_owner_id=OUTSIDER),
                                                 db=db, current_user=me), "Otto Okta")


def _refused_named(call, name):
    with pytest.raises(HTTPException) as e:
        call()
    assert e.value.status_code == 400 and e.value.detail.startswith(f"{name} is an account an access review imported")


def _create_user(w, monkeypatch, **body):
    admin = importlib.import_module("grc.routers.admin_router")
    monkeypatch.setattr(admin, "get_tenant_from_request", lambda request, token, db: w.db.get(m.Tenant, 1))
    data = admin.UserCreate.model_construct(**{"username": "otto.k", "email": "otto@cfsb.test", "password": "Adopted!Passw0rd-2026",
                                               "display_name": "Otto Khan", "role_ids": [APPROVERS], **body})   # (EmailStr refuses .test)
    return admin.create_user(data=data, user=w.user(CONTACT), tenant_db=w.db, request=None, db=w.db)


def test_an_administrator_turns_an_imported_person_into_a_platform_user_by_creating_them(w, monkeypatch):
    db, http = w.db, w.http
    assert _login(w, monkeypatch, "otto@cfsb.test", "pw-otto").status_code == 403   # the directory import: refused until then
    assert sso._imported_by_email(db, {"email": "OTTO@cfsb.test"}) is True        # SSO says an administrator can create the user
    assert sso._imported_by_email(db, {"email": "lena@cfsb.test"}) is False
    with pytest.raises(HTTPException) as e:                                         # without a role it would stay an imported account
        _create_user(w, monkeypatch, role_ids=[])
    assert e.value.status_code == 400 and "choose at least one role" in e.value.detail

    out = _create_user(w, monkeypatch)
    assert out["adopted"] is True and out["message"] == "An account from Access Reviews was turned into a platform user"
    db.expire_all()
    otto = w.user(OUTSIDER)
    assert out["user"]["id"] == OUTSIDER and (otto.username, otto.display_name) == ("otto.k", "Otto Khan")
    assert (otto.external_provider, otto.external_id) == ("okta", "okta:7")      # Access Reviews still match it
    assert is_platform_account(db, otto) and not sso._imported_by_email(db, {"email": "otto@cfsb.test"})
    link = db.query(m.UserRole).filter_by(user_id=OUTSIDER, role_id=APPROVERS).one()
    assert (link.source, link.assigned_by) == (None, CONTACT)
    why = db.query(m.AuditLog).filter_by(resource_type="users", resource_id=OUTSIDER).one()
    assert why.user_id == CONTACT
    assert _login(w, monkeypatch, "otto.k", "Adopted!Passw0rd-2026").status_code == 200
    assert http.put("/governance/documents/5", json={"owner_id": OUTSIDER}).status_code == 200     # documents can be given to them


def test_adopting_an_imported_person_gives_only_the_roles_ticked(w, monkeypatch):
    db = w.db
    db.add(m.UserRole(user_id=OUTSIDER, role_id=ADMIN_ROLE, tenant_id=1))           # an older link nobody gave (no source)
    db.add(m.UserRole(user_id=OUTSIDER, role_id=DO_ROLE, tenant_id=1, source="okta"))  # the connector's own
    db.commit()
    _create_user(w, monkeypatch)                                                    # Approvers ticked
    db.expire_all()
    otto = w.user(OUTSIDER)
    assert not auth.is_tenant_admin(db, otto)                                       # not an Administrator nobody chose
    assert {(l.role_id, l.source) for l in db.query(m.UserRole).filter_by(user_id=OUTSIDER)} == {(APPROVERS, None), (DO_ROLE, "okta")}


def test_creating_a_user_still_refuses_a_name_another_account_has(w, monkeypatch):
    with pytest.raises(HTTPException) as e:
        _create_user(w, monkeypatch, username="lena")                              # a platform user's username
    assert e.value.detail == "Username or email already exists"
    with pytest.raises(HTTPException) as e:
        _create_user(w, monkeypatch, username="arif", email="new@cfsb.test")       # an imported account's username, another email
    assert "access review imported an account" in e.value.detail


def test_pickers_offer_platform_people_by_name_and_roles_and_teams_counting_them_only(w):
    w.me["id"] = LOCAL                                                              # not an administrator
    r = w.http.get("/governance/documents/signoff/targets")
    assert r.status_code == 200
    body = r.json()
    assert [u["name"] for u in body["users"]] == ["Ada Adopted", "Anna Author", "Cfsb Admin", "Lena Local", "Sia Sso"]
    assert [(x["name"], x["user_count"]) for x in body["roles"]] == [("Administrator", 1), ("Approvers", 2)]   # not the DigitalOcean team
    assert [(x["name"], x["member_count"]) for x in body["teams"]] == [("Security", 1)]       # its imported lead and member left out
    from grc.modules.governance.routers.document_lifecycle import _settings_answer

    assert [x["name"] for x in _settings_answer(w.db, w.user(CONTACT), 1)["roles"]] == ["Administrator", "Approvers"]   # "Escalate to"


def test_a_stage_nobody_can_sign_goes_on_and_send_for_review_says_why(w):
    http, db = w.http, w.db
    db.add(m.GovernanceDocument(id=13, tenant_id=1, title="Policy 13", doc_type="policy", status="draft", current_version="1.0",
                                content="# P\n", owner_id=LOCAL, author_id=LOCAL))
    db.add(m.DocumentSignoffAssignment(tenant_id=1, document_id=13, role_type="approver", target_type="role", target_id=DO_ROLE))
    db.commit()
    r = http.post("/governance/documents/13/signoff/send-for-review")
    assert r.status_code == 200 and r.json()["status"] == "draft"                  # nobody in that role can approve it
    assert r.json()["notice"] == ("Nobody in DigitalOcean: team My Team can sign it; choose other approvers. None of its reviewers or "
                                  "approvers can sign it, so it is a draft again: choose others and send it for review.")
    assert _status_rows(db, 13)[-1][1:] == ("draft", "None of its reviewers or approvers can sign it, so it is a draft again: "
                                                     "choose others and send it for review")
    assert not db.query(m.DocumentObligation).filter_by(document_id=13).count()

    db.add(m.DocumentSignoffAssignment(tenant_id=1, document_id=13, role_type="reviewer", target_type="user", target_id=LOCAL))
    db.commit()
    r = http.post("/governance/documents/13/signoff/send-for-review")
    assert r.json()["status"] == "pending_review" and r.json()["notice"].startswith("Nobody in DigitalOcean: team My Team can sign it")
    w.me["id"] = LOCAL
    signed = http.post("/governance/documents/13/signoff/sign", json={"signature_image": _png()}).json()
    assert signed["status"] == "draft"                                              # never approved without its named approvers
    assert _status_rows(db, 13)[-1] == ("pending_review", "draft", "Reviewed, but none of its approvers can sign it, so it is a draft again: choose other approvers and send it for review")
    w.me["id"] = CONTACT
    assert http.post("/governance/documents/5/signoff/send-for-review").status_code == 400   # nobody chosen at all: as before
