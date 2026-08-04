"""Metasploit RPC (msfrpcd) adapter — pen-test inbound.

Talks to `msfrpcd` over its HTTPS RPC interface. Pulls successful
`session` rows + their loot to confirm "this CVE was exploited
on this host" — boosts vuln priority and links into the pen-test
findings register.

Auth: token-based. `msfrpcd -P <password>` issues a token via
`auth.login`. We cache the token in `oauth_tokens['msfrpc_token']`
so we don't re-auth on every call.

Note: the `python-msfrpc` library is unmaintained — this adapter
talks MessagePack-RPC directly over HTTPS using `requests` + the
official msgpack-python lib.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests

from ..base import ConnectionTestResult, ExploitConfirmation, PenTestAdapter
from ..registry import ProviderField, ProviderMeta

logger = logging.getLogger(__name__)


class MetasploitAdapter(PenTestAdapter):
    provider = "metasploit"

    # ─── Helpers ────────────────────────────────────────────────────

    def _rpc(self, method: str, *args: Any) -> Any:
        try:
            import msgpack
        except ImportError as exc:
            raise RuntimeError(
                "Metasploit adapter requires the `msgpack` Python package. "
                "Install it in the worker image before enabling this connector."
            ) from exc

        token = self.oauth_tokens.get("msfrpc_token")
        if not token and method != "auth.login":
            token = self._login(msgpack)

        # auth.login is the only method that doesn't take the token as first arg
        if method == "auth.login":
            payload = [method, *args]
        else:
            payload = [method, token, *args]

        body = msgpack.packb(payload, use_bin_type=False)
        resp = requests.post(
            f"{self.console_url}/api/",
            data=body,
            headers={"Content-Type": "binary/message-pack"},
            verify=self.verify_ssl,
            timeout=30,
        )
        if resp.status_code != 200:
            raise RuntimeError(
                f"msfrpcd returned {resp.status_code}: {resp.text[:200]}"
            )
        return msgpack.unpackb(resp.content, raw=False)

    def _login(self, msgpack_mod) -> str:
        user = self.credentials.get("username") or "msf"
        pwd = self.credentials.get("password")
        if not pwd:
            raise RuntimeError("Metasploit credentials missing password")
        reply = self._rpc("auth.login", user, pwd)
        token = reply.get("token") if isinstance(reply, dict) else None
        if not token:
            raise RuntimeError(f"msfrpcd auth.login failed: {reply!r}")
        # Cache for next call within the adapter lifetime.
        self.oauth_tokens["msfrpc_token"] = token
        return token

    # ─── BaseConnectorAdapter ───────────────────────────────────────

    def test_connection(self) -> ConnectionTestResult:
        try:
            reply = self._rpc("core.version")
            version = reply.get("version") if isinstance(reply, dict) else None
            return ConnectionTestResult(
                success=True,
                message="Authenticated to msfrpcd.",
                server_version=version or "unknown",
                details=reply if isinstance(reply, dict) else {},
            )
        except Exception as exc:
            logger.exception("Metasploit test_connection failed")
            return ConnectionTestResult(success=False, message=str(exc))

    # ─── PenTestAdapter ─────────────────────────────────────────────

    def fetch_exploits(
        self,
        *,
        since: Optional[datetime] = None,
        limit: int = 500,
    ) -> List[ExploitConfirmation]:
        sessions_reply = self._rpc("session.list")
        if not isinstance(sessions_reply, dict):
            return []

        confirmations: List[ExploitConfirmation] = []
        for sess_id, info in sessions_reply.items():
            if not isinstance(info, dict):
                continue
            opened = info.get("opened") or info.get("session_host_open_time") or time.time()
            try:
                ts = datetime.fromtimestamp(float(opened), tz=timezone.utc)
            except Exception:
                ts = datetime.now(timezone.utc)
            if since and ts < since:
                continue

            exploit = info.get("via_exploit") or info.get("exploit") or ""
            host = info.get("session_host") or info.get("target_host")
            ip = info.get("tunnel_peer") or info.get("ip")
            # CVEs are inferred from the exploit module name when not annotated.
            cve_ids = _cves_from_exploit_name(exploit)

            confirmations.append(ExploitConfirmation(
                source_id=str(sess_id),
                timestamp=ts,
                cve_ids=cve_ids,
                target_host=host,
                target_ip=ip,
                exploit_name=exploit,
                payload=info.get("via_payload"),
                raw=info,
            ))
            if len(confirmations) >= limit:
                break
        return confirmations


def _cves_from_exploit_name(name: str) -> List[str]:
    """Best-effort CVE extraction from a Metasploit module path like
    `exploit/windows/smb/ms17_010_eternalblue` → `[CVE-2017-0143, …]`.

    We can't do this purely from the path; we just look for explicit
    `cve_YYYY_NNNN` patterns embedded in module names some modules use.
    Adapter returns empty when nothing parses, and the consumer falls
    back to per-host matching.
    """
    import re
    matches = re.findall(r"cve[\-_](\d{4})[\-_](\d{4,7})", name or "", re.IGNORECASE)
    return [f"CVE-{y}-{n}" for y, n in matches]


META = ProviderMeta(
    provider="metasploit",
    label="Metasploit",
    category="pentest",
    description="Pull successful exploit sessions from msfrpcd. Confirmed exploits boost the linked vulnerabilities' composite priority.",
    auth_method="token",
    fields=[
        ProviderField(key="console_url", label="msfrpcd URL", kind="url",
                      placeholder="https://msfrpcd.example.com:55553",
                      is_credential=False),
        ProviderField(key="username", label="RPC username",
                      kind="text", required=False, placeholder="msf"),
        ProviderField(key="password", label="RPC password",
                      kind="password", required=True),
    ],
    adapter_cls=MetasploitAdapter,
    docs_url="https://docs.metasploit.com/api/Msf/RPC/RPC_Auth.html",
)
