"""MySQL / MariaDB deep inventory collector.

Registers `mysql_sql`. Distinguishes the actual engine (MySQL vs MariaDB) from
the version string / @@version_comment instead of hard-coding "MySQL / MariaDB",
and returns status-wrapped SECTIONS (databases, objects, storage_engines, users,
replication) plus the legacy plugins + security vars.

Reuses the legacy connection setup + credential-key names exactly
(mysql_host/port/username/password/database).
"""
from __future__ import annotations

from typing import Any, Dict

from . import register, safe_cursor, collect_section

_ROW_CAP = 500


@register("mysql_sql")
def collect_mysql(creds: Dict[str, Any]) -> Dict[str, Any]:
    """Inventory a MySQL or MariaDB instance over a read-only connection."""
    try:
        import pymysql  # type: ignore
    except ImportError:
        raise RuntimeError("pymysql not installed on this server")

    host = creds.get("mysql_host")
    port = int(creds.get("mysql_port") or 3306)
    user = creds.get("mysql_username")
    pw = creds.get("mysql_password")
    db = creds.get("mysql_database") or "information_schema"
    if not host or not user:
        raise RuntimeError("MySQL host and username are required")

    conn = pymysql.connect(
        host=host, port=port, user=user, password=pw, database=db,
        connect_timeout=int(creds.get("timeout") or 10),
    )
    props: Dict[str, Any] = {"host": host, "port": port}
    try:
        cur = conn.cursor()
        _safe = safe_cursor(cur, conn)

        def _q(sql: str, args=None):
            # Only pass params when there are some — the DB-API driver does
            # %-substitution whenever a params arg is supplied (even ()), which
            # breaks any SQL containing a literal %.
            if args:
                cur.execute(sql, args)
            else:
                cur.execute(sql)
            return cur.fetchall()

        # ── engine distinction + identity scalars ──────────────────────────
        v = _safe("SELECT VERSION()")
        version = str(v[0][0]) if v else ""
        props["version"] = version or None
        comment = _safe("SELECT @@version_comment")
        comment_str = str(comment[0][0]) if comment else ""
        is_maria = "mariadb" in (version + " " + comment_str).lower()
        props["engine"] = "MariaDB" if is_maria else "MySQL"

        for var, key in (
            ("server_id", "server_id"),
            ("version_compile_os", "version_compile_os"),
        ):
            row = _safe(f"SELECT @@{var}")
            if row:
                props[key] = row[0][0]
        upt = _safe("SHOW GLOBAL STATUS LIKE 'Uptime'")
        if upt:
            try:
                props["uptime_seconds"] = int(upt[0][1])
            except (ValueError, TypeError, IndexError):
                pass

        # ── databases (charset, collation, size) ───────────────────────────
        def _databases():
            rows = _q(
                "SELECT s.schema_name, s.default_character_set_name, "
                "       s.default_collation_name, "
                "       COALESCE(t.total_bytes, 0) "
                "FROM information_schema.schemata s "
                "LEFT JOIN ("
                "  SELECT table_schema, "
                "         SUM(data_length + index_length) AS total_bytes "
                "  FROM information_schema.tables GROUP BY table_schema"
                ") t ON t.table_schema = s.schema_name "
                "ORDER BY s.schema_name"
            )
            return [
                {
                    "name": r[0], "charset": r[1], "collation": r[2],
                    "size_bytes": int(r[3]) if r[3] is not None else None,
                }
                for r in rows[:_ROW_CAP]
            ]
        props["databases"] = collect_section(_databases)

        # ── object counts ──────────────────────────────────────────────────
        def _objects():
            def _one(sql: str) -> int:
                return int(_q(sql)[0][0])
            return {
                "tables": _one("SELECT count(*) FROM information_schema.tables "
                               "WHERE table_type = 'BASE TABLE'"),
                "views": _one("SELECT count(*) FROM information_schema.views"),
                "procedures": _one("SELECT count(*) FROM information_schema.routines "
                                   "WHERE routine_type = 'PROCEDURE'"),
                "functions": _one("SELECT count(*) FROM information_schema.routines "
                                  "WHERE routine_type = 'FUNCTION'"),
                "triggers": _one("SELECT count(*) FROM information_schema.triggers"),
                "events": _one("SELECT count(*) FROM information_schema.events"),
                "indexes": _one("SELECT count(DISTINCT table_schema, table_name, index_name) "
                                "FROM information_schema.statistics"),
            }
        props["objects"] = collect_section(_objects)

        # ── storage engines ────────────────────────────────────────────────
        def _storage_engines():
            rows = _q("SHOW ENGINES")
            return [{"name": r[0], "support": r[1]} for r in rows[:_ROW_CAP]]
        props["storage_engines"] = collect_section(_storage_engines)

        # ── users (mysql.user often denied) ────────────────────────────────
        def _users():
            rows = _q("SELECT user, host FROM mysql.user ORDER BY user, host")
            users = [{"user": r[0], "host": r[1]} for r in rows[:_ROW_CAP]]
            return {"count": len(rows), "users": users}
        props["users"] = collect_section(_users)

        # ── replication (replica-side status; denied/empty captured) ───────
        def _replication():
            try:
                rows = _q("SHOW REPLICA STATUS")
                cols = [d[0] for d in cur.description] if cur.description else []
            except Exception:  # noqa: BLE001 — older servers use SLAVE
                rows = _q("SHOW SLAVE STATUS")
                cols = [d[0] for d in cur.description] if cur.description else []
            if not rows:
                return {"role": "primary", "replicas": []}
            colmap = {c.lower(): i for i, c in enumerate(cols)}

            def _get(row, *names):
                for n in names:
                    i = colmap.get(n.lower())
                    if i is not None:
                        return row[i]
                return None
            out = []
            for r in rows[:_ROW_CAP]:
                out.append({
                    "source_host": _get(r, "Source_Host", "Master_Host"),
                    "io_running": _get(r, "Replica_IO_Running", "Slave_IO_Running"),
                    "sql_running": _get(r, "Replica_SQL_Running", "Slave_SQL_Running"),
                    "seconds_behind": _get(r, "Seconds_Behind_Source",
                                           "Seconds_Behind_Master"),
                })
            return {"role": "replica", "replicas": out}
        props["replication"] = collect_section(_replication)

        # ── active plugins ─────────────────────────────────────────────────
        def _plugins():
            rows = _q(
                "SELECT plugin_name FROM information_schema.plugins "
                "WHERE plugin_status = 'ACTIVE' ORDER BY plugin_name"
            )
            return [r[0] for r in rows[:_ROW_CAP]]
        props["plugins"] = collect_section(_plugins)

        # ── security-relevant settings + ssl flag ──────────────────────────
        def _settings():
            rows = _q(
                "SHOW VARIABLES WHERE Variable_name IN "
                "('have_ssl','require_secure_transport','local_infile',"
                "'max_connections','version_compile_os','secure_file_priv')"
            )
            return {r[0]: r[1] for r in rows}
        props["settings"] = collect_section(_settings)

        _s = props["settings"].get("data") if isinstance(props["settings"], dict) else None
        if isinstance(_s, dict):
            props["ssl_enabled"] = (_s.get("have_ssl") == "YES")

        return props
    finally:
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass
