"""Cloud transport (C4): the AWS collector, driven by a fake boto3 client.

No AWS account and no network. `run_cloud_provider` takes a client factory, so
every path — authenticated, rejected, partially collectable — is exercised
against canned responses. What these assert is not "boto3 works" but the two
rules the rest of the platform depends on: a collector that cannot collect never
emits a control failure, and connectivity never emits a control pass.
"""
import pytest

from grc.modules.compliance_plugins.runners.cloud_transport import (
    CLOUD_CHECKS,
    aws_call,
    cloud_control_codes,
    run_cloud_provider,
)
from grc.modules.compliance_plugins.runners.live_api_catalog import (
    PROVIDER_API,
    all_control_codes,
    provider_meta,
)

CREDS = {"access_key_id": "AKIAEXAMPLE", "token": "secret", "region": "eu-west-1"}
SPEC = PROVIDER_API["aws"]


class Denied(Exception):
    """Stands in for botocore's ClientError, which the transport catches broadly."""


class FakeClient:
    def __init__(self, responses):
        self._responses = responses

    def __getattr__(self, name):
        if name not in self._responses:
            raise AttributeError(name)

        def call(**kwargs):
            r = self._responses[name]
            if isinstance(r, Exception):
                raise r
            return r(**kwargs) if callable(r) else dict(r)
        return call


def factory_for(by_service):
    def factory(service, creds):
        return FakeClient(by_service.get(service, {}))
    return factory


# A healthy account: root MFA on, no root keys, strong policy, multi-region
# trail, EBS default encryption, Config recording, one console user with MFA.
HEALTHY = {
    "sts": {"get_caller_identity": {"Arn": "arn:aws:iam::123456789012:user/audit", "Account": "123456789012"}},
    "iam": {
        "get_account_summary": {"SummaryMap": {"AccountMFAEnabled": 1, "AccountAccessKeysPresent": 0}},
        "get_account_password_policy": {"PasswordPolicy": {"MinimumPasswordLength": 16}},
        "list_users": {"Users": [{"UserName": "alice"}]},
        "get_login_profile": {"LoginProfile": {"UserName": "alice"}},
        "list_mfa_devices": {"MFADevices": [{"SerialNumber": "arn:aws:iam::1:mfa/alice"}]},
    },
    "cloudtrail": {"describe_trails": {"trailList": [{"Name": "org", "IsMultiRegionTrail": True}]}},
    "ec2": {"get_ebs_encryption_by_default": {"EbsEncryptionByDefault": True}},
    "config": {"describe_configuration_recorders": {"ConfigurationRecorders": [{"name": "default"}]}},
    "backup": {
        "list_backup_plans": {"BackupPlansList": [{"BackupPlanName": "daily"}]},
        "list_protected_resources": {"Results": [{"ResourceType": "RDS"}]},
    },
    "rds": {"describe_db_instances": {"DBInstances": [{"DBInstanceIdentifier": "orders", "BackupRetentionPeriod": 14}]}},
    "dynamodb": {
        "list_tables": {"TableNames": ["carts"]},
        "describe_continuous_backups": {"ContinuousBackupsDescription": {
            "PointInTimeRecoveryDescription": {"PointInTimeRecoveryStatus": "ENABLED"}}},
    },
}


def run(by_service, creds=CREDS):
    return run_cloud_provider("aws", SPEC, creds, factory=factory_for(by_service))


def findings_by_check(result):
    return {f["check"]: f for f in result["findings"]}


# ── the catalog sees AWS as an ordinary connector ────────────────────────────

def test_aws_is_in_the_connector_catalog_with_a_transport():
    assert SPEC["transport"] == "aws"
    row = next(r for r in provider_meta() if r["provider"] == "aws")
    assert row["category"] == "cloud" and row["needs_key_id"] and row["needs_region"]


def test_seed_mapping_covers_every_code_the_transport_can_emit():
    # If this drifts, checks emit codes no control is indexed under and the
    # findings reach no control at all.
    declared = set(all_control_codes("aws"))
    emitted = {c for chk in CLOUD_CHECKS["aws"] for c in chk["controls"]} | {"CC6.1", "CC6.2"}
    assert emitted <= declared


def test_cloud_control_codes_includes_the_sweep():
    assert {"CC6.1", "CC6.2"} <= set(cloud_control_codes("aws"))


# ── connectivity is never a control pass ─────────────────────────────────────

def test_connectivity_is_info_not_pass():
    conn = findings_by_check(run(HEALTHY))["aws.connectivity"]
    assert conn["status"] == "info", "a working key must not credit a control"
    assert conn["resource"] == "arn:aws:iam::123456789012:user/audit"


def test_healthy_account_passes_every_check():
    result = run(HEALTHY)
    assert result["connectivity"] == "pass"
    assert result["summary"]["fail"] == 0
    assert result["summary"]["error"] == 0
    assert result["summary"]["pass"] == len(CLOUD_CHECKS["aws"]) + 2   # + the MFA and PITR sweeps


# ── a collector that cannot collect never fails a control ────────────────────

def test_rejected_credentials_produce_no_control_failure():
    result = run({"sts": {"get_caller_identity": Denied("InvalidClientTokenId")}})
    assert result["connectivity"] == "error"
    assert [f["status"] for f in result["findings"]] == ["error"]
    assert not any(f["status"] == "fail" for f in result["findings"])


def test_missing_credentials_are_a_collection_error():
    ok, _data, detail = aws_call({}, "sts", "get_caller_identity", factory=factory_for(HEALTHY))
    assert ok is False and "not configured" in detail


