"""The Assessments tab of a supplier, read from the data: one card per questionnaire
sent for an engagement, and one questionnaire read in full.

A card is a questionnaire (grc_vendor_questionnaire_responses) with the review cycle
it was sent in (its assessment's version_no). The score, grade and change on it are
the assessment's: a cycle's residual against the cycle before it. "Changes since
cycle n" sets a reassessment's answers beside the last cycle's, question by
question. The score steps are the saved scores laid out, not worked out again.

Reads only. A questionnaire sent before versions existed is read from its template
as it stands, frozen the way a send would freeze it: versions.pin would write that
down, and a GET writes nothing.
"""
from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional, Tuple

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ....models import (
    TPRAEngagement, TPRAStageInstance, TPRATemplateVersion, TPRAVendorContact, Vendor, VendorAssessment,
    VendorQuestionnaireEvidence, VendorQuestionnaireResponse, VendorQuestionnaireTemplate,
)
from ....models._41_tpra_lifecycle_models import TPRA_RISK_DOMAINS
from . import portal, service, versions
from . import questionnaire_evidence as qevidence
from .bootstrap import get_tiering_config
from .engine_scoring import answer_score, build_responses_from_answers, is_answered

DOMAIN = {d["key"]: d["label"] for d in TPRA_RISK_DOMAINS}
MOVES = 50              # answers that moved, listed (the rest are counted)


def _iso(value) -> Optional[str]:
    return value.isoformat() if value else None


def _round(value, places: int = 1) -> Optional[float]:
    return None if value is None else round(float(value), places)


def questions_of(db: Session, qr) -> Tuple[List[dict], Optional[TPRATemplateVersion]]:
    """The questions as they were sent, and the version they were sent on (None for
    one sent before versions: those are read from the template, frozen, unwritten)."""
    version = db.get(TPRATemplateVersion, qr.template_version_id) if qr.template_version_id else None
    if version is not None:
        return list(version.questions or []), version
    template = db.get(VendorQuestionnaireTemplate, qr.template_id) if qr.template_id else None
    if template is None:
        return [], None
    policy = get_tiering_config(db, template.tenant_id).get("scoring_policy") or {}
    return versions.freeze(template.questions or [], policy), None


def tally(db: Session, qr, questions: List[dict]) -> dict:
    """How many questions apply to the answers given, how many are answered (a file
    question by its file), and how many answers still owe evidence nothing linked
    to that question gives (the rules the supplier is held to at submit)."""
    answers, linked = qr.responses or {}, portal.evidence_keys(db, qr)
    shown = portal.visible_questions(questions, answers)
    answered = missing = 0
    for q in shown:
        key = str(q.get("id"))
        if portal.answered(q, answers.get(key), linked):
            answered += 1
            if portal.owes_evidence(q, answers.get(key)) and key not in linked:
                missing += 1
    return {"questions": len(shown), "answered": answered, "missing_evidence": missing}


def _closed(vendor: Vendor, engagement: Optional[TPRAEngagement]) -> Optional[str]:
    if vendor.deleted_at is not None:
        return "This vendor is archived."
    if (vendor.status or "").lower() == "offboarded":
        return "This vendor is offboarded."
    if engagement is not None and engagement.status == "ended":
        return "This engagement has ended."
    return None


def _scope(db: Session, vendor: Vendor, engagement: Optional[TPRAEngagement]) -> dict:
    """What the tab's buttons depend on: whether the scope is tiered, whether its
    current review has passed the approval gate, and whether it is closed."""
    active = service.get_active_assessment(db, vendor, engagement)
    row = service.scope_row(db, vendor, engagement)
    approval = None
    if active is not None:
        approval = db.query(TPRAStageInstance.status).filter(
            TPRAStageInstance.assessment_id == active.id, TPRAStageInstance.stage_key == "approval").scalar()
    return {
        "engagement_id": engagement.id if engagement is not None else None,
        "tier": (active.inherent_tier if active is not None else None) or row.tier,
        # tiered under a review: a questionnaire is sent for one, so a supplier scored before the lifecycle began has none yet
        "tiered": active is not None and (active.inherent_tier is not None or row.inherent_risk_score is not None),
        "active_assessment_id": active.id if active is not None else None,
        "approval_passed": approval == "complete",
        "closed": _closed(vendor, engagement),
    }


def _kind(qr, assessment: Optional[VendorAssessment]) -> str:
    if qr.parent_response_id:
        return "follow_up"
    if assessment is None:
        return "unlinked"
    return "reassessment" if (assessment.version_no or 1) > 1 else "initial"


