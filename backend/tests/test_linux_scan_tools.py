"""P0b linux-scan LINKAGE — the ava-linux-scan arsenal registry (linux_scan_tools) + its wiring into the
finder via the convention dispatcher (_SCAN_ARSENAL_KEY[("internal","linux")] == "linux").

Deterministic + offline: each parser is fed CAPTURED sample tool output and we assert the normalized finding
rows (shape, severity, port/component, corroboration-ready source slug). No live scan, no docker. Also
asserts the dispatcher loads THIS module by convention and honest-skips an unmapped sub-lane.
"""
import grc.modules.pentest.linux_scan_tools as lst
import grc.modules.pentest.service as svc


# ---- row shape contract (matches service._nikto_rows so dedup + ingest consume it unchanged) -----------
def _assert_shape(rows):
    for r in rows:
        assert r["kind"] in ("network", "web")          # linux host rows = network; reused web/TLS = web
        assert set(("vid", "source_slug", "title", "affected_url", "fields")) <= set(r)
        f = r["fields"]
        assert f["severity"] in lst._SEV
        assert f["source"].startswith("ai-pentest:") and f["plugin_family"] == "AI Pentest"
        assert f["status"] == "open" and f["title"]
        assert f["affected_host"]                        # a host-lane finding always names its host


def test_nmap_ports_and_vulners_cves():
    out = ("PORT     STATE SERVICE VERSION\n"
           "22/tcp   open  ssh     OpenSSH 7.4 (protocol 2.0)\n"
           "80/tcp   open  http    Apache httpd 2.4.6 ((CentOS))\n"
           "| vulners:\n"
           "|   cpe:/a:apache:http_server:2.4.6:\n"
           "|       CVE-2017-7679   7.5   https://vulners.com/cve/CVE-2017-7679\n"
           "|       CVE-2018-1312   6.8   https://vulners.com/cve/CVE-2018-1312\n"
           "|_      CVE-2019-0211   7.2   https://vulners.com/cve/CVE-2019-0211\n")
    rows = lst.parse_tool("nmap", out, "1.2.3.4", 1, "http://1.2.3.4")
    _assert_shape(rows)
    ports = [r for r in rows if not r["cve_id"]]
    cves = {r["cve_id"]: r for r in rows if r["cve_id"]}
    assert {r["affected_port"] for r in ports} == {22, 80}
    assert all(r["fields"]["severity"] == "info" for r in ports)
    assert cves["CVE-2017-7679"]["fields"]["severity"] == "high"      # 7.5
    assert cves["CVE-2018-1312"]["fields"]["severity"] == "medium"    # 6.8
    assert cves["CVE-2019-0211"]["fields"]["severity"] == "high"      # 7.2
    assert all(r["affected_port"] == 80 for r in cves.values())       # attached to the port they follow
    assert all(r["source_slug"] == "nmap" for r in rows)


def test_nmap_rejects_future_year_cve_but_keeps_current():
    # the vulners feed can surface reserved/placeholder ids with an impossible FUTURE year — dropped so they
    # never inflate the register. a legit high-sequence CURRENT-year id (CVE-<thisyear>-99999) is kept.
    from datetime import datetime, timezone
    yr = datetime.now(timezone.utc).year
    out = ("22/tcp open ssh OpenSSH 7.4\n"
           "| vulners:\n"
           f"|       CVE-{yr}-99999   9.8   https://vulners.com/cve/CVE-{yr}-99999\n"
           f"|       CVE-{yr + 1}-100000   9.8   https://vulners.com/cve/CVE-{yr + 1}-100000\n")
    cves = {r["cve_id"] for r in lst.parse_tool("nmap", out, "1.2.3.4", 1, "http://1.2.3.4") if r["cve_id"]}
    assert f"CVE-{yr}-99999" in cves                 # current-year high-sequence kept (no digit heuristic)
    assert f"CVE-{yr + 1}-100000" not in cves        # future-year impossible id dropped


def test_masscan_open_ports_dedup():
    out = ("Starting masscan 1.3.2\n"
           "Discovered open port 80/tcp on 1.2.3.4\n"
           "Discovered open port 22/tcp on 1.2.3.4\n"
           "Discovered open port 80/tcp on 1.2.3.4\n")
    rows = lst.parse_tool("masscan", out, "1.2.3.4", 2, "http://1.2.3.4")
    _assert_shape(rows)
    assert {r["affected_port"] for r in rows} == {80, 22}             # dupe 80 collapsed
    assert len(rows) == 2


def test_naabu_open_port_summary():
    rows = lst.parse_tool("naabu", "1.2.3.4:22\n1.2.3.4:80\n1.2.3.4:22\n", "1.2.3.4", 2, "http://1.2.3.4")
    _assert_shape(rows)
    assert len(rows) == 1 and "2 open port" in rows[0]["fields"]["title"]


