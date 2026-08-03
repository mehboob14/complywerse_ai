"""Tenant-secret encryption helper for credentials at rest.

Banks reject any product that stores integration passwords / API keys in
plaintext — they fail audits on it. This module wraps Fernet (AES-128-CBC
HMAC-SHA256) so the `grc_integration_connections.password` column (and any
other secret-bearing field we add later) is stored encrypted.

Wire-format
-----------
Encrypted values are prefixed with ``enc:v1:`` so any read path can
distinguish "already encrypted" from "legacy plaintext" without a schema
migration. This lets us deploy + backfill incrementally instead of needing
a hard cutover.

    "enc:v1:gAAAAABoUhT..."  → encrypted, decrypt with current key
    "MyOldPassword123"        → legacy plaintext, return as-is + warn

Key derivation
--------------
The Fernet key is derived from the existing ``SESSION_SECRET`` env var
(already required by the JWT auth code) via PBKDF2-HMAC-SHA256. This
avoids introducing a new env var that ops would forget to set during
deploy. Rotation is just: set ``SESSION_SECRET_OLD`` to the previous
value, run the rotate_secrets.py migration, then unset OLD.

Threat model
------------
Protects against: DB dump exfiltration, backup tape theft, read-only DB
access by support staff.

Does NOT protect against: a compromised backend (the key lives in env;
process can decrypt). For that level of paranoia, integrate with a real
KMS (AWS KMS / Azure Key Vault / HashiCorp Vault) — same wire format,
swap out the key derivation.
"""
from __future__ import annotations

import base64
import logging
import os
from functools import lru_cache
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

logger = logging.getLogger(__name__)

_ENC_PREFIX = "enc:v1:"
# Stable salt — rotated together with the key. Don't change this without
# bumping the prefix to enc:v2: AND running a re-encryption migration.
_KDF_SALT = b"complyverse-cred-vault-v1"


@lru_cache(maxsize=2)
def _fernet(secret: str) -> Fernet:
    """Derive a Fernet instance from the given secret. Cached so we don't
    re-run PBKDF2 on every call (PBKDF2 with 200k iterations is slow)."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_KDF_SALT,
        iterations=200_000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(secret.encode("utf-8")))
    return Fernet(key)


def _current_secret() -> str:
    secret = os.environ.get("SESSION_SECRET")
    if not secret:
        # We refuse to silently no-op encryption — if ops forgot to set the
        # secret in prod, fail loud so the deploy gets caught in staging.
        raise RuntimeError(
            "SESSION_SECRET env var is required for credential encryption. "
            "Set it in your .env before starting the backend."
        )
    return secret


def encrypt_secret(plaintext: Optional[str]) -> Optional[str]:
    """Encrypt a credential value with the current key.

    Returns ``None`` if the input is ``None`` or empty (so we don't store
    an "encrypted empty string" in nullable columns — keeps the DB clean).
    """
    if plaintext is None or plaintext == "":
        return plaintext
    if plaintext.startswith(_ENC_PREFIX):
        # Already encrypted — defensive: re-encrypting an encrypted blob
        # would produce a double-wrapped value the runner can't decrypt.
        return plaintext
    token = _fernet(_current_secret()).encrypt(plaintext.encode("utf-8")).decode("ascii")
    return f"{_ENC_PREFIX}{token}"


def decrypt_secret(value: Optional[str]) -> Optional[str]:
    """Decrypt a credential value. Legacy plaintext rows pass through
    unchanged so the system keeps working during the rolling backfill."""
    if value is None or value == "":
        return value
    if not value.startswith(_ENC_PREFIX):
        # Legacy plaintext row — return as-is and warn so ops can see how
        # many unencrypted creds are still in flight.
        logger.warning(
            "credential.legacy_plaintext encountered — schedule a re-encrypt"
        )
        return value
    token = value[len(_ENC_PREFIX):]
    try:
        return _fernet(_current_secret()).decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken:
        # Wrong key — most common cause is SESSION_SECRET was rotated
        # without running the migration. Don't crash the scan; surface a
        # clear error to the runner so the operator can see "this conn
        # needs re-onboarding" instead of a silent SSL/auth failure.
        logger.error("credential.decrypt_failed — key may have rotated")
        raise RuntimeError(
            "Credential decryption failed. SESSION_SECRET may have changed "
            "since this connection was created — re-enter credentials via "
            "Administration → Integrations."
        )


def is_encrypted(value: Optional[str]) -> bool:
    return bool(value) and value.startswith(_ENC_PREFIX)


__all__ = ["encrypt_secret", "decrypt_secret", "is_encrypted"]
