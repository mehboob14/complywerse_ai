"""Who sees which Task Management task (the user's rule of 2026-10-21): a person sees the tasks they take part in - its owner, one
of its assignees, its reviewer or whoever created it. Administrators (``auth_router.is_tenant_admin``) and whoever holds
``critical_tasks:tasks:view_all`` (Administration > Roles > Critical Tasks > Task Board > "view all") see every task.

A document request's task stays the asked person's own: whoever sent the request (its creator) and a reviewer set by hand are not
asked, so they do not see it; someone who sees every task sees another person's as the document rule allows
(``doc_lifecycle.without_others_tasks`` in lists, ``doc_lifecycle.may_see_task`` opened by its link).

Every query that reads tasks for a person is cut here, in SQL (never in Python after a page is cut): the board and its counts,
the reports, bulk actions, the AI's input, a task opened by its id, the reports module's task dataset and the record pickers."""
from sqlalchemy import cast, exists, func, or_
from sqlalchemy.dialects.postgresql import JSONB

from ..models import CriticalTask

VIEW_ALL = "critical_tasks:tasks:view_all"


def sees_all(db, user) -> bool:
    """An administrator, or a platform-given role holds ``view_all``."""
    from ..routers.auth_router import has_tenant_permission

    return has_tenant_permission(db, user, VIEW_ALL)


def assigned_to(db, user_id: int):
    """SQL: the person is in the task's assignee list, a JSON array of ids (jsonb containment on Postgres, json_each on SQLite)."""
    if db.get_bind().dialect.name == "postgresql":
        return cast(CriticalTask.assigned_user_ids, JSONB).contains([user_id])
    each = func.json_each(CriticalTask.assigned_user_ids).table_valued("value")
    return exists().select_from(each).where(each.c.value == user_id)


def takes_part(db, user_id: int):
    """SQL: the person is the task's owner, one of its assignees, its reviewer or whoever created it."""
    T = CriticalTask
    return or_(T.assigned_owner_id == user_id, T.reviewer_id == user_id, T.created_by_id == user_id, assigned_to(db, user_id))


def _own(db, user, query):
    """The tasks of ``query`` the person takes part in (of a document request's task, only the person asked)."""
    from ..modules.governance import doc_lifecycle

    return doc_lifecycle.without_others_tasks(query.filter(takes_part(db, user.id)), user)


def scope(db, user):
    """``(cut, everyone)``: ``cut(query)`` keeps the tasks of a query (of tasks, or joined to them) the person may see, and
    ``everyone`` says whether that is every task. One look at the person's rights, so a report cuts all its queries with it."""
    from ..modules.governance import doc_lifecycle, permissions

    if not sees_all(db, user):
        return (lambda query: _own(db, user, query)), False
    reads_all = permissions.visible_filter(db, user) is None         # reads every document: other people's document tasks too
    return (lambda query: doc_lifecycle.without_others_tasks(query, user, reads_all)), True


def visible(db, user, query):
    """``query`` cut to the tasks the person may see."""
    return scope(db, user)[0](query)


def may_see(db, user, task) -> bool:
    """``visible`` for one task opened by its id or link; someone who sees every task opens another person's document task when
    they may read the document, as before (``doc_lifecycle.may_see_task``)."""
    from ..modules.governance import doc_lifecycle

    if sees_all(db, user):
        return doc_lifecycle.may_see_task(db, user, task)
    return _own(db, user, db.query(CriticalTask.id).filter(CriticalTask.id == task.id)).first() is not None
