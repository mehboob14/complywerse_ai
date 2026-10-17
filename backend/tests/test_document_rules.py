"""The shared rules of who may read a governance document and which version they read (governance/permissions.py, the user's
decisions of 2026-10-17): the library right, the owner and the author, anyone asked, auditors, never-published drafts hidden from
staff; the version in force while a newer one is on its way; the column that records it and its backfill. In-memory SQLite, on a
session that does not flush by itself (as tenant sessions in production)."""
from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.modules.governance import permissions as P

(OWNER, AUTHOR, EDITOR, PUBLISHER, ADMIN, CONTACT, AUDITOR, VIEWER, WILD, STAFF, OUTSIDER, IMPORTED, BYNAME, BYROLE, MEMBER, LEAD,
 ASKED, CANCELLED) = range(1, 19)
DRAFT, PUBLISHED, IN_REVIEW = 5, 6, 7          # never published | published 1.0 | published 1.0, 1.1 in review


@pytest.fixture
def world():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False)
    db = factory()
    db.add(m.Tenant(id=1, name="CFSB", slug="cfsb", primary_contact_email="Boss@CFSB.test"))
    for uid in range(1, 19):
        db.add(m.GRCUser(id=uid, username=f"u{uid}", email=("boss@cfsb.test" if uid == CONTACT else f"u{uid}@cfsb.test"),
                         display_name=f"User {uid}"))
    for rid, role, perm in [(20, "Document editors", "governance:policies:edit"), (21, "Document publishers", "governance:policies:publish"),
                            (22, "Administrator", None), (23, "Auditors", "compliance:frameworks:view"),
                            (24, "Document readers", "governance:policies:view"), (25, "Governance", "governance:*:*"),
                            (26, "Risk viewers", "risks:risk_register:view"), (30, "Approvers", None)]:
        db.add(m.Role(id=rid, tenant_id=1, name=role))
        if perm:
            db.add(m.Permission(id=rid, name=perm, resource=perm.rsplit(":", 1)[0], action=perm.rsplit(":", 1)[1]))
            db.add(m.RolePermission(role_id=rid, permission_id=rid))
    for uid, rid, source in [(EDITOR, 20, None), (PUBLISHER, 21, None), (ADMIN, 22, None), (AUDITOR, 23, None), (VIEWER, 24, None),
                             (WILD, 25, None), (STAFF, 26, None), (BYROLE, 30, None),
                             (IMPORTED, 24, "okta"), (IMPORTED, 30, "okta")]:    # links a connector imported give nothing
        db.add(m.UserRole(user_id=uid, role_id=rid, tenant_id=1, source=source))
    db.add(m.Team(id=40, tenant_id=1, name="Policy team", lead_user_id=LEAD))
    db.add(m.TeamMember(team_id=40, user_id=MEMBER))
    db.add(m.GovernanceDocument(id=DRAFT, tenant_id=1, title="Access policy", doc_type="policy", status="draft", current_version="1.0",
                                owner_id=OWNER, author_id=AUTHOR))
    db.add(m.GovernanceDocument(id=PUBLISHED, tenant_id=1, title="Backup policy", doc_type="policy", current_version="1.0"))
    db.add(m.GovernanceDocument(id=IN_REVIEW, tenant_id=1, title="Travel policy", doc_type="policy", current_version="1.0", owner_id=OWNER))
    db.flush()
    db.get(m.GovernanceDocument, PUBLISHED).status = "published"
    travel = db.get(m.GovernanceDocument, IN_REVIEW)
    travel.status = "published"
    travel.current_version, travel.status = "1.1", "pending_review"
    db.add(m.GovernanceDocumentVersion(id=1, document_id=IN_REVIEW, version_number="1.0", title="Travel policy", content="v1.0", status="superseded"))
    db.add(m.GovernanceDocumentVersion(id=2, document_id=IN_REVIEW, version_number="1.1", title="Travel policy", content="v1.1", status="current"))
    for doc_id, kind, ttype, tid in [(DRAFT, "reviewer", "user", BYNAME), (DRAFT, "approver", "role", 30), (DRAFT, "prepared_by", "team", 40),
                                     (IN_REVIEW, "prepared_by", "user", BYNAME)]:
        db.add(m.DocumentSignoffAssignment(tenant_id=1, document_id=doc_id, role_type=kind, target_type=ttype, target_id=tid))
    db.add(m.DocumentObligation(id=1, tenant_id=1, document_id=IN_REVIEW, kind="acknowledgement", user_id=ASKED, document_version="1.0"))
    db.add(m.DocumentObligation(id=2, tenant_id=1, document_id=IN_REVIEW, kind="acknowledgement", user_id=CANCELLED, status="cancelled"))
    db.commit()
    yield SimpleNamespace(db=db, user=lambda uid: db.get(m.GRCUser, uid), doc=lambda did: db.get(m.GovernanceDocument, did), engine=engine)
    db.close()


