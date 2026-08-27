"""P5 — the review flow around ai_control_mapping: generate proposals for a
scope/tenant, then human accept / reject. Suggest-only by construction: the
ONLY paths that write a VulnerabilityControlLink are `accept_proposal` and the
reuse of a HUMAN's earlier accept on the same (CWE, control) pair. Never
commits — the router owns the transaction.

REASON ONCE, APPLY MANY (L4 of CTEM_VALIDATE_REASONING_PLAN):
  * weakness key = the finding's CWE id. Findings collapse ~10:1 on it.
  * before calling the model for a finding, look at what humans already
    decided for that key: ACCEPTED (key, control) pairs are applied to this
    finding as accepted proposals (provenance "reused", decided_by = the
    original approver) and linked; REJECTED pairs are never re-proposed.
  * the model is called only for findings whose key has NO human decision yet.
  So a bank with 10k findings on ~100 CWEs makes ~100 model calls, and a
  reviewer's decision propagates deterministically instead of being re-asked.
"""

import logging
import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .ai_control_mapping import suggest_controls, PROMPT_VERSION

logger = logging.getLogger(__name__)

# Every AI-created link (human-accept, gate-auto, reused, or a group-family
# edition) carries one of these note prefixes — the load-bearing marker that lets
# Reject unwind ONLY AI links and never a human's manual assertion.
_LINK_NOTE_PREFIXES = ("ai_suggested:", "ai_reused:", "ai_auto:", "ai_family:")

# The confidence gate: a suggestion at or above the tenant's floor is linked by the
# run itself (provenance model, note "ai_auto:"), reversibly; a weaker one waits as
# `proposed`. Floor is configurable via AI_AUTOLINK_MIN_CONFIDENCE.
_CONF_RANK = {"high": 2, "medium": 1, "low": 0}
_FLOOR_RANK = {"off": 99, "none": 99, "high": 2, "medium": 1, "low": 0}


def _meets_gate(confidence: Optional[str]) -> bool:
    from ..config import get_ai_autolink_min_confidence
    floor = _FLOOR_RANK.get(get_ai_autolink_min_confidence(), 1)
    return _CONF_RANK.get((confidence or "low").lower(), 0) >= floor


def _ref_kwargs(kind: str, control_id: int) -> Dict[str, Any]:
    """The FK kwargs for a control ref, for both AiControlProposal and VulnerabilityControlLink."""
    if kind == "parsed_framework_control":
        return {"parsed_framework_control_id": control_id, "normalized_control_id": None}
    return {"normalized_control_id": control_id, "parsed_framework_control_id": None}


def _gate_autolink(db, proposal, kind: str, control_id: int, actor_id: Optional[int]) -> None:
    """Link a `proposed` model suggestion that clears the confidence gate: create
    the VulnerabilityControlLink (note "ai_auto:") if absent, flip the proposal to
    accepted with the gate as the decider. Idempotent, reversible (Reject unwinds).
    A group pick fans out to its original framework controls."""
    from ..models import VulnerabilityControlLink
    link = _link_for(db, proposal.vulnerability_id, kind, control_id)
    if link is None:
        link = VulnerabilityControlLink(
            vulnerability_id=proposal.vulnerability_id, compliance_impact="at_risk",
            notes=f"ai_auto:{proposal.prompt_version} · {proposal.confidence} · {proposal.reason or ''}"[:500],
            created_by=actor_id, **_ref_kwargs(kind, control_id))
        db.add(link); db.flush()
    proposal.status = "accepted"
    proposal.provenance = "model"
    proposal.decided_by = actor_id
    proposal.decided_at = datetime.utcnow()
    proposal.decision_note = f"auto-linked by confidence gate ({proposal.confidence} ≥ floor)"
    proposal.control_link_id = link.id
    _fan_out_editions(db, proposal, actor_id)


def _fan_out_editions(db, proposal, actor_id: Optional[int]) -> int:
    """The owner's group rule: linking a library control links its WHOLE group —
    every original framework control it wraps (PCI x.x, CIS x.x, …), for the
    active, tenant-visible frameworks. Each family row is tagged
    `ai_family:p<proposal_id>` so one Reject unwinds exactly this family.
    Standalone picks wrap one original — that single original still links, so
    the framework's own page lights up. Never raises (sqlite fixtures may lack
    the group tables)."""
    if proposal.normalized_control_id is None:
        return 0                                  # a raw-control pick has no family
    try:
        from sqlalchemy import or_
        from ..models import (NormalizedControlLink, ParsedFrameworkControl,
                              UploadedFramework, VulnerabilityControlLink)
        rows = db.query(NormalizedControlLink.parsed_control_id).join(
            ParsedFrameworkControl, ParsedFrameworkControl.id == NormalizedControlLink.parsed_control_id
        ).join(UploadedFramework, UploadedFramework.id == ParsedFrameworkControl.uploaded_framework_id
        ).filter(NormalizedControlLink.normalized_control_id == proposal.normalized_control_id,
                 NormalizedControlLink.parsed_control_id.isnot(None),
                 UploadedFramework.is_active == True,  # noqa: E712
                 or_(UploadedFramework.tenant_id == proposal.tenant_id,
                     UploadedFramework.is_shared == True)).all()  # noqa: E712
        made = 0
        for (pid,) in rows:
            if _link_for(db, proposal.vulnerability_id, "parsed_framework_control", pid) is not None:
                continue                          # never duplicate a (finding, control) pair
            db.add(VulnerabilityControlLink(
                vulnerability_id=proposal.vulnerability_id,
                parsed_framework_control_id=pid, compliance_impact="at_risk",
                notes=f"ai_family:p{proposal.id} · original framework control of the linked group"[:500],
                created_by=actor_id))
            made += 1
        if made:
            db.flush()
        return made
    except Exception:
        logger.exception("edition fan-out failed (non-fatal) for proposal %s", getattr(proposal, "id", "?"))
        return 0


def _has_sticker(db, vulnerability_id: int) -> bool:
    """The owner's re-run rule: a finding with ANY stored answer — a proposal row
    of any status, or any control link — is settled. Mapping never re-runs on it
    (zero AI cost) unless the caller explicitly forces."""
    from ..models import AiControlProposal, VulnerabilityControlLink
    if db.query(AiControlProposal.id).filter(
            AiControlProposal.vulnerability_id == vulnerability_id).first() is not None:
        return True
    return db.query(VulnerabilityControlLink.id).filter(
        VulnerabilityControlLink.vulnerability_id == vulnerability_id).first() is not None


# ── the explicit "no specific control" answer (deliverable #1) ────────────────
# A marker proposal — both control refs null, status "no_control" — is the
# persisted answer for a finding that WAS analysed and got no specific control.
# `bucket` says which honest kind: "patch_only" (an open CVE — the fix is to
# patch, tracked by the vuln-management programme) or "no_specific" (a weakness
# with nothing in the tenant's library that addresses it). list_proposals skips
# null-control rows, so a marker never shows up as a bogus control suggestion.
def _marker_for(db, vulnerability_id: int):
    from ..models import AiControlProposal
    return db.query(AiControlProposal).filter(
        AiControlProposal.vulnerability_id == vulnerability_id,
        AiControlProposal.normalized_control_id.is_(None),
        AiControlProposal.parsed_framework_control_id.is_(None),
        AiControlProposal.status == "no_control").first()


def _has_real_proposal(db, vulnerability_id: int) -> bool:
    """True when the finding already carries a real control proposal that is live
    (proposed or accepted) — so we don't stamp "no control" over an actual one."""
    from ..models import AiControlProposal
    from sqlalchemy import or_
    return db.query(AiControlProposal.id).filter(
        AiControlProposal.vulnerability_id == vulnerability_id,
        AiControlProposal.status.in_(("proposed", "accepted")),
        or_(AiControlProposal.normalized_control_id.isnot(None),
            AiControlProposal.parsed_framework_control_id.isnot(None))).first() is not None


