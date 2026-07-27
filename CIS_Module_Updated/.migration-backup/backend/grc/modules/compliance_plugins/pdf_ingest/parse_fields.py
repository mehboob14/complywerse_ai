"""Higher-level field extraction from a single rule's parsed sections.

Classification policy (severity / runner_type / confidence_score) lives
in `classify.py`; this module orchestrates field extraction + projection
onto CompliancePlugin column values, and re-exports the classifier
helpers for backwards compatibility.
"""
from __future__ import annotations

import re
from typing import Any

from .classify import confidence_score, runner_type_for, runner_type_from, severity_from

_URL_RE = re.compile(r"https?://[^\s)<>]+")
_CIS_CONTROL_RE = re.compile(r"\b(?:Control(?:s)?\s+)?(\d{1,2}(?:\.\d{1,2}){0,2})\b")
_MITRE_RE = re.compile(r"\bT\d{4}(?:\.\d{3})?\b")


def extract_references(text: str) -> list[str]:
    return list(dict.fromkeys(_URL_RE.findall(text or "")))


def extract_cis_controls(text: str) -> list[str]:
    if not text:
        return []
    found = _CIS_CONTROL_RE.findall(text)
    # Filter to two-or-three-segment IDs (Controls 5.2, 5.2.1) — skip stray "1" matches
    return list(dict.fromkeys(c for c in found if "." in c))


def extract_mitre(text: str) -> list[str]:
    return list(dict.fromkeys(_MITRE_RE.findall(text or "")))


def assemble_plugin_fields(rule: dict[str, Any], benchmark: str) -> dict[str, Any]:
    """Project a parsed rule onto CompliancePlugin column values."""
    secs = rule["sections"]
    audit = secs.get("Audit", "")
    description = secs.get("Description", "")
    rationale = secs.get("Rationale", "")
    remediation = secs.get("Remediation", "")
    references = extract_references(secs.get("References", ""))
    cis_controls = extract_cis_controls(secs.get("CIS Controls", ""))
    mitre = extract_mitre(rule.get("raw_body", ""))
    # Benchmark-name takes precedence over audit-text heuristics — see
    # `runner_type_for` for rationale (Visual Studio Code GPO etc).
    runner_type = runner_type_for(benchmark, audit)
    sev = severity_from(
        rule.get("level"),
        " ".join([rule.get("title") or "", description, rationale, audit]),
    )
    conf = confidence_score(rule)

    return {
        "plugin_key": f"{benchmark}__{rule['rule_id']}",
        "benchmark": benchmark,
        "rule_id": rule["rule_id"],
        "title": rule["title"],
        "description": description or None,
        "rationale": rationale or None,
        "remediation": remediation or None,
        "audit_steps_text": audit or None,
        "level": rule.get("level"),
        "assessment_status": rule.get("assessment_status"),
        "severity": sev,
        "runner_type": runner_type,
        "references_json": references,
        "cis_controls_json": cis_controls,
        "mitre_techniques_json": mitre,
        "confidence_score": conf,
        # Auto-approval policy:
        #   confidence ≥ 0.6 → auto_approved (lands directly in the library)
        #   confidence  < 0.6 → pending_review (sits in the review queue)
        #
        # The pipeline also forces pending_review for any auto-generated
        # PowerShell/SSH check (see pipeline.py — auto_gen flag), so even
        # high-confidence rules whose check_definition was synthesised
        # from PDF audit text still require human eyes before they run.
        "review_status": "pending_review" if conf < 0.6 else "auto_approved",
    }
