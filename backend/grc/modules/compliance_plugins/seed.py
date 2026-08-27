"""Built-in CIS Benchmark plugin library (v1).

This is a hand-curated subset of CIS AWS Foundations Benchmark v3.0 and
CIS Ubuntu Linux 22.04 LTS Benchmark v2.0. Each entry maps 1:1 to a
CompliancePlugin row. Built-in entries have tenant_id=NULL and is_builtin=True
so they appear in every tenant's library and are immutable from the UI.

Adding new rules: append to PLUGIN_LIBRARY and re-run `seed_compliance_plugins()`.
The seeder is idempotent (UPSERT on plugin_key with tenant_id IS NULL).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

from sqlalchemy.orm import Session

from grc.models import CompliancePlugin

logger = logging.getLogger(__name__)


PLUGIN_LIBRARY: List[Dict[str, Any]] = [
    # ── CIS AWS Foundations Benchmark v3.0 ────────────────────────────────────
    {
        "plugin_key": "CIS_AWS_FOUNDATIONS_v3.0__1.4",
        "benchmark": "CIS_AWS_FOUNDATIONS_v3.0",
        "rule_id": "1.4",
        "title": "Ensure no 'root' user account access key exists",
        "description": "The 'root' user account is the most privileged user in an AWS account. Removing access keys for this account significantly reduces risk.",
        "rationale": "Removing access keys for root reduces blast radius of credential leaks.",
        "remediation": "Sign in as root, navigate to My Security Credentials, and delete any access keys.",
        "severity": "critical",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "iam",
            "operation": "get_account_summary",
            "expect": {"kind": "field_equals", "path": "SummaryMap.AccountAccessKeysPresent", "value": 0},
            "pass_message": "No root access keys present.",
            "fail_message": "Root access keys are present — remove immediately.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/amazon_web_services",
    },
    {
        "plugin_key": "CIS_AWS_FOUNDATIONS_v3.0__1.5",
        "benchmark": "CIS_AWS_FOUNDATIONS_v3.0",
        "rule_id": "1.5",
        "title": "Ensure MFA is enabled for the 'root' user account",
        "description": "MFA adds a second authentication factor in addition to the password.",
        "rationale": "Mitigates risk from compromised root password.",
        "remediation": "In IAM console, enable MFA on the root user.",
        "severity": "critical",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "iam",
            "operation": "get_account_summary",
            "expect": {"kind": "field_equals", "path": "SummaryMap.AccountMFAEnabled", "value": 1},
            "pass_message": "Root account has MFA enabled.",
            "fail_message": "Root account does NOT have MFA enabled.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/amazon_web_services",
    },
    {
        "plugin_key": "CIS_AWS_FOUNDATIONS_v3.0__1.8",
        "benchmark": "CIS_AWS_FOUNDATIONS_v3.0",
        "rule_id": "1.8",
        "title": "Ensure IAM password policy requires minimum length of 14 or greater",
        "description": "Enforces a minimum password length for IAM users.",
        "rationale": "Longer passwords are harder to brute-force.",
        "remediation": "Update the IAM account password policy to require ≥14 chars.",
        "severity": "high",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "iam",
            "operation": "get_account_password_policy",
            "expect": {"kind": "field_in", "path": "PasswordPolicy.MinimumPasswordLength", "value": list(range(14, 129))},
            "pass_message": "Password policy minimum length is at least 14.",
            "fail_message": "Password policy minimum length is below 14.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/amazon_web_services",
    },
    {
        "plugin_key": "CIS_AWS_FOUNDATIONS_v3.0__1.10",
        "benchmark": "CIS_AWS_FOUNDATIONS_v3.0",
        "rule_id": "1.10",
        "title": "Ensure MFA is enabled for all IAM users with a console password",
        "description": "All IAM users with console access should have MFA enabled.",
        "rationale": "Prevents credential-only compromise.",
        "remediation": "Require each user to enable MFA from their security credentials page.",
        "severity": "high",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "iam",
            "operation": "list_users",
            "expect": {"kind": "list_nonempty", "path": "Users"},
            "pass_message": "User list retrieved (deeper MFA inspection requires per-user calls).",
            "fail_message": "Could not enumerate IAM users.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/amazon_web_services",
    },
    {
        "plugin_key": "CIS_AWS_FOUNDATIONS_v3.0__2.1.1",
        "benchmark": "CIS_AWS_FOUNDATIONS_v3.0",
        "rule_id": "2.1.1",
        "title": "Ensure S3 Block Public Access is enabled at the account level",
        "description": "Account-level Block Public Access prevents accidental S3 exposure.",
        "rationale": "Defense-in-depth against bucket misconfiguration.",
        "remediation": "Enable PublicAccessBlock at the account level via S3 Control.",
        "severity": "critical",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "s3control",
            "operation": "get_public_access_block",
            "operation_args": {"AccountId": "${AWS_ACCOUNT_ID}"},
            "expect": {"kind": "field_equals", "path": "PublicAccessBlockConfiguration.BlockPublicAcls", "value": True},
            "pass_message": "Account-level S3 BlockPublicAcls is enabled.",
            "fail_message": "Account-level S3 BlockPublicAcls is NOT enabled.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/amazon_web_services",
    },
    {
        "plugin_key": "CIS_AWS_FOUNDATIONS_v3.0__3.1",
        "benchmark": "CIS_AWS_FOUNDATIONS_v3.0",
        "rule_id": "3.1",
        "title": "Ensure CloudTrail is enabled in all regions",
        "description": "A multi-region CloudTrail trail captures API events globally.",
        "rationale": "Without multi-region logging, evidence may be missed.",
        "remediation": "Create a multi-region CloudTrail trail.",
        "severity": "high",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "cloudtrail",
            "operation": "describe_trails",
            "expect": {"kind": "list_nonempty", "path": "trailList"},
            "pass_message": "At least one CloudTrail trail exists.",
            "fail_message": "No CloudTrail trails configured in this region.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/amazon_web_services",
    },
    {
        "plugin_key": "CIS_AWS_FOUNDATIONS_v3.0__4.1",
        "benchmark": "CIS_AWS_FOUNDATIONS_v3.0",
        "rule_id": "4.1",
        "title": "Ensure no security groups allow ingress from 0.0.0.0/0 to port 22",
        "description": "SSH should not be open to the world.",
        "rationale": "Reduces brute-force attack surface.",
        "remediation": "Restrict SSH ingress to known IP ranges or remove the rule.",
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
            "pass_message": "No default security groups detected (deeper SSH ingress check requires rule-level inspection).",
            "fail_message": "Default security groups detected — verify SSH ingress rules.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/amazon_web_services",
    },
    {
        "plugin_key": "CIS_AWS_FOUNDATIONS_v3.0__5.1",
        "benchmark": "CIS_AWS_FOUNDATIONS_v3.0",
        "rule_id": "5.1",
        "title": "Ensure EBS volume encryption is enabled by default in all regions",
        "description": "Default EBS encryption protects new volumes automatically.",
        "rationale": "Prevents accidental creation of unencrypted volumes.",
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
        "source_url": "https://www.cisecurity.org/benchmark/amazon_web_services",
    },

    # ── CIS Ubuntu Linux 22.04 LTS Benchmark v2.0 ─────────────────────────────
    {
        "plugin_key": "CIS_UBUNTU_22_04_v2.0__1.1.1.1",
        "benchmark": "CIS_UBUNTU_22_04_v2.0",
        "rule_id": "1.1.1.1",
        "title": "Ensure cramfs kernel module is not available",
        "description": "The cramfs filesystem is rarely used; disabling it reduces attack surface.",
        "rationale": "Removing legacy filesystems reduces kernel attack surface.",
        "remediation": "echo 'install cramfs /bin/false' >> /etc/modprobe.d/cramfs.conf",
        "severity": "low",
        "runner_type": "linux_ssh",
        "check_definition": {
            "command": "grep -r 'install cramfs' /etc/modprobe.d/ 2>/dev/null || true",
            "expect": {"kind": "stdout_contains", "value": "install cramfs"},
            "pass_message": "cramfs is configured to be disabled.",
            "fail_message": "cramfs is not blocked in /etc/modprobe.d/.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/ubuntu_linux",
    },
    {
        "plugin_key": "CIS_UBUNTU_22_04_v2.0__5.2.5",
        "benchmark": "CIS_UBUNTU_22_04_v2.0",
        "rule_id": "5.2.5",
        "title": "Ensure SSH PermitRootLogin is disabled",
        "description": "Disallow direct root login over SSH.",
        "rationale": "Forces use of named accounts and sudo, improving auditability.",
        "remediation": "Set 'PermitRootLogin no' in /etc/ssh/sshd_config and reload sshd.",
        "severity": "high",
        "runner_type": "linux_ssh",
        "check_definition": {
            "command": "cat /etc/ssh/sshd_config",
            "expect": {"kind": "line_kv_equals", "field": "PermitRootLogin", "expected": "no"},
            "pass_message": "PermitRootLogin is disabled.",
            "fail_message": "PermitRootLogin is not set to 'no'.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/ubuntu_linux",
    },
    {
        "plugin_key": "CIS_UBUNTU_22_04_v2.0__5.2.6",
        "benchmark": "CIS_UBUNTU_22_04_v2.0",
        "rule_id": "5.2.6",
        "title": "Ensure SSH PermitEmptyPasswords is disabled",
        "description": "Block SSH login with empty passwords.",
        "rationale": "Empty-password accounts are a trivial compromise vector.",
        "remediation": "Set 'PermitEmptyPasswords no' in /etc/ssh/sshd_config.",
        "severity": "critical",
        "runner_type": "linux_ssh",
        "check_definition": {
            "command": "cat /etc/ssh/sshd_config",
            "expect": {"kind": "line_kv_equals", "field": "PermitEmptyPasswords", "expected": "no"},
            "pass_message": "PermitEmptyPasswords is disabled.",
            "fail_message": "PermitEmptyPasswords is not set to 'no'.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/ubuntu_linux",
    },
    {
        "plugin_key": "CIS_UBUNTU_22_04_v2.0__5.2.10",
        "benchmark": "CIS_UBUNTU_22_04_v2.0",
        "rule_id": "5.2.10",
        "title": "Ensure SSH MaxAuthTries is set to 4 or less",
        "description": "Limits SSH authentication attempts per connection.",
        "rationale": "Mitigates brute-force attacks.",
        "remediation": "Set 'MaxAuthTries 4' in /etc/ssh/sshd_config.",
        "severity": "medium",
        "runner_type": "linux_ssh",
        "check_definition": {
            "command": "cat /etc/ssh/sshd_config",
            "expect": {"kind": "stdout_regex", "value": "^\\s*MaxAuthTries\\s+[1-4]\\s*$"},
            "pass_message": "MaxAuthTries is set to 4 or less.",
            "fail_message": "MaxAuthTries is not configured to 4 or less.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/ubuntu_linux",
    },
    {
        "plugin_key": "CIS_UBUNTU_22_04_v2.0__1.6.1",
        "benchmark": "CIS_UBUNTU_22_04_v2.0",
        "rule_id": "1.6.1",
        "title": "Ensure AppArmor is installed",
        "description": "AppArmor enforces mandatory access control on processes.",
        "rationale": "AppArmor limits damage from compromised services.",
        "remediation": "apt-get install apparmor apparmor-utils",
        "severity": "medium",
        "runner_type": "linux_ssh",
        "check_definition": {
            "command": "dpkg -s apparmor 2>/dev/null | grep -E '^Status:' || echo 'not installed'",
            "expect": {"kind": "stdout_contains", "value": "install ok installed"},
            "pass_message": "AppArmor package is installed.",
            "fail_message": "AppArmor is not installed.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/ubuntu_linux",
    },
    {
        "plugin_key": "CIS_UBUNTU_22_04_v2.0__3.5.1.1",
        "benchmark": "CIS_UBUNTU_22_04_v2.0",
        "rule_id": "3.5.1.1",
        "title": "Ensure ufw (uncomplicated firewall) is installed",
        "description": "ufw provides a simple host firewall on Ubuntu.",
        "rationale": "Host firewalls limit exposed services.",
        "remediation": "apt-get install ufw",
        "severity": "medium",
        "runner_type": "linux_ssh",
        "check_definition": {
            "command": "dpkg -s ufw 2>/dev/null | grep -E '^Status:' || echo 'not installed'",
            "expect": {"kind": "stdout_contains", "value": "install ok installed"},
            "pass_message": "ufw package is installed.",
            "fail_message": "ufw is not installed.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/ubuntu_linux",
    },
    {
        "plugin_key": "CIS_UBUNTU_22_04_v2.0__1.5.1",
        "benchmark": "CIS_UBUNTU_22_04_v2.0",
        "rule_id": "1.5.1",
        "title": "Ensure address space layout randomization (ASLR) is enabled",
        "description": "ASLR randomises memory addresses to harden against memory exploits.",
        "rationale": "ASLR raises the cost of exploitation.",
        "remediation": "Set kernel.randomize_va_space = 2 in /etc/sysctl.conf.",
        "severity": "high",
        "runner_type": "linux_ssh",
        "check_definition": {
            "command": "cat /proc/sys/kernel/randomize_va_space",
            "expect": {"kind": "stdout_contains", "value": "2"},
            "pass_message": "ASLR is fully enabled (randomize_va_space=2).",
            "fail_message": "ASLR is not fully enabled.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/ubuntu_linux",
    },
    {
        "plugin_key": "CIS_UBUNTU_22_04_v2.0__4.2.1.1",
        "benchmark": "CIS_UBUNTU_22_04_v2.0",
        "rule_id": "4.2.1.1",
        "title": "Ensure rsyslog is installed",
        "description": "rsyslog provides reliable system logging.",
        "rationale": "System logging is essential for forensic investigation.",
        "remediation": "apt-get install rsyslog",
        "severity": "medium",
        "runner_type": "linux_ssh",
        "check_definition": {
            "command": "dpkg -s rsyslog 2>/dev/null | grep -E '^Status:' || echo 'not installed'",
            "expect": {"kind": "stdout_contains", "value": "install ok installed"},
            "pass_message": "rsyslog package is installed.",
            "fail_message": "rsyslog is not installed.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/ubuntu_linux",
    },
    {
        "plugin_key": "CIS_UBUNTU_22_04_v2.0__6.2.1",
        "benchmark": "CIS_UBUNTU_22_04_v2.0",
        "rule_id": "6.2.1",
        "title": "Ensure /etc/passwd permissions are 644 or stricter",
        "description": "/etc/passwd should not be world-writable.",
        "rationale": "World-write on /etc/passwd is a critical compromise vector.",
        "remediation": "chmod 644 /etc/passwd",
        "severity": "high",
        "runner_type": "linux_ssh",
        "check_definition": {
            "command": "stat -c '%a' /etc/passwd",
            "expect": {"kind": "stdout_regex", "value": "^(644|640|600|400|444)\\s*$"},
            "pass_message": "/etc/passwd permissions are 644 or stricter.",
            "fail_message": "/etc/passwd permissions are looser than 644.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/ubuntu_linux",
    },

    # ── CIS AWS Foundations Benchmark v3.0 — additional rules (v2 expansion) ──
    {
        "plugin_key": "CIS_AWS_FOUNDATIONS_v3.0__1.6",
        "benchmark": "CIS_AWS_FOUNDATIONS_v3.0",
        "rule_id": "1.6",
        "title": "Ensure hardware MFA is enabled for the 'root' user account",
        "description": "Hardware MFA tokens are more resistant to phishing than virtual MFA.",
        "rationale": "Hardware tokens reduce risk of root credential theft.",
        "remediation": "Replace virtual MFA on the root account with a hardware MFA device.",
        "severity": "high",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "iam",
            "operation": "list_virtual_mfa_devices",
            "expect": {"kind": "no_items_match", "path": "VirtualMFADevices",
                       "match": {"field": "SerialNumber", "value": "root-account-mfa-device"}},
            "pass_message": "No virtual MFA device assigned to root (hardware MFA presumed).",
            "fail_message": "Root has a virtual MFA device — replace with hardware MFA.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/amazon_web_services",
    },
    {
        "plugin_key": "CIS_AWS_FOUNDATIONS_v3.0__1.12",
        "benchmark": "CIS_AWS_FOUNDATIONS_v3.0",
        "rule_id": "1.12",
        "title": "Ensure credentials unused for 45 days or greater are disabled",
        "description": "Inactive IAM credentials should be disabled to reduce blast radius.",
        "rationale": "Stale credentials are a common compromise vector.",
        "remediation": "Disable IAM users / access keys whose last_used > 45 days.",
        "severity": "medium",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "iam",
            "operation": "get_credential_report",
            "expect": {"kind": "exists", "path": "Content"},
            "pass_message": "Credential report retrieved — review last_used columns offline.",
            "fail_message": "Credential report unavailable.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/amazon_web_services",
    },
    {
        "plugin_key": "CIS_AWS_FOUNDATIONS_v3.0__1.14",
        "benchmark": "CIS_AWS_FOUNDATIONS_v3.0",
        "rule_id": "1.14",
        "title": "Ensure access keys are rotated every 90 days or less",
        "description": "Long-lived access keys should be rotated regularly.",
        "rationale": "Frequent rotation limits exposure of leaked keys.",
        "remediation": "Rotate access keys older than 90 days; remove unused keys.",
        "severity": "medium",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "iam",
            "operation": "get_credential_report",
            "expect": {"kind": "exists", "path": "Content"},
            "pass_message": "Credential report retrieved — review access_key_last_rotated columns.",
            "fail_message": "Credential report unavailable.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/amazon_web_services",
    },
    {
        "plugin_key": "CIS_AWS_FOUNDATIONS_v3.0__3.2",
        "benchmark": "CIS_AWS_FOUNDATIONS_v3.0",
        "rule_id": "3.2",
        "title": "Ensure CloudTrail log file validation is enabled",
        "description": "Log file validation lets you verify CloudTrail logs were not tampered with.",
        "rationale": "Tamper-evident logs are required for forensics and many audit standards.",
        "remediation": "On each trail, enable log file validation in CloudTrail settings.",
        "severity": "high",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "cloudtrail",
            "operation": "describe_trails",
            "expect": {"kind": "all_items_field_equals", "path": "trailList",
                       "field": "LogFileValidationEnabled", "value": True},
            "pass_message": "All trails have log file validation enabled.",
            "fail_message": "One or more trails do NOT have log file validation enabled.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/amazon_web_services",
    },
    {
        "plugin_key": "CIS_AWS_FOUNDATIONS_v3.0__3.7",
        "benchmark": "CIS_AWS_FOUNDATIONS_v3.0",
        "rule_id": "3.7",
        "title": "Ensure CloudTrail logs are encrypted at rest using KMS CMKs",
        "description": "CloudTrail logs should be encrypted with a customer-managed KMS key.",
        "rationale": "CMK encryption ensures only authorised principals can read log content.",
        "remediation": "Configure each trail to use a KMS CMK for SSE.",
        "severity": "high",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "cloudtrail",
            "operation": "describe_trails",
            "expect": {"kind": "no_items_match", "path": "trailList",
                       "match": {"field": "KmsKeyId", "value": None}},
            "pass_message": "No trail is missing a KmsKeyId.",
            "fail_message": "One or more trails are not encrypted with a KMS CMK (KmsKeyId is null).",
        },
        "source_url": "https://www.cisecurity.org/benchmark/amazon_web_services",
    },
    {
        "plugin_key": "CIS_AWS_FOUNDATIONS_v3.0__4.2",
        "benchmark": "CIS_AWS_FOUNDATIONS_v3.0",
        "rule_id": "4.2",
        "title": "Ensure no security groups allow ingress from 0.0.0.0/0 to port 3389 (RDP)",
        "description": "RDP should not be exposed to the public internet.",
        "rationale": "Reduces brute-force and CVE exposure on Windows hosts.",
        "remediation": "Restrict RDP ingress to known IP ranges or remove the rule.",
        "severity": "critical",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "ec2",
            "operation": "describe_security_groups",
            "expect": {"kind": "list_nonempty", "path": "SecurityGroups"},
            "pass_message": "Security groups enumerated (deeper RDP ingress check requires rule-level inspection).",
            "fail_message": "Could not enumerate security groups.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/amazon_web_services",
    },
    {
        "plugin_key": "CIS_AWS_FOUNDATIONS_v3.0__2.1.5",
        "benchmark": "CIS_AWS_FOUNDATIONS_v3.0",
        "rule_id": "2.1.5",
        "title": "Ensure S3 buckets are configured with 'Block public access (bucket settings)'",
        "description": "Bucket-level Block Public Access supplements account-level controls.",
        "rationale": "Per-bucket BPA settings catch buckets created before account-level BPA.",
        "remediation": "Enable Block Public Access on every bucket via S3 console.",
        "severity": "high",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "s3",
            "operation": "list_buckets",
            "expect": {"kind": "list_nonempty", "path": "Buckets"},
            "pass_message": "S3 buckets enumerated (per-bucket BPA inspection requires bucket-level calls).",
            "fail_message": "Could not list S3 buckets, or no buckets exist.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/amazon_web_services",
    },

    # ── CIS Ubuntu Linux 22.04 LTS Benchmark v2.0 — additional rules ──────────
    {
        "plugin_key": "CIS_UBUNTU_22_04_v2.0__1.1.1.2",
        "benchmark": "CIS_UBUNTU_22_04_v2.0",
        "rule_id": "1.1.1.2",
        "title": "Ensure squashfs kernel module is not available",
        "description": "squashfs is rarely used outside container/snap workflows.",
        "rationale": "Removing legacy filesystems reduces kernel attack surface.",
        "remediation": "echo 'install squashfs /bin/false' >> /etc/modprobe.d/squashfs.conf",
        "severity": "low",
        "runner_type": "linux_ssh",
        "check_definition": {
            "command": "grep -r 'install squashfs' /etc/modprobe.d/ 2>/dev/null || true",
            "expect": {"kind": "stdout_contains", "value": "install squashfs"},
            "pass_message": "squashfs is configured to be disabled.",
            "fail_message": "squashfs is not blocked in /etc/modprobe.d/.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/ubuntu_linux",
    },
    {
        "plugin_key": "CIS_UBUNTU_22_04_v2.0__1.1.1.3",
        "benchmark": "CIS_UBUNTU_22_04_v2.0",
        "rule_id": "1.1.1.3",
        "title": "Ensure udf kernel module is not available",
        "description": "Universal Disk Format is rarely needed on servers.",
        "rationale": "Removing unused filesystems reduces kernel attack surface.",
        "remediation": "echo 'install udf /bin/false' >> /etc/modprobe.d/udf.conf",
        "severity": "low",
        "runner_type": "linux_ssh",
        "check_definition": {
            "command": "grep -r 'install udf' /etc/modprobe.d/ 2>/dev/null || true",
            "expect": {"kind": "stdout_contains", "value": "install udf"},
            "pass_message": "udf is configured to be disabled.",
            "fail_message": "udf is not blocked in /etc/modprobe.d/.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/ubuntu_linux",
    },
    {
        "plugin_key": "CIS_UBUNTU_22_04_v2.0__5.1.1",
        "benchmark": "CIS_UBUNTU_22_04_v2.0",
        "rule_id": "5.1.1",
        "title": "Ensure cron daemon is enabled and active",
        "description": "cron is required for scheduled hardening and patching tasks.",
        "rationale": "Without cron, scheduled security tasks won't run.",
        "remediation": "systemctl --now enable cron",
        "severity": "medium",
        "runner_type": "linux_ssh",
        "check_definition": {
            "command": "systemctl is-active cron 2>/dev/null || echo inactive",
            "expect": {"kind": "stdout_contains", "value": "active"},
            "pass_message": "cron service is active.",
            "fail_message": "cron service is not active.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/ubuntu_linux",
    },
    {
        "plugin_key": "CIS_UBUNTU_22_04_v2.0__6.2.2",
        "benchmark": "CIS_UBUNTU_22_04_v2.0",
        "rule_id": "6.2.2",
        "title": "Ensure /etc/shadow permissions are 640 or stricter",
        "description": "/etc/shadow contains password hashes and must not be world-readable.",
        "rationale": "World-read on /etc/shadow exposes hashes to offline cracking.",
        "remediation": "chmod 640 /etc/shadow && chown root:shadow /etc/shadow",
        "severity": "critical",
        "runner_type": "linux_ssh",
        "check_definition": {
            "command": "stat -c '%a' /etc/shadow",
            "expect": {"kind": "stdout_regex", "value": "^(640|600|400|000)\\s*$"},
            "pass_message": "/etc/shadow permissions are 640 or stricter.",
            "fail_message": "/etc/shadow permissions are looser than 640.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/ubuntu_linux",
    },
    {
        "plugin_key": "CIS_UBUNTU_22_04_v2.0__6.2.3",
        "benchmark": "CIS_UBUNTU_22_04_v2.0",
        "rule_id": "6.2.3",
        "title": "Ensure /etc/group permissions are 644 or stricter",
        "description": "/etc/group should not be world-writable.",
        "rationale": "World-write on /etc/group enables privilege-escalation via group membership.",
        "remediation": "chmod 644 /etc/group",
        "severity": "high",
        "runner_type": "linux_ssh",
        "check_definition": {
            "command": "stat -c '%a' /etc/group",
            "expect": {"kind": "stdout_regex", "value": "^(644|640|600|400|444)\\s*$"},
            "pass_message": "/etc/group permissions are 644 or stricter.",
            "fail_message": "/etc/group permissions are looser than 644.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/ubuntu_linux",
    },
    {
        "plugin_key": "CIS_AWS_FOUNDATIONS_v3.0__2.2.1",
        "benchmark": "CIS_AWS_FOUNDATIONS_v3.0",
        "rule_id": "2.2.1",
        "title": "Ensure EBS default encryption is enabled (account-wide check)",
        "description": "Default EBS encryption must be on so newly-created volumes are encrypted automatically.",
        "rationale": "Eliminates the risk of a forgotten unencrypted volume.",
        "remediation": "Enable EBS encryption by default in every active region.",
        "severity": "high",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "ec2",
            "operation": "get_ebs_default_kms_key_id",
            "expect": {"kind": "exists", "path": "KmsKeyId"},
            "pass_message": "EBS default KMS key id is set.",
            "fail_message": "No EBS default KMS key id configured.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/amazon_web_services",
    },
    {
        "plugin_key": "CIS_AWS_FOUNDATIONS_v3.0__3.6",
        "benchmark": "CIS_AWS_FOUNDATIONS_v3.0",
        "rule_id": "3.6",
        "title": "Ensure CloudTrail trails deliver to an S3 bucket (audit log durability)",
        "description": "Each CloudTrail trail must have an S3 bucket configured so events are persisted off-host for forensic review.",
        "rationale": "A trail with no S3 destination loses events as soon as they roll off the in-region log buffer.",
        "remediation": "On every trail, set an S3 destination bucket and enable server access logging on that bucket.",
        "severity": "medium",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "cloudtrail",
            "operation": "describe_trails",
            "expect": {"kind": "no_items_match", "path": "trailList",
                       "match": {"field": "S3BucketName", "value": None}},
            "pass_message": "Every CloudTrail trail has an S3 bucket destination configured.",
            "fail_message": "One or more trails have no S3BucketName configured.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/amazon_web_services",
    },
    {
        "plugin_key": "CIS_AWS_FOUNDATIONS_v3.0__1.20",
        "benchmark": "CIS_AWS_FOUNDATIONS_v3.0",
        "rule_id": "1.20",
        "title": "Ensure IAM Access Analyzer is enabled for all regions",
        "description": "IAM Access Analyzer continuously evaluates resource policies for unintended public/cross-account access.",
        "rationale": "Catches mis-scoped policies before they become incidents.",
        "remediation": "Create an Access Analyzer in every active region.",
        "severity": "medium",
        "runner_type": "aws_readonly",
        "check_definition": {
            "service": "accessanalyzer",
            "operation": "list_analyzers",
            "expect": {"kind": "list_nonempty", "path": "analyzers"},
            "pass_message": "At least one IAM Access Analyzer is configured.",
            "fail_message": "No IAM Access Analyzer found in this region.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/amazon_web_services",
    },
    {
        "plugin_key": "CIS_UBUNTU_22_04_v2.0__1.4.1",
        "benchmark": "CIS_UBUNTU_22_04_v2.0",
        "rule_id": "1.4.1",
        "title": "Ensure bootloader password is set",
        "description": "GRUB should require a password before allowing boot-parameter edits.",
        "rationale": "Prevents an attacker with console access from booting into single-user mode.",
        "remediation": "Set a GRUB password via grub-mkpasswd-pbkdf2 and update /etc/grub.d/.",
        "severity": "medium",
        "runner_type": "linux_ssh",
        "check_definition": {
            "command": "grep -E '^(set superusers|password_pbkdf2)' /boot/grub/grub.cfg 2>/dev/null || true",
            "expect": {"kind": "stdout_contains", "value": "password_pbkdf2"},
            "pass_message": "GRUB bootloader password is configured.",
            "fail_message": "GRUB bootloader password is not configured.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/ubuntu_linux",
    },
    {
        "plugin_key": "CIS_UBUNTU_22_04_v2.0__4.1.1.1",
        "benchmark": "CIS_UBUNTU_22_04_v2.0",
        "rule_id": "4.1.1.1",
        "title": "Ensure auditd is installed",
        "description": "auditd captures kernel-level audit events required for forensic investigation.",
        "rationale": "Without auditd, host-level security telemetry is missing.",
        "remediation": "apt-get install auditd audispd-plugins",
        "severity": "high",
        "runner_type": "linux_ssh",
        "check_definition": {
            "command": "dpkg -s auditd 2>/dev/null | grep -E '^Status:' || echo 'not installed'",
            "expect": {"kind": "stdout_contains", "value": "install ok installed"},
            "pass_message": "auditd package is installed.",
            "fail_message": "auditd is not installed.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/ubuntu_linux",
    },
    {
        "plugin_key": "CIS_UBUNTU_22_04_v2.0__5.2.4",
        "benchmark": "CIS_UBUNTU_22_04_v2.0",
        "rule_id": "5.2.4",
        "title": "Ensure SSH protocol version 2 is enforced",
        "description": "SSH protocol 1 is deprecated and insecure.",
        "rationale": "Forces clients onto modern, vetted crypto.",
        "remediation": "Set 'Protocol 2' in /etc/ssh/sshd_config (default in OpenSSH ≥ 7.4).",
        "severity": "high",
        "runner_type": "linux_ssh",
        "check_definition": {
            "command": "sshd -T 2>&1 | grep -E '^protocol' || true",
            "expect": {"kind": "stdout_regex", "value": "^protocol\\s+2\\s*$"},
            "pass_message": "SSH protocol 2 is in effect.",
            "fail_message": "SSH protocol is not exclusively version 2 (sshd -T did not report 'protocol 2').",
        },
        "source_url": "https://www.cisecurity.org/benchmark/ubuntu_linux",
    },
    {
        "plugin_key": "CIS_UBUNTU_22_04_v2.0__5.4.4",
        "benchmark": "CIS_UBUNTU_22_04_v2.0",
        "rule_id": "5.4.4",
        "title": "Ensure default user umask is 027 or stricter",
        "description": "Default umask should restrict group-write and all other-access.",
        "rationale": "Loose umask leaks files to the local group / other users by default.",
        "remediation": "Set 'umask 027' in /etc/login.defs and /etc/profile.",
        "severity": "medium",
        "runner_type": "linux_ssh",
        "check_definition": {
            "command": "grep -E '^\\s*UMASK' /etc/login.defs 2>/dev/null || true",
            "expect": {"kind": "stdout_regex", "value": "UMASK\\s+(027|077|022)"},
            "pass_message": "Default umask is 027 or stricter (UMASK directive present).",
            "fail_message": "Default umask is not configured to 027 or stricter in /etc/login.defs.",
        },
        "source_url": "https://www.cisecurity.org/benchmark/ubuntu_linux",
    },
]


_READONLY_AWS_PREFIXES = ("get_", "list_", "describe_", "head_", "lookup_", "select_", "search_")


def _validate_readonly_at_seed_time(spec: Dict[str, Any]) -> None:
    """Refuse to seed a plugin whose AWS check is not a read-only verb.

    Mirrors the runtime check in aws_runner._is_readonly_aws_operation, but
    runs at seed-time so non-compliant entries can never reach prod. SSH
    checks are validated by the existing _is_command_safe filter in the
    runner; we do not duplicate that here.
    """
    if spec.get("runner_type") != "aws_readonly":
        return
    op = ((spec.get("check_definition") or {}).get("operation") or "").lower()
    if not op.startswith(_READONLY_AWS_PREFIXES):
        raise ValueError(
            f"Plugin {spec.get('plugin_key')!r} violates the read-only contract: "
            f"AWS operation {op!r} is not in {_READONLY_AWS_PREFIXES}"
        )


def seed_compliance_plugins(db: Session | None = None) -> int:
    """Idempotently seed the built-in plugin library into a tenant DB.

    Built-ins are stored with tenant_id=NULL. Updates: any change to
    PLUGIN_LIBRARY metadata (title, severity, check_definition, etc.) is
    upserted on next call. Returns the number of rows inserted-or-updated.

    Multi-tenant note: this platform stores operational data in a
    database-per-tenant. ``db`` MUST be a Session bound to the *target
    tenant's* DB (i.e. ``open_tenant_session(slug)``); calling without a
    session would write to the master catalog DB, where the catalog rows
    are unreachable to any tenant's app code. We raise loudly rather than
    silently miswrite — keep the fail-fast behaviour even in dev.
    """
    own_db = db is None
    if own_db:
        raise RuntimeError(
            "seed_compliance_plugins() requires an explicit tenant-DB Session. "
            "Pass open_tenant_session(slug) — never call without args, or the "
            "catalog will land in grc_master where the app can't see it."
        )
    touched = 0
    try:
        for spec in PLUGIN_LIBRARY:
            _validate_readonly_at_seed_time(spec)
            existing = (
                db.query(CompliancePlugin)
                .filter(CompliancePlugin.tenant_id.is_(None), CompliancePlugin.plugin_key == spec["plugin_key"])
                .first()
            )
            if existing:
                # Update metadata in-place; preserve id and is_builtin flag.
                for k, v in spec.items():
                    setattr(existing, k, v)
                existing.is_builtin = True
                db.add(existing)
            else:
                row = CompliancePlugin(tenant_id=None, is_builtin=True, **spec)
                db.add(row)
            touched += 1
        db.commit()
        logger.info("seed_compliance_plugins: upserted %d built-in plugins", touched)
        # Additive SOC 2 quantitative AWS catalog (does not alter CIS payloads).
        try:
            from .seed_soc2_quantitative import seed_soc2_quantitative_plugins

            touched += seed_soc2_quantitative_plugins(db)
        except Exception:
            logger.exception("seed_soc2_quantitative_plugins failed after CIS seed")
            raise
    except Exception as exc:
        db.rollback()
        logger.exception("seed_compliance_plugins failed: %s", exc)
        raise
    return touched


# ─── Global-library sync (PDF-ingested CIS benchmarks) ──────────────────────
# `seed_compliance_plugins` only loads the 36 built-in PLUGIN_LIBRARY rows.
# The other ~5,300 rules that operators expect to see (CIS Windows 11,
# Ubuntu, etc.) are PDF-ingested via the /compliance-plugins/ingest UI
# into ONE tenant's DB — they land with `tenant_id IS NULL` (conceptually
# "global to that DB") but DO NOT auto-propagate to other tenants because
# the platform is database-per-tenant.
#
# Result: tenants created AFTER the operator did their PDF ingest get a
# near-empty library (the 36 built-ins only). This function copies the
# global rows from a canonical source tenant into a target tenant DB so
# every tenant sees the same library.
#
# Provisioning: call this from tenant_manager._seed_tenant_database
# right after seed_compliance_plugins so new tenants start fully loaded.
# One-shot backfill: call directly against an under-seeded tenant.
def sync_global_plugins_from_source(
    target_db: Session,
    source_db: Session,
) -> int:
    """Copy all `tenant_id IS NULL` rows from source_db into target_db.

    Idempotent on (plugin_key). If a target row with the same plugin_key
    already exists (e.g. one of the 36 built-ins), it's left untouched —
    we only INSERT the rows that target_db is missing. This means re-running
    the sync against an already-synced tenant is a no-op (insert count = 0).

    Returns the number of rows actually inserted.
    """
    from sqlalchemy import select

    # Pull all existing plugin_keys on the target so we know what to skip.
    existing_keys = {
        k for (k,) in target_db.execute(
            select(CompliancePlugin.plugin_key).where(CompliancePlugin.tenant_id.is_(None))
        )
    }

    # Stream global rows from source.
    src_rows = source_db.query(CompliancePlugin).filter(
        CompliancePlugin.tenant_id.is_(None)
    ).all()
    if not src_rows:
        logger.warning(
            "sync_global_plugins_from_source: source tenant has no global plugins"
            " — backfill source likely under-seeded itself"
        )
        return 0

    inserted = 0
    try:
        # SQLAlchemy ORM-level copy: enumerate columns from the mapper so
        # we don't have to keep this in sync with the model schema as it
        # grows. Skip id (autoincrement) + tenant_id (force NULL).
        # Skip parent_plugin_id on the first pass — that's a self-FK
        # pointing at source-DB ids which don't exist in target. We fix
        # parent links in a second pass after the new rows have target ids.
        col_names = [c.name for c in CompliancePlugin.__table__.columns
                     if c.name not in ('id', 'tenant_id', 'parent_plugin_id')]
        # src.id -> (target row + remembered parent_plugin_id from source)
        # so we can resolve the FK after all inserts settle.
        parent_link_pending: list[tuple[int, int]] = []  # (target_id, src_parent_id)
        src_id_to_target_id: dict[int, int] = {}
        for src in src_rows:
            if src.plugin_key in existing_keys:
                continue
            data = {col: getattr(src, col) for col in col_names}
            new_row = CompliancePlugin(tenant_id=None, **data)
            target_db.add(new_row)
            target_db.flush()  # populate new_row.id
            src_id_to_target_id[src.id] = new_row.id
            if src.parent_plugin_id is not None:
                parent_link_pending.append((new_row.id, src.parent_plugin_id))
            inserted += 1
            # Commit in batches so memory stays bounded and a single bad
            # row doesn't abort everything.
            if inserted % 500 == 0:
                target_db.commit()
        target_db.commit()

        # Second pass: fix parent_plugin_id FKs using the src->target map.
        # parent might be an EXISTING target row (one of the 36 built-ins)
        # — in that case the source-id won't be in our map, so we look it
        # up on the source by plugin_key and find the target's id by key.
        fixed_links = 0
        for target_id, src_parent_id in parent_link_pending:
            target_parent_id = src_id_to_target_id.get(src_parent_id)
            if target_parent_id is None:
                # Parent was already on target before sync ran — resolve
                # by plugin_key. Falls through to NULL if no match.
                parent_src = source_db.query(CompliancePlugin).get(src_parent_id)
                if parent_src is not None:
                    match = (
                        target_db.query(CompliancePlugin)
                        .filter(CompliancePlugin.plugin_key == parent_src.plugin_key,
                                CompliancePlugin.tenant_id.is_(None))
                        .first()
                    )
                    target_parent_id = match.id if match else None
            if target_parent_id is not None:
                target_db.query(CompliancePlugin).filter(
                    CompliancePlugin.id == target_id
                ).update({"parent_plugin_id": target_parent_id})
                fixed_links += 1
        target_db.commit()

        logger.info(
            "sync_global_plugins_from_source: inserted %d global plugin(s)"
            " (source had %d total, target already had %d, parent FKs fixed=%d)",
            inserted, len(src_rows), len(existing_keys), fixed_links,
        )
    except Exception as exc:
        target_db.rollback()
        logger.exception("sync_global_plugins_from_source failed: %s", exc)
        raise
    return inserted
