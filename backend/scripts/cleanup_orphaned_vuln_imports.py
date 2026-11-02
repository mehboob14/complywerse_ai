"""One-time cleanup: administratively close vulnerability rows orphaned by
older import paths — rows the current sync pipeline can never update again.

Two patterns, both verified in the dev tenant (2026-08-07):

  A. Superseded pre-plugin-key Nessus rows
     Rows with vuln_id 'NS-…' but external_vuln_id IS NULL were created by an
     earlier import whose row-key hash differed from the current pipeline's,
     BEFORE the scanner-native plugin id was stored. The closure engine
     deliberately skips NULL-external_vuln_id rows (absence can't be verified
     — see _apply_scanner_closures in sync_service.py), so they sit open
     forever. They are closed here ONLY when a superseding sibling exists:
     a row for the same affected_host carrying an external_vuln_id whose
     title is either identical or the known "positive" counterpart of a
     Nessus credential/patch-assessment status plugin (e.g. "…No Credentials
     Provided" superseded by "…Valid Credentials Provided"). NS- orphans
     with no superseding sibling are REPORTED but left untouched.

  B. Hostname-keyed demo rows from seed_prod_vulns.py
     backend/seed_prod_vulns.py seeded 10 real-CVE demo findings keyed by the
     primary asset's raw hostname (e.g. 'DESKTOP-CE3EFJB') with no
     connection/source/external id. The current pipeline keys hosts as
     'nessus-<sha>', so no scan will ever update or close them. Open /
     in_progress ones are closed here; already-resolved ones are left alone.
     (Full removal remains available via `python seed_prod_vulns.py cleanup`.)

What "close" means here — administrative closure, NOT scanner verification:
  * status            -> 'closed'   (in RESOLVED_STATUSES → excluded from
                                     open counts; in _SCANNER_CLOSE_PROTECTED
                                     → the closure engine never touches it)
  * closed_by         -> 'orphaned_import_cleanup'
  * closure_evidence  -> audit JSON: basis, previous_status, superseding row
                         / seed origin
  * resolution_notes  -> appended human-readable stamp
  * NEVER 'auto_closed_fixed', NEVER scanner_status='not-detected' — both
    would claim scanner-verified absence, which is false for these rows.

Rows with an active exception (is_exception, or exception_status
requested/approved) are skipped, mirroring the closure engine's protections.

Dry-run by default; nothing is written without --apply. Idempotent — closed
rows no longer match the selection filters.

Usage (from backend/):
    python -m scripts.cleanup_orphaned_vuln_imports                  # dry-run, all tenants
    python -m scripts.cleanup_orphaned_vuln_imports --tenant complyverse
    python -m scripts.cleanup_orphaned_vuln_imports --apply --tenant complyverse
"""
from dotenv import load_dotenv
load_dotenv()

import argparse
import logging
from datetime import datetime

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger(__name__)

from sqlalchemy import or_

from grc.models import SessionLocal, Tenant, Vulnerability
from grc.db import open_tenant_session

# Mirrors RESOLVED_STATUSES in modules/vuln_management/routers/dashboard.py
# (not imported — pulling a router module drags in FastAPI/auth at import time).
_TERMINAL_STATUSES = (
    "resolved", "remediated", "verified", "closed",
    "accepted", "false_positive", "auto_closed_decommissioned",
    "auto_closed_fixed",
)

# Pattern A: informational Nessus scan-quality plugins whose "negative" state
# is superseded by the "positive" counterpart once a credentialed scan of the
# same host succeeds. Identical-title siblings always count as superseding.
_SUPERSEDING_TITLES = {
    "Target Credential Status by Authentication Protocol - No Credentials Provided": (
        "Target Credential Status by Authentication Protocol - Valid Credentials Provided",
    ),
    "OS Security Patch Assessment Not Available": (
        "OS Security Patch Assessment Available",
    ),
}

