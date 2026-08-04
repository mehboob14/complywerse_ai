"""Phase 7 — Google Cloud Security Command Center connector.

Pulls findings from GCP SCC at the organisation level. Requires SCC
Premium tier — the standard tier doesn't expose findings via API.

Auth: GCP service account JSON. The operator pastes the SA key JSON into
the admin page; we encrypt and store. On every sync we instantiate the
SCC client with `service_account.Credentials.from_service_account_info`.

Optional dependencies: `google-cloud-securitycenter`. When absent,
`health_check` and `sync` return a clean "GCP SDK not installed" signal.

Configuration:
  * `service_account_json` (string, the SA key contents)
  * `organization_id` (string, e.g. "123456789012")
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from .base import (
    CloudConnectorBase,
    ConnectorCredentialsInvalid,
    ConnectorHealth,
    ConnectorSyncResult,
)

logger = logging.getLogger(__name__)

# SCC severities → our scale. Note GCP uses CRITICAL/HIGH/MEDIUM/LOW.
_GCP_SEVERITY_MAP = {
    "CRITICAL": "critical",
    "HIGH": "high",
    "MEDIUM": "medium",
    "LOW": "low",
    "SEVERITY_UNSPECIFIED": "medium",
}


def _try_import_gcp():
    try:
        from google.cloud import securitycenter_v1  # type: ignore
        from google.oauth2 import service_account  # type: ignore
        from google.api_core import exceptions as gerr  # type: ignore
        return {
            "securitycenter": securitycenter_v1,
            "service_account": service_account,
            "errors": (gerr.GoogleAPIError,),
        }
    except Exception:
        return None


class GcpSccConnector(CloudConnectorBase):
    provider = "gcp_scc"
    display_label = "Google Cloud Security Command Center (Premium)"

    credentials_schema = {
        "type": "object",
        "required": ["service_account_json", "organization_id"],
        "properties": {
            "service_account_json": {"type": "string", "description": "Service account key JSON contents."},
            "organization_id": {"type": "string", "description": "GCP organisation ID (digits only)."},
        },
    }

    def validate_credentials(self, payload: Dict[str, Any]) -> None:
        if not isinstance(payload, dict):
            raise ConnectorCredentialsInvalid("Credentials must be a JSON object.")
        sa = payload.get("service_account_json")
        if not sa or not isinstance(sa, str):
            raise ConnectorCredentialsInvalid("service_account_json is required.")
        try:
            parsed = json.loads(sa)
        except Exception:
            raise ConnectorCredentialsInvalid("service_account_json is not valid JSON.")
        if parsed.get("type") != "service_account":
            raise ConnectorCredentialsInvalid(
                "service_account_json must be a service-account key (type=service_account)."
            )
        org = (payload.get("organization_id") or "").strip()
        if not org or not org.isdigit():
            raise ConnectorCredentialsInvalid(
                "organization_id is required and must be the numeric GCP org ID."
            )

    def _client(self, gcp):
        info = json.loads(self.credentials["service_account_json"])
        creds = gcp["service_account"].Credentials.from_service_account_info(info)
        return gcp["securitycenter"].SecurityCenterClient(credentials=creds)

    def health_check(self) -> ConnectorHealth:
        try:
            self.validate_credentials(self.credentials)
        except ConnectorCredentialsInvalid as exc:
            return ConnectorHealth(status="error", detail=str(exc),
                                   checked_at=datetime.utcnow().isoformat())
        gcp = _try_import_gcp()
        if gcp is None:
            return ConnectorHealth(
                status="error",
                detail="google-cloud-securitycenter is not installed.",
                checked_at=datetime.utcnow().isoformat(),
            )
        try:
            client = self._client(gcp)
            # Probe: list sources at the org. Equivalent of "auth works,
            # we can see SCC".
            parent = f"organizations/{self.credentials['organization_id']}"
            it = client.list_sources(parent=parent)
            _ = next(iter(it), None)
            return ConnectorHealth(
                status="ok",
                detail="GCP SCC reachable.",
                checked_at=datetime.utcnow().isoformat(),
            )
        except gcp["errors"] as exc:  # type: ignore[misc]
            return ConnectorHealth(
                status="error",
                detail=f"GCP API error: {exc.__class__.__name__}",
                checked_at=datetime.utcnow().isoformat(),
            )
        except Exception as exc:
            return ConnectorHealth(
                status="error",
                detail=f"Unexpected error: {exc.__class__.__name__}",
                checked_at=datetime.utcnow().isoformat(),
            )

    def sync(self, db: Session) -> ConnectorSyncResult:
        from ....models import CloudConnector
        from ....services.normalized_assets import (
            upsert_cloud_asset,
            upsert_cloud_vulnerability,
        )

        result = ConnectorSyncResult()
        gcp = _try_import_gcp()
        if gcp is None:
            result.errors.append("gcp_sdk_not_installed")
            return result

        connector = db.query(CloudConnector).filter(
            CloudConnector.id == self.connector_id,
        ).first()
        if not connector:
            result.errors.append("connector_row_not_found")
            return result
        tenant_id = connector.tenant_id

        try:
            client = self._client(gcp)
        except Exception as exc:
            result.errors.append(f"client_init:{exc.__class__.__name__}")
            return result

        org = self.credentials["organization_id"]
        # SCC findings are listed under sources. We list all sources at the
        # org then findings under each.
        parent = f"organizations/{org}"
        try:
            sources = list(client.list_sources(parent=parent))
        except Exception as exc:
            result.errors.append(f"list_sources:{exc.__class__.__name__}")
            return result

        for source in sources:
            source_name = source.name
            try:
                # Filter to active CVE-ish findings. SCC's `findings.filter`
                # syntax is its own DSL; this matches the common case.
                request = {
                    "parent": source_name,
                    "filter": 'state="ACTIVE"',
                }
                page = client.list_findings(request=request)
                for entry in page:
                    try:
                        self._upsert_one(
                            db, tenant_id, entry, result,
                            upsert_cloud_asset, upsert_cloud_vulnerability,
                        )
                    except Exception as exc:
                        result.errors.append(f"finding:{exc.__class__.__name__}")
            except Exception as exc:
                logger.warning("SCC source %s failed: %s", source_name, exc)
                result.errors.append(f"source:{exc.__class__.__name__}")

        try:
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("GCP SCC sync commit failed")
            result.errors.append("commit_failed")

        return result

    def _upsert_one(
        self, db, tenant_id: int, entry, result: ConnectorSyncResult,
        upsert_cloud_asset, upsert_cloud_vulnerability,
    ) -> None:
        # `entry` is a ListFindingsResult; finding lives under .finding.
        finding = getattr(entry, "finding", None) or entry
        resource = getattr(entry, "resource", None)
        finding_name = getattr(finding, "name", None)
        if not finding_name:
            return

        resource_name = getattr(resource, "name", None) or "gcp-resource"
        # Resource name format: `//compute.googleapis.com/projects/<p>/zones/<z>/instances/<i>`
        # Strip leading slashes and keep as cloud_resource_id.
        cloud_resource_id = f"gcp:{resource_name.lstrip('/')}"
        display_name = resource_name.rsplit("/", 1)[-1] if resource_name else "gcp-resource"

        asset, was_new = upsert_cloud_asset(
            db,
            tenant_id=tenant_id,
            source="gcp_scc",
            cloud_resource_id=cloud_resource_id,
            name=display_name,
            asset_type="cloud",
            vendor="gcp",
            location=getattr(resource, "location", None),
        )
        if was_new:
            result.assets_new += 1
        else:
            result.assets_updated += 1

        sev_raw = str(getattr(finding, "severity", "MEDIUM") or "MEDIUM").upper()
        severity = _GCP_SEVERITY_MAP.get(sev_raw, "medium")

        # CVE extraction — sometimes embedded in `external_uri` or
        # `source_properties`. Best-effort.
        cve_id = None
        src_props = getattr(finding, "source_properties", None) or {}
        if isinstance(src_props, dict):
            for v in src_props.values():
                if isinstance(v, str) and v.upper().startswith("CVE-"):
                    cve_id = v.upper()
                    break

        _v, was_new = upsert_cloud_vulnerability(
            db,
            tenant_id=tenant_id,
            source="gcp_scc",
            cve_id=cve_id,
            title=getattr(finding, "category", None) or "GCP SCC finding",
            description=getattr(finding, "description", None),
            severity=severity,
            cvss_score=None,
            cvss_vector=None,
            affected_host=cloud_resource_id,
            asset_id=asset.id,
            external_id=finding_name.rsplit("/", 1)[-1][:50],
        )
        if was_new:
            result.vulnerabilities_new += 1
        else:
            result.vulnerabilities_updated += 1
