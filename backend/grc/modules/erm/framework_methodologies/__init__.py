"""Framework-specific risk-assessment methodologies.

Loaded at startup from the tenant-maintained JSON guides under
``backend/grc/seed_data/framework_assessments/frameworks/``. Each JSON
holds the framework's official assessment shape — domains, controls,
question prompts, likelihood / impact / maturity scales, and risk
thresholds — which the platform then turns into one risk-assessment
question per control with the methodology's exact field set.

Public API
----------
- ``Methodology`` — dataclass describing one methodology.
- ``MethodologyControl`` — one official control item from the JSON catalog.
- ``match_methodology(name, short_code)`` — find the right methodology for
  an uploaded framework based on aliases; returns ``None`` if no match.
- ``all_methodologies()`` — registry listing for the UI.
- ``get_methodology(code)`` — look up by canonical code.
- ``generate_questions(methodology, framework, controls, ...)`` — emit the
  question payloads ready to persist as ``FrameworkRiskQuestion`` rows.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class ScalePoint:
    """One step on a 5-tier (or 6-tier) qualitative scale."""

    value: int
    label: str
    description: str


@dataclass(frozen=True)
class Phase:
    """A discrete stage / domain of the assessment workflow."""

    code: str
    name: str
    description: str
    order: int


@dataclass(frozen=True)
class MethodologyField:
    """A methodology-specific input field rendered on each question card."""

    key: str
    label: str
    field_type: str = "text"          # text | textarea | select | date | boolean
    placeholder: Optional[str] = None
    options: Optional[List[str]] = None
    required: bool = False
    help_text: Optional[str] = None
    # When this field is a 1-5 rating that maps to one of the methodology's
    # named scales (likelihood / impact / maturity / implementation_status)
    # the loader records which one so the UI can render rich labels.
    scale: Optional[str] = None


@dataclass(frozen=True)
class TreatmentOption:
    value: str
    label: str
    description: str


@dataclass(frozen=True)
class MethodologyControl:
    """One official control item from the methodology's catalog.

    Generated questions are emitted one-per-control so the assessment
    follows the framework's own structure rather than an AI guess.
    """

    domain_id: str
    domain_name: str
    control_id: str
    control_title: str
    description: Optional[str] = None
    # Per-control question_block override. Most frameworks reuse the same
    # block across every control (so this stays ``None`` and the
    # methodology-level ``fields`` are used). A few frameworks vary the
    # block per control — those carry it here.
    fields: Optional[List[MethodologyField]] = None


@dataclass
class Methodology:
    """Declarative shape of a framework's risk-assessment methodology."""

    code: str
    display_name: str
    short_description: str
    reference_standard: str
    aliases: List[str]
    phases: List[Phase]
    fields: List[MethodologyField]
    likelihood_scale: List[ScalePoint]
    impact_scale: List[ScalePoint]
    treatment_options: List[TreatmentOption]
    controls: List[MethodologyControl] = field(default_factory=list)
    maturity_scale: Optional[List[ScalePoint]] = None
    implementation_status_scale: Optional[List[Dict[str, str]]] = None
    assessment_shape: Optional[str] = None         # e.g. "control_maturity"
    methodology_text: Optional[str] = None         # JSON's `methodology` blurb
    risk_calculation: Optional[str] = None         # e.g. "max(c,i,a)*likelihood"
    acceptance_threshold: Optional[int] = None
    risk_thresholds: Optional[Dict[str, List[int]]] = None
    version: Optional[str] = None
    official_sources: List[Dict[str, str]] = field(default_factory=list)
    questions_per_control: int = 1
    default_scope: str = "full"

    # ------------------------------------------------------------------
    # Matching helpers

    def matches(self, name: Optional[str], short_code: Optional[str] = None) -> bool:
        haystacks = [s for s in (name, short_code) if s]
        if not haystacks:
            return False
        normalized = " ".join(_normalize(h) for h in haystacks)
        for alias in self.aliases:
            if _normalize(alias) in normalized:
                return True
        return False

    def to_dict(self) -> Dict[str, Any]:
        """Serializable form for the frontend registry endpoint."""
        return {
            "code": self.code,
            "display_name": self.display_name,
            "short_description": self.short_description,
            "reference_standard": self.reference_standard,
            "version": self.version,
            "official_sources": self.official_sources,
            "assessment_shape": self.assessment_shape,
            "methodology_text": self.methodology_text,
            "phases": [
                {"code": p.code, "name": p.name, "description": p.description, "order": p.order}
                for p in self.phases
            ],
            "fields": [_field_to_dict(f) for f in self.fields],
            "likelihood_scale": [_scale_to_dict(s) for s in self.likelihood_scale],
            "impact_scale": [_scale_to_dict(s) for s in self.impact_scale],
            "maturity_scale": (
                [_scale_to_dict(s) for s in self.maturity_scale] if self.maturity_scale else None
            ),
            "implementation_status_scale": self.implementation_status_scale,
            "treatment_options": [
                {"value": t.value, "label": t.label, "description": t.description}
                for t in self.treatment_options
            ],
            "questions_per_control": self.questions_per_control,
            "default_scope": self.default_scope,
            "risk_calculation": self.risk_calculation,
            "acceptance_threshold": self.acceptance_threshold,
            "risk_thresholds": self.risk_thresholds,
            "control_count": len(self.controls),
        }


def _scale_to_dict(s: ScalePoint) -> Dict[str, Any]:
    return {"value": s.value, "label": s.label, "description": s.description}


def _field_to_dict(f: MethodologyField) -> Dict[str, Any]:
    return {
        "key": f.key,
        "label": f.label,
        "field_type": f.field_type,
        "placeholder": f.placeholder,
        "options": f.options,
        "required": f.required,
        "help_text": f.help_text,
        "scale": f.scale,
    }


def _normalize(s: str) -> str:
    """Lowercase + strip non-alphanumerics for substring alias matching."""
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


# ----------------------------------------------------------------------
# Registry — lazy-loaded once on first access, then cached. Sourced from
# the tenant-maintained JSON guides under seed_data/.

_REGISTRY: Optional[List[Methodology]] = None


def _load_registry() -> List[Methodology]:
    global _REGISTRY
    if _REGISTRY is not None:
        return _REGISTRY
    from ._loader import load_all_methodologies  # noqa: WPS433
    _REGISTRY = load_all_methodologies()
    # Sort most-specific first so e.g. "sbp_cloud" wins over "sbp_etgrmf"
    # when both contain "sbp" as an alias. Specificity proxy: number of
    # alias characters (longer aliases win) is good enough.
    _REGISTRY.sort(key=lambda m: -max((len(a) for a in m.aliases), default=0))
    return _REGISTRY


def all_methodologies() -> List[Methodology]:
    return list(_load_registry())


def match_methodology(
    framework_name: Optional[str],
    short_code: Optional[str] = None,
) -> Optional[Methodology]:
    """Return the first methodology whose aliases match the given framework.

    Returns ``None`` if no methodology applies — the caller falls back to
    the legacy AI generator so unmapped frameworks still produce something.
    """
    for m in _load_registry():
        if m.matches(framework_name, short_code):
            return m
    return None


def get_methodology(code: str) -> Optional[Methodology]:
    for m in _load_registry():
        if m.code == code:
            return m
    return None


# Re-export the generator entry-point.
from ._generator import generate_questions  # noqa: E402,F401
