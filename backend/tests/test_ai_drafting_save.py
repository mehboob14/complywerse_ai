"""tasks/ai_drafting: a draft asked to be saved as a document (an NCA template re-drafted by AI, a reference law) is saved as a
library draft with its next review set, as a document made with New Document is. The pipeline and the job store are stand-ins;
the save runs on in-memory SQLite."""
from datetime import datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.modules.governance import ai_drafting as drafting
from grc.modules.governance.ai_drafting.pipeline import DraftResult
from grc.tasks import ai_drafting


def test_a_draft_asked_to_be_saved_is_a_library_draft_with_its_next_review(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    jobs = {}                                                              # never Redis
    monkeypatch.setattr(ai_drafting, "_read_job", jobs.get)
    monkeypatch.setattr(ai_drafting, "_write_job", jobs.__setitem__)
    monkeypatch.setattr(drafting, "build_tenant_context", lambda *_a, **_k: type("Ctx", (), {"primary_contact_name": None})())
    monkeypatch.setattr(drafting, "build_framework_index", lambda *_a, **_k: None)
    monkeypatch.setattr(drafting, "run_drafting_pipeline", lambda **_k: DraftResult(
        title="Access Control Policy", doc_type="policy", generated_content="# Access Control Policy\n\nAccess is reviewed.",
        sections=[], framework_alignment=[], word_count=5, qa_failures=[], stage_telemetry={}))

    ai_drafting._execute_drafting("job-1", {
        "tenant_id": 1, "doc_type": "policy", "title": "Access Control Policy", "save_as_document": True,
        "source_template_title": "ECC Access Policy", "user_id": 7, "user_name": "User 7",
    }, db)

    doc = db.query(m.GovernanceDocument).one()
    assert jobs["job-1"]["status"] == "completed" and jobs["job-1"]["result"]["document_id"] == doc.id
    assert (doc.title, doc.status, doc.author_id, doc.document_code) == ("Access Control Policy", "draft", 7, "POLI-0001")
    assert doc.next_review_date > datetime.utcnow() + timedelta(days=360)     # today + the 12-month review cycle
