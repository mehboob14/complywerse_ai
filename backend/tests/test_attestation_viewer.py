"""The public attestation page shows the document so that a person can read it before acknowledging it: one test per kind of document
(platform text as Markdown, HTML content, plain text, a Markdown file, a Word file, a PDF, a file that cannot be shown), the version
in force and nothing of a newer round, and a hostile payload cleaned by the allow-list. Over HTTP through the real router, on in-memory
SQLite; the acknowledge flow itself is covered by test_document_lifecycle / test_esignature."""
import base64
import json
from types import SimpleNamespace

import fitz
import pytest
from docx import Document as Word
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.modules.governance import attestation_view as view
from grc.modules.governance.routers import document_attestations as external

PNG_1PX = "data:image/png;base64," + base64.b64encode(
    bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082")
).decode()


@pytest.fixture
def world(tmp_path):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False)
    with factory() as db:
        db.add(m.Tenant(id=1, name="CFSB", slug="cfsb"))
        db.add(m.GRCUser(id=1, username="olivia", email="olivia@cfsb.test", display_name="Olivia Owner"))
        db.commit()
    app = FastAPI()
    app.include_router(external.router)

    def _db():
        with factory() as session:
            yield session

    app.dependency_overrides[m.get_db] = _db
    return SimpleNamespace(factory=factory, http=TestClient(app), dir=tmp_path)


def make(world, doc_id=5, token=None, campaign_status="active", **fields):
    """A published document with a campaign over it; ``fields`` are the document's columns. Returns the campaign's public path."""
    token = token or f"tok{doc_id}"
    with world.factory() as db:
        base = dict(id=doc_id, tenant_id=1, title="Access Control Policy", description="Who may enter what", doc_type="policy",
                    status="published", current_version="1.0", owner_id=1, author_id=1)
        base.update(fields)
        db.add(m.GovernanceDocument(**base))
        db.add(m.DocumentAttestationCampaign(id=doc_id, tenant_id=1, document_id=doc_id, name="Q4 attestation", status=campaign_status,
                                             public_token=token, allowed_email_domain="cfsb.test", message="Please read and sign."))
        db.commit()
    return f"/document-attestations/public/{token}"


def get(world, path):
    r = world.http.get(path)
    assert r.status_code == 200, r.text
    return r.json()["document"]


def pdf_file(world, pages=3, name="policy.pdf"):
    path = world.dir / name
    d = fitz.open()
    for i in range(pages):
        d.new_page(width=595, height=842).insert_text((72, 100), f"Section {i + 1}. Access is reviewed every quarter.", fontsize=14)
    d.save(str(path))
    d.close()
    return str(path)


def docx_file(world, name="policy.docx"):
    path = world.dir / name
    w = Word()
    w.add_heading("Access Control Policy", 0)
    w.add_heading("1. Purpose", 1)
    w.add_paragraph("Access is granted on need.", style="List Bullet")
    t = w.add_table(rows=2, cols=2)
    t.cell(0, 0).text, t.cell(1, 0).text = "Role", "Owner"
    w.save(str(path))
    return str(path)


MARKDOWN = "# Access Control Policy\n\n## 1. Purpose\n\n1. Grant access on need.\n2. Review it **quarterly**.\n\n| Role | Owner |\n| --- | --- |\n| CISO | Ana |\n"


# ── the kinds ────────────────────────────────────────────────────────────────
def test_platform_text_is_sent_as_markdown_for_the_documents_own_renderer(world):
    doc = get(world, make(world, content=MARKDOWN))
    assert doc["kind"] == "markdown" and doc["markdown"].startswith("# Access Control Policy")
    assert doc["html"] is None and doc["file"] is None and doc["pages"] is None
    assert (doc["title"], doc["version"], doc["doc_type"], doc["description"]) == ("Access Control Policy", "1.0", "policy", "Who may enter what")


def test_markdown_carries_only_pictures_that_are_inside_it(world):
    md = (f"# Policy\n\nA ![logo]({PNG_1PX}) kept, ![tracker](https://evil.example/p.png \"t\") dropped, ![ref][r] dropped,\n"
          "<img src=\"https://evil.example/x.png\" onerror=\"alert(1)\"> and <script>alert(1)</script>gone.\n\n[r]: https://evil.example/r.png\n")
    out = get(world, make(world, content=md))["markdown"]
    assert PNG_1PX in out
    assert "evil.example/p.png" not in out and "evil.example/x.png" not in out and "<script" not in out and "<img" not in out
    assert "tracker" in out and "dropped" in out                                           # the description stays where the picture was


