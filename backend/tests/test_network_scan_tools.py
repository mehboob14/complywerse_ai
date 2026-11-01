"""network-scan LINKAGE — the ava-netdev-scan arsenal registry (network_scan_tools) parsed over CAPTURED
sample tool output. STANDALONE: imports ONLY the new module (not service.py). Deterministic + offline; no
live scan, no docker, no device. Asserts the normalized finding rows (shape, severity, port/component,
corroboration-ready source slug), the credential-gating flags, the registry wiring (every spec is callable),
and honest skips. Focus is the NEWLY wired device tools — nuclei (device-template breadth) and ike-scan
(IPsec VPN gateway) — plus the shared row contract on the reused parsers.
"""
import grc.modules.pentest.network_scan_tools as nst


# ---- row shape contract (matches linux _lrow so dedup + ingest consume it unchanged) -------------------
def _assert_shape(rows):
    for r in rows:
        assert r["kind"] == "network"
        assert set(("vid", "source_slug", "title", "fields")) <= set(r)
        f = r["fields"]
        assert f["severity"] in nst._SEV
        assert f["source"].startswith("ai-pentest:") and f["plugin_family"] == "AI Pentest"
        assert f["status"] == "open" and f["title"]
        assert f["affected_host"]                          # a netdev finding always names its device host


# ---- registry wiring: every spec has a name/argv/parse and parse_tool dispatches to each ---------------
def test_registry_wiring_every_spec_callable():
    names = {s["name"] for s in nst.NETWORK_SCAN_TOOLS}
    assert {"nmap", "nuclei", "onesixtyone", "snmpwalk", "ssh-audit", "sslscan", "ike-scan",
            "netdev-config", "snmpv3"} <= names
    for spec in nst.NETWORK_SCAN_TOOLS:
        assert callable(spec["parse"]) and callable(spec["argv"])
        # argv builds without raising and yields a non-empty command list
        argv = spec["argv"]("10.0.0.1", "https://10.0.0.1")
        assert isinstance(argv, list) and argv
        # every parser honest-skips empty input
        assert nst.parse_tool(spec["name"], "", "10.0.0.1", 1, "https://10.0.0.1") == []
    # nuclei no longer deferred; the device tools that stay in the exploit lane / host sweep are recorded
    assert "nuclei" not in nst._STILL_UNWIRED_NETWORK_SCAN_TOOLS
    assert "metasploit" in nst._STILL_UNWIRED_NETWORK_SCAN_TOOLS


# ---- nuclei -jsonl: device CVE + misconfig breadth (severity map, cve extraction, port, dedup) ---------
def test_nuclei_device_cve_and_misconfig():
    out = (
        '{"template-id":"CVE-2018-0296","info":{"name":"Cisco ASA Path Traversal",'
        '"severity":"high","classification":{"cve-id":["CVE-2018-0296"]}},'
        '"matched-at":"https://10.0.0.1:8443/+CSCOE+/"}\n'
        'not-json banner line\n'
        '{"template-id":"fortinet-fortios-panel","info":{"name":"FortiOS Admin Login Panel",'
        '"severity":"info"},"matched-at":"https://10.0.0.1"}\n'
        # duplicate of the first (same template+matched-at) must be collapsed
        '{"template-id":"CVE-2018-0296","info":{"name":"Cisco ASA Path Traversal","severity":"high"},'
        '"matched-at":"https://10.0.0.1:8443/+CSCOE+/"}\n'
    )
    rows = nst.parse_tool("nuclei", out, "10.0.0.1", 7, "https://10.0.0.1")
    _assert_shape(rows)
    assert len(rows) == 2, rows                                    # dup collapsed, non-json skipped
    cve = {r["cve_id"]: r for r in rows if r["cve_id"]}
    assert "CVE-2018-0296" in cve
    assert cve["CVE-2018-0296"]["fields"]["severity"] == "high"
    assert cve["CVE-2018-0296"]["fields"]["affected_port"] == 8443
    assert all(r["source_slug"] == "nuclei" for r in rows)
    # honest skip on garbage / empty
    assert nst.parse_tool("nuclei", "totally not json\n", "h", 1, "https://h") == []


