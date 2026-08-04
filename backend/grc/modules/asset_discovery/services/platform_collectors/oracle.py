"""Oracle Database deep inventory collector.

Registers `oracle_sql`. Returns flat instance identity plus status-wrapped
SECTIONS (instance, storage, objects, security, runtime, high_availability).
Many v$ / dba_ views require DBA privilege; where the privileged view is denied
the section falls back to the all_* equivalent, and a genuinely denied query is
captured as permission_denied (ORA-00942 / ORA-01031) instead of aborting.

Reuses the legacy connection setup + credential-key names exactly
(oracle_host/port/username/password/service_name/sid).
"""
from __future__ import annotations

from typing import Any, Dict

from . import register, safe_cursor, collect_section

_ROW_CAP = 500


@register("oracle_sql")
def collect_oracle(creds: Dict[str, Any]) -> Dict[str, Any]:
    """Inventory an Oracle instance over a read-only connection."""
    try:
        import oracledb  # type: ignore
    except ImportError:
        raise RuntimeError("oracledb not installed on this server")

    host = creds.get("oracle_host")
    port = int(creds.get("oracle_port") or 1521)
    user = creds.get("oracle_username")
    pw = creds.get("oracle_password")
    service = creds.get("oracle_service_name")
    sid = creds.get("oracle_sid")
    if not host or not user or not (service or sid):
        raise RuntimeError("Oracle host, username, and service_name/sid are required")

    dsn = (
        oracledb.makedsn(host, port, service_name=service)
        if service else oracledb.makedsn(host, port, sid=sid)
    )
    conn = oracledb.connect(user=user, password=pw, dsn=dsn)
    props: Dict[str, Any] = {
        "engine": "Oracle Database", "host": host, "port": port,
        "service_name": service, "sid": sid,
    }
    try:
        cur = conn.cursor()
        _safe = safe_cursor(cur, conn)

        def _q(sql: str):
            cur.execute(sql)
            return cur.fetchall()

        # ── flat version scalar ────────────────────────────────────────────
        v = _safe("SELECT banner FROM v$version WHERE ROWNUM = 1")
        if v:
            props["version"] = str(v[0][0])

        # ── instance (v$instance + v$database identity) ───────────────────
        def _instance():
            out: Dict[str, Any] = {}
            inst = _q(
                "SELECT instance_name, host_name, version, status, startup_time "
                "FROM v$instance"
            )
            if inst:
                r = inst[0]
                out.update({
                    "instance_name": r[0], "host_name": r[1], "version": r[2],
                    "status": r[3],
                    "startup_time": str(r[4]) if r[4] is not None else None,
                })
            dbr = _q(
                "SELECT name, db_unique_name, database_role, open_mode, log_mode "
                "FROM v$database"
            )
            if dbr:
                r = dbr[0]
                out.update({
                    "name": r[0], "db_unique_name": r[1], "database_role": r[2],
                    "open_mode": r[3], "log_mode": r[4],
                })
            return out
        props["instance"] = collect_section(_instance)

        # ── storage: tablespaces + datafiles, tempfiles, redo, control ────
        def _storage():
            out: Dict[str, Any] = {}
            ts = _q(
                "SELECT t.tablespace_name, t.status, "
                "       ROUND(NVL(f.bytes,0)/1024/1024, 2), f.autoextensible "
                "FROM dba_tablespaces t "
                "LEFT JOIN (SELECT tablespace_name, SUM(bytes) bytes, "
                "                  MAX(autoextensible) autoextensible "
                "           FROM dba_data_files GROUP BY tablespace_name) f "
                "  ON f.tablespace_name = t.tablespace_name "
                "ORDER BY t.tablespace_name"
            )
            out["tablespaces"] = [
                {
                    "name": r[0], "status": r[1],
                    "size_mb": float(r[2]) if r[2] is not None else None,
                    "autoextensible": r[3],
                }
                for r in ts[:_ROW_CAP]
            ]
            redo = _q("SELECT group#, status, ROUND(bytes/1024/1024, 2), members "
                      "FROM v$log ORDER BY group#")
            out["redo_logs"] = [
                {"group": r[0], "status": r[1],
                 "size_mb": float(r[2]) if r[2] is not None else None,
                 "members": r[3]}
                for r in redo[:_ROW_CAP]
            ]
            ctl = _q("SELECT name FROM v$controlfile")
            out["control_files"] = [r[0] for r in ctl[:_ROW_CAP]]
            return out
        props["storage"] = collect_section(_storage)

        # ── object counts by type (dba_objects, fall back to all_objects) ─
        def _objects():
            try:
                rows = _q("SELECT object_type, COUNT(*) FROM dba_objects "
                          "GROUP BY object_type ORDER BY object_type")
                scope = "dba"
            except Exception:  # noqa: BLE001 — no DBA priv on dba_objects
                rows = _q("SELECT object_type, COUNT(*) FROM all_objects "
                          "GROUP BY object_type ORDER BY object_type")
                scope = "all"
            return {
                "scope": scope,
                "counts": {r[0]: int(r[1]) for r in rows},
            }
        props["objects"] = collect_section(_objects)

        # ── security: users + roles ────────────────────────────────────────
        def _security():
            users = _q(
                "SELECT username, account_status, default_tablespace, created "
                "FROM dba_users ORDER BY username"
            )
            roles = _q("SELECT role FROM dba_roles ORDER BY role")
            return {
                "users": [
                    {
                        "username": r[0], "account_status": r[1],
                        "default_tablespace": r[2],
                        "created": str(r[3]) if r[3] is not None else None,
                    }
                    for r in users[:_ROW_CAP]
                ],
                "user_count": len(users),
                "roles": [r[0] for r in roles[:_ROW_CAP]],
            }
        props["security"] = collect_section(_security)

        # ── runtime: sessions + processes ──────────────────────────────────
        def _runtime():
            sess = _q("SELECT COUNT(*) FROM v$session")
            proc = _q("SELECT COUNT(*) FROM v$process")
            return {
                "sessions": int(sess[0][0]) if sess else None,
                "processes": int(proc[0][0]) if proc else None,
            }
        props["runtime"] = collect_section(_runtime)

        # ── high availability: Data Guard role + archive destinations ─────
        def _high_availability():
            role = _q("SELECT database_role, protection_mode FROM v$database")
            dests = _q(
                "SELECT dest_name, status, database_mode, recovery_mode "
                "FROM v$archive_dest_status "
                "WHERE status <> 'INACTIVE' AND ROWNUM <= 20"
            )
            return {
                "database_role": role[0][0] if role else None,
                "protection_mode": role[0][1] if role else None,
                "archive_destinations": [
                    {"dest_name": r[0], "status": r[1],
                     "database_mode": r[2], "recovery_mode": r[3]}
                    for r in dests[:_ROW_CAP]
                ],
            }
        props["high_availability"] = collect_section(_high_availability)

        return props
    finally:
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass
