"""Cloud transports for the connector catalog.

The 65 connectors in `live_api_catalog` all speak the same dialect: an HTTPS
call carrying a static token. The cloud providers do not — AWS signs each
request with a key pair, Azure/GCP/Entra exchange a client credential for a
short-lived bearer, Kubernetes presents a service-account token against a
cluster CA. That is a transport difference, not a different kind of collector,
so a provider spec names a `transport` and everything downstream — the catalog,
the admin page, collection health, the control crosswalk — is unchanged.

    PROVIDER_API["aws"] = {..., "transport": "aws"}

A transport owns two things: proving it can reach the account at all, and
making one read-only call. Everything above it stays declarative, so adding
Azure or GCP is a `_call` implementation plus a list of checks, not a new
runner.

AWS is implemented here on boto3. Its read-only guard is imported from
`aws_runner` rather than restated: one list of permitted verbs, enforced at the
only place a call is made.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple

from .aws_runner import _evaluate_expectation, _is_readonly_aws_operation

try:  # pragma: no cover - exercised by the absence path only
    import boto3
    from botocore.config import Config
    from botocore.exceptions import BotoCoreError, ClientError
    BOTO3_AVAILABLE = True
except ImportError:  # pragma: no cover
    BOTO3_AVAILABLE = False
    BotoCoreError = ClientError = Exception  # type: ignore[misc,assignment]

# A collector must never be the reason an audit stalls, so every call is bounded.
_TIMEOUT = dict(connect_timeout=10, read_timeout=30, retries={"max_attempts": 2})
# Access-review sweeps page at this many principals. A larger estate reports the
# cap in its detail line rather than silently testing a subset.
SWEEP_CAP = 200

# A call result: (ok, data, detail). `ok` False means we could not look, which is
# a collection failure — never a control failure.
CallResult = Tuple[bool, Any, str]

ClientFactory = Callable[[str, Dict[str, Any]], Any]


def _aws_credentials(creds: Dict[str, Any]) -> Dict[str, Optional[str]]:
    """Accept both credential shapes.

    `aws_readonly` connections (Connect Wizard / env vars) carry aws_* keys; a
    connection made through the evidence-collector page carries the catalog's
    own field names. Same account either way.
    """
    return {
        "aws_access_key_id": creds.get("aws_access_key_id") or creds.get("access_key_id") or "",
        "aws_secret_access_key": (creds.get("aws_secret_access_key")
                                  or creds.get("token") or ""),
        "aws_session_token": creds.get("aws_session_token") or None,
        "region_name": (creds.get("aws_region") or creds.get("region")
                        or creds.get("domain") or "us-east-1"),
    }


def _default_aws_factory(service: str, creds: Dict[str, Any]) -> Any:
    resolved = _aws_credentials(creds)
    return boto3.client(service, config=Config(**_TIMEOUT), **resolved)


def aws_call(creds: Dict[str, Any], service: str, operation: str,
             kwargs: Optional[Dict[str, Any]] = None,
             factory: Optional[ClientFactory] = None) -> CallResult:
    """One read-only AWS call. Never raises: a failure is a result, not an exception."""
    if not BOTO3_AVAILABLE and factory is None:
        return False, None, "boto3 is not installed on this server"
    if not _is_readonly_aws_operation(operation):
        # Belt and braces: the seeded checks are read-only by construction, and
        # this refuses anything that ever stops being so.
        return False, None, f"Refusing non-read-only AWS operation '{operation}'"
    resolved = _aws_credentials(creds)
    if not resolved["aws_access_key_id"] or not resolved["aws_secret_access_key"]:
        return False, None, "AWS access key and secret key are not configured"
    try:
        client = (factory or _default_aws_factory)(service, creds)
        method = getattr(client, operation, None)
        if method is None:
            return False, None, f"AWS {service} client has no method '{operation}'"
        response = method(**(kwargs or {}))
        if isinstance(response, dict):
            response.pop("ResponseMetadata", None)
        return True, response, "ok"
    except (BotoCoreError, ClientError) as exc:      # provider said no
        return False, None, str(exc)
    except Exception as exc:                          # noqa: BLE001 - transport is a boundary
        return False, None, f"{type(exc).__name__}: {exc}"


# ── declarative checks ───────────────────────────────────────────────────────
# Each entry is one read-only call and one expectation, mapped to the SOC 2
# criteria it speaks to. `absent_is` says what a missing resource means: AWS
# returns NoSuchEntity for an unset password policy, which is a finding, not an
# error.
CLOUD_CHECKS: Dict[str, List[Dict[str, Any]]] = {
    "aws": [
        {
            "id": "aws.root_mfa", "service": "iam", "operation": "get_account_summary",
            "resource": "account", "controls": ["CC6.1", "CC6.6"],
            "expect": {"kind": "field_equals", "path": "SummaryMap.AccountMFAEnabled", "value": 1},
            "pass_message": "Root account has MFA enabled",
            "fail_message": "Root account has no MFA device — anyone with the root password has full control",
        },
        {
            "id": "aws.root_access_keys", "service": "iam", "operation": "get_account_summary",
            "resource": "account", "controls": ["CC6.1"],
            "expect": {"kind": "field_equals", "path": "SummaryMap.AccountAccessKeysPresent", "value": 0},
            "pass_message": "Root account has no access keys",
            "fail_message": "Root account has an access key — long-lived unrestricted credentials",
        },
        {
            "id": "aws.password_policy", "service": "iam",
            "operation": "get_account_password_policy", "resource": "account",
            "controls": ["CC6.1"], "absent_is": "fail",
            "expect": {"kind": "field_gte", "path": "PasswordPolicy.MinimumPasswordLength", "value": 14},
            "pass_message": "Password policy requires at least 14 characters",
            "fail_message": "Password policy is unset or shorter than 14 characters",
        },
        {
            "id": "aws.cloudtrail", "service": "cloudtrail", "operation": "describe_trails",
            "resource": "account", "controls": ["CC7.2"],
            "expect": {"kind": "any_item_field_equals", "path": "trailList",
                       "field": "IsMultiRegionTrail", "value": True},
            "pass_message": "A multi-region CloudTrail trail is configured",
            "fail_message": "No multi-region CloudTrail trail — API activity is not fully recorded",
        },
        {
            "id": "aws.ebs_encryption", "service": "ec2",
            "operation": "get_ebs_encryption_by_default", "resource": "region",
            "controls": ["CC6.7"],
            "expect": {"kind": "field_equals", "path": "EbsEncryptionByDefault", "value": True},
            "pass_message": "EBS volumes are encrypted by default in this region",
            "fail_message": "EBS default encryption is off — new volumes may be created unencrypted",
        },
        {
            "id": "aws.config_recorder", "service": "config",
            "operation": "describe_configuration_recorders", "resource": "region",
            "controls": ["CC7.1"],
            "expect": {"kind": "list_nonempty", "path": "ConfigurationRecorders"},
            "pass_message": "AWS Config is recording resource configuration",
            "fail_message": "AWS Config has no recorder — configuration drift is not tracked",
        },
    ],
}


def _finding(controls: List[str], check: str, resource: str, status: str, detail: str) -> dict:
    return {"control_codes": list(controls), "check": check, "resource": resource,
            "status": status, "detail": detail}


def _expect(response: Any, spec: Dict[str, Any]) -> Tuple[bool, str]:
    """`aws_runner`'s evaluator, plus the two shapes these checks need."""
    kind = (spec or {}).get("kind")
    if kind == "field_gte":
        cur: Any = response
        for part in (spec.get("path") or "").split("."):
            cur = cur.get(part) if isinstance(cur, dict) else None
        try:
            return (cur is not None and cur >= spec["value"]), f"{spec['path']} = {cur}"
        except TypeError:
            return False, f"{spec['path']} = {cur!r} is not comparable"
    if kind == "any_item_field_equals":
        items = response.get(spec.get("path")) if isinstance(response, dict) else None
        items = items if isinstance(items, list) else []
        hits = [i for i in items if isinstance(i, dict) and i.get(spec["field"]) == spec["value"]]
        return bool(hits), f"{len(hits)} of {len(items)} items match {spec['field']}={spec['value']}"
    return _evaluate_expectation(response if isinstance(response, dict) else {}, spec)


