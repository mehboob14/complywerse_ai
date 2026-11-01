"""ComplyVerse Advisory module.

Self-contained feature folder: an advisory (from a CERT/vendor, by API or
uploaded document) becomes a set of CVE records that bridge into the general
Vulnerability pipeline (enrichment → asset match → SLA → remediation), and we
track per-asset applicability ("affected / not affected") with a rollup.

Everything for the feature lives under this folder so it can be developed and
pushed without colliding with other modules. It stays fully linked to the rest
of the platform through the shared services it reuses (see service.py).

NOTE: keep this package __init__ free of heavy imports (no router import here) —
``grc/models/__init__.py`` imports ``.models`` from this package to register the
tables, and dragging the router in at that point would risk an import cycle. The
app mounts the router via ``from grc.modules.advisories.router import router``.
"""
