"""Who reviews and approves a policy exception (DECISIONS D58): the rules of Governance > Settings and the flow of an exception through
the rule that applies to it. Over HTTP through the whole governance router with real tokens on in-memory SQLite (foreign keys on, a
session that does not flush by itself).

* writing rules: who may, what is refused in words, one rule per department and conditions;
* which rule applies: the deepest unit wins, a department's rule covers what is under it, conditions, ties, the whole organisation;
* the flow: steps in order, together or in turn, all / any / at least N, the owner of the unit and of its parent, never the requester,
  never someone who is not asked (administrators included), changes asked for, rejected, withdrawn, resubmitted as a new round;
* what is kept: every decision with who, which step and when, across rounds; a rule changed later never changes an exception waiting;
* an exception no rule matches follows the older flow, exactly as before; GET writes nothing.
"""
import os

os.environ.setdefault("SESSION_SECRET", "unit-test-secret")
os.environ.setdefault("OPENAI_API_KEY", "dummy")

import copy  # noqa: E402
from datetime import datetime, timedelta  # noqa: E402
from types import SimpleNamespace  # noqa: E402

import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, event  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import grc.models as m  # noqa: E402
from grc.modules.governance import exception_approvals as svc  # noqa: E402
from grc.modules.governance import exception_rules as R  # noqa: E402
from grc.modules.governance.router import router as governance_router  # noqa: E402
from grc.routers.auth_router import create_access_token  # noqa: E402

(PLAIN, ADMIN, REQ, REV1, REV2, APP1, APP2, APP3, OPS, SUP, SETTER, EXCADMIN) = range(1, 13)
EX = "/governance/policy-exceptions"
RULES = "/governance/exception-approval-rules"


@pytest.fixture(scope="module")
def _schema():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def w(_schema):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    event.listen(engine, "connect", lambda conn, _record: conn.execute("PRAGMA foreign_keys=ON"))
    _schema.raw_connection().driver_connection.backup(engine.raw_connection().driver_connection)
    db = sessionmaker(bind=engine, autoflush=False)()
    db.add(m.Tenant(id=1, name="Acme", slug="acme", primary_contact_email="boss@acme.test"))
    db.add(m.Tenant(id=2, name="Other", slug="other"))
    names = {PLAIN: "plain", ADMIN: "ada", REQ: "rita", REV1: "rev1", REV2: "rev2", APP1: "app1", APP2: "app2", APP3: "app3", OPS: "ops",
             SUP: "sup", SETTER: "setter", EXCADMIN: "eve"}
    for uid, name in names.items():
        db.add(m.GRCUser(id=uid, username=name, email=f"{name}@acme.test", display_name=name.title()))
    roles = {1: "Administrator", 2: "Requesters", 3: "Approvers", 4: "Settings editors", 5: "Risk committee", 6: "Exception admins"}
    for rid, name in roles.items():
        db.add(m.Role(id=rid, tenant_id=1, name=name))
    db.add(m.Role(id=9, tenant_id=2, name="Somebody else's role"))
    for pid, perm in enumerate(["governance:policy_exceptions:create", "governance:policy_exceptions:approve",
                                "governance:settings:edit", "governance:policy_exceptions:edit"], start=1):
        db.add(m.Permission(id=pid, name=perm, resource=perm.rsplit(":", 1)[0], action=perm.rsplit(":", 1)[1]))
    for rid, pid in [(2, 1), (3, 2), (4, 3), (6, 4), (6, 2)]:         # Requesters create; Approvers approve; Settings editors; Exception admins edit + approve
        db.add(m.RolePermission(role_id=rid, permission_id=pid))
    for uid, rid in [(ADMIN, 1), (REQ, 2), (APP1, 3), (APP2, 3), (APP3, 3), (SETTER, 4), (REV1, 5), (REV2, 5), (EXCADMIN, 6)]:
        db.add(m.UserRole(user_id=uid, role_id=rid, tenant_id=1, source=None))
    # Operations (owner Ops) > Support (owner Sup) > Helpdesk (no owner); Finance (no owner)
    db.add(m.GRCDepartment(id=10, tenant_id=1, name="Operations", code="OPS", department_head_user_id=OPS))
    db.add(m.GRCDepartment(id=11, tenant_id=1, name="Support", code="SUP", parent_department_id=10, department_head_user_id=SUP))
    db.add(m.GRCDepartment(id=12, tenant_id=1, name="Helpdesk", code="HELP", parent_department_id=11))
    db.add(m.GRCDepartment(id=13, tenant_id=1, name="Finance", code="FIN"))
    db.add(m.GRCDepartment(id=14, tenant_id=1, name="Old unit", code="OLD", is_active=False))
    db.add(m.GRCDepartment(id=90, tenant_id=2, name="Elsewhere", code="ELSE"))
    for did, dept, kind in [(1, 11, "policy"), (2, 13, "standard"), (3, None, "policy"), (4, 12, "policy")]:
        db.add(m.GovernanceDocument(id=did, tenant_id=1, title=f"Doc {did}", doc_type=kind, status="published", current_version="1.0",
                                    published_version="1.0", owner_id=REQ, department_id=dept))
    db.commit()
    app = FastAPI()
    app.include_router(governance_router)
    app.dependency_overrides[m.get_db] = lambda: db

    def as_(uid):
        token = create_access_token({"sub": db.get(m.GRCUser, uid).username, "tenant_slug": "acme", "tenant_id": 1})
        return TestClient(app, headers={"Authorization": "Bearer " + token})

    yield SimpleNamespace(db=db, as_=as_)
    db.close()