def readable(w, uid):
    return [d for d in (DRAFT, PUBLISHED, IN_REVIEW) if P.can_read(w.db, w.user(uid), w.doc(d))]


def listed(w, uid):
    cond = P.visible_filter(w.db, w.user(uid))
    q = w.db.query(m.GovernanceDocument.id).order_by(m.GovernanceDocument.id)
    return [i for (i,) in (q if cond is None else q.filter(cond))]


ALL = [DRAFT, PUBLISHED, IN_REVIEW]
# who reads which document on its own, and what a list shows them
EXPECTED = {
    OWNER: ([DRAFT, IN_REVIEW], [DRAFT, IN_REVIEW]),          # their own documents only (no library right)
    AUTHOR: ([DRAFT], [DRAFT]),
    EDITOR: (ALL, ALL), PUBLISHER: (ALL, ALL), ADMIN: (ALL, ALL), CONTACT: (ALL, ALL),   # they see drafts too
    VIEWER: ([PUBLISHED, IN_REVIEW], [PUBLISHED, IN_REVIEW]),  # library readers: never the never-published draft
    WILD: ([PUBLISHED, IN_REVIEW], [PUBLISHED, IN_REVIEW]),    # governance:*:* reads the library like the menu says
    AUDITOR: (ALL, []),                                       # single documents from the Auditor Portal, no lists
    STAFF: ([], []), OUTSIDER: ([], []), IMPORTED: ([], []),
    BYNAME: ([DRAFT, IN_REVIEW], [DRAFT, IN_REVIEW]),         # named on the sign-off
    BYROLE: ([DRAFT], [DRAFT]),                               # through a role the platform gave them
    MEMBER: ([DRAFT], [DRAFT]), LEAD: ([DRAFT], [DRAFT]),     # through a team they belong to or lead
    ASKED: ([IN_REVIEW], [IN_REVIEW]),                        # a request that is waiting
    CANCELLED: ([], []),                                      # a withdrawn request opens nothing
}


@pytest.mark.parametrize("uid", sorted(EXPECTED))
def test_who_reads_which_document_and_what_their_lists_show(world, uid):
    reads, lists = EXPECTED[uid]
    assert readable(world, uid) == reads
    assert listed(world, uid) == lists
    ids = P.readable_ids(world.db, world.user(uid))
    library = uid in (EDITOR, PUBLISHER, ADMIN, CONTACT, VIEWER, WILD)
    assert P.can_read_library(world.db, world.user(uid)) is library
    if library:
        assert ids is None
    else:
        assert sorted(i for (i,) in world.db.execute(ids)) == lists


@pytest.mark.parametrize("status", ["pending", "done", "rejected"])
def test_a_request_opens_its_document_until_it_is_withdrawn(world, status):
    ob = world.db.get(m.DocumentObligation, 1)
    ob.status = status
    world.db.commit()
    assert readable(world, ASKED) == [IN_REVIEW]
    assert sorted(i for (i,) in world.db.execute(P.asked_ids(world.db, world.user(ASKED)))) == [IN_REVIEW]
    ob.status = "cancelled"
    world.db.commit()
    assert readable(world, ASKED) == [] and list(world.db.execute(P.asked_ids(world.db, world.user(ASKED)))) == []


