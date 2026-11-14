"""P0b win-scan LINKAGE — the ava-win-scan arsenal registry (win_scan_tools) — Windows/AD host discovery
+ unauthenticated null-session enumeration.

Deterministic + offline: each parser is fed CAPTURED sample tool output (real formats/schemas confirmed
read-only against the ava-win-scan image) and we assert the normalized finding rows (shape, severity,
component, port, corroboration-ready source slug). No live scan, no docker. Rows use the same shape as
web_scan_tools._row (kind="network" for host findings, asset_type="windows" for per-type dedup) so
_dedup_findings + _write_rows consume them unchanged. Garbage-safety + registry bounded/read-only asserted.
"""
import grc.modules.pentest.win_scan_tools as wst


# ---- row shape contract (matches service._hexstrike_rows so dedup + ingest consume it unchanged) --------
def _assert_shape(rows):
    for r in rows:
        assert r["kind"] == "network"
        assert r["asset_type"] == "windows"
        assert set(("vid", "source_slug", "title", "fields")) <= set(r)
        f = r["fields"]
        assert f["severity"] in wst._SEV
        assert f["source"].startswith("ai-pentest:") and f["plugin_family"] == "AI Pentest"
        assert f["status"] == "open" and f["title"] and f["asset_type"] == "windows"


def test_netexec_host_signing_and_smbv1():
    out = ("SMB         10.10.10.5      445    DC01             [*] Windows Server 2019 Build 17763 x64 "
           "(name:DC01) (domain:corp.local) (signing:False) (SMBv1:True)")
    rows = wst.parse_tool("netexec", out, "10.10.10.5", 1, "http://10.10.10.5")
    _assert_shape(rows)
    titles = [r["fields"]["title"] for r in rows]
    assert any("SMB host" in t and "corp.local" in t for t in titles)
    signing = next(r for r in rows if "signing not required" in r["fields"]["title"])
    assert signing["fields"]["severity"] == "medium" and signing["affected_port"] == 445
    smbv1 = next(r for r in rows if "SMBv1" in r["fields"]["title"])
    assert smbv1["fields"]["severity"] == "high"
    assert all(r["source_slug"] == "netexec" for r in rows)


def test_netexec_hardened_host_only_info():
    out = ("SMB         10.0.0.9        445    SRV02            [*] Windows Server 2022 Build 20348 x64 "
           "(name:SRV02) (domain:corp.local) (signing:True) (SMBv1:False)")
    rows = wst.parse_tool("netexec", out, "10.0.0.9", 2, "http://10.0.0.9")
    _assert_shape(rows)
    assert len(rows) == 1 and rows[0]["fields"]["severity"] == "info"   # no signing/SMBv1 finding


def test_nbtscan_netbios_names():
    out = ("Doing NBT name scan for addresses from 10.0.0.5\n\n"
           "IP address       NetBIOS Name     Server    User             MAC address      \n"
           "------------------------------------------------------------------------------\n"
           "10.0.0.5         DC01             <server>  <unknown>        00:0c:29:ab:cd:ef\n")
    rows = wst.parse_tool("nbtscan", out, "10.0.0.5", 3, "http://10.0.0.5")
    _assert_shape(rows)
    assert len(rows) == 1
    assert rows[0]["fields"]["title"] == "NetBIOS name: DC01 (10.0.0.5)"
    assert rows[0]["affected_component"] == "DC01" and rows[0]["affected_port"] == 137
    assert "00:0c:29:ab:cd:ef" in rows[0]["fields"]["evidence"]


def test_smbmap_writable_readable_default_shares():
    out = ("[+] IP: 10.10.10.5:445\tName: dc01.corp.local\tStatus: Guest session\n"
           "\tDisk                    Permissions\tComment\n"
           "\t----                    -----------\t-------\n"
           "\tADMIN$                  NO ACCESS\tRemote Admin\n"
           "\tIPC$                    READ ONLY\tRemote IPC\n"
           "\tbackups                 READ, WRITE\tNightly backups\n"
           "\tpublic                  READ ONLY\tPublic files\n")
    rows = wst.parse_tool("smbmap", out, "10.10.10.5", 4, "http://10.10.10.5")
    _assert_shape(rows)
    host = next(r for r in rows if "SMB accessible" in r["fields"]["title"])
    assert host["fields"]["severity"] == "info"
    backups = next(r for r in rows if r["affected_component"] == "backups")
    assert backups["fields"]["severity"] == "high"                       # writable non-default = high
    public = next(r for r in rows if r["affected_component"] == "public")
    assert public["fields"]["severity"] == "low"                         # readable non-default = low
    ipc = next(r for r in rows if r["affected_component"] == "IPC$")
    assert ipc["fields"]["severity"] == "info"                           # default share = info
    # NO ACCESS shares are not surfaced
    assert not any(r["affected_component"] == "ADMIN$" for r in rows)


def test_ldapsearch_anonymous_rootdse():
    out = ("dn:\n"
           "domainFunctionality: 7\n"
           "defaultNamingContext: DC=corp,DC=local\n"
           "rootDomainNamingContext: DC=corp,DC=local\n"
           "dnsHostName: DC01.corp.local\n"
           "ldapServiceName: corp.local:dc01$@CORP.LOCAL\n"
           "supportedLDAPVersion: 3\n")
    rows = wst.parse_tool("ldapsearch", out, "10.10.10.5", 5, "http://10.10.10.5")
    _assert_shape(rows)
    anon = next(r for r in rows if "Anonymous LDAP bind" in r["fields"]["title"])
    assert anon["fields"]["severity"] == "medium" and anon["affected_port"] == 389
    assert any("DC=corp,DC=local" in r["fields"]["title"] for r in rows)
    assert "DC01.corp.local" in anon["fields"]["evidence"]


