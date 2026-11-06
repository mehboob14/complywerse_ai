"""The one place the platform calls Claude, behind the same data-protection guard as every other AI call.

``complete(...)`` runs, in order: the licence check (no Secure Controls Framework text leaves), the guard in
``engine.py`` (names, hosts, secrets and account numbers are replaced by placeholders, images and scanned pages are
refused, a fault in the guard refuses the call), the call itself, then puts the original values back into the answer and
records the call in the tenant's usage ledger (Administration > AI Governance) with the same report as any other call.

The answer is read in full before it is kept: the SDK streams from the provider to this process, which is what keeps a
long document from hitting a request timeout, and the guard checks and restores the finished answer. While it is being
written a caller may ask to see it (``on_progress``): each report carries the answer so far, and ``Progress.show`` puts the
original values back into a piece of it for the screen (a half-written placeholder is held back). That is a view for the
person who asked, never what is kept or acted on.

A structured answer (``schema``) is parsed *before* the original values are restored and restored string by string, so
a restored name can never break the JSON. Nothing here names the provider to a user: the errors say "Comply Agent" (the
assistant's name on the platform).

Environment (operator): ``ANTHROPIC_API_KEY`` (the SDK reads it), ``ANTHROPIC_WORKSPACE_ID`` (only when the key is not tied to
one workspace), ``DOCUMENT_STUDIO_MODEL`` (default ``claude-opus-5-5``), ``ANTHROPIC_REFUSAL_FALLBACK=off`` to stop asking the
provider to retry a declined request on its recommended model.
"""
from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Union

from .errors import AIBlocked

logger = logging.getLogger(__name__)

PROGRESS_EVERY = 0.4                      # seconds between two reports of an answer that is being written
DEFAULT_MODEL = "claude-opus-5-5"
FALLBACK_BETA = "server-side-fallback-2026-07-01"
_fallbacks_rejected = False               # set when the account turns out not to accept the fallback parameter


class ClaudeNotConfigured(RuntimeError):
    """No credentials: the screen says AI is not set up yet."""

    def __init__(self) -> None:
        super().__init__("Comply Agent is not set up for this organisation yet. An administrator needs to add its credentials.")


class ClaudeRefused(RuntimeError):
    """The provider declined the request (a safety classifier), and no fallback took it."""

    def __init__(self, category: Optional[str] = None) -> None:
        self.category = category
        super().__init__("Comply Agent declined this request. Rephrase it, or reduce the part of the document it points at, and try again.")


class ClaudeFailed(RuntimeError):
    """A call that did not give an answer. ``message`` is safe to show; ``retryable`` says whether trying again may work."""

    def __init__(self, message: str, *, retryable: bool = False, detail: str = "") -> None:
        self.retryable, self.detail = retryable, detail
        super().__init__(message)


class ClaudeStopped(RuntimeError):
    """The person stopped the work (``should_stop`` said so): the answer was abandoned where it was."""

    def __init__(self) -> None:
        super().__init__("You stopped Comply Agent.")


@dataclass
class Result:
    text: str                                   # the answer with the original values back in it
    data: Any = None                            # the parsed JSON, when a schema was given
    model: str = ""
    stop_reason: Optional[str] = None
    truncated: bool = False                     # the answer hit the output ceiling
    usage: Dict[str, int] = field(default_factory=dict)
    report: Dict[str, Any] = field(default_factory=dict)      # the guard's report: counts and decisions, never a value
    searches: List[str] = field(default_factory=list)          # with the web search tool: what was searched for
    sources: List[Dict[str, str]] = field(default_factory=list)   # and the pages the answer cites ({url, title}), else the pages found