def _upsert_no_control_marker(db, tenant_id: int, vuln, res: Dict[str, Any], run_id: str) -> None:
    has_cve = bool((getattr(vuln, "cve_id", None) or "").strip())
    reason = res.get("no_specific_control_reason") or "analysed — no specific control in your library addresses this weakness"
    if has_cve:
        bucket = "patch_only"
    elif re.search(r"inventor|informational", reason, re.I):
        # The MODEL judged it a pure inventory note the cheap title classifier let
        # through — record that verdict so the pipeline counts it informational,
        # not as an unaddressed weakness. (A CVE-bearing finding is never inventory.)
        bucket = "inventory"
    else:
        bucket = "no_specific"
    row = _marker_for(db, vuln.id)
    if row is None:
        from ..models import AiControlProposal
        db.add(AiControlProposal(
            tenant_id=tenant_id, vulnerability_id=vuln.id, confidence="low", reason=reason,
            driven_by=res.get("bucket"), prompt_version=PROMPT_VERSION, bucket=bucket,
            status="no_control", provenance="model", run_id=run_id,
            prompt_inputs=res.get("prompt"), raw_output=res.get("raw_output")))
    else:
        row.reason, row.bucket, row.run_id, row.prompt_version = reason, bucket, run_id, PROMPT_VERSION
        row.prompt_inputs, row.raw_output = res.get("prompt"), res.get("raw_output")


def _clear_no_control_marker(db, vulnerability_id: int) -> None:
    row = _marker_for(db, vulnerability_id)
    if row is not None:
        db.delete(row)


def _decided_pairs_for_key(db, tenant_id: int, cwe_id: str) -> Tuple[Dict[Tuple[str, int], Any], set]:
    """Human decisions on this weakness key across ALL findings:
    accepted → {(kind, control_id): proposal_row}, rejected → {(kind, control_id)}."""
    from ..models import AiControlProposal, Vulnerability
    rows = db.query(AiControlProposal).join(Vulnerability, Vulnerability.id == AiControlProposal.vulnerability_id
                                            ).filter(AiControlProposal.tenant_id == tenant_id,
                                                     Vulnerability.cwe_id == cwe_id,
                                                     AiControlProposal.status.in_(("accepted", "rejected"))).all()
    accepted: Dict[Tuple[str, int], Any] = {}
    rejected: set = set()
    for p in rows:
        key = p.control_ref
        if p.status == "accepted":
            accepted.setdefault(key, p)   # first approver wins as the provenance source
        else:
            rejected.add(key)
    return accepted, rejected


def _link_for(db, vulnerability_id: int, kind: str, control_id: int):
    from ..models import VulnerabilityControlLink
    col = getattr(VulnerabilityControlLink, "parsed_framework_control_id" if kind == "parsed_framework_control"
                  else "normalized_control_id")
    return db.query(VulnerabilityControlLink).filter(
        VulnerabilityControlLink.vulnerability_id == vulnerability_id, col == control_id).first()


