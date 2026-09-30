"""World-Check One (LSEG) screening for TPRA — vendors + key people.

Plan: docs/thomson-reuters-integration-plan.md §6.1–6.4.

* Subjects = the vendor organisation + every key person marked for screening.
* Screening upserts provider results as matches (resolutions are preserved on
  re-screen) and enables ongoing screening for configured tiers (decision E).
* Analyst resolution (Positive / Possible / False / Unspecified) is synced back to
  the World-Check One case; failures are kept visible and retried by the sweep.
* A POSITIVE resolution creates exactly one TPRA finding per match (severity /
  domain from the mapping); a critical finding blocks the gates and suspends an
  onboarded vendor through the EXISTING engine (decision G). Re-resolving away
  from Positive closes that finding with an audit reason.
* Unresolved matches never block a gate (decision Q6).

Callers own the commit. Provider failures raise ``ProviderError`` only where the
whole operation cannot proceed; per-subject failures are recorded on the subject.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from ....models import (
    Vendor, VendorAssessment, TPRAFinding, TPRAVendorPerson, TPRAScreeningSubject,
    TPRAScreeningMatch, TRProviderConnection, TR_PROVIDER_WC1,
)
from ....integrations_tr import connections, registry
from ....integrations_tr.catalog import DEFAULT_FINDING_MAP, SIGNAL_SEVERITY
from ....integrations_tr.http import ProviderError
from ....integrations_tr.wc1 import RESOLUTION_TYPES, normalise_result, pick_option, toolkit_options
from . import service
from .monitoring_connectors import MonitoringConnector, SignalDraft

logger = logging.getLogger(__name__)

RESOLUTION_STATUSES = ("positive", "possible", "false", "unspecified")
RISK_LEVELS = ("high", "medium", "low", "unknown")
SOURCE_LABEL = "World-Check One (LSEG)"
_TOOLKIT_TTL = timedelta(hours=24)


class ScreeningError(ValueError):
    """User-correctable screening problem (surfaced as HTTP 400/409)."""


# ── connection helpers ───────────────────────────────────────────────────────

def get_wc1_connection(db: Session, tenant_id: int) -> TRProviderConnection:
    return connections.require_active(db, tenant_id, TR_PROVIDER_WC1)


def _group_id(conn: TRProviderConnection) -> str:
    gid = connections.effective_config(conn).get("group_id")
    if gid:
        return str(gid)
    if conn.mode == "simulated":
        return "sim-group-1"
    raise ScreeningError("Select a World-Check One screening group in TPRM → Settings → Data providers.")


def _vendor_tier(db: Session, vendor: Vendor) -> str:
    a = service.get_active_assessment(db, vendor)
    return ((a.inherent_tier if a else None) or vendor.tier or "medium").lower()


# ── subjects ─────────────────────────────────────────────────────────────────

def _iso3(value: Optional[str]) -> Optional[str]:
    v = (value or "").strip().upper()
    return v if len(v) == 3 and v.isalpha() else None


def org_secondary_fields(vendor: Vendor) -> List[dict]:
    locs = vendor.geographic_locations or []
    first = locs[0] if isinstance(locs, list) and locs else None
    code = _iso3(first if isinstance(first, str) else None)
    return [{"typeId": "SFCT_6", "value": code}] if code else []


def person_secondary_fields(p: TPRAVendorPerson) -> List[dict]:
    out: List[dict] = []
    if p.gender and p.gender.upper() in ("MALE", "FEMALE", "UNSPECIFIED"):
        out.append({"typeId": "SFCT_1", "value": p.gender.upper()})
    if p.date_of_birth:
        out.append({"typeId": "SFCT_2", "dateTimeValue": p.date_of_birth})
    if _iso3(p.country_location):
        out.append({"typeId": "SFCT_3", "value": _iso3(p.country_location)})
    if _iso3(p.nationality):
        out.append({"typeId": "SFCT_5", "value": _iso3(p.nationality)})
    return out


def sync_subjects(db: Session, vendor: Vendor) -> List[TPRAScreeningSubject]:
    """Ensure one subject per screened party; retire subjects of removed/excluded
    people. Returns the active subjects (org first)."""
    existing = db.query(TPRAScreeningSubject).filter(
        TPRAScreeningSubject.vendor_id == vendor.id, TPRAScreeningSubject.provider == TR_PROVIDER_WC1,
    ).all()
    by_person = {s.person_id: s for s in existing}

    def upsert(person_id, entity_type, name, fields):
        s = by_person.get(person_id)
        if s is None:
            s = TPRAScreeningSubject(tenant_id=vendor.tenant_id, vendor_id=vendor.id, person_id=person_id,
                                     provider=TR_PROVIDER_WC1, entity_type=entity_type,
                                     submitted_name=name, secondary_fields=fields, status="not_screened")
            db.add(s)
        else:
            if s.submitted_name != name or (s.secondary_fields or []) != fields:
                # Identity changed → the old case no longer describes this party.
                s.submitted_name = name
                s.secondary_fields = fields
                s.external_case_id = None
                s.status = "not_screened"
            s.deleted_at = None
        return s

    active = [upsert(None, "ORGANISATION", vendor.name, org_secondary_fields(vendor))]
    people = db.query(TPRAVendorPerson).filter(TPRAVendorPerson.vendor_id == vendor.id).all()
    keep = set()
    for p in people:
        if p.deleted_at is None and p.include_in_screening:
            keep.add(p.id)
            active.append(upsert(p.id, "INDIVIDUAL", p.full_name, person_secondary_fields(p)))
    for s in existing:
        if s.person_id is not None and s.person_id not in keep and s.deleted_at is None:
            s.deleted_at = datetime.utcnow()
    db.flush()
    return active


def _recompute_status(db: Session, subject: TPRAScreeningSubject) -> None:
    statuses = [m.resolution_status for m in db.query(TPRAScreeningMatch.resolution_status)
                .filter(TPRAScreeningMatch.subject_id == subject.id).all()]
    if "positive" in statuses:
        subject.status = "confirmed_hit"
    elif any(s in ("unresolved", "possible") for s in statuses):
        subject.status = "potential_matches"
    else:
        subject.status = "clear"


def _upsert_matches(db: Session, subject: TPRAScreeningSubject, results: List[dict],
                    simulated: bool, via: str) -> List[TPRAScreeningMatch]:
    """Insert new results; refresh provider fields of known ones (keeping the
    analyst's resolution). Returns the NEWLY created matches."""
    known = {m.external_result_id: m for m in db.query(TPRAScreeningMatch)
             .filter(TPRAScreeningMatch.subject_id == subject.id).all()}
    created: List[TPRAScreeningMatch] = []
    for raw in results or []:
        n = normalise_result(raw)
        rid = n["external_result_id"]
        if not rid:
            continue
        m = known.get(rid)
        if m is None:
            m = TPRAScreeningMatch(tenant_id=subject.tenant_id, vendor_id=subject.vendor_id,
                                   subject_id=subject.id, external_result_id=rid,
                                   resolution_status="unresolved", first_seen_via=via, simulated=simulated)
            db.add(m)
            created.append(m)
            known[rid] = m
        m.reference_id = n["reference_id"]
        m.matched_name = (n["matched_name"] or "")[:500] or None
        m.match_strength = n["match_strength"]
        m.provider_type = n["provider_type"]
        m.categories = n["categories"]
        m.countries = n["countries"]
        m.hit_class = n["hit_class"]
        m.raw = n["raw"]
    db.flush()
    return created


# ── screening ────────────────────────────────────────────────────────────────

def screen_vendor(db: Session, vendor: Vendor, *, actor_id: Optional[int] = None,
                  subject_ids: Optional[List[int]] = None, trigger: str = "manual") -> dict:
    conn = get_wc1_connection(db, vendor.tenant_id)
    client = registry.wc1_client(conn)
    group_id = _group_id(conn)
    cfg = connections.effective_config(conn)
    ongoing_tiers = {t.lower() for t in (cfg.get("ongoing_screening_tiers") or [])}
    want_ongoing = _vendor_tier(db, vendor) in ongoing_tiers

    subjects = sync_subjects(db, vendor)
    if subject_ids:
        subjects = [s for s in subjects if s.id in set(subject_ids)]
    summary = {"screened": 0, "errors": 0, "new_matches": 0, "simulated": bool(client.simulated), "subjects": []}
    any_ok = False
    last_error = None
    for s in subjects:
        try:
            res = client.screen(group_id=group_id, entity_type=s.entity_type, name=s.submitted_name,
                                secondary_fields=s.secondary_fields or [], case_system_id=s.external_case_id)
            s.external_case_id = res.get("case_system_id") or s.external_case_id
            created = _upsert_matches(db, s, res.get("results") or [], client.simulated, "screen")
            if want_ongoing and not s.ongoing_screening and s.external_case_id:
                client.set_ongoing(s.external_case_id, True)
                s.ongoing_screening = True
            s.simulated = bool(client.simulated)
            s.last_screened_at = datetime.utcnow()
            s.last_error = None
            _recompute_status(db, s)
            summary["screened"] += 1
            summary["new_matches"] += len(created)
            any_ok = True
        except (ProviderError, ValueError) as e:
            s.status = "error"
            s.last_error = str(e)[:2000]
            summary["errors"] += 1
            last_error = str(e)
            logger.warning("wc1 screening failed vendor=%s subject=%s: %s", vendor.id, s.id, e)
        summary["subjects"].append({"id": s.id, "name": s.submitted_name, "status": s.status})
    connections.record_result(conn, any_ok or not subjects, None if any_ok else last_error)
    service.write_audit(db, vendor.tenant_id, entity="screening", action="run", vendor_id=vendor.id,
                        actor_id=actor_id, to_value=SOURCE_LABEL,
                        extra={"trigger": trigger, "screened": summary["screened"], "errors": summary["errors"],
                               "new_matches": summary["new_matches"], "simulated": summary["simulated"]})
    db.flush()
    return summary


def set_ongoing(db: Session, vendor: Vendor, enabled: bool, *, actor_id: Optional[int] = None,
                subject_ids: Optional[List[int]] = None) -> int:
    conn = get_wc1_connection(db, vendor.tenant_id)
    client = registry.wc1_client(conn)
    q = db.query(TPRAScreeningSubject).filter(TPRAScreeningSubject.vendor_id == vendor.id,
                                              TPRAScreeningSubject.deleted_at.is_(None))
    changed = 0
    for s in q.all():
        if subject_ids and s.id not in set(subject_ids):
            continue
        if not s.external_case_id:
            continue  # screen first — there is no case to monitor yet
        if bool(s.ongoing_screening) != bool(enabled):
            client.set_ongoing(s.external_case_id, enabled)
            s.ongoing_screening = bool(enabled)
            changed += 1
    service.write_audit(db, vendor.tenant_id, entity="screening", action="ongoing",
                        vendor_id=vendor.id, actor_id=actor_id, to_value=str(bool(enabled)),
                        extra={"subjects_changed": changed})
    return changed


def maybe_auto_screen(db: Session, vendor: Vendor, *, actor_id: Optional[int] = None) -> Optional[dict]:
    """Decision D: screen automatically when the lifecycle enters Due Diligence
    Planning. Best-effort and fully isolated in a SAVEPOINT — any failure (even a
    failed query) is rolled back without touching the caller's transaction, so a
    lifecycle transition can never fail because of screening. Live screening is
    queued to Celery when a broker is available."""
    try:
        nested = db.begin_nested()
    except Exception:  # noqa: BLE001
        return None
    try:
        conn = connections.get_connection(db, vendor.tenant_id, TR_PROVIDER_WC1)
        if conn is None or not conn.is_active or not connections.effective_config(conn).get("auto_screen_at_dd"):
            nested.commit()
            return None
        if conn.mode == "live":
            try:
                from ....tasks.tprm import screen_vendor_task
                from ....models import Tenant
                tenant = db.query(Tenant).filter(Tenant.id == vendor.tenant_id).first()
                screen_vendor_task.delay(tenant_slug=tenant.slug, vendor_id=vendor.id, actor_id=actor_id)
                nested.commit()
                return {"queued": True}
            except Exception:  # noqa: BLE001 — no broker: fall through to inline
                logger.warning("auto-screen queue unavailable; screening inline", exc_info=True)
        out = screen_vendor(db, vendor, actor_id=actor_id, trigger="auto_dd_planning")
        nested.commit()
        return out
    except Exception:  # noqa: BLE001
        nested.rollback()
        logger.warning("auto-screen skipped for vendor %s", getattr(vendor, "id", "?"), exc_info=True)
        return None


# ── resolution ───────────────────────────────────────────────────────────────

def resolution_options(db: Session, conn: TRProviderConnection) -> Dict[str, List[dict]]:
    """The group's resolution toolkit (cached 24h on the connection)."""
    group_id = _group_id(conn)
    cache = dict(conn.cache or {})
    entry = (cache.get("wc1_toolkit") or {}).get(group_id)
    fresh = entry and entry.get("fetched_at") and \
        datetime.utcnow() - datetime.fromisoformat(entry["fetched_at"]) < _TOOLKIT_TTL
    if not fresh:
        toolkit = registry.wc1_client(conn).resolution_toolkit(group_id)
        cache = dict(conn.cache or {})  # simulated client may have written the cache
        tk = dict(cache.get("wc1_toolkit") or {})
        tk[group_id] = {"fetched_at": datetime.utcnow().isoformat(), "options": toolkit_options(toolkit)}
        cache["wc1_toolkit"] = tk
        conn.cache = cache
        entry = tk[group_id]
    return entry["options"]


def _finding_spec(conn: Optional[TRProviderConnection], hit_class: str) -> dict:
    overrides = (connections.effective_config(conn).get("finding_map") if conn else None) or {}
    spec = dict(DEFAULT_FINDING_MAP.get(hit_class) or DEFAULT_FINDING_MAP["other"])
    spec.update(overrides.get(hit_class) or {})
    return spec


def _ensure_finding(db: Session, vendor: Vendor, match: TPRAScreeningMatch, subject: TPRAScreeningSubject,
                    conn: Optional[TRProviderConnection], actor_id: Optional[int]) -> TPRAFinding:
    if match.linked_finding_id:
        f = db.query(TPRAFinding).filter(TPRAFinding.id == match.linked_finding_id).first()
        if f is not None and f.deleted_at is None and f.status not in ("closed",):
            return f
    spec = _finding_spec(conn, match.hit_class)
    assessment = service.ensure_active_assessment(db, vendor, actor_id)
    party = "vendor" if subject.person_id is None else f"key person {subject.submitted_name}"
    label = match.hit_class.replace("_", " ")
    f = TPRAFinding(
        tenant_id=vendor.tenant_id, vendor_id=vendor.id, assessment_id=assessment.id,
        domain=spec["domain"], severity=spec["severity"],
        title=f"Confirmed {label} screening match — {party}"[:255],
        description=(
            f"{SOURCE_LABEL} match confirmed POSITIVE by an analyst.\n"
            f"Screened: {subject.submitted_name}\nMatched: {match.matched_name or '—'}\n"
            f"Categories: {', '.join(match.categories or []) or '—'}\n"
            f"Strength: {match.match_strength or '—'} · Countries: {', '.join(match.countries or []) or '—'}\n"
            f"Remark: {match.remark or '—'}"
            + ("\n[SIMULATED screening data — not a real World-Check result]" if match.simulated else "")
        ),
        status="open", created_by=actor_id,
        is_critical_control_fail=(spec["severity"] == "critical"),
    )
    db.add(f)
    db.flush()
    match.linked_finding_id = f.id
    service.write_audit(db, vendor.tenant_id, entity="finding", action="create", vendor_id=vendor.id,
                        assessment_id=assessment.id, entity_id=f.id, actor_id=actor_id, to_value=f.title,
                        extra={"source": "screening", "match_id": match.id})
    service.ensure_finding_issue(db, f, actor_id)
    if f.severity == "critical":
        service.enforce_critical_invariant(db, vendor, assessment, actor_id)
    return f


def _close_linked_finding(db: Session, vendor: Vendor, match: TPRAScreeningMatch, actor_id: Optional[int],
                          new_status: str) -> None:
    if not match.linked_finding_id:
        return
    f = db.query(TPRAFinding).filter(TPRAFinding.id == match.linked_finding_id).first()
    if f is None or f.status == "closed":
        return
    prev = f.status
    f.status = "closed"
    f.row_version = (f.row_version or 1) + 1
    reason = f"Screening match re-resolved as {new_status.upper()} — the confirmed hit no longer stands."
    service.write_audit(db, vendor.tenant_id, entity="finding", action="update", vendor_id=vendor.id,
                        assessment_id=f.assessment_id, entity_id=f.id, actor_id=actor_id,
                        from_value=prev, to_value="closed", reason=reason,
                        extra={"source": "screening", "match_id": match.id})
    service.close_finding_issue(db, f, actor_id, reason=reason)
    service.snapshot_after_finding_change(db, f)
    assessment = db.query(VendorAssessment).filter(VendorAssessment.id == f.assessment_id).first()
    if assessment is not None:
        service.enforce_critical_invariant(db, vendor, assessment, actor_id)


def sync_resolution(db: Session, match: TPRAScreeningMatch, conn: Optional[TRProviderConnection] = None) -> bool:
    """Push the analyst's decision to the World-Check One case. Never raises;
    records ``sync_status`` / ``sync_error``."""
    if match.resolution_status == "unresolved":
        match.sync_status = "not_required"
        return True
    subject = db.query(TPRAScreeningSubject).filter(TPRAScreeningSubject.id == match.subject_id).first()
    try:
        conn = conn or get_wc1_connection(db, match.tenant_id)
        if not subject or not subject.external_case_id:
            raise ScreeningError("The screening case is missing — re-screen the subject first.")
        opts = resolution_options(db, conn)
        status_id = pick_option(opts["statuses"], RESOLUTION_TYPES[match.resolution_status])
        if not status_id:
            raise ScreeningError(f"The group's resolution toolkit has no {match.resolution_status} status.")
        risk_id = pick_option(opts["risks"], (match.risk_level or "").upper()) if match.risk_level else None
        reason_id = pick_option(opts["reasons"], None, match.reason) if match.reason else None
        registry.wc1_client(conn).resolve(subject.external_case_id, [match.external_result_id],
                                          status_id=status_id, risk_id=risk_id, reason_id=reason_id,
                                          remark=match.remark)
        match.sync_status = "synced"
        match.sync_error = None
        return True
    except (ProviderError, ValueError, LookupError) as e:
        match.sync_status = "failed"
        match.sync_error = str(e)[:2000]
        logger.warning("wc1 resolution sync failed match=%s: %s", match.id, e)
        return False


def resolve_match(db: Session, match: TPRAScreeningMatch, *, status: str, actor_id: Optional[int],
                  risk_level: Optional[str] = None, reason: Optional[str] = None,
                  remark: Optional[str] = None) -> dict:
    status = (status or "").lower()
    if status not in RESOLUTION_STATUSES:
        raise ScreeningError(f"status must be one of {', '.join(RESOLUTION_STATUSES)}")
    if risk_level and risk_level.lower() not in RISK_LEVELS:
        raise ScreeningError(f"risk_level must be one of {', '.join(RISK_LEVELS)}")
    if status in ("positive", "false") and not (remark or "").strip():
        raise ScreeningError("A remark is required when marking a match Positive or False.")
    vendor = db.query(Vendor).filter(Vendor.id == match.vendor_id).first()
    subject = db.query(TPRAScreeningSubject).filter(TPRAScreeningSubject.id == match.subject_id).first()
    prev = match.resolution_status
    match.resolution_status = status
    match.risk_level = risk_level.lower() if risk_level else None
    match.reason = (reason or None) and reason[:120]
    match.remark = (remark or "").strip() or None
    match.resolved_by = actor_id
    match.resolved_at = datetime.utcnow()
    match.row_version = (match.row_version or 1) + 1
    match.sync_status = "pending"
    service.write_audit(db, match.tenant_id, entity="screening_match", action="resolve", vendor_id=match.vendor_id,
                        entity_id=match.id, actor_id=actor_id, from_value=prev, to_value=status,
                        reason=match.remark, extra={"hit_class": match.hit_class, "risk": match.risk_level})
    conn = connections.get_connection(db, match.tenant_id, TR_PROVIDER_WC1)
    finding = None
    if status == "positive":
        finding = _ensure_finding(db, vendor, match, subject, conn, actor_id)
    elif prev == "positive":
        _close_linked_finding(db, vendor, match, actor_id, status)
    synced = sync_resolution(db, match, conn if conn is not None and conn.is_active else None)
    if subject is not None:
        _recompute_status(db, subject)
    db.flush()
    return {"match": match, "finding_id": finding.id if finding else None, "synced": synced}


def retry_failed_syncs(db: Session, tenant_id: int, limit: int = 200) -> int:
    rows = db.query(TPRAScreeningMatch).filter(
        TPRAScreeningMatch.tenant_id == tenant_id, TPRAScreeningMatch.sync_status.in_(("failed", "pending")),
    ).limit(limit).all()
    return sum(1 for m in rows if sync_resolution(db, m))


# ── ongoing screening → monitoring signals (Phase 2) ─────────────────────────

_SIGNAL_TYPE = {"sanctions": "sanctions", "pep": "pep", "law_enforcement": "law_enforcement",
                "adverse_media": "adverse_media", "other": "watchlist"}
_ONGOING_LOOKBACK = timedelta(days=7)


def _signal_severity(m: TPRAScreeningMatch) -> str:
    sev = SIGNAL_SEVERITY.get(m.hit_class, "low")
    if m.hit_class == "adverse_media" and (m.match_strength or "") in ("STRONG", "EXACT"):
        sev = "high"
    return sev


def poll_ongoing(db: Session, tenant_id: int) -> List[SignalDraft]:
    """Pull ongoing-screening updates since the stored cursor, upsert the new
    matches (first_seen_via='ongoing') and return one signal draft per NEW match.
    Also retries resolution syncs that failed earlier. Provider failures are
    recorded on the connection and yield no drafts (the sweep carries on)."""
    conn = connections.get_connection(db, tenant_id, TR_PROVIDER_WC1)
    if conn is None or not conn.is_active:
        return []
    client = registry.wc1_client(conn)
    started = datetime.utcnow().replace(microsecond=0)
    cursor = (conn.cache or {}).get("wc1_ongoing_cursor") or \
        (started - _ONGOING_LOOKBACK).isoformat() + "Z"
    drafts: List[SignalDraft] = []
    try:
        case_ids = client.ongoing_updates(cursor)
        for cid in case_ids:
            subjects = db.query(TPRAScreeningSubject).filter(
                TPRAScreeningSubject.tenant_id == tenant_id, TPRAScreeningSubject.external_case_id == cid,
                TPRAScreeningSubject.deleted_at.is_(None),
            ).all()
            if not subjects:
                continue
            results = client.get_results(cid)
            for s in subjects:
                created = _upsert_matches(db, s, results, client.simulated, "ongoing")
                s.last_screened_at = datetime.utcnow()
                _recompute_status(db, s)
                for m in created:
                    label = m.hit_class.replace("_", " ")
                    drafts.append(SignalDraft(
                        vendor_id=s.vendor_id, signal_type=_SIGNAL_TYPE.get(m.hit_class, "watchlist"),
                        severity=_signal_severity(m),
                        title=f"New {SOURCE_LABEL} {label} match — {s.submitted_name}"[:255],
                        detail=(f"Ongoing screening matched '{m.matched_name or '—'}' "
                                f"({m.match_strength or 'unknown strength'}; "
                                f"{', '.join(m.categories or []) or 'no categories'}). "
                                f"Resolve it in the vendor's Screening tab."),
                        source=SOURCE_LABEL, external_id=f"wc1:{cid}:{m.external_result_id}",
                        source_ref={"match_id": m.id, "subject_id": s.id}, simulated=bool(client.simulated),
                        occurred_at=datetime.utcnow(),
                    ))
        retry_failed_syncs(db, tenant_id)
    except (ProviderError, ValueError) as e:
        connections.record_result(conn, False, f"Ongoing screening poll failed: {e}")
        logger.warning("wc1 ongoing poll failed tenant=%s: %s", tenant_id, e)
        return []
    cache = dict(conn.cache or {})
    cache["wc1_ongoing_cursor"] = started.isoformat() + "Z"
    conn.cache = cache
    connections.record_result(conn, True)
    db.flush()
    return drafts


class WorldCheckOneConnector(MonitoringConnector):
    """Registered in monitoring_connectors.CONNECTORS; polled every 6h by the
    existing ``poll_monitoring_connectors_sweep`` beat task."""

    provider = TR_PROVIDER_WC1
    requires_credentials = True

    def is_configured(self, db: Optional[Session] = None, tenant_id: Optional[int] = None) -> bool:
        if db is None or tenant_id is None:
            return False
        conn = connections.get_connection(db, tenant_id, TR_PROVIDER_WC1)
        return bool(conn is not None and conn.is_active)

    def poll(self, db: Session, tenant_id: int) -> List[SignalDraft]:
        return poll_ongoing(db, tenant_id)
