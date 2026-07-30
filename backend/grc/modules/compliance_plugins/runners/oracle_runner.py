"""Oracle SQL check runner using `oracledb` (thin mode — no Oracle Instant
Client needed).

Used for CIS Oracle Database benchmarks. A bank typically gives us a
read-only DBA account (or a `select on v_$parameter` style scoped grant)
and the runner runs DBA_* / V$ queries to verify settings like:

    - Password complexity profiles
    - Auditing parameters
    - Listener configuration
    - Encryption settings
    - Privilege grants

`check_definition` shape:
    {
      "sql": "SELECT value FROM v$parameter WHERE name='audit_sys_operations'",
      "expect": {
         "kind": "row_count_zero" | "row_count_nonzero" | "value_equals"
                 | "value_in" | "value_not_in" | "value_contains",
         "expected": "TRUE",
         "expected_values": ["TRUE", "DB"],   # for value_in / value_not_in
         "column": 0,   # 0-based column index, defaults to 0
      },
      "pass_message": "Audit trail is enabled.",
      "fail_message": "audit_sys_operations is FALSE — CIS requires TRUE.",
      "timeout_seconds": 15,
    }

Credentials dict expected keys: oracle_host, oracle_port (default 1521),
oracle_service_name OR oracle_sid, oracle_username, oracle_password.

Read-only contract: only SELECT statements allowed — the SQL safety
check rejects anything that looks like a write (INSERT / UPDATE / DELETE
/ TRUNCATE / DROP / ALTER / GRANT / REVOKE / EXEC / CALL / MERGE /
CREATE).
"""
from __future__ import annotations

import re
from typing import Any, Dict

from .registry import RunnerResult, register

try:
    import oracledb  # type: ignore
    ORACLEDB_AVAILABLE = True
except ImportError:  # pragma: no cover
    ORACLEDB_AVAILABLE = False


# Hard block any keyword that mutates state. Word boundaries on both sides
# so legitimate identifiers like "create_date" in a SELECT clause aren't
# rejected.
_DENY_KEYWORDS = (
    "insert", "update", "delete", "truncate", "drop", "alter",
    "grant", "revoke", "exec", "execute", "call", "merge", "create",
    "rename", "begin", "declare",
)
_DENY_RE = re.compile(
    r"\b(" + "|".join(_DENY_KEYWORDS) + r")\b",
    re.IGNORECASE,
)
# Multi-statement SQL (with semicolons) is also rejected — a single
# benchmark check should always be a single SELECT.
_MULTI_STATEMENT_RE = re.compile(r";\s*\w")


def _is_sql_safe(sql: str) -> tuple[bool, str]:
    """Reject any SQL that isn't a pure read-only SELECT.

    Returns (ok, reason). Reason is empty when ok=True.

    String literals are stripped before the write-keyword scan so CIS
    expected values like ``'(DROP,3)'`` or privilege names like
    ``'CREATE LIBRARY'`` do not false-positive as mutating SQL.
    """
    s = (sql or "").strip()
    if not s:
        return False, "Empty SQL statement."
    # Strip a trailing semicolon — operators commonly include one out of
    # habit, but `oracledb.execute()` rejects it. Keep this *before* the
    # multi-statement check so a single trailing ';' is tolerated.
    s = s.rstrip(";").strip()
    # Strip ANY -- line comments before the keyword check so commented-out
    # writes (e.g. `-- DELETE FROM x; SELECT 1`) don't reach the DB.
    lines = [ln.split("--", 1)[0] for ln in s.splitlines()]
    s_no_comments = "\n".join(lines).strip()
    # Strip single-quoted string literals ('' escaped quotes inside).
    s_no_literals = re.sub(r"'(?:[^']|'')*'", "''", s_no_comments)
    if not s_no_comments.lower().startswith(("select", "with")):
        return False, "SQL must start with SELECT or WITH (read-only)."
    if _DENY_RE.search(s_no_literals):
        return False, "SQL contains a write keyword (INSERT/UPDATE/DELETE/etc.)."
    if _MULTI_STATEMENT_RE.search(s_no_comments):
        return False, "Multiple SQL statements per check are not allowed."
    return True, ""


