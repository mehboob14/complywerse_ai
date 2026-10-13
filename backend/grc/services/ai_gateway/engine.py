"""The data-protection guard in front of every chat completion.

``begin(kwargs)`` runs inside the shim in ``grc/config.py`` before a prompt leaves the process. It finds what must not
leave (by pattern, and by the tenant's own names), replaces it, refuses what cannot be made safe, and hands back a
``Gateway``; ``Gateway.finish(response)`` puts the original values back into the answer before the caller reads it.
Callers are untouched: they build the prompt and parse the answer exactly as before.

What happens to a value (see ``patterns`` and ``dictionary``):
* a secret, a card/account/identity number, a MAC address is **removed** (``<REMOVED_SECRET>``) and never restored;
* an e-mail address, phone number, IP address, cloud id, host, person, organisation, unit, vendor, project or asset
  is replaced by ``<TYPE_n>`` and **restored** in the answer;
* public names (frameworks, regulators, common products, role titles) are left alone.

What is refused (``AIBlocked``): images/PDF pages (``vision_blocked``: local OCR comes first, an outside service never
sees pixels), a use case registered as never-public (L4), streaming, a secret still in the prompt after the
replacement, and any fault in the guard itself: it fails closed and never sends the original.

``AI_GATEWAY_MODE`` (operator level, not a user setting): ``protect`` (default), ``monitor`` (find and count, send the
original: for calibration only) or ``off`` (emergency).
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from collections import Counter
from dataclasses import dataclass, field, replace
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from . import dictionary as dictionaries
from . import patterns, registry
from .errors import AIBlocked
from .tokens import TokenMap, mask_tokens, removed_marker, restore

logger = logging.getLogger(__name__)

NOTE = ("Values written like <PERSON_1> or <HOST_2> stand for real values that are not shown to you. Treat each as an "
        "opaque name: copy it exactly as written wherever you refer to it, and never guess what it stands for.")
_VISION_PARTS = frozenset({"image_url", "input_image", "image", "input_file", "file", "input_audio", "audio"})
_TEXT_PARTS = frozenset({"text", "input_text", "output_text"})
_DATA_URL = re.compile(r"data:[\w/+.-]+;base64,[A-Za-z0-9+/=]{1000,}")
_RULE = {"SECRET": "B1", "MAC": "B1", "PAN": "B2", "IBAN": "B2", "NATIONAL_ID": "B3"}


@dataclass
class Gateway:
    """What ``begin`` knew about one call, kept to restore its answer and to report on it."""
    mode: str
    scope: TokenMap
    report: Dict[str, Any]
    context: Any = None                       # the AIUsageContext found before the call (so it is found once)
    seen: Set[str] = field(default_factory=set)       # every value found in the prompt
    cache_key: Optional[str] = None                   # set by the shim when the use case may be answered from the result cache

    # ── the answer ──────────────────────────────────────────────────────────
    def _clean(self, text: str, counts: Counter) -> str:
        """Remove sensitive-looking strings the model made up (a secret or card/account number that was not in the
        prompt), then put the original values back into the placeholders."""
        found = patterns.resolve(patterns.detect_dropped(mask_tokens(text)), len(text))
        for e in reversed([e for e in found if e.value not in self.seen]):
            text = text[:e.start] + removed_marker(e.type) + text[e.end:]
            counts["invented"] += 1
        text, stats = restore(text, self.scope)
        counts["restored"] += stats["restored"]
        counts["unknown_tokens"] += stats["unknown"]
        return text

    def _set(self, obj: Any, name: str, counts: Counter) -> None:
        value = getattr(obj, name, None)
        if isinstance(value, str) and value:
            new = self._clean(value, counts)
            if new != value:
                setattr(obj, name, new)

    def finish(self, response: Any) -> Any:
        """Restore the original values in every text the answer carries. Never raises."""
        if self.mode != "protect":
            return response
        counts: Counter = Counter()
        try:
            for choice in getattr(response, "choices", None) or []:              # chat completions
                message = getattr(choice, "message", None)
                if message is None:
                    continue
                self._set(message, "content", counts)
                for call in getattr(message, "tool_calls", None) or []:
                    self._set(getattr(call, "function", None), "arguments", counts)
                self._set(getattr(message, "function_call", None), "arguments", counts)
            for item in getattr(response, "output", None) or []:                  # the Responses API
                kind = getattr(item, "type", None)
                if kind == "message":
                    for part in getattr(item, "content", None) or []:
                        if getattr(part, "type", None) == "output_text":
                            self._set(part, "text", counts)
                elif kind == "function_call":
                    self._set(item, "arguments", counts)
        except Exception:
            logger.exception("restoring the answer failed; placeholders may remain in it")
            counts["restore_failed"] += 1
        self.report.update({k: counts[k] for k in ("restored", "unknown_tokens", "invented", "restore_failed") if counts[k]})
        return response


# ── the prompt ──────────────────────────────────────────────────────────────
def _has_vision(messages: List[Any]) -> bool:
    for m in messages:
        content = m.get("content") if isinstance(m, dict) else None
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") in _VISION_PARTS:
                    return True
                if isinstance(part, dict) and isinstance(part.get("text"), str) and _DATA_URL.search(part["text"]):
                    return True
        elif isinstance(content, str) and _DATA_URL.search(content):
            return True
    return False


def _texts(messages: List[Any]) -> List[str]:
    out: List[str] = []
    _rewrite(messages, lambda t: out.append(t) or t)
    return out


def _rewrite(messages: List[Any], fn: Callable[[str], str]) -> List[Any]:
    """The messages with ``fn`` applied to every text in them; the caller's own objects are never changed."""
    result = []
    for message in messages:
        if not isinstance(message, dict):
            raise TypeError("a message that is not a mapping cannot be checked")
        new = dict(message)
        content = message.get("content")
        if isinstance(content, str):
            new["content"] = fn(content)
        elif isinstance(content, list):
            parts = []
            for part in content:
                if isinstance(part, dict) and part.get("type") in _TEXT_PARTS and isinstance(part.get("text"), str):
                    part = dict(part, text=fn(part["text"]))
                parts.append(part)
            new["content"] = parts
        calls = message.get("tool_calls")
        if isinstance(calls, list):
            new_calls = []
            for call in calls:
                function = call.get("function") if isinstance(call, dict) else None
                if isinstance(function, dict) and isinstance(function.get("arguments"), str):
                    call = dict(call, function=dict(function, arguments=fn(function["arguments"])))
                new_calls.append(call)
            new["tool_calls"] = new_calls
        legacy = message.get("function_call")
        if isinstance(legacy, dict) and isinstance(legacy.get("arguments"), str):
            new["function_call"] = dict(legacy, arguments=fn(legacy["arguments"]))
        # items of the Responses API that are not messages
        if message.get("type") == "function_call_output" and isinstance(message.get("output"), str):
            new["output"] = fn(message["output"])
        if message.get("type") == "function_call" and isinstance(message.get("arguments"), str):
            new["arguments"] = fn(message["arguments"])
        result.append(new)
    return result