def test_markdown_links_go_only_to_the_web_email_or_phone():
    out = view.safe_markdown("[a](https://example.com/p \"t\") [b](mailto:a@b.co) [c](javascript:alert(1)) [d](<javascript:alert(2)>) "
                             "[e](jav&#97;script:x) [f](/governance/documents/5) [g](data:text/html;base64,AAAA) [h](JaVaScRiPt:alert(3))")
    assert "(https://example.com/p" in out and "(mailto:a@b.co)" in out
    for bad in ("javascript", "/governance", "data:text", "(<", "alert"):
        assert bad.lower() not in out.lower().replace("jav&#97;script", ""), bad
    assert all(word in out for word in "cdefgh") and ")" not in out.replace("(https://example.com/p \"t\")", "").replace("(mailto:a@b.co)", "")


def test_html_content_is_cleaned_with_an_allow_list(world):
    hostile = (
        "<h1 onclick=\"steal()\">Policy</h1><script>alert(1)</script><p style=\"color:red;position:fixed;background:url(http://evil/x)\">"
        "Read <b>this</b> and <a href=\"javascript:alert(1)\">bad</a> <a href=\" java\tscript:alert(2)\">worse</a> "
        "<a href=\"https://example.com/policy\" onmouseover=\"x()\">good</a></p><iframe src=\"https://evil.example\"></iframe>"
        "<img src=\"https://evil.example/pixel.png\"><img src=\"" + PNG_1PX + "\" onerror=\"x()\" alt=\"logo\">"
        "<svg onload=\"x()\"><script>1</script></svg><form action=\"https://evil\"><input name=pw></form><style>body{display:none}</style>"
        "<table><tr><th colspan=\"2\">Role</th></tr><tr><td>CISO</td><td>Ana</td></tr></table><!-- c --><object data=\"x\"></object>"
    )
    doc = get(world, make(world, content=hostile))
    assert doc["kind"] == "html" and doc["markdown"] is None
    html = doc["html"]
    for bad in ("<script", "alert(", "onclick", "onerror", "onload", "onmouseover", "javascript:", "java", "<iframe", "<style", "<svg", "<form",
                "<input", "<object", "evil", "position", "url(", "<!--", "display:none"):
        assert bad not in html, bad
    assert "<h1>Policy</h1>" in html and "<b>this</b>" in html and "<th colspan=\"2\">Role</th>" in html and "<td>Ana</td>" in html
    assert 'href="https://example.com/policy"' in html and 'rel="noopener noreferrer nofollow"' in html and 'target="_blank"' in html
    assert PNG_1PX in html and 'alt="logo"' in html


@pytest.mark.parametrize("payload", [
    "<img src=x onerror=alert(1)>", "<a href=\"data:text/html;base64,PHNjcmlwdD4=\">x</a>", "<a href=\"vbscript:x\">x</a>",
    "<img src=\"data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+\">", "<p style=\"width:expression(alert(1))\">x</p>",
    "<math><mi xlink:href=\"javascript:alert(1)\">x</mi></math>", "<<script>script>alert(1)<</script>/script>", "<div><p>unclosed <b>x",
    "<meta http-equiv=refresh content=\"0;url=https://evil\">", "<base href=\"https://evil/\">", "<a href=\"//evil.example\">x</a>",
    "<a href=\"/governance/documents/5\">x</a>", "<a href=\"jav&#8203;ascript:alert(1)\">x</a>", "<a href=\"java&#9;script:alert(1)\">x</a>", "<noscript><p title=\"</noscript><img src=x onerror=alert(1)>\"></noscript>",
])
def test_the_allow_list_leaves_nothing_that_runs_loads_or_leaves(payload):
    out = view.sanitize_html(payload).lower()
    for bad in ("<script", "onerror", "onload", "javascript:", "vbscript:", "data:text", "svg", "<meta", "<base", "expression(", "href=\"//",
                "href=\"/", "<img src=\"x", "http-equiv"):
        assert bad not in out, (payload, out)


def test_plain_text_keeps_its_lines(world):
    doc = get(world, make(world, content="Section one.\nSection two.\n\nSection three."))
    assert doc["kind"] == "text" and doc["content"] == "Section one.\nSection two.\n\nSection three." and doc["markdown"] is None


def test_a_markdown_file_is_markdown_and_a_text_file_is_text(world):
    md = world.dir / "p.md"
    md.write_text("Heading\n=======\n\nBody **bold**.\n", encoding="utf-8")
    txt = world.dir / "p.txt"
    txt.write_text("# not a heading\nline two\n", encoding="utf-8")
    one = get(world, make(world, 5, file_path=str(md), file_name="p.md", file_type="md"))
    two = get(world, make(world, 6, file_path=str(txt), file_name="p.txt", file_type="txt"))
    assert one["kind"] == "markdown" and "Body **bold**" in one["markdown"]
    assert two["kind"] == "text" and two["content"].startswith("# not a heading\nline two")


