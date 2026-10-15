"""PDF files in the studio: read from their layout (headings by type size, lists, tables, running headers and footers dropped,
paragraphs kept whole across pages), refused with a sentence when they cannot be read."""
import fitz
import pytest

from grc.modules.governance.studio import blocks as B
from grc.modules.governance.studio import exporters, pdf_io
from grc.modules.governance.studio.importers import ImportProblem


def pdf(tmp_path, md, name="doc.pdf", **kwargs):
    path = tmp_path / name
    path.write_bytes(exporters.to_pdf(md, title="Doc", entity_name="Capital Financial Services Bank", doc_code="POL-9", version="1.0", classification="internal", **kwargs))
    return str(path)


SENTENCE = "The bank shall protect the information it holds and shall report any breach without delay. "


def test_a_multi_page_pdf_loses_its_running_header_footer_and_page_numbers(tmp_path):
    md = "# Retention Policy\n\n" + "\n\n".join(f"## {n}. Section {n}\n\n" + SENTENCE * 12 for n in range(1, 9))
    imp = pdf_io.import_pdf(pdf(tmp_path, md))
    assert imp.kind == "pdf" and "Capital Financial Services Bank" not in imp.markdown and "POL-9" not in imp.markdown and "Page " not in imp.markdown
    blocks = B.parse(imp.markdown)
    assert [b.level for b in blocks if b.kind == "heading"] == [1] + [2] * 8
    assert [b.text for b in blocks if b.kind == "heading"][1] == "1. Section 1"
    assert sum(b.kind == "paragraph" for b in blocks) == 8                                       # a paragraph is not cut where a page ends
    assert any("check them" in n for n in imp.notes)


def test_lists_tables_and_nesting_come_back_as_lists_and_tables(tmp_path):
    md = ("# Rules\n\n## 1. Access\n\n1. Users receive the minimum access they need.\n2. Access is removed when a person leaves.\n\n"
          "- Hardware is covered\n- Software is covered\n\n| Role | Duty |\n|------|------|\n| CISO | Owns it |\n| IT | Runs it |\n")
    blocks = B.parse(pdf_io.import_pdf(pdf(tmp_path, md)).markdown)
    assert [(b.kind, b.ordered) for b in blocks if b.kind == "list_item"] == [("list_item", True), ("list_item", True), ("list_item", False), ("list_item", False)]
    table = next(b for b in blocks if b.kind == "table")
    assert [[c.text for c in r] for r in table.rows] == [["Role", "Duty"], ["CISO", "Owns it"], ["IT", "Runs it"]]


def test_text_that_looks_like_markdown_stays_text(tmp_path):
    md = "# Odd Text\n\nSee \\[1\\] and the C\\# guide, 50% of \\*all\\* snake\\_case names \\| pipes.\n\n" + SENTENCE * 3
    blocks = B.parse(pdf_io.import_pdf(pdf(tmp_path, md)).markdown)
    assert blocks[1].text.startswith("See [1] and the C# guide, 50% of *all* snake_case names | pipes.")


def test_a_pdf_that_is_a_picture_or_broken_or_locked_is_refused_with_a_sentence(tmp_path):
    scan = fitz.open()
    page = scan.new_page()
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 200, 200), False)
    pix.set_rect(pix.irect, (240, 240, 240))
    page.insert_image(page.rect, pixmap=pix)
    path = tmp_path / "scan.pdf"
    scan.save(str(path))
    with pytest.raises(ImportProblem, match="no text"):
        pdf_io.import_pdf(str(path))
    broken = tmp_path / "broken.pdf"
    broken.write_bytes(b"%PDF-1.4 this is not really a pdf")
    with pytest.raises(ImportProblem, match="could not be opened"):
        pdf_io.import_pdf(str(broken))
    locked = fitz.open()
    locked.new_page().insert_text((72, 100), "secret text " * 10)
    locked_path = tmp_path / "locked.pdf"
    locked.save(str(locked_path), encryption=fitz.PDF_ENCRYPT_AES_256, user_pw="pw", owner_pw="pw")
    with pytest.raises(ImportProblem, match="password"):
        pdf_io.import_pdf(str(locked_path))
