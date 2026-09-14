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