def _eval_expectation(
    rows: list[tuple[Any, ...]],
    expect: Dict[str, Any],
    fail_message: str,
    pass_message: str,
) -> RunnerResult:
    kind = (expect.get("kind") or "row_count_nonzero").lower()
    column = int(expect.get("column", 0) or 0)

    if kind == "row_count_zero":
        if not rows:
            return RunnerResult(status="passed", summary=pass_message, raw_output={"row_count": 0})
        return RunnerResult(
            status="failed",
            summary=fail_message + f" (Got {len(rows)} rows — CIS expects 0.)",
            raw_output={"row_count": len(rows), "first_row": list(rows[0])},
        )

    if kind == "row_count_nonzero":
        if rows:
            return RunnerResult(status="passed", summary=pass_message, raw_output={"row_count": len(rows)})
        return RunnerResult(
            status="failed",
            summary=fail_message + " (Got 0 rows — CIS expects >= 1.)",
            raw_output={"row_count": 0},
        )

    # value-based expectations operate on the first row, given column
    if not rows:
        return RunnerResult(
            status="failed",
            summary=fail_message + " (No rows returned — cannot read setting.)",
            raw_output={"row_count": 0},
        )
    actual = rows[0][column] if column < len(rows[0]) else None
    actual_s = "" if actual is None else str(actual)

    if kind == "value_equals":
        expected_s = str(expect.get("expected", ""))
        if actual_s.strip().lower() == expected_s.strip().lower():
            return RunnerResult(status="passed", summary=pass_message,
                                raw_output={"actual": actual_s})
        return RunnerResult(
            status="failed",
            summary=fail_message + f" (actual={actual_s!r}, expected={expected_s!r})",
            raw_output={"actual": actual_s, "expected": expected_s},
        )

    if kind == "value_in":
        expected = [str(v).strip().lower() for v in (expect.get("expected_values") or [])]
        if actual_s.strip().lower() in expected:
            return RunnerResult(status="passed", summary=pass_message,
                                raw_output={"actual": actual_s})
        return RunnerResult(
            status="failed",
            summary=fail_message + f" (actual={actual_s!r}, allowed={expected})",
            raw_output={"actual": actual_s, "allowed": expected},
        )

    if kind == "value_not_in":
        expected = [str(v).strip().lower() for v in (expect.get("expected_values") or [])]
        if actual_s.strip().lower() not in expected:
            return RunnerResult(status="passed", summary=pass_message,
                                raw_output={"actual": actual_s})
        return RunnerResult(
            status="failed",
            summary=fail_message + f" (actual={actual_s!r} is in disallowed set {expected})",
            raw_output={"actual": actual_s, "disallowed": expected},
        )

    if kind == "value_contains":
        needle = str(expect.get("expected", ""))
        if needle.lower() in actual_s.lower():
            return RunnerResult(status="passed", summary=pass_message,
                                raw_output={"actual": actual_s})
        return RunnerResult(
            status="failed",
            summary=fail_message + f" (substring {needle!r} not in {actual_s!r})",
            raw_output={"actual": actual_s, "needle": needle},
        )

    return RunnerResult(
        status="error",
        summary=f"Unknown expectation kind: {kind}",
        error_message=f"unknown_expectation_kind:{kind}",
    )


@register("oracle_sql")
def run_oracle_sql_check(check_definition: Dict[str, Any], credentials: Dict[str, Any]) -> RunnerResult:
    if not ORACLEDB_AVAILABLE:
        return RunnerResult(
            status="error",
            summary="oracledb library not installed on this server.",
            error_message="oracledb_not_installed",
        )

    sql = check_definition.get("sql") or check_definition.get("command")
    if not sql:
        return RunnerResult(
            status="error",
            summary="Missing 'sql' (or 'command') in check_definition.",
            error_message="invalid_check_definition",
        )
    safe, reason = _is_sql_safe(sql)
    if not safe:
        return RunnerResult(status="error", summary=reason, error_message="unsafe_sql")

    host = credentials.get("oracle_host")
    port = credentials.get("oracle_port") or 1521
    service = credentials.get("oracle_service_name")
    sid = credentials.get("oracle_sid")
    username = credentials.get("oracle_username")
    password = credentials.get("oracle_password")
    if not host or not username or not password or (not service and not sid):
        return RunnerResult(
            status="error",
            summary=(
                "Oracle credentials missing (need oracle_host, oracle_username, "
                "oracle_password, and one of oracle_service_name OR oracle_sid)."
            ),
            error_message="missing_credentials",
        )

    # Build connection string — service_name is preferred, but SID is
    # supported for older bank installations.
    if service:
        dsn = oracledb.makedsn(host, int(port), service_name=service)
    else:
        dsn = oracledb.makedsn(host, int(port), sid=sid)

    timeout = int(check_definition.get("timeout_seconds", 15))
    expect = check_definition.get("expect") or {"kind": "row_count_nonzero"}
    pass_msg = check_definition.get("pass_message") or "Oracle check passed."
    fail_msg = check_definition.get("fail_message") or "Oracle check failed."

    try:
        # Thin mode — no Oracle client needed
        conn = oracledb.connect(
            user=username, password=password, dsn=dsn,
            tcp_connect_timeout=timeout,
        )
    except oracledb.DatabaseError as e:
        return RunnerResult(
            status="error",
            summary=f"Oracle connect failed: {e}",
            error_message=str(e),
        )

    try:
        cursor = conn.cursor()
        cursor.execute(sql.rstrip(";").strip())
        rows = cursor.fetchall()
        return _eval_expectation(rows, expect, fail_msg, pass_msg)
    except oracledb.DatabaseError as e:
        return RunnerResult(
            status="error",
            summary=f"Oracle SQL error: {e}",
            error_message=str(e),
        )
    finally:
        try:
            conn.close()
        except Exception:
            pass


__all__ = ["run_oracle_sql_check"]
