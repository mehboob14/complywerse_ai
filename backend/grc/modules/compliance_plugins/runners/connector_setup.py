"""How a customer connects each collector: the credential, where to create it,
the permissions it needs, and the form fields to fill in.

Kept as reviewed data (seed_data/evidence/connector_setup.json), one entry per
provider, written from each vendor's own documentation. A provider without an
entry still gets a correct form, derived from how the collector authenticates.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

from .live_api_catalog import PROVIDER_API

_SETUP_PATH = Path(__file__).resolve().parents[3] / "seed_data" / "evidence" / "connector_setup.json"
#: The fields the connect endpoint stores. `token` and `secret2` are the secrets and
#: are stored encrypted; the others are identifiers (a client ID, a host, a region).
FIELD_KEYS = ("token", "secret2", "domain", "email", "access_key_id", "region")
#: Research notes kept with the reviewed entry for maintainers, not shown to customers.
_INTERNAL = ("sources", "fields", "compatibility", "verified")


@lru_cache(maxsize=1)
def _registry() -> Dict[str, Dict[str, Any]]:
    try:
        data = json.loads(_SETUP_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def connector_setup(provider: str) -> Optional[Dict[str, Any]]:
    """The reviewed setup guide for a provider, without the research trail."""
    entry = _registry().get(provider)
    if not entry:
        return None
    out = {k: v for k, v in entry.items() if k not in _INTERNAL}
    if isinstance(out.get("permissions"), str):
        out["permissions"] = [out["permissions"]]
    return out


def form_fields(provider: str) -> List[Dict[str, Any]]:
    """The fields the connect form asks for, labelled in the provider's own terms."""
    spec = PROVIDER_API.get(provider) or {}
    reviewed = [f for f in (_registry().get(provider) or {}).get("fields") or []
                if isinstance(f, dict) and f.get("key") in FIELD_KEYS]
    if reviewed:
        # a host with a well-known default (GitLab.com, Datadog US1) may be left blank
        fields = [{**f, "required": f.get("required", not (f["key"] == "domain" and spec.get("domain_default")))}
                  for f in reviewed]
        if not any(f["key"] == "token" for f in fields):
            fields.insert(0, {"key": "token", "label": "API token", "required": True})
        return fields

    # No reviewed entry: derive the form from how the collector authenticates.
    fields: List[Dict[str, Any]] = []
    if spec.get("needs_key_id"):
        fields.append({"key": "access_key_id", "label": "Access key ID", "required": True})
    fields.append({"key": "token", "label": "Secret access key" if spec.get("needs_key_id") else "API token",
                   "required": True})
    if "{domain}" in (spec.get("base") or ""):
        fields.append({"key": "domain", "label": "Domain", "required": not spec.get("domain_default"),
                       "help": "Your instance's address, without https://"})
    if spec.get("auth") == "basic":
        fields.append({"key": "email", "label": "Username or email", "required": True})
    if spec.get("needs_region"):
        fields.append({"key": "region", "label": "Region", "required": True, "placeholder": "eu-west-1"})
    return fields


def normalize_domain(provider: str, value: Optional[str]) -> str:
    """What people paste → what the collector substitutes for {domain}.

    A host field keeps only the host ("https://acme.okta.com/admin/" → "acme.okta.com").
    A path-segment field such as Azure DevOps' organization keeps only the segment
    ("https://dev.azure.com/acme" → "acme"). A company-name field inside a host
    keeps only the name ("acme.bamboohr.com" → "acme" for https://{domain}.bamboohr.com).
    """
    v = re.sub(r"^\s*https?://", "", value or "").strip().strip("/")
    spec = PROVIDER_API.get(provider) or {}
    if spec.get("domain_path"):
        return v  # a self-hosted root (Grafana, SigNoz) may live under a path
    head, _, tail = (spec.get("base") or "").partition("{domain}")
    prefix = re.sub(r"^https?://", "", head)
    if prefix and v.startswith(prefix):
        v = v[len(prefix):]
    v = v.split("/")[0]
    host_suffix = tail.split("/")[0]
    if host_suffix and v.endswith(host_suffix):
        v = v[: -len(host_suffix)]
    return v


def missing_fields(provider: str, values: Dict[str, Optional[str]]) -> List[str]:
    """Labels of required fields left empty."""
    return [f["label"] for f in form_fields(provider)
            if f.get("required", True) and not (values.get(f["key"]) or "").strip()]
