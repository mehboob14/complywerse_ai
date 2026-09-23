"""Questionnaire templates are edited; what a vendor was sent is not.

A template's questions are a working draft. Sending a questionnaire publishes the
draft as a numbered, immutable version (a new one only when something changed)
and pins the questionnaire to it. Everything that reads a questionnaire's
questions afterwards reads the pinned version: the vendor portal, the
per-question answers, scoring, findings, the assessment view and AI analysis.
Editing a template can therefore never change what an old answer meant.

Publishing also freezes how answers score (decision 6: weights sit on the answer
options, so "Partial" is worth what the tenant says) and the finding each weak
answer raises. Changing the tenant's scoring policy later affects new versions
only.
"""
from __future__ import annotations

import hashlib
import json
from typing import List, Optional

from sqlalchemy.orm import Session

from ....models import TPRATemplateVersion, VendorQuestionnaireTemplate
from .bootstrap import get_tiering_config
from .engine_scoring import default_severity


def _clamp(value, default: float) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return default


def freeze(questions: list, scoring_policy: Optional[dict] = None) -> List[dict]:
    """The template's questions with everything scoring needs written in: each
    option's score and the finding it raises (None when it raises none)."""
    partial = _clamp((scoring_policy or {}).get("partial_credit", 0.5), 0.5)
    out: List[dict] = []
    for i, raw in enumerate(questions or []):
        if not isinstance(raw, dict):
            continue
        q = json.loads(json.dumps(raw, default=str))            # a deep, JSON-safe copy
        q["id"] = str(q.get("id") or q.get("key") or f"q{i + 1}")
        qtype = q.get("type") or q.get("qtype") or "yes_no"
        q["type"] = q["qtype"] = qtype
        q["weight"] = float(q.get("weight") or 1.0)
        options = q.get("options") or []
        if qtype == "yes_no":
            given = {str(o.get("value", "")).lower(): o for o in options if isinstance(o, dict)}
            options = [
                given.get("yes") or {"value": "yes", "label": "Yes", "score": 1.0},
                given.get("partial") or {"value": "partial", "label": "Partial", "score": partial},
                given.get("no") or {"value": "no", "label": "No", "score": 0.0},
                given.get("n-a") or {"value": "n-a", "label": "Not applicable", "na": True},
            ]
        elif qtype == "rating":
            # 1 is the worst, 5 the best.
            options = [{"value": str(n), "label": str(n), "score": (n - 1) / 4} for n in range(1, 6)]
        elif qtype == "multiple_choice":
            options = [dict(o) if isinstance(o, dict) else {"value": str(o), "label": str(o), "score": None}
                       for o in options]
        else:
            options = []
        for option in options:
            if not option.get("na"):
                option.setdefault("finding", default_severity(q, option.get("score")))
        q["options"] = options
        out.append(q)
    return out


def _hash(questions: list) -> str:
    return hashlib.sha256(json.dumps(questions, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def latest(db: Session, template_id: int) -> Optional[TPRATemplateVersion]:
    return (db.query(TPRATemplateVersion).filter(TPRATemplateVersion.template_id == template_id)
            .order_by(TPRATemplateVersion.version_no.desc()).first())


def publish(db: Session, template: VendorQuestionnaireTemplate, actor_id: Optional[int] = None) -> TPRATemplateVersion:
    """The template as it stands, as a version: the latest one if nothing has
    changed since, otherwise a new one."""
    policy = get_tiering_config(db, template.tenant_id).get("scoring_policy") or {}
    questions = freeze(template.questions or [], policy)
    digest = _hash(questions)
    last = latest(db, template.id)
    if last is not None and last.content_hash == digest:
        return last
    version = TPRATemplateVersion(
        tenant_id=template.tenant_id, template_id=template.id,
        version_no=(last.version_no + 1) if last else 1, name=template.name,
        questions=questions, content_hash=digest, published_by=actor_id,
    )
    db.add(version)
    db.flush()
    return version


def pin(db: Session, qr, actor_id: Optional[int] = None) -> Optional[TPRATemplateVersion]:
    """The version a questionnaire was sent on. One sent before versions existed
    is pinned now, to the template as it stands: the closest record there is,
    and from here on it stops moving."""
    if qr is None:
        return None
    if qr.template_version_id:
        version = db.get(TPRATemplateVersion, qr.template_version_id)
        if version is not None:
            return version
    if not qr.template_id:
        return None
    template = db.get(VendorQuestionnaireTemplate, qr.template_id)
    if template is None:
        return None
    version = publish(db, template, actor_id)
    qr.template_version_id = version.id
    return version


def questions_for(db: Session, qr) -> List[dict]:
    version = pin(db, qr)
    return list(version.questions or []) if version else []
