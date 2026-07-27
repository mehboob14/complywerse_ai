"""Unit tests for the governance AI drafting pipeline (production-readiness work).

These are pure unit tests: the LLM call (`pipeline._chat_json`) is monkeypatched
with a deterministic fake, and `FrameworkIndex` / `TenantContextBundle` are built
in memory — no DB, no network. They prove:

  (a) charter routes to the charter scaffold,
  (b) a broad policy fans the clause engine across multiple areas,
  (c) a scoped procedure injects ONLY its in-scope parent clauses,
  (d) configured / cited numbers sit after the craft block (so they win) and the
      industry defaults are explicitly demoted,
  (e) leap-day date math no longer raises,
plus backward-compat invariants (industry no-op for banks, annex headings,
scaffold topics all known, warn-level clause-ref QA).
"""
import re
from datetime import datetime, timedelta, timezone

import pytest

from grc.modules.governance.ai_drafting import pipeline
from grc.modules.governance.ai_drafting import scaffolds
from grc.modules.governance.ai_drafting.framework_index import (
    FrameworkCitation,
    FrameworkIndex,
    TOPIC_KEYWORDS,
)
from grc.modules.governance.ai_drafting.tenant_context import TenantContextBundle


# ─── in-memory fixtures ──────────────────────────────────────────────

def make_index() -> FrameworkIndex:
    idx = FrameworkIndex(tenant_id=1)
    idx.framework_summaries = [
        {"code": "ISO-27001", "name": "ISO/IEC 27001:2022", "version": "2022",
         "regulator": "Reg", "control_count": 3}
    ]

    def cite(ref, title):
        return FrameworkCitation("ISO-27001", "ISO/IEC 27001:2022", "2022", ref, title, "excerpt")

    idx.topics = {
        "access_control": [cite("A.5.15", "Access control")],
        "data_protection": [cite("A.8.24", "Cryptography")],
        "incident_management": [cite("A.5.24", "Incident management")],
    }
    return idx


def make_ctx(industry=None, password_min=None) -> TenantContextBundle:
    pw = None
    if password_min is not None:
        pw = {
            "min_length": password_min, "require_uppercase": True, "require_lowercase": True,
            "require_digit": True, "require_special": True, "lockout_threshold": 5,
            "lockout_minutes": 30, "session_idle_timeout_minutes": 15,
            "password_history_count": 12, "max_password_age_days": 90,
        }
    return TenantContextBundle(
        tenant_id=1, organization_name="Northwind", legal_entity=None,
        industry=industry, regulatory_scope=None, geography=None,
        primary_contact_name="A. Owner", password_policy=pw,
    )


def make_fake(calls):
    """Deterministic fake LLM. Records every call; returns generous section content
    (passes QA), echoing any [PS-xxx] refs present in the prompt so coverage works."""
    def fake(prompt, *, system, temperature=0.45, max_tokens=3200):
        calls.append({"prompt": prompt, "system": system})
        if "mapping section numbers to topic keys" in (system or ""):
            return {}
        refs = re.findall(r"\[(PS-[A-Za-z0-9\-]+)\]", prompt)
        ref_tag = f" [{refs[0]}]" if refs else ""
        lines = [
            f"7.{i} The organisation shall maintain control number {i} with a named "
            f"responsible function, evidence retained, and a defined review cadence "
            f"for audit completeness.{ref_tag}"
            for i in range(1, 46)
        ]
        body = "## Heading\n\n" + "\n".join(lines)
        return {"content": body}
    return fake


# ─── (a) charter ─────────────────────────────────────────────────────

def test_charter_routes_to_charter_scaffold():
    sc = scaffolds.get_scaffold("Charter")  # case-insensitive
    assert sc.doc_type == "charter"
    assert sc is scaffolds.CHARTER_SCAFFOLD
    headings = [s.heading for s in sc.mandatory_sections]
    assert any("Purpose and Authority" == h for h in headings)
    assert any("Decision Rights and Delegated Authority" == h for h in headings)
    # quorum is an explicit must in the composition section
    assert any("QUORUM" in s.expansion_focus for s in sc.mandatory_sections)
    # charters are focused, not breadth fan-out
    assert sc.clause_engine_breadth is False


def test_unknown_doc_type_falls_back_to_policy():
    assert scaffolds.get_scaffold("framework").doc_type == "policy"
    assert scaffolds.get_scaffold("nonsense").doc_type == "policy"


# ─── (b) broad policy spans multiple areas ───────────────────────────

