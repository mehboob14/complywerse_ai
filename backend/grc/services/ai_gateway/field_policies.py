"""What a record may show an AI, column by column: the minimisation half of the data-protection guard.

The guard in the OpenAI shim cleans whatever a prompt contains. This module decides what a module *puts* in a prompt in
the first place. Every column of the record types below carries one code, and a use case lists the columns it needs;
``ai_view(record, use_case)`` returns only those, transformed by their code, so an owner, an internal id, a serial
number, a scanner's raw output or a tenant-defined field cannot reach a prompt just by being on the record.

Codes
  A  allow          scores, enums, flags, counts, public ids (CVE, CPE, advisories); strings and lists are capped
  K  row key        an opaque row id: only for a use case whose answer must point back at the record
  Y  calendar day   a deadline or a public date (due date, NVD publication): the answer may need a real date
  R  relative date  "in 12 days" / "140 days ago": a date of something that happened to the organisation
  B  band           money as an order of magnitude ("100k-1M")
  T  text           free text, capped; the guard replaces the names, hosts and addresses inside it
  P  person         an alias (P1, P2...) the call can map back; never a display name
  G  generalise     reduced to a class (an IP address -> internal / public, a purchase date -> its year)
  S  suppress       never sent
  D  JSON, deny     tenant-defined or nested structures: never sent whole

Anything not classified is not sent: ``tests/test_ai_field_policies.py`` fails when a column of these tables has no
code, so adding a column forces a decision.
"""
from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

CODES = {"A": "allow", "K": "row key", "Y": "calendar day", "R": "relative date", "B": "band", "T": "text",
         "P": "person alias", "G": "generalise", "S": "suppress", "D": "JSON, deny"}
NEVER_SENT = frozenset({"S", "D"})
TEXT_CAP = 2000          # characters of one free-text column unless the use case says otherwise
PUBLIC_CAP = 300         # characters of one string in a column that is public by nature
LIST_CAP = 20            # items of a list in such a column


# ── transformations ─────────────────────────────────────────────────────────────────────────────────────────────
def _as_date(value: Any) -> Optional[date]:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.strip().replace("Z", "+00:00")).date()
        except ValueError:
            return None
    return None


def relative(value: Any, now: Optional[datetime] = None) -> Optional[str]:
    """'today', 'in 12 days', '140 days ago': the offset from today, never the date itself."""
    d = _as_date(value)
    if d is None:
        return None
    n = (d - (now or datetime.utcnow()).date()).days
    if n == 0:
        return "today"
    unit = "day" if abs(n) == 1 else "days"
    return f"in {n} {unit}" if n > 0 else f"{-n} {unit} ago"


def day(value: Any) -> Optional[str]:
    d = _as_date(value)
    return d.isoformat() if d else None


_BANDS = ((1e3, "under 1k"), (1e4, "1k-10k"), (1e5, "10k-100k"), (1e6, "100k-1M"), (1e7, "1M-10M"), (1e8, "10M-100M"))


def band(value: Any) -> Optional[str]:
    try:
        n = abs(float(value))
    except (TypeError, ValueError):
        return None
    return next((label for limit, label in _BANDS if n < limit), "over 100M")


def ip_class(value: Any) -> Any:
    """'internal' (private, loopback, link-local) or 'public'; a list of addresses becomes the sorted classes in it."""
    if isinstance(value, (list, tuple)):
        return sorted({c for c in (ip_class(v) for v in value) if c}) or None
    try:
        ip = ipaddress.ip_address(str(value).split("/")[0].strip())
    except ValueError:
        return None
    return "internal" if (ip.is_private or ip.is_loopback or ip.is_link_local) else "public"


def _year(value: Any) -> Optional[int]:
    d = _as_date(value)
    return d.year if d else None


GENERALISE: Dict[str, Callable[[Any], Any]] = {"ip_address": ip_class, "known_ips": ip_class, "purchase_date": _year}


def text(value: Any, cap: int = TEXT_CAP) -> Any:
    if value is None:
        return None
    if isinstance(value, str):
        value = value.strip()
        return (value[:cap].rstrip() + "...") if len(value) > cap else (value or None)
    if isinstance(value, (list, tuple)):
        return [t for t in (text(v, cap) for v in list(value)[:LIST_CAP]) if t] or None
    return None


