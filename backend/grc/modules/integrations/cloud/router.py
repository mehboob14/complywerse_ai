"""Track A — Admin CRUD for cloud connectors.

This is the API surface the admin page will use to configure connectors.
The actual sync orchestration is deferred to the future PR that pairs the
second adapter with the abstract base; for now operators can:

  * List existing connectors per tenant (`GET /cloud-connectors`).
  * Create a new connector with provider-validated credentials (`POST`).
  * Run a health check on demand (`POST /{id}/health-check`).
  * Disable / re-enable a connector (`POST /{id}/activate`,
    `POST /{id}/deactivate`).
  * Delete a connector (`DELETE`).

What's deliberately NOT here yet:

  * `POST /{id}/sync` — would dispatch a Celery sync job. Held back until
    `bulk_sync` lands so the button doesn't queue a no-op.
  * Per-tenant audit log on credential changes. Existing audit-log machinery
    can wrap these endpoints; we'll plug it in alongside the audit-log
    revamp.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ....models import CloudConnector, GRCUser, IntegrationConnection, get_db
from ....routers.auth_router import (
    require_auth,
    get_user_tenants,
    get_user_primary_tenant,
)
from ....services.connector_credentials import (
    ConnectorCredentialError,
    decrypt_credentials,
    encrypt_credentials,
    has_master_key,
)
from .base import (
    ConnectorCredentialsInvalid,
    PROVIDER_REGISTRY,
    get_connector_class,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/cloud-connectors", tags=["Cloud Connectors"])


# ─── Schemas ─────────────────────────────────────────────────────────────────


class CloudConnectorCreate(BaseModel):
    provider: str
    display_name: str
    description: Optional[str] = None
    credentials: Dict[str, Any]
    sync_schedule_seconds: Optional[int] = 6 * 60 * 60


class CloudConnectorUpdate(BaseModel):
    display_name: Optional[str] = None
    description: Optional[str] = None
    # When set, fully replaces the stored credentials blob.
    credentials: Optional[Dict[str, Any]] = None
    sync_schedule_seconds: Optional[int] = None
    is_active: Optional[bool] = None


class CloudConnectorResponse(BaseModel):
    id: int
    tenant_id: int
    provider: str
    display_name: str
    description: Optional[str] = None
    sync_schedule_seconds: Optional[int] = None
    is_active: bool
    last_sync_at: Optional[datetime] = None
    last_sync_status: Optional[str] = None
    last_sync_error: Optional[str] = None
    last_health_check_at: Optional[datetime] = None
    last_health_status: Optional[str] = None
    health_metrics: Optional[Dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _get_connector_for_user(
    connector_id: int, user: GRCUser, db: Session,
) -> CloudConnector:
    tenants = get_user_tenants(user, db)
    row = (
        db.query(CloudConnector)
        .filter(CloudConnector.id == connector_id)
        .filter(CloudConnector.tenant_id.in_(tenants))
        .first()
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cloud connector not found.",
        )
    return row


def _validate_with_adapter(provider: str, credentials: Dict[str, Any]) -> None:
    cls = get_connector_class(provider)
    if cls is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown provider {provider!r}. Available: {sorted(PROVIDER_REGISTRY.keys())}",
        )
    try:
        # Pass connector_id=0 here — validation doesn't need the row id.
        cls(connector_id=0, credentials=credentials).validate_credentials(credentials)
    except ConnectorCredentialsInvalid as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc),
        ) from exc


# ─── Endpoints ───────────────────────────────────────────────────────────────


@router.get("/unified")
def list_unified_integrations(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Unified discovery view across both connector tables.

    The platform has two connector tables for historical reasons:
      * `grc_cloud_connectors` (this framework) — AWS / Azure / GCP, etc.
      * `grc_integration_connections` (legacy) — Nessus / Nexpose.

    Both work today, but admins want one place to see "what's connected to
    this tenant?". This endpoint surfaces both, normalised into a single
    row shape so the admin page can render them in a single list. The
    edit/sync paths still go to each table's owning router; this endpoint
    is read-only.
    """
    from ....routers.auth_router import get_user_tenants
    tenants = get_user_tenants(current_user, db)

    rows = []
    # Cloud connectors (new framework).
    cloud_rows = (
        db.query(CloudConnector)
        .filter(CloudConnector.tenant_id.in_(tenants))
        .order_by(CloudConnector.created_at.desc())
        .all()
    )
    for c in cloud_rows:
        rows.append({
            "id": c.id,
            "framework": "cloud_connector",
            "provider": c.provider,
            "display_name": c.display_name,
            "description": c.description,
            "is_active": c.is_active,
            "last_sync_at": c.last_sync_at.isoformat() if c.last_sync_at else None,
            "last_sync_status": c.last_sync_status,
            "last_sync_error": c.last_sync_error,
            "last_health_status": c.last_health_status,
            "manage_path": "/admin → Cloud Connectors",
        })
    # Legacy scanner integrations.
    try:
        scanner_rows = (
            db.query(IntegrationConnection)
            .filter(IntegrationConnection.tenant_id.in_(tenants))
            .order_by(IntegrationConnection.created_at.desc())
            .all()
        )
        for s in scanner_rows:
            rows.append({
                "id": s.id,
                "framework": "legacy_scanner",
                "provider": s.integration_type,
                "display_name": s.connection_name,
                "description": f"Scanner @ {s.console_url}",
                "is_active": s.is_active,
                "last_sync_at": s.last_sync_at.isoformat() if s.last_sync_at else None,
                "last_sync_status": s.last_sync_status,
                "last_sync_error": None,
                "last_health_status": s.status,
                "manage_path": "/admin → Integrations",
            })
    except Exception:
        logger.exception("unified-integrations: legacy scanner read failed")

    return {"connectors": rows, "total": len(rows)}