def test_a_word_file_is_drawn_by_the_page_from_a_file_that_only_this_link_serves(world):
    path = docx_file(world)
    base = make(world, file_path=path, file_name="Access Control Policy.docx", file_type="docx")
    doc = get(world, base)
    assert doc["kind"] == "word" and doc["pages"] is None and doc["markdown"] is None
    assert doc["file"] == {"kind": "docx", "url": f"/governance{base}/file?v=1.0"}       # the path the page asks the API for
    f = world.http.get(f"{base}/file")
    assert f.status_code == 200 and f.content == open(path, "rb").read()
    assert f.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    assert f.headers["content-disposition"].startswith("attachment") and f.headers["x-content-type-options"] == "nosniff"
    assert str(world.dir) not in json.dumps(doc)                                                # no path of the server
    assert world.http.get("/document-attestations/public/other/file").status_code == 404


def test_a_word_file_also_gives_its_text_so_a_phone_can_read_it(world):
    path = world.dir / "linked.docx"
    w = Word()
    w.add_heading("Access Control Policy", 0)
    w.add_heading("1. Purpose", 1)
    w.add_paragraph("Access is granted on need.", style="List Number")
    t = w.add_table(rows=2, cols=2)
    for i, v in enumerate(("Role", "Owner", "CISO", "Ana")):
        t.cell(i // 2, i % 2).text = v
    w.save(str(path))
    base = make(world, 5, file_path=str(path), file_name="linked.docx", file_type="docx")
    doc = get(world, base)
    assert doc["text_url"] == f"/governance{base}/text?v=1.0"
    r = world.http.get(f"{base}/text")
    assert r.status_code == 200 and r.headers["cache-control"].startswith("private")
    text = r.json()["markdown"]
    assert "## 1. Purpose" in text and "1. Access is granted on need." in text and "| Role | Owner |" in text and "| CISO | Ana |" in text
    # PDFs, text and files that cannot be shown have no text route
    other = make(world, 6, file_path=pdf_file(world, 1), file_name="p.pdf", file_type="pdf")
    assert get(world, other)["text_url"] is None and world.http.get(f"{other}/text").status_code == 404
    third = make(world, 7, content=MARKDOWN)
    assert get(world, third)["text_url"] is None and world.http.get(f"{third}/text").status_code == 404


def test_the_text_of_a_word_file_keeps_no_script_link(world):
    path = world.dir / "hostile.docx"
    w = Word()
    p = w.add_paragraph("Read ")
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    rid = w.part.relate_to("javascript:alert(document.domain)", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
                           is_external=True)
    link = OxmlElement("w:hyperlink")
    link.set(qn("r:id"), rid)
    run = OxmlElement("w:r")
    run.append(OxmlElement("w:t"))
    run[0].text = "this notice"
    link.append(run)
    p._p.append(link)
    w.save(str(path))
    base = make(world, file_path=str(path), file_name="hostile.docx", file_type="docx")
    text = world.http.get(f"{base}/text").json()["markdown"]
    assert "this notice" in text and "javascript" not in text.lower() and "](" not in text


def test_a_pdf_is_drawn_page_by_page(world):
    path = pdf_file(world, pages=3)
    base = make(world, file_path=path, file_name="policy.pdf", file_type="pdf")
    doc = get(world, base)
    assert doc["kind"] == "pdf" and doc["markdown"] is None
    assert doc["pages"] == {"count": 3, "total": 3, "ratio": round(842 / 595, 4), "url": f"/governance{base}/pages/{{page}}?v=1.0"}
    assert doc["file"] == {"kind": "pdf", "url": f"/governance{base}/file?v=1.0"}
    for n in (1, 3):
        r = world.http.get(f"{base}/pages/{n}")
        assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content[:8] == b"\x89PNG\r\n\x1a\n"
        assert fitz.Pixmap(r.content).width == view.PAGE_WIDTH_PX
    for n in (0, 4, -1):
        assert world.http.get(f"{base}/pages/{n}").status_code == 404
    pdf = world.http.get(f"{base}/file")
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf" and pdf.headers["content-disposition"].startswith("inline")


def test_a_long_pdf_is_drawn_up_to_a_limit(world, monkeypatch):
    monkeypatch.setattr(view, "MAX_PAGES", 2)
    base = make(world, file_path=pdf_file(world, pages=5), file_name="policy.pdf", file_type="pdf")
    pages = get(world, base)["pages"]
    assert (pages["count"], pages["total"]) == (2, 5)
    assert world.http.get(f"{base}/pages/2").status_code == 200 and world.http.get(f"{base}/pages/3").status_code == 404


def test_a_poster_sized_page_is_drawn_smaller_so_it_cannot_fill_the_servers_memory(world, monkeypatch):
    monkeypatch.setattr(view, "MAX_PIXELS", 400_000)
    path = world.dir / "poster.pdf"
    d = fitz.open()
    d.new_page(width=5000, height=5000)
    d.save(str(path))
    d.close()
    base = make(world, file_path=str(path), file_name="poster.pdf", file_type="pdf")
    r = world.http.get(f"{base}/pages/1")
    assert r.status_code == 200
    pic = fitz.Pixmap(r.content)
    assert pic.width * pic.height <= 400_000 * 1.02


def test_a_file_that_cannot_be_shown_says_so_and_shows_the_text_when_there_is_one(world):
    bogus = world.dir / "old.docx"
    bogus.write_bytes(b"\xd0\xcf\x11\xe0 an old .doc saved as .docx")
    locked = world.dir / "broken.pdf"
    locked.write_bytes(b"%PDF-1.4 not really")
    sheet = world.dir / "figures.xlsx"
    sheet.write_bytes(b"PK")
    one = get(world, make(world, 5, file_path=str(bogus), file_name="old.docx", file_type="docx"))
    two = get(world, make(world, 6, file_path=str(locked), file_name="broken.pdf", file_type="pdf", content=MARKDOWN))
    three = get(world, make(world, 7, file_path=str(sheet), file_name="figures.xlsx", file_type="xlsx"))
    assert (one["kind"], one["file"], one["has_file"], one["file_name"]) == ("none", None, True, "old.docx")
    assert two["kind"] == "markdown" and two["file"] is None                                     # the extracted text stands in
    assert three["kind"] == "none"
    assert world.http.get("/document-attestations/public/tok5/file").status_code == 404
    assert world.http.get("/document-attestations/public/tok5/pages/1").status_code == 404


# ── the version in force, and nothing else ───────────────────────────────────
def test_the_version_in_force_is_shown_and_a_newer_round_is_not(world):
    one = pdf_file(world, 2, "v1.pdf")
    newer = docx_file(world, "v11.docx")
    base = make(world, file_path=newer, file_name="v11.docx", file_type="docx", content="# New rule in 1.1", status="pending_review",
                current_version="1.1", published_version="1.0", last_published_version="1.0")
    with world.factory() as db:
        db.add(m.GovernanceDocumentVersion(document_id=5, version_number="1.0", title="Access Control Policy", file_path=one,
                                           file_name="v1.pdf", file_type="pdf", status="superseded"))
        db.add(m.GovernanceDocumentVersion(document_id=5, version_number="1.1", title="Access Control Policy", content="# New rule in 1.1",
                                           file_path=newer, file_name="v11.docx", file_type="docx", status="current"))
        db.commit()
    doc = get(world, base)
    assert (doc["kind"], doc["version"], doc["file_name"]) == ("pdf", "1.0", "v1.pdf") and doc["pages"]["count"] == 2
    assert world.http.get(f"{base}/file").headers["content-type"] == "application/pdf"          # not the 1.1 Word file
    assert world.http.get(f"{base}/pages/2").status_code == 200 and world.http.get(f"{base}/pages/3").status_code == 404
    assert world.http.get(f"{base}/text").status_code == 404                                    # the 1.1 Word file's words are not served either
    assert "New rule" not in json.dumps(doc) and "v11" not in json.dumps(doc)


def test_the_page_is_told_nothing_about_approvers_or_the_server(world):
    base = make(world, content=MARKDOWN, approved_by=1, published_by=1, owner_id=1)
    body = world.http.get(base).json()
    assert set(body) == {"campaign", "document", "tenant_slug"}
    assert set(body["document"]) == {"title", "description", "version", "doc_type", "has_file", "file_name", "kind", "markdown", "html",
                                     "content", "file", "pages", "text_url"}
    assert set(body["campaign"]) == {"id", "name", "message", "due_date", "status", "allowed_email_domain", "acknowledgment_count",
                                     "attestation_percent"}
    assert "olivia" not in json.dumps(body).lower()                                           # not the owner, author or approver


def test_a_closed_or_unknown_link_shows_nothing(world):
    base = make(world, file_path=pdf_file(world, 1), file_name="p.pdf", file_type="pdf", campaign_status="closed")
    assert world.http.get(base).status_code == 410
    assert world.http.get(f"{base}/file").status_code == 410 and world.http.get(f"{base}/pages/1").status_code == 410
    assert world.http.get("/document-attestations/public/nope").status_code == 404
    assert world.http.get("/document-attestations/public/nope/pages/1").status_code == 404
