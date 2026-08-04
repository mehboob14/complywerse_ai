"""On-demand AI-generated natural-language summaries for audit log rows.

Strict prompt: the model must restate facts from the row, not infer.
Result is cached in the row's `changes.ai_summary` so each row is summarized
at most once. Callers fall back to the existing template summary on any failure.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = (
    "You convert a raw GRC audit-log row into a structured, human-readable summary "
    "that a non-technical compliance/audit reader can scan in seconds.\n\n"
    "STRICT RULES:\n"
    "1. Only restate facts present in the JSON. Never invent fields, names, counts, "
    "outcomes, or steps that aren't in the data.\n"
    "2. NEVER output raw JSON, code blocks, file paths, or URL paths. If a field "
    "value is JSON (e.g. nodes_json, edges_json, definition_json, payload), describe "
    "what it contains in plain English — list items, count, flow, etc.\n"
    "3. Output format is GitHub-flavored markdown. The FIRST line must be a level-3 "
    "heading restating the action: '### <Actor> <verb> <resource>'.\n"
    "4. Use these sub-sections, each as a '#### <name>' heading, only when the data "
    "supports them — skip empty ones entirely:\n"
    "   - '#### Details' — bullet list of simple key/value facts (name, description, "
    "category, trigger event, tags, status). Use bold for the label: '- **Name:** ...'.\n"
    "   - '#### Steps' — numbered list of workflow nodes if nodes_json/snapshot has "
    "them. For each: '**<Name>** *(type)* — plain-English description of its config'. "
    "Translate config (approver IDs, recipients, timeout in human units like '48 hours', "
    "message subjects, action_name) into plain English; resolve action_name like "
    "'platform_action.approve.risk_management.vendor_risk.assessment' to its readable "
    "action ('approves the vendor risk assessment').\n"
    "   - '#### Flow' — arrow path of node names from edges_json "
    "(`Start → A → B → End`). If conditional branches exist (approved/rejected, "
    "True/False), show both paths on separate lines.\n"
    "   - '#### Field changes' — for updates, show '- **field:** old → new' bullets.\n"
    "   - '#### Result' — only if status_code >= 400: state failure clearly. If "
    "the row has a response_error field (e.g. {\"detail\": \"...\"} or "
    "{\"errors\": [...]}), USE its message verbatim as the failure reason — do "
    "not paraphrase it. Format as '- **Failure reason:** <message from "
    "response_error>'. Omit this section entirely on 2xx success.\n"
    "5. Keep it tight. No filler like 'this audit log shows that…'. No preamble. "
    "No closing remarks. No timestamps (the UI shows those).\n"
    "6. Refer to the actor by display_name. Refer to the resource by its name "
    "(in quotes) when present; otherwise use 'resource #<id>'.\n"
    "7. Reply with ONLY the markdown body. Do not wrap it in a code fence."
)


def _redact(d: Dict[str, Any]) -> Dict[str, Any]:
    """Strip secrets from any dict before sending to OpenAI."""
    SECRET_KEYS = {"password", "token", "secret", "api_key", "apikey", "authorization", "cookie"}
    if not isinstance(d, dict):
        return d
    out: Dict[str, Any] = {}
    for k, v in d.items():
        if any(s in k.lower() for s in SECRET_KEYS):
            out[k] = "<redacted>"
        elif isinstance(v, dict):
            out[k] = _redact(v)
        elif isinstance(v, list):
            out[k] = [_redact(x) if isinstance(x, dict) else x for x in v]
        else:
            out[k] = v
    return out


def _build_user_prompt(row: Dict[str, Any]) -> str:
    safe_row = {
        "actor_display_name": row.get("user_name"),
        "actor_type": row.get("actor_type"),
        "action": row.get("action"),
        "resource_type": row.get("resource_type"),
        "resource_id": row.get("resource_id"),
        "resource_name": row.get("resource_name"),
        "method": row.get("method"),
        "path": row.get("path"),
        "status_code": row.get("status_code"),
        "template_summary": row.get("summary"),
        "request_body": _redact(row.get("request") or {}) if isinstance(row.get("request"), dict) else None,
        "snapshot": _redact(row.get("snapshot") or {}) if isinstance(row.get("snapshot"), dict) else None,
        "field_diff": row.get("field_diff"),
        "response_error": row.get("response_error"),
    }
    return (
        "Convert this audit event into a structured markdown summary following the rules.\n\n"
        + json.dumps(safe_row, default=str, indent=2)
    )


def generate_ai_summary(row: Dict[str, Any]) -> Optional[str]:
    """Call OpenAI to produce a one-sentence natural-language summary.

    Returns the summary string, or None on any failure (missing key, API error,
    empty response). Callers should fall back to the row's existing template
    summary when None is returned.
    """
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None

    model = os.environ.get("OPENAI_MODEL") or "gpt-4o-mini"

    try:
        from openai import OpenAI
    except ImportError:
        logger.warning("openai package not installed; AI summary unavailable")
        return None

    try:
        base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
        kwargs: Dict[str, Any] = {"api_key": api_key}
        if base_url:
            kwargs["base_url"] = base_url
        client = OpenAI(**kwargs)

        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": _build_user_prompt(row)},
            ],
            max_tokens=600,
            temperature=0.1,
            timeout=30,
        )
        text = (resp.choices[0].message.content or "").strip()
        # Strip code fences if the model wrapped despite the rule.
        if text.startswith("```"):
            text = text.split("\n", 1)[-1] if "\n" in text else text
            if text.endswith("```"):
                text = text[: -3].rstrip()
        return text or None
    except Exception as exc:
        logger.warning("AI summary generation failed: %s", exc)
        return None
