"""PDF export must survive the wide registers the artifact catalogue ships.

A 50-column table on A4 used to leave each column narrower than its padding, and
141 of 527 authored templates failed to download as PDF.
"""
from grc.routers._artifact_export import build_export


def _table(ncol: int, rows: int) -> str:
    head = "| " + " | ".join(f"Field {j}" for j in range(ncol)) + " |"
    sep = "|" + "---|" * ncol
    body = ["| " + " | ".join(f"row {i} value {j} with some words" for j in range(ncol)) + " |"
            for i in range(rows)]
    return "\n".join(["# Register", "", head, sep, *body])


def test_pdf_renders_wide_and_narrow_tables():
    for ncol, rows in ((6, 3), (25, 2), (50, 2), (85, 0)):
        body, media, ext = build_export("pdf", title="Register", content=_table(ncol, rows))
        assert body.startswith(b"%PDF") and ext == "pdf", ncol


def test_word_headings_are_black_not_the_blue_of_words_own_template():
    import io
    import re
    import zipfile

    body, _media, ext = build_export("docx", title="Access Control Policy", content="# 1. Purpose\n\nText.\n\n## 1.1 Scope\n\nMore.\n")
    styles = zipfile.ZipFile(io.BytesIO(body)).read("word/styles.xml").decode()
    for sid in ("Title", "Heading1", "Heading2"):
        style = re.search(rf'<w:style [^>]*w:styleId="{sid}".*?</w:style>', styles, re.S).group(0)
        assert '<w:color w:val="000000"/>' in style and "w:themeColor" not in style and "<w:pBdr>" not in style, sid
