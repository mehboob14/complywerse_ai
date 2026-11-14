"""Seed SSH host keys before a parallel compliance scan fans out.

Root cause of the "Host key verification failed" error storm: ``_do_scan_all``
runs up to ``AVA_SCAN_CONCURRENCY`` (default 10) SSH sessions at once. On the
FIRST scan of a host its key isn't in ``~/.ssh/known_hosts`` yet, so every
worker races to add it — oscap-ssh via ``StrictHostKeyChecking=accept-new``,
paramiko via its missing-host-key policy — and the concurrent reads/writes of
the single ``known_hosts`` file collide. Most workers are then rejected with
"Host key verification failed" while the file churns (confirmed in the wild:
``known_hosts.old`` + mid-scan mtimes, 1282/2041 rules errored on one host).

Seeding each target's key ONCE, serially, before the pool starts removes the
race. Host-key verification stays fully enabled afterwards: we add the host's
real key via the same trust-on-first-use the scanner already used — we do not
disable checking and we do not hardcode any key.

shortcut: appends to ``~/.ssh/known_hosts`` without a file lock, so two scans of
the SAME brand-new host in the same instant could double-write a line (harmless
— ssh dedupes host keys on read). Add a lock if concurrent scans of new hosts
become common.
"""
from __future__ import annotations

import logging
import os
import subprocess
from pathlib import Path
from typing import Iterable, Tuple

logger = logging.getLogger(__name__)

# Targets that are scanned in-process / never over SSH — nothing to seed.
_LOCAL_HOSTS = {"", "127.0.0.1", "localhost", "::1", "[::1]"}


def _valid_keyscan_lines(text: str) -> list[str]:
    """Keep only real host-key lines from ssh-keyscan output (drop comments and
    blank lines). Pure — exercised by the self-check at the bottom."""
    return [ln for ln in (text or "").splitlines()
            if ln.strip() and not ln.lstrip().startswith("#")]


def _target_key(host: str, port: int) -> str:
    """known_hosts lookup key: bare host for port 22, ``[host]:port`` otherwise
    — exactly how ssh / ssh-keygen -F address a non-default port."""
    return host if port == 22 else f"[{host}]:{port}"


def _known_hosts_path() -> Path:
    return Path(os.path.expanduser("~/.ssh/known_hosts"))


def _already_known(host: str, port: int) -> bool:
    try:
        r = subprocess.run(
            ["ssh-keygen", "-F", _target_key(host, port)],
            capture_output=True, text=True, timeout=10,
        )
        return r.returncode == 0 and bool(r.stdout.strip())
    except Exception:
        return False


def seed_host_keys(targets: Iterable[Tuple[str, int]]) -> None:
    """ssh-keyscan each (host, port) not already trusted and append its keys to
    ``~/.ssh/known_hosts``. Idempotent and serial, so the parallel scan that
    follows finds every key already present and never races to add one."""
    uniq = {
        (h.strip(), int(p or 22))
        for (h, p) in targets
        if h and h.strip().lower() not in _LOCAL_HOSTS
    }
    if not uniq:
        return
    kh = _known_hosts_path()
    try:
        kh.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    except Exception:
        pass
    for host, port in sorted(uniq):
        if _already_known(host, port):
            continue
        try:
            scan = subprocess.run(
                ["ssh-keyscan", "-T", "5", "-p", str(port), host],
                capture_output=True, text=True, timeout=20,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("host-key pre-seed: ssh-keyscan failed for %s:%s — %s", host, port, exc)
            continue
        lines = _valid_keyscan_lines(scan.stdout)
        if not lines:
            logger.warning("host-key pre-seed: no key returned for %s:%s", host, port)
            continue
        try:
            with open(kh, "a", encoding="utf-8") as f:
                f.write("\n".join(lines) + "\n")
            logger.info("host-key pre-seed: added %d key(s) for %s:%s", len(lines), host, port)
        except Exception as exc:  # noqa: BLE001
            logger.warning("host-key pre-seed: could not write known_hosts for %s:%s — %s", host, port, exc)


if __name__ == "__main__":  # self-check
    assert _valid_keyscan_lines("# comment\n1.2.3.4 ssh-ed25519 AAA\n\n") == ["1.2.3.4 ssh-ed25519 AAA"]
    assert _valid_keyscan_lines("") == []
    assert _target_key("h", 22) == "h"
    assert _target_key("h", 2222) == "[h]:2222"
    print("hostkeys self-check OK")
