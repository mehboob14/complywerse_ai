"""Shared factory: CIS PostgreSQL 13–17 authored checks from the PG18 base.

Each major version gets an explicit delta profile derived from that version's
CIS audit prose (not a blind clone). Call ``build_postgresql_family(major)``.

Verification tags:
  - PG18: verified-live against the platform's PG18 instance
  - PG13–17 siblings shape-verified on that same PG18 instance unless noted
"""
from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from . import seed_cis_pg18 as pg18


@dataclass(frozen=True)
class PgFamilyProfile:
    major: int
    benchmark: str
    auth_tag: str
    # CIS audit cites systemctl is-enabled postgresql-N.service
    service_unit: str
    # Rule 4.10 present in PG13/14/18, absent in PG15/16/17
    include_4_10: bool
    # PG17 audit requires TLSv1.3; older audits accept TLSv1.2 or TLSv1.3
    tls_require_1_3: bool
    # PG17 title marks pgcrypto Automated; older mark Manual
    pgcrypto_automated: bool
    # Shape-verified on the platform PG18 server (not a native major instance)
    verification: str = "shape-verified"


# Profiles from live audit-prose / title / rule-id delta hunt (2026-07-30).
PROFILES: Dict[int, PgFamilyProfile] = {
    17: PgFamilyProfile(
        major=17,
        benchmark="CIS_PostgreSQL_17_Benchmark_v1.0.0",
        auth_tag="cis-pg17",
        service_unit="postgresql-17.service",
        include_4_10=False,
        tls_require_1_3=True,
        pgcrypto_automated=True,
        verification="shape-verified",
    ),
    16: PgFamilyProfile(
        major=16,
        benchmark="CIS_PostgreSQL_16_Benchmark_v1.1.0",
        auth_tag="cis-pg16",
        service_unit="postgresql-16.service",
        include_4_10=False,
        tls_require_1_3=False,
        pgcrypto_automated=False,
        verification="shape-verified",
    ),
    15: PgFamilyProfile(
        major=15,
        benchmark="CIS_PostgreSQL_15_Benchmark_v1.2.0",
        auth_tag="cis-pg15",
        service_unit="postgresql-15.service",
        include_4_10=False,
        tls_require_1_3=False,
        pgcrypto_automated=False,
        verification="shape-verified",
    ),
    14: PgFamilyProfile(
        major=14,
        benchmark="CIS_PostgreSQL_14_Benchmark_v1.3.0",
        auth_tag="cis-pg14",
        service_unit="postgresql-14.service",
        include_4_10=True,
        tls_require_1_3=False,
        pgcrypto_automated=False,
        verification="shape-verified",
    ),
    13: PgFamilyProfile(
        major=13,
        benchmark="CIS_PostgreSQL_13_Benchmark_v1.3.0",
        auth_tag="cis-pg13",
        service_unit="postgresql-13.service",
        include_4_10=True,
        tls_require_1_3=False,
        pgcrypto_automated=False,
        verification="shape-verified",
    ),
}


def _stamp(cd: Dict[str, Any], profile: PgFamilyProfile) -> Dict[str, Any]:
    out = copy.deepcopy(cd)
    out["_authored"] = profile.auth_tag
    out["_verification"] = profile.verification
    win = out.get("windows_winrm")
    if isinstance(win, dict):
        win["_authored"] = profile.auth_tag
        win["_verification"] = profile.verification
    return out


def _pg(
    profile: PgFamilyProfile,
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
        "check_definition": _stamp(
            {
                "runner": "postgres_sql",
                "sql": sql,
                "expect": expect,
                "pass_message": pass_message,
                "fail_message": fail_message,
                "timeout_seconds": 15,
            },
            profile,
        ),
    }


def _linux(
    profile: PgFamilyProfile,
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
        "check_definition": _stamp(
            {
                "command": command,
                "expect": expect,
                "pass_message": pass_message,
                "fail_message": fail_message,
                "applicable_host_families": ["linux"],
                "timeout_seconds": 20,
            },
            profile,
        ),
    }


def _manual(profile: PgFamilyProfile, attestation_prompt: str) -> Dict[str, Any]:
    return {
        "runner_type": "manual",
        "check_definition": _stamp(
            {
                "requires_attestation": True,
                "attestation_prompt": attestation_prompt,
                "pass_message": "Operator attested compliant.",
                "fail_message": "Operator attested non-compliant.",
            },
            profile,
        ),
    }


