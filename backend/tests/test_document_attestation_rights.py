"""Attestation campaigns (the external acknowledgement links of a published document): reading them stays with the library's readers;
creating, changing, closing and deleting one is for whoever may change its document (its owner, its author, the edit right); and a
campaign anyone has acknowledged is never deleted - its signed acknowledgements are records - it is closed instead, which keeps
them. Over HTTP through the whole governance router, on in-memory SQLite."""
import grc.models as m
from grc.modules.governance import permissions
from grc.modules.governance.routers.document_attestations import KEEP_SIGNED

from test_governance_permissions import EDITOR, OWNER, SAM, _grant, doc, world  # noqa: F401  (world is a fixture)

API = "/governance/document-attestations/campaigns"


def test_only_who_may_change_the_document_runs_its_campaigns_and_acknowledged_ones_are_closed_not_deleted(world):
    db, http, me = world.db, world.http, world.me
    d = doc(world)
    d.status = "published"
    db.commit()
    _grant(db, SAM, "governance:policies:view")                            # Sam reads the library, may not change the policy
    db.add(m.UserRole(user_id=OWNER, role_id=40, tenant_id=1))             # Olivia reads it too, and owns the policy
    db.commit()

    me["id"] = SAM
    r = http.post(API, json={"document_id": 5})
    assert r.status_code == 403 and r.json()["detail"] == permissions.EDIT_REFUSED
    me["id"] = OWNER
    made = http.post(API, json={"document_id": 5, "name": "Q3 access policy"})
    assert made.status_code == 201 and made.json()["can_manage"] is True
    cid = made.json()["id"]
    spare = http.post(API, json={"document_id": 5, "name": "Spare", "activate": False}).json()["id"]
    assert http.get(API).json()["can_create_for"] == [5]

    me["id"] = SAM
    listed = http.get(API).json()
    assert listed["can_create_for"] == [] and {c["can_manage"] for c in listed["items"]} == {False}
    for method, path, kw in [("patch", f"{API}/{cid}", {"json": {"status": "closed"}}), ("patch", f"{API}/{cid}", {"json": {"name": "x"}}),
                             ("delete", f"{API}/{spare}", {})]:
        r = getattr(http, method)(path, **kw)
        assert r.status_code == 403 and r.json()["detail"] == permissions.EDIT_REFUSED, (method, path)
    assert db.get(m.DocumentAttestationCampaign, cid).status == "active" and db.get(m.DocumentAttestationCampaign, spare) is not None

    db.add(m.DocumentAttestationAcknowledgment(campaign_id=cid, name="Uma User", email="uma@cfsb.test", designation="Clerk",
                                               signature_data="data:image/png;base64,AAAA"))
    db.commit()
    me["id"] = EDITOR                                                      # the edit right runs any document's campaigns
    r = http.delete(f"{API}/{cid}")
    assert r.status_code == 409 and r.json()["detail"] == KEEP_SIGNED
    db.expire_all()
    assert db.get(m.DocumentAttestationCampaign, cid) is not None and db.query(m.DocumentAttestationAcknowledgment).count() == 1
    closed = http.patch(f"{API}/{cid}", json={"status": "closed"})
    assert closed.status_code == 200 and closed.json()["status"] == "closed" and len(closed.json()["acknowledgments"]) == 1
    assert http.delete(f"{API}/{spare}").status_code == 204                # nobody acknowledged it: it may go


def test_the_coverage_map_says_how_many_of_how_many_beside_the_percent(world):
    """The library's Attestation column draws a ring with "4/5" under it: the counts come with the percent, for the same documents."""
    db, http, me = world.db, world.http, world.me
    d = doc(world)
    d.status = "published"
    db.commit()
    _grant(db, SAM, "governance:policies:view")
    db.add(m.UserRole(user_id=OWNER, role_id=40, tenant_id=1))
    db.commit()
    me["id"] = OWNER
    cid = http.post(API, json={"document_id": 5, "name": "Q3 access policy"}).json()["id"]
    db.add(m.DocumentAttestationAcknowledgment(campaign_id=cid, name="Uma User", email="uma@cfsb.test", designation="Clerk",
                                               signature_data="data:image/png;base64,AAAA"))
    db.commit()
    people = db.query(m.GRCUser).filter(m.GRCUser.is_active.is_(True), m.GRCUser.email.like("%@cfsb.test")).count()

    me["id"] = SAM
    got = http.get("/governance/document-attestations/coverage-map")
    assert got.status_code == 200
    body = got.json()
    assert body["counts"] == {"5": {"done": 1, "total": people}}
    assert body["coverage"] == {"5": round(1 / people * 100)}                   # the percent is unchanged: it is the same numbers