# ── helpers ──────────────────────────────────────────────────────────────────
def step(kind="approval", people=None, **kw):
    return {"kind": kind, "people": people if people is not None else [{"type": "user", "id": APP1}], **kw}


def make_rule(w, name="Rule", steps=None, as_user=SETTER, **kw):
    body = {"name": name, "steps": steps if steps is not None else [step()], **kw}
    r = w.as_(as_user).post(RULES, json=body)
    assert r.status_code == 201, r.text
    return r.json()


def raise_exception(w, document_id=1, priority="medium", as_user=REQ, **kw):
    r = w.as_(as_user).post(EX, json={"title": "Skip backups", "justification": "Legacy box", "document_id": document_id,
                                      "priority": priority, **kw})
    assert r.status_code == 201, r.text
    return r.json()


def submit(w, eid, as_user=REQ):
    return w.as_(as_user).post(f"{EX}/{eid}/submit")


def get(w, eid, as_user=ADMIN):
    r = w.as_(as_user).get(f"{EX}/{eid}")
    assert r.status_code == 200, r.text
    return r.json()


def asked(w, eid):
    return sorted(p["id"] for p in get(w, eid)["approval"]["asked"])


def decide(w, eid, who, what="approve", **body):
    path = {"approve": "approve", "reject": "reject", "changes": "request-changes"}[what]
    return w.as_(who).post(f"{EX}/{eid}/{path}", json=body)


# ── writing rules ────────────────────────────────────────────────────────────

def test_only_someone_who_may_change_governance_settings_writes_rules_and_a_governance_right_reads_them(w):
    body = {"name": "Rule", "steps": [step()]}
    for who in (PLAIN, REQ, APP1, EXCADMIN):
        r = w.as_(who).post(RULES, json=body)
        assert r.status_code == 403 and "allowed to change governance settings" in r.json()["detail"], who
    assert w.db.query(m.ExceptionApprovalRule).count() == 0
    for who in (SETTER, ADMIN):
        assert w.as_(who).post(RULES, json={**body, "name": f"By {who}", "priorities": ["low"] if who == ADMIN else []}).status_code == 201
    assert w.as_(PLAIN).get(RULES).status_code == 403                          # no governance right: cannot read
    reader = w.as_(REQ).get(RULES).json()                                       # a governance right (exceptions) reads, cannot edit
    assert reader["can_edit"] is False and reader["options"] is None and len(reader["rules"]) == 2
    editor = w.as_(SETTER).get(RULES).json()
    assert editor["can_edit"] is True and {"users", "roles", "priorities", "doc_types"} <= set(editor["options"])
    assert editor["level_labels"] == ["Department", "Sub-department", "Unit"]
    for method, path, kw in [("put", f"{RULES}/1", {"json": body}), ("delete", f"{RULES}/1", {}), ("post", f"{RULES}/preview", {"json": {}})]:
        assert getattr(w.as_(REQ), method)(path, **kw).status_code == 403, (method, path)


