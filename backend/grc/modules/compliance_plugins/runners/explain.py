"""What an automated test does, in words a control owner can check.

Every check is data: a resource read from a provider's API and a rule applied to
what comes back. The explanation is generated from that same data, so it cannot
drift from what actually runs, and every check has one without anyone writing
prose for it.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from .evidence_engine import MAX_FINDINGS, MAX_ITEMS
from .live_api_catalog import CONNECTOR_CHECKS, PROVIDER_API

_OP = {
    "eq": "is", "ne": "is not", "contains": "includes", "in": "is one of", "not_in": "is not one of",
    "has_word": "includes", "gt": "is greater than", "lt": "is less than", "truthy": "is set", "falsy": "is not set",
}
_AWS_SERVICE = {
    "backup": "AWS Backup", "rds": "Amazon RDS", "dynamodb": "Amazon DynamoDB", "iam": "AWS IAM",
    "cloudtrail": "AWS CloudTrail", "ec2": "Amazon EC2", "config": "AWS Config", "sts": "AWS STS",
    "s3": "Amazon S3", "s3control": "Amazon S3 Control", "securityhub": "AWS Security Hub",
    "guardduty": "Amazon GuardDuty",
}
_NOT_ASSESSED = "If there is nothing to check, the result is “not assessed”, never a pass."


def _words(name: Optional[str]) -> str:
    """snake_case, kebab-case or CamelCase → plain words."""
    text = re.sub(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])", " ", name or "")
    return re.sub(r"[_\-.]+", " ", text).strip().lower()


def _value(v: Any) -> str:
    if isinstance(v, (list, tuple)):
        return ", ".join(_value(x) for x in v)
    if isinstance(v, bool):
        return "true" if v else "false"
    return f"“{v}”" if isinstance(v, str) else str(v)


def _connector_rule(check: Dict[str, Any], noun: str) -> str:
    kind = check.get("kind", "present")
    # has_2fa / is_admin read as "2fa" / "admin" once they sit in "… is on"
    field = re.sub(r"^(has|is) ", "", _words(check.get("field")))
    op = check.get("op", "eq")
    phrase = f"{field} {_OP.get(op, op)}" + ("" if op in ("truthy", "falsy") else f" {_value(check.get('value'))}")
    if check.get("assert"):
        return f"Applies the rule “{check.get('title') or check.get('id')}” to every one of the {noun}."
    counted = f"{noun} where {field} {_OP.get(check.get('op', 'truthy'), check.get('op'))}" + (
        "" if check.get("op", "truthy") in ("truthy", "falsy") else f" {_value(check.get('value'))}")
    if kind == "min_count":
        return f"Passes when the number of {counted if check.get('field') else noun} is at least {int(check.get('min', 1))}."
    if kind == "max_count":
        return f"Passes when the number of {counted if check.get('field') else noun} is at most {check.get('max', 0)}."
    if kind == "all_true":
        return f"Passes when {field} is on for every one of the {noun}."
    if kind == "all_false":
        return f"Passes when {field} is off for every one of the {noun}."
    if kind == "all_match":
        return f"Passes when, for every one of the {noun}, {phrase}."
    if kind == "none_match":
        return f"Passes when, for none of the {noun}, {phrase}."
    return f"Records the {noun} that exist as inventory evidence. Passes when at least one is found."


def _explain_connector(provider: str, label: str, check_id: str) -> Optional[Dict[str, Any]]:
    cdef = CONNECTOR_CHECKS.get(provider) or {}
    check = next((c for c in cdef.get("checks") or [] if c.get("id") == check_id), None)
    if check is None:
        return None
    res = next((r for r in cdef.get("resources") or [] if r.get("name") == check.get("resource")), {})
    parent = (res.get("for_each") or {}).get("resource")
    what = _words(res.get("name") or check.get("resource") or "records")
    # a detail endpoint read once per parent yields one row per parent: the test is about the parents
    noun = _words(parent) if parent and res.get("items") == ["$"] else what
    reads = f"Your {label} {what}" + (f", looked up for each of your {_words(parent)}" if parent else "")
    skip = check.get("skip_if_field_true")
    kind = check.get("kind", "present")
    if kind == "min_count":
        when_empty = "If none exist, the test fails."
    elif check.get("empty") == "pass":
        when_empty = f"If {label} reports none, the test passes."
    else:
        when_empty = _NOT_ASSESSED
    skips = [skip] if isinstance(skip, str) else list(skip or [])
    excludes = [f"Leaves out {noun} where {' or '.join(_words(s) for s in skips)} is set." if skips else None,
                f"Leaves out {noun} that {label} returns without {_words(check.get('field'))}, as not assessable."
                if check.get("skip_missing") else None]
    return {
        "checks": _connector_rule(check, noun),
        "rule": None,
        "reads": reads,
        "call": f"{res.get('method', 'GET')} {res['path']}" if res.get("path") else None,
        "fields": [_words(f) for f in (res.get("fields") or {})],
        "fails_when": check.get("fail_msg"),
        "excludes": " ".join(e for e in excludes if e) or None,
        "when_empty": when_empty,
    }


def _explain_cloud(provider: str, label: str, check_id: str) -> Optional[Dict[str, Any]]:
    from .cloud_transport import CLOUD_CHECKS, SWEEP_CHECKS

    check = next((c for c in CLOUD_CHECKS.get(provider, []) + SWEEP_CHECKS.get(provider, [])
                  if c["id"] == check_id), None)
    if check is None:
        return None
    service = _AWS_SERVICE.get(check.get("service"), check.get("service", "").upper())
    operation = "".join(p.capitalize() for p in (check.get("operation") or "").split("_"))
    expect = check.get("expect") or {}
    path = _words((expect.get("path") or "").split(".")[-1])
    kind = expect.get("kind")
    if check.get("rule"):
        rule = check["rule"]
    elif kind == "list_nonempty":
        rule = f"Passes when {service} returns at least one entry in {path}."
    elif kind in ("field_equals", "field_gte"):
        rule = f"Passes when {path} {'is' if kind == 'field_equals' else 'is at least'} {_value(expect.get('value'))}."
    elif kind == "any_item_field_equals":
        rule = f"Passes when at least one of the {path} has {_words(expect.get('field'))} set to {_value(expect.get('value'))}."
    elif kind == "all_items_field_gte":
        rule = f"Passes when every one of the {path} has {_words(expect.get('field'))} of at least {expect.get('value')}."
    else:
        rule = check.get("pass_message") or check.get("title") or check_id
    return {
        # the pass message is already written for people; the rule is the mechanics behind it
        "checks": check.get("pass_message") or rule,
        "rule": rule if check.get("pass_message") else None,
        "reads": f"{service} in the {label} account and region you connect",
        "call": f"{service} {operation}",
        "fields": [],
        "fails_when": check.get("fail_message"),
        "excludes": None,
        "when_empty": _NOT_ASSESSED if check.get("empty_is") or check.get("rule") else None,
    }


def _sentence(text: Optional[str]) -> str:
    text = (text or "").strip()
    return text if not text or text[-1] in ".!?" else text + "."


def _set_phrase(values: Any) -> str:
    """`is one of` a list; a run of whole numbers reads as a range (14 to 128)."""
    if isinstance(values, list) and len(values) > 3 and all(isinstance(v, int) for v in values) \
            and values == list(range(min(values), max(values) + 1)):
        return f"between {min(values)} and {max(values)}"
    return f"one of {_value(values)}"


def _explain_quantitative(defn: Dict[str, Any], rationale: Optional[str], remediation: Optional[str]) -> Dict[str, Any]:
    """An AWS check the aws_readonly runner makes: one API call and one expectation on its answer."""
    service = _AWS_SERVICE.get(defn.get("service"), (defn.get("service") or "").upper())
    operation = "".join(p.capitalize() for p in (defn.get("operation") or "").split("_"))
    expect = defn.get("expect") or {}
    path = expect.get("path") or ""
    what = _words(path.split(".")[-1])
    match = expect.get("match") or {}
    kind = expect.get("kind")
    if kind == "exists":
        rule = f"Passes when {what} is present and not empty."
    elif kind == "list_nonempty":
        rule = f"Passes when {service} returns at least one entry in {what}."
    elif kind == "field_equals":
        rule = f"Passes when {what} is {_value(expect.get('value'))}."
    elif kind == "field_in":
        rule = f"Passes when {what} is {_set_phrase(expect.get('value'))}."
    elif kind == "all_items_field_equals":
        rule = f"Passes when every one of the {what} has {_words(expect.get('field'))} set to {_value(expect.get('value'))}."
    elif kind == "no_items_match":
        rule = f"Passes when none of the {what} has {_words(match.get('field'))} set to {_value(match.get('value'))}."
    else:
        rule = defn.get("pass_message")
    # a call's arguments, with the account id the way a person would say it
    args = ", ".join(f"{k} = {'your AWS account id' if '${AWS_ACCOUNT_ID}' in str(v) else v}"
                     for k, v in (defn.get("operation_args") or {}).items())
    return {
        "checks": defn.get("pass_message") or rule,
        "rule": rule,
        "reads": f"{service} in the {PROVIDER_API.get('aws', {}).get('label', 'AWS')} account and region you connect",
        "call": f"{service} {operation}" + (f" ({args})" if args else ""),
        "fields": [],
        "looks_at": path or None,
        "fails_when": defn.get("fail_message"),
        "excludes": None,
        "when_empty": None,
        "why": rationale,
        "fix": remediation,
    }


def _step(label: str, text: str, code: Optional[str] = None) -> Dict[str, Optional[str]]:
    return {"label": label, "text": text, "code": code}


def _steps(label: str, e: Dict[str, Any], *, aws: bool, connector: bool) -> List[Dict[str, Optional[str]]]:
    """The test as a procedure, in the order it happens.

    Assembled from the explanation's own parts, so the procedure and the explanation cannot say different
    things. What it states about limits and results is what the engine does (`evidence_engine`,
    `check_result_recorder`).
    """
    steps = [_step("Sign in", (
        f"Signs in to {label} with the read-only access key you stored for the account and region you connect. "
        "Only read calls (get, list, describe and similar lookups) are allowed." if aws else
        f"Signs in to {label} with the read-only credential you stored. It is kept encrypted and cannot change anything."))]
    kept = f" Only these fields are kept: {', '.join(e['fields'])}." if e.get("fields") else ""
    reads = e.get("reads") or ""
    steps.append(_step("Read", (f"Calls {reads}." if aws else f"Reads {reads[:1].lower()}{reads[1:]}.") + kept, e.get("call")))
    if e.get("looks_at"):
        steps.append(_step("Look at", "Looks at this part of the answer:", e["looks_at"]))
    if e.get("excludes"):
        steps.append(_step("Leave out", e["excludes"]))
    rule, plain = e.get("rule"), e.get("checks")
    steps.append(_step("Test", (_sentence(rule) + (f" In plain words: {_sentence(plain)}" if plain and plain != rule else ""))
                       if rule else _sentence(plain)))
    if e.get("fails_when"):
        steps.append(_step("Fails when", _sentence(e["fails_when"])))
    if e.get("when_empty"):
        steps.append(_step("Nothing to test", e["when_empty"]))
    steps.append(_step("If it cannot read", (
        f"If {label} cannot be reached or refuses the credential, the result is “collection failed”. "
        "That says nothing about the control, so it never counts as a pass or as a failure.")))
    if connector:
        steps.append(_step("Limits", (
            f"Reads at most {MAX_ITEMS:,} rows per list; with more, only the first {MAX_ITEMS:,} are checked and the "
            f"result says so. Up to {MAX_FINDINGS} failing items are named.")))
    steps.append(_step("Keep", (
        "Each run saves its result with the time it ran" + (", how many items it tested out of how many exist, and the failing items"
                                                            if connector else "") +
        ". It counts as evidence until the control’s reassessment window ends.")))
    return steps


def explain_quantitative(defn: Dict[str, Any], rationale: Optional[str] = None,
                         remediation: Optional[str] = None) -> Dict[str, Any]:
    """The explanation of a built-in AWS check, from its `check_definition`."""
    e = _explain_quantitative(defn, rationale, remediation)
    e["steps"] = _steps(PROVIDER_API.get("aws", {}).get("label", "AWS"), e, aws=True, connector=False)
    return e


def explain_check(provider: str, check_id: str) -> Optional[Dict[str, Any]]:
    """{checks, rule, reads, call, fields, fails_when, excludes, when_empty, steps} for one check, or None."""
    spec = PROVIDER_API.get(provider) or {}
    label = spec.get("label", provider)
    aws = bool(spec.get("transport"))
    e = _explain_cloud(provider, label, check_id) if aws else _explain_connector(provider, label, check_id)
    if e is not None:
        e["steps"] = _steps(label, e, aws=aws, connector=not aws)
    return e


def check_title(provider: str, check_id: str) -> str:
    """The check's own title, or its id in words when it has none."""
    spec = PROVIDER_API.get(provider) or {}
    if spec.get("transport"):
        from .cloud_transport import CLOUD_CHECKS, SWEEP_CHECKS
        pool: List[Dict[str, Any]] = CLOUD_CHECKS.get(provider, []) + SWEEP_CHECKS.get(provider, [])
    else:
        pool = (CONNECTOR_CHECKS.get(provider) or {}).get("checks") or []
    check = next((c for c in pool if c.get("id") == check_id), {})
    return check.get("title") or check.get("pass_message") or _words(check_id.split(".", 1)[-1]).capitalize()


