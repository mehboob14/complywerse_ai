"""The organisation's only administrator may decide their own exception (DECISIONS D62, the user's answer of 2026-11-06): nobody decides their own
request, except where nobody else could. Over HTTP through the whole governance router on in-memory SQLite (``_exc_world``).

* alone = an administrator and nobody else is an administrator or holds the right to approve exceptions;
* the older flow (no rule): the lone administrator approves, rejects and records risks on their own exception; the history line says so;
* under a rule: a step that names only them is no longer refused at submit; they are asked, record their assessment and approve; the history says so;
* everyone else keeps the old rule: another administrator or approver in the organisation, a requester who is not an administrator, a step that
  names somebody else.
"""
from _exc_world import ADMIN, APP1, EX, REQ, SEEN, _schema, assess, decide, get, make_rule, raise_exception, step, submit, w  # noqa: F401

import grc.models as m  # noqa: E402
from grc.modules.governance import exception_approvals as svc  # noqa: E402


def alone(w):
    """The organisation as a one-administrator office: nobody but ADMIN is an administrator or holds the approve right."""
    w.db.query(m.UserRole).filter(m.UserRole.role_id.in_([3, 6])).delete(synchronize_session=False)       # Approvers, Exception admins
    w.db.commit()


def history(w, eid):
    return [c.comment for c in w.db.query(m.PolicyExceptionComment).filter_by(exception_id=eid).order_by(m.PolicyExceptionComment.id)]


def test_the_only_administrator_approves_their_own_exception_in_the_older_flow_and_the_history_says_so(w):
    alone(w)
    assert svc.lone_decider_for(w.db, ADMIN) is True and svc.lone_decider_for(w.db, REQ) is False
    eid = raise_exception(w, as_user=ADMIN)["id"]
    assert submit(w, eid, ADMIN).status_code == 200 and get(w, eid)["status"] == "pending_approval"
    assert w.as_(ADMIN).post(f"{EX}/{eid}/risks", json={"none_identified": True}).status_code == 201       # they may record what could go wrong, too
    r = w.as_(ADMIN).post(f"{EX}/{eid}/approve", json={"comments": "Only I can decide"})
    assert r.status_code == 200 and get(w, eid)["status"] == "approved"
    assert any("Approved by the requester, as nobody else could decide" in line for line in history(w, eid))


def test_with_another_administrator_or_approver_nobody_decides_their_own_in_the_older_flow(w):
    eid = raise_exception(w, as_user=ADMIN)["id"]                                                           # APP1 and the others hold the approve right
    assert submit(w, eid, ADMIN).status_code == 200
    r = w.as_(ADMIN).post(f"{EX}/{eid}/approve", json={})
    assert r.status_code == 403 and "someone else" in r.json()["detail"]
    alone(w)
    w.db.add(m.UserRole(user_id=APP1, role_id=1, tenant_id=1, source=None))                                 # a second administrator
    w.db.commit()
    assert svc.lone_decider_for(w.db, ADMIN) is False
    assert w.as_(ADMIN).post(f"{EX}/{eid}/approve", json={}).status_code == 403
    assert get(w, eid)["status"] == "pending_approval"


def test_a_requester_who_is_not_an_administrator_never_decides_their_own(w):
    alone(w)
    w.db.add(m.UserRole(user_id=REQ, role_id=3, tenant_id=1, source=None))                                  # holds the approve right, but is not an administrator
    w.db.commit()
    eid = raise_exception(w, as_user=REQ)["id"]
    assert submit(w, eid, REQ).status_code == 200
    r = w.as_(REQ).post(f"{EX}/{eid}/approve", json={})
    assert r.status_code == 403 and "someone else" in r.json()["detail"]
    assert w.as_(ADMIN).post(f"{EX}/{eid}/approve", json={}).status_code == 200                             # the administrator, who did not ask for it, decides


def test_under_a_rule_a_step_that_names_only_the_lone_administrator_starts_and_they_decide_it(w):
    alone(w)
    make_rule(w, name="Only me", steps=[step(people=[{"type": "user", "id": ADMIN}])])
    eid = raise_exception(w, as_user=ADMIN)["id"]
    r = submit(w, eid, ADMIN)
    assert r.status_code == 200, r.text
    run = w.db.query(m.ExceptionApprovalRun).filter_by(exception_id=eid).one()
    assert run.asked == [ADMIN] and [s.get("self") for s in run.steps[0]["slots"]] == [True]
    assert w.as_(ADMIN).post(f"{EX}/{eid}/approve", json={}).status_code == 400                             # still needs their own assessment first
    assert decide(w, eid, ADMIN, comments="Decided alone").status_code == 200
    assert get(w, eid)["status"] == "approved"
    assert any("by the requester, as nobody else could decide" in line for line in history(w, eid))


def test_under_a_rule_the_requester_is_still_refused_when_somebody_else_could_decide(w):
    alone(w)
    make_rule(w, name="Me or Ann", steps=[step(people=[{"type": "user", "id": ADMIN}, {"type": "user", "id": APP1}])])
    eid = raise_exception(w, as_user=ADMIN)["id"]
    assert submit(w, eid, ADMIN).status_code == 200
    run = w.db.query(m.ExceptionApprovalRun).filter_by(exception_id=eid).one()
    assert run.asked == [APP1] and not any(s.get("self") for s in run.steps[0]["slots"])                    # the step has somebody: the requester is taken out as before
    r = decide(w, eid, ADMIN)
    assert r.status_code == 403 and r.json()["detail"] == svc.OWN
    w.db.query(m.UserRole).delete()                                                                         # and with a second administrator a step naming only them is refused at submit
    w.db.add(m.UserRole(user_id=ADMIN, role_id=1, tenant_id=1, source=None))
    w.db.add(m.UserRole(user_id=APP1, role_id=1, tenant_id=1, source=None))
    w.db.commit()
    make_rule(w, name="Only me, Finance", steps=[step(people=[{"type": "user", "id": ADMIN}])], department_id=13, as_user=ADMIN)
    again = raise_exception(w, document_id=2, as_user=ADMIN)["id"]
    r = submit(w, again, ADMIN)
    assert r.status_code == 409 and "has nobody who can decide" in r.json()["detail"]
