"""The one place the platform calls Claude, behind the same data-protection guard as every other AI call.

``complete(...)`` runs, in order: the licence check (no Secure Controls Framework text leaves), the guard in
``engine.py`` (names, hosts, secrets and account numbers are replaced by placeholders, images and scanned pages are
refused, a fault in the guard refuses the call), the call itself, then puts the original values back into the answer and
records the call in the tenant's usage ledger (Administration > AI Governance) with the same report as any other call.

The answer is read in full before anything is shown (the guard cannot check a stream, so there is no token streaming):
the SDK streams from the provider to this process, which is what keeps a long document from hitting a request timeout.

A structured answer (``schema``) is parsed *before* the original values are restored and restored string by string, so
a restored name can never break the JSON. Nothing here names the provider to a user: the errors say "AI".

Environment (operator): ``ANTHROPIC_API_KEY`` (the SDK reads it), ``DOCUMENT_STUDIO_MODEL`` (default ``claude-opus-5-5``),
``ANTHROPIC_REFUSAL_FALLBACK=off`` to stop asking the provider to retry a declined request on its recommended model.
"""
from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union

from .errors import AIBlocked

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "claude-opus-5-5"
FALLBACK_BETA = "server-side-fallback-2026-07-01"
_fallbacks_rejected = False               # set when the account turns out not to accept the fallback parameter


class ClaudeNotConfigured(RuntimeError):
    """No credentials: the screen says AI is not set up yet."""

    def __init__(self) -> None:
        super().__init__("AI is not set up for this organisation yet. An administrator needs to add the AI credentials.")


class ClaudeRefused(RuntimeError):
    """The provider declined the request (a safety classifier), and no fallback took it."""

    def __init__(self, category: Optional[str] = None) -> None:
        self.category = category
        super().__init__("The AI declined this request. Rephrase it, or reduce the part of the document it points at, and try again.")


class ClaudeFailed(RuntimeError):
    """A call that did not give an answer. ``message`` is safe to show; ``retryable`` says whether trying again may work."""

    def __init__(self, message: str, *, retryable: bool = False, detail: str = "") -> None:
        self.retryable, self.detail = retryable, detail
        super().__init__(message)


@dataclass
class Result:
    text: str                                   # the answer with the original values back in it
    data: Any = None                            # the parsed JSON, when a schema was given
    model: str = ""
    stop_reason: Optional[str] = None
    truncated: bool = False                     # the answer hit the output ceiling
    usage: Dict[str, int] = field(default_factory=dict)
    report: Dict[str, Any] = field(default_factory=dict)      # the guard's report: counts and decisions, never a value


def configured() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def model_name(override: Optional[str] = None) -> str:
    return (override or os.environ.get("DOCUMENT_STUDIO_MODEL") or DEFAULT_MODEL).strip()


def fallbacks_enabled() -> bool:
    return not _fallbacks_rejected and os.environ.get("ANTHROPIC_REFUSAL_FALLBACK", "on").strip().lower() not in ("off", "0", "false", "no")


def _client():
    import anthropic

    return anthropic.Anthropic(max_retries=2, timeout=anthropic.Timeout(900.0, connect=15.0))


# ── before the call ──────────────────────────────────────────────────────────
def _chat_view(system: Union[str, List[dict], None], messages: List[dict]) -> List[dict]:
    return ([{"role": "system", "content": system}] if system else []) + list(messages)


def _screen(system, messages) -> None:
    """Licence gate: no verbatim SCF prose leaves (the same check the OpenAI shim runs)."""
    from ..licence_guard import LicenceRestrictedContent, assert_llm_safe

    try:
        assert_llm_safe(_chat_view(system, messages))
    except LicenceRestrictedContent:
        raise
    except Exception:       # noqa: BLE001 - the screen failing must not take the call down; the guard below still runs
        logger.exception("the licence screen failed")


def _record(*, response=None, error=None, model=None, started_at=None, gw=None, report=None, payload=None) -> None:
    try:
        from ..ai_usage import record_provider_attempt

        record_provider_attempt(
            response=response, error=error, requested_model=model, provider="anthropic", api_family="messages",
            started_at=started_at, context=gw.context if gw is not None else None,
            gateway=report if report is not None else (gw.report if gw is not None else None), payload=payload)
    except Exception:       # noqa: BLE001 - telemetry never breaks the product
        pass


def _guard(kwargs: Dict[str, Any], use_case: str, model: str, started_at: float):
    """The handle that restores the answer, or None when the guard is off. A fault in the guard refuses the call."""
    mode = os.environ.get("AI_GATEWAY_MODE", "protect").strip().lower()
    if mode == "off":
        return None
    from . import engine

    try:
        return engine.begin(kwargs, "monitor" if mode == "monitor" else "protect", "anthropic", use_case=use_case)
    except AIBlocked as exc:
        _record(error=exc, model=model, started_at=started_at, report=exc.report)
        raise
    except Exception as exc:        # noqa: BLE001
        blocked = AIBlocked("gateway_error", "AI was not used because the data-protection check could not run.", rule="B13")
        logger.exception("the data-protection guard failed; the prompt was not sent")
        _record(error=blocked, model=model, started_at=started_at)
        raise blocked from exc


# ── the call ─────────────────────────────────────────────────────────────────
def _stream_final(params: Dict[str, Any]):
    """The finished message, read through the SDK's stream so a long answer never trips a request timeout. A decline is
    retried once on the model the provider recommends for it (a fallback), unless the account does not accept that."""
    global _fallbacks_rejected
    import anthropic

    client = _client()
    extra: Dict[str, Any] = {}
    if fallbacks_enabled():
        extra = {"extra_headers": {"anthropic-beta": FALLBACK_BETA}, "extra_body": {"fallbacks": "default"}}
    try:
        with client.messages.stream(**params, **extra) as stream:
            return stream.get_final_message()
    except anthropic.BadRequestError as exc:
        text = str(exc).lower()
        if extra and ("fallback" in text or "beta" in text):
            _fallbacks_rejected = True
            logger.warning("the AI provider does not accept the fallback parameter for this account; continuing without it")
            with client.messages.stream(**params) as stream:
                return stream.get_final_message()
        raise


def _failure(exc: BaseException) -> ClaudeFailed:
    """What went wrong, in words that name no vendor."""
    try:
        import anthropic
    except Exception:       # noqa: BLE001
        return ClaudeFailed("AI could not be used.", detail=repr(exc))
    detail = f"{type(exc).__name__}: {exc}"[:500]
    if isinstance(exc, anthropic.AuthenticationError) or isinstance(exc, anthropic.PermissionDeniedError):
        return ClaudeFailed("AI is not available: its credentials were not accepted. An administrator should check the AI setup.", detail=detail)
    if isinstance(exc, anthropic.RateLimitError):
        return ClaudeFailed("AI is busy right now. Wait a minute and try again.", retryable=True, detail=detail)
    if isinstance(exc, (anthropic.APIConnectionError, anthropic.APITimeoutError)):
        return ClaudeFailed("AI could not be reached. Check the connection and try again.", retryable=True, detail=detail)
    if isinstance(exc, anthropic.BadRequestError):
        return ClaudeFailed("AI could not process this request. If the document is very large, work on one section at a time.", detail=detail)
    if isinstance(exc, anthropic.APIStatusError) and getattr(exc, "status_code", 0) >= 500:
        return ClaudeFailed("AI is temporarily unavailable. Try again shortly.", retryable=True, detail=detail)
    return ClaudeFailed("AI could not be used for this request.", detail=detail)


def complete(*, use_case: str, system: Union[str, List[dict], None], messages: List[dict],
             schema: Optional[Dict[str, Any]] = None, max_tokens: int = 32000, effort: str = "medium",
             model: Optional[str] = None) -> Result:
    """One guarded call. ``system`` is text or text blocks, ``messages`` are Messages-API turns whose content is text.
    ``schema`` (a JSON schema) makes the answer structured and is returned parsed in ``Result.data``.

    Raises ``ClaudeNotConfigured`` (no credentials), ``AIBlocked`` (the guard refused), ``LicenceRestrictedContent``,
    ``ClaudeRefused`` (declined, no fallback) or ``ClaudeFailed`` (anything else; ``message`` is safe to show)."""
    if not configured():
        raise ClaudeNotConfigured()
    model = model_name(model)
    output_config: Dict[str, Any] = {"effort": effort}
    if schema:
        output_config["format"] = {"type": "json_schema", "schema": schema}
    kwargs: Dict[str, Any] = {"model": model, "max_tokens": max_tokens, "messages": [dict(m) for m in messages],
                              "output_config": output_config, "cache_control": {"type": "ephemeral"}}
    if system:
        kwargs["system"] = system
    started = time.perf_counter()
    _screen(system, kwargs["messages"])
    gw = _guard(kwargs, use_case, model, started)
    try:
        message = _stream_final(kwargs)
    except Exception as exc:        # noqa: BLE001
        _record(error=exc, model=model, started_at=started, gw=gw, payload=_payload(gw, kwargs))
        raise _failure(exc) from exc

    from . import ledger

    as_written = ledger.answer_text(message) if gw is not None and gw.mode == "protect" else None
    usage = {k: int(getattr(message.usage, k, 0) or 0) for k in
             ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")}
    stop = getattr(message, "stop_reason", None)
    if stop == "refusal":
        category = getattr(getattr(message, "stop_details", None), "category", None)
        _record(response=message, model=model, started_at=started, gw=gw, payload=_payload(gw, kwargs, as_written))
        raise ClaudeRefused(category)
    text = "".join(getattr(b, "text", "") for b in message.content if getattr(b, "type", None) == "text")
    truncated = stop == "max_tokens"
    data: Any = None
    if schema:
        try:
            data = json.loads(text)
        except ValueError as exc:
            _record(response=message, model=model, started_at=started, gw=gw, payload=_payload(gw, kwargs, as_written))
            raise ClaudeFailed(
                "The answer was cut off because it was too long. Ask for less at a time, for example one section.",
                retryable=False, detail="structured answer is not valid JSON" + (" (hit max_tokens)" if truncated else "")) from exc
        if gw is not None:
            data = gw.restore_json(data)
        text = json.dumps(data, ensure_ascii=False)
    elif gw is not None:
        text = gw.restore_text(text)
    report = dict(gw.report) if gw is not None else {}
    _record(response=message, model=model, started_at=started, gw=gw, payload=_payload(gw, kwargs, as_written))
    return Result(text=text, data=data, model=getattr(message, "model", model) or model, stop_reason=stop,
                  truncated=truncated, usage=usage, report=report)


def _payload(gw, kwargs: Dict[str, Any], answer: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """What an administrator can read later: the prompt exactly as it was sent (the guard rewrote ``kwargs``)."""
    if gw is None or gw.mode != "protect":
        return None
    try:
        from . import ledger

        return {"request": ledger.request_snapshot(kwargs, "anthropic"), "answer": answer}
    except Exception:       # noqa: BLE001
        return None
