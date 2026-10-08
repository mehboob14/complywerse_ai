"""Status levels, SLA rules, extra fields and dropdown lists a tenant sets for
itself, per module.

One JSON document per (tenant, module), defaults in code, every patched key
validated — the shape the audit issue register already proved. What it does:

* **Status levels are data.** They were Python constants in fifteen places, so
  nobody could add "Awaiting regulator" without a release. A module that opts in
  validates writes against the configured list instead of a hardcoded set. Each
  level also says what the SLA clock does while a record sits in it: it runs, it
  pauses (waiting on someone else), or — at a closing level — it stops.
* **SLA state is computed on read, never stored.** A tenant shortening an SLA
  must change what every open record shows immediately, with no backfill and no
  sweep. The days can hang off any property the tenant picks — priority by
  default, or one of their own dropdown fields — with a reminder and an
  escalation point per value, the way the vulnerability SLA table works.
* **Extra fields are the tenant's form, not ours.** Fields are added, renamed and
  retired by the tenant; their values are validated (a required field that is
  never enforced is not a required field). The same goes for the options of the
  built-in dropdowns a module lets them edit (`lists`), which replaces the
  per-client templates that used to hardcode them.

Removing a field or a dropdown option archives it rather than dropping it,
because the values already recorded against it are audit evidence.
"""
from __future__ import annotations

import re
from copy import deepcopy
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from ..models import ModuleSettings

KEY = re.compile(r"^[a-z][a-z0-9_]{1,39}$")
TONES = ("slate", "blue", "amber", "emerald", "rose", "violet")
FIELD_TYPES = ("text", "textarea", "number", "date", "select", "multiselect", "checkbox", "user")
CLOCKS = ("runs", "paused")
_MAX_DAYS = 3650
_OPTION_TYPES = ("select", "multiselect")
_MAX_OPTIONS = 200


def _status(key: str, label: str, order: int, *, terminal: bool = False,
            tone: str = "slate", escalate_after_days: Optional[int] = None, clock: str = "runs") -> Dict[str, Any]:
    return {"key": key, "label": label, "order": order, "terminal": terminal,
            "tone": tone, "escalate_after_days": escalate_after_days, "clock": clock}


def _options(*pairs) -> List[Dict[str, Any]]:
    """Dropdown options from (value, label) pairs, or plain labels.

    A third item is the child options shown when that choice is selected
    (a category's sub-categories).
    """
    out = []
    for pair in pairs:
        if isinstance(pair, tuple) and len(pair) == 3:
            value, label, children = pair
        elif isinstance(pair, tuple):
            value, label, children = pair[0], pair[1], ()
        else:
            value, label, children = pair, pair, ()
        row: Dict[str, Any] = {"value": value, "label": label, "archived": False}
        kids = [str(c).strip() for c in (children or []) if str(c).strip()]
        if kids:
            row["children"] = kids
        out.append(row)
    return out


def _builtin(key: str, label: str, kind: str = "text", *, required: bool = False,
             locked: bool = False, list_key: Optional[str] = None) -> Dict[str, Any]:
    """A field the form already has. `locked` is the record's name: it can be
    renamed, not removed, because create still needs it."""
    return {"key": key, "label": label, "type": kind, "required": required,
            "locked": locked, "list": list_key}


def _audit_sla(by_priority: Dict[str, int]) -> Dict[str, Any]:
    return {"by_priority": dict(by_priority), "driver": "priority", "targets": {},
            "due_soon_days": 7, "escalate_after_days": 14, "escalate_to": [],
            "remind_before_due": 3, "repeat_every": 7}