# Pattern B: the frozen CVE set backend/seed_prod_vulns.py seeded as
# VULN-1001..1010. Deliberately a literal, not an import — this cleanup
# targets what the historical seed wrote, not what the script says today.
_SEED_CVES = (
    "CVE-2024-6387", "CVE-2024-3094", "CVE-2023-4911", "CVE-2021-4034",
    "CVE-2022-0847", "CVE-2023-38545", "CVE-2023-44487", "CVE-2024-10977",
    "CVE-2022-24834", "CVE-2024-2961",
)

_SCRIPT_REF = "backend/scripts/cleanup_orphaned_vuln_imports.py"


def _has_active_exception(v) -> bool:
    if getattr(v, "is_exception", False):
        return True
    return (getattr(v, "exception_status", None) or "none") in ("requested", "approved")


def _close(v, now, reason: str, extra_evidence: dict, stamp: str):
    v.closure_evidence = {
        "basis": "orphaned_import",
        "reason": reason,
        "previous_status": v.status or "open",
        "cleanup_script": _SCRIPT_REF,
        "note": "administrative closure — NOT scanner-verified absence",
        **extra_evidence,
    }
    v.status = "closed"
    v.closed_by = "orphaned_import_cleanup"
    v.closed_at = now
    v.resolved_at = now
    v.resolution_notes = f"{v.resolution_notes}\n\n{stamp}" if v.resolution_notes else stamp
    v.updated_at = now


def _cleanup_superseded_ns_rows(db, tenant_id: int, now, apply: bool):
    """Pattern A. Returns (closed, skipped_no_sibling) row summaries."""
    orphans = db.query(Vulnerability).filter(
        Vulnerability.tenant_id == tenant_id,
        Vulnerability.vuln_id.like("NS-%"),
        Vulnerability.external_vuln_id.is_(None),
        or_(Vulnerability.status.is_(None), Vulnerability.status.notin_(_TERMINAL_STATUSES)),
    ).all()

    closed, skipped = [], []
    for v in orphans:
        if _has_active_exception(v):
            skipped.append((v, "active exception"))
            continue
        titles = (v.title,) + _SUPERSEDING_TITLES.get(v.title, ())
        successor = (
            db.query(Vulnerability)
            .filter(
                Vulnerability.tenant_id == tenant_id,
                Vulnerability.id != v.id,
                Vulnerability.affected_host == v.affected_host,
                Vulnerability.external_vuln_id.isnot(None),
                Vulnerability.title.in_(titles),
            )
            .order_by(Vulnerability.discovered_at.desc().nullslast())
            .first()
        )
        if successor is None:
            skipped.append((v, "no superseding sibling with external_vuln_id"))
            continue

        stamp = (
            f"[{now.strftime('%Y-%m-%d %H:%M UTC')}] Closed by orphaned-import cleanup: "
            f"row was created by an earlier import keyed differently from the current "
            f"Nessus pipeline and has no scanner plugin id (external_vuln_id), so no "
            f"re-scan can ever verify or close it. Superseded on host "
            f"'{v.affected_host}' by {successor.vuln_id} (row {successor.id}, plugin "
            f"{successor.external_vuln_id}) '{successor.title}'. Administrative "
            f"closure — not scanner-verified absence."
        )
        if apply:
            _close(
                v, now,
                reason=(
                    "pre-plugin-key import row; NULL external_vuln_id means the "
                    "scanner closure engine can never verify absence"
                ),
                extra_evidence={
                    "superseded_by_row_id": successor.id,
                    "superseded_by_vuln_id": successor.vuln_id,
                    "superseded_by_external_vuln_id": str(successor.external_vuln_id),
                    "superseded_by_title": successor.title,
                },
                stamp=stamp,
            )
        closed.append((v, f"superseded by {successor.vuln_id} (row {successor.id})"))
    return closed, skipped