def test_ssh_audit_cves_and_weak_algos():
    out = ('{"banner":{"raw":"SSH-2.0-OpenSSH_7.4","software":"OpenSSH_7.4"},'
           '"cves":[{"name":"CVE-2018-15473","cvssv2":5.0,"description":"username enumeration"},'
           '{"name":"CVE-2016-10012","cvssv2":7.2,"description":"privilege escalation"}],'
           '"recommendations":{"critical":{"del":{"kex":[{"name":"diffie-hellman-group1-sha1"}]}},'
           '"warning":{"del":{"enc":[{"name":"3des-cbc"}]}}}}')
    rows = lst.parse_tool("ssh-audit", out, "h", 3, "http://h")
    _assert_shape(rows)
    assert all(r["affected_port"] == 22 for r in rows)
    cves = {r["cve_id"]: r for r in rows if r["cve_id"]}
    assert cves["CVE-2018-15473"]["fields"]["severity"] == "medium"   # 5.0
    assert cves["CVE-2016-10012"]["fields"]["severity"] == "high"     # 7.2
    algos = {r["affected_component"]: r for r in rows if not r["cve_id"]}
    assert algos["diffie-hellman-group1-sha1"]["fields"]["severity"] == "high"   # critical rec
    assert algos["3des-cbc"]["fields"]["severity"] == "medium"                   # warning rec
    assert len(rows) == 4


def test_showmount_nfs_exports():
    out = "Export list for 1.2.3.4:\n/srv/nfs/public       *\n/home                 10.0.0.0/8\n"
    rows = lst.parse_tool("showmount", out, "1.2.3.4", 4, "http://1.2.3.4")
    _assert_shape(rows)
    assert len(rows) == 2
    byexp = {r["affected_component"]: r for r in rows}
    assert byexp["/srv/nfs/public"]["fields"]["severity"] == "medium"   # world-readable (*)
    assert byexp["/home"]["fields"]["severity"] == "low"                # restricted
    assert all(r["affected_port"] == 2049 for r in rows)


def test_rpcinfo_services_dedup():
    out = ("   program vers proto   port  service\n"
           "    100000    4   tcp    111  portmapper\n"
           "    100003    3   tcp   2049  nfs\n"
           "    100003    4   tcp   2049  nfs\n")
    rows = lst.parse_tool("rpcinfo", out, "h", 5, "http://h")
    _assert_shape(rows)
    assert {r["affected_component"] for r in rows} == {"portmapper", "nfs"}   # header skipped, nfs deduped
    nfs = next(r for r in rows if r["affected_component"] == "nfs")
    assert nfs["affected_port"] == 2049


def test_smbmap_anon_shares():
    out = ("[+] IP: 1.2.3.4:445\tName: host\n"
           "\tDisk                              Permissions\tComment\n"
           "\t----                              -----------\t-------\n"
           "\tADMIN$                            NO ACCESS\tRemote Admin\n"
           "\tpublic                            READ ONLY\tPublic share\n"
           "\tbackups                           READ, WRITE\tBackups\n")
    rows = lst.parse_tool("smbmap", out, "h", 6, "http://h")
    _assert_shape(rows)
    shares = {r["affected_component"]: r for r in rows}
    assert set(shares) == {"public", "backups"}                        # NO ACCESS + header/sep dropped
    assert shares["public"]["fields"]["severity"] == "low"
    assert shares["backups"]["fields"]["severity"] == "medium"         # writable
    assert all(r["affected_port"] == 445 for r in rows)


def test_onesixtyone_default_community():
    out = "Scanning 1 hosts, 1 communities\n1.2.3.4 [public] Linux host 3.10.0-1127.el7\n"
    rows = lst.parse_tool("onesixtyone", out, "1.2.3.4", 7, "http://1.2.3.4")
    _assert_shape(rows)
    assert len(rows) == 1
    assert rows[0]["fields"]["severity"] == "medium" and rows[0]["affected_port"] == 161
    assert "public" in rows[0]["fields"]["title"]


def test_ldapsearch_anonymous_bind():
    ctx = ("dn:\nnamingContexts: dc=example,dc=com\nnamingContexts: dc=corp,dc=example,dc=com\n\n"
           "search: 2\nresult: 0 Success\n")
    rows = lst.parse_tool("ldapsearch", ctx, "h", 8, "http://h")
    _assert_shape(rows)
    assert {r["affected_component"] for r in rows} == {"dc=example,dc=com", "dc=corp,dc=example,dc=com"}
    assert all(r["fields"]["severity"] == "medium" and r["affected_port"] == 389 for r in rows)
    # anon bind succeeds but no contexts -> single generic medium row
    only = lst.parse_tool("ldapsearch", "dn:\n\nsearch: 2\nresult: 0 Success\n", "h", 8, "http://h")
    assert len(only) == 1 and only[0]["fields"]["severity"] == "medium"
    # failed bind (non-zero result, no contexts) -> honest nothing
    assert lst.parse_tool("ldapsearch", "result: 32 No such object\n", "h", 8, "http://h") == []


def test_nbtscan_netbios_name():
    out = ("Doing NBT name scan for addresses from 1.2.3.4\n\n"
           "IP address       NetBIOS Name     Server    User\n"
           "-------------------------------------------------------\n"
           "1.2.3.4          HOSTNAME         <server>  HOSTNAME         00:11:22:33:44:55\n")
    rows = lst.parse_tool("nbtscan", out, "1.2.3.4", 9, "http://1.2.3.4")
    _assert_shape(rows)
    assert len(rows) == 1
    assert rows[0]["affected_component"] == "HOSTNAME" and rows[0]["affected_port"] == 139