def test_auditors_and_the_library_right_are_matched_with_wildcards_and_platform_given_roles_only(world):
    db, u = world.db, world.user
    assert [uid for uid in range(1, 19) if P.is_auditor(db, u(uid))] == [ADMIN, CONTACT, AUDITOR]
    assert not P.can_read_library(db, u(IMPORTED)) and not P.can_read_library(db, u(STAFF)) and not P.can_read_library(db, u(AUDITOR))
    db.add(m.UserRole(user_id=STAFF, role_id=25, tenant_id=1, source="sso"))       # an SSO group mapping is given by the platform
    db.commit()
    assert P.can_read_library(db, u(STAFF))


def test_a_participant_is_named_by_user_role_or_team_in_the_kinds_asked_for(world):
    db, u = world.db, world.user
    for uid, kinds in [(BYNAME, ("reviewer",)), (BYROLE, ("approver",)), (MEMBER, ("prepared_by",)), (LEAD, ("prepared_by",))]:
        assert P.participant(db, u(uid), DRAFT), uid
        assert P.participant(db, u(uid), DRAFT, kinds), uid
        assert not P.participant(db, u(uid), DRAFT, tuple(k for k in P.SIGNOFF_KINDS if k not in kinds)), uid
    assert P.participant(db, u(BYNAME), IN_REVIEW) and not P.participant(db, u(BYROLE), IN_REVIEW)
    for uid in (IMPORTED, OWNER, EDITOR, ADMIN, ASKED, OUTSIDER):                    # a connector-imported role link counts for nothing
        assert not P.participant(db, u(uid), DRAFT), uid


def test_the_guards_say_not_found_first_then_refuse(world):
    db, u = world.db, world.user
    with pytest.raises(HTTPException) as e:
        P.require_doc_reader(404, db, u(EDITOR))
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        P.require_doc_reader(DRAFT, db, u(VIEWER))
    assert (e.value.status_code, e.value.detail) == (403, P.DRAFT_REFUSED)              # a library reader: it is a draft, not a right
    with pytest.raises(HTTPException) as e:
        P.require_doc_reader(DRAFT, db, u(STAFF))
    assert (e.value.status_code, e.value.detail) == (403, P.READ_REFUSED)
    assert P.require_doc_reader(PUBLISHED, db, u(VIEWER)).id == PUBLISHED
    with pytest.raises(HTTPException) as e:
        P.require_library_reader(db, u(AUDITOR))
    assert (e.value.status_code, e.value.detail) == (403, P.LIBRARY_REFUSED)
    P.require_library_reader(db, u(VIEWER))
    P.ensure_reader(db, u(OWNER), world.doc(DRAFT))


def test_remarks_are_for_editors_auditors_and_the_people_taking_part(world):
    db, u = world.db, world.user
    for uid in (OWNER, AUTHOR, EDITOR, ADMIN, AUDITOR, BYNAME, BYROLE, MEMBER, LEAD):
        P.ensure_annotator(db, u(uid), world.doc(DRAFT))
    for uid in (VIEWER, PUBLISHER, ASKED, STAFF, OUTSIDER, IMPORTED):
        with pytest.raises(HTTPException) as e:
            P.ensure_annotator(db, u(uid), world.doc(DRAFT))
        assert (e.value.status_code, e.value.detail) == (403, P.ANNOTATE_REFUSED), uid


