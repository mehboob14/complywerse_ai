"""Every AI use case the platform has: what it is called, what the person gets from it, when it fires, what data it
reads and where in the code the provider is called.

This is the inventory the data-protection guard looks use cases up in (``lookup``), the AI Governance page will show, and
the thing ``tests/test_ai_registry.py`` checks against the source: a provider call that is not listed here fails the
test, and so does a listed call that no longer exists. To add a use case: add a ``_uc(...)`` row below, naming the
function that makes the call (``callsites``). When one function serves several use cases (a shared helper), each use
case names the function that starts it (``entry``). A use case that reads a risk, incident, task, asset, vulnerability
or assessment record also declares its columns in ``field_policies.py`` (``tests/test_ai_field_policies.py`` checks).

Fields
- ``id``        ``<module>.<name>``; the module prefix must be a key of ``MODULES``.
- ``label``     short name as the person knows the feature. ``value`` is one sentence on what they get.
                Neither names a model or a vendor (the product says "AI").
- ``surface``   where it appears in the product.
- ``trigger``   ``click`` (the person asks) | ``view`` (a GET that reaches the model: it may fire when a page or panel
                opens, to be confirmed page by page) | ``auto`` (fires on an event: upload, create, after a scan) |
                ``background`` (a job a click started) | ``offline`` (a developer script).
- ``profile``   LIB public/library only | STRUCT structured fields | TEXT short free text | DOC long documents |
                VISION images/scans | PEOPLE directories | CHAT conversational/retrieval | RAW raw target output.
- ``level``     L0 public .. L4 never to a public model (the profile's usual level; a proposal, refined with the policy).
- ``apis``      which SDK surface is called; ``chat`` and ``responses`` pass through the guard in the shim in
                ``grc/config.py``, so anything else is ``outside_shim`` (embeddings, Anthropic, raw HTTP).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

GUARDED_CLAUDE_CLIENT = "services/ai_gateway/claude_client.py"        # the one place that calls Claude, behind the guard
TRIGGERS = ("click", "view", "auto", "background", "offline")
PROFILES = ("LIB", "STRUCT", "TEXT", "DOC", "VISION", "PEOPLE", "CHAT", "RAW")
LEVELS = ("L0", "L1", "L2", "L3", "L4")
APIS = ("chat", "responses", "embeddings", "anthropic", "http", "other")
MODALITIES = ("text", "vision", "embedding")

MODULES: Dict[str, str] = {
    "administration": "Administration",
    "erm": "Risk Management",
    "assessments": "Assessments",
    "certification": "Certification",
    "frameworks": "Frameworks",
    "control_library": "Control Library",
    "governance": "Governance",
    "regulatory": "Regulatory Changes",
    "evidence": "Evidence Management",
    "third_party": "Third-Party Risk",
    "audit": "Audit",
    "access_review": "Access Reviews",
    "workflow": "Workflow Engine",
    "complychat": "ComplyChat",
    "tasks": "Task Management",
    "projects": "IS Projects",
    "dashboard": "Dashboard",
    "assets": "Asset Management",
    "vulnerabilities": "Vulnerability Management",
    "controls_automation": "Controls Automation",
    "integrations": "Integrations",
    "pentest": "Penetration Testing",
}


@dataclass(frozen=True)
class UseCase:
    id: str
    label: str
    value: str
    surface: str
    trigger: str
    profile: str
    level: str
    records: Tuple[str, ...]
    callsites: Tuple[str, ...]
    entry: Tuple[str, ...] = ()
    modality: str = "text"
    apis: Tuple[str, ...] = ("chat",)
    default_enabled: bool = True
    cache_hours: int = 0          # >0: an identical prompt is answered from the result cache for this long (services/ai_gateway/cache.py)

    @property
    def module(self) -> str:
        return self.id.split(".", 1)[0]

    @property
    def tier(self) -> str:
        return _TIER.get(self.id, "standard")

    @property
    def ambient(self) -> bool:
        """Fires without the person asking for AI (an event or a page load)."""
        return self.trigger in ("view", "auto")

    @property
    def outside_shim(self) -> bool:
        """Reaches a provider through something the central choke point does not cover yet: chat, Responses and the
        guarded Claude client (``services/ai_gateway/claude_client.py``) are covered."""
        for api in self.apis:
            if api in ("chat", "responses"):
                continue
            if api == "anthropic" and all(cs.startswith(GUARDED_CLAUDE_CLIENT + ":") for cs in self.callsites):
                continue
            return True
        return False


def _uc(id: str, label: str, value: str, surface: str, trigger: str, profile: str, level: str,
        records: Tuple[str, ...], *callsites: str, entry: Tuple[str, ...] = (), modality: str = "text",
        apis: Tuple[str, ...] = ("chat",), cache: int = 0) -> UseCase:
    return UseCase(id, label, value, surface, trigger, profile, level, records, tuple(callsites), tuple(entry), modality, tuple(apis),
                   cache_hours=cache)


_R = "modules/erm/routers/"
_CL = "modules/control_library/routers/"
_G = "modules/governance/routers/"

USE_CASES: Tuple[UseCase, ...] = (
    # ── Administration ───────────────────────────────────────────────────────
    _uc("administration.audit_log_summary", "Summarise an audit-log entry",
        "One plain-language sentence on what a logged action changed.", "Administration › Audit Logs",
        "click", "TEXT", "L3", ("audit_log",), "audit_ai_summary.py:generate_ai_summary",
        entry=("routers/admin_router.py:generate_audit_log_ai_summary",)),
    _uc("administration.custom_fields_import", "Suggest custom fields from a template file",
        "Reads an uploaded sheet or document and proposes the fields it contains.", "Settings › Custom fields",
        "click", "DOC", "L3", ("upload",), "services/assessment_evidence_ai.py:openai_complete",
        entry=("services/field_import.py:_complete",)),

    # ── Risk Management ──────────────────────────────────────────────────────
    _uc("erm.risk_suggest", "Suggest risk details",
        "Proposes a category, scoring and wording for a risk you are describing.", "Risk Management › Risk Register",
        "click", "TEXT", "L2", ("risk", "control"), _R + "risks.py:get_risk_ai_suggestions"),
    _uc("erm.risk_treatment_plan", "Draft a treatment plan",
        "Drafts treatment options for a risk from its description and linked controls.", "Risk Management › Risk Register",
        "click", "TEXT", "L2", ("risk", "control"), _R + "risks.py:generate_ai_treatment_plan"),
    _uc("erm.assessment_risk_suggest", "Suggest a rating for an assessed risk",
        "Proposes scores and a rationale from the risk and its linked KRIs, incidents and RCSA findings.",
        "Risk Management › Risk Assessments", "click", "TEXT", "L2", ("risk", "kri", "incident", "rcsa"),
        _R + "risk_assessments.py:ai_suggest_assessment_risk"),
    _uc("erm.incident_suggest", "Suggest incident details",
        "Proposes severity, classification and next steps for an incident, on request when it is created.",
        "Risk Management › Incidents", "click", "TEXT", "L2", ("incident", "risk"),
        _R + "incidents.py:_ai_suggest_incident_payload"),
    _uc("erm.incident_analyze", "Analyse an incident",
        "Relates an incident to existing risks, controls and earlier incidents.", "Risk Management › Incidents",
        "click", "TEXT", "L2", ("incident", "risk", "control"), _R + "incidents.py:analyze_incident_with_ai"),
    _uc("erm.kri_suggest", "Suggest a key risk indicator",
        "Proposes the metric, unit and thresholds for a KRI, on request when it is created.", "Risk Management › KRIs",
        "click", "TEXT", "L2", ("kri", "risk"), _R + "kris.py:_ai_suggest_kri_payload"),
    _uc("erm.appetite_suggest", "Suggest a risk appetite",
        "Proposes an appetite statement and limits for a risk category.", "Risk Management › Risk Appetite",
        "click", "STRUCT", "L1", ("risk",), _R + "appetite.py:ai_suggest_appetite"),
    _uc("erm.mitigation_suggest", "Suggest mitigation actions",
        "Proposes actions that reduce a risk, leaving out the ones already planned.", "Risk Management › Mitigation actions",
        "click", "TEXT", "L2", ("risk", "control"), _R + "mitigation_actions.py:ai_suggest_mitigations"),
    _uc("erm.internal_controls_enrich", "Enrich an uploaded controls list",
        "Adds categories and descriptions to every row of an uploaded control register, as part of the upload.",
        "Risk Management › Internal Controls", "auto", "TEXT", "L3", ("upload", "control"),
        _R + "internal_controls.py:_ai_enrich_controls"),
    _uc("erm.internal_control_category", "Suggest a control category",
        "Proposes the category and fields for a new internal control.", "Risk Management › Internal Controls",
        "click", "TEXT", "L2", ("control",), _R + "internal_controls.py:ai_suggest_control_category"),
    _uc("erm.scenario_explain", "Explain a risk scenario",
        "Explains a what-if scenario in plain language.", "Risk Management › Analytics",
        "click", "TEXT", "L2", ("risk",), _R + "advanced_analytics.py:ai_explain_scenario"),
    _uc("erm.bowtie_narrative", "Write a bow-tie narrative",
        "Writes the story of a risk from its causes, controls and consequences.", "Risk Management › Analytics",
        "click", "TEXT", "L2", ("risk", "incident", "control"), _R + "advanced_analytics.py:generate_bowtie_ai_narrative"),
    _uc("erm.rcsa_suggestions", "Suggest RCSA answers",
        "Proposes responses for a self-assessment question.", "Risk Management › RCSA",
        "view", "STRUCT", "L1", ("rcsa",), _R + "rcsa.py:get_ai_suggestions"),
    _uc("erm.rcsa_explain_row", "Explain an RCSA row",
        "Explains an uploaded RCSA row in plain language.", "Risk Management › RCSA",
        "click", "TEXT", "L3", ("rcsa", "upload"), _R + "rcsa_custom.py:explain_row"),
    _uc("erm.framework_questions", "Generate assessment questions from a framework",
        "Turns a framework's clauses into assessment questions.", "Risk Management › Framework Risk Assessments",
        "click", "DOC", "L3", ("framework",), _R + "framework_risk_assessments.py:_generate_questions_batch_with_ai"),
    _uc("erm.framework_question_fields", "Suggest values for a question's fields",
        "Proposes values for each methodology field of an assessment question.",
        "Risk Management › Framework Risk Assessments", "click", "TEXT", "L2", ("framework",),
        _R + "framework_risk_assessments.py:ai_suggest_question_fields"),
    _uc("erm.ai_risk_template", "Suggest AI-system risk text",
        "Drafts risk and control wording for an AI-system risk entry.", "Risk Management › AI Risk Assessment",
        "click", "TEXT", "L2", ("risk", "control"), "routers/ai_risk_assessment_router.py:_ai_llm_suggestion",
        apis=("chat", "anthropic")),

    # ── Assessments ──────────────────────────────────────────────────────────
    _uc("assessments.nca_risk_recommendation", "Recommend a treatment for an NCA risk entry",
        "Recommends how to treat a risk entry in an NCA assessment.", "Assessments › NCA",
        "click", "TEXT", "L2", ("risk",), "routers/nca_risk_router.py:generate_ai_recommendation"),
    _uc("assessments.nca_kpi_recommendation", "Recommend actions for an NCA KPI",
        "Recommends actions from a KPI's definition, targets and results.", "Assessments › NCA",
        "click", "STRUCT", "L1", ("kri",), "routers/nca_kpi_router.py:generate_ai_recommendation"),
    _uc("assessments.nca_vuln_recommendation", "Recommend a fix for an NCA vulnerability entry",
        "Recommends how to remediate a vulnerability entry in an NCA assessment.", "Assessments › NCA",
        "click", "TEXT", "L2", ("vulnerability",), "routers/nca_vuln_router.py:generate_ai_recommendation"),
    _uc("assessments.audit_plan_recommendation", "Recommend an audit approach",
        "Recommends the approach and evidence for an audit-plan entry.", "Assessments › Audit plan",
        "click", "TEXT", "L2", ("assessment",), "routers/audit_plan_router.py:generate_ai_recommendation"),
    _uc("assessments.context", "Summarise the context of an assessment",
        "Writes the background an assessor needs before starting.", "Assessments › Compliance assessments",
        "click", "TEXT", "L2", ("assessment",), "routers/compliance_assessments_router.py:generate_assessment_ai_context"),
    _uc("assessments.assess_item", "Draft an assessment of one control",
        "Drafts the likely finding, gap and score for one control.", "Assessments › Compliance assessments",
        "click", "TEXT", "L2", ("assessment",), "routers/compliance_assessments_router.py:ai_assess_item"),
    _uc("assessments.detail_recommendation", "Recommend what to do for an assessment row",
        "Recommends actions for the rows of an uploaded assessment sheet.", "Assessments › Compliance assessments",
        "click", "TEXT", "L2", ("assessment",), "routers/compliance_assessments_router.py:_generate_detail_recommendations_batch_ai"),
    _uc("assessments.control_recommendations", "Recommend test procedures and evidence for a control",
        "Suggests how to test a control and what evidence proves it.", "Assessments › Controls",
        "click", "LIB", "L0", ("control",), "routers/controls_router.py:get_control_ai_recommendations"),
    _uc("assessments.evidence_advice", "Recommend evidence for an assessment item",
        "Suggests which of your files answer an item and what is still missing.", "Assessments › Compliance assessments",
        "click", "TEXT", "L2", ("assessment", "evidence"), "services/assessment_evidence_ai.py:openai_complete",
        entry=("services/assessment_evidence_ai.py:recommend_evidence",)),
    _uc("assessments.evidence_draft", "Draft a missing evidence document",
        "Drafts a document that would satisfy an item, from the item and the catalogue.", "Assessments › Compliance assessments",
        "background", "TEXT", "L2", ("assessment",), "services/assessment_evidence_ai.py:openai_complete",
        entry=("services/assessment_evidence_ai.py:_draft_complete",)),

    # ── Certification and frameworks ─────────────────────────────────────────
    _uc("certification.journey_phases", "Plan the phases of a certification journey",
        "Proposes the phases to reach a certification.", "Certification › Journeys",
        "click", "LIB", "L0", ("framework",), "routers/certification_router.py:generate_journey_phases"),
    _uc("certification.phase_tasks", "Generate tasks for a phase",
        "Proposes the tasks of one certification phase.", "Certification › Journeys",
        "click", "LIB", "L0", ("framework",), "routers/certification_router.py:generate_phase_tasks"),
    _uc("certification.all_phase_tasks", "Generate tasks for every phase",
        "Proposes the tasks of all phases at once.", "Certification › Journeys",
        "click", "LIB", "L0", ("framework",), "routers/certification_router.py:generate_all_phase_tasks"),
    _uc("certification.critical_controls", "Find the critical controls of a framework",
        "Marks which controls matter most for a certification and why.", "Certification › Journeys",
        "click", "LIB", "L0", ("framework", "control"), "routers/certification_router.py:_classify_controls_batch"),
    _uc("frameworks.enhance_controls", "Enhance imported framework controls",
        "Fills in missing detail on the controls of an imported framework.", "Frameworks › Library",
        "background", "LIB", "L0", ("framework",), "modules/framework_upload/routers/parser.py:_enhance_controls_body"),
    _uc("frameworks.evidence_requirements", "Generate evidence requirements for imported controls",
        "Proposes the evidence each imported control needs.", "Frameworks › Library",
        "background", "LIB", "L0", ("framework",),
        "modules/framework_upload/routers/parser.py:generate_evidence_requirements_for_controls_batch"),
    _uc("frameworks.template_document", "Draft a framework template document",
        "Drafts a section of a framework template from a document.", "Frameworks › Templates",
        "click", "DOC", "L3", ("template", "document"), "modules/framework_templates/routers/ai.py:_chat",
        entry=("modules/framework_templates/routers/ai.py:document_ai",)),
    _uc("frameworks.template_register", "Fill a register template from findings",
        "Drafts register rows from the findings you select.", "Frameworks › Templates",
        "click", "DOC", "L3", ("template", "finding"), "modules/framework_templates/routers/ai.py:_chat",
        entry=("modules/framework_templates/routers/ai.py:register_ai",)),
    _uc("frameworks.batch_parse", "Parse framework documents (developer script)",
        "Extracts a framework's structure and controls from its document; run by a developer, not in the product.",
        "Developer script", "offline", "LIB", "L0", ("framework",),
        "scripts/batch_parse_frameworks.py:extract_document_structure",
        "scripts/batch_parse_frameworks.py:extract_controls_lightweight",
        "scripts/batch_parse_frameworks.py:enhance_controls"),

    # ── Control Library ──────────────────────────────────────────────────────
    _uc("control_library.pair_similarity", "Compare two controls",
        "Rates how alike two controls are.", "Control Library › Mapping",
        "click", "LIB", "L0", ("control",), _CL + "ai_mapping.py:analyze_control_similarity"),
    _uc("control_library.mapping_suggestions", "Suggest control mappings",
        "Proposes which controls of other frameworks match one control.", "Control Library › Mapping",
        "click", "LIB", "L0", ("control",), _CL + "ai_mapping.py:batch_analyze_controls"),
    _uc("control_library.side_by_side", "Compare controls side by side",
        "Explains the differences between controls.", "Control Library › Comparison",
        "click", "LIB", "L0", ("control",), _CL + "comparison.py:get_control_differences"),
    _uc("control_library.analyzed_differences", "Explain differences between equivalent controls",
        "Explains how a control differs from its equivalents.", "Control Library › Comparison",
        "view", "LIB", "L0", ("control",), _CL + "comparison.py:analyze_control_with_equivalents"),
    _uc("control_library.crosswalk_map", "Map a control across frameworks",
        "Finds the best matching controls in another framework.", "Control Library › Crosswalk",
        "click", "LIB", "L0", ("control",), _CL + "comparison.py:ai_map_crosswalk"),
    _uc("control_library.evidence_recommendations", "Recommend evidence for controls",
        "Proposes the evidence an auditor would accept for a control, a group or many at once.",
        "Control Library › Evidence", "click", "LIB", "L0", ("control",),
        _CL + "evidence_recs.py:generate_evidence_recommendations"),
    _uc("control_library.gap_priorities", "Prioritise control gaps",
        "Ranks uncovered or expired controls by what to fix first.", "Control Library › Gap analysis",
        "click", "STRUCT", "L1", ("control",), _CL + "gap_analysis.py:ai_prioritize_gaps"),
    _uc("control_library.group_keywords", "Suggest keywords for a control group",
        "Proposes the keywords of a new control group when it is created with a description and no keywords.",
        "Control Library › Groups", "auto", "TEXT", "L2", ("control",), _CL + "groups.py:generate_keywords_for_group"),
    _uc("control_library.group_summary", "Summarise a control group",
        "Writes a short summary of what a group of controls requires.", "Control Library › Groups",
        "click", "LIB", "L0", ("control",), _CL + "groups.py:generate_group_summary"),
    _uc("control_library.auto_group", "Group controls automatically",
        "Sorts controls into groups of the same requirement.", "Control Library › Groups",
        "background", "LIB", "L0", ("control",), _CL + "groups.py:_ai_group_single_batch"),
    _uc("control_library.consolidate_evidence", "Merge equivalent evidence items",
        "Merges evidence items that mean the same thing when a control's requirements are shown.",
        "Control Library › Controls", "view", "LIB", "L0", ("control",), _CL + "groups.py:_ai_consolidate_evidence"),
    _uc("control_library.recommend_evidence", "Suggest the evidence an auditor would accept",
        "Proposes accepted evidence for one control.", "Control Library › Controls",
        "click", "LIB", "L0", ("control",), _CL + "groups.py:recommend_evidence_for_control"),
    _uc("control_library.draft_document", "Draft a policy or procedure for a control",
        "Drafts a document that would satisfy a control.", "Control Library › Controls",
        "click", "LIB", "L0", ("control",), _CL + "groups.py:draft_document_for_control"),
    _uc("control_library.inheritance", "Analyse control inheritance",
        "Shows which controls satisfy others.", "Control Library › Inheritance",
        "click", "LIB", "L0", ("control",), _CL + "inheritance.py:analyze_inheritance"),
    _uc("control_library.executive_summary", "Write a control coverage summary",
        "Summarises control coverage for a report.", "Control Library › Reports",
        "click", "STRUCT", "L1", ("control",), _CL + "reports.py:generate_executive_summary"),
    _uc("control_library.test_procedures", "Draft test procedures for a work item",
        "Drafts a numbered checklist of test procedures for a control being worked.", "Control Library › Workbench",
        "click", "TEXT", "L2", ("control", "evidence"), _CL + "workbench.py:generate_procedures"),
    _uc("control_library.baseline_build", "Build the master control baseline",
        "Builds the common control baseline from the loaded frameworks.", "Control Library › Baseline",
        "background", "LIB", "L0", ("control",), "modules/control_library/services/baseline_builder.py:_ai_json"),
    _uc("control_library.absorption_verify", "Verify absorbed control joins",
        "Double-checks control joins proposed when a framework is absorbed.", "Control Library › Baseline",
        "background", "LIB", "L0", ("control",), "modules/control_library/services/extend_baseline.py:_verify_joins"),
    _uc("control_library.normalization", "Normalise the control library",
        "Clusters, labels and merges the library's controls into one consistent set.", "Control Library › Baseline",
        "background", "LIB", "L0", ("control",),
        "modules/control_library/services/normalization.py:_ai_cluster_batch",
        "modules/control_library/services/normalization.py:_ai_merge_partials",
        "modules/control_library/services/normalization.py:_ai_tag_controls",
        "modules/control_library/services/normalization.py:_build_taxonomy",
        "modules/control_library/services/normalization.py:_classify_to_taxonomy",
        "modules/control_library/services/normalization.py:_consolidate_labels",
        "modules/control_library/services/normalization.py:_merge_fragments._verify_pairs",
        "modules/control_library/services/normalization.py:_refine_candidate_batch",
        "modules/control_library/services/normalization.py:_verify_clusters"),
    _uc("control_library.compare_frameworks", "Compare frameworks",
        "Compares two frameworks control by control as a background job.", "Control Library › Comparison",
        "background", "LIB", "L0", ("control", "framework"), "tasks/control_library.py:_call_llm"),

    # ── Governance ───────────────────────────────────────────────────────────
    _uc("governance.statement_extraction", "Extract policy statements from a document",
        "Splits a policy into its individual statements so they can be mapped to controls.", "Governance › Documents",
        "auto", "DOC", "L3", ("document",), _G + "policy_parser.py:parse_policy_statements_with_openai"),
    _uc("governance.vision_ocr", "Read scanned pages with AI vision",
        "A scanned document or image is read on our own servers. If no text can be read there, the picture is not sent to an outside AI: it is refused.", "Governance › Documents",
        "auto", "VISION", "L4", ("upload",), _G + "policy_parser.py:_vision_transcribe_png", modality="vision"),
    _uc("governance.statement_mapping", "Map policy statements to controls",
        "Proposes which controls each statement of a document satisfies.", "Governance › Documents",
        "auto", "TEXT", "L2", ("document", "control"), "modules/governance/statement_auto_map.py:_ai_match", cache=168),
    _uc("governance.gap_analysis", "Analyse a document against a framework",
        "Checks a document clause by clause against a framework and lists the gaps.", "Governance › Documents",
        "background", "DOC", "L3", ("document", "framework"), _G + "gap_analysis.py:analyze_clauses_batch"),
    _uc("governance.gap_fix", "Draft a fix for a gap",
        "Drafts the wording that closes one gap in a document.", "Governance › Documents",
        "click", "DOC", "L3", ("document",), _G + "gap_analysis.py:_generate_clause_fix"),
    _uc("governance.ai_drafting", "Draft a policy with AI",
        "Drafts a complete policy from a title and brief, using your organisation's profile.", "Governance › Documents",
        "background", "DOC", "L3", ("document", "committee"), "modules/governance/ai_drafting/pipeline.py:_call_chat_json_once"),
    _uc("governance.compare_documents", "Compare two documents",
        "Compares two of your documents side by side.", "Governance › Documents",
        "click", "DOC", "L3", ("document",), _G + "documents.py:compare_with_document"),
    _uc("governance.suggest_policies", "Suggest policies for a framework",
        "Suggests which policies, procedures and standards a framework calls for, leaving out what you already have.",
        "Governance › Documents", "click", "TEXT", "L2", ("framework", "document"),
        _G + "documents.py:suggest_policies_for_framework", _G + "documents.py:_semantic_dedup_against_existing"),
    _uc("governance.committee_action_summary", "Summarise a committee action",
        "Writes a short summary of an action from a committee meeting.", "Governance › Committees",
        "click", "DOC", "L3", ("committee",), _G + "committees.py:generate_action_ai_text",
        entry=(_G + "committees.py:ai_generate_action_summary",)),
    _uc("governance.committee_action_reword", "Reword a committee action",
        "Rewrites an action's text more clearly.", "Governance › Committees",
        "click", "DOC", "L3", ("committee",), _G + "committees.py:generate_action_ai_text",
        entry=(_G + "committees.py:ai_reword_action_text",)),
    _uc("governance.charter_generate", "Draft a committee charter",
        "Drafts a charter from the committee's purpose and frameworks.", "Governance › Committees",
        "click", "TEXT", "L2", ("committee", "control"), _G + "committees.py:ai_generate_charter"),
    _uc("governance.charter_compare", "Compare a charter with the standard",
        "Checks a charter against a reference and lists the differences.", "Governance › Committees",
        "click", "DOC", "L3", ("committee",), _G + "committees.py:ai_compare_charter"),
    _uc("governance.agenda_parse", "Read a meeting agenda from a file",
        "Turns an uploaded agenda into agenda items.", "Governance › Committees",
        "click", "DOC", "L3", ("committee", "upload"), "services/agenda_parser.py:_ai_extract_chunk"),
    _uc("governance.exception_content", "Draft a policy exception",
        "Drafts the justification and conditions of a policy exception.", "Governance › Policy Exceptions",
        "click", "DOC", "L3", ("document",), "routers/policy_exception_router.py:_generate_exception_suggestion"),
    _uc("governance.exception_candidates", "Suggest policy exceptions",
        "Suggests where an exception to a policy may be needed.", "Governance › Policy Exceptions",
        "view", "DOC", "L3", ("document",), "routers/policy_exception_router.py:_generate_candidate_exceptions"),
    _uc("governance.template_document", "Create a document from a template",
        "Adapts a template into a new document.", "Governance › Documents",
        "click", "TEXT", "L2", ("template", "document"), "routers/nca_templates_router.py:create_document_from_template"),
    _uc("governance.template_compare", "Compare a document with a template",
        "Shows how your document differs from a template.", "Governance › Documents",
        "click", "DOC", "L3", ("template", "document"), "routers/nca_templates_router.py:compare_with_document"),

    # the AI Studio: all three reach the model through the guarded client, which a shared helper names by use case
    _uc("governance.studio_chat", "Draft or edit a document in the studio",
        "Writes or revises a document from your instructions and references, as changes you review.",
        "Governance › Documents › AI Studio", "click", "DOC", "L3", ("document", "framework", "upload", "template"),
        "services/ai_gateway/claude_client.py:_stream_final", entry=("modules/governance/studio/engine.py:run_chat_turn",),
        apis=("anthropic",)),
    _uc("governance.studio_draft", "Write a whole document in the studio",
        "Asks what a new policy, standard, procedure, guideline or charter must cover and follow, then plans it and writes it section by section "
        "from your answers, instructions and references.",
        "Governance › Documents › AI Studio", "click", "DOC", "L3", ("document", "framework", "upload", "template"),
        "services/ai_gateway/claude_client.py:_stream_final",
        entry=("modules/governance/studio/drafting.py:run_draft", "modules/governance/studio/drafting.py:run_scoping"),
        apis=("anthropic",)),
    _uc("governance.studio_research", "Look up the rules a new document must follow",
        "Searches the internet for the laws, regulations and standards that apply to a new document's subject in your sector and country, "
        "so you can choose them before it is written.",
        "Governance › Documents › AI Studio", "click", "DOC", "L3", ("document",),
        "services/ai_gateway/claude_client.py:_stream_final", entry=("modules/governance/studio/drafting.py:run_scoping",),
        apis=("anthropic",)),
    _uc("governance.studio_checks", "Check a document's language and requirements",
        "Finds spelling, grammar and wording problems and checks your requirements against the document.",
        "Governance › Documents › AI Studio", "click", "DOC", "L3", ("document",),
        "services/ai_gateway/claude_client.py:_stream_final", entry=("modules/governance/studio/engine.py:run_ai_checks",),
        apis=("anthropic",)),
    _uc("governance.studio_compare", "Compare two documents in the studio",
        "Explains how two documents differ and which differences matter.",
        "Governance › Documents › AI Studio", "click", "DOC", "L3", ("document",),
        "services/ai_gateway/claude_client.py:_stream_final", entry=("modules/governance/studio/engine.py:run_ai_compare",),
        apis=("anthropic",)),
    _uc("governance.version_change", "Decide whether a new version is major or minor",
        "Reads what changed in a document and says whether its new version is a major or a minor change, and why.",
        "Governance › Documents", "auto", "DOC", "L3", ("document",),
        "services/ai_gateway/claude_client.py:_stream_final", entry=("modules/governance/doc_version.py:decide",),
        apis=("anthropic",)),
    _uc("governance.document_details", "Fill in a document's details from its file",
        "Reads the opening of a document you upload and proposes the title, type and description its file does not state; nothing is saved until you confirm.",
        "Governance › Documents", "auto", "DOC", "L3", ("document", "upload"),
        "services/ai_gateway/claude_client.py:_stream_final", entry=("modules/governance/doc_details.py:_ask_ai",),
        apis=("anthropic",)),

    # ── Regulatory Changes ───────────────────────────────────────────────────
    _uc("regulatory.read_circular", "Read a regulatory circular",
        "Finds the circular's identity and lists its obligations.", "Compliance Management › Regulatory Changes",
        "auto", "LIB", "L0", ("regulation",), "modules/governance/regulatory_engine.py:llm_json",
        entry=("modules/governance/regulatory_engine.py:_about", "modules/governance/regulatory_engine.py:_obligations_in"),
        apis=("responses",)),
    _uc("regulatory.impact_analysis", "Assess a circular's impact on your organisation",
        "Relates a circular to your policies, controls, audit observations and departments.",
        "Compliance Management › Regulatory Changes", "auto", "TEXT", "L2",
        ("regulation", "document", "control", "finding"), "modules/governance/regulatory_engine.py:llm_json",
        entry=("modules/governance/regulatory_engine.py:analyse",), apis=("responses",)),
    _uc("regulatory.link_controls", "Link obligations to your controls",
        "Proposes which of your controls meet each obligation.", "Compliance Management › Regulatory Changes",
        "auto", "TEXT", "L2", ("regulation", "control"), "modules/governance/regulatory_engine.py:llm_json",
        entry=("modules/governance/regulatory_links.py:_own_control_links",), apis=("responses",)),
    _uc("regulatory.feed_analysis", "Analyse a regulatory feed item",
        "Assesses what a published item means for your policies and controls.", "Compliance Management › Regulatory Feeds",
        "click", "TEXT", "L2", ("regulation", "document", "control"), _G + "regulatory_feeds.py:analyze_regulatory_item"),

    # ── Evidence ─────────────────────────────────────────────────────────────
    _uc("evidence.rate_maturity", "Rate an evidence file",
        "Scores how well a file proves a requirement and what is missing.", "Evidence Management",
        "auto", "DOC", "L3", ("evidence",), "modules/evidence/routers/ai_assessment.py:_chat_json",
        entry=("modules/evidence/routers/ai_assessment.py:_rate",)),
    _uc("evidence.match_clauses", "Match evidence to requirements",
        "Finds which framework requirements a file helps satisfy.", "Evidence Management",
        "auto", "DOC", "L3", ("evidence", "control"), "modules/evidence/routers/ai_assessment.py:_chat_json",
        entry=("modules/evidence/routers/ai_assessment.py:_match",)),
    _uc("evidence.quality_check", "Check evidence against a requirement",
        "Checks whether a file satisfies one requirement and quotes what it saw.", "Evidence Management",
        "auto", "DOC", "L3", ("evidence",), "services/assessment_evidence_ai.py:openai_complete",
        entry=("services/evidence_quality.py:check",)),
    _uc("evidence.quick_assess", "Quick assessment from a file's details",
        "Gives a first view of a file from its name, type and description before it is read.", "Evidence Management",
        "click", "TEXT", "L2", ("evidence",), "modules/evidence/routers/ai_assessment.py:quick_assess_evidence"),
    _uc("evidence.link_picker", "Suggest what a file should link to",
        "Suggests the controls, risks, assets and documents a file belongs to.", "Evidence Management",
        "click", "DOC", "L3", ("evidence", "control", "risk", "asset", "document"),
        "modules/evidence/routers/ai_assessment.py:_ai_select_targets", cache=24),
    _uc("evidence.vision_ocr", "Read scanned evidence with AI vision",
        "A scanned PDF or image is read on our own servers. If no text can be read there, the picture is not sent to an outside AI: it is refused.", "Evidence Management",
        "auto", "VISION", "L4", ("evidence", "upload"), "modules/evidence/routers/ocr.py:extract_text_with_vision",
        modality="vision"),

    # ── Third-Party Risk ─────────────────────────────────────────────────────
    _uc("third_party.score_assessment", "Score a vendor questionnaire",
        "Scores a vendor's answers and lists findings and recommendations.", "Third-Party Risk › Assessments",
        "click", "DOC", "L3", ("vendor",), "modules/vendor_risk/routers/ai_analysis.py:ai_score_assessment"),
    _uc("third_party.risk_summary", "Summarise a vendor's risk",
        "Writes a narrative of a vendor's overall risk position.", "Third-Party Risk › Suppliers",
        "click", "TEXT", "L2", ("vendor",), "modules/vendor_risk/routers/ai_analysis.py:ai_vendor_risk_summary"),
    _uc("third_party.gap_analysis", "Find gaps in a vendor's answers",
        "Lists where a vendor's answers fall short.", "Third-Party Risk › Assessments",
        "click", "DOC", "L3", ("vendor",), "modules/vendor_risk/routers/ai_analysis.py:_run_ai_json",
        entry=("modules/vendor_risk/routers/ai_analysis.py:ai_gap_analysis",)),
    _uc("third_party.recommend_tier", "Recommend a vendor tier",
        "Recommends how critical a vendor is.", "Third-Party Risk › Suppliers",
        "click", "TEXT", "L2", ("vendor",), "modules/vendor_risk/routers/ai_analysis.py:_run_ai_json",
        entry=("modules/vendor_risk/routers/ai_analysis.py:ai_recommend_tier",)),
    _uc("third_party.remediation_plan", "Draft a vendor remediation plan",
        "Drafts the actions a vendor should take.", "Third-Party Risk › Assessments",
        "click", "TEXT", "L2", ("vendor",), "modules/vendor_risk/routers/ai_analysis.py:_run_ai_json",
        entry=("modules/vendor_risk/routers/ai_analysis.py:ai_remediation_plan",)),
    _uc("third_party.contract_terms", "Read a vendor contract",
        "Reads an uploaded contract and extracts its terms.", "Third-Party Risk › Contracts",
        "click", "DOC", "L3", ("vendor", "upload"), "services/assessment_evidence_ai.py:openai_complete",
        entry=("modules/vendor_risk/tpra/contracts.py:ai_terms",)),
    _uc("third_party.vendor_narrative", "Write a vendor summary",
        "Writes a plain-language summary of a vendor's profile and findings.", "Third-Party Risk › Suppliers",
        "click", "DOC", "L3", ("vendor",), "services/assessment_evidence_ai.py:openai_complete",
        entry=("modules/vendor_risk/tpra/summary.py:write_narrative",)),
    _uc("third_party.fair_writeup", "Write a FAIR analysis",
        "Writes up a vendor's quantified risk analysis.", "Third-Party Risk › Suppliers",
        "click", "DOC", "L3", ("vendor", "upload"), "services/assessment_evidence_ai.py:openai_complete",
        entry=("modules/vendor_risk/tpra/fair.py:write_up",)),
    _uc("third_party.alert_research", "Research a vendor alert",
        "Looks into a vendor alert and summarises what it means.", "Third-Party Risk › Monitoring",
        "click", "DOC", "L3", ("vendor",), "services/assessment_evidence_ai.py:openai_complete",
        entry=("modules/vendor_risk/tpra/alerts.py:research",)),

    # ── Audit ────────────────────────────────────────────────────────────────
    _uc("audit.statutory_observations", "Draft observations from an audit file",
        "Reads an uploaded audit file and proposes observations; nothing is saved until you accept.",
        "Auditor Portal › Statutory Audit", "click", "DOC", "L3", ("upload", "finding"),
        "modules/auditor_portal/routers/statutory_audit.py:upload_parse_observations"),
    _uc("audit.register_assist", "Draft audit-register fields",
        "Drafts fields of an audit-register finding from your text.", "Issue Management › Audit Register",
        "click", "TEXT", "L3", ("finding", "user"), "modules/issue_management/audit_register/assist.py:openai_complete"),
    _uc("audit.register_risk_suggestions", "Suggest risks for a finding",
        "Suggests which risks a finding belongs to.", "Issue Management › Audit Register",
        "view", "TEXT", "L3", ("finding", "risk"), "modules/issue_management/audit_register/suggestions.py:_judge_risks"),

    # ── Access Reviews ───────────────────────────────────────────────────────
    _uc("access_review.recommendations", "Recommend access decisions",
        "Recommends approve, revoke or exception, with a reason, for each sampled user.", "Access Reviews",
        "click", "PEOPLE", "L1", ("user",), "routers/access_review_router.py:ai_recommendations"),
    _uc("access_review.summary", "Write a review summary",
        "Writes a short auditor-facing narrative of an access-review campaign.", "Access Reviews",
        "click", "STRUCT", "L1", ("user",), "routers/access_review_router.py:ai_summary"),

    # ── Workflow Engine ──────────────────────────────────────────────────────
    _uc("workflow.natural_language", "Build a workflow from a description",
        "Turns a sentence into a workflow definition.", "Workflow Engine",
        "click", "PEOPLE", "L2", ("workflow", "user"), "modules/workflow_engine/routers/ai.py:ai_natural_language_to_workflow"),
    _uc("workflow.suggestions", "Suggest workflows",
        "Suggests workflows worth automating.", "Workflow Engine",
        "view", "STRUCT", "L1", ("workflow",), "modules/workflow_engine/routers/ai.py:ai_workflow_suggestions", cache=24),
    _uc("workflow.optimize", "Optimise a workflow",
        "Suggests improvements to an existing workflow.", "Workflow Engine",
        "click", "STRUCT", "L1", ("workflow",), "modules/workflow_engine/routers/ai.py:ai_optimize_workflow"),

    # ── ComplyChat ───────────────────────────────────────────────────────────
    _uc("complychat.sql_generate", "Turn a question into a data query",
        "Writes the database query that answers a question about your GRC data.", "ComplyChat",
        "click", "CHAT", "L2", ("chat",), "modules/chatbot/complychat/complychat/grc_sql_agent.py:generate_sql_query"),
    _uc("complychat.format_results", "Format query results",
        "Turns the rows returned by a query into a written answer.", "ComplyChat",
        "click", "CHAT", "L4", ("chat",), "modules/chatbot/complychat/complychat/grc_sql_agent.py:format_query_results"),
    _uc("complychat.answer", "Answer a GRC question",
        "Answers a question using your documents and general GRC knowledge.", "ComplyChat",
        "click", "CHAT", "L3", ("chat", "document"), "modules/chatbot/router.py:answer_grc_knowledge_question"),
    _uc("complychat.analyze_uploads", "Analyse files attached to a chat",
        "Reads the files you attach to a question and answers about them.", "ComplyChat",
        "click", "CHAT", "L3", ("chat", "upload"), "modules/chatbot/router.py:analyze_uploaded_files_with_llm"),
    _uc("complychat.embeddings", "Index documents for chat search",
        "Prepares your documents and questions for semantic search.", "ComplyChat",
        "click", "CHAT", "L3", ("document", "chat"), "modules/chatbot/qdrant_service.py:QdrantComplyChatService.embed_texts",
        modality="embedding", apis=("embeddings",)),

    # ── Task Management ──────────────────────────────────────────────────────
    _uc("tasks.prioritize", "Prioritise open tasks", "Ranks open tasks by what to do first.", "Task Management",
        "click", "STRUCT", "L1", ("task",), "routers/critical_tasks_router.py:ai_prioritize_tasks"),
    _uc("tasks.root_cause", "Analyse a task's root cause", "Looks for the cause behind a task from its description and comments.",
        "Task Management", "click", "TEXT", "L3", ("task",), "routers/critical_tasks_router.py:ai_analyze_root_cause"),
    _uc("tasks.generate_description", "Write a task description", "Drafts a description for a task from its title.",
        "Task Management", "click", "TEXT", "L2", ("task",), "routers/critical_tasks_router.py:ai_generate_description"),
    _uc("tasks.predict_escalations", "Predict task escalations", "Points out tasks likely to need escalation.",
        "Task Management", "click", "STRUCT", "L1", ("task",), "routers/critical_tasks_router.py:ai_predict_escalations"),
    _uc("tasks.balance_workload", "Balance workload", "Suggests how to spread tasks across owners.",
        "Task Management", "click", "PEOPLE", "L2", ("task", "user"), "routers/critical_tasks_router.py:ai_balance_workload"),

    # ── IS Projects ──────────────────────────────────────────────────────────
    _uc("projects.generate_plan", "Generate a project plan", "Drafts milestones and tasks for a project.", "IS Projects",
        "click", "TEXT", "L2", ("project",), "routers/is_projects_router.py:ai_generate_plan"),
    _uc("projects.assess_risks", "Assess project risks", "Lists the risks of a project and how to treat them.", "IS Projects",
        "click", "TEXT", "L2", ("project", "risk"), "routers/is_projects_router.py:ai_assess_risks"),
    _uc("projects.status_report", "Draft a status report", "Drafts a status report from a project's current state.", "IS Projects",
        "click", "TEXT", "L2", ("project",), "routers/is_projects_router.py:ai_draft_status_report"),
    _uc("projects.suggest_team", "Suggest a project team", "Suggests who should be on a project and in which role.",
        "IS Projects", "click", "PEOPLE", "L2", ("project", "user"), "routers/is_projects_router.py:ai_suggest_team"),
    _uc("projects.estimate_budget", "Estimate a project budget", "Estimates a budget range from the project's scope.",
        "IS Projects", "click", "TEXT", "L2", ("project",), "routers/is_projects_router.py:ai_estimate_budget"),

    # ── Dashboard ────────────────────────────────────────────────────────────
    _uc("dashboard.ai_insights", "Dashboard insights",
        "Short observations on compliance posture, shown on the home dashboard.", "Dashboard",
        "auto", "STRUCT", "L1", ("framework", "evidence", "risk", "rcsa"), "routers/dashboard_router.py:get_ai_insights", cache=1),

    # ── Asset Management ─────────────────────────────────────────────────────
    _uc("assets.discovery_explain", "Explain a discovered device",
        "Explains in plain language what a discovered device probably is.", "Asset Management › Discovery",
        "view", "STRUCT", "L1", ("asset",), "modules/asset_discovery/services/explainer.py:_ai_rephrase", cache=24),
    _uc("assets.import_mapping", "Map import columns to asset fields",
        "Proposes which asset field each column of an uploaded file belongs to.", "Asset Management › Import",
        "click", "TEXT", "L2", ("upload", "asset"), "modules/asset_import/ai_assist.py:ai_suggest_mapping"),
    _uc("assets.layout_plan", "Choose the layout of an asset page",
        "Chooses which sections an asset page shows for its type; the result is cached.", "Asset Management › Asset page",
        "view", "STRUCT", "L1", ("asset",), "services/asset_layout_ai.py:_call_model"),

    # ── Vulnerability Management ─────────────────────────────────────────────
    _uc("vulnerabilities.analyze_report", "Analyse a scan report",
        "Summarises a scan report and what to fix first.", "Vulnerability Management",
        "click", "TEXT", "L2", ("vulnerability", "scan"), "modules/vuln_management/routers/ai_analysis.py:analyze_report"),
    _uc("vulnerabilities.suggest_fix", "Suggest a fix for a vulnerability",
        "Proposes how to remediate one vulnerability.", "Vulnerability Management",
        "click", "TEXT", "L2", ("vulnerability", "asset"), "modules/vuln_management/routers/ai_analysis.py:suggest_fix"),
    _uc("vulnerabilities.attack_narrative", "Narrate an attack path",
        "Explains how a vulnerability could be exploited on a given asset.", "Vulnerability Management",
        "view", "STRUCT", "L1", ("vulnerability", "asset"), "modules/vuln_management/attack/narrative.py:_call_model"),
    _uc("vulnerabilities.control_proposals", "Propose controls for findings",
        "Maps scanner findings to the controls that address them.", "Vulnerability Management",
        "background", "TEXT", "L2", ("vulnerability", "control"), "services/ai_control_mapping.py:_chat", cache=720),

    # ── Controls Automation ──────────────────────────────────────────────────
    _uc("controls_automation.benchmark_select", "Choose benchmarks for an operating system",
        "Chooses which hardening benchmarks apply to an operating system.", "Controls Automation › Benchmarks",
        "click", "STRUCT", "L1", ("asset",), "modules/compliance_plugins/services/ai_benchmark_router.py:_ask_llm"),
    _uc("controls_automation.benchmark_classify", "Classify a benchmark by operating system",
        "Works out which operating systems a benchmark targets.", "Controls Automation › Benchmarks",
        "click", "STRUCT", "L1", ("asset",), "modules/compliance_plugins/services/ai_benchmark_router.py:classify_benchmark_with_ai"),
    _uc("controls_automation.mapping_suggest", "Suggest benchmark mappings",
        "Proposes which benchmarks map to which operating systems.", "Controls Automation › Benchmarks",
        "view", "STRUCT", "L1", ("asset",), "modules/compliance_plugins/services/ai_mapping_suggester.py:_call_openai_for_mapping"),
    _uc("controls_automation.mapping_suggest_asset", "Suggest a benchmark for an asset",
        "Proposes a benchmark for an asset whose operating system has no mapping yet.", "Controls Automation › Benchmarks",
        "view", "STRUCT", "L1", ("asset",), "modules/compliance_plugins/services/ai_mapping_suggester.py:suggest_for_unmapped_os"),
    _uc("controls_automation.normalise_os", "Normalise an operating-system name",
        "Maps a free-text operating-system string to a standard name.", "Controls Automation › Benchmarks",
        "click", "STRUCT", "L1", ("asset",), "modules/compliance_plugins/services/ai_os_normaliser.py:normalise_os_string"),

    # ── Integrations ─────────────────────────────────────────────────────────
    _uc("integrations.control_mapping", "Map a vulnerability to controls",
        "Proposes which controls address a scanner finding.", "Integrations › Vulnerability scanners",
        "click", "TEXT", "L2", ("vulnerability", "control"),
        "modules/integrations/services/control_mapping_service.py:ControlMappingService.ai_based_mapping"),

    # ── Penetration Testing (the engine is a separate process that calls the provider over raw HTTP) ──────────────
    _uc("pentest.choose_tools", "Choose tools for a target",
        "Chooses which tools to run against a target.", "Penetration Testing",
        "click", "RAW", "L2", ("scan",), "ava-pentest-engine/ava_pentest/llm.py:choose_mcps", apis=("http",)),
    _uc("pentest.choose_exploit", "Choose an exploit for a finding",
        "Chooses which exploit to try for a finding.", "Penetration Testing",
        "click", "RAW", "L2", ("scan",), "ava-pentest-engine/ava_pentest/llm.py:choose_exploit", apis=("http",)),
    _uc("pentest.assign_tool", "Assign a tool to an exploit",
        "Chooses the tool that runs an exploit.", "Penetration Testing",
        "click", "RAW", "L2", ("scan",), "ava-pentest-engine/ava_pentest/llm.py:assign_exploit_tool", apis=("http",)),
    _uc("pentest.verify_exploit", "Verify an exploit result",
        "Reads the raw output of a command run against a live target and judges whether the exploit worked.",
        "Penetration Testing", "click", "RAW", "L4", ("scan",),
        "ava-pentest-engine/ava_pentest/llm.py:verify_exploit", apis=("http",)),
    _uc("pentest.classify_findings", "Classify exploitability of findings",
        "Sorts findings by how exploitable they are, after a scan.", "Penetration Testing",
        "auto", "RAW", "L2", ("scan",),
        "ava-pentest-engine/ava_pentest/llm.py:classify_exploitability",
        "ava-pentest-engine/ava_pentest/llm.py:_classify_batch_chunk", apis=("http",)),
    _uc("pentest.plan", "Plan a test", "Plans the steps of a penetration test.", "Penetration Testing",
        "click", "RAW", "L2", ("scan",), "ava-pentest-engine/ava_pentest/llm.py:plan_with_gpt", apis=("http",)),
)

# Which model class a use case needs (services/ai_gateway/tiers.py maps a class to a model with AI_MODEL_LIGHT / AI_MODEL_DEEP;
# a class with no model set keeps the model the call asked for). Everything not listed is "standard".
#   light  short, structured or wording work whose answer a person reads and edits: a name, a pick from a list, a sentence
#   deep   long documents judged where a wrong answer costs most: regulation, contracts, audit findings, framework gaps
TIERS = ("light", "standard", "deep")
_TIER: Dict[str, str] = {
    **dict.fromkeys((
        "administration.audit_log_summary", "erm.internal_control_category", "erm.rcsa_explain_row",
        "governance.committee_action_summary", "governance.committee_action_reword", "complychat.format_results",
        "tasks.generate_description", "evidence.link_picker", "assets.import_mapping", "assets.layout_plan",
        "assets.discovery_explain", "controls_automation.benchmark_select", "controls_automation.benchmark_classify",
        "controls_automation.normalise_os", "control_library.group_keywords", "control_library.group_summary",
        "workflow.suggestions", "dashboard.ai_insights"), "light"),
    **dict.fromkeys((
        "regulatory.impact_analysis", "regulatory.link_controls", "governance.gap_analysis", "evidence.match_clauses",
        "third_party.contract_terms", "audit.statutory_observations", "complychat.sql_generate"), "deep"),
}

_BY_ID: Dict[str, UseCase] = {u.id: u for u in USE_CASES}
_BY_SITE: Dict[Tuple[str, str], List[UseCase]] = {}
for _u in USE_CASES:
    for _cs in _u.callsites:
        _path, _, _qual = _cs.partition(":")
        _BY_SITE.setdefault((_path, _qual.rsplit(".", 1)[-1]), []).append(_u)


def get(use_case_id: str) -> Optional[UseCase]:
    return _BY_ID.get(use_case_id)


def match_event(callsite: str, feature: str) -> List[UseCase]:
    """Use cases for a ledger event: by the function the event names, else by the line it was recorded at, else by the
    file (code moves, and an explicit feature key need not be a function name; a file with one use case is unambiguous)."""
    path, _, line = (callsite or "").partition(":")
    hits = [u for (p, fn), ucs in _BY_SITE.items() if p == path and fn.strip("_") == (feature or "") for u in ucs]
    if not hits and line.isdigit():
        from . import callsites
        function = callsites.enclosing_function(path, int(line))
        if function:
            hits = lookup(path, function.rsplit(".", 1)[-1])
    if not hits:
        hits = [u for (p, _fn), ucs in _BY_SITE.items() if p == path for u in ucs]
    return list({u.id: u for u in hits}.values())


def lookup(path: str, function: str) -> List[UseCase]:
    """Use cases whose call is made in ``function`` (its own name, as the interpreter reports it) of ``path``
    (relative to backend/grc). Several when the function is a shared helper."""
    return list(_BY_SITE.get((path, function), []))


def module_label(module: str) -> str:
    return MODULES.get(module, module)