def _prompt(kwargs: Dict[str, Any], api: str):
    """The prompt as chat-style messages whatever the API calls it, and how to write the protected one back:
    ``(messages, write)``, or ``(None, None)`` when there is nothing in a shape the guard understands."""
    if api == "chat":
        messages = kwargs.get("messages")
        if not isinstance(messages, list):
            return None, None
        return messages, lambda new: kwargs.__setitem__("messages", new)
    instructions, items = kwargs.get("instructions"), kwargs.get("input")        # the Responses API
    messages: List[Any] = []
    if isinstance(instructions, str):
        messages.append({"role": "system", "content": instructions})
    if isinstance(items, str):
        messages.append({"role": "user", "content": items})
    elif isinstance(items, list):
        messages.extend(items)
    elif items is not None:
        return None, None
    if not messages:
        return None, None
    had_instructions, input_was_text, size = isinstance(instructions, str), isinstance(items, str), len(messages)

    def write(new: List[Any]) -> None:
        rest = list(new)
        if had_instructions or len(rest) > size:           # the first message is the instructions (or only the note)
            kwargs["instructions"] = rest.pop(0)["content"]
        if items is not None:
            kwargs["input"] = rest[0]["content"] if input_was_text else rest
    return messages, write


_UESC = re.compile(r"\\u([0-9a-fA-F]{4})")


def _unescape(text: str) -> Optional[Tuple[str, List[int]]]:
    """``json.dumps`` writes non-ASCII as ``\\uXXXX``, which hides an Arabic or accented name from a match on the name.
    For a text carrying such escapes: the decoded text, and for each decoded character where it starts in the original
    (one more entry at the end). ``None`` when there is nothing to decode."""
    matches = list(_UESC.finditer(text))
    if not matches:
        return None
    decoded: List[str] = []
    starts: List[int] = []
    pos, k = 0, 0
    while k < len(matches):
        m = matches[k]
        decoded.append(text[pos:m.start()])
        starts.extend(range(pos, m.start()))
        code, end = int(m.group(1), 16), m.end()
        if 0xD800 <= code <= 0xDBFF and k + 1 < len(matches) and matches[k + 1].start() == end:     # a surrogate pair
            low = int(matches[k + 1].group(1), 16)
            if 0xDC00 <= low <= 0xDFFF:
                code, end, k = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00), matches[k + 1].end(), k + 1
        decoded.append(chr(code))
        starts.append(m.start())
        pos, k = end, k + 1
    decoded.append(text[pos:])
    starts.extend(range(pos, len(text)))
    starts.append(len(text))
    return "".join(decoded), starts


def _use_case(site) -> Optional[registry.UseCase]:
    """The registered use case of the calling function (the most sensitive one when a helper serves several)."""
    found = registry.lookup(site[0], site[1]) if site else []
    return max(found, key=lambda u: registry.LEVELS.index(u.level)) if found else None


def begin(kwargs: Dict[str, Any], mode: str = "protect", api: str = "chat") -> Optional[Gateway]:
    """Protect the prompt in ``kwargs`` (the dict, not the caller's own objects) and return the handle that restores
    the answer. ``api`` is ``chat`` (``messages``) or ``responses`` (``instructions`` and ``input``). ``None`` when
    there is nothing to protect. Raises ``AIBlocked`` when the prompt must not be sent."""
    from ..ai_usage import callsite, resolve_context

    started = time.perf_counter()
    messages, write = _prompt(kwargs, api)
    if messages is None:
        return None
    protect = mode != "monitor"
    report: Dict[str, Any] = {"mode": "protect" if protect else "monitor", "decision": "allowed"}
    if api != "chat":
        report["api"] = api
    uc = _use_case(callsite())
    report.update(use_case=uc.id if uc else None, level=uc.level if uc else None, registered=uc is not None)
    context = resolve_context()
    report["tenant"] = bool(context.tenant_slug)

    def refuse(code: str, message: str, rule: str):
        report.update(decision="blocked", blocked=code, rule=rule, ms=round((time.perf_counter() - started) * 1000, 1))
        raise AIBlocked(code, message, rule=rule, use_case=report["use_case"], report=report)

    if protect and kwargs.get("stream"):
        refuse("stream_unsupported", "AI was not used because streamed answers cannot be checked for protected data.", "B13")
    if _has_vision(messages):
        report["vision"] = True
        if protect:      # a picture or scanned page cannot be masked: local text extraction comes first (B4)
            refuse("vision_blocked", "AI could not read this file because it is only available as an image, and images "
                   "are not sent to an outside service. Provide it as text instead.", "B4")
    if protect and uc is not None and uc.level == "L4":
        refuse("restricted_data", "AI was not used because this request would send raw records to an outside service.", "B12")

    dictionary = None
    if uc is None or uc.level != "L0":          # library and framework text carries no tenant names: patterns only
        if context.tenant_slug:
            try:
                dictionary = dictionaries.get(context.tenant_slug)
            except Exception:
                logger.exception("the tenant's names could not be loaded for the data-protection check")
                if protect:
                    refuse("dictionary_unavailable", "AI was not used because the data-protection check could not load "
                           "this organisation's names.", "B13")
        else:
            report["baseline_only"] = True       # no tenant resolved (B8): patterns only
    report["dictionary_terms"] = len(dictionary) if dictionary else 0

    try:
        gateway = Gateway(report["mode"], TokenMap(_texts(messages)), report, context)
    except TypeError:
        refuse("unscannable_payload", "AI was not used because part of the request could not be checked.", "B13")
    counts: Counter = Counter()
    changed: List[str] = []

    def sanitise(text: str) -> str:
        view = _unescape(text)                  # find names inside JSON text, where non-ASCII is written \uXXXX
        scan, starts = view if view else (text, None)
        found = patterns.detect(scan)
        if dictionary is not None:
            found += dictionary.find(scan)
        chosen = patterns.resolve(found, len(scan))
        if starts:
            chosen = [replace(e, start=starts[e.start], end=starts[e.end]) for e in chosen]
        if not chosen:
            return text
        out, pos = [], 0
        for e in chosen:
            gateway.seen.add(e.value)
            counts[e.type] += 1
            if protect:
                out.append(text[pos:e.start])
                out.append(removed_marker(e.type) if e.action == "drop" else gateway.scope.token(e.type, e.value))
                pos = e.end
        if not protect:
            return text
        out.append(text[pos:])
        new = "".join(out)
        changed.append(new)
        return new

    new_messages = _rewrite(messages, sanitise)

    for text in changed:                         # the replacement must not have left, or made, anything that cannot leave
        masked = mask_tokens(text)
        left = patterns.detect_dropped(masked)
        if left:
            report["residual"] = sorted({e.type for e in left})
            refuse("secret_survived", "AI was not used because the request still contained a secret or an account "
                   "number after the data-protection check.", _RULE.get(left[0].type, "B1"))
        if dictionary is not None:
            report["residual_terms"] = report.get("residual_terms", 0) + len(dictionary.find(masked))

    report["entities"] = dict(counts)
    report["tokens"] = len(gateway.scope)
    report["dropped"] = sum(n for t, n in counts.items() if t in patterns.DROP_TYPES)
    if protect:
        if len(gateway.scope):
            report["note"] = True
            new_messages = _with_note(new_messages)
        write(new_messages)
        # what the cost report reads: the same prompt twice has the same hash (placeholders are numbered by first
        # appearance), and the size says whether the call was big because of the question or the data around it
        report["hash"] = hashlib.sha256(json.dumps(new_messages, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")).hexdigest()[:16]
        report["chars"] = sum(len(t) for t in _texts(new_messages))
    report["effort"] = kwargs.get("reasoning_effort") or (kwargs.get("reasoning") or {}).get("effort")
    report["ms"] = round((time.perf_counter() - started) * 1000, 1)
    return gateway


def _with_note(messages: List[Any]) -> List[Any]:
    """Tell the model what the placeholders are: appended to the first system message, or a new one."""
    for i, m in enumerate(messages):
        if m.get("role") in ("system", "developer") and isinstance(m.get("content"), str):
            return messages[:i] + [dict(m, content=m["content"] + "\n\n" + NOTE)] + messages[i + 1:]
    return [{"role": "system", "content": NOTE}] + messages