def test_a_rule_is_checked_and_refused_in_words(w):
    bad = [
        ({"name": "", "steps": [step()]}, "needs a name"),
        ({"name": "R", "steps": []}, "at least one step"),
        ({"name": "R", "steps": [step(kind="review")]}, "last step has to be an approval"),
        ({"name": "R", "steps": [step(kind="signer")]}, "review or an approval"),
        ({"name": "R", "steps": [step(people=[])]}, "choose who is asked"),
        ({"name": "R", "steps": [step(people=[{"type": "team", "id": 1}])]}, "choose a person, a role or an owner"),
        ({"name": "R", "steps": [step(people=[{"type": "user"}])]}, "choose who is asked"),
        ({"name": "R", "steps": [step(order="sideways")]}, "together or one after another"),
        ({"name": "R", "steps": [step(rule="most")]}, "who has to decide"),
        ({"name": "R", "steps": [step(people=[{"type": "user", "id": APP1}], rule="at_least", min_count=2)]}, "at least how many"),
        ({"name": "R", "steps": [step(due_days=0)]}, "from 1 to 365"),
        ({"name": "R", "steps": [step()], "priorities": ["urgent"]}, "'urgent' is not a priority"),
        ({"name": "R", "steps": [step()], "department_id": 90}, "department chosen does not exist"),
        ({"name": "R", "steps": [step(people=[{"type": "user", "id": 999}])]}, "person chosen does not exist"),
        ({"name": "R", "steps": [step(people=[{"type": "role", "id": 9}])]}, "role chosen does not exist"),
        ({"name": "R", "steps": [step() for _ in range(9)]}, "at most 8 steps"),
    ]
    for body, why in bad:
        r = w.as_(SETTER).post(RULES, json=body)
        assert r.status_code == 400 and why in r.json()["detail"], (why, r.text)
    w.db.get(m.GRCUser, REV2).is_active = False
    w.db.commit()
    r = w.as_(SETTER).post(RULES, json={"name": "R", "steps": [step(people=[{"type": "user", "id": REV2}])]})
    assert r.status_code == 400 and "is not an active user" in r.json()["detail"]
    assert w.db.query(m.ExceptionApprovalRule).count() == 0


def test_the_owner_types_need_no_id_defaults_are_filled_and_one_rule_per_scope(w):
    r = make_rule(w, steps=[step(kind="review", people=[{"type": "unit_owner"}, {"type": "parent_owner"}], order="in_turn", rule="any"),
                            step(people=[{"type": "role", "id": 3}], rule="at_least", min_count=1)],
                  department_id=10, priorities=["High", "critical", "high"], doc_types=["Policy"])
    assert r["priorities"] == ["high", "critical"] and r["doc_types"] == ["policy"]
    first, last = r["steps"]
    assert first["rule"] == "all"                                             # one after another always needs everyone
    assert (first["allow_reject"], last["allow_reject"], first["allow_changes"]) == (False, True, True)
    assert first["name"] == "Review" and last["name"] == "Approval" and first["people"][0] == {"type": "unit_owner", "label": "Owner of the unit"}
    assert r["department_path"] == ["Operations"] and r["department_level"] == 1
    dup = w.as_(SETTER).post(RULES, json={"name": "Again", "steps": [step()], "department_id": 10, "priorities": ["critical", "high"], "doc_types": ["policy"]})
    assert dup.status_code == 400 and "already covers the same department and conditions" in dup.json()["detail"]
    other = make_rule(w, name="Whole org")                                    # another scope: fine
    switched = w.as_(SETTER).put(f"{RULES}/{r['id']}", json={**{k: r[k] for k in ("name", "department_id", "priorities", "doc_types", "steps")}, "is_active": False})
    assert switched.status_code == 200 and switched.json()["is_active"] is False
    assert w.as_(SETTER).post(RULES, json={"name": "Again", "steps": [step()], "department_id": 10, "priorities": ["high", "critical"], "doc_types": ["policy"]}).status_code == 201
    assert w.as_(SETTER).delete(f"{RULES}/{other['id']}").status_code == 200
    assert w.as_(SETTER).delete(f"{RULES}/{other['id']}").status_code == 404


# ── which rule applies (pure) ────────────────────────────────────────────────

def _rules(*specs):
    return [{"id": i, "is_active": True, "priorities": [], "doc_types": [], **s} for i, s in enumerate(specs, start=1)]


def test_the_deepest_unit_wins_a_departments_rule_covers_what_is_under_it_and_conditions_and_age_break_ties():
    level = {10: 1, 11: 2, 12: 3, 13: 1}.get
    path = {12: [10, 11, 12], 11: [10, 11], 10: [10], 13: [13]}
    rules = _rules({"department_id": None}, {"department_id": 10}, {"department_id": 11}, {"department_id": 11, "priorities": ["high"]},
                   {"department_id": 11, "doc_types": ["standard"]}, {"department_id": 11, "priorities": ["high"], "doc_types": ["policy"]},
                   {"department_id": 13, "is_active": False})
    pick = lambda unit, pri, kind: (R.pick(rules, path.get(unit, []), pri, kind, lambda i: level(i, 1)) or {}).get("id")
    assert pick(12, "low", "policy") == 3                      # Helpdesk inherits Support's rule over Operations' and the whole organisation's
    assert pick(11, "high", "standard") == 4                   # one named condition beats none (first of the two that tie: the oldest)
    assert pick(11, "high", "policy") == 6                     # two conditions beat one
    assert pick(11, "low", "standard") == 5
    assert pick(10, "high", "policy") == 2                     # Operations: its own; Support's are below it and do not apply upward
    assert pick(13, "low", "policy") == 1                      # Finance has only a switched-off rule: the whole organisation's
    assert pick(None, "critical", None) == 1                   # no unit: only the whole-organisation rules fit
    assert R.pick([], [10], "low", None, level) is None