def generate_proposals(db: Session, tenant_id: int, *, vulnerability_ids: Optional[List[int]] = None,
                       ctem_scope_id: Optional[int] = None, triggered_by: Optional[int] = None,
                       client=None, model: Optional[str] = None, limit: int = 500,
                       force: bool = False) -> Dict[str, Any]:
    """Run the context mapper over the tenant's (or a scope's) findings and
    persist every answer. The owner's re-run rule: a finding with ANY stored
    answer is SKIPPED (zero AI cost) — cycle 2..n only pays for new findings.
    `force=True` re-maps stickered findings too (library/prompt upgrades), but a
    human decision is still never overridden. No regex anywhere: every
    unanswered finding goes to the AI, which itself says "pure inventory note"
    where true. Reused human decisions are applied without a model call."""
    from ..models import (Vulnerability, ITAsset, VulnerabilityAssetLink, VulnerabilityControlLink,
                          AiControlProposal, AiControlProposalRun)

    run_id = uuid.uuid4().hex[:24]
    run = AiControlProposalRun(tenant_id=tenant_id, run_id=run_id, prompt_version=PROMPT_VERSION,
                               ctem_scope_id=ctem_scope_id, triggered_by=triggered_by)
    db.add(run)
    # Commit the run row NOW so a poller sees "running" (started_at set,
    # finished_at null) while the model calls proceed.
    db.commit()

    q = db.query(Vulnerability).filter(Vulnerability.tenant_id == tenant_id)
    if vulnerability_ids is not None:
        if not vulnerability_ids:
            run.finished_at = datetime.utcnow()
            return _summary(run)
        q = q.filter(Vulnerability.id.in_(vulnerability_ids))
    # Dangerous first: the prioritised findings' answers land in the first minutes
    # of the run, so the operator sees the ones that matter covered earliest.
    scoped = q.order_by(Vulnerability.composite_priority.desc().nullslast(),
                        Vulnerability.id).limit(limit).all()
    # ── the honest funnel, split UP FRONT so the progress display can tell it:
    #    "<in scope> → <already answered, skipped> → <to analyse this run>".
    #    findings_total = what THIS run will analyse (the bar's denominator);
    #    findings_inventory carries the skip count (column repurposed — the old
    #    regex-inventory count is always 0 under the context design).
    findings = [v for v in scoped if force or not _has_sticker(db, v.id)]
    skipped_existing = len(scoped) - len(findings)
    run.findings_total = len(findings)
    run.findings_inventory = skipped_existing
    db.commit()                                   # poller sees the funnel immediately

    # one primary asset per finding for asset_context (first linked asset)
    asset_for: Dict[int, Any] = {}
    if findings:
        links = db.query(VulnerabilityAssetLink.vulnerability_id, VulnerabilityAssetLink.asset_id).filter(
            VulnerabilityAssetLink.vulnerability_id.in_([f.id for f in findings])).all()
        first_asset = {}
        for vid, aid in links:
            first_asset.setdefault(vid, aid)
        assets = {a.id: a for a in db.query(ITAsset).filter(ITAsset.id.in_(set(first_asset.values()))).all()} if first_asset else {}
        asset_for = {vid: assets.get(aid) for vid, aid in first_asset.items()}

    decided_cache: Dict[str, Tuple[Dict, set]] = {}
    reused = 0
    try:
        for v in findings:
            # ── reason once, apply many: human decisions on this CWE come first ──
            cwe = (getattr(v, "cwe_id", None) or "").strip()
            accepted, rejected = ({}, set())
            if cwe:
                if cwe not in decided_cache:
                    decided_cache[cwe] = _decided_pairs_for_key(db, tenant_id, cwe)
                accepted, rejected = decided_cache[cwe]
                for (kind, cid), src in accepted.items():
                    existing = db.query(AiControlProposal).filter(
                        AiControlProposal.vulnerability_id == v.id).filter_by(**_ref_kwargs(kind, cid)).first()
                    if existing is not None:
                        continue                                   # already proposed/decided for THIS finding
                    link = _link_for(db, v.id, kind, cid)
                    if link is None:
                        link = VulnerabilityControlLink(
                            vulnerability_id=v.id, compliance_impact="at_risk",
                            notes=f"ai_reused:{cwe} · from proposal {src.id} · {src.reason or ''}"[:500],
                            created_by=src.decided_by, **_ref_kwargs(kind, cid))
                        db.add(link); db.flush()
                    p_reused = AiControlProposal(
                        tenant_id=tenant_id, vulnerability_id=v.id, confidence=src.confidence, reason=src.reason,
                        driven_by=src.driven_by, prompt_version=src.prompt_version, bucket=src.bucket,
                        status="accepted", provenance="reused", decided_by=src.decided_by,
                        decided_at=datetime.utcnow(), decision_note=f"reused human decision on {cwe} (proposal {src.id})",
                        control_link_id=link.id, run_id=run_id, **_ref_kwargs(kind, cid))
                    db.add(p_reused); db.flush()
                    _fan_out_editions(db, p_reused, src.decided_by)   # a reused group decision links its family too
                    reused += 1
                if accepted or rejected:
                    # the key has been reviewed by a human — do NOT re-ask the model for it.
                    # (New candidates for a decided key arrive on a prompt/corpus version bump.)
                    run.findings_reused = (run.findings_reused or 0) + 1
                    continue

            run.findings_sent += 1
            res = suggest_controls(db, v, asset=asset_for.get(v.id), client=client, model=model)
            if res.get("error"):
                run.model_errors += 1
                continue
            try:
                # SAVEPOINT: two runs racing on the same finding must cost us ONE
                # finding's work, never the whole run. The winner's committed answer
                # stands; this run just moves on (the sticker rule covers it).
                with db.begin_nested():
                    run.invalid_ids_dropped += len(res.get("dropped_invalid_ids") or [])
                    wrote_real = False
                    for s in res.get("suggestions") or []:
                        kind = s.get("kind", "normalized_control")
                        if (kind, s["control_id"]) in rejected:
                            continue                                       # a human said no for this CWE — never re-propose
                        wrote_real = True
                        existing = db.query(AiControlProposal).filter(
                            AiControlProposal.vulnerability_id == v.id).filter_by(**_ref_kwargs(kind, s["control_id"])).first()
                        if existing is None:
                            p = AiControlProposal(
                                tenant_id=tenant_id, vulnerability_id=v.id, confidence=s["confidence"], reason=s["reason"],
                                driven_by=s["driven_by"], prompt_version=PROMPT_VERSION, bucket=res["bucket"],
                                status="proposed", provenance="model", run_id=run_id,
                                prompt_inputs=res.get("prompt"), raw_output=res.get("raw_output"),
                                **_ref_kwargs(kind, s["control_id"]))
                            db.add(p); db.flush()
                            run.proposals_created += 1
                            if _meets_gate(s["confidence"]):        # the gate: link now, reversibly
                                _gate_autolink(db, p, kind, s["control_id"], triggered_by)
                        elif existing.status == "proposed":        # refresh, but never override a human/gate decision
                            existing.confidence, existing.reason, existing.driven_by = s["confidence"], s["reason"], s["driven_by"]
                            existing.prompt_version, existing.run_id = PROMPT_VERSION, run_id
                            existing.prompt_inputs, existing.raw_output = res.get("prompt"), res.get("raw_output")
                            run.proposals_updated += 1
                            if _meets_gate(s["confidence"]):        # a re-run that now clears the gate links it
                                _gate_autolink(db, existing, kind, s["control_id"], triggered_by)
                    # deliverable #1 — never a silent blank: a finding that was analysed and got
                    # no specific control gets an explicit, persisted answer instead of nothing.
                    if not wrote_real and not _has_real_proposal(db, v.id):
                        _upsert_no_control_marker(db, tenant_id, v, res, run_id)
                    elif wrote_real:
                        _clear_no_control_marker(db, v.id)          # it now has a control — drop any stale marker
            except IntegrityError:
                logger.warning("finding %s: lost a write race with a concurrent run — keeping the existing answer", v.id)
                skipped_existing += 1
                continue
            # persist progress every few findings so a poller sees movement and a
            # mid-run crash keeps what was already decided
            if run.findings_sent % 5 == 0:
                db.commit()
        run.proposals_reused = reused
        run.finished_at = datetime.utcnow()
        db.flush()
        # Gated loop: a finished mapping run IS Validate-stage completion for the
        # scope's open cycle — stamped here, server-side, so navigating away during
        # the background run can never lose it. Unlocks Mobilise.
        if ctem_scope_id is not None:
            try:
                from .ctem_scopes import stamp_validate_stage
                stamp_validate_stage(db, tenant_id, ctem_scope_id)
            except Exception:
                logger.exception("validate-stage stamp failed (non-fatal)")
        # skipped-existing isn't a run column (no migration); it rides the response only
        return _summary(run)
    except Exception as e:
        # never leave a zombie "running" row: close the run with the error so
        # pollers unblock; every answer committed before the crash is kept and
        # the sticker rule makes the re-run continue from it.
        logger.exception("generate_proposals crashed mid-run (%s)", run_id)
        db.rollback()
        crashed = db.query(AiControlProposalRun).filter(AiControlProposalRun.run_id == run_id).first()
        if crashed is not None:
            crashed.finished_at = datetime.utcnow()
            crashed.error = f"crashed mid-run: {type(e).__name__} — committed answers kept; a re-run continues from them"
            db.commit()
        return {**(_summary(crashed) if crashed else {"run_id": run_id, "running": False}),
                "error": f"crashed mid-run: {type(e).__name__}"}


