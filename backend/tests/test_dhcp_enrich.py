"""Unit tests for the DHCP-enrichment core (parsers + fingerprint + packet).

All pure functions — no network, no DB. The enrichment DB path is covered
separately; here we lock the per-vendor parsing and the vendor-class inference,
which is where the real, breakable logic lives.
"""
import struct

from grc.modules.asset_discovery.services.dhcp_enrich import (
    normalize_mac, guess_from_dhcp,
    parse_mikrotik, parse_dnsmasq, parse_isc_dhcpd, parse_windows_leases,
    parse_dhcp_packet,
)


def test_normalize_mac_forms():
    assert normalize_mac("14:EB:B6:47:24:F5") == "14:eb:b6:47:24:f5"
    assert normalize_mac("14-eb-b6-47-24-f5") == "14:eb:b6:47:24:f5"
    assert normalize_mac("14ebb64724f5") == "14:eb:b6:47:24:f5"
    assert normalize_mac("garbage") is None
    assert normalize_mac(None) is None


def test_parse_mikrotik():
    text = (
        ' 0 address=10.11.10.103 mac-address=14:EB:B6:47:24:F5 host-name="7XG4LQ3" status=bound\n'
        ' 1 address=10.11.10.190 mac-address=28:D0:EA:F9:34:7C host-name="KING-Z" status=bound\n'
        ' 2 address=10.11.10.55 mac-address=90:78:41:51:0D:10 status=bound\n'  # no host-name
    )
    leases = parse_mikrotik(text)
    by_ip = {l.ip: l for l in leases}
    assert by_ip["10.11.10.103"].hostname == "7XG4LQ3"
    assert by_ip["10.11.10.103"].mac == "14:eb:b6:47:24:f5"
    assert by_ip["10.11.10.190"].hostname == "KING-Z"
    assert by_ip["10.11.10.55"].hostname is None      # gracefully absent, still a lease
    assert len(leases) == 3


def test_parse_dnsmasq():
    text = (
        "1691085600 14:eb:b6:47:24:f5 10.11.10.103 7XG4LQ3 01:14:eb:b6:47:24:f5\n"
        "1691085601 a8:6d:aa:df:fb:dd 10.11.10.46 5CG9177BS2 *\n"
        "1691085602 ee:63:09:de:d2:fb 10.11.10.241 * 01:ee:63:09:de:d2:fb\n"     # no hostname
    )
    leases = parse_dnsmasq(text)
    by_ip = {l.ip: l for l in leases}
    assert by_ip["10.11.10.103"].hostname == "7XG4LQ3"
    assert by_ip["10.11.10.46"].mac == "a8:6d:aa:df:fb:dd"
    assert by_ip["10.11.10.241"].hostname is None       # '*' placeholder dropped
    assert len(leases) == 3


def test_parse_isc_dhcpd():
    text = (
        'lease 10.11.10.103 {\n'
        '  starts 4 2026/08/03 17:00:00;\n'
        '  hardware ethernet 14:eb:b6:47:24:f5;\n'
        '  client-hostname "7XG4LQ3";\n'
        '  set vendor-class-identifier "MSFT 5.0";\n'
        '}\n'
        'lease 10.11.10.13 {\n'
        '  hardware ethernet 48:9e:9d:88:f6:45;\n'
        '}\n'
    )
    leases = parse_isc_dhcpd(text)
    by_ip = {l.ip: l for l in leases}
    assert by_ip["10.11.10.103"].hostname == "7XG4LQ3"
    assert by_ip["10.11.10.103"].mac == "14:eb:b6:47:24:f5"
    assert by_ip["10.11.10.103"].vendor_class == "MSFT 5.0"
    assert by_ip["10.11.10.13"].hostname is None
    assert len(leases) == 2


def test_parse_windows_leases_csv():
    text = (
        '#TYPE Microsoft.Management.Infrastructure.CimInstance\n'
        'IPAddress,ScopeId,ClientId,HostName,AddressState\n'
        '10.11.10.103,10.11.10.0,14-eb-b6-47-24-f5,7XG4LQ3.corp.local,Active\n'
        '10.11.10.232,10.11.10.0,00-15-5d-01-02-03,DESKTOP-CE3EFJB,Active\n'
    )
    leases = parse_windows_leases(text)
    by_ip = {l.ip: l for l in leases}
    assert by_ip["10.11.10.103"].hostname == "7XG4LQ3.corp.local"
    assert by_ip["10.11.10.103"].mac == "14:eb:b6:47:24:f5"
    assert by_ip["10.11.10.232"].hostname == "DESKTOP-CE3EFJB"
    assert len(leases) == 2


def test_guess_from_dhcp_vendor_class():
    assert guess_from_dhcp("MSFT 5.0") == ("host", "windows")
    assert guess_from_dhcp("android-dhcp-13") == ("host", "android")
    assert guess_from_dhcp("dhcpcd-9.4.1") == ("host", "linux")
    assert guess_from_dhcp("Hewlett-Packard JetDirect") == ("printer", None)
    assert guess_from_dhcp("Cisco Systems, Inc. IP Phone") == ("network_device", None)
    assert guess_from_dhcp("some-unknown-vendor") == (None, None)
    assert guess_from_dhcp(None) == (None, None)


def _make_dhcp_packet(mac_hex: str, hostname: str, vendor_class: str) -> bytes:
    """Build a minimal valid BOOTP/DHCP DISCOVER for the passive parser test."""
    pkt = bytearray(240)
    pkt[0] = 1            # op = BOOTREQUEST
    pkt[1] = 1            # htype = ethernet
    pkt[2] = 6            # hlen
    mac = bytes.fromhex(mac_hex.replace(":", ""))
    pkt[28:28 + len(mac)] = mac
    pkt[236:240] = b"\x63\x82\x53\x63"   # magic cookie
    opts = bytearray()
    opts += bytes([53, 1, 1])            # DHCP message type = DISCOVER
    hb = hostname.encode()
    opts += bytes([12, len(hb)]) + hb    # Option 12 hostname
    vb = vendor_class.encode()
    opts += bytes([60, len(vb)]) + vb    # Option 60 vendor class
    opts += bytes([55, 3, 1, 3, 6])      # Option 55 param list
    opts += bytes([255])                 # END
    return bytes(pkt) + bytes(opts)


def test_parse_dhcp_packet():
    data = _make_dhcp_packet("14:eb:b6:47:24:f5", "Umars-iPhone", "android-dhcp-13")
    lease = parse_dhcp_packet(data)
    assert lease is not None
    assert lease.mac == "14:eb:b6:47:24:f5"
    assert lease.hostname == "Umars-iPhone"
    assert lease.vendor_class == "android-dhcp-13"
    assert lease.param_list == "1,3,6"
    assert lease.source == "passive"


def test_parse_dhcp_packet_rejects_non_dhcp():
    assert parse_dhcp_packet(b"not a dhcp packet") is None
    assert parse_dhcp_packet(b"\x00" * 240) is None   # no magic cookie