def connector_tests(provider: str) -> List[Dict[str, Any]]:
    """Every test a connector runs: title, what it checks, and the controls it evidences."""
    from .covers import covers_for_check, scf_targets_from_covers
    from .live_api_catalog import provider_checks

    out = []
    for check in provider_checks(provider):
        e = explain_check(provider, check["id"]) or {}
        out.append({
            "id": check["id"],
            "title": check_title(provider, check["id"]),
            "checks": e.get("checks"),
            "rule": e.get("rule"),
            "fails_when": e.get("fails_when"),
            "soc2": list(check.get("controls") or []),
            "scf": sorted(scf_targets_from_covers(covers_for_check(check))),
            "call": e.get("call"),
        })
    return out


def connector_reads(provider: str) -> List[Dict[str, str]]:
    """Every call a connector makes, each with what it is for. All are reads."""
    spec = PROVIDER_API.get(provider) or {}
    label = spec.get("label", provider)
    calls: List[Dict[str, str]] = []

    def add(call: Optional[str], what: str) -> None:
        if call and all(c["call"] != call for c in calls):
            calls.append({"call": call, "what": what})

    if spec.get("transport"):
        from .cloud_transport import CLOUD_CHECKS, SWEEP_CHECKS, VERIFY
        v = VERIFY.get(provider) or {}
        add(f"{_AWS_SERVICE.get(v.get('service'), v.get('service', ''))} "
            f"{''.join(p.capitalize() for p in (v.get('operation') or '').split('_'))}",
            "Confirms the key works and which account it belongs to")
        for c in CLOUD_CHECKS.get(provider, []) + SWEEP_CHECKS.get(provider, []):
            e = _explain_cloud(provider, label, c["id"]) or {}
            add(e.get("call"), check_title(provider, c["id"]))
        return calls

    exchange = spec.get("token_exchange")
    if exchange:
        add(f"POST {exchange['url'].split('?')[0]}", "Signs in with the stored client credentials for a short-lived access token")
    add(f"{spec.get('method', 'GET')} {spec['verify']}" if spec.get("verify") else None,
        "Confirms the credential works")
    for res in (CONNECTOR_CHECKS.get(provider) or {}).get("resources") or []:
        parent = (res.get("for_each") or {}).get("resource")
        add(f"{res.get('method', 'GET')} {res.get('path')}",
            f"Reads your {_words(res.get('name'))}" + (f" for each of your {_words(parent)}" if parent else ""))
    return calls