def test_reused_web_and_tls_parsers_reachable():
    # the web-lane parsers are reused wholesale — reachable via THIS registry, producing kind="web" rows
    rows = lst.parse_tool("whatweb", "http://h [200 OK] HTTPServer[Apache/2.4.7], PHP[5.5.9]", "h", 1,
                          "http://h")
    _assert_shape(rows)
    assert rows and all(r["kind"] == "web" for r in rows)
    ssl = lst.parse_tool("sslscan", "  SSLv3     enabled\n", "h", 1, "https://h")
    _assert_shape(ssl)
    assert any("SSLv3" in r["fields"]["title"] for r in ssl)
    for n in ("sslscan", "testssl", "sslyze", "whatweb", "httpx", "wafw00f"):
        assert lst.parse_tool(n, "", "h", 1, "http://h") == []       # empty -> honest skip


# ---- NEW: SNMP family (corroborate onesixtyone; community 'public') ------------------------------------
def test_snmp_check_public_community():
    out = ("[+] Try to connect to 1.2.3.4:161 using SNMPv2c and community 'public'\n\n"
           "[*] System information:\n\n"
           "  Hostname                      : server01\n"
           "  Description                   : Linux server01 3.10.0\n"
           "  Uptime system                 : 10 days\n")
    rows = lst.parse_tool("snmp-check", out, "1.2.3.4", 1, "http://1.2.3.4")
    _assert_shape(rows)
    assert len(rows) == 1 and rows[0]["fields"]["severity"] == "medium" and rows[0]["affected_port"] == 161
    assert lst.parse_tool("snmp-check", "Connection refused\n", "h", 1, "http://h") == []


def test_snmpwalk_oid_summary():
    out = ("SNMPv2-MIB::sysDescr.0 = STRING: Linux server01 3.10.0\n"
           "SNMPv2-MIB::sysUpTime.0 = Timeticks: (12345) 0:02:03.45\n"
           "iso.3.6.1.2.1.1.5.0 = STRING: server01\n")
    rows = lst.parse_tool("snmpwalk", out, "1.2.3.4", 1, "http://1.2.3.4")
    _assert_shape(rows)
    assert len(rows) == 1 and "3 OIDs" in rows[0]["fields"]["title"] and rows[0]["affected_port"] == 161
    assert lst.parse_tool("snmpwalk", "Timeout: No Response from 1.2.3.4\n", "h", 1, "http://h") == []


def test_braa_oid_summary():
    out = ("1.2.3.4:.1.3.6.1.2.1.1.1.0:Linux server01 3.10.0\n"
           "1.2.3.4:.1.3.6.1.2.1.1.5.0:server01\n")
    rows = lst.parse_tool("braa", out, "1.2.3.4", 1, "http://1.2.3.4")
    _assert_shape(rows)
    assert len(rows) == 1 and rows[0]["affected_port"] == 161
    assert lst.parse_tool("braa", "no OIDs here\n", "h", 1, "http://h") == []


# ---- NEW: SMB / RPC anonymous enumeration --------------------------------------------------------------
def test_smbclient_anon_shares():
    out = ("Disk|public|Public share\n"
           "IPC|IPC$|IPC Service (Samba)\n"
           "Printer|hp-laser|Office printer\n")
    rows = lst.parse_tool("smbclient", out, "h", 1, "http://h")
    _assert_shape(rows)
    shares = {r["affected_component"]: r for r in rows}
    assert set(shares) == {"public", "IPC$", "hp-laser"}
    assert shares["public"]["fields"]["severity"] == "low" and shares["public"]["affected_port"] == 445
    assert shares["IPC$"]["fields"]["severity"] == "info"
    # table format also parses; access denied -> nothing
    tbl = "\tSharename       Type      Comment\n\tdata            Disk      Data share\n"
    assert any(r["affected_component"] == "data" for r in lst.parse_tool("smbclient", tbl, "h", 1, "http://h"))
    assert lst.parse_tool("smbclient", "session setup failed: NT_STATUS_ACCESS_DENIED\n", "h", 1,
                          "http://h") == []


def test_rpcclient_null_session_users():
    out = ("        HOSTNAME       Wk Sv PrQ Unx NT SNT server (Samba 4.x)\n"
           "        platform_id     :       500\n"
           "user:[admin] rid:[0x3e8]\n"
           "user:[guest] rid:[0x1f5]\n")
    rows = lst.parse_tool("rpcclient", out, "h", 1, "http://h")
    _assert_shape(rows)
    users = {r["affected_component"] for r in rows if r["affected_component"]}
    assert {"admin", "guest"} <= users
    assert any("null session" in r["fields"]["title"].lower() for r in rows)
    assert all(r["affected_port"] == 445 for r in rows)
    assert lst.parse_tool("rpcclient", "Cannot connect: NT_STATUS_ACCESS_DENIED\n", "h", 1, "http://h") == []


# ---- NEW: exposed DB / cache no-auth checks ------------------------------------------------------------
def test_redis_unauth_exposure():
    out = "# Server\r\nredis_version:7.0.11\r\nos:Linux\r\n"
    rows = lst.parse_tool("redis-cli", out, "h", 1, "http://h")
    _assert_shape(rows)
    assert len(rows) == 1 and rows[0]["fields"]["severity"] == "high" and rows[0]["affected_port"] == 6379
    assert "7.0.11" in rows[0]["fields"]["title"]
    assert lst.parse_tool("redis-cli", "NOAUTH Authentication required.\n", "h", 1, "http://h") == []


