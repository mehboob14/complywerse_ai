"""Assurance tab on an SCF control: what must be proven, what proves it, how it was tested.

The control detail page already carries the control's assessment objectives,
its consolidated evidence set and its bound checks. This module adds what the
page could not answer:

* **which required artifacts are satisfied**, by linked evidence or by current
  automated results, and which still need a person to upload something;
* **the automated results themselves** — `SCFCheckResult` rows with the
  population each test covered, which no endpoint listed before;
* **suggestions** from the tenant's evidence library for every unsatisfied
  artifact (see evidence_match);
* the **testing record** — procedures, samples and tests — which lives in the
  Control Workbench tables, reached through the control's NormalizedControl.

There is no second assurance model. SCF controls map 1:1 to NormalizedControl
rows (verified 1,534 of 1,534 on both tenants), and the workbench already keys
test procedures, tests and samples to `source_type='normalized'`, so this reads
and writes the same rows the Controls catalog does.
"""
from __future__ import annotations

import random
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from grc.models import (
    ControlWorkEvidence, ControlWorkItem, ControlWorkSample, ControlWorkTest, ControlWorkTestProcedure,
    Evidence, EvidenceControlMapping, GRCUser, NormalizedControl, NormalizedControlLink, SCFCheckResult,
    SCFControlState, SCFObjective, SCFRelease, get_db,
)
from grc.modules.automation.evidence_match import EvidenceDoc, artifact_key, document_frequencies, rank
from grc.modules.automation.testing_rules import (
    FREQUENCY_LABELS, control_designation, count_exceptions, nist_53a, nist_procedures_for_control,
    population_items, recommended_sample_size, scaffold_procedures, select_sample, suggested_result,
)
from grc.modules.automation.router import (
    _authored_evidence, _mapping_reviews, _normalized_control_id, _require_evidence_edit, _scope_frameworks,
    consolidated_artifacts_for, evidence_type, requirement_codes_for_control, scoped_required_evidence,
)
from grc.modules.control_library.routers.workbench import (
    _FREQ_DAYS, _get_or_create_work_item, _resync_effectiveness as wb_resync_effectiveness,
    _serialize_item, ensure_tables, generate_procedures as wb_generate_procedures,
)
from grc.modules.scf import custom_controls
from grc.modules.scf.ownership import ensure_state
from grc.modules.scf.scope_service import ensure_default_scope
from grc.rich_audit import write_rich_audit_log
from grc.routers.auth_router import get_user_primary_tenant, require_auth, require_tenant_permission

router = APIRouter(prefix="/automation/common", tags=["Automation Control Assurance"])


def _audit(db: Session, current_user: GRCUser, tenant_id: int, scf_id: str, action: str, summary: str,
           resource_type: str = "control_testing", resource_id: Optional[int] = None,
           before: Optional[Dict[str, Any]] = None, after: Optional[Dict[str, Any]] = None) -> None:
    """One audit-log row named for the control, so its History tab and the Audit
    Logs page (module Controls Automation) both show who did what."""
    write_rich_audit_log(
        db=db, tenant_id=tenant_id, user_id=getattr(current_user, "id", None), action=action,
        resource_type=resource_type, resource_id=resource_id, resource_name=scf_id,
        resource_url=f"/automation/soc2-controls/{scf_id}?tab=assurance", summary=summary,
        before=before, after=after,
    )


def _test_snapshot(t: Any) -> Dict[str, Any]:
    return {"test_type": t.test_type, "result": t.result, "status": t.status, "sample_size": t.sample_size,
            "exceptions_found": t.exceptions_found, "findings": t.findings}

#: Library items considered for suggestions, newest first.
#: ponytail: tokenises per request; cache per tenant keyed on (count, newest
#: upload) once a library in the thousands makes the tab slow to open.
_SUGGESTION_POOL = 500


# ── states ──────────────────────────────────────────────────────────────────
def evidence_state(status: Optional[str], expired: bool, is_stale: bool) -> str:
    """What one linked file currently proves.

    Expiry outranks approval: an approved policy past its validity date is not
    evidence of anything today.
    """
    s = (status or "").lower()
    if s == "rejected":
        return "rejected"
    if expired or is_stale:
        return "stale"
    if s == "approved":
        return "approved"
    return "pending"


def automated_state(results: Iterable[Dict[str, Any]]) -> str:
    """Roll the latest automated results for a control into one word.

    `collection_failed`/`error` never count as a failure of the control — the
    collector could not look, which says nothing about whether the control works.
    """
    current = [r for r in results if not r.get("expired")]
    if any(r.get("status") == "fail" for r in current):
        return "failing"
    if any(r.get("status") == "pass" for r in current):
        return "passing"
    if any(r.get("expired") for r in results):
        return "expired"
    return "none"


def artifact_state(method: str, evidence_states: List[str], automated: str) -> str:
    """Whether one required artifact is satisfied.

    * manual — only a person's evidence can satisfy it.
    * hybrid — collected partly by a system and partly by hand, so the manual half
      is still required; automated results are shown alongside, not counted.
    * automated — current passing results satisfy it. An uploaded file does too:
      until a collector is connected, a person can evidence it by hand, which is
      what the tab tells them to do. A live failure outranks any upload, though:
      the collector is looking at the system now, and a document is a snapshot.
    """
    if "approved" in evidence_states:
        manual = "satisfied"
    elif "pending" in evidence_states:
        manual = "pending_review"
    elif "stale" in evidence_states:
        manual = "stale"
    else:
        manual = "missing"

    if (method or "manual") != "automated":
        return manual
    if automated == "failing":
        return "failing"
    if manual == "satisfied" or automated == "passing":
        return "satisfied"
    if automated == "expired" and manual == "missing":
        return "stale"
    return manual


READINESS_ORDER = ("satisfied", "pending_review", "failing", "stale", "missing")


# ── loaders ─────────────────────────────────────────────────────────────────
def _nc_or_404(db: Session, scf_id: str, tenant_id: Optional[int] = None) -> int:
    nc_id = _normalized_control_id(db, scf_id, tenant_id)
    if nc_id is None:
        raise HTTPException(status_code=404, detail=f"No control {scf_id} in this tenant's catalog")
    return nc_id


def _artifacts(db: Session, tenant_id: int, scf_id: str) -> List[Dict[str, Any]]:
    """The control's consolidated evidence set, each with its cross-control key."""
    out = []
    seen = set()
    for a in consolidated_artifacts_for(db, tenant_id, scf_id):
        key = artifact_key(a.get("name"))
        if not key or key in seen:
            continue
        seen.add(key)
        out.append({
            "key": key,
            "name": a.get("name"),
            "description": a.get("description") or "",
            "collection_method": a.get("collection_method") or "manual",
            "required_by": a.get("required_by") or [],
            "references": [],
            "filetype": a.get("filetype"),
            "type": evidence_type(a.get("name"), a.get("filetype")),
            "mandatory": bool(a.get("mandatory")),
        })
    return out


def _required_artifacts(db: Session, tenant_id: int, scf_id: str, automated: bool = False) -> List[Dict[str, Any]]:
    """The evidence this control needs.

    With frameworks in scope: exactly what those frameworks' requirements ask for,
    in their own words. With none: the consolidated set across every framework.
    """
    scope_fws = _scope_frameworks(ensure_default_scope(db, tenant_id))
    release = (db.query(SCFRelease)
               .filter(SCFRelease.import_status == "ready", SCFRelease.is_current.is_(True)).first())
    if not scope_fws:
        required = _artifacts(db, tenant_id, scf_id)
    elif release is None:
        required = []
    else:
        suppressed, retargets = _mapping_reviews(db, tenant_id)
        codes = requirement_codes_for_control(
            db, tenant_id, release.id, scf_id, [f["key"] for f in scope_fws], suppressed, retargets,
        )
        required = scoped_required_evidence(codes, scope_fws, automated)
    # A tenant-authored control also asks for whatever its author wrote down.
    nc = custom_controls.get_custom(db, tenant_id, scf_id)
    if nc is not None:
        have = {r["key"] for r in required}
        required = required + [a for a in _authored_evidence(nc) if a["key"] not in have]
    return required


def _linked_evidence(db: Session, tenant_id: int, nc_id: int) -> List[Dict[str, Any]]:
    now = datetime.utcnow()
    rows = (
        db.query(Evidence, EvidenceControlMapping)
        .join(EvidenceControlMapping, EvidenceControlMapping.evidence_id == Evidence.id)
        .filter(Evidence.tenant_id == tenant_id, EvidenceControlMapping.normalized_control_id == nc_id)
        .order_by(Evidence.uploaded_at.desc())
        .all()
    )
    out = []
    for e, m in rows:
        expired = bool(e.expiry_date and e.expiry_date < now)
        out.append({
            "mapping_id": m.id,
            "evidence_id": e.id,
            "artifact_key": m.artifact_key,
            "name": e.name,
            "file_name": e.file_name,
            "file_type": e.file_type,
            "evidence_type": e.evidence_type,
            "status": e.status,
            "state": evidence_state(e.status, expired, bool(e.is_stale)),
            "expired": expired,
            "expiry_date": e.expiry_date.isoformat() if e.expiry_date else None,
            "collection_date": e.collection_date.isoformat() if e.collection_date else None,
            "uploaded_at": e.uploaded_at.isoformat() if e.uploaded_at else None,
            "coverage_type": m.coverage_type,
            "created_by_ai": bool(m.created_by_ai),
            # Workbench samples are mapped with a clause reference ("Test procedure 3")
            # and locked; they are unlinked from the procedure, not from here.
            "clause_reference": m.clause_reference,
            "locked": bool(m.is_locked),
        })
    return out


def _automated_results(db: Session, tenant_id: int, scf_id: str) -> List[Dict[str, Any]]:
    """Latest result per (check, objective, resource) for this control.

    `SCFCheckResult` is append-only; the newest row for a given check and
    resource is what is known now. Population figures are the test's own
    account of how much it looked at, which is what makes an automated check a
    full-population test rather than a sample.
    """
    now = datetime.utcnow()
    where = [SCFCheckResult.scf_id == scf_id]
    # A custom control's checks are bound by id, and a connector records its
    # result under the check's own SCF token, not the authored control's code.
    nc = custom_controls.get_custom(db, tenant_id, scf_id)
    if nc is not None and nc.bound_check_ids:
        where.append(SCFCheckResult.check_id.in_(sorted(set(nc.bound_check_ids))))
    rows = (
        db.query(SCFCheckResult)
        .filter(SCFCheckResult.tenant_id == tenant_id, or_(*where))
        .order_by(SCFCheckResult.collected_at.desc())
        .limit(1000)
        .all()
    )
    latest: Dict[Tuple[str, Optional[str], Optional[str]], SCFCheckResult] = {}
    for r in rows:
        latest.setdefault((r.check_id, r.ao_id, r.resource), r)
    return [{
        "check_id": r.check_id,
        "connector": r.connector,
        "ao_id": r.ao_id,
        "resource": r.resource,
        "status": r.status,
        "severity": r.severity,
        "population_size": r.population_size,
        "tested_size": r.tested_size,
        "truncated": bool(r.truncated),
        "detail": r.detail,
        "collected_at": r.collected_at.isoformat() if r.collected_at else None,
        "expires_at": r.expires_at.isoformat() if r.expires_at else None,
        "expired": bool(r.expires_at and r.expires_at < now),
    } for r in latest.values()]


# ── read ────────────────────────────────────────────────────────────────────
@router.get("/controls/{scf_id}/assurance")
def get_control_assurance(
    scf_id: str,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Everything the Assurance tab needs beyond the control detail payload."""
    tenant_id = get_user_primary_tenant(current_user, db)
    nc_id = _nc_or_404(db, scf_id, tenant_id)

    ensure_tables(db)
    wi = _get_or_create_work_item(db, tenant_id, "normalized", nc_id,
                                  created_by=getattr(current_user, "id", None))
    if wi is None:
        raise HTTPException(status_code=404, detail=f"No control {scf_id} in this tenant's catalog")
    db.commit()

    linked = _linked_evidence(db, tenant_id, nc_id)
    automated = _automated_results(db, tenant_id, scf_id)
    auto_state = automated_state(automated)

    by_artifact: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for item in linked:
        if item["artifact_key"]:
            by_artifact[item["artifact_key"]].append(item)

    scope = ensure_default_scope(db, tenant_id)
    required = _required_artifacts(db, tenant_id, scf_id, automated=bool(automated))

    artifacts = []
    readiness = {k: 0 for k in READINESS_ORDER}
    for a in required:
        items = by_artifact.get(a["key"], [])
        state = artifact_state(a["collection_method"], [i["state"] for i in items], auto_state)
        readiness[state] += 1
        artifacts.append({**a, "state": state, "evidence": items})

    state = (db.query(SCFControlState)
             .filter(SCFControlState.tenant_id == tenant_id, SCFControlState.scope_id == scope.id,
                     SCFControlState.scf_id == scf_id).first())
    db.commit()

    return {
        "scf_id": scf_id,
        "normalized_control_id": nc_id,
        "work_item": _serialize_item(db, wi),
        "designation": (state.designation if state else None) or "not_assessed",
        "last_assessed_at": state.last_assessed_at.isoformat() if state and state.last_assessed_at else None,
        "artifacts": artifacts,
        "readiness": {"total": len(artifacts), **readiness},
        "evidence": linked,
        "automated": {"state": auto_state, "results": automated},
    }


# ── link / unlink ───────────────────────────────────────────────────────────
class LinkArtifactEvidenceBody(BaseModel):
    evidence_id: int
    #: The required artifact this file satisfies. Omit to link to the control generally.
    artifact_name: Optional[str] = None
    coverage_type: str = Field("full", pattern="^(full|partial|supporting)$")
    note: Optional[str] = None


@router.post("/controls/{scf_id}/assurance/evidence")
def link_artifact_evidence(
    scf_id: str,
    body: LinkArtifactEvidenceBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_evidence_edit),
):
    """Link a library item to this control as a specific required artifact.

    Idempotent per (evidence, control, artifact). A file already linked to the
    control generally is upgraded in place rather than duplicated, so the
    Evidence tab keeps one row per file.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    nc_id = _nc_or_404(db, scf_id, tenant_id)
    ev = db.query(Evidence).filter(Evidence.id == body.evidence_id, Evidence.tenant_id == tenant_id).first()
    if ev is None:
        raise HTTPException(status_code=404, detail="Evidence not found for this tenant")
    key = artifact_key(body.artifact_name) or None

    existing = (db.query(EvidenceControlMapping)
                .filter(EvidenceControlMapping.evidence_id == ev.id,
                        EvidenceControlMapping.normalized_control_id == nc_id).all())
    for m in existing:
        if m.artifact_key == key:
            return {"mapping_id": m.id, "created": False}
    general = next((m for m in existing if m.artifact_key is None and not m.is_locked), None)
    what = f"“{body.artifact_name}”" if body.artifact_name else "the control"
    if key and general is not None:
        general.artifact_key = key
        general.coverage_type = body.coverage_type
        general.created_by_ai = False
        if body.note:
            general.matching_rationale = body.note
        _audit(db, current_user, tenant_id, scf_id, "evidence_link",
               f"Linked {ev.name or ev.file_name} to {scf_id} as {what}", resource_type="control_evidence",
               resource_id=general.id)
        db.commit()
        return {"mapping_id": general.id, "created": False, "upgraded": True}

    m = EvidenceControlMapping(
        evidence_id=ev.id,
        normalized_control_id=nc_id,
        framework_name="SCF",
        control_code=scf_id,
        artifact_key=key,
        clause_reference=(body.artifact_name or None),
        coverage_type=body.coverage_type,
        matching_rationale=body.note,
        rule_based_validation=False,
        created_by_ai=False,
    )
    db.add(m)
    db.flush()
    _audit(db, current_user, tenant_id, scf_id, "evidence_link",
           f"Linked {ev.name or ev.file_name} to {scf_id} as {what}", resource_type="control_evidence",
           resource_id=m.id)
    db.commit()
    return {"mapping_id": m.id, "created": True}


@router.delete("/controls/{scf_id}/assurance/evidence/{mapping_id}")
def unlink_artifact_evidence(
    scf_id: str,
    mapping_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_evidence_edit),
):
    """Remove a link. The file stays in the library."""
    tenant_id = get_user_primary_tenant(current_user, db)
    nc_id = _nc_or_404(db, scf_id, tenant_id)
    m = (db.query(EvidenceControlMapping)
         .join(Evidence, Evidence.id == EvidenceControlMapping.evidence_id)
         .filter(EvidenceControlMapping.id == mapping_id,
                 EvidenceControlMapping.normalized_control_id == nc_id,
                 Evidence.tenant_id == tenant_id)
         .first())
    if m is None:
        raise HTTPException(status_code=404, detail="Link not found on this control")
    if m.is_locked:
        raise HTTPException(
            status_code=409,
            detail="This file is a test sample; remove it from its test procedure instead.",
        )
    name = db.query(Evidence.name).filter(Evidence.id == m.evidence_id).scalar()
    _audit(db, current_user, tenant_id, scf_id, "evidence_unlink", f"Unlinked {name or 'evidence'} from {scf_id}",
           resource_type="control_evidence", resource_id=m.id)
    db.delete(m)
    db.commit()
    return {"deleted": mapping_id}


# ── suggestions ─────────────────────────────────────────────────────────────
@router.get("/controls/{scf_id}/assurance/suggestions")
def suggest_evidence(
    scf_id: str,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Library items that may satisfy each required artifact, with the reason."""
    tenant_id = get_user_primary_tenant(current_user, db)
    nc_id = _nc_or_404(db, scf_id, tenant_id)
    artifacts = _required_artifacts(db, tenant_id, scf_id)
    if not artifacts:
        return {"scf_id": scf_id, "suggestions": {}}

    now = datetime.utcnow()
    pool = (db.query(Evidence)
            .filter(Evidence.tenant_id == tenant_id, Evidence.status != "rejected")
            .order_by(Evidence.uploaded_at.desc())
            .limit(_SUGGESTION_POOL)
            .all())
    if not pool:
        return {"scf_id": scf_id, "suggestions": {}}
    docs = [EvidenceDoc(
        id=e.id, name=e.name or "", evidence_type=e.evidence_type or "",
        description=e.description or "", summary=e.content_summary or "",
        text=e.ocr_content or "", file_name=e.file_name or "", status=e.status or "",
        is_stale=bool(e.is_stale), expired=bool(e.expiry_date and e.expiry_date < now),
    ) for e in pool]
    df = document_frequencies(docs)
    meta = {e.id: e for e in pool}

    keys = [a["key"] for a in artifacts]
    already: Dict[str, set] = defaultdict(set)
    elsewhere: Dict[str, Dict[int, List[str]]] = defaultdict(lambda: defaultdict(list))
    for m in (db.query(EvidenceControlMapping)
              .join(Evidence, Evidence.id == EvidenceControlMapping.evidence_id)
              .filter(Evidence.tenant_id == tenant_id, EvidenceControlMapping.artifact_key.in_(keys))
              .all()):
        if m.normalized_control_id == nc_id:
            already[m.artifact_key].add(m.evidence_id)
        else:
            elsewhere[m.artifact_key][m.evidence_id].append(m.control_code or f"control {m.normalized_control_id}")

    # Evidence on the framework controls this control consolidates. SCF controls
    # carry no NormalizedControlLink rows until a scope recompute backfills them,
    # so this is often empty — cheap to ask either way.
    crosswalk: Dict[int, List[str]] = defaultdict(list)
    links = db.query(NormalizedControlLink).filter(NormalizedControlLink.normalized_control_id == nc_id).all()
    parsed_ids = [l.parsed_control_id for l in links if l.parsed_control_id]
    framework_ids = [l.framework_control_id for l in links if l.framework_control_id]
    if parsed_ids or framework_ids:
        clauses = []
        if parsed_ids:
            clauses.append(EvidenceControlMapping.parsed_control_id.in_(parsed_ids))
        if framework_ids:
            clauses.append(EvidenceControlMapping.framework_control_id.in_(framework_ids))
        for m in (db.query(EvidenceControlMapping)
                  .join(Evidence, Evidence.id == EvidenceControlMapping.evidence_id)
                  .filter(Evidence.tenant_id == tenant_id, or_(*clauses))
                  .all()):
            label = " ".join(x for x in (m.framework_name, m.control_code) if x) or "a mapped framework control"
            crosswalk[m.evidence_id].append(label)

    linked_here = {m.evidence_id for m in db.query(EvidenceControlMapping.evidence_id)
                   .filter(EvidenceControlMapping.normalized_control_id == nc_id).all()}

    out: Dict[str, List[Dict[str, Any]]] = {}
    for a in artifacts:
        ranked = rank(
            a["name"], a["description"], docs, df=df,
            same_artifact=dict(elsewhere.get(a["key"], {})),
            # A file already on this control is offered for another of its artifacts
            # only on the strength of what it contains, not the crosswalk.
            crosswalk={k: v for k, v in crosswalk.items() if k not in linked_here},
            exclude=already.get(a["key"], set()),
        )
        if ranked:
            out[a["key"]] = [{
                "evidence_id": s.evidence_id,
                "score": s.score,
                "signal": s.signal,
                "reasons": s.reasons,
                "name": meta[s.evidence_id].name,
                "file_name": meta[s.evidence_id].file_name,
                "evidence_type": meta[s.evidence_id].evidence_type,
                "status": meta[s.evidence_id].status,
                "already_on_control": s.evidence_id in linked_here,
            } for s in ranked]
    return {"scf_id": scf_id, "suggestions": out}


# ═════════════════════════════════════════════════════════════════════════════
# Testing: procedures, sampling, conclusion, sign-off
# ═════════════════════════════════════════════════════════════════════════════
_require_testing_edit = require_tenant_permission("controls:control_testing:edit")
_require_testing_approve = require_tenant_permission("controls:controls:approve")

PROCEDURE_TYPES = {"walkthrough", "inquiry", "observation", "inspection", "reperformance"}
STEP_RESULTS = {"pass", "exception", "not_applicable"}
TEST_RESULTS = {"effective", "partially_effective", "ineffective"}


def _control_work_item(db: Session, current_user: GRCUser, scf_id: str) -> Tuple[int, int, ControlWorkItem]:
    tenant_id = get_user_primary_tenant(current_user, db)
    nc_id = _nc_or_404(db, scf_id, tenant_id)
    ensure_tables(db)
    wi = _get_or_create_work_item(db, tenant_id, "normalized", nc_id,
                                  created_by=getattr(current_user, "id", None))
    if wi is None:
        raise HTTPException(status_code=404, detail=f"No control {scf_id} in this tenant's catalog")
    return tenant_id, nc_id, wi


def _users(db: Session, ids: Iterable[Optional[int]]) -> Dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: (u.display_name or u.username or u.email or f"User {u.id}")
            for u in db.query(GRCUser).filter(GRCUser.id.in_(ids)).all()}


def _iso(v) -> Optional[str]:
    return v.isoformat() if v else None


def _testing_record(db: Session, wi: ControlWorkItem) -> Dict[str, Any]:
    """Procedures with their outcomes and files, tests with their samples."""
    procs = (db.query(ControlWorkTestProcedure)
             .filter(ControlWorkTestProcedure.work_item_id == wi.id)
             .order_by(ControlWorkTestProcedure.seq, ControlWorkTestProcedure.id).all())
    tests = (db.query(ControlWorkTest)
             .filter(ControlWorkTest.work_item_id == wi.id)
             .order_by(ControlWorkTest.test_date.desc(), ControlWorkTest.id.desc()).all())
    files = db.query(ControlWorkEvidence).filter(ControlWorkEvidence.work_item_id == wi.id).all()
    samples = (db.query(ControlWorkSample)
               .filter(ControlWorkSample.work_item_id == wi.id)
               .order_by(ControlWorkSample.test_id, ControlWorkSample.seq).all())
    names = _users(db, [p.tested_by for p in procs] + [t.tester_id for t in tests]
                   + [t.reviewer_id for t in tests] + [f.uploaded_by for f in files]
                   + [s.tested_by for s in samples])

    files_by_proc: Dict[Optional[int], List[Dict[str, Any]]] = defaultdict(list)
    for f in files:
        files_by_proc[f.test_procedure_id].append({
            "id": f.id, "evidence_id": f.evidence_id, "file_name": f.file_name,
            "review_status": f.review_status, "uploaded_by": names.get(f.uploaded_by),
            "uploaded_at": _iso(f.uploaded_at),
        })
    samples_by_test: Dict[int, List[Dict[str, Any]]] = defaultdict(list)
    for s in samples:
        samples_by_test[s.test_id].append({
            "id": s.id, "seq": s.seq, "item_ref": s.item_ref, "procedure_id": s.procedure_id,
            "result": s.result, "note": s.note, "evidence_id": s.evidence_id,
            "tested_by": names.get(s.tested_by), "tested_at": _iso(s.tested_at),
        })

    return {
        "procedures": [{
            "id": p.id, "seq": p.seq, "procedure_type": p.procedure_type,
            "description": p.description, "expected_result": p.expected_result,
            "frequency": p.frequency, "sample_size": p.sample_size, "source": p.source,
            "ao_ids": p.ao_ids or [], "result": p.result, "result_note": p.result_note,
            "is_checked": bool(p.is_checked),
            "tested_by": names.get(p.tested_by), "tested_at": _iso(p.tested_at),
            "files": files_by_proc.get(p.id, []),
        } for p in procs],
        "control_files": files_by_proc.get(None, []),
        "tests": [{
            "id": t.id, "test_type": t.test_type, "status": t.status,
            "result": None if t.result == "pending" else t.result,
            "test_date": _iso(t.test_date),
            "period_start": _iso(t.test_period_start), "period_end": _iso(t.test_period_end),
            "tester_id": t.tester_id, "tester": names.get(t.tester_id),
            "reviewer_id": t.reviewer_id, "reviewer": names.get(t.reviewer_id),
            "reviewed_at": _iso(t.reviewed_at), "locked": bool(t.locked_at),
            "independent_review": t.independent_review,
            "frequency": t.frequency, "population_size": t.population_size,
            "population_description": t.population_description,
            "selection_method": t.selection_method, "sample_seed": t.sample_seed,
            "tolerable_exceptions": t.tolerable_exceptions or 0,
            "sample_size": t.sample_size, "exceptions_found": t.exceptions_found,
            "conclusion_rationale": t.conclusion_rationale, "findings": t.findings,
            "recommendations": t.recommendations, "management_response": t.management_response,
            "suggested_result": suggested_result([s["result"] for s in samples_by_test.get(t.id, [])],
                                                 t.tolerable_exceptions or 0),
            "samples": samples_by_test.get(t.id, []),
        } for t in tests],
    }


def _procedure(db: Session, wi: ControlWorkItem, procedure_id: int) -> ControlWorkTestProcedure:
    p = (db.query(ControlWorkTestProcedure)
         .filter(ControlWorkTestProcedure.id == procedure_id, ControlWorkTestProcedure.work_item_id == wi.id)
         .first())
    if p is None:
        raise HTTPException(status_code=404, detail="Procedure not found on this control")
    return p


def _test(db: Session, wi: ControlWorkItem, test_id: int) -> ControlWorkTest:
    t = (db.query(ControlWorkTest)
         .filter(ControlWorkTest.id == test_id, ControlWorkTest.work_item_id == wi.id).first())
    if t is None:
        raise HTTPException(status_code=404, detail="Test not found on this control")
    return t


def _unlocked(t: ControlWorkTest) -> None:
    if t.locked_at:
        raise HTTPException(
            status_code=409,
            detail="This test was signed off and is locked as the audit record. Start a new test instead.",
        )


@router.get("/controls/{scf_id}/assurance/testing")
def get_testing_record(
    scf_id: str,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Procedures, tests and samples, plus the sampling guidance for this control."""
    _, _, wi = _control_work_item(db, current_user, scf_id)
    db.commit()
    record = _testing_record(db, wi)
    record["sampling"] = {
        "key_control": bool(wi.is_key_control),
        "frequencies": [{"value": k, "label": v} for k, v in FREQUENCY_LABELS.items()],
        "sizes": {k: recommended_sample_size(k, bool(wi.is_key_control))[0] for k in FREQUENCY_LABELS},
    }
    # The NIST SP 800-53A procedure behind each objective, where SCF cites one.
    record["nist"] = nist_procedures_for_control(scf_id)
    source = nist_53a().get("source") or {}
    record["nist_source"] = {k: source.get(k) for k in ("title", "version", "url")} if source else None
    return record


# ── procedures ──────────────────────────────────────────────────────────────
def _current_objectives(db: Session, scf_id: str, tenant_id: Optional[int] = None) -> List[Dict[str, Any]]:
    release = (db.query(SCFRelease)
               .filter(SCFRelease.import_status == "ready", SCFRelease.is_current.is_(True)).first())
    if release is None:
        return []
    ids = [scf_id]
    if tenant_id is not None:
        # An authored control has no objectives of its own; it is tested against
        # those of the SCF controls it implements.
        nc = custom_controls.get_custom(db, tenant_id, scf_id)
        if nc is not None and nc.implements_scf_ids:
            ids = list(nc.implements_scf_ids)
    return [{"ao_id": o.ao_id, "objective": o.objective, "pptdf": o.pptdf}
            for o in db.query(SCFObjective)
            .filter(SCFObjective.release_id == release.id, SCFObjective.scf_id.in_(ids))
            .order_by(SCFObjective.scf_id, SCFObjective.seq).all()]


def _next_seq(db: Session, wi: ControlWorkItem) -> int:
    return (db.query(func.max(ControlWorkTestProcedure.seq))
            .filter(ControlWorkTestProcedure.work_item_id == wi.id).scalar() or 0) + 1


@router.post("/controls/{scf_id}/assurance/procedures/scaffold")
def scaffold_objective_procedures(
    scf_id: str,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_testing_edit),
):
    """One editable step per SCF assessment objective not already covered.

    Model-free: each step quotes its objective verbatim inside a fixed
    instruction for the objective's PPTDF tag (see testing_rules).
    """
    tenant_id, _, wi = _control_work_item(db, current_user, scf_id)
    existing = [ao for (ids,) in db.query(ControlWorkTestProcedure.ao_ids)
                .filter(ControlWorkTestProcedure.work_item_id == wi.id).all() for ao in (ids or [])]
    steps = scaffold_procedures(_current_objectives(db, scf_id, tenant_id), existing)
    seq = _next_seq(db, wi)
    for i, step in enumerate(steps):
        db.add(ControlWorkTestProcedure(
            work_item_id=wi.id, tenant_id=tenant_id, seq=seq + i, source="scf_objective",
            procedure_type=step["procedure_type"], description=step["description"],
            expected_result=step["expected_result"], ao_ids=step["ao_ids"],
        ))
    if steps:
        _audit(db, current_user, tenant_id, scf_id, "procedures_scaffold",
               f"Added {len(steps)} test procedure{'s' if len(steps) != 1 else ''} from {scf_id}'s objectives")
    db.commit()
    return {"created": len(steps), **_testing_record(db, wi)}


@router.post("/controls/{scf_id}/assurance/procedures/suggest")
def suggest_procedures_with_ai(
    scf_id: str,
    replace: bool = Query(False, description="Regenerate: replace AI steps nobody has worked on"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_testing_edit),
):
    """Get AI Recommendation, as in the Controls catalog: a numbered checklist.

    Built only from our consolidated evidence text and the tenant's own evidence
    names — never SCF text (workbench.generate_procedures withholds the control's
    wording for SCF controls). When the model is unavailable the catalog's
    template steps are added instead, marked `template`, and `source` says so.
    """
    tenant_id, _, wi = _control_work_item(db, current_user, scf_id)
    db.commit()
    before_ids = {pid for (pid,) in db.query(ControlWorkTestProcedure.id)
                  .filter(ControlWorkTestProcedure.work_item_id == wi.id).all()}
    wb_generate_procedures(wi.id, replace=replace, db=db, current_user=current_user)
    after = _testing_record(db, wi)
    new = [p for p in after["procedures"] if p["id"] not in before_ids]
    source = "template" if new and all(p["source"] == "template" for p in new) else "ai"
    _audit(db, current_user, tenant_id, scf_id, "procedures_regenerate" if replace else "procedures_generate",
           f"{'Regenerated' if replace else 'Generated'} {len(new)} test procedure{'s' if len(new) != 1 else ''} "
           f"for {scf_id} ({'template' if source == 'template' else 'AI recommendation'})")
    db.commit()
    return {"created": len(new), "source": source, **after}


class ProcedureBody(BaseModel):
    procedure_type: Optional[str] = None
    description: Optional[str] = Field(None, max_length=4000)
    expected_result: Optional[str] = Field(None, max_length=4000)
    frequency: Optional[str] = Field(None, max_length=100)
    sample_size: Optional[str] = Field(None, max_length=100)
    ao_ids: Optional[List[str]] = None
    #: Recording an outcome. Empty string clears it.
    result: Optional[str] = None
    result_note: Optional[str] = Field(None, max_length=4000)
    #: The Controls catalog's checklist tick.
    is_checked: Optional[bool] = None


def _apply_procedure(p: ControlWorkTestProcedure, body: ProcedureBody, user_id: Optional[int]) -> None:
    if body.procedure_type is not None:
        if body.procedure_type not in PROCEDURE_TYPES:
            raise HTTPException(status_code=422, detail=f"procedure_type must be one of {sorted(PROCEDURE_TYPES)}")
        p.procedure_type = body.procedure_type
    if body.description is not None:
        if not body.description.strip():
            raise HTTPException(status_code=422, detail="A procedure needs a description.")
        p.description = body.description.strip()
    for field in ("expected_result", "frequency", "sample_size", "result_note"):
        value = getattr(body, field)
        if value is not None:
            setattr(p, field, value.strip() or None)
    if body.ao_ids is not None:
        p.ao_ids = [a for a in body.ao_ids if a] or None
    if body.result is not None:
        if body.result == "":
            p.result, p.tested_by, p.tested_at, p.is_checked = None, None, None, False
        elif body.result not in STEP_RESULTS:
            raise HTTPException(status_code=422, detail=f"result must be one of {sorted(STEP_RESULTS)}")
        else:
            p.result, p.tested_by, p.tested_at = body.result, user_id, datetime.utcnow()
            # Keep the Controls catalog's checklist in step with the outcome.
            p.is_checked, p.checked_by, p.checked_at = True, user_id, p.tested_at
    if body.is_checked is not None and body.result is None:
        p.is_checked = body.is_checked
        p.checked_by = user_id if body.is_checked else None
        p.checked_at = datetime.utcnow() if body.is_checked else None


@router.post("/controls/{scf_id}/assurance/procedures")
def add_procedure(
    scf_id: str,
    body: ProcedureBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_testing_edit),
):
    tenant_id, _, wi = _control_work_item(db, current_user, scf_id)
    if not (body.description or "").strip():
        raise HTTPException(status_code=422, detail="A procedure needs a description.")
    p = ControlWorkTestProcedure(work_item_id=wi.id, tenant_id=tenant_id, seq=_next_seq(db, wi),
                                 source="manual", description=body.description.strip(),
                                 procedure_type=body.procedure_type or "inspection")
    _apply_procedure(p, body, getattr(current_user, "id", None))
    db.add(p)
    db.flush()
    _audit(db, current_user, tenant_id, scf_id, "procedure_add", f"Added test procedure {p.seq} to {scf_id}",
           resource_id=p.id, after={"description": p.description, "procedure_type": p.procedure_type})
    db.commit()
    return _testing_record(db, wi)


@router.patch("/controls/{scf_id}/assurance/procedures/{procedure_id}")
def update_procedure(
    scf_id: str,
    procedure_id: int,
    body: ProcedureBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_testing_edit),
):
    tenant_id, _, wi = _control_work_item(db, current_user, scf_id)
    p = _procedure(db, wi, procedure_id)
    before = {"description": p.description, "result": p.result, "is_checked": bool(p.is_checked)}
    _apply_procedure(p, body, getattr(current_user, "id", None))
    after = {"description": p.description, "result": p.result, "is_checked": bool(p.is_checked)}
    if before != after:
        verb = ("Ticked" if p.is_checked else "Unticked") if before["is_checked"] != after["is_checked"] and \
            before["result"] == after["result"] else "Updated"
        _audit(db, current_user, tenant_id, scf_id, "procedure_update", f"{verb} test procedure {p.seq} on {scf_id}",
               resource_id=p.id, before=before, after=after)
    db.commit()
    return _testing_record(db, wi)


@router.post("/controls/{scf_id}/assurance/procedures/{procedure_id}/move")
def move_procedure(
    scf_id: str,
    procedure_id: int,
    direction: int = 1,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_testing_edit),
):
    """Swap a step with its neighbour (direction -1 up, +1 down)."""
    _, _, wi = _control_work_item(db, current_user, scf_id)
    procs = (db.query(ControlWorkTestProcedure).filter(ControlWorkTestProcedure.work_item_id == wi.id)
             .order_by(ControlWorkTestProcedure.seq, ControlWorkTestProcedure.id).all())
    idx = next((i for i, p in enumerate(procs) if p.id == procedure_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Procedure not found on this control")
    j = idx + (1 if direction > 0 else -1)
    if 0 <= j < len(procs):
        procs[idx], procs[j] = procs[j], procs[idx]
        for i, p in enumerate(procs, start=1):  # renumber: seq gaps and ties become a clean 1..n
            p.seq = i
        db.commit()
    return _testing_record(db, wi)


@router.delete("/controls/{scf_id}/assurance/procedures/{procedure_id}")
def delete_procedure(
    scf_id: str,
    procedure_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_testing_edit),
):
    """Remove a step. Files and samples that referenced it stay, on the control."""
    tenant_id, _, wi = _control_work_item(db, current_user, scf_id)
    p = _procedure(db, wi, procedure_id)
    db.query(ControlWorkEvidence).filter(ControlWorkEvidence.test_procedure_id == p.id) \
        .update({ControlWorkEvidence.test_procedure_id: None}, synchronize_session=False)
    db.query(ControlWorkSample).filter(ControlWorkSample.procedure_id == p.id) \
        .update({ControlWorkSample.procedure_id: None}, synchronize_session=False)
    _audit(db, current_user, tenant_id, scf_id, "procedure_delete", f"Deleted test procedure {p.seq} from {scf_id}",
           resource_id=p.id, before={"description": p.description})
    db.delete(p)
    db.commit()
    return _testing_record(db, wi)


# ── tests and samples ───────────────────────────────────────────────────────
class StartTestBody(BaseModel):
    test_type: str = Field(..., pattern="^(design|operating)$")
    frequency: Optional[str] = None
    population_size: Optional[int] = Field(None, ge=0, le=1_000_000)
    #: Item references (ticket ids, usernames…). Takes precedence over population_size.
    population_items: Optional[List[str]] = Field(None, max_length=20_000)
    population_description: Optional[str] = Field(None, max_length=2000)
    period_start: Optional[datetime] = None
    period_end: Optional[datetime] = None
    selection_method: str = Field("random", pattern="^(random|systematic|all|judgmental)$")
    #: Override the recommended size; the recommendation is recorded either way.
    sample_size: Optional[int] = Field(None, ge=1, le=1000)
    tolerable_exceptions: int = Field(0, ge=0, le=100)


@router.post("/controls/{scf_id}/assurance/tests")
def start_test(
    scf_id: str,
    body: StartTestBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_testing_edit),
):
    """Open a test and select its sample.

    A design test is a walkthrough of one instance. An operating test draws its
    sample from the population by the chosen method, sized by how often the
    control operates, and records the seed so the selection can be re-performed.
    """
    tenant_id, _, wi = _control_work_item(db, current_user, scf_id)
    if body.frequency is not None and body.frequency not in FREQUENCY_LABELS:
        raise HTTPException(status_code=422, detail=f"frequency must be one of {sorted(FREQUENCY_LABELS)}")
    if body.period_start and body.period_end and body.period_end < body.period_start:
        raise HTTPException(status_code=422, detail="The test period ends before it starts.")

    population = population_items(body.population_items, body.population_size)
    method = body.selection_method
    if body.test_type == "design":
        size = body.sample_size or 1
        if not population:
            population = ["Walkthrough"]
            method = "all"
    else:
        if not population and method != "judgmental":
            raise HTTPException(
                status_code=422,
                detail="Give the population size or its items so a sample can be selected from it.",
            )
        recommended, _why = recommended_sample_size(body.frequency, bool(wi.is_key_control), len(population) or None)
        size = body.sample_size or recommended
        if not size:
            raise HTTPException(status_code=422, detail="Set how often the control operates, or give a sample size.")

    seed = random.SystemRandom().randint(1, 2_147_483_647) if method in ("random", "systematic") else None
    picks = select_sample(population, size, method, seed)
    now = datetime.utcnow()
    t = ControlWorkTest(
        work_item_id=wi.id, tenant_id=tenant_id, test_type=body.test_type, test_date=now,
        test_period_start=body.period_start, test_period_end=body.period_end,
        tester_id=getattr(current_user, "id", None), status="in_progress", result="pending",
        frequency=body.frequency, population_size=len(population) if body.population_items or body.population_size else None,
        population_description=body.population_description, selection_method=method,
        sample_seed=seed, tolerable_exceptions=body.tolerable_exceptions, sample_size=len(picks),
        exceptions_found=0,
    )
    db.add(t)
    db.flush()
    for i, ref in enumerate(picks, start=1):
        db.add(ControlWorkSample(tenant_id=tenant_id, work_item_id=wi.id, test_id=t.id, seq=i, item_ref=ref))
    if wi.implementation_status in (None, "not_started"):
        wi.implementation_status = "in_progress"
    _audit(db, current_user, tenant_id, scf_id, "test_start",
           f"Started {'an' if body.test_type == 'operating' else 'a'} {body.test_type} test on {scf_id} "
           f"with {len(picks)} sample{'s' if len(picks) != 1 else ''}",
           resource_id=t.id, after=_test_snapshot(t))
    db.commit()
    return _testing_record(db, wi)


class SampleBody(BaseModel):
    item_ref: Optional[str] = Field(None, max_length=255)
    #: pass | exception | not_applicable; empty string clears.
    result: Optional[str] = None
    note: Optional[str] = Field(None, max_length=4000)
    procedure_id: Optional[int] = None
    evidence_id: Optional[int] = None


@router.patch("/controls/{scf_id}/assurance/samples/{sample_id}")
def record_sample(
    scf_id: str,
    sample_id: int,
    body: SampleBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_testing_edit),
):
    tenant_id, _, wi = _control_work_item(db, current_user, scf_id)
    s = (db.query(ControlWorkSample)
         .filter(ControlWorkSample.id == sample_id, ControlWorkSample.work_item_id == wi.id).first())
    if s is None:
        raise HTTPException(status_code=404, detail="Sample not found on this control")
    t = _test(db, wi, s.test_id)
    _unlocked(t)
    if t.status != "in_progress":
        raise HTTPException(status_code=409, detail="This test is concluded. Reopen it to change a sample.")

    if body.item_ref is not None:
        s.item_ref = body.item_ref.strip() or None
    if body.note is not None:
        s.note = body.note.strip() or None
    if body.procedure_id is not None:
        s.procedure_id = _procedure(db, wi, body.procedure_id).id if body.procedure_id else None
    if body.evidence_id is not None:
        if body.evidence_id:
            ev = db.query(Evidence).filter(Evidence.id == body.evidence_id, Evidence.tenant_id == tenant_id).first()
            if ev is None:
                raise HTTPException(status_code=404, detail="Evidence not found for this tenant")
        s.evidence_id = body.evidence_id or None
    if body.result is not None:
        if body.result == "":
            s.result, s.tested_by, s.tested_at = None, None, None
        elif body.result not in STEP_RESULTS:
            raise HTTPException(status_code=422, detail=f"result must be one of {sorted(STEP_RESULTS)}")
        else:
            if body.result == "exception" and not (s.note or "").strip():
                raise HTTPException(status_code=422, detail="Describe the exception before recording it.")
            s.result, s.tested_by, s.tested_at = body.result, getattr(current_user, "id", None), datetime.utcnow()
    if body.result is not None:
        _audit(db, current_user, tenant_id, scf_id, "sample_record",
               f"Recorded sample {s.seq} of the {t.test_type} test on {scf_id}: {body.result or 'cleared'}",
               resource_id=s.id, after={"result": s.result, "note": s.note})
    db.commit()
    return _testing_record(db, wi)


class ConcludeBody(BaseModel):
    #: Omit to accept the rating the samples support.
    result: Optional[str] = None
    conclusion_rationale: Optional[str] = Field(None, max_length=4000)
    findings: Optional[str] = Field(None, max_length=8000)
    recommendations: Optional[str] = Field(None, max_length=8000)
    management_response: Optional[str] = Field(None, max_length=8000)


@router.post("/controls/{scf_id}/assurance/tests/{test_id}/conclude")
def conclude_test(
    scf_id: str,
    test_id: int,
    body: ConcludeBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_testing_edit),
):
    """The tester's conclusion. A departure from what the samples show needs a reason."""
    tenant_id, _, wi = _control_work_item(db, current_user, scf_id)
    t = _test(db, wi, test_id)
    _unlocked(t)
    before = _test_snapshot(t)
    results = [r for (r,) in db.query(ControlWorkSample.result).filter(ControlWorkSample.test_id == t.id).all()]
    suggested = suggested_result(results, t.tolerable_exceptions or 0)
    if suggested is None:
        raise HTTPException(status_code=422, detail="Record a result for every sample before concluding.")
    final = body.result or suggested
    if final not in TEST_RESULTS:
        raise HTTPException(status_code=422, detail=f"result must be one of {sorted(TEST_RESULTS)}")
    rationale = (body.conclusion_rationale or "").strip()
    if final != suggested and not rationale:
        raise HTTPException(
            status_code=422,
            detail=f"The samples support '{suggested}'. Explain why you are concluding '{final}' instead.",
        )
    tested, exceptions = count_exceptions(results)
    t.result, t.status = final, "completed"
    t.sample_size, t.exceptions_found = tested, exceptions
    t.conclusion_rationale = rationale or None
    for field in ("findings", "recommendations", "management_response"):
        value = getattr(body, field)
        if value is not None:
            setattr(t, field, value.strip() or None)
    wb_resync_effectiveness(db, wi)
    _audit(db, current_user, tenant_id, scf_id, "test_conclude",
           f"Concluded the {t.test_type} test on {scf_id}: {final.replace('_', ' ')}",
           resource_id=t.id, before=before, after=_test_snapshot(t))
    db.commit()
    return _testing_record(db, wi)


