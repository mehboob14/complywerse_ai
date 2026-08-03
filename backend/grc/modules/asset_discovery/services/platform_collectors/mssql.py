"""Microsoft SQL Server deep inventory collector.

Registers `mssql_sql`. Returns flat instance identity plus status-wrapped
SECTIONS (databases, files, objects, security, additional) and the legacy
sys.configurations settings. Many server-wide catalogs (msdb jobs, per-db
object counts) are commonly denied to a low-privilege login — those are captured
as permission_denied rather than aborting the collect.

Reuses the legacy connection setup + credential-key names exactly
(mssql_host/port/username/password/database).
"""
from __future__ import annotations

from typing import Any, Dict

from . import register, safe_cursor, collect_section

_ROW_CAP = 500


@register("mssql_sql")
def collect_mssql(creds: Dict[str, Any]) -> Dict[str, Any]:
    """Inventory a SQL Server instance over a read-only connection."""
    try:
        import pymssql  # type: ignore
    except ImportError:
        raise RuntimeError("pymssql not installed on this server")

    host = creds.get("mssql_host")
    port = int(creds.get("mssql_port") or 1433)
    user = creds.get("mssql_username")
    pw = creds.get("mssql_password")
    db = creds.get("mssql_database") or "master"
    if not host or not user:
        raise RuntimeError("MSSQL host and username are required")

    conn = pymssql.connect(
        server=host, port=str(port), user=user, password=pw, database=db,
        login_timeout=int(creds.get("timeout") or 10),
    )
    props: Dict[str, Any] = {"engine": "Microsoft SQL Server", "host": host, "port": port}
    try:
        cur = conn.cursor()
        _safe = safe_cursor(cur, conn)

        def _q(sql: str):
            cur.execute(sql)
            return cur.fetchall()

        # ── instance identity scalars ──────────────────────────────────────
        e = _safe(
            "SELECT CAST(SERVERPROPERTY('Edition') AS VARCHAR(200)), "
            "CAST(SERVERPROPERTY('ProductVersion') AS VARCHAR(50)), "
            "CAST(SERVERPROPERTY('ProductLevel') AS VARCHAR(50)), "
            "CAST(@@SERVERNAME AS VARCHAR(200))"
        )
        if e:
            props["edition"] = e[0][0]
            props["version"] = e[0][1]
            props["product_level"] = e[0][2]
            props["server_name"] = e[0][3]

        # ── instance detail section (SQL Agent state if readable) ──────────
        def _instance():
            agent = None
            try:
                rows = _q(
                    "SELECT CAST(SERVERPROPERTY('IsHadrEnabled') AS INT), "
                    "CAST(SERVERPROPERTY('MachineName') AS VARCHAR(200)), "
                    "CAST(SERVERPROPERTY('InstanceName') AS VARCHAR(200))"
                )
                hadr, machine, inst = rows[0]
            except Exception:  # noqa: BLE001
                hadr = machine = inst = None
            try:
                arows = _q(
                    "SELECT status_desc FROM sys.dm_server_services "
                    "WHERE servicename LIKE 'SQL Server Agent%'"
                )
                agent = arows[0][0] if arows else None
            except Exception:  # noqa: BLE001
                agent = None
            return {
                "hadr_enabled": bool(hadr) if hadr is not None else None,
                "machine_name": machine, "instance_name": inst,
                "sql_agent_status": agent,
            }
        props["instance"] = collect_section(_instance)

        # ── databases ──────────────────────────────────────────────────────
        def _databases():
            rows = _q(
                "SELECT d.name, d.database_id, d.state_desc, "
                "       d.compatibility_level, d.recovery_model_desc, "
                "       d.create_date, suser_sname(d.owner_sid), "
                "       (SELECT CAST(SUM(mf.size) * 8.0 / 1024 AS DECIMAL(18,2)) "
                "        FROM sys.master_files mf WHERE mf.database_id = d.database_id) "
                "FROM sys.databases d ORDER BY d.name"
            )
            return [
                {
                    "name": r[0], "database_id": r[1], "state_desc": r[2],
                    "compatibility_level": r[3], "recovery_model_desc": r[4],
                    "create_date": str(r[5]) if r[5] is not None else None,
                    "owner": r[6],
                    "size_mb": float(r[7]) if r[7] is not None else None,
                }
                for r in rows[:_ROW_CAP]
            ]
        props["databases"] = collect_section(_databases)

        # ── physical files ─────────────────────────────────────────────────
        def _files():
            rows = _q(
                "SELECT DB_NAME(mf.database_id), mf.type_desc, mf.physical_name, "
                "       CAST(mf.size * 8.0 / 1024 AS DECIMAL(18,2)) "
                "FROM sys.master_files mf "
                "ORDER BY mf.database_id, mf.type_desc"
            )
            return [
                {
                    "database": r[0], "type_desc": r[1], "physical_name": r[2],
                    "size_mb": float(r[3]) if r[3] is not None else None,
                }
                for r in rows[:_ROW_CAP]
            ]
        props["files"] = collect_section(_files)

        # ── object counts (current db; per-db often blocked) ───────────────
        def _objects():
            def _one(sql: str) -> int:
                return int(_q(sql)[0][0])
            return {
                "tables": _one("SELECT count(*) FROM sys.objects WHERE type = 'U'"),
                "views": _one("SELECT count(*) FROM sys.objects WHERE type = 'V'"),
                "procedures": _one("SELECT count(*) FROM sys.objects WHERE type = 'P'"),
                "functions": _one("SELECT count(*) FROM sys.objects "
                                  "WHERE type IN ('FN','IF','TF')"),
                "triggers": _one("SELECT count(*) FROM sys.objects "
                                 "WHERE type IN ('TR','TA')"),
                "indexes": _one("SELECT count(*) FROM sys.indexes WHERE index_id > 0"),
            }
        props["objects"] = collect_section(_objects)

        # ── security: logins + server roles ────────────────────────────────
        def _security():
            logins = _q(
                "SELECT sp.name, sp.is_disabled, sp.type_desc "
                "FROM sys.server_principals sp "
                "WHERE sp.type IN ('S','U','G') ORDER BY sp.name"
            )
            roles = _q(
                "SELECT name FROM sys.server_principals "
                "WHERE type = 'R' ORDER BY name"
            )
            return {
                "logins": [
                    {"name": r[0], "is_disabled": bool(r[1]), "type_desc": r[2]}
                    for r in logins[:_ROW_CAP]
                ],
                "server_roles": [r[0] for r in roles[:_ROW_CAP]],
            }
        props["security"] = collect_section(_security)

        # ── additional: agent jobs, linked servers, availability groups ───
        def _additional():
            jobs = None
            try:
                jrows = _q("SELECT name, enabled FROM msdb.dbo.sysjobs ORDER BY name")
                jobs = [{"name": r[0], "enabled": bool(r[1])} for r in jrows[:_ROW_CAP]]
            except Exception:  # noqa: BLE001 — msdb commonly denied
                jobs = None
            linked = None
            try:
                lrows = _q("SELECT name, product, data_source FROM sys.servers "
                           "WHERE is_linked = 1 ORDER BY name")
                linked = [
                    {"name": r[0], "product": r[1], "data_source": r[2]}
                    for r in lrows[:_ROW_CAP]
                ]
            except Exception:  # noqa: BLE001
                linked = None
            ags = None
            try:
                arows = _q("SELECT name FROM sys.availability_groups ORDER BY name")
                ags = [r[0] for r in arows[:_ROW_CAP]]
            except Exception:  # noqa: BLE001
                ags = None
            return {
                "sql_agent_jobs": jobs,
                "linked_servers": linked,
                "availability_groups": ags,
            }
        props["additional"] = collect_section(_additional)

        # ── security-relevant configurations ───────────────────────────────
        def _settings():
            rows = _q(
                "SELECT name, CAST(value_in_use AS VARCHAR(50)) "
                "FROM sys.configurations "
                "WHERE name IN ('remote access','xp_cmdshell','clr enabled',"
                "'contained database authentication','cross db ownership chaining',"
                "'Ole Automation Procedures') ORDER BY name"
            )
            return {r[0]: r[1] for r in rows}
        props["settings"] = collect_section(_settings)

        return props
    finally:
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass
