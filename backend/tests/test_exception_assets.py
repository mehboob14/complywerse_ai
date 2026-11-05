"""The assets of an exception (DECISIONS D62): one list shared by the person who raised it and the people asked to implement it, with who put each
asset there and at which stage. Over HTTP through the whole governance router with real tokens on in-memory SQLite (``_exc_world``).

* who may add: the requester, someone allowed to edit exceptions, the implementer while the implementation is open; nobody else;
* who may take off: the person who added it, or someone allowed to edit exceptions; the list itself (``linked_asset_ids``) stays the membership
  the posture score and "Move to risk register" already read;
* an exception that is rejected, revoked or expired keeps its assets; one that predates the rows reads as added by its requester;
* the owner's form never takes away what the implementer added.
"""
from _exc_world import (ADMIN, EXCADMIN, EX, IMPL1, IMPL2, PLAIN, REQ, _schema, get, implementing, raise_exception, w)  # noqa: F401

import grc.models as m  # noqa: E402
from grc.modules.governance import exception_assets as ASSETS  # noqa: E402


def links(body):
    return [(a["asset_id"], a["added_by"]["id"], a["stage"]) for a in body["asset_links"]]


def test_assets_know_who_added_them_and_at_which_stage(w):
    e = raise_exception(w, linked_asset_ids=[1])
    eid = e["id"]
    assert links(e) == [(1, REQ, "request")] and e["asset_links"][0]["can_remove"] is True and e["can_add_assets"] is True
    r = w.as_(REQ).post(f"{EX}/{eid}/assets", json={"asset_ids": [2, 1]})                     # 1 is there already and stays as it was
    assert r.status_code == 200 and links(r.json()) == [(1, REQ, "request"), (2, REQ, "request")]
    r = w.as_(EXCADMIN).put(f"{EX}/{eid}", json={"linked_asset_ids": [1, 2, 3]})              # the form: what is new is the editor's
    assert r.status_code == 200 and links(r.json()) == [(1, REQ, "request"), (2, REQ, "request"), (3, EXCADMIN, "request")]
    mine = get(w, eid, REQ)["asset_links"]
    assert [(a["asset_id"], a["can_remove"]) for a in mine] == [(1, True), (2, True), (3, False)]   # the requester takes off their own, not the editor's
    refused = w.as_(REQ).delete(f"{EX}/{eid}/assets/3")
    assert refused.status_code == 403 and refused.json()["detail"] == "You can take off only the assets you added."
    assert links(w.as_(EXCADMIN).delete(f"{EX}/{eid}/assets/1").json()) == [(2, REQ, "request"), (3, EXCADMIN, "request")]   # an editor takes off any
    assert get(w, eid)["linked_asset_ids"] == [2, 3]
    assert [(a["asset_id"], a["can_remove"]) for a in get(w, eid, PLAIN)["asset_links"]] == [(2, False), (3, False)]


def test_nobody_else_changes_the_assets(w):
    eid = raise_exception(w, linked_asset_ids=[1])["id"]
    for who in (PLAIN, IMPL1):
        r = w.as_(who).post(f"{EX}/{eid}/assets", json={"asset_ids": [2]})
        assert r.status_code == 403 and r.json()["detail"] == ASSETS.NOT_YOURS, who
        assert w.as_(who).delete(f"{EX}/{eid}/assets/1").status_code == 403, who
    assert get(w, eid, PLAIN)["can_add_assets"] is False and get(w, eid)["linked_asset_ids"] == [1]
    assert w.as_(ADMIN).post(f"{EX}/{eid}/assets", json={"asset_ids": [2]}).status_code == 200      # an administrator may edit exceptions


