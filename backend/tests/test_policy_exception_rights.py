"""Policy exceptions, enforced by the server: raising one needs the create right; changing or submitting one is for its requester
(with the create right) or the edit right, and only while it is a draft or pending; deciding one (approve, reject, revoke) needs the
approve right and is never for the person who requested it, administrators included; what the approver and the revoker wrote is
kept on the exception and in its comments; and the list never shows the title of a document the person may not open - nor does
the report builder's documents dataset. Over HTTP through the whole governance router, on in-memory SQLite."""
import importlib
from datetime import datetime

import grc.models as m
from grc.modules.governance import permissions

from test_document_read_access import VIEWER, as_, reads  # noqa: F401  (reads is a fixture)
from test_governance_permissions import ADMIN, AUTHOR, CONTACT, EDITOR, OWNER, PUBLISHER, SAM, doc, world  # noqa: F401

pe = importlib.import_module("grc.routers.policy_exception_router")       # the module, not the router (PITFALLS 46)
API = "/governance/policy-exceptions"
AUDITOR = 16                                                               # the Auditor Portal's right, no library right


def _rights(db):
    """Sam may request and approve exceptions, Pat may approve them, Eddie may edit them; nobody else holds an exception right."""
    for pid, action in [(60, "create"), (61, "approve"), (62, "edit")]:
        name = f"governance:policy_exceptions:{action}"
        db.add(m.Permission(id=pid, name=name, resource="governance:policy_exceptions", action=action))
        db.add(m.Role(id=pid, tenant_id=1, name=f"Exception {action}"))
        db.add(m.RolePermission(role_id=pid, permission_id=pid))
    for uid, rid in [(SAM, 60), (SAM, 61), (PUBLISHER, 61), (EDITOR, 62)]:
        db.add(m.UserRole(user_id=uid, role_id=rid, tenant_id=1))
    db.commit()


def _comments(http, eid):
    return [(c["user_id"], c["comment"]) for c in http.get(f"{API}/{eid}/comments").json()]


def test_raising_changing_and_deciding_an_exception_each_need_their_right_and_nobody_decides_their_own(world):
    db, http, me = world.db, world.http, world.me
    me["id"] = AUTHOR                                                      # holds no exception right
    r = http.post(API, json={"title": "Skip backups", "document_id": 6, "justification": "x"})
    assert r.status_code == 403 and r.json()["detail"] == pe.CREATE_REFUSED
    _rights(db)

    me["id"] = SAM
    made = http.post(API, json={"title": "Skip backups", "document_id": 6, "justification": "Legacy box",
                                "expiry_date": "2027-01-01T00:00:00"})
    assert made.status_code == 201, made.text
    eid, mine = made.json()["id"], made.json()
    assert (mine["can_edit"], mine["can_delete"], mine["can_decide"]) == (True, True, False)     # his own: never his to decide

    me["id"] = AUTHOR                                                      # not hers, no right: changes nothing
    for method, path, kw in [("put", f"{API}/{eid}", {"json": {"title": "Changed"}}), ("post", f"{API}/{eid}/submit", {}),
                             ("post", f"{API}/{eid}/comments", {"json": {"comment": "hi"}}), ("delete", f"{API}/{eid}", {}),
                             ("post", f"{API}/{eid}/approve", {"json": {}})]:
        r = getattr(http, method)(path, **kw)
        assert r.status_code == 403, (method, path, r.text)
    me["id"] = EDITOR                                                      # the edit right changes anyone's request
    assert http.put(f"{API}/{eid}", json={"justification": "Legacy box, isolated"}).status_code == 200
    me["id"] = SAM
    assert http.post(f"{API}/{eid}/submit").json()["status"] == "pending_approval"
    assert http.put(f"{API}/{eid}", json={"title": "Skip nightly backups"}).status_code == 200   # pending: still his to change
    r = http.post(f"{API}/{eid}/approve", json={"comments": "fine"})
    assert r.status_code == 403 and r.json()["detail"] == pe.OWN_REFUSED                           # he holds the approve right too
    me["id"] = EDITOR
    r = http.post(f"{API}/{eid}/reject", json={"rejection_reason": "no"})
    assert r.status_code == 403 and r.json()["detail"] == pe.DECIDE_REFUSED

    me["id"] = ADMIN                                                       # an administrator requests one: not his to approve either
    own = http.post(API, json={"title": "Old TLS", "document_id": 5, "justification": "Vendor"}).json()["id"]
    http.post(f"{API}/{own}/submit")
    r = http.post(f"{API}/{own}/approve", json={})
    assert r.status_code == 403 and r.json()["detail"] == pe.OWN_REFUSED
    assert db.get(m.PolicyException, own).status == "pending_approval"

    me["id"] = PUBLISHER                                                   # someone else with the approve right decides
    seen = http.get(f"{API}/{eid}").json()
    assert (seen["can_decide"], seen["can_edit"]) == (True, False)
    ok = http.post(f"{API}/{eid}/approve", json={"comments": "Isolated network; review in March"}).json()
    assert (ok["status"], ok["approval_comments"], ok["approver_name"]) == ("approved", "Isolated network; review in March", "Pat Publisher")
    assert _comments(http, eid)[-1] == (PUBLISHER, "Approved: Isolated network; review in March")
    assert http.post(f"{API}/{own}/approve").json()["approval_comments"] is None                  # no words: none kept
    assert _comments(http, own)[-1] == (PUBLISHER, "Approved.")

    for who in (SAM, EDITOR, ADMIN):                                       # what was approved is not changed afterwards
        me["id"] = who
        r = http.put(f"{API}/{eid}", json={"expiry_date": "2030-01-01T00:00:00", "title": "Wider"})
        assert r.status_code == 409 and r.json()["detail"] == pe.APPROVED_LOCKED, who
    db.expire_all()
    e = db.get(m.PolicyException, eid)
    assert (e.expiry_date, e.title) == (datetime(2027, 1, 1), "Skip nightly backups")

    me["id"] = SAM
    r = http.post(f"{API}/{eid}/revoke", json={"reason": "mine"})
    assert r.status_code == 403 and r.json()["detail"] == pe.OWN_REFUSED
    me["id"] = PUBLISHER
    gone = http.post(f"{API}/{eid}/revoke", json={"reason": "The box was replaced"}).json()
    assert (gone["status"], gone["revocation_reason"], gone["revoker_name"]) == ("revoked", "The box was replaced", "Pat Publisher")
    assert gone["closed_at"] and _comments(http, eid)[-1] == (PUBLISHER, "Revoked: The box was replaced")
    me["id"] = SAM
    r = http.put(f"{API}/{eid}", json={"title": "Again"})
    assert r.status_code == 409 and "revoked and can no longer be changed" in r.json()["detail"]

    again = http.post(API, json={"title": "Skip patching", "document_id": 6, "justification": "Freeze"}).json()["id"]
    http.post(f"{API}/{again}/submit")
    me["id"] = PUBLISHER
    http.post(f"{API}/{again}/reject", json={"rejection_reason": "Patch first"})
    assert _comments(http, again)[-1] == (PUBLISHER, "Rejected: Patch first")
    assert http.post(f"{API}/{again}/comments", json={"comment": "Ask the vendor"}).status_code == 201   # deciders comment too


def test_the_list_never_shows_the_title_of_a_document_the_person_may_not_open(reads):
    db = reads.db
    db.add(m.GRCUser(id=AUDITOR, username="aud", email="aud@cfsb.test", display_name="Audrey Auditor"))
    db.add(m.Permission(id=63, name="compliance:frameworks:view", resource="compliance:frameworks", action="view"))
    db.add(m.Role(id=63, tenant_id=1, name="Auditors"))
    db.add(m.RolePermission(role_id=63, permission_id=63))
    db.add(m.UserRole(user_id=AUDITOR, role_id=63, tenant_id=1))
    db.add(m.PolicyException(id=1, tenant_id=1, document_id=5, title="Old TLS", status="approved", requested_by=OWNER,
                             expiry_date=datetime(2099, 1, 1)))
    db.commit()

    def titles(who):
        http = as_(reads, who)
        return (http.get(API).json()[0]["document_title"], http.get(f"{API}/1").json()["document_title"])

    assert titles(VIEWER) == (None, None)                                  # a draft never published: not for library readers
    assert titles(SAM) == (None, None)
    assert titles(OWNER) == ("Access policy", "Access policy") and titles(ADMIN) == ("Access policy", "Access policy")
    assert titles(AUDITOR) == ("Access policy", "Access policy")           # auditors open any document from the portal

    for who in (VIEWER, SAM, OWNER, ADMIN, AUDITOR):                       # readable_among is can_read, for many at once
        user = db.get(m.GRCUser, who)
        assert permissions.readable_among(db, user, [5, 6, None]) == {d for d in (5, 6) if permissions.can_read(db, user, doc(reads, d))}, who

    _rights(db)
    db.add(m.UserRole(user_id=VIEWER, role_id=60, tenant_id=1))           # Vera may raise exceptions, but not against a draft she cannot open
    db.commit()
    r = as_(reads, VIEWER).post(API, json={"title": "Peek", "document_id": 5, "justification": "x"})
    assert r.status_code == 403 and r.json()["detail"] == permissions.DRAFT_REFUSED
    d = doc(reads)
    d.status = "published"
    reads.db.commit()
    assert titles(VIEWER) == ("Access policy", "Access policy")            # published: everyone in the library reads it


def test_the_documents_report_lists_only_the_documents_the_person_may_read(reads):
    reporting = importlib.import_module("grc.routers.reporting_router")
    reads.http.app.include_router(reporting.router)

    def report(who):
        http = as_(reads, who)
        rows = http.post("/reporting/query", json={"dataset": "gov_documents"}).json()
        grouped = http.post("/reporting/aggregate", json={"dataset": "gov_documents", "group_by": ["title"],
                                                           "measures": [{"id": "n", "pct_of_total": True}]}).json()
        return sorted(r["id"] for r in rows["rows"]), rows["total"], sorted(g["title"] for g in grouped["rows"]), grouped["grand"]["m_n"]

    assert report(VIEWER) == ([], 0, [], 0)                                # two drafts never published
    assert report(ADMIN) == ([5, 6], 2, ["Access policy", "Backup policy"], 2)
    d = doc(reads)
    d.status = "published"
    reads.db.commit()
    assert report(VIEWER) == ([5], 1, ["Access policy"], 1)
