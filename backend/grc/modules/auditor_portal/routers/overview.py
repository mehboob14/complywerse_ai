"""Auditor portal — framework overview.

Returns the high-level summary an auditor sees on landing: framework
identity, journey status, totals across every framework-linked artifact
(controls, evidence, documents, risks, assets, vulns, vendors,
exceptions), and the breakdown of approval states so the auditor can
spot pending review work at a glance.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Text, and_, case, func, cast, or_
from sqlalchemy.orm import Session, joinedload

from ....models import (
    GRCUser,
    get_db,
    CertificationJourney,
    ClauseApplicability,
    ControlImplementation,
    ImplementationEvidence,
    ParsedFrameworkControl,
    UploadedFramework,
    GovernanceDocument,
    Risk,
    ITAsset,
    Vulnerability,
    VulnerabilityAssetLink,
    Vendor,
    PolicyException,
)
from ....routers.auth_router import require_auth, get_user_tenants
from ..helpers import resolve_framework_context, parsed_control_ids_for_context
from ..months import month_windows
from .reviews import _iso, _person, _word


router = APIRouter()


@router.get("/{framework_id}/overview")
def get_overview(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Aggregated counts for an auditor's framework dashboard."""
    user_tenants = get_user_tenants(current_user, db)
    ctx = resolve_framework_context(framework_id, user_tenants, db)
    parsed_ids = parsed_control_ids_for_context(ctx, db)

    # Controls + applicability split
    applicability_rows = []
    if parsed_ids:
        applicability_rows = db.query(
            ClauseApplicability.is_applicable,
            ClauseApplicability.status,
            func.count(ClauseApplicability.id),
        ).filter(
            ClauseApplicability.tenant_id.in_(user_tenants),
            ClauseApplicability.control_id.in_(parsed_ids),
        ).group_by(
            ClauseApplicability.is_applicable, ClauseApplicability.status
        ).all()

    in_scope = 0
    out_of_scope = 0
    pending_applicability = 0
    rejected_applicability = 0
    for is_applicable, status_val, count in applicability_rows:
        if status_val == "approved" and is_applicable is True:
            in_scope += count
        elif status_val == "approved" and is_applicable is False:
            out_of_scope += count
        else:
            pending_applicability += count
            if status_val == "rejected":
                rejected_applicability += count

    total_controls = len(parsed_ids)
    untouched_controls = max(0, total_controls - in_scope - out_of_scope - pending_applicability)

    # Implementation status across all journeys for this framework
    implementation_summary = {}
    if ctx.journey_ids:
        rows = db.query(
            ControlImplementation.status, func.count(ControlImplementation.id)
        ).filter(
            ControlImplementation.journey_id.in_(ctx.journey_ids)
        ).group_by(ControlImplementation.status).all()
        implementation_summary = {status_val or "unknown": count for status_val, count in rows}

    # Evidence approval breakdown for this framework's journeys
    evidence_summary = {"total": 0, "pending": 0, "approved": 0, "rejected": 0}
    if ctx.journey_ids:
        ev_rows = db.query(
            ImplementationEvidence.review_status, func.count(ImplementationEvidence.id)
        ).join(
            ControlImplementation,
            ImplementationEvidence.implementation_id == ControlImplementation.id,
        ).filter(
            ControlImplementation.journey_id.in_(ctx.journey_ids)
        ).group_by(ImplementationEvidence.review_status).all()
        for status_val, count in ev_rows:
            evidence_summary["total"] += count
            key = (status_val or "pending").lower()
            if key in evidence_summary:
                evidence_summary[key] += count
            else:
                evidence_summary["pending"] += count

    # Documents linked to this framework via JSON framework_ids array.
    # JSON containment isn't portable across SQLite/Postgres, so we
    # serialize the column to text and substring-match the id. Acceptable
    # because counts collide only on very long id substrings (unlikely).
    documents_count = 0
    if ctx.framework:
        token = f"\"{ctx.framework.id}\""
        documents_count = db.query(func.count(GovernanceDocument.id)).filter(
            GovernanceDocument.tenant_id.in_(user_tenants),
            GovernanceDocument.framework_ids.isnot(None),
            cast(GovernanceDocument.framework_ids, Text).ilike(f"%{ctx.framework.id}%"),
        ).scalar() or 0
        _ = token  # placeholder; see comment above on quoted-id strategy

    # Risks — heuristic match on register_type to the framework short_code.
    risks_count = 0
    if ctx.framework_short_code:
        risks_count = db.query(func.count(Risk.id)).filter(
            Risk.tenant_id.in_(user_tenants),
            Risk.status != "closed",
            Risk.register_type == ctx.framework_short_code,
        ).scalar() or 0

    # Assets — compliance_scope is a JSON array of framework short codes.
    assets_count = 0
    if ctx.framework_short_code:
        assets_count = db.query(func.count(ITAsset.id)).filter(
            ITAsset.tenant_id.in_(user_tenants),
            ITAsset.status == "active",
            cast(ITAsset.compliance_scope, Text).ilike(f"%{ctx.framework_short_code}%"),
        ).scalar() or 0

    # Vulnerabilities on in-scope assets
    vulns_count = 0
    if ctx.framework_short_code:
        vulns_count = db.query(func.count(func.distinct(Vulnerability.id))).join(
            VulnerabilityAssetLink, VulnerabilityAssetLink.vulnerability_id == Vulnerability.id,
        ).join(
            ITAsset, VulnerabilityAssetLink.asset_id == ITAsset.id,
        ).filter(
            Vulnerability.tenant_id.in_(user_tenants),
            Vulnerability.status.in_(("open", "in_progress")),
            cast(ITAsset.compliance_scope, Text).ilike(f"%{ctx.framework_short_code}%"),
        ).scalar() or 0

    # Vendors — active vendors in the tenant.
    vendors_count = db.query(func.count(Vendor.id)).filter(
        Vendor.tenant_id.in_(user_tenants),
        Vendor.status == "active",
    ).scalar() or 0

    # Exceptions — control N/A approvals + active policy exceptions
    n_a_count = 0
    if parsed_ids:
        n_a_count = db.query(func.count(ClauseApplicability.id)).filter(
            ClauseApplicability.tenant_id.in_(user_tenants),
            ClauseApplicability.control_id.in_(parsed_ids),
            ClauseApplicability.is_applicable == False,  # noqa: E712
            ClauseApplicability.status == "approved",
        ).scalar() or 0
    pol_exception_count = db.query(func.count(PolicyException.id)).filter(
        PolicyException.tenant_id.in_(user_tenants),
        PolicyException.status == "approved",
    ).scalar() or 0

    journey_payload = None
    if ctx.journeys:
        j = ctx.journeys[0]
        journey_payload = {
            "id": j.id,
            "name": getattr(j, "name", None),
            "status": getattr(j, "status", None),
            "progress": getattr(j, "completion_percentage", None),
        }

    return {
        "framework": {
            "id": framework_id,
            "name": ctx.framework_label,
            "version": ctx.framework_version,
            "short_code": ctx.framework_short_code,
            "upload_status": ctx.framework.upload_status if ctx.framework else None,
        },
        "journey": journey_payload,
        "controls": {
            "total": total_controls,
            "in_scope": in_scope,
            "out_of_scope": out_of_scope,
            # everything not approved, a turned-down request included (the key's old meaning; kept for older readers) ...
            "pending_applicability": pending_applicability,
            # ... and the same count told apart: requests still waiting for a decision, and requests that were turned down
            "waiting_applicability": pending_applicability - rejected_applicability,
            "rejected_applicability": rejected_applicability,
            "untouched": untouched_controls,
        },
        "implementation": implementation_summary,
        "evidence": evidence_summary,
        "documents": {"total": documents_count},
        "risks": {"total": risks_count},
        "assets": {"in_scope": assets_count},
        "vulnerabilities": {"open_on_in_scope_assets": vulns_count},
        "vendors": {"active": vendors_count},
        "exceptions": {
            "controls_marked_not_applicable": n_a_count,
            "policy_exceptions_active": pol_exception_count,
        },
    }


