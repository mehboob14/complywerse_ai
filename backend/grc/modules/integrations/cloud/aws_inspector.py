"""Phase 7 — AWS Inspector v2 connector.

Pulls findings from AWS Inspector across one-or-more regions of a single
account. Auth path is cross-account STS assume-role with an external ID:
the operator pastes the role ARN + external ID into the admin page, AWS
assumes the role on every sync, and the temporary credentials never get
persisted.

What this adapter does on `sync()`:

  1. Assumes the customer role.
  2. For every region in `credentials.regions`:
       - Lists EC2 instances + ECR repos + Lambda functions (so we can
         upsert assets even if Inspector hasn't yet generated findings).
       - Lists Inspector findings via `inspector2:ListFindings`, filtered
         to `severity != INFORMATIONAL` to keep volume sane.
  3. Upserts assets through `services.normalized_assets.upsert_cloud_asset`
     so dedup + manual-field preservation rules apply.
  4. Upserts findings through `upsert_cloud_vulnerability` and links each
     to its asset.

Failure mode: `boto3` is an optional dependency. If it isn't installed we
return `health="error"` from `health_check()` with a clear "boto3 not
installed" message, and `sync()` returns an empty result with the same
error tag. The deployment that wants cloud sync runs
`pip install boto3 botocore` and restarts the worker.

Performance: pagination via `paginate()` is mandatory on accounts with
100k+ findings. `MaxResults=100` per page is the documented sweet spot.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional
import re

from sqlalchemy.orm import Session

from .base import (
    CloudConnectorBase,
    ConnectorCredentialsInvalid,
    ConnectorHealth,
    ConnectorSyncResult,
)

logger = logging.getLogger(__name__)

_ROLE_ARN_RE = re.compile(r"^arn:aws:iam::\d{12}:role/[A-Za-z0-9+=,.@/_-]+$")
_REGION_RE = re.compile(r"^[a-z]{2}-[a-z]+-\d+$")

# AWS Inspector → our internal severity map. Inspector returns
# {INFORMATIONAL, LOW, MEDIUM, HIGH, CRITICAL, UNTRIAGED}.
_AWS_SEVERITY_MAP = {
    "CRITICAL": "critical",
    "HIGH": "high",
    "MEDIUM": "medium",
    "LOW": "low",
    "INFORMATIONAL": "info",
    "UNTRIAGED": "medium",
}


def _try_import_boto3():
    """Return (boto3, botocore_exceptions) or (None, None) when not installed."""
    try:
        import boto3  # type: ignore
        from botocore.exceptions import BotoCoreError, ClientError  # type: ignore
        return boto3, (BotoCoreError, ClientError)
    except Exception:
        return None, None


class AwsInspectorConnector(CloudConnectorBase):
    provider = "aws_inspector"
    display_label = "AWS Inspector v2"

    credentials_schema = {
        "type": "object",
        "required": ["role_arn", "external_id", "regions"],
        "properties": {
            "role_arn": {"type": "string"},
            "external_id": {"type": "string"},
            "regions": {"type": "array", "items": {"type": "string"}},
            "session_name": {"type": "string"},
        },
    }

    # ── Credential validation ────────────────────────────────────────────

    def validate_credentials(self, payload: Dict[str, Any]) -> None:
        if not isinstance(payload, dict):
            raise ConnectorCredentialsInvalid("Credentials must be a JSON object.")
        role_arn = (payload.get("role_arn") or "").strip()
        external_id = (payload.get("external_id") or "").strip()
        regions = payload.get("regions") or []

        if not _ROLE_ARN_RE.match(role_arn):
            raise ConnectorCredentialsInvalid(
                "role_arn must look like 'arn:aws:iam::<12-digit-account>:role/<name>'."
            )
        if not external_id:
            raise ConnectorCredentialsInvalid("external_id is required.")
        if not isinstance(regions, list) or not regions:
            raise ConnectorCredentialsInvalid("At least one AWS region is required.")
        for region in regions:
            if not isinstance(region, str) or not _REGION_RE.match(region):
                raise ConnectorCredentialsInvalid(
                    f"Region {region!r} doesn't match the AWS region pattern (e.g. us-east-1)."
                )

    # ── Auth helper ──────────────────────────────────────────────────────

    def _assume_role(self, boto3):
        """Return assumed-role temporary credentials, or raise."""
        sts = boto3.client("sts")
        resp = sts.assume_role(
            RoleArn=self.credentials["role_arn"],
            ExternalId=self.credentials["external_id"],
            RoleSessionName=(self.credentials.get("session_name") or "grc-inspector-sync")[:64],
            DurationSeconds=3600,
        )
        creds = resp["Credentials"]
        return {
            "aws_access_key_id": creds["AccessKeyId"],
            "aws_secret_access_key": creds["SecretAccessKey"],
            "aws_session_token": creds["SessionToken"],
        }

    # ── Health check ─────────────────────────────────────────────────────

    def health_check(self) -> ConnectorHealth:
        try:
            self.validate_credentials(self.credentials)
        except ConnectorCredentialsInvalid as exc:
            return ConnectorHealth(
                status="error", detail=str(exc),
                checked_at=datetime.utcnow().isoformat(),
            )

        boto3, errs = _try_import_boto3()
        if boto3 is None:
            return ConnectorHealth(
                status="error",
                detail=("boto3 is not installed on this backend. "
                        "Install boto3 + botocore in the worker image to enable AWS sync."),
                checked_at=datetime.utcnow().isoformat(),
            )

        # Real probe — assume the role and call STS GetCallerIdentity on
        # the assumed session. Fast, cheap, exercises the trust policy.
        try:
            temp = self._assume_role(boto3)
            session = boto3.Session(**temp)
            sts = session.client("sts")
            ident = sts.get_caller_identity()
            return ConnectorHealth(
                status="ok",
                detail=f"Assumed {ident.get('Arn', '?')}",
                checked_at=datetime.utcnow().isoformat(),
            )
        except errs as exc:  # type: ignore[misc]
            return ConnectorHealth(
                status="error",
                detail=f"AWS API error: {exc.__class__.__name__}",
                checked_at=datetime.utcnow().isoformat(),
            )
        except Exception as exc:
            return ConnectorHealth(
                status="error",
                detail=f"Unexpected error: {exc.__class__.__name__}",
                checked_at=datetime.utcnow().isoformat(),
            )

    # ── Sync ─────────────────────────────────────────────────────────────

    def sync(self, db: Session) -> ConnectorSyncResult:
        from ....models import CloudConnector
        from ....services.normalized_assets import (
            upsert_cloud_asset,
            upsert_cloud_vulnerability,
        )

        result = ConnectorSyncResult()
        boto3, errs = _try_import_boto3()
        if boto3 is None:
            result.errors.append("boto3_not_installed")
            return result

        # We need tenant_id off the CloudConnector row to thread through
        # the upsert helpers.
        connector = db.query(CloudConnector).filter(
            CloudConnector.id == self.connector_id,
        ).first()
        if not connector:
            result.errors.append("connector_row_not_found")
            return result
        tenant_id = connector.tenant_id

        # Single assume-role session reused across regions.
        try:
            temp = self._assume_role(boto3)
        except Exception as exc:
            result.errors.append(f"assume_role_failed:{exc.__class__.__name__}")
            return result
        session = boto3.Session(**temp)

        for region in self.credentials.get("regions") or []:
            try:
                self._sync_region(
                    db, session, region, tenant_id, result,
                    upsert_cloud_asset, upsert_cloud_vulnerability,
                )
            except Exception as exc:
                logger.exception("AWS Inspector region sync failed: %s", region)
                result.errors.append(f"region_{region}:{exc.__class__.__name__}")

        try:
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("AWS Inspector sync commit failed")
            result.errors.append("commit_failed")

        return result

    def _sync_region(
        self, db, session, region: str, tenant_id: int,
        result: ConnectorSyncResult,
        upsert_cloud_asset, upsert_cloud_vulnerability,
    ) -> None:
        # ── 1. Assets: EC2 + ECR + Lambda ─────────────────────────────
        ec2 = session.client("ec2", region_name=region)
        asset_index: Dict[str, int] = {}  # arn → ITAsset.id

        try:
            paginator = ec2.get_paginator("describe_instances")
            for page in paginator.paginate():
                for reservation in page.get("Reservations", []):
                    for inst in reservation.get("Instances", []):
                        arn = f"aws:ec2:{region}:{inst['InstanceId']}"
                        name_tag = next(
                            (t.get("Value") for t in (inst.get("Tags") or [])
                             if t.get("Key") == "Name"),
                            inst["InstanceId"],
                        )
                        asset, was_new = upsert_cloud_asset(
                            db,
                            tenant_id=tenant_id,
                            source="aws_inspector",
                            cloud_resource_id=arn,
                            name=name_tag or inst["InstanceId"],
                            asset_type="cloud",
                            ip_address=inst.get("PrivateIpAddress"),
                            vendor="aws",
                            location=region,
                        )
                        if was_new:
                            result.assets_new += 1
                        else:
                            result.assets_updated += 1
                        asset_index[arn] = asset.id
        except Exception as exc:
            logger.warning("EC2 describe failed in %s: %s", region, exc)
            result.errors.append(f"ec2_{region}:{exc.__class__.__name__}")

        # ECR repositories — less common; tolerate failure.
        try:
            ecr = session.client("ecr", region_name=region)
            paginator = ecr.get_paginator("describe_repositories")
            for page in paginator.paginate():
                for repo in page.get("repositories", []):
                    arn = f"aws:ecr:{region}:{repo['repositoryName']}"
                    asset, was_new = upsert_cloud_asset(
                        db,
                        tenant_id=tenant_id,
                        source="aws_inspector",
                        cloud_resource_id=arn,
                        name=repo.get("repositoryName"),
                        asset_type="cloud",
                        vendor="aws",
                        location=region,
                    )
                    if was_new:
                        result.assets_new += 1
                    else:
                        result.assets_updated += 1
                    asset_index[repo.get("repositoryArn", arn)] = asset.id
        except Exception:
            logger.debug("ECR describe skipped in %s", region)

        # Lambda functions.
        try:
            lam = session.client("lambda", region_name=region)
            paginator = lam.get_paginator("list_functions")
            for page in paginator.paginate():
                for fn in page.get("Functions", []):
                    arn = fn.get("FunctionArn") or f"aws:lambda:{region}:{fn['FunctionName']}"
                    asset, was_new = upsert_cloud_asset(
                        db,
                        tenant_id=tenant_id,
                        source="aws_inspector",
                        cloud_resource_id=arn,
                        name=fn.get("FunctionName"),
                        asset_type="cloud",
                        vendor="aws",
                        location=region,
                    )
                    if was_new:
                        result.assets_new += 1
                    else:
                        result.assets_updated += 1
                    asset_index[arn] = asset.id
        except Exception:
            logger.debug("Lambda list skipped in %s", region)

        # ── 2. Inspector findings ─────────────────────────────────────
        try:
            inspector = session.client("inspector2", region_name=region)
        except Exception as exc:
            # Inspector v2 may not be available in every region.
            result.errors.append(f"inspector_client_{region}:{exc.__class__.__name__}")
            return

        try:
            paginator = inspector.get_paginator("list_findings")
            filter_criteria = {
                "severity": [
                    {"comparison": "EQUALS", "value": s}
                    for s in ("CRITICAL", "HIGH", "MEDIUM", "LOW")
                ],
                "findingStatus": [{"comparison": "EQUALS", "value": "ACTIVE"}],
            }
            for page in paginator.paginate(
                filterCriteria=filter_criteria,
                PaginationConfig={"PageSize": 100},
            ):
                for finding in page.get("findings", []):
                    self._upsert_one_finding(
                        db, tenant_id, finding, asset_index,
                        result, upsert_cloud_vulnerability,
                    )
        except Exception as exc:
            result.errors.append(f"inspector_list_{region}:{exc.__class__.__name__}")

    def _upsert_one_finding(
        self, db, tenant_id: int, finding: Dict[str, Any],
        asset_index: Dict[str, int],
        result: ConnectorSyncResult,
        upsert_cloud_vulnerability,
    ) -> None:
        finding_arn = finding.get("findingArn") or finding.get("findingId")
        if not finding_arn:
            result.errors.append("finding_missing_id")
            return

        # CVE: Inspector returns packageVulnerabilityDetails with a `vulnerabilityId`
        # that is typically a CVE ID.
        pkg = finding.get("packageVulnerabilityDetails") or {}
        cve_id = pkg.get("vulnerabilityId")
        if cve_id and not cve_id.upper().startswith("CVE-"):
            # Non-CVE vuln IDs (e.g. CWE-style) — keep but don't claim as CVE.
            cve_id = None

        # Severity normalisation.
        sev_raw = (finding.get("severity") or "").upper()
        severity = _AWS_SEVERITY_MAP.get(sev_raw, "medium")
        cvss_score: Optional[float] = None
        cvss_vector: Optional[str] = None
        for cvss in (finding.get("cvssScores") or []):
            if cvss.get("source") == "NVD" and cvss.get("version", "").startswith("3"):
                cvss_score = cvss.get("baseScore")
                cvss_vector = cvss.get("scoringVector")
                break
        if cvss_score is None:
            cvss_score = finding.get("inspectorScore")

        # Asset link: Inspector identifies the affected resource by ARN
        # under `resources[].id`. Map back to our upserted ITAsset.
        asset_id: Optional[int] = None
        affected_host: Optional[str] = None
        for res in (finding.get("resources") or []):
            res_id = res.get("id")
            if not res_id:
                continue
            # Try our index first (exact ARN); fall back to a soft prefix
            # match for `aws:ec2:...:<instance-id>` shape.
            asset_id = asset_index.get(res_id)
            if asset_id:
                affected_host = res_id
                break
            # Soft prefix scan — instance IDs frequently match.
            for key in asset_index:
                if key.endswith(":" + res_id) or key == res_id:
                    asset_id = asset_index[key]
                    affected_host = key
                    break
            if asset_id:
                break

        try:
            _v, was_new = upsert_cloud_vulnerability(
                db,
                tenant_id=tenant_id,
                source="aws_inspector",
                cve_id=cve_id,
                title=finding.get("title") or cve_id or "AWS Inspector finding",
                description=finding.get("description"),
                severity=severity,
                cvss_score=cvss_score,
                cvss_vector=cvss_vector,
                affected_component=pkg.get("name") or pkg.get("filePath"),
                affected_host=affected_host,
                asset_id=asset_id,
                external_id=finding_arn[:50],
            )
            if was_new:
                result.vulnerabilities_new += 1
            else:
                result.vulnerabilities_updated += 1
        except Exception as exc:
            result.errors.append(f"finding_upsert_failed:{exc.__class__.__name__}")
