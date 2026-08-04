"""PostgreSQL deep inventory collector.

Registers `postgres_sql` and returns the database's OWN component model: flat
identity scalars (engine, version, host, port) plus status-wrapped SECTIONS of
deep inventory (databases, schemas, objects, roles, replication, foreign data
wrappers) so a permission-denied query is badged, not silently empty, and never
aborts the collect.

Reuses the legacy connection setup + credential-key names exactly
(postgres_host/port/username/password/database).
"""
from __future__ import annotations

from typing import Any, Dict

from . import register, safe_cursor, collect_section

# Security-relevant settings surfaced on the detail card (CIS Postgres themes:
# transport encryption, exposure, auth strength, logging).
_PG_SETTINGS = (
    "server_version", "ssl", "listen_addresses", "port",
    "password_encryption", "log_connections", "log_disconnections",
    "logging_collector", "max_connections", "shared_buffers",
)

# Cap on rows returned for per-object listings; larger sets keep only counts.
_ROW_CAP = 500


@register("postgres_sql")
def collect_postgres(creds: Dict[str, Any]) -> Dict[str, Any]:
    """Inventory a PostgreSQL instance over a read-only connection."""
    try:
        import psycopg2  # type: ignore
    except ImportError:
        raise RuntimeError("psycopg2 not installed on this server")

    host = creds.get("postgres_host")
    port = int(creds.get("postgres_port") or 5432)
    user = creds.get("postgres_username")
    pw = creds.get("postgres_password")
    db = creds.get("postgres_database") or "postgres"
    if not host or not user:
        raise RuntimeError("PostgreSQL host and username are required")

    conn = psycopg2.connect(
        host=host, port=port, user=user, password=pw, dbname=db,
        connect_timeout=int(creds.get("timeout") or 10),
    )
    props: Dict[str, Any] = {"engine": "PostgreSQL", "host": host, "port": port}
    try:
        conn.set_session(readonly=True, autocommit=True)
        cur = conn.cursor()
        _safe = safe_cursor(cur, conn)

        # ── flat identity scalars ──────────────────────────────────────────
        ver = _safe("SHOW server_version")
        if ver:
            props["version"] = str(ver[0][0])
        cur_db = _safe("SELECT current_database()")
        if cur_db:
            props["connected_database"] = cur_db[0][0]

        # A section that raises inside its lambda is classified + wrapped, so
        # the query must actually raise on denial — use a cursor that re-raises.
        def _q(sql: str, args=None):
            # Only pass params when there actually are some: psycopg2 does
            # %-substitution whenever a params argument is supplied — even () —
            # which breaks any SQL with a literal % (e.g. LIKE 'pg\_%') with
            # "tuple index out of range". No params → execute without them.
            if args:
                cur.execute(sql, args)
            else:
                cur.execute(sql)
            return cur.fetchall()

        # ── databases ──────────────────────────────────────────────────────
        def _databases():
            rows = _q(
                "SELECT d.datname, pg_catalog.pg_get_userbyid(d.datdba), "
                "       pg_database_size(d.datname), pg_encoding_to_char(d.encoding), "
                "       d.datcollate, d.datconnlimit "
                "FROM pg_database d "
                "WHERE d.datistemplate = false "
                "ORDER BY d.datname"
            )
            return [
                {
                    "name": r[0], "owner": r[1], "size_bytes": int(r[2]) if r[2] is not None else None,
                    "encoding": r[3], "collation": r[4],
                    "connection_limit": r[5],
                }
                for r in rows[:_ROW_CAP]
            ]
        props["databases"] = collect_section(_databases)

        # ── schemas (exclude system schemas) ───────────────────────────────
        def _schemas():
            rows = _q(
                "SELECT n.nspname, pg_catalog.pg_get_userbyid(n.nspowner) "
                "FROM pg_namespace n "
                "WHERE n.nspname NOT LIKE 'pg\\_%' "
                "  AND n.nspname <> 'information_schema' "
                "ORDER BY n.nspname"
            )
            return [{"schema": r[0], "owner": r[1]} for r in rows[:_ROW_CAP]]
        props["schemas"] = collect_section(_schemas)

        # ── object counts ──────────────────────────────────────────────────
        def _objects():
            def _one(sql: str) -> int:
                return int(_q(sql)[0][0])
            return {
                "tables": _one("SELECT count(*) FROM pg_class WHERE relkind = 'r' "
                               "AND relnamespace NOT IN "
                               "(SELECT oid FROM pg_namespace WHERE nspname LIKE 'pg\\_%' "
                               " OR nspname = 'information_schema')"),
                "views": _one("SELECT count(*) FROM pg_class WHERE relkind = 'v' "
                              "AND relnamespace NOT IN "
                              "(SELECT oid FROM pg_namespace WHERE nspname LIKE 'pg\\_%' "
                              " OR nspname = 'information_schema')"),
                "materialized_views": _one("SELECT count(*) FROM pg_class WHERE relkind = 'm'"),
                "sequences": _one("SELECT count(*) FROM pg_class WHERE relkind = 'S'"),
                "indexes": _one("SELECT count(*) FROM pg_class WHERE relkind = 'i'"),
                "functions": _one("SELECT count(*) FROM pg_proc WHERE prokind = 'f'"),
                "procedures": _one("SELECT count(*) FROM pg_proc WHERE prokind = 'p'"),
            }
        props["objects"] = collect_section(_objects)

        # ── roles (login/privilege attributes + memberships) ───────────────
        def _roles():
            rows = _q(
                "SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolcreatedb, "
                "       r.rolcreaterole, r.rolreplication, "
                "       ARRAY(SELECT g.rolname FROM pg_auth_members m "
                "             JOIN pg_roles g ON g.oid = m.roleid "
                "             WHERE m.member = r.oid) "
                "FROM pg_roles r ORDER BY r.rolname"
            )
            return [
                {
                    "name": r[0], "login": bool(r[1]), "superuser": bool(r[2]),
                    "createdb": bool(r[3]), "createrole": bool(r[4]),
                    "replication": bool(r[5]),
                    "member_of": list(r[6] or []),
                }
                for r in rows[:_ROW_CAP]
            ]
        props["roles"] = collect_section(_roles)

        # ── replication ────────────────────────────────────────────────────
        # A standalone server has no connected replicas, so pg_stat_replication
        # is empty and the section reads blank. To stay informative even for a
        # single-node install we also report the replication *configuration*
        # (wal_level / senders / slots — all readable by any role) and a derived
        # role, so the card always says something concrete.
        def _replication():
            in_recovery = bool(_q("SELECT pg_is_in_recovery()")[0][0])
            settings = {
                row[0]: row[1]
                for row in _q(
                    "SELECT name, setting FROM pg_settings "
                    "WHERE name IN ('wal_level','max_wal_senders','max_replication_slots',"
                    "'synchronous_commit','hot_standby','archive_mode')"
                )
            }
            replicas = _q(
                "SELECT client_addr, state, sync_state, "
                "       write_lag, replay_lag "
                "FROM pg_stat_replication"
            )
            try:
                slots = _q(
                    "SELECT slot_name, slot_type, active FROM pg_replication_slots"
                )
            except Exception:
                slots = []
            replica_rows = [
                {
                    "client_addr": str(r[0]) if r[0] is not None else None,
                    "state": r[1], "sync_state": r[2],
                    "write_lag": str(r[3]) if r[3] is not None else None,
                    "replay_lag": str(r[4]) if r[4] is not None else None,
                }
                for r in replicas[:_ROW_CAP]
            ]
            return {
                "role": "Replica (in recovery)" if in_recovery else (
                    "Primary" if replica_rows else "Standalone (no replicas)"),
                "is_in_recovery": in_recovery,
                "connected_replicas": len(replica_rows),
                "wal_level": settings.get("wal_level"),
                "max_wal_senders": settings.get("max_wal_senders"),
                "max_replication_slots": settings.get("max_replication_slots"),
                "synchronous_commit": settings.get("synchronous_commit"),
                "hot_standby": settings.get("hot_standby"),
                "archive_mode": settings.get("archive_mode"),
                "replication_slots": len(slots),
                "replicas": replica_rows,
            }
        props["replication"] = collect_section(_replication)

        # ── foreign data wrappers / servers ────────────────────────────────
        def _fdw():
            wrappers = _q("SELECT fdwname FROM pg_foreign_data_wrapper ORDER BY fdwname")
            servers = _q(
                "SELECT s.srvname, w.fdwname "
                "FROM pg_foreign_server s "
                "JOIN pg_foreign_data_wrapper w ON w.oid = s.srvfdw "
                "ORDER BY s.srvname"
            )
            return {
                "wrappers": [r[0] for r in wrappers[:_ROW_CAP]],
                "servers": [{"name": r[0], "wrapper": r[1]} for r in servers[:_ROW_CAP]],
            }
        props["foreign_data_wrappers"] = collect_section(_fdw)

        # ── extensions ─────────────────────────────────────────────────────
        def _extensions():
            rows = _q("SELECT extname, extversion FROM pg_extension ORDER BY extname")
            return [{"name": r[0], "version": r[1]} for r in rows[:_ROW_CAP]]
        props["extensions"] = collect_section(_extensions)

        # ── security-relevant settings + convenience flags ─────────────────
        def _settings():
            placeholders = ",".join("%s" for _ in _PG_SETTINGS)
            rows = _q(
                "SELECT name, setting FROM pg_settings "
                f"WHERE name IN ({placeholders}) ORDER BY name",
                list(_PG_SETTINGS),
            )
            return {r[0]: r[1] for r in rows}
        props["settings"] = collect_section(_settings)

        _s = props["settings"].get("data") if isinstance(props["settings"], dict) else None
        if isinstance(_s, dict):
            props["ssl_enabled"] = (_s.get("ssl") == "on")
            props["publicly_listening"] = (_s.get("listen_addresses") in ("*", "0.0.0.0"))

        return props
    finally:
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass
