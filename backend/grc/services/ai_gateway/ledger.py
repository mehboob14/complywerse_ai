"""The prompts and answers of AI calls, kept encrypted for a while so an administrator can see exactly what was sent.

Only what the data-protection guard let through is kept: the prompt after names, hosts, addresses and secrets were
replaced, and the model's answer as it came back (placeholders still in it). A call the guard was not protecting
(the operator's ``monitor`` / ``off`` settings) keeps nothing, because its prompt would be the original text.
``AI_PAYLOAD_RETENTION_DAYS`` (operator, default 30; 0 keeps nothing) says how long.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

MAX_CHARS = 200_000
_PURGE_EVERY_SECONDS = 3600
_last_purge = 0.0
_purge_lock = threading.Lock()


def retention_days() -> int:
    try:
        return max(0, int(os.environ.get("AI_PAYLOAD_RETENTION_DAYS", "30")))
    except ValueError:
        return 30


# ── what to keep ────────────────────────────────────────────────────────────────────────────────────────────────
def request_snapshot(kwargs: Dict[str, Any], api: str) -> Dict[str, Any]:
    """The prompt part of a call (after the guard rewrote it): which model, the messages or the instructions and input.
    No credentials are ever in these arguments; image parts are refused before a call is made."""
    keep = {"chat": ("model", "messages"), "anthropic": ("model", "system", "messages")}.get(api, ("model", "instructions", "input"))
    snapshot = {k: kwargs[k] for k in keep if k in kwargs}
    snapshot["api"] = api
    return snapshot


def answer_text(response: Any) -> str:
    """The text of an answer as the model wrote it (call before the guard puts the original values back)."""
    parts = []
    for block in getattr(response, "content", None) or []:                      # Messages API
        if getattr(block, "type", None) == "text" and isinstance(getattr(block, "text", None), str):
            parts.append(block.text)
    for choice in getattr(response, "choices", None) or []:
        message = getattr(choice, "message", None)
        if message is None:
            continue
        if isinstance(getattr(message, "content", None), str):
            parts.append(message.content)
        for call in getattr(message, "tool_calls", None) or []:
            arguments = getattr(getattr(call, "function", None), "arguments", None)
            if isinstance(arguments, str):
                parts.append(arguments)
    for item in getattr(response, "output", None) or []:
        if getattr(item, "type", None) == "message":
            parts += [p.text for p in getattr(item, "content", None) or [] if isinstance(getattr(p, "text", None), str)]
        elif getattr(item, "type", None) == "function_call" and isinstance(getattr(item, "arguments", None), str):
            parts.append(item.arguments)
    return "\n".join(parts)


# ── keeping and showing it ──────────────────────────────────────────────────────────────────────────────────────
def _clip(text: str) -> tuple[str, bool]:
    return (text[:MAX_CHARS] + "\n[... cut: too long to keep ...]", True) if len(text) > MAX_CHARS else (text, False)


def store(db, event_id: int, request: Dict[str, Any], answer: Optional[str]) -> bool:
    """Add the encrypted payload of one call to the open session (the caller commits). Returns whether it was kept."""
    days = retention_days()
    if not days or not event_id:
        return False
    from ...crypto import encrypt_secret
    from ...models import AICallPayload

    asked, cut_a = _clip(json.dumps(request, ensure_ascii=False, default=str))
    answered, cut_b = _clip(answer or "")
    db.add(AICallPayload(
        event_id=event_id, request_enc=encrypt_secret(asked), response_enc=encrypt_secret(answered) if answered else None,
        truncated=cut_a or cut_b, expires_at=datetime.utcnow() + timedelta(days=days)))
    return True


def purge(db) -> int:
    """Remove what is past its time. Called now and then as payloads are written (the platform clock may never run)."""
    from ...models import AICallPayload

    removed = db.query(AICallPayload).filter(AICallPayload.expires_at < datetime.utcnow()).delete(synchronize_session=False)
    return int(removed or 0)


def purge_sometimes(db) -> None:
    global _last_purge
    now = time.monotonic()
    with _purge_lock:
        if now - _last_purge < _PURGE_EVERY_SECONDS:
            return
        _last_purge = now
    try:
        purge(db)
    except Exception:       # noqa: BLE001 - housekeeping never breaks a call
        logger.exception("could not purge expired AI call payloads")


def reveal(db, event_id: int) -> Optional[Dict[str, Any]]:
    """The decrypted prompt and answer of a call, or None when nothing was kept (or it has expired)."""
    from ...crypto import decrypt_secret
    from ...models import AICallPayload

    row = db.query(AICallPayload).filter(AICallPayload.event_id == event_id).first()
    if row is None or row.expires_at < datetime.utcnow():
        return None
    return {"request": decrypt_secret(row.request_enc), "response": decrypt_secret(row.response_enc),
            "truncated": bool(row.truncated), "expires_at": row.expires_at.isoformat() + "Z"}
