"""The sidebar module and sub-module an API call belongs to.

Administration → Audit Logs names every row by it and filters on it. A route is
placed by its own file when the URL doesn't say which page it serves, else by
its URL, longest prefix first. Every assessment page shares
/compliance/assessments, so those are placed by the assessment's format.
"""
import re
from collections import OrderedDict
from typing import Any, Dict, List, Optional, Tuple

Place = Tuple[str, str]  # (module, sub-module)

# Sidebar order, for the filter lists.
MODULE_ORDER = [
    "Performance Overview", "My Work", "Governance", "Risk Management", "Third-Party Vendor Risk",
    "Compliance Management", "Assessments", "Business Continuity", "Controls Automation",
    "Issue & Incident Management", "Cybersecurity Assurance", "Auditor Portal", "Critical Tasks",
    "Reports", "AI Assistant", "Administration",
]

# Route files whose URL doesn't name the page they serve.
BY_FILE: Dict[str, Place] = {
    "grc.routers.audit_plan_router": ("Auditor Portal", "Internal Audit"),
    "grc.modules.issue_management.routers.audit_register": ("Auditor Portal", "Issue Register"),
    "grc.modules.automation.assurance": ("Controls Automation", "Control Assurance"),
    "grc.routers.dcc_router": ("Assessments", "NCA"),
}