@router.post("/controls/{scf_id}/assurance/tests/{test_id}/reopen")
def reopen_test(
    scf_id: str,
    test_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_testing_edit),
):
    tenant_id, _, wi = _control_work_item(db, current_user, scf_id)
    t = _test(db, wi, test_id)
    _unlocked(t)
    before = _test_snapshot(t)
    t.status, t.result = "in_progress", "pending"
    wb_resync_effectiveness(db, wi)
    _audit(db, current_user, tenant_id, scf_id, "test_reopen", f"Reopened the {t.test_type} test on {scf_id}",
           resource_id=t.id, before=before, after=_test_snapshot(t))
    db.commit()
    return _testing_record(db, wi)


@router.post("/controls/{scf_id}/assurance/tests/{test_id}/review")
def sign_off_test(
    scf_id: str,
    test_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_testing_approve),
):
    """Reviewer sign-off: locks the test and updates the control's assurance status.

    Signing off your own test is allowed and completes it, but is recorded as not
    independent — it never makes a control satisfactory (testing_rules.
    control_designation), so the Assurance page and the SoA only show a pass
    that someone other than the tester has reviewed.
    """
    tenant_id, _, wi = _control_work_item(db, current_user, scf_id)
    t = _test(db, wi, test_id)
    _unlocked(t)
    if t.status != "completed":
        raise HTTPException(status_code=409, detail="Record or conclude the test before signing it off.")
    reviewer_id = getattr(current_user, "id", None)
    now = datetime.utcnow()
    t.reviewer_id, t.reviewed_at, t.locked_at, t.status = reviewer_id, now, now, "reviewed"
    t.independent_review = bool(reviewer_id and reviewer_id != t.tester_id)
    wb_resync_effectiveness(db, wi)

    latest = {}
    for ttype in ("design", "operating"):
        latest[ttype] = (db.query(ControlWorkTest)
                         .filter(ControlWorkTest.work_item_id == wi.id, ControlWorkTest.test_type == ttype,
                                 ControlWorkTest.status == "reviewed")
                         .order_by(ControlWorkTest.reviewed_at.desc()).first())
    reviewed = [x for x in latest.values() if x is not None]
    designation = control_designation(
        latest["design"].result if latest["design"] else None,
        latest["operating"].result if latest["operating"] else None,
        independent=all(x.independent_review for x in reviewed),
    )

    scope = ensure_default_scope(db, tenant_id)
    state = ensure_state(db, tenant_id, scope.id, scf_id)
    previous_designation = state.designation
    state.designation, state.designation_source, state.last_assessed_at = designation, "test", now
    state.linked_evidence_ids = sorted({
        m.evidence_id for m, e in db.query(EvidenceControlMapping, Evidence)
        .join(Evidence, Evidence.id == EvidenceControlMapping.evidence_id)
        .filter(EvidenceControlMapping.normalized_control_id == wi.source_id,
                Evidence.tenant_id == tenant_id, Evidence.status == "approved").all()
    })
    _audit(db, current_user, tenant_id, scf_id, "test_sign_off",
           f"Signed off the {t.test_type} test on {scf_id} ({(t.result or '').replace('_', ' ')}"
           f"{'' if t.independent_review else ', self-reviewed'}); assurance status {designation.replace('_', ' ')}",
           resource_id=t.id, before={"designation": previous_designation},
           after={"designation": designation, "independent_review": t.independent_review})
    db.commit()
    return {"designation": designation, **_testing_record(db, wi)}


@router.delete("/controls/{scf_id}/assurance/tests/{test_id}")
def delete_test(
    scf_id: str,
    test_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_testing_edit),
):
    """Discard a test that was never signed off."""
    tenant_id, _, wi = _control_work_item(db, current_user, scf_id)
    t = _test(db, wi, test_id)
    _unlocked(t)
    _audit(db, current_user, tenant_id, scf_id, "test_delete", f"Deleted the {t.test_type} test on {scf_id}",
           resource_id=t.id, before=_test_snapshot(t))
    db.query(ControlWorkSample).filter(ControlWorkSample.test_id == t.id).delete(synchronize_session=False)
    db.delete(t)
    db.flush()
    wb_resync_effectiveness(db, wi)
    db.commit()
    return _testing_record(db, wi)

# ── capability maturity ─────────────────────────────────────────────────────
class MaturityBody(BaseModel):
    #: SCF's SCR-CMM scale: 0 Not Performed … 5 Continuously Improving.
    cmm_actual: Optional[int] = Field(None, ge=0, le=5)
    cmm_target: Optional[int] = Field(None, ge=0, le=5)


@router.patch("/controls/{scf_id}/maturity")
def set_control_maturity(
    scf_id: str,
    body: MaturityBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_testing_edit),
):
    """Record the level this control operates at and the level it should reach.

    A rating is a person's judgement, so only the fields sent change; send null
    to clear one. The target falls back to the scope's default when unset.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    _nc_or_404(db, scf_id, tenant_id)
    scope = ensure_default_scope(db, tenant_id)
    state = ensure_state(db, tenant_id, scope.id, scf_id)
    before = {f: getattr(state, f) for f in body.model_fields_set}
    for field in body.model_fields_set:
        setattr(state, field, getattr(body, field))
    after = {f: getattr(state, f) for f in body.model_fields_set}
    if before != after:
        _audit(db, current_user, tenant_id, scf_id, "maturity_update",
               f"Set {scf_id}'s maturity: " + ", ".join(f"{k.replace('cmm_', '')} {v if v is not None else 'cleared'}"
                                                         for k, v in after.items()),
               resource_type="control_maturity", resource_id=state.id, before=before, after=after)
    db.commit()
    return {
        "scf_id": scf_id,
        "cmm_actual": state.cmm_actual,
        "cmm_target": state.cmm_target,
        "cmm_target_default": scope.target_cmm if scope.target_cmm is not None else 3,
    }


# ═════════════════════════════════════════════════════════════════════════════
# The Controls catalog's testing actions, on SCF controls
# ═════════════════════════════════════════════════════════════════════════════
IMPLEMENTATION_STATUSES = {"not_started", "in_progress", "implemented", "verified", "not_applicable"}
PRIORITIES = {"low", "medium", "high", "critical"}
#: Retest cadences the catalog offers; each schedules the next test.
RETEST_CADENCES = {"monthly", "quarterly", "semi_annually", "annually"}


class DetailsBody(BaseModel):
    priority: Optional[str] = None
    implementation_status: Optional[str] = None
    is_key_control: Optional[bool] = None
    #: Retest cadence. Empty string clears it.
    frequency: Optional[str] = None


@router.patch("/controls/{scf_id}/assurance/details")
def update_testing_details(
    scf_id: str,
    body: DetailsBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_testing_edit),
):
    """Priority, progress, key-control flag and retest cadence: the catalog's Details tab."""
    tenant_id, _, wi = _control_work_item(db, current_user, scf_id)
    if body.priority is not None and body.priority not in PRIORITIES:
        raise HTTPException(status_code=422, detail=f"priority must be one of {sorted(PRIORITIES)}")
    if body.implementation_status is not None and body.implementation_status not in IMPLEMENTATION_STATUSES:
        raise HTTPException(status_code=422, detail=f"implementation_status must be one of {sorted(IMPLEMENTATION_STATUSES)}")
    if body.frequency and body.frequency not in RETEST_CADENCES:
        raise HTTPException(status_code=422, detail=f"frequency must be one of {sorted(RETEST_CADENCES)}")
    fields = ("priority", "implementation_status", "is_key_control", "frequency")
    before = {f: getattr(wi, f) for f in fields}
    for f in body.model_fields_set & set(fields):
        value = getattr(body, f)
        setattr(wi, f, (value or None) if f == "frequency" else value)
    after = {f: getattr(wi, f) for f in fields}
    changed = {f: after[f] for f in fields if before[f] != after[f]}
    if changed:
        _audit(db, current_user, tenant_id, scf_id, "testing_details_update",
               f"Updated {scf_id}'s " + ", ".join({"is_key_control": "key control", "frequency": "retest cadence",
                                                   "implementation_status": "progress"}.get(k, k) for k in changed),
               resource_type="control_testing", resource_id=wi.id,
               before={k: before[k] for k in changed}, after=changed)
    db.commit()
    return {"work_item": _serialize_item(db, wi), **_testing_record(db, wi)}


