"""Accepting Comply Agent's changes to a library draft makes its next version: +0.1 for a minor change, +1.0 for a major one,
the version before kept with its file. A document in review or in force waits for Save to library, which starts the review
again; a document not in the library has no versions."""
import json

from docx import Document

import grc.models as m

from _claude_mock import reply
from test_studio_files import lib, make_library_doc                 # noqa: F401  (lib is a fixture: the library's own folder for files)
from test_studio_flow import answer, change, world                  # noqa: F401  (world is a fixture)


def _ask(world, sid, changes):
    world.respond(lambda body: reply(answer(changes, "Done.")))
    sent = world.http.post(world.api(f"/sessions/{sid}/messages"), json={"text": "Change it."}).json()
    return world.http.get(world.api(f"/sessions/{sid}/messages/{sent['id']}")).json()


def _accept(world, sid, msg, verdict):
    world.respond(lambda body: reply(json.dumps({"change": verdict, "reason": f"A {verdict} change."})))
    out = world.http.post(world.api(f"/sessions/{sid}/messages/{msg['id']}/accept"), json={})
    assert out.status_code == 200, out.text
    return out.json()


def _versions(db, doc_id):
    db.expire_all()
    rows = db.query(m.GovernanceDocumentVersion).filter_by(document_id=doc_id).order_by(m.GovernanceDocumentVersion.id).all()
    return [(r.version_number, r.status) for r in rows]


def test_each_accept_on_a_draft_makes_the_next_version_minor_then_major(world):
    s = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 11}).json()
    msg = _ask(world, s["id"], [change("replace", "B3", markdown="Accounts shall be reviewed monthly.", reason="monthly")])
    out = _accept(world, s["id"], msg, "minor")
    assert out["accepted"] == 1 and out["library_version"] == {"saved": True, "version": "1.1", "change": "minor", "status": "draft"}
    doc = world.db.get(m.GovernanceDocument, 11)
    assert doc.current_version == "1.1" and "reviewed monthly" in doc.content
    assert _versions(world.db, 11)[-1] == ("1.1", "current") and ("1.0", "superseded") in _versions(world.db, 11)   # 1.0 is kept

    msg = _ask(world, s["id"], [change("insert", "B3", markdown="## 2. Exceptions\n\nExceptions need the CISO's approval.", reason="exceptions")])
    out = _accept(world, s["id"], msg, "major")
    assert out["library_version"]["version"] == "2.0" and out["library_version"]["change"] == "major"
    assert [v for v, st in _versions(world.db, 11) if st == "current"] == ["2.0"]


def test_a_published_document_waits_for_save_to_library(world):
    before = _versions(world.db, 10)
    s = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 10}).json()
    msg = _ask(world, s["id"], [change("replace", "B7", markdown="Access to systems shall be reviewed every quarter.", reason="quarterly")])
    out = _accept(world, s["id"], msg, "minor")
    assert out["accepted"] == 1 and out["library_version"]["saved"] is False and "published" in out["library_version"]["why"]
    doc = world.db.get(m.GovernanceDocument, 10)
    assert doc.status == "published" and doc.current_version == "1.0" and _versions(world.db, 10) == before
    assert "every quarter" in out["content"] and "every quarter" not in (doc.content or "")

    draft = world.db.get(m.GovernanceDocument, 11)                     # in review: the changes collect until Save to library
    draft.status = "pending_review"
    world.db.commit()
    s = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 11}).json()
    msg = _ask(world, s["id"], [change("replace", "B3", markdown="Accounts shall be reviewed monthly.", reason="monthly")])
    out = _accept(world, s["id"], msg, "minor")
    assert out["library_version"]["saved"] is False and "in review" in out["library_version"]["why"] and not _versions(world.db, 11)


