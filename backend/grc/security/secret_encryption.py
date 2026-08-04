"""Fernet-based encryption for at-rest secrets stored in the per-tenant DB.

Used today for the Microsoft Entra ID client secret. Designed to be reusable
for any other integration secret in the future.

Key resolution (first match wins):
  1. `INTEGRATION_ENCRYPTION_KEY` env var — a 32-byte url-safe base64 Fernet key.
  2. Derived from `SESSION_SECRET` via PBKDF2-HMAC-SHA256 with a fixed salt.
     Means existing deployments that already set SESSION_SECRET get a working
     key for free; rotating SESSION_SECRET would invalidate stored ciphertexts,
     which is the expected behaviour.

If neither env var is set we raise on first use rather than silently falling
back to plaintext storage.
"""

from __future__ import annotations

import base64
import os
from functools import lru_cache

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


# Constant salt is acceptable here because the input keying material
# (SESSION_SECRET) is itself high-entropy and per-deployment. The salt's job
# is to ensure two deployments with the same SESSION_SECRET don't end up with
# the same Fernet key — but in practice each deployment has a unique secret.
_DERIVATION_SALT = b"grc-integration-encryption-v1"


class EncryptionKeyMissing(RuntimeError):
    """Raised when neither INTEGRATION_ENCRYPTION_KEY nor SESSION_SECRET is set."""


@lru_cache(maxsize=1)
def _get_fernet() -> Fernet:
    explicit = os.getenv("INTEGRATION_ENCRYPTION_KEY", "").strip()
    if explicit:
        try:
            return Fernet(explicit.encode("utf-8"))
        except Exception as exc:  # pragma: no cover — surfaces obvious config error
            raise EncryptionKeyMissing(
                "INTEGRATION_ENCRYPTION_KEY is set but is not a valid Fernet key "
                "(must be 32 url-safe base64 bytes). Generate one with "
                "`python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'`."
            ) from exc

    session_secret = os.getenv("SESSION_SECRET", "").strip()
    if not session_secret:
        raise EncryptionKeyMissing(
            "Cannot encrypt integration secrets: neither INTEGRATION_ENCRYPTION_KEY "
            "nor SESSION_SECRET is set in the environment."
        )

    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_DERIVATION_SALT,
        iterations=200_000,
    )
    raw = kdf.derive(session_secret.encode("utf-8"))
    return Fernet(base64.urlsafe_b64encode(raw))


def encrypt(plaintext: str) -> bytes:
    """Encrypt a UTF-8 string. Returns Fernet ciphertext bytes."""
    if plaintext is None:
        raise ValueError("Cannot encrypt None")
    return _get_fernet().encrypt(plaintext.encode("utf-8"))


def decrypt(ciphertext: bytes) -> str:
    """Decrypt Fernet ciphertext (as stored in the LargeBinary column) back to a string."""
    if ciphertext is None:
        raise ValueError("Cannot decrypt None")
    return _get_fernet().decrypt(bytes(ciphertext)).decode("utf-8")