def test_the_version_in_force_while_a_new_one_is_on_its_way(world):
    db, doc = world.db, world.doc
    assert (P.in_force_number(doc(DRAFT)), P.in_force_number(doc(PUBLISHED)), P.in_force_number(doc(IN_REVIEW))) == (None, "1.0", "1.0")
    assert P.in_force_row(db, doc(PUBLISHED)) is None and P.in_force_row(db, doc(DRAFT)) is None
    assert P.in_force_row(db, doc(IN_REVIEW)).id == 1
    travel = doc(IN_REVIEW)
    for status in P.ON_ITS_WAY:
        travel.status = status
        assert P.in_force_number(travel) == "1.0" and P.in_force_row(db, travel).id == 1, status
    assert "review_required" in P.ON_ITS_WAY                                        # a workflow flagged it for review: 1.0 stays in force
    travel.status, travel.current_version = "draft", "1.0"                          # set back to draft by hand, no new version
    assert P.in_force_number(travel) == "1.0" and P.in_force_row(db, travel) is None
    travel.current_version = "1.1"
    for status in ("archived", "expired", "exception_applied"):                     # withdrawn: nothing is in force any more,
        travel.status = status                                                       # but staff still read 1.0, never the 1.1 nobody approved
        assert P.in_force_number(travel) is None and P.in_force_row(db, travel).id == 1, status
        assert P.version_for(db, world.user(VIEWER), travel).id == 1 and P.can_read(db, world.user(VIEWER), travel), status
    travel.status = "draft"                                                          # revived: the old version does not come back in force
    assert P.in_force_number(travel) is None and P.in_force_row(db, travel).id == 1
    assert (travel.published_version, travel.last_published_version) == (None, "1.0")
    travel.status, travel.current_version = "published", None
    assert P.in_force_number(travel) == "1.0"


def test_the_row_in_force_is_the_earliest_with_its_number_never_a_reverted_or_empty_one(world):
    db = world.db
    db.add(m.GovernanceDocument(id=9, tenant_id=1, title="Leave policy", doc_type="policy", status="pending_review",
                                current_version="1.2", published_version="1.0"))
    for vid, number, status, content, path in [(11, "1.0", "reverted", "taken back", None), (12, "1.0", "superseded", None, ""),
                                               (13, "1.0", "superseded", "", None), (14, "1.0", "superseded", None, "leave-1.0.docx"),
                                               (15, "1.0", "superseded", "the gap fix's pre-fix copy", None), (16, "1.2", "current", "v1.2", None)]:
        db.add(m.GovernanceDocumentVersion(id=vid, document_id=9, version_number=number, title="Leave policy", content=content,
                                           file_path=path, status=status))
    db.commit()
    assert P.in_force_row(db, world.doc(9)).id == 14
    db.get(m.GovernanceDocumentVersion, 14).status = None                          # an old row with no status still counts
    db.commit()
    assert P.in_force_row(db, world.doc(9)).id == 14
    db.query(m.GovernanceDocumentVersion).filter(m.GovernanceDocumentVersion.id.in_([14, 15])).delete()
    db.commit()
    assert P.in_force_row(db, world.doc(9)) is None                                # the row is missing: the document itself


def test_who_reads_the_newest_version_and_who_the_one_in_force(world):
    db, u = world.db, world.user
    travel = world.doc(IN_REVIEW)
    for uid in (OWNER, EDITOR, PUBLISHER, ADMIN, CONTACT, BYNAME):                  # BYNAME prepared it
        assert P.sees_draft(db, u(uid), travel) and P.version_for(db, u(uid), travel) is None, uid
    for uid in (VIEWER, WILD, AUDITOR, ASKED, STAFF):
        assert not P.sees_draft(db, u(uid), travel), uid
        assert P.version_for(db, u(uid), travel).version_number == "1.0", uid
    assert P.version_for(db, u(VIEWER), world.doc(PUBLISHED)) is None              # published: the document is the version in force
    db.add(m.DocumentSignoffAssignment(tenant_id=1, document_id=IN_REVIEW, role_type="reviewer", target_type="team", target_id=40))
    db.commit()
    assert P.version_for(db, u(MEMBER), travel) is None and P.version_for(db, u(LEAD), travel) is None