@dataclass
class Progress:
    """An answer that is being written, as ``on_progress`` receives it."""
    phase: str                                   # reading (the AI has the request) | thinking | searching (the web) | writing
    chars: int = 0                               # how much of the answer exists so far
    data: Any = None                             # a structured answer so far, as written: placeholders not yet replaced (see ``show``)
    text: str = ""                               # the answer so far when it is not structured, original values back in it
    protected: int = 0                           # values replaced or removed in the request before it was sent
    show: Callable[[str], str] = str             # a piece of ``data`` with the original values back in it: for what goes on the screen
    searches: List[str] = field(default_factory=list)     # what has been searched for on the web so far, original values back in it


def _partial_json(text: str) -> Any:
    """A structured answer that is half written, as far as it goes (a string still being written is included), or None."""
    if not text.strip():
        return None
    try:
        from jiter import from_json         # the SDK's own dependency: it reads the half-written JSON of a streamed tool call the same way

        return from_json(text.encode("utf-8"), partial_mode="trailing-strings")
    except Exception:       # noqa: BLE001 - nothing to show yet
        return None


class _Watcher:
    """Reads the provider's stream as it arrives and reports the answer so far to ``callback``: when the phase changes, and while the
    answer is being written at most every ``PROGRESS_EVERY`` seconds. A callback that fails is dropped: the screen is not worth a call."""

    def __init__(self, callback: Callable[[Progress], None], gw, structured: bool, protected: int):
        self.callback, self.gw, self.structured, self.protected = callback, gw, structured, protected
        self.phase, self.last = "", 0.0

    def show(self, text: str) -> str:
        return self.gw.restore_partial(text) if self.gw is not None else text

    def report(self, phase: str, stream=None) -> None:
        self.phase, self.last = phase, time.monotonic()
        text, searches = "", []
        if stream is not None:
            try:
                content = stream.current_message_snapshot.content
                text = "".join(b.text for b in content if getattr(b, "type", "") == "text")
                searches = [self.show(q) for q in (_query(b) for b in content) if q]
            except AssertionError:      # the message has not started
                pass
        progress = Progress(phase=phase, chars=len(text), protected=self.protected, show=self.show, searches=searches)
        if self.structured:
            progress.data = _partial_json(text)
        else:
            progress.text = self.show(text)
        try:
            self.callback(progress)
        except Exception:       # noqa: BLE001
            logger.warning("showing the progress of an AI call failed; it is not shown any more for this call", exc_info=True)
            self.callback = lambda _p: None

    def __call__(self, event, stream) -> None:
        kind = getattr(event, "type", "")
        if kind == "content_block_start":
            block = getattr(getattr(event, "content_block", None), "type", "")
            phase = ("thinking" if block in ("thinking", "redacted_thinking") else "searching" if block in ("server_tool_use",) + _WEB_RESULTS
                     else "writing")
            if phase != self.phase:
                self.report(phase, stream)
        elif kind == "content_block_delta" and time.monotonic() - self.last >= PROGRESS_EVERY:
            self.report(self.phase or "writing", stream)


def _query(block) -> Optional[str]:
    """What a web search block searched for (as far as it is written), or None."""
    if getattr(block, "type", "") != "server_tool_use":
        return None
    given = getattr(block, "input", None)
    if not isinstance(given, dict):
        return None
    return str(given.get("query") or "").strip() or None


_WEB_RESULTS = ("web_search_tool_result", "web_fetch_tool_result")


def _found(content) -> List[Dict[str, str]]:
    """The pages a web-fetched answer opened, then the pages it cites, else the pages its searches returned: {url, title}, each once."""
    fetched, cited, returned = [], [], []
    for b in content:
        kind = getattr(b, "type", "")
        if kind == "text":
            cited += [(c.url, getattr(c, "title", "")) for c in getattr(b, "citations", None) or [] if getattr(c, "url", None)]
        elif kind == "web_search_tool_result" and isinstance(getattr(b, "content", None), list):
            returned += [(r.url, getattr(r, "title", "")) for r in b.content if getattr(r, "url", None)]
        elif kind == "web_fetch_tool_result" and getattr(getattr(b, "content", None), "type", "") == "web_fetch_result":
            fetched.append((b.content.url, getattr(getattr(b.content, "content", None), "title", "")))      # an error block opened nothing
    out, seen = [], set()
    for url, title in fetched + (cited or returned):
        if url not in seen:
            seen.add(url)
            out.append({"url": url, "title": (title or url).strip()})
    return out