def _iam_mfa_sweep(creds: Dict[str, Any], factory: Optional[ClientFactory]) -> List[dict]:
    """Per-user MFA, the access-review sweep the Okta collector already does.

    A console user without MFA is the finding auditors ask for by name. Users
    with no console password are excluded: they cannot log in interactively, so
    MFA is not the control that applies to them.
    """
    ok, data, detail = aws_call(creds, "iam", "list_users", factory=factory)
    if not ok:
        return [_finding(["CC6.1", "CC6.2"], "aws.iam_mfa", "directory", "error",
                         f"Could not list IAM users — {detail}")]
    users = (data or {}).get("Users") or []
    out: List[dict] = []
    no_mfa = 0
    checked = 0
    for u in users[:SWEEP_CAP]:
        name = u.get("UserName") or "user"
        pw_ok, _pw, _d = aws_call(creds, "iam", "get_login_profile",
                                  {"UserName": name}, factory=factory)
        if not pw_ok:
            continue                      # no console password: MFA does not apply
        checked += 1
        mfa_ok, mfa, _d = aws_call(creds, "iam", "list_mfa_devices",
                                   {"UserName": name}, factory=factory)
        if mfa_ok and ((mfa or {}).get("MFADevices") or []):
            continue
        no_mfa += 1
        out.append(_finding(["CC6.1", "CC6.2"], "aws.iam_user_mfa", name, "fail",
                            "Console user has no MFA device enrolled"))
    capped = " (capped)" if len(users) > SWEEP_CAP else ""
    out.append(_finding(["CC6.1", "CC6.2"], "aws.iam_mfa", "directory",
                        "pass" if no_mfa == 0 else "fail",
                        f"{no_mfa} of {checked} console users lack MFA"
                        f" ({len(users)} IAM users total{capped})"))
    return out