# What each module ships with. `sections` says which parts a tenant can change;
# `permissions` gate its settings; `priorities` bound the SLA table to the
# vocabulary the records actually use; `lists` are the built-in dropdowns whose
# options the tenant owns. free_text lists store an option's name as its value
# (and the form may take a value typed in); the others store a slug.
MODULES: Dict[str, Dict[str, Any]] = {
    "statutory_audit": {
        "label": "Statutory Audit",
        "record": "Observation",
        "sections": ("statuses", "sla", "fields"),
        "permissions": {"view": "compliance:assessments:view", "edit": "compliance:assessments:edit"},
        "priorities": ("critical", "high", "medium", "low"),
        "defaults": {
            "statuses": [
                _status("open", "Open", 1, tone="amber", escalate_after_days=14),
                _status("in_progress", "In progress", 2, tone="blue", escalate_after_days=30),
                _status("complied", "Complied", 3, tone="emerald"),
                _status("closed", "Closed", 4, terminal=True, tone="slate"),
                _status("cancelled", "Cancelled", 5, terminal=True, tone="slate"),
            ],
            "sla": _audit_sla({"critical": 30, "high": 60, "medium": 90, "low": 180}),
            "fields": [],
        },
    },
    "internal_audit": {
        "label": "Internal Audit",
        "record": "Audit",
        "sections": ("statuses", "sla", "fields"),
        "permissions": {"view": "compliance:assessments:view", "edit": "compliance:assessments:edit"},
        "priorities": ("critical", "high", "medium", "low"),
        "defaults": {
            "statuses": [
                _status("planned", "Planned", 1, tone="slate", escalate_after_days=7),
                _status("in_progress", "In progress", 2, tone="blue", escalate_after_days=14),
                _status("completed", "Completed", 3, terminal=True, tone="emerald"),
                _status("cancelled", "Cancelled", 4, terminal=True, tone="slate"),
            ],
            "sla": _audit_sla({"critical": 30, "high": 60, "medium": 90, "low": 120}),
            "fields": [],
        },
    },
    "assets": {
        "label": "IT Asset Inventory",
        "record": "Asset",
        "sections": ("statuses", "sla", "fields", "lists"),
        "permissions": {"view": "assets:asset_inventory:view", "edit": "assets:asset_inventory:edit"},
        "priorities": ("critical", "high", "medium", "low"),
        "lists": {
            "environment": {"label": "Environment", "free_text": False, "options": _options(
                ("production", "Production"), ("staging", "Staging"), ("development", "Development"),
                ("test", "Test"), ("dr", "DR"))},
            "network_segment": {"label": "Network segment", "free_text": True, "options": _options(
                ("dmz", "DMZ"), ("internal", "Internal"), ("mgmt", "Management"), ("production", "Production"),
                ("staging", "Staging"), ("development", "Development"), ("cde", "Cardholder Data Environment"),
                ("restricted", "Restricted / Air-gapped"), ("guest", "Guest / Wi-Fi"), ("iot", "IoT / OT"))},
            "location": {"label": "Location", "free_text": True, "options": _options(
                ("us-east-1", "AWS us-east-1"), ("us-west-2", "AWS us-west-2"), ("eu-west-1", "AWS eu-west-1"),
                ("me-south-1", "AWS me-south-1"), ("azure-eastus", "Azure East US"),
                ("gcp-us-central1", "GCP us-central1"), "On-Premise", ("Co-located", "Co-located DC"),
                ("HQ", "Head Office"), ("Branch", "Branch Office"), ("Remote", "Remote / Home"))},
            # The asset wizard reads the vendor to pick a platform, so the shipped
            # values stay as they were; the tenant adds their own beside them.
            "vendor": {"label": "Vendor", "free_text": True, "options": _options(
                "Microsoft", ("AWS", "Amazon Web Services"), "Google Cloud", ("Azure", "Microsoft Azure"),
                "PostgreSQL", ("MySQL", "MySQL / MariaDB"), "MongoDB", "Redis", "Oracle", "SAP", "IBM",
                "Red Hat", "VMware", ("Apache", "Apache HTTP Server"), "Nginx", ("Tomcat", "Apache Tomcat"),
                ("IIS", "Microsoft IIS"), ("Mozilla", "Mozilla (Firefox)"), ("Google", "Google (Chrome)"),
                "Microsoft Edge", "Cisco", ("Palo Alto", "Palo Alto Networks"), "Fortinet", "CrowdStrike",
                "Okta", "Atlassian", "GitHub", "GitLab", ("In-house", "In-house / internally built"))},
            "data_classification": {"label": "Data classification", "free_text": False,
                                    "note": "Restricted and Confidential raise the calculated criticality; "
                                            "options you add do not.",
                                    "options": _options(
                ("public", "Public"), ("internal", "Internal"), ("confidential", "Confidential"),
                ("restricted", "Restricted"))},
        },
        "defaults": {
            "statuses": [
                _status("active", "Active", 1, tone="emerald"),
                _status("inactive", "Inactive", 2, tone="slate", clock="paused"),
                _status("decommissioned", "Decommissioned", 3, terminal=True, tone="slate"),
            ],
            "sla": _audit_sla({"critical": 7, "high": 14, "medium": 30, "low": 90}),
            "fields": [],
        },
        "builtins": [
            _builtin("name", "Name", required=True, locked=True),
            _builtin("description", "Description", "textarea"),
            _builtin("asset_type", "Asset type", "select", required=True),
            _builtin("vendor", "Vendor", "select", list_key="vendor"),
            _builtin("location", "Location", "select", list_key="location"),
            _builtin("environment", "Environment", "select", list_key="environment"),
            _builtin("network_segment", "Network segment", "select", list_key="network_segment"),
            _builtin("data_classification", "Data classification", "select", list_key="data_classification"),
            _builtin("owner", "Owner", "user"),
            _builtin("status", "Status", "select"),
        ],
    },
    "vulnerabilities": {
        "label": "Vulnerabilities",
        "record": "Vulnerability",
        "sections": ("statuses", "fields"),
        "permissions": {"view": "vulnerabilities:vulnerability_register:view",
                        "edit": "vulnerabilities:vulnerability_register:edit"},
        "priorities": ("critical", "high", "medium", "low", "info"),
        "defaults": {
            "statuses": [
                _status("open", "Open", 1, tone="rose", escalate_after_days=2),
                _status("in_progress", "In progress", 2, tone="amber"),
                _status("resolved", "Resolved", 3, terminal=True, tone="emerald"),
                _status("accepted", "Accepted", 4, terminal=True, tone="blue"),
                _status("closed", "Closed", 5, terminal=True, tone="slate"),
                _status("false_positive", "False positive", 6, terminal=True, tone="slate"),
            ],
            "fields": [],
        },
        "builtins": [
            _builtin("title", "Title", required=True, locked=True),
            _builtin("description", "Description", "textarea"),
            _builtin("severity", "Severity", "select", required=True, locked=True),
            _builtin("cvss", "CVSS score", "number"),
            _builtin("cve", "CVE ID"),
            _builtin("cwe", "CWE ID"),
            _builtin("affected_component", "Affected component"),
            _builtin("affected_host", "Affected host"),
            _builtin("due_date", "Due date", "date"),
        ],
    },
    "vendors": {
        "label": "Third-Party Risk",
        "record": "Supplier",
        "sections": ("statuses", "sla", "fields", "lists"),
        "permissions": {"view": "vendor_risk:vendors:view", "edit": "vendor_risk:config:edit"},
        "priorities": ("critical", "high", "medium", "low"),
        # Free text throughout: records already hold whatever was typed before.
        "lists": {
            "vendor_type": {"label": "Supplier type", "free_text": True, "options": _options(
                "Software as a service", "Software we install", "Professional services", "Hosting or infrastructure",
                "Outsourced business process", "Hardware", "Other")},
            "industry": {"label": "Industry", "free_text": True, "options": _options(
                "Financial services", "Technology", "Telecommunications", "Healthcare", "Professional services",
                "Logistics", "Manufacturing", "Retail", "Public sector", "Other")},
            "questionnaire_category": {"label": "Questionnaire category", "free_text": True, "options": _options(
                ("security", "Security"), ("privacy", "Privacy"), ("compliance", "Compliance"),
                ("operational", "Operational"), ("financial", "Financial"), ("general", "General"))},
            "document_type": {"label": "Supplier document type", "free_text": True, "options": _options(
                "Document", "Policy", "Procedure", "Form", "Register", "Agreement", "Report", "Plan", "Attestation")},
        },
        "defaults": {
            "statuses": [
                _status("active", "Active", 1, tone="emerald"),
                _status("under_review", "Under review", 2, tone="amber"),
                _status("onboarding", "Onboarding", 3, tone="blue"),
                _status("offboarded", "Offboarded", 4, terminal=True, tone="slate"),
                _status("suspended", "Suspended", 5, clock="paused", tone="slate"),
            ],
            "sla": _audit_sla({"critical": 14, "high": 30, "medium": 60, "low": 90}),
            "fields": [],
        },
        "builtins": [
            _builtin("name", "Vendor name", required=True, locked=True),
            _builtin("description", "Description", "textarea"),
            _builtin("vendor_type", "Vendor type", "select", list_key="vendor_type"),
            _builtin("industry", "Industry", "select", list_key="industry"),
            _builtin("website", "Website"),
            _builtin("business_owner", "Business owner", "user"),
            _builtin("tier", "Tier", "select"),
            _builtin("data_classification", "Draft data classification", "select"),
            _builtin("data_types", "Data types in scope"),
            _builtin("services", "Systems and services in scope"),
            _builtin("contact_name", "Contact name"),
            _builtin("contact_email", "Contact email"),
            _builtin("contact_phone", "Contact phone"),
            _builtin("contract_start", "Contract start", "date"),
            _builtin("contract_end", "Contract end", "date"),
            _builtin("annual_spend", "Annual spend", "number"),
        ],
    },
    "risks": {
        "label": "Risk Register",
        "record": "Risk",
        "sections": ("statuses", "sla", "fields", "lists"),
        "permissions": {"view": "erm:risks:view", "edit": "erm:risks:edit"},
        "priorities": ("critical", "high", "medium", "low"),
        "lists": {
            "category": {"label": "Risk category", "free_text": False, "child_label": "Sub-category",
                         "options": _options(
                ("strategic", "Strategic", ("Market", "Reputation", "Strategic Planning", "Competitive", "Brand", "Other")),
                ("operational", "Operational", ("Process", "Human Resources", "Supply Chain", "Business Continuity", "Quality", "Other")),
                ("financial", "Financial", ("Credit", "Market Risk", "Liquidity", "Accounting", "Budget", "Other")),
                ("compliance", "Compliance", ("Regulatory", "Legal", "Contractual", "Ethical", "Data Privacy", "Other")),
                ("technology", "Technology", ("Cybersecurity", "Infrastructure", "Data", "System Availability", "Software", "Other")),
                ("third_party", "Third Party", ("Vendor", "Outsourcing", "Partnership", "Contractor", "Other")),
                ("project_change", "Project/Change", ("Project Delivery", "Change Management", "Integration", "Scope", "Other")),
                ("internal", "Internal", ("Fraud", "Governance", "Culture", "Process Integrity", "Other")))},
            "register_type": {"label": "Register", "free_text": True, "options": _options(
                "RCSA", "PCI-DSS", "ISO 27001", "SOX", "GDPR", "NIST", "SAMA CSF", "Internal", "Project-Based",
                "Third-Party", "Other")},
        },
        "defaults": {
            "statuses": [
                _status("open", "Open", 1, tone="rose"),
                _status("in_treatment", "In treatment", 2, tone="amber"),
                _status("mitigated", "Mitigated", 3, tone="emerald"),
                _status("accepted", "Accepted", 4, terminal=True, tone="blue"),
                _status("closed", "Closed", 5, terminal=True, tone="slate"),
            ],
            "sla": _audit_sla({"critical": 14, "high": 30, "medium": 60, "low": 90}),
            "fields": [],
        },
        "builtins": [
            _builtin("title", "Title", required=True, locked=True),
            _builtin("description", "Description", "textarea"),
            _builtin("register_type", "Register type", "select", list_key="register_type"),
            _builtin("category", "Category", "select", list_key="category"),
            _builtin("sub_category", "Sub-category", "select"),
            _builtin("status", "Status", "select"),
            _builtin("owner", "Business owner", "user"),
            _builtin("team", "Assigned team", "user"),
            _builtin("linked_assets", "Linked assets"),
            _builtin("inherent_likelihood", "Inherent likelihood", "number"),
            _builtin("inherent_impact", "Inherent impact", "number"),
            _builtin("residual_likelihood", "Residual likelihood", "number"),
            _builtin("residual_impact", "Residual impact", "number"),
            _builtin("root_cause", "Root cause", "textarea"),
            _builtin("consequences", "Consequences", "textarea"),
            _builtin("recommendations", "Recommendations", "textarea"),
            _builtin("treatment_plan", "Treatment plan", "textarea"),
        ],
    },
    "tasks": {
        "label": "Task Management",
        "record": "Task",
        "sections": ("statuses", "sla", "fields", "lists"),
        "permissions": {"view": "critical_tasks:tasks:view", "edit": "critical_tasks:tasks:create"},
        "priorities": ("critical", "high", "medium", "low", "info"),
        "lists": {
            "priority": {"label": "Priority", "free_text": True, "options": _options(
                "Critical", "High", "Medium", "Low")},
            "category": {"label": "Category", "free_text": True, "options": _options(
                "Remediation", "Implementation", "Review", "Reporting", "Other")},
            "source": {"label": "Source", "free_text": True, "options": _options(
                "Audit", "Risk", "Compliance", "Vulnerability", "Manual")},
            "severity": {"label": "Severity", "free_text": True, "options": _options(
                "Critical", "High", "Medium", "Low")},
        },
        "defaults": {
            "statuses": [
                _status("open", "Open", 1, tone="slate"),
                _status("in_progress", "In progress", 2, tone="amber"),
                _status("under_review", "Under review", 3, tone="blue"),
                _status("completed", "Completed", 4, terminal=True, tone="emerald"),
                _status("verified", "Verified", 5, terminal=True, tone="emerald"),
                _status("reopened", "Reopened", 6, tone="rose"),
            ],
            "sla": _audit_sla({"critical": 7, "high": 30, "medium": 90, "low": 180, "info": 365}),
            "fields": [],
        },
        "builtins": [
            _builtin("title", "Title", required=True, locked=True),
            _builtin("description", "Description", "textarea"),
            _builtin("source", "Source", "select", list_key="source"),
            _builtin("priority", "Priority", "select", list_key="priority"),
            _builtin("category", "Category", "select", list_key="category"),
            _builtin("severity", "Severity", "select", list_key="severity"),
            _builtin("owners", "Assigned owners", "user"),
            _builtin("reviewer", "Reviewer", "user"),
            _builtin("due_date", "Due date", "date"),
            _builtin("notes", "Evidence / notes", "textarea"),
        ],
    },
    "evidence": {
        "label": "Evidence",
        "record": "Evidence",
        "sections": ("statuses", "sla", "fields", "lists"),
        "permissions": {"view": "evidence:evidence_library:view", "edit": "evidence:evidence_library:edit"},
        "priorities": ("critical", "high", "medium", "low"),
        "lists": {
            "evidence_type": {"label": "Evidence type", "free_text": False, "options": _options(
                ("screenshot", "Screenshot"), ("document", "Document"), ("certificate", "Certificate"),
                ("audit_report", "Audit report"), ("log", "Log"), ("policy", "Policy"),
                ("procedure", "Procedure"), ("configuration", "Configuration"),
                ("attestation", "Attestation"), ("training_record", "Training record"),
                ("access_review", "Access review"), ("vulnerability_scan", "Vulnerability scan"),
                ("penetration_test", "Penetration test"), ("backup_log", "Backup log"),
                ("change_record", "Change record"), ("incident_report", "Incident report"),
                ("validation_material", "Validation material"), ("other", "Other"))},
        },
        "defaults": {
            "statuses": [
                _status("draft", "Draft", 1, tone="slate"),
                _status("pending_review", "Pending review", 2, tone="amber"),
                _status("approved", "Approved", 3, terminal=True, tone="emerald"),
                _status("rejected", "Rejected", 4, tone="rose"),
            ],
            "sla": _audit_sla({"critical": 7, "high": 14, "medium": 30, "low": 60}),
            "fields": [],
        },
        "builtins": [
            _builtin("name", "Name", required=True, locked=True),
            _builtin("description", "Description", "textarea"),
            _builtin("evidence_type", "Evidence type", "select", list_key="evidence_type"),
            _builtin("owner", "Owner", "user"),
            _builtin("collection_date", "Collection date", "date"),
            _builtin("validity", "Validity period", "number"),
            _builtin("source", "Source system"),
        ],
    },
    "controls": {
        "label": "Common Controls",
        "record": "Control",
        "sections": ("statuses", "sla", "fields"),
        "permissions": {"view": "controls:control_library:view", "edit": "controls:control_library:edit"},
        "priorities": ("critical", "high", "medium", "low"),
        "defaults": {
            "statuses": [
                _status("not_started", "Not started", 1, tone="slate"),
                _status("in_progress", "In progress", 2, tone="amber"),
                _status("implemented", "Implemented", 3, terminal=True, tone="emerald"),
            ],
            "sla": _audit_sla({"critical": 14, "high": 30, "medium": 60, "low": 90}),
            "fields": [],
        },
    },
}