def _summary(run) -> Dict[str, Any]:
    # findings_inventory carries the sticker-skip count (see generate_proposals);
    # exposed under both names so the funnel display and older readers agree.
    return {"run_id": run.run_id, "prompt_version": run.prompt_version,
            "findings_total": run.findings_total, "findings_inventory": run.findings_inventory,
            "findings_skipped_existing": run.findings_inventory or 0,
            "findings_in_scope": (run.findings_total or 0) + (run.findings_inventory or 0),
            "findings_sent": run.findings_sent, "findings_reused": getattr(run, "findings_reused", 0) or 0,
            "proposals_created": run.proposals_created, "proposals_updated": run.proposals_updated,
            "proposals_reused": getattr(run, "proposals_reused", 0) or 0,
            "model_errors": run.model_errors, "invalid_ids_dropped": run.invalid_ids_dropped,
            "started_at": run.started_at.isoformat() if run.started_at else None,
            "finished_at": run.finished_at.isoformat() if run.finished_at else None,
            "running": run.finished_at is None}


def accept_proposal(db: Session, tenant_id: int, proposal_id: int, *, user_id: int,
                    note: Optional[str] = None) -> Dict[str, Any]:
    """The ONE human path that turns a suggestion into a real link. Idempotent: an
    already-accepted proposal returns its existing link. Records the approver."""
    from ..models import AiControlProposal, VulnerabilityControlLink
    p = db.query(AiControlProposal).filter(AiControlProposal.id == proposal_id,
                                           AiControlProposal.tenant_id == tenant_id).first()
    if p is None:
        raise LookupError("proposal not found")
    if p.status == "accepted" and p.control_link_id:
        return {"proposal_id": p.id, "status": "accepted", "control_link_id": p.control_link_id, "created": False}
    kind, cid = p.control_ref
    link = _link_for(db, p.vulnerability_id, kind, cid)
    created = False
    if link is None:
        link = VulnerabilityControlLink(
            vulnerability_id=p.vulnerability_id, compliance_impact="at_risk",
            notes=f"ai_suggested:{p.prompt_version} · {p.confidence} · {p.reason or ''}"[:500],
            created_by=user_id, **_ref_kwargs(kind, cid))
        db.add(link)
        db.flush()
        created = True
    p.status, p.decided_by, p.decided_at, p.decision_note, p.control_link_id = "accepted", user_id, datetime.utcnow(), note, link.id
    fanned = _fan_out_editions(db, p, user_id)     # a group accept links its original framework controls
    db.flush()
    return {"proposal_id": p.id, "status": "accepted", "control_link_id": link.id, "created": created,
            "family_links_created": fanned}


