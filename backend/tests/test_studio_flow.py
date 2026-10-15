"""The AI Studio end to end: sessions, chat turns through the guard, placing and accepting the AI's changes, references and the
quotes checked against them, checks, compare, and moving a document into the library. Claude is a mocked wire; the SDK,
the guard, the ledger, the engine, the service and the HTTP routes are the real ones."""
import json
import re
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.modules.governance.studio import blocks as B
from grc.modules.governance.studio import jobs, service
from grc.modules.governance.studio.router import router
from grc.routers.auth_router import require_auth
from grc.services.ai_gateway import claude_client
from grc.services.ai_gateway import dictionary as dictionaries

from _claude_mock import Wire, error, reply

ENTITY = "Capital Financial Services Bank"
POLICY = """# Information Security Policy

## 1. Purpose

This policy protects the information assets of the organisation.

## 2. Scope

All employees and contractors.

## 3. Access Control

Access to systems shall be reviewed every year.

Service account password=hunter-ZX81-canary! is rotated by IT.
"""


def answer(changes=(), reply_text="Done.", used=(), questions=(), requirements=()):
    return json.dumps({"reply": reply_text, "changes": list(changes), "references_used": list(used), "questions": list(questions),
                       "placeholders": [], "requirements": list(requirements)})


def change(kind, start="", end="", markdown="", reason="because", refs=()):
    return {"kind": kind, "start": start, "end": end, "markdown": markdown, "reason": reason, "refs": list(refs)}


