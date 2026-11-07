"""P0b databases-scan LINKAGE — the ava-databases-scan arsenal registry (databases_scan_tools) parsers.

STANDALONE + offline: imports ONLY the new module (NOT service.py — the dispatcher keys are wired in a later
serial pass). Each parser is fed CAPTURED sample tool output and we assert the normalized finding rows (shape,
severity, port/component, honest-skip on auth/connection failure). No live scan, no docker.
"""
import grc.modules.pentest.databases_scan_tools as dst


# ---- row shape contract (matches linux_scan_tools._lrow so dedup + ingest consume it unchanged) ---------
def _assert_shape(rows):
    for r in rows:
        assert r["kind"] in ("network", "web")
        assert set(("vid", "source_slug", "title", "affected_url", "fields")) <= set(r)
        f = r["fields"]
        assert f["severity"] in dst._SEV
        assert f["source"].startswith("ai-pentest:") and f["plugin_family"] == "AI Pentest"
        assert f["status"] == "open" and f["title"]
        assert f["affected_host"]


# ---- reused linux DB/port/TLS parsers reachable through THIS registry -----------------------------------
def test_nmap_db_ports_reused_parser():
    out = ("PORT     STATE SERVICE VERSION\n"
           "3306/tcp open  mysql   MySQL 5.7.33\n"
           "5432/tcp open  postgresql PostgreSQL DB 14.9\n")
    rows = dst.parse_tool("nmap", out, "1.2.3.4", 1, "http://1.2.3.4")
    _assert_shape(rows)
    assert {r["affected_port"] for r in rows} == {3306, 5432}
    assert all(r["source_slug"] == "nmap" for r in rows)


def test_mysql_and_psql_no_password_reused():
    myrows = dst.parse_tool("mysql", "5.7.33-log\n", "h", 1, "http://h")
    _assert_shape(myrows)
    assert len(myrows) == 1 and myrows[0]["fields"]["severity"] == "critical" and myrows[0]["affected_port"] == 3306
    pgrows = dst.parse_tool("psql", "PostgreSQL 14.9 on x86_64-pc-linux-gnu\n", "h", 1, "http://h")
    assert len(pgrows) == 1 and pgrows[0]["affected_port"] == 5432 and pgrows[0]["fields"]["severity"] == "critical"
    # auth failure / refused -> honest skip
    assert dst.parse_tool("mysql", "ERROR 1045 (28000): Access denied for user 'root'@'x'\n", "h", 1,
                          "http://h") == []
    assert dst.parse_tool("psql", "psql: error: connection to server failed: Connection refused\n", "h", 1,
                          "http://h") == []


def test_redis_unauth_reused():
    rows = dst.parse_tool("redis-cli", "# Server\r\nredis_version:7.0.11\r\nos:Linux\r\n", "h", 1, "http://h")
    _assert_shape(rows)
    assert len(rows) == 1 and rows[0]["fields"]["severity"] == "high" and rows[0]["affected_port"] == 6379
    assert dst.parse_tool("redis-cli", "NOAUTH Authentication required.\n", "h", 1, "http://h") == []


def test_sslscan_db_tls_reused():
    ssl = dst.parse_tool("sslscan", "  SSLv3     enabled\n", "h", 1, "https://h")
    _assert_shape(ssl)
    assert any("SSLv3" in r["fields"]["title"] for r in ssl)
    assert dst.parse_tool("sslscan", "", "h", 1, "http://h") == []


# ---- NEW: MSSQL blank-sa probe -------------------------------------------------------------------------
def test_mssql_blank_sa_exposure():
    out = ("[*] Encryption required, switching to TLS\n"
           "[*] ENVCHANGE(DATABASE): Old Value: master, New Value: master\n"
           "Microsoft SQL Server 2019 (RTM-CU18) (KB5017593) - 15.0.4261.1 (X64)\n")
    rows = dst.parse_tool("mssql", out, "1.2.3.4", 1, "http://1.2.3.4")
    _assert_shape(rows)
    assert len(rows) == 1 and rows[0]["fields"]["severity"] == "critical" and rows[0]["affected_port"] == 1433
    assert "2019" in rows[0]["fields"]["title"]
    # login failure / refused -> honest skip
    assert dst.parse_tool("mssql", "[-] ERROR(SQL01): Line 1: Login failed for user 'sa'.\n", "h", 1,
                          "http://h") == []
    assert dst.parse_tool("mssql", "[-] Connection refused\n", "h", 1, "http://h") == []


# ---- NEW: MongoDB unauth probe -------------------------------------------------------------------------
def test_mongodb_unauth_exposure():
    rows = dst.parse_tool("mongodb", "7.0.5\n", "1.2.3.4", 1, "http://1.2.3.4")
    _assert_shape(rows)
    assert len(rows) == 1 and rows[0]["fields"]["severity"] == "high" and rows[0]["affected_port"] == 27017
    assert "7.0.5" in rows[0]["fields"]["title"]
    assert dst.parse_tool("mongodb", "MongoServerError: command serverStatus requires authentication\n", "h",
                          1, "http://h") == []
    assert dst.parse_tool("mongodb", "MongoNetworkError: connect ECONNREFUSED 1.2.3.4:27017\n", "h", 1,
                          "http://h") == []


# ---- NEW: Oracle TNS listener probe --------------------------------------------------------------------
def test_tnscmd_listener_version():
    out = ('.........(DESCRIPTION=(TMP=)(VSNNUM=186647040)(ERR=0)(ALIAS=LISTENER))\n'
           'Oracle Database 11g TNSLSNR Version 11.2.0.4.0 - Production\n')
    rows = dst.parse_tool("tnscmd", out, "1.2.3.4", 1, "http://1.2.3.4")
    _assert_shape(rows)
    assert len(rows) == 1 and rows[0]["affected_port"] == 1521 and rows[0]["fields"]["severity"] == "info"
    assert "11.2.0.4.0" in rows[0]["fields"]["title"]
    assert dst.parse_tool("tnscmd", "no response\n", "h", 1, "http://h") == []


# ---- NEW: Oracle ODAT SID enumeration ------------------------------------------------------------------
def test_odat_sid_enumeration():
    out = ("[+] Searching valid SIDs\n"
           "'XE' is a valid SID. Continue...\n"
           "'ORCL' is a valid SID. Continue...\n"
           "'XE' is a valid SID. Continue...\n")       # dupe collapses
    rows = dst.parse_tool("odat", out, "h", 1, "http://h")
    _assert_shape(rows)
    assert {r["affected_component"] for r in rows} == {"XE", "ORCL"}
    assert all(r["fields"]["severity"] == "medium" and r["affected_port"] == 1521 for r in rows)
    assert dst.parse_tool("odat", "No valid SID found.\n", "h", 1, "http://h") == []


# ---- NEW: Elasticsearch http probe ---------------------------------------------------------------------
def test_elasticsearch_unauth_exposure():
    out = ('{"name":"node-1","cluster_name":"prod-cluster",'
           '"version":{"number":"7.17.0","build_flavor":"default"},'
           '"tagline":"You Know, for Search"}')
    rows = dst.parse_tool("elasticsearch", out, "1.2.3.4", 1, "http://1.2.3.4")
    _assert_shape(rows)
    assert len(rows) == 1 and rows[0]["fields"]["severity"] == "high" and rows[0]["affected_port"] == 9200
    assert "7.17.0" in rows[0]["fields"]["title"] and "prod-cluster" in rows[0]["fields"]["title"]
    # 401 security_exception -> honest skip
    err = '{"error":{"root_cause":[{"type":"security_exception"}]},"status":401}'
    assert dst.parse_tool("elasticsearch", err, "h", 1, "http://h") == []
    assert dst.parse_tool("elasticsearch", "not json", "h", 1, "http://h") == []


# ---- NEW: Cassandra CQL probe --------------------------------------------------------------------------
def test_cassandra_unauth_exposure():
    out = ("\n release_version\n"
           "-----------------\n"
           "           4.0.7\n\n(1 rows)\n")
    rows = dst.parse_tool("cassandra", out, "1.2.3.4", 1, "http://1.2.3.4")
    _assert_shape(rows)
    assert len(rows) == 1 and rows[0]["fields"]["severity"] == "high" and rows[0]["affected_port"] == 9042
    assert "4.0.7" in rows[0]["fields"]["title"]
    assert dst.parse_tool("cassandra",
                          "Connection error: AuthenticationException: Remote end requires authentication\n",
                          "h", 1, "http://h") == []
    assert dst.parse_tool("cassandra", "Unable to connect to any servers\n", "h", 1, "http://h") == []


# ---- honesty + registry invariants ---------------------------------------------------------------------
def test_still_unwired_and_missing_are_honest():
    names = {s["name"] for s in dst.DATABASES_SCAN_TOOLS}
    assert not (set(dst._STILL_UNWIRED_DATABASES_SCAN_TOOLS) & names)   # nothing unwired is also wired
    assert not (set(dst._MISSING_FROM_IMAGE) & names)
    # the brute/injection tools (exploit lane) stay out of the read-only scan registry
    assert {"sqlmap", "nosqlmap", "hydra"} <= set(dst._STILL_UNWIRED_DATABASES_SCAN_TOOLS)


def test_parsers_never_raise_on_garbage():
    everyone = ("nmap", "mysql", "psql", "redis-cli", "mssql", "mongodb", "tnscmd", "odat",
                "elasticsearch", "cassandra", "sslscan")
    for name in everyone:
        assert dst.parse_tool(name, "", "h", 1, "http://h") == []                         # empty -> nothing
        assert isinstance(dst.parse_tool(name, "\x00 not\n valid {[", "h", 1, "http://h"), list)  # no raise
    assert dst.parse_tool("does-not-exist", "anything", "h", 1, "http://h") == []


def test_registry_specs_bounded_and_readonly():
    names = [s["name"] for s in dst.DATABASES_SCAN_TOOLS]
    assert len(names) == len(set(names))                               # no duplicate spec name
    assert {"nmap", "mysql", "psql", "redis-cli", "mssql", "mongodb", "tnscmd", "odat",
            "elasticsearch", "cassandra", "sslscan"} <= set(names)
    # brute-force / injection tools must NOT have leaked into the read-only find registry
    assert not ({"sqlmap", "nosqlmap", "hydra", "metasploit-framework"} & set(names))
    for spec in dst.DATABASES_SCAN_TOOLS:
        argv = spec["argv"]("1.2.3.4", "https://1.2.3.4:5432")
        assert isinstance(argv, list) and argv and all(isinstance(a, str) for a in argv)
        assert 0 < int(spec["timeout"]) <= 600                        # every tool is time-bounded
        assert callable(spec["parse"])
        joined = " ".join(argv)
        # destructive/write flags stay out (read-only scan). DROP/DELETE/INSERT/UPDATE never appear.
        assert not any(bad in joined for bad in (" rm -", "--delete", " -X DELETE", "mkfs",
                                                 "DROP ", "DELETE ", "INSERT ", "UPDATE "))