# ── the flow ─────────────────────────────────────────────────────────────────

def test_review_then_approval_together_everyone_every_decision_kept(w):
    make_rule(w, steps=[step("review", [{"type": "user", "id": REV1}, {"type": "user", "id": REV2}], rule="any"),
                        step("approval", [{"type": "user", "id": APP1}, {"type": "user", "id": APP2}], rule="all", due_days=3)])
    eid = raise_exception(w)["id"]
    assert get(w, eid)["approval"] is None                                      # a draft has no run yet
    sub = submit(w, eid)
    assert sub.status_code == 200, sub.text
    s = sub.json()
    assert s["status"] == "pending_approval" and s["approval"]["current_step"] == 1 and s["approval"]["rule"]["name"] == "Rule"
    assert asked(w, eid) == [REV1, REV2]
    assert (s["can_decide"], s["can_withdraw"]) == (False, True)               # the requester
    assert get(w, eid, REV1)["can_decide"] is True and get(w, eid, APP1)["can_decide"] is False
    r = decide(w, eid, APP1)
    assert r.status_code == 403 and "It is not your turn: step 1 (Review) waits for Rev1, Rev2." == r.json()["detail"]
    ok = decide(w, eid, REV1, comments="Looks fine")
    assert ok.status_code == 200 and ok.json()["approval"]["current_step"] == 2 and asked(w, eid) == [APP1, APP2]   # any: one review is enough
    assert decide(w, eid, REV2).status_code == 403                              # step 1 is over
    mid = decide(w, eid, APP1, comments="Agreed").json()
    assert mid["status"] == "pending_approval" and asked(w, eid) == [APP2]       # everyone: the other is still asked
    assert decide(w, eid, APP1).status_code == 403                              # nobody decides twice
    done = decide(w, eid, APP2, comments="Approved by the second").json()
    assert (done["status"], done["approved_by"], done["approval_comments"], done["approval"]["status"]) == ("approved", APP2, "Approved by the second", "approved")
    assert [(d["step_position"], d["step_name"], d["user_name"], d["decision"], d["comment"]) for d in done["approval"]["decisions"]] == [
        (1, "Review", "Rev1", "approve", "Looks fine"), (2, "Approval", "App1", "approve", "Agreed"), (2, "Approval", "App2", "approve", "Approved by the second")]
    assert [s["state"] for s in done["approval"]["steps"]] == ["done", "done"] and done["approval"]["steps"][1]["due_days"] == 3
    comments = [c["comment"] for c in w.as_(ADMIN).get(f"{EX}/{eid}/comments").json()]
    assert comments == ["Approved (step 1, Review): Looks fine", "Approved (step 2, Approval): Agreed",
                        "Approved (step 2, Approval): Approved by the second"]
    hist = w.as_(REQ).get(f"{EX}/{eid}/approval").json()
    assert [(r["round"], r["status"], len(r["decisions"])) for r in hist["rounds"]] == [(1, "approved", 3)]
    notes = w.db.query(m.WorkflowNotification).all()
    assert {n.user_id for n in notes} >= {REV1, REV2, APP1, APP2, REQ}           # the asked were told, the requester at the end


def test_the_rule_binds_everyone_an_administrator_who_is_not_asked_cannot_decide_and_nobody_decides_their_own(w):
    make_rule(w, steps=[step(people=[{"type": "user", "id": APP1}, {"type": "user", "id": REQ}])])
    eid = raise_exception(w)["id"]
    submit(w, eid)
    assert asked(w, eid) == [APP1]                                              # the requester is taken out of the step
    for who in (ADMIN, EXCADMIN, APP2, REQ):                                    # holds the approve right or is the requester: not asked
        r = decide(w, eid, who)
        assert r.status_code == 403, who
    assert "It is not your turn: step 1 (Approval) waits for App1." in decide(w, eid, ADMIN).json()["detail"]
    assert decide(w, eid, REQ).json()["detail"] == svc.OWN
    assert get(w, eid)["status"] == "pending_approval"
    only_me = make_rule(w, name="Only the requester", steps=[step(people=[{"type": "user", "id": REQ}])], department_id=13)
    again = raise_exception(w, document_id=2)["id"]
    r = submit(w, again)
    assert r.status_code == 409 and "cannot start" in r.json()["detail"] and "Step 1 (Approval) has nobody who can decide" in r.json()["detail"]
    assert get(w, again)["status"] == "draft" and w.db.query(m.ExceptionApprovalRun).filter_by(exception_id=again).count() == 0
    assert only_me["department_path"] == ["Finance"]


def test_owner_of_the_unit_and_of_its_parent_are_read_from_the_departments(w):
    make_rule(w, steps=[step("review", [{"type": "unit_owner"}], order="in_turn"), step("approval", [{"type": "parent_owner"}])], department_id=10)
    eid = raise_exception(w, document_id=1)["id"]                               # the policy sits in Support: owner Sup, its parent Operations: owner Ops
    assert submit(w, eid).status_code == 200
    assert asked(w, eid) == [SUP]
    assert [s["slots"][0]["label"] for s in get(w, eid)["approval"]["steps"]] == ["Owner of Support", "Owner of Operations"]
    decide(w, eid, SUP)
    assert asked(w, eid) == [OPS]
    assert decide(w, eid, OPS).json()["status"] == "approved"
    helpdesk = raise_exception(w, document_id=4)["id"]                          # Helpdesk has no owner: nobody to ask at step 1
    r = submit(w, helpdesk)
    assert r.status_code == 409 and "Owner of Helpdesk (none set)" in r.json()["detail"]
    top = raise_exception(w, document_id=3, department_id=10)["id"]            # a top department has no parent: the second step has nobody
    r = submit(w, top)
    assert r.status_code == 409 and "Step 2 (Approval) has nobody who can decide: Owner of the parent department" in r.json()["detail"]


def test_which_rule_an_exception_follows_unit_inheritance_priority_policy_kind_and_the_exceptions_own_department(w):
    make_rule(w, name="Organisation", steps=[step(people=[{"type": "user", "id": APP1}])])
    make_rule(w, name="Operations", steps=[step(people=[{"type": "user", "id": APP2}])], department_id=10)
    make_rule(w, name="Support critical", steps=[step(people=[{"type": "user", "id": APP3}])], department_id=11, priorities=["critical"])
    used = {}
    for label, kw in [("helpdesk-low", {"document_id": 4}), ("support-critical", {"document_id": 1, "priority": "critical"}),
                      ("finance", {"document_id": 2}), ("no-unit", {"document_id": 3}), ("own-department", {"document_id": 3, "department_id": 12}),
                      ("own-beats-policy", {"document_id": 2, "department_id": 10})]:
        eid = raise_exception(w, **kw)["id"]
        assert submit(w, eid).status_code == 200, label
        used[label] = (get(w, eid)["approval"]["rule"]["name"], asked(w, eid))
    assert used == {"helpdesk-low": ("Operations", [APP2]), "support-critical": ("Support critical", [APP3]), "finance": ("Organisation", [APP1]),
                    "no-unit": ("Organisation", [APP1]), "own-department": ("Operations", [APP2]), "own-beats-policy": ("Operations", [APP2])}
    plain = raise_exception(w, document_id=3)
    assert plain["department_id"] is None and plain["department_path"] == [] and plain["department_inherited"] is False
    inherited = raise_exception(w, document_id=1)
    assert (inherited["department_path"], inherited["department_inherited"]) == (["Operations", "Support"], True)


def test_someone_asked_who_may_not_read_the_policy_still_sees_the_unit_the_rule_was_chosen_for(w):
    make_rule(w, steps=[step(people=[{"type": "user", "id": APP1}])], department_id=10)
    eid = raise_exception(w, document_id=1)["id"]                                # the policy sits in Support, under Operations
    submit(w, eid)
    seen = get(w, eid, APP1)                                                     # APP1 holds no library right: the policy's title stays hidden
    assert seen["document_title"] is None
    assert seen["department_path"] == ["Operations", "Support"] and seen["department_inherited"] is True and seen["department_id"] is None