def test_nuclei_argv_is_bare_tag_filtered_and_device_tags_present():
    argv = nst._nuclei_argv("10.0.0.1", "https://10.0.0.1")
    assert argv[0] == "nuclei"                                     # BARE argv so _lane_container_run injects -t
    assert "-jsonl" in argv and "-tags" in argv
    tags = argv[argv.index("-tags") + 1]
    for t in ("router", "firewall", "cisco", "fortinet", "snmp", "telnet", "default-login", "vpn"):
        assert t in tags
    # read-only + severity-bounded so the tag-filtered subset stays within budget
    assert "-etags" in argv and "dos,fuzz,intrusive" in argv
    assert "medium,high,critical" in argv


# ---- ike-scan: IPsec VPN gateway + aggressive-mode PSK exposure + weak crypto --------------------------
def test_ikescan_main_mode_gateway_and_weak_crypto():
    out = (
        "Starting ike-scan 1.9.5 with 1 hosts\n"
        "10.0.0.1\tMain Mode Handshake returned HDR=(CKY-R=abc) "
        "SA=(Enc=3DES Hash=SHA1 Group=2:modp1024 Auth=PSK LifeType=Seconds LifeDuration=28800) "
        "VID=1234 (Cisco Unity)\n"
        "Ending ike-scan: 1 hosts scanned, 1 returned handshake\n"
    )
    rows = nst.parse_tool("ike-scan", out, "10.0.0.1", 3, "https://10.0.0.1")
    _assert_shape(rows)
    by_key = {r["title"]: r for r in rows}
    gw = next(r for r in rows if "VPN gateway" in r["title"])
    assert gw["fields"]["severity"] == "info" and gw["fields"]["affected_port"] == 500
    assert "Cisco" in gw["title"]                                  # vendor lifted from the VID
    weak = next(r for r in rows if "weak crypto" in r["title"])
    assert weak["fields"]["severity"] == "low"
    assert all(r["source_slug"] == "ike-scan" for r in rows)


def test_ikescan_aggressive_mode_is_medium():
    out = ("10.0.0.1\tAggressive Mode Handshake returned HDR=(CKY-R=abc) "
           "SA=(Enc=AES Hash=SHA256 Group=14:modp2048 Auth=PSK) "
           "VID=... ID(Type=ID_IPV4_ADDR, Value=10.0.0.1)\n")
    rows = nst.parse_tool("ike-scan", out, "10.0.0.1", 3, "https://10.0.0.1")
    _assert_shape(rows)
    aggr = next(r for r in rows if "Aggressive Mode" in r["title"])
    assert aggr["fields"]["severity"] == "medium" and aggr["fields"]["affected_port"] == 500
    # strong transform (AES/SHA256/modp2048) -> no weak-crypto row
    assert not any("weak crypto" in r["title"] for r in rows)


def test_ikescan_no_handshake_is_honest_empty():
    out = ("Starting ike-scan 1.9.5\n"
           "Ending ike-scan: 1 hosts scanned, 0 returned handshake; 0 returned notify\n")
    assert nst.parse_tool("ike-scan", out, "10.0.0.1", 3, "https://10.0.0.1") == []


# ---- a reused parser still carries the netdev row contract (nmap device fingerprint) -------------------
def test_nmap_netdev_telnet_and_webmgmt_fingerprint():
    out = ("23/tcp open  telnet\n"
           "80/tcp open  http\n"
           "|_http-title: RouterOS router configuration page\n")
    rows = nst.parse_tool("nmap", out, "10.0.0.1", 5, "http://10.0.0.1")
    _assert_shape(rows)
    assert any(r["fields"]["affected_component"] == "telnet" for r in rows)
    assert any("RouterOS" in r["title"] or "MikroTik" in r["title"] for r in rows)


# ---- credentialed tier flags + honest skip on a failed login ------------------------------------------
def test_credentialed_specs_gated_and_honest():
    gated = {s["name"]: s for s in nst.NETWORK_SCAN_TOOLS if s.get("needs_creds")}
    assert {"netdev-config", "snmpv3"} <= set(gated)
    # a failed SSH login returns no config markers -> honest []
    assert nst.parse_tool("netdev-config", "Permission denied (publickey,password).", "h", 1, "https://h") == []
    # a Cisco running-config with a weak signature -> the config row + the signature row
    cfg = ("Building configuration...\nhostname edge-rtr\nline vty 0 4\n transport input telnet\n"
           "snmp-server community public RO\n")
    rows = nst.parse_tool("netdev-config", cfg, "10.0.0.1", 1, "https://10.0.0.1")
    _assert_shape(rows)
    assert any("Telnet" in r["title"] for r in rows)
