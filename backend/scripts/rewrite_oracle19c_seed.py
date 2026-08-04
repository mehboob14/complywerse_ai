"""Rewrite Oracle 19c authored seed with title-driven v$parameter checks.

Privilege/allowlist rules stay manual (org-specific). File-based sqlnet/listener
checks become linux_ssh with host-family gate. All tagged unverified-live.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
AUTH = "cis-oracle-19c"
VER = "unverified-live"
BENCH = "CIS_Oracle_Database_19c_Benchmark_v2.0.0"


def manual(prompt: str) -> dict:
    return {
        "runner_type": "manual",
        "check_definition": {
            "requires_attestation": True,
            "attestation_prompt": prompt,
            "pass_message": "Operator attested compliant.",
            "fail_message": "Operator attested non-compliant.",
            "_authored": AUTH,
            "_verification": VER,
        },
        "authoring_class": "manual",
    }


def ora_sql(sql: str, expect: dict, pass_msg: str, fail_msg: str) -> dict:
    return {
        "runner_type": "oracle_sql",
        "check_definition": {
            "sql": sql,
            "expect": expect,
            "pass_message": pass_msg,
            "fail_message": fail_msg,
            "_authored": AUTH,
            "_verification": VER,
            "timeout_seconds": 15,
        },
        "authoring_class": "deterministic",
    }


def linux_cmd(cmd: str, value: str, pass_msg: str, fail_msg: str) -> dict:
    return {
        "runner_type": "linux_ssh",
        "check_definition": {
            "command": cmd,
            "expect": {"kind": "stdout_contains", "value": value},
            "pass_message": pass_msg,
            "fail_message": fail_msg,
            "applicable_host_families": ["linux"],
            "_authored": AUTH,
            "_verification": VER,
            "timeout_seconds": 20,
        },
        "authoring_class": "deterministic",
    }


# CIS 2.3.x — expected values taken from rule titles / audit prose.
PARAM_RULES = {
    "2.3.1": ("background_core_dump", "not_equals", "FULL"),
    "2.3.2": ("shadow_core_dump", "not_equals", "FULL"),
    "2.3.3": ("allow_group_access_to_sga", "equals", "FALSE"),
    "2.3.5": ("os_roles", "equals", "FALSE"),
    "2.3.6": ("remote_os_roles", "equals", "FALSE"),
    "2.3.7": ("sec_max_failed_login_attempts", "lte", "3"),
    "2.3.8": ("sec_protocol_error_further_action", "equals", "(DROP,3)"),
    "2.3.9": ("sec_protocol_error_trace_action", "equals", "LOG"),
    "2.3.10": ("sec_return_server_release_banner", "equals", "FALSE"),
    "2.3.11": ("remote_login_passwordfile", "equals", "NONE"),
    "2.3.12": ("remote_listener", "empty", None),
    "2.3.13": ("resource_limit", "equals", "TRUE"),
    "2.3.14": ("remote_os_authent", "equals", "FALSE"),
    "2.3.15": ("sec_case_sensitive_logon", "equals", "TRUE"),
}

# CIS defines "unauthorized" as non-Oracle-maintained grantees. Simplified
# non-CDB shape of the CIS audit (row_count_zero = compliant).
ROLE_REVOKE = {
    "6.2.2": "EXP_FULL_DATABASE",
    "6.2.3": "IMP_FULL_DATABASE",
    "6.2.4": "DATAPUMP_EXP_FULL_DATABASE",
    "6.2.5": "DATAPUMP_IMP_FULL_DATABASE",
    "6.2.6": "DV_ADMIN",
    "6.2.7": "DV_AUDIT_CLEANUP",
    "6.2.8": "OLAP_DBA",
    "6.2.9": "LBAC_DBA",
    "6.2.10": "JAVA_ADMIN",
    "6.2.11": "JAVASYSPRIVS",
    "6.2.12": "LOGSTDBY_ADMINISTRATOR",
    "6.2.13": "MAINTPLAN_APP",
    "6.2.14": "JAVADEBUGPRIV",
    "6.2.15": "DV_PATCH_ADMIN",
    "6.2.16": "DV_POLICY_OWNER",
    "6.2.17": "AUDIT_ADMIN",
    "6.2.18": "AUDIT_VIEWER",
    "6.2.19": "PDB_DBA",
    "6.2.20": "SELECT_CATALOG_ROLE",
    "6.2.21": "EXECUTE_CATALOG_ROLE",
}

SYS_PRIV_REVOKE = {
    "6.1.4": "CREATE EXTERNAL JOB",
    "6.1.5": "BECOME USER",
    "6.1.8": "LOGMINING",
    "6.1.9": "ALTER SYSTEM",
    "6.1.10": "CREATE LIBRARY",
}


def _role_revoke_sql(role: str) -> str:
    return (
        "SELECT p.grantee FROM dba_role_privs p "
        f"WHERE p.granted_role = '{role}' "
        "AND ("
        " EXISTS (SELECT 1 FROM dba_users u "
        "         WHERE u.username = p.grantee AND u.oracle_maintained = 'N') "
        " OR EXISTS (SELECT 1 FROM dba_roles r "
        "            WHERE r.role = p.grantee AND r.oracle_maintained = 'N')"
        ")"
    )


def _sys_priv_revoke_sql(priv: str) -> str:
    return (
        "SELECT p.grantee FROM dba_sys_privs p "
        f"WHERE p.privilege = '{priv}' "
        "AND EXISTS (SELECT 1 FROM dba_users u "
        "            WHERE u.username = p.grantee AND u.oracle_maintained = 'N')"
    )


def _profile_limit_sql(resource: str, *, mode: str, bound: str) -> str:
    """Return non-compliant profile rows (expect row_count_zero)."""
    decoded = (
        "TO_NUMBER(DECODE(p.limit,"
        "'DEFAULT',(SELECT DECODE(limit,'UNLIMITED','9999',limit) "
        "           FROM dba_profiles WHERE profile='DEFAULT' "
        f"          AND resource_name='{resource}'),"
        "'UNLIMITED','9999',p.limit))"
    )
    if mode == "gte":
        pred = f"{decoded} < {bound}"
    elif mode == "lte":
        pred = f"{decoded} > {bound}"
    else:
        raise ValueError(mode)
    return (
        "SELECT p.profile, p.limit FROM dba_profiles p "
        f"WHERE p.resource_name = '{resource}' AND {pred}"
    )


def main() -> None:
    dump = json.loads((BACKEND / "scripts/_oracle19c_rules_dump.json").read_text(encoding="utf-8"))
    rules: dict = {}
    deterministic_ids: list[str] = []

    for row in dump:
        rid = row["rule_id"]
        title = row.get("title") or ""
        audit = row.get("audit") or ""
        a = audit.lower()
        t = title.lower()

        if rid in PARAM_RULES:
            name, kind, expected = PARAM_RULES[rid]
            if kind == "equals":
                # Prefer value_equals so expected tokens like DROP don't trip
                # the SQL write-keyword safety filter when embedded in SQL text.
                sql = f"SELECT value FROM v$parameter WHERE name = '{name}'"
                rules[rid] = ora_sql(
                    sql,
                    {"kind": "value_equals", "expected": expected},
                    f"{name} is {expected}.",
                    f"{name} is not {expected}.",
                )
            elif kind == "not_equals":
                sql = (
                    f"SELECT value FROM v$parameter WHERE name = '{name}' "
                    f"AND UPPER(value) = UPPER('{expected}')"
                )
                # FULL is safe; if expected ever contains deny keywords, switch shape.
                if re.search(r"\b(drop|delete|alter|grant)\b", str(expected), re.I):
                    sql = f"SELECT value FROM v$parameter WHERE name = '{name}'"
                    rules[rid] = ora_sql(
                        sql,
                        {"kind": "value_not_in", "expected_values": [expected]},
                        f"{name} is not {expected}.",
                        f"{name} is {expected}.",
                    )
                else:
                    rules[rid] = ora_sql(
                        sql,
                        {"kind": "row_count_zero"},
                        f"{name} is not {expected}.",
                        f"{name} is {expected}.",
                    )
            elif kind == "empty":
                sql = (
                    f"SELECT value FROM v$parameter WHERE name = '{name}' "
                    f"AND value IS NOT NULL AND TRIM(value) <> ''"
                )
                rules[rid] = ora_sql(
                    sql,
                    {"kind": "row_count_zero"},
                    f"{name} is empty.",
                    f"{name} is not empty.",
                )
            elif kind == "lte":
                sql = (
                    f"SELECT value FROM v$parameter WHERE name = '{name}' "
                    f"AND TO_NUMBER(REGEXP_SUBSTR(value, '[0-9]+')) > {int(expected)}"
                )
                rules[rid] = ora_sql(
                    sql,
                    {"kind": "row_count_zero"},
                    f"{name} <= {expected}.",
                    f"{name} is greater than {expected}.",
                )
            deterministic_ids.append(rid)
            continue

        if "(manual)" in t:
            rules[rid] = manual(
                f"CIS Oracle 19c {rid}: {title}. Follow CIS audit steps and attest."
            )
            continue

        if rid == "4.1":
            rules[rid] = ora_sql(
                "SELECT username FROM dba_users_with_defpwd",
                {"kind": "row_count_zero"},
                "No accounts use default passwords.",
                "Accounts with default passwords exist.",
            )
            deterministic_ids.append(rid)
            continue

        if rid == "4.5":
            rules[rid] = ora_sql(
                "SELECT format FROM v$passwordfile_info WHERE format <> '12.2'",
                {"kind": "row_count_zero"},
                "Password file format is 12.2.",
                "Password file format is not 12.2.",
            )
            deterministic_ids.append(rid)
            continue

        if rid == "4.4":
            rules[rid] = ora_sql(
                "SELECT username, password_versions FROM dba_users "
                "WHERE username <> 'SYS' "
                "AND NOT REGEXP_LIKE(password_versions, '^\\s*12C\\s*$')",
                {"kind": "row_count_zero"},
                "No old password versions in use.",
                "Accounts still use pre-12C password versions.",
            )
            deterministic_ids.append(rid)
            continue

        # Profile resource limits (CIS 3.x) — non-CDB dba_profiles shape.
        if rid == "3.2":
            rules[rid] = ora_sql(
                _profile_limit_sql("PASSWORD_LOCK_TIME", mode="gte", bound="1"),
                {"kind": "row_count_zero"},
                "PASSWORD_LOCK_TIME >= 1 for all profiles.",
                "A profile has PASSWORD_LOCK_TIME < 1.",
            )
            deterministic_ids.append(rid)
            continue
        if rid == "3.5":
            rules[rid] = ora_sql(
                "SELECT profile, limit FROM dba_profiles "
                "WHERE resource_name = 'PASSWORD_VERIFY_FUNCTION' AND limit = 'NULL'",
                {"kind": "row_count_zero"},
                "PASSWORD_VERIFY_FUNCTION is set on all profiles.",
                "A profile has PASSWORD_VERIFY_FUNCTION = NULL.",
            )
            deterministic_ids.append(rid)
            continue
        if rid == "3.7":
            rules[rid] = ora_sql(
                "SELECT profile, limit FROM dba_profiles "
                "WHERE resource_name = 'PASSWORD_ROLLOVER_TIME' "
                "AND limit NOT IN ('0', 'DEFAULT')",
                {"kind": "row_count_zero"},
                "PASSWORD_ROLLOVER_TIME is 0.",
                "A profile has PASSWORD_ROLLOVER_TIME <> 0.",
            )
            deterministic_ids.append(rid)
            continue
        if rid == "3.8":
            rules[rid] = ora_sql(
                _profile_limit_sql("INACTIVE_ACCOUNT_TIME", mode="lte", bound="120"),
                {"kind": "row_count_zero"},
                "INACTIVE_ACCOUNT_TIME <= 120 for all profiles.",
                "A profile has INACTIVE_ACCOUNT_TIME > 120.",
            )
            deterministic_ids.append(rid)
            continue
        if rid == "3.4":
            rules[rid] = ora_sql(
                "SELECT profile, limit FROM dba_profiles "
                "WHERE resource_name = 'PASSWORD_REUSE_MAX' "
                "AND UPPER(limit) <> 'UNLIMITED' "
                "AND limit <> 'DEFAULT'",
                {"kind": "row_count_zero"},
                "PASSWORD_REUSE_MAX is UNLIMITED.",
                "A profile has PASSWORD_REUSE_MAX not UNLIMITED.",
            )
            deterministic_ids.append(rid)
            continue

        if rid in ROLE_REVOKE:
            role = ROLE_REVOKE[rid]
            rules[rid] = ora_sql(
                _role_revoke_sql(role),
                {"kind": "row_count_zero"},
                f"{role} is not granted to non-Oracle-maintained grantees.",
                f"{role} is granted to a non-Oracle-maintained grantee.",
            )
            deterministic_ids.append(rid)
            continue

        if rid in SYS_PRIV_REVOKE:
            priv = SYS_PRIV_REVOKE[rid]
            rules[rid] = ora_sql(
                _sys_priv_revoke_sql(priv),
                {"kind": "row_count_zero"},
                f"{priv} is not granted to non-Oracle-maintained users.",
                f"{priv} is granted to a non-Oracle-maintained user.",
            )
            deterministic_ids.append(rid)
            continue

        if "sqlnet.ora" in a or "listener.ora" in a:
            which = "sqlnet.ora" if "sqlnet.ora" in a else "listener.ora"
            m = re.search(r"(ACCEPT_MD5_CERTS|ACCEPT_SHA1_CERTS)", title, re.I)
            if m and ("not set" in t or "configured correctly" in t):
                key = m.group(1)
                cmd = (
                    f"sh -c 'f=\"$ORACLE_HOME/network/admin/{which}\"; "
                    f"[ -f \"$f\" ] || {{ echo ok; exit 0; }}; "
                    f"if grep -Ei \"^[^#]*{key}[[:space:]]*=[[:space:]]*TRUE\" \"$f\" >/dev/null; "
                    f"then echo bad; else echo ok; fi'"
                )
                rules[rid] = linux_cmd(
                    cmd,
                    "ok",
                    f"{key}=TRUE absent from {which}.",
                    f"{key}=TRUE present in {which}.",
                )
                deterministic_ids.append(rid)
                continue

            m = re.search(
                r"(SQLNET\.(?:ENCRYPTION_CLIENT|ENCRYPTION_SERVER|"
                r"CRYPTO_CHECKSUM_CLIENT|CRYPTO_CHECKSUM_SERVER))",
                title,
                re.I,
            )
            if m and "required" in t:
                key = m.group(1)
                cmd = (
                    f"sh -c 'f=\"$ORACLE_HOME/network/admin/sqlnet.ora\"; "
                    f"[ -f \"$f\" ] || {{ echo bad; exit 0; }}; "
                    f"if grep -Ei \"^[[:space:]]*{re.escape(key)}[[:space:]]*=[[:space:]]*REQUIRED[[:space:]]*$\" \"$f\" >/dev/null; "
                    f"then echo ok; else echo bad; fi'"
                )
                rules[rid] = linux_cmd(
                    cmd, "ok", f"{key}=REQUIRED.", f"{key} is not REQUIRED."
                )
                deterministic_ids.append(rid)
                continue

            m = re.search(r"(SQLNET\.ALLOWED_LOGON_VERSION_(?:CLIENT|SERVER))", title, re.I)
            if m:
                key = m.group(1)
                cmd = (
                    f"sh -c 'f=\"$ORACLE_HOME/network/admin/sqlnet.ora\"; "
                    f"[ -f \"$f\" ] || {{ echo bad; exit 0; }}; "
                    f"if grep -Ei \"^[[:space:]]*{re.escape(key)}[[:space:]]*=[[:space:]]*12a[[:space:]]*$\" \"$f\" >/dev/null; "
                    f"then echo ok; else echo bad; fi'"
                )
                rules[rid] = linux_cmd(cmd, "ok", f"{key}=12a.", f"{key} is not 12a.")
                deterministic_ids.append(rid)
                continue

            if "ALLOWED_WEAK_CERT_ALGORITHMS" in title.upper() or "ALLOWED_WEAK_CERT_ALGORITHMS" in audit.upper():
                cmd = (
                    f"sh -c 'f=\"$ORACLE_HOME/network/admin/{which}\"; "
                    f"[ -f \"$f\" ] || {{ echo ok; exit 0; }}; "
                    f"line=$(grep -Ei \"^[[:space:]]*ALLOWED_WEAK_CERT_ALGORITHMS[[:space:]]*=\" \"$f\" | "
                    f"grep -Ev \"^[[:space:]]*#\" | head -1); "
                    f"if [ -z \"$line\" ]; then echo ok; "
                    f"elif echo \"$line\" | grep -Ei \"\\(NONE\\)\" >/dev/null; then echo ok; "
                    f"else echo bad; fi'"
                )
                rules[rid] = linux_cmd(
                    cmd,
                    "ok",
                    "ALLOWED_WEAK_CERT_ALGORITHMS is NONE or unset.",
                    "ALLOWED_WEAK_CERT_ALGORITHMS allows weak algorithms.",
                )
                deterministic_ids.append(rid)
                continue

            # AES256 encryption types (CIS 2.2.8 / similar)
            if "ENCRYPTION_TYPES_CLIENT" in title.upper() or "ENCRYPTION_TYPES_SERVER" in title.upper():
                key = (
                    "SQLNET.ENCRYPTION_TYPES_CLIENT"
                    if "CLIENT" in title.upper()
                    else "SQLNET.ENCRYPTION_TYPES_SERVER"
                )
                cmd = (
                    f"sh -c 'f=\"$ORACLE_HOME/network/admin/sqlnet.ora\"; "
                    f"[ -f \"$f\" ] || {{ echo bad; exit 0; }}; "
                    f"if grep -Ei \"^[[:space:]]*{re.escape(key)}[[:space:]]*=[[:space:]]*\\(?AES256\\)?[[:space:]]*$\" \"$f\" >/dev/null; "
                    f"then echo ok; else echo bad; fi'"
                )
                rules[rid] = linux_cmd(
                    cmd, "ok", f"{key} is AES256.", f"{key} is not AES256."
                )
                deterministic_ids.append(rid)
                continue

            if "extproc" in a:
                rules[rid] = manual(
                    f"CIS {rid}: Confirm extproc is not listener-exposed "
                    f"(or a documented exception applies). "
                    f"Audit: grep -i extproc $ORACLE_HOME/network/admin/listener.ora"
                )
                continue

        rules[rid] = manual(
            f"CIS Oracle Database 19c {rid}: {title}. Follow the CIS audit SQL/steps "
            f"and attest. Left manual because the CIS check needs an org allowlist, "
            f"CDB-only constructs, or multi-step review beyond a single SELECT."
        )

    assert set(rules) == {r["rule_id"] for r in dump}

    out = {
        "benchmark": BENCH,
        "authored_tag": AUTH,
        "verification": VER,
        "notes": (
            "Parameter/profile/role-revoke checks use simplified non-CDB DBA_*/V$ "
            "shapes derived from CIS audit intent (unauthorized = non-Oracle-maintained). "
            "Remaining manuals are true CIS Manual or need org allowlists / CDB audit."
        ),
        "deterministic_ids": deterministic_ids,
        "rules": rules,
    }
    path = (
        BACKEND
        / "grc/modules/compliance_plugins/seed_data/cis_oracle_database_19c_authored.json"
    )
    path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("Oracle mix", dict(Counter(s["runner_type"] for s in rules.values())))
    print("deterministic", len(deterministic_ids), deterministic_ids)
    print("wrote", path)


if __name__ == "__main__":
    main()
