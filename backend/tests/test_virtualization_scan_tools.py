"""virtualization-scan LINKAGE — the ava-virtualization-scan arsenal registry (virtualization_scan_tools) —
hypervisor / virtualization-management fingerprinting + read-only CVE DETECTION.

Deterministic + offline: each parser is fed CAPTURED sample tool output (real nmap NSE / HTTP / ssl-cert
formats) and we assert the normalized finding rows (shape, severity, component, port, source slug). No live
scan, no docker. Rows use the same shape as win_scan_tools._row (kind="network", asset_type="virtualization"
for per-type dedup) so _dedup_findings + _write_rows consume them unchanged. Garbage-safety + a bounded,
read-only, unauthenticated registry are asserted. STANDALONE: imports only the new module, never service.py.
"""
import grc.modules.pentest.virtualization_scan_tools as vst


# ---- row shape contract (matches service._hexstrike_rows so dedup + ingest consume it unchanged) --------
def _assert_shape(rows):
    for r in rows:
        assert r["kind"] == "network"
        assert r["asset_type"] == "virtualization"
        assert set(("vid", "source_slug", "title", "fields")) <= set(r)
        f = r["fields"]
        assert f["severity"] in vst._SEV
        assert f["source"].startswith("ai-pentest:") and f["plugin_family"] == "AI Pentest"
        assert f["status"] == "open" and f["title"] and f["asset_type"] == "virtualization"


def test_nmap_vmware_fingerprint_and_path_traversal():
    out = ("PORT     STATE SERVICE          VERSION\n"
           "443/tcp  open  ssl/https        VMware ESXi SOAP API 6.7.0\n"
           "902/tcp  open  vmware-auth      VMware Authentication Daemon 1.10 (Uses VNC, SOAP)\n"
           "| vmware-version:\n"
           "|   Server version: VMware ESXi 6.7.0\n"
           "|   Build: 8169922\n"
           "|_  OS: VMware ESXi 6.7.0 build-8169922\n"
           "| http-vmware-path-vuln:\n"
           "|   VULNERABLE:\n"
           "|   Path traversal in VMware products (CVE-2009-3733)\n"
           "|     State: VULNERABLE\n"
           "|     IDs:  CVE:CVE-2009-3733\n")
    rows = vst.parse_tool("nmap-vmware", out, "esxi.local", 1, "https://esxi.local")
    _assert_shape(rows)
    # open ports surfaced as info
    p443 = next(r for r in rows if r["affected_port"] == 443 and "Open port" in r["fields"]["title"])
    assert p443["fields"]["severity"] == "info"
    assert any(r["affected_port"] == 902 and "Open port" in r["fields"]["title"] for r in rows)
    # product fingerprint
    fp = next(r for r in rows if r["source_slug"] == "nmap-vmware" and r["fields"]["title"].endswith("detected")
              and "ESXi" in r["fields"]["title"])
    assert "VMware ESXi 6.7.0" in fp["fields"]["title"] and "8169922" in fp["fields"]["title"]
    assert fp["fields"]["severity"] == "info"
    # path traversal DETECTION -> high + CVE
    vuln = next(r for r in rows if "path traversal" in r["fields"]["title"].lower())
    assert vuln["fields"]["severity"] == "high"
    assert vuln["cve_id"] == "CVE-2009-3733"
    assert all(r["source_slug"] == "nmap-vmware" for r in rows)


def test_nmap_vmware_clean_host_no_vuln():
    out = ("PORT     STATE SERVICE     VERSION\n"
           "443/tcp  open  ssl/https   VMware vCenter 8.0.1\n"
           "| vmware-version:\n"
           "|   Server version: VMware vCenter 8.0.1\n"
           "|   Build: 21860503\n")
    rows = vst.parse_tool("nmap-vmware", out, "vc.local", 2, "https://vc.local")
    _assert_shape(rows)
    assert not any(r["fields"]["severity"] == "high" for r in rows)   # no path-traversal verdict
    fp = next(r for r in rows if r["fields"]["title"].endswith("detected"))
    assert "vCenter 8.0.1" in fp["fields"]["title"]


def test_esxi_http_version_probe_and_sdk():
    out = ("HTTP/1.1 200 OK\r\n"
           "Server: VMware ESXi/6.7.0 HTTP reverse proxy\r\n"
           "\r\n"
           "<html><head><title>ID_EESX_Welcome</title></head><body>VMware ESXi</body></html>\n"
           "<namespaces version=\"1.0\"><namespace><name>urn:vim25</name>"
           "<version>8.0.1.0</version></namespace></namespaces>\n")
    rows = vst.parse_tool("esxi-http", out, "esxi.local", 3, "https://esxi.local")
    _assert_shape(rows)
    mgmt = next(r for r in rows if "management interface exposed" in r["fields"]["title"])
    assert mgmt["fields"]["severity"] == "info" and "VMware ESXi" in mgmt["fields"]["title"]
    sdk = next(r for r in rows if "/sdk" in r["fields"]["title"])
    assert sdk["affected_component"] == "/sdk" and "8.0.1.0" in sdk["fields"]["title"]
    # a non-VMware host -> honest skip
    assert vst.parse_tool("esxi-http", "HTTP/1.1 200 OK\r\nServer: nginx\r\n\r\n<html>hi</html>",
                          "x", 3, "https://x") == []


def test_proxmox_http_probe():
    out = ("<html><head><title>pve01 - Proxmox Virtual Environment</title></head>\n"
           "pve-manager/7.4-3/9002ab8a (running kernel: 5.15.102-1-pve)\n")
    rows = vst.parse_tool("proxmox-http", out, "pve.local", 4, "https://pve.local:8006")
    _assert_shape(rows)
    assert len(rows) == 1
    r = rows[0]
    assert r["affected_port"] == 8006 and r["fields"]["severity"] == "info"
    assert "7.4-3" in r["fields"]["title"]
    # a non-Proxmox host -> honest skip
    assert vst.parse_tool("proxmox-http", "<html>nothing here</html>", "x", 4, "https://x:8006") == []


def test_hv_ports_platform_map():
    out = ("PORT     STATE SERVICE       VERSION\n"
           "902/tcp  open  vmware-auth   VMware Authentication Daemon 1.10\n"
           "2179/tcp open  vmrdp         Microsoft Hyper-V VMConnect\n"
           "5900/tcp open  vnc           VNC (protocol 3.8)\n"
           "8006/tcp open  wsman         Proxmox VE\n"
           "443/tcp  open  ssl/http      XAPI/XenServer management\n"
           "22/tcp   open  ssh           OpenSSH 8.4\n")
    rows = vst.parse_tool("hv-ports", out, "hv.local", 5, "https://hv.local")
    _assert_shape(rows)
    comps = {r["affected_component"] for r in rows}
    assert {"esxi-agent", "hyperv-vmconnect", "vnc", "proxmox", "xapi"} <= comps
    vnc = next(r for r in rows if r["affected_component"] == "vnc")
    assert vnc["fields"]["severity"] == "low" and vnc["affected_port"] == 5900
    prox = next(r for r in rows if r["affected_component"] == "proxmox")
    assert prox["fields"]["severity"] == "info" and prox["affected_port"] == 8006
    # ssh (22) is not a hypervisor mgmt port -> not surfaced
    assert not any(r["affected_port"] == 22 for r in rows)


