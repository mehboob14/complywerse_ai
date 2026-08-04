"""AI auto-mapping of governance policy statements → 360° linkage.

For each policy statement, an LLM (GPT-4o) selects the controls it implements
from a grounded candidate list (the tenant's normalized controls, or parsed
framework controls when normalization hasn't run). From those direct matches we
fan out across the linkage already stored in the platform:

    statement ──AI──▶ control (normalized | parsed)
                       │  ControlMapping            ▶ framework controls
                       │  NormalizedControlLink     ▶ parsed framework controls
                       │  InternalControlFrameworkLink ▶ internal controls
                       │  source_statement_id       ▶ internal controls
                       └  EvidenceControlMapping     ▶ evidence → EvidencePolicyLink

Results persist in `StatementControlMapping` (+ `EvidencePolicyLink` for
evidence) and the statement's `ai_suggested_controls`. Non-locked AI rows are
cleared on each run so re-mapping is idempotent; user-locked rows are preserved.
Runs automatically after a document is parsed (see policy_parser).
"""
import os
import re
import json
import logging
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ...config import get_openai_api_key, get_openai_model

from ...models import (
    GovernanceDocument,
    PolicyStatement, StatementControlMapping,
    NormalizedControl, ParsedFrameworkControl, FrameworkControl,
    InternalControl, InternalControlFrameworkLink,
    ControlMapping, NormalizedControlLink,
    EvidenceControlMapping, EvidencePolicyLink,
)

logger = logging.getLogger(__name__)
_WORD = re.compile(r"[a-z0-9]+")


def _ai_available() -> bool:
    key = get_openai_api_key()
    if not key or key.startswith("_DUMMY") or key == "your-api-key-here" or len(key) < 20:
        return False
    return True


def _client():
    from openai import OpenAI
    return OpenAI(api_key=get_openai_api_key(), base_url=os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL"))


def _kw(s: str) -> set:
    return set(_WORD.findall((s or "").lower()))


def _cand_text(kind: str, c) -> tuple:
    if kind == "normalized":
        return (c.code or "", c.name or "", c.statement or "", c.domain or "")
    return (c.control_id or "", c.title or "", (c.full_text or c.description or ""), c.domain or "")


def _candidates(db: Session, fw_ids=None):
    """Prefer normalized controls (the unified hub with the richest fan-out);
    fall back to parsed framework controls when the tenant hasn't normalized.

    When fw_ids (a set/list of UploadedFramework ids) is given, restrict the
    candidate pool to controls that belong to those frameworks — so a document is
    only mapped against its OWN in-scope/referenced frameworks, never the whole
    tenant catalog (the root cause of over-broad "matched across all frameworks"
    recommendations). Falls back to the full catalog only when fw_ids is empty."""
    if fw_ids:
        fw_ids = list(fw_ids)
        # Parsed controls live in the same id space as the document's framework ids.
        parsed = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id.in_(fw_ids)
        ).all()
        # Normalized controls linked INTO those frameworks (comply-once hub).
        sub = db.query(NormalizedControlLink.normalized_control_id).join(
            ParsedFrameworkControl,
            NormalizedControlLink.parsed_control_id == ParsedFrameworkControl.id,
        ).filter(ParsedFrameworkControl.uploaded_framework_id.in_(fw_ids)).subquery()
        ncs = db.query(NormalizedControl).filter(NormalizedControl.id.in_(sub)).all()
        if ncs:
            return "normalized", ncs
        # No normalized linkage for these frameworks → map directly against their parsed controls.
        return "parsed", parsed
    ncs = db.query(NormalizedControl).all()
    if ncs:
        return "normalized", ncs
    return "parsed", db.query(ParsedFrameworkControl).all()


def _narrow(stmt_text: str, kind: str, rows: list, top: int = 25) -> list:
    skw = _kw(stmt_text)
    scored = []
    for c in rows:
        _code, title, text, _dom = _cand_text(kind, c)
        scored.append((len(skw & _kw(f"{title} {text}")), c))
    scored.sort(key=lambda x: x[0], reverse=True)
    hits = [c for ov, c in scored[:top] if ov > 0]
    # If nothing overlaps, still hand the LLM the closest candidates to judge.
    return hits or [c for _ov, c in scored[:top]]


def _ai_match(stmt, kind: str, cands: list) -> list:
    """Return [(candidate, confidence, coverage_type, rationale)] chosen by the LLM."""
    if not cands:
        return []
    lines = []
    for i, c in enumerate(cands):
        code, title, text, _dom = _cand_text(kind, c)
        lines.append(f"[{i}] {code} | {title} | {text[:200]}")
    prompt = (
        "You are a GRC compliance analyst. A governance POLICY STATEMENT is given, plus a numbered list "
        "of candidate CONTROLS. Select ONLY the candidates that the statement implements, satisfies, or is "
        "governed by. Be precise — do not select loosely-related controls. For each selected control give a "
        "confidence (0-1) and a coverage of full|partial|supporting. Respond as STRICT JSON only: "
        '{"matches":[{"index":<int>,"confidence":<0-1>,"coverage_type":"full|partial|supporting","rationale":"<one sentence>"}]}. '
        "Use only indices from the list. If none genuinely match, return an empty matches array.\n\n"
        f"POLICY STATEMENT:\n{(stmt.statement_text or '')[:1500]}\n\nCANDIDATE CONTROLS:\n" + "\n".join(lines)
    )
    try:
        comp = _client().chat.completions.create(
            model=os.environ.get("AI_INTEGRATIONS_OPENAI_MODEL") or get_openai_model(),
            temperature=0.2,
            messages=[
                {"role": "system", "content": "Respond with valid JSON only."},
                {"role": "user", "content": prompt},
            ],
        )
        raw = (comp.choices[0].message.content or "").strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if raw.endswith("```"):
                raw = raw[:-3]
        data = json.loads(raw.strip())
        out = []
        for m in (data.get("matches") or []):
            try:
                idx = int(m.get("index"))
            except (TypeError, ValueError):
                continue
            if 0 <= idx < len(cands):
                try:
                    conf = float(m.get("confidence"))
                except (TypeError, ValueError):
                    conf = 0.6
                cov = str(m.get("coverage_type") or "partial").lower()
                if cov not in ("full", "partial", "supporting"):
                    cov = "partial"
                out.append((cands[idx], max(0.0, min(1.0, conf)), cov, str(m.get("rationale") or "")[:500]))
        return out
    except Exception as exc:  # noqa: BLE001
        logger.warning("statement auto-map LLM call failed: %s", exc)
        return []


def _add(db, seen, stmt, kind, id_field, cid, code, title, fw, dom, conf, cov, rat, src):
    key = (kind, cid)
    if cid is None or key in seen:
        return
    seen.add(key)
    m = StatementControlMapping(
        tenant_id=stmt.tenant_id, statement_id=stmt.id, control_kind=kind,
        control_code=code, control_title=(title or "")[:500], framework_name=fw, domain=dom,
        confidence=conf, coverage_type=cov, rationale=rat, link_source=src, created_by_ai=True,
    )
    setattr(m, id_field, cid)
    db.add(m)


def auto_map_statement(db: Session, stmt, fw_ids=None) -> dict:
    """Map one statement and persist the 360° linkage. Caller handles commit
    granularity; this commits its own unit of work. fw_ids scopes the candidate
    pool to the document's own frameworks (see _candidates)."""
    # Idempotent: drop prior AI-generated, non-locked rows before re-mapping.
    db.query(StatementControlMapping).filter(
        StatementControlMapping.statement_id == stmt.id,
        StatementControlMapping.is_locked.is_(False),
    ).delete(synchronize_session=False)

    if not _ai_available():
        db.commit()
        return {"mapped": 0, "evidence": 0, "source": "skipped_no_ai"}

    kind, rows = _candidates(db, fw_ids)
    if not rows:
        db.commit()
        return {"mapped": 0, "evidence": 0, "source": "no_controls"}

    seen = set()
    norm_ids, fc_ids, pc_ids = [], [], []

    # 1) Direct AI matches.
    for c, conf, cov, rat in _ai_match(stmt, kind, _narrow(stmt.statement_text, kind, rows)):
        if kind == "normalized":
            _add(db, seen, stmt, "normalized", "normalized_control_id", c.id, c.code, c.name, None, c.domain, conf, cov, rat, "ai")
            norm_ids.append(c.id)
        else:
            fw = c.uploaded_framework.name if getattr(c, "uploaded_framework", None) else None
            _add(db, seen, stmt, "parsed", "parsed_control_id", c.id, c.control_id, c.title, fw, c.domain, conf, cov, rat, "ai")
            pc_ids.append(c.id)

    # 2) Fan out from normalized controls → framework + parsed controls.
    for ncid in norm_ids:
        for cm in db.query(ControlMapping).filter(ControlMapping.normalized_control_id == ncid).all():
            fc = db.query(FrameworkControl).filter(FrameworkControl.id == cm.framework_control_id).first()
            if fc:
                _add(db, seen, stmt, "framework", "framework_control_id", fc.id, fc.code, fc.name, None, None, None, "supporting", "Mapped via normalized control", "derived")
                fc_ids.append(fc.id)
        for nl in db.query(NormalizedControlLink).filter(NormalizedControlLink.normalized_control_id == ncid).all():
            if nl.parsed_control_id:
                pc = db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id == nl.parsed_control_id).first()
                if pc:
                    fw = pc.uploaded_framework.name if getattr(pc, "uploaded_framework", None) else None
                    _add(db, seen, stmt, "parsed", "parsed_control_id", pc.id, pc.control_id, pc.title, fw, pc.domain, None, "supporting", "Member of a mapped normalized control", "derived")
                    pc_ids.append(pc.id)
            if nl.framework_control_id:
                fc_ids.append(nl.framework_control_id)

    # 3) Internal controls — those created from this statement, and those linked
    #    to any framework/normalized control we matched.
    for ic in db.query(InternalControl).filter(
        InternalControl.tenant_id == stmt.tenant_id,
        InternalControl.source_statement_id == stmt.id,
    ).all():
        _add(db, seen, stmt, "internal", "internal_control_id", ic.id, ic.control_id, ic.name, None, ic.category, None, "full", "Internal control derived from this statement", "derived")
    if norm_ids or fc_ids:
        for link in db.query(InternalControlFrameworkLink).filter(
            or_(
                InternalControlFrameworkLink.normalized_control_id.in_(norm_ids or [-1]),
                InternalControlFrameworkLink.framework_control_id.in_(fc_ids or [-1]),
            )
        ).all():
            ic = db.query(InternalControl).filter(InternalControl.id == link.internal_control_id).first()
            if ic:
                _add(db, seen, stmt, "internal", "internal_control_id", ic.id, ic.control_id, ic.name, None, ic.category, None, "supporting", "Internal control mapped to a linked framework/normalized control", "derived")

    # 4) Evidence — anything mapped to the controls we linked → link to the statement.
    ev_ids = set()
    if norm_ids:
        ev_ids |= {e.evidence_id for e in db.query(EvidenceControlMapping).filter(EvidenceControlMapping.normalized_control_id.in_(norm_ids)).all()}
    if fc_ids:
        ev_ids |= {e.evidence_id for e in db.query(EvidenceControlMapping).filter(EvidenceControlMapping.framework_control_id.in_(fc_ids)).all()}
    if pc_ids:
        ev_ids |= {e.evidence_id for e in db.query(EvidenceControlMapping).filter(EvidenceControlMapping.parsed_control_id.in_(pc_ids)).all()}
    existing_ev = {e.evidence_id for e in db.query(EvidencePolicyLink).filter(EvidencePolicyLink.policy_statement_id == stmt.id).all()}
    new_ev = 0
    for eid in ev_ids:
        if eid and eid not in existing_ev:
            db.add(EvidencePolicyLink(evidence_id=eid, policy_statement_id=stmt.id, link_type="auto"))
            new_ev += 1

    # 5) Populate ai_suggested_controls with the mapped control codes.
    db.flush()
    codes = sorted({
        m.control_code for m in db.query(StatementControlMapping).filter(
            StatementControlMapping.statement_id == stmt.id
        ).all() if m.control_code
    })
    stmt.ai_suggested_controls = codes
    db.commit()
    return {"mapped": len(seen), "evidence": new_ev, "source": "ai"}


def auto_map_document(db: Session, document_id: int) -> dict:
    """Auto-map every active statement of a document. Best-effort per statement —
    one failure never aborts the rest. Returns a summary."""
    # Scope the candidate pool to the document's OWN frameworks (in-scope ∪
    # referenced UploadedFramework ids) so we never map against the whole catalog.
    doc = db.query(GovernanceDocument).filter(GovernanceDocument.id == document_id).first()
    fw_ids = None
    if doc is not None:
        fw_ids = sorted(
            {int(x) for x in (getattr(doc, "applicable_framework_ids", None) or [])}
            | {int(x) for x in (getattr(doc, "framework_ids", None) or [])}
        ) or None

    stmts = db.query(PolicyStatement).filter(
        PolicyStatement.document_id == document_id,
        PolicyStatement.status == "active",
    ).all()
    mapped_total, ev_total, ok = 0, 0, 0
    for s in stmts:
        try:
            r = auto_map_statement(db, s, fw_ids=fw_ids)
            mapped_total += r.get("mapped", 0)
            ev_total += r.get("evidence", 0)
            ok += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("auto-map failed for statement %s: %s", getattr(s, "id", "?"), exc)
            try:
                db.rollback()
            except Exception:
                pass
    return {"statements": len(stmts), "statements_mapped": ok, "control_links": mapped_total, "evidence_links": ev_total}