def configured() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def model_name(override: Optional[str] = None) -> str:
    return (override or os.environ.get("DOCUMENT_STUDIO_MODEL") or DEFAULT_MODEL).strip()


def fallbacks_enabled() -> bool:
    return not _fallbacks_rejected and os.environ.get("ANTHROPIC_REFUSAL_FALLBACK", "on").strip().lower() not in ("off", "0", "false", "no")


def _client():
    import anthropic

    # a key that is not tied to one workspace needs to be told which one to use (an id, not a secret)
    workspace = os.environ.get("ANTHROPIC_WORKSPACE_ID", "").strip()
    return anthropic.Anthropic(max_retries=2, timeout=anthropic.Timeout(900.0, connect=15.0),
                               default_headers={"anthropic-workspace-id": workspace} if workspace else None)


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
        blocked = AIBlocked("gateway_error", "Comply Agent was not used because the data-protection check could not run.", rule="B13")
        logger.exception("the data-protection guard failed; the prompt was not sent")
        _record(error=blocked, model=model, started_at=started_at)
        raise blocked from exc


# ── the call ─────────────────────────────────────────────────────────────────
def _read(stream, watch: Optional[Callable[[Any, Any], None]]):
    """The finished message of a stream, letting ``watch`` see each event as it arrives."""
    if watch is not None:
        for event in stream:
            watch(event, stream)
    return stream.get_final_message()


def _stream_final(params: Dict[str, Any], watch: Optional[Callable[[Any, Any], None]] = None):
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
            return _read(stream, watch)
    except anthropic.BadRequestError as exc:
        text = str(exc).lower()
        if extra and ("fallback" in text or "beta" in text):
            _fallbacks_rejected = True
            logger.warning("the AI provider does not accept the fallback parameter for this account; continuing without it")
            with client.messages.stream(**params) as stream:
                return _read(stream, watch)
        raise


def _failure(exc: BaseException) -> ClaudeFailed:
    """What went wrong, in words that name no vendor."""
    try:
        import anthropic
    except Exception:       # noqa: BLE001
        return ClaudeFailed("Comply Agent could not be used.", detail=repr(exc))
    detail = f"{type(exc).__name__}: {exc}"[:500]
    if isinstance(exc, anthropic.AuthenticationError) or isinstance(exc, anthropic.PermissionDeniedError):
        return ClaudeFailed("Comply Agent is not available: its credentials were not accepted. An administrator should check its setup.", detail=detail)
    if isinstance(exc, anthropic.RateLimitError):
        return ClaudeFailed("Comply Agent is busy right now. Wait a minute and try again.", retryable=True, detail=detail)
    if isinstance(exc, (anthropic.APIConnectionError, anthropic.APITimeoutError)):
        return ClaudeFailed("Comply Agent could not be reached. Check the connection and try again.", retryable=True, detail=detail)
    if isinstance(exc, anthropic.BadRequestError):
        if "workspace" in str(exc).lower():
            return ClaudeFailed("Comply Agent is not set up completely: its credentials need a workspace. An administrator should check its setup.", detail=detail)
        return ClaudeFailed("Comply Agent could not process this request. If the document is very large, work on one section at a time.", detail=detail)
    if isinstance(exc, anthropic.APIStatusError) and getattr(exc, "status_code", 0) >= 500:
        return ClaudeFailed("Comply Agent is temporarily unavailable. Try again shortly.", retryable=True, detail=detail)
    return ClaudeFailed("Comply Agent could not be used for this request.", detail=detail)


