"""Built-in SOC 2 quantitative AWS checks (v1).

Additive catalog: benchmark SOC2_QUANTITATIVE_v1. Each plugin maps to one
SOC 2 TSC criterion (rule_id) and uses the existing aws_readonly runner.
Idempotent UPSERT with tenant_id=NULL / is_builtin=True — same pattern as CIS.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List

from sqlalchemy.orm import Session

from grc.models import CompliancePlugin, FrameworkControl, PluginControlMapping

logger = logging.getLogger(__name__)

BENCHMARK = "SOC2_QUANTITATIVE_v1"
_CATALOG_PATH = (
    Path(__file__).resolve().parents[2]
    / "seed_data"
    / "automation"
    / "soc2_quantitative_controls.json"
)

SOC2_QUANTITATIVE_LIBRARY: List[Dict[str, Any]] = [
    {
        "plugin_key": "SOC2_QUANTITATIVE_v1__CC6.1__root_no_access_keys",
        "benchmark": BENCHMARK,
        "rule_id": "CC6.1",
        "title": "SOC 2 CC6.1 — No root user access keys",
        "description": "Root account access keys increase blast radius; quantitative check via IAM account summary.",
        "rationale": "Supports logical access restriction and credential hygiene for privileged accounts.",
        "remediation": "Sign in as root, open My Security Credentials, and delete any access keys.",
        "severity": "critical",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "iam",
            "operation": "get_account_summary",
            "expect": {"kind": "field_equals", "path": "SummaryMap.AccountAccessKeysPresent", "value": 0},
            "pass_message": "No root access keys present.",
            "fail_message": "Root access keys are present — remove immediately.",
        },
        "source_url": "https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria",
    },
    {
        "plugin_key": "SOC2_QUANTITATIVE_v1__CC6.1__root_mfa_enabled",
        "benchmark": BENCHMARK,
        "rule_id": "CC6.1",
        "title": "SOC 2 CC6.1 — Root MFA enabled",
        "description": "MFA on the root user strengthens authentication before privileged access.",
        "rationale": "Mitigates risk from compromised root password.",
        "remediation": "Enable MFA on the AWS root user in IAM console.",
        "severity": "critical",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "iam",
            "operation": "get_account_summary",
            "expect": {"kind": "field_equals", "path": "SummaryMap.AccountMFAEnabled", "value": 1},
            "pass_message": "Root account has MFA enabled.",
            "fail_message": "Root account does NOT have MFA enabled.",
        },
        "source_url": "https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria",
    },
    {
        "plugin_key": "SOC2_QUANTITATIVE_v1__CC6.2__password_policy_min_length",
        "benchmark": BENCHMARK,
        "rule_id": "CC6.2",
        "title": "SOC 2 CC6.2 — IAM password policy minimum length ≥ 14",
        "description": "Strong password policy supports authorized credential issuance standards.",
        "rationale": "Longer passwords reduce brute-force risk for provisioned IAM users.",
        "remediation": "Update the IAM account password policy to require ≥14 characters.",
        "severity": "high",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "iam",
            "operation": "get_account_password_policy",
            "expect": {
                "kind": "field_in",
                "path": "PasswordPolicy.MinimumPasswordLength",
                "value": list(range(14, 129)),
            },
            "pass_message": "Password policy minimum length is at least 14.",
            "fail_message": "Password policy minimum length is below 14.",
        },
        "source_url": "https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria",
    },
    {
        "plugin_key": "SOC2_QUANTITATIVE_v1__CC6.3__iam_users_enumerated",
        "benchmark": BENCHMARK,
        "rule_id": "CC6.3",
        "title": "SOC 2 CC6.3 — IAM users can be inventoried",
        "description": "Ability to enumerate IAM users is a prerequisite for least-privilege and access reviews.",
        "rationale": "Confirms IAM inventory visibility for role/access reviews.",
        "remediation": "Ensure IAM ListUsers is permitted for the automation role and review unused users.",
        "severity": "medium",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "iam",
            "operation": "list_users",
            "expect": {"kind": "list_nonempty", "path": "Users"},
            "pass_message": "IAM users enumerated successfully (inventory available for access reviews).",
            "fail_message": "Could not enumerate IAM users — check permissions or account state.",
        },
        "source_url": "https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria",
    },
    {
        "plugin_key": "SOC2_QUANTITATIVE_v1__CC6.6__s3_block_public_access",
        "benchmark": BENCHMARK,
        "rule_id": "CC6.6",
        "title": "SOC 2 CC6.6 — S3 account Block Public Access (ACLs)",
        "description": "Account-level S3 Block Public Access reduces unauthorized exposure of data assets.",
        "rationale": "Defense-in-depth against accidental public buckets.",
        "remediation": "Enable PublicAccessBlock at the account level via S3 Control.",
        "severity": "critical",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "s3control",
            "operation": "get_public_access_block",
            "operation_args": {"AccountId": "${AWS_ACCOUNT_ID}"},
            "expect": {
                "kind": "field_equals",
                "path": "PublicAccessBlockConfiguration.BlockPublicAcls",
                "value": True,
            },
            "pass_message": "Account-level S3 BlockPublicAcls is enabled.",
            "fail_message": "Account-level S3 BlockPublicAcls is NOT enabled.",
        },
        "source_url": "https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria",
    },
    {
        "plugin_key": "SOC2_QUANTITATIVE_v1__CC6.7__ebs_encryption_by_default",
        "benchmark": BENCHMARK,
        "rule_id": "CC6.7",
        "title": "SOC 2 CC6.7 — EBS encryption by default",
        "description": "Default EBS encryption protects data at rest for new volumes.",
        "rationale": "Supports encryption controls for stored information assets.",
        "remediation": "Enable EBS encryption by default in each region.",
        "severity": "high",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "ec2",
            "operation": "get_ebs_encryption_by_default",
            "expect": {"kind": "field_equals", "path": "EbsEncryptionByDefault", "value": True},
            "pass_message": "EBS encryption by default is enabled.",
            "fail_message": "EBS encryption by default is NOT enabled.",
        },
        "source_url": "https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria",
    },
    {
        "plugin_key": "SOC2_QUANTITATIVE_v1__CC6.8__no_open_ssh_world",
        "benchmark": BENCHMARK,
        "rule_id": "CC6.8",
        "title": "SOC 2 CC6.8 — Review default security groups (SSH surface)",
        "description": "Detect default security groups as a signal to review world-open SSH / malicious access paths.",
        "rationale": "Reduces remote attack surface used for unauthorized software introduction.",
        "remediation": "Restrict SSH ingress to known IP ranges; avoid world-open port 22.",
        "severity": "critical",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "ec2",
            "operation": "describe_security_groups",
            "expect": {
                "kind": "no_items_match",
                "path": "SecurityGroups",
                "match": {"field": "GroupName", "value": "default"},
            },
            "pass_message": "No default security groups detected (verify SSH ingress rules).",
            "fail_message": "Default security groups detected — verify SSH / open ingress rules.",
        },
        "source_url": "https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria",
    },
    {
        "plugin_key": "SOC2_QUANTITATIVE_v1__CC7.1__security_hub_enabled",
        "benchmark": BENCHMARK,
        "rule_id": "CC7.1",
        "title": "SOC 2 CC7.1 — Security Hub hub available",
        "description": "Security Hub aggregates findings used to detect configuration / vulnerability changes.",
        "rationale": "Supports detection procedures for security events.",
        "remediation": "Enable AWS Security Hub in the account/region.",
        "severity": "medium",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "securityhub",
            "operation": "describe_hub",
            "expect": {"kind": "exists", "path": "HubArn"},
            "pass_message": "Security Hub hub is configured.",
            "fail_message": "Security Hub hub is not configured or not accessible.",
        },
        "source_url": "https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria",
    },
    {
        "plugin_key": "SOC2_QUANTITATIVE_v1__CC7.2__cloudtrail_enabled",
        "benchmark": BENCHMARK,
        "rule_id": "CC7.2",
        "title": "SOC 2 CC7.2 — CloudTrail trail present",
        "description": "CloudTrail provides monitoring evidence of API activity indicative of anomalies.",
        "rationale": "Without trails, security event monitoring is incomplete.",
        "remediation": "Create and enable a multi-region CloudTrail trail.",
        "severity": "high",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "cloudtrail",
            "operation": "describe_trails",
            "expect": {"kind": "list_nonempty", "path": "trailList"},
            "pass_message": "At least one CloudTrail trail exists.",
            "fail_message": "No CloudTrail trails configured in this region.",
        },
        "source_url": "https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria",
    },
    {
        "plugin_key": "SOC2_QUANTITATIVE_v1__CC7.3__guardduty_detectors",
        "benchmark": BENCHMARK,
        "rule_id": "CC7.3",
        "title": "SOC 2 CC7.3 — GuardDuty detector present",
        "description": "GuardDuty findings support evaluation of security events for impact.",
        "rationale": "Threat detection informs whether events threaten control objectives.",
        "remediation": "Enable Amazon GuardDuty in the account/region.",
        "severity": "high",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "guardduty",
            "operation": "list_detectors",
            "expect": {"kind": "list_nonempty", "path": "DetectorIds"},
            "pass_message": "At least one GuardDuty detector is present.",
            "fail_message": "No GuardDuty detectors found.",
        },
        "source_url": "https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria",
    },
]


def load_soc2_quantitative_catalog() -> Dict[str, Any]:
    """Load the control-centric catalog JSON shipped with the app."""
    if not _CATALOG_PATH.is_file():
        return {
            "framework": "SOC 2 Type II",
            "catalog_version": BENCHMARK,
            "controls": [],
        }
    with _CATALOG_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def seed_soc2_quantitative_plugins(db: Session) -> int:
    """Idempotently upsert SOC2_QUANTITATIVE_v1 built-in plugins into a tenant DB."""
    from .seed import _validate_readonly_at_seed_time

    touched = 0
    for spec in SOC2_QUANTITATIVE_LIBRARY:
        _validate_readonly_at_seed_time(spec)
        existing = (
            db.query(CompliancePlugin)
            .filter(
                CompliancePlugin.tenant_id.is_(None),
                CompliancePlugin.plugin_key == spec["plugin_key"],
            )
            .first()
        )
        if existing:
            for k, v in spec.items():
                setattr(existing, k, v)
            existing.is_builtin = True
            db.add(existing)
        else:
            db.add(CompliancePlugin(tenant_id=None, is_builtin=True, **spec))
        touched += 1
    db.commit()
    logger.info("seed_soc2_quantitative_plugins: upserted %d plugins", touched)
    return touched


def ensure_soc2_framework_mappings(db: Session, tenant_id: int) -> int:
    """Best-effort PluginControlMapping to FrameworkControl by code == rule_id.

    Skips silently when the tenant has no matching SOC 2 framework controls.
    """
    plugins = (
        db.query(CompliancePlugin)
        .filter(
            CompliancePlugin.benchmark == BENCHMARK,
            CompliancePlugin.tenant_id.is_(None),
        )
        .all()
    )
    if not plugins:
        return 0

    created = 0
    for plugin in plugins:
        fc = (
            db.query(FrameworkControl)
            .filter(FrameworkControl.code == plugin.rule_id)
            .first()
        )
        if fc is None:
            continue
        exists = (
            db.query(PluginControlMapping)
            .filter(
                PluginControlMapping.tenant_id == tenant_id,
                PluginControlMapping.plugin_id == plugin.id,
                PluginControlMapping.framework_control_id == fc.id,
            )
            .first()
        )
        if exists:
            continue
        db.add(
            PluginControlMapping(
                tenant_id=tenant_id,
                plugin_id=plugin.id,
                framework_control_id=fc.id,
                weight=1.0,
            )
        )
        created += 1
    if created:
        db.commit()
    return created