def reject_proposal(db: Session, tenant_id: int, proposal_id: int, *, user_id: int,
                    note: Optional[str] = None) -> Dict[str, Any]:
    """Reject — and if it had been accepted (by a human OR by reuse), remove the
    link it created (only that link, only if it was ai-created). Never re-proposed
    for this finding, and never re-proposed for any other finding with the same CWE."""
    from ..models import AiControlProposal, VulnerabilityControlLink
    p = db.query(AiControlProposal).filter(AiControlProposal.id == proposal_id,
                                           AiControlProposal.tenant_id == tenant_id).first()
    if p is None:
        raise LookupError("proposal not found")
    unlinked = False
    if p.control_link_id:
        link = db.query(VulnerabilityControlLink).get(p.control_link_id)
        if link is not None and (link.notes or "").startswith(_LINK_NOTE_PREFIXES):
            db.delete(link)
            unlinked = True
        p.control_link_id = None
    # one Reject unwinds the WHOLE family: the group's original framework controls
    # that were fanned out from exactly this proposal (tag ai_family:p<id>).
    family_removed = 0
    for fam in db.query(VulnerabilityControlLink).filter(
            VulnerabilityControlLink.vulnerability_id == p.vulnerability_id,
            VulnerabilityControlLink.notes.like(f"ai_family:p{p.id} %")).all():
        db.delete(fam)
        family_removed += 1
    p.status, p.decided_by, p.decided_at, p.decision_note = "rejected", user_id, datetime.utcnow(), note
    db.flush()
    return {"proposal_id": p.id, "status": "rejected", "unlinked": unlinked,
            "family_links_removed": family_removed}


