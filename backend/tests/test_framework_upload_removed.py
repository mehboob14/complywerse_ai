"""The framework upload feature is gone; the framework library API it lived in still answers.

Removed: uploading a document, extracting its text, AI parsing (and retry), classifying from the file, parsed-control
review, alignment to the control library, publishing, and the framework assessments (with their evidence) that sat
beside them. Kept, because other pages read them: list / read / delete of frameworks, their controls, evidence
requirements with the review workflow, and the AI evidence-recommendation actions.
"""
import importlib.util

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.main import app
from grc.models import get_db
from grc.routers.auth_router import require_auth


def _routes():
    return {(method, r.path) for r in app.routes if hasattr(r, "methods") for method in r.methods}


def test_no_route_can_bring_a_framework_in_or_process_one():
    routes = _routes()
    gone = {
        ("POST", "/framework-upload/upload"),
        ("POST", "/framework-upload/upload/{framework_id}/extract-text"),
        ("POST", "/framework-upload/parser/{framework_id}/parse"),
        ("POST", "/framework-upload/parser/{framework_id}/parse-sync"),
        ("POST", "/framework-upload/parser/{framework_id}/retry-parse"),
        ("GET", "/framework-upload/parser/{framework_id}/parse-status"),
        ("POST", "/framework-upload/parser/{framework_id}/classify"),
        ("PUT", "/framework-upload/parser/controls/{control_id}"),
        ("POST", "/framework-upload/parser/controls/{control_id}/verify"),
        ("DELETE", "/framework-upload/parser/controls/{control_id}"),
    }
    assert not gone & routes, sorted(gone & routes)
    for prefix in ("/framework-upload/alignment", "/framework-upload/assessment",
                   "/framework-upload/evidence", "/framework-upload/publish"):
        assert not [p for _m, p in routes if p == prefix or p.startswith(prefix + "/")], prefix


def test_the_library_endpoints_other_pages_use_are_still_there():
    routes = _routes()
    kept = {
        ("GET", "/framework-upload/upload"),
        ("GET", "/framework-upload/upload/{framework_id}"),
        ("DELETE", "/framework-upload/upload/{framework_id}"),
        ("GET", "/framework-upload/parser/{framework_id}/controls"),
        ("POST", "/framework-upload/parser/frameworks/{framework_id}/enhance"),
        ("GET", "/framework-upload/parser/{framework_id}/evidence-requirements"),
        ("POST", "/framework-upload/parser/evidence-requirements/{requirement_id}/submit"),
        ("POST", "/framework-upload/parser/evidence-requirements/{requirement_id}/review"),
        ("POST", "/framework-upload/parser/evidence-requirements/{requirement_id}/approve"),
        ("POST", "/framework-upload/parser/evidence-requirements/{requirement_id}/reject"),
    }
    assert kept <= routes, sorted(kept - routes)


def test_the_code_behind_the_removed_feature_is_gone_but_shared_pieces_moved():
    base = "grc.modules.framework_upload.routers"
    for name in ("alignment", "assessment", "evidence", "publish"):
        assert importlib.util.find_spec(f"{base}.{name}") is None, name

    from grc.tasks import frameworks as tasks
    assert not hasattr(tasks, "parse_framework")                      # the document parser went with the upload
    assert hasattr(tasks, "enhance_framework_controls") and hasattr(tasks, "generate_evidence_requirements")

    # reading, rating and clause-matching an uploaded evidence file is shared with certification journeys
    from grc.services import evidence_review
    certification = importlib.import_module("grc.routers.certification_router")    # the module, not the APIRouter the package exports
    assert certification.evidence_review is evidence_review

    from grc.permissions import PERMISSION_MATRIX
    subs = {s["name"] for mod in PERMISSION_MATRIX if mod["module"] == "frameworks" for s in mod["submodules"]}
    assert "framework_upload" not in subs and {"framework_library", "framework_mapping"} <= subs


@pytest.fixture
def api():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    db = Session(engine)
    db.add(m.Tenant(id=1, name="Demo Bank", slug="demo"))
    user = m.GRCUser(id=7, username="owner", email="owner@bank.example", display_name="Owner")
    db.add(user)
    db.flush()
    db.add_all([
        m.UploadedFramework(id=1, tenant_id=1, name="ISO 27001", file_name="iso.pdf", file_path="iso.pdf",
                            file_type="pdf", upload_status="parsed", classification="certification", uploaded_by=7),
        m.UploadedFramework(id=2, tenant_id=1, name="GDPR", file_name="gdpr.pdf", file_path="gdpr.pdf",
                            file_type="pdf", upload_status="completed", uploaded_by=7),
    ])
    db.flush()
    db.add(m.ParsedFrameworkControl(uploaded_framework_id=1, control_id="A.5.1", title="Policies for information security",
                                    original_reference="A.5.1"))
    db.commit()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: user
    yield TestClient(app), db
    app.dependency_overrides.clear()
    db.close()


def test_the_library_lists_reads_and_deletes_frameworks(api):
    http, db = api
    listed = http.get("/framework-upload/upload", params={"limit": 1000}).json()
    by_name = {f["name"]: f for f in listed["items"]}
    assert set(by_name) == {"ISO 27001", "GDPR"} and listed["total"] == 2
    assert by_name["ISO 27001"]["parsed_controls_count"] == 1 and by_name["ISO 27001"]["classification"] == "certification"

    one = http.get("/framework-upload/upload/1")
    assert one.status_code == 200 and one.json()["name"] == "ISO 27001"
    assert http.get("/framework-upload/upload/99").status_code == 404

    controls = http.get("/framework-upload/parser/1/controls")
    assert controls.status_code == 200, controls.text

    assert http.delete("/framework-upload/upload/2").status_code == 204
    assert db.get(m.UploadedFramework, 2) is None and db.get(m.UploadedFramework, 1) is not None


def test_nothing_can_be_uploaded(api):
    http, _db = api
    files = {"file": ("iso.pdf", b"%PDF-1.4 stub", "application/pdf")}
    gone = http.post("/framework-upload/upload", files=files, data={"name": "ISO 27001"})
    assert gone.status_code in (404, 405)                                  # no POST on /upload any more
    assert http.post("/framework-upload/parser/1/parse").status_code in (404, 405)