class RecordTestBody(BaseModel):
    test_type: str = Field(..., pattern="^(design|operating)$")
    result: str = Field(..., pattern="^(effective|partially_effective|ineffective)$")
    sample_size: Optional[int] = Field(None, ge=0, le=1_000_000)
    exceptions_found: int = Field(0, ge=0, le=1_000_000)
    findings: Optional[str] = Field(None, max_length=8000)
    #: Retest cadence; schedules the next test. Empty string: no schedule.
    frequency: Optional[str] = None


def _schedule_next_test(db: Session, tenant_id: int, scf_id: str, wi: ControlWorkItem, cadence: Optional[str],
                        now: datetime) -> None:
    """The catalog's schedule: the cadence sets when the control is next tested,
    and the SCF views read the same date as the control's next due date."""
    if cadence:
        wi.frequency = cadence
    days = _FREQ_DAYS.get((cadence or wi.frequency or "").lower())
    if days:
        wi.next_test_date = now + timedelta(days=days)
        scope = ensure_default_scope(db, tenant_id)
        ensure_state(db, tenant_id, scope.id, scf_id).next_due_at = wi.next_test_date


@router.post("/controls/{scf_id}/assurance/tests/record")
def record_test(
    scf_id: str,
    body: RecordTestBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_testing_edit),
):
    """Record a test the way the Controls catalog does: type, result, sample size,
    exceptions and findings, rolled up onto design or operating effectiveness,
    with the retest cadence scheduling the next one."""
    tenant_id, _, wi = _control_work_item(db, current_user, scf_id)
    if body.frequency and body.frequency not in RETEST_CADENCES:
        raise HTTPException(status_code=422, detail=f"frequency must be one of {sorted(RETEST_CADENCES)}")
    if body.sample_size is not None and body.exceptions_found > body.sample_size:
        raise HTTPException(status_code=422, detail="Exceptions can't exceed the sample size.")
    now = datetime.utcnow()
    t = ControlWorkTest(
        work_item_id=wi.id, tenant_id=tenant_id, test_type=body.test_type, test_date=now,
        tester_id=getattr(current_user, "id", None), sample_size=body.sample_size,
        exceptions_found=body.exceptions_found, result=body.result,
        findings=(body.findings or "").strip() or None, status="completed",
        frequency=body.frequency or None,
    )
    db.add(t)
    db.flush()
    wb_resync_effectiveness(db, wi)
    _schedule_next_test(db, tenant_id, scf_id, wi, body.frequency, now)
    _audit(db, current_user, tenant_id, scf_id, "test_record",
           f"Recorded {'an' if body.test_type == 'operating' else 'a'} {body.test_type} test on {scf_id}: "
           f"{body.result.replace('_', ' ')}"
           + (f", {body.exceptions_found} exception{'s' if body.exceptions_found != 1 else ''}" if body.exceptions_found else ""),
           resource_id=t.id, after=_test_snapshot(t))
    db.commit()
    return {"work_item": _serialize_item(db, wi), **_testing_record(db, wi)}


class EditTestBody(BaseModel):
    test_type: Optional[str] = Field(None, pattern="^(design|operating)$")
    result: Optional[str] = Field(None, pattern="^(effective|partially_effective|ineffective)$")
    sample_size: Optional[int] = Field(None, ge=0, le=1_000_000)
    exceptions_found: Optional[int] = Field(None, ge=0, le=1_000_000)
    findings: Optional[str] = Field(None, max_length=8000)


@router.patch("/controls/{scf_id}/assurance/tests/{test_id}")
def edit_test(
    scf_id: str,
    test_id: int,
    body: EditTestBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_testing_edit),
):
    """Correct a recorded test. A signed-off test is the audit record and stays as it was."""
    tenant_id, _, wi = _control_work_item(db, current_user, scf_id)
    t = _test(db, wi, test_id)
    _unlocked(t)
    if t.status == "in_progress":
        raise HTTPException(status_code=409, detail="This test is still being sampled; conclude it instead.")
    before = _test_snapshot(t)
    for f in body.model_fields_set:
        value = getattr(body, f)
        if value is None and f in ("test_type", "result"):
            continue
        setattr(t, f, (value.strip() or None) if f == "findings" and isinstance(value, str) else value)
    if t.sample_size is not None and (t.exceptions_found or 0) > t.sample_size:
        raise HTTPException(status_code=422, detail="Exceptions can't exceed the sample size.")
    wb_resync_effectiveness(db, wi)
    after = _test_snapshot(t)
    if before != after:
        _audit(db, current_user, tenant_id, scf_id, "test_update", f"Edited the {t.test_type} test on {scf_id}",
               resource_id=t.id, before=before, after=after)
    db.commit()
    return {"work_item": _serialize_item(db, wi), **_testing_record(db, wi)}


@router.get("/assurance/tests")
def list_control_tests(
    limit: int = Query(5000, ge=1, le=20000),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Every recorded design and operating test on the tenant's common controls, newest first.

    The Reports module's Control Tests dataset: who tested what, the result,
    the sample, and whether it was independently signed off.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    ensure_tables(db)
    rows = (
        db.query(ControlWorkTest, ControlWorkItem, NormalizedControl.scf_id)
        .join(ControlWorkItem, ControlWorkItem.id == ControlWorkTest.work_item_id)
        .join(NormalizedControl, NormalizedControl.id == ControlWorkItem.source_id)
        .filter(ControlWorkItem.tenant_id == tenant_id, ControlWorkItem.source_type == "normalized",
                NormalizedControl.scf_id.isnot(None))
        .order_by(ControlWorkTest.test_date.desc(), ControlWorkTest.id.desc())
        .limit(limit)
        .all()
    )
    names = _users(db, [t.tester_id for t, _, _ in rows] + [t.reviewer_id for t, _, _ in rows])
    return {"tests": [{
        "id": t.id, "scf_id": scf_id, "control": wi.name, "domain": wi.domain,
        "test_type": t.test_type, "status": t.status,
        "result": None if t.result == "pending" else t.result,
        "test_date": _iso(t.test_date), "tester": names.get(t.tester_id), "reviewer": names.get(t.reviewer_id),
        "reviewed_at": _iso(t.reviewed_at), "independent_review": t.independent_review, "locked": bool(t.locked_at),
        "sample_size": t.sample_size, "exceptions_found": t.exceptions_found,
        "frequency": t.frequency, "findings": t.findings,
        "is_key_control": bool(wi.is_key_control),
    } for t, wi, scf_id in rows]}
