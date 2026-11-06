"""AI-assisted column mapping — a fallback for files the rule-based mapper
can't confidently place. Reuses the shared OpenAI client (grc.services.openai_client).

Anti-hallucination: the model is given the EXACT allowed field keys and MUST
return one of them or null; anything else is rejected. One target field can be
claimed by at most one source column (higher confidence wins). No DB, isolated.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List

logger = logging.getLogger(__name__)
_MODEL = os.environ.get("AVA_AI_MODEL", "gpt-4o-mini")
_CONF = {"high": 3, "medium": 2, "low": 1}


def ai_available() -> bool:
    try:
        from grc.services.openai_client import check_ai_available
        return bool(check_ai_available())
    except Exception:  # noqa: BLE001
        return False


def ai_suggest_mapping(headers: List[str], samples: Dict[str, List[Any]],
                       fields: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """headers: source column names; samples: {header: [example values]};
    fields: the canonical field set. Returns
    {"ai_used": bool, "mapping": {header: {field, confidence, why}}, "error": str|None}."""
    allowed = list(fields.keys())
    labels = {k: v.get("label", k) for k, v in fields.items()}
    if not headers:
        return {"ai_used": False, "mapping": {}, "error": "no columns"}
    if not ai_available():
        return {"ai_used": False, "mapping": {}, "error": "AI not configured"}
    try:
        from grc.services.openai_client import get_openai_client
        client = get_openai_client()
    except Exception as e:  # noqa: BLE001
        return {"ai_used": False, "mapping": {}, "error": f"AI unavailable: {e}"}

    lines = []
    for h in headers:
        sv = [str(x) for x in (samples.get(h) or [])[:3] if str(x if x is not None else "").strip()]
        lines.append(f"- {h!r}: examples {sv}" if sv else f"- {h!r}: (no sample values)")
    menu = "\n".join(f"  {k} — {labels[k]}" for k in allowed)
    prompt = (
        "Map each SOURCE spreadsheet column to ONE target field key, or null if none fits.\n\n"
        "SOURCE columns (with example values):\n" + "\n".join(lines) +
        "\n\nTARGET field keys (choose ONLY from these exact keys, or null):\n" + menu +
        '\n\nReturn STRICT JSON keyed by the source header:\n'
        '{ "<source header>": {"field": "<target key or null>", '
        '"confidence": "low|medium|high", "why": "<short reason>"}, ... }\n'
        "Rules:\n"
        "- Use ONLY the exact target keys listed above, or null. NEVER invent a key.\n"
        "- Each target key maps to at most ONE source column — pick the best fit.\n"
        "- Judge by BOTH the header name and the example values."
    )
    try:
        resp = client.chat.completions.create(
            model=_MODEL,
            messages=[
                {"role": "system", "content": "You map spreadsheet columns to a fixed schema. Reply with strict JSON only — no markdown, no commentary."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.0,
            max_tokens=900,
            response_format={"type": "json_object"},
        )
        raw = (resp.choices[0].message.content or "").strip()
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.MULTILINE)
        parsed = json.loads(raw)
    except Exception as e:  # noqa: BLE001
        logger.warning("ai_assist mapping failed: %s", e)
        return {"ai_used": False, "mapping": {}, "error": f"AI call failed: {e}"}

    if not isinstance(parsed, dict):
        return {"ai_used": False, "mapping": {}, "error": "AI returned a non-object"}

    # Collect valid candidates, then enforce one-field-per-column (best conf wins).
    cand: Dict[str, Dict[str, Any]] = {}
    for h in headers:
        v = parsed.get(h)
        if not isinstance(v, dict):
            continue
        fk = v.get("field")
        fk = fk.strip() if isinstance(fk, str) else None
        if fk not in allowed:
            fk = None
        conf = (v.get("confidence") or "low")
        conf = conf.strip().lower() if isinstance(conf, str) else "low"
        if conf not in _CONF:
            conf = "low"
        why = v.get("why")
        why = why.strip()[:80] if isinstance(why, str) and why.strip() else ("no field fits" if not fk else "matched")
        cand[h] = {"field": fk, "confidence": conf, "why": f"AI · {why}"}

    out: Dict[str, Dict[str, Any]] = {h: {"field": None, "confidence": "low", "why": "AI · no suggestion"} for h in headers}
    taken: Dict[str, str] = {}  # field -> header already assigned
    for h, c in sorted(cand.items(), key=lambda kv: -_CONF[kv[1]["confidence"]]):
        fk = c["field"]
        if fk and fk in taken:
            out[h] = {**c, "field": None, "why": "AI · duplicate of a stronger column"}
        else:
            out[h] = c
            if fk:
                taken[fk] = h
    return {"ai_used": True, "mapping": out, "error": None}
