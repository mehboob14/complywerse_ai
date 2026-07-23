"""Additional agentless runners — MSSQL, PostgreSQL, MySQL, Azure, LDAP, K8s.

Same `RunnerResult` contract as the existing runners. Drivers are
imported lazily so the backend boots without them installed; a check
against an unconfigured runner returns a clear error pointing at the
pip package the operator needs.

`check_definition` shape (SQL-style runners — MSSQL/Postgres/MySQL):
    {
      "sql": "SELECT name FROM sys.server_principals WHERE is_disabled = 0",
      "expect": {
        "kind": "row_count_zero" | "row_count_nonzero" |
                "first_value_equals" | "first_value_contains" |
                "first_value_regex",
        "expected": "...",
      },
      "pass_message": "...",
      "fail_message": "...",
      "timeout_seconds": 15,
    }

`check_definition` shape (LDAP):
    {
      "ldap_base_dn": "DC=bank,DC=local",
      "ldap_filter": "(&(objectClass=user)(adminCount=1))",
      "ldap_attributes": ["sAMAccountName", "memberOf"],
      "expect": {
        "kind": "result_count_zero" | "result_count_nonzero" |
                "attribute_equals",
        "attribute": "minPwdLength",
        "expected": "14",
      },
    }

`check_definition` shape (Azure):
    {
      "azure_resource_type": "Microsoft.Storage/storageAccounts",
      "azure_property_path": "properties.supportsHttpsTrafficOnly",
      "expect": { "kind": "all_match", "expected": True },
    }

`check_definition` shape (Kubernetes):
    {
      "k8s_api": "/api/v1/namespaces/kube-system/pods",  # GET path
      "k8s_jmespath": "items[?spec.hostNetwork].metadata.name",
      "expect": { "kind": "result_count_zero" },
    }

Same read-only contract as the others — write verbs / mutating
statements rejected upfront by the safety check at the top of each runner.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Optional

from .registry import RunnerResult, register


# ─── Shared SQL safety filter (read-only) ─────────────────────────────────
_SQL_DENY = re.compile(
    r"\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|"
    r"EXEC|EXECUTE|MERGE|REPLACE|RENAME|COMMENT|RESET|RESTORE|BACKUP|"
    r"LOAD|HANDLER|CALL|PREPARE|DEALLOCATE|SET\s+\w+\s*=)\b",
    re.IGNORECASE,
)


def _is_sql_readonly(sql: str) -> tuple[bool, str]:
    if not sql or not sql.strip():
        return False, "empty SQL"
    if _SQL_DENY.search(sql):
        m = _SQL_DENY.search(sql)
        return False, f"SQL rejected by read-only filter (matched {m.group(0)!r})"
    # also block multi-statement attempts
    stripped = sql.strip().rstrip(";").rstrip()
    if ";" in stripped:
        return False, "multi-statement SQL not allowed"
    return True, ""


def _evaluate_sql_row(row, expect: Dict[str, Any], rowcount: int) -> tuple[bool, str]:
    """Apply expect kind against the first row + rowcount."""
    kind = (expect or {}).get("kind", "row_count_nonzero")
    if kind == "row_count_zero":
        return rowcount == 0, f"rowcount={rowcount}"
    if kind == "row_count_nonzero":
        return rowcount > 0, f"rowcount={rowcount}"
    if rowcount == 0:
        return False, "no rows returned"
    first = row[0] if isinstance(row, (list, tuple)) else row
    actual = "" if first is None else str(first)
    if kind == "first_value_equals":
        exp = str(expect.get("expected", ""))
        ok = actual.strip().lower() == exp.strip().lower()
        return ok, f"{actual!r} {'==' if ok else '!='} {exp!r}"
    if kind == "first_value_contains":
        needle = str(expect.get("expected", ""))
        return needle in actual, f"contains {needle!r}: {needle in actual}"
    if kind == "first_value_regex":
        pat = str(expect.get("expected", ""))
        ok = bool(re.search(pat, actual))
        return ok, f"regex {pat!r} → {actual!r}"
    return False, f"unknown expect kind: {kind!r}"


# ─── MSSQL ────────────────────────────────────────────────────────────────
try:
    import pymssql  # type: ignore
    PYMSSQL_AVAILABLE = True
except ImportError:
    PYMSSQL_AVAILABLE = False


@register("mssql_sql")
def run_mssql_check(check_definition: Dict[str, Any], credentials: Dict[str, Any]) -> RunnerResult:
    if not PYMSSQL_AVAILABLE:
        return RunnerResult(
            status="error",
            summary="MSSQL runner needs pymssql: `pip install pymssql` on the backend.",
            error_message="pymssql_not_installed",
        )
    sql = check_definition.get("sql") or check_definition.get("command")
    if not sql:
        return RunnerResult(status="error", summary="Missing 'sql' in check_definition.",
                            error_message="invalid_check_definition")
    safe, reason = _is_sql_readonly(sql)
    if not safe:
        return RunnerResult(status="error", summary=reason, error_message="unsafe_sql")

    host = credentials.get("mssql_host")
    port = int(credentials.get("mssql_port") or 1433)
    user = credentials.get("mssql_username")
    pw = credentials.get("mssql_password")
    db = credentials.get("mssql_database") or "master"
    if not host or not user or not pw:
        return RunnerResult(
            status="error",
            summary="MSSQL credentials missing (need mssql_host, mssql_username, mssql_password).",
            error_message="missing_credentials",
        )

    timeout = int(check_definition.get("timeout_seconds", 15))
    expect = check_definition.get("expect") or {"kind": "row_count_nonzero"}
    pass_msg = check_definition.get("pass_message") or "MSSQL check passed."
    fail_msg = check_definition.get("fail_message") or "MSSQL check failed."

    try:
        conn = pymssql.connect(server=host, port=port, user=user, password=pw,
                               database=db, login_timeout=timeout, timeout=timeout)
        cur = conn.cursor()
        cur.execute(sql)
        rows = cur.fetchall() or []
        rowcount = len(rows)
        first_row = rows[0] if rows else None
        cur.close()
        conn.close()
    except Exception as exc:  # noqa: BLE001
        return RunnerResult(status="error",
                            summary=f"MSSQL execution failed: {exc}",
                            error_message=str(exc))

    ok, detail = _evaluate_sql_row(first_row, expect, rowcount)
    return RunnerResult(
        status="passed" if ok else "failed",
        summary=f"{pass_msg if ok else fail_msg} ({detail})",
        raw_output={"sql": sql, "rowcount": rowcount, "first_row": list(first_row) if first_row else None,
                    "expectation_detail": detail},
    )


# ─── PostgreSQL ───────────────────────────────────────────────────────────
try:
    import psycopg2  # type: ignore
    PSYCOPG2_AVAILABLE = True
except ImportError:
    PSYCOPG2_AVAILABLE = False


@register("postgres_sql")
def run_postgres_check(check_definition: Dict[str, Any], credentials: Dict[str, Any]) -> RunnerResult:
    if not PSYCOPG2_AVAILABLE:
        return RunnerResult(status="error",
                            summary="PostgreSQL runner needs psycopg2: `pip install psycopg2-binary`.",
                            error_message="psycopg2_not_installed")
    sql = check_definition.get("sql") or check_definition.get("command")
    if not sql:
        return RunnerResult(status="error", summary="Missing 'sql' in check_definition.",
                            error_message="invalid_check_definition")
    safe, reason = _is_sql_readonly(sql)
    if not safe:
        return RunnerResult(status="error", summary=reason, error_message="unsafe_sql")

    host = credentials.get("postgres_host")
    port = int(credentials.get("postgres_port") or 5432)
    user = credentials.get("postgres_username")
    pw = credentials.get("postgres_password")
    db = credentials.get("postgres_database") or "postgres"
    if not host or not user or not pw:
        return RunnerResult(status="error",
                            summary="PostgreSQL credentials missing (postgres_host/username/password).",
                            error_message="missing_credentials")

    timeout = int(check_definition.get("timeout_seconds", 15))
    expect = check_definition.get("expect") or {"kind": "row_count_nonzero"}

    try:
        conn = psycopg2.connect(host=host, port=port, user=user, password=pw,
                                dbname=db, connect_timeout=timeout)
        cur = conn.cursor()
        cur.execute(sql)
        rows = cur.fetchall() or []
        rowcount = len(rows)
        first_row = rows[0] if rows else None
        cur.close()
        conn.close()
    except Exception as exc:  # noqa: BLE001
        return RunnerResult(status="error",
                            summary=f"PostgreSQL execution failed: {exc}",
                            error_message=str(exc))

    ok, detail = _evaluate_sql_row(first_row, expect, rowcount)
    pass_msg = check_definition.get("pass_message") or "Postgres check passed."
    fail_msg = check_definition.get("fail_message") or "Postgres check failed."
    return RunnerResult(
        status="passed" if ok else "failed",
        summary=f"{pass_msg if ok else fail_msg} ({detail})",
        raw_output={"sql": sql, "rowcount": rowcount,
                    "first_row": list(first_row) if first_row else None,
                    "expectation_detail": detail},
    )


# ─── MySQL / MariaDB ──────────────────────────────────────────────────────
try:
    import pymysql  # type: ignore
    PYMYSQL_AVAILABLE = True
except ImportError:
    PYMYSQL_AVAILABLE = False


@register("mysql_sql")
def run_mysql_check(check_definition: Dict[str, Any], credentials: Dict[str, Any]) -> RunnerResult:
    if not PYMYSQL_AVAILABLE:
        return RunnerResult(status="error",
                            summary="MySQL runner needs PyMySQL: `pip install pymysql`.",
                            error_message="pymysql_not_installed")
    sql = check_definition.get("sql") or check_definition.get("command")
    if not sql:
        return RunnerResult(status="error", summary="Missing 'sql' in check_definition.",
                            error_message="invalid_check_definition")
    safe, reason = _is_sql_readonly(sql)
    if not safe:
        return RunnerResult(status="error", summary=reason, error_message="unsafe_sql")

    host = credentials.get("mysql_host")
    port = int(credentials.get("mysql_port") or 3306)
    user = credentials.get("mysql_username")
    pw = credentials.get("mysql_password")
    db = credentials.get("mysql_database") or "information_schema"
    if not host or not user or not pw:
        return RunnerResult(status="error",
                            summary="MySQL credentials missing (mysql_host/username/password).",
                            error_message="missing_credentials")

    timeout = int(check_definition.get("timeout_seconds", 15))
    expect = check_definition.get("expect") or {"kind": "row_count_nonzero"}

    try:
        conn = pymysql.connect(host=host, port=port, user=user, password=pw,
                               database=db, connect_timeout=timeout, read_timeout=timeout)
        cur = conn.cursor()
        cur.execute(sql)
        rows = cur.fetchall() or []
        rowcount = len(rows)
        first_row = rows[0] if rows else None
        cur.close()
        conn.close()
    except Exception as exc:  # noqa: BLE001
        return RunnerResult(status="error",
                            summary=f"MySQL execution failed: {exc}",
                            error_message=str(exc))

    ok, detail = _evaluate_sql_row(first_row, expect, rowcount)
    pass_msg = check_definition.get("pass_message") or "MySQL check passed."
    fail_msg = check_definition.get("fail_message") or "MySQL check failed."
    return RunnerResult(
        status="passed" if ok else "failed",
        summary=f"{pass_msg if ok else fail_msg} ({detail})",
        raw_output={"sql": sql, "rowcount": rowcount,
                    "first_row": list(first_row) if first_row else None,
                    "expectation_detail": detail},
    )


# ─── Active Directory / LDAP ──────────────────────────────────────────────
try:
    import ldap3  # type: ignore
    LDAP3_AVAILABLE = True
except ImportError:
    LDAP3_AVAILABLE = False


@register("ldap_query")
def run_ldap_check(check_definition: Dict[str, Any], credentials: Dict[str, Any]) -> RunnerResult:
    if not LDAP3_AVAILABLE:
        return RunnerResult(status="error",
                            summary="LDAP runner needs ldap3: `pip install ldap3`.",
                            error_message="ldap3_not_installed")
    base_dn = check_definition.get("ldap_base_dn")
    ldap_filter = check_definition.get("ldap_filter")
    attrs = check_definition.get("ldap_attributes") or []
    if not base_dn or not ldap_filter:
        return RunnerResult(status="error",
                            summary="Missing ldap_base_dn or ldap_filter.",
                            error_message="invalid_check_definition")

    host = credentials.get("ldap_host")
    port = int(credentials.get("ldap_port") or 389)
    user = credentials.get("ldap_bind_dn") or credentials.get("ldap_username")
    pw = credentials.get("ldap_password")
    use_ssl = bool(credentials.get("ldap_use_ssl", port == 636))
    if not host or not user or not pw:
        return RunnerResult(status="error",
                            summary="LDAP credentials missing (ldap_host/bind_dn/password).",
                            error_message="missing_credentials")

    expect = check_definition.get("expect") or {"kind": "result_count_zero"}
    pass_msg = check_definition.get("pass_message") or "AD/LDAP check passed."
    fail_msg = check_definition.get("fail_message") or "AD/LDAP check failed."

    try:
        server = ldap3.Server(host, port=port, use_ssl=use_ssl, get_info=ldap3.NONE)
        conn = ldap3.Connection(server, user=user, password=pw, auto_bind=True,
                                receive_timeout=int(check_definition.get("timeout_seconds", 15)))
        conn.search(base_dn, ldap_filter, attributes=attrs or ldap3.ALL_ATTRIBUTES)
        entries = list(conn.entries)
        conn.unbind()
    except Exception as exc:  # noqa: BLE001
        return RunnerResult(status="error",
                            summary=f"LDAP query failed: {exc}",
                            error_message=str(exc))

    kind = expect.get("kind", "result_count_zero")
    count = len(entries)
    if kind == "result_count_zero":
        ok, detail = count == 0, f"entries={count}"
    elif kind == "result_count_nonzero":
        ok, detail = count > 0, f"entries={count}"
    elif kind == "attribute_equals":
        attr = expect.get("attribute")
        exp = str(expect.get("expected", ""))
        if not entries or not attr:
            ok, detail = False, f"no entries or no attribute"
        else:
            actual = str(getattr(entries[0], attr, "")).strip()
            ok = actual.lower() == exp.lower()
            detail = f"{attr}={actual!r} (expected {exp!r})"
    else:
        ok, detail = False, f"unknown expect kind: {kind!r}"

    return RunnerResult(
        status="passed" if ok else "failed",
        summary=f"{pass_msg if ok else fail_msg} ({detail})",
        raw_output={"base_dn": base_dn, "filter": ldap_filter, "count": count,
                    "expectation_detail": detail,
                    "sample_entries": [str(e) for e in entries[:5]]},
    )


# ─── Azure (read-only via azure-mgmt-resource + azure-identity) ───────────
try:
    from azure.identity import ClientSecretCredential  # type: ignore
    from azure.mgmt.resource import ResourceManagementClient  # type: ignore
    AZURE_AVAILABLE = True
except ImportError:
    AZURE_AVAILABLE = False


@register("azure_readonly")
def run_azure_check(check_definition: Dict[str, Any], credentials: Dict[str, Any]) -> RunnerResult:
    if not AZURE_AVAILABLE:
        return RunnerResult(status="error",
                            summary="Azure runner needs `pip install azure-identity azure-mgmt-resource`.",
                            error_message="azure_libs_not_installed")
    sub_id = credentials.get("azure_subscription_id")
    tenant_id = credentials.get("azure_tenant_id")
    client_id = credentials.get("azure_client_id")
    client_secret = credentials.get("azure_client_secret")
    if not all([sub_id, tenant_id, client_id, client_secret]):
        return RunnerResult(status="error",
                            summary="Azure credentials missing (subscription_id, tenant_id, client_id, client_secret).",
                            error_message="missing_credentials")

    resource_type = check_definition.get("azure_resource_type")
    if not resource_type:
        return RunnerResult(status="error",
                            summary="Missing azure_resource_type (e.g. 'Microsoft.Storage/storageAccounts').",
                            error_message="invalid_check_definition")

    try:
        cred = ClientSecretCredential(tenant_id=tenant_id, client_id=client_id,
                                       client_secret=client_secret)
        rm = ResourceManagementClient(cred, sub_id)
        resources = list(rm.resources.list(filter=f"resourceType eq '{resource_type}'"))
    except Exception as exc:  # noqa: BLE001
        return RunnerResult(status="error",
                            summary=f"Azure call failed: {exc}",
                            error_message=str(exc))

    expect = check_definition.get("expect") or {"kind": "result_count_zero"}
    count = len(resources)
    if expect["kind"] == "result_count_zero":
        ok, detail = count == 0, f"resources_found={count}"
    elif expect["kind"] == "result_count_nonzero":
        ok, detail = count > 0, f"resources_found={count}"
    else:
        ok, detail = False, f"unknown expect kind: {expect['kind']!r}"

    return RunnerResult(
        status="passed" if ok else "failed",
        summary=f"Azure {resource_type}: {count} found ({detail})",
        raw_output={"resource_type": resource_type, "count": count,
                    "sample": [str(r.id) for r in resources[:5]]},
    )


# ─── Kubernetes (read-only via the kubernetes client) ─────────────────────
try:
    from kubernetes import client as k8s_client, config as k8s_config  # type: ignore
    K8S_AVAILABLE = True
except ImportError:
    K8S_AVAILABLE = False


@register("k8s_api")
def run_k8s_check(check_definition: Dict[str, Any], credentials: Dict[str, Any]) -> RunnerResult:
    if not K8S_AVAILABLE:
        return RunnerResult(status="error",
                            summary="K8s runner needs `pip install kubernetes`.",
                            error_message="kubernetes_not_installed")

    kubeconfig_text = credentials.get("kubeconfig")
    server = credentials.get("k8s_server")
    token = credentials.get("k8s_token")
    ca_cert = credentials.get("k8s_ca_cert")

    if not kubeconfig_text and not (server and token):
        return RunnerResult(status="error",
                            summary=("K8s credentials missing — provide either 'kubeconfig' (YAML) "
                                     "OR 'k8s_server' + 'k8s_token'."),
                            error_message="missing_credentials")

    try:
        cfg = k8s_client.Configuration()
        if kubeconfig_text:
            import yaml, tempfile, os as _os
            with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as tf:
                tf.write(kubeconfig_text)
                kpath = tf.name
            try:
                k8s_config.load_kube_config(config_file=kpath, client_configuration=cfg)
            finally:
                try:
                    _os.unlink(kpath)
                except Exception:
                    pass
        else:
            cfg.host = server
            cfg.api_key = {"authorization": f"Bearer {token}"}
            if ca_cert:
                import tempfile
                with tempfile.NamedTemporaryFile("w", suffix=".crt", delete=False) as cf:
                    cf.write(ca_cert)
                    cfg.ssl_ca_cert = cf.name
            else:
                cfg.verify_ssl = False
        api_client = k8s_client.ApiClient(cfg)
    except Exception as exc:  # noqa: BLE001
        return RunnerResult(status="error",
                            summary=f"K8s client setup failed: {exc}",
                            error_message=str(exc))

    api_path = check_definition.get("k8s_api")
    if not api_path:
        return RunnerResult(status="error",
                            summary="Missing k8s_api (e.g. '/api/v1/namespaces/kube-system/pods').",
                            error_message="invalid_check_definition")

    try:
        resp = api_client.call_api(api_path, "GET", response_type="object",
                                   _return_http_data_only=True, _preload_content=True)
    except Exception as exc:  # noqa: BLE001
        return RunnerResult(status="error",
                            summary=f"K8s GET failed: {exc}",
                            error_message=str(exc))

    items = (resp or {}).get("items", []) if isinstance(resp, dict) else []
    expect = check_definition.get("expect") or {"kind": "result_count_nonzero"}
    count = len(items)
    if expect["kind"] == "result_count_zero":
        ok, detail = count == 0, f"items={count}"
    elif expect["kind"] == "result_count_nonzero":
        ok, detail = count > 0, f"items={count}"
    else:
        ok, detail = False, f"unknown expect kind: {expect['kind']!r}"

    pass_msg = check_definition.get("pass_message") or "K8s check passed."
    fail_msg = check_definition.get("fail_message") or "K8s check failed."
    return RunnerResult(
        status="passed" if ok else "failed",
        summary=f"{pass_msg if ok else fail_msg} ({detail})",
        raw_output={"api_path": api_path, "count": count,
                    "expectation_detail": detail},
    )
