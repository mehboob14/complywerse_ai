"""Links from a circular's obligations to the rest of the platform, one kind of
record at a time. Controls first: which controls meet each obligation.

SCF controls are suggested by a plain keyword ranking over their names and
descriptions — no model reads SCF text (CC BY-ND, no AI derivatives). The
organisation's own controls (the internal control register and custom
controls) go to the regulatory model with each obligation's shortlist, and it
says which actually meet the obligation and why. Every suggestion starts as
proposed; a person confirms or rejects it, and a re-analysis keeps those
decisions and never proposes a rejected pair again.
"""
from __future__ import annotations

import math
import re
from collections import Counter
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ...models import (
    GRCUser, InternalControl, NormalizedControl, RegulatoryChange, RegulatoryImplementationTask, RegulatoryLink,
    RegulatoryObligation, get_db,
)
from ...routers.auth_router import get_user_tenants, require_auth

CONTROL_TYPES = ("control", "internal_control")
SCF_SUGGESTIONS = 3            # keyword suggestions per obligation from the SCF library
OWN_SHORTLIST = 8              # the organisation's controls the model weighs per obligation
MIN_TERMS = 3                  # distinct words a suggestion must share with the obligation
# ponytail: BM25 floor for SCF suggestions, calibrated on the SCF 2026.2 library (good matches scored
# 12.4–22, noise 6.7–11.9); re-check when a new release changes the corpus.
MIN_SCF_SCORE = 12.0
_STOP = set("""a an the of to and or for in on by with be shall must should may any all its their it is are as at
from that this these those which who whom such other than not no each every within into under upon also
including include includes where when been being has have had will would can could per such via""".split())


# ── Ranking ──────────────────────────────────────────────────────────────────

def _stem(word: str) -> str:
    """test, tests, tested, testing → test: enough for a regulation and a control to meet."""
    for suffix in ("ing", "ed", "es", "s"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 4:
            return word[:-len(suffix)]
    return word


def _terms(text: str) -> List[str]:
    return [_stem(w) for w in re.findall(r"[a-z0-9]+", (text or "").lower()) if len(w) > 2 and w not in _STOP]


class Ranker:
    """BM25 over short texts: which records share the most distinctive words with a query."""

    def __init__(self, texts: List[str], k1: float = 1.2, b: float = 0.75):
        self.docs = [Counter(_terms(t)) for t in texts]
        self.lens = [sum(d.values()) for d in self.docs]
        self.avg = (sum(self.lens) / len(self.lens)) if self.lens else 1.0
        df = Counter(t for d in self.docs for t in d)
        n = len(self.docs)
        self.idf = {t: math.log(1 + (n - c + 0.5) / (c + 0.5)) for t, c in df.items()}
        self.k1, self.b = k1, b

    def top(self, query: str, k: int = 10) -> List[Tuple[int, float, int]]:
        """(index, score, shared words) of the best matches."""
        q = set(_terms(query)) & set(self.idf)
        scored = []
        for i, doc in enumerate(self.docs):
            shared = [t for t in q if t in doc]
            if not shared:
                continue
            norm = self.k1 * (1 - self.b + self.b * self.lens[i] / self.avg)
            score = sum(self.idf[t] * doc[t] * (self.k1 + 1) / (doc[t] + norm) for t in shared)
            scored.append((i, round(score, 3), len(shared)))
        scored.sort(key=lambda x: -x[1])
        return scored[:k]


def control_candidates(db: Session, tenant_id: int) -> List[dict]:
    """Every control an obligation could be met by: the SCF library and custom
    controls, and the internal control register."""
    out = []
    for c in db.query(NormalizedControl).filter(or_(NormalizedControl.tenant_id.is_(None),
                                                    NormalizedControl.tenant_id == tenant_id),
                                                NormalizedControl.retired_at.is_(None)):
        scf = (c.source or "").lower() == "scf"
        out.append({"type": "control", "id": c.id, "ref": c.scf_id or c.code, "label": c.name, "scf": scf,
                    "text": f"{c.name}. {c.statement or ''}"})
    for c in db.query(InternalControl).filter(InternalControl.tenant_id == tenant_id,
                                              InternalControl.status != "deprecated"):
        out.append({"type": "internal_control", "id": c.id, "ref": c.control_id, "label": c.name, "scf": False,
                    "text": f"{c.name}. {c.description or ''}"})
    return out


# ── Suggesting ───────────────────────────────────────────────────────────────

_OWN_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["links"],
    "properties": {"links": {"type": "array", "items": {
        "type": "object", "additionalProperties": False, "required": ["obligation", "control", "meets", "why"],
        "properties": {"obligation": {"type": "string"}, "control": {"type": "string"},
                       "meets": {"type": "string", "enum": ["fully", "partly"]}, "why": {"type": "string"}},
    }}},
}


def _safe_text(text: str) -> str:
    """A control's words for the model, or nothing when they carry SCF prose."""
    from ...services.licence_guard import find_restricted
    return "" if find_restricted(text or "") else (text or "")[:600]


def _own_control_links(obligations: List[RegulatoryObligation], shortlists: Dict[int, List[dict]]) -> List[tuple]:
    """(obligation id, candidate, meets, why) for the organisation's own controls the model says meet it."""
    from .regulatory_engine import llm_json

    found: List[tuple] = []
    todo = [ob for ob in obligations if shortlists.get(ob.id)]
    for start in range(0, len(todo), 12):
        batch = todo[start:start + 12]
        lines = []
        for n, ob in enumerate(batch, start=1):
            lines.append(f"O{n}: [{ob.ref or 'no ref'}] {ob.summary}\n  Text: \"{(ob.quote or '')[:500]}\"\n  Candidates:")
            for c in shortlists[ob.id]:
                lines.append(f"  - {c['ref']}: {c['label']}. {_safe_text(c['text'])}")
        prompt = ("For each obligation O1..On, say which of ITS OWN candidate controls actually meet it, fully or "
                  "partly, and why in one sentence naming what the control does. Leave out candidates that only "
                  "share words with it. Use the candidate's code exactly as listed; never a code from another "
                  "obligation's list.\n\n" + "\n".join(lines))
        data, _ = llm_json("You are a senior compliance analyst mapping regulatory obligations to the "
                           "organisation's own controls. Be strict: a control meets an obligation only if doing "
                           "the control satisfies the duty.", prompt, _OWN_SCHEMA, "obligation_controls",
                           effort="medium", max_output_tokens=16000)
        for row in data.get("links") or []:
            try:
                ob = batch[int(str(row.get("obligation", "")).lstrip("Oo")) - 1]
            except (ValueError, IndexError):
                continue
            cand = next((c for c in shortlists[ob.id] if c["ref"] == row.get("control")), None)
            if cand:
                found.append((ob.id, cand, row.get("meets"), (row.get("why") or "")[:1000]))
    return found


def suggest_controls(db: Session, change: RegulatoryChange, user_id: Optional[int]) -> dict:
    """Propose the controls that meet each of the change's obligations. Decisions people made stand."""
    obligations = db.query(RegulatoryObligation).filter(RegulatoryObligation.regulatory_change_id == change.id,
                                                        RegulatoryObligation.deleted_at.is_(None)).all()
    links = db.query(RegulatoryLink).filter(RegulatoryLink.regulatory_change_id == change.id,
                                            RegulatoryLink.target_type.in_(CONTROL_TYPES)).all()
    decided = {(l.obligation_id, l.target_type, l.target_id) for l in links if l.status != "proposed"}
    for l in links:
        if l.status == "proposed":
            db.delete(l)
    db.flush()
    candidates = control_candidates(db, change.tenant_id)
    if not obligations or not candidates:
        return {"control_suggestions": 0}
    ranker = Ranker([c["text"] for c in candidates])
    shortlists: Dict[int, List[dict]] = {}
    added = 0

    def propose(ob_id: int, cand: dict, source: str, score: float, rationale: str) -> None:
        nonlocal added
        key = (ob_id, cand["type"], cand["id"])
        if key in decided:
            return
        decided.add(key)
        db.add(RegulatoryLink(tenant_id=change.tenant_id, regulatory_change_id=change.id, obligation_id=ob_id,
                              target_type=cand["type"], target_id=cand["id"], target_ref=cand["ref"],
                              target_label=(cand["label"] or "")[:500], rationale=rationale, score=score,
                              status="proposed", source=source, created_by=user_id))
        added += 1

    for ob in obligations:
        ranked = [(candidates[i], score, shared) for i, score, shared in
                  ranker.top(f"{ob.summary} {ob.quote or ''}", k=40) if shared >= MIN_TERMS]
        for cand, score, shared in [r for r in ranked if r[0]["scf"] and r[1] >= MIN_SCF_SCORE][:SCF_SUGGESTIONS]:
            propose(ob.id, cand, "match", score, f"Shares {shared} distinctive words with the obligation.")
        shortlists[ob.id] = [r[0] for r in ranked if not r[0]["scf"]][:OWN_SHORTLIST]
    for ob_id, cand, meets, why in _own_control_links(obligations, shortlists):
        propose(ob_id, cand, "ai", 1.0 if meets == "fully" else 0.6, f"{'Fully' if meets == 'fully' else 'Partly'} meets it: {why}")
    return {"control_suggestions": added}


def carry_decisions(db: Session, moved: Dict[int, int]) -> None:
    """A re-analysis replaced these obligations (old id → new id): decisions, and the
    tasks raised from them, follow them."""
    if not moved:
        return
    for link in db.query(RegulatoryLink).filter(RegulatoryLink.obligation_id.in_(list(moved))):
        if link.status == "proposed":
            db.delete(link)
        else:
            link.obligation_id = moved[link.obligation_id]
    for task in db.query(RegulatoryImplementationTask).filter(RegulatoryImplementationTask.obligation_id.in_(list(moved))):
        task.obligation_id = moved[task.obligation_id]


# ── REST ─────────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/regulatory-changes", tags=["Governance - Regulatory Change Management"])


def _tenants(db: Session, user: GRCUser) -> List[int]:
    tids = get_user_tenants(user, db)
    if not tids:
        raise HTTPException(403, "No tenant context")
    return tids


def s_link(link: RegulatoryLink, names: Optional[Dict[int, str]] = None) -> dict:
    return {"id": link.id, "obligation_id": link.obligation_id, "regulatory_change_id": link.regulatory_change_id,
            "target_type": link.target_type, "target_id": link.target_id, "target_ref": link.target_ref,
            "target_label": link.target_label, "rationale": link.rationale, "score": link.score,
            "status": link.status, "source": link.source,
            "decided_by": (names or {}).get(link.decided_by),
            "decided_at": link.decided_at.isoformat() if link.decided_at else None}


def _names(db: Session, ids) -> Dict[int, str]:
    ids = {i for i in ids if i}
    return {u.id: u.display_name or u.username for u in db.query(GRCUser).filter(GRCUser.id.in_(ids))} if ids else {}


def _audit(db: Session, tenant_id: int, user_id: int, action: str, link: RegulatoryLink) -> None:
    from .routers.regulatory_changes import create_audit_log_entry
    create_audit_log_entry(db, tenant_id, user_id, action, "regulatory_link", link.id,
                           {"obligation_id": link.obligation_id, "target": f"{link.target_type}:{link.target_ref}",
                            "status": link.status})


@router.get("/changes/{change_id}/links")
def list_links(change_id: int, target_type: Optional[str] = Query(None, max_length=30), db: Session = Depends(get_db),
               user: GRCUser = Depends(require_auth)):
    q = db.query(RegulatoryLink).filter(RegulatoryLink.regulatory_change_id == change_id,
                                        RegulatoryLink.tenant_id.in_(_tenants(db, user)))
    if target_type:
        q = q.filter(RegulatoryLink.target_type == target_type)
    rows = q.order_by(RegulatoryLink.obligation_id, RegulatoryLink.score.desc()).all()
    names = _names(db, (l.decided_by for l in rows))
    return {"items": [s_link(l, names) for l in rows]}


@router.post("/changes/{change_id}/suggest-controls")
def run_control_suggestions(change_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    change = db.query(RegulatoryChange).filter(RegulatoryChange.id == change_id,
                                               RegulatoryChange.tenant_id.in_(_tenants(db, user))).first()
    if change is None:
        raise HTTPException(404, "Regulatory change not found")
    counts = suggest_controls(db, change, user.id)
    db.commit()
    return counts


class DecisionIn(BaseModel):
    status: str = Field(..., pattern="^(confirmed|rejected|proposed)$")


@router.patch("/links/{link_id}")
def decide_link(link_id: int, body: DecisionIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    link = db.query(RegulatoryLink).filter(RegulatoryLink.id == link_id,
                                           RegulatoryLink.tenant_id.in_(_tenants(db, user))).first()
    if link is None:
        raise HTTPException(404, "Link not found")
    link.status, link.decided_by, link.decided_at = body.status, user.id, datetime.utcnow()
    _audit(db, link.tenant_id, user.id, "update", link)
    db.commit()
    return s_link(link, _names(db, [user.id]))


class LinkIn(BaseModel):
    target_type: str = Field(..., pattern="^(" + "|".join(CONTROL_TYPES) + ")$")
    target_id: int
    rationale: Optional[str] = Field(None, max_length=2000)


@router.post("/obligations/{obligation_id}/links", status_code=201)
def add_link(obligation_id: int, body: LinkIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tenants(db, user)
    ob = db.query(RegulatoryObligation).filter(RegulatoryObligation.id == obligation_id,
                                               RegulatoryObligation.tenant_id.in_(tids),
                                               RegulatoryObligation.deleted_at.is_(None)).first()
    if ob is None:
        raise HTTPException(404, "Obligation not found")
    cand = next((c for c in control_candidates(db, ob.tenant_id)
                 if (c["type"], c["id"]) == (body.target_type, body.target_id)), None)
    if cand is None:
        raise HTTPException(404, "Control not found")
    link = db.query(RegulatoryLink).filter_by(obligation_id=ob.id, target_type=cand["type"], target_id=cand["id"]).first()
    if link is None:
        link = RegulatoryLink(tenant_id=ob.tenant_id, regulatory_change_id=ob.regulatory_change_id, obligation_id=ob.id,
                              target_type=cand["type"], target_id=cand["id"], target_ref=cand["ref"],
                              target_label=(cand["label"] or "")[:500], source="manual", created_by=user.id)
        db.add(link)
    link.status, link.decided_by, link.decided_at = "confirmed", user.id, datetime.utcnow()
    link.rationale = body.rationale or link.rationale
    db.flush()
    _audit(db, link.tenant_id, user.id, "create", link)
    db.commit()
    return s_link(link, _names(db, [user.id]))


@router.delete("/links/{link_id}")
def remove_link(link_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    link = db.query(RegulatoryLink).filter(RegulatoryLink.id == link_id,
                                           RegulatoryLink.tenant_id.in_(_tenants(db, user))).first()
    if link is None:
        raise HTTPException(404, "Link not found")
    _audit(db, link.tenant_id, user.id, "delete", link)
    db.delete(link)
    db.commit()
    return {"message": "Link removed"}


@router.get("/control-search")
def search_controls(q: str = Query(..., min_length=2, max_length=200), db: Session = Depends(get_db),
                    user: GRCUser = Depends(require_auth)):
    tid = _tenants(db, user)[0]
    candidates = control_candidates(db, tid)
    needle = q.strip().lower()
    exact = [c for c in candidates if needle == (c["ref"] or "").lower()]
    ranked = [candidates[i] for i, _, _ in Ranker([c["text"] for c in candidates]).top(q, k=20)]
    seen, out = set(), []
    for c in exact + ranked:
        if (c["type"], c["id"]) not in seen:
            seen.add((c["type"], c["id"]))
            out.append({k: c[k] for k in ("type", "id", "ref", "label", "scf")})
    return {"items": out[:20]}


@router.get("/links/for")
def links_for_record(target_type: str = Query(..., max_length=30), target_id: Optional[int] = None,
                     target_ref: Optional[str] = Query(None, max_length=120), db: Session = Depends(get_db),
                     user: GRCUser = Depends(require_auth)):
    """The regulatory obligations a record is linked to, for that record's own page."""
    if target_id is None and not target_ref:
        raise HTTPException(400, "Name the record by id or by its code.")
    q = db.query(RegulatoryLink, RegulatoryObligation, RegulatoryChange).join(
        RegulatoryObligation, RegulatoryObligation.id == RegulatoryLink.obligation_id).join(
        RegulatoryChange, RegulatoryChange.id == RegulatoryLink.regulatory_change_id).filter(
        RegulatoryLink.tenant_id.in_(_tenants(db, user)), RegulatoryLink.target_type == target_type,
        RegulatoryLink.status != "rejected", RegulatoryObligation.deleted_at.is_(None))
    q = q.filter(RegulatoryLink.target_id == target_id) if target_id is not None else q.filter(
        RegulatoryLink.target_ref == target_ref)
    return {"items": [{
        "link": s_link(link), "obligation": {"id": ob.id, "ref": ob.ref, "summary": ob.summary,
                                             "compliance_status": ob.compliance_status,
                                             "deadline": ob.deadline.isoformat() if ob.deadline else None},
        "change": {"id": ch.id, "title": ch.title, "source": ch.source, "status": ch.status},
    } for link, ob, ch in q.order_by(RegulatoryChange.id.desc(), RegulatoryObligation.id).all()]}
