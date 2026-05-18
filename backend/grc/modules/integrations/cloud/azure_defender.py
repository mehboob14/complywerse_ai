"""Phase 7 — Microsoft Defender for Cloud connector.

Pulls Defender for Cloud security recommendations + sub-assessments via
`Microsoft.Security/assessments`. CVE-bearing findings live under the
sub-assessments of vulnerability-scanner-style recommendations (e.g.
"Vulnerabilities in Azure Container Registry images should be remediated",
"Vulnerabilities in your virtual machines should be remediated").

Auth: Azure AD client credentials (service principal). The operator pastes
`tenant_id`, `client_id`, `client_secret`, `subscription_id` into the admin
page; we encrypt and store. On every sync we mint a fresh token via
`ClientSecretCredential` (no token caching to disk — the SDK keeps it in
memory for the run).

Optional dependencies: `azure-identity`, `azure-mgmt-security`,
`azure-mgmt-resource`. When absent, `health_check` and `sync` return a
clean "azure SDK not installed" signal rather than crashing.
"""
from __future__ import annotations

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

# Azure Defender severities are Low/Medium/High → map to our scale.
_AZURE_SEVERITY_MAP = {
    "high": "high",
    "medium": "medium",
    "low": "low",
}


def _try_import_azure():
    """Lazy-import the Azure SDKs. Returns a small bag of names or None."""
    try:
        from azure.identity import ClientSecretCredential  # type: ignore
        from azure.mgmt.security import SecurityCenter  # type: ignore
        from azure.mgmt.resource import ResourceManagementClient  # type: ignore
        from azure.core.exceptions import AzureError, HttpResponseError  # type: ignore
        return {
            "ClientSecretCredential": ClientSecretCredential,
            "SecurityCenter": SecurityCenter,
            "ResourceManagementClient": ResourceManagementClient,
            "errors": (AzureError, HttpResponseError),
        }
    except Exception:
        return None