def test_snmpcheck_default_community():
    out = ("snmp-check v1.9 - SNMP enumerator\n\n"
           "[+] Try to connect to 10.0.0.7:161 using SNMPv1 and community 'public'\n\n"
           "[*] System information:\n\n"
           "  Hostname                      : WIN-SRV\n"
           "  Description                   : Hardware: Intel64 - Software: Windows Version 10.0\n"
           "  Uptime system                 : 3 days, 04:12:55.00\n")
    rows = wst.parse_tool("snmpcheck", out, "10.0.0.7", 6, "http://10.0.0.7")
    _assert_shape(rows)
    pub = next(r for r in rows if "default community" in r["fields"]["title"])
    assert pub["fields"]["severity"] == "low" and pub["affected_port"] == 161
    assert "WIN-SRV" in pub["fields"]["evidence"]
    # a timed-out host produces nothing (honest skip)
    miss = ("[+] Try to connect to 10.0.0.7:161 using SNMPv1 and community 'public'\n\n"
            "[!] 10.0.0.7:161 SNMP request timeout\n")
    assert wst.parse_tool("snmpcheck", miss, "10.0.0.7", 6, "http://10.0.0.7") == []


def test_enum4linux_null_session_full():
    doc = {
        "target": {"host": "10.10.10.5"},
        "credentials": {"auth_method": "null", "user": "", "password": ""},
        "listeners": {"LDAP": {"port": 389, "accessible": True},
                      "SMB": {"port": 445, "accessible": True},
                      "SMB over NetBIOS": {"port": 139, "accessible": False}},
        "smb_dialects": {"Supported dialects": {"SMB 1.0": True, "SMB 2.02": True, "SMB 3.0": True},
                         "Preferred dialect": "SMB 3.0", "SMB signing required": False},
        "sessions": {"Null session possible": True},
        "os_info": {"OS": "Windows Server 2019", "OS version": "10.0", "Server type string": "DC"},
        "smb_domain_info": {"NetBIOS computer name": "DC01", "NetBIOS domain name": "CORP",
                            "DNS domain": "corp.local", "FQDN": "DC01.corp.local",
                            "Derived membership": "domain member"},
        "users": {"1000": {"username": "alice"}, "1001": {"username": "bob"}},
        "groups": {"512": {"groupname": "Domain Admins"}},
        "shares": {"IPC$": {"access": {"mapping": "ok", "listing": "denied"}, "comment": "Remote IPC"},
                   "data": {"access": {"mapping": "ok", "listing": "ok"}, "comment": "Data"},
                   "secret": {"access": {"mapping": "denied", "listing": "denied"}, "comment": ""}},
        "policy": {"Minimum password length": 5, "Account lockout threshold": None},
    }
    import json as _j
    rows = wst.parse_tool("enum4linux", "BANNER\n" + _j.dumps(doc) + "\ntrailing", "10.10.10.5", 7,
                          "http://10.10.10.5")
    _assert_shape(rows)
    titles = [r["fields"]["title"] for r in rows]
    assert any("SMBv1" in t for t in titles)
    smbv1 = next(r for r in rows if "SMBv1" in r["fields"]["title"])
    assert smbv1["fields"]["severity"] == "high"
    assert any("signing not required" in t for t in titles)
    assert any("Null SMB session permitted" in t for t in titles)
    users = next(r for r in rows if "users enumerable" in r["fields"]["title"])
    assert users["fields"]["severity"] == "medium" and "2" in users["fields"]["title"]
    assert "alice" in users["fields"]["evidence"] and "bob" in users["fields"]["evidence"]
    # readable non-default share = low; default IPC$ = info; denied share not surfaced
    data = next(r for r in rows if r["affected_component"] == "data")
    assert data["fields"]["severity"] == "low"
    ipc = next(r for r in rows if r["affected_component"] == "IPC$")
    assert ipc["fields"]["severity"] == "info"
    assert not any(r["affected_component"] == "secret" for r in rows)
    assert any("Reachable Windows services" in t for t in titles)
    assert any(r["fields"]["title"].startswith("Password policy") for r in rows)


def test_enum4linux_dead_host_json_is_honest():
    # the exact JSON enum4linux-ng writes for an unreachable target (confirmed live) -> no findings
    dead = ('{"target":{"host":"127.0.0.1"},"credentials":{"auth_method":"null"},'
            '"listeners":{"LDAP":{"port":389,"accessible":false},"SMB":{"port":445,"accessible":false}},'
            '"domain":null,"nmblookup":null,'
            '"errors":{"listeners":{"enum_listeners":["Could not connect"]}}}')
    assert wst.parse_tool("enum4linux", dead, "127.0.0.1", 8, "http://127.0.0.1") == []


def test_rpcclient_null_session_users_groups_domain():
    out = ("\tDC01           Wk Sv PDC Tim NT   \n"
           "\tplatform_id     :\t500\n"
           "\tos version      :\t10.0\n"
           "Domain: CORP  Server: DC01\n"
           "user:[Administrator] rid:[0x1f4]\n"
           "user:[alice] rid:[0x3e8]\n"
           "group:[Domain Admins] rid:[0x200]\n")
    rows = wst.parse_tool("rpcclient", out, "10.10.10.5", 1, "http://10.10.10.5")
    _assert_shape(rows)
    users = next(r for r in rows if "users enumerable via null RPC" in r["fields"]["title"])
    assert users["fields"]["severity"] == "medium" and "2" in users["fields"]["title"]
    assert "alice" in users["fields"]["evidence"] and users["affected_port"] == 445
    assert any("Domain information" in r["fields"]["title"] and "CORP" in r["fields"]["title"] for r in rows)
    assert any(r["fields"]["title"].startswith("SMB/RPC host OS") for r in rows)
    assert any("groups enumerable" in r["fields"]["title"] for r in rows)
    # access-denied null session yields nothing
    assert wst.parse_tool("rpcclient", "Cannot connect: NT_STATUS_ACCESS_DENIED\n", "h", 1, "http://h") == []