def _card(db: Session, qr, assessment: Optional[VendorAssessment], prior: Optional[VendorAssessment],
          names: dict, now: datetime) -> dict:
    questions, version = questions_of(db, qr)
    contact = names["contacts"].get(qr.contact_id)
    name = (version.name if version is not None else None) or names["templates"].get(qr.template_id) or "Questionnaire"
    scored = assessment is not None and assessment.rating_grade is not None and assessment.residual_score is not None
    change = None
    if scored and prior is not None and prior.residual_score is not None:
        change = _round(assessment.residual_score - prior.residual_score)
    return {
        "id": qr.id, "assessment_id": qr.assessment_id,
        "cycle": (assessment.version_no or 1) if assessment is not None else None,
        "kind": _kind(qr, assessment),
        "name": name, "template_id": qr.template_id, "template_version": version.version_no if version else None,
        "status": qr.status,
        # a link that has run out reads expired only while the supplier still owes answers
        "expired": qr.status in portal.WAITING_ON_VENDOR and qr.expires_at is not None and qr.expires_at < now,
        "contact": ({"id": qr.contact_id, "name": contact[0], "email": contact[1]} if contact else
                    {"id": None, "name": qr.respondent_name, "email": qr.respondent_email}
                    if qr.respondent_name or qr.respondent_email else None),
        **tally(db, qr, questions),
        "sent_at": _iso(qr.last_sent_at or qr.created_at), "due_date": _iso(qr.due_date),
        "submitted_at": _iso(qr.submitted_at), "expires_at": _iso(qr.expires_at),
        # its review is the scope's current one: the only one scoring may move the scope's scores for
        "active": assessment is not None and assessment.lifecycle_status == "active",
        "scored": scored, "grade": assessment.rating_grade if assessment is not None else None,
        "inherent_score": _round(assessment.inherent_score) if assessment is not None else None,
        "residual_score": _round(assessment.residual_score) if assessment is not None else None,
        "rating": assessment.residual_rating if assessment is not None else None,
        "previous": ({"cycle": prior.version_no or 1, "residual_score": _round(prior.residual_score),
                      "grade": prior.rating_grade} if prior is not None and assessment is not None else None),
        "residual_change": change,
    }


def cards(db: Session, vendor: Vendor, engagement: Optional[TPRAEngagement], now: Optional[datetime] = None) -> dict:
    """One scope's questionnaires, newest review first. General (engagement None) also
    holds the questionnaires sent with no review at all, which belong to no engagement."""
    engagement = None if engagement is None or engagement.is_general else engagement
    now = now or datetime.utcnow()
    assessments = service._in_scope(db.query(VendorAssessment).filter(
        VendorAssessment.vendor_id == vendor.id, VendorAssessment.deleted_at.is_(None), service.IN_LIFECYCLE),
        engagement).order_by(VendorAssessment.version_no.desc(), VendorAssessment.id.desc()).all()
    by_id = {a.id: a for a in assessments}
    belongs = VendorQuestionnaireResponse.assessment_id.in_(list(by_id) or [-1])
    if engagement is None:
        belongs = or_(belongs, VendorQuestionnaireResponse.assessment_id.is_(None))
    rows = db.query(VendorQuestionnaireResponse).filter(VendorQuestionnaireResponse.vendor_id == vendor.id,
                                                        belongs).all()
    rows.sort(key=lambda r: (-((by_id[r.assessment_id].version_no or 1) if r.assessment_id in by_id else 0), -r.id))
    names = {
        "contacts": {c.id: (c.name, c.email) for c in db.query(TPRAVendorContact).filter(
            TPRAVendorContact.vendor_id == vendor.id)},
        "templates": dict(db.query(VendorQuestionnaireTemplate.id, VendorQuestionnaireTemplate.name).filter(
            VendorQuestionnaireTemplate.id.in_([r.template_id for r in rows if r.template_id] or [-1]))),
    }
    out = []
    for qr in rows:
        a = by_id.get(qr.assessment_id)
        out.append(_card(db, qr, a, by_id.get(a.supersedes_id) if a is not None else None, names, now))
    return {"scope": _scope(db, vendor, engagement), "items": out}


# ── one questionnaire, read in full ──────────────────────────────────────────

def _answer(q: dict, raw, linked: set) -> dict:
    """One answer as it reads: its state, the words, its credit, and a rank to compare
    two cycles by (None when there is nothing to rank)."""
    key, kind = str(q.get("id")), q.get("type") or q.get("qtype") or "yes_no"
    if kind == "file":
        sent = key in linked
        return {"state": "answered" if sent else "unanswered", "text": "File sent" if sent else None,
                "label": None, "credit": None, "rank": None}
    if not is_answered(raw):
        return {"state": "unanswered", "text": None, "label": None, "credit": None, "rank": None}
    name, score = answer_score(q, raw)
    if portal.note_needed(q, raw) == "reason":
        return {"state": "na", "text": None, "label": name or "Not applicable", "credit": "na", "rank": None}
    credit = None if score is None else "full" if score >= 1 else "gap" if score <= 0 else "partial"
    text = None if name is not None else str(portal._value(raw))
    return {"state": "answered", "text": text, "label": name, "credit": credit, "rank": score}


def _prior(db: Session, qr, assessment: Optional[VendorAssessment]):
    """The cycle before this questionnaire's, and the questionnaire of it to compare
    with: the latest the supplier answered, on the same template when there is one."""
    prior = db.get(VendorAssessment, assessment.supersedes_id) if assessment is not None and assessment.supersedes_id else None
    if prior is None:
        return None, None
    answered = db.query(VendorQuestionnaireResponse).filter(
        VendorQuestionnaireResponse.assessment_id == prior.id,
        VendorQuestionnaireResponse.parent_response_id.is_(None),
        VendorQuestionnaireResponse.status.in_(portal.ANSWERED),
    ).order_by(VendorQuestionnaireResponse.id.desc()).all()
    return prior, next((r for r in answered if r.template_id == qr.template_id), answered[0] if answered else None)


def _before(db: Session, prior_qr) -> Dict[str, dict]:
    """The previous cycle's answers, by question, read as that cycle's version read them."""
    if prior_qr is None:
        return {}
    questions, _ = questions_of(db, prior_qr)
    linked, answers = portal.evidence_keys(db, prior_qr), prior_qr.responses or {}
    return {str(q.get("id")): _answer(q, answers.get(str(q.get("id"))), linked) for q in questions}


def _words(a: dict) -> Optional[str]:
    return a["label"] or a["text"]


def _moves(rows: List[Tuple[dict, dict]], before: Dict[str, dict]) -> List[dict]:
    """The answers that read differently from last cycle's, weaker first. An answer
    that ranks lower than before (a gap for a yes, no answer for a partial) is weaker;
    one that ranks higher, stronger; a change of words that ranks the same is neither.
    A question not answered yet has not moved: a reassessment just sent is all of that."""
    out = []
    for q, now in rows:
        was = before.get(str(q.get("id")))
        if was is None or now["state"] == "unanswered" or _words(was) == _words(now):
            continue
        a, b = (-1.0 if was["rank"] is None else was["rank"]), (-1.0 if now["rank"] is None else now["rank"])
        out.append({"id": str(q.get("id")), "text": q.get("text"), "from": _words(was), "to": _words(now),
                    "weaker": True if b < a else False if b > a else None})
    return sorted(out, key=lambda m: (m["weaker"] is not True, m["weaker"] is None))


def _steps(assessment: Optional[VendorAssessment], failed: List[str]) -> List[dict]:
    """The saved score, laid out: inherent risk, each domain's controls and residual,
    any failed critical control, the residual and its grade."""
    if assessment is None or assessment.residual_score is None:
        return []
    steps = []
    if assessment.inherent_score is not None:
        steps.append({"label": "Inherent risk", "detail": "from the tiering", "value": f"{assessment.inherent_score:.1f}"})
    domains = assessment.domain_scores if isinstance(assessment.domain_scores, dict) else {}
    for key, d in sorted(domains.items()):
        if isinstance(d, dict) and d.get("total"):
            steps.append({"label": DOMAIN.get(key, key.replace("_", " ").capitalize()),
                          "detail": f"controls {round(float(d.get('posture') or 0) * 100)}% · {d.get('answered', 0)} of {d['total']} scored",
                          "value": f"{float(d.get('residual') or 0):.1f}"})
    if failed:
        steps.append({"label": "Critical controls failed", "detail": "the rating is High at least", "value": str(len(failed))})
    steps.append({"label": "Residual risk", "detail": (assessment.residual_rating or "").capitalize() or None,
                  "value": f"{assessment.residual_score:.1f}"})
    if assessment.rating_grade:
        steps.append({"label": "Grade", "detail": None, "value": assessment.rating_grade})
    return steps