def test_broad_policy_spans_multiple_areas(monkeypatch):
    calls = []
    monkeypatch.setattr(pipeline, "_chat_json", make_fake(calls))
    res = pipeline.run_drafting_pipeline(
        doc_type="policy", title="Information Security Policy", description=None,
        tenant_context=make_ctx(), framework_index=make_index(),
    )
    outline = next(s for s in res.stage_telemetry["stages"] if s["stage"] == "outline")
    # The clause-engine section (Policy Statements = §7) now plans multiple areas.
    assert len(outline["area_plan"].get("7", [])) > 1


def test_single_area_when_one_topic(monkeypatch):
    """A policy whose index has a single topic stays single-area (len-1 == today)."""
    calls = []
    monkeypatch.setattr(pipeline, "_chat_json", make_fake(calls))
    idx = make_index()
    idx.topics = {"access_control": idx.topics["access_control"]}  # one topic only
    res = pipeline.run_drafting_pipeline(
        doc_type="policy", title="Access Control Policy", description=None,
        tenant_context=make_ctx(), framework_index=idx,
    )
    outline = next(s for s in res.stage_telemetry["stages"] if s["stage"] == "outline")
    assert len(outline["area_plan"].get("7", [])) == 1


def test_focus_areas_override_drives_plan(monkeypatch):
    calls = []
    monkeypatch.setattr(pipeline, "_chat_json", make_fake(calls))
    res = pipeline.run_drafting_pipeline(
        doc_type="policy", title="P", description=None,
        tenant_context=make_ctx(), framework_index=make_index(),
        focus_areas=["access_control", "incident_management"],
    )
    outline = next(s for s in res.stage_telemetry["stages"] if s["stage"] == "outline")
    # focus-area labels preserve the user's exact wording (not humanized)
    assert outline["area_plan"]["7"] == ["access_control", "incident_management"]


# ─── (c) scoped procedure: only in-scope parent clauses ──────────────

def test_scoped_procedure_injects_only_in_scope_parent_clauses(monkeypatch):
    calls = []
    monkeypatch.setattr(pipeline, "_chat_json", make_fake(calls))
    parent_index = {
        "PS-001": "User access shall follow least privilege; privileged access is logged.",
        "PS-002": "User access rights shall be reviewed; privileged access recertified.",
        "PS-050": "Personal data shall be encrypted and a data retention schedule enforced.",
    }
    res = pipeline.run_drafting_pipeline(
        doc_type="procedure", title="Access Provisioning Procedure", description=None,
        tenant_context=make_ctx(), framework_index=make_index(),
        parent_index=parent_index, parent_scope=["PS-001", "PS-002"],
    )
    all_prompts = "\n".join(c["prompt"] for c in calls)
    assert "PS-001" in all_prompts and "PS-002" in all_prompts
    # the out-of-scope clause is NEVER injected into any prompt
    assert "PS-050" not in all_prompts
    # scoped → not flagged ambiguous
    assert not any("ambiguous" in w.lower() for w in res.warnings)


def test_broad_unscoped_procedure_warns(monkeypatch):
    monkeypatch.setattr(pipeline, "_chat_json", make_fake([]))
    parent_index = {f"PS-{i:03d}": f"User access control statement {i}" for i in range(1, 20)}
    res = pipeline.run_drafting_pipeline(
        doc_type="procedure", title="Mega Procedure", description=None,
        tenant_context=make_ctx(), framework_index=make_index(),
        parent_index=parent_index,  # no scope → ambiguous
    )
    assert any("ambiguous" in w.lower() for w in res.warnings)


def test_legacy_blob_parent_unchanged_path(monkeypatch):
    """A caller passing only the legacy blob (no index/scope) still gets the blob
    injected verbatim — backward compatible."""
    calls = []
    monkeypatch.setattr(pipeline, "_chat_json", make_fake(calls))
    blob = "PARENT DOCUMENT — statements:\n[PS-009] Encrypt personal data at rest."
    pipeline.run_drafting_pipeline(
        doc_type="procedure", title="P", description=None,
        tenant_context=make_ctx(), framework_index=make_index(),
        parent_document_context=blob,
    )
    assert any("[PS-009] Encrypt personal data at rest." in c["prompt"] for c in calls)


# ─── (d) configured / cited numbers win over industry defaults ───────