def test_db_no_password_login():
    myrows = lst.parse_tool("mysql", "10.5.19-MariaDB\n", "h", 1, "http://h")
    _assert_shape(myrows)
    assert len(myrows) == 1 and myrows[0]["fields"]["severity"] == "critical" and myrows[0]["affected_port"] == 3306
    pgrows = lst.parse_tool("psql", "PostgreSQL 14.9 on x86_64-pc-linux-gnu\n", "h", 1, "http://h")
    assert len(pgrows) == 1 and pgrows[0]["affected_port"] == 5432
    # auth failure / refused -> honest skip (no fabricated finding)
    assert lst.parse_tool("mysql", "ERROR 1045 (28000): Access denied for user 'root'@'x'\n", "h", 1,
                          "http://h") == []
    assert lst.parse_tool("psql", "psql: error: connection to server failed: Connection refused\n", "h", 1,
                          "http://h") == []


# ---- NEW: VPN / SMTP service probes ------------------------------------------------------------------
def test_ike_scan_aggressive_mode():
    agg = ("Starting ike-scan\n1.2.3.4  Aggressive Mode Handshake returned SA=(...)\n")
    rows = lst.parse_tool("ike-scan", agg, "1.2.3.4", 1, "http://1.2.3.4")
    _assert_shape(rows)
    assert len(rows) == 1 and rows[0]["fields"]["severity"] == "medium" and rows[0]["affected_port"] == 500
    main = "1.2.3.4  Main Mode Handshake returned SA=(...)\n"
    mrows = lst.parse_tool("ike-scan", main, "1.2.3.4", 1, "http://1.2.3.4")
    assert len(mrows) == 1 and mrows[0]["fields"]["severity"] == "info"
    assert lst.parse_tool("ike-scan", "0 returned handshake; 0 returned notify\n", "h", 1, "http://h") == []


def test_smtp_user_enum_vrfy():
    out = ("mail.h: root exists\nmail.h: admin exists\nmail.h: nosuch does not exist\n")
    rows = lst.parse_tool("smtp-user-enum", out, "h", 1, "http://h")
    _assert_shape(rows)
    assert {r["affected_component"] for r in rows} == {"root", "admin"}
    assert all(r["fields"]["severity"] == "medium" and r["affected_port"] == 25 for r in rows)


# ---- NEW: CMS scanners (honest-skip when not that CMS) -------------------------------------------------
def test_wpscan_version_and_vuln():
    out = ("[+] WordPress version 5.4.1 identified (Insecure, released on 2020-04-29).\n"
           " | [!] Title: WordPress 5.4 - XSS in Block Editor\n")
    rows = lst.parse_tool("wpscan", out, "h", 1, "http://h")
    _assert_shape(rows)
    assert any("version 5.4.1" in r["fields"]["title"] for r in rows)
    vuln = [r for r in rows if r["fields"]["severity"] == "high"]
    assert vuln and "XSS in Block Editor" in vuln[0]["fields"]["title"]
    assert lst.parse_tool("wpscan", "The remote website does not seem to be running WordPress.\n", "h", 1,
                          "http://h") == []


def test_joomscan_version_and_finding():
    out = ("\x1b[34m[+] Detecting Joomla Version\x1b[0m\n"
           "[++] Joomla 3.9.1\n"
           "[++] Core Joomla Vulnerability : SQLi in com_fields\n")
    rows = lst.parse_tool("joomscan", out, "h", 1, "http://h")
    _assert_shape(rows)
    assert any("Joomla" in r["fields"]["title"] and "3.9.1" in r["fields"]["title"] for r in rows)
    assert any(r["fields"]["severity"] == "medium" for r in rows)
    assert lst.parse_tool("joomscan", "[+] target is not Joomla\n", "h", 1, "http://h") == []


# ---- NEW: screenshots + credentialed AD dump + surface reuse ------------------------------------------
def test_eyewitness_screenshot_artifact():
    rows = lst.parse_tool("eyewitness", "/tmp/ew/screens/http.h.png\n", "h", 1, "http://h")
    _assert_shape(rows)
    assert len(rows) == 1 and rows[0]["fields"]["severity"] == "info"
    assert lst.parse_tool("eyewitness", "no report generated\n", "h", 1, "http://h") == []


def test_ldapdomaindump_credentialed():
    out = ("cn\tname\tsAMAccountName\n"
           "Administrator\tAdministrator\tadministrator\n"
           "John Doe\tJohn Doe\tjdoe\n")
    rows = lst.parse_tool("ldapdomaindump", out, "h", 1, "http://h")
    _assert_shape(rows)
    assert len(rows) == 1 and rows[0]["fields"]["severity"] == "medium" and rows[0]["affected_port"] == 389
    assert "2 user record" in rows[0]["fields"]["title"]                # header line dropped
    assert lst.parse_tool("ldapdomaindump", "", "h", 1, "http://h") == []   # env-gated no-run -> nothing


