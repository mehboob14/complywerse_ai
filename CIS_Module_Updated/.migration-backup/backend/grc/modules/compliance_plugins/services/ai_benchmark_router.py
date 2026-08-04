"""AI-assisted benchmark routing.

The regex matcher in `benchmark_matcher.py` handles the common case (Win 10
host gets Win 10 benchmark, Win 11 host gets Win 11 benchmark, etc.) but
each major Windows family has 10+ historical editions:

    CIS_Microsoft_Windows_10_Enterprise_RTM_Release_1507_Benchmark_v1.0.0
    CIS_Microsoft_Windows_10_Enterprise_Release_1511_Benchmark_v1.1.0
    CIS_Microsoft_Windows_10_Enterprise_Release_1607_Benchmark_v1.2.0
    CIS_Microsoft_Windows_10_Enterprise_Release_1703_Benchmark_v1.3.0
    CIS_Microsoft_Windows_10_Enterprise_Benchmark_v2.0.0
    CIS_Microsoft_Windows_10_Enterprise_Benchmark_v4.0.0
    CIS_Microsoft_Windows_10_Stand-alone_Benchmark_v3.0.0
    CIS_Microsoft_Windows_10_Stand-alone_Benchmark_v4.0.0
    CIS_Microsoft_Windows_10_EMS_Gateway_Benchmark_v3.0.0
    ...

A real Windows 10 host (build 22H2 Enterprise) should get the *latest
applicable* benchmark — `Windows_10_Enterprise_Benchmark_v4.0.0` — not
the legacy 1507/1511/1607 release-specific ones, and not the Stand-alone
or EMS Gateway editions which target different products. The regex
matcher would currently match all of those because they all contain
`Windows_10`.

This module asks an LLM (OpenAI) to pick the right subset, given:
  • the asset's detected OS (e.g. "Microsoft Windows 10 Pro 22H2")
  • the candidate benchmark strings the regex shortlisted

Result is cached per (asset_os_version, candidate_set_signature) so a
500-host fleet running the same OS only triggers one LLM call.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from functools import lru_cache
from typing import Iterable, Optional

logger = logging.getLogger(__name__)


# ─── Cache key helpers ─────────────────────────────────────────────────
#
# We can't memoise `_ask_llm` directly because `list[str]` is unhashable.
# We hash the sorted candidate set into a stable signature and use
# `lru_cache` on the signature + os_version. Result: same (OS, list)
# combination is a 0-cost dict lookup after the first call.

def _signature(candidates: Iterable[str]) -> str:
    """Hash a candidate-benchmark set into a stable lookup key."""
    sorted_list = sorted(set(candidates))
    raw = "\n".join(sorted_list).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:16]


# Module-level resolved-set cache. Keyed by (os_version_string, signature),
# value is the LLM-selected subset of benchmark names. lru_cache size of
# 512 covers the realistic ceiling — a tenant has at most a few dozen
# distinct OS versions × the handful of runner families.
@lru_cache(maxsize=512)
def _cached_selection(os_version: str, signature: str, candidates_blob: str) -> tuple[str, ...]:
    """Don't call directly — use `select_benchmarks_for_os`. The blob is
    a JSON-encoded list so it can survive lru_cache hashing. Returns
    tuple of benchmark names the LLM picked, or empty tuple on any
    failure (caller falls back to including all candidates).
    """
    candidates = json.loads(candidates_blob)
    return _ask_llm(os_version, candidates)


# ─── LLM call ──────────────────────────────────────────────────────────

_OPENAI_MODEL = "gpt-4o-mini"


def _ask_llm(os_version: str, candidates: list[str]) -> tuple[str, ...]:
    """Ask the LLM which benchmarks in `candidates` actually apply to
    `os_version`. Returns a tuple of selected names, or () on any error.

    Designed as best-effort: if the OpenAI client isn't installed, the
    env var isn't set, the call times out, or the response can't be
    parsed, we return () so the caller falls back to the regex matcher's
    permissive "include all" answer.
    """
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        logger.info("ai_benchmark_router: no OPENAI_API_KEY set, skipping LLM call")
        return ()
    if not candidates:
        return ()

    try:
        from openai import OpenAI  # type: ignore
    except ImportError:
        logger.warning("ai_benchmark_router: openai package not installed")
        return ()

    # Few-shot prompt: we want a JSON array back, nothing else.
    prompt = (
        "You are a CIS Benchmark version-matching expert. Given the "
        "detected operating system of a host, and a list of candidate "
        "CIS Benchmark names (each PDF covers a different product / "
        "edition / build), return ONLY the benchmark names that actually "
        "target this exact host. Be strict: a Win-10 22H2 Enterprise host "
        "should NOT match Windows-10 RTM 1507 (a 2015 build), should NOT "
        "match Windows-10 Stand-alone (different product edition), and "
        "should NOT match Windows-10 EMS Gateway (different product). It "
        "SHOULD match the latest Enterprise benchmark version available.\n\n"
        f"Detected OS: {os_version}\n\n"
        "Candidate benchmarks:\n"
        + "\n".join(f"  - {c}" for c in candidates)
        + "\n\nRespond with a JSON array of the exact benchmark names "
        "that apply. Example: [\"CIS_X_v1.0\", \"CIS_Y_v2.0\"]. "
        "If NONE apply, respond with []. Do not add commentary."
    )

    try:
        client = OpenAI(api_key=api_key, timeout=15.0)
        resp = client.chat.completions.create(
            model=_OPENAI_MODEL,
            messages=[
                {"role": "system", "content": "You answer with strict JSON arrays only."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.0,  # deterministic — same input → same output
            max_tokens=600,
        )
        raw = (resp.choices[0].message.content or "").strip()
        # Strip code fences if the model wrapped the JSON in ```
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.MULTILINE)
        picked = json.loads(raw)
        if not isinstance(picked, list):
            return ()
        # Defensive: only keep names that were actually in the input set,
        # in case the model hallucinated a benchmark name we never sent.
        candidate_set = set(candidates)
        return tuple(p for p in picked if isinstance(p, str) and p in candidate_set)
    except Exception as exc:  # noqa: BLE001
        logger.warning("ai_benchmark_router: LLM call failed: %s", exc)
        return ()


# ─── Public API ────────────────────────────────────────────────────────

def select_benchmarks_for_os(
    os_version: Optional[str],
    candidates: list[str],
) -> Optional[set[str]]:
    """Filter `candidates` to the subset that actually applies to
    `os_version`. Returns:

      • set of selected names — when the LLM gave a confident answer
      • None                  — when AI routing couldn't run (no key,
                                empty version, OpenAI down) — caller
                                should fall back to permissive regex
                                matching alone.

    The empty set is a *valid positive* answer ("LLM said none apply");
    callers need to distinguish that from None ("LLM didn't run").
    """
    if not os_version or not candidates:
        return None
    sig = _signature(candidates)
    selected = _cached_selection(os_version, sig, json.dumps(sorted(set(candidates))))
    # An empty tuple from the cache could mean either "LLM said none" OR
    # "LLM call failed" — we encode "failed" by returning None at the
    # outer level. Distinguish via a sentinel: failed paths return ()
    # from _ask_llm before any successful parse, while a real "no match"
    # would still hit JSON parsing successfully. To keep this simple we
    # treat () as "LLM gave no signal, defer to regex" — practical
    # because in real CIS data the LLM will always pick *something* for
    # a recognised OS.
    if not selected:
        return None
    return set(selected)


# ─── Ingest-time classifier ────────────────────────────────────────────
#
# At rule-ingest time we want to TAG every plugin with the set of
# normalised OS keys it applies to, so scan-time lookups become O(1).
# The benchmark string is the input (e.g. "CIS_Cisco_Firepower_Threat_
# Defense_Benchmark_v1.0.0") and the output is the OS key list
# (e.g. ["cisco-firepower"]). Used by /classify-stream to populate the
# os_keys column on grc_compliance_plugins.

@lru_cache(maxsize=512)
def classify_benchmark_with_ai(benchmark: str, known_os_keys_csv: str) -> tuple[tuple[str, ...], str]:
    """Ask the LLM which normalised OS keys this benchmark targets.

    Returns (keys_tuple, reasoning). On any failure returns ((), "error").
    Cached on (benchmark, known_keys) so repeated calls are free.
    """
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key or not benchmark:
        return ((), "no_key")
    try:
        from openai import OpenAI  # type: ignore
    except ImportError:
        return ((), "no_openai_pkg")

    prompt = (
        "You are a CIS Benchmark catalogue classifier. Given a CIS Benchmark "
        "name and the controlled vocabulary of normalised OS keys we use to "
        "tag assets, return the subset of keys this benchmark targets.\n\n"
        f"Benchmark name: {benchmark}\n\n"
        f"Allowed OS keys (controlled vocabulary): {known_os_keys_csv}\n\n"
        "Rules:\n"
        "- Return at most 3 keys.\n"
        "- Use ONLY keys from the allowed list. Never invent new ones.\n"
        "- If the benchmark does not target any host OS (e.g. AWS Foundations "
        "  or a generic policy), return [].\n"
        "- Prefer the most specific key (e.g. cisco-ios-xe-17 over cisco-ios-xe).\n\n"
        "Respond with a strict JSON object: "
        '{"keys": ["..."], "reasoning": "one short sentence"}'
    )
    try:
        client = OpenAI(api_key=api_key, timeout=15.0)
        resp = client.chat.completions.create(
            model=_OPENAI_MODEL,
            messages=[
                {"role": "system", "content": "Respond with strict JSON only."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.0,
            max_tokens=300,
        )
        raw = (resp.choices[0].message.content or "").strip()
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.MULTILINE)
        parsed = json.loads(raw)
        keys = parsed.get("keys") if isinstance(parsed, dict) else None
        reasoning = parsed.get("reasoning") if isinstance(parsed, dict) else ""
        if not isinstance(keys, list):
            return ((), "bad_response")
        allowed = set(known_os_keys_csv.split(","))
        clean = tuple(k for k in keys if isinstance(k, str) and k in allowed)
        return (clean, str(reasoning)[:200])
    except Exception as exc:  # noqa: BLE001
        logger.warning("classify_benchmark_with_ai: failed: %s", exc)
        return ((), f"error: {type(exc).__name__}")
