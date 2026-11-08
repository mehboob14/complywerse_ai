"""Auditor Portal: the front door and the review queue (UX revamp G-1, 2026-11-08).

GET /auditor-portal/work and GET /auditor-portal/{id}/review-queue are reads: they carry what an auditor needs to decide (names, the requirement,
the library id a file previews by), page with a true total, tell a turned-down scope request from a waiting one, and never show a file path or an
e-mail address. The Overview keeps its old `pending_applicability` and adds the two counts told apart; the controls list adds `decision` next to
`state`. In-memory SQLite, the route functions called directly.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.modules.auditor_portal.routers import controls, overview, reviews

T0 = datetime(2026, 11, 1, 9, 0, 0)


@pytest.fixture()
def world():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add(m.Tenant(id=1, name="Acme", slug="acme", is_active=True, primary_contact_email="ada@acme.test"))
    db.add_all([
        m.GRCUser(id=7, username="ada", email="ada@acme.test", display_name="Ada Admin", is_active=True),
        m.GRCUser(id=8, username="vic", email="vic@acme.test", display_name="Vic Viewer", is_active=True),
    ])
    db.add(m.UploadedFramework(id=3, tenant_id=1, name="ISO 27001", version="2022", file_name="iso.pdf", file_path="iso.pdf", file_type="pdf", uploaded_by=7))
    for i, (ref, title, critical) in enumerate([("A.5.1", "Policies for information security", False), ("A.5.2", "Roles and responsibilities", False),
                                                ("A.8.2", "Privileged access rights", True), ("A.8.3", "Information access restriction", False)], start=1):
        db.add(m.ParsedFrameworkControl(id=i, uploaded_framework_id=3, control_id=f"FW-{i:03d}", original_reference=ref, title=title,
                                        description=f"The organisation shall {title.lower()}.", is_critical=critical))
    db.add(m.CertificationJourney(id=1, tenant_id=1, uploaded_framework_id=3, name="ISO 27001 - 2026", status="in_progress", started_at=T0))
    db.flush()
    for i in range(1, 5):
        db.add(m.ControlImplementation(id=100 + i, journey_id=1, parsed_control_id=i, status="not_started"))
    db.flush()
    db.commit()
    yield db
    db.close()


def user(db, uid=7):
    return db.get(m.GRCUser, uid)


def file_row(db, impl, name, status="pending", hours=0, **kw):
    ev = m.ImplementationEvidence(implementation_id=impl, evidence_id=kw.pop("library", None), file_name=name, file_path=f"/srv/uploads/{name}",
                                  file_size=2048, mime_type="application/pdf", uploaded_at=T0 + timedelta(hours=hours), uploaded_by=8,
                                  review_status=status, **kw)
    db.add(ev)
    db.flush()
    return ev


def request(db, control, status="pending", applicable=True, hours=0, **kw):
    rec = m.ClauseApplicability(tenant_id=1, uploaded_framework_id=3, control_id=control, is_applicable=applicable, status=status,
                                justification="Not processed here", requested_by=8, requested_at=T0 + timedelta(hours=hours), **kw)
    db.add(rec)
    db.flush()
    return rec


def queue(db, **kw):
    args = dict(kind="files", status_filter=None, q=None, skip=0, limit=50, db=db, current_user=user(db))
    args.update(kw)
    return reviews.review_queue(1, **args)


def test_files_wait_oldest_first_and_carry_names_not_paths_or_emails(world):
    db = world
    file_row(db, 102, "newer.pdf", hours=5)
    file_row(db, 101, "older.pdf", hours=1)
    file_row(db, 103, "done.pdf", status="approved", hours=2, reviewed_by=7, reviewed_at=T0 + timedelta(hours=9), review_notes="Fine")
    db.commit()
    page = queue(db)
    assert [r["file_name"] for r in page["items"]] == ["older.pdf", "newer.pdf"]
    assert page["total"] == 2 and page["counts"]["files"] == {"pending": 2, "approved": 1, "rejected": 0, "total": 3}
    row = page["items"][0]
    assert row["uploaded_by"] == "Vic Viewer" and row["control"]["ref"] == "A.5.1" and row["control"]["implementation_id"] == 101
    assert "The organisation shall" in row["control"]["requirement"]
    dumped = str(page)
    assert "/srv/uploads" not in dumped and "@acme.test" not in dumped, "no server path and no e-mail address in the payload"


def test_a_file_previews_by_its_library_id_not_by_the_journey_row_id(world):
    db = world
    db.add(m.Evidence(id=77, tenant_id=1, name="Policy", file_path="p.pdf", file_name="policy.pdf", evidence_type="document", status="draft", uploaded_by=8))
    db.flush()
    row = file_row(db, 101, "policy.pdf", library=77)
    db.commit()
    item = queue(db)["items"][0]
    assert item["id"] == row.id and item["library_evidence_id"] == 77
    assert item["id"] != item["library_evidence_id"]


def test_a_file_with_no_state_counts_as_waiting_like_the_overview_always_did(world):
    db = world
    file_row(db, 101, "blank.pdf", status=None)
    db.commit()
    page = queue(db)
    assert page["total"] == 1 and page["counts"]["files"]["pending"] == 1 and page["items"][0]["status"] == "pending"


def test_scope_requests_a_turned_down_one_is_not_waiting(world):
    db = world
    request(db, 1, "pending", True, hours=3)
    request(db, 2, "rejected", False, hours=1, reviewed_by=7, reviewed_at=T0 + timedelta(hours=4), review_comment="No: it is used")
    request(db, 3, "approved", False, hours=2, reviewed_by=7, reviewed_at=T0 + timedelta(hours=5))
    db.commit()
    page = queue(db, kind="scope")
    assert [r["control"]["ref"] for r in page["items"]] == ["A.5.1"] and page["total"] == 1
    assert page["counts"]["scope"] == {"pending": 1, "approved": 1, "rejected": 1, "in_scope": 0, "out_of_scope": 1, "total": 3}
    turned = queue(db, kind="scope", status_filter="rejected")["items"][0]
    assert turned["status"] == "rejected" and turned["reviewed_by"] == "Ada Admin" and turned["review_notes"] == "No: it is used"
    assert turned["requested_by"] == "Vic Viewer" and turned["is_applicable"] is False


def test_controls_with_no_request_and_which_of_them_may_be_auto_approved(world):
    db = world
    request(db, 1, "pending")
    db.commit()
    page = queue(db, kind="untouched")
    assert [r["control"]["ref"] for r in page["items"]] == ["A.5.2", "A.8.2", "A.8.3"] and page["total"] == 3
    assert {r["control"]["ref"]: r["can_auto_approve"] for r in page["items"]} == {"A.5.2": True, "A.8.2": False, "A.8.3": True}
    assert page["counts"]["untouched"] == 3 and page["counts"]["untouched_manual"] == 1
    assert [r["control"]["ref"] for r in queue(db, kind="untouched", q="privileged")["items"]] == ["A.8.2"]


def test_decided_merges_files_and_requests_newest_first_with_a_true_total(world):
    db = world
    file_row(db, 101, "a.pdf", status="approved", reviewed_by=7, reviewed_at=T0 + timedelta(hours=10))
    file_row(db, 102, "b.pdf", status="rejected", reviewed_by=7, reviewed_at=T0 + timedelta(hours=12), review_notes="Wrong period")
    file_row(db, 103, "waiting.pdf", status="pending")
    request(db, 1, "approved", True, reviewed_by=7, reviewed_at=T0 + timedelta(hours=11))
    request(db, 2, "pending")
    db.commit()
    page = queue(db, kind="decided")
    assert page["total"] == 3 and [(r["type"], r["status"]) for r in page["items"]] == [("file", "rejected"), ("scope", "approved"), ("file", "approved")]
    second = queue(db, kind="decided", skip=1, limit=1)
    assert second["total"] == 3 and [r["type"] for r in second["items"]] == ["scope"]
    turned = queue(db, kind="decided", status_filter="rejected")
    assert turned["total"] == 1 and turned["items"][0]["review_notes"] == "Wrong period"
    assert page["counts"]["decided"] == 3


def test_the_queue_pages_with_a_true_total(world):
    db = world
    for i in range(7):
        file_row(db, 101, f"f{i}.pdf", hours=i)
    db.commit()
    page = queue(db, limit=3, skip=3)
    assert page["total"] == 7 and [r["file_name"] for r in page["items"]] == ["f3.pdf", "f4.pdf", "f5.pdf"]
    assert [r["file_name"] for r in queue(db, q="f6")["items"]] == ["f6.pdf"]


def test_an_unknown_list_or_state_is_a_plain_400(world):
    db = world
    with pytest.raises(HTTPException) as e:
        queue(db, kind="everything")
    assert e.value.status_code == 400 and "files, scope, untouched or decided" in e.value.detail
    with pytest.raises(HTTPException) as e:
        queue(db, status_filter="maybe")
    assert e.value.status_code == 400


def test_reading_the_queue_writes_nothing(world):
    db = world
    file_row(db, 101, "a.pdf")
    request(db, 1)
    db.commit()
    before = db.query(m.AuditLog).count()
    queue(db), queue(db, kind="scope"), queue(db, kind="untouched"), queue(db, kind="decided")
    overview.get_work(limit=20, db=db, current_user=user(db))
    assert not db.dirty and not db.new and db.query(m.AuditLog).count() == before


def test_the_front_door_counts_what_waits_per_journey_and_lists_the_oldest_first(world):
    db = world
    file_row(db, 101, "late.pdf", hours=8)
    file_row(db, 102, "early.pdf", hours=1)
    file_row(db, 103, "done.pdf", status="approved", hours=2)
    request(db, 1, "pending", True, hours=4)
    request(db, 2, "rejected", False, hours=3)
    db.commit()
    work = overview.get_work(limit=20, db=db, current_user=user(db))
    assert work["counters"] == {"files_to_review": 2, "scope_to_decide": 1} and work["rows_total"] == 3
    card = work["journeys"][0]
    assert card["name"] == "ISO 27001 - 2026" and card["framework"] == "ISO 27001"
    assert card["files"] == {"pending": 2, "approved": 1, "rejected": 0, "total": 3}
    assert card["scope"] == {"pending": 1, "approved": 0, "rejected": 1, "total": 2} and card["no_request"] == 2 and card["controls_total"] == 4
    assert [(r["kind"], r["title"]) for r in work["rows"]] == [("file", "early.pdf"), ("scope", "A.5.1 Policies for information security"), ("file", "late.pdf")]
    assert all(r["journey_id"] == 1 and r["journey"] == "ISO 27001 - 2026" for r in work["rows"])
    assert "/srv/uploads" not in str(work) and "@acme.test" not in str(work)
    assert len(overview.get_work(limit=1, db=db, current_user=user(db))["rows"]) == 1


def test_the_front_door_of_an_organisation_with_no_journey_is_empty_not_an_error(world):
    db = world
    db.query(m.ControlImplementation).delete()
    db.query(m.CertificationJourney).delete()
    db.commit()
    work = overview.get_work(limit=20, db=db, current_user=user(db))
    assert work == {"counters": {"files_to_review": 0, "scope_to_decide": 0}, "journeys": [], "journeys_total": 0, "rows": [], "rows_total": 0}


def test_the_overview_keeps_its_old_count_and_tells_waiting_from_turned_down(world):
    db = world
    request(db, 1, "pending")
    request(db, 2, "rejected", reviewed_by=7, reviewed_at=T0)
    request(db, 3, "approved", True, reviewed_by=7, reviewed_at=T0)
    db.commit()
    c = overview.get_overview(1, db=db, current_user=user(db))["controls"]
    assert c["pending_applicability"] == 2, "the old key keeps its old meaning"
    assert (c["waiting_applicability"], c["rejected_applicability"], c["in_scope"], c["untouched"]) == (1, 1, 1, 1)


def test_the_controls_list_says_a_turned_down_request_is_turned_down_and_who_decided(world):
    db = world
    request(db, 1, "pending")
    request(db, 2, "rejected", reviewed_by=7, reviewed_at=T0, review_comment="No")
    request(db, 3, "approved", False, reviewed_by=7, reviewed_at=T0)
    db.commit()
    rows = {r["control_id"]: r["applicability"] for r in controls.list_controls(1, applicability=None, implementation_status=None, db=db, current_user=user(db))["controls"]}
    assert {c: rows[c]["decision"] for c in rows} == {"FW-001": "pending", "FW-002": "rejected", "FW-003": "out_of_scope", "FW-004": "untouched"}
    assert rows["FW-002"]["state"] == "pending", "the old key is unchanged"
    assert rows["FW-002"]["reviewed_by_name"] == "Ada Admin"
    detail = controls.get_control_detail(1, 2, db=db, current_user=user(db))["applicability"]
    assert detail["decision"] == "rejected" and detail["reviewed_by_name"] == "Ada Admin"