def test_content_discovery_and_surface_summaries():
    ferox = lst.parse_tool("feroxbuster", "200      GET http://h/admin\n200      GET http://h/login\n",
                           "h", 1, "http://h")
    _assert_shape(ferox)
    assert ferox and "2 path" in ferox[0]["fields"]["title"]
    ffuf = lst.parse_tool("ffuf", "http://h/robots.txt [Status: 200]\n", "h", 1, "http://h")
    assert ffuf and ffuf[0]["source_slug"] == "ffuf"
    subs = lst.parse_tool("subfinder", "www.h.com\napi.h.com\n", "h", 1, "http://h")
    assert subs and "subdomain" in subs[0]["fields"]["title"]
    for n in ("gobuster", "dirsearch", "dnsx", "dnsrecon", "fierce", "gau", "katana"):
        assert lst.parse_tool(n, "", "h", 1, "http://h") == []          # empty -> honest skip


def test_arjun_hidden_params():
    # arjun -oJ JSON: endpoint -> {method, params}. One low row per distinct param (an injection target).
    out = '{"http://h/search": {"method": "GET", "params": ["id", "q", "debug"]}}'
    rows = lst.parse_tool("arjun", out, "h", 1, "http://h")
    _assert_shape(rows)
    assert {r["affected_component"] for r in rows} == {"id", "q", "debug"}
    assert all(r["fields"]["severity"] == "low" and r["source_slug"] == "arjun" for r in rows)
    assert all(r["affected_url"] == "http://h/search" for r in rows)
    # flat single-URL shape ({"params":[...]}) normalizes against the target url
    flat = lst.parse_tool("arjun", '{"params": ["token"]}', "h", 1, "http://h")
    assert len(flat) == 1 and flat[0]["affected_component"] == "token" and flat[0]["affected_url"] == "http://h"
    # nothing found / non-JSON -> honest skip
    assert lst.parse_tool("arjun", "{}", "h", 1, "http://h") == []
    assert lst.parse_tool("arjun", "no params here", "h", 1, "http://h") == []


# ---- LIVE-FIRE argv/parser fixes (verified against ava-livefire-net, 2026-09-30) ----------------------
def test_ffuf_bare_tokens_normalized_to_paths():
    # REAL `ffuf -s` output: BARE relative words (no scheme, no leading slash) — the shared _extract_disc
    # matched neither full URLs nor /-paths, yielding 0 rows. _extract_ffuf normalizes each to a /path.
    out = ".git/HEAD\n.cvs\n.config\n.env\n.git/HEAD\n"
    rows = lst.parse_tool("ffuf", out, "juice", 1, "http://juice:3000")
    _assert_shape(rows)
    assert len(rows) == 1 and "4 path" in rows[0]["fields"]["title"]     # dupe collapsed
    ev = rows[0]["fields"]["evidence"]
    assert "/.git/HEAD" in ev and "/.env" in ev                          # bare word -> /path


def test_psql_error_line_not_faked_as_version():
    # REAL psql empty-password error vs pg: the IP octets 172.18.0.8 match \d+\.\d+, and the old
    # _DB_FAIL_RE missed "fe_sendauth: no password supplied" -> the error line was reported as a version.
    err = ('Password for user postgres: \n'
           'psql: error: connection to server at "pg" (172.18.0.8), port 5432 failed: '
           'fe_sendauth: no password supplied')
    assert lst.parse_tool("psql", err, "pg", 1, "http://pg") == []       # clean fail, no fake version
    # a genuine no-auth success still parses the real version banner.
    ok = ("PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2) on x86_64-pc-linux-gnu, "
          "compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit")
    rows = lst.parse_tool("psql", ok, "pg", 1, "http://pg")
    _assert_shape(rows)
    assert len(rows) == 1 and rows[0]["fields"]["severity"] == "critical" and "18.6" in rows[0]["fields"]["title"]


def test_naabu_top_ports_100_not_200_linux():
    spec = next(s for s in lst.LINUX_SCAN_TOOLS if s["name"] == "naabu")
    joined = " ".join(spec["argv"]("samba", "http://samba"))
    assert "-top-ports 100" in joined and "-top-ports 200" not in joined


def test_masscan_resolves_hostname_to_ip():
    # masscan does NO DNS and rejects a hostname ("unknown command-line parameter") — the argv must
    # resolve host->IP (getent) before invoking masscan.
    spec = next(s for s in lst.LINUX_SCAN_TOOLS if s["name"] == "masscan")
    joined = " ".join(spec["argv"]("samba", "http://samba"))
    assert "getent hosts" in joined and "masscan" in joined
    # parser still consumes the real "Discovered open port" lines.
    out = ("Discovered open port 139/tcp on 172.18.0.5\nDiscovered open port 445/tcp on 172.18.0.5\n")
    rows = lst.parse_tool("masscan", out, "samba", 1, "http://samba")
    _assert_shape(rows)
    assert {r["affected_port"] for r in rows} == {139, 445}