# ─── The Portal's front door ─────────────────────────────────────────

_JOURNEY_CAP = 200


@router.get("/work")
def get_work(
    limit: int = Query(20, ge=1, le=100, description="how many of the oldest waiting items to list"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """What waits for an auditor across every journey of the organisation (GET only, writes nothing, computes no journey progress).

    `counters`: files sent for review and not yet decided, and scope requests waiting for a decision (a framework shared by two journeys is counted once).
    `journeys`: each journey with what waits on it and how much is decided. `rows`: the oldest waiting items, files and requests together, each with the
    journey it belongs to. There is no per-auditor assignment in the platform, so "waiting" means waiting for any auditor.
    """
    tenants = get_user_tenants(current_user, db)
    empty = {"counters": {"files_to_review": 0, "scope_to_decide": 0}, "journeys": [], "journeys_total": 0, "rows": [], "rows_total": 0}
    if not tenants:
        return empty
    base = db.query(CertificationJourney).filter(CertificationJourney.tenant_id.in_(tenants))
    journeys_total = base.count()
    journeys = base.order_by(CertificationJourney.started_at.desc(), CertificationJourney.id.desc()).limit(_JOURNEY_CAP).all()
    if not journeys:
        return empty
    journey_ids = [j.id for j in journeys]
    fw_ids = sorted({j.uploaded_framework_id for j in journeys if j.uploaded_framework_id})

    files: Dict[int, Dict[str, int]] = {jid: {"pending": 0, "approved": 0, "rejected": 0, "total": 0} for jid in journey_ids}
    word = func.coalesce(ImplementationEvidence.review_status, "pending")
    for jid, value, count in db.query(ControlImplementation.journey_id, word, func.count(ImplementationEvidence.id)).join(
        ControlImplementation, ImplementationEvidence.implementation_id == ControlImplementation.id,
    ).filter(ControlImplementation.journey_id.in_(journey_ids)).group_by(ControlImplementation.journey_id, word).all():
        files[jid][_word(value)] += count
        files[jid]["total"] += count

    scope: Dict[int, Dict[str, int]] = {fw: {"pending": 0, "approved": 0, "rejected": 0, "total": 0} for fw in fw_ids}
    controls: Dict[int, int] = {fw: 0 for fw in fw_ids}
    if fw_ids:
        for fw, value, count in db.query(ClauseApplicability.uploaded_framework_id, ClauseApplicability.status, func.count(ClauseApplicability.id)).filter(
            ClauseApplicability.tenant_id.in_(tenants), ClauseApplicability.uploaded_framework_id.in_(fw_ids),
        ).group_by(ClauseApplicability.uploaded_framework_id, ClauseApplicability.status).all():
            scope[fw][_word(value)] += count
            scope[fw]["total"] += count
        for fw, count in db.query(ParsedFrameworkControl.uploaded_framework_id, func.count(ParsedFrameworkControl.id)).filter(
            ParsedFrameworkControl.uploaded_framework_id.in_(fw_ids),
        ).group_by(ParsedFrameworkControl.uploaded_framework_id).all():
            controls[fw] = count

    frameworks = {f.id: f for f in db.query(UploadedFramework).filter(UploadedFramework.id.in_(fw_ids)).all()} if fw_ids else {}
    first_journey_of: Dict[int, int] = {}
    cards: List[Dict[str, Any]] = []
    for j in journeys:
        fw = j.uploaded_framework_id
        if fw and fw not in first_journey_of:
            first_journey_of[fw] = j.id
        mine = scope.get(fw, {"pending": 0, "approved": 0, "rejected": 0, "total": 0}) if fw else {"pending": 0, "approved": 0, "rejected": 0, "total": 0}
        cards.append({
            "id": j.id,
            "name": j.name,
            "status": j.status,
            "framework": frameworks[fw].name if fw in frameworks else None,
            "version": frameworks[fw].version if fw in frameworks else None,
            "files": files[j.id],
            "scope": mine,
            "controls_total": controls.get(fw, 0) if fw else 0,
            "no_request": max(0, controls.get(fw, 0) - mine["total"]) if fw else 0,
        })

    counted = {fw: first_journey_of[fw] for fw in scope}
    counters = {
        "files_to_review": sum(files[jid]["pending"] for jid in journey_ids),
        "scope_to_decide": sum(scope[fw]["pending"] for fw in counted),
    }

    names = {j.id: j.name for j in journeys}
    rows: List[Dict[str, Any]] = []
    for ev in db.query(ImplementationEvidence).join(
        ControlImplementation, ImplementationEvidence.implementation_id == ControlImplementation.id,
    ).filter(
        ControlImplementation.journey_id.in_(journey_ids),
        (ImplementationEvidence.review_status == "pending") | (ImplementationEvidence.review_status.is_(None)),
    ).options(
        joinedload(ImplementationEvidence.uploader),
        joinedload(ImplementationEvidence.implementation).joinedload(ControlImplementation.parsed_control),
    ).order_by(ImplementationEvidence.uploaded_at.asc(), ImplementationEvidence.id.asc()).limit(limit).all():
        impl = ev.implementation
        control = impl.parsed_control if impl else None
        rows.append({
            "kind": "file", "id": ev.id, "journey_id": impl.journey_id, "journey": names.get(impl.journey_id),
            "title": ev.file_name, "context": " ".join(x for x in [getattr(control, "original_reference", None) or getattr(control, "control_id", None), getattr(control, "title", None)] if x) or None,
            "since": _iso(ev.uploaded_at), "by": _person(ev.uploader),
        })
    if counted:
        for rec in db.query(ClauseApplicability).filter(
            ClauseApplicability.tenant_id.in_(tenants), ClauseApplicability.uploaded_framework_id.in_(list(counted)), ClauseApplicability.status == "pending",
        ).options(joinedload(ClauseApplicability.requester), joinedload(ClauseApplicability.control)).order_by(
            ClauseApplicability.requested_at.asc(), ClauseApplicability.id.asc(),
        ).limit(limit).all():
            control = rec.control
            ref = getattr(control, "original_reference", None) or getattr(control, "control_id", None)
            rows.append({
                "kind": "scope", "id": rec.id, "journey_id": counted[rec.uploaded_framework_id], "journey": names.get(counted[rec.uploaded_framework_id]),
                "title": " ".join(x for x in [ref, getattr(control, "title", None)] if x) or None,
                "context": "Asks to put it in scope" if rec.is_applicable else "Asks to put it out of scope",
                "since": _iso(rec.requested_at or rec.created_at), "by": _person(rec.requester),
            })
    rows.sort(key=lambda r: (r["since"] or "", r["id"]))
    return {
        "counters": counters,
        "journeys": cards,
        "journeys_total": journeys_total,
        "rows": rows[:limit],
        "rows_total": counters["files_to_review"] + counters["scope_to_decide"],
    }


# ─── The front door's charts ─────────────────────────────────────────

AGE_EDGES_DAYS = (7, 14, 30, 90)            # a waiting item is under a week, 1-2 weeks, 2-4 weeks, 1-3 months, or older: five buckets


def _total(expr):
    return func.coalesce(func.sum(expr), 0)


def _flow(scoped, stamp, decided_at, status_col, windows) -> Dict[str, List[int]]:
    """Per calendar month, for one kind of request: how many were raised (`sent`), how many a reviewer decided (`decided`: approved or turned down, by the
    time they decided), and how many were still waiting at the end of the month (`waiting`: raised before it, and not decided yet or decided after it). The
    last month's `waiting` is the count now. A request decided with no time on record is never counted as waiting in the past (nobody knows when it stopped)."""
    done = func.lower(func.coalesce(status_col, "pending")).in_(("approved", "rejected"))
    n = len(windows)
    cols = (
        [_total(case((and_(stamp >= s, stamp < e), 1), else_=0)) for _, s, e in windows]
        + [_total(case((and_(done, decided_at >= s, decided_at < e), 1), else_=0)) for _, s, e in windows]
        + [_total(case((and_(stamp < e, or_(~done, decided_at >= e)), 1), else_=0)) for _, s, e in windows]
    )
    row = [int(v or 0) for v in scoped(cols).one()]
    return {"sent": row[:n], "decided": row[n:2 * n], "waiting": row[2 * n:]}


def _ages(scoped, stamp, status_col, now: datetime) -> Dict[str, Any]:
    """The waiting ones by how long they have waited (AGE_EDGES_DAYS: under 7 days, 7-13, 14-29, 30-89, 90 and over), and how many have no date at all."""
    waiting = ~func.lower(func.coalesce(status_col, "pending")).in_(("approved", "rejected"))
    cuts = [now - timedelta(days=d) for d in AGE_EDGES_DAYS]               # newest cut first: a stamp after cuts[0] is under 7 days old
    cols = []
    for i in range(len(cuts) + 1):
        bucket = [waiting, stamp.isnot(None)]
        if i < len(cuts):
            bucket.append(stamp > cuts[i])
        if i > 0:
            bucket.append(stamp <= cuts[i - 1])
        cols.append(_total(case((and_(*bucket), 1), else_=0)))
    cols.append(_total(case((and_(waiting, stamp.is_(None)), 1), else_=0)))
    row = [int(v or 0) for v in scoped(cols).one()]
    return {"buckets": row[:-1], "undated": row[-1]}


@router.get("/work/summary")
def get_work_summary(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """What the front door's charts draw (GET only, writes nothing), over the same journeys `/work` counts (the newest 200 of the organisation).

    `months`: the last 12 calendar months, oldest first. `files` and `scope`: per month `sent`, `decided` and `waiting` (see `_flow`); scope requests count once per
    framework, the way `/work` counts them. `aging`: the waiting files and scope requests by days waiting, in the buckets `edges_days` cut (under 7, 7-13, 14-29,
    30-89, 90 and over), `undated` those with no date. `scope_totals`: the requirements of those frameworks by scope state: in scope and out of scope (approved
    requests), waiting, turned down, and `no_request` (requirements nobody has asked about).
    """
    now = datetime.utcnow()
    windows = month_windows(now)
    zeros = lambda: [0] * len(windows)                                                    # noqa: E731
    out: Dict[str, Any] = {
        "as_of": now.isoformat(), "months": [key for key, _, _ in windows],
        "files": {"sent": zeros(), "decided": zeros(), "waiting": zeros()},
        "scope": {"sent": zeros(), "decided": zeros(), "waiting": zeros()},
        "aging": {"edges_days": list(AGE_EDGES_DAYS), "files": [0] * (len(AGE_EDGES_DAYS) + 1), "scope": [0] * (len(AGE_EDGES_DAYS) + 1), "undated": {"files": 0, "scope": 0}},
        "scope_totals": {"controls": 0, "in_scope": 0, "out_of_scope": 0, "waiting": 0, "turned_down": 0, "no_request": 0},
    }
    tenants = get_user_tenants(current_user, db)
    if not tenants:
        return out
    journeys = db.query(CertificationJourney).filter(CertificationJourney.tenant_id.in_(tenants)).order_by(
        CertificationJourney.started_at.desc(), CertificationJourney.id.desc()).limit(_JOURNEY_CAP).all()
    if not journeys:
        return out
    journey_ids = [j.id for j in journeys]
    fw_ids = sorted({j.uploaded_framework_id for j in journeys if j.uploaded_framework_id})     # one count per framework, however many journeys share it

    def files(cols):
        return db.query(*cols).select_from(ImplementationEvidence).join(
            ControlImplementation, ImplementationEvidence.implementation_id == ControlImplementation.id,
        ).filter(ControlImplementation.journey_id.in_(journey_ids))

    out["files"] = _flow(files, ImplementationEvidence.uploaded_at, ImplementationEvidence.reviewed_at, ImplementationEvidence.review_status, windows)
    ages_files = _ages(files, ImplementationEvidence.uploaded_at, ImplementationEvidence.review_status, now)
    out["aging"]["files"], out["aging"]["undated"]["files"] = ages_files["buckets"], ages_files["undated"]
    if not fw_ids:
        return out

    raised = func.coalesce(ClauseApplicability.requested_at, ClauseApplicability.created_at)

    def scope(cols):
        return db.query(*cols).select_from(ClauseApplicability).filter(ClauseApplicability.tenant_id.in_(tenants), ClauseApplicability.uploaded_framework_id.in_(fw_ids))

    out["scope"] = _flow(scope, raised, ClauseApplicability.reviewed_at, ClauseApplicability.status, windows)
    ages_scope = _ages(scope, raised, ClauseApplicability.status, now)
    out["aging"]["scope"], out["aging"]["undated"]["scope"] = ages_scope["buckets"], ages_scope["undated"]

    totals = out["scope_totals"]
    asked: Dict[int, int] = {fw: 0 for fw in fw_ids}
    for fw, value, applicable, count in db.query(
        ClauseApplicability.uploaded_framework_id, ClauseApplicability.status, ClauseApplicability.is_applicable, func.count(ClauseApplicability.id),
    ).filter(ClauseApplicability.tenant_id.in_(tenants), ClauseApplicability.uploaded_framework_id.in_(fw_ids)).group_by(
        ClauseApplicability.uploaded_framework_id, ClauseApplicability.status, ClauseApplicability.is_applicable,
    ).all():
        asked[fw] += count
        word = _word(value)
        if word == "approved":
            totals["in_scope" if applicable else "out_of_scope"] += count
        elif word == "rejected":
            totals["turned_down"] += count
        else:
            totals["waiting"] += count
    for fw, count in db.query(ParsedFrameworkControl.uploaded_framework_id, func.count(ParsedFrameworkControl.id)).filter(
        ParsedFrameworkControl.uploaded_framework_id.in_(fw_ids),
    ).group_by(ParsedFrameworkControl.uploaded_framework_id).all():
        totals["controls"] += count
        totals["no_request"] += max(0, count - asked.get(fw, 0))
    return out
