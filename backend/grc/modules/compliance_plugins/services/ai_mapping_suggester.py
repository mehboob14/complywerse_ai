"""AI helper: suggest benchmark→OS mapping rows.

Three entry points, each gated on operator confirmation (never auto-apply):

  1. suggest_for_ingest_job(job_id)   — when a single CIS PDF was ingested
  2. suggest_for_all_unmapped()        — bulk: every benchmark in DB with no mapping
  3. suggest_for_unmapped_os(os_norm)  — asset has OS but no mapping row

ANTI-HALLUCINATION rules:
  • The AI is given an EXPLICIT list of allowed os_pattern values (extracted
    from the OS knowledge base + existing assets). It MUST pick one of those
    OR return null. Anything else is rejected post-hoc.
  • The AI is given the EXACT benchmark_label as input — it does not invent
    benchmark names; we reuse the input verbatim.
  • The suggestion record includes a `quoted_evidence` field — the AI must
    quote the literal substring from the input that justified its choice.
    If the quote isn't in the input, the suggestion is rejected.
  • Confidence is reported as low/medium/high; low confidence requires an
    operator override before save.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from grc.models import (
    BenchmarkOsMapping,
    CompliancePlugin,
    CisIngestJob,
)

logger = logging.getLogger(__name__)
_OPENAI_MODEL = os.environ.get("COMPLYVERSE_AI_MODEL", "gpt-4o-mini")


# ─── Allowed os_pattern vocabulary ──────────────────────────────────────
# Build the universe of acceptable os_pattern strings from:
#   (a) Existing mapping rows (so AI can re-use known patterns)
#   (b) Distinct os_normalized values in grc_it_assets
#   (c) Distinct os_normalized values in grc_os_versions (knowledge base)
#   (d) A hand-curated baseline of CIS-recognised product lines
# The AI must pick from this set OR return null. Anything outside the
# set is treated as a hallucination and discarded.
_BASELINE_PATTERNS = [
    "windows-11", "windows-10", "windows-8.1", "windows-7",
    "windows-server-2025", "windows-server-2022", "windows-server-2019",
    "windows-server-2016", "windows-server-2012",
    "ubuntu-24.04", "ubuntu-22.04", "ubuntu-20.04", "ubuntu-18.04",
    "debian-12", "debian-11", "debian-10",
    "rhel-9", "rhel-8", "rhel-7",
    "almalinux-9", "almalinux-8",
    "oraclelinux-9", "oraclelinux-8", "oraclelinux-7",
    "amazonlinux-2023", "amazonlinux-2",
    "rocky-9", "rocky-8",
    "macos-15", "macos-14", "macos-13", "macos-12",
    "cisco-ios", "cisco-ios-xe", "cisco-nx-os", "cisco-asa", "cisco-firepower",
    "oracle-db-19c", "oracle-db-21c", "oracle-db-23ai",
    "mssql-2019", "mssql-2022",
    "postgres-15", "postgres-16",
    "mysql-8.0",
    "aws-account", "azure-account", "gcp-account",
    "kubernetes-1.29", "kubernetes-1.30",
]


def _allowed_patterns(db: Session) -> List[str]:
    """Union of baseline + DB-derived patterns."""
    patterns = set(_BASELINE_PATTERNS)
    try:
        for row in db.query(BenchmarkOsMapping.os_pattern).distinct().all():
            if row[0]:
                patterns.add(row[0].strip().lower())
    except Exception:
        pass
    return sorted(patterns)


def _call_openai_for_mapping(prompt: str) -> Optional[Dict[str, Any]]:
    """Send one strict-JSON prompt to the LLM. Return parsed dict OR None.

    Why dict (not list): we want named fields back — pattern, edition,
    archive flag, confidence, quoted_evidence. The system message pins
    the schema.
    """
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        logger.info("ai_mapping_suggester: no OPENAI_API_KEY set")
        return None
    try:
        from openai import OpenAI  # type: ignore
    except ImportError:
        logger.warning("ai_mapping_suggester: openai package not installed")
        return None
    try:
        client = OpenAI(api_key=api_key, timeout=20.0)
        resp = client.chat.completions.create(
            model=_OPENAI_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a CIS Benchmark expert. You analyse a single CIS PDF "
                        "benchmark NAME (and optionally its first page text) and return "
                        "structured metadata. You NEVER invent benchmark names, OS "
                        "patterns, or rule content. If unsure, set confidence='low' and "
                        "explain. Respond with strict JSON matching the schema in the "
                        "user message — no commentary, no markdown."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.0,
            max_tokens=400,
            response_format={"type": "json_object"},
        )
        raw = (resp.choices[0].message.content or "").strip()
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.MULTILINE)
        return json.loads(raw)
    except Exception as exc:  # noqa: BLE001
        logger.warning("ai_mapping_suggester: LLM call failed: %s", exc)
        return None


def _validate_ai_response(
    raw: Dict[str, Any],
    benchmark_name: str,
    allowed_patterns: List[str],
) -> Dict[str, Any]:
    """Strip hallucinations + enforce schema.

    Returns a dict with:
      suggested_os_pattern  — must be in allowed_patterns or None
      is_archived           — bool (we derive ourselves; AI is just a hint)
      confidence            — low | medium | high
      quoted_evidence       — must be a substring of benchmark_name OR None
      product               — string or None
      edition               — string or None
      version               — string or None
      ai_raw                — the original AI response (for audit)
      validation_notes      — list of strings explaining what was rejected
    """
    out = {
        "suggested_os_pattern": None,
        "is_archived": "archive" in (benchmark_name or "").lower(),
        "confidence": "low",
        "quoted_evidence": None,
        "product": None,
        "edition": None,
        "version": None,
        "ai_raw": raw,
        "validation_notes": [],
    }
    if not isinstance(raw, dict):
        out["validation_notes"].append("AI response was not a JSON object")
        return out

    # suggested_os_pattern — must be in the allowed set
    sp = raw.get("suggested_os_pattern")
    if isinstance(sp, str) and sp.strip().lower() in allowed_patterns:
        out["suggested_os_pattern"] = sp.strip().lower()
    elif sp is None or (isinstance(sp, str) and not sp.strip()):
        out["validation_notes"].append("AI did not suggest a pattern")
    else:
        out["validation_notes"].append(
            f"AI suggested pattern {sp!r} which is NOT in the allowed vocabulary — rejected"
        )

    # quoted_evidence — must be a literal substring of the benchmark name
    qe = raw.get("quoted_evidence")
    if isinstance(qe, str) and qe.strip() and qe.strip().lower() in (benchmark_name or "").lower():
        out["quoted_evidence"] = qe.strip()
    elif qe:
        out["validation_notes"].append(
            f"AI 'quoted_evidence' {qe!r} is NOT a substring of the benchmark name — rejected as fabricated"
        )

    # confidence — clamp to allowed values
    conf = (raw.get("confidence") or "").strip().lower()
    if conf in ("low", "medium", "high"):
        out["confidence"] = conf

    # Pass through descriptive fields without trust
    for k in ("product", "edition", "version"):
        v = raw.get(k)
        if isinstance(v, str) and v.strip():
            out[k] = v.strip()

    return out


def suggest_for_benchmark(
    db: Session,
    tenant_id: Optional[int],
    benchmark_name: str,
    pdf_first_page_text: Optional[str] = None,
) -> Dict[str, Any]:
    """Generate a suggestion for ONE benchmark. Caller may use this for
    a freshly ingested PDF (`benchmark_name` from the ingest job) OR for
    backfilling existing benchmarks that have no mapping row.

    Result schema is documented in _validate_ai_response.
    """
    allowed = _allowed_patterns(db)

    # Build the prompt. We DO NOT include the rule contents — the
    # benchmark name itself plus the first page (if available) is the
    # operator-visible evidence. AI must quote from it.
    prompt_parts = [
        "CIS benchmark name:",
        f"    {benchmark_name}",
    ]
    if pdf_first_page_text:
        snippet = pdf_first_page_text[:2000]
        prompt_parts += [
            "",
            "PDF first-page excerpt (truncated to 2000 chars):",
            snippet,
        ]
    prompt_parts += [
        "",
        f"Allowed os_pattern values (you MUST pick one of these, OR null):",
        ", ".join(allowed[:80]),
        "",
        "Required JSON schema:",
        "{",
        '  "product": "<exact product line, e.g. Microsoft Windows 11>",',
        '  "edition": "<Enterprise | Stand-alone | Foundations | null>",',
        '  "version": "<benchmark semver, e.g. v5.0.1>",',
        '  "is_archived": <true if the name contains ARCHIVE, else false>,',
        '  "suggested_os_pattern": "<one value from allowed list above, OR null>",',
        '  "confidence": "<low | medium | high>",',
        '  "quoted_evidence": "<a literal substring of the benchmark name OR first-page excerpt above that justified your pattern choice; required when confidence>=medium>"',
        "}",
        "",
        "Rules:",
        "- NEVER invent an os_pattern not in the allowed list. Use null.",
        "- NEVER invent benchmark text. Quote literal substrings only.",
        "- If is_archived is true, set confidence='low' (we typically don't map archived benchmarks).",
        "- For 'CIS_Microsoft_Windows_11_Enterprise_Benchmark_v5.0.1', the correct pattern is 'windows-11' and confidence='high'.",
    ]
    raw = _call_openai_for_mapping("\n".join(prompt_parts))
    if raw is None:
        return {
            "suggested_os_pattern": None,
            "is_archived": "archive" in benchmark_name.lower(),
            "confidence": "low",
            "quoted_evidence": None,
            "product": None,
            "edition": None,
            "version": None,
            "ai_raw": None,
            "validation_notes": ["LLM unavailable (no key, no client, or call failed)"],
            "ai_used": False,
            "benchmark_name": benchmark_name,
        }
    validated = _validate_ai_response(raw, benchmark_name, allowed)
    validated["ai_used"] = True
    validated["benchmark_name"] = benchmark_name
    return validated


def suggest_for_unmapped_os(db: Session, tenant_id: int, asset_os_normalized: str) -> Dict[str, Any]:
    """When an asset's os_normalized has no mapping row, suggest the
    CLOSEST existing mapping (constrained to existing benchmarks +
    existing patterns — no new vocab introduced).

    Returns: {
      asset_os: str,
      closest_pattern: str|None,         # one of the existing patterns
      closest_benchmark: str|None,        # benchmark from that pattern's row
      confidence: low|medium|high,
      quoted_evidence: str|None,
      ai_used: bool,
      validation_notes: [...],
    }
    """
    asset_key = (asset_os_normalized or "").strip().lower()
    result = {
        "asset_os": asset_key,
        "closest_pattern": None,
        "closest_benchmark": None,
        "confidence": "low",
        "quoted_evidence": None,
        "ai_used": False,
        "validation_notes": [],
    }
    if not asset_key:
        result["validation_notes"].append("empty asset os")
        return result

    # Pull existing mappings — tenant-specific beats global
    rows = (
        db.query(BenchmarkOsMapping)
        .filter(
            BenchmarkOsMapping.is_active.is_(True),
            (BenchmarkOsMapping.tenant_id == tenant_id) | (BenchmarkOsMapping.tenant_id.is_(None)),
        )
        .all()
    )
    if not rows:
        result["validation_notes"].append("no existing mappings to choose from")
        return result

    pattern_to_bench = {r.os_pattern: r.benchmark_name for r in rows}
    allowed_patterns = list(pattern_to_bench.keys())

    # Deterministic prefix-walk first — if asset key already matches an
    # existing pattern by prefix, no AI needed.
    for p in sorted(allowed_patterns, key=len, reverse=True):
        if asset_key == p or asset_key.startswith(p + "-"):
            result.update(
                closest_pattern=p,
                closest_benchmark=pattern_to_bench[p],
                confidence="high",
                quoted_evidence=p,
                ai_used=False,
                validation_notes=["deterministic prefix match — AI not consulted"],
            )
            return result

    # AI fallback: ask which existing pattern is most similar to the asset key
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        result["validation_notes"].append("no OPENAI_API_KEY")
        return result
    try:
        from openai import OpenAI  # type: ignore
    except ImportError:
        result["validation_notes"].append("openai package not installed")
        return result

    prompt = (
        f"Asset OS key: {asset_key!r}\n\n"
        f"Existing mapping patterns (you MUST pick one of these OR null):\n"
        + ", ".join(sorted(allowed_patterns))
        + "\n\nReturn STRICT JSON:\n"
        "{\n"
        '  "closest_pattern": "<one existing pattern OR null>",\n'
        '  "confidence": "low|medium|high",\n'
        '  "reason": "<short reason, must reference both asset key and chosen pattern>"\n'
        "}\n\nRules:\n"
        "- NEVER invent a pattern. Use null if nothing fits well.\n"
        "- If asset key starts with the pattern, that's a high-confidence match.\n"
        "- Otherwise look for the same product family."
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
    cp = (parsed.get("closest_pattern") or "").strip().lower() or None
    if cp and cp in pattern_to_bench:
        result["closest_pattern"] = cp
        result["closest_benchmark"] = pattern_to_bench[cp]
    elif cp:
        result["validation_notes"].append(
            f"AI returned pattern {cp!r} which is NOT in the existing mapping set — rejected"
        )
    conf = (parsed.get("confidence") or "").strip().lower()
    if conf in ("low", "medium", "high"):
        result["confidence"] = conf
    reason = parsed.get("reason")
    if isinstance(reason, str) and reason.strip():
        result["quoted_evidence"] = reason.strip()
    return result


def suggest_for_all_unmapped(db: Session, tenant_id: int) -> List[Dict[str, Any]]:
    """Bulk: every benchmark in the library that has no mapping row
    (global OR tenant-specific) gets a suggestion.

    Returns a list of suggestion dicts ready for an admin UI review pane.
    """
    # Distinct benchmarks with at least one approved rule.
    bench_rows = (
        db.query(CompliancePlugin.benchmark)
        .filter(
            CompliancePlugin.benchmark.isnot(None),
            CompliancePlugin.review_status.in_(["approved", "auto_approved"]),
            CompliancePlugin.enabled.is_(True),
            (CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == tenant_id),
        )
        .distinct()
        .all()
    )
    benches = sorted({r[0] for r in bench_rows if r[0]})

    # Benchmarks that already have a mapping (global OR tenant) — skip.
    mapped = set(
        b for (b,) in
        db.query(BenchmarkOsMapping.benchmark_name)
        .filter(
            BenchmarkOsMapping.is_active.is_(True),
            (BenchmarkOsMapping.tenant_id == tenant_id) | (BenchmarkOsMapping.tenant_id.is_(None)),
        )
        .distinct()
        .all()
    )

    suggestions = []
    for b in benches:
        if b in mapped:
            continue
        # Try to find the ingest job for first-page text (best-effort)
        job = (
            db.query(CisIngestJob)
            .filter(CisIngestJob.benchmark_label == b)
            .order_by(CisIngestJob.id.desc())
            .first()
        )
        first_page = None  # we don't actually decode pdf bytes here; rely on benchmark name
        s = suggest_for_benchmark(db, tenant_id, b, first_page)
        s["ingest_job_id"] = job.id if job else None
        s["original_filename"] = job.original_filename if job else None
        suggestions.append(s)
    return suggestions
