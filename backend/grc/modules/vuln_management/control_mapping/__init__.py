"""CWE → framework-control crosswalk — REMOVED.

The hand-curated CWE→control table and its rule crosswalk produced zero links on
live data (every real link came from the AI mapper), so it was deleted. The AI
mapper (`grc.services.ai_control_mapping` + `grc.services.ai_control_proposals`)
is now the single decision-maker for the CTEM Validate stage: it reads each
finding and picks the fixing control from the tenant's own control corpus, with a
confidence gate, reason, and full audit trail. Findings the model finds no
specific control for get an explicit "patch-only / no-specific-control" marker
instead of a silent blank.

The legacy `auto:cwe:` link-note prefix is still recognised for DISPLAY of any
rows written before removal (see `control_links._parse_auto_marker`); no code
writes new `auto:cwe:` links.
"""
