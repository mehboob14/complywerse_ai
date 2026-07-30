"""CIS PostgreSQL 17 Benchmark — authored checks (PG18 pattern, version-adjusted).

Proof that the PG18 authoring generalises: reuse the verified PG18 check library,
drop the PG18-only rule (4.10), retag, and override the three version-specific
deltas (1.3 service unit, 6.9 TLS floor, 6.11 automated pgcrypto).

Apply with ``scripts/apply_cis_pg17_checks.py``.
Verify with ``scripts/verify_cis_pg17_checks.py`` against grc_app @ 5433.
"""
from __future__ import annotations

import copy
from typing import Any, Dict, List

from . import seed_cis_pg18 as pg18

BENCHMARK = "CIS_PostgreSQL_17_Benchmark_v1.0.0"
AUTH_TAG = "cis-pg17"

# PG18 introduced 4.10 ("accounts that can log in have passwords"); PG17 does
# not have that rule id in the library.
_DROP_RULE_IDS = {"4.10"}


def _retags(cd: Dict[str, Any]) -> Dict[str, Any]:
    out = copy.deepcopy(cd)
    out["_authored"] = AUTH_TAG
    win = out.get("windows_winrm")
    if isinstance(win, dict):
        win["_authored"] = AUTH_TAG
    return out


def _pg(
    sql: str,
    *,
    kind: str,
    expected: Any = None,
    pass_message: str,
    fail_message: str,
) -> Dict[str, Any]:
    expect: Dict[str, Any] = {"kind": kind}
    if expected is not None:
        expect["expected"] = expected
    return {
        "runner_type": "postgres_sql",
        "check_definition": {
            "runner": "postgres_sql",
            "sql": sql,
            "expect": expect,
            "pass_message": pass_message,
            "fail_message": fail_message,
            "_authored": AUTH_TAG,
            "timeout_seconds": 15,
        },
    }


def _linux(
    command: str,
    *,
    kind: str,
    value: str = "",
    pass_message: str,
    fail_message: str,
) -> Dict[str, Any]:
    expect: Dict[str, Any] = {"kind": kind}
    if value:
        expect["value"] = value
    return {
        "runner_type": "linux_ssh",
        "check_definition": {
            "command": command,
            "expect": expect,
            "pass_message": pass_message,
            "fail_message": fail_message,
            "applicable_host_families": ["linux"],
            "_authored": AUTH_TAG,
            "timeout_seconds": 20,
        },
    }


def _build_authored() -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for rule_id, spec in pg18.AUTHORED.items():
        if rule_id in _DROP_RULE_IDS:
            continue
        out[rule_id] = {
            "runner_type": spec["runner_type"],
            "check_definition": _retags(spec["check_definition"]),
        }

    # 1.3 — CIS PG17 audit cites postgresql-17.service (not -18).
    out["1.3"] = _linux(
        "systemctl is-enabled postgresql-17.service 2>/dev/null || "
        "systemctl is-enabled postgresql.service 2>/dev/null || "
        "systemctl is-enabled postgresql@17-main.service 2>/dev/null",
        kind="stdout_contains",
        value="enabled",
        pass_message="PostgreSQL 17 systemd unit is enabled.",
        fail_message="PostgreSQL 17 systemd unit is not enabled.",
    )

    # 6.9 — PG17 requires TLSv1.3+ (PG18 only requires 1.0/1.1 disabled).
    # Always return a row so missing/hidden settings fail clearly (not "no rows").
    out["6.9"] = _pg(
        "SELECT COALESCE("
        "(SELECT setting FROM pg_settings WHERE name = 'ssl_min_protocol_version'),"
        "'')",
        kind="first_value_equals",
        expected="TLSv1.3",
        pass_message="ssl_min_protocol_version is TLSv1.3.",
        fail_message="ssl_min_protocol_version is not TLSv1.3 (CIS PG17 requires TLS 1.3+).",
    )

    # 6.11 — PG17 marks this Automated; require the extension to be installed.
    out["6.11"] = _pg(
        "SELECT 1 FROM pg_available_extensions "
        "WHERE name = 'pgcrypto' AND installed_version IS NOT NULL",
        kind="row_count_nonzero",
        pass_message="pgcrypto extension is installed.",
        fail_message="pgcrypto is available but not installed (CREATE EXTENSION required).",
    )
    return out


AUTHORED: Dict[str, Dict[str, Any]] = _build_authored()

WINDOWS_VARIANTS: Dict[str, Dict[str, Any]] = {}
for _rid, _alt in pg18.WINDOWS_VARIANTS.items():
    if _rid in _DROP_RULE_IDS:
        continue
    WINDOWS_VARIANTS[_rid] = _retags(_alt)

# 1.3 Windows alternate — match any postgresql* Automatic service (version-agnostic).
WINDOWS_VARIANTS["1.3"] = {
    "command": (
        "$s = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | "
        "Select-Object -First 1; if (-not $s) { 'missing' } "
        "elseif ($s.StartType -eq 'Automatic') { 'enabled' } else { $s.StartType }"
    ),
    "shell": "powershell",
    "expect": {"kind": "stdout_contains", "value": "enabled"},
    "pass_message": "PostgreSQL Windows service StartType is Automatic.",
    "fail_message": "PostgreSQL Windows service is missing or not Automatic.",
    "applicable_host_families": ["windows"],
    "_authored": AUTH_TAG,
}


def all_rule_ids() -> List[str]:
    return sorted(
        AUTHORED.keys(),
        key=lambda r: [int(x) if x.isdigit() else x for x in r.replace("-", ".").split(".")],
    )


def merge_windows_variant(rule_id: str, cd: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(cd)
    alt = WINDOWS_VARIANTS.get(rule_id)
    if alt:
        out["windows_winrm"] = alt
        fams = list(out.get("applicable_host_families") or [])
        if "windows" not in fams:
            fams.append("windows")
        if fams:
            out["applicable_host_families"] = fams
    return out