def test_nmblookup_name_and_domain():
    out = ("Looking up status of 10.0.0.5\n"
           "\tDC01            <00> -         B <ACTIVE>\n"
           "\tCORP            <1c> - <GROUP> B <ACTIVE>\n"
           "\tCORP            <00> - <GROUP> B <ACTIVE>\n"
           "\n\tMAC Address = 00:0C:29:AB:CD:EF\n")
    rows = wst.parse_tool("nmblookup", out, "10.0.0.5", 2, "http://10.0.0.5")
    _assert_shape(rows)
    host = next(r for r in rows if r["fields"]["title"] == "NetBIOS name: DC01")
    assert host["affected_component"] == "DC01" and host["affected_port"] == 137
    assert "00:0C:29:AB:CD:EF" in host["fields"]["evidence"]
    assert any("NetBIOS/AD domain: CORP" in r["fields"]["title"] for r in rows)
    assert wst.parse_tool("nmblookup", "No reply from 10.0.0.5\n", "h", 2, "http://h") == []


def test_smbclient_null_share_listing():
    out = ("\n\tSharename       Type      Comment\n"
           "\t---------       ----      -------\n"
           "\tIPC$            IPC       Remote IPC\n"
           "\tdata            Disk      Data share\n"
           "\tNETLOGON        Disk      Logon server share\n")
    rows = wst.parse_tool("smbclient", out, "10.10.10.5", 3, "http://10.10.10.5")
    _assert_shape(rows)
    data = next(r for r in rows if r["affected_component"] == "data")
    assert data["fields"]["severity"] == "low" and data["affected_port"] == 445
    ipc = next(r for r in rows if r["affected_component"] == "IPC$")
    assert ipc["fields"]["severity"] == "info"
    netlogon = next(r for r in rows if r["affected_component"] == "NETLOGON")
    assert netlogon["fields"]["severity"] == "info"                      # default share
    # denied with no share table -> nothing
    assert wst.parse_tool("smbclient", "session setup failed: NT_STATUS_ACCESS_DENIED\n",
                          "h", 3, "http://h") == []


def test_snmpwalk_default_community():
    out = ("SNMPv2-MIB::sysDescr.0 = STRING: Hardware: Intel64 Family - Windows Version 10.0\n"
           "SNMPv2-MIB::sysName.0 = STRING: WIN-SRV\n")
    rows = wst.parse_tool("snmpwalk", out, "10.0.0.7", 4, "http://10.0.0.7")
    _assert_shape(rows)
    pub = next(r for r in rows if "default community" in r["fields"]["title"])
    assert pub["fields"]["severity"] == "low" and pub["affected_port"] == 161
    assert "WIN-SRV" in pub["fields"]["evidence"]
    assert wst.parse_tool("snmpwalk", "Timeout: No Response from 10.0.0.7\n", "h", 4, "http://h") == []


def test_onesixtyone_community_spray():
    out = ("10.0.0.7 [public] Hardware: Intel64 - Windows\n"
           "10.0.0.7 [secret123] Hardware: Intel64 - Windows\n")
    rows = wst.parse_tool("onesixtyone", out, "10.0.0.7", 5, "http://10.0.0.7")
    _assert_shape(rows)
    pub = next(r for r in rows if r["affected_component"] == "public")
    assert pub["fields"]["severity"] == "low" and pub["affected_port"] == 161
    guessed = next(r for r in rows if r["affected_component"] == "secret123")
    assert guessed["fields"]["severity"] == "medium"                     # non-default community = medium
    assert wst.parse_tool("onesixtyone", "", "h", 5, "http://h") == []


def test_braa_snmp_walk():
    out = ("10.0.0.7:.1.3.6.1.2.1.1.1.0:Hardware: Intel64 - Windows\n"
           "10.0.0.7:.1.3.6.1.2.1.1.5.0:WIN-SRV\n")
    rows = wst.parse_tool("braa", out, "10.0.0.7", 6, "http://10.0.0.7")
    _assert_shape(rows)
    assert any("SNMP readable via braa" in r["fields"]["title"] for r in rows)
    assert all(r["affected_port"] == 161 for r in rows)
    assert wst.parse_tool("braa", "no response\n", "h", 6, "http://h") == []


def test_lookupsid_anonymous_rid_cycling():
    out = ("[*] Brute forcing SIDs at 10.10.10.5\n"
           "[*] Domain SID is: S-1-5-21-1111111111-2222222222-3333333333\n"
           "500: CORP\\Administrator (SidTypeUser)\n"
           "1000: CORP\\alice (SidTypeUser)\n"
           "512: CORP\\Domain Admins (SidTypeGroup)\n")
    rows = wst.parse_tool("lookupsid", out, "10.10.10.5", 7, "http://10.10.10.5")
    _assert_shape(rows)
    users = next(r for r in rows if "users enumerable via anonymous RID" in r["fields"]["title"])
    assert users["fields"]["severity"] == "medium" and users["affected_port"] == 445
    assert "Administrator" in users["fields"]["evidence"] and "alice" in users["fields"]["evidence"]
    assert any("Domain SID disclosed" in r["fields"]["title"] for r in rows)
    assert wst.parse_tool("lookupsid", "[-] STATUS_ACCESS_DENIED\n", "h", 7, "http://h") == []


def test_samrdump_anonymous_users():
    out = ("[*] Retrieving endpoint list from 10.10.10.5\n"
           "Found domain(s):\n"
           " . CORP\n"
           " . Builtin\n"
           "[*] Looking up users in domain CORP\n"
           "Found user: Administrator, uid = 500\n"
           "Found user: bob, uid = 1001\n")
    rows = wst.parse_tool("samrdump", out, "10.10.10.5", 8, "http://10.10.10.5")
    _assert_shape(rows)
    users = next(r for r in rows if "users enumerable via anonymous SAMR" in r["fields"]["title"])
    assert users["fields"]["severity"] == "medium" and "bob" in users["fields"]["evidence"]
    assert any("SAMR domain(s)" in r["fields"]["title"] and "CORP" in r["fields"]["title"] for r in rows)
    assert wst.parse_tool("samrdump", "[-] SMB SessionError: STATUS_ACCESS_DENIED\n", "h", 8, "http://h") == []