@pytest.fixture
def world(monkeypatch, tmp_path):
    monkeypatch.setenv("SESSION_SECRET", "a-test-secret")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("DOCUMENT_STUDIO_AUTO_DRAFT", "off")        # a new document is not written on creation here; test_studio_draft.py turns it on
    for name in ("AI_GATEWAY_MODE", "DOCUMENT_STUDIO_MODEL", "ANTHROPIC_REFUSAL_FALLBACK"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(claude_client, "_fallbacks_rejected", False)
    monkeypatch.setattr(jobs, "INLINE", True)
    monkeypatch.setattr(service, "UPLOAD_DIR", str(tmp_path / "studio"))
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory() as s:
        s.add(m.Tenant(id=1, name="CFSB", slug="cfsb", legal_entity=ENTITY))
        s.add(m.GRCUser(id=1, username="olivia", email="o@cfsb.test", display_name="Olivia Owner"))
        s.add(m.GRCUser(id=2, username="sam", email="s@cfsb.test", display_name="Sam Other"))
        s.add(m.Role(id=11, tenant_id=1, name="Tenant Admin"))
        s.add(m.UserRole(user_id=1, role_id=11, tenant_id=1))                               # Olivia administers; Sam does not
        s.add(m.GovernanceDocument(id=10, tenant_id=1, title="Information Security Policy", doc_type="policy", status="published",
                                   current_version="1.0", content=POLICY.replace("password=hunter-ZX81-canary!", "password rotation"), owner_id=1))
        s.add(m.GovernanceDocument(id=11, tenant_id=1, title="Access Control Standard", doc_type="standard", status="draft", current_version="1.0",
                                   content="# Access Control Standard\n\n## 1. Requirements\n\nAccounts shall be reviewed quarterly.\n", parent_document_id=10, owner_id=1))
        s.add(m.UploadedFramework(id=1, tenant_id=None, name="ISO/IEC 27001", version="2022", source_organization="ISO", is_shared=True, is_active=True,
                                  upload_status="parsed", file_name="x.pdf", file_path="x.pdf", file_type="pdf", uploaded_by=1))
        for cid, ref, title, desc, dom in (("FW-1", "A.5.1", "Policies for information security", "Information security policy and topic-specific policies shall be defined, approved by management, published and communicated.", "Organizational"),
                                           ("FW-2", "A.5.10", "Acceptable use of information", "Rules for acceptable use of information and assets shall be identified and documented.", "Organizational"),
                                           ("FW-3", "A.8.2", "Privileged access rights", "The allocation and use of privileged access rights shall be restricted and managed.", "Technological")):
            s.add(m.ParsedFrameworkControl(uploaded_framework_id=1, control_id=cid, original_reference=ref, title=title, description=desc, domain=dom))
        s.commit()
        d = dictionaries.build(s)
    monkeypatch.setattr(dictionaries, "get", lambda slug, d=d: d)
    monkeypatch.setattr("grc.db.open_tenant_session", lambda slug: factory())
    monkeypatch.setattr("grc.modules.governance.routers.documents._resolve_tenant_slug_for_autoparse", lambda tenant_id: None)   # never reach for the real master database

    app = FastAPI()
    app.include_router(router, prefix="/governance")
    db = factory()
    me = {"id": 1}
    app.dependency_overrides[m.get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(m.GRCUser, me["id"])
    state = SimpleNamespace(factory=factory, db=db, me=me, http=TestClient(app), wire=None)

    def respond_with(fn):
        state.wire = Wire(fn)
        monkeypatch.setattr(claude_client, "_client", state.wire.client)
        return state.wire
    state.respond = respond_with
    state.api = lambda path: f"/governance/studio{path}"
    yield state
    db.close()


def last_body(world):
    return world.wire.requests[-1].body


def user_turn(world):
    return last_body(world)["messages"][-1]["content"]


def token_of(world, kind="ORG"):
    return re.findall(rf"<{kind}_\d+>", json.dumps(last_body(world)))[0]


# ── enabling ─────────────────────────────────────────────────────────────────
def test_only_the_configured_tenants_have_the_studio(world):
    assert world.http.get(world.api("/status")).json() == {"enabled": True, "ai_configured": True, "doc_types": [
        "policy", "standard", "procedure", "guideline", "charter", "other"], "max_upload_mb": 30, "is_admin": True}
    world.me["id"] = 2
    assert world.http.get(world.api("/status")).json()["is_admin"] is False
    world.me["id"] = 1
    world.db.query(m.Tenant).one().slug = "acme"
    world.db.commit()
    assert world.http.get(world.api("/status")).json() == {"enabled": False}
    assert world.http.get(world.api("/sessions")).status_code == 404


# ── starting ─────────────────────────────────────────────────────────────────
def test_a_new_document_starts_from_the_template_with_the_entity_name_filled_in(world):
    s = world.http.post(world.api("/sessions"), json={"kind": "new", "title": "Access Control Policy", "doc_type": "policy"}).json()
    assert s["revision"] == 1 and s["doc_type"] == "policy" and s["template_id"] == "builtin:policy" and s["base_label"] == "Started from Policy (standard structure)"
    assert s["content"].startswith("# Access Control Policy") and "## 3. Purpose" in s["content"]
    assert s["instructions"]["entity_name"] == ENTITY
    blank = world.http.post(world.api("/sessions"), json={"kind": "new", "title": "Memo", "doc_type": "other", "template_id": "builtin:blank"}).json()
    assert blank["content"] == "# Memo\n" and blank["template_id"] == "builtin:blank"


def test_a_library_document_and_an_uploaded_text_file_open_as_sessions(world):
    s = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 10}).json()
    assert s["document_id"] == 10 and s["title"] == "Information Security Policy" and "## 2. Scope" in s["content"] and s["base_label"] == "Information Security Policy v1.0"
    up = world.http.post(world.api("/sessions/upload"), files={"file": ("notes.md", b"# Notes\n\nA paragraph.\n", "text/markdown")}, data={"doc_type": "guideline"}).json()
    assert up["kind"] == "upload" and up["source"]["kind"] == "md" and up["content"] == "# Notes\n\nA paragraph.\n" and up["title"] == "notes"
    assert world.http.post(world.api("/sessions/upload"), files={"file": ("x.exe", b"MZ", "application/octet-stream")}).status_code == 400
    assert [i["id"] for i in world.http.get(world.api("/sessions")).json()["items"]][:2] == [up["id"], s["id"]]


# ── a chat turn ──────────────────────────────────────────────────────────────
def test_the_first_draft_of_a_blank_document_is_applied_and_the_entity_name_never_leaves(world):
    s = world.http.post(world.api("/sessions"), json={"kind": "new", "title": "Access Control Policy", "template_id": "builtin:blank", "doc_type": "other"}).json()

    def respond(body):
        org = re.findall(r"<ORG_\d+>", json.dumps(body))[0]
        md = f"# Access Control Policy\n\n*Owned by {org}*\n\n## Purpose\n\n{org} shall control access to its systems.\n\n## Scope\n\n[[Who and what this applies to]]\n"
        return reply(answer([change("replace_all", markdown=md)], "I drafted the policy with two sections."))
    world.respond(respond)
    out = world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"text": "Write an access control policy for our staff."}).json()
    assert out["status"] in ("working", "done")
    done = world.http.get(world.api(f"/sessions/{s['id']}/messages/{out['id']}")).json()
    assert done["status"] == "done" and done["content"] == "I drafted the policy with two sections."
    assert [o["status"] for o in done["proposal"]["ops"]] == ["accepted"]

    session = world.http.get(world.api(f"/sessions/{s['id']}")).json()
    assert session["revision"] == 2 and f"*Owned by {ENTITY}*" in session["content"] and f"{ENTITY} shall control access" in session["content"]
    sent = json.dumps(last_body(world))
    assert ENTITY not in sent and "<ORG_1>" in sent                                    # the real name was replaced on the way out
    body = last_body(world)
    assert body["output_config"]["effort"] == "high" and body["output_config"]["format"]["schema"]["required"][0] == "reply"
    assert "Entity name: <ORG_1>" in user_turn(world) and "[B1] # Access Control Policy" in user_turn(world)
    revs = world.http.get(world.api(f"/sessions/{s['id']}/revisions")).json()["items"]
    assert [(r["number"], r["author_type"]) for r in revs] == [(2, "ai"), (1, "system")]
    assert revs[0]["summary"] == "The AI wrote the first draft"


