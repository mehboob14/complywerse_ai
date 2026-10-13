"""A result cache in front of the model, for work that repeats exactly.

When a use case is marked ``cache`` in the registry (a selection or a classification that is asked again whenever a page
opens, a job re-runs or a document is parsed again), an identical request is answered from the tenant's own cache
instead of another call. "Identical" means the same prompt *after* the data-protection guard replaced names with
placeholders, the same model and the same settings that shape the answer, so a changed input, a changed control
library, a new prompt wording or another model is a different key and asks the model again. The cache holds what the
model wrote (placeholders still in it) and the original values are put back for each caller by that caller's own
placeholder map, exactly as for a fresh call.

Only an answer that looks usable is kept (finished normally, not empty, valid JSON when JSON was asked for), so a bad
answer is never replayed to a caller that would have retried. ``AI_RESULT_CACHE=off`` (operator) stops it.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
from datetime import datetime, timedelta
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

# the arguments that shape an answer; limits, timeouts and the like do not (a finished answer is the same under any limit)
_SHAPING = ("model", "temperature", "top_p", "seed", "n", "response_format", "reasoning_effort", "reasoning", "text",
            "tools", "tool_choice", "functions", "function_call", "stop")
_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.I)
_PURGE_EVERY_SECONDS = 3600
_last_purge = 0.0
_purge_lock = threading.Lock()


def enabled() -> bool:
    return os.environ.get("AI_RESULT_CACHE", "on").strip().lower() != "off"


def make_key(kwargs: Dict[str, Any], api: str) -> str:
    material: Dict[str, Any] = {k: kwargs[k] for k in _SHAPING if k in kwargs}
    material["api"] = api
    if api == "chat":
        material["messages"] = kwargs.get("messages")
    else:
        material["instructions"], material["input"] = kwargs.get("instructions"), kwargs.get("input")
    return hashlib.sha256(json.dumps(material, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")).hexdigest()


def _wants_json(kwargs: Dict[str, Any]) -> bool:
    fmt = (kwargs.get("response_format") or {}).get("type") if isinstance(kwargs.get("response_format"), dict) else None
    fmt = fmt or (((kwargs.get("text") or {}).get("format") or {}).get("type") if isinstance(kwargs.get("text"), dict) else None)
    return fmt in ("json_object", "json_schema")


def usable(api: str, response: Any, kwargs: Dict[str, Any]) -> bool:
    """An answer worth replaying: finished normally, said something, and is valid JSON when JSON was asked for."""
    try:
        if api == "chat":
            choices = response.choices or []
            if len(choices) != 1:
                return False
            choice = choices[0]
            message = choice.message
            if choice.finish_reason != "stop" or getattr(message, "tool_calls", None) or getattr(message, "function_call", None):
                return False
            text = message.content
        else:
            if getattr(response, "status", "completed") != "completed":
                return False
            if any(getattr(item, "type", None) == "function_call" for item in getattr(response, "output", None) or []):
                return False
            text = response.output_text
        if not isinstance(text, str) or not text.strip():
            return False
        if _wants_json(kwargs):
            json.loads(_FENCE.sub("", text))
        return True
    except Exception:       # noqa: BLE001 - anything odd is simply not cached
        return False


def _rebuild(api: str, dump: Dict[str, Any]) -> Any:
    """The response object a caller expects, with no tokens used (the original call's usage is not this call's)."""
    if api == "chat":
        from openai.types.chat import ChatCompletion
        dump["usage"] = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        return ChatCompletion.model_validate(dump)
    from openai.types.responses import Response
    dump["usage"] = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0,
                     "input_tokens_details": {"cached_tokens": 0}, "output_tokens_details": {"reasoning_tokens": 0}}
    return Response.model_validate(dump)


def lookup(slug: str, key: str, api: str) -> Optional[Tuple[Any, int]]:
    """``(response, tokens the original call used)`` for a live entry, else None."""
    from ...crypto import decrypt_secret
    from ...db import open_tenant_session
    from ...models import AIResultCache

    db = open_tenant_session(slug)
    try:
        row = db.query(AIResultCache).filter(AIResultCache.key == key).first()
        if row is None or row.expires_at < datetime.utcnow() or row.api != api:
            return None
        response = _rebuild(api, json.loads(decrypt_secret(row.response_enc)))
        row.hits, row.last_hit_at = (row.hits or 0) + 1, datetime.utcnow()
        tokens = int(row.tokens or 0)
        db.commit()
        return response, tokens
    finally:
        db.close()


def store(slug: str, key: str, use_case_id: Optional[str], api: str, model: Optional[str], response: Any, hours: int) -> None:
    from ...crypto import encrypt_secret
    from ...db import open_tenant_session
    from ...models import AIResultCache

    usage = getattr(response, "usage", None)
    tokens = int(getattr(usage, "total_tokens", 0) or 0)
    blob = encrypt_secret(json.dumps(response.model_dump(mode="json"), ensure_ascii=False))
    db = open_tenant_session(slug)
    try:
        db.query(AIResultCache).filter(AIResultCache.key == key).delete(synchronize_session=False)
        db.add(AIResultCache(key=key, use_case_id=use_case_id, api=api, model=model, response_enc=blob, tokens=tokens,
                             expires_at=datetime.utcnow() + timedelta(hours=hours)))
        db.commit()
        _purge_sometimes(db)
    except Exception:
        db.rollback()
        logger.exception("could not keep an AI answer in the result cache")
    finally:
        db.close()


def _purge_sometimes(db) -> None:
    """Remove what has expired. Called now and then as answers are stored (the platform clock may never run)."""
    global _last_purge
    now = time.monotonic()
    with _purge_lock:
        if now - _last_purge < _PURGE_EVERY_SECONDS:
            return
        _last_purge = now
    try:
        from ...models import AIResultCache
        db.query(AIResultCache).filter(AIResultCache.expires_at < datetime.utcnow()).delete(synchronize_session=False)
        db.commit()
    except Exception:       # noqa: BLE001 - housekeeping never breaks a call
        db.rollback()
        logger.exception("could not purge the AI result cache")