def spec(module_key: str) -> Dict[str, Any]:
    if module_key not in MODULES:
        raise ValueError(f"Unknown module '{module_key}'. One of {sorted(MODULES)}")
    return MODULES[module_key]


def sections(module_key: str) -> tuple:
    return tuple(spec(module_key).get("sections") or ("statuses", "sla", "fields"))


# ── read ─────────────────────────────────────────────────────────────────────

def get_settings(db: Session, tenant_id: int, module_key: str) -> Dict[str, Any]:
    """The tenant's settings, defaults filled in. No row is needed."""
    module = spec(module_key)
    parts = sections(module_key)
    merged = deepcopy(module["defaults"])
    row = db.query(ModuleSettings).filter(
        ModuleSettings.tenant_id == tenant_id, ModuleSettings.module_key == module_key).first()
    stored = (row.config if isinstance(getattr(row, "config", None), dict) else {}) or {}
    return _merge(module_key, module, parts, merged, stored,
                  row.updated_at.isoformat() if row is not None and row.updated_at else None)


def _merge(module_key: str, module: Dict[str, Any], parts: tuple, merged: Dict[str, Any],
           stored: Dict[str, Any], updated_at: Optional[str]) -> Dict[str, Any]:
    if "statuses" in parts:
        if isinstance(stored.get("statuses"), list) and stored["statuses"]:
            merged["statuses"] = stored["statuses"]
        for s in merged["statuses"]:
            s.setdefault("clock", "runs")
        merged["statuses"] = sorted(merged["statuses"], key=lambda s: (s.get("order") or 0, s.get("label") or ""))
    if "sla" in parts:
        if isinstance(stored.get("sla"), dict):
            merged["sla"].update({k: v for k, v in stored["sla"].items() if k in merged["sla"]})
        merged["sla"].setdefault("driver", "priority")
        merged["sla"].setdefault("targets", {})
    merged["fields"] = sorted((stored.get("fields") if isinstance(stored.get("fields"), list) else merged.get("fields"))
                              or [], key=lambda f: (f.get("order") or 0, f.get("label") or ""))
    if "lists" in parts:
        saved_lists = stored.get("lists") if isinstance(stored.get("lists"), dict) else {}
        merged["lists"] = {key: {"label": item["label"], "free_text": bool(item.get("free_text")),
                                 "note": item.get("note"), "child_label": item.get("child_label"),
                                 "options": deepcopy(saved_lists.get(key) or item["options"])}
                           for key, item in (module.get("lists") or {}).items()}
    layout = stored.get("layout") if isinstance(stored.get("layout"), dict) else {}
    merged["builtins"] = []
    for item in module.get("builtins") or []:
        over = layout.get(item["key"]) if isinstance(layout.get(item["key"]), dict) else {}
        label = str(over.get("label") or item["label"])
        hidden = bool(over.get("hidden")) and not item.get("locked")
        merged["builtins"].append({**item, "label": label, "hidden": hidden})
    merged["module"] = {"key": module_key, "label": module["label"], "record": module["record"],
                        "priorities": list(module["priorities"]), "sections": list(parts),
                        "permissions": dict(module.get("permissions") or {})}
    merged["updated_at"] = updated_at
    return merged