def test_ssl_cert_self_signed_expired_weak():
    out = ("443/tcp open  https\n"
           "| ssl-cert: Subject: commonName=localhost.localdomain/organizationName=VMware Installer\n"
           "| Issuer: commonName=localhost.localdomain/organizationName=VMware Installer\n"
           "| Public Key type: rsa\n"
           "| Public Key bits: 1024\n"
           "| Not valid before: 2019-03-01T00:00:00\n"
           "| Not valid after:  2021-03-01T00:00:00\n"
           "|_SHA-1: ab:cd\n")
    rows = vst.parse_tool("ssl-cert", out, "esxi.local", 6, "https://esxi.local")
    _assert_shape(rows)
    assert all(r["affected_port"] == 443 for r in rows)
    base = next(r for r in rows if r["fields"]["title"].startswith("TLS certificate"))
    assert base["fields"]["severity"] == "info"
    ss = next(r for r in rows if "Self-signed" in r["fields"]["title"])
    assert ss["fields"]["severity"] == "medium"
    exp = next(r for r in rows if "Expired" in r["fields"]["title"])
    assert exp["fields"]["severity"] == "medium"
    weak = next(r for r in rows if "Weak TLS key" in r["fields"]["title"])
    assert weak["fields"]["severity"] == "medium" and "1024" in weak["fields"]["title"]


def test_ssl_cert_valid_ca_signed_current():
    # CA-signed (Subject != Issuer), strong key, far-future expiry -> only the info base row
    out = ("| ssl-cert: Subject: commonName=vc.corp.example.com\n"
           "| Issuer: commonName=DigiCert TLS RSA SHA256 2020 CA1\n"
           "| Public Key bits: 4096\n"
           "| Not valid after:  2099-01-01T00:00:00\n")
    rows = vst.parse_tool("ssl-cert", out, "vc.local", 7, "https://vc.local")
    _assert_shape(rows)
    assert len(rows) == 1 and rows[0]["fields"]["severity"] == "info"
    assert vst.parse_tool("ssl-cert", "443/tcp open https\nno cert here\n", "x", 7, "https://x") == []


def test_sslscan_reused_from_web_lane():
    # the TLS cipher/protocol posture parser is the web lane's, reused wholesale (DRY) — just confirm it is
    # wired and produces our-shaped rows for a weak endpoint.
    out = ("Testing SSL server vc.local on port 443\n\n"
           "  SSL/TLS Protocols:\n"
           "SSLv3     enabled\nTLSv1.2   enabled\n\n"
           "  Supported Server Cipher(s):\n"
           "Accepted  SSLv3    128 bits  RC4-SHA\n")
    rows = vst.parse_tool("sslscan", out, "vc.local", 8, "https://vc.local")
    # the web parser emits its own kind; only assert it never raises and returns a list
    assert isinstance(rows, list)


def test_parsers_never_raise_on_garbage():
    everyone = ("nmap-vmware", "esxi-http", "proxmox-http", "hv-ports", "ssl-cert", "sslscan")
    for name in everyone:
        assert vst.parse_tool(name, "", "h", 1, "https://h") == []                 # empty -> nothing
        assert isinstance(vst.parse_tool(name, "\x00 not\n valid {[", "h", 1, "https://h"), list)  # no raise
    assert vst.parse_tool("does-not-exist", "anything", "h", 1, "https://h") == []


def test_registry_specs_bounded_and_readonly():
    names = {s["name"] for s in vst.VIRTUALIZATION_SCAN_TOOLS}
    assert {"nmap-vmware", "esxi-http", "proxmox-http", "hv-ports", "ssl-cert", "sslscan"} <= names
    assert len(names) == len(vst.VIRTUALIZATION_SCAN_TOOLS)                         # no duplicate spec name
    for spec in vst.VIRTUALIZATION_SCAN_TOOLS:
        argv = spec["argv"]("esxi.local", "https://esxi.local")
        assert isinstance(argv, list) and argv and all(isinstance(a, str) for a in argv)
        assert 0 < int(spec["timeout"]) <= 600                                     # every tool is time-bounded
        assert callable(spec["parse"])
        joined = " ".join(argv)
        # unauthenticated + read-only: no creds, no destructive flags leaked into any argv
        assert not any(bad in joined for bad in ("--password", " -u admin", " rm -", "--delete",
                                                 " -X DELETE", "mkfs", "msfconsole", "exploit "))
        assert "esxi.local" in joined                                              # argv actually targets host
