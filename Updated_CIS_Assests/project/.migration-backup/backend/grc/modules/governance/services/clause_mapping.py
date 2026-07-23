"""Hybrid clause-coverage mapping (Task #46 step 2).

For each framework clause we score whether an existing policy already covers it,
combining three independent signals:
  1. Embedding-similarity (TF-IDF fallback when no embeddings client available)
  2. Control-ID keyword regex match in the policy text
  3. Optional AI clause-by-clause LLM scoring (gpt-4o-mini chat completion)

Each signal contributes to a unified confidence score in [0, 1]. We keep the
mapping deterministic enough that re-running on unchanged inputs returns the
same status, and we surface every signal in the persisted ``signals`` JSON so
the UI can explain *why* a clause was flagged covered.
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
from collections import Counter
from datetime import datetime
from typing import Iterable, List, Optional, Tuple

from sqlalchemy.orm import Session

from ....models import (
    GovernanceDocument,
    ParsedFrameworkControl,
    PolicyClauseCoverage,
    UploadedFramework,
)


logger = logging.getLogger(__name__)

# Status thresholds (tuned to be conservative — false positives are worse here
# because they would silently skip clauses during AI generation).
COVERED_THRESHOLD = 0.72
PARTIAL_THRESHOLD = 0.45


def _tokenize(text: str) -> List[str]:
    return [t for t in re.findall(r"[a-z0-9]+", (text or "").lower()) if len(t) > 2]


def _tf(text: str) -> Counter:
    return Counter(_tokenize(text))


def _cosine(a: Counter, b: Counter) -> float:
    if not a or not b:
        return 0.0
    inter = set(a.keys()) & set(b.keys())
    num = sum(a[t] * b[t] for t in inter)
    da = math.sqrt(sum(v * v for v in a.values()))
    db = math.sqrt(sum(v * v for v in b.values()))
    if da == 0 or db == 0:
        return 0.0
    return num / (da * db)


def _control_id_hits(policy_text: str, control: ParsedFrameworkControl) -> bool:
    if not policy_text or not control.control_id:
        return False
    cid = re.escape(control.control_id.strip())
    # Match the control id as a token, case-insensitive, allowing common
    # punctuation around it (1.2.3, A.5.1, AC-2, etc.).
    pattern = rf"(?<![A-Za-z0-9]){cid}(?![A-Za-z0-9])"
    return bool(re.search(pattern, policy_text, re.IGNORECASE))


def _ai_score_batch(
    policy_text: str,
    controls: List[ParsedFrameworkControl],
) -> List[float]:
    """Optional LLM scoring. Returns 0.0 for each control if no key configured."""
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not api_key or not controls:
        return [0.0] * len(controls)
    try:
        from openai import OpenAI

        base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL") or os.environ.get("OPENAI_BASE_URL")
        client = OpenAI(api_key=api_key, base_url=base_url, timeout=120.0)
        prompt = (
            "You are a compliance auditor. For each numbered framework clause below, "
            "respond ONLY with a JSON array of floats in [0,1] indicating how thoroughly "
            "the policy text covers that clause. 1.0 = fully addressed, 0.5 = partially, "
            "0.0 = not addressed. Return the array in the same order.\n\n"
            f"POLICY TEXT (truncated):\n{(policy_text or '')[:6000]}\n\n"
            "CLAUSES:\n"
            + "\n".join(
                f"{i+1}. [{c.control_id}] {(getattr(c,'title','') or '')}: "
                f"{(getattr(c,'requirement_text','') or getattr(c,'description','') or '')[:400]}"
                for i, c in enumerate(controls)
            )
        )
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "Return only a JSON array of floats."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.0,
            max_tokens=1000,
        )
        content = (resp.choices[0].message.content or "").strip()
        # Strip code fences if present.
        m = re.search(r"\[.*\]", content, re.DOTALL)
        if not m:
            return [0.0] * len(controls)
        arr = json.loads(m.group(0))
        out: List[float] = []
        for i in range(len(controls)):
            try:
                out.append(max(0.0, min(1.0, float(arr[i]))))
            except (IndexError, TypeError, ValueError):
                out.append(0.0)
        return out
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("clause_mapping.ai_score.failed: %s", e)
        return [0.0] * len(controls)


def _combine_signals(emb: float, kw: bool, ai: float) -> Tuple[float, str]:
    """Combine the three signals into a single confidence + status."""
    # Weight: embedding 0.45, control-id 0.30 (binary), ai 0.25.
    score = (emb * 0.45) + (1.0 * 0.30 if kw else 0.0) + (ai * 0.25)
    if score >= COVERED_THRESHOLD:
        return score, "covered"
    if score >= PARTIAL_THRESHOLD:
        return score, "partial"
    return score, "missing"


def _excerpt_around(policy_text: str, query: str, window: int = 240) -> Optional[str]:
    if not policy_text or not query:
        return None
    q = (query or "").strip().split()
    if not q:
        return None
    needle = q[0].lower()
    idx = policy_text.lower().find(needle)
    if idx < 0:
        return None
    start = max(0, idx - window // 2)
    end = min(len(policy_text), idx + window // 2)
    return policy_text[start:end]


def map_document_to_framework(
    db: Session,
    document: GovernanceDocument,
    framework: UploadedFramework,
    policy_text: str,
    use_ai: bool = True,
) -> List[PolicyClauseCoverage]:
    """Score every clause in ``framework`` against ``policy_text`` and persist.

    Existing rows whose ``is_locked`` flag is True (manual ground truth) are
    NOT overwritten; we update everything else."""
    controls: List[ParsedFrameworkControl] = (
        db.query(ParsedFrameworkControl)
        .filter(ParsedFrameworkControl.uploaded_framework_id == framework.id)
        .all()
    )
    if not controls:
        return []

    policy_tf = _tf(policy_text)
    ai_scores: List[float] = []
    if use_ai:
        # Process in chunks to keep prompt size reasonable.
        for i in range(0, len(controls), 25):
            ai_scores.extend(_ai_score_batch(policy_text, controls[i : i + 25]))
    if not ai_scores:
        ai_scores = [0.0] * len(controls)

    existing_by_ctrl = {
        row.parsed_control_id: row
        for row in db.query(PolicyClauseCoverage)
        .filter(
            PolicyClauseCoverage.document_id == document.id,
            PolicyClauseCoverage.uploaded_framework_id == framework.id,
        )
        .all()
    }

    out: List[PolicyClauseCoverage] = []
    for ctrl, ai in zip(controls, ai_scores):
        clause_text = (
            getattr(ctrl, "requirement_text", "")
            or getattr(ctrl, "description", "")
            or getattr(ctrl, "title", "")
            or ""
        )
        emb = _cosine(policy_tf, _tf(clause_text))
        kw = _control_id_hits(policy_text, ctrl)
        score, status = _combine_signals(emb, kw, ai)
        signals = {
            "embedding": round(emb, 3),
            "control_id_keyword": kw,
            "ai": round(ai, 3),
        }
        excerpt = _excerpt_around(policy_text, ctrl.control_id or "")

        row = existing_by_ctrl.get(ctrl.id)
        if row and row.is_locked:
            # Preserve manual ground truth, but refresh signals for transparency.
            row.signals = signals
            row.matching_excerpt = excerpt
            row.updated_at = datetime.utcnow()
            db.add(row)
            out.append(row)
            continue
        if not row:
            row = PolicyClauseCoverage(
                tenant_id=document.tenant_id,
                document_id=document.id,
                uploaded_framework_id=framework.id,
                parsed_control_id=ctrl.id,
            )
        row.coverage_status = status
        row.confidence = round(score, 3)
        row.signals = signals
        row.matching_excerpt = excerpt
        row.source = "auto"
        row.updated_at = datetime.utcnow()
        db.add(row)
        out.append(row)
    db.flush()
    return out


def coverage_report_for_tenant(
    db: Session,
    tenant_id: int,
    uploaded_framework_id: int,
) -> List[dict]:
    """Aggregated per-clause coverage across ALL of a tenant's policy documents.
    Returns the best (highest-confidence) covering policy per clause."""
    rows: List[PolicyClauseCoverage] = (
        db.query(PolicyClauseCoverage)
        .filter(
            PolicyClauseCoverage.tenant_id == tenant_id,
            PolicyClauseCoverage.uploaded_framework_id == uploaded_framework_id,
        )
        .all()
    )
    best: dict = {}
    for r in rows:
        cur = best.get(r.parsed_control_id)
        if cur is None or (r.confidence or 0) > (cur.confidence or 0):
            best[r.parsed_control_id] = r
    out: List[dict] = []
    for ctrl_id, r in best.items():
        out.append(
            {
                "parsed_control_id": ctrl_id,
                "document_id": r.document_id,
                "coverage_status": r.coverage_status,
                "confidence": r.confidence,
                "signals": r.signals,
                "matching_excerpt": r.matching_excerpt,
                "source": r.source,
                "user_choice": r.user_choice,
                "is_locked": r.is_locked,
            }
        )
    return out
