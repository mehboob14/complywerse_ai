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


def test_a_scanned_cover_memo_a_contents_page_and_indented_lists_keep_the_documents_own_hierarchy(tmp_path):
    doc = fitz.open()
    cover = doc.new_page()                                  # a signed memo scanned in: a picture with the scanner's invisible text on it
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 50, 50), False)
    pix.set_rect(pix.irect, (250, 250, 250))
    cover.insert_image(cover.rect, pixmap=pix)
    cover.insert_text((72, 140), "ffi", fontsize=40, render_mode=3)
    cover.insert_text((72, 220), "Extracts of the Board meeting held in December", fontsize=11, render_mode=3)
    page = doc.new_page()
    y = 90

    def line(text, size=10, x=72, bold=False, gap=1.6):
        nonlocal y
        page.insert_text((x, y), text, fontsize=size, fontname="hebo" if bold else "helv")
        y += size * gap

    line("Information Security Policy", 20, bold=True, gap=2)
    line("Table of Contents", 16, bold=True)
    line("Purpose ........................................ 2", 11, bold=True)
    line("Scope .......................................... 3", 11, bold=True)
    line("Purpose", 16, bold=True)
    for _ in range(3):
        line("The bank protects the information it holds and reports any breach to the regulator without delay.", gap=1.25)
    line("The policy covers:", gap=1.4)
    line("• Hardware the bank owns", x=90, gap=1.4)
    line("• Software the bank licenses", x=90, gap=1.6)
    line("Scope", 16, bold=True)
    line("Roles", 12, bold=True)
    line("Every member of staff follows this policy and the procedures under it, and reports a breach at once.", gap=1.4)
    line("Duties", 12, bold=True)
    line("Line managers make sure their teams have read the policy and know where to find the procedures.", gap=1.4)
    path = tmp_path / "policy.pdf"
    doc.save(str(path))
    imp = pdf_io.import_pdf(str(path))
    blocks = B.parse(imp.markdown)
    assert [(b.text, b.level) for b in blocks if b.kind == "heading"] == [
        ("Information Security Policy", 1), ("Table of Contents", 2), ("Purpose", 2), ("Scope", 2), ("Roles", 3), ("Duties", 3)]
    assert any(b.kind == "paragraph" and b.text.startswith("Extracts of the Board") for b in blocks)      # the scan's text is kept, as text
    assert [b.kind for b in blocks if b.text.startswith(("Purpose ...", "Scope ..."))] == ["paragraph", "paragraph"]
    assert [(b.kind, b.level, b.text) for b in blocks if "the bank" in b.text and b.text.startswith(("Hardware", "Software"))] == [
        ("list_item", 0, "Hardware the bank owns"), ("list_item", 0, "Software the bank licenses")]
    assert not any(b.kind == "code" for b in blocks)
    assert any("Page 1 is scanned" in n for n in imp.notes)