def build_postgresql_family(major: int) -> Dict[str, Any]:
    """Return {benchmark, auth_tag, verification, authored, windows_variants, deltas}."""
    if major not in PROFILES:
        raise KeyError(f"No PostgreSQL family profile for major={major}")
    profile = PROFILES[major]

    authored: Dict[str, Dict[str, Any]] = {}
    for rule_id, spec in pg18.AUTHORED.items():
        if rule_id == "4.10" and not profile.include_4_10:
            continue
        authored[rule_id] = {
            "runner_type": spec["runner_type"],
            "check_definition": _stamp(spec["check_definition"], profile),
        }

    deltas: List[str] = []

    # ── Delta: systemd unit name from CIS audit prose ─────────────────────
    unit = profile.service_unit
    authored["1.3"] = _linux(
        profile,
        f"systemctl is-enabled {unit} 2>/dev/null || "
        "systemctl is-enabled postgresql.service 2>/dev/null || "
        f"systemctl is-enabled postgresql@{profile.major}-main.service 2>/dev/null",
        kind="stdout_contains",
        value="enabled",
        pass_message=f"PostgreSQL {profile.major} systemd unit is enabled.",
        fail_message=f"PostgreSQL {profile.major} systemd unit is not enabled.",
    )
    deltas.append(f"1.3 service unit -> {unit}")

    # ── Delta: TLS floor (PG17 unique) ────────────────────────────────────
    if profile.tls_require_1_3:
        authored["6.9"] = _pg(
            profile,
            "SELECT COALESCE("
            "(SELECT setting FROM pg_settings WHERE name = 'ssl_min_protocol_version'),"
            "'')",
            kind="first_value_equals",
            expected="TLSv1.3",
            pass_message="ssl_min_protocol_version is TLSv1.3.",
            fail_message="ssl_min_protocol_version is not TLSv1.3 (CIS PG17 requires TLS 1.3+).",
        )
        deltas.append("6.9 requires TLSv1.3 (CIS PG17)")
    else:
        # Keep PG18-authored check (TLSv1.2 / TLSv1.3; reject 1.0/1.1) — already stamped
        deltas.append("6.9 TLSv1.2+ floor (CIS: disable 1.0/1.1)")

    # ── Delta: pgcrypto Manual vs Automated ───────────────────────────────
    if profile.pgcrypto_automated:
        authored["6.11"] = _pg(
            profile,
            "SELECT 1 FROM pg_available_extensions "
            "WHERE name = 'pgcrypto' AND installed_version IS NOT NULL",
            kind="row_count_nonzero",
            pass_message="pgcrypto extension is installed.",
            fail_message="pgcrypto is available but not installed (CREATE EXTENSION required).",
        )
        deltas.append("6.11 automated pgcrypto install check")
    else:
        authored["6.11"] = _manual(
            profile,
            "Confirm pgcrypto is installed where required and configured per policy "
            "(extension present + key management practices).",
        )
        deltas.append("6.11 manual (CIS marks Manual)")

    # ── Delta: 4.10 presence ──────────────────────────────────────────────
    if profile.include_4_10:
        deltas.append("4.10 present (login roles must have passwords)")
    else:
        deltas.append("4.10 absent from this CIS version")

    windows_variants: Dict[str, Dict[str, Any]] = {}
    for rid, alt in pg18.WINDOWS_VARIANTS.items():
        if rid == "4.10" and not profile.include_4_10:
            continue
        windows_variants[rid] = _stamp(alt, profile)

    windows_variants["1.3"] = _stamp(
        {
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
        },
        profile,
    )

    return {
        "profile": profile,
        "benchmark": profile.benchmark,
        "auth_tag": profile.auth_tag,
        "verification": profile.verification,
        "authored": authored,
        "windows_variants": windows_variants,
        "deltas": deltas,
    }


def merge_windows_variant(
    windows_variants: Dict[str, Dict[str, Any]],
    rule_id: str,
    cd: Dict[str, Any],
) -> Dict[str, Any]:
    out = dict(cd)
    alt = windows_variants.get(rule_id)
    if alt:
        out["windows_winrm"] = alt
        fams = list(out.get("applicable_host_families") or [])
        if "windows" not in fams:
            fams.append("windows")
        if fams:
            out["applicable_host_families"] = fams
    return out


def export_filename(major: int) -> str:
    return f"cis_postgresql_{major}_authored.json"