def _cleanup_seeded_demo_rows(db, tenant_id: int, now, apply: bool):
    """Pattern B. Returns (closed, skipped) row summaries."""
    rows = db.query(Vulnerability).filter(
        Vulnerability.tenant_id == tenant_id,
        Vulnerability.vuln_id.like("VULN-10%"),
        Vulnerability.cve_id.in_(_SEED_CVES),
        Vulnerability.connection_id.is_(None),
        Vulnerability.source.is_(None),
        Vulnerability.external_vuln_id.is_(None),
        Vulnerability.report_id.is_(None),
        or_(Vulnerability.status.is_(None), Vulnerability.status.notin_(_TERMINAL_STATUSES)),
    ).all()

    closed, skipped = [], []
    for v in rows:
        if _has_active_exception(v):
            skipped.append((v, "active exception"))
            continue
        stamp = (
            f"[{now.strftime('%Y-%m-%d %H:%M UTC')}] Closed by orphaned-import cleanup: "
            f"demo finding seeded by backend/seed_prod_vulns.py, keyed by raw hostname "
            f"'{v.affected_host}' with no scanner connection/plugin id — the current "
            f"pipeline keys hosts as 'nessus-<sha>' and can never update or close it. "
            f"Previous status: {v.status or 'open'}. Administrative closure — not "
            f"scanner-verified absence."
        )
        if apply:
            _close(
                v, now,
                reason=(
                    "demo row created by backend/seed_prod_vulns.py; hostname-keyed "
                    "with no scanner connection/plugin id, invisible to the current "
                    "nessus-keyed sync pipeline"
                ),
                extra_evidence={"origin": "backend/seed_prod_vulns.py"},
                stamp=stamp,
            )
        closed.append((v, "seed_prod_vulns.py demo row"))
    return closed, skipped


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--tenant", help="tenant slug; default: every tenant in the master registry")
    p.add_argument("--apply", action="store_true", help="write changes (default is dry-run)")
    args = p.parse_args()

    master = SessionLocal()
    try:
        tenants = master.query(Tenant).all()
    finally:
        master.close()
    if args.tenant:
        tenants = [t for t in tenants if getattr(t, "slug", None) == args.tenant]
        if not tenants:
            raise SystemExit(f"No tenant with slug '{args.tenant}' in the master registry.")

    mode = "APPLY" if args.apply else "DRY-RUN"
    now = datetime.utcnow()
    total_closed = 0

    for t in tenants:
        slug = getattr(t, "slug", None)
        if not slug:
            continue
        try:
            db = open_tenant_session(slug)
        except Exception as e:
            logger.error("open_tenant_session(%s) failed: %s", slug, e)
            continue
        try:
            a_closed, a_skipped = _cleanup_superseded_ns_rows(db, t.id, now, args.apply)
            b_closed, b_skipped = _cleanup_seeded_demo_rows(db, t.id, now, args.apply)

            for v, why in a_closed + b_closed:
                logger.info("[%s] %s row %-5s %-16s %-28s host=%s — %s",
                            mode, slug, v.id, v.vuln_id,
                            (v.closure_evidence or {}).get("previous_status", v.status) if args.apply else v.status,
                            v.affected_host, why)
            for v, why in a_skipped + b_skipped:
                logger.warning("[%s] %s row %-5s %-16s LEFT UNTOUCHED — %s",
                               mode, slug, v.id, v.vuln_id, why)

            if args.apply and (a_closed or b_closed):
                db.commit()
            total_closed += len(a_closed) + len(b_closed)
            logger.info("[%s] tenant=%s: %d closed (%d superseded NS-, %d seeded demo), %d left untouched",
                        mode, slug, len(a_closed) + len(b_closed),
                        len(a_closed), len(b_closed), len(a_skipped) + len(b_skipped))
        except Exception:
            db.rollback()
            logger.exception("tenant=%s failed — rolled back", slug)
        finally:
            db.close()

    logger.info("[%s] Done. %d row(s) %s across %d tenant(s).",
                mode, total_closed, "closed" if args.apply else "would be closed", len(tenants))


if __name__ == "__main__":
    main()
