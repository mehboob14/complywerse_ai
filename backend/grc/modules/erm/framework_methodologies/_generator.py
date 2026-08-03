"""Methodology-driven question generator.

Two modes, picked automatically:

1. **JSON-driven (preferred).** When the methodology was loaded from a
   seed-data JSON it carries the framework's *official* control catalog
   (``methodology.controls``). The generator emits one question per
   official control, in the order the JSON declares — so the assessment
   exactly mirrors the standard. The user's uploaded framework controls
   are still used to find a matching ``source_quote`` for evidence /
   traceability where possible.

2. **Parsed-controls fallback.** When no methodology is loaded for the
   framework (rare — used for older AI-only assessments), the generator
   falls back to emitting one question per ParsedFrameworkControl row
   from the user's uploaded document.

Each payload follows the shape:

    {
        "question_text": str,
        "phase_code":   str | None,
        "clause_reference": str | None,
        "source_quote": str | None,
        "methodology_fields": dict,    # keyed by methodology.fields[*].key
    }
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from . import Methodology, MethodologyControl

_SOURCE_QUOTE_MAX = 220


def generate_questions(
    methodology: Methodology,
    framework: Any,
    controls: List[Dict[str, Any]],
    *,
    full_coverage: bool = True,
    sample_size: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Produce question payloads following the methodology's official template.

    ``controls`` is the user's uploaded / parsed framework controls; it's
    used as a source-quote lookup, not as the question set, when the
    methodology has its own catalog.
    """
    if methodology.controls:
        return _generate_from_official_controls(
            methodology, framework, controls,
            full_coverage=full_coverage, sample_size=sample_size,
        )
    return _generate_from_parsed_controls(
        methodology, framework, controls,
        full_coverage=full_coverage, sample_size=sample_size,
    )


# ---------------------------------------------------------------------------
# Mode 1 — official controls from the methodology JSON.

def _generate_from_official_controls(
    methodology: Methodology,
    framework: Any,
    parsed_controls: List[Dict[str, Any]],
    *,
    full_coverage: bool,
    sample_size: Optional[int],
) -> List[Dict[str, Any]]:
    selected = _select_official(methodology.controls, full_coverage=full_coverage, sample_size=sample_size)
    quote_index = _build_quote_index(parsed_controls)
    framework_name = getattr(framework, "name", None) or methodology.display_name
    empty_fields = {f.key: "" for f in methodology.fields}

    out: List[Dict[str, Any]] = []
    for ctrl in selected:
        out.append({
            "question_text": _question_text_for_official(methodology, ctrl, framework_name),
            "phase_code": ctrl.domain_id or None,
            "clause_reference": ctrl.control_id or None,
            "source_quote": _lookup_source_quote(quote_index, ctrl),
            "methodology_fields": dict(empty_fields),
        })
    return out


