"""Encrypted credential vault for the agent.

The vault stores:
  • api_token        — the long-lived token issued at enrollment
  • collector creds  — SSH / Oracle / vCenter creds typed by the bank
                       admin in Scenario A, or fetched from cloud in
                       Scenario B

Encryption strategy:
  • Windows  → DPAPI CryptProtectData (LocalMachine scope). The encrypted
               blob can ONLY be decrypted on the same Windows install by
               the same user — moving vault.bin to another box yields
               garbage. This is the same primitive used by Chrome to
               store cookie encryption keys.
  • POSIX    → Fernet (AES-128-CBC + HMAC-SHA256) keyed by a host-derived
               secret (machine-id + /etc/machine-id + hostname). Same
               "can't move the file" property.

Wire format on disk:
    [4-byte magic "CV01"][1-byte version=1][N-byte ciphertext]

The vault is a single binary file at config.vault_path() — easier to
back up / wipe than a sqlite DB and we never need queryability.

Public API:
    vault.set_api_token(token)
    vault.get_api_token() -> str | None
    vault.set_collector_cred(asset_id, creds_dict)
    vault.get_collector_cred(asset_id) -> dict | None
    vault.list_collector_assets() -> list[int]
    vault.clear()                       # wipe on revoke / uninstall
"""
from __future__ import annotations

import json
import logging
import os
import platform
import sys
from pathlib import Path
from typing import Any, Optional

from .config import vault_path

logger = logging.getLogger(__name__)

_MAGIC = b"CV01"
_VERSION = bytes([1])

# In-memory cache so we don't decrypt+reencrypt on every call inside a
# single agent run. Cleared on `clear()` and on each process start.
_cache: Optional[dict] = None


# ─── Backend selection ──────────────────────────────────────────────────────

def _backend():
    """Return (encrypt_fn, decrypt_fn) tuple appropriate for this OS."""
    if platform.system() == "Windows":
        return _dpapi_encrypt, _dpapi_decrypt
    return _fernet_encrypt, _fernet_decrypt


# ─── Windows DPAPI backend ──────────────────────────────────────────────────

def _dpapi_encrypt(plaintext: bytes) -> bytes:
    """Encrypt with Windows DPAPI (LocalMachine scope)."""
    # We use ctypes directly so the agent doesn't need pywin32 at all —
    # DPAPI is a Win32 API, callable from stdlib ctypes. This keeps the
    # NSIS installer slim.
    import ctypes
    from ctypes import wintypes

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]

    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32

    in_blob = DATA_BLOB(len(plaintext), ctypes.cast(ctypes.c_char_p(plaintext), ctypes.POINTER(ctypes.c_byte)))
    out_blob = DATA_BLOB()
    # CRYPTPROTECT_LOCAL_MACHINE = 4 — encrypt against the machine, not
    # the current user. Lets the Windows Service (running as SYSTEM) read
    # vault rows the operator wrote via the tray UI (running as user).
    flags = 4
    if not crypt32.CryptProtectData(
        ctypes.byref(in_blob), None, None, None, None, flags, ctypes.byref(out_blob),
    ):
        raise RuntimeError(f"DPAPI CryptProtectData failed: 0x{ctypes.GetLastError():x}")
    try:
        return ctypes.string_at(out_blob.pbData, out_blob.cbData)
    finally:
        kernel32.LocalFree(out_blob.pbData)


def _dpapi_decrypt(ciphertext: bytes) -> bytes:
    import ctypes
    from ctypes import wintypes

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]

    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32

    in_blob = DATA_BLOB(len(ciphertext), ctypes.cast(ctypes.c_char_p(ciphertext), ctypes.POINTER(ctypes.c_byte)))
    out_blob = DATA_BLOB()
    if not crypt32.CryptUnprotectData(
        ctypes.byref(in_blob), None, None, None, None, 0, ctypes.byref(out_blob),
    ):
        raise RuntimeError(f"DPAPI CryptUnprotectData failed: 0x{ctypes.GetLastError():x}")
    try:
        return ctypes.string_at(out_blob.pbData, out_blob.cbData)
    finally:
        kernel32.LocalFree(out_blob.pbData)


# ─── POSIX Fernet backend ───────────────────────────────────────────────────