def test_configured_numbers_after_craft_block():
    sc = scaffolds.POLICY_SCAFFOLD
    sec = next(s for s in sc.mandatory_sections if s.inject_password_policy)
    prompt = pipeline._build_section_prompt(
        section=sec, scaffold=sc, ctx=make_ctx(password_min=17), idx=make_index(),
        resolved_topic="password_policy", user_title="P", user_description=None,
        parent_document_context=None,
    )
    assert "INDUSTRY DEFAULTS" in prompt           # defaults explicitly demoted
    assert "CONFIGURED PASSWORD / SESSION POLICY THRESHOLDS" in prompt
    assert "17" in prompt                           # the configured value is present
    # configured block sits AFTER the craft/defaults block → wins the model's attention
    assert prompt.index("INDUSTRY DEFAULTS") < prompt.index("CONFIGURED PASSWORD / SESSION POLICY THRESHOLDS")
    # citations (and their convention) also sit after the craft block
    assert prompt.index("INDUSTRY DEFAULTS") < prompt.index("CITATION CONVENTIONS")


def test_industry_defaults_demoted_with_precedence_rule():
    from grc.modules.governance.ai_drafting.enterprise_craft import BANKING_REALITY_BLOCK
    assert "INDUSTRY DEFAULTS" in BANKING_REALITY_BLOCK
    assert "ALWAYS wins" in BANKING_REALITY_BLOCK


# ─── (e) leap-day date math ──────────────────────────────────────────

def test_leapday_date_math_is_safe():
    leap = datetime(2024, 2, 29, tzinfo=timezone.utc)
    # the OLD approach raised on a leap day:
    with pytest.raises(ValueError):
        leap.replace(year=2025)
    # the NEW approach never does:
    assert (leap + timedelta(days=365)).strftime("%Y-%m-%d") == "2025-02-28"


def test_metadata_stage_produces_review_date():
    sc = scaffolds.POLICY_SCAFFOLD
    out = pipeline._stage_metadata_and_annexures(
        scaffold=sc, ctx=make_ctx(), idx=make_index(),
        user_title="P", document_owner_name=None,
    )
    assert "Next Review Date" in out["1"]
    assert "Document Description" in out["1"]


# ─── backward-compat / invariants ────────────────────────────────────

def test_industry_noop_for_bank_and_unset():
    from grc.modules.governance.ai_drafting.enterprise_craft import (
        industry_profile, apply_industry, BANKING_REALITY_BLOCK, SME_SYSTEM_ADDENDUM,
    )
    for ind in (None, "", "Banking", "Financial Services"):
        p = industry_profile(ind)
        assert apply_industry(BANKING_REALITY_BLOCK, p) == BANKING_REALITY_BLOCK
        assert apply_industry(SME_SYSTEM_ADDENDUM, p) == SME_SYSTEM_ADDENDUM


def test_industry_reskins_for_non_bank():
    from grc.modules.governance.ai_drafting.enterprise_craft import industry_profile, apply_industry
    p = industry_profile("Healthcare")
    assert p.is_bank_default is False
    out = apply_industry('Refer to the organisation as "the Bank".', p)
    assert "the Bank" not in out
    assert p.entity_noun in out


def test_annex_headings_not_double_numbered():
    for sc in scaffolds._SCAFFOLD_REGISTRY.values():
        for s in sc.mandatory_sections:
            if s.heading.strip().lower().startswith("annex"):
                assert s.full_heading == s.heading.strip(), f"{sc.doc_type}/{s.number}"


def test_all_scaffold_topics_exist_in_framework_taxonomy():
    for sc in scaffolds._SCAFFOLD_REGISTRY.values():
        for s in sc.mandatory_sections:
            if s.topic is not None:
                assert s.topic in TOPIC_KEYWORDS, f"{sc.doc_type}/{s.number}: unknown topic {s.topic!r}"


def test_qa_clause_ref_is_warn_level_not_failure():
    from grc.modules.governance.ai_drafting.qa import validate_section
    sec = scaffolds.POLICY_SCAFFOLD.mandatory_sections[2]  # a prose section
    body = (
        "## 3. Purpose\n\nThe organisation shall protect information assets in "
        "accordance with the framework [ISO-27001 2022, clause A.99.99]. " * 30
    )
    known = {"ISO-27001": {"A.5.15"}}  # A.99.99 is NOT a known ref
    res = validate_section(sec, body, ["ISO-27001"], known_clause_refs=known)
    assert res.unknown_clause_refs                 # the bad ref was flagged
    assert res.warnings                            # surfaced as a warning
    assert res.ok                                  # but NOT a hard failure


def test_run_pipeline_returns_warnings_field(monkeypatch):
    monkeypatch.setattr(pipeline, "_chat_json", make_fake([]))
    res = pipeline.run_drafting_pipeline(
        doc_type="policy", title="P", description=None,
        tenant_context=make_ctx(), framework_index=make_index(),
    )
    assert isinstance(res.warnings, list)
