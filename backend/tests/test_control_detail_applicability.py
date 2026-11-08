"""The control page reads the applicability decision and the request behind it (Controls Automation revamp, workspace group).

`GET /automation/common/controls/{id}` answers an additive `applicability` block: what was decided, why, the request's status (draft / pending_review / approved /
rejected), who asked and who ruled. Nothing the route returned before moved.
"""
from __future__ import annotations

import inspect
import sys
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from grc.models import GRCUser  # noqa: E402
from grc.modules.automation import router as automation_router  # noqa: E402
from grc.modules.scf import ownership  # noqa: E402


@pytest.fixture()
def db():
    engine = create_engine("sqlite://")
    GRCUser.__table__.create(engine)
    session = sessionmaker(bind=engine)()
    session.add_all([GRCUser(id=1, username="ana", email="ana@x.test", display_name="Ana Asker"),
                     GRCUser(id=2, username="rev", email="rev@x.test", display_name="Rey Reviewer")])
    session.commit()
    yield session
    session.close()


def test_a_control_with_no_decision_reads_as_draft_with_nothing_filled(db):
    a = ownership.applicability_fields(db, None)
    assert a["status"] == "draft" and a["is_applicable"] is None and a["requested_by_name"] is None and a["review_comment"] is None


def test_a_pending_request_names_who_asked_and_holds_the_value_asked_for(db):
    st = SimpleNamespace(is_applicable=False, applicability_source="override", applicability_reason="No facilities", obligation=None, status="pending_review",
                         requested_by=1, requested_at=datetime(2026, 11, 8, 9, 0), reviewed_by=None, reviewed_at=None, review_comment=None)
    a = ownership.applicability_fields(db, st)
    assert a["status"] == "pending_review" and a["is_applicable"] is False and a["reason"] == "No facilities"
    assert a["requested_by_name"] == "Ana Asker" and a["requested_at"] == "2026-11-08T09:00:00"
    assert a["reviewed_by_name"] is None


def test_a_ruled_request_names_the_reviewer_and_keeps_the_comment(db):
    st = SimpleNamespace(is_applicable=False, applicability_source="override", applicability_reason="No facilities", obligation="MCR", status="approved",
                         requested_by=1, requested_at=datetime(2026, 11, 8, 9, 0), reviewed_by=2, reviewed_at=datetime(2026, 11, 8, 10, 0), review_comment="Agreed")
    a = ownership.applicability_fields(db, st)
    assert a["status"] == "approved" and a["reviewed_by_name"] == "Rey Reviewer" and a["review_comment"] == "Agreed" and a["obligation"] == "MCR"


def test_an_unset_status_reads_as_draft(db):
    st = SimpleNamespace(is_applicable=None, applicability_source=None, applicability_reason=None, obligation=None, status=None,
                         requested_by=None, requested_at=None, reviewed_by=None, reviewed_at=None, review_comment=None)
    assert ownership.applicability_fields(db, st)["status"] == "draft"


def test_both_detail_builders_answer_it_and_the_old_fields_are_still_there():
    source = inspect.getsource(automation_router)
    assert source.count("scf_own.applicability_fields(db, st)") == 2 and source.count("scf_own.applicability_fields(db, None)") == 2
    for field in ('"exception_id"', '"alternative_scf_id"', '"inheritance_type"', '"provider_vendor_id"', '"designation"', '"cmm_actual"', '"cmm_target"'):
        assert source.count(field) >= 2, field
