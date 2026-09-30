"""Provider catalogue — what each provider needs and its safe defaults.

Drives the Settings UI (fields rendered from here) and the connection service.
Host/path details marked UNVERIFIED in docs/thomson-reuters-integration-plan.md
§3 are configurable per connection, so a correction never needs a deploy.
"""
from __future__ import annotations

from typing import Dict, List

from ..models import TR_PROVIDER_WC1, TR_PROVIDER_CLEAR, TR_PROVIDER_TRRI

# Default mapping of a POSITIVE screening resolution → TPRA finding (decision Q6 /
# plan §6.3). As everywhere in TPRA, a CRITICAL finding is a failed critical control:
# the existing gate engine (count_open_critical) blocks the findings + approval gates
# on it, and enforce_critical_invariant suspends an already-onboarded vendor (G).
DEFAULT_FINDING_MAP: Dict[str, dict] = {
    "sanctions":       {"severity": "critical", "domain": "compliance"},
    "law_enforcement": {"severity": "high",     "domain": "compliance"},
    "pep":             {"severity": "high",     "domain": "compliance"},
    "adverse_media":   {"severity": "medium",   "domain": "reputational"},
    "other":           {"severity": "medium",   "domain": "compliance"},
}

# Monitoring-signal severity for a NEW ongoing-screening match, by hit class.
SIGNAL_SEVERITY: Dict[str, str] = {
    "sanctions": "critical", "law_enforcement": "high", "pep": "high",
    "adverse_media": "medium", "other": "low",
}


def _f(key, label, kind="text", secret=False, required=True, help_text=None, options=None, default=None):
    return {
        "key": key, "label": label, "kind": kind, "secret": secret, "required": required,
        "help_text": help_text, "options": options or [], "default": default,
    }


PROVIDERS: Dict[str, dict] = {
    TR_PROVIDER_WC1: {
        "provider": TR_PROVIDER_WC1,
        "label": "World-Check One",
        "vendor": "LSEG (formerly Thomson Reuters / Refinitiv)",
        "category": "screening",
        "module": "tprm",
        "description": "Sanctions, PEP, law-enforcement and adverse-media screening of vendors "
                       "and their key people, with ongoing screening.",
        "default_base_url": "https://api-worldcheck.refinitiv.com/v2",
        "credential_fields": [
            _f("api_key", "API key", "password", secret=True),
            _f("api_secret", "API secret", "password", secret=True),
        ],
        "config_fields": [
            _f("group_id", "Screening group ID", required=False,
               help_text="World-Check One group used for new cases. Use 'Load groups' after saving credentials."),
            _f("auto_screen_at_dd", "Auto-screen when a vendor enters Due Diligence Planning", "toggle",
               required=False, default=True),
            _f("ongoing_screening_tiers", "Enable ongoing screening for tiers", "multiselect", required=False,
               options=[{"value": t, "label": t.title()} for t in ("critical", "high", "medium", "low")],
               default=["critical", "high"]),
            _f("finding_map", "Positive match → finding mapping", "finding_map", required=False,
               help_text="Severity and risk domain of the finding raised per hit class. A critical "
                         "finding blocks the Findings and Approval gates."),
        ],
        "docs_url": "https://developers.lseg.com/en/api-catalog/customer-and-third-party-screening/world-check-one-api",
    },
    TR_PROVIDER_CLEAR: {
        "provider": TR_PROVIDER_CLEAR,
        "label": "CLEAR",
        "vendor": "Thomson Reuters",
        "category": "enrichment",
        "module": "tprm",
        "description": "Due-diligence enrichment from public records — registrations, liens, judgments, "
                       "bankruptcies, lawsuits and Risk Inform flags (strongest US coverage).",
        # UNVERIFIED production host — the beta host is s2s.beta.thomsonreuters.com.
        "default_base_url": "https://s2s.thomsonreuters.com",
        "credential_fields": [
            _f("client_cert_pem", "Client certificate (PEM)", "textarea", secret=True,
               help_text="Certificate issued with your CLEAR S2S account."),
            _f("client_key_pem", "Client private key (PEM)", "textarea", secret=True),
            _f("username", "Username", "text", secret=True, required=False),
            _f("password", "Password", "password", secret=True, required=False),
        ],
        "config_fields": [
            _f("default_glb_purpose", "Default GLB permissible purpose", required=False),
            _f("default_dppa_purpose", "Default DPPA permissible purpose", required=False),
            _f("search_path", "Search endpoint path", required=False, default="/v3/business/searchResults",
               help_text="From your CLEAR S2S guide (UNVERIFIED default)."),
            _f("report_path", "Report endpoint path", required=False, default="/v3/business/reportResults",
               help_text="From your CLEAR S2S guide (UNVERIFIED default)."),
        ],
        "docs_url": "https://developerportal.thomsonreuters.com/clear-system-system",
    },
    TR_PROVIDER_TRRI: {
        "provider": TR_PROVIDER_TRRI,
        "label": "Regulatory Intelligence",
        "vendor": "Thomson Reuters",
        "category": "regulatory_content",
        "module": "governance",
        "description": "Regulatory change alerts and documents from global regulators, fed into "
                       "Governance → Regulatory Feeds / Changes.",
        "default_base_url": "https://api.thomsonreuters.com/regulatory-intelligence/v1",
        "credential_fields": [
            _f("client_id", "API key (client ID)", "password", secret=True),
            _f("client_secret", "API secret", "password", secret=True),
        ],
        "config_fields": [
            _f("token_url", "OAuth token URL", "url", required=False,
               help_text="Leave blank to use <base URL>/oauth2/token."),
            _f("documents_path", "Documents endpoint path", required=False, default="/documents",
               help_text="From your Regulatory Intelligence API docs (UNVERIFIED default)."),
        ],
        "docs_url": "https://developerportal.thomsonreuters.com/regulatory-intelligence/getting_started/about-the-regulatory-intelligence-api",
    },
}


def provider_meta(provider: str) -> dict:
    meta = PROVIDERS.get(provider)
    if not meta:
        raise KeyError(provider)
    return meta


def list_providers(module: str = None) -> List[dict]:
    return [p for p in PROVIDERS.values() if module is None or p["module"] == module]


def config_defaults(provider: str) -> dict:
    return {f["key"]: f["default"] for f in provider_meta(provider)["config_fields"] if f["default"] is not None}