def test_rpcdump_anonymous_epm():
    out = ("[*] Retrieving endpoint list from 10.10.10.5\n"
           "Protocol: [MS-RPRN]: Print System Remote Protocol\n"
           "UUID    : 12345678-1234-abcd-ef00-0123456789ab v1.0\n"
           "Protocol: [MS-SCMR]: Service Control Manager\n"
           "UUID    : 367abb81-9844-35f1-ad32-98f038001003 v2.0\n")
    rows = wst.parse_tool("rpcdump", out, "10.10.10.5", 9, "http://10.10.10.5")
    _assert_shape(rows)
    assert len(rows) == 1 and rows[0]["affected_port"] == 135
    assert "RPC endpoints enumerable" in rows[0]["fields"]["title"]
    assert wst.parse_tool("rpcdump", "[-] Connection refused\n", "h", 9, "http://h") == []


def test_sslscan_ldaps_tls_posture():
    out = ("Version: 2.1.3\n\nConnected to 10.10.10.5\n\n"
           "Testing SSL server dc01.corp.local on port 636 using SNI name dc01.corp.local\n\n"
           "  SSL/TLS Protocols:\n"
           "SSLv2     disabled\nSSLv3     enabled\nTLSv1.0   enabled\nTLSv1.1   disabled\n"
           "TLSv1.2   enabled\nTLSv1.3   disabled\n\n"
           "  Supported Server Cipher(s):\n"
           "Accepted  TLSv1.2  256 bits  ECDHE-RSA-AES256-GCM-SHA384   Curve 25519 DHE 253\n"
           "Accepted  TLSv1.2  128 bits  AES128-SHA\n"
           "Accepted  TLSv1.0  112 bits  DES-CBC3-SHA\n"
           "Accepted  SSLv3    128 bits  RC4-SHA\n\n"
           "  SSL Certificate:\nRSA Key Strength:    2048\nSubject:  dc01.corp.local\n")
    rows = wst.parse_tool("sslscan", out, "10.10.10.5", 10, "http://10.10.10.5")
    _assert_shape(rows)
    assert all(r["affected_port"] == 636 for r in rows)
    tls = next(r for r in rows if r["fields"]["title"].startswith("TLS service"))
    assert tls["fields"]["severity"] == "info" and "dc01.corp.local" in tls["fields"]["title"]
    sslv3 = next(r for r in rows if "SSLv3" in r["fields"]["title"])
    assert sslv3["fields"]["severity"] == "high"
    tls10 = next(r for r in rows if "TLSv1.0" in r["fields"]["title"])
    assert tls10["fields"]["severity"] == "medium"
    # deprecated protocols that are DISABLED are not surfaced
    assert not any("TLSv1.1" in r["fields"]["title"] for r in rows)
    # weak ciphers: 3DES (112-bit) and RC4 flagged; strong AES256/AES128 not
    des = next(r for r in rows if "DES-CBC3-SHA" in r["fields"]["title"])
    assert des["fields"]["severity"] == "medium"
    rc4 = next(r for r in rows if "RC4-SHA" in r["fields"]["title"])
    assert rc4["fields"]["severity"] == "medium"
    assert not any("AES256" in r["fields"]["title"] or "AES128" in r["fields"]["title"] for r in rows)
    # a closed/refused 636 (no protocol lines) -> honest skip
    assert wst.parse_tool("sslscan", "Connection refused\nCould not open a connection.\n",
                          "h", 10, "http://h") == []


def test_rdpseccheck_posture_issues_and_protocols():
    out = ("[+] Scanning 10.10.10.5:3389\n\n"
           "[+] Summary of protocol support\n"
           "[-] 10.10.10.5:3389 supports PROTOCOL_RDP     : TRUE\n"
           "[-] 10.10.10.5:3389 supports PROTOCOL_SSL     : TRUE\n"
           "[-] 10.10.10.5:3389 supports PROTOCOL_HYBRID  : FALSE\n\n"
           "[+] Summary of security issues\n"
           "[-] 10.10.10.5:3389 has issue NLA_NOT_SUPPORTED_OR_DISABLED\n"
           "[-] 10.10.10.5:3389 has issue SSL_WITH_WEAK_RSA_KEYS\n")
    rows = wst.parse_tool("rdp-sec-check", out, "10.10.10.5", 11, "http://10.10.10.5")
    _assert_shape(rows)
    assert all(r["affected_port"] == 3389 for r in rows)
    host = next(r for r in rows if r["fields"]["title"].startswith("RDP service"))
    assert host["fields"]["severity"] == "info"
    nla = next(r for r in rows if "NLA" in r["fields"]["title"] or "Network Level" in r["fields"]["title"])
    assert nla["fields"]["severity"] == "medium"
    std = next(r for r in rows if "Standard RDP Security" in r["fields"]["title"])
    assert std["fields"]["severity"] == "medium"
    weak = next(r for r in rows if "WEAK_RSA" in r["fields"]["title"] or "Weak RDP" in r["fields"]["title"])
    assert weak["fields"]["severity"] == "medium"
    # a hardened host (only TLS+NLA, no issues) -> just the info host row
    hard = ("[+] Summary of protocol support\n"
            "[-] 10.0.0.9:3389 supports PROTOCOL_RDP     : FALSE\n"
            "[-] 10.0.0.9:3389 supports PROTOCOL_SSL     : TRUE\n"
            "[-] 10.0.0.9:3389 supports PROTOCOL_HYBRID  : TRUE\n")
    hrows = wst.parse_tool("rdp-sec-check", hard, "10.0.0.9", 12, "http://10.0.0.9")
    assert len(hrows) == 1 and hrows[0]["fields"]["severity"] == "info"
    # closed/refused 3389 (no protocol/issue lines) -> honest skip
    assert wst.parse_tool("rdp-sec-check", "Connection refused\n", "h", 11, "http://h") == []


