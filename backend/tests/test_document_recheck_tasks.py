"""The QA re-check's last defects in Task Management (2026-10-19): its reports count only the tasks the person's board shows; a
review, approval or acknowledgement request makes a task only for someone who may open Task Management, and only they are told it
is in their tasks; every request's alert opens the person's own step (?act=ack / ?act=sign)."""
import importlib

import grc.models as m
from grc.modules.governance import doc_lifecycle as life

from test_document_lifecycle import _secret, alerts, doc, obligations, participants, signoff, tasks, user, world  # noqa: F401
from test_document_tasks import http, manual_task  # noqa: F401  (http is a fixture)

critical_tasks_router = importlib.import_module("grc.routers.critical_tasks_router")


def test_the_task_reports_count_only_the_tasks_the_board_shows(http):
    db = http.db
    participants(db)
    signoff.send_for_review(5, db, user(db, 1))                # a draft: Rana (2) and Rafay (3) are asked, with tasks
    manual_task(db)                                            # Uma's own task
    http.me["u"] = 6                                           # Uma reads no drafts
    board = http.get("/critical-tasks").json()
    summary = http.get("/critical-tasks/reports/summary").json()
    assert board["total"] == summary["total"] == sum(summary["by_status"].values()) == sum(summary["by_source"].values()) == 1
    assert summary["owner_workload"] == {"Uma User": 1} and sum(s["total"] for s in summary["completion_by_source"].values()) == 1
    http.me["u"] = 7                                           # an administrator reads every document: every task
    assert http.get("/critical-tasks/reports/summary").json()["total"] == 1 + len(tasks(db)) == 3


def test_only_people_who_open_task_management_get_a_task_and_are_told_so(world):
    with world.factory() as db:
        for uid in (3, 6, 7):                                  # Rafay, Uma and Adam hold no task right of their own
            db.query(m.UserRole).filter_by(user_id=uid, role_id=900).delete()
        db.commit()
        participants(db)
        signoff.send_for_review(5, db, user(db, 1))
        assert {o.user_id: bool(o.critical_task_id) for o in obligations(db, "review")} == {2: True, 3: False}
        assert alerts(db, 2)[-1].message.endswith("It is in your tasks and in the document's Approvals.")
        assert alerts(db, 3)[-1].message.endswith("It is in the document's Approvals.") and "tasks" not in alerts(db, 3)[-1].message
        assert alerts(db, 3)[-1].link == alerts(db, 2)[-1].link == "/governance/documents/5?act=sign"      # opens the step
        d = doc(db)
        d.status = "published"
        life.ensure_acknowledgements(db, d, 1)
        db.commit()
        asked = {o.user_id: bool(o.critical_task_id) for o in obligations(db, "acknowledgement")}
        assert asked == {1: True, 2: True, 3: False, 4: True, 5: True, 6: False, 7: True}      # an administrator always may
        assert alerts(db, 6)[-1].message.endswith("before the due date.") and "tasks" not in alerts(db, 6)[-1].message
        assert alerts(db, 2)[-1].message.endswith("; it is in your tasks.")
        assert alerts(db, 6)[-1].link == "/governance/documents/5?act=ack"
        assert life._link(d) == "/governance/documents/5?tab=lifecycle"                       # what is not a request opens its Approvals