def test_dirsearch_uses_output_formats_not_format():
    # dirsearch v0.5.0 in this image rejects --format ("no such option"); the supported flag is
    # --output-formats (simple is available).
    spec = next(s for s in lst.LINUX_SCAN_TOOLS if s["name"] == "dirsearch")
    joined = " ".join(spec["argv"]("juice", "http://juice:3000"))
    assert "--output-formats=simple" in joined and "--format=simple" not in joined
    # parser reads the report's full-URL lines.
    rows = lst.parse_tool("dirsearch", "http://juice:3000/api\nhttp://juice:3000/ftp\n", "juice", 1,
                          "http://juice:3000")
    assert rows and "2 path" in rows[0]["fields"]["title"]


def test_gowitness_writes_screenshots_flag():
    spec = next(s for s in lst.LINUX_SCAN_TOOLS if s["name"] == "gowitness")
    joined = " ".join(spec["argv"]("juice", "http://juice:3000"))
    assert "--write-screenshots" in joined and "--screenshot-path" in joined


def test_still_unwired_and_missing_are_honest():
    names = {s["name"] for s in lst.LINUX_SCAN_TOOLS}
    # nothing declared still-unwired or missing may also be wired (no contradiction)
    assert not (set(lst._STILL_UNWIRED_LINUX_SCAN_TOOLS) & names)
    assert not (set(lst._MISSING_FROM_IMAGE) & names)
    # netexec + enum4linux-ng ARE in the image (pipx) and are now wired — no longer "missing"
    assert {"netexec", "enum4linux-ng"} <= names
    # cewl (target-specific wordlist maker / would-be feeder) is the genuine image gap, honestly recorded
    assert "cewl" in lst._MISSING_FROM_IMAGE


def test_parsers_never_raise_on_garbage():
    everyone = ("nmap", "masscan", "naabu", "ssh-audit", "showmount", "rpcinfo", "smbmap", "onesixtyone",
                "ldapsearch", "nbtscan", "sslscan", "testssl", "sslyze", "whatweb", "httpx", "wafw00f",
                "snmp-check", "snmpwalk", "braa", "smbclient", "rpcclient", "redis-cli", "mysql", "psql",
                "ike-scan", "smtp-user-enum", "wpscan", "joomscan", "eyewitness", "ldapdomaindump",
                "feroxbuster", "ffuf", "gobuster", "dirsearch", "arjun", "dnsx", "subfinder", "amass",
                "dnsrecon", "fierce", "gau", "katana", "gowitness", "netexec", "enum4linux-ng")
    for name in everyone:
        assert lst.parse_tool(name, "", "h", 1, "http://h") == []                     # empty -> nothing
        assert isinstance(lst.parse_tool(name, "\x00 not\n valid {[", "h", 1, "http://h"), list)  # no raise
    # JSON-driven parsers must reject non-JSON garbage outright (never a fabricated finding)
    for name in ("ssh-audit", "testssl", "sslyze", "httpx"):
        assert lst.parse_tool(name, "\x00 not\n valid {[", "h", 1, "http://h") == []
    assert lst.parse_tool("does-not-exist", "anything", "h", 1, "http://h") == []


def test_registry_specs_bounded_and_readonly():
    names = {s["name"] for s in lst.LINUX_SCAN_TOOLS}
    assert {"nmap", "naabu", "masscan", "ssh-audit", "showmount", "rpcinfo", "smbmap", "onesixtyone",
            "ldapsearch", "nbtscan", "sslscan", "testssl", "sslyze", "whatweb", "httpx",
            "wafw00f"} <= names
    assert len(names) == len(lst.LINUX_SCAN_TOOLS)                    # no duplicate spec name
    # brute-force / already-wired tools must NOT have leaked into the read-only find registry
    # (netexec IS wired now — read-only creds-gated enum, not the brute modes — so it is intentionally absent here)
    assert not ({"hydra", "medusa", "nuclei", "nikto", "swaks"} & names)
    for spec in lst.LINUX_SCAN_TOOLS:
        argv = spec["argv"]("1.2.3.4", "https://1.2.3.4")
        assert isinstance(argv, list) and argv and all(isinstance(a, str) for a in argv)
        assert 0 < int(spec["timeout"]) <= 600                       # every tool is time-bounded
        assert callable(spec["parse"])
        joined = " ".join(argv)
        # destructive/write flags stay out. (`-w <wordlist>` is content-discovery INPUT, read-only, so it is
        # NOT forbidden; smtp-user-enum's `-w 5` is a wait timeout; snmp-check's write probe is `-w`/`--write`.
        # gowitness's `--write-screenshots` writes a local screenshot artifact — benign, like `-o`.)
        joined_no_gw = joined.replace("--write-screenshots", "")
        assert not any(bad in joined_no_gw for bad in (" rm -", "--delete", " -X DELETE", "mkfs", "--write"))
        assert "-w" not in argv                                       # no bare snmp-check write-access probe


# ---- wiring: the convention dispatcher loads THIS module for (internal, linux) + honest on unmapped ------
def test_dispatcher_loads_linux_module_by_convention(monkeypatch):
    def fake_run(lane, argv, timeout=0, input_bytes=None, phase="scan", subtype=None, **kwargs):
        if argv and argv[0] == "showmount":
            return {"stdout": "Export list for h:\n/data *\n", "stderr": "", "rc": 0, "error": None}
        return {"stdout": "", "stderr": "", "rc": 0, "error": None}

    monkeypatch.setattr(svc, "_lane_container_run", fake_run)
    rows = svc._lane_scan_arsenal_rows("internal", "linux", "h", 1, "http://h")
    assert any(r["source_slug"] == "showmount" for r in rows)        # module loaded + parsed by convention
    # an unmapped sub-lane -> honest [] (no run, no rows)
    assert svc._lane_scan_arsenal_rows("internal", "bogus", "h", 1, "http://h") == []