def test_a_change_to_an_existing_document_waits_for_the_person_and_only_touches_its_blocks(world):
    s = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 10}).json()
    world.respond(lambda body: reply(answer([change("replace", "B7", markdown="Access to systems shall be reviewed every quarter.", reason="quarterly"),
                                              change("insert", "B5", markdown="Contractors are in scope.")], "Made access reviews quarterly.")))
    msg = world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"text": "Make access reviews quarterly and mention contractors."}).json()
    done = world.http.get(world.api(f"/sessions/{s['id']}/messages/{msg['id']}")).json()
    ops = done["proposal"]["ops"]
    assert [(o["id"], o["status"]) for o in ops] == [("c1", "pending"), ("c2", "pending")]
    assert ops[0]["before"][0]["text"] == "Access to systems shall be reviewed every year." and ops[0]["words_added"] >= 1
    assert world.http.get(world.api(f"/sessions/{s['id']}")).json()["revision"] == 1                 # nothing changed yet
    preview = world.http.get(world.api(f"/sessions/{s['id']}/messages/{msg['id']}/redline")).json()
    assert {r["status"] for r in preview["rows"]} == {"equal", "modified", "inserted"}

    accepted = world.http.post(world.api(f"/sessions/{s['id']}/messages/{msg['id']}/accept"), json={"op_ids": ["c1"]}).json()
    assert (accepted["accepted"], accepted["conflicts"], accepted["revision"]) == (1, 0, 2)
    assert "reviewed every quarter" in accepted["content"] and "Contractors are in scope" not in accepted["content"]
    assert "## 2. Scope" in accepted["content"]                                                       # untouched text is untouched
    rejected = world.http.post(world.api(f"/sessions/{s['id']}/messages/{msg['id']}/reject"), json={}).json()
    assert [o["status"] for o in rejected["message"]["proposal"]["ops"]] == ["accepted", "rejected"]


def test_a_change_is_placed_on_the_document_as_it_is_now_and_a_block_the_person_edited_is_a_conflict(world):
    s = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 10}).json()
    world.respond(lambda body: reply(answer([change("replace", "B5", markdown="All staff, contractors and third parties."),
                                              change("replace", "B7", markdown="Access to systems shall be reviewed every quarter.")])))
    msg = world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"text": "Widen the scope and review quarterly."}).json()
    # meanwhile the person adds a paragraph at the top and rewrites the scope paragraph
    edited = s["content"].replace("## 1. Purpose", "A paragraph the person added.\n\n## 1. Purpose").replace("All employees and contractors.", "Everyone.")
    saved = world.http.put(world.api(f"/sessions/{s['id']}/content"), json={"content": edited, "base_revision": 1}).json()
    assert saved["saved"] and saved["revision"] == 2
    out = world.http.post(world.api(f"/sessions/{s['id']}/messages/{msg['id']}/accept"), json={}).json()
    assert (out["accepted"], out["conflicts"]) == (1, 1)
    statuses = {o["id"]: o["status"] for o in out["message"]["proposal"]["ops"]}
    assert statuses == {"c1": "conflict", "c2": "accepted"}
    assert "Everyone." in out["content"] and "reviewed every quarter" in out["content"] and "A paragraph the person added." in out["content"]


