"""Scoped sessions — reuse the one-time master baseline instead of re-running AI.

The owner runs the master-list pipeline ONCE to build the baseline (all
frameworks classified onto a fixed master list). After that, when a user picks a
subset of frameworks we do NOT re-run AI: we FILTER the baseline to those
frameworks. AI only runs for a brand-new framework the baseline never saw, and
even then only that framework's own controls are classified onto the existing
master list (the cheap _classify_to_taxonomy step) — never a full re-cluster.

The baseline run is never mutated; each session is an isolated, deletable
NormalizationRun (scope='custom') with its own CommonControlGroup rows.
"""
from __future__ import annotations

import logging
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ....models import (
    NormalizedControl, NormalizedControlLink, CommonControlGroup,
    CommonControlGroupMapping, ParsedFrameworkControl, UploadedFramework,
    NormalizationRun,
)
from . import normalization as N

logger = logging.getLogger(__name__)


def get_baseline_run(db: Session, tenant_id: int):
    """The owner's one-time master baseline (preferred) or the newest full run."""
    q = db.query(NormalizationRun).filter(
        NormalizationRun.tenant_id == tenant_id,
        NormalizationRun.status == "completed",
    )
    base = q.filter(NormalizationRun.is_baseline.is_(True)).order_by(
        NormalizationRun.id.desc()).first()
    if base:
        return base
    return q.filter(NormalizationRun.scope == "full").order_by(
        NormalizationRun.id.desc()).first()


def get_master_list(db: Session, tenant_id: int) -> List[str]:
    """Canonical master-control names, persisted on the baseline run summary."""
    base = get_baseline_run(db, tenant_id)
    if base and isinstance(base.summary, dict):
        ml = base.summary.get("master_list")
        if isinstance(ml, list) and ml:
            return [m for m in ml if isinstance(m, str) and m.strip()]
    if base:
        return [nc.name for nc in db.query(NormalizedControl).filter(
            NormalizedControl.run_id == base.id).all()]
    return []


def build_scoped_session(
    db: Session, tenant_id: int, framework_ids: List[int], *,
    user_id: Optional[int] = None, label: Optional[str] = None,
    progress_cb: Optional[Callable] = None, should_cancel: Optional[Callable] = None,
) -> Dict[str, Any]:
    """Produce a framework-scoped unified view by FILTERING the master baseline.

    No full AI re-run. For frameworks already in the baseline this is a pure DB
    filter. For a brand-new framework only its controls are classified onto the
    existing master list. Persists an isolated NormalizationRun (scope='custom')
    with its own groups; the baseline is never touched. Returns a summary dict.
    """
    from ..routers.groups import get_openai_client

    sel = [int(f) for f in (framework_ids or [])]
    if len(sel) < 2:
        raise ValueError("Pick at least 2 frameworks to build a unified view.")
    sel_set = set(sel)
    base = get_baseline_run(db, tenant_id)
    if not base:
        raise RuntimeError("No master baseline exists yet — run the one-time baseline first.")

    if progress_cb:
        progress_cb(5, 100, "Loading master baseline…")

    base_ncs = db.query(NormalizedControl).filter(NormalizedControl.run_id == base.id).all()
    fw_name = {f.id: f.name for f in db.query(UploadedFramework).all()}

    # Baseline DOMAIN layer: the domain each control lives in, so the scoped view
    # mirrors the master library's domain grouping (not a flat control-per-group).
    base_groups = db.query(CommonControlGroup).filter(CommonControlGroup.run_id == base.id).all()
    gid_domain = {g.id: (g.domain or g.name or "Other / Uncategorized") for g in base_groups}
    base_gids = [g.id for g in base_groups]
    pid_domain: Dict[int, str] = {}
    if base_gids:
        for m in db.query(CommonControlGroupMapping).filter(
                CommonControlGroupMapping.parsed_control_id.isnot(None),
                CommonControlGroupMapping.group_id.in_(base_gids)).all():
            pid_domain.setdefault(m.parsed_control_id, gid_domain.get(m.group_id, "Other / Uncategorized"))

    # Unified-control definitions: name, domain, consolidated evidence, members.
    nc_defs: List[dict] = []
    base_fws: set = set()
    for nc in base_ncs:
        mems = []
        for ln in db.query(NormalizedControlLink).filter(
                NormalizedControlLink.normalized_control_id == nc.id).all():
            p = db.query(ParsedFrameworkControl).filter(
                ParsedFrameworkControl.id == ln.parsed_control_id).first()
            if p:
                mems.append((p.id, p.uploaded_framework_id))
                base_fws.add(p.uploaded_framework_id)
        dom = nc.domain or (pid_domain.get(mems[0][0]) if mems else None) or "Other / Uncategorized"
        nc_defs.append({"name": nc.name, "domain": dom,
                        "ev": nc.recommended_evidence, "members": mems})

    # Brand-new frameworks (selected but never seen by the baseline) → classify
    # ONLY their controls onto the existing master list. Only AI step here.
    new_fws = [f for f in sel_set if f not in base_fws]
    extra: Dict[str, List[tuple]] = {}
    if new_fws:
        if progress_cb:
            progress_cb(15, 100, f"Classifying {len(new_fws)} new framework(s) onto the master list…")
        master = [d["name"] for d in nc_defs]
        rows = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id.in_(new_fws)).all()
        members = [{"ref_id": p.id, "framework": fw_name.get(p.uploaded_framework_id, "?"),
                    "fwid": p.uploaded_framework_id, "name": (p.title or "")[:200],
                    "text": (p.description or p.full_text or "")[:300]} for p in rows]
        members = N._interleave_by_framework(members)
        client = get_openai_client()
        tags = N._classify_to_taxonomy(client, members, master,
                                       should_cancel=should_cancel, progress_cb=progress_cb)
        for m, t in zip(members, tags):
            if t:
                extra.setdefault(t, []).append((m["ref_id"], m["fwid"]))

    if progress_cb:
        progress_cb(70, 100, "Filtering baseline to the selected frameworks…")

    run = NormalizationRun(
        tenant_id=tenant_id,
        label=label or f"Session — {len(sel)} frameworks",
        scope="custom", framework_ids=sel, is_baseline=False,
        status="running", created_by=user_id, started_at=func.now(),
    )
    db.add(run); db.flush()

    # Domain groups, created on demand — same shape as the master library so the
    # scoped run shows GROUPING (every selected control, in its domain) AND
    # NORMALIZATION (the cross-framework unified ones), not just the overlaps.
    dom_group: Dict[str, int] = {}
    def group_for(domain: str) -> int:
        domain = domain or "Other / Uncategorized"
        if domain not in dom_group:
            gseq = len(dom_group) + 1
            g = CommonControlGroup(tenant_id=tenant_id, run_id=run.id,
                                   code=f"SDOM-{run.id}-{gseq:02d}", name=domain,
                                   domain=domain, category=domain, created_by=user_id)
            db.add(g); db.flush(); dom_group[domain] = g.id
        return dom_group[domain]

    seq = 0; created = 0; covered = 0; claimed: set = set()
    # 1) NORMALIZATION — keep a unified control when >=2 of its members fall inside
    #    the selected frameworks (a genuine cross-framework overlap within the pick).
    for d in nc_defs:
        if should_cancel and should_cancel():
            raise N.AutoGroupCancelled()
        all_mems = [(pid, fid) for (pid, fid) in d["members"] if fid in sel_set]
        all_mems += [(pid, fid) for (pid, fid) in extra.get(d["name"], []) if fid in sel_set]
        seen_pid = set(); uniq = []
        for pid, fid in all_mems:
            if pid not in seen_pid:
                seen_pid.add(pid); uniq.append((pid, fid))
        if len({fid for _, fid in uniq}) < 2:
            continue   # not cross-framework within the selection → members fall to standalone below
        gid = group_for(d["domain"])
        seq += 1
        # Do NOT copy the baseline's consolidated evidence — it spans ALL the
        # baseline's frameworks. A scoped control holds only the SELECTED
        # frameworks' members, so leave evidence empty and let it regenerate from
        # those members on first view (so it reflects only the chosen frameworks).
        nc = NormalizedControl(code=f"NCS{run.id}-{seq:04d}", name=d["name"],
                               source="ai_normalized", run_id=run.id, domain=d["domain"],
                               maturity_level=0, recommended_evidence=None)
        db.add(nc); db.flush()
        db.add(CommonControlGroupMapping(group_id=gid, normalized_control_id=nc.id,
                                         mapping_source="domain", mapping_confidence=1.0))
        for pid, _fid in uniq:
            db.add(NormalizedControlLink(normalized_control_id=nc.id,
                                         parsed_control_id=pid, mapping_type="direct"))
            db.add(CommonControlGroupMapping(group_id=gid, parsed_control_id=pid,
                                             mapping_source="domain", mapping_confidence=1.0))
            claimed.add(pid); covered += 1
        created += 1

    # 2) GROUPING — every other control from the selected frameworks shows up as a
    #    standalone under its domain, so the run lists ALL their controls.
    standalone = 0
    sel_controls = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id.in_(list(sel_set))).all()
    for p in sel_controls:
        if p.id in claimed:
            continue
        gid = group_for(pid_domain.get(p.id, "Other / Uncategorized"))
        db.add(CommonControlGroupMapping(group_id=gid, parsed_control_id=p.id,
                                         mapping_source="standalone", mapping_confidence=1.0))
        standalone += 1; covered += 1

    run.status = "completed"; run.completed_at = func.now()
    run.summary = {"unified_controls": created, "standalone": standalone,
                   "controls_covered": covered, "from_baseline": base.id,
                   "new_frameworks_classified": new_fws}
    db.commit()
    if progress_cb:
        progress_cb(100, 100,
                    f"Ready: {created} unified + {standalone} standalone across {len(sel)} frameworks.")
    return {"run_id": run.id, "unified_controls": created, "standalone": standalone,
            "controls_covered": covered, "new_frameworks_classified": new_fws,
            "ai_used": bool(new_fws)}