def _platform_aws_account_id() -> str:
    """Return the platform's AWS account ID — the value the customer pastes
    into their IAM role's trust policy. Configured via env so each
    deployment surfaces the right account number. Returns a placeholder
    string when unset so the UI still renders something obvious."""
    return (os.environ.get("PLATFORM_AWS_ACCOUNT_ID") or "<set PLATFORM_AWS_ACCOUNT_ID>").strip()


def _stable_external_id(tenant_id: int, provider: str = "aws_inspector") -> str:
    """Deterministic External ID per (tenant, provider). Stable across
    calls so the customer's IAM role keeps validating — random per-call
    would force them to rewrite the trust policy on every visit.

    Uses HMAC-style derivation off a server-side salt + the tenant ID so
    even if the algorithm is known, attackers can't predict another
    tenant's ExternalID without knowing the salt."""
    salt = (os.environ.get("EXTERNAL_ID_SALT") or "grc-default-salt-rotate-me").encode("utf-8")
    raw = hashlib.sha256(salt + f"{tenant_id}:{provider}".encode("utf-8")).hexdigest()
    # Format as a human-recognizable string with a fixed prefix for audit.
    return f"grc-tenant-{tenant_id}-{raw[:16]}"


def _aws_iam_policy_json() -> str:
    """Recommended least-privilege IAM permissions policy the customer
    attaches to the role. Read-only across Inspector + EC2 + ECR + Lambda
    — never write, never delete, never IAM."""
    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "InspectorReadOnly",
                "Effect": "Allow",
                "Action": [
                    "inspector2:ListFindings",
                    "inspector2:GetFindings",
                    "inspector2:ListCoverage",
                    "inspector2:ListMembers",
                    "inspector2:ListAccountPermissions",
                ],
                "Resource": "*",
            },
            {
                "Sid": "AssetInventoryReadOnly",
                "Effect": "Allow",
                "Action": [
                    "ec2:DescribeInstances",
                    "ec2:DescribeSecurityGroups",
                    "ec2:DescribeVpcs",
                    "ecr:DescribeRepositories",
                    "ecr:DescribeImages",
                    "lambda:ListFunctions",
                ],
                "Resource": "*",
            },
            {
                "Sid": "STSWhoAmI",
                "Effect": "Allow",
                "Action": ["sts:GetCallerIdentity"],
                "Resource": "*",
            },
        ],
    }
    return json.dumps(policy, indent=2)


def _aws_trust_policy_json(external_id: str) -> str:
    """Recommended trust policy the customer pastes into the role. Limits
    AssumeRole to the platform's AWS account AND requires the External ID
    to match — confused-deputy protection. Customer can audit this in
    CloudTrail (event=AssumeRole, condition=ExternalId)."""
    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "GRCPlatformAssumeRole",
                "Effect": "Allow",
                "Principal": {
                    "AWS": f"arn:aws:iam::{_platform_aws_account_id()}:root",
                },
                "Action": "sts:AssumeRole",
                "Condition": {
                    "StringEquals": {"sts:ExternalId": external_id},
                },
            },
        ],
    }
    return json.dumps(policy, indent=2)