def test_changes_that_do_not_fit_or_touch_a_protected_block_or_carry_html_are_handled(world):
    doc = world.db.get(m.GovernanceDocument, 10)
    doc.content = POLICY                                              # holds a secret: the AI never sees that block whole
    world.db.commit()
    s = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 10}).json()
    world.respond(lambda body: reply(answer([
        change("replace", "B8", markdown="Service accounts rotate daily."),                               # the protected block
        change("replace", "B99", markdown="Nowhere."),                                                    # no such block
        change("replace", "B5", markdown="Everyone.<script>alert(1)</script> <div>in a div</div> <u>underlined</u>")], "Edited.")))
    msg = world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"text": "Tidy this."}).json()
    done = world.http.get(world.api(f"/sessions/{s['id']}/messages/{msg['id']}")).json()
    assert [(o["id"], o["markdown"]) for o in done["proposal"]["ops"]] == [("c3", "Everyone. in a div <u>underlined</u>")]
    assert len(done["notes"]) == 2 and any("protected value" in n for n in done["notes"]) and any("no block range" in n for n in done["notes"])
    assert "[B8 read-only]" in user_turn(world) and "hunter-ZX81" not in json.dumps(last_body(world))


def test_a_busy_session_refuses_a_second_request_and_a_dead_turn_is_closed(world):
    s = world.http.post(world.api("/sessions"), json={"kind": "new", "title": "T", "template_id": "builtin:blank", "doc_type": "other"}).json()
    working = m.StudioMessage(session_id=s["id"], role="assistant", kind="chat", status="working", stage="Writing", created_by=1)
    world.db.add(working)
    world.db.commit()
    world.respond(lambda body: reply(answer()))
    busy = world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"text": "Again"})
    assert busy.status_code == 400 and "still working" in busy.json()["detail"]
    from datetime import datetime, timedelta
    working.updated_at = datetime.utcnow() - timedelta(minutes=30)
    world.db.commit()
    assert world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"text": "Again"}).status_code == 200
    old = world.http.get(world.api(f"/sessions/{s['id']}/messages/{working.id}")).json()
    assert old["status"] == "error" and "interrupted" in old["error"]


def test_failures_become_sentences_the_person_can_read(world):
    s = world.http.post(world.api("/sessions"), json={"kind": "new", "title": "T", "template_id": "builtin:blank", "doc_type": "other"}).json()
    world.respond(lambda body: error(429, "slow down", "rate_limit_error"))
    msg = world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"text": "Write it"}).json()
    done = world.http.get(world.api(f"/sessions/{s['id']}/messages/{msg['id']}")).json()
    assert done["status"] == "error" and "busy" in done["error"] and "claude" not in done["error"].lower()
    world.respond(lambda body: reply(answer([change("replace_all", markdown="")])))
    msg = world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"text": "Write it"}).json()
    done = world.http.get(world.api(f"/sessions/{s['id']}/messages/{msg['id']}")).json()
    assert done["status"] == "done" and done["proposal"]["ops"] == [] and any("empty" in n for n in done["notes"])


def test_without_credentials_a_request_is_refused_up_front(world, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    s = world.http.post(world.api("/sessions"), json={"kind": "new", "title": "T", "template_id": "builtin:blank", "doc_type": "other"}).json()
    out = world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"text": "Write it"})
    assert out.status_code == 503 and "AI is not set up" in out.json()["detail"]
    assert world.http.get(world.api("/status")).json()["ai_configured"] is False