# URL prefix (without the /grc mount) → place. Longest match wins.
BY_PREFIX: Dict[str, Place] = {
    "/dashboard": ("Performance Overview", "Dashboard"),
    "/enriched-dashboard": ("Performance Overview", "Dashboard"),
    "/scf/my-work": ("My Work", "My Work"),
    # Governance
    "/governance": ("Governance", "Overview"),
    "/governance/documents": ("Governance", "Documents"),
    "/governance/mappings": ("Governance", "Documents"),
    "/governance/versions": ("Governance", "Documents"),
    "/governance/reviews": ("Governance", "Documents"),
    "/governance/workflows": ("Governance", "Documents"),
    "/governance/gap-analysis": ("Governance", "Gap Analysis"),
    "/governance/applicability": ("Governance", "Gap Analysis"),
    "/documents": ("Governance", "Documents"),
    "/governance/attestations": ("Governance", "Attestations"),
    "/governance/attestation-campaigns": ("Governance", "Attestations"),
    "/governance/document-attestations": ("Governance", "Attestations"),
    "/governance/policy-exceptions": ("Governance", "Policy Exceptions"),
    "/governance/exceptions": ("Governance", "Policy Exceptions"),
    "/governance/objectives": ("Governance", "Objectives"),
    "/governance/issues": ("Governance", "Objectives"),
    "/governance/nca-templates": ("Governance", "Document Templates"),
    "/governance/reference-laws": ("Governance", "Document Templates"),
    "/governance/committees": ("Governance", "Committees"),
    "/erm/kris": ("Governance", "KRIs"),
    "/erm/kri-workflow": ("Governance", "KRIs"),
    "/advanced-erm/kris": ("Governance", "KRIs"),
    "/risks/nca-kpi": ("Governance", "KPI Report"),
    "/is-projects": ("Governance", "Projects"),
    # Risk Management
    "/erm": ("Risk Management", "Overview"),
    "/advanced-erm": ("Risk Management", "Overview"),
    "/erm/risks": ("Risk Management", "Risk Register"),
    "/risks": ("Risk Management", "Risk Register"),
    "/erm/risk-assessments": ("Risk Management", "Risk Assessments"),
    "/erm/framework-risk-assessments": ("Risk Management", "Risk Assessments"),
    "/erm/ai-risk-assessment": ("Risk Management", "Risk Assessments"),
    "/erm/rcsa": ("Risk Management", "RCSA"),
    "/erm/analytics": ("Risk Management", "Advanced Analytics"),
    "/erm/internal-controls": ("Risk Management", "Internal Controls"),
    "/erm/mitigation-actions": ("Risk Management", "Mitigation Actions"),
    "/erm/reviews": ("Risk Management", "Risk Reviews"),
    "/advanced-erm/reviews": ("Risk Management", "Risk Reviews"),
    "/erm/appetite": ("Risk Management", "Risk Appetite"),
    "/advanced-erm/appetite": ("Risk Management", "Risk Appetite"),
    "/erm/dependencies": ("Risk Management", "Dependencies"),
    "/advanced-erm/dependencies": ("Risk Management", "Dependencies"),
    "/erm/scales": ("Risk Management", "Risk Framework"),
    "/erm/reports": ("Risk Management", "Risk Framework"),
    "/advanced-erm/reports": ("Risk Management", "Risk Framework"),
    "/erm/quantification": ("Risk Management", "Quantification"),
    "/erm/ctem": ("Risk Management", "Threat Exposure (CTEM)"),
    # Third-Party Vendor Risk
    "/vendor-risk": ("Third-Party Vendor Risk", "Vendors"),
    "/vendor-risk/assessments": ("Third-Party Vendor Risk", "Vendor Assessments"),
    "/vendor-risk/tpra": ("Third-Party Vendor Risk", "Third-Party Risk Assessments"),
    "/vendor-risk/questionnaires": ("Third-Party Vendor Risk", "Questionnaires"),
    "/vendor-risk/questionnaire-templates": ("Third-Party Vendor Risk", "Questionnaires"),
    "/vendor-risk/questionnaire-responses": ("Third-Party Vendor Risk", "Questionnaires"),
    # Compliance Management
    "/compliance": ("Compliance Management", "Overview"),
    "/compliance/policies": ("Compliance Management", "Policy Statements"),
    "/frameworks": ("Compliance Management", "Frameworks"),
    "/framework-upload": ("Compliance Management", "Frameworks"),
    "/framework-templates": ("Compliance Management", "Frameworks"),
    "/controls": ("Compliance Management", "Framework Controls"),
    "/control-library": ("Compliance Management", "Control Library"),
    "/certifications": ("Compliance Management", "Certifications"),
    "/evidence": ("Compliance Management", "Evidence Management"),
    "/evidence-mgmt": ("Compliance Management", "Evidence Management"),
    "/artifacts": ("Compliance Management", "Evidence Management"),
    "/access-reviews": ("Compliance Management", "Access Reviews"),
    "/governance/regulatory-changes": ("Compliance Management", "Regulatory Changes"),
    "/governance/regulatory-feeds": ("Compliance Management", "Regulatory Feeds"),
    # Assessments (the page is refined by format, see assessment_page)
    "/compliance/assessments": ("Assessments", "Overview"),
    "/compliance/nca": ("Assessments", "NCA"),
    "/risks/nca": ("Assessments", "NCA"),
    "/vulnerabilities/nca": ("Assessments", "NCA"),
    "/framework-upload/assessment": ("Assessments", "Framework Assessments"),
    # Business Continuity
    "/bcm": ("Business Continuity", "Overview"),
    "/bcm/plans": ("Business Continuity", "Continuity Plans"),
    "/bcm/bia": ("Business Continuity", "Continuity Plans"),
    "/bcm/dependencies": ("Business Continuity", "Continuity Plans"),
    "/bcm/recovery-strategies": ("Business Continuity", "Continuity Plans"),
    "/bcm/drills": ("Business Continuity", "Drills & Invocations"),
    "/bcm/findings": ("Business Continuity", "Drills & Invocations"),
    # Controls Automation
    "/automation": ("Controls Automation", "Common Controls"),
    "/scf": ("Controls Automation", "Common Controls"),
    "/scf/scopes": ("Controls Automation", "Scope"),
    "/scf/custom-controls": ("Controls Automation", "Custom Controls"),
    "/scf/audit-periods": ("Controls Automation", "Audit Periods"),
    # Issue & Incident Management
    "/issue-management": ("Issue & Incident Management", "Issues"),
    "/erm/incidents": ("Issue & Incident Management", "Incidents"),
    "/advanced-erm/incidents": ("Issue & Incident Management", "Incidents"),
    # Cybersecurity Assurance
    "/discovery": ("Cybersecurity Assurance", "IT Asset Discovery"),
    "/onboarding": ("Cybersecurity Assurance", "IT Asset Discovery"),
    "/assets": ("Cybersecurity Assurance", "IT Asset Inventory"),
    "/notes": ("Cybersecurity Assurance", "IT Asset Inventory"),
    "/history": ("Cybersecurity Assurance", "IT Asset Inventory"),
    "/asset-alerts": ("Cybersecurity Assurance", "IT Asset Inventory"),
    "/asset-relationship-types": ("Cybersecurity Assurance", "IT Asset Inventory"),
    "/criticality-assessments": ("Cybersecurity Assurance", "Criticality Assessments"),
    "/risk-posture": ("Cybersecurity Assurance", "Assets Risk Posture"),
    "/vuln-management": ("Cybersecurity Assurance", "Vulnerabilities"),
    "/vulnerabilities": ("Cybersecurity Assurance", "Vulnerabilities"),
    "/integrations": ("Cybersecurity Assurance", "Vulnerability Scanning"),
    # Auditor Portal
    "/auditor-portal": ("Auditor Portal", "Portal"),
    "/auditor-portal/statutory-audit": ("Auditor Portal", "Statutory Audit"),
    # Critical Tasks
    "/critical-tasks": ("Critical Tasks", "Critical Tasks"),
    # Reports
    "/reporting": ("Reports", "Analytics"),
    "/reporting/reports": ("Reports", "Saved exports"),
    "/analytics": ("Reports", "Analytics"),
    "/search": ("Reports", "Search"),
    # AI Assistant
    "/ai": ("AI Assistant", "ComplyChat"),
    "/ai-recommendations": ("AI Assistant", "Saved AI Recommendations"),
    # Administration
    "/admin": ("Administration", "Company"),
    "/admin/organization": ("Administration", "Company"),
    "/tenants": ("Administration", "Company"),
    "/admin/users": ("Administration", "User Management"),
    "/admin/roles": ("Administration", "Role Management"),
    "/admin/permissions": ("Administration", "Role Management"),
    "/admin/teams": ("Administration", "Teams"),
    "/admin/password-policy": ("Administration", "Password Policy"),
    "/admin/ai-usage": ("Administration", "Token usage"),
    "/admin/usage": ("Administration", "Usage Monitoring"),
    "/admin/audit-logs": ("Administration", "Audit Logs"),
    "/auth": ("Administration", "Sign-in"),
    "/sso": ("Administration", "Identity Providers"),
    "/auth/entra": ("Administration", "Identity Providers"),
    "/cloud-connectors": ("Administration", "Cloud Connectors"),
    "/connectors": ("Administration", "Connectors"),
    "/compliance-plugins": ("Administration", "Connections"),
    "/connect-wizard": ("Administration", "Connections"),
    "/agents": ("Administration", "Compliance Agents"),
    "/agent": ("Administration", "Compliance Agents"),
    "/workflow-engine": ("Administration", "Workflow Engine"),
    "/tasks": ("Administration", "Background Jobs"),
}
_PREFIXES = sorted(BY_PREFIX, key=len, reverse=True)