class AzureDefenderConnector(CloudConnectorBase):
    provider = "azure_defender"
    display_label = "Microsoft Defender for Cloud"

    credentials_schema = {
        "type": "object",
        "required": ["tenant_id", "client_id", "client_secret", "subscription_id"],
        "properties": {
            "tenant_id": {"type": "string", "description": "Azure AD tenant ID (UUID)"},
            "client_id": {"type": "string", "description": "Service principal application ID"},
            "client_secret": {"type": "string", "description": "Service principal client secret"},
            "subscription_id": {"type": "string", "description": "Azure subscription ID (UUID)"},
        },
    }

    def validate_credentials(self, payload: Dict[str, Any]) -> None:
        if not isinstance(payload, dict):
            raise ConnectorCredentialsInvalid("Credentials must be a JSON object.")
        for field in ("tenant_id", "client_id", "client_secret", "subscription_id"):
            if not (payload.get(field) or "").strip():
                raise ConnectorCredentialsInvalid(f"{field} is required.")
        # Light UUID shape check on tenant_id + subscription_id.
        import re
        uuid_re = re.compile(r"^[0-9a-fA-F-]{8,40}$")
        for field in ("tenant_id", "subscription_id"):
            if not uuid_re.match((payload.get(field) or "").strip()):
                raise ConnectorCredentialsInvalid(
                    f"{field} doesn't look like a valid Azure UUID."
                )

    def _credential(self, azure):
        return azure["ClientSecretCredential"](
            tenant_id=self.credentials["tenant_id"],
            client_id=self.credentials["client_id"],
            client_secret=self.credentials["client_secret"],
        )

    def health_check(self) -> ConnectorHealth:
        try:
            self.validate_credentials(self.credentials)
        except ConnectorCredentialsInvalid as exc:
            return ConnectorHealth(status="error", detail=str(exc),
                                   checked_at=datetime.utcnow().isoformat())

        azure = _try_import_azure()
        if azure is None:
            return ConnectorHealth(
                status="error",
                detail="azure-identity + azure-mgmt-security are not installed.",
                checked_at=datetime.utcnow().isoformat(),
            )
        try:
            cred = self._credential(azure)
            # Probe — list one resource group. Cheap, exercises auth.
            rmc = azure["ResourceManagementClient"](
                cred, self.credentials["subscription_id"],
            )
            _ = next(iter(rmc.resource_groups.list(top=1)), None)
            return ConnectorHealth(
                status="ok",
                detail="Azure credentials accepted; Resource Manager reachable.",
                checked_at=datetime.utcnow().isoformat(),
            )
        except azure["errors"] as exc:  # type: ignore[misc]
            return ConnectorHealth(
                status="error",
                detail=f"Azure error: {exc.__class__.__name__}",
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
        azure = _try_import_azure()
        if azure is None:
            result.errors.append("azure_sdk_not_installed")
            return result

        connector = db.query(CloudConnector).filter(
            CloudConnector.id == self.connector_id,
        ).first()
        if not connector:
            result.errors.append("connector_row_not_found")
            return result
        tenant_id = connector.tenant_id

        sub_id = self.credentials["subscription_id"]
        try:
            cred = self._credential(azure)
            sc = azure["SecurityCenter"](cred, sub_id)
        except Exception as exc:
            result.errors.append(f"client_init:{exc.__class__.__name__}")
            return result

        # Iterate assessments. Only CVE-bearing categories carry sub-assessments
        # with CVE IDs; we look at every assessment and harvest the ones that
        # produce them.
        try:
            assessment_iter = sc.assessments.list(scope=f"/subscriptions/{sub_id}")
            for assessment in assessment_iter:
                try:
                    self._process_assessment(
                        db, sc, sub_id, tenant_id, assessment, result,
                        upsert_cloud_asset, upsert_cloud_vulnerability,
                    )
                except Exception as exc:
                    logger.warning("Azure assessment processing failed: %s", exc)
                    result.errors.append(f"assessment:{exc.__class__.__name__}")
        except Exception as exc:
            result.errors.append(f"list_assessments:{exc.__class__.__name__}")

        try:
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("Azure Defender sync commit failed")
            result.errors.append("commit_failed")

        return result

    def _process_assessment(
        self, db, sc, sub_id: str, tenant_id: int, assessment,
        result: ConnectorSyncResult,
        upsert_cloud_asset, upsert_cloud_vulnerability,
    ) -> None:
        # `assessment.id` looks like
        # /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Compute/virtualMachines/<vm>/providers/Microsoft.Security/assessments/<assid>
        # The owning resource is everything up to `/providers/Microsoft.Security/`.
        full_id: str = getattr(assessment, "id", "") or ""
        if "/providers/Microsoft.Security/" not in full_id:
            return
        resource_id, _, _ = full_id.partition("/providers/Microsoft.Security/")
        resource_name = resource_id.rsplit("/", 1)[-1] if resource_id else None
        if not resource_id or not resource_name:
            return

        # Upsert the asset for this resource.
        asset, was_new = upsert_cloud_asset(
            db,
            tenant_id=tenant_id,
            source="azure_defender",
            cloud_resource_id=f"azure:{resource_id}",
            name=resource_name,
            asset_type="cloud",
            vendor="microsoft",
            location=None,
        )
        if was_new:
            result.assets_new += 1
        else:
            result.assets_updated += 1

        # Pull sub-assessments for finer-grained vuln data (CVEs).
        try:
            sub_iter = sc.sub_assessments.list(
                scope=resource_id,
                assessment_name=getattr(assessment, "name", ""),
            )
        except Exception:
            return

        for sub in sub_iter:
            try:
                self._upsert_subassessment(
                    db, tenant_id, sub, asset.id, result, upsert_cloud_vulnerability,
                )
            except Exception as exc:
                result.errors.append(f"subassessment:{exc.__class__.__name__}")

    def _upsert_subassessment(
        self, db, tenant_id: int, sub, asset_id: int,
        result: ConnectorSyncResult, upsert_cloud_vulnerability,
    ) -> None:
        # Azure returns ProxyResource shape with nested objects. Pull
        # defensively.
        sub_id = getattr(sub, "id", None) or getattr(sub, "name", None)
        if not sub_id:
            return
        display = getattr(sub, "display_name", None) or getattr(sub, "name", None)
        description = getattr(sub, "description", None)
        status = getattr(sub, "status", None)
        sev_raw = getattr(status, "severity", "Medium") if status else "Medium"
        severity = _AZURE_SEVERITY_MAP.get((sev_raw or "").lower(), "medium")
        # additionalData often contains the CVE.
        cve_id = None
        add = getattr(sub, "additional_data", None)
        if add is not None:
            cve_id = getattr(add, "cve", None) or None

        _v, was_new = upsert_cloud_vulnerability(
            db,
            tenant_id=tenant_id,
            source="azure_defender",
            cve_id=(cve_id.upper() if isinstance(cve_id, str) and cve_id.upper().startswith("CVE-") else None),
            title=display or "Azure Defender finding",
            description=description,
            severity=severity,
            cvss_score=None,
            cvss_vector=None,
            affected_host=None,
            asset_id=asset_id,
            external_id=str(sub_id)[:50],
        )
        if was_new:
            result.vulnerabilities_new += 1
        else:
            result.vulnerabilities_updated += 1