def test_polenum_null_session_password_policy():
    out = ("[+] Attaching to 10.10.10.5 using anonymous session\n\n"
           "[+] Password Info for Domain: CORP\n\n"
           "\t[+] Minimum password length: 5\n"
           "\t[+] Password history length: 24\n"
           "\t[+] Account Lockout Threshold: None\n"
           "\t[+] Forced Log off Time: Not Set\n")
    rows = wst.parse_tool("polenum", out, "10.10.10.5", 13, "http://10.10.10.5")
    _assert_shape(rows)
    base = next(r for r in rows if r["fields"]["title"].startswith("Password policy retrieved"))
    assert base["fields"]["severity"] == "low" and base["affected_port"] == 445
    minlen = next(r for r in rows if "minimum password length" in r["fields"]["title"].lower())
    assert minlen["fields"]["severity"] == "medium"
    lockout = next(r for r in rows if "lockout" in r["fields"]["title"].lower())
    assert lockout["fields"]["severity"] == "medium"
    # a strong policy -> just the low base row (no weak-minlen / no-lockout findings)
    strong = ("[+] Password Info for Domain: CORP\n"
              "\t[+] Minimum password length: 14\n"
              "\t[+] Account Lockout Threshold: 5\n")
    srows = wst.parse_tool("polenum", strong, "10.10.10.5", 13, "http://10.10.10.5")
    assert len(srows) == 1 and srows[0]["fields"]["severity"] == "low"
    # access-denied / no policy -> honest skip
    assert wst.parse_tool("polenum", "[-] Failed to connect: STATUS_ACCESS_DENIED\n", "h", 13, "http://h") == []


def test_polenum_is_wired_as_enum4linux_fallback():
    """polenum is a DUPLICATE of enum4linux's null-session policy row, so it must be wired as a fallback
    (never a primary that runs unconditionally)."""
    spec = next(s for s in wst.WIN_SCAN_TOOLS if s["name"] == "polenum")
    assert spec["fallback_for"] == "enum4linux"


def test_fallback_fires_only_when_enum4linux_empty(monkeypatch):
    """Real-registry dispatcher check: polenum (fallback_for=enum4linux) runs ONLY when the flagship
    enumerator ran and produced nothing — and stays dormant when enum4linux succeeds (zero added cost)."""
    import grc.modules.pentest.service as svc

    def _make_run(e4l_stdout):
        calls = []

        def fake_run(lane, argv, timeout=0, input_bytes=None, phase="scan", subtype=None, **_kw):
            calls.append(argv)
            cmd = " ".join(argv)
            if "enum4linux-ng" in cmd:
                return {"stdout": e4l_stdout, "stderr": "", "rc": 0, "error": None}
            if argv and argv[0] == "polenum":
                return {"stdout": ("[+] Password Info for Domain: CORP\n"
                                   "\t[+] Minimum password length: 7\n"
                                   "\t[+] Account Lockout Threshold: None\n"),
                        "stderr": "", "rc": 0, "error": None}
            return {"stdout": "", "stderr": "", "rc": 0, "error": None}   # every other tool: honest empty
        return calls, fake_run

    e4l_ok = '{"users": {"1000": {"username": "alice"}}}'   # enum4linux-ng produces rows -> it "succeeded"
    calls, run = _make_run(e4l_ok)
    monkeypatch.setattr(svc, "_lane_container_run", run)
    rows = svc._lane_scan_arsenal_rows("internal", "windows", "10.10.10.5", 1, "http://10.10.10.5")
    assert any(r["source_slug"] == "enum4linux" for r in rows)
    assert not any(r["source_slug"] == "polenum" for r in rows)          # fallback dormant
    assert not any(a and a[0] == "polenum" for a in calls)               # …and never even ran

    calls, run = _make_run("")                                           # enum4linux ran, produced NOTHING
    monkeypatch.setattr(svc, "_lane_container_run", run)
    rows = svc._lane_scan_arsenal_rows("internal", "windows", "10.10.10.5", 1, "http://10.10.10.5")
    assert any(r["source_slug"] == "polenum" for r in rows)             # fallback picked up the miss
    assert any(a and a[0] == "polenum" for a in calls)


# ---- CREDENTIALED nxc tier (needs_creds) — authenticated SMB read-only enum --------------------------
_CREDS_PREFIX = "SMB         10.10.10.5      445    DC01             "


def _nxc(*body_lines):
    """Wrap body lines in the real `SMB  <host>  445  <NAME>  <body>` nxc prefix."""
    return "\n".join(_CREDS_PREFIX + b for b in body_lines) + "\n"


def test_nxc_creds_shares_write_read_default():
    out = _nxc("[*] Enumerated shares",
               "Share           Permissions     Remark",
               "-----           -----------     ------",
               "ADMIN$                          Remote Admin",
               "C$                              Default share",
               "IPC$            READ            Remote IPC",
               "backups         READ,WRITE",
               "public          READ")
    rows = wst.parse_tool("nxc-creds-shares", out, "10.10.10.5", 20, "http://10.10.10.5")
    _assert_shape(rows)
    assert all(r["source_slug"] == "netexec-creds" and r["affected_port"] == 445 for r in rows)
    backups = next(r for r in rows if r["affected_component"] == "backups")
    assert backups["fields"]["severity"] == "high"                       # writable non-default = high
    public = next(r for r in rows if r["affected_component"] == "public")
    assert public["fields"]["severity"] == "low"                         # readable non-default = low
    ipc = next(r for r in rows if r["affected_component"] == "IPC$")
    assert ipc["fields"]["severity"] == "info"                           # default share = info
    admin = next(r for r in rows if r["affected_component"] == "ADMIN$")
    assert admin["fields"]["severity"] == "info"
    assert wst.parse_tool("nxc-creds-shares", "", "h", 20, "http://h") == []


def test_nxc_creds_users_skips_machine_accounts():
    out = _nxc("[*] Enumerated domain user(s)",
               "corp.local\\Administrator        Built-in account for administering the computer",
               "corp.local\\alice",
               "corp.local\\DC01$")
    rows = wst.parse_tool("nxc-creds-users", out, "10.10.10.5", 21, "http://10.10.10.5")
    _assert_shape(rows)
    names = {r["affected_component"] for r in rows}
    assert names == {"Administrator", "alice"}                           # machine account DC01$ skipped
    assert all(r["fields"]["severity"] == "info" for r in rows)
    assert wst.parse_tool("nxc-creds-users", "", "h", 21, "http://h") == []


def test_nxc_creds_admins_members_and_summary():
    out = _nxc("[+] corp.local\\svc_admin (Pwn3d!)",
               "Alias name     administrators",
               "Comment        Administrators have complete and unrestricted access",
               "Members",
               "-------------------------------------------------------------------------------",
               "Administrator",
               "CORP\\Domain Admins",
               "CORP\\svc_admin",
               "The command completed successfully.")
    rows = wst.parse_tool("nxc-creds-admins", out, "10.10.10.5", 22, "http://10.10.10.5")
    _assert_shape(rows)
    summary = next(r for r in rows if "Local Administrators group membership" in r["fields"]["title"])
    assert summary["fields"]["severity"] == "info" and "3" in summary["fields"]["title"]
    admins = [r for r in rows if r["fields"]["title"].startswith("Local administrator principal")]
    assert {r["affected_component"] for r in admins} == {"Administrator", "CORP\\Domain Admins", "CORP\\svc_admin"}
    assert all(r["fields"]["severity"] == "medium" for r in admins)      # privileged accounts
    # lines before Members (Alias name/Comment) and the Pwn3d! status are NOT members
    assert not any(r["affected_component"] in ("administrators", "Alias name") for r in admins)
    assert wst.parse_tool("nxc-creds-admins", _nxc("[-] Access denied"), "h", 22, "http://h") == []


def test_nxc_creds_passpol_weak_and_strong():
    weak = _nxc("[+] Dumping password info for domain: CORP",
                "Minimum password length: 5",
                "Password history length: 24",
                "Maximum password age: 42 days",
                "Account Lockout Threshold: None")
    rows = wst.parse_tool("nxc-creds-passpol", weak, "10.10.10.5", 23, "http://10.10.10.5")
    _assert_shape(rows)
    base = next(r for r in rows if r["fields"]["title"].startswith("Password policy retrieved"))
    assert base["fields"]["severity"] == "low" and base["affected_port"] == 445
    minlen = next(r for r in rows if "minimum password length" in r["fields"]["title"].lower())
    assert minlen["fields"]["severity"] == "medium"
    lockout = next(r for r in rows if "lockout" in r["fields"]["title"].lower())
    assert lockout["fields"]["severity"] == "medium"
    strong = _nxc("[+] Dumping password info for domain: CORP",
                  "Minimum password length: 14",
                  "Account Lockout Threshold: 5")
    srows = wst.parse_tool("nxc-creds-passpol", strong, "10.10.10.5", 23, "http://10.10.10.5")
    assert len(srows) == 1 and srows[0]["fields"]["severity"] == "low"   # only the base policy row
    assert wst.parse_tool("nxc-creds-passpol", _nxc("[-] STATUS_ACCESS_DENIED"), "h", 23, "http://h") == []


def test_nxc_creds_loggedon_users_and_sessions():
    out = _nxc("[+] Enumerated loggedon users",
               "CORP\\alice           logon_server: DC01",
               "CORP\\bob",
               "[*] Enumerated sessions",
               "\\\\10.0.0.9     user: carol")
    rows = wst.parse_tool("nxc-creds-loggedon", out, "10.10.10.5", 24, "http://10.10.10.5")
    _assert_shape(rows)
    assert {r["affected_component"] for r in rows} == {"alice", "bob", "carol"}
    assert all(r["fields"]["severity"] == "info" and r["affected_port"] == 445 for r in rows)
    assert wst.parse_tool("nxc-creds-loggedon", "", "h", 24, "http://h") == []


def test_nxc_creds_specs_armed_and_gated():
    """Every credentialed spec is needs_creds (dormant without creds) and self-gates on $AVA_SMB_USER,
    and NEVER interpolates the password — the argv references only the quoted shell var "${AVA_SMB_PASS:-}"."""
    creds = [s for s in wst.WIN_SCAN_TOOLS if s["name"].startswith("nxc-creds-")]
    assert len(creds) == 5
    for spec in creds:
        assert spec.get("needs_creds") is True
        joined = " ".join(spec["argv"]("10.10.10.5", "http://10.10.10.5"))
        assert '[ -n "${AVA_SMB_USER:-}" ] || exit 0' in joined          # self-gate
        assert '"${AVA_SMB_PASS:-}"' in joined                           # pass only as a quoted shell var
        assert "--local-auth" in joined and "AVA_SMB_DOMAIN" in joined    # domain-aware auth fragment


# ---- CREDENTIALED wesng tier (needs_creds) — missing MS patch -> CVE (the Nessus alternative) ----------
def test_wesng_creds_missing_patch_cves():
    # REAL wesng -o CSV header (DatePosted,CVE,BulletinKB,Title,AffectedProduct,AffectedComponent,Severity,
    # Impact,Exploits); a leading banner line is tolerated. argv filters to Critical+Important at the tool,
    # but the parser itself never filters by severity — it maps Critical->critical / Important->high / else
    # medium. KB lives in BulletinKB (not "KB"); the Exploits column drives the "public exploit" note.
    out = (
        "Windows Exploit Suggester NG banner line (goes to stdout, ignored)\n"
        "DatePosted,CVE,BulletinKB,Title,AffectedProduct,AffectedComponent,Severity,Impact,Exploits\n"
        "20210413,CVE-2021-28310,5001330,Win32k Elevation of Privilege,Windows 10,win32k,Critical,"
        "Elevation of Privilege,Exploited in the wild\n"
        "20210413,CVE-2021-28437,5001330,Windows Installer Information Disclosure,Windows 10,Installer,"
        "Important,Information Disclosure,\n"
        "20210309,CVE-2021-26877,5000822,Windows DNS Server RCE,Windows Server,DNS,Moderate,"
        "Remote Code Execution,\n"
    )
    rows = wst.parse_tool("wesng-creds", out, "10.10.10.5", 30, "http://10.10.10.5")
    _assert_shape(rows)
    assert len(rows) == 3
    assert all(r["source_slug"] == "wesng" for r in rows)
    crit = next(r for r in rows if r["cve_id"] == "CVE-2021-28310")
    assert crit["fields"]["severity"] == "critical"
    assert crit["affected_component"] == "5001330"                 # KB from BulletinKB column
    assert "CVE-2021-28310" in crit["fields"]["title"] and "missing 5001330" in crit["fields"]["title"]
    assert "public exploit available" in crit["fields"]["evidence"]   # Exploits column non-empty
    assert crit["affected_port"] is None                           # host-level missing-patch finding
    imp = next(r for r in rows if r["cve_id"] == "CVE-2021-28437")
    assert imp["fields"]["severity"] == "high"                     # Important -> high
    assert "public exploit available" not in imp["fields"]["evidence"]
    mod = next(r for r in rows if r["cve_id"] == "CVE-2021-26877")
    assert mod["fields"]["severity"] == "medium"                   # Moderate (anything else) -> medium
    # no CSV / no header / garbage -> honest skip
    assert wst.parse_tool("wesng-creds", "", "h", 30, "http://h") == []
    assert wst.parse_tool("wesng-creds", "no header here\njust noise\n", "h", 30, "http://h") == []