def status_keys(settings: Dict[str, Any]) -> List[str]:
    return [str(s["key"]) for s in settings.get("statuses") or []]


def _status_of(settings: Dict[str, Any], status: Optional[str]) -> Optional[Dict[str, Any]]:
    key = (status or "").strip().lower()
    return next((s for s in settings.get("statuses") or [] if str(s.get("key")) == key), None)


def is_terminal(settings: Dict[str, Any], status: Optional[str]) -> bool:
    level = _status_of(settings, status)
    return bool(level and level.get("terminal"))


def active_fields(settings: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [f for f in settings.get("fields") or [] if not f.get("archived")]


def list_options(settings: Dict[str, Any], list_key: str, *, include_archived: bool = False) -> List[Dict[str, Any]]:
    """The options of one of the module's built-in dropdowns, as the tenant set them."""
    options = ((settings.get("lists") or {}).get(list_key) or {}).get("options") or []
    return [o for o in options if include_archived or not o.get("archived")]


# ── validation ───────────────────────────────────────────────────────────────

def _int(value: Any, name: str, low: int, high: int, allow_none: bool = False) -> Optional[int]:
    if (value is None or value == "") and allow_none:
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be a whole number")
    if not low <= number <= high:
        raise ValueError(f"{name} must be between {low} and {high}")
    return number


def _text(value: Any, name: str, limit: int, required: bool = True) -> str:
    cleaned = " ".join(str(value or "").split())[:limit]
    if required and not cleaned:
        raise ValueError(f"{name} is required")
    return cleaned


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")[:40]


def _clean_statuses(raw: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw, list) or not raw:
        raise ValueError("At least one status level is needed")
    out, seen = [], set()
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError("Each status level must be an object")
        key = str(item.get("key") or "").strip().lower()
        if not KEY.match(key):
            raise ValueError(f"Status key '{key}' must be lower case letters, digits and underscores")
        if key in seen:
            raise ValueError(f"Status '{key}' is listed twice")
        seen.add(key)
        tone = str(item.get("tone") or "slate").lower()
        clock = str(item.get("clock") or "runs").lower()
        if clock not in CLOCKS:
            raise ValueError(f"The SLA clock at '{key}' must be one of {', '.join(CLOCKS)}")
        out.append({
            "key": key,
            "label": _text(item.get("label") or key, "Status label", 60),
            "order": _int(item.get("order", index + 1), "Status order", 0, 999),
            "terminal": bool(item.get("terminal")),
            "tone": tone if tone in TONES else "slate",
            "escalate_after_days": _int(item.get("escalate_after_days"), "Days to escalation",
                                        0, _MAX_DAYS, allow_none=True),
            "clock": clock,
        })
    if not any(s["terminal"] for s in out):
        raise ValueError("One status level must be marked as closing the record")
    return sorted(out, key=lambda s: (s["order"], s["label"]))


def driver_values(module: Dict[str, Any], fields: List[Dict[str, Any]], driver: str) -> List[str]:
    """What the SLA days can be set per, for this driver."""
    if driver == "priority":
        return list(module["priorities"])
    if driver.startswith("field:"):
        field = next((f for f in fields if f.get("key") == driver[6:] and not f.get("archived")), None)
        if field is None or field.get("type") != "select":
            raise ValueError(f"'{driver[6:]}' is not one of your dropdown fields, so the SLA cannot follow it")
        return list(field.get("options") or [])
    raise ValueError("The SLA can follow the priority, or one of your own dropdown fields")


def _clean_sla(raw: Any, module: Dict[str, Any], current: Dict[str, Any],
               fields: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("SLA settings must be an object")
    sla = deepcopy(current)
    sla.setdefault("driver", "priority")
    sla.setdefault("targets", {})
    if "driver" in raw:
        driver = str(raw.get("driver") or "priority").strip()
        driver_values(module, fields or [], driver)          # refuses a driver that isn't there
        if driver != sla["driver"]:
            sla["targets"] = {}                              # days per the old property mean nothing now
        sla["driver"] = driver
    allowed = driver_values(module, fields or [], sla["driver"])
    for key, value in raw.items():
        if key == "driver":
            continue
        if key == "by_priority":
            if not isinstance(value, dict):
                raise ValueError("SLA days must be given per priority")
            for priority, days in value.items():
                if priority not in module["priorities"]:
                    raise ValueError(f"Unknown priority '{priority}'")
                sla["by_priority"][priority] = _int(days, f"SLA days for {priority}", 0, _MAX_DAYS)
        elif key == "targets":
            if not isinstance(value, dict):
                raise ValueError("SLA targets must be given per value")
            targets = {}
            for option, row in value.items():
                if option not in allowed:
                    raise ValueError(f"'{option}' is not a value the SLA follows")
                row = row if isinstance(row, dict) else {"days": row}
                targets[option] = {
                    "days": _int(row.get("days"), f"Days allowed for {option}", 0, _MAX_DAYS, allow_none=True),
                    "notify_before": _int(row.get("notify_before"), f"Reminder days for {option}", 0, 365, allow_none=True),
                    "escalate_after": _int(row.get("escalate_after"), f"Escalation days for {option}", 0, _MAX_DAYS,
                                           allow_none=True),
                }
                # The priority days stay in step, for anything still reading them.
                if sla["driver"] == "priority" and targets[option]["days"] is not None:
                    sla["by_priority"][option] = targets[option]["days"]
            sla["targets"] = targets
        elif key in ("due_soon_days", "remind_before_due", "repeat_every"):
            sla[key] = _int(value, key.replace("_", " "), 0, 365)
        elif key == "escalate_after_days":
            sla[key] = _int(value, "days to escalation", 0, _MAX_DAYS)
        elif key == "escalate_to":
            if not isinstance(value, list) or len(value) > 10:
                raise ValueError("Escalate to must be a list of at most 10 entries")
            targets_ = []
            for entry in value:
                target = _text(entry, "escalation target", 80)
                if not (target.startswith("role:") or target.startswith("user:")):
                    raise ValueError(f"'{target}' must start with 'role:' or 'user:'")
                targets_.append(target)
            sla["escalate_to"] = targets_
        else:
            raise ValueError(f"Unknown SLA setting '{key}'")
    return sla


def _clean_fields(raw: Any, existing: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not isinstance(raw, list):
        raise ValueError("Fields must be a list")
    out, seen = [], set()
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError("Each field must be an object")
        key = str(item.get("key") or "").strip().lower()
        if not KEY.match(key):
            raise ValueError(f"Field key '{key}' must be lower case letters, digits and underscores")
        if key in seen:
            raise ValueError(f"Field '{key}' is listed twice")
        seen.add(key)
        kind = str(item.get("type") or "text").lower()
        if kind not in FIELD_TYPES:
            raise ValueError(f"Field type '{kind}' must be one of {', '.join(FIELD_TYPES)}")
        depends = str(item.get("depends_on") or "").strip() or None
        groups: Dict[str, List[str]] = {}
        options: List[str] = []
        if kind in _OPTION_TYPES and depends:
            raw_groups = item.get("groups") if isinstance(item.get("groups"), dict) else {}
            for parent, kids in list(raw_groups.items())[:_MAX_OPTIONS]:
                parent_name = _text(parent, "parent option", 80)
                cleaned_kids: List[str] = []
                for kid in (kids or [])[:_MAX_OPTIONS] if isinstance(kids, list) else []:
                    text = _text(kid, "option", 80, required=False)
                    if text and text not in cleaned_kids:
                        cleaned_kids.append(text)
                if cleaned_kids:
                    groups[parent_name] = cleaned_kids
            if not groups:
                raise ValueError(f"Field '{key}' depends on another dropdown, so add options under at least one choice")
        elif kind in _OPTION_TYPES:
            values = item.get("options")
            if not isinstance(values, list) or not values:
                raise ValueError(f"Field '{key}' is a {kind}, so it needs at least one option")
            for option in values[:_MAX_OPTIONS]:
                text = _text(option, "option", 80)
                if text not in options:
                    options.append(text)
        out.append({
            "key": key,
            "label": _text(item.get("label") or key, "Field label", 80),
            "type": kind,
            "required": bool(item.get("required")),
            "options": options,
            "depends_on": depends,
            "groups": groups,
            "help": _text(item.get("help"), "help text", 200, required=False),
            "order": _int(item.get("order", index + 1), "field order", 0, 999),
            "archived": bool(item.get("archived")),
        })
    # A field taken out of the list is archived, not dropped: values already
    # recorded against it are evidence.
    for old in existing:
        if str(old.get("key")) not in seen:
            kept = deepcopy(old)
            kept["archived"] = True
            out.append(kept)
    live = {f["key"]: f for f in out if not f.get("archived")}
    for field in live.values():
        dep = field.get("depends_on")
        if not dep:
            continue
        parent = live.get(dep)
        if parent is None or parent.get("type") != "select" or parent.get("depends_on"):
            raise ValueError(f"'{field['label']}' must depend on a single dropdown")
    return sorted(out, key=lambda f: (f["order"], f["label"]))


def _clean_lists(raw: Any, module: Dict[str, Any], current: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    """The tenant's options for the module's built-in dropdowns. An option taken out
    is archived: records already holding it keep it and still show its name."""
    if not isinstance(raw, dict):
        raise ValueError("Dropdown lists must be given per list")
    known = module.get("lists") or {}
    out = {key: deepcopy(item["options"]) for key, item in (current or {}).items()}
    for key, options in raw.items():
        if key not in known:
            raise ValueError(f"'{key}' is not a dropdown you can change here")
        if not isinstance(options, list) or not options:
            raise ValueError(f"{known[key]['label']} needs at least one option")
        cleaned, seen = [], set()
        for option in options[:_MAX_OPTIONS]:
            option = option if isinstance(option, dict) else {"label": option}
            label = _text(option.get("label") or option.get("value"), f"{known[key]['label']} option", 80)
            value = _text(option.get("value") or (label if known[key].get("free_text") else _slug(label)),
                          f"{known[key]['label']} value", 80)
            if value.lower() in seen:
                raise ValueError(f"'{label}' is listed twice in {known[key]['label']}")
            seen.add(value.lower())
            row = {"value": value, "label": label, "archived": bool(option.get("archived"))}
            children = []
            for child in (option.get("children") or [])[:_MAX_OPTIONS]:
                text = _text(child, "sub-option", 80, required=False)
                if text and text not in children:
                    children.append(text)
            if children:
                row["children"] = children
            cleaned.append(row)
        for old in (current.get(key) or {}).get("options") or []:
            if str(old.get("value")).lower() not in seen:
                cleaned.append({**old, "archived": True})
        if not any(not o["archived"] for o in cleaned):
            raise ValueError(f"{known[key]['label']} needs at least one option in use")
        out[key] = cleaned
    return out


def _clean_layout(raw: Any, module: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Rename or hide a field the form already has. The record's name stays."""
    known = {item["key"]: item for item in module.get("builtins") or []}
    if not isinstance(raw, dict):
        raise ValueError("Existing fields must be given as an object")
    out: Dict[str, Dict[str, Any]] = {}
    for key, item in raw.items():
        spec_row = known.get(str(key))
        if spec_row is None:
            raise ValueError(f"'{key}' is not a field on this form")
        if not isinstance(item, dict):
            raise ValueError(f"'{spec_row['label']}' needs a label")
        hidden = bool(item.get("hidden"))
        if spec_row.get("locked") and hidden:
            raise ValueError(f"'{spec_row['label']}' can't be removed")
        out[str(key)] = {
            "label": _text(item.get("label") or spec_row["label"], "Field label", 80),
            "hidden": hidden,
        }
    return out


def save_settings(db: Session, tenant_id: int, module_key: str, patch: Dict[str, Any],
                  user_id: Optional[int] = None) -> Dict[str, Any]:
    """Apply a patch of whole sections. Unknown keys are refused rather than
    quietly stored, so a typo cannot look like a saved setting."""
    module = spec(module_key)
    parts = sections(module_key)
    if not isinstance(patch, dict) or not patch:
        raise ValueError("Nothing to save")
    current = get_settings(db, tenant_id, module_key)
    row = db.query(ModuleSettings).filter(
        ModuleSettings.tenant_id == tenant_id, ModuleSettings.module_key == module_key).first()
    stored = deepcopy(row.config) if row is not None and isinstance(row.config, dict) else {}

    for section in patch:
        if section not in ("statuses", "sla", "fields", "lists", "layout"):
            raise ValueError(f"Unknown settings section '{section}'")
        if section not in parts and section != "layout":
            raise ValueError(f"{module['label']} has no '{section}' settings")
    # Fields first: an SLA may follow one of them.
    if "fields" in patch:
        stored["fields"] = _clean_fields(patch["fields"], current.get("fields") or [])
    fields = stored.get("fields") if isinstance(stored.get("fields"), list) else current.get("fields") or []
    if "statuses" in patch:
        stored["statuses"] = _clean_statuses(patch["statuses"])
    if "sla" in patch:
        stored["sla"] = _clean_sla(patch["sla"], module, current["sla"], fields)
    elif "sla" in parts and str(current["sla"].get("driver", "")).startswith("field:"):
        driver_values(module, fields, current["sla"]["driver"])   # a field the SLA follows can't be retired
    if "lists" in patch:
        stored["lists"] = _clean_lists(patch["lists"], module, current.get("lists") or {})
    if "layout" in patch:
        stored["layout"] = _clean_layout(patch["layout"], module)

    if row is None:
        row = ModuleSettings(tenant_id=tenant_id, module_key=module_key, config=stored)
        db.add(row)
    else:
        row.config = stored
    row.updated_by = user_id
    row.updated_at = datetime.utcnow()
    db.commit()
    return get_settings(db, tenant_id, module_key)


# ── the clock ────────────────────────────────────────────────────────────────

def _driver_value(settings: Dict[str, Any], priority: Optional[str], values: Optional[Dict[str, Any]]) -> Optional[str]:
    driver = (settings.get("sla") or {}).get("driver") or "priority"
    if driver.startswith("field:"):
        value = (values or {}).get(driver[6:])
        return str(value) if value not in (None, "") else None
    return (priority or "").strip().lower() or None


def target(settings: Dict[str, Any], priority: Optional[str] = None,
           values: Optional[Dict[str, Any]] = None) -> Dict[str, Optional[int]]:
    """The SLA row that applies to a record: days allowed, reminder and escalation."""
    sla = settings.get("sla") or {}
    key = _driver_value(settings, priority, values)
    row = dict((sla.get("targets") or {}).get(key or "") or {})
    if row.get("days") is None and (sla.get("driver") or "priority") == "priority":
        row["days"] = (sla.get("by_priority") or {}).get(key or "")
    return {"days": row.get("days"), "notify_before": row.get("notify_before"),
            "escalate_after": row.get("escalate_after")}


def target_days(settings: Dict[str, Any], priority: Optional[str], values: Optional[Dict[str, Any]] = None) -> Optional[int]:
    return target(settings, priority, values)["days"]


def sla_state(settings: Dict[str, Any], *, status: Optional[str], due_date: Optional[datetime],
              priority: Optional[str] = None, opened_at: Optional[datetime] = None,
              now: Optional[datetime] = None, values: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Where this record stands against the tenant's SLA, computed fresh.

    With no due date of its own, one is implied from when the record opened plus
    the days its SLA value allows — otherwise a record without a date is invisible
    to an SLA it is nonetheless subject to. `values` are the record's own field
    values, for an SLA that follows one of them.
    """
    now = now or datetime.utcnow()
    rule = target(settings, priority, values)
    days = rule["days"]
    implied = None
    if due_date is None and opened_at is not None and days is not None:
        implied = opened_at + timedelta(days=days)
    deadline = due_date or implied
    sla = settings.get("sla") or {}
    state = {"state": "no_due_date", "days_overdue": None, "due_in_days": None,
             "target_days": days, "due_date": deadline.isoformat() if deadline else None,
             "implied_due_date": implied is not None, "escalate_after_days": None, "escalated": False,
             "remind_before_due": rule["notify_before"] if rule["notify_before"] is not None
             else sla.get("remind_before_due")}

    level = _status_of(settings, status)
    if level and level.get("terminal"):
        state["state"] = "closed"
        return state
    if level and level.get("clock") == "paused":
        state["state"] = "paused"                   # waiting on someone else: the SLA doesn't run
        return state
    if deadline is None:
        return state

    overdue_days = (now.date() - deadline.date()).days
    due_soon = sla.get("due_soon_days") or 0
    if overdue_days > 0:
        state.update(state="breached", days_overdue=overdue_days, due_in_days=-overdue_days)
    elif -overdue_days <= due_soon:
        state.update(state="due_soon", days_overdue=0, due_in_days=-overdue_days)
    else:
        state.update(state="on_track", days_overdue=0, due_in_days=-overdue_days)

    # The status level wins, then the SLA row for this record, then the module default.
    per_status = level.get("escalate_after_days") if level else None
    after = next((d for d in (per_status, rule["escalate_after"], sla.get("escalate_after_days")) if d is not None), None)
    state["escalate_after_days"] = after
    if after is not None and state["state"] == "breached" and overdue_days >= after:
        state["escalated"] = True
    return state


# ── extra field values ───────────────────────────────────────────────────────

def _choices(field: Dict[str, Any], values: Dict[str, Any]) -> List[str]:
    """Options a dropdown accepts. A field that depends on another dropdown
    accepts the group for the parent value in this payload, or any of its
    groups when the parent was not sent (a partial update)."""
    groups = field.get("groups") or {}
    dep = field.get("depends_on")
    if dep and isinstance(groups, dict) and groups:
        parent = values.get(dep)
        parent = parent.strip() if isinstance(parent, str) else parent
        kids = groups.get(parent) if isinstance(parent, str) else None
        if isinstance(kids, list) and kids:
            return list(kids)
        flat: List[str] = []
        for row in groups.values():
            if isinstance(row, list):
                for kid in row:
                    if kid not in flat:
                        flat.append(kid)
        return flat
    return list(field.get("options") or [])


def validate_custom_values(settings: Dict[str, Any], values: Any, *,
                           partial: bool = False) -> Dict[str, Any]:
    """Clean a record's extra field values against the tenant's definitions.

    `partial` is for a PATCH: only the keys given are checked, and a required
    field that was not sent is left alone.
    """
    if values is None:
        values = {}
    if not isinstance(values, dict):
        raise ValueError("Field values must be an object")
    by_key = {str(f["key"]): f for f in settings.get("fields") or []}
    cleaned: Dict[str, Any] = {}

    for key, value in values.items():
        field = by_key.get(str(key))
        if field is None:
            raise ValueError(f"'{key}' is not a field on this record")
        if field.get("archived"):
            raise ValueError(f"'{field['label']}' has been removed and cannot be set")
        kind = field["type"]
        if value in (None, "") or value == []:
            cleaned[key] = None
            continue
        allowed = _choices(field, values)
        if kind == "number":
            try:
                cleaned[key] = float(value) if not float(value).is_integer() else int(float(value))
            except (TypeError, ValueError):
                raise ValueError(f"'{field['label']}' must be a number")
        elif kind == "checkbox":
            cleaned[key] = bool(value) if not isinstance(value, str) else value.strip().lower() in (
                "1", "true", "yes", "on")
        elif kind == "date":
            text = str(value).strip()[:10]
            try:
                datetime.strptime(text, "%Y-%m-%d")
            except ValueError:
                raise ValueError(f"'{field['label']}' must be a date as YYYY-MM-DD")
            cleaned[key] = text
        elif kind == "select":
            text = _text(value, field["label"], 200)
            if text not in allowed:
                raise ValueError(f"'{field['label']}' must be one of: {', '.join(allowed)}")
            cleaned[key] = text
        elif kind == "multiselect":
            if not isinstance(value, list):
                raise ValueError(f"'{field['label']}' must be a list")
            picked = []
            for entry in value[:50]:
                text = _text(entry, field["label"], 200)
                if text not in allowed:
                    raise ValueError(f"'{field['label']}' must be one of: {', '.join(allowed)}")
                picked.append(text)
            cleaned[key] = picked
        elif kind == "user":
            cleaned[key] = _int(value, field["label"], 1, 2_147_483_647)
        else:
            cleaned[key] = _text(value, field["label"], 4000, required=False)

    if not partial:
        for field in active_fields(settings):
            if field.get("required") and cleaned.get(field["key"]) in (None, "", []):
                raise ValueError(f"'{field['label']}' is required")
    return cleaned


def merge_custom_values(settings: Dict[str, Any], current: Optional[Dict[str, Any]], incoming: Any) -> Dict[str, Any]:
    """A record's values after an update: the ones sent are validated and replace
    theirs; the rest — including values of fields since removed — stay."""
    cleaned = validate_custom_values(settings, incoming, partial=True)
    return {**(current or {}), **cleaned}


def clean_record_values(db: Session, tenant_id: int, module_key: str, incoming: Any,
                        current: Optional[Dict[str, Any]] = None, *, creating: bool) -> Optional[Dict[str, Any]]:
    """The extra field values to store on a record a form is saving.

    A caller that sends no values at all (an import, a scanner, an older screen)
    leaves them as they are: required fields are enforced on the forms that show
    them, not on every path that happens to create a record.
    """
    if incoming is None:
        return current
    settings = get_settings(db, tenant_id, module_key)
    if creating:
        return validate_custom_values(settings, incoming, partial=False)
    return merge_custom_values(settings, current, incoming)
