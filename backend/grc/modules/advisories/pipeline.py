"""Advisory processing pipeline — the explicit multi-stage view.

Every advisory moves through five stages, whatever its origin (uploaded PDF,
scraped CERT PDF, API feed, or manual entry):

    Ingest → Parse → Review → Match → Remediate

This is a *derived* view over the advisory's existing state (status + CVE rows +
rollup counts), not a second source of truth — so there is no extra state to keep
in sync and no migration. Each stage reports done / current / pending and a short
detail, and the UI renders it as a stage strip (like the pentest RunWorkspace).

Stage → how it is driven:
  * Ingest    — document/source received (the advisory exists).
  * Parse     — CVEs + normalised template extracted (regex spine + AI).
  * Review    — human confirm gate (PDF); auto for trusted API feeds.
  * Match     — applicability cross-check vs the estate (POST /{id}/recheck).
  * Remediate — bridged findings in the fix flow + advisory rollup/close.
"""
from __future__ import annotations

from typing import Any, Dict, List

from .models import Advisory

def _origin(a: Advisory) -> str:
    if a.raw_file_path:
        return "Document (PDF)"
    if a.source_id:
        return "API source"
    return "Manual entry"


def pipeline_view(a: Advisory) -> Dict[str, Any]:
    """Ordered stages with status + detail, plus the key of the current stage.
    Reads only already-loaded advisory state — no extra queries beyond its CVEs."""
    pending_review = a.status == "pending"
    cve_count = len(a.cves)
    bridged = sum(1 for c in a.cves if c.bridged_vulnerability_id)
    total = a.asset_total_count or 0
    affected = a.asset_affected_count or 0
    # "Evaluated" = a re-check has run. Closed states imply it ran; otherwise a
    # non-zero universe/affected count is the signal (0/0 unevaluated reads pending).
    evaluated = a.status in ("resolved", "not_applicable") or total > 0 or affected > 0

    is_doc = bool(a.raw_file_path)

    status: Dict[str, tuple] = {}
    # A parsed document moves through Ingest→Parse (we read CVEs out of a PDF).
    # A feed/manual advisory arrives with structured CVEs already — that is one
    # step: "Synced" (API feed) or "Added" (manual), not ingest-then-parse.
    if is_doc:
        first_labels = [("ingest", "Ingest"), ("parse", "Parse")]
        status["ingest"] = ("done", _origin(a))
        status["parse"] = ("done", f"{cve_count} CVE(s)") if cve_count else ("current", "No CVEs extracted")
    else:
        key, label = ("synced", "Synced") if a.source_id else ("added", "Added")
        first_labels = [(key, label)]
        status[key] = ("done", f"{cve_count} CVE(s)" if cve_count else _origin(a))

    if pending_review:
        status["review"] = ("current", "Awaiting human confirmation")
    else:
        status["review"] = ("done", "Confirmed" if a.raw_file_path else "Auto (trusted source)")

    if pending_review:
        status["match"] = ("pending", "After review")
    elif evaluated:
        status["match"] = ("done", f"{affected} of {total} assets affected")
    else:
        status["match"] = ("current", "Run re-check")

    if a.status == "resolved":
        status["remediate"] = ("done", "Resolved")
    elif a.status == "not_applicable":
        status["remediate"] = ("done", "Not applicable to the estate")
    elif not pending_review and evaluated and bridged:
        status["remediate"] = ("current", f"{bridged} finding(s) in the fix flow")
    else:
        status["remediate"] = ("pending", "After match")

    stage_labels = first_labels + [("review", "Review"), ("match", "Match"), ("remediate", "Remediate")]
    stages: List[Dict[str, str]] = [
        {"key": key, "label": label, "status": status[key][0], "detail": status[key][1]}
        for key, label in stage_labels
    ]
    current = next((s["key"] for s in stages if s["status"] == "current"),
                   next((s["key"] for s in stages if s["status"] == "pending"), "remediate"))
    return {"stages": stages, "current": current}