@router.get("/setup-info/{provider}")
def get_setup_info(
    provider: str,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Per-provider linking guide + auto-generated secure values.

    Returned shape (provider-shaped — the frontend reads `provider` and
    renders the matching panel):

      {
        "provider": "aws_inspector",
        "security_model": "cross_account_assume_role",
        "security_summary": "...what's stored, what isn't, what the
                             customer can audit...",
        "steps": [{"title": "...", "body": "...", "code": "..."}, ...],
        "copy_blocks": [{"label": "External ID",  "value": "..."},
                        {"label": "Trust policy", "value": "...json..."},
                        ...],
      }

    Every call for the SAME tenant returns the SAME External ID — so the
    customer's IAM role keeps validating across visits. The platform
    salts the derivation, so external IDs aren't guessable.
    """
    provider = (provider or "").strip().lower()
    tenants = get_user_tenants(current_user, db)
    if not tenants:
        raise HTTPException(status_code=400, detail="No tenant context.")
    tenant_id = tenants[0]

    if provider == "aws_inspector":
        external_id = _stable_external_id(tenant_id, "aws_inspector")
        platform_acct = _platform_aws_account_id()
        return {
            "provider": provider,
            "label": "AWS Inspector v2",
            "security_model": "cross_account_assume_role",
            "security_summary": (
                "We never store an AWS access key or secret. You give us a role ARN "
                "and a one-line External ID; on every sync we call STS to assume "
                "the role and get temporary credentials (max 1 hour). You can "
                "revoke us in one click by deleting the IAM role — next sync "
                "fails immediately. Every assume-role call shows up in your "
                "CloudTrail with our session name (grc-sync-<tenant>-<timestamp>)."
            ),
            "what_we_store": [
                "Role ARN (a public AWS identifier)",
                "External ID (encrypted; deterministic per tenant)",
                "List of regions to scan",
            ],
            "what_we_dont_store": [
                "No AWS access key",
                "No AWS secret key",
                "No long-lived AWS credentials of any kind",
            ],
            "copy_blocks": [
                {
                    "label": "Platform AWS Account ID",
                    "value": platform_acct,
                    "language": "text",
                    "help": "Paste this into the trust policy's Principal.AWS field.",
                },
                {
                    "label": "External ID (per-tenant)",
                    "value": external_id,
                    "language": "text",
                    "help": "Paste this into the trust policy's sts:ExternalId condition.",
                },
                {
                    "label": "Trust policy (paste in IAM → Role → Trust relationships)",
                    "value": _aws_trust_policy_json(external_id),
                    "language": "json",
                },
                {
                    "label": "Permissions policy (attach to the role)",
                    "value": _aws_iam_policy_json(),
                    "language": "json",
                    "help": "Read-only across Inspector + EC2 + ECR + Lambda. No write, no delete, no IAM.",
                },
            ],
            "steps": [
                {
                    "title": "Open AWS IAM Console",
                    "body": "Sign into AWS, go to IAM → Roles → Create role.",
                },
                {
                    "title": "Trusted entity: Another AWS account",
                    "body": (
                        "Pick 'AWS account' → 'Another AWS account'. Enter the "
                        "platform AWS Account ID shown on the left. Tick "
                        "'Require external ID' and paste the External ID."
                    ),
                },
                {
                    "title": "Attach permissions",
                    "body": (
                        "Create a new policy with the JSON from the right pane "
                        "(Permissions policy block) and attach it to the role."
                    ),
                },
                {
                    "title": "Name the role",
                    "body": "Suggested: GRCPlatform-Inspector-Reader. Save the role.",
                },
                {
                    "title": "Copy the Role ARN",
                    "body": (
                        "AWS will show the role's ARN at the top of the role "
                        "page. Paste it into the credentials JSON below as "
                        "`role_arn`. Add the regions you want us to scan."
                    ),
                },
                {
                    "title": "Click Test connection",
                    "body": (
                        "We'll call STS:AssumeRole + STS:GetCallerIdentity to "
                        "verify the role accepts our External ID. If it works, "
                        "the connector is marked Active and we schedule syncs."
                    ),
                },
            ],
            "credentials_template": {
                "role_arn": "arn:aws:iam::<your-aws-account>:role/GRCPlatform-Inspector-Reader",
                "external_id": external_id,
                "regions": ["us-east-1"],
            },
        }

    if provider == "azure_defender":
        return {
            "provider": provider,
            "label": "Microsoft Defender for Cloud",
            "security_model": "service_principal_with_security_reader_role",
            "security_summary": (
                "Recommended path for production: register a multi-tenant Azure "
                "AD app in YOUR Azure AD and have the customer consent via "
                "OAuth — no client secret is shared, we hold a refresh token "
                "that the customer can revoke in Azure AD any time. For dev / "
                "single-tenant setups, the simpler 'Manual Service Principal' "
                "flow below works: the customer creates an app registration "
                "in THEIR tenant, generates a client secret, and pastes the "
                "four values. We encrypt the secret at rest."
            ),
            "what_we_store": [
                "Tenant ID + Client ID (public Azure identifiers)",
                "Client secret (encrypted at rest with CONNECTOR_MASTER_KEY)",
                "List of subscription IDs to scan",
            ],
            "what_we_dont_store": [
                "No user passwords",
                "No global admin credentials",
                "No subscription-level access keys",
            ],
            "copy_blocks": [
                {
                    "label": "Required role assignment",
                    "value": "Security Reader",
                    "language": "text",
                    "help": (
                        "Assign 'Security Reader' to the app registration at "
                        "the subscription scope (Subscription → Access "
                        "control (IAM) → Add role assignment)."
                    ),
                },
                {
                    "label": "Required Graph permissions (delegated)",
                    "value": "https://management.azure.com/.default",
                    "language": "text",
                },
            ],
            "steps": [
                {
                    "title": "Create an App Registration",
                    "body": (
                        "Azure Portal → Azure AD → App registrations → New "
                        "registration. Name it 'GRC Platform — Defender Reader'. "
                        "Single tenant. No redirect URI needed."
                    ),
                },
                {
                    "title": "Generate a client secret",
                    "body": (
                        "Open the app → Certificates & secrets → New client "
                        "secret. Copy the VALUE (not the secret ID). You won't "
                        "see it again."
                    ),
                },
                {
                    "title": "Note the IDs",
                    "body": (
                        "From the app's Overview page, copy Application "
                        "(client) ID and Directory (tenant) ID. From any "
                        "subscription's Overview page, copy the Subscription ID."
                    ),
                },
                {
                    "title": "Grant Security Reader at subscription scope",
                    "body": (
                        "Subscription → Access control (IAM) → Add role "
                        "assignment → Role: Security Reader → assign to the "
                        "app registration."
                    ),
                },
                {
                    "title": "Paste the four values below",
                    "body": (
                        "Tenant ID, Client ID, Client Secret, Subscription ID. "
                        "Click Test connection — we'll list one resource group "
                        "to verify access."
                    ),
                },
            ],
            "credentials_template": {
                "tenant_id": "00000000-0000-0000-0000-000000000000",
                "client_id": "00000000-0000-0000-0000-000000000000",
                "client_secret": "<paste-secret-value-here>",
                "subscription_id": "00000000-0000-0000-0000-000000000000",
            },
        }

    if provider == "gcp_scc":
        return {
            "provider": provider,
            "label": "Google Cloud Security Command Center (Premium)",
            "security_model": "service_account_json_key",
            "security_summary": (
                "Recommended path for production: GCP Workload Identity "
                "Federation — the platform impersonates a customer service "
                "account using its own identity, no key file stored. For dev / "
                "smaller customers, the simpler 'Service Account JSON Key' "
                "flow below works: the customer creates a service account, "
                "grants it Security Center Findings Viewer + Cloud Asset "
                "Viewer, and pastes the downloaded JSON key into our UI. We "
                "encrypt the key at rest."
            ),
            "what_we_store": [
                "Organisation ID (public GCP identifier)",
                "Service account JSON key (encrypted at rest)",
            ],
            "what_we_dont_store": [
                "No user credentials",
                "No project owner / admin keys",
            ],
            "copy_blocks": [
                {
                    "label": "Required IAM roles for the service account",
                    "value": "\n".join([
                        "roles/securitycenter.findingsViewer",
                        "roles/cloudasset.viewer",
                        "roles/compute.viewer",
                    ]),
                    "language": "text",
                    "help": "Grant at the ORGANISATION scope, not project — SCC findings live at the org level.",
                },
                {
                    "label": "gcloud command (one-liner)",
                    "value": (
                        "gcloud iam service-accounts create grc-platform-reader "
                        "--display-name='GRC Platform Reader'"
                    ),
                    "language": "bash",
                },
            ],
            "steps": [
                {
                    "title": "Confirm SCC Premium is enabled",
                    "body": (
                        "GCP Console → Security → Security Command Center → "
                        "Settings. Without Premium tier, the findings API is "
                        "not exposed and this connector cannot pull data."
                    ),
                },
                {
                    "title": "Create the service account",
                    "body": (
                        "IAM & Admin → Service Accounts → Create. Name it "
                        "'grc-platform-reader'. Skip the role assignment "
                        "screen — we'll do it at org scope next."
                    ),
                },
                {
                    "title": "Grant three roles at the ORG scope",
                    "body": (
                        "IAM & Admin → IAM at the organisation level → Grant "
                        "Access → paste the service account email. Assign "
                        "Security Center Findings Viewer + Cloud Asset Viewer "
                        "+ Compute Viewer."
                    ),
                },
                {
                    "title": "Create a JSON key for the service account",
                    "body": (
                        "Open the service account → Keys → Add key → Create "
                        "new key → JSON. The browser downloads a file. Open it, "
                        "copy the WHOLE contents."
                    ),
                },
                {
                    "title": "Paste the JSON key + your Organisation ID",
                    "body": (
                        "Paste the JSON key string into the credentials block "
                        "below. The Organisation ID is the numeric value visible "
                        "in IAM & Admin → Identity & Organization. Click Test "
                        "connection."
                    ),
                },
            ],
            "credentials_template": {
                "service_account_json": "<paste the entire JSON key file contents here>",
                "organization_id": "123456789012",
            },
        }

    if provider == "nessus":
        return {
            "provider": provider,
            "label": "Tenable Nessus (legacy scanner)",
            "security_model": "api_key_pair_stored_encrypted",
            "security_summary": (
                "Manage Nessus connections via Admin → Integrations → Scanner "
                "Connections. Nessus uses an Access Key / Secret Key pair "
                "issued by your Nessus Manager or Tenable.io account; we "
                "encrypt both at rest."
            ),
            "redirect": "/admin#integrations",
            "steps": [],
            "copy_blocks": [],
        }

    if provider == "nexpose":
        return {
            "provider": provider,
            "label": "Rapid7 Nexpose (legacy scanner)",
            "security_model": "username_password_stored_encrypted",
            "security_summary": (
                "Manage Nexpose / InsightVM connections via Admin → "
                "Integrations → Scanner Connections. Console URL + username + "
                "password are encrypted at rest."
            ),
            "redirect": "/admin#integrations",
            "steps": [],
            "copy_blocks": [],
        }

    raise HTTPException(status_code=404, detail=f"Unknown provider: {provider!r}")


@router.get("/providers")
def list_providers(_user: GRCUser = Depends(require_auth)):
    """Catalog of connector providers this build knows about. Used by the
    admin page to render the provider picker + matching credentials form.

    Also advertises the two legacy scanner providers (Nessus / Nexpose) so
    the admin sees the full list in one place, but with a hint pointing to
    the legacy management page — those rows live in
    `grc_integration_connections`, not `grc_cloud_connectors`, and have
    their own setup flow.
    """
    providers = [
        {
            "provider": cls.provider,
            "label": cls.display_label or cls.provider,
            "credentials_schema": cls.credentials_schema or {},
            "framework": "cloud_connector",
        }
        for cls in PROVIDER_REGISTRY.values()
    ]
    providers.extend([
        {
            "provider": "nessus",
            "label": "Tenable Nessus (legacy)",
            "credentials_schema": {},
            "framework": "legacy_scanner",
            "manage_hint": "Manage via /admin → Integrations → Scanner Connections.",
        },
        {
            "provider": "nexpose",
            "label": "Rapid7 Nexpose (legacy)",
            "credentials_schema": {},
            "framework": "legacy_scanner",
            "manage_hint": "Manage via /admin → Integrations → Scanner Connections.",
        },
    ])
    return {
        "providers": providers,
        "encryption_ready": has_master_key(),
    }


@router.get("", response_model=List[CloudConnectorResponse])
def list_connectors(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenants = get_user_tenants(current_user, db)
    rows = (
        db.query(CloudConnector)
        .filter(CloudConnector.tenant_id.in_(tenants))
        .order_by(CloudConnector.created_at.desc())
        .all()
    )
    return rows


@router.post("", response_model=CloudConnectorResponse, status_code=status.HTTP_201_CREATED)
def create_connector(
    payload: CloudConnectorCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    # Encryption is OPTIONAL in dev — when CONNECTOR_MASTER_KEY isn't set,
    # `encrypt_credentials()` stores `dev::<base64-json>` with a loud
    # warning log. The admin UI still surfaces an "encryption not
    # configured" banner so operators know the state.
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not assigned to any tenant.",
        )

    _validate_with_adapter(payload.provider, payload.credentials)

    try:
        ciphertext = encrypt_credentials(payload.credentials)
    except ConnectorCredentialError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Connector encryption is misconfigured. Contact your administrator.",
        )

    row = CloudConnector(
        tenant_id=tenant_id,
        provider=payload.provider,
        display_name=payload.display_name,
        description=payload.description,
        encrypted_credentials_blob=ciphertext,
        sync_schedule_seconds=payload.sync_schedule_seconds,
        is_active=True,
        created_by=current_user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{connector_id}", response_model=CloudConnectorResponse)
def update_connector(
    connector_id: int,
    payload: CloudConnectorUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    row = _get_connector_for_user(connector_id, current_user, db)

    if payload.display_name is not None:
        row.display_name = payload.display_name
    if payload.description is not None:
        row.description = payload.description
    if payload.sync_schedule_seconds is not None:
        row.sync_schedule_seconds = payload.sync_schedule_seconds
    if payload.is_active is not None:
        row.is_active = payload.is_active

    if payload.credentials is not None:
        # Encryption is optional in dev — credentials still get stored
        # (as base64 in dev mode, Fernet in prod). The admin banner
        # shows the current state.
        _validate_with_adapter(row.provider, payload.credentials)
        try:
            row.encrypted_credentials_blob = encrypt_credentials(payload.credentials)
        except ConnectorCredentialError:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Connector encryption is misconfigured.",
            )

    db.commit()
    db.refresh(row)
    return row


@router.post("/{connector_id}/health-check")
def health_check_connector(
    connector_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    row = _get_connector_for_user(connector_id, current_user, db)

    cls = get_connector_class(row.provider)
    if cls is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Provider {row.provider!r} is not registered in this build.",
        )

    creds = decrypt_credentials(row.encrypted_credentials_blob)
    if creds is None:
        # Could be missing master key, corrupt blob, or key rotation. Don't
        # leak which — surface "credentials unavailable" and mark health.
        row.last_health_check_at = datetime.utcnow()
        row.last_health_status = "error"
        db.commit()
        return {
            "status": "error",
            "detail": "Credentials could not be decrypted. Re-enter them or check CONNECTOR_MASTER_KEY.",
        }

    adapter = cls(connector_id=row.id, credentials=creds)
    health = adapter.health_check()

    row.last_health_check_at = datetime.utcnow()
    row.last_health_status = health.status
    db.commit()

    return {
        "status": health.status,
        "detail": health.detail,
        "latency_ms": health.latency_ms,
        "checked_at": health.checked_at,
    }


@router.post("/{connector_id}/sync")
def sync_connector_now(
    connector_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Run the connector's sync immediately. Returns the result summary —
    counts of assets + vulnerabilities + any errors. Use this for the
    admin page "Sync now" button; the daily beat runs the same code path."""
    row = _get_connector_for_user(connector_id, current_user, db)
    from ....tasks.cloud_sync import _run_single_sync
    summary = _run_single_sync(db, row.id)
    return summary


@router.post("/sync-all")
def sync_all_connectors(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Queue a Celery job that walks every active connector in the
    tenant. Returns immediately with a task ID."""
    tenant_id = get_user_primary_tenant(current_user, db)
    from ....db import MasterSession
    from ....models import Tenant as _Tenant

    master = MasterSession()
    try:
        row = master.query(_Tenant.slug).filter(_Tenant.id == tenant_id).first()
    finally:
        master.close()
    if not row or not row[0]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not resolve tenant slug for bulk sync.",
        )

    try:
        from ....tasks.cloud_sync import bulk_sync_for_tenant
        result = bulk_sync_for_tenant.delay(tenant_slug=row[0])
        return {"queued": True, "task_id": result.id}
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Could not queue bulk sync: {exc}",
        )


@router.delete("/{connector_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_connector(
    connector_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    row = _get_connector_for_user(connector_id, current_user, db)
    db.delete(row)
    db.commit()
    return None
