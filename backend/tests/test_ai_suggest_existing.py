"""Documents suggested for a framework leave out what the organisation already has (the library's drafts, documents in review, approved and
published; not the archived) and what it is writing in the AI Studio, and say which one justified each skip. The AI is a fake client answering
by what it is asked; the dedup stages, the router and the database are the real ones."""
import json
from types import SimpleNamespace

import grc.models as m
from grc.modules.governance.routers import documents

from test_governance_permissions import ADMIN, SAM, world  # noqa: F401  (world is a fixture)

SUGGESTED = [
    {"doc_type": "policy", "title": "Access Policy", "description": "Who may reach the systems.", "priority": "high", "relevant_controls": ["A.5.15"]},
    {"doc_type": "policy", "title": "Encryption Policy", "description": "How data is protected with cryptography.", "priority": "high", "relevant_controls": ["A.8.24"]},
    {"doc_type": "policy", "title": "Password Policy", "description": "How secrets are chosen and kept.", "priority": "medium", "relevant_controls": ["A.5.17"]},
    {"doc_type": "policy", "title": "Clear Desk Policy", "description": "Keeping information out of sight.", "priority": "low", "relevant_controls": ["A.7.7"]},
]


class FakeOpenAI:
    """Answers the suggestion prompt with SUGGESTED and the librarian's duplicate check with none."""

    def __init__(self):
        self.prompts = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        prompt = " ".join(str(x.get("content")) for x in kwargs["messages"])
        self.prompts.append(prompt)
        body = {"duplicates": []} if "Two lists below" in prompt else {"framework_names": "ISO/IEC 27001", "suggestions": SUGGESTED, "total_suggestions": len(SUGGESTED)}
        return SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(content=json.dumps(body)))])


def set_up(world, monkeypatch):
    fake = FakeOpenAI()
    monkeypatch.setattr(documents, "OpenAI", lambda **kwargs: fake)
    monkeypatch.setattr(documents, "AI_INTEGRATIONS_OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(documents, "AI_INTEGRATIONS_OPENAI_BASE_URL", "http://openai.invalid")
    world.me["id"] = ADMIN
    world.db.add(m.UploadedFramework(id=1, tenant_id=None, name="ISO/IEC 27001", version="2022", source_organization="ISO", is_shared=True, is_active=True,
                                     upload_status="parsed", file_name="x.pdf", file_path="x.pdf", file_type="pdf", uploaded_by=1))
    world.db.add(m.ParsedFrameworkControl(uploaded_framework_id=1, control_id="A.5.15", original_reference="A.5.15", title="Access control",
                                          description="Rules to control physical and logical access shall be established.", domain="Organizational"))
    world.db.commit()
    return fake


def suggest(world, **body):
    out = world.http.post("/governance/documents/ai-suggest-policies", json={"framework_ids": [1], **body})
    assert out.status_code == 200, out.text
    return out.json()


def test_a_suggestion_the_library_has_is_left_out_and_an_archived_document_does_not_block_it(world, monkeypatch):
    fake = set_up(world, monkeypatch)
    world.db.add(m.GovernanceDocument(id=7, tenant_id=1, title="Password Policy", doc_type="policy", status="archived", current_version="1.0", content="# Password policy\n"))
    world.db.commit()
    out = suggest(world, doc_type="policy")
    assert [s["title"] for s in out["suggestions"]] == ["Encryption Policy", "Password Policy", "Clear Desk Policy"]         # doc 5 is "Access policy"
    skipped = out["skipped_matches"]
    assert [(x["suggested_title"], x["matched_existing_id"], x["match_type"]) for x in skipped] == [("Access Policy", 5, "exact_normalized")]
    assert skipped[0]["matched_session_id"] is None
    assert {d["id"] for d in out["already_covered"]} == {5, 6}                                                               # archived is not "covered"
    assert "DOCUMENTS THE ORG ALREADY HAS" in fake.prompts[0] and "Access policy" in fake.prompts[0]


def test_a_document_being_written_in_the_studio_is_left_out_too_and_the_skip_says_which_draft(world, monkeypatch):
    set_up(world, monkeypatch)
    draft = m.StudioSession(tenant_id=1, created_by=SAM, title="Encryption Policy", kind="new", doc_type="policy", status="active", instructions={}, settings={})
    moved = m.StudioSession(tenant_id=1, created_by=SAM, title="Clear Desk Policy", kind="new", doc_type="policy", status="moved", instructions={}, settings={})
    blank = m.StudioSession(tenant_id=1, created_by=SAM, title="Untitled document", kind="new", doc_type="policy", status="active", instructions={}, settings={})
    world.db.add_all([draft, moved, blank])
    world.db.commit()
    out = suggest(world, doc_type="policy")
    assert [s["title"] for s in out["suggestions"]] == ["Password Policy", "Clear Desk Policy"]                              # a moved session is the library's, not a draft
    by_title = {x["suggested_title"]: x for x in out["skipped_matches"]}
    assert by_title["Encryption Policy"]["matched_existing_id"] is None and by_title["Encryption Policy"]["matched_session_id"] == draft.id
    assert by_title["Encryption Policy"]["matched_existing_status"] == "studio_draft"
    assert {(d["id"], d["session_id"]) for d in out["already_covered"]} >= {(None, draft.id), (5, None)}
    assert suggest(world, doc_type="procedure")["suggestions"] == []                                                         # the fake answers policies: the type filter holds


def test_no_type_asks_for_every_type_and_an_unknown_one_is_refused(world, monkeypatch):
    fake = set_up(world, monkeypatch)
    suggest(world)
    assert "Cover policy, standard, procedure, and guideline needs systematically, and a charter" in fake.prompts[0]
    assert world.http.post("/governance/documents/ai-suggest-policies", json={"framework_ids": [1], "doc_type": "memo"}).status_code == 400
    assert world.http.post("/governance/documents/ai-suggest-policies", json={"framework_ids": []}).status_code == 400