def test_wesng_creds_spec_armed_gated_and_secret_safe():
    spec = next(s for s in wst.WIN_SCAN_TOOLS if s["name"] == "wesng-creds")
    assert spec["needs_creds"] is True
    assert not spec["name"].startswith("nxc-creds-")               # keeps the nxc-creds count at 5
    joined = " ".join(spec["argv"]("10.10.10.5", "http://10.10.10.5"))
    assert '[ -n "${AVA_SMB_USER:-}" ] || exit 0' in joined        # self-gate
    assert '"${AVA_SMB_PASS:-}"' in joined                         # pass only as a quoted shell var
    assert "-x systeminfo" in joined and "--severity Critical Important" in joined
    assert "AVA_SMB_DOMAIN" in joined and "--local-auth" in joined


# ---- CREDENTIALED AD-ENUM tier (needs_creds + DOMAIN-gated) — proactive read-only discovery -----------
def test_getadusers_creds_user_inventory():
    out = ("Impacket v0.13.1 - Copyright Fortra, LLC and its affiliated companies \n\n"
           "[*] Querying corp.local for information about domain.\n"
           "Name                  Email            PasswordLastSet      LastLogon           \n"
           "--------------------  ---------------  -------------------  -------------------\n"
           "Administrator                          2021-08-11 10:24:12  2021-09-01 08:00:00 \n"
           "krbtgt                                 2021-08-11 10:20:00  <never>             \n"
           "svc_sql               sql@corp.local   2021-08-12 09:00:00  2021-09-02 07:30:00 \n")
    rows = wst.parse_tool("getadusers-creds", out, "10.10.10.5", 40, "http://10.10.10.5")
    _assert_shape(rows)
    assert len(rows) == 1 and rows[0]["fields"]["severity"] == "info"
    assert "enumerated with credentials: 3" in rows[0]["fields"]["title"]
    assert rows[0]["affected_port"] == 389 and rows[0]["source_slug"] == "getadusers-creds"
    assert "svc_sql" in rows[0]["fields"]["evidence"] and "Administrator" in rows[0]["fields"]["evidence"]
    assert wst.parse_tool("getadusers-creds", "", "h", 40, "http://h") == []


def test_getuserspns_creds_kerberoastable():
    out = ("Impacket v0.13.1 - Copyright Fortra, LLC\n\n"
           "ServicePrincipalName             Name     MemberOf   PasswordLastSet      LastLogon  Delegation\n"
           "-------------------------------  -------  ---------  -------------------  ---------  ----------\n"
           "MSSQLSvc/sql01.corp.local:1433   svc_sql  CN=g       2021-08-12 09:00:00  <never>              \n"
           "HTTP/web01.corp.local            svc_web  CN=g       2021-07-01 09:00:00  <never>              \n")
    rows = wst.parse_tool("getuserspns-creds", out, "10.10.10.5", 41, "http://10.10.10.5")
    _assert_shape(rows)
    summary = next(r for r in rows if r["fields"]["title"].startswith("Kerberoastable accounts"))
    assert "discovered with credentials: 2" in summary["fields"]["title"]
    acct = [r for r in rows if r["fields"]["title"].startswith("Kerberoastable account:")]
    assert {r["affected_component"] for r in acct} == {"svc_sql", "svc_web"}
    assert all(r["fields"]["severity"] == "medium" and r["affected_port"] == 88 for r in rows)
    assert wst.parse_tool("getuserspns-creds", "", "h", 41, "http://h") == []


def test_getnpusers_creds_asrep_roastable():
    out = ("Impacket v0.13.1 - Copyright Fortra, LLC\n\n"
           "Name       MemberOf     PasswordLastSet      LastLogon  UAC      \n"
           "---------  -----------  -------------------  ---------  --------\n"
           "svc_asrep  CN=Users     2021-08-12 09:00:00  <never>    0x410200 \n"
           "guest                   <never>              <never>    0x410200 \n")
    rows = wst.parse_tool("getnpusers-creds", out, "10.10.10.5", 42, "http://10.10.10.5")
    _assert_shape(rows)
    summary = next(r for r in rows if r["fields"]["title"].startswith("AS-REP roastable accounts"))
    assert "discovered: 2" in summary["fields"]["title"]
    assert all(r["fields"]["severity"] == "high" and r["affected_port"] == 88 for r in rows)
    assert {r["affected_component"] for r in rows if "account (" in r["fields"]["title"]} == {"svc_asrep", "guest"}
    # a 'No entries found' run (pre-auth enforced everywhere) -> honest skip
    assert wst.parse_tool("getnpusers-creds", "Impacket v0.13.1\n\nNo entries found!\n", "h", 42, "http://h") == []