def _select_official(
    controls: List[MethodologyControl],
    *,
    full_coverage: bool,
    sample_size: Optional[int],
) -> List[MethodologyControl]:
    if full_coverage or not sample_size or sample_size >= len(controls):
        return list(controls)
    if sample_size <= 0:
        return []
    step = max(1, len(controls) // sample_size)
    sampled = controls[::step][:sample_size]
    if len(sampled) < sample_size:
        leftover = [c for c in controls if c not in sampled]
        sampled.extend(leftover[: sample_size - len(sampled)])
    return sampled


def _question_text_for_official(
    methodology: Methodology,
    ctrl: MethodologyControl,
    framework_name: str,
) -> str:
    """Compose a single instruction sentence for the assessor.

    Wording is original (we don't reproduce any standard's verbatim text);
    the *content* — what to assess — comes from the JSON's control title
    plus the methodology's assessment-shape semantics.
    """
    title = (ctrl.control_title or "").strip()
    code = (ctrl.control_id or "").strip()
    label = (
        f"control {code} — “{title}”"
        if code and title
        else f"control {code}"
        if code
        else f"“{title}”"
        if title
        else "this control"
    )

    shape = (methodology.assessment_shape or "").lower()

    if shape == "asset_threat_vulnerability":
        return (
            f"For {label}, identify the asset(s) at risk, the threat the "
            f"control mitigates, and the vulnerability the threat could "
            f"exploit. Document existing controls, score likelihood and "
            f"the C/I/A impact, and record any treatment decision."
        )
    if shape == "control_maturity":
        return (
            f"Assess {label}: rate current implementation status and "
            f"maturity (0–5), record supporting evidence, the gap to the "
            f"target maturity, the residual risk if the control is not "
            f"implemented, owner, and remediation plan."
        )
    if shape == "soc2_criterion":
        return (
            f"For {label}, document the entity's control activity for "
            f"this Trust Services criterion: description, implementation "
            f"status, evidence, test of design and operating effectiveness, "
            f"exceptions, remediation plan, and owner."
        )
    if shape == "attestation":
        return (
            f"Attest to compliance with {label}: state status, supporting "
            f"evidence, any compensating control, whether remediation is "
            f"required, plan and target date."
        )
    if shape == "operational_resilience":
        return (
            f"For {label}, describe how the entity meets this operational "
            f"resilience requirement: critical functions affected, ICT "
            f"third-party exposure, testing approach, and recovery posture."
        )
    if shape == "icfr_control":
        return (
            f"For {label}, document the ICFR control: financial assertion "
            f"covered, frequency, control type (preventive/detective), "
            f"evidence of design and operating effectiveness, deficiencies, "
            f"and remediation."
        )

    # Generic fallback used by methodology shapes we haven't special-cased.
    return (
        f"Complete the {methodology.display_name} assessment for {label}: "
        f"populate every methodology field below and rate likelihood and "
        f"impact."
    )


# ---------------------------------------------------------------------------
# Mode 2 — fallback when methodology has no JSON catalog.

def _generate_from_parsed_controls(
    methodology: Methodology,
    framework: Any,
    controls: List[Dict[str, Any]],
    *,
    full_coverage: bool,
    sample_size: Optional[int],
) -> List[Dict[str, Any]]:
    if not controls:
        return []
    selected = _select_parsed(controls, full_coverage=full_coverage, sample_size=sample_size)
    framework_name = getattr(framework, "name", None) or methodology.display_name
    empty_fields = {f.key: "" for f in methodology.fields}

    out: List[Dict[str, Any]] = []
    for ctrl in selected:
        code = _first_str(ctrl.get("code"), ctrl.get("control_id"))
        title = _first_str(ctrl.get("title"), ctrl.get("name"))
        clause_ref = _first_str(
            ctrl.get("clause_reference"),
            ctrl.get("original_reference"),
            ctrl.get("section_number"),
            code,
        )
        body = _first_str(ctrl.get("original_text"), ctrl.get("full_text"), ctrl.get("description"))
        out.append({
            "question_text": _generic_question_text(methodology, framework_name, code, title, clause_ref),
            "phase_code": methodology.phases[0].code if methodology.phases else None,
            "clause_reference": clause_ref,
            "source_quote": _short_excerpt(body),
            "methodology_fields": dict(empty_fields),
        })
    return out


def _select_parsed(
    controls: List[Dict[str, Any]],
    *,
    full_coverage: bool,
    sample_size: Optional[int],
) -> List[Dict[str, Any]]:
    if full_coverage or not sample_size or sample_size >= len(controls):
        return list(controls)
    if sample_size <= 0:
        return []
    step = max(1, len(controls) // sample_size)
    sampled = controls[::step][:sample_size]
    if len(sampled) < sample_size:
        leftover = [c for c in controls if c not in sampled]
        sampled.extend(leftover[: sample_size - len(sampled)])
    return sampled


def _generic_question_text(
    methodology: Methodology,
    framework_name: str,
    code: Optional[str],
    title: Optional[str],
    clause_ref: Optional[str],
) -> str:
    label_parts: List[str] = []
    if clause_ref and clause_ref != code:
        label_parts.append(clause_ref)
    if code:
        label_parts.append(code)
    if title:
        label_parts.append(f"“{title}”")
    label = " ".join(label_parts).strip() or "this control"
    return (
        f"For {label} in {framework_name}, complete the "
        f"{methodology.display_name} assessment: populate the methodology "
        f"fields and rate likelihood and impact."
    )


# ---------------------------------------------------------------------------
# Source-quote matching — link an official control to the user's parsed text.

def _build_quote_index(parsed_controls: List[Dict[str, Any]]) -> Dict[str, str]:
    """Index parsed controls by normalized reference / code for O(1) lookup
    when we try to attach a source quote to a JSON control."""
    index: Dict[str, str] = {}
    for ctrl in parsed_controls or []:
        body = _first_str(ctrl.get("original_text"), ctrl.get("full_text"), ctrl.get("description"))
        quote = _short_excerpt(body)
        if not quote:
            continue
        for key_source in (
            ctrl.get("clause_reference"),
            ctrl.get("original_reference"),
            ctrl.get("section_number"),
            ctrl.get("code"),
            ctrl.get("control_id"),
        ):
            key = _normalize_ref(key_source)
            if key and key not in index:
                index[key] = quote
    return index


def _lookup_source_quote(index: Dict[str, str], ctrl: MethodologyControl) -> Optional[str]:
    if not index:
        return None
    key = _normalize_ref(ctrl.control_id)
    if key and key in index:
        return index[key]
    # Try the prefix without sub-parts (e.g. "A.5.1.3" → "A.5.1" → "A.5").
    if key:
        parts = key.split(".")
        for cut in range(len(parts) - 1, 0, -1):
            prefix = ".".join(parts[:cut])
            if prefix in index:
                return index[prefix]
    return None


def _normalize_ref(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip().lower()
    if not s:
        return None
    # Collapse whitespace and remove all non-alphanumeric except '.' and '-'.
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"[^a-z0-9.\-_]", "", s)
    return s or None


# ---------------------------------------------------------------------------
# Small helpers

def _first_str(*candidates: Optional[Any]) -> Optional[str]:
    for c in candidates:
        if c is None:
            continue
        s = str(c).strip()
        if s:
            return s
    return None


def _short_excerpt(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    s = " ".join(str(text).split())
    if len(s) <= _SOURCE_QUOTE_MAX:
        return s
    return s[: _SOURCE_QUOTE_MAX].rstrip() + "…"