def complete(*, use_case: str, system: Union[str, List[dict], None], messages: List[dict],
             schema: Optional[Dict[str, Any]] = None, max_tokens: int = 32000, effort: str = "medium",
             model: Optional[str] = None, on_progress: Optional[Callable[[Progress], None]] = None,
             tools: Optional[List[Dict[str, Any]]] = None, should_stop: Optional[Callable[[], bool]] = None) -> Result:
    """One guarded call. ``system`` is text or text blocks, ``messages`` are Messages-API turns whose content is text.
    ``schema`` (a JSON schema) makes the answer structured and is returned parsed in ``Result.data``.
    ``on_progress`` is called on this thread while the answer arrives (see ``Progress``): to show it, never to act on it.
    ``tools`` are the provider's own tools (web search, web fetch): ``Result.text`` is then the answer written after the last search, with
    ``searches`` and ``sources``. A schema cannot go with them (citations and structured answers do not mix).
    ``should_stop`` is asked before the call and at every event of the answer; True abandons the call (``ClaudeStopped``).

    Raises ``ClaudeNotConfigured`` (no credentials), ``AIBlocked`` (the guard refused), ``LicenceRestrictedContent``,
    ``ClaudeRefused`` (declined, no fallback), ``ClaudeStopped`` or ``ClaudeFailed`` (anything else; ``message`` is safe to show)."""
    if not configured():
        raise ClaudeNotConfigured()
    if should_stop is not None and should_stop():
        raise ClaudeStopped()
    model = model_name(model)
    output_config: Dict[str, Any] = {"effort": effort}
    if schema:
        output_config["format"] = {"type": "json_schema", "schema": schema}
    kwargs: Dict[str, Any] = {"model": model, "max_tokens": max_tokens, "messages": [dict(m) for m in messages],
                              "output_config": output_config, "cache_control": {"type": "ephemeral"}}
    if system:
        kwargs["system"] = system
    if tools:
        kwargs["tools"] = tools
    started = time.perf_counter()
    _screen(system, kwargs["messages"])
    gw = _guard(kwargs, use_case, model, started)
    watcher = None
    if on_progress is not None:
        watcher = _Watcher(on_progress, gw, bool(schema), int(gw.report.get("tokens", 0) + gw.report.get("dropped", 0)) if gw is not None else 0)
        watcher.report("reading")
    def watch(event, stream) -> None:
        if should_stop is not None and should_stop():
            raise ClaudeStopped()
        if watcher is not None:
            watcher(event, stream)
    try:
        message = _stream_final(kwargs, watch if watcher is not None or should_stop is not None else None)
    except ClaudeStopped as exc:
        _record(error=exc, model=model, started_at=started, gw=gw, payload=_payload(gw, kwargs))
        raise
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
    content = list(message.content)
    if tools:       # the answer is what was written after the last search or page opened ("I'll search for …" before it is not)
        last = max((i for i, b in enumerate(content) if getattr(b, "type", "") in _WEB_RESULTS), default=-1)
        content = [b for b in content[last + 1:] if getattr(b, "type", None) == "text"] or content
    text = "".join(getattr(b, "text", "") for b in content if getattr(b, "type", None) == "text")
    truncated = stop == "max_tokens"        # a "pause_turn" (the provider's own search loop reached its limit) keeps what was written
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
    searches = [q for q in (_query(b) for b in message.content) if q]
    return Result(text=text, data=data, model=getattr(message, "model", model) or model, stop_reason=stop,
                  truncated=truncated, usage=usage, report=report, searches=[gw.restore_partial(q) for q in searches] if gw is not None else searches,
                  sources=_found(message.content) if tools else [])


def _payload(gw, kwargs: Dict[str, Any], answer: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """What an administrator can read later: the prompt exactly as it was sent (the guard rewrote ``kwargs``)."""
    if gw is None or gw.mode != "protect":
        return None
    try:
        from . import ledger

        return {"request": ledger.request_snapshot(kwargs, "anthropic"), "answer": answer}
    except Exception:       # noqa: BLE001
        return None
