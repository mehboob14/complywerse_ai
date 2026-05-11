"""JSON-driven methodology loader.

At startup we walk every ``*.json`` file under
``backend/grc/seed_data/framework_assessments/frameworks/`` and turn each
into a fully-populated ``Methodology`` object — including the full
catalog of official controls so the question generator can produce one
question per control in the methodology's own structure.

The JSON schema (consistent across all files) looks like:

    {
      "id": "iso_27001",
      "name": "ISO/IEC 27001:2022",
      "version": "2022",
      "official_sources": [{"title": "...", "url": "..."}],
      "assessment_shapes": ["asset_threat_vulnerability"],
      "methodology": "Clause 6.1.2 ...",
      "scoping_inputs": [...],
      "risk_model": {
        "factors": ["asset", "threat", "vulnerability", "likelihood", "impact_c", ...],
        "scales": {
          "likelihood": [{"value": 1, "label": "Rare", "definition": "..."}, ...],
          "impact":     [...],
          "maturity":   [...],            # optional
          "implementation_status": [...]   # optional
        },
        "matrix": "5x5",
        "calculation": "max(impact_c, impact_i, impact_a) * likelihood",
        "acceptance_threshold": 6,
        "thresholds": {"low": [1, 4], ...}
      },
      "domains": [
        {
          "id": "ANNEX_A",
          "name": "Annex A — ...",
          "controls": [
            {
              "id": "A.5.1",
              "title": "...",
              "description": "...",
              "question_block": {
                "type": "asset_threat_vulnerability",
                "questions": [
                  {"field": "asset", "type": "text", "prompt": "..."},
                  {"field": "likelihood", "type": "scale", "scale": "likelihood", "prompt": "..."},
                  ...
                ]
              }
            }
          ]
        }
      ]
    }
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

from . import (
    Methodology,
    MethodologyControl,
    MethodologyField,
    Phase,
    ScalePoint,
    TreatmentOption,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Hand-curated alias overrides per framework id. The loader also extracts
# aliases automatically from each JSON's `name` and `id`, but for
# disambiguation (especially within a regulator family like SBP) explicit
# specific aliases avoid false matches.
_ALIAS_OVERRIDES: Dict[str, List[str]] = {
    "aramco_ccc": [
        "aramco ccc", "sacs-002", "sacs 002", "saudi aramco cybersecurity",
        # Broader catches — uploaded framework names rarely match the full
        # canonical title verbatim. "aramco" / "saudi aramco" alone are
        # specific enough to never collide with another methodology.
        "aramco", "saudi aramco", "third party cybersecurity",
    ],
    "cis_controls": [
        "cis controls", "cis v8", "cis v8.1", "cis critical security",
        "center for internet security", "cis benchmark",
    ],
    "cobit": ["cobit", "cobit 2019", "cobit 5", "isaca cobit", "edm03", "apo12"],
    "dora": ["dora", "digital operational resilience"],
    "gdpr": [
        "gdpr", "dpia", "data protection impact",
        "general data protection", "regulation 2016/679", "eu 2016/679",
    ],
    "hipaa": [
        "hipaa", "hitech", "ocr risk analysis", "hhs sra",
        "health insurance portability",
    ],
    "iso_22301": ["iso 22301", "iso/iec 22301", "iso22301", "business continuity management"],
    "iso_27001": ["iso 27001", "iso/iec 27001", "iso27001", "isms", "iso 27002", "iso 27005"],
    "mas_trm": [
        "mas trm", "mas technology risk", "monetary authority of singapore",
        "trm guidelines",
    ],
    "nis2": ["nis2", "nis 2", "nis-2", "nis directive"],
    "nist_800_53": ["nist 800-53", "nist sp 800-53", "nist800-53", "nist 80053"],
    "nist_csf": ["nist csf", "nist cybersecurity framework", "csf 2.0", "csf v2"],
    "pci_dss": [
        "pci dss", "pci-dss", "pcidss",
        "payment card industry", "payment card data security",
        "pci data security",
    ],
    "sabic_cybertrust": ["sabic cybertrust", "sabic cyber trust", "sabic"],
    "sama_csf": [
        "sama csf", "sama cyber", "saudi arabian monetary",
        "saudi central bank", "saudi banking cybersecurity",
    ],
    # SBP family — each gets very specific aliases so they never collide.
    "sbp_cloud": [
        "outsourcing to cloud", "sbp cloud", "bprd 01 of 2023",
        "state bank pakistan cloud", "sbp cloud computing",
    ],
    "sbp_etgrmf": [
        "etgrmf", "enterprise technology governance",
        "bprd 05 of 2017", "sbp risk management framework",
    ],
    "sbp_internet_banking": [
        "sbp internet banking", "security of internet banking",
        "psd 2015", "internet banking pakistan",
    ],
    "sl_csf": [
        "cbsl", "sri lanka cybersecurity", "sri lanka csf",
        # Most permissive — "sri lanka" alone is uniquely identifying.
        "sri lanka", "central bank of sri lanka",
    ],
    "soc2": [
        "soc 2", "soc2", "trust services criteria", "trust service criteria",
        "soc ii",
    ],
    "sox": [
        "sox", "sarbanes-oxley", "icfr",
        "internal controls over financial reporting", "sarbanes oxley",
    ],
    "swift_cscf": [
        "swift cscf", "swift customer security",
        "customer security controls framework",
    ],
}


def _seed_dir() -> str:
    """Absolute path to the framework_assessments seed directory."""
    here = os.path.dirname(os.path.abspath(__file__))
    # backend/grc/modules/erm/framework_methodologies/ → backend/grc/seed_data/...
    return os.path.normpath(
        os.path.join(here, "..", "..", "..", "seed_data", "framework_assessments", "frameworks")
    )


def load_all_methodologies() -> List[Methodology]:
    """Load every JSON guide into a Methodology. Skip & log any that fail."""
    base = _seed_dir()
    if not os.path.isdir(base):
        logger.warning("framework_assessments seed dir missing: %s", base)
        return []
    out: List[Methodology] = []
    for filename in sorted(os.listdir(base)):
        if not filename.endswith(".json"):
            continue
        path = os.path.join(base, filename)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                raw = json.load(fh)
            m = _build_methodology(raw)
            out.append(m)
        except Exception:
            logger.exception("Failed to load methodology JSON: %s", path)
    return out


# ---------------------------------------------------------------------------
# Per-JSON construction

def _build_methodology(raw: Dict[str, Any]) -> Methodology:
    code = str(raw["id"]).strip()
    name = str(raw.get("name") or code).strip()
    version = (raw.get("version") or "").strip() or None
    methodology_text = (raw.get("methodology") or "").strip() or None
    shapes = raw.get("assessment_shapes") or []
    assessment_shape = shapes[0] if shapes else None
    official_sources = raw.get("official_sources") or []

    rm = raw.get("risk_model") or {}
    scales = rm.get("scales") or {}
    likelihood_scale = _scale_from_json(scales.get("likelihood"))
    impact_scale = _scale_from_json(scales.get("impact"))
    maturity_scale = _scale_from_json(scales.get("maturity")) or None
    impl_status = scales.get("implementation_status") or None

    domains_raw = raw.get("domains") or []
    phases = _phases_from_domains(domains_raw)
    controls = _controls_from_domains(domains_raw)
    fields = _fields_for_methodology(domains_raw, scales)

    aliases = _aliases_for(code, name)
    short_description = _short_description(name, methodology_text, assessment_shape)
    reference = _reference_string(name, version)
    treatment_options = _default_treatment_options()

    return Methodology(
        code=code,
        display_name=name,
        short_description=short_description,
        reference_standard=reference,
        aliases=aliases,
        phases=phases,
        fields=fields,
        likelihood_scale=likelihood_scale or _fallback_5tier("Likelihood"),
        impact_scale=impact_scale or _fallback_5tier("Impact"),
        treatment_options=treatment_options,
        controls=controls,
        maturity_scale=maturity_scale,
        implementation_status_scale=impl_status,
        assessment_shape=assessment_shape,
        methodology_text=methodology_text,
        risk_calculation=rm.get("calculation"),
        acceptance_threshold=rm.get("acceptance_threshold"),
        risk_thresholds=rm.get("thresholds"),
        version=version,
        official_sources=official_sources,
        questions_per_control=1,
        default_scope="full",
    )


# ---------------------------------------------------------------------------
# Scale / phase / control / field extraction

def _scale_from_json(items: Any) -> List[ScalePoint]:
    if not items:
        return []
    out: List[ScalePoint] = []
    for item in items:
        try:
            value = int(item.get("value"))
        except (TypeError, ValueError):
            continue
        out.append(
            ScalePoint(
                value=value,
                label=str(item.get("label") or value),
                description=str(item.get("definition") or item.get("description") or ""),
            )
        )
    return out


def _phases_from_domains(domains: List[Dict[str, Any]]) -> List[Phase]:
    out: List[Phase] = []
    for idx, d in enumerate(domains, start=1):
        code = str(d.get("id") or f"D{idx}").strip()
        name = str(d.get("name") or code).strip()
        out.append(
            Phase(
                code=_safe_phase_code(code),
                name=name,
                description=(d.get("description") or "").strip(),
                order=idx,
            )
        )
    return out


def _controls_from_domains(domains: List[Dict[str, Any]]) -> List[MethodologyControl]:
    out: List[MethodologyControl] = []
    for d in domains:
        domain_id = _safe_phase_code(str(d.get("id") or "").strip())
        domain_name = str(d.get("name") or "").strip()
        for c in d.get("controls") or []:
            ctrl_id = str(c.get("id") or "").strip()
            title = str(c.get("title") or "").strip()
            description = (c.get("description") or "").strip() or None
            qb = c.get("question_block") or {}
            # Most frameworks reuse the same question_block across controls,
            # so we leave per-control fields=None and use methodology-level
            # fields. We only override here if the block differs from the
            # primary block — detected by the caller.
            out.append(
                MethodologyControl(
                    domain_id=domain_id,
                    domain_name=domain_name,
                    control_id=ctrl_id,
                    control_title=title,
                    description=description,
                    fields=None,  # methodology-level fields used by default
                )
            )
    return out


def _fields_for_methodology(
    domains: List[Dict[str, Any]],
    scales: Dict[str, Any],
) -> List[MethodologyField]:
    """Take the first control's question_block as the methodology field shape.

    Across the seed data we've verified that every control inside a single
    framework reuses the same question_block schema, so picking the first
    one gives the canonical field set without per-control duplication.
    """
    for d in domains:
        for c in d.get("controls") or []:
            qb = c.get("question_block") or {}
            questions = qb.get("questions") or []
            if questions:
                return [_question_to_field(q, scales) for q in questions]
    return []


def _question_to_field(q: Dict[str, Any], scales: Dict[str, Any]) -> MethodologyField:
    field_key = str(q.get("field") or "").strip() or "field"
    prompt = str(q.get("prompt") or "").strip()
    qtype = (q.get("type") or "text").strip().lower()
    scale_name = (q.get("scale") or "").strip() or None

    if qtype == "scale" and scale_name:
        # Render rating-scale questions as a select whose options are
        # "<value> · <label>" so the assessor sees the meaning of each tier.
        scale_items = scales.get(scale_name) or []
        options = [
            f"{int(p.get('value'))} · {p.get('label')}"
            for p in scale_items
            if isinstance(p.get('value'), (int, float))
        ]
        return MethodologyField(
            key=field_key,
            label=_field_label(field_key, prompt),
            field_type="select",
            options=options or None,
            help_text=prompt if prompt and prompt != _field_label(field_key, prompt) else None,
            scale=scale_name,
        )

    if qtype == "select":
        opts = q.get("options") or []
        return MethodologyField(
            key=field_key,
            label=_field_label(field_key, prompt),
            field_type="select",
            options=[str(o) for o in opts] if opts else None,
            help_text=prompt if prompt and prompt != _field_label(field_key, prompt) else None,
        )

    if qtype == "boolean":
        return MethodologyField(
            key=field_key,
            label=_field_label(field_key, prompt),
            field_type="select",
            options=["Yes", "No"],
            help_text=prompt if prompt and prompt != _field_label(field_key, prompt) else None,
        )

    if qtype == "date":
        return MethodologyField(
            key=field_key,
            label=_field_label(field_key, prompt),
            field_type="text",
            placeholder="YYYY-MM-DD",
            help_text=prompt if prompt and prompt != _field_label(field_key, prompt) else None,
        )

    # "text", "list", "number", fallback → textarea for longer fields by name,
    # plain text input otherwise.
    is_long = any(tok in field_key for tok in (
        "description", "plan", "rationale", "remediation",
        "evidence", "gap", "test", "exception", "scenario",
    ))
    return MethodologyField(
        key=field_key,
        label=_field_label(field_key, prompt),
        field_type="textarea" if is_long else "text",
        placeholder=prompt or None,
        help_text=None,
    )


def _field_label(key: str, prompt: str) -> str:
    """Turn 'impact_c' into 'Impact (Confidentiality)' and 'control_owner'
    into 'Control owner' — make the label friendly for the UI."""
    pretty_map = {
        "impact_c": "Impact — Confidentiality",
        "impact_i": "Impact — Integrity",
        "impact_a": "Impact — Availability",
        "inherent_likelihood": "Inherent likelihood",
        "residual_likelihood": "Residual likelihood",
        "inherent_impact": "Inherent impact",
        "residual_impact": "Residual impact",
        "ephi_asset": "ePHI asset / system",
        "hipaa_citation": "HIPAA citation",
        "tsc_category": "Trust Services category",
        "control_description": "Control description",
        "control_owner": "Control owner",
        "test_of_design": "Test of design",
        "test_of_operating_effectiveness": "Test of operating effectiveness",
        "target_maturity": "Target maturity",
        "remediation_plan": "Remediation plan",
        "target_date": "Target date",
        "risk_if_not_implemented": "Risk if not implemented",
        "compliance_status": "Compliance status",
        "compensating_control": "Compensating control",
    }
    if key in pretty_map:
        return pretty_map[key]
    # Default: convert "snake_case" → "Snake case"
    text = key.replace("_", " ").strip()
    return text[:1].upper() + text[1:]


def _safe_phase_code(raw: str) -> str:
    """Phase codes are stored in a VARCHAR(50) column, so trim aggressively
    and remove characters that would confuse downstream consumers."""
    s = re.sub(r"\s+", "_", (raw or "").strip())
    s = re.sub(r"[^A-Za-z0-9_.-]", "", s)
    return (s or "phase")[:50]


# ---------------------------------------------------------------------------
# Aliases / labels

def _aliases_for(code: str, name: str) -> List[str]:
    """Combine hand-curated overrides with auto-extracted aliases."""
    aliases: List[str] = list(_ALIAS_OVERRIDES.get(code, []))
    # Always include the id itself, with underscores → spaces.
    aliases.append(code)
    aliases.append(code.replace("_", " "))
    # Acronyms inside parentheses, e.g. "Digital Operational Resilience Act (DORA)" → "DORA".
    for paren in re.findall(r"\(([^)]+)\)", name):
        paren = paren.strip()
        if paren:
            aliases.append(paren)
    # The framework name without parentheses (good for substring matching).
    clean_name = re.sub(r"\([^)]*\)", "", name).strip()
    if clean_name:
        aliases.append(clean_name)
    # Dedup while preserving order, case-insensitive.
    seen = set()
    deduped: List[str] = []
    for a in aliases:
        key = a.lower().strip()
        if key and key not in seen:
            seen.add(key)
            deduped.append(a)
    return deduped


def _short_description(name: str, methodology_text: Optional[str], shape: Optional[str]) -> str:
    """Compose a one-liner used in the UI's methodology badge."""
    if methodology_text:
        text = methodology_text.strip()
        # Trim long methodology blurbs to a single sentence/clause.
        first = re.split(r"(?<=[.!?])\s", text, maxsplit=1)[0]
        if len(first) > 240:
            first = first[:237].rstrip() + "…"
        return first
    if shape:
        return f"{name} — {shape.replace('_', ' ')} assessment."
    return f"{name} risk assessment."


def _reference_string(name: str, version: Optional[str]) -> str:
    return f"{name} ({version})" if version else name


def _default_treatment_options() -> List[TreatmentOption]:
    """Treatment options used across all methodologies. The JSON guides
    don't include this list, so we use the standard four-option taxonomy
    that every major risk-management framework supports."""
    return [
        TreatmentOption("mitigate", "Mitigate", "Apply controls to reduce likelihood, impact, or both."),
        TreatmentOption("accept", "Accept", "Acknowledge the risk and continue within stated criteria."),
        TreatmentOption("avoid", "Avoid", "Eliminate or change the activity that gives rise to the risk."),
        TreatmentOption("transfer", "Transfer / share", "Shift residual risk via insurance or contract."),
    ]


def _fallback_5tier(label: str) -> List[ScalePoint]:
    """Used only when the JSON omits a likelihood/impact scale (it always
    has them, but defensive code keeps the loader total)."""
    return [
        ScalePoint(1, "Very Low", f"{label} — minimal."),
        ScalePoint(2, "Low", f"{label} — limited."),
        ScalePoint(3, "Medium", f"{label} — moderate."),
        ScalePoint(4, "High", f"{label} — significant."),
        ScalePoint(5, "Very High", f"{label} — severe."),
    ]
