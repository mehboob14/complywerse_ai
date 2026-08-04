"""AWS read-only check runner using boto3.

`check_definition` shape:
    {
      "service": "iam" | "s3" | "ec2" | "cloudtrail" | "rds" | ...,
      "operation": "<boto3 client method name>",
      "operation_args": { ... }                # optional kwargs
      "expect": {
         "kind": "field_equals" | "field_in" | "exists" | "list_nonempty"
                 | "all_items_field_equals" | "no_items_match",
         "path": "Foo.Bar.Baz",                # dotted path, supports list-pluck via "[]"
         "value": <expected value>,            # for field_equals / field_in
         "match": { "field": "X", "value": "Y" } # for no_items_match
      },
      "pass_message": "...",                   # rendered on pass
      "fail_message": "...",                   # rendered on fail
    }

Credentials dict expected keys: aws_access_key_id, aws_secret_access_key,
aws_session_token (optional), aws_region (optional).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from .registry import RunnerResult, register

try:
    import boto3
    from botocore.config import Config
    from botocore.exceptions import BotoCoreError, ClientError
    BOTO3_AVAILABLE = True
except ImportError:  # pragma: no cover
    BOTO3_AVAILABLE = False


def _resolve_path(obj: Any, path: str) -> Any:
    """Resolve a dotted path. `[]` denotes pluck-from-list."""
    if not path:
        return obj
    parts = path.split(".")
    cur: Any = obj
    for part in parts:
        if part == "[]":
            if isinstance(cur, list):
                cur = cur  # explicit no-op: caller iterates
            else:
                return None
            continue
        if isinstance(cur, dict):
            cur = cur.get(part)
        elif isinstance(cur, list):
            try:
                idx = int(part)
                cur = cur[idx]
            except (ValueError, IndexError):
                return None
        else:
            return None
    return cur


def _evaluate_expectation(response: Dict[str, Any], expect: Dict[str, Any]) -> tuple[bool, str]:
    kind = (expect or {}).get("kind", "exists")
    path = (expect or {}).get("path", "")

    if kind == "exists":
        val = _resolve_path(response, path)
        ok = val is not None and val != [] and val != {}
        return ok, f"path '{path}' resolved to: {type(val).__name__} (truthy={ok})"

    if kind == "list_nonempty":
        val = _resolve_path(response, path)
        ok = isinstance(val, list) and len(val) > 0
        return ok, f"list '{path}' length={len(val) if isinstance(val, list) else 'n/a'}"

    if kind == "field_equals":
        val = _resolve_path(response, path)
        expected = expect.get("value")
        ok = val == expected
        return ok, f"path '{path}' = {val!r} (expected {expected!r})"

    if kind == "field_in":
        val = _resolve_path(response, path)
        allowed = expect.get("value", [])
        ok = val in allowed
        return ok, f"path '{path}' = {val!r} (allowed {allowed!r})"

    if kind == "all_items_field_equals":
        items = _resolve_path(response, path) or []
        if not isinstance(items, list):
            return False, f"path '{path}' is not a list"
        field = expect.get("field", "")
        expected = expect.get("value")
        bad = [i for i in items if (i.get(field) if isinstance(i, dict) else None) != expected]
        ok = not bad
        return ok, f"{len(items)} items checked, {len(bad)} non-conforming on field '{field}'"

    if kind == "no_items_match":
        items = _resolve_path(response, path) or []
        if not isinstance(items, list):
            return True, f"path '{path}' is not a list — vacuously passes"
        match = expect.get("match", {})
        field = match.get("field", "")
        expected = match.get("value")
        hits = [i for i in items if (i.get(field) if isinstance(i, dict) else None) == expected]
        ok = not hits
        return ok, f"{len(hits)} item(s) matched {field}={expected} (expected 0)"

    return False, f"Unknown expectation kind: {kind}"


def _truncate_for_storage(obj: Any, max_chars: int = 50_000) -> Any:
    import json
    try:
        s = json.dumps(obj, default=str)
    except Exception:
        s = str(obj)
    if len(s) <= max_chars:
        return obj
    return {"_truncated": True, "preview": s[:max_chars]}


# Read-only AWS operation verbs. We allow boto3 method names that start with
# any of these prefixes — boto3 maps every API operation to one of these
# verbs by convention, and Get/List/Describe/Head/Lookup are guaranteed
# read-only by AWS API design.
_READONLY_AWS_PREFIXES = ("get_", "list_", "describe_", "head_", "lookup_", "select_", "search_")


def _is_readonly_aws_operation(operation: str) -> bool:
    return isinstance(operation, str) and operation.lower().startswith(_READONLY_AWS_PREFIXES)


@register("aws_readonly")
def aws_readonly_runner(check_definition: Dict[str, Any], credentials: Dict[str, Any]) -> RunnerResult:
    if not BOTO3_AVAILABLE:
        return RunnerResult(
            status="error",
            summary="boto3 is not installed on this server.",
            error_message="ImportError: boto3",
        )

    service = check_definition.get("service")
    operation = check_definition.get("operation")
    if not service or not operation:
        return RunnerResult(
            status="error",
            summary="check_definition is missing 'service' or 'operation'.",
            error_message="invalid_check_definition",
        )
    # Hard read-only contract: refuse any boto3 call that isn't an
    # information-retrieval verb. This is enforced both here at runtime AND
    # in seed.py at seed-time so non-compliant checks can never reach prod.
    if not _is_readonly_aws_operation(operation):
        return RunnerResult(
            status="error",
            summary=f"Refusing non-read-only AWS operation '{operation}'. Only get*/list*/describe*/head*/lookup* are permitted.",
            error_message="readonly_violation",
        )

    region = credentials.get("aws_region") or check_definition.get("region") or "us-east-1"
    access_key = credentials.get("aws_access_key_id")
    secret_key = credentials.get("aws_secret_access_key")
    if not access_key or not secret_key:
        return RunnerResult(
            status="error",
            summary="AWS credentials not configured for this connection.",
            error_message="missing_credentials",
        )

    try:
        client = boto3.client(
            service,
            region_name=region,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            aws_session_token=credentials.get("aws_session_token") or None,
            config=Config(connect_timeout=10, read_timeout=30, retries={"max_attempts": 2}),
        )
        method = getattr(client, operation, None)
        if not method:
            return RunnerResult(
                status="error",
                summary=f"AWS {service} client has no method '{operation}'.",
                error_message="invalid_operation",
            )
        kwargs = dict(check_definition.get("operation_args") or {})
        # Substitute ${AWS_ACCOUNT_ID} dynamically via STS so seeded checks
        # don't need a hardcoded account number per tenant.
        if any(isinstance(v, str) and "${AWS_ACCOUNT_ID}" in v for v in kwargs.values()):
            try:
                sts = boto3.client(
                    "sts", region_name=region,
                    aws_access_key_id=access_key, aws_secret_access_key=secret_key,
                    aws_session_token=credentials.get("aws_session_token") or None,
                    config=Config(connect_timeout=10, read_timeout=15, retries={"max_attempts": 2}),
                )
                acct = sts.get_caller_identity().get("Account") or ""
                kwargs = {k: (v.replace("${AWS_ACCOUNT_ID}", acct) if isinstance(v, str) else v) for k, v in kwargs.items()}
            except (BotoCoreError, ClientError) as exc:
                return RunnerResult(
                    status="error",
                    summary=f"Could not resolve AWS account id via STS: {exc}",
                    error_message="sts_get_caller_identity_failed",
                    raw_output={"service": service, "operation": operation, "region": region},
                )
        response = method(**kwargs)
        # Strip ResponseMetadata to keep storage small
        if isinstance(response, dict):
            response.pop("ResponseMetadata", None)
    except (BotoCoreError, ClientError) as exc:
        return RunnerResult(
            status="error",
            summary=f"AWS API error: {exc}",
            error_message=str(exc),
            raw_output={"service": service, "operation": operation, "region": region},
        )

    expect = check_definition.get("expect") or {}
    ok, detail = _evaluate_expectation(response, expect)
    msg = (check_definition.get("pass_message") if ok else check_definition.get("fail_message")) or detail
    return RunnerResult(
        status="passed" if ok else "failed",
        summary=f"{msg} ({detail})",
        raw_output={
            "service": service,
            "operation": operation,
            "region": region,
            "response": _truncate_for_storage(response),
            "expectation_detail": detail,
        },
    )