def _public(value: Any, depth: int = 0) -> Any:
    """A column that is public by nature (scores, ids, advisories, references): its structure is kept, its strings capped."""
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value[:PUBLIC_CAP]
    if isinstance(value, (datetime, date)):
        return day(value)
    if depth >= 3:
        return None
    if isinstance(value, (list, tuple)):
        return [_public(v, depth + 1) for v in list(value)[:LIST_CAP]]
    if isinstance(value, dict):
        return {str(k)[:60]: _public(v, depth + 1) for k, v in list(value.items())[:LIST_CAP]}
    return None


class AliasBook:
    """Aliases (P1, P2...) for the people in one call, and the way back. Keys are user ids or, for a name typed into
    a record, the name itself (compared without case)."""

    def __init__(self, prefix: str = "P"):
        self.prefix = prefix
        self._alias: Dict[Any, str] = {}
        self._key: Dict[str, Any] = {}

    @staticmethod
    def _norm(key: Any) -> Any:
        return key.casefold().strip() if isinstance(key, str) else key

    def alias(self, key: Any) -> Optional[str]:
        if key is None or key == "":
            return None
        norm = self._norm(key)
        if norm not in self._alias:
            alias = f"{self.prefix}{len(self._alias) + 1}"
            self._alias[norm], self._key[alias] = alias, key
        return self._alias[norm]

    def key(self, alias: Any) -> Any:
        """The user id (or name) behind an alias the model wrote; None when it is not one of ours."""
        return self._key.get(str(alias).strip().upper())

    def restore(self, obj: Any, show: Callable[[Any], str]) -> Any:
        """``obj`` (parsed JSON) with every alias in its strings replaced by ``show(key)``."""
        if not self._key:
            return obj
        pattern = re.compile(r"\b" + re.escape(self.prefix) + r"\d+\b")

        def fix(value: Any) -> Any:
            if isinstance(value, str):
                return pattern.sub(lambda m: str(show(self._key[m.group(0)])) if m.group(0) in self._key else m.group(0), value)
            if isinstance(value, list):
                return [fix(v) for v in value]
            if isinstance(value, dict):
                return {fix(k) if isinstance(k, str) else k: fix(v) for k, v in value.items()}
            return value
        return fix(obj)


