"""Find every place the code can reach an AI provider, by reading the source (no imports, no network).

``scan_calls()`` is what ``tests/test_ai_registry.py`` compares with the registry: every call to a provider SDK in
``backend/grc`` and every raw HTTP call to a provider in the pentest engine must belong to a registered use case.
A call is attributed to the function it sits in, as ``"<path relative to backend/grc>:<Class.function>"``; the
pentest engine's paths start with ``ava-pentest-engine/``.
"""
from __future__ import annotations

import ast
import os
import re
import warnings
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

GRC = Path(__file__).resolve().parents[2]            # backend/grc
ENGINE = GRC.parents[1] / "ava-pentest-engine"       # repo root / ava-pentest-engine (may be absent in a sparse checkout)

# the end of the dotted call path -> which API family it is (the shim in grc/config.py patches only "chat" today)
_TAILS = {
    "chat.completions.create": "chat", "chat.completions.parse": "chat", "chat.completions.stream": "chat",
    "completions.create": "chat",
    "responses.create": "responses", "responses.parse": "responses", "responses.stream": "responses",
    "embeddings.create": "embeddings",
    "messages.create": "anthropic", "messages.stream": "anthropic",
    "images.generate": "other", "audio.transcriptions.create": "other", "audio.speech.create": "other",
    "moderations.create": "other",
}
PROVIDER_HOSTS = re.compile(
    r"api\.openai\.com|api\.anthropic\.com|openai\.azure\.com|/v1/chat/completions|/v1/responses|/v1/embeddings|"
    r"generativelanguage\.googleapis|api\.cohere|api\.mistral|api\.groq|api\.together|openrouter\.ai|api\.deepseek|api\.x\.ai"
)
# SDKs of other providers (a new one means a new egress path that needs a decision)
OTHER_SDKS = re.compile(
    r"^\s*(?:from|import)\s+(anthropic|litellm|cohere|groq|mistralai|google\.generativeai|langchain_openai|langchain_anthropic|ollama)\b",
    re.M,
)


@dataclass(frozen=True)
class Site:
    path: str
    function: str
    line: int
    api: str          # chat | responses | embeddings | anthropic | other | http

    @property
    def key(self) -> str:
        return f"{self.path}:{self.function}"


@dataclass
class Index:
    calls: List[Site]
    functions: Set[Tuple[str, str]]                 # (path, qualname) of every function in backend/grc
    hosts: List[Tuple[str, str, int, str]]          # provider host strings in backend/grc: path, function, line, text
    sdk_imports: List[Tuple[str, str]]              # path, module
    spans: Dict[str, List[Tuple[int, int, str]]]    # path -> (first line, last line, qualname) of every function


def _parse(path: Path) -> Optional[ast.AST]:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")           # old regex strings raise SyntaxWarning
            return ast.parse(path.read_text(encoding="utf-8-sig"))
    except (SyntaxError, UnicodeDecodeError, OSError):
        return None


def _dotted(node: ast.AST) -> str:
    parts: List[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
    return ".".join(reversed(parts))


class _Visitor(ast.NodeVisitor):
    def __init__(self, rel: str, want_hosts: bool):
        self.rel, self.want_hosts = rel, want_hosts
        self.stack: List[str] = []
        self.calls: List[Site] = []
        self.hosts: List[Tuple[str, str, int, str]] = []
        self.functions: List[Tuple[int, int, str]] = []

    def _qual(self) -> str:
        return ".".join(self.stack) or "<module>"

    def visit_ClassDef(self, node):
        self.stack.append(node.name)
        self.generic_visit(node)
        self.stack.pop()

    def visit_FunctionDef(self, node):
        self.stack.append(node.name)
        self.functions.append((node.lineno, node.end_lineno or node.lineno, ".".join(self.stack)))
        self.generic_visit(node)
        self.stack.pop()

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_Call(self, node):
        dotted = _dotted(node.func)
        for tail, api in _TAILS.items():
            if dotted == tail or dotted.endswith("." + tail):
                self.calls.append(Site(self.rel, self._qual(), node.lineno, api))
                break
        self.generic_visit(node)

    def visit_Constant(self, node):
        if self.want_hosts and isinstance(node.value, str) and PROVIDER_HOSTS.search(node.value):
            self.hosts.append((self.rel, self._qual(), node.lineno, node.value[:80]))


@lru_cache(maxsize=1)
def index() -> Index:
    calls: List[Site] = []
    functions: Set[Tuple[str, str]] = set()
    hosts: List[Tuple[str, str, int, str]] = []
    sdk_imports: List[Tuple[str, str]] = []
    spans: Dict[str, List[Tuple[int, int, str]]] = {}

    for dirpath, dirnames, filenames in os.walk(GRC):
        dirnames[:] = [d for d in dirnames if d != "__pycache__"]
        for name in filenames:
            if not name.endswith(".py"):
                continue
            path = Path(dirpath) / name
            rel = path.relative_to(GRC).as_posix()
            tree = _parse(path)
            if tree is None:
                continue
            visitor = _Visitor(rel, want_hosts=True)
            visitor.visit(tree)
            calls += visitor.calls
            hosts += visitor.hosts
            spans[rel] = visitor.functions
            functions |= {(rel, q) for _, _, q in visitor.functions}
            try:
                text = path.read_text(encoding="utf-8-sig")
            except (UnicodeDecodeError, OSError):
                continue
            sdk_imports += [(rel, m.group(1)) for m in OTHER_SDKS.finditer(text)]

    if ENGINE.is_dir():    # the pentest engine talks to the provider over raw HTTP: its host strings are its call sites
        for dirpath, dirnames, filenames in os.walk(ENGINE):
            dirnames[:] = [d for d in dirnames if d not in ("__pycache__", "venv", "node_modules", ".git")]
            for name in filenames:
                if not name.endswith(".py"):
                    continue
                path = Path(dirpath) / name
                tree = _parse(path)
                if tree is None:
                    continue
                rel = "ava-pentest-engine/" + path.relative_to(ENGINE).as_posix()
                visitor = _Visitor(rel, want_hosts=True)
                visitor.visit(tree)
                seen: Set[str] = set()
                for _, function, line, _text in visitor.hosts:
                    if function not in seen:
                        seen.add(function)
                        calls.append(Site(rel, function, line, "http"))

    return Index(sorted(calls, key=lambda s: (s.path, s.function, s.line)), functions, hosts, sdk_imports, spans)


def scan_calls() -> List[Site]:
    return index().calls


def enclosing_function(path: str, line: int) -> Optional[str]:
    """The innermost function of ``path`` (relative to backend/grc) that contains ``line``."""
    best: Optional[Tuple[int, str]] = None
    for first, last, qual in index().spans.get(path, []):
        if first <= line <= last and (best is None or first >= best[0]):
            best = (first, qual)
    return best[1] if best else None
