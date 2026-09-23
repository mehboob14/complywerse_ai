"""An answer can call for another questionnaire.

A question may carry `follow_up: {"when": [answers], "template_id": <id>}`. When
the questionnaire is accepted, each answer that matches sends the vendor that
follow-up questionnaire, once. The trigger — parent questionnaire, question,
template — is recorded on the new questionnaire, and is what stops a second one
being sent however often the parent is accepted or re-examined.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from ....models import VendorQuestionnaireResponse, VendorQuestionnaireTemplate
from . import versions
from .portal import visible_questions

logger = logging.getLogger(__name__)

DUE_IN_DAYS, EXPIRES_IN_DAYS = 14, 30


def _value(answer) -> str:
    if isinstance(answer, dict):
        answer = answer.get("value") or answer.get("answer")
    return "" if answer is None else str(answer).strip().lower()


def triggers(questions: List[dict], answers: dict) -> List[Tuple[str, int]]:
    """(question key, follow-up template id) for each answer that calls for one."""
    out = []
    for q in visible_questions(questions, answers):
        rule = q.get("follow_up")
        if not isinstance(rule, dict) or not rule.get("template_id"):
            continue
        wanted = {str(v).strip().lower() for v in rule.get("when") or []}
        if _value(answers.get(str(q.get("id")))) in wanted:
            out.append((str(q.get("id")), int(rule["template_id"])))
    return out


def trigger_key(parent_id: int, question_key: str, template_id: int) -> str:
    return f"{parent_id}:{question_key}:{template_id}"[:200]


def send(db: Session, qr: VendorQuestionnaireResponse, questions: List[dict], actor_id: Optional[int],
         now: Optional[datetime] = None) -> List[VendorQuestionnaireResponse]:
    """Create the follow-ups this questionnaire's answers call for, each once."""
    now = now or datetime.utcnow()
    created = []
    for key, template_id in triggers(questions, qr.responses or {}):
        trigger = trigger_key(qr.id, key, template_id)
        # ponytail: checked in the accepting transaction, which is one person's
        # click; a unique index on trigger_key would close the race if that changes.
        if db.query(VendorQuestionnaireResponse.id).filter(
                VendorQuestionnaireResponse.trigger_key == trigger).first():
            continue
        template = db.query(VendorQuestionnaireTemplate).filter(
            VendorQuestionnaireTemplate.id == template_id,
            VendorQuestionnaireTemplate.tenant_id == qr.tenant_id).first()
        if template is None:
            logger.warning("follow-up template %s for questionnaire %s question %s no longer exists",
                           template_id, qr.id, key)
            continue
        version = versions.publish(db, template, actor_id)
        child = VendorQuestionnaireResponse(
            tenant_id=qr.tenant_id, vendor_id=qr.vendor_id, assessment_id=qr.assessment_id,
            template_id=template.id, template_version_id=version.id,
            respondent_name=qr.respondent_name, respondent_email=qr.respondent_email,
            token=str(uuid.uuid4()), status="pending", last_sent_at=now,
            due_date=now + timedelta(days=DUE_IN_DAYS), expires_at=now + timedelta(days=EXPIRES_IN_DAYS),
            parent_response_id=qr.id, trigger_key=trigger,
        )
        db.add(child)
        db.flush()
        created.append(child)
    return created