# ── references ───────────────────────────────────────────────────────────────
def test_a_parent_document_a_framework_and_an_upload_are_attached_shown_to_the_ai_and_their_quotes_checked(world):
    s = world.http.post(world.api("/sessions"), json={"kind": "new", "title": "Access Control Standard", "template_id": "builtin:blank", "doc_type": "other"}).json()
    sid = s["id"]
    parent = world.http.post(world.api(f"/sessions/{sid}/references"), json={"kind": "document", "source_id": 10}).json()
    fw = world.http.post(world.api(f"/sessions/{sid}/references"), json={"kind": "framework", "source_id": 1, "scope": {"mode": "domains", "domains": ["Organizational"]}}).json()
    up = world.http.post(world.api(f"/sessions/{sid}/references/upload"), files={"file": ("rules.txt", b"Contractors shall sign an acceptable use agreement before access is granted.", "text/plain")}).json()
    assert (parent["key"], fw["key"], up["key"]) == ("R1", "R2", "R3")
    assert fw["scope"]["count"] == 2 and fw["scope"]["total"] == 3 and "2 of 3 controls" in fw["label"]
    again = world.http.post(world.api(f"/sessions/{sid}/references"), json={"kind": "document", "source_id": 10}).json()
    assert again["id"] == parent["id"]                                                                 # the same reference is not attached twice

    used = [
        {"ref": "R1", "locator": "Purpose", "quote": "This policy protects the information assets of the organisation.", "how": "same purpose", "basis": "reference"},
        {"ref": "R2", "locator": "A.5.1", "quote": "Information security policy and topic-specific policies shall be defined", "how": "policy approval", "basis": "reference"},
        {"ref": "R2", "locator": "A.8.2", "quote": "The allocation and use of privileged access rights shall be restricted", "how": "privileged access", "basis": "reference"},
        {"ref": "R3", "locator": "line 1", "quote": "Contractors must carry a badge at all times.", "how": "badges", "basis": "reference"},
        {"ref": "", "locator": "", "quote": "", "how": "common practice", "basis": "general_knowledge"}]
    world.respond(lambda body: reply(answer([change("replace_all", markdown="# Access Control Standard\n\n## Requirements\n\nContractors shall sign an acceptable use agreement.\n")],
                                             "Drafted from the references.", used)))
    msg = world.http.post(world.api(f"/sessions/{sid}/messages"), json={"text": "Draft the standard from the policy, the framework and the contractor rules."}).json()
    done = world.http.get(world.api(f"/sessions/{sid}/messages/{msg['id']}")).json()
    turn = user_turn(world)
    assert '<reference id="R1" kind="document"' in turn and "[A.5.1] Policies for information security" in turn and "acceptable use agreement" in turn
    assert "[A.8.2]" not in turn and "## Organizational" in turn                                       # only the chosen domain was sent
    by = {(u["ref"], u["locator"]): u for u in done["references_used"]}
    assert by[("R1", "Purpose")]["verified"] is True and by[("R2", "A.5.1")]["verified"] is True and by[("R2", "A.5.1")]["locator_ok"] is True
    assert by[("R2", "A.8.2")]["verified"] is False and by[("R2", "A.8.2")]["locator_ok"] is False        # a control that was not given
    assert by[("R3", "line 1")]["verified"] is False and by[("", "")]["verified"] is None
    assert any("could not be found" in n for n in done["notes"])
    toggled = world.http.patch(world.api(f"/sessions/{sid}/references/{up['id']}?include=false")).json()
    assert toggled["include"] is False
    assert "acceptable use agreement" in world.http.get(world.api(f"/sessions/{sid}/references/{up['id']}")).json()["text"]


def test_a_framework_that_is_not_available_and_scf_text_are_refused(world, monkeypatch):
    s = world.http.post(world.api("/sessions"), json={"kind": "new", "title": "T", "template_id": "builtin:blank", "doc_type": "other"}).json()
    fw = world.db.get(m.UploadedFramework, 1)
    fw.is_active = False
    world.db.commit()
    assert world.http.post(world.api(f"/sessions/{s['id']}/references"), json={"kind": "framework", "source_id": 1}).status_code == 400
    fw.is_active = True
    world.db.commit()
    assert world.http.post(world.api(f"/sessions/{s['id']}/references"), json={"kind": "framework", "source_id": 1, "scope": {"mode": "domains", "domains": ["Nope"]}}).status_code == 400
    monkeypatch.setattr("grc.services.licence_guard.find_restricted", lambda text: "scf sentence")
    out = world.http.post(world.api(f"/sessions/{s['id']}/references"), json={"kind": "document", "source_id": 10})
    assert out.status_code == 400 and "Secure Controls Framework" in out.json()["detail"]
    assert world.http.post(world.api(f"/sessions/{s['id']}/references"), json={"kind": "document", "source_id": 999}).status_code == 400


def test_the_pickers_list_library_documents_and_usable_frameworks(world):
    docs = world.http.get(world.api("/documents?q=access")).json()["items"]
    assert [d["title"] for d in docs] == ["Access Control Standard"]
    fws = world.http.get(world.api("/frameworks")).json()["items"]
    assert fws == [{"id": 1, "name": "ISO/IEC 27001", "version": "2022", "organisation": "ISO", "controls": 3, "domains": ["Organizational", "Technological"]}]


# ── saving, history, restore ─────────────────────────────────────────────────
def test_saving_makes_revisions_refuses_a_stale_editor_and_can_restore(world):
    s = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 10}).json()
    url = world.api(f"/sessions/{s['id']}/content")
    same = world.http.put(url, json={"content": s["content"], "base_revision": 1}).json()
    assert same["saved"] is False and same["revision"] == 1
    changed = s["content"].replace("every year", "every six months")
    assert world.http.put(url, json={"content": changed, "base_revision": 1}).json()["revision"] == 2
    stale = world.http.put(url, json={"content": changed + "\nMore.\n", "base_revision": 1})
    assert stale.status_code == 409 and "Reload" in stale.json()["detail"]
    diff = world.http.get(world.api(f"/sessions/{s['id']}/diff?from=0&to=2")).json()
    assert diff["stats"]["modified"] == 1 and any(r["status"] == "modified" for r in diff["rows"])
    back = world.http.post(world.api(f"/sessions/{s['id']}/restore/1")).json()
    assert back["revision"] == 3 and "every year" in back["content"]
    revs = world.http.get(world.api(f"/sessions/{s['id']}/revisions")).json()["items"]
    assert [(r["number"], r["author_type"]) for r in revs] == [(3, "restore"), (2, "user"), (1, "import")]
    assert world.http.get(world.api(f"/sessions/{s['id']}/diff?from=0&to=9")).status_code == 400