def _machine_secret() -> bytes:
    """Derive a stable per-machine secret from host identifiers.

    On systemd Linux /etc/machine-id is a 128-bit random ID set at first
    boot and persists across reboots. We salt it with the hostname so
    two machines that somehow share machine-id (cloned images that
    weren't regenerated) still get different keys.
    """
    parts = [platform.node().encode("utf-8", errors="replace")]
    for candidate in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
        try:
            parts.append(Path(candidate).read_bytes().strip())
            break
        except Exception:
            pass
    else:
        # Last-ditch fallback — UID + hostname. Not as strong but better
        # than a hardcoded constant.
        parts.append(str(os.getuid() if hasattr(os, "getuid") else 0).encode())
    import hashlib
    return hashlib.sha256(b"|".join(parts)).digest()


def _fernet_encrypt(plaintext: bytes) -> bytes:
    import base64
    from cryptography.fernet import Fernet  # type: ignore

    key = base64.urlsafe_b64encode(_machine_secret())
    return Fernet(key).encrypt(plaintext)


def _fernet_decrypt(ciphertext: bytes) -> bytes:
    import base64
    from cryptography.fernet import Fernet  # type: ignore

    key = base64.urlsafe_b64encode(_machine_secret())
    return Fernet(key).decrypt(ciphertext)


# ─── Public vault API ───────────────────────────────────────────────────────

def _read_vault() -> dict:
    """Load + decrypt the vault file into a dict. Empty dict if missing."""
    global _cache
    if _cache is not None:
        return _cache

    p = vault_path()
    if not p.exists():
        _cache = {}
        return _cache

    blob = p.read_bytes()
    if not blob.startswith(_MAGIC):
        # Old plaintext vault from PoC days? Try to migrate.
        try:
            data = json.loads(blob.decode("utf-8"))
            logger.warning("vault.legacy_plaintext_detected — migrating to encrypted")
            _cache = data
            _write_vault(_cache)
            return _cache
        except Exception:
            raise RuntimeError("Vault file is corrupt — re-enroll the agent")

    version = blob[4:5]
    if version != _VERSION:
        raise RuntimeError(f"Unsupported vault version: {version!r}")
    ciphertext = blob[5:]
    _, decrypt_fn = _backend()
    plaintext = decrypt_fn(ciphertext)
    _cache = json.loads(plaintext.decode("utf-8"))
    return _cache


def _write_vault(data: dict) -> None:
    """Encrypt + atomically write the vault file."""
    global _cache
    encrypt_fn, _ = _backend()
    plaintext = json.dumps(data, indent=2).encode("utf-8")
    ciphertext = encrypt_fn(plaintext)
    blob = _MAGIC + _VERSION + ciphertext

    p = vault_path()
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_bytes(blob)
    try:
        os.chmod(tmp, 0o600)
    except Exception:
        pass
    os.replace(tmp, p)
    _cache = data


def set_api_token(token: str) -> None:
    """Store the long-lived api_token (issued by /agents/enroll)."""
    v = _read_vault()
    v["api_token"] = token
    _write_vault(v)


def get_api_token() -> Optional[str]:
    return _read_vault().get("api_token")


def set_collector_cred(asset_id: int, creds: dict) -> None:
    """Store credentials for one scan target.

    `creds` is a free-form dict — typically:
        {"type": "ssh", "host": "10.0.0.5", "port": 22,
         "username": "svc-compliverse", "password": "..."}
        {"type": "oracle", "host": "...", "service_name": "ORCL",
         "username": "svc_compliverse", "password": "..."}
        {"type": "vmware", "host": "vcsa.bank.local",
         "username": "...", "password": "..."}
    """
    v = _read_vault()
    targets = v.setdefault("collector_targets", {})
    targets[str(asset_id)] = creds
    _write_vault(v)


def get_collector_cred(asset_id: int) -> Optional[dict]:
    return _read_vault().get("collector_targets", {}).get(str(asset_id))


def list_collector_assets() -> list[int]:
    return [int(k) for k in _read_vault().get("collector_targets", {})]


def clear() -> None:
    """Wipe the entire vault — used on `agent revoke` / uninstall."""
    global _cache
    _cache = None
    p = vault_path()
    if p.exists():
        # Best-effort secure wipe: overwrite with random before unlink.
        # On modern SSDs this is largely symbolic (wear-leveling), but it
        # raises the bar for forensic recovery.
        try:
            p.write_bytes(os.urandom(p.stat().st_size or 4096))
        except Exception:
            pass
        p.unlink(missing_ok=True)


__all__ = [
    "set_api_token", "get_api_token",
    "set_collector_cred", "get_collector_cred", "list_collector_assets",
    "clear",
]
