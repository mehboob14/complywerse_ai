"""CIS Benchmark PDF ingestion pipeline.

Multi-layer extraction:
  1. pdfplumber native text layer
  2. PyMuPDF (fitz) layout-aware blocks (fallback when pdfplumber returns sparse text)
  3. Tesseract OCR per-page (fallback when text density is too low)

Then rules are split on numeric headings (1.1.1 …), parent/child tree is built
from the numeric prefix, and per-rule fields (Description / Rationale / Impact /
Audit / Remediation / Default Value / References / CIS Controls) are extracted
via section detectors. Auto-generated check_definitions are produced for the
common verbs (aws cli, grep /etc/..., Get-ItemProperty, net accounts).
"""
from .pipeline import ingest_pdf  # noqa: F401