def test_in_turn_asks_one_after_another_and_at_least_counts_different_people(w):
    make_rule(w, steps=[step("review", [{"type": "user", "id": REV1}, {"type": "user", "id": REV2}], order="in_turn"),
                        step("approval", [{"type": "user", "id": APP1}, {"type": "user", "id": APP2}, {"type": "user", "id": APP3}], rule="at_least", min_count=2)])
    eid = raise_exception(w)["id"]
    submit(w, eid)
    assert asked(w, eid) == [REV1]
    assert decide(w, eid, REV2).status_code == 403                              # not yet
    decide(w, eid, REV1)
    assert asked(w, eid) == [REV2]
    decide(w, eid, REV2)
    assert asked(w, eid) == [APP1, APP2, APP3] and get(w, eid)["approval"]["steps"][1]["progress"] == {"required": 2, "answered": 0}
    assert decide(w, eid, APP3).json()["status"] == "pending_approval"
    assert asked(w, eid) == [APP1, APP2]
    assert decide(w, eid, APP1).json()["status"] == "approved"                   # two different people approved


def test_a_role_asks_whoever_holds_it_and_one_of_them_answers_for_it(w):
    make_rule(w, steps=[step("approval", [{"type": "role", "id": 3}, {"type": "user", "id": REV1}])])
    eid = raise_exception(w)["id"]
    submit(w, eid)
    assert asked(w, eid) == [REV1, APP1, APP2, APP3]
    decide(w, eid, APP2)
    assert asked(w, eid) == [REV1]                                              # the role has answered through APP2
    assert decide(w, eid, REV1).json()["status"] == "approved"


def test_asking_for_changes_sends_it_back_a_new_submission_is_a_new_round_and_history_keeps_both(w):
    make_rule(w, steps=[step("review", [{"type": "user", "id": REV1}]), step("approval", [{"type": "user", "id": APP1}])])
    eid = raise_exception(w)["id"]
    submit(w, eid)
    decide(w, eid, REV1)
    r = decide(w, eid, APP1, what="changes")
    assert r.status_code == 400 and "comment is required" in r.json()["detail"]
    r = decide(w, eid, APP1, what="changes", comment="Add the compensating control")
    assert r.status_code == 200 and r.json()["status"] == "draft" and r.json()["approval"]["status"] == "changes_requested"
    assert [n.user_id for n in w.db.query(m.WorkflowNotification).filter(m.WorkflowNotification.subject.like("Changes asked for%"))] == [REQ]
    assert w.as_(REQ).put(f"{EX}/{eid}", json={"compensating_controls": "Weekly manual restore test", "priority": "high"}).status_code == 200
    again = submit(w, eid)
    assert again.status_code == 200 and again.json()["approval"]["round"] == 2 and asked(w, eid) == [REV1]   # the rules start again
    decide(w, eid, REV1)
    assert decide(w, eid, APP1).json()["status"] == "approved"
    hist = w.as_(REQ).get(f"{EX}/{eid}/approval").json()
    assert [(r["round"], r["status"], [(d["step_name"], d["decision"]) for d in r["decisions"]]) for r in hist["rounds"]] == [
        (1, "changes_requested", [("Review", "approve"), ("Approval", "changes")]), (2, "approved", [("Review", "approve"), ("Approval", "approve")])]
    assert "Changes asked for (step 2, Approval): Add the compensating control" in [c["comment"] for c in w.as_(ADMIN).get(f"{EX}/{eid}/comments").json()]


def test_reject_needs_a_step_that_allows_it_and_a_reason_a_review_does_not_reject_unless_told_to(w):
    make_rule(w, steps=[step("review", [{"type": "user", "id": REV1}]), step("approval", [{"type": "user", "id": APP1}])])
    eid = raise_exception(w)["id"]
    submit(w, eid)
    r = decide(w, eid, REV1, what="reject", reason="No")
    assert r.status_code == 409 and "cannot reject" in r.json()["detail"]
    decide(w, eid, REV1)
    assert decide(w, eid, APP1, what="reject").status_code == 400                # a reason is required
    out = decide(w, eid, APP1, what="reject", rejection_reason="Patch first").json()
    assert (out["status"], out["rejected_by"], out["rejection_reason"], out["approval"]["status"]) == ("rejected", APP1, "Patch first", "rejected")
    assert decide(w, eid, APP1).status_code == 400                                 # nothing waits any more: only pending ones are decided
    assert w.as_(REQ).put(f"{EX}/{eid}", json={"title": "x"}).status_code == 409
    make_rule(w, name="Strict", steps=[step("review", [{"type": "user", "id": REV1}], allow_reject=True, allow_changes=False),
                                       step("approval", [{"type": "user", "id": APP1}], allow_reject=False)], department_id=13)
    e2 = raise_exception(w, document_id=2)["id"]
    submit(w, e2)
    assert decide(w, e2, REV1, what="changes", comment="x").status_code == 409
    assert decide(w, e2, REV1, what="reject", reason="Not acceptable").json()["status"] == "rejected"