# ── the policies ────────────────────────────────────────────────────────────────────────────────────────────────
def _codes(table: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for line in table.strip().splitlines():
        code, *columns = line.split()
        for column in columns:
            if column in out:
                raise ValueError(f"column {column} is classified twice")
            out[column] = code
    return out


@dataclass(frozen=True)
class Policy:
    model: str                                  # the SQLAlchemy class name
    columns: Dict[str, str]                     # column -> code
    uses: Dict[str, Tuple[str, ...]]            # use-case id -> the columns it may carry ("column" or "column:cap")


def _spec(spec: str) -> Tuple[str, Optional[int]]:
    column, _, cap = spec.partition(":")
    return column, int(cap) if cap else None


_RISK = _codes("""
K id
A category risk_category risk_sub_category register_type inherent_likelihood inherent_impact inherent_score residual_likelihood residual_impact residual_score risk_appetite status priority closure_status source_type is_material
R due_date review_date closed_at created_at updated_at
T title description treatment_plan root_cause consequences recommendations closure_notes scenario_actor scenario_method scenario_statement source_reference
D ubl_fields template_fields custom_values scenario_effect
S tenant_id business_unit_id owner_id business_owner_id affected_department_ids closed_by source_assessment_id source_incident_id source_rcsa_finding_id
""")

_INCIDENT = _codes("""
K id
A severity status
R incident_date discovered_date resolved_at created_at updated_at
B financial_impact
T title description operational_impact root_cause corrective_actions lessons_learned tags
S tenant_id risk_id reported_by assigned_to
""")

_TASK = _codes("""
K id
A source source_module source_entity_type priority severity status category sla_days escalation_level recurrence_pattern recurrence_interval approval_required approval_status
Y due_date next_recurrence_date
R completed_at verified_at approved_at created_at updated_at
T title description evidence_notes approval_comment
P assigned_owner_id assigned_user_ids reviewer_id created_by_id approved_by_id
D custom_values
S tenant_id source_entity_id linked_risk_id linked_control_id linked_vulnerability_id linked_framework_id linked_requirement_id linked_issue_id linked_issue_action_id linked_regulatory_change_id parent_task_id
""")

_TASK_COMMENT = _codes("""
K id
T content
R created_at
S task_id user_id
""")

_ASSET = _codes("""
K id
A asset_type criticality confidentiality_rating integrity_rating availability_rating status cde_environment ephi_environment internet_facing is_internet_facing is_customer_facing data_classification regulated_data_type op_dep_business_impact lifecycle_state criticality_score criticality_manual_override last_seen_source origin_source os_family os_version os_normalized os_build os_edition asset_role cpu_cores memory_gb storage_gb agent_version manufacturer model environment source_system discovery_state platform_kind
R decommissioned_at last_seen_at first_seen_at created_at warranty_expiry eol_date
B valuation purchase_cost
G ip_address known_ips purchase_date
T name description host_name fqdn dns_aliases vendor location network_segment business_function owning_team department retirement_reason criticality_override_reason business_impact_notes
D pci_dss hipaa compliance_scope custom_values detected_software_json app_attributes_json security_posture platform_properties
S tenant_id owner_id owner_name custodian assigned_user primary_owner_id secondary_owner_id owning_team_id escalation_contact_id business_owner_id replacement_asset_id parent_asset_id serial_number primary_mac cloud_resource_id
""")

_VULNERABILITY = _codes("""
K id
A vuln_id severity cvss_score cvss_vector cvss_version nvd_cvss_score nvd_cvss_vector vpr_score cpe cve_id cwe_id cwe_ids affected_port plugin_family status scanner_status source epss_score epss_percentile kev_flag kev_ransomware_flag exploit_class exploit_status exploit_source public_exploit_count public_exploit_refs exploitdb_count exploitdb_verified_count exploitdb_refs exploit_references effective_risk_score composite_priority exception_status is_exception reopen_count template_type psirt_source patch_references vendor_advisory_ids
Y due_date kev_date_added nvd_published_at nvd_last_modified_at exception_expiry exception_expires_at
R discovered_at resolved_at first_detected last_seen closed_at reopened_at verified_at created_at updated_at nvd_last_synced_at effective_risk_computed_at public_exploit_synced_at psirt_synced_at exception_requested_at exception_approved_at exception_revoked_at
T title description affected_component affected_host affected_url recommendation remediation_guidance resolution_notes effective_risk_reason exception_reason exception_justification exception_denial_reason exception_revocation_reason ai_recommendation ai_impact_assessment
D custom_values template_fields exception_metadata host_identity closure_evidence exception_compensating_controls
S tenant_id report_id connection_id assigned_to verified_by closed_by exception_approved_by exception_requested_by_id exception_revoked_by_id workflow_template_id current_state_id last_seen_scan_id external_vuln_id evidence reproduction_steps
""")

_ASSESSMENT_ITEM = _codes("""
K id
A item_number compliance_status priority control_source control_type maturity_score risk_rating remediation_status
Y target_date
R ai_recommendation_generated_at closed_at created_at updated_at
T area_domain subdomain_name control_description gaps_identified proposed_solution remarks evidence_reference timeline ai_evidence_recommendation
P responsible_party
D assignees asset_status
S assessment_id tenant_id
""")

_ASSESSMENT_DOCUMENT = _codes("""
K id
A assessment_type assessment_format status overall_score total_items complied_count partially_complied_count not_complied_count in_progress_count na_count
Y due_date
R upload_date created_at updated_at
T name notes file_name
D xlsx_data asset_levels linked_asset_ids
S tenant_id source file_path assessor created_by
""")

_ASSESSMENT_RECORD = _codes("""
K id
A compliance_status compliance_score
T assessment_notes gap_description department
R assessed_at created_at updated_at
S assessment_id parsed_control_id owner_id assessed_by
""")

_PROGRAM_ASSESSMENT = _codes("""
K id
A status maturity_level
T notes
R assessed_at
S program_id normalized_control_id assessed_by
""")

# Which columns each use case may carry. A use case is registered in ai_gateway/registry.py; the column list is what its
# prompt needs, no more. "column:N" caps a text column at N characters.
_RISK_SCORES = ("inherent_likelihood", "inherent_impact", "inherent_score", "residual_likelihood", "residual_impact", "residual_score")
_USES: Dict[str, Dict[str, Tuple[str, ...]]] = {
    "Risk": {
        "erm.risk_treatment_plan": ("title:300", "description:2000", "risk_category", "category", *_RISK_SCORES, "status"),
        "erm.mitigation_suggest": ("title:300", "description:2000", "category", "risk_sub_category", "inherent_likelihood",
                                   "inherent_impact", "residual_likelihood", "residual_impact", "status"),
        "erm.bowtie_narrative": ("title:300", "description:2000", "risk_category", *_RISK_SCORES),
        "erm.assessment_risk_suggest": ("title:300", "description:2000", "risk_category", "category"),
        "erm.incident_suggest": ("title:200", "category", "status"),
        "erm.incident_analyze": ("id", "title:200", "category", "status"),
    },
    "RiskIncident": {
        "erm.bowtie_narrative": ("title:200", "severity"),
        "erm.assessment_risk_suggest": ("title:200", "severity"),
        "erm.incident_suggest": ("title:300", "description:2000", "severity"),
        "erm.incident_analyze": ("id", "title:200", "severity", "incident_date"),
    },
    "ComplianceAssessmentDocumentItem": {
        "assessments.evidence_advice": ("item_number", "area_domain:200", "subdomain_name:200", "control_description:2000",
                                        "remarks:500", "compliance_status", "maturity_score", "gaps_identified:600"),
        "assessments.evidence_draft": ("item_number", "control_description:2000"),
        "assessments.assess_item": ("area_domain:200", "control_description:2000", "remarks:4000"),
    },
    "ComplianceAssessmentDocument": {
        "assessments.evidence_advice": ("name:200", "assessment_format"),
        "assessments.evidence_draft": ("name:200", "assessment_format"),
    },
    "CriticalTask": {
        "tasks.prioritize": ("id", "title:200", "priority", "status", "category", "source", "due_date", "escalation_level"),
        "tasks.root_cause": ("title:200", "description:1500", "source", "source_module", "category", "priority", "severity",
                             "status", "evidence_notes:1000"),
        "tasks.predict_escalations": ("id", "title:200", "priority", "status", "category", "due_date", "escalation_level",
                                      "sla_days", "assigned_owner_id"),
        "tasks.balance_workload": ("id", "title:200", "priority", "category", "assigned_owner_id", "due_date"),
    },
    "CriticalTaskComment": {
        "tasks.root_cause": ("content:500",),
    },
    "Vulnerability": {
        "vulnerabilities.analyze_report": ("title:200", "severity", "cve_id"),
        "vulnerabilities.suggest_fix": (
            "title:300", "severity", "status", "cvss_score", "cve_id", "cwe_id", "description:2000", "affected_component",
            "kev_flag", "kev_date_added", "epss_score", "epss_percentile", "composite_priority", "nvd_published_at",
            "exploit_references", "patch_references", "vendor_advisory_ids", "remediation_guidance:800", "psirt_source",
            "recommendation:1500"),
        "vulnerabilities.control_proposals": (
            "title:300", "cve_id", "cwe_id", "cvss_vector", "severity", "description:1200", "epss_score", "kev_flag"),
    },
    "ITAsset": {
        "vulnerabilities.suggest_fix": ("asset_type", "criticality", "internet_facing", "data_classification"),
    },
}

POLICIES: Dict[str, Policy] = {
    p.model: p for p in (
        Policy("Risk", _RISK, _USES["Risk"]),
        Policy("RiskIncident", _INCIDENT, _USES["RiskIncident"]),
        Policy("CriticalTask", _TASK, _USES["CriticalTask"]),
        Policy("CriticalTaskComment", _TASK_COMMENT, _USES["CriticalTaskComment"]),
        Policy("ITAsset", _ASSET, _USES["ITAsset"]),
        Policy("Vulnerability", _VULNERABILITY, _USES["Vulnerability"]),
        Policy("ComplianceAssessmentDocumentItem", _ASSESSMENT_ITEM, _USES["ComplianceAssessmentDocumentItem"]),
        Policy("ComplianceAssessmentDocument", _ASSESSMENT_DOCUMENT, _USES["ComplianceAssessmentDocument"]),
        Policy("AssessmentItem", _ASSESSMENT_RECORD, {}),
        Policy("GRCComplianceAssessment", _PROGRAM_ASSESSMENT, {}),
    )
}


# ── rows a tenant defined itself (an uploaded register, an RCSA template) ───────────────────────────────────────
# Their columns are whatever the file or template says, so there is no fixed list of columns to classify: the use case
# names the columns it needs (``pick``), or the cells are filtered by what their column is called (``free_cells``).
_PERSON_LABEL = re.compile(
    r"\b(owner|assignee|assigned|reviewer|approver|responsible|accountable|contact|e-?mail|phone|mobile|employee|staff|"
    r"manager|officer|custodian|prepared by|reviewed by|approved by|signed|signature|person|name of)\b", re.I)


def pick(row: Dict[str, Any], keys: Iterable[str], cap: int = 500) -> Dict[str, Any]:
    """``row`` reduced to the columns a use case declared, text capped: an uploaded file may carry any column at all."""
    wanted = set(keys)
    return {k: (text(v, cap) if isinstance(v, str) else v) for k, v in row.items() if k in wanted}


def free_cells(row: Dict[str, Any], labels: Optional[Dict[str, str]] = None, *, limit: int = 40,
               cap: int = 500) -> List[Tuple[str, str]]:
    """``(label, value)`` for the populated cells of a tenant-defined row, minus every cell whose column is named like a
    person or a contact, each value capped, at most ``limit`` cells."""
    out: List[Tuple[str, str]] = []
    for key, value in row.items():
        label = str((labels or {}).get(key) or key)
        value = text(value if isinstance(value, str) else (None if value is None else str(value)), cap)
        if value and not _PERSON_LABEL.search(label):
            out.append((label, value))
        if len(out) >= limit:
            break
    return out


def policy_for(record: Any) -> Policy:
    name = record if isinstance(record, str) else type(record).__name__
    try:
        return POLICIES[name]
    except KeyError:
        raise KeyError(f"{name} has no AI field policy: add one in ai_gateway/field_policies.py") from None


def ai_view(record: Any, use_case: str, *, model: Optional[str] = None, book: Optional[AliasBook] = None,
            now: Optional[datetime] = None) -> Dict[str, Any]:
    """The columns ``use_case`` may carry from ``record``, transformed by their codes. Raises when the use case did not
    declare what it needs from this record type: a module cannot read a record into a prompt by accident. ``model``
    names the record type when ``record`` is not an instance of its class (a row object, a test double)."""
    policy = policy_for(model or record)
    specs = policy.uses.get(use_case)
    if specs is None:
        raise KeyError(f"{use_case} has not declared what it may read from {policy.model}")
    out: Dict[str, Any] = {}
    for spec in specs:
        column, cap = _spec(spec)
        code = policy.columns[column]
        value = getattr(record, column, None)
        if code == "A":
            out[column] = _public(value)
        elif code == "K":
            out[column] = value
        elif code == "Y":
            out[column] = day(value)
        elif code == "R":
            out[column] = relative(value, now)
        elif code == "B":
            out[column] = band(value)
        elif code == "T":
            out[column] = text(value, cap or TEXT_CAP)
        elif code == "G":
            out[column] = GENERALISE[column](value)
        elif code == "P":
            if book is None:
                raise ValueError(f"{use_case} reads the person column {column}: pass an AliasBook")
            out[column] = [book.alias(v) for v in value] if isinstance(value, (list, tuple)) else book.alias(value)
        else:
            raise ValueError(f"{policy.model}.{column} is {CODES[code]} and cannot be listed by {use_case}")
    return out


def declared() -> Iterable[Tuple[str, str, str]]:
    """(model, use case, column spec) for every declaration: what the tests walk."""
    for name, policy in POLICIES.items():
        for use_case, specs in policy.uses.items():
            for spec in specs:
                yield name, use_case, spec
