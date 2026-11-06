"""The AI Studio's view of a library document: who may change or publish it (owner, author, governance:policies:edit; publish
needs governance:policies:publish; the primary contact always), whether the studio can open it, and one draft per person per
document - reused, replaced when clean and the library moved on (instructions and references come along), offered as stale when it
holds unsaved work, started again on request. Reading the access writes nothing."""
import grc.models as m
from grc.modules.governance.routers import document_access

from test_studio_flow import world                                          # noqa: F401  (world is a fixture)


def _wire(world):
    world.http.app.include_router(document_access.router, prefix="/governance")
    return world


def _access(world, doc=10):
    return world.http.get(world.api(f"/documents/{doc}/access")).json()


def _draft(world, doc=10, **body):
    return world.http.post(world.api(f"/documents/{doc}/draft"), json=body)


def _grant(db, user_id, *names):
    role = m.Role(tenant_id=1, name="Policy editors")
    db.add(role)
    db.flush()
    for name in names:
        p = m.Permission(name=name, resource="governance", action=name.rsplit(":", 1)[1])
        db.add(p)
        db.flush()
        db.add(m.RolePermission(role_id=role.id, permission_id=p.id))
    db.add(m.UserRole(user_id=user_id, role_id=role.id, tenant_id=1))
    db.commit()


def test_one_draft_per_person_and_document_seeded_from_the_document(world):
    _wire(world)
    doc = world.db.get(m.GovernanceDocument, 10)
    doc.classification, doc.review_cycle_months = "confidential", 24
    world.db.commit()
    first = _draft(world).json()
    again = _draft(world).json()
    assert first["created"] is True and again == {**first, "created": False}
    s = world.http.get(world.api(f"/sessions/{first['session_id']}")).json()
    assert s["instructions"]["classification"] == "Confidential" and s["instructions"]["review_cycle"] == "Every two years"
    assert world.db.query(m.StudioSession).filter_by(document_id=10, status="active").count() == 1


def test_reading_the_access_writes_nothing(world):
    _wire(world)
    sid = _draft(world).json()["session_id"]
    s = world.db.get(m.StudioSession, sid)
    before = (s.updated_at, s.last_opened_at, world.db.get(m.GovernanceDocument, 10).updated_at)
    out = _access(world)
    world.db.expire_all()
    s = world.db.get(m.StudioSession, sid)
    assert (s.updated_at, s.last_opened_at, world.db.get(m.GovernanceDocument, 10).updated_at) == before
    assert out["can_edit"] is True and out["openable"] is True and out["version"] == "1.0"
    assert out["draft"]["session_id"] == sid and out["draft"]["behind"] is False and out["draft"]["unsaved"] is False


def test_a_clean_draft_behind_the_library_is_replaced_and_an_unsaved_one_is_offered_as_stale(world):
    _wire(world)
    first = _draft(world).json()["session_id"]
    world.http.post(world.api(f"/sessions/{first}/references"), json={"kind": "framework", "source_id": 1, "scope": {"mode": "all"}})
    world.http.patch(world.api(f"/sessions/{first}"), json={"instructions": {"tone": "Plain English"}})
    doc = world.db.get(m.GovernanceDocument, 10)
    doc.content += "\nSomeone else added this.\n"                              # the library moved on
    world.db.commit()
    assert _access(world)["draft"]["behind"] is True
    replaced = _draft(world).json()
    assert replaced["created"] is True and replaced["replaced"] == first and world.db.get(m.StudioSession, first).status == "archived"
    fresh = world.http.get(world.api(f"/sessions/{replaced['session_id']}")).json()
    assert fresh["instructions"]["tone"] == "Plain English" and [r["source_id"] for r in fresh["references"] if r["kind"] == "framework"] == [1]
    # unsaved work on an older version: kept and marked, until the person starts again
    world.http.put(world.api(f"/sessions/{replaced['session_id']}/content"), json={"content": fresh["content"] + "\nMy change.\n", "base_revision": 1})
    doc.content += "\nAnd again.\n"
    world.db.commit()
    stale = _draft(world).json()
    assert stale == {**stale, "session_id": replaced["session_id"], "created": False, "stale": True}
    restarted = _draft(world, fresh=True).json()
    assert restarted["created"] is True and world.db.get(m.StudioSession, replaced["session_id"]).status == "archived"


def test_documents_the_studio_cannot_open_say_why(world):
    _wire(world)
    doc = world.db.get(m.GovernanceDocument, 11)
    doc.content = None
    world.db.commit()
    out = _access(world, 11)
    assert out["openable"] is False and "no text or file" in out["reason"]
    sheet = world.db.get(m.GovernanceDocument, 11)
    sheet.file_name, sheet.file_path = "risks.xlsx", __file__                 # a file that exists, of a kind the studio does not open
    world.db.commit()
    out = _access(world, 11)
    assert out["openable"] is False and ".xlsx" in out["reason"]
    assert _draft(world, 11).status_code == 400


def test_who_may_change_and_publish(world):
    _wire(world)
    db = world.db
    world.me["id"] = 2                                                          # Sam: not the owner or the author, no permission
    assert world.http.get(world.api("/documents/10/access")).status_code == 403   # he may not even read it
    db.add_all([m.Role(id=12, tenant_id=1, name="Readers"), m.UserRole(user_id=2, role_id=12, tenant_id=1),
                m.Permission(id=12, name="governance:policies:view", resource="governance:policies", action="view"),
                m.RolePermission(role_id=12, permission_id=12)])
    db.commit()                                                                 # now he reads the library
    assert (_access(world)["can_edit"], _access(world)["can_publish"]) == (False, False)
    assert _draft(world).status_code == 403
    db.get(m.GovernanceDocument, 10).author_id = 2                              # the author may change it
    db.commit()
    assert _access(world)["can_edit"] is True and _access(world)["can_publish"] is False
    db.get(m.GovernanceDocument, 10).author_id = None
    db.commit()
    _grant(db, 2, "governance:policies:edit", "governance:policies:publish")
    assert (_access(world)["can_edit"], _access(world)["can_publish"]) == (True, True)
    db.query(m.UserRole).filter_by(user_id=1, role_id=11).delete()             # Olivia owns it, without administering
    db.commit()
    world.me["id"] = 1
    assert _access(world)["can_edit"] is True and _access(world)["can_publish"] is False
    db.get(m.Tenant, 1).primary_contact_email = "o@cfsb.test"                  # the primary contact may do everything
    db.commit()
    assert _access(world)["can_publish"] is True
