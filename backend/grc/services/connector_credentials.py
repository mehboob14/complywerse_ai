"""Track A — Credential encryption helper for the connector framework.

`CloudConnector.encrypted_credentials_blob` stores ciphertext (or, in dev
mode without a master key, base64-encoded JSON marked with a sentinel
prefix). This module owns both code paths.

Two modes:

1. **Production (CONNECTOR_MASTER_KEY set):** Fernet (AES-128-CBC + HMAC).
   Tokens are valid Fernet tokens. Encrypt requires a key; decrypt
   returns None on bad key / corrupt token.

2. **Development (no CONNECTOR_MASTER_KEY):** the helper still works —
   it stores `dev::<base64-json>` so the system is usable end-to-end
   without configuring an encryption key. The sentinel makes the lack
   of encryption *obvious* in the DB so it can never be mistaken for a
   Fernet token, and `has_master_key()` keeps returning False so the
   admin UI can show a "no encryption configured" banner. **Real
   deployments MUST set CONNECTOR_MASTER_KEY before storing real creds.**

Logged once per process when dev mode is used, so it shows up in the
boot log of any environment that left the key unset.
"""
from __future__ import annotations

import base64
import json
import logging
import os
from typing import Any, Optional

logger = logging.getLogger(__name__)

_ENV_KEY = "CONNECTOR_MASTER_KEY"
# Sentinel prefix on dev-mode (unencrypted) tokens. Real Fernet tokens
# never contain `::` in their first 16 chars so this is unambiguous.
_DEV_PREFIX = "dev::"
_DEV_WARNED = False


class ConnectorCredentialError(RuntimeError):
    """Raised by `encrypt_credentials` when something fundamentally broken
    happens (e.g. a malformed CONNECTOR_MASTER_KEY value). Missing key is
    NOT an error — dev mode handles it transparently."""


def _warn_dev_mode_once() -> None:
    global _DEV_WARNED
    if not _DEV_WARNED:
        logger.warning(
            "CONNECTOR_MASTER_KEY is not set — storing connector credentials "
            "as base64 JSON (DEV MODE). Set the env var to enable Fernet "
            "encryption in production."
        )
        _DEV_WARNED = True


def _load_fernet():
    """Return a `Fernet` instance, or None when no master key is set.
    Raises only when the env var is set BUT malformed (e.g. user pasted a
    bad string) — that's a configuration error worth surfacing."""
    raw = (os.environ.get(_ENV_KEY) or "").strip()
    if not raw:
        return None
    try:
        from cryptography.fernet import Fernet  # type: ignore
        return Fernet(raw.encode("utf-8"))
    except Exception as exc:
        raise ConnectorCredentialError(
            f"{_ENV_KEY} is not a valid Fernet key: {exc.__class__.__name__}"
        ) from exc


def encrypt_credentials(payload: Any) -> str:
    """JSON-encode `payload` and return either a Fernet token or a
    `dev::<base64>` sentinel-prefixed string.

    Empty payload → empty string. Caller should treat as 'no credentials'."""
    if payload is None:
        return ""
    fernet = _load_fernet()
    serialized = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    if fernet is not None:
        token = fernet.encrypt(serialized)
        return token.decode("utf-8")
    # Dev mode — no encryption, sentinel-prefixed base64.
    _warn_dev_mode_once()
    encoded = base64.urlsafe_b64encode(serialized).decode("utf-8")
    return f"{_DEV_PREFIX}{encoded}"


def decrypt_credentials(token: Optional[str]) -> Optional[Any]:
    """Decrypt a token previously produced by `encrypt_credentials`.

    Returns `None` for any unrecoverable failure (corrupt token, env-var
    rotated to a different key, malformed dev sentinel). Callers should
    treat `None` as "credentials unavailable, mark this connector as
    health=error" — never as "empty credentials, sync anyway".
    """
    if not token:
        return None

    # Dev-mode sentinel path — handled regardless of whether a master key
    # is currently set. That lets a deployment toggle the env var on/off
    # mid-life without breaking already-stored rows (old dev rows still
    # decrypt; new writes get Fernet).
    if token.startswith(_DEV_PREFIX):
        try:
            raw = base64.urlsafe_b64decode(token[len(_DEV_PREFIX):].encode("utf-8"))
            return json.loads(raw.decode("utf-8"))
        except Exception:
            logger.warning("Failed to decode dev-mode connector credentials.")
            return None

    # Fernet path.
    try:
        fernet = _load_fernet()
    except ConnectorCredentialError:
        logger.warning("Connector master key is set but malformed; cannot decrypt.")
        return None
    if fernet is None:
        # Token looks like a Fernet token but no key is configured. Most
        # likely the key was unset after rows were already written; the
        # admin needs to set it back.
        logger.warning("Connector token is encrypted but CONNECTOR_MASTER_KEY is no longer set.")
        return None
    try:
        raw = fernet.decrypt(token.encode("utf-8"))
    except Exception as exc:
        logger.warning("Failed to decrypt connector credentials: %s", exc.__class__.__name__)
        return None
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        logger.warning("Decrypted connector credentials are not valid JSON.")
        return None


def has_master_key() -> bool:
    """Probe for the master key without instantiating Fernet. Used by the
    admin page to show a 'no encryption configured (dev mode)' banner —
    the admin can still save credentials, they're just stored as
    base64 JSON until the key is set."""
    return bool((os.environ.get(_ENV_KEY) or "").strip())