# ---- NEW: netexec — CREDENTIALED SMB enum (parser) -----------------------------------------------------
def test_netexec_credentialed_smb_enum():
    out = ("SMB  10.0.0.5  445  DC01  [*] Windows Server 2019 (name:DC01) (domain:CORP)\n"
           "SMB  10.0.0.5  445  DC01  [+] CORP\\svc:Passw0rd\n"
           "SMB  10.0.0.5  445  DC01  Share           Permissions     Remark\n"
           "SMB  10.0.0.5  445  DC01  -----           -----------     ------\n"
           "SMB  10.0.0.5  445  DC01  ADMIN$                          Remote Admin\n"
           "SMB  10.0.0.5  445  DC01  Data            READ,WRITE      File share\n"
           "SMB  10.0.0.5  445  DC01  IPC$            READ            Remote IPC\n"
           "SMB  10.0.0.5  445  DC01  CORP\\Administrator\n"
           "SMB  10.0.0.5  445  DC01  CORP\\DC01$\n")           # machine account -> skipped
    rows = lst.parse_tool("netexec", out, "10.0.0.5", 1, "http://10.0.0.5")
    _assert_shape(rows)
    shares = {r["affected_component"]: r for r in rows if "share" in r["fields"]["title"].lower()}
    assert set(shares) == {"Data", "IPC$"}                       # header/sep + no-perm ADMIN$ dropped
    assert shares["Data"]["fields"]["severity"] == "medium"      # writable
    assert shares["IPC$"]["fields"]["severity"] == "low"         # read-only
    users = {r["affected_component"] for r in rows if "user enumerated" in r["fields"]["title"].lower()}
    assert users == {"Administrator"}                            # DC01$ machine account skipped
    assert all(r["affected_port"] == 445 and r["source_slug"] == "netexec" for r in rows)
    assert lst.parse_tool("netexec", "", "h", 1, "http://h") == []


# ---- NEW: enum4linux-ng — null-session comprehensive enum (parser) -------------------------------------
def test_enum4linux_null_session_parse():
    out = ('{"users": {"1001": {"username": "administrator"}, "1002": {"username": "guest"}}, '
           '"shares": {"public": {"access": {"mapping": "ok"}}, "netlogon": {}}}')
    rows = lst.parse_tool("enum4linux-ng", out, "h", 1, "http://h")
    _assert_shape(rows)
    users = {r["affected_component"] for r in rows if r["fields"]["severity"] == "medium"}
    assert users == {"administrator", "guest"}
    shares = {r["affected_component"] for r in rows if r["fields"]["severity"] == "low"}
    assert shares == {"public", "netlogon"}
    assert all(r["affected_port"] == 445 and r["source_slug"] == "enum4linux-ng" for r in rows)
    assert lst.parse_tool("enum4linux-ng", "not json", "h", 1, "http://h") == []


# ---- NEW: netexec is creds-GATED at the dispatcher (dormant w/o creds, fires with) ---------------------
def test_netexec_creds_gated_dispatcher(monkeypatch):
    def fake_run(lane, argv, timeout=0, input_bytes=None, phase="scan", subtype=None, **kwargs):
        j = " ".join(argv)
        if "nxc smb" in j:
            return {"stdout": "SMB 10.0.0.5 445 DC01  Data  READ,WRITE  File share\n"
                              "SMB 10.0.0.5 445 DC01  CORP\\jdoe\n", "stderr": "", "rc": 0, "error": None}
        return {"stdout": "", "stderr": "", "rc": 0, "error": None}

    monkeypatch.setattr(svc, "_lane_container_run", fake_run)
    # no creds -> netexec (needs_creds) stays DORMANT: not run, no rows
    dormant = svc._lane_scan_arsenal_rows("internal", "linux", "h", 1, "http://h", creds_available=False)
    assert not any(r["source_slug"] == "netexec" for r in dormant)
    # creds available -> netexec FIRES and its rows land
    fired = svc._lane_scan_arsenal_rows("internal", "linux", "h", 1, "http://h", creds_available=True)
    assert any(r["source_slug"] == "netexec" for r in fired)