# Background job modules (grc/tasks) → the place of the records they change.
JOB_PLACES: Dict[str, Place] = {
    "grc.tasks.ai_drafting": ("Governance", "Documents"),
    "grc.tasks.governance": ("Governance", "Documents"),
    "grc.tasks.exceptions": ("Governance", "Policy Exceptions"),
    "grc.tasks.frameworks": ("Compliance Management", "Frameworks"),
    "grc.tasks.control_library": ("Compliance Management", "Control Library"),
    "grc.tasks.scf": ("Controls Automation", "Common Controls"),
    "grc.tasks.tprm": ("Third-Party Vendor Risk", "Third-Party Risk Assessments"),
    "grc.tasks.audit_register": ("Auditor Portal", "Issue Register"),
    "grc.tasks.vulnerabilities": ("Cybersecurity Assurance", "Vulnerabilities"),
    "grc.tasks.patch_intel": ("Cybersecurity Assurance", "Vulnerabilities"),
    "grc.tasks.discovery": ("Cybersecurity Assurance", "IT Asset Discovery"),
    "grc.tasks.cloud_sync": ("Administration", "Cloud Connectors"),
    "grc.tasks.connectors": ("Administration", "Connectors"),
    "grc.tasks.evidence_collectors": ("Administration", "Connections"),
}

CYBER_SECURITY_FORMATS = {
    "asvs_checklist", "owasp_v4_testing_checklist", "mobile_app_security",
    "csir_maturity", "cti_maturity", "incident_maturity", "itsecops_maturity",
}
_FORMAT_PAGES = {
    "digital_ops_maturity": ("Assessments", "Digital Operations Maturity"),
    "dpia_pia": ("Assessments", "DPIA / PIA"),
    "pdpl_assessment_toolkit": ("Assessments", "Saudi PDPL"),
    "kpi_report": ("Governance", "KPI Report"),
}


def strip_mount(path: str) -> str:
    path = path or ""
    return path[4:] if path.startswith("/grc/") or path == "/grc" else path


def place_path(path: str) -> Optional[Place]:
    """The place a URL alone gives, or None."""
    p = strip_mount(path).rstrip("/") or "/"
    for prefix in _PREFIXES:
        if p == prefix or p.startswith(prefix + "/"):
            return BY_PREFIX[prefix]
    return None


def assessment_place(fmt: Optional[str]) -> Optional[Place]:
    fmt = (fmt or "").strip().lower()
    if not fmt:
        return None
    if fmt in CYBER_SECURITY_FORMATS:
        return ("Assessments", "Cyber Security")
    if fmt.startswith("nca_"):
        return ("Assessments", "NCA")
    return _FORMAT_PAGES.get(fmt, ("Assessments", "Other Assessments"))


# (tenant slug, "a"|"i", id) → format; formats never change once set.
_FORMAT_CACHE: "OrderedDict[tuple, Optional[str]]" = OrderedDict()
_ASSESSMENT_ID = re.compile(r"^/compliance/assessments/(\d+)(?:/|$)")
_ITEM_ID = re.compile(r"^/compliance/assessments/items/(\d+)(?:/|$)")


def _assessment_format(db, slug: str, path: str, payload: Any, query: Any) -> Optional[str]:
    for source in (payload, query):
        if isinstance(source, dict) and isinstance(source.get("assessment_format"), str):
            return source["assessment_format"]
    p = strip_mount(path)
    item = _ITEM_ID.match(p)
    whole = None if item else _ASSESSMENT_ID.match(p)
    if db is None or not (item or whole):
        return None
    key = (slug, "i" if item else "a", int((item or whole).group(1)))
    if key in _FORMAT_CACHE:
        return _FORMAT_CACHE[key]
    from .models import ComplianceAssessmentDocument, ComplianceAssessmentDocumentItem
    try:
        q = db.query(ComplianceAssessmentDocument.assessment_format)
        if item:
            q = q.join(ComplianceAssessmentDocumentItem,
                       ComplianceAssessmentDocumentItem.assessment_id == ComplianceAssessmentDocument.id
                       ).filter(ComplianceAssessmentDocumentItem.id == key[2])
        else:
            q = q.filter(ComplianceAssessmentDocument.id == key[2])
        row = q.first()
    except Exception:  # noqa: BLE001 — a label is never worth failing the audit write
        return None
    fmt = row[0] if row else None
    _FORMAT_CACHE[key] = fmt
    if len(_FORMAT_CACHE) > 5000:
        _FORMAT_CACHE.popitem(last=False)
    return fmt


def place(endpoint: Optional[str], path: str, *, db=None, slug: str = "",
          payload: Any = None, query: Any = None) -> Place:
    """(module, sub-module) for a request: its route file, else its URL, else
    the URL's first segment."""
    file = (endpoint or "").split(":", 1)[0]
    found = BY_FILE.get(file) or place_path(path)
    if found and found[0] == "Assessments" and found[1] == "Overview":
        found = assessment_place(_assessment_format(db, slug, path, payload, query)) or found
    if found:
        return found
    first = next((s for s in strip_mount(path).split("/") if s), "")
    return ("System", first.replace("-", " ").title() if first else "Platform")


def modules() -> List[Dict[str, Any]]:
    """Every module with its sub-modules, in sidebar order — the filter lists."""
    pages: "OrderedDict[str, list]" = OrderedDict((m, []) for m in MODULE_ORDER)
    places = list(BY_FILE.values()) + list(BY_PREFIX.values()) + list(_FORMAT_PAGES.values()) + list(
        JOB_PLACES.values()) + [("Assessments", "Cyber Security"), ("Assessments", "Other Assessments")]
    for module, page in places:
        bucket = pages.setdefault(module, [])
        if page not in bucket:
            bucket.append(page)
    return [{"module": m, "submodules": sorted(p, key=lambda s: (s != "Overview", s))} for m, p in pages.items() if p]


def legacy_prefixes(module: str, submodule: Optional[str] = None) -> Tuple[List[str], List[str]]:
    """URL prefixes of a module (or one sub-module), and the longer prefixes
    under them that belong elsewhere — to find rows written before rows named
    their module."""
    def mine(place: Place) -> bool:
        return place[0] == module and (submodule is None or place[1] == submodule)

    include = [p for p, where in BY_PREFIX.items() if mine(where)]
    exclude = [q for q, where in BY_PREFIX.items() if not mine(where)
               and any(q.startswith(p + "/") for p in include)]
    return include, exclude