def test_a_session_belongs_to_the_person_who_opened_it(world):
    s = world.http.post(world.api("/sessions"), json={"kind": "new", "title": "Mine", "template_id": "builtin:blank", "doc_type": "other"}).json()
    world.me["id"] = 2
    assert world.http.get(world.api(f"/sessions/{s['id']}")).status_code == 404
    assert world.http.get(world.api("/sessions")).json()["items"] == []
    world.me["id"] = 1
    assert world.http.delete(world.api(f"/sessions/{s['id']}")).json() == {"deleted": True}
    assert world.http.get(world.api(f"/sessions/{s['id']}")).status_code == 404


# ── checks ───────────────────────────────────────────────────────────────────
def test_the_checks_need_no_ai_and_a_simple_fix_is_one_revision(world):
    s = world.http.post(world.api("/sessions"), json={"kind": "new", "title": "Policy", "doc_type": "policy"}).json()
    world.http.patch(world.api(f"/sessions/{s['id']}"), json={"instructions": {"entity_name": "Nowhere Bank", "logo_required": True}})
    out = world.http.post(world.api(f"/sessions/{s['id']}/checks")).json()
    rules = {i["rule"] for i in out["issues"]}
    assert {"placeholder", "entity_missing", "logo_missing"} <= rules and out["summary"]["must_fill"] > 3
    messy = world.http.put(world.api(f"/sessions/{s['id']}/content"), json={"content": s["content"] + "\n\nThe the rule  applies.\n", "base_revision": 1}).json()
    one = next(i for i in world.http.post(world.api(f"/sessions/{s['id']}/checks")).json()["issues"] if i["rule"] == "repeated_word")
    fixed = world.http.post(world.api(f"/sessions/{s['id']}/checks/fix"), json={"fix": one["fix"], "message": one["message"]}).json()
    assert "The rule" in fixed["content"] and fixed["revision"] == messy["revision"] + 1
    stale_fix = world.http.post(world.api(f"/sessions/{s['id']}/checks/fix"), json={"fix": one["fix"]})
    assert stale_fix.status_code == 409
    many = world.http.post(world.api(f"/sessions/{s['id']}/checks/fix-all"), json={}).json()
    assert many["fixed"] >= 1 and "rule applies" in many["content"]


def test_the_ai_check_keeps_only_findings_that_are_really_in_the_document(world):
    s = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 10}).json()
    world.http.patch(world.api(f"/sessions/{s['id']}"), json={"instructions": {"requirements": ["Mention contractors", "Name the CISO"]}})
    world.respond(lambda body: reply(json.dumps({
        "issues": [
            {"block": "B5", "kind": "grammar", "quote": "All employees and contractors", "suggestion": "All employees, and all contractors", "message": "comma", "severity": "info"},
            {"block": "B5", "kind": "spelling", "quote": "a phrase that is not there", "suggestion": "x", "message": "made up", "severity": "error"},
            {"block": "B99", "kind": "grammar", "quote": "x", "suggestion": "y", "message": "no block", "severity": "error"},
            {"block": "B3", "kind": "consistency", "quote": "organisation", "suggestion": "", "message": "check", "severity": "warning"}],
        "requirements": [{"requirement": "Mention contractors", "status": "met", "evidence": "All employees and contractors.", "block": "B5"},
                         {"requirement": "Name the CISO", "status": "not_met", "evidence": "no CISO named", "block": ""}],
        "summary": "Mostly clean."})))
    out = world.http.post(world.api(f"/sessions/{s['id']}/checks?ai=true")).json()
    assert out["ai_message"]["status"] in ("working", "done")
    msg = world.http.get(world.api(f"/sessions/{s['id']}/checks/ai")).json()
    assert msg["stale"] is False and msg["message"]["content"] == "Mostly clean."
    issues = msg["message"]["proposal"]["issues"]
    assert [(i["block"], i["quote"], bool(i["fix"])) for i in issues] == [(4, "All employees and contractors", True), (2, "organisation", False)]
    assert [(r["requirement"], r["status"]) for r in msg["message"]["proposal"]["requirements"]] == [("Mention contractors", "met"), ("Name the CISO", "not_met")]
    assert "<required_items>" in user_turn(world) and "- Name the CISO" in user_turn(world)
    fix = world.http.post(world.api(f"/sessions/{s['id']}/checks/fix"), json={"fix": issues[0]["fix"]}).json()
    assert "All employees, and all contractors." in fix["content"]
    assert world.http.get(world.api(f"/sessions/{s['id']}/checks/ai")).json()["stale"] is True            # the document moved on