def test_withdrawing_and_the_edits_that_wait_for_it(w):
    make_rule(w, steps=[step()])
    eid = raise_exception(w)["id"]
    submit(w, eid)
    assert w.as_(REQ).put(f"{EX}/{eid}", json={"title": "Skip nightly backups"}).status_code == 200      # text may change while it waits
    for field, value in [("priority", "critical"), ("department_id", 13), ("document_id", 2)]:
        r = w.as_(REQ).put(f"{EX}/{eid}", json={field: value})
        assert r.status_code == 409 and r.json()["detail"] == svc.LOCKED, field
    assert w.as_(REQ).put(f"{EX}/{eid}", json={"priority": "MEDIUM", "document_id": 1}).status_code == 200  # the same value is not a change
    assert w.as_(APP1).post(f"{EX}/{eid}/withdraw").status_code == 403                                  # not his to change
    wd = w.as_(REQ).post(f"{EX}/{eid}/withdraw")
    assert wd.status_code == 200 and wd.json()["status"] == "draft" and wd.json()["approval"]["status"] == "withdrawn"
    assert decide(w, eid, APP1).status_code == 400                                                      # a draft: nothing to decide
    assert w.as_(REQ).put(f"{EX}/{eid}", json={"priority": "critical"}).status_code == 200              # a draft again: free
    assert w.as_(REQ).post(f"{EX}/{eid}/withdraw").status_code == 409


def test_a_rule_changed_or_deleted_later_never_changes_an_exception_already_waiting(w):
    rule = make_rule(w, steps=[step(people=[{"type": "user", "id": APP1}])])
    eid = raise_exception(w)["id"]
    submit(w, eid)
    body = {k: rule[k] for k in ("name", "department_id", "priorities", "doc_types")}
    w.as_(SETTER).put(f"{RULES}/{rule['id']}", json={**body, "name": "Renamed", "steps": [step(people=[{"type": "user", "id": APP2}])]})
    assert asked(w, eid) == [APP1] and get(w, eid)["approval"]["rule"]["name"] == "Rule"
    w.as_(SETTER).delete(f"{RULES}/{rule['id']}")
    assert asked(w, eid) == [APP1] and decide(w, eid, APP1).json()["status"] == "approved"
    after = raise_exception(w)["id"]                                             # no rule now: the older flow
    assert submit(w, after).json()["approval"] is None


def test_without_a_rule_the_older_flow_is_exactly_as_before(w):
    eid = raise_exception(w)["id"]
    s = submit(w, eid).json()
    assert s["status"] == "pending_approval" and s["approval"] is None and s["can_withdraw"] is False
    assert w.db.query(m.ExceptionApprovalRun).count() == 0
    assert get(w, eid, APP1)["can_decide"] is True and get(w, eid, ADMIN)["can_decide"] is True   # the approve right (administrators hold it)
    assert get(w, eid, REQ)["can_decide"] is False
    r = decide(w, eid, REQ)
    assert r.status_code == 403
    assert decide(w, eid, APP1, comments="ok").json()["status"] == "approved"
    assert w.as_(APP1).post(f"{EX}/{eid}/request-changes", json={"comment": "x"}).status_code == 409
    assert w.as_(REQ).post(f"{EX}/{eid}/withdraw").status_code == 409


def test_waiting_for_me_lists_only_what_waits_for_this_person_now(w):
    make_rule(w, steps=[step("review", [{"type": "user", "id": REV1}]), step("approval", [{"type": "user", "id": APP1}])])
    one, two = raise_exception(w)["id"], raise_exception(w)["id"]
    submit(w, one), submit(w, two)
    mine = lambda who: sorted(e["id"] for e in w.as_(who).get(f"{EX}/waiting-for-me").json())
    assert (mine(REV1), mine(APP1), mine(REQ), mine(ADMIN)) == ([one, two], [], [], [])
    decide(w, one, REV1)
    assert (mine(REV1), mine(APP1)) == ([two], [one])
    decide(w, one, APP1)
    assert mine(APP1) == []
    assert w.as_(REV1).get(f"{EX}/waiting-for-me").json()[0]["approval"]["my_step"] == {
        "position": 1, "name": "Review", "kind": "review", "can_reject": False, "can_ask_changes": True}


