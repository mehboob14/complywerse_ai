"""Any file can be attached in the AI Studio's chat (the paperclip): it becomes a reference of the session, the request names the
files that came with it, and Comply Agent does whatever the person asks with them (a gap analysis, a summary, changes...).
Workbooks, slides, data files, scans and pictures are read on the server; a picture is never sent to the AI. The AI is a mocked
wire; the SDK, the guard, the engine, the service and the HTTP routes are the real ones."""
import io
import json
import re
import zipfile

import openpyxl
import pytest

from grc.modules.governance.studio import importers, prompts
from grc.modules.governance.studio.importers import ImportProblem, read_attachment

from _claude_mock import reply
from test_studio_flow import answer, user_turn, world             # noqa: F401  (world is a fixture)


def workbook() -> bytes:
    book = openpyxl.Workbook()
    sheet = book.active
    sheet.title = "Controls"
    sheet.append(["Control", "Requirement", "Owner"])
    sheet.append(["AC-1", "Access is reviewed every quarter | by the owner", "CISO"])
    sheet.append([None, None, None])
    sheet.append(["AC-2", "Leavers lose access within 24 hours", None])
    book.create_sheet("Empty")
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()


def slides(*decks) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for n, texts in decks:
            body = "".join(f"<a:p><a:r><a:t>{t}</a:t></a:r></a:p>" for t in texts)
            z.writestr(f"ppt/slides/slide{n}.xml", '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
                       f'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>{body}'
                       "</p:txBody></p:sp></p:spTree></p:cSld></p:sld>")
        z.writestr("ppt/notesSlides/notesSlide1.xml", "<x>speaker notes</x>")
    return out.getvalue()


def read(tmp_path, name, data):
    path = tmp_path / name
    path.write_bytes(data)
    return read_attachment(str(path), name)


# ── reading any file ─────────────────────────────────────────────────────────
def test_a_workbook_is_read_sheet_by_sheet_as_tables(tmp_path):
    got = read(tmp_path, "controls.xlsx", workbook())
    assert got.kind == "xlsx" and got.markdown.startswith("## Controls\n\n| Control | Requirement | Owner |\n| --- | --- | --- |\n")
    assert "| AC-1 | Access is reviewed every quarter \\| by the owner | CISO |" in got.markdown and "| AC-2 | Leavers lose access within 24 hours |  |" in got.markdown
    assert "Empty" not in got.markdown                                                         # a sheet with nothing in it is left out


def test_slides_are_read_in_their_order_without_the_speaker_notes(tmp_path):
    got = read(tmp_path, "board.pptx", slides((10, ["Last"]), (1, ["Risk appetite", "Low for cyber"]), (2, ["Next steps"])))
    assert got.markdown == "## Slide 1\n\nRisk appetite\n\nLow for cyber\n\n## Slide 2\n\nNext steps\n\n## Slide 3\n\nLast\n"
    assert "speaker notes" not in got.markdown


def test_data_files_and_text_of_any_name_are_read_as_they_are(tmp_path):
    assert read(tmp_path, "findings.csv", b"id,finding\n1,No MFA on VPN\n").markdown == "id,finding\n1,No MFA on VPN\n"
    assert json.loads(read(tmp_path, "export.json", b'{"users": 3}').markdown) == {"users": 3}
    assert read(tmp_path, "README", b"Plain words in a file without an extension.").kind == "text"


@pytest.mark.parametrize("name, data, says", [
    ("old.doc", b"\xd0\xcf\x11\xe0", "Save it as Word (.docx) or PDF"),
    ("old.xls", b"\xd0\xcf\x11\xe0", "Save it as Excel (.xlsx) or PDF"),
    ("tool.exe", b"MZ\x90\x00\x03\x00\x00\x00" * 64, "cannot read this kind of file"),
    ("broken.xlsx", b"not a workbook", "could not be opened"),
])
def test_what_cannot_be_read_says_what_to_do(tmp_path, name, data, says):
    with pytest.raises(ImportProblem, match=re.escape(says)):
        read(tmp_path, name, data)


def test_a_picture_is_read_here_by_ocr(tmp_path, monkeypatch):
    from PIL import Image

    seen = {}

    class FakeTesseract:
        @staticmethod
        def image_to_string(image, config=""):
            seen["image"] = image.size
            return "Visitors shall sign in at reception."

    monkeypatch.setattr(importers, "_tesseract", lambda: FakeTesseract)
    picture = io.BytesIO()
    Image.new("RGB", (40, 20), "white").save(picture, format="PNG")
    got = read(tmp_path, "notice.png", picture.getvalue())
    assert got.kind == "image" and got.markdown == "Visitors shall sign in at reception.\n" and "read on this server by OCR" in got.notes[0]
    assert seen["image"] == (40, 20)                    # (a scanned PDF is read by OCR in pdf_io, see test_studio_pdf.py)


def test_without_ocr_a_picture_says_so():
    def none():
        raise ImportProblem("Pictures and scans cannot be read on this server yet (no OCR is installed). Attach the file with its text instead.")

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(importers, "_tesseract", none)
        with pytest.raises(ImportProblem, match="no OCR is installed"):
            importers._ocr_picture(b"")


# ── attaching in the chat ────────────────────────────────────────────────────
def test_files_attached_in_the_chat_are_named_in_the_request_and_comply_agent_answers_with_them(world):
    s = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 10}).json()
    up = world.http.post(world.api(f"/sessions/{s['id']}/references/upload"), files={"file": ("ISO 27001 controls.xlsx", workbook())})
    assert up.status_code == 200, up.text
    ref = up.json()
    assert (ref["key"], ref["kind"], ref["title"]) == ("R1", "upload", "ISO 27001 controls.xlsx")

    table = "| Requirement | Where | Status | What to add |\n|---|---|---|---|\n| AC-1 quarterly review | B7 | partly | quarterly, by the owner |"
    world.respond(lambda body: reply(answer([], "## Gap analysis\n\n" + table)))
    sent = world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"text": "Run a gap analysis of the policy against this.", "attachments": [ref["id"]]})
    assert sent.status_code == 200, sent.text
    msgs = world.http.get(world.api(f"/sessions/{s['id']}/messages")).json()["items"]
    person, done = [x for x in msgs if x["role"] == "user"][-1], msgs[-1]
    assert person["content"] == 'Run a gap analysis of the policy against this.\n\nAttached with this message: R1 "ISO 27001 controls.xlsx"'
    assert person["attachments"] == [{"id": ref["id"], "key": "R1", "title": "ISO 27001 controls.xlsx"}]
    assert done["content"].startswith("## Gap analysis") and table in done["content"]                # a full answer, not a short note
    prompt = json.dumps(user_turn(world))
    assert "Attached with this message: R1" in prompt and "Leavers lose access within 24 hours" in prompt
    refs = world.http.get(world.api(f"/sessions/{s['id']}")).json()["references"]
    assert [r["key"] for r in refs] == ["R1"]                    # the file's name (ISO 27001) does not attach the platform's ISO framework

    world.respond(lambda body: reply(answer([], "It is a list of access controls.")))
    only = world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"text": "", "attachments": [ref["id"]]})
    assert only.status_code == 200
    person = [x for x in world.http.get(world.api(f"/sessions/{s['id']}/messages")).json()["items"] if x["role"] == "user"][-1]
    assert person["content"].startswith("Read what I attached and tell me what it is and how it relates to this document.")


def test_a_file_of_another_session_cannot_be_attached(world):
    one = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 10}).json()
    two = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 11}).json()
    ref = world.http.post(world.api(f"/sessions/{one['id']}/references/upload"), files={"file": ("notes.txt", b"Some notes.")}).json()
    world.respond(lambda body: reply(answer([], "Done.")))
    got = world.http.post(world.api(f"/sessions/{two['id']}/messages"), json={"text": "Use it.", "attachments": [ref["id"]]})
    assert got.status_code == 400 and "attached file was not found" in got.text


def test_the_prompt_lets_comply_agent_answer_in_full_and_work_with_attached_files():
    assert "FILES THE PERSON ATTACHES" in prompts.SYSTEM and "For a gap analysis" in prompts.SYSTEM
    assert "reply is the full answer instead" in prompts.SYSTEM
