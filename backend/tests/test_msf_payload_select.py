"""MsfRpc._select_payload — the module-compatibility payload picker that makes real exploits LAND.

Regression guard for the live-fire finding (2026-10-10): the engine used to force one payload
(generic/shell_reverse_tcp) on every module, so modules whose only compatible payloads are cmd/unix/bind_*
(vsftpd backdoor, distcc, UnrealIRCd) never opened a session. The picker must prefer a BIND / no-callback
shell, skip target-altering payloads, and only pick reverse when a callback route exists. Pure function —
no msfrpcd needed."""
from grc.modules.connectors.providers.metasploit_rpc import MsfRpc

sel = MsfRpc._select_payload


def test_empty_returns_none():
    assert sel([]) is None


def test_bind_preferred_over_reverse_without_callback():
    # distcc-style list: must pick the bind shell, never the reverse (no LHOST route on the VPN'd box).
    out = sel(["cmd/unix/reverse_bash", "cmd/unix/bind_perl"], reverse_ok=False)
    assert out == "cmd/unix/bind_perl"


def test_cmd_unix_bind_preferred_over_generic():
    # a cmd-exec module (distcc/unrealircd/samba backdoor) lists both; cmd/unix/bind_perl MUST win because
    # generic/shell_bind_tcp stages a binary the cmd backdoor can't launch (this was the unrealircd no-session bug).
    out = sel(["generic/shell_bind_tcp", "cmd/unix/bind_perl"])
    assert out == "cmd/unix/bind_perl"


def test_skips_target_altering_payloads():
    # adduser/chmod MODIFY the target — never auto-selected; the bind shell wins.
    out = sel(["cmd/unix/adduser", "cmd/unix/bind_perl", "cmd/linux/ftp/x86/exec"])
    assert out == "cmd/unix/bind_perl"


def test_reverse_only_when_callback_route_exists():
    only_reverse = ["cmd/unix/reverse", "cmd/unix/reverse_bash"]
    assert sel(only_reverse, reverse_ok=False) is None          # no route -> refuse to pick a reverse
    assert sel(only_reverse, reverse_ok=True) == "cmd/unix/reverse"


def test_hint_honored_only_when_compatible():
    # a hint that the module does NOT accept is ignored (that was the old bug); a compatible non-bind/non-
    # reverse payload is still returned so the fire can proceed.
    assert sel(["cmd/unix/generic"], hint="generic/shell_bind_tcp") == "cmd/unix/generic"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
    print("all payload-select self-checks passed")