def list_proposals(db: Session, tenant_id: int, *, status: Optional[str] = None,
                   vulnerability_ids: Optional[List[int]] = None, run_id: Optional[str] = None,
                   limit: int = 500) -> List[Dict[str, Any]]:
    from ..models import AiControlProposal, Vulnerability, NormalizedControl, ParsedFrameworkControl, UploadedFramework
    q = db.query(AiControlProposal, Vulnerability, NormalizedControl, ParsedFrameworkControl, UploadedFramework
                 ).join(Vulnerability, Vulnerability.id == AiControlProposal.vulnerability_id
                 ).outerjoin(NormalizedControl, NormalizedControl.id == AiControlProposal.normalized_control_id
                 ).outerjoin(ParsedFrameworkControl, ParsedFrameworkControl.id == AiControlProposal.parsed_framework_control_id
                 ).outerjoin(UploadedFramework, UploadedFramework.id == ParsedFrameworkControl.uploaded_framework_id
                 ).filter(AiControlProposal.tenant_id == tenant_id)
    if status:
        q = q.filter(AiControlProposal.status == status)
    if run_id:
        q = q.filter(AiControlProposal.run_id == run_id)
    if vulnerability_ids is not None:
        if not vulnerability_ids:
            return []
        q = q.filter(AiControlProposal.vulnerability_id.in_(vulnerability_ids))
    rows = q.order_by(AiControlProposal.status.asc(), AiControlProposal.confidence.asc(),
                      AiControlProposal.vulnerability_id.asc()).limit(limit).all()
    out = []
    for p, v, c, pc, fw in rows:
        if pc is not None:
            control = {"id": pc.id, "kind": "parsed_framework_control",
                       "code": pc.original_reference or pc.control_id, "name": pc.title,
                       "domain": pc.domain, "framework": fw.name if fw else None}
        elif c is not None:
            control = {"id": c.id, "kind": "normalized_control", "code": c.code, "name": c.name,
                       "domain": c.domain, "framework": "Unified Control Library"}
        else:
            continue
        out.append({
            "id": p.id, "status": p.status, "confidence": p.confidence, "reason": p.reason,
            "driven_by": p.driven_by, "bucket": p.bucket, "prompt_version": p.prompt_version,
            "provenance": getattr(p, "provenance", "model") or "model",
            "vulnerability": {"id": v.id, "vuln_id": v.vuln_id, "title": v.title, "cve_id": v.cve_id,
                              "cwe_id": v.cwe_id, "severity": v.severity,
                              # priority = Prioritise's own definition (CVE/CWE/vector) — the
                              # panel sorts these on top and badges them
                              "priority": bool((v.cve_id or "").strip() or (v.cwe_id or "").strip()
                                               or ((getattr(v, "cvss_vector", None) or "").strip()))},
            "control": control,
            "run_id": p.run_id,
            "decided_at": p.decided_at.isoformat() if p.decided_at else None,
            "control_link_id": p.control_link_id,
        })
    # attach "satisfies": the framework editions of each group control, so the
    # review queue shows the same tags as the result table
    try:
        from ..models import NormalizedControlLink, ParsedFrameworkControl, UploadedFramework
        nc_ids = {i["control"]["id"] for i in out if i["control"]["kind"] == "normalized_control"}
        if nc_ids:
            fam: Dict[int, List[str]] = {}
            rows2 = db.query(NormalizedControlLink.normalized_control_id,
                             ParsedFrameworkControl.original_reference, ParsedFrameworkControl.control_id,
                             UploadedFramework.name).join(
                ParsedFrameworkControl, ParsedFrameworkControl.id == NormalizedControlLink.parsed_control_id).join(
                UploadedFramework, UploadedFramework.id == ParsedFrameworkControl.uploaded_framework_id).filter(
                NormalizedControlLink.normalized_control_id.in_(nc_ids),
                UploadedFramework.is_active == True).all()  # noqa: E712
            for nc, ref, cid, fw in rows2:
                fam.setdefault(nc, []).append(f"{(fw or '?')[:28]} {ref or cid or ''}".strip())
            for i in out:
                if i["control"]["kind"] == "normalized_control":
                    i["control"]["satisfies"] = fam.get(i["control"]["id"], [])[:5]
    except Exception:
        logger.exception("list_proposals: satisfies tags unavailable (non-fatal)")
    return out
