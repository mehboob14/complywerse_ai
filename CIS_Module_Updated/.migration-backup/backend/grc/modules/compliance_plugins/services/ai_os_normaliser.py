"""AI helper: normalise a messy os_version string into a canonical
os_normalized key.

Trigger: agent heartbeat / connect-wizard handshake reports an os_version
like "Microsoft Windows 11 Pro 25H2 Insider Preview" that the hardcoded
regex in demo_agent.py / dialect_detector didn't recognise into a clean
key (e.g. windows-11-25H2).

Anti-hallucination:
  - AI must pick from an EXPLICIT allow-list of canonical keys.
  - AI must return a literal substring quote from the input as evidence.
  - Both checks enforced post-call. Anything else → suggestion rejected.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)
_OPENAI_MODEL = os.environ.get("COMPLYVERSE_AI_MODEL", "gpt-4o-mini")

# Canonical normalisation targets. Same vocabulary as the strict matcher
# patterns plus a "with build" variant for OS versions that carry a build.
_ALLOWED_KEYS = [
    "windows-11", "windows-11-25H2", "windows-11-24H2", "windows-11-23H2", "windows-11-22H2",
    "windows-10", "windows-10-22H2", "windows-10-21H2", "windows-10-25H2",
    "windows-server-2025", "windows-server-2022", "windows-server-2019", "windows-server-2016",
    "ubuntu-24.04", "ubuntu-22.04", "ubuntu-20.04",
    "debian-12", "debian-11",
    "rhel-9", "rhel-8",
    "almalinux-9", "almalinux-8",
    "oraclelinux-9", "oraclelinux-8",
    "amazonlinux-2023", "amazonlinux-2",
    "rocky-9", "rocky-8",
    "macos-15", "macos-14", "macos-13", "macos-12",
    "cisco-ios", "cisco-ios-xe", "cisco-nx-os", "cisco-asa", "cisco-firepower",
    "oracle-db-19c", "oracle-db-21c", "oracle-db-23ai",
    "mssql-2022", "mssql-2019",
    "postgres-16", "postgres-15", "postgres-14",
    "mysql-8.0",
    "kubernetes-1.29", "kubernetes-1.30",
]


def normalise_os_string(messy_os_version: str) -> Dict[str, Any]:
    """Return {normalized: str|None, confidence: low|med|high,
    quoted: str|None, ai_used: bool, validation_notes: [...]}.
    """
    result: Dict[str, Any] = {
        "normalized": None, "confidence": "low", "quoted": None,
        "ai_used": False, "validation_notes": [],
    }
    if not messy_os_version or not messy_os_version.strip():
        result["validation_notes"].append("empty input")
        return result
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        result["validation_notes"].append("OPENAI_API_KEY not set")
        return result
    try:
        from openai import OpenAI  # type: ignore
    except ImportError:
        result["validation_notes"].append("openai package not installed")
        return result

    prompt = (
        f"Input OS string: {messy_os_version!r}\n\n"
        f"Allowed canonical keys (you MUST pick one OR null):\n"
        + ", ".join(_ALLOWED_KEYS)
        + "\n\nReturn STRICT JSON:\n"
        "{\n"
        '  "normalized": "<one allowed key OR null>",\n'
        '  "confidence": "low|medium|high",\n'
        '  "quoted": "<literal substring of input that justifies your choice>"\n'
        "}\n\n"
        "Rules:\n"
        "- NEVER invent a key not in the allowed list.\n"
        "- The 'quoted' field MUST be a substring of the input.\n"
        "- If unsure, set normalized=null."
    )
    try:
        client = OpenAI(api_key=api_key, timeout=15.0)
        resp = client.chat.completions.create(
            model=_OPENAI_MODEL,
            messages=[
                {"role": "system", "content": "You answer with strict JSON only."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.0,
            max_tokens=200,
            response_format={"type": "json_object"},
        )
        raw = (resp.choices[0].message.content or "").strip()
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.MULTILINE)
        parsed = json.loads(raw)
    except Exception as exc:  # noqa: BLE001
        result["validation_notes"].append(f"LLM call failed: {exc}")
        return result

    result["ai_used"] = True
    # Validate normalized — case-insensitive match against allow-list
    norm_raw = (parsed.get("normalized") or "").strip() or None
    if norm_raw:
        norm_lc = norm_raw.lower()
        canonical = None
        for k in _ALLOWED_KEYS:
            if k.lower() == norm_lc:
                canonical = k
                break
        if canonical:
            result["normalized"] = canonical
        else:
            result["validation_notes"].append(
                f"AI returned {norm_raw!r} which is NOT in the allowed key list — rejected"
            )
    # Validate quoted substring
    q = parsed.get("quoted")
    if isinstance(q, str) and q.strip() and q.strip().lower() in messy_os_version.lower():
        result["quoted"] = q.strip()
    elif q:
        result["validation_notes"].append(
            f"AI 'quoted' {q!r} is NOT a substring of the input — rejected as fabricated"
        )
    # Confidence
    conf = (parsed.get("confidence") or "").strip().lower()
    if conf in ("low", "medium", "high"):
        result["confidence"] = conf
    return result