def test_a_word_draft_gets_a_new_file_and_its_original_stays_as_the_earlier_version(world, lib):
    original = make_library_doc(world, lib, status="draft")
    before = open(original, "rb").read()
    s = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 20}).json()
    block = next(i for i, part in enumerate(s["content"].split("\n\n"), start=1) if "Review it every year." in part)
    old = s["content"].split("\n\n")[block - 1]
    msg = _ask(world, s["id"], [change("replace", f"B{block}", markdown=old.replace("every year", "every six months"), reason="cycle")])
    out = _accept(world, s["id"], msg, "minor")
    assert out["library_version"] == {"saved": True, "version": "1.1", "change": "minor", "status": "draft"}
    doc = world.db.get(m.GovernanceDocument, 20)
    world.db.refresh(doc)
    assert doc.file_path != original and open(original, "rb").read() == before                     # the original file is untouched
    first = world.db.query(m.GovernanceDocumentVersion).filter_by(document_id=20, version_number="1.0").one()
    assert first.file_path == original and first.status == "superseded"
    edited = Document(doc.file_path)
    assert any("every six months" in p.text for p in edited.paragraphs)
    assert edited.sections[0].header.paragraphs[0].text == "ACME BANK - CONFIDENTIAL"                # the same file, with the change in it


def test_a_document_not_in_the_library_has_no_versions(world):
    s = world.http.post(world.api("/sessions"), json={"kind": "new", "title": "Memo", "template_id": "builtin:blank", "doc_type": "other"}).json()
    world.http.put(world.api(f"/sessions/{s['id']}/content"), json={"content": "# Memo\n\nHello.\n", "base_revision": s["revision"]})
    msg = _ask(world, s["id"], [change("replace", "B2", markdown="Hello, everyone.", reason="warmer")])
    out = _accept(world, s["id"], msg, "minor")
    assert out["accepted"] == 1 and out["library_version"] is None


def test_a_request_to_format_offers_a_tidy_that_becomes_the_next_version_and_can_be_taken_back(world, lib):
    from test_studio_word_fidelity import messy_policy

    make_library_doc(world, lib, status="draft", file_fixture=messy_policy)
    s = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 20}).json()
    world.respond(lambda body: reply(answer([], "The headings and lists are right; only the spacing needs tidying.")))
    sent = world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"text": "Please format this document professionally."}).json()
    msg = world.http.get(world.api(f"/sessions/{s['id']}/messages/{sent['id']}")).json()
    (tidy,) = [o for o in msg["proposal"]["ops"] if o["kind"] == "tidy"]
    assert "15 extra spaces" in tidy["reason"] and "1 line break" in tidy["reason"] and "1 empty line at the end" in tidy["reason"]
    assert world.http.get(world.api(f"/sessions/{s['id']}/messages/{msg['id']}/redline")).json()["applied"] == []     # not a text change

    out = _accept(world, s["id"], msg, "minor")
    assert out["accepted"] == 1 and out["revision"] == s["revision"] + 1
    assert out["library_version"] == {"saved": True, "version": "1.1", "change": "minor", "status": "draft"}               # only the file changed
    doc = world.db.get(m.GovernanceDocument, 20)
    world.db.refresh(doc)
    texts = [p.text for p in Document(doc.file_path).paragraphs]
    assert texts[2] == "Purpose" and "This policy applies to all staff." in texts and texts[:2] == ["", ""]      # the layout lines stay

    session = world.db.get(m.StudioSession, s["id"])
    tidied = session.source_path
    back = world.http.post(world.api(f"/sessions/{s['id']}/messages/{msg['id']}/ops/tidy/revert"))
    assert back.status_code == 200, back.text
    world.db.expire_all()
    session = world.db.get(m.StudioSession, s["id"])
    assert session.source_path != tidied and "_tidied" not in session.source_path and (session.settings or {}).get("file_changed")

    plain = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 20}).json()
    world.respond(lambda body: reply(answer([], "Nothing to change.")))
    sent = world.http.post(world.api(f"/sessions/{plain['id']}/messages"), json={"text": "Is the scope clear?"}).json()
    assert not world.http.get(world.api(f"/sessions/{plain['id']}/messages/{sent['id']}")).json()["proposal"]["ops"]   # no tidy unasked
