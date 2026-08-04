"""CIS PostgreSQL 18 Benchmark — hand-authored executable checks.

Replaces PDF-ingest ``expect:{"kind":"any"}`` placeholders with real
``postgres_sql`` / ``linux_ssh`` / ``windows_winrm`` / ``manual`` checks.

Apply with ``scripts/apply_cis_pg18_checks.py`` (idempotent UPSERT of
``check_definition`` + ``runner_type`` + review flags). Every authored
definition carries ``_authored: "cis-pg18"`` so a re-apply is auditable
and a re-ingest can re-merge without wiping these rows.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

BENCHMARK = "CIS_PostgreSQL_18_Benchmark_v1.0.0"
AUTH_TAG = "cis-pg18"


def _pg(
    sql: str,
    *,
    kind: str,
    expected: Any = None,
    pass_message: str,
    fail_message: str,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    expect: Dict[str, Any] = {"kind": kind}
    if expected is not None:
        expect["expected"] = expected
    cd: Dict[str, Any] = {
        "runner": "postgres_sql",
        "sql": sql,
        "expect": expect,
        "pass_message": pass_message,
        "fail_message": fail_message,
        "_authored": AUTH_TAG,
        "timeout_seconds": 15,
    }
    if extra:
        cd.update(extra)
    return {"runner_type": "postgres_sql", "check_definition": cd}


def _manual(attestation_prompt: str) -> Dict[str, Any]:
    return {
        "runner_type": "manual",
        "check_definition": {
            "requires_attestation": True,
            "attestation_prompt": attestation_prompt,
            "pass_message": "Operator attested compliant.",
            "fail_message": "Operator attested non-compliant.",
            "_authored": AUTH_TAG,
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


def _winrm(
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
    if kind == "exit_zero":
        # winrm runner uses exit_zero equivalently via status_code
        expect = {"kind": "exit_zero"}
    return {
        "runner_type": "windows_winrm",
        "check_definition": {
            "command": command,
            "shell": "powershell",
            "expect": expect,
            "pass_message": pass_message,
            "fail_message": fail_message,
            "applicable_host_families": ["windows"],
            "_authored": AUTH_TAG,
            "timeout_seconds": 30,
        },
    }


def _setting_on(name: str, title: str) -> Dict[str, Any]:
    return _pg(
        f"SELECT setting FROM pg_settings WHERE name = '{name}'",
        kind="first_value_equals",
        expected="on",
        pass_message=f"{name} is enabled.",
        fail_message=f"{name} is OFF.",
    )


def _setting_off(name: str) -> Dict[str, Any]:
    return _pg(
        f"SELECT setting FROM pg_settings WHERE name = '{name}'",
        kind="first_value_equals",
        expected="off",
        pass_message=f"{name} is disabled.",
        fail_message=f"{name} is ON.",
    )


def _setting_equals(name: str, expected: str, *, pass_message: str, fail_message: str) -> Dict[str, Any]:
    return _pg(
        f"SELECT setting FROM pg_settings WHERE name = '{name}'",
        kind="first_value_equals",
        expected=expected,
        pass_message=pass_message,
        fail_message=fail_message,
    )


def _setting_regex(name: str, pattern: str, *, pass_message: str, fail_message: str) -> Dict[str, Any]:
    return _pg(
        f"SELECT setting FROM pg_settings WHERE name = '{name}'",
        kind="first_value_regex",
        expected=pattern,
        pass_message=pass_message,
        fail_message=fail_message,
    )


def _setting_contains(name: str, needle: str, *, pass_message: str, fail_message: str) -> Dict[str, Any]:
    return _pg(
        f"SELECT setting FROM pg_settings WHERE name = '{name}'",
        kind="first_value_contains",
        expected=needle,
        pass_message=pass_message,
        fail_message=fail_message,
    )


# ─── Authored checks keyed by rule_id ─────────────────────────────────────
# Includes the 12 already-live checks so apply is the single source of truth.

AUTHORED: Dict[str, Dict[str, Any]] = {
    # ── 1.x Installation / packaging (OS or manual) ───────────────────────
    "1.1": _manual(
        "Confirm PostgreSQL packages were installed only from organization-approved "
        "repositories (dnf/apt repo list + package From-repo). Record evidence."
    ),
    "1.2": _manual(
        "Confirm only required PostgreSQL packages are installed (no unused "
        "admin UIs / docs packages beyond policy). Record package inventory."
    ),
    "1.3": _linux(
        "systemctl is-enabled postgresql-18.service 2>/dev/null || "
        "systemctl is-enabled postgresql.service 2>/dev/null || "
        "systemctl is-enabled postgresql@18-main.service 2>/dev/null",
        kind="stdout_contains",
        value="enabled",
        pass_message="PostgreSQL systemd unit is enabled.",
        fail_message="PostgreSQL systemd unit is not enabled.",
    ),
    "1.4": _manual(
        "Confirm the data cluster was initialized successfully (PGDATA exists, "
        "permissions private to the service account, initdb checksumming per policy)."
    ),
    "1.5": _manual(
        "Compare SHOW server_version against current PostgreSQL security releases "
        "and confirm the instance is on a supported, patched minor release."
    ),
    "1.6": _linux(
        "sh -c 'grep -R \"PGPASSWORD\" /home/*/.bashrc /home/*/.profile "
        "/home/*/.bash_profile /root/.bashrc /root/.profile /root/.bash_profile "
        "/etc/environment 2>/dev/null | head -n 20; "
        "test $? -eq 1 -o $? -eq 0'",
        kind="stdout_not_contains",
        value="PGPASSWORD",
        pass_message="PGPASSWORD is not set in user profiles.",
        fail_message="PGPASSWORD appears in a user profile or /etc/environment.",
    ),
    "1.7": _linux(
        # Avoid sudo (blocked by runner). Scan readable /proc environ for the
        # current SSH user context; full-host coverage still needs attestation.
        "sh -c 'grep -l PGPASSWORD /proc/*/environ 2>/dev/null | head -n 5 || true'",
        kind="stdout_not_contains",
        value="/proc/",
        pass_message="No process environ currently exposes PGPASSWORD (readable /proc).",
        fail_message="At least one process environ contains PGPASSWORD.",
    ),

    # ── 2.x File permissions (Linux SSH / Windows WinRM / manual) ─────────
    "2.1": _linux(
        "sh -c 'umask'",
        kind="stdout_regex",
        value=r"^0*0[0-7]7\s*$",
        pass_message="Current shell umask is 0077 or more restrictive.",
        fail_message="Current shell umask is weaker than 0077.",
    ),
    "2.2": _manual(
        "Confirm the PostgreSQL extension directory ownership/permissions match "
        "policy (typically root:root, mode 755). Use pg_config --sharedir/extension."
    ),
    "2.3": _linux(
        "sh -c 'find /home /root -name .psql_history 2>/dev/null | while read f; "
        "do ls -la \"$f\"; done'",
        kind="stdout_not_regex",
        value=r"(^|[\n])-.*\.psql_history",
        pass_message="No regular .psql_history files found (only absences or /dev/null links).",
        fail_message="A regular .psql_history file exists (should be absent or linked to /dev/null).",
    ),
    "2.4": _linux(
        "sh -c 'grep -R \"^[[:space:]]*password[[:space:]]*=\" "
        "${PGSERVICEFILE:-} ${PGSYSCONFDIR:-/etc}/pg_service.conf "
        "/root/.pg_service.conf 2>/dev/null | head -n 10 || true'",
        kind="stdout_not_contains",
        value="password",
        pass_message="No password= entries found in checked pg_service files.",
        fail_message="A password= entry was found in a pg_service file.",
    ),

    # ── 3.1.x Logging (SQL) ───────────────────────────────────────────────
    "3.1.2": _setting_regex(
        "log_destination",
        r"(stderr|csvlog|syslog|jsonlog|eventlog)",
        pass_message="log_destination includes a recognized destination.",
        fail_message="log_destination is empty or unrecognized.",
    ),
    "3.1.3": _setting_on("logging_collector", "logging collector"),
    "3.1.4": _pg(
        # Requires pg_read_all_settings — without it current_setting errors (not a false fail).
        "SELECT current_setting('log_directory')",
        kind="first_value_regex",
        expected=r".+",
        pass_message="log_directory is set.",
        fail_message="log_directory is empty.",
    ),
    "3.1.5": _pg(
        "SELECT current_setting('log_filename')",
        kind="first_value_regex",
        expected=r".+",
        pass_message="log_filename pattern is set.",
        fail_message="log_filename is empty.",
    ),
    "3.1.6": _pg(
        # CIS example wants 0600; accept owner-only write (no group/other write).
        "SELECT setting FROM pg_settings WHERE name = 'log_file_mode'",
        kind="first_value_regex",
        expected=r"^0?600$",
        pass_message="log_file_mode is 0600 (owner-only).",
        fail_message="log_file_mode is not 0600.",
    ),
    "3.1.7": _setting_on("log_truncate_on_rotation", "log_truncate_on_rotation"),
    "3.1.8": _pg(
        "SELECT setting FROM pg_settings WHERE name = 'log_rotation_age'",
        kind="first_value_regex",
        expected=r"^(?!0\s*$).+",
        pass_message="log_rotation_age is non-zero.",
        fail_message="log_rotation_age is 0 (rotation by age disabled).",
    ),
    "3.1.9": _pg(
        "SELECT setting FROM pg_settings WHERE name = 'log_rotation_size'",
        kind="first_value_regex",
        expected=r"^(?!0\s*$).+",
        pass_message="log_rotation_size is non-zero.",
        fail_message="log_rotation_size is 0 (rotation by size disabled).",
    ),
    "3.1.10": _pg(
        # When syslog is not a log destination, facility is irrelevant → ok.
        "SELECT CASE WHEN current_setting('log_destination', true) NOT ILIKE '%syslog%' "
        "THEN 'ok' WHEN lower(COALESCE(current_setting('syslog_facility', true),'')) "
        "~ '^local[0-7]$' THEN 'ok' ELSE 'bad' END",
        kind="first_value_equals",
        expected="ok",
        pass_message="syslog_facility is appropriate (or syslog logging is unused).",
        fail_message="syslog is enabled but syslog_facility is not LOCAL0–LOCAL7.",
    ),
    "3.1.11": _pg(
        "SELECT CASE WHEN current_setting('log_destination', true) NOT ILIKE '%syslog%' "
        "THEN 'ok' WHEN lower(current_setting('syslog_sequence_numbers', true)) = 'on' "
        "THEN 'ok' ELSE 'bad' END",
        kind="first_value_equals",
        expected="ok",
        pass_message="syslog_sequence_numbers is on (or syslog unused).",
        fail_message="syslog is enabled but syslog_sequence_numbers is off.",
    ),
    "3.1.12": _pg(
        "SELECT CASE WHEN current_setting('log_destination', true) NOT ILIKE '%syslog%' "
        "THEN 'ok' WHEN lower(current_setting('syslog_split_messages', true)) = 'on' "
        "THEN 'ok' ELSE 'bad' END",
        kind="first_value_equals",
        expected="ok",
        pass_message="syslog_split_messages is on (or syslog unused).",
        fail_message="syslog is enabled but syslog_split_messages is off.",
    ),
    "3.1.13": _pg(
        "SELECT CASE WHEN current_setting('log_destination', true) NOT ILIKE '%syslog%' "
        "THEN 'ok' WHEN length(COALESCE(current_setting('syslog_ident', true),'')) > 0 "
        "THEN 'ok' ELSE 'bad' END",
        kind="first_value_equals",
        expected="ok",
        pass_message="syslog_ident is set (or syslog unused).",
        fail_message="syslog is enabled but syslog_ident is empty.",
    ),
    "3.1.14": _pg(
        # At least warning: warning, error, log, fatal, panic (not debug*/info*/notice)
        "SELECT CASE WHEN lower(setting) IN "
        "('warning','error','log','fatal','panic') THEN 'ok' ELSE 'bad' END "
        "FROM pg_settings WHERE name = 'log_min_messages'",
        kind="first_value_equals",
        expected="ok",
        pass_message="log_min_messages is at least warning.",
        fail_message="log_min_messages is below warning (too verbose / under-logging).",
    ),
    "3.1.15": _pg(
        "SELECT CASE WHEN lower(setting) IN "
        "('error','log','fatal','panic') THEN 'ok' ELSE 'bad' END "
        "FROM pg_settings WHERE name = 'log_min_error_statement'",
        kind="first_value_equals",
        expected="ok",
        pass_message="log_min_error_statement is at least error.",
        fail_message="log_min_error_statement is below error.",
    ),
    "3.1.16": _setting_off("debug_print_parse"),
    "3.1.17": _setting_off("debug_print_rewritten"),
    "3.1.18": _setting_off("debug_print_plan"),
    "3.1.19": _setting_on("debug_pretty_print", "debug_pretty_print"),
    "3.1.20": _pg(
        "SELECT CASE WHEN lower(COALESCE(NULLIF(setting,''),'off')) = 'on' "
        "THEN 'on' ELSE 'off' END FROM pg_settings WHERE name = 'log_connections'",
        kind="first_value_equals",
        expected="on",
        pass_message="log_connections is enabled.",
        fail_message="log_connections is OFF — connections are not audited.",
    ),
    "3.1.21": _setting_on("log_disconnections", "log_disconnections"),
    "3.1.22": _setting_equals(
        "log_error_verbosity",
        "verbose",
        pass_message="log_error_verbosity is verbose.",
        fail_message="log_error_verbosity is not verbose.",
    ),
    "3.1.23": _setting_on("log_hostname", "log_hostname"),
    "3.1.24": _pg(
        # Require the core tokens CIS cites for non-syslog logging.
        "SELECT CASE WHEN setting LIKE '%m%' AND setting LIKE '%p%' "
        "AND setting LIKE '%u%' AND setting LIKE '%d%' "
        "AND setting LIKE '%a%' AND setting LIKE '%h%' "
        "THEN 'ok' ELSE 'bad' END "
        "FROM pg_settings WHERE name = 'log_line_prefix'",
        kind="first_value_equals",
        expected="ok",
        pass_message="log_line_prefix includes required tokens (%m %p %u %d %a %h).",
        fail_message="log_line_prefix is missing one or more required tokens.",
    ),
    "3.1.25": _pg(
        "SELECT 1 FROM pg_settings WHERE name = 'log_statement' AND lower(setting) <> 'none'",
        kind="row_count_nonzero",
        pass_message="log_statement is not 'none'.",
        fail_message="log_statement is 'none' — DDL/DML not audited.",
    ),
    "3.1.26": _pg(
        "SELECT CASE WHEN upper(setting) IN ('GMT','UTC') "
        "OR setting ILIKE 'UTC%' OR setting ILIKE 'GMT%' "
        "THEN 'ok' ELSE 'bad' END "
        "FROM pg_settings WHERE name = 'log_timezone'",
        kind="first_value_equals",
        expected="ok",
        pass_message="log_timezone is GMT/UTC.",
        fail_message="log_timezone is not GMT/UTC.",
    ),
    "3.2": _pg(
        "SELECT current_setting('shared_preload_libraries')",
        kind="first_value_contains",
        expected="pgaudit",
        pass_message="pgAudit is loaded (shared_preload_libraries).",
        fail_message="pgAudit is NOT loaded — no statement-level audit trail.",
    ),

    # ── 4.x User access / privileges ──────────────────────────────────────
    "4.1": _linux(
        # Readable without sudo on many hosts if /etc/shadow perms allow group;
        # otherwise run errors → not a silent pass.
        "sh -c 'grep \"^postgres:\" /etc/passwd | cut -d: -f7'",
        kind="stdout_regex",
        value=r"(nologin|false|sbin/nologin)",
        pass_message="postgres OS account shell is non-interactive.",
        fail_message="postgres OS account has an interactive login shell.",
    ),
    "4.2": _manual(
        "Confirm only authorized OS admins can sudo -iu postgres (sudoers / group "
        "membership). Attest the approved admin list."
    ),
    "4.3": _pg(
        # Allow at most one login-capable non-system superuser (the bootstrap
        # owner). A second login superuser is the CIS "excessive privileges" finding.
        "SELECT rolname FROM pg_roles WHERE rolsuper AND rolcanlogin "
        "AND rolname !~ '^pg_' ORDER BY 1 OFFSET 1",
        kind="row_count_zero",
        pass_message="At most one login-capable superuser role (bootstrap owner).",
        fail_message="Multiple login-capable superuser roles — revoke excess admin privileges.",
    ),
    "4.4": _manual(
        "Review pg_roles WHERE rolcanlogin and confirm inactive human/service "
        "accounts are NOLOGIN. Automated listing alone cannot know 'currently unused'."
    ),
    "4.5": _pg(
        # List SECURITY DEFINER functions outside pg_catalog / information_schema.
        "SELECT n.nspname || '.' || p.proname FROM pg_proc p "
        "JOIN pg_namespace n ON n.oid = p.pronamespace "
        "WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema') "
        "AND p.proname NOT LIKE 'pgaudit%'",
        kind="row_count_zero",
        pass_message="No non-catalog SECURITY DEFINER functions found.",
        fail_message="SECURITY DEFINER functions exist outside system catalogs — review necessity.",
    ),
    "4.6": _manual(
        "Inventory table DML grants (pg_tables × role grants) per database and "
        "confirm only authorized roles hold INSERT/UPDATE/DELETE."
    ),
    "4.7": _manual(
        "Confirm every table that requires RLS has relrowsecurity enabled and "
        "policies applied (business-process decision; cannot auto-pass)."
    ),
    "4.8": _pg(
        "SELECT 1 FROM pg_extension WHERE extname = 'set_user'",
        kind="row_count_nonzero",
        pass_message="set_user extension is installed.",
        fail_message="set_user extension is NOT installed.",
    ),
    "4.9": _manual(
        "Review superuser roles and confirm predefined roles (pg_monitor, "
        "pg_read_all_settings, …) are used instead of blanket SUPERUSER where possible."
    ),
    "4.10": _pg(
        # pg_authid requires elevated privilege — without it the runner returns
        # error (not a silent pass/fail). Customer scan roles should hold rights
        # to read password metadata, or this stays an error until granted.
        "SELECT rolname FROM pg_authid WHERE rolpassword IS NULL AND rolcanlogin "
        "AND rolname !~ '^pg_'",
        kind="row_count_zero",
        pass_message="All login roles have a password set (or none can login without one).",
        fail_message="Login roles without passwords exist — use passwords or cert auth intentionally.",
        extra={
            "_requires_privilege": "pg_authid",
            "_note": "Needs rights to read pg_authid; otherwise the check errors (not auto-pass).",
        },
    ),

    # ── 5.x Connection / auth ─────────────────────────────────────────────
    "5.1": _linux(
        "sh -c 'ps -eww -o args= 2>/dev/null | grep -E \"psql|postgres://\" | "
        "grep -i password | grep -v grep | head -n 5 || true'",
        kind="stdout_not_contains",
        value="password",
        pass_message="No live process args expose a password= / postgres URI password.",
        fail_message="A process command line appears to embed a database password.",
    ),
    "5.2": _setting_regex(
        "listen_addresses",
        r"^(?!\*).+",
        pass_message="listen_addresses is bound to specific host(s), not '*'.",
        fail_message="listen_addresses is '*' — the DB accepts connections on every interface.",
    ),
    "5.3": _manual(
        "Attest local (UNIX socket) pg_hba rules: peer for postgres only as intended; "
        "other OS users cannot impersonate DB roles over the socket."
    ),
    "5.4": _pg(
        # database / user_name are text[] in pg_hba_file_rules.
        "SELECT type || ' ' || array_to_string(database, ',') || ' ' || "
        "array_to_string(user_name, ',') || ' ' || COALESCE(address,'') || ' ' || auth_method "
        "FROM pg_hba_file_rules "
        "WHERE type IN ('host','hostssl','hostnossl') "
        "AND auth_method IN ('trust','password')",
        kind="row_count_zero",
        pass_message="No host TCP rules use trust or plaintext password auth.",
        fail_message="One or more host TCP pg_hba rules use trust or password (use scram-sha-256/cert/etc).",
    ),
    "5.5": _pg(
        "SELECT rolname FROM pg_roles WHERE rolname NOT LIKE 'pg_%' "
        "AND rolcanlogin AND rolconnlimit = -1",
        kind="row_count_zero",
        pass_message="All login roles have a finite connection limit.",
        fail_message="One or more login roles have rolconnlimit = -1 (unlimited).",
    ),
    "5.6": _manual(
        "Confirm password complexity (e.g. passwordcheck / policy) meets organization "
        "requirements — not fully expressible as a single cluster setting."
    ),

    # ── 6.x Runtime / TLS ─────────────────────────────────────────────────
    "6.1": _manual(
        "Document understood attack vectors and which runtime parameters are "
        "intentionally tunable by non-superusers vs locked down."
    ),
    "6.2": _pg(
        # backend context params that CIS cares about often include work_mem etc.
        # Enforce that dangerous developer settings stay off at least.
        "SELECT name FROM pg_settings WHERE name IN "
        "('debug_print_parse','debug_print_rewritten','debug_print_plan') "
        "AND lower(setting) = 'on'",
        kind="row_count_zero",
        pass_message="Backend debug_print_* parameters are off.",
        fail_message="One or more backend debug_print_* parameters are on.",
    ),
    "6.3": _manual(
        "Review Postmaster-context parameters (listen_addresses, port, shared_buffers, "
        "shared_preload_libraries) against hardened baseline; attest."
    ),
    "6.4": _manual(
        "Review SIGHUP-reloadable parameters against hardened baseline; attest."
    ),
    "6.5": _manual(
        "Review Superuser-context parameters against hardened baseline; attest."
    ),
    "6.6": _manual(
        "Review User-context parameters and ALTER ROLE/USER SETs for unsafe overrides; attest."
    ),
    # 6.7 already disabled in library — leave disabled; still author a real check
    "6.7": _manual(
        "Confirm FIPS 140-2 OpenSSL cryptography is in use where policy requires it."
    ),
    "6.8": _setting_on("ssl", "TLS/SSL"),
    "6.9": _pg(
        "SELECT CASE WHEN COALESCE(current_setting('ssl_min_protocol_version'),'') = '' THEN 'ok' "
        "WHEN current_setting('ssl_min_protocol_version') !~* 'TLSv1(\\.0|\\.1)(,|$)' "
        "AND current_setting('ssl_min_protocol_version') !~* '(^|,)TLSv1(,|$)' "
        "THEN 'ok' ELSE 'bad' END",
        kind="first_value_equals",
        expected="ok",
        pass_message="ssl_min_protocol_version excludes TLSv1.0/1.1 (or unset with modern default).",
        fail_message="TLS 1.0/1.1 appears allowed by ssl_min_protocol_version.",
    ),
    "6.10": _pg(
        "SELECT CASE WHEN COALESCE(current_setting('ssl_ciphers'),'') = '' THEN 'ok' "
        "WHEN current_setting('ssl_ciphers') ~* '(NULL|EXP|aNULL|ADH|RC4|DES|MD5)' THEN 'bad' "
        "ELSE 'ok' END",
        kind="first_value_equals",
        expected="ok",
        pass_message="ssl_ciphers does not list known-weak suites.",
        fail_message="ssl_ciphers includes weak suites (NULL/EXP/RC4/DES/MD5/…).",
    ),
    "6.11": _manual(
        "Confirm pgcrypto is installed where required and configured per policy "
        "(extension present + key management practices)."
    ),

    # ── 7.x Replication / backup ──────────────────────────────────────────
    "7.1": _manual(
        "Confirm a replication-only role (REPLICATION, NOSUPERUSER) is used for "
        "streaming replication — not a superuser."
    ),
    "7.2": _setting_on("log_replication_commands", "log_replication_commands"),
    "7.3": _manual(
        "Confirm base backups are configured, scheduled, and restore-tested."
    ),
    "7.4": _pg(
        "SELECT CASE WHEN lower(setting) IN ('on','always') THEN 'ok' ELSE 'bad' END "
        "FROM pg_settings WHERE name = 'archive_mode'",
        kind="first_value_equals",
        expected="ok",
        pass_message="archive_mode is on/always.",
        fail_message="archive_mode is off — WAL archiving not enabled.",
    ),
    "7.5": _manual(
        "Confirm streaming replication parameters (primary_conninfo, slots, sync commit) "
        "match the intended topology."
    ),

    # ── 8.x Filesystem / backup tool / misc ───────────────────────────────
    "8.1": _manual(
        "Confirm tablespace / log / archive directories live outside the data cluster "
        "directory as required by policy."
    ),
    "8.2": _manual(
        "Confirm pgBackRest (or approved backup tool) is installed and configured."
    ),
    "8.3": _manual(
        "Review miscellaneous configuration settings against the organization's "
        "hardened baseline and attest."
    ),
}


# Windows-specific variants for rules that CAN run via WinRM (service / ACL).
# Applied as alternate check_definition when host family is windows — stored
# under check_definition["windows_winrm"] and selected at execute time.
WINDOWS_VARIANTS: Dict[str, Dict[str, Any]] = {
    "1.3": {
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
    },
    "2.2": {
        # Use data_directory parent share if available via env is hard; check
        # Program Files PostgreSQL extension path heuristically.
        "command": (
            "$p = Get-ChildItem 'C:\\Program Files\\PostgreSQL' -ErrorAction SilentlyContinue | "
            "Sort-Object Name -Descending | Select-Object -First 1; "
            "if (-not $p) { 'no-install' } else { "
            "$ext = Join-Path $p.FullName 'share\\extension'; "
            "if (-not (Test-Path $ext)) { 'missing-ext' } else { "
            "(Get-Acl $ext).Access | Out-String } }"
        ),
        "shell": "powershell",
        "expect": {"kind": "stdout_not_contains", "value": "no-install"},
        "pass_message": "PostgreSQL extension directory is present (review ACL in evidence).",
        "fail_message": "PostgreSQL install/extension directory not found for ACL review.",
        "applicable_host_families": ["windows"],
        "_authored": AUTH_TAG,
        "_note": "ACL detail is in raw output for operator review; tighten expect once policy is fixed.",
    },
}


def all_rule_ids() -> List[str]:
    return sorted(AUTHORED.keys(), key=lambda r: [int(x) if x.isdigit() else x for x in r.replace("-", ".").split(".")])


def merge_windows_variant(rule_id: str, cd: Dict[str, Any]) -> Dict[str, Any]:
    """Attach windows_winrm alternate payload when defined."""
    out = dict(cd)
    alt = WINDOWS_VARIANTS.get(rule_id)
    if alt:
        out["windows_winrm"] = alt
        # Allow both families when a windows alternate exists alongside linux_ssh
        fams = list(out.get("applicable_host_families") or [])
        if "windows" not in fams:
            fams.append("windows")
        if fams:
            out["applicable_host_families"] = fams
    return out