def test_ldapdomaindump_creds_directory_and_flags():
    out = ("===AVALDD:domain_users===\n"
           "cn\tname\tsAMAccountName\tuserAccountControl\n"
           "Administrator\tAdministrator\tAdministrator\tNORMAL_ACCOUNT\n"
           "svc_asrep\tsvc_asrep\tsvc_asrep\tNORMAL_ACCOUNT, DONT_REQ_PREAUTH\n"
           "dc01\tDC01\tDC01$\tSERVER_TRUST_ACCOUNT, TRUSTED_FOR_DELEGATION\n"
           "===AVALDD:domain_groups===\n"
           "cn\tname\n"
           "Domain Admins\tDomain Admins\n"
           "===AVALDD:domain_computers===\n"
           "cn\tname\n"
           "DC01\tDC01\n"
           "===AVALDD:domain_trusts===\n"
           "cn\ttrustDirection\n"
           "child.corp.local\tBidirectional\n")
    rows = wst.parse_tool("ldapdomaindump", out, "10.10.10.5", 43, "http://10.10.10.5")
    _assert_shape(rows)
    summary = next(r for r in rows if r["fields"]["title"].startswith("AD directory dumped"))
    assert "3 users / 1 groups / 1 computers / 1 trusts" in summary["fields"]["title"]
    asrep = next(r for r in rows if "AS-REP roastable accounts in directory" in r["fields"]["title"])
    assert asrep["fields"]["severity"] == "high" and "svc_asrep" in asrep["fields"]["evidence"]
    deleg = next(r for r in rows if "trusted for Kerberos delegation" in r["fields"]["title"])
    assert deleg["fields"]["severity"] == "high" and "dc01" in deleg["fields"]["evidence"]
    assert any("AD trust relationship: child.corp.local" in r["fields"]["title"] for r in rows)
    assert all(r["source_slug"] == "ldapdomaindump" for r in rows)
    # no marker (bind failed / tool absent) -> honest skip, never a fabricated row
    assert wst.parse_tool("ldapdomaindump", "", "h", 43, "http://h") == []
    assert wst.parse_tool("ldapdomaindump", "===AVALDD:domain_users===\ncn\tname\n", "h", 43, "http://h") == []


def test_ad_enum_specs_armed_domain_gated_and_secret_safe():
    """Every AD-enum spec is needs_creds, self-gates on BOTH $AVA_SMB_USER AND $AVA_SMB_DOMAIN (the
    applicability gate — AD enum only against a domain), and references the password ONLY as the quoted
    shell var "${AVA_SMB_PASS:-}" (never interpolated -> absent from the engine argv / ps / logs)."""
    ad = [s for s in wst.WIN_SCAN_TOOLS
          if s["name"] in ("getadusers-creds", "getuserspns-creds", "getnpusers-creds", "ldapdomaindump")]
    assert len(ad) == 4
    for spec in ad:
        assert spec.get("needs_creds") is True
        joined = " ".join(spec["argv"]("10.10.10.5", "http://10.10.10.5"))
        assert '[ -n "${AVA_SMB_USER:-}" ] && [ -n "${AVA_SMB_DOMAIN:-}" ] || exit 0' in joined  # domain gate
        assert "${AVA_SMB_PASS:-}" in joined                       # pass only as a shell-var expansion
        assert "AVA_SMB_PASS=" not in joined                       # never a literal value / assignment
        assert "-request" not in joined and "-save" not in joined  # discovery only — never a hash-grab
    # the four tools wired here are REMOVED from the deferral ledger (no stale entry)
    for gone in ("GetADUsers.py", "GetUserSPNs.py", "GetNPUsers.py", "ldapdomaindump"):
        assert gone not in wst._STILL_UNWIRED_WIN_SCAN_TOOLS


def test_parsers_never_raise_on_garbage():
    everyone = ("netexec", "nbtscan", "smbmap", "ldapsearch", "snmpcheck", "enum4linux",
                "rpcclient", "nmblookup", "smbclient", "snmpwalk", "onesixtyone", "braa",
                "lookupsid", "samrdump", "rpcdump", "sslscan", "rdp-sec-check", "polenum",
                "nxc-creds-shares", "nxc-creds-users", "nxc-creds-admins", "nxc-creds-passpol",
                "nxc-creds-loggedon", "wesng-creds",
                "getadusers-creds", "getuserspns-creds", "getnpusers-creds", "ldapdomaindump")
    for name in everyone:
        assert wst.parse_tool(name, "", "h", 1, "http://h") == []            # empty -> nothing
        assert isinstance(wst.parse_tool(name, "\x00 not\n valid {[", "h", 1, "http://h"), list)  # no raise
    # the JSON-driven parser rejects non-JSON garbage outright (never a fabricated finding)
    assert wst.parse_tool("enum4linux", "\x00 not\n valid {[", "h", 1, "http://h") == []
    assert wst.parse_tool("does-not-exist", "anything", "h", 1, "http://h") == []


def test_registry_specs_bounded_and_readonly():
    names = {s["name"] for s in wst.WIN_SCAN_TOOLS}
    assert {"netexec", "nbtscan", "smbmap", "ldapsearch", "snmpcheck", "enum4linux",
            "rpcclient", "nmblookup", "smbclient", "snmpwalk", "onesixtyone", "braa",
            "lookupsid", "samrdump", "rpcdump", "sslscan", "rdp-sec-check", "polenum"} <= names
    assert len(names) == len(wst.WIN_SCAN_TOOLS)                             # no duplicate spec name
    for spec in wst.WIN_SCAN_TOOLS:
        argv = spec["argv"]("10.10.10.5", "http://10.10.10.5")
        assert isinstance(argv, list) and argv and all(isinstance(a, str) for a in argv)
        assert 0 < int(spec["timeout"]) <= 600                              # every tool is time-bounded
        assert callable(spec["parse"])
        joined = " ".join(argv)
        # unauthenticated + read-only: no creds, no destructive/writey flags leaked into any argv
        assert not any(bad in joined for bad in (" rm -", "--delete", " -X DELETE", "mkfs", "-u admin",
                                                 "--password", "put "))
        # the host/IP is always present in the argv (tool actually targets something)
        assert "10.10.10.5" in joined