def test_one_unreadable_service_does_not_fail_its_control():
    # Config denied by IAM policy: we cannot see, so we must not claim a finding.
    broken = {**HEALTHY, "config": {"describe_configuration_recorders": Denied("AccessDenied")}}
    f = findings_by_check(run(broken))["aws.config_recorder"]
    assert f["status"] == "error" and "Could not collect" in f["detail"]


def test_absent_resource_is_evidence_not_an_error():
    # An unset password policy raises NoSuchEntity. That IS the finding.
    no_policy = {**HEALTHY, "iam": {**HEALTHY["iam"],
                                    "get_account_password_policy": Denied("NoSuchEntity: policy not found")}}
    f = findings_by_check(run(no_policy))["aws.password_policy"]
    assert f["status"] == "fail" and "unset" in f["detail"]


# ── the checks actually discriminate ─────────────────────────────────────────

def test_root_without_mfa_fails():
    weak = {**HEALTHY, "iam": {**HEALTHY["iam"],
                               "get_account_summary": {"SummaryMap": {"AccountMFAEnabled": 0,
                                                                      "AccountAccessKeysPresent": 1}}}}
    f = findings_by_check(run(weak))
    assert f["aws.root_mfa"]["status"] == "fail"
    assert f["aws.root_access_keys"]["status"] == "fail"


def test_short_password_policy_fails():
    weak = {**HEALTHY, "iam": {**HEALTHY["iam"],
                               "get_account_password_policy": {"PasswordPolicy": {"MinimumPasswordLength": 8}}}}
    assert findings_by_check(run(weak))["aws.password_policy"]["status"] == "fail"


def test_single_region_trail_fails_the_multi_region_check():
    weak = {**HEALTHY,
            "cloudtrail": {"describe_trails": {"trailList": [{"Name": "eu", "IsMultiRegionTrail": False}]}}}
    assert findings_by_check(run(weak))["aws.cloudtrail"]["status"] == "fail"


def test_console_user_without_mfa_is_named():
    weak = {**HEALTHY, "iam": {**HEALTHY["iam"],
                               "list_users": {"Users": [{"UserName": "alice"}, {"UserName": "bob"}]},
                               "list_mfa_devices": {"MFADevices": []}}}
    result = run(weak)
    named = [f for f in result["findings"] if f["check"] == "aws.iam_user_mfa"]
    assert {f["resource"] for f in named} == {"alice", "bob"}
    assert findings_by_check(result)["aws.iam_mfa"]["status"] == "fail"


def test_users_without_console_access_are_not_counted():
    # A service account cannot log in interactively, so MFA is not its control.
    svc = {**HEALTHY, "iam": {**HEALTHY["iam"],
                              "list_users": {"Users": [{"UserName": "ci-deploy"}]},
                              "get_login_profile": Denied("NoSuchEntity"),
                              "list_mfa_devices": {"MFADevices": []}}}
    summary = findings_by_check(run(svc))["aws.iam_mfa"]
    assert summary["status"] == "pass"
    assert "0 of 0 console users lack MFA" in summary["detail"]


# ── the read-only contract holds at the transport, not just at seed time ─────

@pytest.mark.parametrize("op", ["delete_user", "put_bucket_policy", "create_access_key",
                                "update_account_password_policy"])
def test_write_operations_are_refused(op):
    ok, _data, detail = aws_call(CREDS, "iam", op, factory=factory_for(HEALTHY))
    assert ok is False and "read-only" in detail


def test_every_seeded_check_uses_a_read_only_verb():
    for check in CLOUD_CHECKS["aws"]:
        assert check["operation"].startswith(("get_", "list_", "describe_", "head_", "lookup_"))


# ── backups ──────────────────────────────────────────────────────────────────

def with_service(service, responses):
    return {**HEALTHY, service: {**HEALTHY.get(service, {}), **responses}}


def test_short_rds_backup_retention_fails_and_names_the_instance():
    result = run(with_service("rds", {"describe_db_instances": {"DBInstances": [
        {"DBInstanceIdentifier": "orders", "BackupRetentionPeriod": 14},
        {"DBInstanceIdentifier": "legacy", "BackupRetentionPeriod": 1},
    ]}}))
    f = findings_by_check(result)["aws.rds_backup_retention"]
    assert f["status"] == "fail" and "legacy" in f["detail"] and "1 of 2" in f["detail"]


def test_no_rds_instances_is_not_assessed_rather_than_passed():
    f = findings_by_check(run(with_service("rds", {"describe_db_instances": {"DBInstances": []}})))
    assert f["aws.rds_backup_retention"]["status"] == "not_run"


def test_dynamodb_table_without_pitr_is_named():
    result = run(with_service("dynamodb", {
        "list_tables": {"TableNames": ["carts", "sessions"]},
        "describe_continuous_backups": lambda TableName: {"ContinuousBackupsDescription": {
            "PointInTimeRecoveryDescription": {
                "PointInTimeRecoveryStatus": "ENABLED" if TableName == "carts" else "DISABLED"}}},
    }))
    named = [f for f in result["findings"] if f["check"] == "aws.dynamodb_table_pitr"]
    assert [f["resource"] for f in named] == ["sessions"]
    assert findings_by_check(result)["aws.dynamodb_pitr"]["status"] == "fail"


def test_no_dynamodb_tables_is_not_assessed():
    f = findings_by_check(run(with_service("dynamodb", {"list_tables": {"TableNames": []}})))
    assert f["aws.dynamodb_pitr"]["status"] == "not_run"


def test_backup_sweep_is_bound_like_any_declared_check():
    from grc.modules.compliance_plugins.runners.live_api_catalog import provider_checks
    ids = {c["id"]: c["controls"] for c in provider_checks("aws")}
    assert ids["aws.dynamodb_pitr"] == ["A1.2"] and ids["aws.iam_mfa"] == ["CC6.1", "CC6.2"]
    assert "aws.sweep" not in ids