def test_every_publication_records_its_version_before_anything_is_flushed(world):
    db = world.db
    d = m.GovernanceDocument(id=20, tenant_id=1, title="New policy", doc_type="policy", status="published")   # version not set yet
    assert d.published_version == "1.0"
    d.current_version = "2.0"
    d.status = "published"
    assert d.published_version == "2.0"
    db.add(d)
    db.commit()
    d.current_version, d.status = "2.1", "pending_review"                          # a new version on its way keeps the one in force
    assert d.published_version == "2.0"
    d.status = "approved"
    assert d.published_version == "2.0"
    d.status = "published"
    assert d.published_version == "2.1"
    db.commit()
    db.expire_all()
    assert db.get(m.GovernanceDocument, 20).published_version == "2.1"
    db.get(m.GovernanceDocument, 20).status = "archived"                           # withdrawn: nothing in force
    db.commit()
    db.expire_all()
    assert db.get(m.GovernanceDocument, 20).published_version is None
    assert db.get(m.GovernanceDocument, 20).last_published_version == "2.1"        # the version published last is never cleared
    assert world.doc(PUBLISHED).published_version == "1.0" and world.doc(IN_REVIEW).published_version == "1.0"
    assert world.doc(DRAFT).published_version is None


def test_documents_published_before_the_column_existed_are_filled_once(world):
    from grc.modules.compliance.schema_migrations import _COLUMN_ADDS, _backfill_published_version

    assert ("grc_governance_documents", "published_version", "VARCHAR(50)", None) in _COLUMN_ADDS
    assert ("grc_governance_documents", "last_published_version", "VARCHAR(50)", None) in _COLUMN_ADDS
    with world.engine.begin() as conn:                                             # as the database holds them before the change
        conn.execute(text("UPDATE grc_governance_documents SET published_version = NULL, last_published_version = NULL"))
        conn.execute(text("INSERT INTO grc_governance_documents (id, tenant_id, title, doc_type, status, current_version) VALUES "
                          "(30, 1, 'No number', 'policy', 'published', NULL), (31, 1, 'Set', 'policy', 'published', '3.0'), "
                          "(32, 1, 'In review', 'policy', 'pending_review', '2.1'), (33, 1, 'Archived', 'policy', 'archived', '4.0')"))
        conn.execute(text("UPDATE grc_governance_documents SET published_version = '2.0' WHERE id IN (31, 32)"))
        conn.execute(text("UPDATE grc_governance_documents SET last_published_version = '1.0' WHERE id = 31"))
    _backfill_published_version(world.engine)
    _backfill_published_version(world.engine)                                      # idempotent
    with world.engine.connect() as conn:
        got = {i: (p, last) for i, p, last in conn.execute(text("SELECT id, published_version, last_published_version FROM grc_governance_documents"))}
    assert got == {DRAFT: (None, None), PUBLISHED: ("1.0", "1.0"), IN_REVIEW: (None, None), 30: ("1.0", "1.0"), 31: ("2.0", "1.0"),
                   32: ("2.0", "2.0"), 33: (None, None)}                           # only empty columns; an archived one cannot tell


def test_a_once_published_document_never_shows_staff_a_text_nobody_approved_and_withdrawing_one_ends_what_is_in_force(world):
    db, viewer = world.db, world.user(VIEWER)
    old = world.doc(DRAFT)
    old.status, old.published_at = "pending_review", datetime.utcnow()       # published once, in re-review at deploy: no number
    db.commit()
    # which of its texts was approved is unknown, so staff are not served its newest one (the people asked still open it)
    assert old.published_version is None and old.last_published_version is None and not P.can_read(db, viewer, old)
    assert DRAFT not in listed(world, VIEWER) and P.can_read(db, world.user(BYNAME), old)
    travel = world.doc(IN_REVIEW)
    assert travel.published_version == "1.0"
    travel.status = "archived"                                               # withdrawn: nothing in force
    db.commit()
    assert travel.published_version is None and P.in_force_number(travel) is None
    assert IN_REVIEW in listed(world, VIEWER) and P.version_for(db, viewer, travel).version_number == "1.0"
    travel.status = "draft"                                                  # revived: the old version does not come back in force
    db.commit()
    assert P.in_force_number(travel) is None and P.version_for(db, viewer, travel).version_number == "1.0"