# ── compare ──────────────────────────────────────────────────────────────────
def test_compare_gives_the_redline_now_and_an_explanation_on_request(world):
    s = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 10}).json()
    out = world.http.post(world.api(f"/sessions/{s['id']}/compare"), json={"document_id": 11}).json()
    assert out["other_title"] == "Access Control Standard" and out["stats"]["inserted"] > 0 and out["rows"]
    world.respond(lambda body: reply(json.dumps({"summary": "A is a policy, B a standard.", "differences": [
        {"topic": "Review frequency", "in_a": "Every year.", "in_b": "Quarterly.", "importance": "high", "recommendation": "Align on quarterly."}],
        "recommendation": "Align the review frequency."})))
    with_ai = world.http.post(world.api(f"/sessions/{s['id']}/compare"), json={"document_id": 11, "ai": True}).json()
    msg = world.http.get(world.api(f"/sessions/{s['id']}/messages/{with_ai['ai_message']['id']}")).json()
    assert msg["status"] == "done" and msg["proposal"]["differences"][0]["topic"] == "Review frequency" and msg["content"] == "A is a policy, B a standard."
    assert "<document_a" in user_turn(world) and "<document_b" in user_turn(world) and "Accounts shall be reviewed quarterly" in user_turn(world)
    earlier = world.http.post(world.api(f"/sessions/{s['id']}/compare"), json={"revision": 1}).json()
    assert earlier["other_title"] == "Revision 1" and earlier["stats"]["inserted"] == 0
    assert world.http.post(world.api(f"/sessions/{s['id']}/compare"), json={}).status_code == 400


# ── the library ──────────────────────────────────────────────────────────────
def test_a_session_moves_into_the_library_and_then_saves_as_new_versions(world, monkeypatch):
    monkeypatch.setattr("grc.modules.governance.routers.policy_parser.maybe_autoparse_document", lambda *a, **k: False)
    s = world.http.post(world.api("/sessions"), json={"kind": "new", "title": "Access Control Policy", "template_id": "builtin:blank", "doc_type": "other"}).json()
    world.http.put(world.api(f"/sessions/{s['id']}/content"), json={"content": "# Access Control Policy\n\n## Purpose\n\nControl access.\n", "base_revision": 1})
    moved = world.http.post(world.api(f"/sessions/{s['id']}/move-to-library"), json={"doc_type": "policy", "classification": "internal", "parent_document_id": 10}).json()
    doc = world.db.get(m.GovernanceDocument, moved["document_id"])
    assert (doc.title, doc.status, doc.current_version, doc.parent_document_id, doc.owner_id, doc.doc_type) == ("Access Control Policy", "draft", "1.0", 10, 1, "policy")
    assert "Control access." in doc.content
    assert world.db.query(m.DocumentAuditLog).filter_by(document_id=doc.id, action="created").one().action_details.endswith("created in the AI Studio")
    session = world.http.get(world.api(f"/sessions/{s['id']}")).json()
    assert session["kind"] == "library" and session["document_id"] == doc.id and session["base_label"] == "Access Control Policy v1.0"
    assert world.http.post(world.api(f"/sessions/{s['id']}/move-to-library"), json={}).status_code == 400

    nothing = world.http.post(world.api(f"/sessions/{s['id']}/save-to-document"), json={})
    assert nothing.status_code == 400 and "Nothing has changed" in nothing.json()["detail"]
    world.http.put(world.api(f"/sessions/{s['id']}/content"), json={"content": session["content"] + "\n## Scope\n\nAll staff.\n", "base_revision": session["revision"]})
    saved = world.http.post(world.api(f"/sessions/{s['id']}/save-to-document"), json={"change_reason": "Added scope"}).json()
    assert saved["version"] == "1.1" and saved["status"] == "draft"
    world.db.refresh(doc)
    assert "All staff." in doc.content
    versions = world.db.query(m.GovernanceDocumentVersion).filter_by(document_id=doc.id).order_by(m.GovernanceDocumentVersion.id).all()
    assert [(v.version_number, v.status) for v in versions] == [("1.0", "superseded"), ("1.1", "current")] and versions[1].change_reason == "Added scope"


