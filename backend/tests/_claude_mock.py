"""A mock of the provider's wire for tests: the real SDK talks to a handler, so the request it builds and the answer it
parses are the real ones. ``reply(...)`` renders a message as the server-sent events the SDK expects."""
import json
from types import SimpleNamespace
from typing import Callable, Dict, List, Optional

import httpx2


def _event(name: str, data: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(data)}\n\n"


def reply(text: str, *, stop: str = "end_turn", input_tokens: int = 120, output_tokens: int = 30, cache_read: int = 0,
          cache_write: int = 0, model: str = "claude-opus-5-5", details: Optional[dict] = None, chunk: int = 400) -> httpx2.Response:
    """One answer, as the stream of events a real call returns (``chunk`` characters in each delta)."""
    usage = {"input_tokens": input_tokens, "output_tokens": 1, "cache_read_input_tokens": cache_read,
             "cache_creation_input_tokens": cache_write}
    start = {"id": "msg_test", "type": "message", "role": "assistant", "model": model, "content": [],
             "stop_reason": None, "stop_sequence": None, "usage": usage}
    delta: dict = {"stop_reason": stop, "stop_sequence": None}
    if details:
        delta["stop_details"] = details
    body = _event("message_start", {"type": "message_start", "message": start})
    if text:
        body += _event("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}})
        for i in range(0, len(text), chunk):
            body += _event("content_block_delta", {"type": "content_block_delta", "index": 0,
                                                   "delta": {"type": "text_delta", "text": text[i:i + chunk]}})
        body += _event("content_block_stop", {"type": "content_block_stop", "index": 0})
    body += _event("message_delta", {"type": "message_delta", "delta": delta, "usage": {"output_tokens": output_tokens}})
    body += _event("message_stop", {"type": "message_stop"})
    return httpx2.Response(200, content=body.encode("utf-8"), headers={"content-type": "text/event-stream"})


def error(status: int, message: str, kind: str = "invalid_request_error") -> httpx2.Response:
    return httpx2.Response(status, json={"type": "error", "error": {"type": kind, "message": message}})


class Wire:
    """Collects every request the SDK makes and answers with what ``respond`` returns (a function of the request body)."""

    def __init__(self, respond: Callable[[dict], httpx2.Response]):
        self.respond = respond
        self.requests: List[SimpleNamespace] = []

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        body = json.loads(request.content or b"{}")
        self.requests.append(SimpleNamespace(body=body, headers=dict(request.headers), url=str(request.url)))
        return self.respond(body)

    def client(self):
        import anthropic

        return anthropic.Anthropic(api_key="test-key", max_retries=0,
                                   http_client=httpx2.Client(transport=httpx2.MockTransport(self.handler)))