def test_the_department_of_an_exception_is_checked_and_who_may_see_how_it_was_approved(w):
    r = w.as_(REQ).post(EX, json={"title": "x", "justification": "y", "department_id": 90})
    assert r.status_code == 400 and "does not exist" in r.json()["detail"]
    r = w.as_(REQ).post(EX, json={"title": "x", "justification": "y", "department_id": 14})
    assert r.status_code == 400 and "is not active" in r.json()["detail"]
    ok = w.as_(REQ).post(EX, json={"title": "x", "justification": "y", "department_id": 12}).json()
    assert ok["department_id"] == 12 and ok["department_path"] == ["Operations", "Support", "Helpdesk"]
    assert w.as_(REQ).put(f"{EX}/{ok['id']}", json={"department_id": 13}).json()["department_path"] == ["Finance"]
    assert w.as_(REQ).put(f"{EX}/{ok['id']}", json={"department_id": None}).json()["department_id"] is None
    make_rule(w, steps=[step()])
    eid = raise_exception(w)["id"]
    submit(w, eid)
    decide(w, eid, APP1)
    for who, code in [(PLAIN, 403), (REQ, 200), (APP1, 200), (ADMIN, 200), (EXCADMIN, 200), (REV1, 403)]:
        assert w.as_(who).get(f"{EX}/{eid}/approval").status_code == code, who


def test_preview_says_which_rule_applies_who_each_step_asks_and_what_would_stop_it(w):
    make_rule(w, name="Support", steps=[step("review", [{"type": "unit_owner"}]), step("approval", [{"type": "role", "id": 3}])], department_id=11)
    p = w.as_(SETTER).post(f"{RULES}/preview", json={"department_id": 12, "priority": "high"}).json()
    assert p["rule"]["name"] == "Support"
    assert [[(s["label"], s["members"]) for s in st["slots"]] for st in p["steps"]] == [
        [("Owner of Helpdesk (none set)", [])], [("Role: Approvers", [APP1, APP2, APP3])]]
    assert p["problems"] == ["Step 1 (Review) has nobody who can decide: Owner of Helpdesk (none set) for Helpdesk."]
    ok = w.as_(SETTER).post(f"{RULES}/preview", json={"department_id": 11}).json()           # Support has an owner
    assert ok["problems"] == [] and ok["steps"][0]["slots"][0] | {"members": None} == {
        "key": f"unit_owner:11", "type": "unit_owner", "ref": None, "label": "Owner of Support", "members": None}
    none = w.as_(SETTER).post(f"{RULES}/preview", json={"department_id": 13}).json()
    assert none == {"rule": None, "steps": [], "problems": []}
    assert w.as_(SETTER).post(f"{RULES}/preview", json={"department_id": 90}).status_code == 400


def test_an_overdue_step_says_so_and_a_stalled_step_says_nobody_can_act(w):
    make_rule(w, steps=[step("approval", [{"type": "user", "id": APP1}], due_days=2)])
    eid = raise_exception(w)["id"]
    submit(w, eid)
    run = w.db.query(m.ExceptionApprovalRun).filter_by(exception_id=eid).one()
    steps = copy.deepcopy(run.steps)
    steps[0]["due_at"] = (datetime.utcnow() - timedelta(days=1)).isoformat()
    run.steps = steps
    w.db.commit()
    seen = get(w, eid)["approval"]
    assert seen["steps"][0]["overdue"] is True and seen["stalled"] is False
    w.db.get(m.GRCUser, APP1).is_active = False                                   # the only person left: the run waits for nobody
    run.asked = []
    w.db.commit()
    assert get(w, eid)["approval"]["stalled"] is True


def test_rules_and_runs_stay_inside_their_organisation_and_a_get_writes_nothing(w):
    w.db.add(m.ExceptionApprovalRule(tenant_id=2, name="Theirs", steps=[{"position": 1, "name": "Approval", "kind": "approval", "order": "together",
                                                                       "rule": "all", "people": [{"type": "user", "id": APP2}]}]))
    w.db.commit()
    assert w.as_(SETTER).get(RULES).json()["rules"] == []
    assert w.as_(SETTER).put(f"{RULES}/1", json={"name": "x", "steps": [step()]}).status_code == 404
    assert w.as_(SETTER).delete(f"{RULES}/1").status_code == 404
    eid = raise_exception(w)["id"]
    assert submit(w, eid).json()["approval"] is None                              # the other organisation's rule never applies
    make_rule(w)
    eid2 = raise_exception(w)["id"]
    submit(w, eid2)
    counts = lambda: tuple(w.db.query(model).count() for model in (m.ExceptionApprovalRun, m.ExceptionApprovalDecision, m.ExceptionApprovalRule,
                                                                    m.PolicyExceptionComment, m.WorkflowNotification))
    before = counts()
    for who in (ADMIN, REQ, APP1):
        for path in (EX, f"{EX}/{eid2}", f"{EX}/waiting-for-me", f"{EX}/{eid2}/approval", RULES):
            assert w.as_(who).get(path).status_code in (200, 403)
    assert counts() == before