# ---- NEW: enum4linux-ng fires ONLY when its primary (rpcclient) produced nothing -----------------------
def test_enum4linux_fallback_fires_only_on_rpcclient_empty(monkeypatch):
    e4l = ('{"users": {"1001": {"username": "administrator"}}, "shares": {"public": {}}}')

    def make_fake(rpcclient_out):
        def fake_run(lane, argv, timeout=0, input_bytes=None, phase="scan", subtype=None, **kwargs):
            j = " ".join(argv)
            if "rpcclient" in j:
                return {"stdout": rpcclient_out, "stderr": "", "rc": 0, "error": None}
            if "enum4linux-ng" in j:
                return {"stdout": e4l, "stderr": "", "rc": 0, "error": None}
            return {"stdout": "", "stderr": "", "rc": 0, "error": None}
        return fake_run

    # rpcclient SUCCEEDS (enumerates a user) -> enum4linux-ng fallback stays DORMANT
    monkeypatch.setattr(svc, "_lane_container_run", make_fake("user:[admin] rid:[0x3e8]\n"))
    ok = svc._lane_scan_arsenal_rows("internal", "linux", "h", 1, "http://h")
    assert any(r["source_slug"] == "rpcclient" for r in ok)
    assert not any(r["source_slug"] == "enum4linux-ng" for r in ok)
    # rpcclient PRODUCES NOTHING -> the fallback fires and contributes its rows
    monkeypatch.setattr(svc, "_lane_container_run", make_fake(""))
    fb = svc._lane_scan_arsenal_rows("internal", "linux", "h", 1, "http://h")
    assert not any(r["source_slug"] == "rpcclient" for r in fb)
    assert any(r["source_slug"] == "enum4linux-ng" for r in fb)


# ---- NEW: amass — deeper passive subdomain OSINT, wired fallback_for="subfinder" -----------------------
# REAL amass v4 relationship-format output (captured from a live `amass enum -d owasp.org`): the valuable
# discovered FQDNs sit in the LEFT column; ASN/Netblock/IP tokens are dropped by _extract_hosts/_HOST_RE.
_AMASS_SAMPLE = (
    "owasp.org (FQDN) --> ns_record --> fay.ns.cloudflare.com (FQDN)\n"
    "owasp.org (FQDN) --> mx_record --> aspmx.l.google.com (FQDN)\n"
    "genai.owasp.org (FQDN) --> a_record --> 192.0.78.146 (IPAddress)\n"
    "training.owasp.org (FQDN) --> a_record --> 104.20.44.163 (IPAddress)\n"
    "devsecops.owasp.org (FQDN) --> aaaa_record --> 2606:4700:10::6814:2ca3 (IPAddress)\n"
    "192.0.64.0/18 (Netblock) --> contains --> 192.0.78.146 (IPAddress)\n"
    "2635 (ASN) --> managed_by --> AUTOMATTIC - Automattic, Inc (RIROrganization)\n")


def test_amass_subdomain_summary_from_relationship_output():
    rows = lst.parse_tool("amass", _AMASS_SAMPLE, "owasp.org", 1, "http://owasp.org")
    _assert_shape(rows)
    assert len(rows) == 1 and rows[0]["source_slug"] == "amass"
    # left-column FQDNs only (owasp.org deduped, 3 subs) — ASN 2635 + Netblock 192.0.64.0/18 dropped
    assert "4 subdomain" in rows[0]["fields"]["title"]
    ev = rows[0]["fields"]["evidence"]
    assert "genai.owasp.org" in ev and "2635" not in ev and "192.0.64.0/18" not in ev
    assert lst.parse_tool("amass", "", "owasp.org", 1, "http://owasp.org") == []    # empty -> honest skip


def test_amass_argv_bounded_gated_and_fallback():
    spec = next(s for s in lst.LINUX_SCAN_TOOLS if s["name"] == "amass")
    assert spec["fallback_for"] == "subfinder"                 # second opinion only when subfinder is dry
    assert 0 < int(spec["timeout"]) <= 600
    joined = " ".join(spec["argv"]("owasp.org", "http://owasp.org"))
    assert "amass enum -passive" in joined                     # same invocation as the cloud-lane fallback
    assert "-timeout 3" in joined and "| head -n 2000" in joined   # bounded; stdout captured (container timeout caps)
    assert "*[A-Za-z]*" in joined                              # bare-IP applicability gate (no domain -> skip)
    assert "-silent" not in joined                             # NOT -silent: names must reach stdout to be read


def test_amass_fallback_fires_only_on_subfinder_empty(monkeypatch):
    def make_fake(subfinder_out):
        def fake_run(lane, argv, timeout=0, input_bytes=None, phase="scan", subtype=None, **kwargs):
            j = " ".join(argv)
            if "subfinder -d" in j:
                return {"stdout": subfinder_out, "stderr": "", "rc": 0, "error": None}
            if "amass enum" in j:
                return {"stdout": _AMASS_SAMPLE, "stderr": "", "rc": 0, "error": None}
            return {"stdout": "", "stderr": "", "rc": 0, "error": None}
        return fake_run

    # subfinder SUCCEEDS -> amass fallback stays DORMANT (zero added cost)
    monkeypatch.setattr(svc, "_lane_container_run", make_fake("www.owasp.org\napi.owasp.org\n"))
    ok = svc._lane_scan_arsenal_rows("internal", "linux", "owasp.org", 1, "http://owasp.org")
    assert any(r["source_slug"] == "subfinder" for r in ok)
    assert not any(r["source_slug"] == "amass" for r in ok)
    # subfinder EMPTY -> amass fires and contributes its rows
    monkeypatch.setattr(svc, "_lane_container_run", make_fake(""))
    fb = svc._lane_scan_arsenal_rows("internal", "linux", "owasp.org", 1, "http://owasp.org")
    assert not any(r["source_slug"] == "subfinder" for r in fb)
    assert any(r["source_slug"] == "amass" for r in fb)