def test_the_implementer_adds_assets_while_the_implementation_is_open_and_takes_off_only_their_own(w):
    eid, _ = implementing(w, linked_asset_ids=[1])
    assert get(w, eid, IMPL1)["can_add_assets"] is True and get(w, eid, IMPL2)["can_add_assets"] is False        # asked: IMPL1 alone
    assert w.as_(IMPL2).post(f"{EX}/{eid}/assets", json={"asset_ids": [3]}).status_code == 403
    r = w.as_(IMPL1).post(f"{EX}/{eid}/assets", json={"asset_ids": [3]})
    assert r.status_code == 200 and links(r.json()) == [(1, REQ, "request"), (3, IMPL1, "implementation")]
    assert [(a["asset_id"], a["can_remove"]) for a in r.json()["asset_links"]] == [(1, False), (3, True)]
    assert w.as_(IMPL1).delete(f"{EX}/{eid}/assets/1").status_code == 403
    assert links(w.as_(IMPL1).delete(f"{EX}/{eid}/assets/3").json()) == [(1, REQ, "request")]
    assert w.as_(REQ).post(f"{EX}/{eid}/assets", json={"asset_ids": [2]}).status_code == 200                       # the requester still can while it is approved


def test_assets_must_exist_in_the_organisation_and_on_the_exception(w):
    eid = raise_exception(w, linked_asset_ids=[1])["id"]
    r = w.as_(REQ).post(f"{EX}/{eid}/assets", json={"asset_ids": [50]})                                           # another organisation's
    assert r.status_code == 400 and r.json()["detail"] == "An asset chosen does not exist."
    r = w.as_(REQ).delete(f"{EX}/{eid}/assets/2")
    assert r.status_code == 404 and r.json()["detail"] == "That asset is not on this exception."
    assert get(w, eid)["linked_asset_ids"] == [1]


def test_an_exception_that_is_closed_keeps_its_assets(w):
    eid, _ = implementing(w, linked_asset_ids=[1])
    assert w.as_(EXCADMIN).post(f"{EX}/{eid}/revoke", json={"reason": "No longer needed"}).status_code == 200
    for call in (lambda: w.as_(REQ).post(f"{EX}/{eid}/assets", json={"asset_ids": [2]}), lambda: w.as_(REQ).delete(f"{EX}/{eid}/assets/1")):
        r = call()
        assert r.status_code == 409 and r.json()["detail"] == ASSETS.LOCKED
    e = get(w, eid, REQ)
    assert e["can_add_assets"] is False and e["linked_asset_ids"] == [1] and e["asset_links"][0]["can_remove"] is False


def test_an_exception_that_predates_the_rows_reads_as_added_by_its_requester(w):
    old = m.PolicyException(tenant_id=1, title="Old exception", requested_by=REQ, status="draft", priority="medium", linked_asset_ids=[1, 2])
    w.db.add(old)
    w.db.commit()
    assert links(get(w, old.id, REQ)) == [(1, REQ, "request"), (2, REQ, "request")]
    assert w.db.query(m.ExceptionAssetLink).count() == 0                                         # a GET writes nothing
    assert w.as_(REQ).post(f"{EX}/{old.id}/assets", json={"asset_ids": [3]}).status_code == 200
    assert sorted((r.asset_id, r.added_by, r.stage) for r in w.db.query(m.ExceptionAssetLink)) == [(1, REQ, "request"), (2, REQ, "request"), (3, REQ, "request")]


def test_the_owners_form_never_takes_away_what_the_implementer_added(w):
    eid, _ = implementing(w, linked_asset_ids=[1])
    assert w.as_(IMPL1).post(f"{EX}/{eid}/assets", json={"asset_ids": [3]}).status_code == 200
    exc, user = w.db.get(m.PolicyException, eid), w.db.get(m.GRCUser, REQ)
    ASSETS.sync_from_form(w.db, exc, user, [1, 2])
    w.db.commit()
    assert sorted(exc.linked_asset_ids) == [1, 2, 3]
    assert {r.asset_id: (r.stage, r.added_by) for r in w.db.query(m.ExceptionAssetLink)} == {1: ("request", REQ), 2: ("request", REQ), 3: ("implementation", IMPL1)}
    ASSETS.sync_from_form(w.db, exc, user, [])
    w.db.commit()
    assert exc.linked_asset_ids == [3]