def detail(db: Session, qr) -> dict:
    """A questionnaire as the review reads it: answers by section with what each is
    worth and what backs it, what moved since the last cycle, and the score's steps."""
    from .reviews import label, section_of           # reviews imports the routers, which import this: not at the top

    questions, version = questions_of(db, qr)
    answers = qr.responses or {}
    linked = portal.evidence_keys(db, qr)
    assessment = db.get(VendorAssessment, qr.assessment_id) if qr.assessment_id else None
    prior, prior_qr = _prior(db, qr, assessment)
    before = _before(db, prior_qr)

    files: Dict[str, List[dict]] = {}
    for f in db.query(VendorQuestionnaireEvidence).filter(VendorQuestionnaireEvidence.response_id == qr.id).order_by(
            VendorQuestionnaireEvidence.id):
        files.setdefault(str(f.question_id), []).append({
            "id": f.id, "file_name": f.file_name, "file_type": f.file_type, "file_size": f.file_size,
            "file_path": f.file_path, "evidence_id": f.evidence_id})

    sections: Dict[str, dict] = {}
    pairs: List[Tuple[dict, dict]] = []
    for q in portal.visible_questions(questions, answers):
        key, raw = str(q.get("id")), answers.get(str(q.get("id")))
        a = _answer(q, raw, linked)
        pairs.append((q, a))
        owed = a["state"] != "unanswered" and portal.owes_evidence(q, raw)
        s = sections.setdefault(section_of(q), {"key": section_of(q), "label": label(section_of(q)), "domains": set(),
                                                "answered": 0, "rows": []})
        s["domains"].add(q.get("domain") or "cybersecurity")
        s["answered"] += a["state"] != "unanswered"
        was = before.get(key)
        s["rows"].append({
            "id": key, "text": q.get("text"), "type": q.get("type") or q.get("qtype") or "yes_no",
            "optional": q.get("required") is False, "critical": bool(q.get("critical_control")),
            "state": a["state"], "label": a["label"], "text_answer": a["text"], "credit": a["credit"],
            "evidence": {"rule": portal.evidence_rule(q)[0], "owed": owed, "has": key in linked,
                         "missing": owed and key not in linked, "files": files.get(key, [])},
            "was": _words(was) if was is not None and _words(was) != _words(a) else None,
            "changed": was is not None and _words(was) != _words(a),
        })
    residual = assessment.domain_scores if assessment is not None and isinstance(assessment.domain_scores, dict) else {}
    out_sections = []
    for s in sections.values():
        domains = s.pop("domains")
        # a domain's residual belongs to a section only when the section is that domain
        one = next(iter(domains)) if len(domains) == 1 else None
        s["residual"] = (_round((residual.get(one) or {}).get("residual"))
                         if one and s["key"] == one.replace("_", " ") else None)
        out_sections.append(s)

    moves = _moves(pairs, before) if prior_qr is not None else []
    graded = assessment is not None and assessment.rating_grade is not None
    # a tier that skips scoring (Low) has no score to make here: the residual is its inherent score
    skipped = assessment is not None and db.query(TPRAStageInstance.id).filter(
        TPRAStageInstance.assessment_id == assessment.id, TPRAStageInstance.stage_key == "scoring",
        TPRAStageInstance.status == "skipped").first() is not None
    failed = [str(r["question_key"]) for r in build_responses_from_answers(questions, answers)
              if r["critical_control"] and r["score"] is not None and r["score"] <= 0] if graded else []
    return {
        "template_version": version.version_no if version is not None else None,
        "assessment": None if assessment is None else {
            "id": assessment.id, "cycle": assessment.version_no or 1, "active": assessment.lifecycle_status == "active",
            "lifecycle": assessment.current_stage is not None, "scored": graded, "scoring_skipped": skipped,
            "inherent_score": _round(assessment.inherent_score), "residual_score": _round(assessment.residual_score),
            "rating": assessment.residual_rating, "grade": assessment.rating_grade},
        **tally(db, qr, questions),
        "library_evidence": qevidence.by_question(db, qr),
        "sections": out_sections,
        "changes": None if prior is None else {
            "cycle": prior.version_no or 1, "compared": prior_qr is not None,
            "residual": {"now": _round(assessment.residual_score), "before": _round(prior.residual_score),
                         "change": (_round(assessment.residual_score - prior.residual_score)
                                    if assessment.residual_score is not None and prior.residual_score is not None else None)},
            "grade": {"now": assessment.rating_grade, "before": prior.rating_grade},
            "moved": len(moves), "of": len(pairs),
            "weaker": sum(m["weaker"] is True for m in moves), "stronger": sum(m["weaker"] is False for m in moves),
            "items": moves[:MOVES],
        },
        "steps": _steps(assessment, failed),
    }