def test_saving_over_a_library_document_that_changed_is_a_conflict_and_approved_documents_go_back_to_review(world):
    s = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 10}).json()
    world.http.put(world.api(f"/sessions/{s['id']}/content"), json={"content": s["content"].replace("every year", "every month"), "base_revision": 1})
    doc = world.db.get(m.GovernanceDocument, 10)
    doc.content = doc.content + "\nSomeone else added this.\n"
    world.db.commit()
    clash = world.http.post(world.api(f"/sessions/{s['id']}/save-to-document"), json={})
    assert clash.status_code == 409 and "changed in the library" in clash.json()["detail"]
    forced = world.http.post(world.api(f"/sessions/{s['id']}/save-to-document"), json={"force": True}).json()
    assert forced["status"] == "pending_review" and "every month" in world.db.get(m.GovernanceDocument, 10).content


# ── templates ────────────────────────────────────────────────────────────────
def test_a_document_is_saved_as_a_template_and_becomes_the_default_for_new_documents(world):
    s = world.http.post(world.api("/sessions"), json={"kind": "new", "title": "CFSB Policy", "template_id": "builtin:blank", "doc_type": "policy"}).json()
    world.http.put(world.api(f"/sessions/{s['id']}/content"), json={"content": "# [[Document title]]\n\n## Purpose\n\n[[Why]]\n\n## Our Own Section\n\n[[What]]\n", "base_revision": 1})
    saved = world.http.post(world.api("/templates"), json={"session_id": s["id"], "name": "CFSB policy", "make_default": True}).json()
    assert saved["is_default"] and [x["title"] for x in saved["structure"]["sections"]] == ["Purpose", "Our Own Section"]
    nxt = world.http.post(world.api("/sessions"), json={"kind": "new", "title": "Backup Policy", "doc_type": "policy"}).json()
    assert nxt["template_id"] == f"tenant:{saved['id'].split(':')[1]}" and nxt["content"].startswith("# Backup Policy") and "## Our Own Section" in nxt["content"]
    listing = world.http.get(world.api("/templates")).json()["items"]
    assert next(t for t in listing if t["id"] == "builtin:policy")["replaced_by_default"] is True
    assert world.http.delete(world.api(f"/templates/{saved['id'].split(':')[1]}")).json() == {"deleted": True}
    assert world.http.post(world.api("/sessions"), json={"kind": "new", "title": "X", "doc_type": "policy"}).json()["template_id"] == "builtin:policy"


def test_only_an_administrator_makes_a_template_the_default_and_only_its_maker_or_an_administrator_changes_it(world):
    world.me["id"] = 2                                                                    # Sam is not an administrator
    mine = world.http.post(world.api("/templates"), json={"name": "Sam's checklist", "doc_type": "procedure", "content": "# Checklist\n\n## Steps\n\nDo it.\n"})
    assert mine.status_code == 200 and mine.json()["is_default"] is False
    mine_id = mine.json()["id"].split(":")[1]
    assert world.http.post(world.api("/templates"), json={"name": "Sam's default", "doc_type": "procedure", "content": "# X\n", "make_default": True}).status_code == 403
    assert world.http.put(world.api(f"/templates/{mine_id}"), json={"name": "Sam's checklist v2", "content": "# Checklist\n\n## Steps\n\nDo it well.\n"}).status_code == 200
    assert world.http.put(world.api(f"/templates/{mine_id}"), json={"name": "Sam's checklist", "make_default": True}).status_code == 403

    world.me["id"] = 1                                                                    # Olivia administers
    theirs = world.http.post(world.api("/templates"), json={"name": "Org default", "doc_type": "standard", "content": "# S\n\n## Rules\n\nAll.\n", "make_default": True}).json()
    org_id = theirs["id"].split(":")[1]
    assert theirs["is_default"] is True
    world.me["id"] = 2
    assert world.http.put(world.api(f"/templates/{org_id}"), json={"name": "Hijacked"}).status_code == 403
    assert world.http.delete(world.api(f"/templates/{org_id}")).status_code == 403
    world.me["id"] = 1
    assert world.http.put(world.api(f"/templates/{mine_id}"), json={"name": "Renamed by the administrator", "make_default": False}).status_code == 200      # an administrator may change anyone's
    world.me["id"] = 2
    assert world.http.delete(world.api(f"/templates/{mine_id}")).json() == {"deleted": True}                                                              # and its maker may remove it