SWEEPS: Dict[str, List[Callable[..., List[dict]]]] = {"aws": [_iam_mfa_sweep]}

# What proves the transport can reach the account at all. Its result decides
# `connectivity`, and nothing else in the run is attempted if it fails.
VERIFY: Dict[str, Dict[str, Any]] = {
    "aws": {"service": "sts", "operation": "get_caller_identity",
            "identity": lambda d: (d or {}).get("Arn") or (d or {}).get("Account") or "account"},
}


def run_cloud_provider(provider: str, spec: Dict[str, Any], creds: Dict[str, Any],
                       factory: Optional[ClientFactory] = None) -> dict:
    """Authenticate + collect over a cloud transport.

    Same contract as `live_api_catalog.run_provider`, including the rule that
    connectivity is reported as `info` and never as a control pass: a working
    key proves we can see the account, not that any control operates.
    """
    controls = spec.get("controls") or []
    v = VERIFY.get(provider)
    if v is None:
        return {"connectivity": "error", "findings": [], "summary": {},
                "summary_text": f"No cloud transport for '{provider}'"}

    ok, data, detail = aws_call(creds, v["service"], v["operation"], factory=factory)
    findings: List[dict] = []
    if not ok:
        # Credentials rejected vs could-not-reach are both collection failures.
        # The run status carries that; the findings must not claim a control failed.
        findings.append(_finding(controls, f"{provider}.connectivity", provider, "error",
                                 f"Could not authenticate to {provider} — {detail}"))
        return _summarise(provider, "error", findings)

    findings.append(_finding(controls, f"{provider}.connectivity", v["identity"](data), "info",
                             "Authenticated read-only API call succeeded"))

    for check in CLOUD_CHECKS.get(provider, []):
        c_ok, c_data, c_detail = aws_call(creds, check["service"], check["operation"],
                                          check.get("args"), factory=factory)
        if not c_ok:
            # A resource AWS reports as absent is evidence, not a broken collector.
            absent = check.get("absent_is")
            if absent and ("NoSuchEntity" in c_detail or "ResourceNotFound" in c_detail):
                findings.append(_finding(check["controls"], check["id"], check["resource"],
                                         absent, check["fail_message"]))
            else:
                findings.append(_finding(check["controls"], check["id"], check["resource"],
                                         "error", f"Could not collect — {c_detail}"))
            continue
        passed, why = _expect(c_data, check.get("expect") or {})
        findings.append(_finding(
            check["controls"], check["id"], check["resource"],
            "pass" if passed else "fail",
            f"{check['pass_message'] if passed else check['fail_message']} ({why})"))

    for sweep in SWEEPS.get(provider, []):
        findings.extend(sweep(creds, factory))

    # Verify already succeeded, so the collector reached the account: connectivity
    # is `pass` even if individual services were denied. Those show up as per-check
    # errors, which is the honest split — we could log in, we could not look
    # everywhere.
    return _summarise(provider, "pass", findings)


def _summarise(provider: str, conn: str, findings: List[dict]) -> dict:
    summary: Dict[str, Any] = {"total": len(findings), "pass": 0, "fail": 0, "error": 0}
    touched: set = set()
    for f in findings:
        summary[f["status"]] = summary.get(f["status"], 0) + 1
        touched.update(f["control_codes"])
    summary["controls_touched"] = sorted(touched)
    return {
        "connectivity": conn, "findings": findings, "summary": summary,
        "summary_text": (
            f"{provider}: {summary['pass']} pass / {summary['fail']} fail / "
            f"{summary.get('info', 0)} inventory / {summary['error']} error "
            f"across {len(summary['controls_touched'])} controls"
        ),
    }


def cloud_control_codes(provider: str) -> List[str]:
    """Every SOC 2 code this transport can emit, so the seed mapping covers them."""
    codes: set = set()
    for c in CLOUD_CHECKS.get(provider, []):
        codes.update(c.get("controls") or [])
    if provider == "aws":
        codes.update(["CC6.1", "CC6.2"])          # the IAM MFA sweep
    return sorted(codes)
